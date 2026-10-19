import { test, expect, inspector, openNodeEditor, openEdgeEditor } from './support/game.mjs';

async function commit(locator, value) {
  await locator.fill(String(value));
  await locator.blur();
}

async function giveNodeOneToRed(page, policy) {
  await page.evaluate((policy) => {
    const match = store.getSnapshot().match;
    const nodes = match.state.nodes.map((n) => (n.id === 1 ? { ...n, owner: 1, active: 4 } : n));
    store.replaceMatch({
      ...match,
      state: { ...match.state, nodes },
      policies: policy ? { 0: policy } : match.policies,
    });
    render();
  }, policy);
}

const nodePolicy = (page) => page.evaluate(() => policies[0]);

async function resolveRound(page) {
  const round = await page.evaluate(() => state.round);
  await page.locator('#uxDockResolve:visible, #resolve:visible').first().click();
  await expect(page.locator('#score')).toContainText('Round ' + (round + 1));
}

test('an enemy edge holds its own pressure share and minimum', async ({ page }) => {
  await giveNodeOneToRed(page);
  await openEdgeEditor(page, '0-1');
  await page.locator('#tacticalAutoPressure').check();
  expect((await nodePolicy(page)).pressure).toEqual({ 1: { pct: 10, min: 10 } });
  await expect(inspector(page)).toContainText('banked 0 → 1.9 / 10');
  await commit(page.locator('#tacticalEdgePressurePct'), 20);
  await commit(page.locator('#tacticalEdgePressureMin'), 6);
  expect((await nodePolicy(page)).pressure).toEqual({ 1: { pct: 20, min: 6 } });
  await page.locator('#tacticalAutoPressure').uncheck();
  expect((await nodePolicy(page)).pressure).toEqual({});
});

test('a node pressures two neighbours from two edges', async ({ page }) => {
  await giveNodeOneToRed(page);
  await openEdgeEditor(page, '0-1');
  await page.locator('#tacticalAutoPressure').check();
  await inspector(page).getByRole('button', { name: 'Clear map selection' }).click();
  await openEdgeEditor(page, '0-2');
  await page.locator('#tacticalAutoPressure').check();
  expect(Object.keys((await nodePolicy(page)).pressure)).toEqual(['1', '2']);
  await inspector(page).getByRole('button', { name: 'Clear map selection' }).click();
  await openNodeEditor(page);
  await expect(inspector(page)).toContainText('Node 1 · 10% · banked');
  await expect(inspector(page)).toContainText('Node 2 · 10% · banked');
  await expect(inspector(page)).toContainText(
    'Shares: invest 50% + defense 0% + pressure 20% = 70%',
  );
});

test('an edge share that would exceed 100% is refused', async ({ page }) => {
  await giveNodeOneToRed(page, { enabled: true, reserve: 5, investPct: 95, dest: null });
  await openEdgeEditor(page, '0-1');
  await page.locator('#tacticalAutoPressure').click();
  await expect(page.locator('#tacticalAutoPressure')).not.toBeChecked();
  await expect(inspector(page)).toContainText('cannot add up to more than 100%');
  expect((await nodePolicy(page)).pressure).toBeUndefined();
});

test('the bank shows on the map after a round', async ({ page }) => {
  await giveNodeOneToRed(page);
  await openEdgeEditor(page, '0-1');
  await page.locator('#tacticalAutoPressure').check();
  await commit(page.locator('#tacticalEdgePressurePct'), 20);
  await inspector(page).getByRole('button', { name: 'Clear map selection' }).click();
  await resolveRound(page);
  expect((await nodePolicy(page)).pressure[1].bank).toBeCloseTo(3.8, 9);
  await expect(page.locator('#map .ux-income-label').first()).toContainText('⟂ 3.8');
});

test('a pulse fires at the minimum and logs one pressure line', async ({ page }) => {
  await giveNodeOneToRed(page, {
    enabled: true,
    reserve: 5,
    investPct: 0,
    dest: null,
    pressure: { 1: { pct: 10, min: 10, bank: 9 } },
  });
  await openEdgeEditor(page, '0-1');
  await expect(inspector(page)).toContainText('pulse this round: 10 → Node 1');
  await inspector(page).getByRole('button', { name: 'Clear map selection' }).click();
  await resolveRound(page);
  expect(await page.evaluate(() => history.join('\n'))).toMatch(
    /Pressure: Node 0 → Node 1 \(10\.0, captured\)/,
  );
});
