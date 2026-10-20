import { test, expect, inspector, openNodeEditor } from './support/game.mjs';

const allocation = (page, kind) => page.locator(`#allocator input[data-allocation="${kind}"]`);
const inspectorHint = (page) => inspector(page).locator('#hint');

async function openManualAllocations(page) {
  await openNodeEditor(page);
  await page.getByText('Manual investment, withdrawal and allocations').click();
}

test('a negative manual amount is rejected with a message in the inspector', async ({ page }) => {
  await openManualAllocations(page);
  const invest = allocation(page, 'invest');
  await invest.fill('-1');
  await invest.press('Enter');
  await expect(inspectorHint(page)).toBeVisible();
  await expect(inspectorHint(page)).toHaveText('Invalid amount');
});

test('an over-budget manual amount is rejected with a message in the inspector', async ({
  page,
}) => {
  await openManualAllocations(page);
  const available = await page.evaluate(() => availableEnergy(selected, plan(selected)));
  const invest = allocation(page, 'invest');
  await invest.fill(String(Math.floor(available)));
  await invest.press('Enter');
  const edge = page.locator('#allocator input[data-allocation^="edge-"]').first();
  await edge.fill(String(Math.floor(available)));
  await edge.press('Enter');
  await expect(inspectorHint(page)).toBeVisible();
  await expect(inspectorHint(page)).toHaveText(/^Over budget: allocations cannot exceed /);
});
