import { test, expect, inspector } from './support/game.mjs';

const groupBar = (page) => page.locator('#tacticalGroupBar');
const node = (page, id) => page.locator(`#map .node-hit[data-node="${id}"]`);

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

async function openGroup(page, ids) {
  await page.evaluate((ids) => {
    store.setGroupMode(true);
    store.setBulkSelection(ids);
    store.setGroupEditing(true);
    render();
  }, ids);
  await expect(inspector(page)).toContainText('Group · ' + ids.length + ' nodes');
}

async function commit(locator, value) {
  await locator.fill(String(value));
  await locator.blur();
}

const ui = (page) => page.evaluate(() => store.getSnapshot().ui);
const nodePolicies = (page) => page.evaluate(() => policies);

async function touch(page, id, type, offset = 0) {
  const box = await node(page, id).boundingBox();
  await node(page, id).dispatchEvent(type, {
    pointerType: 'touch',
    pointerId: 7,
    isPrimary: true,
    button: 0,
    clientX: box.x + box.width / 2 + offset,
    clientY: box.y + box.height / 2,
  });
}

test('Shift+click builds a group from own nodes only, without opening the editor', async ({
  page,
}) => {
  await giveBlue(page, { 1: {} });
  await node(page, 0).click({ modifiers: ['Shift'] });
  await expect(groupBar(page)).toContainText('1 selected');
  await node(page, 1).click({ modifiers: ['Shift'] });
  await expect(groupBar(page)).toContainText('2 selected');
  await expect(inspector(page)).toBeHidden();
  await node(page, 3).focus();
  await page.keyboard.press('Shift+Enter');
  await expect(groupBar(page)).toContainText('Only your nodes join a group.');
  expect((await ui(page)).bulkSelection).toEqual([0, 1]);
});

test('Edit opens one node or the group, and the map keeps selecting while it is open', async ({
  page,
}) => {
  await giveBlue(page, { 1: {} });
  await node(page, 1).focus();
  await page.keyboard.press('Shift+Enter');
  await groupBar(page).getByRole('button', { name: 'Edit' }).click();
  await expect(inspector(page)).toContainText('Node 1');
  await expect(page.locator('#tacticalPolicyPercent')).toBeVisible();
  await node(page, 0).focus();
  await page.keyboard.press('Enter');
  await expect(inspector(page)).toContainText('Group · 2 nodes');
  await expect(groupBar(page)).toContainText('2 selected');
  await inspector(page).getByRole('button', { name: 'Edit node 1 alone' }).click();
  await expect(inspector(page)).toContainText('Node 1');
  await expect(page.locator('#tacticalPolicyPercent')).toBeVisible();
  await expect(groupBar(page)).toBeHidden();
});

test('a group edit applies one field and keeps destinations and other fields', async ({ page }) => {
  await giveBlue(page, { 1: {} }, { 0: { enabled: true, reserve: 5, investPct: 40, dest: 1 } });
  await openGroup(page, [0, 1]);
  await expect(page.locator('#group-investPct')).toHaveAttribute('placeholder', 'mixed (40–50)');
  await commit(page.locator('#group-reserve'), 3);
  expect(await nodePolicies(page)).toEqual({
    0: { enabled: true, reserve: 3, investPct: 40, dest: 1 },
    1: { enabled: true, reserve: 3, investPct: 50, dest: null },
  });
});

test('a group edit that breaks a node names it and changes nothing', async ({ page }) => {
  const shared = { enabled: true, reserve: 5, investPct: 50, dest: null };
  await giveBlue(page, { 1: {} }, { 1: { ...shared, defensePct: 30, defenseTarget: 40 } });
  await openGroup(page, [0, 1]);
  await commit(page.locator('#group-investPct'), 80);
  await expect(inspector(page)).toContainText('Nothing changed: Node 1 would exceed 100%');
  await expect(page.locator('#group-investPct')).toHaveValue('50');
  expect((await nodePolicies(page))[0]).toBeUndefined();
});

test('investing on each node reports the nodes that lacked energy', async ({ page }) => {
  await giveBlue(page, { 2: { active: 2 } });
  await openGroup(page, [0, 2]);
  await commit(page.locator('#groupInvestEach'), 5);
  await expect(inspector(page)).toContainText('Applied to 1 of 2; Node 2 lacked energy.');
  expect(await page.evaluate(() => orders)).toEqual({
    0: { invest: 5, withdraw: 0, edges: {} },
  });
});

