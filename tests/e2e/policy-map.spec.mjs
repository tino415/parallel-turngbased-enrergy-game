import { test, expect } from './support/game.mjs';

test('the map switch shows a policy route that sends nothing this round', async ({ page }) => {
  await page.evaluate(() => {
    const match = store.getSnapshot().match;
    const [a, b] = match.map.edges.find(
      ([x, y]) => match.state.nodes[x].owner === 0 || match.state.nodes[y].owner === 0,
    );
    const mine = match.state.nodes[a].owner === 0 ? a : b;
    const other = mine === a ? b : a;
    const nodes = match.state.nodes.map((n) =>
      n.id === mine || n.id === other ? { ...n, owner: 0, active: 0 } : n,
    );
    store.replaceMatch({
      ...match,
      state: { ...match.state, nodes },
      policies: {
        ...match.policies,
        [mine]: { enabled: true, reserve: 5, investPct: 40, dest: other },
      },
    });
    render();
  });
  await expect(page.locator('#map .policy-route')).toHaveCount(0);
  await page.locator('#mapValues').click();
  await expect(page.locator('#mapValues')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#map text.policy-route')).toHaveText('→ 60%');
  await page.locator('#mapValues').click();
  await expect(page.locator('#map .policy-route')).toHaveCount(0);
});
