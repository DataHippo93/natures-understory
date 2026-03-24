"""
main.py — CLI entry point for the Clover Sales Analysis Bot

Usage
-----
    python main.py --demo                       # demo with synthetic data (no credentials needed)
    python main.py --demo --report labor        # focused labor ratio report
    python main.py                              # 30-day forecast, all merchants
    python main.py --days 90                   # 90-day look-back
    python main.py --merchant NATURES_STOREHOUSE
    python main.py --report labor              # focused labor ratio table
    python main.py --serve                     # start the dashboard server (fetches fresh data on startup)
    python main.py --serve --cached            # start server serving from cache (Docker mode)
    python main.py --refresh-cache             # fetch data, write cache files, exit (used by cron)
    python main.py --export                    # write sales_trends.csv only
"""

import argparse
import json
import logging
import os
import sys
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

# ---------------------------------------------------------------------------
# Cache paths
# ---------------------------------------------------------------------------
CACHE_DIR = Path("cache")
LABOR_CACHE_FILE = CACHE_DIR / "labor_cache.json"
STORE_CACHE_FILE = CACHE_DIR / "store_cache.json"
REFRESH_COOLDOWN_SECS = 300  # minimum seconds between /api/refresh requests

import pandas as pd
import yaml
from dotenv import load_dotenv
from rich.console import Console
from rich.table import Table

from analyzer import (
    aggregate_by_hour_and_dow,
    build_hourly_analysis,
    export_csv,
    generate_fake_payments,
    payments_to_dataframe,
)
from clover_client import build_clients_from_config
from homebase_client import build_labor_source, FakeLaborData, HomebaseTierError

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(name)s — %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler("storehouse.log", encoding="utf-8"),
    ],
)
logger = logging.getLogger(__name__)
console = Console()

# ---------------------------------------------------------------------------
# Config loading
# ---------------------------------------------------------------------------

def load_config(config_path: str = "config.yaml") -> dict:
    p = Path(config_path)
    if not p.exists():
        logger.error("Config file not found: %s", p.resolve())
        sys.exit(1)
    with p.open() as f:
        return yaml.safe_load(f)


def load_env():
    """Load .env from the project root (WSL-safe absolute path)."""
    env_path = Path(__file__).parent / ".env"
    if env_path.exists():
        load_dotenv(dotenv_path=env_path)
        logger.info("Loaded environment from %s", env_path)
    else:
        logger.warning(
            ".env not found at %s — relying on shell environment variables.", env_path
        )


# ---------------------------------------------------------------------------
# Cache helpers
# ---------------------------------------------------------------------------

def _read_cache(path: Path):
    try:
        if path.exists():
            return json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        logger.warning("Cache read error %s: %s", path, exc)
    return None


def _write_cache(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, default=str), encoding="utf-8")
    logger.info("Cache written → %s", path.resolve())


# ---------------------------------------------------------------------------
# Display helpers
# ---------------------------------------------------------------------------

_SCORE_COLOR = {
    range(0, 4): "red",
    range(4, 7): "yellow",
    range(7, 11): "green",
}


def _score_color(score: float) -> str:
    for r, color in _SCORE_COLOR.items():
        if int(score) in r:
            return color
    return "white"


def _ratio_color(ratio) -> str:
    if ratio is None:
        return "dim"
    if ratio < 20:
        return "green"
    if ratio <= 35:
        return "yellow"
    return "red"


def _ratio_label(ratio) -> str:
    if ratio is None:
        return "no sales"
    if ratio < 20:
        return "Excellent"
    if ratio <= 35:
        return "Acceptable"
    return "Review"


