import { test, expect, isMobileLayout, resolveUntilGameOver } from './support/game.mjs';

const menu = (page) => page.locator('#tacticalMenu');
const openDialogs = (page) => page.locator('dialog[open]');

async function openFromMenu(page, label) {
  await menu(page).locator('summary').click();
  await menu(page).locator('button').filter({ hasText: label }).click();
}

const MENU_DIALOGS = [
  ['Orders', '#uxOrdersDialog'],
  ['Settings', '#uxSettingsDialog'],
  ['New game', '#newGameDialog'],
];

for (const [label, dialog] of MENU_DIALOGS) {
  test(`${label} opened from the menu closes the menu`, async ({ page }) => {
    await openFromMenu(page, label);
    await expect(page.locator(dialog)).toBeVisible();
    await expect(menu(page)).not.toHaveAttribute('open', '');
  });

  test(`a click outside the ${label} dialog closes it`, async ({ page }, testInfo) => {
    test.skip(
      dialog !== '#newGameDialog' && isMobileLayout(testInfo),
      'full-screen dialog has no outside',
    );
    await openFromMenu(page, label);
    await expect(page.locator(dialog)).toBeVisible();
    await page.mouse.click(2, 2);
    await expect(openDialogs(page)).toHaveCount(0);
  });

  test(`a click inside the ${label} dialog keeps it open`, async ({ page }) => {
    await openFromMenu(page, label);
    await page.locator(`${dialog} h2`).first().click();
    await expect(page.locator(dialog)).toBeVisible();
  });
}

test('New game opened from Settings leaves only New game open', async ({ page }) => {
  await openFromMenu(page, 'Settings');
  await page.locator('#settingsNewGame').click();
  await expect(page.locator('#newGameDialog')).toBeVisible();
  await expect(page.locator('#uxSettingsDialog')).toBeHidden();
  await expect(openDialogs(page)).toHaveCount(1);
});

for (const [opener, dialog] of [
  ['#gameOverNewGame', '#newGameDialog'],
  ['#watchReplay', '#replayDialog'],
]) {
  test(`${opener} clicked while the menu is open closes the menu`, async ({ page }) => {
    await resolveUntilGameOver(page);
    await menu(page).locator('summary').click();
    await expect(menu(page)).toHaveAttribute('open', '');
    await page.locator(opener).click();
    await expect(page.locator(dialog)).toBeVisible();
    await expect(menu(page)).not.toHaveAttribute('open', '');
  });
}

test('a click outside the menu closes it', async ({ page }) => {
  await menu(page).locator('summary').click();
  await expect(menu(page)).toHaveAttribute('open', '');
  await page.mouse.click(2, 2);
  await expect(menu(page)).not.toHaveAttribute('open', '');
});

test('selecting text by dragging out onto the backdrop keeps New game open', async ({ page }) => {
  await openFromMenu(page, 'New game');
  const box = await page.locator('#seed').boundingBox();
  await page.mouse.move(box.x + 5, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(2, 2, { steps: 5 });
  await page.mouse.up();
  await expect(page.locator('#newGameDialog')).toBeVisible();
});
