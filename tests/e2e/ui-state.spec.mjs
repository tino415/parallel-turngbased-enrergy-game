import {
  test,
  expect,
  blueNode,
  edgeHit,
  inspector,
  openNodeEditor,
  openEdgeEditor,
  gameSnapshot,
  isTouchProject,
  isMobileLayout,
  seedMathRandom,
} from './support/game.mjs';

async function dragMap(page, testInfo) {
  const box = await page.locator('#map').boundingBox();
  const x = box.x + box.width / 2;
  const y = box.y + Math.min(box.height, page.viewportSize().height - box.y) / 2;
  if (!isTouchProject(testInfo)) {
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 70, y + 40, { steps: 8 });
    await page.mouse.up();
    return;
  }
  const cdp = await page.context().newCDPSession(page);
  const send = (type, touchPoints) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints });
  await send('touchStart', [{ x, y }]);
  await send('touchMove', [{ x: x + 35, y: y + 20 }]);
  await send('touchMove', [{ x: x + 70, y: y + 40 }]);
  await send('touchEnd', []);
  await cdp.detach();
}

async function openFromMenu(page, label) {
  await page.locator('#tacticalMenu summary').click();
  await page.locator('#tacticalMenu button').filter({ hasText: label }).click();
}

test('the seeded fixture starts every page on the same match', async ({ page, browser }) => {
  const other = await browser.newContext();
  const second = await other.newPage();
  await second.addInitScript(seedMathRandom);
  await second.goto('/');
  const nodes = (target) => target.evaluate(() => JSON.stringify(state.nodes));
  expect(await nodes(second)).toBe(await nodes(page));
  await other.close();
});

test('UI-only interactions leave game state and RNG untouched', async ({ page }, testInfo) => {
  const before = await gameSnapshot(page);

  await openNodeEditor(page);
  await page.getByText('Other policy settings').click();
  await page.getByText('Manual investment, withdrawal and allocations').click();
  await inspector(page).getByRole('button', { name: 'Clear map selection' }).click();
  await openEdgeEditor(page, '0-1');
  await page.keyboard.press('Escape');
  await edgeHit(page, '0-2').click();

  await dragMap(page, testInfo);
  await page.locator('#zoomIn').click();
  await page.locator('#zoomOut').click();
  await page.locator('#focusMap').click();
  await page.locator('#fit').click();

  await page.locator('#messagesTab').click();
  await page.locator('#mapTab').click();

  await openFromMenu(page, 'Orders');
  await page.keyboard.press('Escape');
  await openFromMenu(page, 'Settings');
  await page.locator('#uxSettingsDialog .ux-dialog-close').click();
  if (isMobileLayout(testInfo)) {
    await page.locator('#uxDockOrders').click();
    await page.locator('#uxOrdersDialog .ux-dialog-close').click();
  }

  const viewport = page.viewportSize();
  await page.setViewportSize({ width: viewport.width, height: viewport.height - 200 });
  await page.setViewportSize(viewport);

  expect(await gameSnapshot(page)).toBe(before);
});

test('reloading without edits restores an identical match', async ({ page }) => {
  await blueNode(page).click();
  await page.locator('#zoomIn').click();
  const before = await page.evaluate(() => JSON.stringify({ state, orders, policies }));
  await page.reload();
  expect(await page.evaluate(() => JSON.stringify({ state, orders, policies }))).toBe(before);
});
