"""
analyzer.py — Data processing and Quiet Score analytics

Consumes raw Clover payment dicts, aggregates by hour, filters closed
days, and emits a Quiet Score (0–10) for each hour block.
"""

import logging
from datetime import datetime, timedelta, timezone
from typing import Iterable

import pandas as pd

logger = logging.getLogger(__name__)


def generate_fake_payments(days: int = 30, seed: int = 7) -> list[dict]:
    """
    Generate realistic fake Clover payment dicts for demo/testing.

    Models a small Adirondack retail store:
      - Busy hours: 10am–1pm and 3pm–6pm
      - Slow hours: 8–9am, 6–9pm, near-zero overnight
      - Closed Sundays (no transactions)
      - Ticket size: $8–$85 with peak-hour clustering
    """
    import random
    rng = random.Random(seed)

    # Avg transactions per hour (0-indexed, local time)
    hourly_weight = [
        0, 0, 0, 0, 0, 0, 0, 0,   # 0–7am
        0.3, 1.0,                   # 8–9am  (opening)
        3.5, 6.0, 7.0, 5.5,        # 10am–1pm (morning rush)
        4.0, 6.5, 7.5, 6.0,        # 2–5pm  (afternoon peak)
        3.0, 1.5, 0.5, 0, 0, 0,    # 6–11pm (closing)
    ]

    import pytz
    eastern = pytz.timezone("America/New_York")

    end_dt = datetime.now(timezone.utc)
    start_dt = end_dt - timedelta(days=days)
    payments = []
    payment_id = 1000

    # Walk calendar days in Eastern local time so hour weights map correctly
    current_date = start_dt.astimezone(eastern).date()
    end_date = end_dt.astimezone(eastern).date()

    while current_date <= end_date:
        # Closed Sundays
        if current_date.weekday() == 6:
            current_date += timedelta(days=1)
            continue

        # Slightly busier on Fridays/Saturdays
        day_multiplier = 1.3 if current_date.weekday() >= 4 else 1.0

        for hour, weight in enumerate(hourly_weight):
            expected = weight * day_multiplier
            if expected <= 0:
                continue

            txn_count = rng.choices(
                [0, 1, 2, 3, 4, 5],
                weights=[
                    max(0, 1 - expected),
                    expected * 0.4,
                    expected * 0.3,
                    expected * 0.2,
                    expected * 0.07,
                    expected * 0.03,
                ],
            )[0]

            for _ in range(txn_count):
                minute = rng.randint(0, 59)
                second = rng.randint(0, 59)
                # Build timestamp in Eastern local time, then convert to UTC
                local_dt = eastern.localize(
                    datetime(current_date.year, current_date.month, current_date.day,
                             hour, minute, second)
                )
                ts = local_dt.astimezone(timezone.utc)
                if ts >= end_dt:
                    continue

                # Calibrated to ~$130 avg ticket for a small natural food store
                # (~23 transactions/day * $130 avg = ~$3,000/day)
                amount_dollars = rng.uniform(25, 210)
                # Slightly larger baskets during peak grocery hours
                if 10 <= hour <= 15:
                    amount_dollars *= rng.uniform(1.0, 1.2)

                payments.append({
                    "id": f"demo-{payment_id}",
                    "createdTime": int(ts.timestamp() * 1000),  # UTC ms epoch
                    "amount": int(amount_dollars * 100),
                    "tender": {"label": rng.choice(["CREDIT", "CREDIT", "CASH", "DEBIT"])},
                })
                payment_id += 1

        current_date += timedelta(days=1)

    logger.info("Demo mode: generated %d fake payments over %d days.", len(payments), days)
    return payments


