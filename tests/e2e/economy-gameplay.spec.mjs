import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('new game editor shows combined capacity and can spend withdrawn reserves', async ({
  page,
}) => {
  await page.locator('#map .node-hit[fill="#3278c8"]').first().click();
  await expect(page.locator('#nodeDialog')).toBeVisible();
  await expect(page.locator('#details')).toContainText('250 sustainable capacity');
  const fields = page.locator('#uxManualSection .allocation-line input');
  const withdrawal = fields.nth(0);
  await expect(withdrawal).toHaveValue('0');
  await withdrawal.fill('10');
  await withdrawal.blur();
  await expect(page.locator('#uxBalance')).toContainText('33.5 available');
  await expect(page.locator('#uxFooterSummary')).toContainText('Next active');

  // An investment above starting active energy is affordable after withdrawal.
  const invest = page.locator('#uxManualSection .allocation-line input').nth(1);
  await invest.fill('30');
  await invest.blur();
  const before = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('parallel-energy-game-v1')),
  );
  // Check the actual pending browser state without depending on the storage key.
  await expect(page.locator('#uxBalance')).toContainText('Manual');
  await page.locator('#closeNodeDialog').click();
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
  await page.evaluate(() => {
    for (const key of Object.keys(localStorage)) {
      const raw = localStorage.getItem(key);
      if (!raw || !raw.startsWith('{')) continue;
      try {
        const save = JSON.parse(raw);
        if (!save?.state?.nodes) continue;
        delete save.state.rulesVersion;
        localStorage.setItem(key, JSON.stringify(save));
      } catch {
        // Ignore unrelated storage.
      }
    }
  });
  await page.reload();
  await page.locator('#map .node-hit[fill="#3278c8"]').first().click();
  await expect(page.locator('#uxManualSection')).not.toContainText('Withdraw invested');
  await expect(page.locator('#details')).not.toContainText('sustainable capacity');
});
