import { test, expect, inspector, openNodeEditor } from './support/game.mjs';

const allocation = (page, kind) => inspector(page).locator(`input[data-allocation="${kind}"]`);
const roundError = (page) => inspector(page).locator('#tacticalRoundError');

test('a negative manual amount is rejected with a message in the inspector', async ({ page }) => {
  await openNodeEditor(page);
  const invest = allocation(page, 'invest');
  await invest.fill('-1');
  await invest.press('Enter');
  await expect(roundError(page)).toBeVisible();
  await expect(roundError(page)).toHaveText('Invalid amount');
});

test('an over-budget manual amount is rejected with a message in the inspector', async ({
  page,
}) => {
  await openNodeEditor(page);
  const available = await page.evaluate(() => {
    const amount = availableEnergy(selected, plan(selected));
    store.setAllocation(selected, neighbors(selected)[0], Math.floor(amount));
    render();
    return amount;
  });
  const invest = allocation(page, 'invest');
  await invest.fill(String(Math.floor(available)));
  await invest.press('Enter');
  await expect(roundError(page)).toBeVisible();
  await expect(roundError(page)).toHaveText(/^Over budget: allocations cannot exceed /);
  await expect(invest).toHaveValue('0');
});
