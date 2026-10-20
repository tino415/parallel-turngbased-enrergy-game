import { test, expect } from './support/game.mjs';

const PURPLE = '#b18adc';
const BLUE = '#3278c8';

async function startAsPurple(page) {
  await page.getByLabel('More actions').click();
  await page.getByRole('button', { name: 'New game' }).click();
  await page.locator('#seat').selectOption({ label: 'Purple' });
  await page.getByRole('button', { name: 'Start game' }).click();
  await expect(page.locator('#newGameDialog')).toBeHidden();
}

test('a match started as Purple is played and replayed as Purple', async ({ page }) => {
  await startAsPurple(page);
  await expect(page.locator('#score')).toContainText('Purple 1');
  await expect(page.locator('#log')).toContainText('You are Purple.');
  expect(await page.evaluate(() => state.nodes.filter((n) => n.owner === 2).length)).toBe(1);

  await page.locator('#uxDockResolve:visible, #resolve:visible').first().click();
  await expect(page.locator('#score')).toContainText('Round 2');
  expect(await page.evaluate(() => state.nodes.some((n) => n.owner === 2))).toBe(true);

  await page.locator('#tacticalMenu summary').click();
  await page.locator('#tacticalMenu button').filter({ hasText: 'Replay' }).click();
  await expect(page.locator('#replayDialog')).toBeVisible();
  await expect(page.locator(`#replayMap circle[fill="${PURPLE}"]`)).toHaveCount(1);
  await expect(page.locator(`#replayMap circle[fill="${BLUE}"]`)).toHaveCount(1);
  expect(await page.evaluate(() => currentMatch().replay.seat)).toBe(2);
});

test('the colour choice follows the number of players', async ({ page }) => {
  await page.getByLabel('More actions').click();
  await page.getByRole('button', { name: 'New game' }).click();
  await page.locator('#playerCount').selectOption('2');
  await expect(page.locator('#seat option')).toHaveText(['Blue', 'Red']);
  await page.locator('#playerCount').selectOption('4');
  await expect(page.locator('#seat option')).toHaveText(['Blue', 'Red', 'Purple', 'Orange']);
});