def print_forecast_table(merchant_name: str, hourly: pd.DataFrame, demo: bool = False):
    has_labor = "avg_labor_cost" in hourly.columns
    demo_tag = " [dim](DEMO DATA)[/dim]" if demo else ""

    table = Table(
        title=f"[bold cyan]Chore Forecast — {merchant_name}[/bold cyan]{demo_tag}",
        show_header=True,
        header_style="bold magenta",
    )
    table.add_column("Hour (local)", justify="center", style="dim", width=14)
    table.add_column("Avg Txns", justify="right")
    table.add_column("Avg Sales ($)", justify="right")
    table.add_column("Quiet Score", justify="center")
    if has_labor:
        table.add_column("Labor Cost/hr", justify="right")
        table.add_column("Labor Ratio %", justify="center")
    table.add_column("Recommendation", justify="left")

    for _, row in hourly.iterrows():
        hour = int(row["hour"])
        score = row["quiet_score"]
        score_color = _score_color(score)
        label = (
            "Schedule chores" if score >= 7
            else ("Light activity" if score >= 4 else "Peak — avoid")
        )

        cols = [
            f"{hour:02d}:00-{hour:02d}:59",
            f"{row['avg_transactions']:.1f}",
            f"{row['avg_volume']:.2f}",
            f"[{score_color}]{score:.1f}[/{score_color}]",
        ]

        if has_labor:
            ratio = row.get("labor_ratio_pct")
            ratio_val = float(ratio) if ratio is not None else None
            rc = _ratio_color(ratio_val)
            ratio_str = f"[{rc}]{ratio_val:.1f}%[/{rc}]" if ratio_val is not None else "[dim]--[/dim]"
            cols += [f"${row['avg_labor_cost']:.2f}", ratio_str]

        cols.append(label)
        table.add_row(*cols)

    console.print(table)


def print_labor_report(merchant_name: str, hourly: pd.DataFrame, demo: bool = False):
    """Focused labor ratio table for the meeting report."""
    if "labor_ratio_pct" not in hourly.columns:
        console.print("[yellow]No labor data available.[/yellow]")
        return

    demo_tag = " [dim](DEMO DATA)[/dim]" if demo else ""

    table = Table(
        title=f"[bold cyan]Labor Ratio Report — {merchant_name}[/bold cyan]{demo_tag}",
        caption="[dim]Target: <20% Excellent | 20-35% Acceptable | >35% Review[/dim]",
        show_header=True,
        header_style="bold magenta",
    )
    table.add_column("Hour (local)", justify="center", style="dim", width=14)
    table.add_column("Avg Sales ($)", justify="right")
    table.add_column("Labor Cost ($)", justify="right")
    table.add_column("Labor Hrs", justify="right")
    table.add_column("Labor Ratio %", justify="center", width=14)
    table.add_column("Efficiency", justify="left")

    for _, row in hourly.iterrows():
        hour = int(row["hour"])
        ratio = row.get("labor_ratio_pct")
        ratio_val = float(ratio) if ratio is not None else None
        rc = _ratio_color(ratio_val)
        ratio_str = f"[{rc}]{ratio_val:.1f}%[/{rc}]" if ratio_val is not None else "[dim]no sales[/dim]"

        table.add_row(
            f"{hour:02d}:00-{hour:02d}:59",
            f"{row['avg_volume']:.2f}",
            f"{row['avg_labor_cost']:.2f}",
            f"{row['avg_labor_hours']:.2f}",
            ratio_str,
            f"[{rc}]{_ratio_label(ratio_val)}[/{rc}]",
        )

    console.print(table)


# ---------------------------------------------------------------------------
# Home Assistant JSON export
# ---------------------------------------------------------------------------

def _build_store_payload(all_results: dict, days_window: int = 90, demo: bool = False) -> dict:
    """Assemble the /store_status JSON payload from analysis results."""
    export_cols = ["hour", "avg_transactions", "avg_volume", "quiet_score", "days_observed"]

    payload = {
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "demo": demo,
        "days_window": days_window,
        "merchants": {},
    }

    for mid, info in all_results.items():
        hourly = info["hourly"]
        raw_df = info.get("raw_df")
        local_tz = info.get("local_tz", "America/New_York")

        hours_by_dow = {}
        if raw_df is not None and not raw_df.empty:
            dow_map = aggregate_by_hour_and_dow(raw_df, local_tz=local_tz)
            for dow_int, dow_hourly in dow_map.items():
                if dow_hourly.empty:
                    hours_by_dow[dow_int] = []
                    continue
                hours_by_dow[dow_int] = (
                    dow_hourly[[c for c in export_cols if c in dow_hourly.columns]]
                    .round(2)
                    .to_dict(orient="records")
                )

        payload["merchants"][mid] = {
            "name": info["name"],
            "hours": hourly[export_cols].round(2).to_dict(orient="records"),
            "hours_by_dow": hours_by_dow,
        }

    return payload


