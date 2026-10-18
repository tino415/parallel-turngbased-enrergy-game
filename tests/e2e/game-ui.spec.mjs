import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('main views can be opened without losing state', async ({ page }, testInfo) => {
  await expect(page.locator('#score')).toContainText('Round');
  const before = await page.locator('#score').innerText();
  await page.locator('#tableView').click();
  await expect(page.locator('#dashboard')).toBeVisible();
  await page.locator('#messagesTab').click();
  await expect(page.locator('#messagesView')).toBeVisible();
  await page.locator('#mapTab').click();
  await expect(page.locator('#mapViewport')).toBeVisible();
  expect(await page.locator('#score').innerText()).toBe(before);
  await page.screenshot({ path: testInfo.outputPath('map.png'), fullPage: true });
});

test('map controls change scale and Fit resets it', async ({ page }) => {
  // Fit defines the camera baseline on mobile (which initially starts focused).
  await page.locator('#fit').click();
  const graph = page.locator('#map > g').first();
  const initial = await graph.getAttribute('transform');
  await page.locator('#zoomIn').click();
  expect(await graph.getAttribute('transform')).not.toBe(initial);
  await page.locator('#fit').click();
  expect(await graph.getAttribute('transform')).toBe(initial);
});

test('node selection opens contextual policy controls on second click', async ({
  page,
}, testInfo) => {
  const node = page.locator('#map .node-hit[fill="#3278c8"]').first();
  await node.click();
  await expect(page.locator('#tacticalInspector')).toBeHidden();
  await expect(page.locator('#map .tactical-node-selected')).toHaveCount(1);
  await node.click();
  await expect(page.locator('#tacticalPolicyPercent')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('node-details.png') });
});

test('round state survives refresh using local save', async ({ page }) => {
  await page.locator('#uxDockResolve:visible, #resolve:visible').first().click();
  await expect(page.locator('#score')).toContainText('Round 2');
  page.on('dialog', (dialog) => dialog.accept());
  await page.reload();
  await expect(page.locator('#score')).toContainText('Round 2');
});

test('viewport has no unexpected horizontal document overflow', async ({ page }) => {
  const overflow = await page.evaluate(() => ({
    page: document.documentElement.scrollWidth,
    viewport: document.documentElement.clientWidth,
  }));
  expect(overflow.page).toBeLessThanOrEqual(overflow.viewport + 2);
});

test('mobile map captures natural touch gestures without a mode switch', async ({
  page,
}, testInfo) => {
  test.skip(!testInfo.project.name.startsWith('mobile'), 'Touch-only behavior');
  await expect(page.locator('#panMode')).toBeHidden();
  expect(
    await page.locator('#mapViewport').evaluate((el) => getComputedStyle(el).touchAction),
  ).toBe('none');
});
