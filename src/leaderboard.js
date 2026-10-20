'use strict';

(() => {
  const table = document.getElementById('leaderboardTable');
  const headers = [...table.querySelectorAll('th[data-column]')];
  const ARIA_SORT = { asc: 'ascending', desc: 'descending' };
  const byId = (id) => document.getElementById(id);
  const seriesButtons = [...byId('chartSeries').querySelectorAll('button')];
  const totalButtons = [...byId('chartTotals').querySelectorAll('button')];
  const chartFrame = byId('chartFrame');
  const SERIES_DESCRIPTIONS = {
    invested: 'Invested energy after each round.',
    active: 'Active energy after each round.',
    battleLoss:
      'Energy lost in fights, attacking or defending, plus the invested energy on nodes the player lost.',
    inefficiencyLoss:
      'Energy that fades: 10% of active energy every round, overflow above a node’s capacity and the withdrawal fee.',
    production: 'Energy the player’s nodes produce: 1 per node plus 10% of its invested energy.',
    nodes: 'Nodes the player owns after each round.',
  };
  const SERIES_TITLES = Object.fromEntries(
    seriesButtons.map((button) => [button.dataset.series, button.textContent]),
  );
  const isYou = (player) => player === 0;
  let history = null;
  let hoveredRound = null;

  for (const header of headers)
    header.querySelector('.sort').onclick = () => store.sortLeaderboard(header.dataset.column);
  for (const button of seriesButtons)
    button.onclick = () => store.setLeaderboardChart({ series: button.dataset.series });
  for (const button of totalButtons)
    button.onclick = () =>
      store.setLeaderboardChart({ runningTotal: button.dataset.runningTotal === 'true' });

  store.subscribe(({ match, ui }, previous) => {
    const shown = ui.view === 'leaderboard';
    const changed =
      match !== previous.match ||
      ui.leaderboardSort !== previous.ui.leaderboardSort ||
      ui.leaderboardChart !== previous.ui.leaderboardChart ||
      ui.view !== previous.ui.view;
    if (shown && changed) {
      renderTable(match, ui.leaderboardSort);
      renderCharts(match, ui.leaderboardChart);
    }
  });
  let drawnWidth = 0;
  new ResizeObserver(() => {
    const { match, ui } = store.getSnapshot();
    if (ui.view === 'leaderboard' && chartFrame.clientWidth !== drawnWidth)
      renderChart(match, ui.leaderboardChart);
  }).observe(chartFrame);

  function renderTable(match, sort) {
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
    row.classList.toggle('is-you', isYou(standing.player));
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
    cell.append(swatch, playerLabel(standing.player));
    return cell;
  }

  function numberCell(text) {
    const cell = document.createElement('td');
    cell.textContent = text;
    return cell;
  }

  function playerLabel(player) {
    const name = GameEngine.playerName(player);
    return isYou(player) ? name + ' (you)' : name;
  }

  function renderCharts(match, chart) {
    history = match.replay ? GameStore.selectors.playerHistory(match, history) : null;
    for (const button of seriesButtons)
      button.setAttribute('aria-pressed', String(button.dataset.series === chart.series));
    byId('chartTotals').hidden = !GameStore.selectors.isFlowSeries(chart.series);
    for (const button of totalButtons)
      button.setAttribute(
        'aria-pressed',
        String(button.dataset.runningTotal === String(chart.runningTotal)),
      );
    byId('chartPlayers').replaceChildren(
      ...Array.from({ length: match.map.playerCount }, (_, player) =>
        playerButton(player, chart.focus),
      ),
    );
    byId('chartDescription').textContent = SERIES_DESCRIPTIONS[chart.series];
    renderChart(match, chart);
  }

  function playerButton(player, focus) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.player = player;
    button.setAttribute('aria-pressed', String(focus === player));
    button.onclick = () => store.setLeaderboardChart({ focus: focus === player ? null : player });
    const key = document.createElement('span');
    key.className = 'line-key';
    key.style.borderColor = GameEngine.playerColor(player);
    button.append(key, playerLabel(player));
    return button;
  }

  function renderChart(match, chart) {
    const empty = emptyChartNote(history);
    byId('chartEmpty').textContent = empty;
    byId('chartEmpty').hidden = !empty;
    chartFrame.hidden = Boolean(empty);
    drawnWidth = chartFrame.clientWidth;
    if (empty || !drawnWidth) return;
    const lines = GameStore.selectors.chartLines(history, chart);
    const rounds = history.rounds.map((round) => round.round);
    if (hoveredRound !== null && hoveredRound >= rounds.length) hoveredRound = null;
    chartFrame.replaceChildren(...lineChart({ lines, rounds, chart, width: drawnWidth }));
  }

  function emptyChartNote(history) {
    if (!history)
      return 'This match was saved before the game kept a history of its rounds, so it has no graphs.';
    if (!history.rounds.length) return 'The graphs start after the first round.';
    return '';
  }

  const SVG = 'http://www.w3.org/2000/svg';
  const MARGIN = { left: 44, right: 12, top: 10, bottom: 24 };

  function lineChart({ lines, rounds, chart, width }) {
    const height = width < 520 ? 240 : 320;
    const whole = chart.series === 'nodes';
    const ticks = valueTicks(Math.max(0, ...lines.flat()), whole);
    const scale = {
      x: (i) =>
        MARGIN.left +
        (rounds.length === 1 ? 0.5 : i / (rounds.length - 1)) *
          (width - MARGIN.left - MARGIN.right),
      y: (value) => MARGIN.top + (1 - value / ticks.at(-1)) * (height - MARGIN.top - MARGIN.bottom),
    };
    const svg = svgElement('svg', {
      viewBox: `0 0 ${width} ${height}`,
      width,
      height,
      tabindex: 0,
      role: 'img',
      'aria-label': `${SERIES_TITLES[chart.series]} of every player over ${rounds.length} rounds. Use the arrow keys to read a round.`,
    });
    svg.append(
      ...valueAxis(ticks, scale, width),
      ...roundAxis(rounds, scale, height, width),
      ...drawingOrder(lines, chart.focus).map((player) =>
        playerLine(player, lines[player], scale, chart.focus),
      ),
    );
    const crosshair = svgElement('g', { class: 'chart-crosshair' });
    svg.append(crosshair);
    const readout = document.createElement('div');
    readout.className = 'chart-readout';
    readout.hidden = true;
    const showRound = (index) => {
      hoveredRound = index;
      drawCrosshair({ crosshair, readout, lines, rounds, chart, scale, height, width });
    };
    listenForRounds(svg, rounds, scale, width, showRound);
    showRound(hoveredRound);
    return [svg, readout];
  }

  function valueTicks(max, whole) {
    if (max <= 0) return [0, 1];
    const step = Math.max(whole ? 1 : 0, niceStep(max / 4, [1, 2, 2.5, 5, 10]));
    return Array.from({ length: Math.ceil(max / step) + 1 }, (_, i) =>
      Number((i * step).toPrecision(6)),
    );
  }

  function niceStep(rough, multiples) {
    const magnitude = 10 ** Math.floor(Math.log10(rough));
    return multiples.map((m) => m * magnitude).find((candidate) => candidate >= rough);
  }

  function valueAxis(ticks, scale, width) {
    return ticks.flatMap((tick) => [
      svgElement('line', {
        class: tick === 0 ? 'chart-baseline' : 'chart-grid',
        x1: MARGIN.left,
        x2: width - MARGIN.right,
        y1: scale.y(tick),
        y2: scale.y(tick),
      }),
      svgText(tickLabel(tick), { x: MARGIN.left - 6, y: scale.y(tick) + 4, 'text-anchor': 'end' }),
    ]);
  }

  const tickLabel = (tick) => (tick >= 1000 ? EnergyFormat.compactEnergy(tick) : String(tick));

  function roundAxis(rounds, scale, height, width) {
    const most = Math.max(2, Math.floor((width - MARGIN.left - MARGIN.right) / 56));
    const step = Math.max(1, niceStep(rounds.length / most, [1, 2, 5, 10]));
    return rounds.flatMap((round, i) =>
      i === 0 || round % step === 0
        ? [svgText(String(round), { x: scale.x(i), y: height - 6, 'text-anchor': 'middle' })]
        : [],
    );
  }

  function drawingOrder(lines, focus) {
    const players = lines.map((_, player) => player);
    return focus === null ? players : [...players.filter((p) => p !== focus), focus];
  }

  function playerLine(player, values, scale, focus) {
    const group = svgElement('g', {
      class: 'chart-line',
      'data-player': player,
      opacity: focus === null || focus === player ? 1 : 0.2,
    });
    const color = GameEngine.playerColor(player);
    group.append(
      svgElement('path', {
        d: values.map((value, i) => `${i ? 'L' : 'M'}${scale.x(i)} ${scale.y(value)}`).join(''),
        stroke: color,
      }),
    );
    if (values.length)
      group.append(
        svgElement('circle', {
          class: 'chart-end',
          cx: scale.x(values.length - 1),
          cy: scale.y(values.at(-1)),
          r: 4,
          fill: color,
        }),
      );
    return group;
  }

  function listenForRounds(svg, rounds, scale, width, showRound) {
    const roundAt = (event) => {
      const box = svg.getBoundingClientRect();
      const x = ((event.clientX - box.left) / box.width) * width;
      const share = (x - MARGIN.left) / (width - MARGIN.left - MARGIN.right);
      return Math.min(rounds.length - 1, Math.max(0, Math.round(share * (rounds.length - 1))));
    };
    svg.addEventListener('pointermove', (event) => showRound(roundAt(event)));
    svg.addEventListener('pointerdown', (event) => showRound(roundAt(event)));
    svg.addEventListener('pointerleave', (event) => {
      if (event.pointerType === 'mouse') showRound(null);
    });
    svg.addEventListener('blur', () => showRound(null));
    svg.addEventListener('keydown', (event) => {
      const last = rounds.length - 1;
      const current = hoveredRound ?? last;
      const next = {
        ArrowLeft: Math.max(0, current - 1),
        ArrowRight: Math.min(last, current + 1),
        Home: 0,
        End: last,
        Escape: null,
      }[event.key];
      if (next === undefined) return;
      event.preventDefault();
      showRound(next);
    });
  }

  function drawCrosshair({ crosshair, readout, lines, rounds, chart, scale, height, width }) {
    crosshair.replaceChildren();
    readout.hidden = hoveredRound === null;
    if (hoveredRound === null) return;
    const x = scale.x(hoveredRound);
    crosshair.append(
      svgElement('line', { x1: x, x2: x, y1: MARGIN.top, y2: height - MARGIN.bottom }),
      ...lines.flatMap((values, player) =>
        hoveredRound < values.length && (chart.focus === null || chart.focus === player)
          ? [
              svgElement('circle', {
                cx: x,
                cy: scale.y(values[hoveredRound]),
                r: 4,
                fill: GameEngine.playerColor(player),
              }),
            ]
          : [],
      ),
    );
    fillReadout(readout, lines, rounds[hoveredRound], chart);
    const room = width - x - 16;
    readout.style.left = room > readout.offsetWidth ? x + 12 + 'px' : '';
    readout.style.right = room > readout.offsetWidth ? '' : width - x + 12 + 'px';
  }

  function fillReadout(readout, lines, round, chart) {
    const index = hoveredRound;
    const head = document.createElement('div');
    head.className = 'chart-readout-head';
    head.textContent = `Round ${round} · ${SERIES_TITLES[chart.series]}`;
    const rows = lines
      .map((values, player) => ({ player, value: values[index] }))
      .sort((a, b) => (b.value ?? -Infinity) - (a.value ?? -Infinity))
      .map(({ player, value }) => readoutRow(player, value, chart.series));
    readout.replaceChildren(head, ...rows);
  }

  function readoutRow(player, value, series) {
    const row = document.createElement('div');
    row.className = 'chart-readout-row';
    row.dataset.player = player;
    const key = document.createElement('span');
    key.className = 'line-key';
    key.style.borderColor = GameEngine.playerColor(player);
    const amount = document.createElement('b');
    const name = document.createElement('span');
    if (value === undefined) {
      row.classList.add('is-out');
      amount.textContent = '—';
      name.textContent = playerLabel(player) + ' · out';
    } else {
      amount.textContent = series === 'nodes' ? String(value) : EnergyFormat.compactEnergy(value);
      name.textContent = playerLabel(player);
    }
    row.append(key, amount, name);
    return row;
  }

  function svgElement(name, attributes) {
    const element = document.createElementNS(SVG, name);
    for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
    return element;
  }

  function svgText(text, attributes) {
    const element = svgElement('text', attributes);
    element.textContent = text;
    return element;
  }
})();