def export_store_status_json(all_results: dict, path: str, demo: bool = False, days_window: int = 90):
    payload = _build_store_payload(all_results, days_window=days_window, demo=demo)
    out = Path(path)
    out.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    logger.info("Wrote store status JSON to %s", out.resolve())


# ---------------------------------------------------------------------------
# Labor data helpers
# ---------------------------------------------------------------------------

def _aggregate_labor_by_day(
    timesheets: list,
    shifts: list,
    payments: list,
    multiplier: float,
    local_tz: str,
) -> list:
    """
    Combine timesheet actuals, scheduled shifts, and Clover sales into a
    per-calendar-day list with nominal and fully-loaded labor costs.
    """
    import pytz

    tz = pytz.timezone(local_tz)
    today = datetime.now(timezone.utc).astimezone(tz).date()
    DOW = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]

    # --- Actuals from timesheets ---
    actuals: dict = {}
    for ts in timesheets:
        try:
            clocked_in = datetime.fromisoformat(ts["clocked_in_at"])
        except (KeyError, ValueError, TypeError):
            continue
        if clocked_in.tzinfo is None:
            clocked_in = clocked_in.replace(tzinfo=timezone.utc)
        day = clocked_in.astimezone(tz).date()

        hours = float(ts.get("regular_hours", 0)) + float(ts.get("overtime_hours", 0))
        if hours == 0:
            try:
                clocked_out = datetime.fromisoformat(ts["clocked_out_at"])
                if clocked_out.tzinfo is None:
                    clocked_out = clocked_out.replace(tzinfo=timezone.utc)
                hours = (clocked_out - clocked_in).total_seconds() / 3600
            except (KeyError, ValueError, TypeError):
                pass

        cost = float(ts.get("total_cost", 0))
        if day not in actuals:
            actuals[day] = {"hours": 0.0, "cost": 0.0}
        actuals[day]["hours"] += hours
        actuals[day]["cost"] += cost

    # --- Scheduled from shifts ---
    scheduled: dict = {}
    published_dates: set = set()
    for sh in shifts:
        start_str = sh.get("start_at") or sh.get("scheduled_start_at")
        end_str = sh.get("end_at") or sh.get("scheduled_end_at")
        if not start_str or not end_str:
            continue
        try:
            s_dt = datetime.fromisoformat(start_str)
            e_dt = datetime.fromisoformat(end_str)
        except (ValueError, TypeError):
            continue
        if s_dt.tzinfo is None:
            s_dt = s_dt.replace(tzinfo=timezone.utc)
        if e_dt.tzinfo is None:
            e_dt = e_dt.replace(tzinfo=timezone.utc)

        day = s_dt.astimezone(tz).date()
        hours = (e_dt - s_dt).total_seconds() / 3600
        emp = sh.get("employee") or {}
        hourly_rate = float(
            emp.get("hourly_rate") or emp.get("pay_rate") or emp.get("wage") or 0
        )
        cost = hours * hourly_rate

        if day not in scheduled:
            scheduled[day] = {"hours": 0.0, "cost": 0.0}
        scheduled[day]["hours"] += hours
        scheduled[day]["cost"] += cost

        # published_at being present (non-null) means the shift is on the published schedule
        if sh.get("published_at") or sh.get("published"):
            published_dates.add(day)

    # --- Sales from Clover payments ---
    sales_by_day: dict = {}
    for p in payments:
        ts_ms = p.get("createdTime")
        if not ts_ms:
            continue
        day = (
            datetime.fromtimestamp(ts_ms / 1000, tz=timezone.utc)
            .astimezone(tz)
            .date()
        )
        # Skip voided/failed payments; subtract refunds for net sales
        if p.get("result") and p.get("result") != "SUCCESS":
            continue
        gross_cents = p.get("amount", 0)
        refund_cents = 0
        refunds_obj = p.get("refunds")
        if isinstance(refunds_obj, dict):
            for r in refunds_obj.get("elements", []):
                refund_cents += r.get("amount", 0)
        net = (gross_cents - refund_cents) / 100.0
        sales_by_day[day] = sales_by_day.get(day, 0.0) + net

    # --- DOW average sales from historical data (for projecting future days) ---
    # Group past sales by day-of-week to get an average daily sales per DOW
    dow_sales: dict = {i: [] for i in range(7)}
    for day, amt in sales_by_day.items():
        if day <= today and amt > 0.01:
            dow_sales[day.weekday()].append(amt)
    dow_avg_sales = {
        dow: (sum(v) / len(v)) if v else 0.0
        for dow, v in dow_sales.items()
    }

    # --- Combine all dates ---
    all_dates = sorted(
        set(list(actuals.keys()) + list(scheduled.keys()) + list(sales_by_day.keys()))
    )

    daily = []
    for day in all_dates:
        act = actuals.get(day, {"hours": 0.0, "cost": 0.0})
        sched = scheduled.get(day, {"hours": 0.0, "cost": 0.0})
        is_historical = day <= today
        sales = sales_by_day.get(day, 0.0)

        # For future days with no sales, use the DOW historical average
        projected_sales = 0.0
        if not is_historical and sales < 0.01:
            projected_sales = round(dow_avg_sales.get(day.weekday(), 0.0), 2)

        effective_sales = sales if is_historical else projected_sales

        act_loaded = round(act["cost"] * multiplier, 2)
        sched_loaded = round(sched["cost"] * multiplier, 2)

        actual_ratio = (
            round(act_loaded / effective_sales * 100, 1)
            if effective_sales > 0.01 and act["hours"] > 0
            else None
        )
        sched_ratio = (
            round(sched_loaded / effective_sales * 100, 1)
            if effective_sales > 0.01 and sched["hours"] > 0
            else None
        )

        daily.append(
            {
                "date": day.isoformat(),
                "day_of_week": DOW[day.weekday()],
                "is_historical": is_historical,
                "schedule_published": day in published_dates,
                "actual_hours": round(act["hours"], 2),
                "actual_cost_nominal": round(act["cost"], 2),
                "actual_cost_loaded": act_loaded,
                "scheduled_hours": round(sched["hours"], 2),
                "scheduled_cost_nominal": round(sched["cost"], 2),
                "scheduled_cost_loaded": sched_loaded,
                "sales": round(sales, 2),
                "projected_sales": projected_sales,
                "actual_labor_ratio_pct": actual_ratio,
                "scheduled_labor_ratio_pct": sched_ratio,
            }
        )

    return daily


