"""
clover_client.py — Clover V3 API client

Handles authentication, pagination, and rate-limiting for the
GET /v3/merchants/{mId}/payments endpoint.
"""

import logging
import time
from datetime import datetime, timedelta, timezone
from typing import Generator, Optional

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

logger = logging.getLogger(__name__)


class CloverRateLimiter:
    """Token-bucket rate limiter capped at Clover's 16 req/sec limit."""

    def __init__(self, rps: int = 16):
        self.rps = rps
        self._min_interval = 1.0 / rps
        self._last_call: float = 0.0

    def wait(self):
        now = time.monotonic()
        elapsed = now - self._last_call
        sleep_for = self._min_interval - elapsed
        if sleep_for > 0:
            time.sleep(sleep_for)
        self._last_call = time.monotonic()


class CloverAPIError(Exception):
    """Raised when the Clover API returns a non-2xx response."""

    def __init__(self, status_code: int, message: str):
        self.status_code = status_code
        super().__init__(f"Clover API error {status_code}: {message}")


class CloverClient:
    """
    Lightweight client for the Clover V3 Payments API.

    Parameters
    ----------
    merchant_id : str
        Clover merchant ID (mId).
    token : str
        Merchant-generated API token.
    base_url : str
        Clover API base URL (default: production).
    rate_limit_rps : int
        Maximum requests per second (default: 16).
    page_size : int
        Records per paginated request (default: 1000).
    timeout : int
        HTTP request timeout in seconds (default: 30).
    """

    _BASE_URL = "https://api.clover.com"

    def __init__(
        self,
        merchant_id: str,
        token: str,
        base_url: str = _BASE_URL,
        rate_limit_rps: int = 16,
        page_size: int = 1000,
        timeout: int = 30,
    ):
        self.merchant_id = merchant_id
        self.token = token
        self.base_url = base_url.rstrip("/")
        self.page_size = page_size
        self.timeout = timeout

        self._rate_limiter = CloverRateLimiter(rps=rate_limit_rps)
        self._session = self._build_session()

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _build_session(self) -> requests.Session:
        session = requests.Session()
        session.headers.update(
            {
                "Authorization": f"Bearer {self.token}",
                "Accept": "application/json",
            }
        )
        # Retry on transient server errors (5xx) and connection issues.
        retry = Retry(
            total=4,
            backoff_factor=1.5,          # 0s, 1.5s, 3s, 6s
            status_forcelist={429, 500, 502, 503, 504},
            allowed_methods={"GET"},
            raise_on_status=False,
        )
        adapter = HTTPAdapter(max_retries=retry)
        session.mount("https://", adapter)
        session.mount("http://", adapter)
        return session

    def _get(self, endpoint: str, params: Optional[dict] = None) -> dict:
        """Single authenticated GET with rate limiting."""
        url = f"{self.base_url}/v3/merchants/{self.merchant_id}/{endpoint}"
        params = params or {}

        self._rate_limiter.wait()
        logger.debug("GET %s  params=%s", url, params)

        resp = self._session.get(url, params=params, timeout=self.timeout)

        if not resp.ok:
            body = resp.text[:500]  # avoid logging huge HTML error pages
            logger.error(
                "Clover API error: status=%s merchant=%s endpoint=%s body=%s",
                resp.status_code,
                self.merchant_id,
                endpoint,
                body,
            )
            raise CloverAPIError(resp.status_code, body)

        return resp.json()

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    # Clover restricts per-query time range to ~90 days for the payments endpoint.
    # Queries longer than this are automatically split into 30-day windows.
    _MAX_QUERY_DAYS = 30

    def fetch_payments(
        self,
        start_dt: datetime,
        end_dt: Optional[datetime] = None,
        expand: str = "tender,refunds",
    ) -> Generator[dict, None, None]:
        """
        Yield every payment in [start_dt, end_dt) using cursor pagination.

        Clover's payments endpoint is restricted to ~90 days per query; longer
        ranges are automatically split into 30-day windows to stay within limits.

        Parameters
        ----------
        start_dt : datetime
            Inclusive start (timezone-aware recommended; naive = UTC assumed).
        end_dt : datetime, optional
            Exclusive end.  Defaults to *now* in UTC.
        expand : str
            Comma-separated Clover expand fields appended to each request.

        Yields
        ------
        dict
            Raw payment objects as returned by the Clover API.
        """
        if end_dt is None:
            end_dt = datetime.now(timezone.utc)

        if start_dt.tzinfo is None:
            start_dt = start_dt.replace(tzinfo=timezone.utc)
        if end_dt.tzinfo is None:
            end_dt = end_dt.replace(tzinfo=timezone.utc)

        total_days = (end_dt - start_dt).days
        if total_days > self._MAX_QUERY_DAYS:
            # Split into 30-day windows and yield from each
            chunk_start = start_dt
            while chunk_start < end_dt:
                chunk_end = min(chunk_start + timedelta(days=self._MAX_QUERY_DAYS), end_dt)
                yield from self._fetch_payments_window(chunk_start, chunk_end, expand)
                chunk_start = chunk_end
            return

        yield from self._fetch_payments_window(start_dt, end_dt, expand)

    def _fetch_payments_window(
        self,
        start_dt: datetime,
        end_dt: datetime,
        expand: str,
    ) -> Generator[dict, None, None]:
        """Fetch a single ≤30-day window of payments with offset pagination."""
        start_ms = int(start_dt.timestamp() * 1000)
        end_ms = int(end_dt.timestamp() * 1000)

        logger.info(
            "Fetching payments: merchant=%s  %s to %s",
            self.merchant_id,
            start_dt.date().isoformat(),
            end_dt.date().isoformat(),
        )

        offset = 0
        total_fetched = 0

        while True:
            params = [
                ("filter", f"createdTime>={start_ms}"),
                ("filter", f"createdTime<{end_ms}"),
                ("limit", self.page_size),
                ("offset", offset),
                ("orderBy", "createdTime ASC"),
                ("expand", expand),
            ]

            try:
                data = self._get("payments", params=params)
            except CloverAPIError as exc:
                logger.error(
                    "Aborting pagination for merchant=%s at offset=%d: %s",
                    self.merchant_id,
                    offset,
                    exc,
                )
                return

            elements: list = data.get("elements", [])

            if not elements:
                logger.info(
                    "Pagination complete: merchant=%s  total=%d payments",
                    self.merchant_id,
                    total_fetched,
                )
                return

            for payment in elements:
                yield payment

            total_fetched += len(elements)
            logger.debug(
                "Page fetched: merchant=%s offset=%d count=%d cumulative=%d",
                self.merchant_id,
                offset,
                len(elements),
                total_fetched,
            )

            if len(elements) < self.page_size:
                logger.info(
                    "Pagination complete (short page): merchant=%s  total=%d payments",
                    self.merchant_id,
                    total_fetched,
                )
                return

            offset += self.page_size

    def fetch_payments_last_n_days(
        self, days: int = 30, **kwargs
    ) -> Generator[dict, None, None]:
        """
        Convenience wrapper: yield payments from the last *days* calendar days.

        Parameters
        ----------
        days : int
            Look-back window.  Defaults to 30.
        **kwargs
            Forwarded to :meth:`fetch_payments`.
        """
        end_dt = datetime.now(timezone.utc)
        start_dt = end_dt - timedelta(days=days)
        return self.fetch_payments(start_dt=start_dt, end_dt=end_dt, **kwargs)

    def ping(self) -> bool:
        """
        Return True if the merchant credentials are valid.

        Uses the lightweight GET /merchants/{mId} endpoint to verify auth.
        """
        try:
            self._get("")  # endpoint resolves to /v3/merchants/{mId}
            return True
        except CloverAPIError as exc:
            logger.warning("Ping failed for merchant=%s: %s", self.merchant_id, exc)
            return False


