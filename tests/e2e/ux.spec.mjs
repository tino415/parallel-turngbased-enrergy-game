import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('node tap highlights only and opens policy editor on second selection', async ({
  page,
}, testInfo) => {
  const node = page.locator('#map .node-hit[fill="#3278c8"]').first();
  await node.click();
  const inspector = page.locator('#tacticalInspector');
  await expect(inspector).toBeHidden();
  await expect(page.locator('#map .tactical-node-selected')).toHaveCount(1);
  await expect(page.locator('#nodeDialog')).toBeHidden();
  await node.click();
  await expect(inspector).toBeVisible();
  await expect(inspector).toContainText('Node 0');
  await expect(inspector).toContainText('Policy');
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
  await inspector.getByRole('button', { name: 'Clear map selection' }).click();
  await expect(inspector).toBeHidden();
  await expect(page.locator('#map .tactical-node-selected')).toHaveCount(0);
});

test('edge selection highlights only then edits amount on second selection', async ({ page }) => {
  await page.locator('#fit').click();
  const edge = page.locator('.tactical-edge-hit[data-edge="0-1"]');
  await edge.click();
  await expect(page.locator('#tacticalInspector')).toBeHidden();
  await expect(page.locator('#map .tactical-node-selected')).toHaveCount(2);
  await edge.click();
  await expect(page.locator('#tacticalInspector')).toContainText('Connection 0 — 1');
  await expect(page.locator('#tacticalEdgeAmount')).toBeVisible();
  await page.locator('#tacticalEdgeAmount').fill('3.5');
  await page.locator('#tacticalEdgeAmount').blur();
  expect(await page.evaluate(() => orders[0].edges[1])).toBe(3.5);
  await expect(page.locator('#tacticalInspector')).toContainText('Attack');

  // The map stays reachable after the inspector is dismissed.
  await page
    .locator('#tacticalInspector')
    .getByRole('button', { name: 'Clear map selection' })
    .click();
  await page.locator('#fit').click();
  const next = page.locator('.tactical-edge-hit[data-edge="0-2"]');
  await next.click();
  await expect(page.locator('#tacticalInspector')).toBeHidden();
  await expect(page.locator('#map .tactical-node-selected')).toHaveCount(2);
  expect(await page.evaluate(() => orders[0].edges[1])).toBe(3.5);
});

test('friendly edge permits both transfer directions without overwriting', async ({ page }) => {
  await page.evaluate(() => {
    state.nodes[1].owner = 0;
    state.nodes[1].active = 10;
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
  await expect(page.locator('#tacticalInspector')).toBeHidden();
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
  const styled = page.locator('#map > g > line.tactical-flow-connection');
  const income = page.locator('#map > g > text.ux-income-label');
  await expect(styled).toHaveCount(3);
  await expect(page.locator('#map > g > line.ux-flow-overlay')).toHaveCount(0);
  // Manual + policy support on the same connection has one shared stroke,
  // but retains directional arrowheads/energy labels.
  await expect(page.locator('#map > g > path.ux-flow-overlay')).toHaveCount(4);
  await expect(income).toHaveCount(2);
  await page.locator('#map .node-hit[fill="#3278c8"]').first().click();
  await expect(styled).toHaveCount(3);
  await page.locator('#overlay').selectOption('manual');
  await expect(styled).toHaveCount(3);
  await page.locator('#overlay').selectOption('policy');
  await expect(styled).toHaveCount(1);
  await page.locator('#overlay').selectOption('none');
  await expect(styled).toHaveCount(0);
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

test('two-finger pinch zooms the map without switching modes', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith('mobile'), 'Mobile pinch gesture');
  await page.locator('#fit').click();
  const previousScale = await page.evaluate(() => camera.scale);
  const box = await page.locator('#map').boundingBox();
  expect(box).not.toBeNull();
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [
      { x: x - 30, y },
      { x: x + 30, y },
    ],
  });
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [
      { x: x - 65, y },
      { x: x + 65, y },
    ],
  });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
  await expect.poll(() => page.evaluate(() => camera.scale)).toBeGreaterThan(previousScale);
});