def _compute_labor_summary(daily: list) -> dict:
    total_act_cost = sum(d["actual_cost_loaded"] for d in daily)
    total_sched_cost = sum(d["scheduled_cost_loaded"] for d in daily)
    total_act_hours = sum(d["actual_hours"] for d in daily)
    total_sched_hours = sum(d["scheduled_hours"] for d in daily)
    # For sales total: use actual sales for historical days, projected for future days
    total_sales = sum(
        d["sales"] if d["is_historical"] else d.get("projected_sales", 0.0)
        for d in daily
    )
    hist_sales = sum(d["sales"] for d in daily if d["is_historical"])

    return {
        "total_actual_hours": round(total_act_hours, 1),
        "total_actual_cost_loaded": round(total_act_cost, 2),
        "total_scheduled_hours": round(total_sched_hours, 1),
        "total_scheduled_cost_loaded": round(total_sched_cost, 2),
        "total_sales": round(hist_sales, 2),           # historical only for the KPI
        "total_sales_with_projected": round(total_sales, 2),  # includes projected future
        "actual_labor_ratio_pct": (
            round(total_act_cost / hist_sales * 100, 1)
            if hist_sales > 0.01 and total_act_cost > 0
            else None
        ),
        "scheduled_labor_ratio_pct": (
            round(total_sched_cost / total_sales * 100, 1)
            if total_sales > 0.01 and total_sched_cost > 0
            else None
        ),
    }


