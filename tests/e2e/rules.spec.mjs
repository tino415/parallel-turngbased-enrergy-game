import { test, expect } from './support/game.mjs';

async function startWithRules(page, rules) {
  await page.getByLabel('More actions').click();
  await page.getByRole('button', { name: 'New game' }).click();
  await page.locator('#newGameRules summary').click();
  for (const [label, value] of Object.entries(rules))
    await page.getByLabel(label).fill(String(value));
  await page.getByRole('button', { name: 'Start game' }).click();
  await expect(page.locator('#newGameDialog')).toBeHidden();
}

test('a match started with custom rules plays and reloads with them', async ({ page }) => {
  await startWithRules(page, {
    'Production per node': 3,
    'Investment interest %': 20,
    'Node capacity': 120,
    'Overflow decay %': 50,
  });
  const custom = { production: 3, interest: 0.2, capacity: 120, overflowDecay: 0.5 };
  expect(await page.evaluate(() => state.rules)).toEqual(custom);

  const own = page.locator('#map .node-hit[fill="#3278c8"]').first();
  await own.click();
  await own.click();
  await expect(page.locator('#tacticalInspector')).toContainText('/ 120');

  await page.locator('#uxDockResolve:visible, #resolve:visible').first().click();
  await expect(page.locator('#score')).toContainText('Round 2');
  await page.reload();
  expect(await page.evaluate(() => state.rules)).toEqual(custom);
});

test('a match started without touching the rules stores none', async ({ page }) => {
  await page.getByLabel('More actions').click();
  await page.getByRole('button', { name: 'New game' }).click();
  await expect(page.locator('#newGameRules')).not.toHaveAttribute('open');
  await page.getByRole('button', { name: 'Start game' }).click();
  await expect(page.locator('#newGameDialog')).toBeHidden();
  expect(await page.evaluate(() => 'rules' in state)).toBe(false);
});

test('the settings dialog lists the rules of the running match', async ({ page }) => {
  await startWithRules(page, { 'Production per node': 3, 'Overflow decay %': 50 });
  await page.locator('#tacticalMenu summary').click();
  await page.locator('#tacticalMenu button').filter({ hasText: 'Settings' }).click();
  const rules = page.locator('#uxSettingsDialog #currentRules');
  await expect(rules).toContainText('Production per node3');
  await expect(rules).toContainText('Investment interest10%');
  await expect(rules).toContainText('Node capacity250');
  await expect(rules).toContainText('Overflow decay50%');
});
