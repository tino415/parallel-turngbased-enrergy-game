import { test, expect, inspector, edgeHit } from './support/game.mjs';

const groupBar = (page) => page.locator('#tacticalGroupBar');
const node = (page, id) => page.locator(`#map .node-hit[data-node="${id}"]`);
const ui = (page) => page.evaluate(() => store.getSnapshot().ui);
const sent = (page, source, destination) =>
  page.evaluate(([s, d]) => orders[s]?.edges[d] ?? 0, [source, destination]);

async function giveBlue(page, changes, policies = {}) {
  await page.evaluate(
    ({ changes, policies }) => {
      const match = store.getSnapshot().match;
      const nodes = match.state.nodes.map((n) =>
        changes[n.id] ? { ...n, owner: 0, ...changes[n.id] } : n,
      );
      store.replaceMatch({ ...match, state: { ...match.state, nodes }, policies });
      render();
    },
    { changes, policies },
  );
  await page.locator('#fit').click();
}

async function openEdgeGroup(page, pairs) {
  await page.evaluate((pairs) => {
    store.setGroupMode(true);
    store.setBulkEdges(pairs);
    store.setGroupEditing(true);
    render();
  }, pairs);
  await expect(inspector(page)).toContainText('Group · ' + pairs.length + ' connections');
}

async function commit(locator, value) {
  await locator.fill(String(value));
  await locator.blur();
}

async function touch(page, edge, type, offset = 0) {
  const box = await edgeHit(page, edge).boundingBox();
  await edgeHit(page, edge).dispatchEvent(type, {
    pointerType: 'touch',
    pointerId: 7,
    isPrimary: true,
    button: 0,
    clientX: box.x + box.width / 2 + offset,
    clientY: box.y + box.height / 2,
  });
}

const blueAroundZero = { 1: { active: 10 }, 2: { active: 10 }, 4: { active: 10 } };

test('Shift+click builds a group of connections from own nodes, never with nodes', async ({
  page,
}) => {
  await giveBlue(page, blueAroundZero);
  await edgeHit(page, '1-3').click({ modifiers: ['Shift'] });
  await expect(groupBar(page)).toContainText('1 connection selected');
  await edgeHit(page, '2-5').click({ modifiers: ['Shift'] });
  await expect(groupBar(page)).toContainText('2 connections selected');
  await expect(inspector(page)).toBeHidden();
  await edgeHit(page, '9-10').click({ modifiers: ['Shift'] });
  await expect(groupBar(page)).toContainText('Only connections touching your nodes join.');
  await node(page, 1).click();
  await expect(groupBar(page)).toContainText('This group holds connections.');
  expect((await ui(page)).bulkEdges).toEqual([
    [1, 3],
    [2, 5],
  ]);
  expect((await ui(page)).bulkSelection).toEqual([]);
  await expect(page.locator('.tactical-group-edge')).toHaveCount(2);
  await groupBar(page).getByRole('button', { name: 'Edit' }).click();
  await expect(inspector(page)).toContainText('Group · 2 connections');
});

test('a node group does not take connections', async ({ page }) => {
  await giveBlue(page, blueAroundZero);
  await node(page, 1).click({ modifiers: ['Shift'] });
  await edgeHit(page, '1-3').click();
  await expect(groupBar(page)).toContainText('This group holds nodes.');
  expect((await ui(page)).bulkEdges).toEqual([]);
});

test('a touch long-press on a connection starts selecting, taps add connections and Edit opens them', async ({
  page,
}) => {
  await giveBlue(page, blueAroundZero);
  await touch(page, '4-7', 'pointerdown');
  await page.waitForTimeout(600);
  await touch(page, '4-7', 'pointerup');
  await expect(groupBar(page)).toContainText('1 connection selected');
  await edgeHit(page, '1-3').click();
  await expect(groupBar(page)).toContainText('2 connections selected');
  await edgeHit(page, '4-7').click();
  await expect(groupBar(page)).toContainText('1 connection selected');
  await edgeHit(page, '2-5').click();
  await expect(inspector(page)).toBeHidden();
  await groupBar(page).getByRole('button', { name: 'Edit' }).click();
  await expect(inspector(page)).toContainText('Group · 2 connections');
});

test('a pan that starts on a connection does not become a long-press', async ({ page }) => {
  await giveBlue(page, blueAroundZero);
  await touch(page, '1-3', 'pointerdown');
  await touch(page, '1-3', 'pointermove', 30);
  await page.waitForTimeout(600);
  await touch(page, '1-3', 'pointerup', 30);
  await expect(groupBar(page)).toBeHidden();
  expect((await ui(page)).groupMode).toBe(false);
});

test('a win chance gives each attack the amount its own target needs', async ({ page }) => {
  await giveBlue(page, { ...blueAroundZero, 2: { active: 1 } });
  await openEdgeGroup(page, [
    [1, 3],
    [4, 7],
    [2, 5],
  ]);
  const chance70 = (source, destination) =>
    page.evaluate(
      ([s, d]) =>
        GameStore.selectors
          .orderPresets(store.getSnapshot().match, s, d)
          .presets.find((preset) => preset.chance === 0.7).amount,
      [source, destination],
    );
  await inspector(page).locator('[data-preset="chance-70"]').click();
  await expect(inspector(page)).toContainText('Applied to 2 of 3; 2 → 5 lacked energy.');
  expect(await sent(page, 1, 3)).toBe(await chance70(1, 3));
  expect(await sent(page, 4, 7)).toBe(await chance70(4, 7));
  expect(await sent(page, 2, 5)).toBe(0);
});

