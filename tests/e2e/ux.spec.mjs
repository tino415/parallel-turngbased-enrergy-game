import { test, expect } from '@playwright/test';
import { chooseSource, offsetFromVisibleMapCenter, visibleMapTop } from './support/game.mjs';

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

test('friendly edge switches direction and the new support replaces the reverse one', async ({
  page,
}) => {
  await page.evaluate(() => {
    const match = structuredClone(store.getSnapshot().match),
      { state, orders, policies } = match;
    state.nodes[1].owner = 0;
    state.nodes[1].active = 10;
    store.replaceMatch(match);
    render();
  });
  const edge = page.locator('.tactical-edge-hit[data-edge="0-1"]');
  await edge.click();
  await edge.click();
  await expect(page.locator('#tacticalSwapDirection')).toHaveAccessibleName(
    'From Node 0 to Node 1. Swap direction',
  );
  await page.locator('#tacticalEdgeAmount').fill('2');
  await page.locator('#tacticalEdgeAmount').blur();
  await chooseSource(page, 1);
  await expect(page.locator('#tacticalEdgeAmount')).toHaveValue('0');
  await expect(page.locator('#tacticalInspector')).toContainText(
    'Replaces Node 0 → 1: 2 manual support.',
  );
  await page.locator('#tacticalEdgeAmount').fill('4');
  await page.locator('#tacticalEdgeAmount').blur();
  expect(await page.evaluate(() => [orders[0]?.edges[1], orders[1].edges[0]])).toEqual([
    undefined,
    4,
  ]);
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
  const centered = await offsetFromVisibleMapCenter(
    page,
    page.locator('#map .node-hit[fill="#3278c8"]').first(),
  );
  expect(Math.abs(centered.dx)).toBeLessThan(3);
  expect(Math.abs(centered.dy)).toBeLessThan(3);
  await page.locator('#map .node-hit[fill="#3278c8"]').first().click();
  await page.keyboard.press('Escape');
  await expect(page.locator('#tacticalInspector')).toBeHidden();
});

