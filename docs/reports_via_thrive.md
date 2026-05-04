# Category + Item reports — now via Thrive warehouse

`/reports/categories` and `/reports/items` previously read from
`sales_line_items` joined to `sales_categories` — a Clover-fed table
set defined in `supabase/migrations/001_sales_tables.sql`.

That migration was never applied to the production Supabase project
(`yvbsibrikylbqupignij`), so the report pages always returned []
silently. The remaining pieces — `app/api/sync/{categories,items,sales}`
endpoints and `lib/clover.ts:fetchCategories/fetchItems/fetchPayments` —
attempted to populate tables that didn't exist; the sync button was
effectively a no-op for users.

This refactor swaps both reports to read from the Thrive warehouse
that's actively populated by the `thrive-pipeline` Vercel project.

## What changed

`app/reports/categories/page.tsx` and `app/reports/items/page.tsx`
both now query `run_report_query` with SQL that:

1. Selects from `thrive_sales_history` (162k+ rows, daily-grain).
2. Joins `thrive_product_catalog` on `thrive_variant_id = variant_id`
   for the `department` label (used as the category name).
3. Sums `revenue_cents` and `units` per the same period the page
   already exposed via the `?days=` query param.

Unchanged:
- The page UI (chart, table, sort links, lookback filter).
- The `CategoryRow` / `ItemRow` shape.
- The `run_report_query` RPC — already exists, no migration needed.

## Coverage

| Dimension | Before (`sales_line_items`) | After (`thrive_*`) |
|---|---|---|
| Row count | 0 (table missing) | 162,322 |
| Latest sale | n/a | 2026-05-03 (yesterday; daily cron at 05:00 UTC) |
| Category labels | Clover category map | `thrive_product_catalog.department` (`Grocery`, `Produce`, `Supplements`, `Body Care`, `Local`, `Bulk`, `Cafe`, etc.) |
| Item names | Clover line-item display | `thrive_sales_history.item_name` |
| Cost / margin | Not captured | Available via `thrive_product_catalog.default_cost_cents` (future opt-in) |

## Limitations / not in this PR

- `/shifts` page DOW breakdown still falls back to live Clover when
  `sales_line_items` doesn't exist (existing graceful path; works fine,
  just slow). Thrive's hourly granularity is missing, so per-hour-of-day
  DOW analysis can't move yet — would need a Clover-line-item ingest
  cron (separate pipeline scope).
- Today's-sales KPI on the dashboard still uses live Clover (real-time
  hourly numbers; Thrive sync runs once daily).
- The `Sync` button on these pages still calls `/api/sync/categories`
  which writes to non-existent tables. Consider hiding or repointing in
  a follow-up; left in place to avoid scope creep.

## Pipelines this depends on (read-only)

The `thrive-pipeline` project owns writes:
- `thrive_sales` cron — daily 05:00 UTC, fetches yesterday's sales.
- `thrive_catalog` cron — daily 09:00 UTC, refreshes product catalog.

Verify health with `select sync_type, count(*) ok, max(started_at)
from sync_log where started_at > now() - interval '7 days'
and error is null group by 1` — both should show daily activity.
