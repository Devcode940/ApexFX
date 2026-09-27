import { expect, test } from '@playwright/test';

const providerFree = { MARKET_DATA_MODE: 'offline' as const };
void providerFree; // documented intent: webServer runs offline; no test may require live data

test('boots the production SPA shell with an honest degraded feed', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#global_header')).toContainText('ApexFX');
  await expect(page.locator('#watchlist_btn_EURUSD')).toBeVisible();
  // offline mode: rows must advertise "No source", never fabricated prices
  await expect(page.locator('#watchlist_btn_EURUSD')).toContainText('No source');
  await expect(page.locator('#weekly_calendar_component')).toBeVisible();
});

test('demo preview mode stays removed from the shipped bundle', async ({ page }) => {
  await page.goto('/');
  const html = await page.content();
  expect(html).not.toMatch(/APEX_DEMO_FEED/i);
  expect(html).not.toMatch(/synthetic (preview|demo) feed/i);
});

test('watchlist add/remove round trip persists across reload', async ({ page }) => {
  await page.goto('/');
  const row = page.locator('#watchlist_btn_EURJPY');
  await expect(row).toHaveCount(0);
  await page.getByTitle(/Add instruments from the covered catalog/).click();
  await page.getByRole('button', { name: /EUR\/JPY/ }).click();
  await expect(row).toBeVisible();
  await page.reload();
  await expect(row).toBeVisible();
  await row.hover();
  await page.getByRole('button', { name: 'Remove EURJPY from watchlist' }).click();
  await expect(row).toHaveCount(0);
});

test('strategy lab refuses to invent results without market data', async ({ page }) => {
  await page.goto('/');
  const panel = page.getByTestId('backtest-panel');
  await expect(panel).toBeVisible();
  await panel.getByRole('button', { name: /Run on cached real candles/ }).click();
  await expect(panel).toContainText('Market data disabled by operator', { timeout: 15_000 });
  await expect(panel).not.toContainText('Win rate');
});

test('execution-cost settings toggle is exposed and persists', async ({ page }) => {
  await page.goto('/');
  const costs = page.getByTestId('execution-costs');
  await expect(costs).toBeVisible();
  await costs.locator('summary').click();
  const spreadToggle = costs.locator('input[type="checkbox"]');
  await spreadToggle.check();
  await expect(page.evaluate(() => localStorage.getItem('apexfx.execution.settings.v1'))).resolves.toContain('"spreadFills":true');
  await page.reload();
  await page.getByTestId('execution-costs').locator('summary').click();
  await expect(page.getByTestId('execution-costs').locator('input[type="checkbox"]')).toBeChecked();
});
