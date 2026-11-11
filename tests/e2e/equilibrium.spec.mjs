import { test, expect, inspector, openNodeEditor } from './support/game.mjs';

const rulesField = (page, label) => page.locator('#newGameRules').getByLabel(label);

async function openNewGameRules(page) {
  await page.getByLabel('More actions').click();
  await page.getByRole('button', { name: 'New game' }).click();
  await page.locator('#newGameRules summary').click();
}

async function startEquilibrium(page, deposit) {
  await openNewGameRules(page);
  await rulesField(page, 'Economy').selectOption('equilibrium');
  await rulesField(page, 'Starting deposit').fill(String(deposit));
  await page.getByRole('button', { name: 'Start game' }).click();
  await expect(page.locator('#newGameDialog')).toBeHidden();
}

test('the starting deposit shows only under Equilibrium', async ({ page }) => {
  await openNewGameRules(page);
  await expect(rulesField(page, 'Economy')).toHaveValue('open');
  await expect(rulesField(page, 'Starting deposit')).toBeHidden();
  await rulesField(page, 'Economy').selectOption('equilibrium');
  await expect(rulesField(page, 'Starting deposit')).toBeVisible();
  await expect(rulesField(page, 'Starting deposit')).toHaveValue('100');
});

test('a new Equilibrium game gives every node its deposit and keeps it after a reload', async ({
  page,
}) => {
  await startEquilibrium(page, 50);
  const rules = await page.evaluate(() => state.rules);
  expect(rules).toMatchObject({ economy: 'equilibrium', startingDeposit: 50 });
  expect(await page.evaluate(() => state.nodes.every((node) => node.deposit === 50))).toBe(true);

  await page.locator('#uxDockResolve:visible, #resolve:visible').first().click();
  await expect(page.locator('#score')).toContainText('Round 2');
  await page.reload();
  expect(await page.evaluate(() => state.rules.economy)).toBe('equilibrium');
});

test('the inspector shows the deposit and this round’s extraction', async ({ page }) => {
  await startEquilibrium(page, 50);
  await openNodeEditor(page);
  await expect(inspector(page)).toContainText(/Deposit 50 · −\d/);
});

test('the Rules dialog and the Leaderboard show the deposit under Equilibrium only', async ({
  page,
}) => {
  await startEquilibrium(page, 50);
  await page.getByLabel('More actions').click();
  await page.locator('#tacticalMenu').getByRole('button', { name: 'Rules' }).click();
  await expect(page.locator('#currentRules')).toContainText('EconomyEquilibrium');
  await expect(page.locator('#currentRules')).toContainText('Starting deposit50');
  await page.getByRole('button', { name: 'Close' }).click();

  await page.getByRole('tab', { name: 'Leaderboard' }).click();
  await expect(page.locator('#leaderboardTable th[data-column="deposit"]')).toBeVisible();
  await expect(page.locator('#leaderboardTable tbody tr').first().locator('td')).toHaveCount(4);
});

test('an open game shows no deposit anywhere', async ({ page }) => {
  await openNodeEditor(page);
  await expect(inspector(page)).not.toContainText('Deposit');
  await page.getByRole('tab', { name: 'Leaderboard' }).click();
  await expect(page.locator('#leaderboardTable th[data-column="deposit"]')).toBeHidden();
  await expect(page.locator('#leaderboardTable tbody tr').first().locator('td')).toHaveCount(3);
});
