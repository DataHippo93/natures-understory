# Nature's Understory — State Audit (2026-05-03)

**Author:** Cowork agent on session `local_4f5be7e1` (Azure-E2E mission).
**Scope:** Inventory of what exists today vs. the store-ops brain
architecture spec. Companion to the Azure E2E pipeline work landing
on the same branch (`chore/azure-e2e-setup`).

---

## TL;DR

- The Vercel app is **alive and substantial** — far past skeleton. Phases 1, 2, and 4 of the produce-buying port are code-complete (per `docs/produce_pipeline_deploy.md`); Phase 3 is gated on Thrive endpoint discovery.
- **Auth is Supabase Auth** (`@supabase/ssr` 0.10.0), email + password, with role-based metadata (`admin / gm / agm / store_associate / kitchen`). No NextAuth, no Google-domain restriction. Matches Clark's correction.
- **No middleware** (`middleware.ts` does not exist). Route protection happens via server components calling `supabase.auth.getUser()` and via RLS at the DB layer. The login page does the redirect implicitly through layout rendering.
- **Deployed on Vercel** (`prj_u9e42ADLW6VGBN1G8SVjv80gJzgi`, team `team_xWBhosYi4OFiiiyPxJhj6SOF`). Domain `natures-understory.vercel.app`. Crons configured for daily-sync + new produce-buying jobs.
- **CI exists** (`.github/workflows/ci.yml`) but runs Playwright on `ubuntu-latest` with hardcoded creds in the spec. **No Azure-hosted browsers, no trace upload to Playwright Workspaces.**
- **One urgent security flag:** `e2e/auth.test.ts` checks Clark's personal `cmaine@ycconsulting.biz` + plaintext password into Git as defaults. Replace with a dedicated test user before the next Azure E2E run lands.
- Substantial **uncommitted WIP** sitting on `main`: the entire produce-buying API surface (`app/api/cron/*`, `app/api/orders/*`, `app/orders/`), the `lib/{alberts,audience,decide,gmail}.ts` core, all five Supabase migrations after the original two. None of this is on origin yet.

---

## 1. Repository layout

```
natures-understory/
├── api/                    legacy Flask shim for old Vercel deploy (api/index.py)
├── app/                    Next.js 16 App Router
│   ├── (auth)/login/       Supabase email+password sign-in form
│   ├── admin/users/        Role management UI
│   ├── api/                API routes (admin, auth, cron, orders, sync, reports)
│   ├── auth/callback/      Supabase magic-link / invite callback
│   ├── labor/, schedule/,
│   │   shifts/, reports/,
│   │   orders/             Operator pages (mostly Phase 1-2 dashboards)
│   └── page.tsx            Dashboard (KPI cards + quiet-score chart)
├── components/             KPI cards, charts, sidebar, tables, query interface
├── lib/
│   ├── supabase/           server / client / admin clients (all Supabase Auth)
│   ├── alberts.ts          pricelist + invoice CSV parsers (UNCOMMITTED)
│   ├── audience.ts         decision/audience-tagged note shape (UNCOMMITTED)
│   ├── decide.ts           pure deterministic match + score logic (UNCOMMITTED)
│   ├── gmail.ts            Gmail OAuth + attachment fetcher (UNCOMMITTED)
│   ├── clover.ts           Clover Reports API client
│   ├── homebase.ts         Homebase scheduling client
│   └── data.ts, demo-data.ts, types.ts, utils.ts
├── supabase/migrations/    001..005 — sales tables, alberts tables,
│                             decision_log, thrive_inventory_snapshot
├── e2e/auth.test.ts        Existing Playwright spec (8 tests)
├── __tests__/              vitest (unit tests)
├── .github/workflows/ci.yml  ubuntu-runner CI (test + e2e + build + deploy)
├── playwright.config.ts    basic, single chromium project, no Azure
├── vercel.json             cron schedule (daily-sync + 4 new WIP crons)
└── (legacy Python: main.py, analyzer.py, clover_client.py,
   homebase_client.py — Flask dashboard, no longer the front door)
```

