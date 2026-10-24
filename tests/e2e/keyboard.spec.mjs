import {
  test,
  blueNode,
  expect,
  inspector,
  edgeHit,
  openNodeEditor,
  activeElementName,
} from './support/game.mjs';

async function tabUntil(page, name, limit = 30) {
  for (let step = 0; step < limit; step++) {
    await page.keyboard.press('Tab');
    if ((await activeElementName(page)) === name) return;
  }
  throw new Error('Tab never reached ' + name);
}

test('Tab reaches map connections after the view tabs and Enter highlights one', async ({
  page,
}) => {
  await page.locator('#leaderboardTab').focus();
  await tabUntil(page, 'Select connection between node 0 and node 1');
  await page.keyboard.press('Enter');
  await expect(page.locator('#map .tactical-node-selected')).toHaveCount(2);
  await expect(page.locator('#map .tactical-edge-selected')).toHaveCount(1);
  await expect(inspector(page)).toBeHidden();
});

test('Space opens the editor of a highlighted connection', async ({ page }) => {
  await edgeHit(page, '0-1').click();
  await edgeHit(page, '0-1').focus();
  await page.keyboard.press(' ');
  await expect(page.locator('#tacticalEdgeAmount')).toBeVisible();
});

test('a second Enter on a connection opens its editor', async ({ page }) => {
  await edgeHit(page, '0-1').focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await expect(page.locator('#tacticalEdgeAmount')).toBeVisible({ timeout: 1000 });
});

test('map nodes are reachable from the keyboard', async ({ page }) => {
  const focusable = page.locator('#map [tabindex]');
  const names = await focusable.evaluateAll((elements) =>
    elements.map((element) => element.getAttribute('aria-label') || ''),
  );
  expect(names.filter((name) => !name.startsWith('Select connection')).length).toBeGreaterThan(0);
});

test('Escape closes the editor and leaves state untouched', async ({ page }) => {
  await openNodeEditor(page);
  const before = await page.evaluate(() => JSON.stringify({ orders, policies }));
  await page.keyboard.press('Escape');
  await expect(inspector(page)).toBeHidden();
  await expect(page.locator('#map .tactical-node-selected')).toHaveCount(0);
  expect(await page.evaluate(() => JSON.stringify({ orders, policies }))).toBe(before);
});

test('Escape returns focus to the map item that was being edited', async ({ page }) => {
  await openNodeEditor(page);
  await page.locator('#tacticalPolicyPercent').focus();
  await page.keyboard.press('Escape');
  await expect(inspector(page)).toBeHidden();
  expect(
    await page.evaluate(() => document.getElementById('map').contains(document.activeElement)),
  ).toBe(true);
});

test('Escape in a dialog opened from the ☰ menu returns focus to the menu', async ({ page }) => {
  await page.locator('#tacticalMenu summary').click();
  await page.locator('#tacticalMenu button').filter({ hasText: 'Settings' }).click();
  await expect(page.locator('#uxSettingsDialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#uxSettingsDialog')).toBeHidden();
  await expect(page.locator('#tacticalMenu summary')).toBeFocused({ timeout: 1000 });
});

test('Orders opens from the ☰ menu by keyboard and Escape returns focus to the menu', async ({
  page,
}) => {
  await page.locator('#tacticalMenu summary').focus();
  await page.keyboard.press('Enter');
  await page.locator('#tacticalMenu button').filter({ hasText: 'Orders' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#uxOrdersDialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#uxOrdersDialog')).toBeHidden();
  await expect(page.locator('#tacticalMenu summary')).toBeFocused({ timeout: 1000 });
});

test('zoom and Fit buttons work from the keyboard', async ({ page }) => {
  await page.locator('#fit').focus();
  await page.keyboard.press('Enter');
  const fitted = await page.evaluate(() => camera.scale);
  await page.locator('#zoomIn').focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => camera.scale)).toBeGreaterThan(fitted);
  await page.locator('#fit').focus();
  await page.keyboard.press(' ');
  await expect.poll(() => page.evaluate(() => camera.scale)).toBe(fitted);
});

