import { readFileSync, writeFileSync } from 'node:fs';
import { test, expect, inspector, chooseSource } from './support/game.mjs';

const fixture = (name) => new URL('./fixtures/' + name, import.meta.url);

function expectGolden(name, actual) {
  if (process.env.UPDATE_GOLDEN)
    writeFileSync(fixture(name), JSON.stringify(actual, null, 2) + '\n');
  expect(actual).toEqual(JSON.parse(readFileSync(fixture(name), 'utf8')));
}

function matchSnapshot(page) {
  return page.evaluate(() => ({
    state,
    orders,
    policies,
    history,
    randomCalls,
    defaults: [autoConquer.checked, defaultReserve.value, defaultInvest.value],
  }));
}

function savedMatch(page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem('parallel-energy-game-v1')));
}

async function commit(locator, value) {
  await locator.fill(String(value));
  await locator.blur();
}

async function openNode(page, id) {
  await page.locator('#fit').click();
  const node = page.locator('#map .node-hit').nth(id);
  await node.click();
  await node.click();
  await expect(inspector(page)).toContainText('Node ' + id);
}

async function openEdge(page, edge) {
  await page.locator('#fit').click();
  const hit = page.locator(`.tactical-edge-hit[data-edge="${edge}"]`);
  await hit.click();
  await hit.click();
  await expect(page.locator('#tacticalEdgeAmount')).toBeVisible();
}

async function closeInspector(page) {
  await inspector(page).getByRole('button', { name: 'Clear map selection' }).click();
  await expect(inspector(page)).toBeHidden();
}

async function openFromMenu(page, label) {
  await page.locator('#tacticalMenu summary').click();
  await page.locator('#tacticalMenu button').filter({ hasText: label }).click();
}

async function resolveRound(page) {
  const round = await page.evaluate(() => state.round);
  await page.locator('#uxDockResolve:visible, #resolve:visible').first().click();
  await expect(page.locator('#score')).toContainText('Round ' + (round + 1));
}

async function selectGroup(page, ids) {
  await page.locator('#fit').click();
  for (const id of ids)
    await page
      .locator('#map .node-hit')
      .nth(id)
      .click({ modifiers: ['Shift'] });
  await page.locator('#tacticalGroupBar').getByRole('button', { name: 'Edit' }).click();
  await expect(inspector(page)).toContainText('Group · ' + ids.length + ' nodes');
}

test('a fixed command sequence produces the recorded orders, policies and rounds', async ({
  page,
}) => {
  test.setTimeout(120000);
  const trace = [];
  const record = async (step) => trace.push({ step, ...(await matchSnapshot(page)) });
  await record('start');

  await openNode(page, 0);
  await commit(page.locator('#tacticalPolicyPercent'), 40);
  await page.getByText('Other policy settings').click();
  await commit(page.locator('#policyEditor label:has-text("Active defense reserve") input'), 3);
  await page.getByRole('checkbox', { name: 'Pause policy this round' }).check();
  await page.getByRole('checkbox', { name: 'Pause policy this round' }).uncheck();
  await page.locator('#policyEditor').getByRole('button', { name: 'Copy' }).click();
  await expect(inspector(page)).toBeVisible();
  await page.getByText('Manual investment, withdrawal and allocations').click();
  await commit(page.locator('#allocator [data-allocation="withdraw"]'), 4);
  await commit(page.locator('#allocator [data-allocation="invest"]'), 2);
  await commit(page.locator('#allocator [data-allocation="edge-1"]'), 12);
  await commit(page.locator('#allocator [data-allocation="edge-2"]'), 99);
  await record('node 0 policy and allocations, over-budget attack rejected');
  await closeInspector(page);

  await openEdge(page, '0-2');
  await commit(page.locator('#tacticalEdgeAmount'), 10);
  await closeInspector(page);
  await record('edge 0-2 attack');

  await openFromMenu(page, 'Settings');
  await commit(page.locator('#defaultReserve'), 2);
  await commit(page.locator('#defaultInvest'), 60);
  await page.locator('#uxSettingsDialog .ux-dialog-close').click();
  await resolveRound(page);
  await record('round 1 resolved with changed conquest defaults');

  await openNode(page, 1);
  await page.getByText('Other policy settings').click();
  await page.locator('#policyEditor').getByRole('button', { name: 'Paste' }).click();
  await closeInspector(page);
  await openEdge(page, '0-2');
  await chooseSource(page, 2);
  await page.locator('#tacticalAutoTransfer').check();
  await commit(page.locator('#tacticalEdgeAmount'), 1.5);
  await closeInspector(page);
  await record('policy pasted to node 1, node 2 routes surplus to node 0');

  await selectGroup(page, [0, 1]);
  await commit(page.locator('#group-reserve'), 4);
  await commit(page.locator('#group-investPct'), 55);
  await commit(page.locator('#groupInvestEach'), 1);
  await expect(inspector(page)).toContainText('Applied to all 2 nodes.');
  await page.locator('#tacticalGroupBar').getByRole('button', { name: 'Done' }).click();
  await record('dashboard bulk policy and manual investment');

  await openFromMenu(page, 'Orders');
  await page
    .locator('#uxOrdersDialog .order-row')
    .filter({ hasText: 'Edit node 1' })
    .getByRole('button', { name: 'Clear ×' })
    .click();
  await page.locator('#uxOrdersDialog .ux-dialog-close').click();
  await record('node 1 orders cleared from the review dialog');

  await resolveRound(page);
  await record('round 2 resolved');

  await openNode(page, 0);
  await page.getByText('Manual investment, withdrawal and allocations').click();
  await commit(page.locator('#allocator [data-allocation="invest"]'), 5);
  await closeInspector(page);
  await record('node 0 invests 5');
  await openFromMenu(page, 'Orders');
  await page.locator('#clearAll').click();
  await page.locator('#uxOrdersDialog .ux-dialog-close').click();
  await record('all manual orders cleared');

  await openNode(page, 1);
  await page.getByRole('checkbox', { name: 'Enable policy for node 1' }).uncheck();
  await closeInspector(page);
  await resolveRound(page);
  await record('round 3 resolved with node 1 policy disabled');

  expectGolden('command-sequence.json', trace);
  expect(await savedMatch(page)).toMatchObject({
    state: trace.at(-1).state,
    orders: trace.at(-1).orders,
    policies: trace.at(-1).policies,
  });
});

