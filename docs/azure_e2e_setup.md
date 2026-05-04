# Azure E2E Setup — Runbook

This document captures the one-time human steps required to make the
new `e2e-azure` workflow go green. Mirrors the pattern adk-makerhub
already uses; do not invent new resources without checking what
makerhub set up.

## What this branch ships (`chore/azure-e2e-setup`)

| File | Purpose |
|---|---|
| `tests/homepage.spec.ts` | Three smoke tests: 2xx response, redirect to /login, page title |
| `tests/auth.spec.ts` | Three smoke tests: form renders, brand chrome, invalid creds error |
| `tests/fixtures/auth.ts` | Playwright fixture: signs the test user in via Supabase Auth REST + injects the SSR cookie |
| `playwright.service.config.ts` | Wraps `playwright.config.ts` to point browsers at Microsoft Playwright Workspaces, force `trace: 'on'`, and disable the local dev-server |
| `.github/workflows/e2e-azure.yml` | New workflow — runs Playwright on Azure-hosted browsers, uploads traces, gated on the `production` GitHub Environment |
| `supabase/migrations/006_e2e_test_user_seed.sql` | Documentation-only — explains how to provision the `e2e@` user (Supabase Auth users can't be created via SQL migration) |
| `docs/understory_audit_2026-05-03.md` | Companion audit |
| `docs/azure_e2e_setup.md` | This file |
| `package.json` | Adds `@azure/microsoft-playwright-testing` dev dep + `test:e2e:azure` script |

## What is intentionally NOT changed

- `playwright.config.ts` (existing local config) — untouched
- `e2e/auth.test.ts` (existing local-CI suite) — untouched
- `.github/workflows/ci.yml` (existing build/deploy pipeline) — untouched
- All produce-buying WIP files sitting on `main` — untouched

The Azure workflow runs **in addition to** the existing CI; it doesn't
replace anything. Once it's been green for a week, the `e2e` job in
`ci.yml` can be deleted in a follow-up.

## Clark-only steps before the workflow can go green

These cannot be done from inside an unsupervised Cowork session — they
require Clark's hands on the Azure portal, Supabase dashboard, and
GitHub repo settings. The list assumes adk-makerhub already has all of
this provisioned, so most of it is "copy the values."

### 1. Reuse or create the Azure resources

If reusing makerhub's setup (recommended — single source of truth):
- Confirm the Microsoft Playwright Workspaces account has a "Tester"
  role assignment for the same OIDC service principal makerhub uses.
- Confirm the storage account `pwstrgyccgeneral5b0f` has a "Storage
  Blob Data Contributor" role assignment for that SP. (No new role
  assignment needed.)

If a separate setup is preferred for Understory:
- Create a new Playwright Workspace in the same Azure subscription.
- Create a new app registration / OIDC service principal with federated
  credentials targeting `repo:Clark/natures-understory:environment:production`.
- Assign the SP "Storage Blob Data Contributor" on `pwstrgyccgeneral5b0f`
  (or a fresh storage account, but reuse if possible to keep one trace
  bucket per org).
- Assign the SP "Tester" on the new Playwright Workspace.

### 2. Create the dedicated `e2e@` Supabase user

In the Understory Supabase project (`yvbsibrikylbqupignij`):
- Dashboard → Authentication → Users → Add user
- Email: `e2e@natures-understory.local`
- Password: 32+ char random — generate via `openssl rand -hex 24`
- Auto-confirm: yes
- (Optional) user_metadata: `{ "role": "store_associate" }` so RLS
  treats it like a regular store associate, not an admin.

Store the password in BWS as `NATURES_UNDERSTORY_E2E_USER_PASSWORD`.

### 3. Set up the GitHub `production` Environment

Repo Settings → Environments → New environment → name: `production`.

Add **Environment secrets**:
| Secret | Value source |
|---|---|
| `AZURE_CLIENT_ID` | Azure portal → App registrations → SP → Overview |
| `AZURE_TENANT_ID` | same |
| `AZURE_SUBSCRIPTION_ID` | Azure portal → Subscriptions |
| `PLAYWRIGHT_SERVICE_URL` | Playwright Workspaces portal → "Add region endpoint" snippet |
| `PLAYWRIGHT_SERVICE_ACCESS_TOKEN` | Playwright Workspaces portal → access tokens (or use Entra ID + delete this secret) |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://yvbsibrikylbqupignij.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase Dashboard → Project Settings → API |
| `E2E_USER_EMAIL` | `e2e@natures-understory.local` |
| `E2E_USER_PASSWORD` | from BWS (step 2) |

Add **Environment variable** (NOT a secret — the workflow reads via `vars.`):
| Variable | Value |
|---|---|
| `PLAYWRIGHT_TEST_BASE_URL` | `https://natures-understory.vercel.app` (or per-PR preview URL via Vercel-GitHub integration) |

(Optional) Add a deployment branch rule limiting `production` to
`main` + the `chore/azure-e2e-setup` branch so PRs from forks can't
exfiltrate the secrets.

### 4. Trigger the first run

```bash
gh workflow run e2e-azure.yml --ref chore/azure-e2e-setup
gh run list --workflow=e2e-azure.yml --limit 1
gh run watch
```

Expected outcome: 6/6 specs green, traces uploaded to the Playwright
Workspaces dashboard under the run ID `<gh_run_id>-<attempt>`.

If it fails, the most likely culprits are:
- `PLAYWRIGHT_SERVICE_URL` missing the workspace ID path segment
- `PLAYWRIGHT_TEST_BASE_URL` not set as a variable (it's `vars.`, not `secrets.`)
- OIDC trust missing for the new branch (federated credential subject
  must include `:environment:production`)
- The `production` environment not gating on the `azure-e2e` job (check
  that `environment: production` is on the job)

## After the first green run

1. Update `package.json` script: `"test:e2e:azure": "playwright test --config=playwright.service.config.ts --workers=10"`. Already wired in this branch.
2. Move the Playwright bits from `e2e/auth.test.ts` into `tests/`, replace the hardcoded `cmaine@ycconsulting.biz` defaults with `requireEnv`, and delete the `e2e` job from `.github/workflows/ci.yml`.
3. Add deeper specs as the operator UI lands (kickoff buttons, approval flows, etc.) — file naming convention: `tests/<feature>.spec.ts`.

## Why this layout

- **Two configs (local + service)** because we want `npm run test:e2e` to keep working for fast local iteration without a Playwright Workspaces token.
- **`tests/` is for Azure smoke; `e2e/` is for local full coverage.** Once the test user lands and the rewrite is done, we collapse to one suite under `tests/`.
- **`production` GitHub Environment, not repo secrets**, so secret access is gated on environment approval rules — no PR from a fork can exfil.
- **OIDC, not long-lived service principal secrets**, so token rotation is handled by Azure automatically.
