"""
homebase_client.py — Homebase Public API client

Real API docs: https://app.joinhomebase.com/api-docs
  Base URL : https://app.joinhomebase.com/api/public   (no /v1)
  Auth     : Authorization: Bearer <api_key>
  Timecards: GET /locations/{location_uuid}/timecards
  Shifts   : GET /locations/{location_uuid}/shifts

Both HomebaseClient and FakeLaborData expose the same two methods:
  .fetch_timesheets(start_dt, end_dt)  -> yields normalized timecard dicts
  .fetch_scheduled_shifts(start_dt, end_dt) -> yields normalized shift dicts

Normalized timecard schema:
  clocked_in_at  : ISO8601 string
  clocked_out_at : ISO8601 string
  regular_hours  : float
  overtime_hours : float
  total_cost     : float  (nominal dollars)
  employee       : {"name": str, "wage": float}

Normalized shift schema:
  start_at       : ISO8601 string
  end_at         : ISO8601 string
  employee       : {"name": str, "hourly_rate": float}
  published      : bool
  published_at   : ISO8601 string or None
  _scheduled_costs : float  (API-computed estimated pay, 0 if unknown)
"""

import logging
import random
from datetime import datetime, timedelta, timezone, date
from typing import Generator, Optional

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Exceptions
# ---------------------------------------------------------------------------

class HomebaseAPIError(Exception):
    def __init__(self, status_code: int, message: str, error_code: str = ""):
        self.status_code = status_code
        self.error_code = error_code
        super().__init__(f"Homebase API {status_code} ({error_code}): {message}")


class HomebaseTierError(HomebaseAPIError):
    """Raised when the location is not on the All-in-one tier."""
    pass


# ---------------------------------------------------------------------------
# Real Homebase client
# ---------------------------------------------------------------------------

