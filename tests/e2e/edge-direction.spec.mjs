import {
  test,
  expect,
  inspector,
  openEdgeEditor,
  edgeHit,
  isMobileLayout,
} from './support/game.mjs';

async function giveNodeOneToBlue(page) {
  await page.evaluate(() => {
    const match = store.getSnapshot().match;
    const nodes = match.state.nodes.map((n) => (n.id === 1 ? { ...n, owner: 0, active: 20 } : n));
    store.replaceMatch({ ...match, state: { ...match.state, nodes } });
    render();
  });
}

const ring = (page, id) => page.locator(`#map .tactical-node-selected[data-ring="${id}"]`);
const arrow = (page) => page.locator('#map .tactical-edge-arrow');
const overlaps = (a, b) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

test('the map arrow and rings follow the chosen support direction', async ({ page }) => {
  await giveNodeOneToBlue(page);
  await openEdgeEditor(page, '0-1');
  await expect(arrow(page)).toHaveAttribute('data-from', '0');
  await expect(arrow(page)).toHaveAttribute('data-to', '1');
  await expect(ring(page, 0)).toHaveClass(/tactical-node-from/);
  await expect(ring(page, 1)).toHaveClass(/tactical-node-to/);
  await expect(page.locator('#map .tactical-node-tag')).toHaveText(['FROM', 'TO']);
  await page.locator('#tacticalSwapDirection').click();
  await expect(arrow(page)).toHaveAttribute('data-from', '1');
  await expect(arrow(page)).toHaveAttribute('data-to', '0');
  await expect(ring(page, 1)).toHaveClass(/tactical-node-from/);
  await expect(inspector(page)).toContainText('Support transfer · 1 → 0');
});

test('the editor names both nodes as on the map', async ({ page }) => {
  await giveNodeOneToBlue(page);
  await openEdgeEditor(page, '0-1');
  const chips = inspector(page).locator('.tactical-node-chip');
  await expect(chips).toHaveCount(2);
  await expect(chips.nth(0)).toContainText('Node 0');
  await expect(chips.nth(0)).toContainText(/Node 0 *[0-9]/);
  await expect(chips.nth(1)).toContainText('20.0');
  await expect(chips.nth(1)).toContainText('Node 1');
  await page.keyboard.press('Escape');
  await openEdgeEditor(page, '0-2');
  await expect(chips.nth(1)).toContainText(/Node 2.*(Neutral|Red)/);
  await expect(page.locator('#tacticalSwapDirection')).toHaveCount(0);
  await expect(arrow(page)).toHaveAttribute('data-to', '2');
});

test('swapping by keyboard keeps focus on the swap button and announces the direction', async ({
  page,
}) => {
  await giveNodeOneToBlue(page);
  await openEdgeEditor(page, '0-1');
  const swap = page.locator('#tacticalSwapDirection');
  await swap.focus();
  await page.keyboard.press('Enter');
  await expect(swap).toBeFocused();
  await expect(swap).toHaveAttribute('aria-label', 'From Node 1 to Node 0. Swap direction');
  await expect(page.locator('#tacticalDirectionStatus')).toHaveText('From Node 1 to Node 0');
  await expect(page.locator('#tacticalDirectionStatus')).toHaveAttribute('aria-live', 'polite');
  await page.keyboard.press('Space');
  await expect(swap).toBeFocused();
  await expect(page.locator('#tacticalDirectionStatus')).toHaveText('From Node 0 to Node 1');
});

for (const edge of ['0-1', '0-2']) {
  test(`the desktop editor opens beside connection ${edge}, not over it`, async ({
    page,
  }, testInfo) => {
    test.skip(isMobileLayout(testInfo), 'Phones use the bottom drawer');
    await giveNodeOneToBlue(page);
    await openEdgeEditor(page, edge);
    const editor = await inspector(page).boundingBox();
    for (const id of edge.split('-')) {
      const box = await ring(page, id).boundingBox();
      expect(overlaps(box, editor), `node ${id} is under the editor`).toBe(false);
    }
  });
}

test('opening and closing a connection editor leaves the map zoom and position alone', async ({
  page,
}) => {
  await giveNodeOneToBlue(page);
  const before = await page.evaluate(() => ({ ...camera }));
  await openEdgeEditor(page, '0-1');
  expect(await page.evaluate(() => ({ ...camera }))).toEqual(before);
  await page.keyboard.press('Escape');
  await expect(inspector(page)).toBeHidden();
  expect(await page.evaluate(() => ({ ...camera }))).toEqual(before);
});

test('the map swap button flips the direction before the editor opens', async ({ page }) => {
  await giveNodeOneToBlue(page);
  await edgeHit(page, '0-1').click();
  await expect(inspector(page)).toBeHidden();
  const swap = page.locator('#map .tactical-map-swap');
  await expect(swap).toHaveAttribute('aria-label', 'Swap direction: from Node 0 to Node 1');
  await swap.click();
  await expect(arrow(page)).toHaveAttribute('data-from', '1');
  await expect(inspector(page)).toBeHidden();
  await edgeHit(page, '0-1').click();
  await expect(inspector(page)).toContainText('Support transfer · 1 → 0');
});

test('the map swap button works from the keyboard and keeps focus', async ({ page }) => {
  await giveNodeOneToBlue(page);
  await edgeHit(page, '0-1').focus();
  await page.keyboard.press('Enter');
  const swap = page.locator('#map .tactical-map-swap');
  await swap.focus();
  await page.keyboard.press('Enter');
  await expect(arrow(page)).toHaveAttribute('data-from', '1');
  await expect(page.locator('#map .tactical-map-swap')).toBeFocused();
  await expect(page.locator('#map .tactical-map-swap')).toHaveAttribute(
    'aria-label',
    'Swap direction: from Node 1 to Node 0',
  );
});

test('an attack connection has no map swap button', async ({ page }) => {
  await edgeHit(page, '0-2').click();
  await expect(arrow(page)).toHaveAttribute('data-to', '2');
  await expect(page.locator('#map .tactical-map-swap')).toHaveCount(0);
});