test('one amount goes on every connection, and differing amounts show as mixed', async ({
  page,
}) => {
  await giveBlue(page, blueAroundZero);
  await openEdgeGroup(page, [
    [1, 3],
    [4, 7],
  ]);
  await commit(page.locator('#groupEdgeAmount'), 4);
  expect([await sent(page, 1, 3), await sent(page, 4, 7)]).toEqual([4, 4]);
  await expect(page.locator('#groupEdgeAmount')).toHaveValue('4');
  await page.evaluate(() => {
    store.setAllocation(1, 3, 2);
    render();
  });
  await expect(page.locator('#groupEdgeAmount')).toHaveAttribute('title', 'mixed (2–4)');
  await inspector(page).getByRole('button', { name: 'Clear orders' }).click();
  expect(await page.evaluate(() => orders)).toEqual({});
});

test('All splits a node’s energy evenly between its selected connections', async ({ page }) => {
  await giveBlue(page, blueAroundZero);
  await openEdgeGroup(page, [
    [1, 3],
    [1, 4],
  ]);
  await expect(inspector(page)).toContainText('Send each');
  await inspector(page).locator('[data-preset="all"]').click();
  expect([await sent(page, 1, 3), await sent(page, 1, 4)]).toEqual([5, 5]);
});

test('pressure turns on for every attack and its fields edit them together', async ({ page }) => {
  await giveBlue(page, blueAroundZero, {
    4: {
      enabled: true,
      reserve: 0,
      investPct: 0,
      dest: null,
      pressure: { 7: { pct: 20, min: 15 } },
    },
  });
  await openEdgeGroup(page, [
    [1, 3],
    [4, 7],
    [1, 4],
  ]);
  const toggle = page.locator('#groupEdgePressure');
  await expect(inspector(page)).toContainText('Pressure · 1 of 2');
  expect(await toggle.evaluate((box) => box.indeterminate)).toBe(true);
  await toggle.check();
  await expect(inspector(page)).toContainText('Pressure · 2 of 2');
  await expect(page.locator('#group-pressure-pct')).toHaveAttribute('placeholder', '10–20');
  await commit(page.locator('#group-pressure-pct'), 25);
  await commit(page.locator('#group-pressure-min'), 12);
  expect(await page.evaluate(() => [policies[1].pressure, policies[4].pressure])).toEqual([
    { 3: { pct: 25, min: 12 } },
    { 7: { pct: 25, min: 12 } },
  ]);
  await inspector(page).getByRole('button', { name: 'Stop pressure' }).click();
  await expect(inspector(page)).toContainText('Pressure · 0 of 2');
  expect(await page.evaluate(() => [policies[1].pressure, policies[4].pressure])).toEqual([{}, {}]);
});

test('a support connection in the group swaps direction and opens alone', async ({ page }) => {
  await giveBlue(page, blueAroundZero);
  await openEdgeGroup(page, [
    [1, 3],
    [0, 1],
  ]);
  await inspector(page)
    .getByRole('button', { name: 'From Node 0 to Node 1. Swap direction' })
    .click();
  expect((await ui(page)).bulkEdges).toEqual([
    [1, 3],
    [1, 0],
  ]);
  await inspector(page).getByRole('button', { name: 'Edit connection 1 → 0 alone' }).click();
  await expect(groupBar(page)).toBeHidden();
  await expect(page.locator('#tacticalSwapDirection')).toHaveAttribute(
    'aria-label',
    /^From Node 1 to Node 0/,
  );
  await expect(page.locator('#tacticalEdgeAmount')).toBeVisible();
});

test('the node group editor sets % and attack at on its nodes’ pressured connections', async ({
  page,
}) => {
  const pressuring = (pressure) => ({
    enabled: true,
    reserve: 0,
    investPct: 0,
    dest: null,
    pressure,
  });
  await giveBlue(page, blueAroundZero, {
    1: pressuring({ 3: { pct: 10, min: 10 } }),
    2: pressuring({ 5: { pct: 15, min: 12 } }),
  });
  await page.evaluate(() => {
    store.setGroupMode(true);
    store.setBulkSelection([1, 2]);
    store.setGroupEditing(true);
    render();
  });
  await expect(inspector(page)).toContainText('pressured connections of these nodes: 1 → 3, 2 → 5');
  await expect(page.locator('#group-pressure-pct')).toHaveAttribute('title', 'mixed (10–15)');
  await commit(page.locator('#group-pressure-min'), 30);
  expect(
    await page.evaluate(() => [policies[1].pressure[3].min, policies[2].pressure[5].min]),
  ).toEqual([30, 30]);
});

test('a refused Shift+click shows its reason before any group exists', async ({ page }) => {
  await giveBlue(page, blueAroundZero);
  await edgeHit(page, '9-10').click({ modifiers: ['Shift'] });
  await expect(groupBar(page)).toBeVisible();
  await expect(groupBar(page)).toContainText('Only connections touching your nodes join.');
  expect((await ui(page)).bulkEdges).toEqual([]);
});
