import { test, expect, gameSnapshot } from './support/game.mjs';

const table = (page) => page.locator('#empireTable');
const rowNames = (page) => table(page).locator('tbody th').allTextContents();
const header = (page, name) => table(page).getByRole('columnheader', { name });

function expectedRows(page) {
  return page.evaluate(() =>
    Array.from({ length: playerCount }, (_, player) => {
      const nodes = state.nodes.filter((node) => node.owner === player);
      const total = (field) => nodes.reduce((sum, node) => sum + node[field], 0);
      return [
        GameEngine.playerName(player) + (player === 0 ? ' (you)' : ''),
        EnergyFormat.compactEnergy(total('invested')),
        EnergyFormat.compactEnergy(total('active')),
        String(nodes.length),
      ];
    }),
  );
}

function shownRows(page) {
  return table(page)
    .locator('tbody tr')
    .evaluateAll((rows) =>
      rows.map((row) => [...row.cells].map((cell) => cell.textContent.trim())),
    );
}

async function openEmpires(page) {
  await page.getByRole('tab', { name: 'Empires' }).click();
  await expect(page.locator('#empireView')).toBeVisible();
}

test('the Empires tab lists every player with their totals and leaves the match untouched', async ({
  page,
}) => {
  const before = await gameSnapshot(page);
  await openEmpires(page);

  await expect(page.getByRole('tab', { name: 'Empires' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#mapViewport')).toBeHidden();
  expect(await shownRows(page)).toEqual(await expectedRows(page));
  await expect(table(page).locator('tbody tr.is-you')).toHaveCount(1);

  await page.getByRole('tab', { name: 'Map' }).click();
  await expect(page.locator('#mapViewport')).toBeVisible();
  expect(await gameSnapshot(page)).toBe(before);
});

function sortedNames(page, column, direction) {
  return page.evaluate(
    (sort) =>
      GameStore.selectors
        .empireStats(store.getSnapshot().match, sort)
        .map((empire) => empire.name + (empire.player === 0 ? ' (you)' : '')),
    { column, direction },
  );
}

test('every column sorts, numbers high first, and a second tap reverses it', async ({ page }) => {
  await openEmpires(page);
  await expect(header(page, 'Player')).toHaveAttribute('aria-sort', 'ascending');
  expect(await rowNames(page)).toEqual(await sortedNames(page, 'player', 'asc'));

  for (const [name, column] of [
    ['Total invested', 'invested'],
    ['Total active energy', 'active'],
    ['Nodes', 'nodes'],
  ]) {
    await header(page, name).getByRole('button').click();
    await expect(header(page, name)).toHaveAttribute('aria-sort', 'descending');
    expect(await rowNames(page)).toEqual(await sortedNames(page, column, 'desc'));

    await header(page, name).getByRole('button').click();
    await expect(header(page, name)).toHaveAttribute('aria-sort', 'ascending');
    expect(await rowNames(page)).toEqual(await sortedNames(page, column, 'asc'));
  }

  await header(page, 'Player').getByRole('button').click();
  await expect(header(page, 'Player')).toHaveAttribute('aria-sort', 'ascending');
  await expect(header(page, 'Nodes')).not.toHaveAttribute('aria-sort', /.*/);
  await header(page, 'Player').getByRole('button').click();
  await expect(header(page, 'Player')).toHaveAttribute('aria-sort', 'descending');
  expect(await rowNames(page)).toEqual(await sortedNames(page, 'player', 'desc'));
});

test('the table follows the match after a round resolves', async ({ page }) => {
  await openEmpires(page);
  const firstRound = await shownRows(page);
  await page.locator('#uxDockResolve:visible, #resolve:visible').first().click();
  await expect.poll(() => shownRows(page)).not.toEqual(firstRound);
  expect(await shownRows(page)).toEqual(await expectedRows(page));
});

test('the table fits the screen without sideways scrolling', async ({ page }) => {
  await openEmpires(page);
  const overflow = await page.evaluate(() => {
    const view = document.getElementById('empireView');
    return {
      page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      view: view.scrollWidth - view.clientWidth,
    };
  });
  expect(overflow).toEqual({ page: 0, view: 0 });
  const headerBox = await header(page, 'Nodes').getByRole('button').boundingBox();
  expect(headerBox.height).toBeGreaterThanOrEqual(40);
});