## 2. Auth (Supabase Auth, NOT NextAuth)

### How it actually works today

- `lib/supabase/client.ts` — browser client (`createBrowserClient` from `@supabase/ssr`). Returns `null` if env vars missing → demo mode.
- `lib/supabase/server.ts` — RSC server client (`createServerClient`) wired to Next 16 cookies(). Returns `null` if env vars missing → demo mode.
- `lib/supabase/admin.ts` — service-role client for admin endpoints. Defines `UserRole` enum + role labels.
- `app/(auth)/login/page.tsx` — client component, calls `supabase.auth.signInWithPassword({email, password})`, then `router.push('/')`.
- `app/auth/callback/route.ts` — handles magic link / invite callbacks via `exchangeCodeForSession`.
- `app/api/auth/sign-out/route.ts` — POST endpoint, calls `signOut()`, redirects to `/login`.
- `app/layout.tsx` — calls `supabase.auth.getUser()` server-side to decide what to show in the sidebar (passes `userEmail` down).
- `app/admin/users/page.tsx` + `app/api/admin/{users,invite}/route.ts` — admin UI for inviting users + assigning roles.

### What's missing vs. spec

- **No `middleware.ts`.** Most Supabase + Next.js 14+ setups put the session-refresh + redirect-to-login logic in middleware so it applies on every request. Today the protection is implicit: pages call `supabase.auth.getUser()` themselves. This works but is easy to forget; missing the call on a new page = unprotected route. Recommend adding middleware in a follow-up.
- **No Google domain restriction.** Architecture doc §13 specced "NextAuth + Google domain-restricted." Clark's overriding direction: Supabase Auth, full stop. So the doc needs an update; the implementation is correct.
- **Role enforcement is admin-page-only.** `lib/supabase/admin.ts` defines roles but I didn't find any `requireRole('gm')`-style guard in the API routes. RLS may be doing the work; should be verified once role-gated features land in Phase 2.

## 3. Pages + components

### Pages
| Path | Purpose |
|---|---|
| `/` | Dashboard — Today's Sales, Labor Ratio, Quiet Score KPIs + traffic chart |
| `/login` | Email + password sign-in |
| `/labor` | Labor ratio table + chart |
| `/shifts` | Shift analysis (quiet score by hour, DOW breakdown) |
| `/schedule` | Upcoming Homebase schedule view |
| `/reports` | Reports landing |
| `/reports/categories` | Category sales breakdown |
| `/reports/items` | Item-level sales |
| `/reports/query` | Ad-hoc query interface |
| `/orders` | (UNCOMMITTED) Albert's order history list |
| `/orders/[date]` | (UNCOMMITTED) Order detail with audience-tagged notes |
| `/admin/users` | User invite + role management |

### Components (highlights)
- `components/sidebar.tsx` — section-grouped nav (Overview / Operations / Reports / Admin)
- `components/kpi-card.tsx` — status-coded KPI tile
- `components/charts/{quiet-score,labor-ratio,category-sales}-chart.tsx` (recharts)
- `components/tables/{dow-breakdown,items,labor-actuals,labor-projections}-table.tsx`
- `components/{sync-button,sync-panel,query-interface,header,nav,lookback-filter,schedule-date-picker}.tsx`
- `components/ui/card.tsx` — base shadcn-style Card primitives

### Visual design system
The app is using a custom dark-forest palette with CSS vars — `--forest-dark`, `--gold`, `--sage`, `--cream` — and Josefin Sans + Montserrat fonts. Fully custom, not a UI kit.

## 4. API routes

