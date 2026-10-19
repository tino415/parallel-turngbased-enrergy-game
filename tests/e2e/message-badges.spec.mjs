import { test, expect } from '@playwright/test';

test('Messages shows each player name, Neutral included, as a badge in its map colour', async ({
  page,
}) => {
  await page.goto('/');
  await page.evaluate(() => {
    store.replaceMatch({
      ...store.getSnapshot().match,
      history: ['Round 1 · Node 6: Red attacks Neutral with 5 vs 1. Captured!', 'You are Blue.'],
    });
    render();
  });
  await page.locator('#messagesTab').click();
  const badges = page.locator('#messagesView .player-badge');
  await expect(badges).toHaveText(['Red', 'Neutral', 'Blue']);
  const colours = await badges.evaluateAll((elements) =>
    elements.map((element) => getComputedStyle(element).backgroundColor),
  );
  expect(colours).toEqual(['rgb(204, 98, 85)', 'rgb(118, 128, 146)', 'rgb(50, 120, 200)']);
  await expect(page.locator('#messagesView .log > div').first()).toHaveText(
    'Round 1 · Node 6: Red attacks Neutral with 5 vs 1. Captured!',
  );
});
