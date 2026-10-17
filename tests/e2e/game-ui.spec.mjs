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
  const graph = page.locator('#map > g').first();
  const initial = await graph.getAttribute('transform');
  await page.locator('#zoomIn').click();
  expect(await graph.getAttribute('transform')).not.toBe(initial);
  await page.locator('#fit').click();
  expect(await graph.getAttribute('transform')).toBe(initial);
});

test('node selection exposes editable allocations', async ({ page }, testInfo) => {
  await page.locator('#map .node-hit[fill="#3278c8"]').first().click();
  if (testInfo.project.name.startsWith('mobile')) {
    await expect(page.locator('#nodeDialog')).toBeVisible();
    await expect(page.locator('#mobileNodeContent input[type="number"]').first()).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('node-details.png') });
    await page.locator('#closeNodeDialog').click();
  } else {
    await expect(page.locator('#allocator input[type="number"]').first()).toBeVisible();
  }
});

test('round state survives refresh using local save', async ({ page }) => {
  await page.locator('#resolve').click();
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

test('mobile scrolling and map pan are explicit modes', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith('mobile'), 'Touch-only behavior');
  const viewport = page.locator('#mapViewport');
  await expect(page.locator('#panMode')).toHaveAttribute('aria-pressed', 'false');
  await page.locator('#panMode').click();
  await expect(page.locator('#panMode')).toHaveAttribute('aria-pressed', 'true');
  expect(await viewport.evaluate((el) => getComputedStyle(el).touchAction)).toBe('none');
  await page.locator('#panMode').click();
  expect(await viewport.evaluate((el) => getComputedStyle(el).touchAction)).not.toBe('none');
});