def _fetch_labor_payload(
    labor_source,
    clients: dict,
    demo: bool,
    local_tz: str,
    start,
    end,
    multiplier: float,
    config: dict,
) -> dict:
    """Fetch timesheets, shifts, and Clover sales; return the full labor_data payload."""
    now = datetime.now(timezone.utc)
    src = labor_source
    synthetic = demo or isinstance(src, FakeLaborData)

    try:
        timesheets = list(src.fetch_timesheets(start, min(end, now)))
        shifts = list(src.fetch_scheduled_shifts(start, end))
    except HomebaseTierError as exc:
        logger.warning("Homebase tier error — falling back to synthetic: %s", exc)
        src = FakeLaborData(avg_wage=config.get("labor", {}).get("fake_avg_wage", 17.00))
        synthetic = True
        timesheets = list(src.fetch_timesheets(start, min(end, now)))
        shifts = list(src.fetch_scheduled_shifts(start, end))

    if demo:
        payments = generate_fake_payments(days=max(1, (min(end, now) - start).days))
    elif clients:
        payments = []
        for client in clients.values():
            payments.extend(client.fetch_payments(start_dt=start, end_dt=min(end, now)))
    else:
        payments = []

    daily = _aggregate_labor_by_day(timesheets, shifts, payments, multiplier, local_tz)
    summary = _compute_labor_summary(daily)
    pub_dates = [d["date"] for d in daily if d["schedule_published"]]

    return {
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "period": {
            "start": start.date().isoformat(),
            "end": end.date().isoformat(),
        },
        "loaded_cost_multiplier": multiplier,
        "schedule_published_through": max(pub_dates) if pub_dates else None,
        "daily": daily,
        "summary": summary,
        "demo": demo,
        "synthetic": synthetic,
    }


def build_caches(
    clients: dict,
    config: dict,
    labor_source,
    demo: bool,
    local_tz: str,
    default_days: int,
    loaded_multiplier: float,
) -> None:
    """Fetch fresh data and write both cache files. Used by --refresh-cache and /api/refresh."""
    now = datetime.now(timezone.utc)
    start = now - timedelta(days=default_days)
    labor_end = now + timedelta(days=7)

    logger.info("Building labor cache (%.0f-day window + 7-day schedule)...", default_days)
    try:
        labor = _fetch_labor_payload(
            labor_source, clients, demo, local_tz, start, labor_end, loaded_multiplier, config
        )
        _write_cache(LABOR_CACHE_FILE, labor)
        logger.info("Labor cache updated.")
    except Exception as exc:
        logger.error("Labor cache build failed: %s", exc, exc_info=True)

    logger.info("Building store cache...")
    try:
        if clients:
            results = {}
            for cid, client in clients.items():
                merchant_name = next(
                    (m["name"] for m in config.get("merchants", []) if m["id"] == cid), cid
                )
                payments = list(client.fetch_payments(start_dt=start, end_dt=now))
                if not payments:
                    continue
                hourly = build_hourly_analysis(
                    payments, lookback_days=default_days, local_tz=local_tz
                )
                results[cid] = {
                    "name": merchant_name,
                    "hourly": hourly,
                    "raw_df": payments_to_dataframe(payments),
                    "local_tz": local_tz,
                }
            if results:
                store = _build_store_payload(results, days_window=default_days, demo=demo)
                _write_cache(STORE_CACHE_FILE, store)
                logger.info("Store cache updated.")
        elif demo:
            fake_payments = generate_fake_payments(days=default_days)
            hourly = build_hourly_analysis(fake_payments, lookback_days=default_days, local_tz=local_tz)
            results = {}
            for m in config.get("merchants", []):
                results[m["id"]] = {
                    "name": m["name"],
                    "hourly": hourly,
                    "raw_df": payments_to_dataframe(fake_payments),
                    "local_tz": local_tz,
                }
            store = _build_store_payload(results, days_window=default_days, demo=True)
            _write_cache(STORE_CACHE_FILE, store)
            logger.info("Store cache (demo) updated.")
    except Exception as exc:
        logger.error("Store cache build failed: %s", exc, exc_info=True)


# ---------------------------------------------------------------------------
# Flask REST endpoint (optional --serve mode)
# ---------------------------------------------------------------------------