# ------------------------------------------------------------------
# Factory — build clients from config + environment
# ------------------------------------------------------------------

def build_clients_from_config(config: dict, env: dict) -> dict[str, "CloverClient"]:
    """
    Instantiate a :class:`CloverClient` for each merchant in *config*.

    Parameters
    ----------
    config : dict
        Parsed contents of ``config.yaml``.
    env : dict
        Mapping of environment variables (e.g. ``os.environ``).

    Returns
    -------
    dict[str, CloverClient]
        Keyed by merchant ``id`` string (e.g. ``"NATURES_STOREHOUSE"``).
    """
    import os
    import re

    def _resolve(value: str) -> str:
        """Expand ${VAR} placeholders from env."""
        return re.sub(
            r"\$\{([^}]+)\}",
            lambda m: env.get(m.group(1), ""),
            value,
        )

    clover_cfg = config.get("clover", {})
    clients: dict[str, CloverClient] = {}

    for merchant in config.get("merchants", []):
        mid = _resolve(merchant["mid"])
        token = _resolve(merchant["token"])
        name = merchant.get("name", merchant["id"])

        if not mid or not token:
            logger.warning(
                "Skipping merchant '%s' — MID or token not set in environment.",
                name,
            )
            continue

        clients[merchant["id"]] = CloverClient(
            merchant_id=mid,
            token=token,
            base_url=clover_cfg.get("base_url", CloverClient._BASE_URL),
            rate_limit_rps=clover_cfg.get("rate_limit_rps", 16),
            page_size=clover_cfg.get("page_size", 1000),
            timeout=clover_cfg.get("timeout_seconds", 30),
        )
        logger.info("Registered merchant: %s (mId=%s)", name, mid)

    return clients
