import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    const match = structuredClone(store.getSnapshot().match),
      { state, orders, policies } = match;
    for (const node of state.nodes) {
      if (node.owner === null) continue;
      node.active = 123456789012.3 * (1 + node.id / 7);
      node.invested = 98765432109.8 * (1 + node.id / 5);
    }
    orders[0] = { invest: 0, edges: { 1: 45678901234.5 } };
    store.replaceMatch(match);
    render();
  });
  await page.locator('#fit').click();
});

test('late-game energy reads as compact map labels', async ({ page }) => {
  const node = page.locator('#map g:has(> .node-hit)').first();
  await expect(node.locator('text').nth(0)).toHaveText('123B');
  await expect(node.locator('text').nth(1)).toHaveText('I 98.8B');
  await expect(node.locator('text').nth(2)).toHaveText('0');
  await expect(page.locator('#map .flow-label')).toHaveText('45.7B');
  await expect(page.locator('#map .ux-income-label').first()).toHaveText(/^\+[\d.]+[KMBT]? \/ I /);
});

test('node tooltip keeps the exact energy', async ({ page }) => {
  const title = page.locator('#map g:has(> .node-hit) > title').first();
  await expect(title).toContainText('Active 123,456,789,012.3');
  await expect(title).toContainText('Invested 98,765,432,109.8');
  await expect(title).toContainText('Next round income +');
});

test('node inspector keeps the exact energy', async ({ page }) => {
  const node = page.locator('#map .node-hit[fill="#3278c8"]').first();
  await node.click();
  await node.click();
  await expect(page.locator('#tacticalInspector')).toContainText('123,456,789,012.3');
});

test('large energy labels stay inside their node and clear of other node labels', async ({
  page,
}) => {
  const problems = await page.evaluate(() => {
    const overlaps = (a, b) =>
      a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    const found = [];
    for (const group of document.querySelectorAll('#map g:has(> .node-hit)')) {
      const circle = group.querySelector('.node-hit').getBoundingClientRect();
      const [active, invested] = group.querySelectorAll('text');
      for (const label of [active, invested]) {
        const box = label.getBoundingClientRect();
        if (box.left < circle.left || box.right > circle.right)
          found.push('label ' + label.textContent + ' wider than its node');
      }
    }
    const labels = [...document.querySelectorAll('#map text')];
    for (const [i, a] of labels.entries())
      for (const b of labels.slice(i + 1))
        if (
          a.parentNode !== b.parentNode &&
          overlaps(a.getBoundingClientRect(), b.getBoundingClientRect())
        )
          found.push(a.textContent + ' overlaps ' + b.textContent);
    return found;
  });
  expect(problems).toEqual([]);
});
