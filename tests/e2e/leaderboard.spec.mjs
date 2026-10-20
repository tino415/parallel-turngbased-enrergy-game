import { test, expect, gameSnapshot } from './support/game.mjs';

const table = (page) => page.locator('#leaderboardTable');
const rowNames = (page) => table(page).locator('tbody th').allTextContents();
const COLUMNS = { Player: 'player', Invested: 'invested', Active: 'active', Nodes: 'nodes' };
const header = (page, label) => table(page).locator(`th[data-column="${COLUMNS[label]}"]`);
const sortButton = (page, label) =>
  header(page, label).getByRole('button', { name: label, exact: true });

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

async function openLeaderboard(page) {
  await page.getByRole('tab', { name: 'Leaderboard' }).click();
  await expect(page.locator('#leaderboardView')).toBeVisible();
}

test('the Leaderboard tab lists every player with their totals and leaves the match untouched', async ({
  page,
}) => {
  const before = await gameSnapshot(page);
  await openLeaderboard(page);

  await expect(page.getByRole('tab', { name: 'Leaderboard' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
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
        .leaderboard(store.getSnapshot().match, sort)
        .map((standing) => standing.name + (standing.player === 0 ? ' (you)' : '')),
    { column, direction },
  );
}

test('every column sorts, numbers high first, and a second tap reverses it', async ({ page }) => {
  await openLeaderboard(page);
  await expect(header(page, 'Player')).toHaveAttribute('aria-sort', 'ascending');
  expect(await rowNames(page)).toEqual(await sortedNames(page, 'player', 'asc'));

  for (const [name, column] of [
    ['Invested', 'invested'],
    ['Active', 'active'],
    ['Nodes', 'nodes'],
  ]) {
    await sortButton(page, name).click();
    await expect(header(page, name)).toHaveAttribute('aria-sort', 'descending');
    expect(await rowNames(page)).toEqual(await sortedNames(page, column, 'desc'));

    await sortButton(page, name).click();
    await expect(header(page, name)).toHaveAttribute('aria-sort', 'ascending');
    expect(await rowNames(page)).toEqual(await sortedNames(page, column, 'asc'));
  }

  await sortButton(page, 'Player').click();
  await expect(header(page, 'Player')).toHaveAttribute('aria-sort', 'ascending');
  await expect(header(page, 'Nodes')).not.toHaveAttribute('aria-sort', /.*/);
  await sortButton(page, 'Player').click();
  await expect(header(page, 'Player')).toHaveAttribute('aria-sort', 'descending');
  expect(await rowNames(page)).toEqual(await sortedNames(page, 'player', 'desc'));
});

test('the table follows the match after a round resolves', async ({ page }) => {
  await openLeaderboard(page);
  const firstRound = await shownRows(page);
  await page.locator('#uxDockResolve:visible, #resolve:visible').first().click();
  await expect.poll(() => shownRows(page)).not.toEqual(firstRound);
  expect(await shownRows(page)).toEqual(await expectedRows(page));
});

test('the table fits the screen without sideways scrolling', async ({ page }) => {
  await openLeaderboard(page);
  const overflow = await page.evaluate(() => {
    const view = document.getElementById('leaderboardView');
    return {
      page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      view: view.scrollWidth - view.clientWidth,
    };
  });
  expect(overflow).toEqual({ page: 0, view: 0 });
  const headerBox = await sortButton(page, 'Nodes').boundingBox();
  expect(headerBox.height).toBeGreaterThanOrEqual(40);
});

test('each header label stays on one line and lines up with its column', async ({ page }) => {
  await openLeaderboard(page);
  const layout = await table(page).evaluate((table) => {
    const textBox = (element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      return range.getClientRects();
    };
    const firstRow = table.tBodies[0].rows[0];
    return [...table.tHead.rows[0].cells].map((cell, index) => {
      const label = textBox(cell.querySelector('.sort'));
      const below = firstRow.cells[index];
      const content = index === 0 ? below.querySelector('.player-swatch') : below;
      const contentBox = index === 0 ? content.getBoundingClientRect() : textBox(content)[0];
      return {
        column: cell.dataset.column,
        lines: label.length,
        offset: Math.round(
          index === 0 ? label[0].left - contentBox.left : label[0].right - contentBox.right,
        ),
      };
    });
  });
  expect(layout).toEqual([
    { column: 'player', lines: 1, offset: 0 },
    { column: 'invested', lines: 1, offset: 0 },
    { column: 'active', lines: 1, offset: 0 },
    { column: 'nodes', lines: 1, offset: 0 },
  ]);
});

test('the question marks explain Invested and Active without sorting', async ({ page }) => {
  await openLeaderboard(page);
  for (const [label, popup, text] of [
    ['Invested', '#investedHelp', 'Each invested point earns'],
    ['Active', '#activeHelp', 'Energy the player can spend now'],
  ]) {
    await header(page, label)
      .getByRole('button', { name: `What is ${label}?` })
      .click();
    await expect(page.locator(popup)).toBeVisible();
    await expect(page.locator(popup)).toContainText(text);
    await expect(header(page, 'Player')).toHaveAttribute('aria-sort', 'ascending');
    await page.keyboard.press('Escape');
    await expect(page.locator(popup)).toBeHidden();
  }

  await header(page, 'Invested').getByRole('button', { name: 'What is Invested?' }).click();
  await expect(page.locator('#investedHelp')).toBeVisible();
  await page.locator('#leaderboardView h2').click();
  await expect(page.locator('#investedHelp')).toBeHidden();
});
