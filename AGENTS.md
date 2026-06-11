<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Nature's Understory — Data Source Map (updated 2026-06-11)

This is the canonical record of where data comes from. **Read this before
touching any sync or data-layer code.** Past bugs came from agents not
knowing this map (duplicate pipelines, queries against dropped tables).

## Supabase

One project: `natures-understory` (`yvbsibrikylbqupignij`). All app reads
and warehouse writes go here. Auth is Supabase Auth (email+password, roles
in metadata). RLS default-deny; service-role key used server-side only.

## Sales (source of truth: Thrive warehouse)

- `thrive_sales_history` — daily per-variant sales (units, revenue_cents,
  cost_cents, profit_cents, margin_pct). Synced nightly ~5am UTC by the
  **thrive-pipeline repo** (separate Vercel project, Python). NOT this repo.
- `thrive_product_catalog` — variants with department, brand, vendor.
- The old Clover warehouse tables (`sales_line_items`, `sales_categories`,
  `sales_items`) were **dropped 2026-05-01** (migration `drop_clover_tables`).
  Never re-add them. The Clover sales sync routes were removed from this
  repo 2026-06-11.
- Clover's live Payments API (lib/clover.ts) is still used ONLY for
  today's intraday numbers and hour-of-day analysis (Thrive has no hourly
  grain). Creds: `NATURES_STOREHOUSE_MID` / `NATURES_STOREHOUSE_TOKEN`.

## Labor (source of truth: Homebase live API)

- `lib/homebase.ts` calls the Homebase API live with `HOMEBASE_API_KEY` +
  `HOMEBASE_LOCATION_ID` (canonical values in BWS, project `master`).
- A separate **homebase-pipeline** (also not this repo) mirrors shifts and
  labor into `homebase_*` tables every 6h for historical analysis.

## Coolers (source of truth: Home Assistant)

- `/api/cron/pull-coolers` (this repo, every 5 min) reads HA `/api/states`
  using `HA_URL` + `HOME_ASSISTANT_TOKEN` (in BWS, project `master`) and
  writes `cooler_readings`; ranges and display names live in `cooler_config`.
- Dashboard: `/coolers`. Alert = continuously out of range ≥30 min.
- Status logic is a pure function in `lib/coolers.ts` with tests in
  `__tests__/coolers.test.ts`.

## Secrets

- All canonical secrets live in **Bitwarden Secrets Manager (BWS)**.
- NEVER hardcode credentials in source, tests, or docs — not even as
  "fallback defaults". E2E creds come from env (`TEST_EMAIL`/`TEST_PASSWORD`).

## Demo mode

`DEMO_MODE=true` is the ONLY path to synthetic data. Data-layer errors must
propagate to the error boundary (`app/error.tsx`). Never silently fall back
to demo/fake numbers — that failure mode burned us once already.
