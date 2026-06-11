import { test, expect } from '@playwright/test';

const EMAIL = process.env.TEST_EMAIL;
const PASSWORD = process.env.TEST_PASSWORD;
if (!EMAIL || !PASSWORD) {
  throw new Error('TEST_EMAIL and TEST_PASSWORD env vars are required — never hardcode credentials.');
}

test.describe('Authentication', () => {
  test('unauthenticated user is redirected to login', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/login/);
  });

  test('login page renders correctly', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toBeVisible();
  });

  test('invalid credentials show error', async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[type="email"]', 'bad@example.com');
    await page.fill('input[type="password"]', 'wrongpassword');
    await page.click('button[type="submit"]');
    // Should show an error message (not redirect)
    await expect(page).toHaveURL(/\/login/);
    await expect(page.locator('text=/invalid|incorrect|failed/i')).toBeVisible({ timeout: 10000 });
  });

  test('valid credentials redirect to dashboard', async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[type="email"]', EMAIL);
    await page.fill('input[type="password"]', PASSWORD);
    await page.click('button[type="submit"]');
    await expect(page).not.toHaveURL(/\/login/, { timeout: 15000 });
    // Dashboard should show
    await expect(page.locator('text=/Dashboard/i').first()).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Navigation (authenticated)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[type="email"]', EMAIL);
    await page.fill('input[type="password"]', PASSWORD);
    await page.click('button[type="submit"]');
    await expect(page).not.toHaveURL(/\/login/, { timeout: 15000 });
  });

  test('dashboard loads with KPI cards', async ({ page }) => {
    await page.goto('/');
    // .first(): KPI titles can also appear in side-cards/labels — strict mode
    await expect(page.locator("text=Today's Sales").first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator('text=Labor Ratio').first()).toBeVisible();
    await expect(page.locator('text=Current Quiet Score').first()).toBeVisible();
  });

  test('shift analysis page loads', async ({ page }) => {
    await page.goto('/shifts');
    await expect(page.getByRole('heading', { name: /Shift Analysis/i })).toBeVisible({ timeout: 10000 });
    await expect(page.locator('text=Day of Week Breakdown').first()).toBeVisible();
  });

  test('labor ratio page loads', async ({ page }) => {
    await page.goto('/labor');
    await expect(page.locator("text=Labor Ratio").first()).toBeVisible({ timeout: 10000 });
  });

  test('schedule page loads', async ({ page }) => {
    await page.goto('/schedule');
    await expect(page.getByRole('heading', { name: /Schedule/i })).toBeVisible({ timeout: 10000 });
  });

  test('lookback filter changes data range', async ({ page }) => {
    await page.goto('/labor?days=30');
    await expect(page.getByText('(30 days)', { exact: true })).toBeVisible({ timeout: 10000 });

    await page.click('text=7D');
    await expect(page).toHaveURL(/days=7/);
    await expect(page.getByText('(7 days)', { exact: true })).toBeVisible({ timeout: 10000 });
  });

  test('sidebar has expected navigation items', async ({ page }) => {
    await page.goto('/');
    const nav = page.locator('aside');
    await expect(nav.getByRole('link', { name: 'Dashboard' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Shift Analysis' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Labor Ratio' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Schedule' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Category Sales' })).toBeVisible();
  });

  test('reports category page loads', async ({ page }) => {
    await page.goto('/reports/categories');
    await expect(page.locator("text=/Category Sales|Sales by Category/i")).toBeVisible({ timeout: 10000 });
  });
});
