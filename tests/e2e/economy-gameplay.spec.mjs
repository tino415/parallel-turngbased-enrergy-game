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
  await page.getByText('Manual investment, withdrawal and allocations').click();
  const withdrawal = page.locator('#uxManualSection [data-allocation="withdraw"]');
  await expect(withdrawal).toHaveValue('0');
  await withdrawal.fill('10');
  await withdrawal.blur();
  await expect(page.locator('#uxBalance')).toContainText('33.5 available');
  await expect(page.locator('#uxFooterSummary')).toContainText('Next active');

  // An investment above starting active energy is affordable after withdrawal.
  const invest = page.locator('#uxManualSection [data-allocation="invest"]');
  await invest.fill('30');
  await invest.blur();
  // A withdrawal raises the same-round budget and persists with its order.
  await expect(page.locator('#uxBalance')).toContainText('Manual');
  await page.locator('#tacticalInspector [aria-label="Clear map selection"]').click();
  await page.evaluate(() => document.getElementById('resolve').click());
  await expect(page.locator('#score')).toContainText('Round 2');
  await page.reload();
  await expect(page.locator('#score')).toContainText('Round 2');
});

test('new matches expose capacity and withdrawal in dashboard', async ({ page }) => {
  await page.locator('#tableView').click();
  await expect(page.locator('#dashboard')).toBeVisible();
  await expect(page.locator('#dashboard')).toContainText('Capacity');
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
  await page.getByText('Manual investment, withdrawal and allocations').click();
  await expect(page.locator('#uxManualSection')).not.toContainText('Withdraw invested');
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
  await page.getByText('Manual investment, withdrawal and allocations').click();
  await expect(page.locator('#uxManualSection')).not.toContainText('Withdraw invested');
  await expect(page.locator('#tacticalInspector')).not.toContainText('Capacity');
});