test('simulated mobile keyboard resize does not move focused policy input', async ({
  page,
}, testInfo) => {
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

test('policy actions and this round orders show without opening a section', async ({ page }) => {
  const node = page.locator('#map .node-hit[fill="#3278c8"]').first();
  await node.click();
  await node.click();
  await expect(page.getByRole('button', { name: 'Copy policy' })).toBeVisible();
  await expect(page.locator('#tacticalInspector [data-allocation="withdraw"]')).toBeVisible();
  await expect(page.locator('#tacticalInspector [data-allocation="invest"]')).toBeVisible();
  await expect(page.locator('#tacticalInspector details')).toHaveCount(0);
  await expect(page.locator('#tacticalInspector')).toContainText('Capacity');
});

test('manual orders can be opened from the overflow Orders review', async ({ page }) => {
  const node = page.locator('#map .node-hit[fill="#3278c8"]').first();
  await node.click();
  await node.click();
  const investment = page.locator('#tacticalInspector input[data-allocation="invest"]');
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

test('planned arrows and income remain visible across selections', async ({ page }) => {
  await page.evaluate(() => {
    const match = structuredClone(store.getSnapshot().match),
      { state, orders, policies } = match;
    state.nodes[1].owner = 0;
    orders[0] = { invest: 0, withdraw: 0, edges: { 1: 4, 2: 6 } };
    orders[1] = { invest: 0, withdraw: 0, edges: { 3: 2 } };
    policies[0] = { enabled: true, reserve: 2, investPct: 0, dest: 1 };
    store.replaceMatch(match);
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
  await expect(income).toHaveCount(2);
});

test('mobile touch drag pans naturally without a Pan toggle', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith('mobile'), 'Touch-only layout');
  await expect(page.locator('#panMode')).toHaveCount(0);
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

test('compact map layout retains Settings, Orders and node groups', async ({ page }, testInfo) => {
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
  if (testInfo.project.name.startsWith('mobile')) await page.locator('#uxDockSelect').click();
  else
    await page
      .locator('#map .node-hit[fill="#3278c8"]')
      .first()
      .click({ modifiers: ['Shift'] });
  await expect(page.locator('#tacticalGroupBar')).toBeVisible();
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
  await expect(inspector.getByRole('button', { name: 'Orders', exact: true })).toHaveCount(0);
  await expect(inspector.getByRole('button', { name: 'Resolve →' })).toHaveCount(0);
  await expectLockedViewport();

  await page.locator('#messagesTab').click();
  await expect(page.locator('#messagesView')).toBeVisible();
  await expectLockedViewport();

  await resolve.click();
  await expect(page.locator('#score')).toContainText('Round 2');
  await expectLockedViewport();
});

test('a mobile editor taller than its drawer scrolls without moving the map', async ({
  page,
}, testInfo) => {
  test.skip(!testInfo.project.name.startsWith('mobile'), 'Mobile drawer layout');
  const viewport = page.viewportSize();
  await page.setViewportSize({ width: viewport.width, height: viewport.height - 200 });
  const node = page.locator('#map .node-hit[fill="#3278c8"]').first();
  await node.tap();
  await node.tap();
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
  await expect(
    page.locator('#tacticalInspector button').filter({ hasText: 'Create policy' }),
  ).toHaveCount(0);
  await expect(page.getByRole('spinbutton', { name: 'Defense floor' })).toHaveValue('5');
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

for (const [source, destination] of [
  [0, 1],
  [1, 0],
]) {
  test(`existing surplus transfer ${source} → ${destination} opens checked in saved direction`, async ({
    page,
  }) => {
    await page.evaluate(
      ({ source, destination }) => {
        const match = structuredClone(store.getSnapshot().match),
          { state, orders, policies } = match;
        state.nodes[1].owner = 0;
        state.nodes[source].active = 20;
        policies[source] = {
          enabled: true,
          reserve: 5,
          investPct: 50,
          dest: destination,
        };
        store.replaceMatch(match);
        render();
      },
      { source, destination },
    );

    const edge = page.locator('.tactical-edge-hit[data-edge="0-1"]');
    await edge.click();
    await expect(page.locator('#tacticalInspector')).toBeHidden();
    await edge.click();

    const inspector = page.locator('#tacticalInspector');
    await expect(inspector).toBeVisible();
    await expect(inspector.locator('#tacticalSwapDirection')).toHaveAttribute(
      'aria-label',
      `From Node ${source} to Node ${destination}. Swap direction`,
    );
    await expect(inspector.locator('#tacticalAutoTransfer')).toBeChecked();
    await expect(inspector.locator('#tacticalAutoTransfer')).toHaveAccessibleName(
      `Automatically send remaining surplus to Node ${destination} each round`,
    );
    await expect(inspector.locator('.tactical-row-note')).toHaveText(/ next round$/);

    // Switching direction must reflect that direction's actual policy without
    // modifying or removing the policy for the opposite source.
    const reverse = destination;
    await chooseSource(page, reverse);
    await expect(inspector.locator('#tacticalAutoTransfer')).not.toBeChecked();
    expect(await page.evaluate((id) => policies[id].dest, source)).toBe(destination);

    await chooseSource(page, source);
    await expect(inspector.locator('#tacticalAutoTransfer')).toBeChecked();
    await inspector.getByRole('button', { name: 'Clear map selection' }).click();
    await edge.click();
    await edge.click();
    await expect(page.locator('#tacticalInspector #tacticalAutoTransfer')).toBeChecked();
  });
}

test('connection editor sets recurring support policy directly using default source values', async ({
  page,
}) => {
  await page.evaluate(() => {
    const match = structuredClone(store.getSnapshot().match),
      { state, orders, policies } = match;
    state.nodes[1].owner = 0;
    store.replaceMatch(match);
    render();
  });
  const edge = page.locator('.tactical-edge-hit[data-edge="0-1"]');
  await edge.click();
  await edge.click();
  await expect(page.locator('#tacticalAutoTransfer')).toBeVisible();
  await expect(page.locator('#tacticalAutoTransfer')).toHaveAccessibleName(
    'Automatically send remaining surplus to Node 1 each round',
  );
  expect(await page.evaluate(() => policies[0])).toBeUndefined();
  await page.locator('#tacticalAutoTransfer').check();
  expect(await page.evaluate(() => policies[0])).toEqual({
    enabled: true,
    reserve: 5,
    investPct: 50,
    dest: 1,
  });
  await expect(page.locator('#tacticalSupportInvestPct')).toHaveCount(0);
  await expect(page.locator('#tacticalInspector')).toContainText('its 50% investment');
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
  await expect(page.locator('#tacticalInspector')).toBeHidden();
  await page.locator('#map .node-hit[fill="#3278c8"]').first().click();
  await expect(page.locator('#tacticalInspector')).toBeVisible();
  if (testInfo.project.name.startsWith('mobile')) {
    await expect(page.locator('.ux-dock')).toBeVisible();
    await expect(page.locator('#uxDockResolve')).toBeVisible();
  }
  await page.locator('#tacticalMenu summary').click();
  await page.locator('#tacticalMenu button').filter({ hasText: 'Orders' }).click();
  await expect(page.locator('#uxOrdersDialog')).toBeVisible();
  await expect(page.locator('#tacticalInspector')).toBeHidden();
  await page.locator('#uxOrdersDialog .ux-dialog-close').click();
  // Opening Orders from outside the editor intentionally clears selection.
  // Closing Orders must not resurrect a hidden inspector.
  await expect(page.locator('#tacticalInspector')).toBeHidden();
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
  await expect(inspector.getByRole('button', { name: 'Orders', exact: true })).toHaveCount(0);
  await expect(inspector.getByRole('button', { name: 'Collapse' })).toHaveCount(0);

  // Tapping blank map space dismisses; the dock remains untouched.
  const box = await page.locator('#map').boundingBox();
  await page.mouse.click(box.x + box.width * 0.13, (await visibleMapTop(page)) + 8);
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

test.describe('node editor stays usable when node ownership changes', () => {
  const nodeOnMap = (page, id) => page.locator('#map .node-hit').nth(id);
  const nodeOwnedBy = (page, owner) =>
    page.evaluate((owner) => state.nodes.find((node) => node.owner === owner).id, owner);

  async function openEditor(page, id) {
    await page.locator('#fit').click();
    await nodeOnMap(page, id).click();
    await nodeOnMap(page, id).click();
    await expect(page.locator('#tacticalInspector')).toContainText('Node ' + id);
  }

  async function closeEditor(page) {
    await page.getByRole('button', { name: 'Clear map selection' }).click();
  }

  async function expectAllocatorUsableOnBlueNode(page, errors) {
    expect(errors).toEqual([]);
    await openEditor(page, await nodeOwnedBy(page, 0));
    await expect(page.locator('#tacticalInspector [data-allocation="invest"]')).toBeVisible();
    await expect(page.getByRole('spinbutton', { name: 'Defense floor' })).toBeVisible();
    expect(errors).toEqual([]);
  }

  test('when the edited node is captured on resolve', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const edited = await nodeOwnedBy(page, 0);
    const opponentStart = await nodeOwnedBy(page, 1);
    await openEditor(page, edited);
    await page.evaluate(
      ([edited, opponentStart]) => {
        const match = structuredClone(store.getSnapshot().match),
          { state, orders, policies } = match;
        state.nodes[edited].owner = 1;
        state.nodes[opponentStart].owner = 0;
        store.replaceMatch(match);
      },
      [edited, opponentStart],
    );
    await page.locator('#uxDockResolve:visible, #resolve:visible').first().click();
    await expect(page.locator('#score')).toContainText('Round 2');
    await openEditor(page, edited);
    await closeEditor(page);
    await expectAllocatorUsableOnBlueNode(page, errors);
  });

  test('when an opponent node is opened after closing the editor', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await openEditor(page, await nodeOwnedBy(page, 0));
    await closeEditor(page);
    await openEditor(page, await nodeOwnedBy(page, 1));
    await closeEditor(page);
    await expectAllocatorUsableOnBlueNode(page, errors);
  });
});
