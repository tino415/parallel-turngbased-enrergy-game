'use strict';

(() => {
  const table = document.getElementById('leaderboardTable');
  const headers = [...table.querySelectorAll('th[data-column]')];
  const ARIA_SORT = { asc: 'ascending', desc: 'descending' };

  for (const header of headers)
    header.querySelector('.sort').onclick = () => store.sortLeaderboard(header.dataset.column);

  store.subscribe(({ match, ui }, previous) => {
    const shown = ui.view === 'leaderboard';
    const changed =
      match !== previous.match ||
      ui.leaderboardSort !== previous.ui.leaderboardSort ||
      ui.view !== previous.ui.view;
    if (shown && changed) renderLeaderboard(match, ui.leaderboardSort);
  });

  function renderLeaderboard(match, sort) {
    for (const header of headers)
      if (header.dataset.column === sort.column)
        header.setAttribute('aria-sort', ARIA_SORT[sort.direction]);
      else header.removeAttribute('aria-sort');
    table.tBodies[0].replaceChildren(
      ...GameStore.selectors.leaderboard(match, sort).map(standingRow),
    );
  }

  function standingRow(standing) {
    const row = document.createElement('tr');
    row.dataset.player = standing.player;
    row.classList.toggle('is-you', standing.player === 0);
    row.append(
      playerCell(standing),
      numberCell(EnergyFormat.compactEnergy(standing.invested)),
      numberCell(EnergyFormat.compactEnergy(standing.active)),
      numberCell(String(standing.nodes)),
    );
    return row;
  }

  function playerCell(standing) {
    const cell = document.createElement('th');
    cell.scope = 'row';
    const swatch = document.createElement('span');
    swatch.className = 'player-swatch';
    swatch.style.background = GameEngine.playerColor(standing.player);
    cell.append(swatch, standing.player === 0 ? standing.name + ' (you)' : standing.name);
    return cell;
  }

  function numberCell(text) {
    const cell = document.createElement('td');
    cell.textContent = text;
    return cell;
  }
})();
