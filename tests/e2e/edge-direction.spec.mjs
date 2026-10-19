import { test, expect, inspector, openEdgeEditor } from './support/game.mjs';

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
  await expect(chips.nth(0)).toContainText(/yours · [0-9]/);
  await expect(chips.nth(1)).toContainText('yours · 20.0');
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
  test(`both ends of connection ${edge} stay on the map and outside the editor`, async ({
    page,
  }) => {
    await giveNodeOneToBlue(page);
    await openEdgeEditor(page, edge);
    const editor = await inspector(page).boundingBox();
    const controls = await page.locator('.map-zoom-controls').boundingBox();
    const map = await page.locator('#mapViewport').boundingBox();
    for (const id of edge.split('-')) {
      const box = await ring(page, id).boundingBox();
      expect(overlaps(box, editor), `node ${id} is under the editor`).toBe(false);
      expect(overlaps(box, controls), `node ${id} is under the zoom buttons`).toBe(false);
      expect(box.x).toBeGreaterThanOrEqual(map.x);
      expect(box.y).toBeGreaterThanOrEqual(map.y);
      expect(box.x + box.width).toBeLessThanOrEqual(map.x + map.width);
      expect(box.y + box.height).toBeLessThanOrEqual(map.y + map.height);
    }
  });
}
