import { test, expect, inspector, openEdgeEditor } from './support/game.mjs';

async function setUpAttack(page, defense, source = 20) {
  await page.evaluate(
    ([defense, source]) => {
      const match = store.getSnapshot().match;
      const nodes = match.state.nodes.map((n) => {
        if (n.id === 0) return { ...n, owner: 0, active: source, invested: 0 };
        if (n.id === 1) return { ...n, owner: 1, active: defense };
        return n;
      });
      const policy = { enabled: true, reserve: 5, investPct: 0, dest: null };
      store.replaceMatch({
        ...match,
        state: { ...match.state, nodes },
        orders: {},
        policies: { ...match.policies, 0: policy },
      });
      render();
    },
    [defense, source],
  );
  await page.locator('#fit').click();
  await openEdgeEditor(page, '0-1');
}

const preset = (page, key) => page.locator(`#tacticalInspector [data-preset="${key}"]`);
const amount = (page) => page.evaluate(() => orders[0]?.edges[1]);

test('preset buttons fill the attack amount', async ({ page }) => {
  await setUpAttack(page, 10);
  await expect(preset(page, 'chance-100')).toHaveText('100% success attack · 15');

  await preset(page, 'chance-90').click();
  const ninety = await amount(page);
  expect(ninety).toBeGreaterThan(10);
  expect(ninety).toBeLessThan(15);
  await expect(page.locator('#tacticalEdgeAmount')).toHaveValue(String(ninety));

  await preset(page, 'chance-70').click();
  expect(await amount(page)).toBeLessThan(ninety);
  await preset(page, 'all').click();
  expect(await amount(page)).toBe(20);
  await preset(page, 'surplus').click();
  expect(await amount(page)).toBe(15);
  await preset(page, 'chance-100').click();
  expect(await amount(page)).toBe(15);
  await expect(page.locator('#tacticalPresetReasons')).toHaveCount(0);
});

test('presets the source cannot afford are disabled with the reason shown', async ({ page }) => {
  await setUpAttack(page, 17);
  await expect(preset(page, 'chance-70')).toBeEnabled();
  await expect(preset(page, 'chance-90')).toBeDisabled();
  await expect(preset(page, 'chance-100')).toBeDisabled();
  await expect(preset(page, 'all')).toBeEnabled();
  await expect(page.locator('#tacticalPresetReasons')).toContainText(
    'Node 0 can send 20, not enough for 90% (21.3) or 100% (25.5) success.',
  );
  await preset(page, 'chance-100').click({ force: true });
  expect(await amount(page)).toBeUndefined();
});

test('preset buttons stay inside the inspector', async ({ page }) => {
  await setUpAttack(page, 10);
  const panel = await inspector(page).boundingBox();
  for (const key of ['chance-70', 'chance-90', 'chance-100', 'all', 'surplus']) {
    await preset(page, key).scrollIntoViewIfNeeded();
    const box = await preset(page, key).boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(panel.x);
    expect(box.x + box.width).toBeLessThanOrEqual(panel.x + panel.width + 0.5);
  }
});

test('send all surplus is disabled when nothing is above the reserve', async ({ page }) => {
  await setUpAttack(page, 3, 4);
  await expect(preset(page, 'all')).toBeEnabled();
  await expect(preset(page, 'surplus')).toBeDisabled();
  await expect(page.locator('#tacticalPresetReasons')).toHaveText(
    'Node 0 can send 4, not enough for 100% (4.5) success. Node 0 has no energy above its reserve.',
  );
});

test('a source with no energy disables every preset', async ({ page }) => {
  await setUpAttack(page, 3, 0);
  await expect(page.locator('.tactical-order-presets button:enabled')).toHaveCount(0);
  await expect(page.locator('#tacticalPresetReasons')).toHaveText(
    'Node 0 has no energy left to send.',
  );
});
