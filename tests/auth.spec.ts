// Auth smoke — proves the Supabase Auth login form renders and that
// known-bad creds produce a visible error. Does NOT exercise a happy-path
// sign-in (that lives in the existing `e2e/auth.test.ts` against the dev
// server, and will move here once the dedicated `e2e@` Supabase user
// from migration 006 is provisioned in the prod project).

import { test, expect } from '@playwright/test';

test.describe('Login page smoke', () => {
  test('login form renders with email + password + submit', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toBeVisible();
  });

  test('brand chrome is intact', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('h1')).toContainText(/Nature.s Understory/i);
    await expect(page.locator('text=/Operations Login/i')).toBeVisible();
  });

  test('invalid creds produce a visible error and stay on /login', async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[type="email"]', 'nope-this-is-not-real@example.invalid');
    await page.fill('input[type="password"]', 'definitely-wrong-password-1234');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/\/login/);
    await expect(
      page.locator('text=/invalid|incorrect|failed|cannot reach/i')
    ).toBeVisible({ timeout: 10000 });
  });
});
