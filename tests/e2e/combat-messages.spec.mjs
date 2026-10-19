import { test, expect } from '@playwright/test';

test('Messages shows multiplayer combat labels and per-player round totals', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    store.replaceMatch({
      ...store.getSnapshot().match,
      state: {
        round: 1,
        finished: false,
        nodes: Array.from({ length: 7 }, (_, id) => ({
          id,
          owner: id === 6 ? null : id,
          active: [20, 20, 20, 1, 20, 1, 1][id],
          invested: 0,
        })),
      },
      orders: {},
      policies: {},
      history: [],
      map: {
        xy: xy.slice(0, 7),
        edges: [
          [1, 6],
          [2, 3],
          [4, 5],
        ],
        N: 7,
        playerCount: 6,
        mapSeed,
      },
    });
    render();
  });
  await page.locator('#uxDockResolve:visible, #resolve:visible').first().click();
  await page.locator('#messagesTab').click();
  const messages = page.locator('#messagesView');
  await expect(messages).toBeVisible();
  await expect(messages).toContainText('Red attacks Neutral');
  await expect(messages).toContainText('Purple attacks Orange');
  await expect(messages).toContainText('Green attacks Pink');
  const summary =
    'Blue 1 nodes / Red 2 nodes / Purple 2 nodes / Orange 0 nodes / Green 2 nodes / Pink 0 nodes.';
  await expect(messages).toContainText('Round 1 complete: ' + summary);
  // The saved player count must still include eliminated players after refresh.
  page.on('dialog', (dialog) => dialog.accept());
  await page.reload();
  await page.locator('#uxDockResolve:visible, #resolve:visible').first().click();
  await page.locator('#messagesTab').click();
  await expect(messages).toContainText('Round 2 complete: ' + summary);
});