def start_server(
    all_results: dict,
    host: str,
    port: int,
    json_path: str,
    clients: dict = None,
    config: dict = None,
    local_tz: str = "America/New_York",
    min_daily_sales: float = 0.01,
    default_days: int = 90,
    demo: bool = False,
    labor_source=None,
    loaded_multiplier: float = 1.2,
):
    from flask import Flask, jsonify, render_template, request as flask_request

    app = Flask(__name__, template_folder="templates")

    # Refresh state (shared mutable dict — safe for single-process Flask)
    _refresh_state = {"in_progress": False, "last_attempt": 0.0}

    def _fetch_and_build(start_dt, end_dt, days_window):
        results = {}
        for cid, client in clients.items():
            merchant_name = next(
                (m["name"] for m in config.get("merchants", []) if m["id"] == cid),
                cid,
            )
            payments = list(client.fetch_payments(start_dt=start_dt, end_dt=end_dt))
            if not payments:
                continue
            hourly = build_hourly_analysis(
                payments,
                lookback_days=days_window,
                local_tz=local_tz,
                min_daily_sales=min_daily_sales,
            )
            results[cid] = {
                "name": merchant_name,
                "hourly": hourly,
                "raw_df": payments_to_dataframe(payments),
                "local_tz": local_tz,
            }
        return _build_store_payload(results, days_window=days_window, demo=demo)

    @app.route("/")
    def dashboard():
        return render_template("dashboard.html")

    @app.route("/store_status")
    def store_status():
        start_param = flask_request.args.get("start")
        end_param = flask_request.args.get("end")
        days_param = flask_request.args.get("days")

        if clients and (start_param or end_param or days_param):
            try:
                now = datetime.now(timezone.utc)
                if start_param or end_param:
                    s = datetime.fromisoformat(start_param).replace(tzinfo=timezone.utc) if start_param else (now - timedelta(days=default_days))
                    e = datetime.fromisoformat(end_param).replace(tzinfo=timezone.utc) if end_param else now
                    if end_param:
                        e = e.replace(hour=23, minute=59, second=59)
                    days_window = max(1, (e - s).days)
                else:
                    days_window = max(1, min(365, int(days_param)))
                    e = now
                    s = now - timedelta(days=days_window)
                return jsonify(_fetch_and_build(s, e, days_window))
            except Exception as exc:
                logger.error("Dynamic fetch failed: %s", exc)
                return jsonify({"error": str(exc)}), 500

        # No dynamic params — serve from file (store_status.json or cache)
        try:
            data = json.loads(Path(json_path).read_text(encoding="utf-8"))
        except FileNotFoundError:
            # Fall back to store cache if the primary json_path is missing
            cached = _read_cache(STORE_CACHE_FILE)
            if cached:
                return jsonify(cached)
            return jsonify({"error": "Store data not available yet. Try again shortly."}), 503
        return jsonify(data)

    @app.route("/labor_data")
    def labor_data_route():
        start_param = flask_request.args.get("start")
        end_param = flask_request.args.get("end")
        days_param = flask_request.args.get("days")
        multiplier = float(flask_request.args.get("multiplier", str(loaded_multiplier)))

        # No custom params and not demo → serve from cache to avoid hammering APIs
        if not (start_param or end_param or days_param) and not demo:
            cached = _read_cache(LABOR_CACHE_FILE)
            if cached is not None:
                return jsonify(cached)
            # Cache miss — fall through to live fetch

        now = datetime.now(timezone.utc)

        if start_param:
            try:
                start = datetime.fromisoformat(start_param).replace(tzinfo=timezone.utc)
            except ValueError:
                return jsonify({"error": "Invalid start date"}), 400
        elif days_param:
            start = now - timedelta(days=max(1, min(365, int(days_param))))
        else:
            start = now - timedelta(days=30)

        if end_param:
            try:
                end = (
                    datetime.fromisoformat(end_param)
                    .replace(tzinfo=timezone.utc)
                    .replace(hour=23, minute=59, second=59)
                )
            except ValueError:
                return jsonify({"error": "Invalid end date"}), 400
        else:
            end = now + timedelta(days=7)

        if labor_source is None:
            return jsonify({"error": "Labor source not configured"}), 503

        try:
            payload = _fetch_labor_payload(
                labor_source, clients, demo, local_tz, start, end, multiplier, config
            )
            return jsonify(payload)
        except Exception as exc:
            logger.error("Labor data fetch failed: %s", exc, exc_info=True)
            return jsonify({"error": str(exc)}), 500

    @app.route("/api/cache_status")
    def api_cache_status():
        labor_cache = _read_cache(LABOR_CACHE_FILE)
        return jsonify({
            "updated_at": labor_cache.get("updated_at") if labor_cache else None,
            "refreshing": _refresh_state["in_progress"],
        })

    @app.route("/api/refresh", methods=["POST"])
    def api_refresh():
        if _refresh_state["in_progress"]:
            return jsonify({"status": "already_refreshing"}), 429
        elapsed = time.time() - _refresh_state["last_attempt"]
        if elapsed < REFRESH_COOLDOWN_SECS:
            remaining = int(REFRESH_COOLDOWN_SECS - elapsed)
            return jsonify({"status": "rate_limited", "retry_after": remaining}), 429

        _refresh_state["in_progress"] = True
        _refresh_state["last_attempt"] = time.time()

        def _do_refresh():
            try:
                build_caches(
                    clients, config, labor_source, demo,
                    local_tz, default_days, loaded_multiplier,
                )
            finally:
                _refresh_state["in_progress"] = False

        threading.Thread(target=_do_refresh, daemon=True).start()
        return jsonify({"status": "refreshing"})

    @app.route("/health")
    def health():
        return jsonify({"status": "ok"})

    logger.info("Starting dashboard on %s:%d", host, port)
    console.print(f"[bold green]Dashboard:[/bold green]    http://localhost:{port}/")
    console.print(f"[dim]API:[/dim]           http://localhost:{port}/store_status")
    app.run(host=host, port=port, debug=False, threaded=True)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def parse_args():
    p = argparse.ArgumentParser(description="Clover Sales Analysis Bot")
    p.add_argument(
        "--demo",
        action="store_true",
        help="Use synthetic sales + labor data (no credentials needed)",
    )
    p.add_argument(
        "--days",
        type=int,
        default=90,
        help="Look-back window in days (default: 90)",
    )
    p.add_argument(
        "--merchant",
        type=str,
        default=None,
        help="Limit analysis to a single merchant ID (e.g. NATURES_STOREHOUSE)",
    )
    p.add_argument(
        "--tz",
        type=str,
        default="America/New_York",
        help="Local timezone for hour bucketing (default: America/New_York)",
    )
    p.add_argument(
        "--report",
        type=str,
        choices=["labor", "forecast", "all"],
        default="all",
        help="Which report to print: forecast, labor, or all (default: all)",
    )
    p.add_argument(
        "--export",
        action="store_true",
        help="Write sales_trends.csv and exit",
    )
    p.add_argument(
        "--serve",
        action="store_true",
        help="Start the dashboard server after analysis",
    )
    p.add_argument(
        "--cached",
        action="store_true",
        help="(With --serve) Skip initial data fetch; serve from cache files. Used in Docker.",
    )
    p.add_argument(
        "--refresh-cache",
        action="store_true",
        dest="refresh_cache",
        help="Fetch fresh data, write to cache files, and exit. Used by the cron job.",
    )
    p.add_argument(
        "--config",
        type=str,
        default="config.yaml",
        help="Path to config.yaml (default: config.yaml)",
    )
    return p.parse_args()


