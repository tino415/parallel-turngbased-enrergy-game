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

test('planned arrows and income stay visible across selections', async ({ page }) => {
  await expect(page.locator('#overlay')).toHaveValue('all');

  // Construct adjacent friendly nodes and both manual and automatic transfer
  // orders in the browser. UI rendering remains the unit under test.
  await page.evaluate(() => {
    state.nodes[1].owner = 0;
    orders[0] = { invest: 0, edges: { 1: 4, 2: 6 } };
    orders[1] = { invest: 0, edges: { 3: 2 } };
    policies[0] = { enabled: true, reserve: 2, investPct: 0, dest: 1 };
    render();
  });

  const attacks = page.locator('#map > g > line[stroke="#ff987f"]');
  const manualSupport = page.locator('#map > g > line[stroke="#63d9af"]');
  const policySupport = page.locator('#map > g > line[stroke="#76b3ff"]');
  const earnings = page.locator('#map > g > text.ux-income-label');

  await expect(attacks).toHaveCount(2);
  await expect(manualSupport).toHaveCount(1);
  await expect(policySupport).toHaveCount(1);
  await expect(earnings).toHaveCount(2);
  await expect(earnings.first()).toContainText('+');

  await page.locator('#fit').click();
  await page.locator('#map .node-hit[fill="#768092"]').first().click();
  await expect(page.locator('#nodeDialog')).toBeVisible();
  await page.locator('#closeNodeDialog').click();

  // Selecting another node should never hide other nodes' active orders.
  await expect(attacks).toHaveCount(2);
  await expect(manualSupport).toHaveCount(1);
  await expect(policySupport).toHaveCount(1);
  await expect(earnings).toHaveCount(2);

  await page.locator('#overlay').selectOption('manual');
  await expect(attacks).toHaveCount(2);
  await expect(manualSupport).toHaveCount(1);
  await expect(policySupport).toHaveCount(0);

  await page.locator('#overlay').selectOption('policy');
  await expect(attacks).toHaveCount(0);
  await expect(manualSupport).toHaveCount(0);
  await expect(policySupport).toHaveCount(1);

  await page.locator('#overlay').selectOption('none');
  await expect(attacks).toHaveCount(0);
  await expect(manualSupport).toHaveCount(0);
  await expect(policySupport).toHaveCount(0);
  await expect(earnings).toHaveCount(2);

  await page.locator('#overlay').selectOption('all');
  await expect(attacks).toHaveCount(2);
  await expect(manualSupport).toHaveCount(1);
  await expect(policySupport).toHaveCount(1);
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
