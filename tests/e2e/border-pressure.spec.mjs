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

test('an enemy edge toggles pressure from its source node', async ({ page }) => {
  await giveNodeOneToRed(page);
  await openEdgeEditor(page, '0-1');
  await page.locator('#tacticalAutoPressure').check();
  expect(await nodePolicy(page)).toMatchObject({
    pressureTarget: 1,
    pressurePct: 10,
    pressureMin: 10,
  });
  await expect(inspector(page)).toContainText('Banked 0 → 1.9 / 10 · next pulse → Node 1');
  await page.locator('#tacticalAutoPressure').uncheck();
  expect(await nodePolicy(page)).toMatchObject({ pressureTarget: null, pressurePct: 0 });
});

test('the inspector banks pressure and the map shows the bank', async ({ page }) => {
  await giveNodeOneToRed(page);
  await openNodeEditor(page);
  await commit(page.locator('#tacticalPressurePct'), 20);
  await expect(inspector(page)).toContainText(
    'Banked 0 → 3.8 / 10 · next pulse → Node 1 (active 4)',
  );
  await expect(inspector(page)).toContainText(
    'Shares: invest 50% + defense 0% + pressure 20% = 70%',
  );
  await resolveRound(page);
  expect((await nodePolicy(page)).pressureBank).toBeCloseTo(3.8, 9);
  await expect(page.locator('#map .ux-income-label').first()).toContainText('⟂ 3.8/10');
});

test('a node with only neutral neighbours waits until neutrals are included', async ({ page }) => {
  await openNodeEditor(page);
  await commit(page.locator('#tacticalPressurePct'), 10);
  await expect(inspector(page)).toContainText('No eligible neighbour');
  await page.locator('#tacticalPressureNeutral').check();
  await expect(inspector(page)).toContainText('next pulse → Node');
});

test('a pulse fires at the minimum and logs one pressure line', async ({ page }) => {
  await giveNodeOneToRed(page, {
    enabled: true,
    reserve: 5,
    investPct: 0,
    dest: null,
    pressurePct: 10,
    pressureMin: 10,
    pressureBank: 9,
  });
  await openNodeEditor(page);
  await expect(inspector(page)).toContainText('Pulse this round: 10 → Node 1');
  await page
    .locator('#tacticalInspector')
    .getByRole('button', { name: 'Clear map selection' })
    .click();
  await resolveRound(page);
  expect(await page.evaluate(() => history.join('\n'))).toMatch(
    /Pressure: Node 0 → Node 1 \(10\.0, captured\)/,
  );
  expect((await nodePolicy(page)).pressureBank).toBe(0);
});
