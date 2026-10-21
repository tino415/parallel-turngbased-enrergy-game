import {
  test,
  expect,
  inspector,
  openNodeEditor,
  openEdgeEditor,
  annotateSimulatedKeyboard,
  chooseSource,
} from './support/game.mjs';

test('policy draft and focus survive a simulated keyboard shrink and restore', async ({ page }) => {
  annotateSimulatedKeyboard();
  await openNodeEditor(page);
  const percent = page.locator('#tacticalPolicyPercent');
  await percent.fill('64');
  const viewport = page.viewportSize();
  await page.setViewportSize({ width: viewport.width, height: viewport.height - 220 });
  await expect(percent).toBeFocused();
  await page.setViewportSize(viewport);
  await expect(percent).toBeFocused();
  await expect(percent).toHaveValue('64');
  await percent.blur();
  expect(await page.evaluate(() => policies[0].investPct)).toBe(64);
});

test('edge draft and focus survive crossing the mobile breakpoint both ways', async ({ page }) => {
  await openEdgeEditor(page, '0-1');
  const amount = page.locator('#tacticalEdgeAmount');
  await amount.fill('2.5');
  const viewport = page.viewportSize();
  const across = viewport.width > 760 ? 700 : 1024;
  await page.setViewportSize({ width: across, height: viewport.height });
  await expect(inspector(page)).toBeVisible();
  await expect(amount).toBeFocused();
  await page.setViewportSize(viewport);
  await expect(inspector(page)).toBeVisible();
  await expect(amount).toBeFocused();
  await expect(amount).toHaveValue('2.5');
});

test('a full render while typing keeps the draft and focus', async ({ page }) => {
  await openEdgeEditor(page, '0-1');
  const amount = page.locator('#tacticalEdgeAmount');
  await amount.fill('2.5');
  await page.evaluate(() => render());
  await expect(amount).toHaveValue('2.5', { timeout: 1000 });
  await expect(amount).toBeFocused({ timeout: 1000 });
});

test('invalid policy percent reverts to the committed value', async ({ page }) => {
  await openNodeEditor(page);
  const percent = page.locator('#tacticalPolicyPercent');
  await percent.fill('62');
  await percent.blur();
  for (const invalid of ['150', '-1']) {
    await percent.fill(invalid);
    await percent.blur();
    await expect(percent).toHaveValue('62');
  }
  expect(await page.evaluate(() => policies[0].investPct)).toBe(62);
});

test('policy slider and enable toggle commit to the node policy', async ({ page }) => {
  await openNodeEditor(page);
  const slider = page.getByRole('slider', { name: 'Investment percentage slider' });
  await slider.fill('30');
  await expect(page.locator('#tacticalPolicyPercent')).toHaveValue('30');
  expect(await page.evaluate(() => policies[0].investPct)).toBe(30);
  const enabled = page.getByRole('checkbox', { name: 'Enable policy for node 0' });
  await enabled.uncheck();
  expect(await page.evaluate(() => policies[0])).toMatchObject({ enabled: false, investPct: 30 });
  await expect(enabled).not.toBeChecked();
});

test('edge amount over budget shows an error and keeps the committed order', async ({ page }) => {
  await openEdgeEditor(page, '0-1');
  const amount = page.locator('#tacticalEdgeAmount');
  await amount.fill('1.5');
  await amount.blur();
  await amount.fill('999');
  await amount.blur();
  await expect(amount).toHaveValue('1.5');
  await expect(inspector(page)).toContainText('Amount exceeds the available allocation budget.');
  expect(await page.evaluate(() => orders[0].edges[1])).toBe(1.5);
});

test('manual investment rejects an invalid amount and keeps the valid order', async ({ page }) => {
  await openNodeEditor(page);
  const invest = inspector(page).getByRole('spinbutton', { name: 'Invest this round' });
  await invest.fill('3');
  await invest.blur();
  await expect(invest).toHaveValue('3');
  await invest.fill('-2');
  await invest.blur();
  await expect(invest).toHaveValue('3');
  expect(await page.evaluate(() => orders[0].invest)).toBe(3);
});

test('closing and reopening the editor shows committed values', async ({ page }) => {
  await openNodeEditor(page);
  await page.locator('#tacticalPolicyPercent').fill('44');
  await page.locator('#tacticalPolicyPercent').blur();
  await inspector(page).getByRole('button', { name: 'Clear map selection' }).click();
  await expect(inspector(page)).toBeHidden();
  await openNodeEditor(page);
  await expect(page.locator('#tacticalPolicyPercent')).toHaveValue('44');
});