def payments_to_dataframe(payments: Iterable[dict]) -> pd.DataFrame:
    """
    Convert an iterable of raw Clover payment dicts to a tidy DataFrame.

    Columns returned
    ----------------
    created_at  : datetime64[ns, UTC]
    amount      : float  (net dollars: gross minus refunds, from Clover cents)
    payment_id  : str
    tender_type : str    (CREDIT, CASH, etc. — from expand=tender)

    Filters out voided/failed payments (result != SUCCESS).
    Subtracts refund amounts when expand=tender,refunds was used.
    """
    records = []
    for p in payments:
        # Skip voided or failed payments
        result = p.get("result", "SUCCESS")
        if result and result != "SUCCESS":
            logger.debug("Skipping non-SUCCESS payment id=%s result=%s", p.get("id"), result)
            continue

        ts_ms = p.get("createdTime")
        if not ts_ms:
            logger.debug("Skipping payment with no createdTime: %s", p.get("id"))
            continue

        gross_cents = p.get("amount", 0)

        # Subtract refunds (available when expand=tender,refunds)
        refund_cents = 0
        refunds_obj = p.get("refunds")
        if isinstance(refunds_obj, dict):
            for r in refunds_obj.get("elements", []):
                refund_cents += r.get("amount", 0)

        net_cents = gross_cents - refund_cents

        tender_label = "UNKNOWN"
        tender = p.get("tender")
        if isinstance(tender, dict):
            tender_label = tender.get("label", tender.get("id", "UNKNOWN"))

        records.append(
            {
                "payment_id": p.get("id", ""),
                "created_at": pd.Timestamp(ts_ms, unit="ms", tz="UTC"),
                "amount": net_cents / 100.0,
                "tender_type": tender_label,
            }
        )

    if not records:
        logger.warning("No valid payments found — returning empty DataFrame.")
        return pd.DataFrame(
            columns=["payment_id", "created_at", "amount", "tender_type"]
        )

    df = pd.DataFrame(records)
    df["created_at"] = pd.to_datetime(df["created_at"], utc=True)
    logger.info("Loaded %d payments into DataFrame.", len(df))
    return df


def filter_closed_days(
    df: pd.DataFrame,
    min_daily_sales: float = 0.01,
) -> pd.DataFrame:
    """
    Drop all rows whose calendar date had total sales <= *min_daily_sales*.

    This prevents holidays/closures from dragging down hourly averages.
    """
    if df.empty:
        return df

    df = df.copy()
    df["_date"] = df["created_at"].dt.date
    daily_totals = df.groupby("_date")["amount"].sum()
    open_days = daily_totals[daily_totals > min_daily_sales].index

    before = len(df)
    df = df[df["_date"].isin(open_days)].copy()
    df.drop(columns=["_date"], inplace=True)
    dropped_days = len(daily_totals) - len(open_days)

    logger.info(
        "Closed-day filter: removed %d day(s) (%d to %d rows).",
        dropped_days,
        before,
        len(df),
    )
    return df


def aggregate_by_hour(df: pd.DataFrame, local_tz: str = "America/New_York") -> pd.DataFrame:
    """
    Return hourly averages across all open days in *df*.

    Converts UTC timestamps to *local_tz* before bucketing so that the
    hours reflect actual store hours rather than UTC.

    Returns a DataFrame indexed 0–23 with columns:
      hour            : int (0–23 in local time)
      avg_transactions: float
      avg_volume      : float (dollars)
      days_observed   : int
    """
    if df.empty:
        return pd.DataFrame(
            columns=["hour", "avg_transactions", "avg_volume", "days_observed"]
        )

    df = df.copy()
    df["local_dt"] = df["created_at"].dt.tz_convert(local_tz)
    df["hour"] = df["local_dt"].dt.hour
    df["date"] = df["local_dt"].dt.date

    daily_hourly = (
        df.groupby(["date", "hour"])
        .agg(transactions=("payment_id", "count"), volume=("amount", "sum"))
        .reset_index()
    )

    # Average across days; include zeros for hours with no sales on a given day.
    all_dates = daily_hourly["date"].unique()
    all_hours = range(24)
    full_index = pd.MultiIndex.from_product(
        [all_dates, all_hours], names=["date", "hour"]
    )
    daily_hourly = (
        daily_hourly.set_index(["date", "hour"])
        .reindex(full_index, fill_value=0)
        .reset_index()
    )

    hourly = (
        daily_hourly.groupby("hour")
        .agg(
            avg_transactions=("transactions", "mean"),
            avg_volume=("volume", "mean"),
            days_observed=("date", "nunique"),
        )
        .reset_index()
    )

    logger.info("Aggregated %d hour buckets over %d day(s).", len(hourly), len(all_dates))
    return hourly