class HomebaseClient:
    """
    Client for the Homebase Public API.

    Auth: ``Authorization: Bearer <api_key>``
    Timecards endpoint: ``GET /locations/{location_uuid}/timecards``
    Shifts endpoint:    ``GET /locations/{location_uuid}/shifts``

    Parameters
    ----------
    api_key      : str — Homebase API key
    location_id  : str — location UUID (required for timecards/shifts)
    base_url     : str — API base (default: production)
    per_page     : int — records per page (default: 100)
    timeout      : int — HTTP timeout in seconds
    """

    _BASE_URL = "https://app.joinhomebase.com/api/public"

    def __init__(
        self,
        api_key: str,
        location_id: Optional[str] = None,
        base_url: str = _BASE_URL,
        per_page: int = 100,
        timeout: int = 30,
    ):
        self.api_key = api_key
        self.location_id = location_id
        self.base_url = base_url.rstrip("/")
        self.per_page = per_page
        self.timeout = timeout
        self._session = self._build_session()

    def _build_session(self) -> requests.Session:
        session = requests.Session()
        session.headers.update(
            {
                "Authorization": f"Bearer {self.api_key}",
                "Accept": "application/json",
            }
        )
        retry = Retry(
            total=3,
            backoff_factor=1.0,
            status_forcelist={429, 500, 502, 503, 504},
            allowed_methods={"GET"},
            raise_on_status=False,
        )
        session.mount("https://", HTTPAdapter(max_retries=retry))
        return session

    def _check_response(self, resp: requests.Response, context: str) -> None:
        """Raise appropriate exception for non-2xx responses."""
        if resp.ok:
            return
        try:
            body = resp.json()
            error_code = body.get("error_code", "")
            message = body.get("error", resp.text[:400])
        except Exception:
            error_code = ""
            message = resp.text[:400]

        if error_code == "invalid_tier":
            raise HomebaseTierError(
                resp.status_code, message, error_code
            )
        logger.error("Homebase %s error: status=%s code=%s msg=%s",
                     context, resp.status_code, error_code, message)
        raise HomebaseAPIError(resp.status_code, message, error_code)

    def _paginate(self, url: str, params: dict, context: str) -> Generator[dict, None, None]:
        """Generic paginator for Homebase list endpoints."""
        page = 1
        total_fetched = 0

        while True:
            params["page"] = page
            try:
                resp = self._session.get(url, params=params, timeout=self.timeout)
            except requests.RequestException as exc:
                logger.error("Homebase %s request failed: %s", context, exc)
                return

            self._check_response(resp, context)  # raises on error

            data = resp.json()
            records: list = data if isinstance(data, list) else data.get("timecards",
                             data.get("shifts", data.get("data", [])))

            if not records:
                logger.info("Homebase %s complete: %d fetched.", context, total_fetched)
                return

            yield from records
            total_fetched += len(records)

            # Homebase returns fewer records than per_page on the last page
            if len(records) < self.per_page:
                logger.info("Homebase %s complete: %d fetched.", context, total_fetched)
                return

            page += 1

    # Homebase API rejects date ranges exceeding one calendar month (~31 days).
    # Use 28-day chunks to stay safely within the limit for any month.
    _MAX_WINDOW_DAYS = 28

    def _date_windows(self, start_dt: datetime, end_dt: datetime):
        """Yield (chunk_start, chunk_end) pairs of ≤28 days covering [start_dt, end_dt)."""
        chunk = start_dt
        while chunk < end_dt:
            yield chunk, min(chunk + timedelta(days=self._MAX_WINDOW_DAYS), end_dt)
            chunk += timedelta(days=self._MAX_WINDOW_DAYS)

    def fetch_timesheets(
        self,
        start_dt: datetime,
        end_dt: Optional[datetime] = None,
    ) -> Generator[dict, None, None]:
        """
        Yield normalized timecard records for [start_dt, end_dt).

        Automatically chunks requests into 28-day windows to stay within
        Homebase's one-month-per-query limit.
        """
        if end_dt is None:
            end_dt = datetime.now(timezone.utc)

        if not self.location_id:
            logger.error("Homebase: location_id required for timecards — set HOMEBASE_LOCATION_ID")
            return

        url = f"{self.base_url}/locations/{self.location_id}/timecards"

        for chunk_start, chunk_end in self._date_windows(start_dt, end_dt):
            params = {
                "start_date": chunk_start.strftime("%Y-%m-%d"),
                "end_date": chunk_end.strftime("%Y-%m-%d"),
                "per_page": self.per_page,
                "date_filter": "clock_in",
            }
            logger.info("Fetching Homebase timecards %s → %s (location=%s)",
                        params["start_date"], params["end_date"], self.location_id)

            for tc in self._paginate(url, params, "timecards"):
                clock_out = tc.get("clock_out")
                if not clock_out:
                    logger.debug("Skipping open timecard id=%s", tc.get("id"))
                    continue

                labor = tc.get("labor") or {}
                regular_hrs = float(labor.get("regular_hours") or 0)
                paid_hrs    = float(labor.get("paid_hours") or 0)
                overtime_hrs = max(0.0, paid_hrs - regular_hrs)
                cost = float(labor.get("costs") or 0)
                wage = float(labor.get("wage_rate") or 0)
                name = f"{tc.get('first_name','') or ''} {tc.get('last_name','') or ''}".strip()

                yield {
                    "id": tc.get("id"),
                    "clocked_in_at":  tc.get("clock_in"),
                    "clocked_out_at": clock_out,
                    "regular_hours":  regular_hrs,
                    "overtime_hours": overtime_hrs,
                    "total_cost":     cost,
                    "employee": {"name": name, "wage": wage},
                }

    def fetch_scheduled_shifts(
        self,
        start_dt: datetime,
        end_dt: Optional[datetime] = None,
    ) -> Generator[dict, None, None]:
        """
        Yield normalized scheduled shift records for [start_dt, end_dt).

        Automatically chunks requests into 28-day windows to stay within
        Homebase's one-month-per-query limit.
        """
        if end_dt is None:
            end_dt = datetime.now(timezone.utc) + timedelta(days=14)

        if not self.location_id:
            logger.error("Homebase: location_id required for shifts — set HOMEBASE_LOCATION_ID")
            return

        url = f"{self.base_url}/locations/{self.location_id}/shifts"

        for chunk_start, chunk_end in self._date_windows(start_dt, end_dt):
            params = {
                "start_date": chunk_start.strftime("%Y-%m-%d"),
                "end_date": chunk_end.strftime("%Y-%m-%d"),
                "per_page": self.per_page,
                "date_filter": "start_at",
            }
            logger.info("Fetching Homebase shifts %s → %s (location=%s)",
                        params["start_date"], params["end_date"], self.location_id)

            for sh in self._paginate(url, params, "shifts"):
                if not sh.get("end_at"):
                    continue

                labor = sh.get("labor") or {}
                is_published = bool(sh.get("published"))
                hourly_rate = float(sh.get("wage_rate") or 0)
                name = f"{sh.get('first_name','') or ''} {sh.get('last_name','') or ''}".strip()

                yield {
                    "id": sh.get("id"),
                    "start_at":  sh.get("start_at"),
                    "end_at":    sh.get("end_at"),
                    "employee":  {"name": name, "hourly_rate": hourly_rate},
                    "published": is_published,
                    "published_at": sh.get("start_at") if is_published else None,
                    "_scheduled_costs": float(labor.get("scheduled_costs") or 0),
                    "_scheduled_hours": float(labor.get("scheduled_hours") or 0),
                }


