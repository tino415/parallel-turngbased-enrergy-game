import {
  test,
  expect,
  blueNode,
  isMobileLayout,
  offsetFromVisibleMapCenter,
} from './support/game.mjs';

function headerControls(page, testInfo) {
  const selectors = isMobileLayout(testInfo)
    ? ['#score', '.view-tabs', '#tacticalMenu > summary']
    : ['#score', '.view-tabs', '#resolve', '#tacticalMenu > summary'];
  return selectors.map((selector) => page.locator('body > header').locator(selector));
}

async function bottomOf(locator) {
  const box = await locator.boundingBox();
  return box.y + box.height;
}

async function topmostNode(page) {
  const tops = await page
    .locator('#map .node-hit')
    .evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().top));
  return Math.min(...tops);
}

test('every header control sits in one line over the top of the map', async ({
  page,
}, testInfo) => {
  expect((await page.locator('#mapViewport').boundingBox()).y).toBe(0);
  const boxes = [];
  for (const control of headerControls(page, testInfo)) {
    await expect(control).toBeVisible();
    boxes.push(await control.boundingBox());
  }
  const middle = (box) => box.y + box.height / 2;
  for (const [index, box] of boxes.entries()) {
    expect(Math.abs(middle(box) - middle(boxes[0]))).toBeLessThan(4);
    if (index > 0)
      expect(box.x).toBeGreaterThanOrEqual(boxes[index - 1].x + boxes[index - 1].width);
  }
  const last = boxes.at(-1);
  expect(last.x + last.width).toBeLessThanOrEqual(page.viewportSize().width);
  if (isMobileLayout(testInfo)) await expect(page.locator('#scoreCounts')).toBeHidden();
  else await expect(page.locator('#score')).toHaveText(/^Round 1 · Blue \d+ · Opponents \d+$/);
});

test('Fit keeps every node below the header line', async ({ page }) => {
  const headerBottom = await bottomOf(page.locator('#tacticalMenu > summary'));
  await page.locator('#fit').click();
  expect(await topmostNode(page)).toBeGreaterThan(headerBottom);
});

test('Focus centers the node in the map area below the header line', async ({ page }) => {
  await page.locator('#zoomIn').click();
  await page.locator('#focusMap').click();
  const centered = await offsetFromVisibleMapCenter(page, blueNode(page));
  expect(Math.abs(centered.dx)).toBeLessThan(3);
  expect(Math.abs(centered.dy)).toBeLessThan(3);
});

test('the mobile dock has no Orders button; the ☰ menu counts planned nodes', async ({
  page,
}, testInfo) => {
  if (isMobileLayout(testInfo))
    await expect(page.locator('.ux-dock button')).toHaveText(['Select', 'Resolve round →']);
  const orders = page.locator('#tacticalMenu button').filter({ hasText: 'Orders' });
  await page.locator('#tacticalMenu summary').click();
  await expect(orders).toHaveText('Orders (0)');
  await page.evaluate(() => {
    store.setAllocation(0, 1, 3);
    render();
  });
  await expect(orders).toHaveText('Orders (1)');
});
