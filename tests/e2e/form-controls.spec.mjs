import { test, expect } from './support/game.mjs';

const heightOf = async (locator) => (await locator.boundingBox()).height;

async function openNewGameDialog(page) {
  await page.getByLabel('More actions').click();
  await page.getByRole('button', { name: 'New game' }).click();
  const dialog = page.locator('#newGameDialog');
  await expect(dialog).toBeVisible();
  return dialog;
}

test('New game selects are as tall as its inputs', async ({ page }) => {
  const dialog = await openNewGameDialog(page);
  const inputHeight = await heightOf(dialog.locator('#nodeCount'));
  for (const id of ['#seed', '#playerCount', '#density']) {
    expect(await heightOf(dialog.locator(id)), id).toBe(inputHeight);
  }
});

test('every select drops the native menulist so WebKit honours its height', async ({ page }) => {
  await openNewGameDialog(page);
  const appearances = await page
    .locator('select')
    .evaluateAll((selects) => selects.map((select) => getComputedStyle(select).appearance));
  expect(appearances.length).toBeGreaterThan(0);
  for (const appearance of appearances) expect(appearance).toBe('none');
});
