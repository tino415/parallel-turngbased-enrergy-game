import { test, expect, inspector, openNodeEditor } from './support/game.mjs';

const defensePct = (page) => page.locator('#tacticalDefensePct');
const defenseTarget = (page) => page.locator('#tacticalDefenseTarget');
const investPercent = (page) => page.locator('#tacticalPolicyPercent');

async function commit(locator, value) {
  await locator.fill(String(value));
  await locator.blur();
}

const nodePolicy = (page) => page.evaluate(() => policies[0]);

test('a defense target grows the floor each round and reports it', async ({ page }) => {
  await openNodeEditor(page);
  await commit(defensePct(page), 20);
  await commit(defenseTarget(page), 30);
  await expect(inspector(page)).toContainText('Floor 5 → 8.8 of 30 · sustainable ≈ 33.5');
  await expect(inspector(page)).toContainText(
    'Shares: invest 50% + defense 20% = 70% · rest 30% stays on the node',
  );
  await page.locator('#uxDockResolve:visible, #resolve:visible').first().click();
  await expect(page.locator('#score')).toContainText('Round 2');
  expect((await nodePolicy(page)).reserve).toBeCloseTo(8.8, 9);
});

test('shares above 100% are rejected and the field reverts', async ({ page }) => {
  await openNodeEditor(page);
  await commit(defensePct(page), 40);
  await commit(investPercent(page), 70);
  await expect(investPercent(page)).toHaveValue('50');
  await expect(inspector(page)).toContainText('Shares cannot add up to more than 100%');
  await commit(defensePct(page), 60);
  await expect(defensePct(page)).toHaveValue('40');
  expect(await nodePolicy(page)).toMatchObject({ investPct: 50, defensePct: 40 });
});

test('a defense target above the sustainable level warns', async ({ page }) => {
  await openNodeEditor(page);
  await commit(defenseTarget(page), 80);
  await expect(inspector(page)).toContainText('the floor stalls near 33.5');
});

test('a defense draft survives a render and keeps focus', async ({ page }) => {
  await openNodeEditor(page);
  const field = defenseTarget(page);
  await field.click();
  await field.pressSequentially('45');
  await page.evaluate(() => render());
  await expect(field).toBeFocused();
  await expect(field).toHaveValue('45');
});
