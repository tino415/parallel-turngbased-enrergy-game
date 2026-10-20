import { test, expect, inspector, openNodeEditor, openEdgeEditor } from './support/game.mjs';

async function giveNodeOneToRed(page) {
  await page.evaluate(() => {
    const match = store.getSnapshot().match;
    const nodes = match.state.nodes.map((n) => (n.id === 1 ? { ...n, owner: 1, active: 4 } : n));
    store.replaceMatch({ ...match, state: { ...match.state, nodes } });
    render();
  });
}

const row = (page, label) =>
  inspector(page)
    .locator('.tactical-editor-row')
    .filter({
      has: page.locator('.tactical-row-label', { hasText: new RegExp('^' + label + '$') }),
    });

async function expectEveryRowInsideTheInspector(page) {
  const panel = await inspector(page).boundingBox();
  const rows = inspector(page).locator('.tactical-editor-row');
  expect(await rows.count()).toBeGreaterThan(0);
  for (const element of await rows.all()) {
    await element.scrollIntoViewIfNeeded();
    expect(await element.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    for (const control of await element.locator('input, button').all()) {
      const box = await control.boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(panel.x);
      expect(box.x + box.width).toBeLessThanOrEqual(panel.x + panel.width + 0.5);
    }
  }
}

test('the defense floor is edited in the Defense row', async ({ page }) => {
  await openNodeEditor(page);
  const floor = row(page, 'Defense').getByRole('spinbutton', { name: 'Defense floor' });
  await expect(floor).toBeVisible();
  await floor.fill('12');
  await floor.blur();
  expect(await page.evaluate(() => policies[0].reserve)).toBe(12);
  await expect(row(page, 'Defense').getByRole('spinbutton')).toHaveCount(3);
});

test('the node editor has no dropdown and no collapsed section', async ({ page }) => {
  await openNodeEditor(page);
  await expect(inspector(page).locator('select')).toHaveCount(0);
  await expect(inspector(page).locator('details')).toHaveCount(0);
  await expect(row(page, 'Invest').getByRole('spinbutton')).toHaveCount(3);
  await expect(row(page, 'This round').getByRole('spinbutton')).toHaveCount(2);
});

test('a help button opens its explanation and Escape closes only the explanation', async ({
  page,
}) => {
  await openNodeEditor(page);
  const about = inspector(page).getByRole('button', { name: 'About defense floor' });
  const popover = page.locator('#tacticalHelp-defense-floor');
  await expect(popover).toBeHidden();
  await about.click();
  await expect(popover).toBeVisible();
  await expect(popover).toContainText('Active energy the policy never spends.');
  await page.keyboard.press('Escape');
  await expect(popover).toBeHidden();
  await expect(inspector(page)).toBeVisible();
});

test('the node editor rows fit inside the inspector', async ({ page }) => {
  await openNodeEditor(page);
  await expectEveryRowInsideTheInspector(page);
});

test('the attack editor rows fit inside the inspector with pressure on', async ({ page }) => {
  await giveNodeOneToRed(page);
  await openEdgeEditor(page, '0-1');
  await page.locator('#tacticalAutoPressure').check();
  await expectEveryRowInsideTheInspector(page);
});

test('the pressure share and minimum share one row', async ({ page }) => {
  await giveNodeOneToRed(page);
  await openEdgeEditor(page, '0-1');
  await page.locator('#tacticalAutoPressure').check();
  const share = await page.locator('#tacticalEdgePressurePct').boundingBox();
  const minimum = await page.locator('#tacticalEdgePressureMin').boundingBox();
  expect(Math.abs(share.y - minimum.y)).toBeLessThan(1);
});
