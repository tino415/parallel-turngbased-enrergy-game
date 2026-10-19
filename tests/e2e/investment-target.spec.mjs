import { test, expect, inspector, openNodeEditor } from './support/game.mjs';

const investTarget = (page) => page.locator('#tacticalInvestTarget');
const divestPct = (page) => page.locator('#tacticalDivestPct');

async function commit(locator, value) {
  await locator.fill(String(value));
  await locator.blur();
}

const nodePolicy = (page) => page.evaluate(() => policies[0]);

test('an investment target caps the policy and reports progress', async ({ page }) => {
  await openNodeEditor(page);
  await expect(investTarget(page)).toHaveValue('');
  await commit(investTarget(page), 20);
  expect(await nodePolicy(page)).toMatchObject({ investTarget: 20, investPct: 50 });
  await expect(inspector(page)).toContainText('Invested 14 of 20 · +6 this round · 0 to go');

  await commit(investTarget(page), '');
  expect((await nodePolicy(page)).investTarget).toBeNull();
  await expect(inspector(page)).not.toContainText('Invested 14 of');
});

test('a node above its target scales down and the round applies it', async ({ page }) => {
  await openNodeEditor(page);
  await commit(investTarget(page), 10);
  await commit(divestPct(page), 20);
  await expect(inspector(page)).toContainText(
    'Invested 14 → 10 · policy withdraws 2.8 this round, 0.1 fee · 2 rounds to target',
  );
  await page.locator('#uxDockResolve:visible, #resolve:visible').first().click();
  await expect(page.locator('#score')).toContainText('Round 2');
  expect(await page.evaluate(() => state.nodes[0].invested)).toBeCloseTo(11.2, 9);
});

test('an invalid target reverts to the committed value', async ({ page }) => {
  await openNodeEditor(page);
  await commit(investTarget(page), 30);
  await commit(investTarget(page), -5);
  await expect(investTarget(page)).toHaveValue('30');
  await commit(divestPct(page), 120);
  await expect(divestPct(page)).toHaveValue('0');
  expect(await nodePolicy(page)).toMatchObject({ investTarget: 30 });
  expect((await nodePolicy(page)).divestPct).toBeUndefined();
});

test('an investment target draft survives a render and keeps focus', async ({ page }) => {
  await openNodeEditor(page);
  const field = investTarget(page);
  await field.click();
  await field.pressSequentially('12');
  await page.evaluate(() => render());
  await expect(field).toBeFocused();
  await expect(field).toHaveValue('12');
  expect((await nodePolicy(page))?.investTarget).toBeUndefined();
});
