import { test, expect, gameSnapshot, inspector } from './support/game.mjs';

const aiFlows = (page) => page.locator('#map .ai-debug-flow');
const aiArrows = (page) => page.locator('#map .ai-debug-arrow');
const aiLabels = (page) => page.locator('#map .ai-debug-label');
const aiDebugSwitch = (page) => page.locator('#aiDebug');

async function setAiDebug(page, on) {
  await page.evaluate(() => document.getElementById('uxSettingsDialog').showModal());
  await aiDebugSwitch(page).setChecked(on);
  await page.evaluate(() => document.getElementById('uxSettingsDialog').close());
}

async function firstAiSource(page) {
  return page.evaluate(() => {
    const { orders } = GameStore.selectors.aiDebugPlan(currentMatch());
    return orders.find((o) => o.dest !== null && o.dest !== undefined)?.source ?? null;
  });
}

test('AI plans are hidden until the debug switch is turned on', async ({ page }) => {
  await expect(aiDebugSwitch(page)).not.toBeChecked();
  await expect(aiFlows(page)).toHaveCount(0);
  await expect(aiLabels(page)).toHaveCount(0);
});

test('the switch shows AI flows and an AI node plan, and hides them again', async ({ page }) => {
  const before = await gameSnapshot(page);
  await setAiDebug(page, true);

  await expect(aiFlows(page).first()).toBeVisible();
  await expect(aiArrows(page)).toHaveCount(await aiFlows(page).count());
  await expect(aiArrows(page).first()).toBeVisible();
  await expect(aiLabels(page).first()).toBeVisible();
  const source = await firstAiSource(page);
  expect(source).not.toBeNull();
  await expect(
    page.locator(`#map .ai-debug-flow[data-source="${source}"]`).first(),
  ).toHaveAttribute(
    'stroke',
    await page.evaluate((id) => GameEngine.playerColor(state.nodes[id].owner), source),
  );

  const aiNode = page.locator(`#map .node-hit[data-node="${source}"]`);
  await aiNode.dispatchEvent('click');
  await aiNode.dispatchEvent('click');
  await expect(inspector(page)).toContainText('AI plan this round');
  await expect(inspector(page).locator('.ai-debug-plan li').first()).toContainText(
    /Attack|Transfer|Invest|Withdraw/,
  );

  await setAiDebug(page, false);
  await expect(aiFlows(page)).toHaveCount(0);
  await expect(aiArrows(page)).toHaveCount(0);
  await expect(aiLabels(page)).toHaveCount(0);
  await expect(inspector(page)).not.toContainText('AI plan this round');
  expect(await gameSnapshot(page)).toBe(before);
});

test('?aidebug turns the switch on at load', async ({ page }) => {
  await page.goto('/?aidebug');
  await expect(aiDebugSwitch(page)).toBeChecked();
  await expect(aiFlows(page).first()).toBeVisible();
});
