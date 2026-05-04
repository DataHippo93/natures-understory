# Azure E2E Setup — Runbook

This document captures the one-time human steps required to make the
new `e2e-azure` workflow go green. Updated with concrete values from the
Cowork-driven provisioning run on 2026-05-04.

## What's already provisioned (Cowork agent did this)

### Azure
| Resource | Value |
|---|---|
| Subscription | `4c8cb21c-80d2-4a5b-8e78-bb3d63dd9e12` (Pay-As-You-Go, tenant `7df011e1-eb7e-46bc-b4f8-9ea223936cc6`) |
| Resource group | `ycc-general` (westus) |
| Playwright Workspace | `natures-understory-tests` (eastus) |
| Workspace ID | `1a88742e-ea29-49a4-8ff4-8e7664036e9d` |
| Service URL | `wss://eastus.api.playwright.microsoft.com/playwrightworkspaces/1a88742e-ea29-49a4-8ff4-8e7664036e9d/browsers` |
| Shared trace storage (reused from makerhub) | `pwstrgyccgeneral5b0f` (no role assignment yet — only needed if we wire the storage-side trace upload; the workspace already accepts traces via the service reporter) |

### GitHub (env: `Production`)
Already set as **secrets**:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `AZURE_TENANT_ID` (set in case we add OIDC later)
- `AZURE_SUBSCRIPTION_ID` (same)

Already set as **variables** (visible in plain text):
- `PLAYWRIGHT_SERVICE_URL` (the wss:// above)
- `PLAYWRIGHT_TEST_BASE_URL` = `https://natures-understory.vercel.app`

## What Clark still needs to do (two human-only steps)

### Step 1 — Generate Playwright Workspace access token

The Cowork SP doesn't have permission to call the Playwright dataplane
(needs admin consent for the Microsoft Playwright service principal in
the YC Consulting tenant). So this is a portal step.

1. Go to https://playwright.microsoft.com (sign in as cmaine@ycconsulting.biz).
2. Switch to the `natures-understory-tests` workspace (workspace selector
   in the top nav). If you don't see it, refresh — it was created
   2026-05-04.
3. Settings → **Access tokens** → **Generate new token**.
   - Name: `github-actions-prod`
   - Lifetime: 90 days (or per your rotation policy)
4. Copy the token value. Send it back to Cowork in the chat
   (this is a secure channel) — Cowork will set the GitHub secret
   `PLAYWRIGHT_SERVICE_ACCESS_TOKEN` for you. Don't paste it anywhere
   else.

### Step 2 — Create the dedicated `e2e@` Supabase user

In the Understory Supabase project (`yvbsibrikylbqupignij`):
1. Dashboard → Authentication → Users → Add user.
2. Email: `e2e@natures-understory.local`
3. Password: 32+ char random — `openssl rand -hex 24` works.
4. Auto-confirm: yes.
5. Store the password in BWS as `NATURES_UNDERSTORY_E2E_USER_PASSWORD`.
6. Tell Cowork the BWS key name; Cowork will pull from BWS and set the
   GitHub secrets `E2E_USER_EMAIL` + `E2E_USER_PASSWORD`.

That's it. Once both are done, Cowork triggers
`gh workflow run e2e-azure.yml --ref chore/azure-e2e-setup` and
reports the run URL.

## Optional follow-up — migrate to OIDC

The current setup uses a workspace access token (90-day rotation). To
move to long-lived-credential-free OIDC:
1. Create an Azure App Registration `natures-understory-github` (needs
   Entra Application Administrator — Cowork SP doesn't have it).
2. Add federated credentials trusting
   `repo:DataHippo93/natures-understory:environment:Production`.
3. Assign the new SP `Contributor` on the Playwright Workspace (and
   `Storage Blob Data Contributor` on `pwstrgyccgeneral5b0f` if/when we
   wire storage-side trace uploads).
4. Set the GitHub secret `AZURE_CLIENT_ID` to the new SP's app id.
5. Update `.github/workflows/e2e-azure.yml` to add `id-token: write`
   permission and an `azure/login@v2` step before the playwright run;
   update `playwright.service.config.ts` to use `serviceAuthType:
   'ENTRA_ID'` in the `getServiceConfig` options (or unset the access
   token env var).
6. Delete the access token in the Playwright portal.

The `scripts/setup_azure_e2e.sh` helper has the exact commands. Run as
yourself (`az login` interactively first).

## What this branch ships (`chore/azure-e2e-setup`)

| File | Purpose |
|---|---|
| `tests/homepage.spec.ts` | 3 smoke tests (200, redirect, title) |
| `tests/auth.spec.ts` | 3 smoke tests (form, brand, error) |
| `tests/fixtures/auth.ts` | Supabase Auth sign-in fixture |
| `playwright.service.config.ts` | Wraps base config for Microsoft Playwright Workspaces |
| `.github/workflows/e2e-azure.yml` | Workflow gated on `Production` environment |
| `supabase/migrations/006_e2e_test_user_seed.sql` | Docs-only migration |
| `scripts/setup_azure_e2e.sh` | Optional OIDC-migration helper |
| `docs/understory_audit_2026-05-03.md` | Companion audit |
| `docs/azure_e2e_setup.md` | This file |
| `package.json` | Adds `@azure/microsoft-playwright-testing` + `test:e2e:azure` script |

## What this branch does NOT touch

- `playwright.config.ts` (existing local config) — untouched
- `e2e/auth.test.ts` (existing local-CI suite) — untouched
- `.github/workflows/ci.yml` (existing build/deploy pipeline) — untouched
- All produce-buying WIP files sitting on `main` — untouched

The Azure workflow runs **in addition to** the existing CI; once it has
been green for a week, the `e2e` job in `ci.yml` can be deleted in a
follow-up.