def compute_quiet_score(hourly: pd.DataFrame) -> pd.DataFrame:
    """
    Append a ``quiet_score`` column (0–10) to an hourly aggregation DataFrame.

    Score of 10 = best time for chores (lowest traffic).
    Score of 0  = worst time (peak traffic).

    Uses min-max normalization on ``avg_transactions`` so the full 0–10
    scale is always used regardless of data magnitude.
    """
    if hourly.empty:
        return hourly

    df = hourly.copy()
    lo = df["avg_transactions"].min()
    hi = df["avg_transactions"].max()

    if hi == lo:
        df["quiet_score"] = 10.0
    else:
        # Invert: fewer transactions → higher score.
        df["quiet_score"] = (
            10.0 * (hi - df["avg_transactions"]) / (hi - lo)
        ).round(1)

    return df


def build_hourly_analysis(
    payments: Iterable[dict],
    lookback_days: int = 30,
    local_tz: str = "America/New_York",
    min_daily_sales: float = 0.01,
) -> pd.DataFrame:
    """
    End-to-end pipeline: raw payments → hourly Quiet Score table.

    Parameters
    ----------
    payments     : iterable of raw Clover payment dicts
    lookback_days: informational only (filtering should happen at fetch time)
    local_tz     : IANA timezone string for local-hour bucketing
    min_daily_sales: dollars threshold to identify closed days

    Returns
    -------
    DataFrame with columns:
      hour, avg_transactions, avg_volume, days_observed, quiet_score
    """
    df = payments_to_dataframe(payments)
    df = filter_closed_days(df, min_daily_sales=min_daily_sales)
    hourly = aggregate_by_hour(df, local_tz=local_tz)
    hourly = compute_quiet_score(hourly)
    return hourly



def aggregate_by_hour_and_dow(df: pd.DataFrame, local_tz: str = "America/New_York") -> dict:
    """
    Return hourly averages broken down by day-of-week.

    Returns a dict keyed by DOW integer (0=Monday ... 6=Sunday), each value
    being a DataFrame identical in shape to aggregate_by_hour() output
    (plus a quiet_score column computed per-DOW).
    """
    if df.empty:
        return {}

    df = df.copy()
    df["local_dt"] = df["created_at"].dt.tz_convert(local_tz)
    df["hour"] = df["local_dt"].dt.hour
    df["date"] = df["local_dt"].dt.date
    df["dow"] = df["local_dt"].dt.dayofweek  # 0=Mon, 6=Sun

    result = {}
    for dow in range(7):
        dow_df = df[df["dow"] == dow]
        if dow_df.empty:
            result[dow] = pd.DataFrame(
                columns=["hour", "avg_transactions", "avg_volume", "days_observed"]
            )
            continue

        daily_hourly = (
            dow_df.groupby(["date", "hour"])
            .agg(transactions=("payment_id", "count"), volume=("amount", "sum"))
            .reset_index()
        )

        all_dates = daily_hourly["date"].unique()
        full_index = pd.MultiIndex.from_product(
            [all_dates, range(24)], names=["date", "hour"]
        )
        daily_hourly = (
            daily_hourly.set_index(["date", "hour"])
            .reindex(full_index, fill_value=0)
            .reset_index()
        )

        hourly = (
            daily_hourly.groupby("hour")
            .agg(
                avg_transactions=("transactions", "mean"),
                avg_volume=("volume", "mean"),
                days_observed=("date", "nunique"),
            )
            .reset_index()
        )
        result[dow] = compute_quiet_score(hourly)

    return result