test('committed policy, manual orders and defaults persist across reload', async ({ page }) => {
  await openNodeEditor(page);
  await page.locator('#tacticalPolicyPercent').fill('37');
  await page.locator('#tacticalPolicyPercent').blur();
  await page.keyboard.press('Escape');
  await openEdgeEditor(page, '0-1');
  await page.locator('#tacticalEdgeAmount').fill('2');
  await page.locator('#tacticalEdgeAmount').blur();
  await page.keyboard.press('Escape');
  await page.locator('#tacticalMenu summary').click();
  await page.locator('#tacticalMenu button').filter({ hasText: 'Settings' }).click();
  await page.locator('#uxSettingsDialog #defaultReserve').fill('8');
  await page.locator('#uxSettingsDialog #defaultReserve').blur();
  await page.locator('#uxSettingsDialog .ux-dialog-close').click();
  await page.evaluate(() => render());
  const before = await page.evaluate(() => ({ orders, policies }));

  await page.reload();
  expect(await page.evaluate(() => ({ orders, policies }))).toEqual(before);
  expect(await page.evaluate(() => policies[0].investPct)).toBe(37);
  await expect(page.locator('#defaultReserve')).toHaveValue('8');
  await openEdgeEditor(page, '0-1');
  await expect(page.locator('#tacticalEdgeAmount')).toHaveValue('2');
});

test('Settings closes with Escape and reopens with its values', async ({ page }) => {
  await page.locator('#tacticalMenu summary').click();
  await page.locator('#tacticalMenu button').filter({ hasText: 'Settings' }).click();
  const settings = page.locator('#uxSettingsDialog');
  await expect(settings).toBeVisible();
  await settings.locator('#defaultInvest').fill('40');
  await page.keyboard.press('Escape');
  await expect(settings).toBeHidden();
  await page.locator('#tacticalMenu summary').click();
  await page.locator('#tacticalMenu button').filter({ hasText: 'Settings' }).click();
  await expect(settings.locator('#defaultInvest')).toHaveValue('40');
});

test('Orders closes with Escape and reopens with the planned order', async ({ page }) => {
  await openEdgeEditor(page, '0-1');
  await page.locator('#tacticalEdgeAmount').fill('2');
  await page.locator('#tacticalEdgeAmount').blur();
  await page.keyboard.press('Escape');
  const ordersDialog = page.locator('#uxOrdersDialog');
  for (let round = 0; round < 2; round++) {
    await page.locator('#tacticalMenu summary').click();
    await page.locator('#tacticalMenu button').filter({ hasText: 'Orders' }).click();
    await expect(ordersDialog).toBeVisible();
    await expect(ordersDialog).toContainText('Attack 1: 2.0');
    await page.keyboard.press('Escape');
    await expect(ordersDialog).toBeHidden();
    await expect(inspector(page)).toBeHidden();
  }
});

test('the edge editor names the reverse support a new order replaces', async ({ page }) => {
  await page.evaluate(() => {
    const match = store.getSnapshot().match;
    const nodes = match.state.nodes.map((n) => (n.id === 1 ? { ...n, owner: 0, active: 20 } : n));
    store.replaceMatch({ ...match, state: { ...match.state, nodes } });
    store.setAllocation(1, 0, 3);
    store.routeSurplus(1, 0, true);
    render();
  });
  await openEdgeEditor(page, '0-1');
  await chooseSource(page, 0);
  await expect(inspector(page)).toContainText('Replaces Node 1 → 0: 3 manual');
  await expect(inspector(page)).toContainText('Replaces Node 1 → 0 surplus route');
  await page.locator('#tacticalEdgeAmount').fill('2');
  await page.locator('#tacticalEdgeAmount').press('Tab');
  expect(await page.evaluate(() => [orders[0].edges[1], orders[1]?.edges[0]])).toEqual([
    2,
    undefined,
  ]);
  await expect(inspector(page)).not.toContainText('3 manual');
});

test('Settings shows the build version, commit and date', async ({ page }) => {
  await page.locator('#tacticalMenu summary').click();
  await page.locator('#tacticalMenu button').filter({ hasText: 'Settings' }).click();
  const build = page.locator('#uxSettingsDialog #buildVersion');
  await expect(build).toBeVisible();
  await expect(build).toHaveText(
    /^Build: v\d+\.\d+\.\d+ · ([0-9a-f]{7}|unknown) · \d{4}-\d{2}-\d{2}$/,
  );
});