function loadedMatch(page) {
  return page.evaluate(() => ({
    state,
    orders,
    policies,
    history,
    selected,
    map: { xy, edges, N, playerCount, mapSeed },
    defaults: [autoConquer.checked, defaultReserve.value, defaultInvest.value],
  }));
}

async function reloadWithSave(page, save) {
  await page.addInitScript((raw) => {
    if (sessionStorage.getItem('characterization-seeded')) return;
    sessionStorage.setItem('characterization-seeded', '1');
    localStorage.setItem('parallel-energy-game-v1', raw);
  }, JSON.stringify(save));
  await page.reload();
}

for (const name of ['save-v0.8.4', 'save-without-optional-fields']) {
  test(`${name} loads, resolves and reloads as recorded`, async ({ page }) => {
    await reloadWithSave(page, JSON.parse(readFileSync(fixture(name + '.json'), 'utf8')));
    const loaded = await loadedMatch(page);
    await resolveRound(page);
    const resolved = await loadedMatch(page);
    expectGolden(name + '-loaded.json', { loaded, resolved, saved: await savedMatch(page) });

    await page.reload();
    const reloaded = await loadedMatch(page);
    expect(reloaded.history.slice(1)).toEqual(resolved.history);
    expect({ ...reloaded, history: null, selected: null }).toEqual({
      ...resolved,
      history: null,
      selected: null,
    });
  });
}

test('a new save with edits and changed defaults reloads unchanged', async ({ page }) => {
  await openNode(page, 0);
  await commit(page.locator('#tacticalPolicyPercent'), 35);
  await page.getByText('Manual investment, withdrawal and allocations').click();
  await commit(page.locator('#allocator [data-allocation="edge-1"]'), 8);
  await closeInspector(page);
  await openFromMenu(page, 'Settings');
  await page.locator('#autoConquer').uncheck();
  await commit(page.locator('#defaultReserve'), 7);
  await commit(page.locator('#defaultInvest'), 25);
  await page.locator('#uxSettingsDialog .ux-dialog-close').click();
  await openNode(page, 0);
  const before = await loadedMatch(page);

  await page.reload();
  const after = await loadedMatch(page);
  expect(after.history).toEqual(['Recovered saved match from this browser.', ...before.history]);
  expect({ ...after, history: null }).toEqual({ ...before, history: null, selected: null });
  expect(after.defaults).toEqual([false, '7', '25']);
});
