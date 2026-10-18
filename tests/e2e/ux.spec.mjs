import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('selected friendly node opens full-screen editor with live budget', async ({
  page,
}, testInfo) => {
  await page.locator('#map .node-hit[fill="#3278c8"]').first().click();
  await expect(page.locator('#nodeDialog')).toBeVisible();
  await expect(page.locator('#uxEditorStats')).toContainText('Active');
  await expect(page.locator('#uxBalance')).toContainText('Defense');
  await expect(page.locator('#uxManualSection input[type="number"]').first()).toBeVisible();
  await expect(page.locator('#uxPolicySection')).toBeVisible();
  if (testInfo.project.name.startsWith('mobile')) {
    const bounds = await page.locator('#nodeDialog').boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds.width).toBeGreaterThan(340);
    expect(bounds.y).toBeLessThanOrEqual(2);
  }
  await page.locator('#closeNodeDialog').click();
  await expect(page.locator('#nodeDialog')).toBeHidden();
});

test('manual orders can be edited from the separate orders dialog', async ({ page }) => {
  await page.locator('#map .node-hit[fill="#3278c8"]').first().click();
  await page.locator('#allocator input[type="number"]').first().fill('2');
  await page.locator('#allocator input[type="number"]').first().dispatchEvent('change');
  await page.locator('#closeNodeDialog').click();
  const ordersButton = page.locator('#uxReviewHead');
  await ordersButton.click();
  await expect(page.locator('#uxOrdersDialog')).toBeVisible();
  await expect(page.locator('#uxOrdersDialog')).toContainText('Invest 2.0');
  await page.locator('#uxOrdersDialog .order-top button:first-child').first().click();
  await expect(page.locator('#nodeDialog')).toBeVisible();
  await expect(page.locator('#uxOrdersDialog')).toBeHidden();
});

test('map and settings expose separate controls on mobile', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith('mobile'), 'Mobile layout only');
  await expect(page.locator('#uxDockOrders')).toBeVisible();
  await expect(page.locator('#focusMap')).toBeVisible();
  await expect(page.locator('#overlay')).toBeVisible();
  const navBox = await page.locator('#fit').boundingBox();
  const dockBox = await page.locator('.ux-dock').boundingBox();
  expect(navBox).not.toBeNull();
  expect(dockBox).not.toBeNull();
  expect(navBox.y + navBox.height).toBeLessThan(dockBox.y);
  await page.locator('#mobileSettings').click();
  await expect(page.locator('#uxSettingsDialog')).toBeVisible();
  await expect(page.locator('#uxSettingsDialog #autoConquer')).toBeVisible();
  await expect(page.locator('#uxSettingsDialog')).toContainText('New game');
  await page.locator('#uxSettingsDialog .ux-dialog-close').click();
});

test('dashboard has node cards on mobile and does not change game round', async ({
  page,
}, testInfo) => {
  const roundBefore = await page.locator('#score').innerText();
  await page.locator('#tableView').click();
  await expect(page.locator('#dashboard')).toBeVisible();
  if (testInfo.project.name.startsWith('mobile')) {
    await expect(page.locator('#dashboard .ux-node-cards .ux-node-card').first()).toBeVisible();
  } else {
    await expect(page.locator('#dashboard table')).toBeVisible();
  }
  await page.locator('#mapTab').click();
  expect(await page.locator('#score').innerText()).toBe(roundBefore);
});