```
app/api/
├── admin/
│   ├── enrich-categories/route.ts
│   ├── invite/route.ts                   POST — Supabase admin invite
│   └── users/route.ts                    GET/PATCH — list + role updates
├── auth/sign-out/route.ts                POST — supabase.auth.signOut + redirect
├── cron/                                 (UNCOMMITTED, except daily-sync)
│   ├── compute-features/route.ts         nightly seasonal_index + elasticity
│   ├── daily-sync/route.ts               existing daily-sync (committed)
│   ├── pull-inventory/route.ts           Mon/Thu 6:55 AM ET (gated 503)
│   ├── pull-invoice/route.ts             Mon/Thu eve every 20 min
│   └── pull-pricelists/route.ts          Mon/Thu 6:50 AM ET — Jasmia emails
├── debug/
│   ├── category-test/route.ts
│   └── homebase/route.ts
├── orders/                               (UNCOMMITTED)
│   ├── build/route.ts                    POST — main order-build endpoint
│   └── [date]/{email,po}/route.ts        GET .eml / POST Thrive PO (gated)
├── reports/
│   ├── query/route.ts
│   └── saved-views/route.ts
└── sync/
    ├── categories/route.ts
    ├── items/route.ts
    └── sales/route.ts
```

The orders/cron surface is the new "store-ops brain" plumbing. Auth on those routes uses Bearer tokens (`CRON_SECRET` for Vercel, `AGENT_SECRET` for Cowork agent calls) per `docs/api_contract.md` — not Supabase user sessions. That's intentional: machine-to-machine.

## 5. Supabase wiring

- Project: `yvbsibrikylbqupignij` (per `docs/produce_pipeline_deploy.md`)
- Auth flow: Supabase Auth + RLS at the DB layer. **All Understory dashboards read from this single project — no separate Thrive ingest, no duplicate pipeline.** The store-ops brain's cron jobs populate the tables; the UI just reads them.
- Migrations on disk:
  - `001_sales_tables.sql` — `sales_categories`, `sales_items`, `sales_line_items` (committed)
  - `002_fix_quantity_type.sql` (committed)
  - `003_alberts_tables.sql` — pricelist + history + orders + lines + invoices (UNCOMMITTED)
  - `004_decision_log.sql` — append-only decision audit (UNCOMMITTED)
  - `005_thrive_inventory.sql` — append-only inventory snapshots + `thrive_inventory_latest` view (UNCOMMITTED)

### Tables Understory dashboards should read

| Table | Rows | Refresh | Notes |
|---|---|---|---|
| `thrive_sales_history` | 171,028 | daily cron | 2023-12-30 → 2026-05-02; 21,661 distinct variants; 840 distinct days. Primary source of truth for category/item sales dashboards. |
| `thrive_product_catalog` | 4,749 | daily cron | Variant-level catalog. |
| `thrive_vendors` | 165 | daily cron | Vendor master. |
| `thrive_inventory_snapshot` | 86,843 | every 6h | 30-day retention. ⚠️ **`qty_on_hand` is 100% NULL across all rows — parser bug in the brain's ingest. Do NOT build inventory-quantity dashboards on this column until the brain ships its parser-fix PR.** |
| `thrive_po_status` | 8 | every 6h | Open PO status snapshot. |
| `sync_log` | varies | append on every cron | Use this for the "last refreshed at" badge in the dashboard footer. |
| `alberts_*` (003 migration) | growing | brain pipeline | Albert's price entries / orders / lines / invoices. |
| `decision_log` (004 migration) | growing | brain pipeline | Append-only decision audit. |

### Cross-project read — Albert's price history

`alberts_price_history` (103,486 rows) **lives in a separate Supabase
project**: `Lobster Maine` (`vadbjrxgttyuxxeaupjr`). The store-ops
brain is shipping a daily mirror cron (`api/cron/alberts_price_mirror.py`)
that copies it into natures-understory. Until that lands, Understory has
two options for any price-history-dependent UI:

1. Wait for the mirror to land (preferred — single project, single auth).
2. Add a second supabase client pointed at the Lobster Maine project (only acceptable if a price-history dashboard is blocking work right now).

Neither option needs to be picked today — the existing dashboards
(labor, shifts, schedule, category sales) don't touch price history.

