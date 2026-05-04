// Smoke spec — runs against the deployed Vercel preview/prod, mirrors the
// adk-makerhub `homepage.spec.ts` pattern. Intentionally minimal: just
// proves the app loads and Supabase Auth redirects unauthenticated users.
//
// Full CRUD coverage will land once Phase 2 of the operator UI ships.

import { test, expect } from '@playwright/test';

test.describe('Homepage smoke', () => {
  test('root URL serves a 2xx response', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.status(), `unexpected HTTP ${response?.status()}`).toBeLessThan(400);
  });

  test('unauthenticated visit redirects to /login', async ({ page }) => {
    await page.goto('/');
    // Either we're already on /login, or the layout's auth check redirects us there.
    await expect(page).toHaveURL(/\/login/, { timeout: 10000 });
  });

  test('app shell metadata is present', async ({ page }) => {
    await page.goto('/login');
    await expect(page).toHaveTitle(/Nature.s Understory/i);
  });
});
