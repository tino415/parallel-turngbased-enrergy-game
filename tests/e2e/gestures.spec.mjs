import { test, expect, blueNode, inspector, isTouchProject } from './support/game.mjs';

async function touchscreen(page) {
  const cdp = await page.context().newCDPSession(page);
  const send = (type, touchPoints) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints });
  return {
    start: (...points) => send('touchStart', points),
    move: (...points) => send('touchMove', points),
    end: () => send('touchEnd', []),
    cancel: () => send('touchCancel', []),
    detach: () => cdp.detach(),
  };
}

async function center(locator) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

const selectionCount = (page) => page.locator('#map .tactical-node-selected').count();

test.describe('touch', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(!isTouchProject(testInfo), 'Touch gestures need a touch-enabled project');
  });

  test('drag starting on a node pans and suppresses the node click', async ({ page }) => {
    const graph = page.locator('#map > g');
    const before = await graph.getAttribute('transform');
    const { x, y } = await center(blueNode(page));
    const touch = await touchscreen(page);
    await touch.start({ x, y });
    await touch.move({ x: x + 30, y: y + 20 });
    await touch.move({ x: x + 60, y: y + 40 });
    await touch.end();
    await touch.detach();
    await expect(graph).not.toHaveAttribute('transform', before);
    expect(await selectionCount(page)).toBe(0);
    expect(await page.evaluate(() => selected)).toBeNull();
    expect(await page.evaluate(() => window.getSelection().toString())).toBe('');
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
  });

  test('a jitter under the drag threshold still selects the node', async ({ page }) => {
    const { x, y } = await center(blueNode(page));
    const touch = await touchscreen(page);
    await touch.start({ x, y });
    await touch.move({ x: x + 3, y: y + 2 });
    await touch.end();
    await touch.detach();
    await expect(page.locator('#map .tactical-node-selected')).toHaveCount(1);
  });

  test('a cancelled drag selects nothing and the next tap still works', async ({ page }) => {
    const { x, y } = await center(blueNode(page));
    const touch = await touchscreen(page);
    await touch.start({ x, y });
    await touch.move({ x: x + 40, y: y + 30 });
    await touch.cancel();
    expect(await selectionCount(page)).toBe(0);
    const node = await center(blueNode(page));
    await touch.start(node);
    await touch.end();
    await touch.detach();
    await expect(page.locator('#map .tactical-node-selected')).toHaveCount(1);
  });

  test('a cancelled pinch leaves no pinch state behind', async ({ page }) => {
    await page.locator('#fit').click();
    const { x, y } = await center(blueNode(page));
    const touch = await touchscreen(page);
    await touch.start({ x: x - 30, y }, { x: x + 30, y });
    await touch.move({ x: x - 45, y }, { x: x + 45, y });
    await touch.cancel();
    const node = await center(blueNode(page));
    await touch.start(node);
    await touch.end();
    await touch.start(node);
    await touch.end();
    await touch.detach();
    await expect(inspector(page)).toBeVisible();
  });

  test('pinching in zooms the map out', async ({ page }) => {
    await page.locator('#fit').click();
    const scale = await page.evaluate(() => camera.scale);
    const { x, y } = await center(page.locator('#map'));
    const touch = await touchscreen(page);
    await touch.start({ x: x - 80, y }, { x: x + 80, y });
    await touch.move({ x: x - 50, y }, { x: x + 50, y });
    await touch.move({ x: x - 30, y }, { x: x + 30, y });
    await touch.end();
    await touch.detach();
    await expect.poll(() => page.evaluate(() => camera.scale)).toBeLessThan(scale);
    expect(await selectionCount(page)).toBe(0);
  });
});

test.describe('mouse', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(isTouchProject(testInfo), 'Mouse drag behaviour is checked on the desktop project');
  });

  test('a drag from empty map ending on a node pans without selecting it', async ({ page }) => {
    await page.locator('#fit').click();
    const box = await page.locator('#map').boundingBox();
    const node = await center(blueNode(page));
    const graph = page.locator('#map > g');
    const before = await graph.getAttribute('transform');
    await page.mouse.move(box.x + 8, box.y + 8);
    await page.mouse.down();
    await page.mouse.move(node.x, node.y, { steps: 12 });
    await page.mouse.up();
    await expect(graph).not.toHaveAttribute('transform', before);
    expect(await selectionCount(page)).toBe(0);
    expect(await page.evaluate(() => window.getSelection().toString())).toBe('');
  });

  test('a mouse drag on the map does not close an open editor', async ({ page }) => {
    await blueNode(page).click();
    await blueNode(page).click();
    await expect(inspector(page)).toBeVisible();
    const box = await page.locator('#map').boundingBox();
    const bottom = Math.min(box.y + box.height, page.viewportSize().height) - 30;
    await page.mouse.move(box.x + 20, bottom);
    await page.mouse.down();
    await page.mouse.move(box.x + 120, bottom - 60, { steps: 10 });
    await page.mouse.up();
    await expect(inspector(page)).toBeVisible();
  });
});
