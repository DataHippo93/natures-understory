// Playwright Supabase Auth sign-in fixture.
//
// Signs the test user in by hitting the Supabase Auth REST endpoint
// directly (no UI), then drops the access/refresh tokens into the
// browser's storage in the format @supabase/ssr expects. Mirrors the
// pattern adk-makerhub uses in `inventory-refresh.spec.ts` (per Clark's
// pointer; canonical implementation lives in that repo).
//
// Required env vars (provisioned in GitHub Environment "production"):
//   NEXT_PUBLIC_SUPABASE_URL
//   NEXT_PUBLIC_SUPABASE_ANON_KEY
//   E2E_USER_EMAIL
//   E2E_USER_PASSWORD
//
// Usage:
//   import { test } from './fixtures/auth';
//   test('something requiring login', async ({ authedPage }) => { ... });

import { test as base, expect, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

type AuthFixtures = {
  authedPage: Page;
};

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name} — required by Playwright auth fixture.`);
  return v;
}

export const test = base.extend<AuthFixtures>({
  authedPage: async ({ page, baseURL }, use) => {
    const supabaseUrl = requireEnv('NEXT_PUBLIC_SUPABASE_URL');
    const supabaseAnonKey = requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY');
    const email = requireEnv('E2E_USER_EMAIL');
    const password = requireEnv('E2E_USER_PASSWORD');

    // Sign in via REST → get access + refresh tokens
    const sb = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error || !data.session) {
      throw new Error(`E2E sign-in failed: ${error?.message ?? 'no session returned'}`);
    }

    // Inject the session cookie that @supabase/ssr expects on requests.
    // Cookie name is `sb-<project-ref>-auth-token`. Project ref = the
    // first label of the supabase URL hostname.
    const projectRef = new URL(supabaseUrl).hostname.split('.')[0];
    const cookieName = `sb-${projectRef}-auth-token`;
    const cookieValue = JSON.stringify([
      data.session.access_token,
      data.session.refresh_token,
      null, // provider_token
      null, // provider_refresh_token
    ]);

    const url = new URL(baseURL ?? 'http://localhost:3000');
    await page.context().addCookies([
      {
        name: cookieName,
        value: encodeURIComponent(cookieValue),
        domain: url.hostname,
        path: '/',
        httpOnly: false,
        secure: url.protocol === 'https:',
        sameSite: 'Lax',
      },
    ]);

    await use(page);
  },
});

export { expect };