# ---------------------------------------------------------------------------
# Synthetic / fake labor data (used when API key is absent or tier is wrong)
# ---------------------------------------------------------------------------

class FakeLaborData:
    """
    Generates realistic synthetic timesheet + shift records mirroring a small
    Adirondack retail store schedule.  Used when Homebase API is unavailable.

    Staffing model
    --------------
    Weekday : opener 08-10 (1 staff), peak 10-15 (2), afternoon 15-18 (2), closer 18-21 (1)
    Weekend : same + 1 extra 10-17
    """

    _WEEKDAY_SHIFTS = [(8, 10, 1), (10, 15, 2), (15, 18, 2), (18, 21, 1)]
    _WEEKEND_EXTRA  = (10, 17, 1)

    def __init__(self, avg_wage: float = 17.00, seed: int = 42):
        self.avg_wage = avg_wage
        self._rng = random.Random(seed)

    def _make_timecard(self, shift_date: date, clock_in_h: int, clock_out_h: int, idx: int) -> dict:
        duration = clock_out_h - clock_in_h
        jitter = self._rng.uniform(0.85, 1.15)
        wage = round(self.avg_wage * jitter, 2)
        cost = round(wage * duration, 2)
        ci = datetime(shift_date.year, shift_date.month, shift_date.day,
                      clock_in_h,  0, 0, tzinfo=timezone.utc)
        co = datetime(shift_date.year, shift_date.month, shift_date.day,
                      clock_out_h, 0, 0, tzinfo=timezone.utc)
        return {
            "id": f"fake-{shift_date}-{clock_in_h}-{idx}",
            "employee": {"name": f"Staff-{idx+1}", "wage": wage},
            "clocked_in_at":  ci.isoformat(),
            "clocked_out_at": co.isoformat(),
            "regular_hours":  float(duration),
            "overtime_hours": 0.0,
            "total_cost":     cost,
        }

    def _make_shift(self, shift_date: date, clock_in_h: int, clock_out_h: int, idx: int) -> dict:
        jitter = self._rng.uniform(0.85, 1.15)
        hourly_rate = round(self.avg_wage * jitter, 2)
        duration = clock_out_h - clock_in_h
        start = datetime(shift_date.year, shift_date.month, shift_date.day,
                         clock_in_h,  0, 0, tzinfo=timezone.utc)
        end   = datetime(shift_date.year, shift_date.month, shift_date.day,
                         clock_out_h, 0, 0, tzinfo=timezone.utc)
        return {
            "id": f"fake-sched-{shift_date}-{clock_in_h}-{idx}",
            "employee": {"name": f"Staff-{idx+1}", "hourly_rate": hourly_rate},
            "start_at":  start.isoformat(),
            "end_at":    end.isoformat(),
            "published": True,
            "published_at": start.isoformat(),
            "_scheduled_costs": round(hourly_rate * duration, 2),
            "_scheduled_hours": float(duration),
        }

    def fetch_timesheets(
        self,
        start_dt: datetime,
        end_dt: Optional[datetime] = None,
    ) -> Generator[dict, None, None]:
        """Yield synthetic timecard records for each day in [start_dt, end_dt)."""
        if end_dt is None:
            end_dt = datetime.now(timezone.utc)

        logger.warning(
            "Using SYNTHETIC labor data (avg wage $%.2f/hr) — numbers are illustrative only.",
            self.avg_wage,
        )

        current = start_dt.date()
        end_date = end_dt.date()
        total = 0

        while current < end_date:
            shifts = list(self._WEEKDAY_SHIFTS)
            if current.weekday() >= 5:
                shifts.append(self._WEEKEND_EXTRA)
            for ci, co, staff in shifts:
                for i in range(staff):
                    yield self._make_timecard(current, ci, co, i)
                    total += 1
            current += timedelta(days=1)

        logger.info("FakeLaborData: generated %d synthetic timecards.", total)

    def fetch_scheduled_shifts(
        self,
        start_dt: datetime,
        end_dt: Optional[datetime] = None,
    ) -> Generator[dict, None, None]:
        """Yield synthetic scheduled shift records for each day in [start_dt, end_dt)."""
        if end_dt is None:
            end_dt = datetime.now(timezone.utc) + timedelta(days=14)

        current = start_dt.date()
        end_date = end_dt.date()
        total = 0

        while current < end_date:
            shifts = list(self._WEEKDAY_SHIFTS)
            if current.weekday() >= 5:
                shifts.append(self._WEEKEND_EXTRA)
            for ci, co, staff in shifts:
                for i in range(staff):
                    yield self._make_shift(current, ci, co, i)
                    total += 1
            current += timedelta(days=1)

        logger.info("FakeLaborData: generated %d synthetic scheduled shifts.", total)


