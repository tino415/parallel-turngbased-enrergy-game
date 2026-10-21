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
  await page.keyboard.press('Escape');
  await page.getByRole('tab', { name: /Leaderboard/ }).click();
  await expect(page.locator('#leaderboardTable tbody tr.is-you')).toContainText('Purple (you)');
  await expect(page.locator('#leaderboardTable tbody')).not.toContainText('Blue (you)');
  await page.getByRole('tab', { name: /Map/ }).click();
  await page.locator('#tacticalMenu summary').click();
  await page.locator('#tacticalMenu button').filter({ hasText: 'Replay' }).click();
  await expect(page.locator(`#replayMap circle[fill="${PURPLE}"]`)).toHaveCount(1);
  await expect(page.locator(`#replayMap circle[fill="${BLUE}"]`)).toHaveCount(1);
  expect(await page.evaluate(() => currentMatch().replay.seat)).toBe(2);
});

test('any colour can be played against a single AI', async ({ page }) => {
  await page.getByLabel('More actions').click();
  await page.getByRole('button', { name: 'New game' }).click();
  await expect(page.locator('#seat option')).toHaveText([
    'Blue',
    'Red',
    'Purple',
    'Orange',
    'Green',
    'Pink',
  ]);
  await page.locator('#playerCount').selectOption('2');
  await page.locator('#seat').selectOption({ label: 'Green' });
  await page.getByRole('button', { name: 'Start game' }).click();
  await expect(page.locator('#score')).toContainText('Green 1 · Opponents 1');
  await expect(page.locator('#log')).toContainText('You are Green.');
  expect(await page.evaluate(() => [...new Set(state.nodes.map((n) => n.owner))].sort())).toEqual([
    0,
    4,
    null,
  ]);
  await page.locator('#uxDockResolve:visible, #resolve:visible').first().click();
  await expect(page.locator('#score')).toContainText('Round 2');
  await page.getByRole('tab', { name: /Leaderboard/ }).click();
  await expect(page.locator('#leaderboardTable tbody tr')).toHaveCount(2);
  await expect(page.locator('#leaderboardTable tbody tr.is-you')).toContainText('Green (you)');
  await expect(page.locator('#chartPlayers button')).toHaveCount(2);
  await expect(page.locator('.chart-line')).toHaveCount(2);
});

async function distanceFromMapCentre(page, id) {
  return page.evaluate((nodeId) => {
    const node = document.querySelector(`#map [data-node="${nodeId}"]`).getBoundingClientRect();
    const map = document.querySelector('#map').getBoundingClientRect();
    return Math.abs(node.x + node.width / 2 - (map.x + map.width / 2));
  }, id);
}

test('a match started as Purple centres the map on the Purple node, and Focus finds it again', async ({
  page,
}) => {
  await startAsPurple(page);
  const own = await page.evaluate(() => state.nodes.find((n) => n.owner === 2).id);
  expect(own).not.toBe(0);
  expect(await distanceFromMapCentre(page, own)).toBeLessThan(40);

  await page.getByRole('button', { name: 'Fit' }).click();
  await page.getByRole('button', { name: 'Focus' }).click();
  expect(await distanceFromMapCentre(page, own)).toBeLessThan(40);
});
