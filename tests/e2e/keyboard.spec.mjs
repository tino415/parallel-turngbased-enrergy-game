import {
  test,
  expect,
  inspector,
  edgeHit,
  openNodeEditor,
  isMobileLayout,
  activeElementName,
} from './support/game.mjs';

const KEYBOARD_TASK =
  'proposed Todoist task "Keyboard map selection and focus return in the contextual inspector"';

async function tabUntil(page, name, limit = 30) {
  for (let step = 0; step < limit; step++) {
    await page.keyboard.press('Tab');
    if ((await activeElementName(page)) === name) return;
  }
  throw new Error('Tab never reached ' + name);
}

test('Tab reaches map connections after the Flows filter and Enter highlights one', async ({
  page,
}) => {
  await page.locator('#overlay').focus();
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
  test.fail(true, 'render() rebuilds the SVG and focus drops to <body>; ' + KEYBOARD_TASK);
  await edgeHit(page, '0-1').focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await expect(page.locator('#tacticalEdgeAmount')).toBeVisible({ timeout: 1000 });
});

test('map nodes are reachable from the keyboard', async ({ page }) => {
  test.fail(true, 'node hits have no tabindex or role; ' + KEYBOARD_TASK);
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
  test.fail(true, 'focus lands on <body>; ' + KEYBOARD_TASK);
  await openNodeEditor(page);
  await page.locator('#tacticalPolicyPercent').focus();
  await page.keyboard.press('Escape');
  await expect(inspector(page)).toBeHidden();
  expect(
    await page.evaluate(() => document.getElementById('map').contains(document.activeElement)),
  ).toBe(true);
});

test('Escape in a dialog opened from the ☰ menu returns focus to the menu', async ({ page }) => {
  test.fail(
    true,
    'the opener sits inside the closed <details>, focus lands on <body>; ' + KEYBOARD_TASK,
  );
  await page.locator('#tacticalMenu summary').click();
  await page.locator('#tacticalMenu button').filter({ hasText: 'Settings' }).click();
  await expect(page.locator('#uxSettingsDialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#uxSettingsDialog')).toBeHidden();
  await expect(page.locator('#tacticalMenu summary')).toBeFocused({ timeout: 1000 });
});

test('Escape in Orders opened from the mobile dock returns focus to the dock', async ({
  page,
}, testInfo) => {
  test.skip(!isMobileLayout(testInfo), 'The Orders dock exists only in the mobile layout');
  await page.locator('#uxDockOrders').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#uxOrdersDialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#uxOrdersDialog')).toBeHidden();
  await expect(page.locator('#uxDockOrders')).toBeFocused();
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
