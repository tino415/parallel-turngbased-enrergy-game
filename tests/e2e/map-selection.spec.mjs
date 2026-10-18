import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    orders[0] = { invest: 0, edges: { 1: 4 } };
    render();
  });
  await page.locator('#fit').click();
});

for (const [name, selector] of [
  ['node ID', '#map .node-hit + text + text + text'],
  ['energy', '#map .node-hit + text'],
  ['flow value', '#map .flow-label'],
]) {
  test(`desktop dragging ${name} does not select SVG text`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'Native mouse selection regression');
    const label = page.locator(selector).first();
    const box = await label.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.move(box.x + 1, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width + 50, box.y + box.height / 2 + 20, { steps: 15 });
    await page.mouse.up();
    expect(await page.evaluate(() => window.getSelection().toString())).toBe('');
  });
}

test('desktop map pans and wheel zoom remains modifier-only', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Desktop mouse gestures');
  const graph = page.locator('#map > g').first();
  const box = await page.locator('#map').boundingBox();
  const before = await graph.getAttribute('transform');
  await page.mouse.move(box.x + 10, box.y + 10);
  await page.mouse.down();
  await page.mouse.move(box.x + 80, box.y + 50, { steps: 10 });
  await page.mouse.up();
  await expect(graph).not.toHaveAttribute('transform', before);
  await expect(page.locator('#nodeDialog')).toBeHidden();
  const scale = await page.evaluate(() => camera.scale);
  await page.mouse.wheel(0, 100);
  await page.waitForTimeout(150);
  expect(await page.evaluate(() => camera.scale)).toBe(scale);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -100);
  await page.keyboard.up('Control');
  await expect.poll(() => page.evaluate(() => camera.scale)).toBeGreaterThan(scale);
  expect(await page.evaluate(() => window.getSelection().toString())).toBe('');
});

test('node clicks and editor input and text selection remain usable', async ({ page }) => {
  await page.locator('#map .node-hit[fill="#3278c8"]').first().click();
  await expect(page.locator('#tacticalInspector')).toBeHidden();
  await page.locator('#map .node-hit[fill="#3278c8"]').first().click();
  await expect(page.locator('#tacticalInspector')).toBeVisible();
  await page.getByText('Manual investment, withdrawal and allocations').click();
  const input = page.locator('#allocator input[type="number"]').first();
  await input.fill('2');
  await expect(input).toHaveValue('2');
  // Native double-click selection outside the map must still work.
  await page.locator('#tacticalInspector .tactical-inspector-head strong').dblclick();
  expect(await page.evaluate(() => window.getSelection().toString())).not.toBe('');
});
