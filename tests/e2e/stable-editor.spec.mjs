import {
  test,
  expect,
  inspector,
  openNodeEditor,
  openEdgeEditor,
  edgeHit,
  annotateSimulatedKeyboard,
} from './support/game.mjs';

const manualInvest = (page) => page.locator('#allocator input[data-allocation="invest"]');
const policyReserve = (page) =>
  page
    .locator('#policyEditor label')
    .filter({ hasText: 'Active defense reserve' })
    .locator('input');

async function openManualAllocations(page) {
  await openNodeEditor(page);
  await page.getByText('Manual investment, withdrawal and allocations').click();
}

async function openOtherPolicySettings(page) {
  await openNodeEditor(page);
  await page.getByText('Other policy settings').click();
}

async function track(field) {
  await field.evaluate((element) => {
    window.trackedField = element;
  });
}

function trackedFieldIsFocusedInInspector(page) {
  return page.evaluate(
    () =>
      window.trackedField.isConnected &&
      document.activeElement === window.trackedField &&
      document.getElementById('tacticalInspector').contains(window.trackedField),
  );
}

async function typeInto(field, text) {
  await field.click();
  await field.press('ControlOrMeta+a');
  await field.pressSequentially(text);
}

async function shrinkAndRestoreViewport(page) {
  const viewport = page.viewportSize();
  await page.setViewportSize({ width: viewport.width, height: viewport.height - 220 });
  await page.evaluate(() => render());
  await page.setViewportSize(viewport);
}

test('an intermediate decimal edge draft survives a render and keeps the caret', async ({
  page,
}) => {
  await openEdgeEditor(page, '0-1');
  const amount = page.locator('#tacticalEdgeAmount');
  await typeInto(amount, '2.');
  await track(amount);
  await page.evaluate(() => render());
  expect(await trackedFieldIsFocusedInInspector(page)).toBe(true);
  await page.keyboard.type('5');
  await expect(amount).toHaveValue('2.5');
  expect(await page.evaluate(() => orders[0])).toBeUndefined();
  await amount.blur();
  expect(await page.evaluate(() => orders[0].edges[1])).toBe(2.5);
});

test('an empty edge draft is not coerced while focused and commits as before on blur', async ({
  page,
}) => {
  await openEdgeEditor(page, '0-1');
  const amount = page.locator('#tacticalEdgeAmount');
  await amount.fill('1.5');
  await amount.blur();
  await amount.click();
  await amount.press('ControlOrMeta+a');
  await amount.press('Backspace');
  await track(amount);
  await page.evaluate(() => render());
  expect(await trackedFieldIsFocusedInInspector(page)).toBe(true);
  await expect(amount).toHaveValue('');
  expect(await page.evaluate(() => orders[0].edges[1])).toBe(1.5);
  await amount.blur();
  expect(await page.evaluate(() => orders[0])).toBeUndefined();
});

test('a manual allocation draft survives map and camera updates', async ({ page }) => {
  await openManualAllocations(page);
  const invest = manualInvest(page);
  await typeInto(invest, '3');
  await track(invest);
  await page.evaluate(() => render());
  await page.evaluate(() => {
    store.setCamera({ ...camera, scale: camera.scale * 1.25 });
    render();
  });
  expect(await trackedFieldIsFocusedInInspector(page)).toBe(true);
  await expect(invest).toHaveValue('3');
  expect(await page.evaluate(() => orders[0])).toBeUndefined();
  await invest.blur();
  expect(await page.evaluate(() => orders[0].invest)).toBe(3);
});

test('a manual allocation draft stays in the inspector through a simulated keyboard', async ({
  page,
}) => {
  annotateSimulatedKeyboard();
  await openManualAllocations(page);
  const invest = manualInvest(page);
  await typeInto(invest, '4');
  await track(invest);
  await shrinkAndRestoreViewport(page);
  expect(await trackedFieldIsFocusedInInspector(page)).toBe(true);
  await expect(invest).toHaveValue('4');
});

test('a manual allocation draft keeps its element across the mobile breakpoint', async ({
  page,
}) => {
  await openManualAllocations(page);
  const invest = manualInvest(page);
  await typeInto(invest, '2');
  await track(invest);
  const viewport = page.viewportSize();
  await page.setViewportSize({ width: viewport.width > 760 ? 700 : 1024, height: viewport.height });
  await page.evaluate(() => render());
  await page.setViewportSize(viewport);
  expect(await trackedFieldIsFocusedInInspector(page)).toBe(true);
  await expect(invest).toHaveValue('2');
});

test('a policy reserve draft survives a render and a simulated keyboard', async ({ page }) => {
  annotateSimulatedKeyboard();
  await openOtherPolicySettings(page);
  const reserve = policyReserve(page);
  await typeInto(reserve, '7.');
  await track(reserve);
  await shrinkAndRestoreViewport(page);
  expect(await trackedFieldIsFocusedInInspector(page)).toBe(true);
  await page.keyboard.type('5');
  await expect(reserve).toHaveValue('7.5');
  await reserve.blur();
  expect(await page.evaluate(() => policies[0].reserve)).toBe(7.5);
});

test('committing a policy field keeps focus on it and updates the other controls', async ({
  page,
}) => {
  await openOtherPolicySettings(page);
  const reserve = policyReserve(page);
  await typeInto(reserve, '9');
  await track(reserve);
  await reserve.press('Enter');
  expect(await page.evaluate(() => policies[0].reserve)).toBe(9);
  expect(await trackedFieldIsFocusedInInspector(page)).toBe(true);
  await expect(page.getByRole('checkbox', { name: 'Enable policy for node 0' })).toBeChecked();
});

test('switching connections without a tap commits the draft to its own connection', async ({
  page,
}) => {
  await openEdgeEditor(page, '0-1');
  const amount = page.locator('#tacticalEdgeAmount');
  await amount.fill('2.5');
  await edgeHit(page, '0-2').dispatchEvent('click');
  await edgeHit(page, '0-2').dispatchEvent('click');
  await expect(inspector(page)).toContainText('Connection 0 — 2');
  await expect(amount).toHaveValue('0');
  expect(await page.evaluate(() => orders[0].edges)).toEqual({ 1: 2.5 });
});

test('Escape closes the editor and commits the draft like any other blur', async ({ page }) => {
  await openEdgeEditor(page, '0-1');
  const amount = page.locator('#tacticalEdgeAmount');
  await amount.fill('2.5');
  await amount.press('Escape');
  await expect(inspector(page)).toBeHidden();
  expect(await page.evaluate(() => orders[0].edges)).toEqual({ 1: 2.5 });
  await openEdgeEditor(page, '0-1');
  await expect(amount).toHaveValue('2.5');
});