test('compact map layout retains Settings, Orders and Dashboard', async ({ page }, testInfo) => {
  await expect(page.locator('#gameSidebar')).toBeHidden();
  await expect(page.locator('#score')).toBeVisible();
  if (testInfo.project.name.startsWith('mobile')) {
    await expect(page.locator('#resolve')).toBeHidden();
    await expect(page.locator('#uxDockResolve')).toBeVisible();
  } else {
    await expect(page.locator('#resolve')).toBeVisible();
  }
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

test('mobile bottom actions stay reachable and the page itself never scrolls', async ({
  page,
}, testInfo) => {
  test.skip(!testInfo.project.name.startsWith('mobile'), 'Mobile viewport layout');

  const dock = page.locator('.ux-dock');
  const resolve = page.locator('#uxDockResolve');
  const viewport = page.locator('#mapViewport');
  const inspector = page.locator('#tacticalInspector');

  await expect(resolve).toBeVisible();
  await expect(page.locator('#resolve')).toBeHidden();

  async function expectLockedViewport() {
    const metrics = await page.evaluate(() => {
      window.scrollTo(0, 250);
      return {
        scrollTop: window.scrollY,
        docHeight: document.documentElement.scrollHeight,
        screenHeight: window.innerHeight,
        bodyHeight: document.body.scrollHeight,
      };
    });
    expect(metrics.scrollTop).toBe(0);
    expect(metrics.docHeight).toBeLessThanOrEqual(metrics.screenHeight + 2);
    expect(metrics.bodyHeight).toBeLessThanOrEqual(metrics.screenHeight + 2);
  }

  const dockBox = await dock.boundingBox();
  const mapBox = await viewport.boundingBox();
  expect(dockBox).not.toBeNull();
  expect(mapBox).not.toBeNull();
  expect(dockBox.y).toBeGreaterThan(page.viewportSize().height / 2);
  expect(mapBox.y + mapBox.height).toBeLessThanOrEqual(dockBox.y + 2);
  await expectLockedViewport();

  const node = page.locator('#map .node-hit[fill="#3278c8"]').first();
  await node.tap();
  await expect(inspector).toBeHidden();
  await expect(resolve).toBeVisible();
  await expectLockedViewport();
  await node.tap();
  await expect(inspector).toBeVisible();
  await expect(dock).toBeVisible();
  await expect(resolve).toBeVisible();
  expect(await inspector.evaluate((el) => el.parentElement === document.body)).toBe(true);
  expect(await inspector.evaluate((el) => getComputedStyle(el).position)).toBe('fixed');
  const inspectorBox = await inspector.boundingBox();
  const dockAfter = await dock.boundingBox();
  expect(inspectorBox.y + inspectorBox.height).toBeLessThanOrEqual(dockAfter.y + 2);
  const closeBox = await inspector
    .getByRole('button', { name: 'Clear map selection' })
    .boundingBox();
  expect(closeBox.width).toBeLessThanOrEqual(45);
  expect(closeBox.height).toBeLessThanOrEqual(45);
  await expect(inspector.getByRole('button', { name: 'Orders' })).toHaveCount(0);
  await expect(inspector.getByRole('button', { name: 'Resolve →' })).toHaveCount(0);
  await expectLockedViewport();

  await page.locator('#tableView').click();
  await expect(page.locator('#dashboard')).toBeVisible();
  await expectLockedViewport();
  await page.locator('#messagesTab').click();
  await expect(page.locator('#messagesView')).toBeVisible();
  await expectLockedViewport();

  await resolve.click();
  await expect(page.locator('#score')).toContainText('Round 2');
  await expectLockedViewport();
});

test('mobile editor keeps its own scrolling without moving the map', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith('mobile'), 'Mobile drawer layout');
  const node = page.locator('#map .node-hit[fill="#3278c8"]').first();
  await node.tap();
  await node.tap();
  await page.getByText('Other policy settings').click();
  await page.getByText('Manual investment, withdrawal and allocations').click();
  const body = page.locator('#tacticalInspector .tactical-inspector-body');
  await expect(body).toBeVisible();
  const overflow = await body.evaluate((el) => ({
    contentHeight: el.scrollHeight,
    visibleHeight: el.clientHeight,
    overflow: getComputedStyle(el).overflowY,
  }));
  expect(overflow.overflow).toBe('auto');
  expect(overflow.contentHeight).toBeGreaterThan(overflow.visibleHeight);
  await body.evaluate((el) => {
    el.scrollTop = 180;
  });
  await expect.poll(() => body.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
});

test('source node exposes default policy without any Create policy button', async ({ page }) => {
  expect(await page.evaluate(() => policies[0])).toBeUndefined();
  const node = page.locator('#map .node-hit[fill="#3278c8"]').first();
  await node.click();
  await node.click();
  await expect(page.locator('#tacticalPolicyPercent')).toHaveValue('50');
  await page.getByText('Other policy settings').click();
  await expect(
    page.locator('#policyEditor button').filter({ hasText: 'Create policy' }),
  ).toHaveCount(0);
  await expect(page.locator('#policyEditor input[type="number"]').first()).toHaveValue('5');
  expect(await page.evaluate(() => policies[0])).toBeUndefined();
  await page.locator('#tacticalPolicyPercent').fill('42');
  await page.locator('#tacticalPolicyPercent').blur();
  expect(await page.evaluate(() => policies[0])).toMatchObject({
    enabled: true,
    reserve: 5,
    investPct: 42,
    dest: null,
  });
});

test('connection editor sets recurring support policy directly using default source values', async ({
  page,
}) => {
  await page.evaluate(() => {
    state.nodes[1].owner = 0;
    render();
  });
  const edge = page.locator('.tactical-edge-hit[data-edge="0-1"]');
  await edge.click();
  await edge.click();
  await expect(page.locator('#tacticalAutoTransfer')).toBeVisible();
  await expect(page.locator('#tacticalInspector')).toContainText('Send remaining surplus to Node 1 each round');
  expect(await page.evaluate(() => policies[0])).toBeUndefined();
  await page.locator('#tacticalAutoTransfer').check();
  expect(await page.evaluate(() => policies[0])).toEqual({
    enabled: true,
    reserve: 5,
    investPct: 50,
    dest: 1,
  });
  await expect(page.locator('#tacticalSupportInvestPct')).toHaveCount(0);
  await expect(page.locator('#tacticalInspector')).toContainText('invest 50% of surplus');
  const preview = await page.evaluate(() =>
    previewOrders().find(
      (o) => o.automatic && o.type === 'transfer' && o.source === 0 && o.dest === 1,
    ),
  );
  expect(preview?.amount).toBeGreaterThan(0);
  await page.locator('#tacticalAutoTransfer').uncheck();
  expect(await page.evaluate(() => policies[0])).toMatchObject({
    enabled: true,
    reserve: 5,
    investPct: 50,
    dest: null,
  });
});

test('Orders dialog replaces the contextual inspector instead of stacking modals', async ({
  page,
}, testInfo) => {
  await page.locator('#map .node-hit[fill="#3278c8"]').first().click();
  await expect(page.locator('#nodeDialog')).toBeHidden();
  await expect(page.locator('#tacticalInspector')).toBeHidden();
  await page.locator('#map .node-hit[fill="#3278c8"]').first().click();
  await expect(page.locator('#tacticalInspector')).toBeVisible();
  if (testInfo.project.name.startsWith('mobile')) {
    await expect(page.locator('.ux-dock')).toBeVisible();
    await expect(page.locator('#uxDockResolve')).toBeVisible();
    await page.locator('#uxDockOrders').click();
  } else {
    await page.locator('#tacticalMenu summary').click();
    await page.locator('#tacticalMenu button').filter({ hasText: 'Orders' }).click();
  }
  await expect(page.locator('#uxOrdersDialog')).toBeVisible();
  await expect(page.locator('#tacticalInspector')).toBeHidden();
  await page.locator('#uxOrdersDialog .ux-dialog-close').click();
  // Opening Orders from outside the editor intentionally clears selection.
  // Closing Orders must not resurrect a hidden inspector.
  await expect(page.locator('#tacticalInspector')).toBeHidden();
  await expect(page.locator('#nodeDialog')).toBeHidden();
});

test('mobile connection editor keeps original dock and closes on outside map tap', async ({
  page,
}, testInfo) => {
  test.skip(!testInfo.project.name.startsWith('mobile'), 'Mobile-only regression');
  const dock = page.locator('.ux-dock');
  const inspector = page.locator('#tacticalInspector');
  const edge = page.locator('.tactical-edge-hit[data-edge="0-1"]');

  await edge.tap();
  await expect(inspector).toBeHidden();
  await expect(page.locator('#uxDockResolve')).toBeVisible();
  await edge.tap();
  await expect(inspector).toBeVisible();
  await expect(page.locator('#uxDockResolve')).toBeVisible();
  await expect(page.locator('#uxDockOrders')).toBeVisible();
  await expect(page.locator('#nodeDialog')).toBeHidden();
  await expect(inspector.locator('.tactical-inspector-body')).toBeVisible();

  const layout = await page.evaluate(() => {
    const dock = document.querySelector('.ux-dock').getBoundingClientRect();
    const inspector = document.querySelector('#tacticalInspector').getBoundingClientRect();
    return {
      overlap: inspector.bottom - dock.top,
      parent: document.querySelector('#tacticalInspector').parentElement.tagName,
    };
  });
  expect(layout.parent).toBe('BODY');
  expect(layout.overlap).toBeLessThanOrEqual(2);
  await expect(inspector.getByRole('button', { name: 'Resolve →' })).toHaveCount(0);
  await expect(inspector.getByRole('button', { name: 'Orders' })).toHaveCount(0);
  await expect(inspector.getByRole('button', { name: 'Collapse' })).toHaveCount(0);

  // Tapping blank map space dismisses; the dock remains untouched.
  const box = await page.locator('#map').boundingBox();
  await page.mouse.click(box.x + box.width * 0.13, box.y + 8);
  await expect(inspector).toBeHidden();
  await expect(dock).toBeVisible();
  await expect(page.locator('#uxDockResolve')).toBeVisible();
});

test('clicking toolbar outside a desktop editor dismisses selection', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Desktop modal dismissal');
  const node = page.locator('#map .node-hit[fill="#3278c8"]').first();
  await node.click();
  await node.click();
  await expect(page.locator('#tacticalInspector')).toBeVisible();
  await page.locator('#score').click();
  await expect(page.locator('#tacticalInspector')).toBeHidden();
  expect(await page.evaluate(() => selected)).toBeNull();
});
