import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('node selection previews first and edits policy on second selection', async ({
  page,
}, testInfo) => {
  const node = page.locator('#map .node-hit[fill="#3278c8"]').first();
  await node.click();
  const inspector = page.locator('#tacticalInspector');
  await expect(inspector).toBeVisible();
  await expect(inspector).toContainText('Node 0');
  await expect(inspector).toContainText('Policy');
  await expect(inspector).not.toHaveClass(/is-editing/);
  await expect(page.locator('#map .tactical-node-selected')).toHaveCount(1);
  await expect(page.locator('#nodeDialog')).toBeHidden();

  await node.click();
  await expect(inspector).toHaveClass(/is-editing/);
  await expect(page.locator('#tacticalPolicyPercent')).toBeVisible();
  await page.locator('#tacticalPolicyPercent').fill('73');
  await page.locator('#tacticalPolicyPercent').blur();
  expect(await page.evaluate(() => policies[0].investPct)).toBe(73);
  expect(await page.evaluate(() => policies[0].enabled)).toBe(true);

  if (testInfo.project.name.startsWith('mobile')) {
    const map = await page.locator('#mapViewport').boundingBox();
    const drawer = await inspector.boundingBox();
    expect(map).not.toBeNull();
    expect(drawer).not.toBeNull();
    expect(drawer.y).toBeGreaterThan(map.y + 90);
  }
  await inspector.getByRole('button', { name: 'Collapse' }).click();
  await expect(inspector).not.toHaveClass(/is-editing/);
});

test('edge selection previews first and edits amount on second selection', async ({ page }) => {
  await page.locator('#fit').click();
  const edge = page.locator('.tactical-edge-hit[data-edge="0-1"]');
  await edge.click();
  await expect(page.locator('#tacticalInspector')).toContainText('Connection 0 — 1');
  await expect(page.locator('#tacticalInspector')).not.toHaveClass(/is-editing/);
  await expect(page.locator('#map .tactical-node-selected')).toHaveCount(2);
  await edge.click();
  await expect(page.locator('#tacticalEdgeAmount')).toBeVisible();
  await page.locator('#tacticalEdgeAmount').fill('3.5');
  await page.locator('#tacticalEdgeAmount').blur();
  expect(await page.evaluate(() => orders[0].edges[1])).toBe(3.5);
  await expect(page.locator('#tacticalInspector')).toContainText('Attack');

  // Keep the map reachable by collapsing the drawer and fitting the next edge.
  await page.locator('#tacticalInspector').getByRole('button', { name: 'Collapse' }).click();
  await page.locator('#fit').click();
  const next = page.locator('.tactical-edge-hit[data-edge="0-2"]');
  await next.click();
  await expect(page.locator('#tacticalInspector')).not.toHaveClass(/is-editing/);
  expect(await page.evaluate(() => orders[0].edges[1])).toBe(3.5);
});

test('friendly edge permits both transfer directions without overwriting', async ({ page }) => {
  await page.evaluate(() => {
    state.nodes[1].owner = 0;
    render();
  });
  const edge = page.locator('.tactical-edge-hit[data-edge="0-1"]');
  await edge.click();
  await edge.click();
  await expect(page.locator('#tacticalInspector')).toContainText('Support transfer');
  await page.locator('#tacticalEdgeAmount').fill('2');
  await page.locator('#tacticalEdgeAmount').blur();
  await page.locator('#tacticalInspector select').selectOption('1');
  await expect(page.locator('#tacticalEdgeAmount')).toHaveValue('0');
  await page.locator('#tacticalEdgeAmount').fill('4');
  await page.locator('#tacticalEdgeAmount').blur();
  expect(await page.evaluate(() => [orders[0].edges[1], orders[1].edges[0]])).toEqual([2, 4]);
});

test('closing selection keeps Focus on the last inspected node', async ({ page }) => {
  await page.locator('#fit').click();
  await page.locator('#map .node-hit[fill="#3278c8"]').first().click();
  await page.locator('#tacticalInspector [aria-label="Clear map selection"]').click();
  await expect(page.locator('#tacticalInspector')).toBeHidden();
  expect(await page.evaluate(() => selected)).toBeNull();
  await page.locator('#focusMap').click();
  const centered = await page.evaluate(() => {
    const svg = document.getElementById('map').viewBox.baseVal;
    return {
      dx: camera.x + xy[0][0] * camera.scale - svg.width / 2,
      dy: camera.y + xy[0][1] * camera.scale - svg.height / 2,
    };
  });
  expect(Math.abs(centered.dx)).toBeLessThan(2);
  expect(Math.abs(centered.dy)).toBeLessThan(2);
  await page.locator('#map .node-hit[fill="#3278c8"]').first().click();
  await page.keyboard.press('Escape');
  await expect(page.locator('#tacticalInspector')).toBeHidden();
});

