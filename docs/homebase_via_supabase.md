# Homebase data — now via Supabase

As of the `feat/hb-supabase` branch, `natures-understory` reads
Homebase labor data from the Supabase warehouse populated by the
[`homebase-pipeline`](https://homebase-pipeline.vercel.app/) Vercel
project. The app no longer hits `app.joinhomebase.com` on every page
load.

## What changed

`lib/homebase.ts` was rewritten in place. Same exported types
(`Timecard`, `ScheduledShift`) and same function signatures
(`fetchTimecards(startDate, endDate)`, `fetchShifts(startDate, endDate)`)
so call sites in `lib/data.ts` did not need to change.

Internally the module now:

1. Reads from `public.homebase_shifts_worked` for timecards.
2. Reads from `public.homebase_shifts_scheduled` for shifts.
3. Joins `public.homebase_employees` for the operator-facing display name.
4. Filters by `(timestamp AT TIME ZONE 'America/New_York')::date` to
   match the original Homebase API behavior (which always filtered by
   the store's local date).
5. Converts cents -> dollars at the boundary (the warehouse stores
   `_cents`; the UI expects dollars).

## Tables this depends on

| Table | Owner | Refresh |
|---|---|---|
| `homebase_shifts_worked` | `homebase-pipeline` cron `homebase_timesheets` | every 6 h, trailing 30 days |
| `homebase_shifts_scheduled` | `homebase-pipeline` cron `homebase_shifts` | every 6 h, +/- 14 days |
| `homebase_employees` | `homebase-pipeline` cron `homebase_employees` | daily 08:00 UTC |
| `homebase_labor_daily` | `homebase-pipeline` cron `homebase_labor_daily` | daily 07:15 UTC |

`homebase_labor_daily` isn't read yet -- it's a pre-aggregated
business-date roll-up that's strictly cheaper than re-aggregating
timecards in JS. Future PR could swap the per-day JS reduce in
`lib/data.ts -> getLaborRatioData` for a single
`select * from homebase_labor_daily where business_date between ...`.

## What is intentionally absent

**Open clock-ins** (`clock_in IS NOT NULL AND clock_out IS NULL`).
The pipeline cron skips them; they appear once the shift closes. If
the UI ever needs "who's clocked in right now", that's a separate
live-API route -- keep `app/api/debug/homebase/route.ts` for that
for now.

## What was kept (and why)

- **`app/api/debug/homebase/route.ts`** still hits Homebase live so
  the pipeline can be sanity-checked end-to-end. It's the only
  remaining caller of `HOMEBASE_API_KEY`/`HOMEBASE_LOCATION_ID` env
  vars in this app.
- **`homebase_client.py`** (the legacy Flask dashboard's
  `HomebaseClient` + `FakeLaborData`) is untouched; the Next.js app
  doesn't call it. If/when the Flask layer retires, the synthetic
  `FakeLaborData` generator should be promoted to
  `tests/fixtures/labor.ts` for unit tests.

## Env vars Vercel still wants

`HOMEBASE_API_KEY` and `HOMEBASE_LOCATION_ID` remain set on the
`natures-understory` Vercel project **only** because of the debug
route. They can be removed entirely once that route is gone (or
swapped to a Supabase-fed shim).

The pipeline project (`homebase-pipeline`) is the canonical owner of
the live Homebase credentials going forward.

## Smoke test

After deploy:
1. Open `/labor` and confirm the actuals + projections numbers match
   what `/labor` rendered on `main`.
2. In DevTools Network tab, confirm zero requests to
   `app.joinhomebase.com` from the page load.
3. Run `select count(*) from homebase_shifts_worked where clock_in
   >= now() - interval '14 days';` -- should be > 0 if the cron is
   healthy.

## Rollback

If the warehouse goes stale, two clean rollback paths:

- Hot fix: `git revert <merge-commit>` -- restores the live-API
  fetcher.
- Soft fall-through: the existing `try/catch` in `lib/data.ts ->
  getLaborRatioData` already falls back to `getDemoLaborRatioData()`
  on any error, so a failed Supabase read shows demo data rather
  than blanks. Set `DEMO_MODE=true` to force this site-wide.