def timesheets_to_hourly_labor(
    timesheets: Iterable[dict], local_tz: str = "America/New_York"
) -> pd.DataFrame:
    """
    Convert timesheet records to per-hour labor cost allocations.

    Each shift's cost is distributed evenly across every clock hour the
    employee was on the clock.  E.g. an 8am–10am shift at $34 total cost
    contributes $17 to hour 8 and $17 to hour 9.

    Returns a DataFrame with columns: date, hour, labor_cost, labor_hours
    """
    import pytz

    tz = pytz.timezone(local_tz)
    rows = []

    for ts in timesheets:
        try:
            clock_in = datetime.fromisoformat(ts["clocked_in_at"])
            clock_out = datetime.fromisoformat(ts["clocked_out_at"])
        except (KeyError, ValueError, TypeError):
            logger.debug("Skipping malformed timesheet: %s", ts.get("id"))
            continue

        if clock_in.tzinfo is None:
            clock_in = clock_in.replace(tzinfo=timezone.utc)
        if clock_out.tzinfo is None:
            clock_out = clock_out.replace(tzinfo=timezone.utc)

        clock_in_local = clock_in.astimezone(tz)
        clock_out_local = clock_out.astimezone(tz)

        total_minutes = (clock_out_local - clock_in_local).total_seconds() / 60
        if total_minutes <= 0:
            continue

        total_cost = float(ts.get("total_cost", 0))

        # Walk minute-by-minute in hour buckets
        current = clock_in_local.replace(minute=0, second=0, microsecond=0)
        while current < clock_out_local:
            bucket_end = current + timedelta(hours=1)
            overlap_start = max(current, clock_in_local)
            overlap_end = min(bucket_end, clock_out_local)
            overlap_minutes = (overlap_end - overlap_start).total_seconds() / 60

            if overlap_minutes > 0:
                fraction = overlap_minutes / total_minutes
                rows.append(
                    {
                        "date": current.date(),
                        "hour": current.hour,
                        "labor_cost": total_cost * fraction,
                        "labor_hours": overlap_minutes / 60,
                    }
                )
            current = bucket_end

    if not rows:
        logger.warning("No valid timesheet records — returning empty labor DataFrame.")
        return pd.DataFrame(columns=["date", "hour", "labor_cost", "labor_hours"])

    df = pd.DataFrame(rows)
    logger.info("Parsed timesheets into %d hourly labor buckets.", len(df))
    return df


def merge_labor(sales_hourly: pd.DataFrame, labor_hourly: pd.DataFrame) -> pd.DataFrame:
    """
    Merge per-hour labor averages into the sales hourly DataFrame.

    Adds columns: avg_labor_cost, avg_labor_hours
    Hours with no labor data are filled with 0.
    """
    if labor_hourly.empty:
        sales_hourly = sales_hourly.copy()
        sales_hourly["avg_labor_cost"] = 0.0
        sales_hourly["avg_labor_hours"] = 0.0
        return sales_hourly

    labor_agg = (
        labor_hourly.groupby("hour")
        .agg(avg_labor_cost=("labor_cost", "mean"), avg_labor_hours=("labor_hours", "mean"))
        .reset_index()
    )

    merged = sales_hourly.merge(labor_agg, on="hour", how="left")
    merged["avg_labor_cost"] = merged["avg_labor_cost"].fillna(0.0)
    merged["avg_labor_hours"] = merged["avg_labor_hours"].fillna(0.0)
    return merged


def compute_labor_ratio(df: pd.DataFrame) -> pd.DataFrame:
    """
    Append ``labor_ratio_pct`` = avg_labor_cost / avg_volume * 100.

    Hours with zero sales volume get NaN (avoids divide-by-zero).
    """
    df = df.copy()
    mask = df["avg_volume"] > 0
    df["labor_ratio_pct"] = None
    df.loc[mask, "labor_ratio_pct"] = (
        df.loc[mask, "avg_labor_cost"] / df.loc[mask, "avg_volume"] * 100
    ).round(1)
    return df


def export_csv(hourly: pd.DataFrame, path: str = "sales_trends.csv"):
    """Write the hourly analysis table to *path*."""
    hourly.to_csv(path, index=False)
    logger.info("Exported hourly trends to %s", path)
