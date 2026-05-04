// Playwright service config — wraps the base playwright.config.ts to
// route browsers to Microsoft Playwright Workspaces (Azure-hosted).
//
// Auth: workspace ACCESS TOKEN (env PLAYWRIGHT_SERVICE_ACCESS_TOKEN).
// Default in @azure/microsoft-playwright-testing is ENTRA_ID, which is
// why we explicitly pass `serviceAuthType: ServiceAuth.ACCESS_TOKEN`.
//
// Note: the MPT reporter is intentionally NOT registered. The current
// portal-issued token uses the `pwid` claim instead of `aid`, which
// breaks the reporter's getRegionFromAccountID helper. The workflow
// patches validateMptPAT to accept pwid; we'd need a parallel patch
// for the reporter to use it. For first-run we use the local html
// reporter only — traces still get uploaded as a workflow artifact.
//
// Required env vars (set in GitHub Environment "Production"):
//   PLAYWRIGHT_SERVICE_URL                 wss://<region>.api.playwright.microsoft.com/accounts/<ws-id>/browsers
//   PLAYWRIGHT_SERVICE_ACCESS_TOKEN        from Playwright Testing portal
//   PLAYWRIGHT_SERVICE_RUN_ID              GH run id for grouping traces
//   PLAYWRIGHT_TEST_BASE_URL               Vercel URL under test
//   NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY
//   E2E_USER_EMAIL, E2E_USER_PASSWORD

import { defineConfig } from '@playwright/test';
import {
  getServiceConfig,
  ServiceAuth,
  ServiceOS,
} from '@azure/microsoft-playwright-testing';
import baseConfig from './playwright.config';

export default defineConfig(
  baseConfig,
  getServiceConfig(baseConfig, {
    serviceAuthType: ServiceAuth.ACCESS_TOKEN,
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
      ['html', { open: 'never', outputFolder: 'playwright-report' }],
    ],
  }
);
