import { readFileSync } from 'node:fs';
import { test, expect, resolveUntilGameOver } from './support/game.mjs';

const BLUE = '#3278c8';
const replay = (page) => page.locator('#replayDialog');
const roundTitle = (page) => page.locator('#replayRound');
const blueNodes = (page) => page.locator(`#replayMap circle[fill="${BLUE}"]`);

async function openFromMenu(page, label) {
  await page.locator('#tacticalMenu summary').click();
  await page.locator('#tacticalMenu button').filter({ hasText: label }).click();
}

test('a finished game replays round by round, back and forward', async ({ page }) => {
  await resolveUntilGameOver(page);
  const lastRound = await page.evaluate(() => state.round);
  await expect(page.locator('#gameOverText')).toHaveText('Game over. Red wins.');

  await page.getByRole('button', { name: 'Watch replay' }).click();
  await expect(replay(page)).toBeVisible();
  await expect(roundTitle(page)).toHaveText('Round 1 of ' + lastRound);
  await expect(blueNodes(page)).toHaveCount(1);
  await expect(page.locator('#replayMap .replay-flow').first()).toBeAttached();
  await expect(page.locator('#replayMap .replay-arrow')).toHaveCount(
    await page.locator('#replayMap .replay-flow').count(),
  );
  await expect(page.locator('#replayLog')).toContainText('Round 1 complete');

  await page.getByRole('button', { name: 'Next round' }).click();
  await expect(roundTitle(page)).toHaveText('Round 2 of ' + lastRound);
  await expect(page.locator('#replayLog')).toContainText('Round 2 complete');
  await page.getByRole('button', { name: 'Previous round' }).click();
  await expect(roundTitle(page)).toHaveText('Round 1 of ' + lastRound);
  await expect(page.getByRole('button', { name: 'Previous round' })).toBeDisabled();

  await page.locator('#replayScrubber').fill(String(lastRound - 1));
  await expect(roundTitle(page)).toHaveText('Final map');
  await expect(blueNodes(page)).toHaveCount(0);
  await expect(page.locator('#replayLog')).toHaveText('Game over.');
  await expect(page.getByRole('button', { name: 'Next round' })).toBeDisabled();

  await page.getByRole('button', { name: 'Previous round' }).click();
  await expect(roundTitle(page)).toHaveText(`Round ${lastRound - 1} of ${lastRound}`);
  await expect(page.locator('#replayLog')).toContainText('Red wins by elimination!');

  await page.getByRole('button', { name: 'Close ×' }).click();
  await expect(replay(page)).toBeHidden();
  await expect(page.locator('#score')).toContainText('Round ' + lastRound);
});

test('a game in progress replays from the ☰ menu without changing the match', async ({ page }) => {
  for (const round of [2, 3, 4]) {
    await page.locator('#uxDockResolve:visible, #resolve:visible').first().click();
    await expect(page.locator('#score')).toContainText('Round ' + round);
  }
  const before = await page.evaluate(() => JSON.stringify(store.getSnapshot().match));

  await openFromMenu(page, 'Replay');
  await expect(roundTitle(page)).toHaveText('Round 1 of 4');
  await page.getByRole('button', { name: 'Play' }).click();
  await expect(roundTitle(page)).toHaveText('Round 4 of 4', { timeout: 6000 });
  await expect(page.getByRole('button', { name: 'Play' })).toBeVisible();
  await expect(page.locator('#replayLog')).toHaveText('This round is still being played.');
  await page.keyboard.press('Home');
  await expect(roundTitle(page)).toHaveText('Round 1 of 4');
  await page.keyboard.press('ArrowRight');
  await expect(roundTitle(page)).toHaveText('Round 2 of 4');

  await page.keyboard.press('Escape');
  await expect(replay(page)).toBeHidden();
  expect(await page.evaluate(() => JSON.stringify(store.getSnapshot().match))).toBe(before);
});

test('a save from before the replay still loads and offers no replay', async ({ page }) => {
  const save = readFileSync(new URL('./fixtures/save-v0.8.4.json', import.meta.url), 'utf8');
  await page.addInitScript((raw) => {
    if (sessionStorage.getItem('old-save-seeded')) return;
    sessionStorage.setItem('old-save-seeded', '1');
    localStorage.setItem('parallel-energy-game-v1', raw);
  }, save);
  await page.reload();
  await expect(page.locator('#score')).toContainText('Round ' + JSON.parse(save).state.round);
  await page.locator('#tacticalMenu summary').click();
  await expect(page.locator('#tacticalMenu button').filter({ hasText: 'Orders' })).toBeVisible();
  await expect(page.locator('#menuReplay')).toBeHidden();
});
