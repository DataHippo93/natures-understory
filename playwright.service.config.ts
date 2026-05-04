// Playwright service config — wraps the base playwright.config.ts to
// route browsers to Microsoft Playwright Workspaces (Azure-hosted) and
// upload traces to the shared storage account.
//
// Mirrors adk-makerhub's working pattern. Three differences worth
// flagging next time the makerhub config changes:
//   1. We point testDir at `./tests` (smoke specs) instead of `./e2e`
//      (the existing local-only suite). Don't run both via this config
//      — keep the local CI workflow on the original config.
//   2. webServer is intentionally OMITTED here: in Azure runs we hit a
//      live deployed URL (`PLAYWRIGHT_TEST_BASE_URL`), not a local dev
//      server.
//   3. trace is forced 'on' so every Azure run uploads, not just retries.
//
// Required env vars (set in GitHub Environment "production"):
//   PLAYWRIGHT_SERVICE_URL   wss://<region>.api.playwright.microsoft.com/...
//   PLAYWRIGHT_SERVICE_ACCESS_TOKEN  (or use Entra ID via AzureCliCredential)
//   PLAYWRIGHT_SERVICE_RUN_ID  GH run id, used to group traces in Workspaces
//   PLAYWRIGHT_TEST_BASE_URL  Vercel preview/prod URL under test
//   NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY
//   E2E_USER_EMAIL, E2E_USER_PASSWORD

import { defineConfig } from '@playwright/test';
import { getServiceConfig, ServiceOS } from '@azure/microsoft-playwright-testing';
import baseConfig from './playwright.config';

export default defineConfig(
  baseConfig,
  getServiceConfig(baseConfig, {
    exposeNetwork: '<loopback>',
    timeout: 30_000,
    os: ServiceOS.LINUX,
    useCloudHostedBrowsers: true,
  }),
  {
    testDir: './tests',
    use: {
      baseURL: process.env.PLAYWRIGHT_TEST_BASE_URL,
      trace: 'on',
      screenshot: 'only-on-failure',
    },
    // Disable the local webServer — we run against the deployed URL.
    webServer: undefined,
    reporter: [
      ['list'],
      ['@azure/microsoft-playwright-testing/reporter'],
    ],
  }
);
