import { test, expect, openNodeEditor, inspector } from './support/game.mjs';

test.beforeEach(async ({ page }) => {
  await page.evaluate(() => {
    window.saveWrites = 0;
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'parallel-energy-game-v1') window.saveWrites += 1;
      return setItem.call(this, key, value);
    };
  });
});

const saveWrites = (page) => page.evaluate(() => window.saveWrites);

test('camera, view and inspector changes do not write the save', async ({ page }) => {
  await openNodeEditor(page);
  await inspector(page).getByRole('button', { name: 'Clear map selection' }).click();
  await page.locator('#zoomIn').click();
  await page.locator('#fit').click();
  await page.locator('#focusMap').click();
  await page.locator('#messagesTab').click();
  await page.locator('#mapTab').click();
  expect(await saveWrites(page)).toBe(0);
});

test('each committed match change writes the save once', async ({ page }) => {
  await openNodeEditor(page);
  const percent = page.locator('#tacticalPolicyPercent');
  await percent.fill('45');
  await percent.blur();
  expect(await saveWrites(page)).toBe(1);

  await page.locator('#tacticalMenu summary').click();
  await page.locator('#tacticalMenu button').filter({ hasText: 'Settings' }).click();
  await page.locator('#defaultReserve').fill('9');
  await page.locator('#defaultReserve').blur();
  expect(await saveWrites(page)).toBe(2);
  await page.locator('#uxSettingsDialog .ux-dialog-close').click();

  await page.locator('#uxDockResolve:visible, #resolve:visible').first().click();
  await expect(page.locator('#score')).toContainText('Round 2');
  expect(await saveWrites(page)).toBe(3);
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem('parallel-energy-game-v1')).defaults.reserve,
    ),
  ).toBe('9');
});
