# Produce-buying pipeline — deployment runbook

The `natures-produce-buying` Python pipeline is being ported to this
Next.js app. Phases 1, 2, 4 are code-complete. Phase 3 is gated on
upstream Thrive endpoint discovery (Tasks #5, #2 in the Cowork
TaskList). This runbook is for the operator wiring it into Vercel
the first time.

## What's new in this repo

```
supabase/migrations/
  003_alberts_tables.sql        ← Albert's price entries / history / orders / lines / invoices
  004_decision_log.sql            ← First-class decision_log table
  005_thrive_inventory.sql        ← Append-only inventory snapshots + thrive_inventory_latest view

lib/
  gmail.ts                         ← Gmail OAuth + CSV-attachment fetcher
  alberts.ts                       ← Pricelist + invoice CSV parsers
  audience.ts                      ← Audience-tagged Decision shape (TS twin of pipeline/decide.py)
  decide.ts                        ← Pure deterministic match + score logic

app/api/cron/
  pull-pricelists/route.ts         ← Mon/Thu 6:50 AM ET — Jasmia's emails → DB
  pull-invoice/route.ts            ← Mon/Thu evening sweep — invoice → DB
  compute-features/route.ts        ← Nightly 3 AM ET — seasonal_index + elasticity_hint
  pull-inventory/route.ts          ← Mon/Thu 6:55 AM ET — Thrive snapshot (GATED)

app/api/orders/
  build/route.ts                   ← POST → run match + decide + persist
  [date]/email/route.ts            ← GET .eml file
  [date]/po/route.ts               ← POST → Thrive PO (GATED)

app/orders/
  page.tsx                         ← Order history list
  [date]/page.tsx                  ← Order detail with audience-tagged notes

docs/
  api_contract.md                  ← Cowork agent ↔ Vercel API boundary
  produce_pipeline_deploy.md       ← This file
```

## Step 1 — Apply migrations

In the Supabase SQL Editor (project `yvbsibrikylbqupignij`), run in
order:

1. `supabase/migrations/003_alberts_tables.sql`
2. `supabase/migrations/004_decision_log.sql`
3. `supabase/migrations/005_thrive_inventory.sql`

Each is idempotent (uses `if not exists`) so re-running is safe.

## Step 2 — Vercel env vars

Add these to **Project Settings → Environment Variables** (apply to
Production + Preview):

| Var | Source | Used by |
|---|---|---|
| `CRON_SECRET` | generate a random 32-byte hex string | All `/api/cron/*` routes |
| `AGENT_SECRET` | generate a different random string | `/api/orders/build` (Cowork agent calls) |
| `GMAIL_OAUTH_CREDENTIALS` | BWS `NATURES_GMAIL_OAUTH_CREDENTIALS` (full JSON, single-line) | `/api/cron/pull-pricelists`, `/api/cron/pull-invoice` |
| `GMAIL_TOKEN_JSON` | BWS `NATURES_GMAIL_TOKEN_JSON` (full JSON, single-line) | same |
| `THRIVE_EMAIL` | Clark's Thrive login email | `/api/cron/pull-inventory`, `/api/orders/[date]/po` |
| `THRIVE_PASSWORD` | Clark's Thrive login password | same |