## 6. Existing CI / E2E

`.github/workflows/ci.yml` has four jobs:
1. **test** — typecheck + vitest
2. **e2e** — Playwright on `ubuntu-latest`, installs chromium, runs `npm run test:e2e`
3. **build** — `next build` against prod env
4. **deploy** — `vercel --prod` on push to main

`playwright.config.ts` is the stock Next.js scaffold:
- `testDir: './e2e'`
- `webServer: { command: 'npm run dev', url: 'http://localhost:3000' }`
- single chromium project
- `trace: 'on-first-retry'`
- 30s timeout, 2 retries on CI

`e2e/auth.test.ts` covers:
- redirect from `/` to `/login` when unauthenticated
- login form renders
- invalid creds show error
- valid creds redirect to dashboard
- 7 authenticated navigation tests (dashboard / shifts / labor / schedule / reports/categories / sidebar / lookback filter)

### ⚠️ Security flags in this file

```ts
const EMAIL = process.env.TEST_EMAIL ?? 'cmaine@ycconsulting.biz';
const PASSWORD = process.env.TEST_PASSWORD ?? 'Cerises!1';
```

Clark's personal credentials are checked into the public(-ish) repo as fallbacks. **Action:** rotate the password Clark currently uses for that account, replace the fallbacks with `throw new Error('TEST_EMAIL not set')`, and create a dedicated `e2e@natures-understory` test user in Supabase Auth (Mission 3 of this session — see `006_e2e_test_user_seed.sql` migration drafted on this branch).

## 7. Gaps vs. store-ops brain UI spec

The architecture doc spec'd Phase 2 of the operator UI as: kickoff buttons for store buying processes, margin dashboards, action lists ("things to fix in Thrive", "stocks to check"), approval flows.

Status today, mapped to spec:

| Spec'd UI | Status |
|---|---|
| Kickoff button — Albert's order | ⏳ API route exists (`POST /api/orders/build`); no operator-facing button yet. The `/orders` page is read-only history. |
| Kickoff button — Kent's order | ❌ Not started. Kent's flow not yet specified; pipeline path not built. |
| Kickoff button — grocery weekly | ❌ Not started. |
| Margin dashboards | ⏳ Category sales chart + items table exist (`/reports/categories`, `/reports/items`); margin column not present in the data layer yet. |
| Action lists ("fix in Thrive") | ❌ Not started. Decision-log queries exist but no "fix list" surface. |
| Action lists ("stocks to check") | ⏳ `thrive_inventory_latest` view exists; surface not built. |
| Approval flow (order → review → send) | ⏳ Status enum exists in `alberts_orders` (`draft / review / sent / received`); no approve/reject UI yet. |
| Role-based auth | ✅ Roles defined; admin page exists; per-route guards not yet exhaustive. |

## 8. Vercel + env vars

- Project ID: `prj_u9e42ADLW6VGBN1G8SVjv80gJzgi`
- Org ID: `team_xWBhosYi4OFiiiyPxJhj6SOF`
- Project name: `natures-understory`
- Site URL (per ci.yml build step): `https://natures-understory.vercel.app`

Env vars referenced across the codebase:
- `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` — required for non-demo mode
- `SUPABASE_SERVICE_ROLE_KEY` — admin client only
- `NATURES_STOREHOUSE_MID` / `NATURES_STOREHOUSE_TOKEN` — Clover
- `HOMEBASE_API_KEY` / `HOMEBASE_LOCATION_ID` — Homebase
- `NEXT_PUBLIC_SITE_URL` — used by sign-out redirect
- `CRON_SECRET` / `AGENT_SECRET` — Bearer auth for cron + orders endpoints
- `GMAIL_OAUTH_CREDENTIALS` / `GMAIL_TOKEN_JSON` — Gmail OAuth for pricelist + invoice ingest
- `THRIVE_EMAIL` / `THRIVE_PASSWORD` — Thrive scraper auth
- `THRIVE_INVENTORY_PATH_VERIFIED` / `THRIVE_PO_PATH_VERIFIED` — gates blocking the inventory + PO routes
- `TEST_EMAIL` / `TEST_PASSWORD` — Playwright auth (used by ci.yml e2e job)

