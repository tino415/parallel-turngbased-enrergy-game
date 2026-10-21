import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('new game editor shows combined capacity and can spend withdrawn reserves', async ({
  page,
}) => {
  await page.locator('#map .node-hit[fill="#3278c8"]').first().click();
  await page.locator('#map .node-hit[fill="#3278c8"]').first().click();
  await expect(page.locator('#tacticalInspector')).toContainText('Capacity');
  const withdrawal = page.locator('#tacticalInspector [data-allocation="withdraw"]');
  await expect(withdrawal).toHaveValue('0');
  await withdrawal.fill('10');
  await withdrawal.blur();

  // An investment above starting active energy is affordable after withdrawal.
  const invest = page.locator('#tacticalInspector [data-allocation="invest"]');
  await invest.fill('30');
  await invest.blur();
  await expect(invest).toHaveValue('30');
  // A withdrawal raises the same-round budget and persists with its order.
  await page.locator('#tacticalInspector [aria-label="Clear map selection"]').click();
  await page.evaluate(() => document.getElementById('resolve').click());
  await expect(page.locator('#score')).toContainText('Round 2');
  await page.reload();
  await expect(page.locator('#score')).toContainText('Round 2');
});

test('new matches expose capacity in the group member rows', async ({ page }) => {
  await page.evaluate(() => {
    const match = store.getSnapshot().match;
    const nodes = match.state.nodes.map((n) => (n.id === 1 ? { ...n, owner: 0 } : n));
    store.replaceMatch({ ...match, state: { ...match.state, nodes } });
    store.setGroupMode(true);
    store.setBulkSelection([0, 1]);
    store.setGroupEditing(true);
    render();
  });
  await expect(page.locator('.tactical-group-member-row').first()).toContainText('38 / 250');
  await expect(page.locator('#tacticalInspector')).toContainText('Overflow loss');
});

test('legacy saved games do not silently switch on new gameplay rules', async ({ page }) => {
  // The game autosaves on both pagehide and beforeunload. Editing localStorage
  // in a running page immediately before reload would be overwritten by the
  // outgoing page's autosave. Instead, migrate the saved snapshot in an init
  // script on the incoming page, before game.js reads it.
  await page.addInitScript(() => {
    const key = 'parallel-energy-game-v1';
    const raw = localStorage.getItem(key);
    if (!raw) return;
    try {
      const save = JSON.parse(raw);
      if (!save?.state?.nodes) return;
      delete save.state.rulesVersion; // Simulate a v0.8.4 autosave.
      localStorage.setItem(key, JSON.stringify(save));
    } catch {
      // Unrelated/invalid browser storage must not affect the page.
    }
  });
  await page.reload();
  await expect(page.locator('#score')).toContainText('Round 1');
  await page.locator('#map .node-hit[fill="#3278c8"]').first().click();
  await page.locator('#map .node-hit[fill="#3278c8"]').first().click();
  await expect(page.locator('#tacticalInspector')).not.toContainText('Capacity');
  await expect(page.locator('#tacticalInspector [data-allocation="withdraw"]')).toHaveCount(0);
  await expect(page.locator('#tacticalWithdrawAll')).toHaveCount(0);
  const storedVersion = await page.evaluate(
    () => JSON.parse(localStorage.getItem('parallel-energy-game-v1')).state.rulesVersion,
  );
  expect(storedVersion).toBeUndefined();

  // The old match remains on legacy rules even after round resolution.
  await page.locator('#tacticalInspector [aria-label="Clear map selection"]').click();
  await page.evaluate(() => document.getElementById('resolve').click());
  await expect(page.locator('#score')).toContainText('Round 2');
  await page.locator('#map .node-hit[fill="#3278c8"]').first().click();
  await page.locator('#map .node-hit[fill="#3278c8"]').first().click();
  await expect(page.locator('#tacticalInspector [data-allocation="withdraw"]')).toHaveCount(0);
  await expect(page.locator('#tacticalWithdrawAll')).toHaveCount(0);
  await expect(page.locator('#tacticalInspector')).not.toContainText('Capacity');
});

test('withdraw all sets the withdrawal to the whole investment like a typed amount', async ({
  page,
}) => {
  await page.locator('#map .node-hit[fill="#3278c8"]').first().click();
  await page.locator('#map .node-hit[fill="#3278c8"]').first().click();
  const withdrawal = page.locator('#tacticalInspector [data-allocation="withdraw"]');
  const invested = await page.evaluate(() => {
    const { match } = store.getSnapshot();
    return match.state.nodes.find((n) => n.id === selected).invested;
  });
  await page.locator('#tacticalWithdrawAll').click();
  await expect(withdrawal).toHaveValue(String(Number(invested.toFixed(2))));
  const typedOrder = await page.evaluate(() => structuredClone(orders[selected]));
  expect(typedOrder.withdraw).toBeCloseTo(invested);
  await withdrawal.fill('0');
  await withdrawal.blur();
  await withdrawal.fill(String(invested));
  await withdrawal.blur();
  expect(await page.evaluate(() => orders[selected])).toEqual(typedOrder);
});