test('a touch long-press starts selecting, taps add nodes and Edit opens the group', async ({
  page,
}) => {
  await giveBlue(page, { 1: {} });
  await touch(page, 1, 'pointerdown');
  await page.waitForTimeout(600);
  await touch(page, 1, 'pointerup');
  await expect(groupBar(page)).toContainText('1 selected');
  await node(page, 0).click();
  await expect(groupBar(page)).toContainText('2 selected');
  await expect(inspector(page)).toBeHidden();
  await groupBar(page).getByRole('button', { name: 'Edit' }).click();
  await expect(inspector(page)).toContainText('Group · 2 nodes');
});

test('a finger lifted off the map after a long-press does not turn the next drag into a pinch', async ({
  page,
}) => {
  await giveBlue(page, { 1: {} });
  await touch(page, 1, 'pointerdown');
  await page.waitForTimeout(600);
  await page.evaluate(() =>
    document.body.dispatchEvent(
      new PointerEvent('pointerup', { pointerId: 7, pointerType: 'touch', bubbles: true }),
    ),
  );
  const scale = await page.evaluate(() => camera.scale);
  const box = await page.locator('#map').boundingBox();
  const drag = (type, dx) =>
    page.locator('#map').dispatchEvent(type, {
      pointerType: 'touch',
      pointerId: 8,
      isPrimary: true,
      button: 0,
      clientX: box.x + 40 + dx,
      clientY: box.y + box.height - 40,
    });
  await drag('pointerdown', 0);
  await drag('pointermove', 60);
  await drag('pointerup', 60);
  expect(await page.evaluate(() => camera.scale)).toBe(scale);
});

test('a pan that starts on a node does not become a long-press', async ({ page }) => {
  await giveBlue(page, { 1: {} });
  await touch(page, 1, 'pointerdown');
  await touch(page, 1, 'pointermove', 30);
  await page.waitForTimeout(600);
  await touch(page, 1, 'pointerup', 30);
  await expect(groupBar(page)).toBeHidden();
  expect((await ui(page)).groupMode).toBe(false);
});

test('Shift+Enter toggles a focused node and Escape leaves the group', async ({ page }) => {
  await giveBlue(page, { 1: {} });
  await node(page, 1).focus();
  await page.keyboard.press('Shift+Enter');
  await expect(groupBar(page)).toContainText('1 selected');
  await node(page, 0).focus();
  await page.keyboard.press('Shift+Enter');
  await groupBar(page).getByRole('button', { name: 'Edit' }).click();
  await expect(inspector(page)).toContainText('Group · 2 nodes');
  await page.keyboard.press('Escape');
  await expect(groupBar(page)).toBeHidden();
  await expect(inspector(page)).toBeHidden();
  expect((await ui(page)).bulkSelection).toEqual([]);
});

test('a keyboard-only player selects several nodes and edits one of them', async ({ page }) => {
  await giveBlue(page, { 1: {}, 2: {} });
  await node(page, 0).focus();
  await page.keyboard.press('Shift+Enter');
  for (const id of [1, 2]) {
    await node(page, id).focus();
    await page.keyboard.press('Enter');
  }
  await groupBar(page).getByRole('button', { name: 'Edit' }).focus();
  await page.keyboard.press('Enter');
  await expect(inspector(page)).toContainText('Group · 3 nodes');
  for (const id of [0, 1, 2])
    await expect(
      inspector(page).getByRole('button', { name: `Edit node ${id} alone` }),
    ).toBeVisible();
  await inspector(page).getByRole('button', { name: 'Edit node 2 alone' }).focus();
  await page.keyboard.press('Enter');
  await expect(inspector(page)).toContainText('Node 2');
  await expect(page.locator('#tacticalPolicyPercent')).toBeVisible();
});

test('an empty-map tap keeps the group and Done leaves it', async ({ page }) => {
  await giveBlue(page, { 1: {} });
  await openGroup(page, [0, 1]);
  await page.locator('#map').dispatchEvent('click');
  await expect(inspector(page)).toContainText('Group · 2 nodes');
  await expect(groupBar(page).getByRole('button')).toHaveText(['Edit', 'Done']);
  await groupBar(page).getByRole('button', { name: 'Done' }).click();
  await expect(groupBar(page)).toBeHidden();
  await expect(inspector(page)).toBeHidden();
});