# ---------------------------------------------------------------------------
# Factory
# ---------------------------------------------------------------------------

def build_labor_source(config: dict, env: dict):
    """
    Return a HomebaseClient if HOMEBASE_API_KEY is set, else FakeLaborData.

    Both share the same .fetch_timesheets() / .fetch_scheduled_shifts() interface.
    """
    import re

    def _resolve(value: str) -> str:
        return re.sub(r"\$\{([^}]+)\}", lambda m: env.get(m.group(1), ""), value)

    api_key = env.get("HOMEBASE_API_KEY", "").strip()
    hb_cfg  = config.get("homebase", {})
    labor_cfg = config.get("labor", {})

    if api_key:
        location_id_raw = hb_cfg.get("location_id", "")
        location_id = _resolve(location_id_raw) if location_id_raw else None
        logger.info("Homebase: using real API client (location_id=%s)", location_id)
        return HomebaseClient(
            api_key=api_key,
            location_id=location_id or None,
            base_url=hb_cfg.get("base_url", HomebaseClient._BASE_URL),
            per_page=hb_cfg.get("per_page", 100),
        )

    avg_wage = labor_cfg.get("fake_avg_wage", 17.00)
    logger.warning("HOMEBASE_API_KEY not set — using FakeLaborData.")
    return FakeLaborData(avg_wage=avg_wage)
