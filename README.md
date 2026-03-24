# Nature's Storehouse — Operations Dashboard

A Flask web dashboard for small retail operations that combines **Clover POS sales data** with **Homebase labor scheduling** to answer two practical questions:

1. **When is it quiet enough to schedule chores?** (Shift Analysis tab)
2. **How is our labor cost tracking against sales?** (Labor Ratio tab)

Demo mode requires no credentials and runs entirely on synthetic data.

---

## Screenshots / Features

### Shift Analysis
- Hourly "Quiet Score" (0–10) across a configurable look-back window
- Day-of-week breakdown to compare e.g. Tuesday patterns vs. Saturday patterns
- Color-coded recommendations: green = schedule chores, yellow = light activity, red = peak

### Labor Ratio
- **Actuals table** — historical days with real timesheet hours, nominal wages, fully-loaded cost, and net sales
- **Upcoming Schedule table** — future days from the published Homebase schedule with projected sales (90-day DOW average)
- KPI cards for actual labor ratio %, projected ratio %, and loaded cost factor
- Line chart: actual vs. projected labor ratio % over the selected period

---

## Requirements

- Python 3.10+ **or** Docker (recommended for deployment)
- Clover merchant account with a Merchant-Generated Token
- Homebase account (optional — synthetic labor data is used if no API key is set)

---

## Quick Start — Demo Mode (no credentials)

```bash
pip install -r requirements.txt
python main.py --serve --demo
```

Open http://localhost:8765. All data is synthetic and illustrative.

---

## Local Setup (real data)

### 1. Clone and install

```bash
git clone https://github.com/DataHippo93/natures-storehouse-operations-dashboard.git
cd natures-storehouse-operations-dashboard
pip install -r requirements.txt
```

### 2. Configure credentials

```bash
cp .env.example .env
```

Edit `.env` and fill in your values:

| Variable | Where to find it |
|----------|-----------------|
| `NATURES_STOREHOUSE_MID` | Clover Dashboard → Account & Setup → Merchant Info |
| `NATURES_STOREHOUSE_TOKEN` | Clover Dashboard → Account & Setup → API Tokens |
| `HOMEBASE_API_KEY` | Homebase → Settings → Integrations → API (requires All-in-one plan) |
| `HOMEBASE_LOCATION_ID` | Homebase API or leave blank to use all locations |

> Homebase integration is optional. If `HOMEBASE_API_KEY` is not set, the app falls back to synthetic labor data modeled on a typical small retail store.

### 3. Edit `config.yaml` (optional)

`config.yaml` controls merchant IDs, Clover API settings, the loaded cost multiplier, and labor efficiency thresholds. The defaults work for a single-location setup; add merchants to the `merchants:` list for multi-location.

### 4. Run

```bash
python main.py --serve
```

The server fetches the last 90 days of Clover data on startup (~10 seconds), then opens at http://localhost:8765.

---

## Deployment — Docker (recommended)

### 1. Build and start

```bash
cp .env.example .env   # fill in credentials
docker compose up -d
```

The container will:
1. Pre-warm the data cache on first start (fetches ~90 days from Clover + Homebase)
2. Serve the dashboard on port **8765**
3. Refresh data automatically at **2 AM Eastern** every day via cron

### 2. Check status

```bash
docker compose logs -f
```

### 3. Stop

```bash
docker compose down
```

The cached data is stored in a Docker volume (`storehouse_cache`) and survives container restarts and image rebuilds.

### Refresh button

The dashboard header has a **↻ Refresh** button. Clicking it triggers an immediate background refresh of both Clover sales and Homebase labor data. It is rate-limited to once every 5 minutes to avoid over-taxing the APIs.

---

## Data Refresh Strategy

The app is designed to be **API-friendly** — it does not hit Clover or Homebase on every page load.

| Trigger | Behavior |
|---------|----------|
| Container start | Full refresh, results cached to `cache/` |
| 2 AM cron (daily) | Full refresh, updates cache files |
| ↻ Refresh button | On-demand refresh (max once per 5 min) |
| `/labor_data?days=60` | Custom date range — always fetches live |
| `/store_status?days=30` | Custom date range — always fetches live |

---

## CLI Usage

```bash
# Demo (no credentials)
python main.py --demo

# Print forecast + labor report for last 60 days
python main.py --days 60

# Labor ratio report only
python main.py --report labor

# Export sales_trends.csv and exit
python main.py --export

# Refresh cache files and exit (used by the cron job)
python main.py --refresh-cache

# Start server from cache (Docker mode — no initial fetch delay)
python main.py --serve --cached
```

---

## Project Structure

```
.
├── main.py              # CLI entry point, Flask server, cache logic
├── analyzer.py          # Sales data processing, Quiet Score calculation
├── clover_client.py     # Clover V3 API client (rate limiting, pagination, retry)
├── homebase_client.py   # Homebase API client + synthetic labor data fallback
├── config.yaml          # Merchant config, API settings, labor thresholds
├── templates/
│   └── dashboard.html   # Single-page dashboard (vanilla JS + Chart.js)
├── Dockerfile
├── docker-compose.yml
├── entrypoint.sh        # Docker: start cron → pre-warm cache → start server
├── requirements.txt
└── .env.example         # Credential template (never commit .env)
```

---

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /` | Dashboard UI |
| `GET /store_status` | Shift analysis JSON (served from cache or fetched live with `?days=N`) |
| `GET /labor_data` | Labor ratio JSON (served from cache or fetched live with `?start=&end=`) |
| `GET /api/cache_status` | Cache freshness: `{"updated_at": "...", "refreshing": bool}` |
| `POST /api/refresh` | Trigger background cache rebuild |
| `GET /health` | `{"status": "ok"}` — used by Docker health check |

---

## License

MIT