test('M switches between the Map and Messages views', async ({ page }) => {
  await page.keyboard.press('m');
  await expect(page.locator('#messagesView')).toBeVisible();
  await expect(page.locator('#mapViewport')).toBeHidden();
  await page.keyboard.press('m');
  await expect(page.locator('#mapViewport')).toBeVisible();
  await page.locator('#leaderboardTab').click();
  await page.keyboard.press('m');
  await expect(page.locator('#mapViewport')).toBeVisible();
});

test('Ctrl+Enter resolves the round and a bare Enter does not', async ({ page }) => {
  const round = () => page.evaluate(() => state.round);
  await page.keyboard.press('Enter');
  expect(await round()).toBe(1);
  await page.keyboard.press('Control+Enter');
  expect(await round()).toBe(2);
});

test('Ctrl+Enter resolves the round while a map node has focus', async ({ page }) => {
  await blueNode(page).focus();
  await page.keyboard.press('Control+Enter');
  expect(await page.evaluate(() => state.round)).toBe(2);
});

test('Shift+M leaves the view alone', async ({ page }) => {
  await page.keyboard.press('Shift+M');
  await expect(page.locator('#mapViewport')).toBeVisible();
});

test('shortcuts do nothing while typing in a field', async ({ page }) => {
  await openNodeEditor(page);
  await inspector(page).locator('input').first().focus();
  await page.keyboard.press('m');
  await page.keyboard.press('Control+Enter');
  await expect(page.locator('#mapViewport')).toBeVisible();
  expect(await page.evaluate(() => state.round)).toBe(1);
});

test('shortcuts do nothing while a dialog is open', async ({ page }) => {
  await page.locator('#tacticalMenu summary').click();
  await page.locator('#tacticalMenu button').filter({ hasText: 'New game' }).click();
  await expect(page.locator('#newGameDialog')).toBeVisible();
  await page.locator('#cancelNewGame').focus();
  await page.keyboard.press('m');
  await page.keyboard.press('Control+Enter');
  await page.keyboard.press('Escape');
  await expect(page.locator('#mapViewport')).toBeVisible();
  expect(await page.evaluate(() => state.round)).toBe(1);
});

test('L opens the leaderboard from any view', async ({ page }) => {
  await page.keyboard.press('l');
  await expect(page.locator('#leaderboardView')).toBeVisible();
  await page.keyboard.press('m');
  await page.keyboard.press('m');
  await expect(page.locator('#messagesView')).toBeVisible();
  await page.keyboard.press('l');
  await expect(page.locator('#leaderboardView')).toBeVisible();
});

test('E opens the group editor while nodes are selected and does nothing otherwise', async ({
  page,
}) => {
  await page.keyboard.press('e');
  await expect(inspector(page)).toBeHidden();
  await page.evaluate(() => store.setGroupMode(true));
  await expect(page.locator('#tacticalGroupEdit')).toBeDisabled();
  await page.keyboard.press('e');
  expect(await page.evaluate(() => store.getSnapshot().ui.groupEditing)).toBe(false);
  await blueNode(page).click({ modifiers: ['Shift'] });
  await expect(page.locator('#tacticalGroupBar')).toContainText('1 selected');
  await page.keyboard.press('e');
  await expect(inspector(page)).toBeVisible();
  expect(await page.evaluate(() => store.getSnapshot().ui.groupEditing)).toBe(true);
});

test('E does nothing once the map gives way to another view', async ({ page }) => {
  await blueNode(page).click({ modifiers: ['Shift'] });
  await expect(page.locator('#tacticalGroupBar')).toContainText('1 selected');
  await page.keyboard.press('l');
  await page.keyboard.press('e');
  expect(await page.evaluate(() => store.getSnapshot().ui.groupEditing)).toBe(false);
});

test('E leaves a group alone while a dialog is open', async ({ page }) => {
  await blueNode(page).click({ modifiers: ['Shift'] });
  await expect(page.locator('#tacticalGroupBar')).toContainText('1 selected');
  await page.locator('#tacticalMenu summary').click();
  await page.locator('#tacticalMenu button').filter({ hasText: 'New game' }).click();
  await expect(page.locator('#newGameDialog')).toBeVisible();
  await page.locator('#cancelNewGame').focus();
  await page.keyboard.press('e');
  await page.keyboard.press('l');
  await page.keyboard.press('Escape');
  await expect(page.locator('#mapViewport')).toBeVisible();
  expect(await page.evaluate(() => store.getSnapshot().ui.groupEditing)).toBe(false);
});
