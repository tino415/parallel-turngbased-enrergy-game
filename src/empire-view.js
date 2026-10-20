'use strict';

(() => {
  const table = document.getElementById('empireTable');
  const headers = [...table.querySelectorAll('th[data-column]')];
  const ARIA_SORT = { asc: 'ascending', desc: 'descending' };

  for (const header of headers)
    header.querySelector('button').onclick = () => store.sortEmpires(header.dataset.column);

  store.subscribe(({ match, ui }, previous) => {
    const shown = ui.view === 'empires';
    const changed =
      match !== previous.match ||
      ui.empireSort !== previous.ui.empireSort ||
      ui.view !== previous.ui.view;
    if (shown && changed) renderEmpires(match, ui.empireSort);
  });

  function renderEmpires(match, sort) {
    for (const header of headers)
      if (header.dataset.column === sort.column)
        header.setAttribute('aria-sort', ARIA_SORT[sort.direction]);
      else header.removeAttribute('aria-sort');
    table.tBodies[0].replaceChildren(
      ...GameStore.selectors.empireStats(match, sort).map(empireRow),
    );
  }

  function empireRow(empire) {
    const row = document.createElement('tr');
    row.dataset.player = empire.player;
    row.classList.toggle('is-you', empire.player === 0);
    row.append(
      playerCell(empire),
      numberCell(EnergyFormat.compactEnergy(empire.invested)),
      numberCell(EnergyFormat.compactEnergy(empire.active)),
      numberCell(String(empire.nodes)),
    );
    return row;
  }

  function playerCell(empire) {
    const cell = document.createElement('th');
    cell.scope = 'row';
    const swatch = document.createElement('span');
    swatch.className = 'empire-swatch';
    swatch.style.background = GameEngine.playerColor(empire.player);
    cell.append(swatch, empire.player === 0 ? empire.name + ' (you)' : empire.name);
    return cell;
  }

  function numberCell(text) {
    const cell = document.createElement('td');
    cell.textContent = text;
    return cell;
  }
})();
