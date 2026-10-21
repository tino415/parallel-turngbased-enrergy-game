import { test, expect, isMobileLayout } from './support/game.mjs';

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

test('opening one dialog closes the dialog that is open', async ({ page }) => {
  await openFromMenu(page, 'Orders');
  await page.evaluate(() => document.getElementById('uxSettingsDialog').showModal());
  await expect(openDialogs(page)).toHaveCount(1);
  await expect(page.locator('#uxSettingsDialog')).toBeVisible();
});

test('opening a dialog closes the open menu', async ({ page }) => {
  await menu(page).locator('summary').click();
  await expect(menu(page)).toHaveAttribute('open', '');
  await page.evaluate(() => document.getElementById('uxOrdersDialog').showModal());
  await expect(menu(page)).not.toHaveAttribute('open', '');
});

test('a click outside the menu closes it', async ({ page }) => {
  await menu(page).locator('summary').click();
  await expect(menu(page)).toHaveAttribute('open', '');
  await page.mouse.click(2, 2);
  await expect(menu(page)).not.toHaveAttribute('open', '');
});

test('opening the menu closes an open dialog', async ({ page }) => {
  await page.evaluate(() => document.getElementById('uxOrdersDialog').showModal());
  await page.evaluate(() => (document.getElementById('tacticalMenu').open = true));
  await expect(openDialogs(page)).toHaveCount(0);
});