Already present (don't touch): `NEXT_PUBLIC_SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`, `NATURES_STOREHOUSE_*`.

**Two intentionally NOT set (gates):**

| Var | Set when |
|---|---|
| `THRIVE_INVENTORY_PATH_VERIFIED` | After Task #5 (endpoint discovery in `natures-produce-buying/docs/specs/thrive_inventory_endpoint.md`) is complete AND `app/api/cron/pull-inventory/route.ts`'s `INVENTORY_LIST_PATH` is updated |
| `THRIVE_PO_PATH_VERIFIED` | After Task #2 captures the working PO POST body AND `app/api/orders/[date]/po/route.ts`'s `createPo()` is updated |

Until these are set, the routes return 503 with the spec link. That's
intentional — better than fabricating a request shape and corrupting
prod data.

## Step 3 — Deploy

Standard Vercel flow:

```bash
git add app supabase lib docs vercel.json
git commit -m "feat(produce): port pricelist/invoice ingest + order build API to Vercel"
git push origin main
```

Vercel auto-deploys. The new crons appear in
**Project → Deployments → Cron Jobs** within ~1 minute.

## Step 4 — Smoke test (in this order)

Use a Bearer token equal to your `CRON_SECRET`:

```bash
SECRET="$CRON_SECRET"
BASE="https://<your-vercel-url>"

# 1. Pricelist pull, dry run
curl -H "Authorization: Bearer $SECRET" "$BASE/api/cron/pull-pricelists?date=2026-04-27&dry=1"

# 2. Pricelist pull, real
curl -H "Authorization: Bearer $SECRET" "$BASE/api/cron/pull-pricelists?date=2026-04-27"

# 3. Compute features (after the pricelist run lands rows)
curl -H "Authorization: Bearer $SECRET" "$BASE/api/cron/compute-features"

# 4. Inventory — should return 503 'gated' until THRIVE_INVENTORY_PATH_VERIFIED is set
curl -H "Authorization: Bearer $SECRET" "$BASE/api/cron/pull-inventory"
```

Expect:
- (1) returns `dry_run: true` and the parsed row counts
- (2) writes ~660 fresh + ~1100 produce rows to `alberts_price_entries`
  and `alberts_price_history`
- (3) writes ~1000 rows into `seasonal_index` (all `insufficient_data:
  true` for now) and ~25 rows into `elasticity_hint` (also all
  insufficient until #8 backfill lands)
- (4) returns `503 {ok: false, gated: true, reason: ...}`

## Step 5 — Migrate the cron callers

The Python schedulers in `natures-produce-buying` should be retired
once the Vercel crons run reliably for one full week:

| Old | New |
|---|---|
| `scripts/pull_pricelists.py` (Cowork scheduled task) | `/api/cron/pull-pricelists` |
| `scripts/pull_invoice.py` (every-20-min Mon/Thu eve) | `/api/cron/pull-invoice` |
| `scripts/compute_seasonal_index.py` (manual) | `/api/cron/compute-features` |
| `scripts/compute_elasticity.py` (manual) | `/api/cron/compute-features` |
| `scripts/pull_inventory.py` (manual) | `/api/cron/pull-inventory` (after gate flips) |

After a week of clean runs:

```bash
# In natures-produce-buying repo
git rm scripts/pull_pricelists.py scripts/pull_invoice.py \
       scripts/compute_seasonal_index.py scripts/compute_elasticity.py \
       scripts/pull_inventory.py
git commit -m "retire python ingestion scripts (moved to natures-understory Vercel app)"
```

## Step 6 — Wire the Cowork agent

The produce-buying skill in `~/.claude/skills/produce-buying/SKILL.md`
currently has the agent calling `scripts/build_order.py` directly.
Update it to POST `/api/orders/build` with an `Authorization: Bearer
${AGENT_SECRET}` header. The contract is documented at
`docs/api_contract.md`.

OCR + dialogue stay in Cowork. Match + decide + persistence move
behind the API.

## Status of each phase

| Phase | Status | Blocker |
|---|---|---|
| Phase 1 — pricelist + invoice + order history | ✅ Code complete; needs deploy + smoke | None |
| Phase 2 — nightly feature compute | ✅ Code complete; needs deploy | None |
| Phase 3 — inventory + Thrive PO | ⛔ Code complete but 503-gated | Tasks #5, #2 |
| Phase 4 — order build API + Cowork contract | ✅ Code complete; needs deploy | None |

## Known limitations

1. **`compute-features` only writes Tier C rows for elasticity.** Tier
   A/B math (log-log around price events, Spearman correlation) is
   stubbed with the constants documented but not yet implemented. Math
   only matters once Task #8 (sales backfill) lands; until then Tier C
   is the correct output.

2. **Standing items are hard-coded** in
   `app/api/orders/build/route.ts → loadStanding()`. Move to a
   `standing_items` table in a follow-up so Clark can edit from the UI.

3. **Email `.eml` is rendered + cached in `alberts_orders.email_eml`
   as bytea.** Currently the build route doesn't render the `.eml` —
   that's a follow-up. The hex-encoded bytea handling in
   `app/api/orders/[date]/email/route.ts` is forward-compatible.

4. **No tests for the new surface yet.** vitest + Playwright are
   already configured; tests for `decide.ts` and the cron route
   handlers are a sensible next add.

## Rollback

The Python pipeline keeps running on its own Cowork-side schedule. If
a Vercel cron fails or writes garbage:

1. Remove the bad cron from `vercel.json`, redeploy
2. Or set `CRON_SECRET=disabled-temp-<timestamp>` to break the auth
   without a deploy
3. Re-enable Python ingest in Cowork

The Python scripts and the Vercel routes can run in parallel safely
because all writes are idempotent (upserts on natural keys).