test('mobile keyboard resize does not move focused policy input', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith('mobile'), 'Mobile keyboard regression');
  const node = page.locator('#map .node-hit[fill="#3278c8"]').first();
  await node.tap();
  await node.tap();
  const input = page.locator('#tacticalPolicyPercent');
  await input.tap();
  await expect(input).toBeFocused();
  const viewport = page.viewportSize();
  await page.setViewportSize({ width: viewport.width, height: viewport.height - 200 });
  await expect(input).toBeFocused();
  await input.fill('62');
  await page.evaluate(() => window.dispatchEvent(new Event('resize')));
  await expect(input).toBeFocused();
  await expect(input).toHaveValue('62');
});

test('legacy policy and withdrawal editors remain accessible', async ({ page }) => {
  const node = page.locator('#map .node-hit[fill="#3278c8"]').first();
  await node.click();
  await node.click();
  await page.getByText('Other policy settings').click();
  await expect(page.locator('#uxPolicySection button').first()).toBeVisible();
  await page.getByText('Manual investment, withdrawal and allocations').click();
  await expect(page.locator('#uxManualSection [data-allocation="withdraw"]')).toBeVisible();
  await expect(page.locator('#uxManualSection [data-allocation="invest"]')).toBeVisible();
  await expect(page.locator('#tacticalInspector')).toContainText('Capacity');
});

test('manual orders can be opened from the overflow Orders review', async ({ page }) => {
  const node = page.locator('#map .node-hit[fill="#3278c8"]').first();
  await node.click();
  await node.click();
  await page.getByText('Manual investment, withdrawal and allocations').click();
  const investment = page.locator('#allocator input[data-allocation="invest"]');
  await investment.fill('2');
  await investment.blur();
  await page.locator('#tacticalMenu summary').click();
  await page.locator('#tacticalMenu button').filter({ hasText: 'Orders' }).click();
  await expect(page.locator('#uxOrdersDialog')).toBeVisible();
  await expect(page.locator('#uxOrdersDialog')).toContainText('Invest 2.0');
  await page.locator('#uxOrdersDialog .order-top button:first-child').first().click();
  await expect(page.locator('#uxOrdersDialog')).toBeHidden();
  await expect(page.locator('#tacticalInspector')).toHaveClass(/is-editing/);
});

test('planned arrows and income remain visible across selections and filters', async ({ page }) => {
  await page.evaluate(() => {
    state.nodes[1].owner = 0;
    orders[0] = { invest: 0, withdraw: 0, edges: { 1: 4, 2: 6 } };
    orders[1] = { invest: 0, withdraw: 0, edges: { 3: 2 } };
    policies[0] = { enabled: true, reserve: 2, investPct: 0, dest: 1 };
    render();
  });
  const attacks = page.locator('#map > g > line[stroke="#ff987f"]');
  const support = page.locator('#map > g > line[stroke="#63d9af"]');
  const policy = page.locator('#map > g > line[stroke="#76b3ff"]');
  const income = page.locator('#map > g > text.ux-income-label');
  await expect(attacks).toHaveCount(2);
  await expect(support).toHaveCount(1);
  await expect(policy).toHaveCount(1);
  await expect(income).toHaveCount(2);
  await page.locator('#map .node-hit[fill="#3278c8"]').first().click();
  await expect(attacks).toHaveCount(2);
  await page.locator('#overlay').selectOption('manual');
  await expect(policy).toHaveCount(0);
  await page.locator('#overlay').selectOption('none');
  await expect(income).toHaveCount(2);
});

test('mobile touch drag pans naturally without a Pan toggle', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith('mobile'), 'Touch-only layout');
  await expect(page.locator('#panMode')).toBeHidden();
  expect(
    await page.locator('#mapViewport').evaluate((el) => getComputedStyle(el).touchAction),
  ).toBe('none');
  const node = page.locator('#map .node-hit[fill="#3278c8"]').first();
  const box = await node.boundingBox();
  expect(box).not.toBeNull();
  const before = await page.locator('#map > g').getAttribute('transform');
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ x: x + 35, y: y + 28 }],
  });
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ x: x + 60, y: y + 40 }],
  });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
  await expect(page.locator('#map > g')).not.toHaveAttribute('transform', before);
  await expect(page.locator('#tacticalInspector')).toBeHidden();
});

test('compact map layout retains Settings, Orders and Dashboard', async ({ page }, testInfo) => {
  await expect(page.locator('#gameSidebar')).toBeHidden();
  await expect(page.locator('#score')).toBeVisible();
  await expect(page.locator('#resolve')).toBeVisible();
  await page.locator('#tacticalMenu summary').click();
  await page.locator('#tacticalMenu button').filter({ hasText: 'Settings' }).click();
  await expect(page.locator('#uxSettingsDialog #autoConquer')).toBeVisible();
  await page.locator('#uxSettingsDialog .ux-dialog-close').click();
  await page.locator('#tableView').click();
  await expect(page.locator('#dashboard')).toBeVisible();
  if (testInfo.project.name.startsWith('mobile')) {
    await expect(page.locator('#dashboard .ux-node-cards .ux-node-card').first()).toBeVisible();
  } else {
    await expect(page.locator('#dashboard table')).toBeVisible();
  }
});
