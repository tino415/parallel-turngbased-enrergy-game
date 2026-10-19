import { test as base, expect } from '@playwright/test';

export { expect };

export const test = base.extend({
  page: async ({ page }, use) => {
    await page.addInitScript(seedMathRandom);
    page.on('dialog', (dialog) => dialog.accept());
    await page.goto('/');
    await use(page);
  },
});

export function seedMathRandom() {
  let seed = 0x2f6b1d;
  window.randomCalls = 0;
  Math.random = () => {
    window.randomCalls += 1;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const isTouchProject = (testInfo) => testInfo.project.use.hasTouch === true;
export const isMobileLayout = (testInfo) => testInfo.project.name.startsWith('mobile');

export const blueNode = (page) => page.locator('#map .node-hit[fill="#3278c8"]').first();
export const edgeHit = (page, edge) => page.locator(`.tactical-edge-hit[data-edge="${edge}"]`);
export const inspector = (page) => page.locator('#tacticalInspector');

export async function openNodeEditor(page) {
  await blueNode(page).click();
  await blueNode(page).click();
  await expect(inspector(page)).toHaveClass(/is-editing/);
  await expect(inspector(page)).toBeVisible();
}

export async function openEdgeEditor(page, edge) {
  await edgeHit(page, edge).click();
  await edgeHit(page, edge).click();
  await expect(page.locator('#tacticalEdgeAmount')).toBeVisible();
}

export function gameSnapshot(page) {
  return page.evaluate(() =>
    JSON.stringify({
      state,
      orders,
      policies,
      history,
      randomCalls,
      defaults: [autoConquer.checked, defaultReserve.value, defaultInvest.value],
    }),
  );
}

export function activeElementName(page) {
  return page.evaluate(() => {
    const element = document.activeElement;
    return element.id || element.getAttribute('aria-label') || element.tagName;
  });
}

export function annotateSimulatedKeyboard() {
  base.info().annotations.push({
    type: 'simulated keyboard',
    description:
      'A viewport height change stands in for the on-screen keyboard. Real Android Chrome stays a manual check.',
  });
}

export async function chooseSource(page, id) {
  const swap = page.locator('#tacticalSwapDirection');
  if (!(await swap.getAttribute('aria-label')).startsWith('From Node ' + id + ' '))
    await swap.click();
  await expect(swap).toHaveAttribute('aria-label', new RegExp('^From Node ' + id + ' '));
}