def main():
    args = parse_args()

    load_env()
    config = load_config(args.config)

    analysis_cfg = config.get("analysis", {})
    min_daily_sales = analysis_cfg.get("min_daily_sales_threshold", 0.01)
    output_cfg = config.get("output", {})
    csv_path = output_cfg.get("csv_path", "sales_trends.csv")
    server_cfg = config.get("server", {})
    labor_cfg = config.get("labor", {})
    loaded_multiplier = float(labor_cfg.get("loaded_cost_multiplier", 1.2))

    # --- Determine client set (or demo mode) ---
    if args.demo:
        console.print("[bold yellow]Demo mode — synthetic sales + labor data. Numbers are illustrative.[/bold yellow]")
        clients = None
    else:
        clients = build_clients_from_config(config, os.environ)
        if not clients and not (args.refresh_cache or args.cached):
            console.print("[bold red]No merchants configured. Check your .env file.[/bold red]")
            console.print("[dim]Tip: run with --demo to preview with synthetic data.[/dim]")
            sys.exit(1)

    labor_source = build_labor_source(config, os.environ)

    # ---------------------------------------------------------------------------
    # --refresh-cache mode: build both caches and exit
    # ---------------------------------------------------------------------------
    if args.refresh_cache:
        console.print("[bold]Refreshing data cache...[/bold]")
        build_caches(
            clients, config, labor_source,
            demo=args.demo,
            local_tz=args.tz,
            default_days=args.days,
            loaded_multiplier=loaded_multiplier,
        )
        console.print("[green]Cache refresh complete.[/green]")
        return

    # ---------------------------------------------------------------------------
    # --serve --cached mode: start Flask immediately, serve from cache
    # ---------------------------------------------------------------------------
    if args.serve and args.cached:
        json_path = str(STORE_CACHE_FILE)
        console.print("[dim]Cached mode — serving from cache files.[/dim]")
        start_server(
            all_results={},
            host=server_cfg.get("host", "0.0.0.0"),
            port=server_cfg.get("port", 8765),
            json_path=json_path,
            clients=clients,
            config=config,
            local_tz=args.tz,
            min_daily_sales=min_daily_sales,
            default_days=args.days,
            demo=args.demo,
            labor_source=labor_source,
            loaded_multiplier=loaded_multiplier,
        )
        return

    # ---------------------------------------------------------------------------
    # Normal mode: fetch data, print reports, (optionally) start server
    # ---------------------------------------------------------------------------

    all_config_merchants = config.get("merchants", [])
    if args.merchant:
        all_config_merchants = [m for m in all_config_merchants if m["id"] == args.merchant]

    if args.demo:
        target_merchants = [(m["id"], m["name"]) for m in all_config_merchants]
        target_client_ids = {}
    else:
        if args.merchant and args.merchant not in clients:
            console.print(
                f"[bold red]Merchant '{args.merchant}' not found. "
                f"Available: {', '.join(clients)}[/bold red]"
            )
            sys.exit(1)
        target_client_ids = {args.merchant: clients[args.merchant]} if args.merchant else clients
        target_merchants = [
            (mid, next(m["name"] for m in config["merchants"] if m["id"] == mid))
            for mid in target_client_ids
        ]

    end_dt = datetime.now(timezone.utc)
    start_dt = end_dt - timedelta(days=args.days)

    all_results: dict = {}

    for merchant_id, merchant_name in target_merchants:
        fetch_label = "Generating demo data" if args.demo else f"Fetching last {args.days} days"
        console.print(f"\n[bold]{fetch_label} for {merchant_name}...[/bold]")

        if args.demo:
            payments = generate_fake_payments(days=args.days)
        else:
            payments = list(target_client_ids[merchant_id].fetch_payments_last_n_days(days=args.days))

        if not payments:
            logger.warning("No payments returned for %s — skipping.", merchant_name)
            console.print(f"[yellow]No data for {merchant_name}.[/yellow]")
            continue

        hourly = build_hourly_analysis(
            payments,
            lookback_days=args.days,
            local_tz=args.tz,
            min_daily_sales=min_daily_sales,
        )

        all_results[merchant_id] = {
            "name": merchant_name,
            "hourly": hourly,
            "raw_df": payments_to_dataframe(payments),
            "local_tz": args.tz,
        }

        if args.report in ("forecast", "all"):
            print_forecast_table(merchant_name, hourly, demo=args.demo)

        if args.report in ("labor", "all"):
            print_labor_report(merchant_name, hourly, demo=args.demo)

    if not all_results:
        console.print("[bold red]No data available for any merchant.[/bold red]")
        sys.exit(0)

    combined = pd.concat(
        [r["hourly"].assign(merchant=r["name"]) for r in all_results.values()],
        ignore_index=True,
    )
    export_csv(combined, csv_path)
    console.print(f"[dim]CSV written to {csv_path}[/dim]")

    if args.export:
        sys.exit(0)

    json_path = server_cfg.get("json_output_path", "store_status.json")
    export_store_status_json(all_results, json_path, demo=args.demo, days_window=args.days)
    console.print(f"[dim]Store status JSON written to {json_path}[/dim]")

    if args.serve:
        start_server(
            all_results,
            host=server_cfg.get("host", "0.0.0.0"),
            port=server_cfg.get("port", 8765),
            json_path=json_path,
            clients=clients,
            config=config,
            local_tz=args.tz,
            min_daily_sales=min_daily_sales,
            default_days=args.days,
            demo=args.demo,
            labor_source=labor_source,
            loaded_multiplier=loaded_multiplier,
        )


if __name__ == "__main__":
    main()