## 8a. Homebase data — open question for Clark

The Labor Ratio + Schedule pages depend on Homebase data. Today the
Next.js code calls the Homebase API directly via `lib/homebase.ts`
(env vars `HOMEBASE_API_KEY` + `HOMEBASE_LOCATION_ID`).

Cross-project search of Supabase (natures-understory, Lobster Maine,
adk-makerhub, northvault) found **no Homebase / payroll / schedule /
shift / employee / labor / timesheet / punch tables anywhere**. So
unlike the Thrive data, there is no warehoused Homebase dataset for
Understory to read.

Options to surface back to Clark:
1. Keep direct Homebase API calls per-request (works but no historical
   labor-ratio analysis beyond Homebase's own retention).
2. Add a `homebase_*` ingest cron in the store-ops brain (mirrors the
   `thrive_*` pattern), so Understory can read from one warehouse.
3. Use the legacy Python pipeline (`homebase_client.py`) if it's still
   running somewhere.

**Action required from Clark before this audit can be considered complete.**

## 9. Recommendations

In rough priority order:

1. **Replace the hardcoded test credentials in `e2e/auth.test.ts` with a dedicated `e2e@` Supabase user.** Rotate the personal account password. (Mission 3 of this session.)
2. **Add `middleware.ts` to centralize auth refresh + redirect-to-login.** Standard Supabase + Next.js 14+ pattern; current implicit per-page protection is fragile.
3. **Commit the produce-buying WIP** (`app/api/cron/*`, `app/api/orders/*`, `app/orders/`, `lib/{alberts,audience,decide,gmail}.ts`, migrations 003-005, `vercel.json` cron updates). Sitting uncommitted on `main` is risky; one missed save and it's gone.
4. **Build the operator kickoff buttons.** The API surface is ready; an `/operations` page with "Build today's Albert's order" / "Send approved order" buttons would close the loop. Phase 2 of the brain's UI mission.
5. **Wire role enforcement into the cron + orders routes.** `AGENT_SECRET` works for the agent path; user-facing approval/reject buttons should re-check the operator's role server-side.
6. **Add `tests/api/orders.spec.ts`** (or vitest) for `decide.ts` and the cron handlers — flagged as a known gap in `docs/produce_pipeline_deploy.md`.
7. **Update the architecture doc** to reflect Supabase Auth (not NextAuth). Doc §13 is wrong.

---

## Appendix A — Files this audit touched (read-only)

```
package.json, tsconfig.json, next.config.ts, vercel.json,
playwright.config.ts, .github/workflows/ci.yml,
app/{layout,page}.tsx, app/(auth)/login/page.tsx,
app/auth/callback/route.ts, app/api/auth/sign-out/route.ts,
lib/supabase/{client,server,admin}.ts,
e2e/auth.test.ts,
docs/api_contract.md, docs/produce_pipeline_deploy.md,
supabase/migrations/{003_alberts_tables,004_decision_log,005_thrive_inventory}.sql,
.env.example, .vercel/project.json,
git log + git status
```

## Appendix B — Companion deliverables on this branch

`chore/azure-e2e-setup` also includes:
- Smoke specs at `tests/{homepage,auth}.spec.ts`
- Azure Playwright service config at `playwright.service.config.ts`
- Test user fixture at `tests/fixtures/auth.ts`
- GitHub workflow at `.github/workflows/e2e-azure.yml`
- E2E user seed migration at `supabase/migrations/006_e2e_test_user_seed.sql`
- See `docs/azure_e2e_setup.md` for runbook + the explicit Clark-action checklist (Azure tenant ID, OIDC service principal, Playwright Workspaces account ID — all of which I do not have access to from this session).
