'use strict';

(() => {
  const PLAY_INTERVAL_MS = 900;
  const SVG = 'http://www.w3.org/2000/svg';
  const byId = (id) => document.getElementById(id);

  const dialog = document.createElement('dialog');
  dialog.id = 'replayDialog';
  dialog.setAttribute('aria-label', 'Replay');
  dialog.innerHTML = `
    <header class="replay-header">
      <strong id="replayRound"></strong>
      <span id="replayStandings" class="replay-standings"></span>
      <button id="replayClose" type="button">Close ×</button>
    </header>
    <div class="replay-body">
      <svg id="replayMap" preserveAspectRatio="xMidYMid meet"></svg>
      <section class="replay-log" aria-label="Round log">
        <p id="replayNode" class="muted"></p>
        <div id="replayLog" class="log"></div>
      </section>
    </div>
    <nav class="replay-bar" aria-label="Replay controls">
      <button id="replayFirst" type="button" aria-label="First round">⏮</button>
      <button id="replayBack" type="button" aria-label="Previous round">◀</button>
      <button id="replayPlay" type="button"></button>
      <button id="replayForward" type="button" aria-label="Next round">▶</button>
      <button id="replayLast" type="button" aria-label="Last round">⏭</button>
      <input id="replayScrubber" type="range" min="0" step="1" aria-label="Round" />
    </nav>`;
  document.body.append(dialog);

  const notice = document.createElement('section');
  notice.id = 'gameOverNotice';
  notice.hidden = true;
  notice.setAttribute('aria-live', 'polite');
  notice.innerHTML = `
    <p id="gameOverText"></p>
    <div class="game-over-actions">
      <button id="watchReplay" class="primary" type="button">Watch replay</button>
      <button id="dismissGameOver" type="button"></button>
      <button id="gameOverNewGame" type="button">New game</button>
    </div>`;
  document.body.append(notice);

  const menuItem = document.createElement('button');
  menuItem.type = 'button';
  menuItem.id = 'menuReplay';
  menuItem.textContent = 'Replay';
  document.querySelector('#tacticalMenu .tactical-menu-content').append(menuItem);

  let framesOf = { replay: null, frames: [] };
  let inspectedNode = null;
  let dismissed = { map: null, outcome: null };
  let playTimer = null;

  menuItem.onclick = () => {
    byId('tacticalMenu').open = false;
    store.openReplay();
  };
  byId('watchReplay').onclick = () => store.openReplay();
  byId('dismissGameOver').onclick = () => {
    const { match } = store.getSnapshot();
    dismissed = { map: match.map, outcome: outcomeOf(match) };
    renderNotice(match);
  };
  byId('gameOverNewGame').onclick = () => byId('reset').click();
  byId('replayClose').onclick = () => store.closeReplay();
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    store.closeReplay();
  });
  const step = (delta) => store.showReplayFrame(store.getSnapshot().ui.replay.frame + delta);
  byId('replayFirst').onclick = () => store.showReplayFrame(0);
  byId('replayBack').onclick = () => step(-1);
  byId('replayPlay').onclick = () => store.toggleReplayPlaying();
  byId('replayForward').onclick = () => step(1);
  byId('replayLast').onclick = () => store.showReplayFrame(Infinity);
  byId('replayScrubber').oninput = (event) => store.showReplayFrame(Number(event.target.value));
  dialog.addEventListener('keydown', (event) => {
    if (handledNatively(event)) return;
    const keys = {
      ArrowLeft: () => step(-1),
      ArrowRight: () => step(1),
      Home: () => store.showReplayFrame(0),
      End: () => store.showReplayFrame(Infinity),
      ' ': () => store.toggleReplayPlaying(),
    };
    if (!keys[event.key]) return;
    event.preventDefault();
    keys[event.key]();
  });

  function handledNatively(event) {
    if (event.target.id === 'replayScrubber') return event.key !== ' ';
    return event.target.tagName === 'BUTTON' && (event.key === ' ' || event.key === 'Enter');
  }

  store.subscribe((snapshot, previous) => {
    if (snapshot.match !== previous.match) renderNotice(snapshot.match);
    if (snapshot.ui.replay !== previous.ui.replay || snapshot.match !== previous.match)
      renderReplay(snapshot.match, snapshot.ui.replay);
  });
  renderNotice(store.getSnapshot().match);

  function renderNotice(match) {
    const outcome = outcomeOf(match);
    menuItem.hidden = !match.replay;
    notice.hidden = outcome === null || isDismissed(match, outcome);
    if (notice.hidden) return;
    byId('gameOverText').textContent = outcomeText(match);
    byId('watchReplay').hidden = !match.replay;
    byId('dismissGameOver').textContent = match.state.finished ? 'Close' : 'Keep watching';
  }

  function outcomeOf(match) {
    if (match.state.finished) return 'finished';
    if (!match.state.nodes.some((n) => n.owner === GameStore.selectors.seatOf(match)))
      return 'eliminated';
    return null;
  }

  const isDismissed = (match, outcome) =>
    dismissed.map === match.map && dismissed.outcome === outcome;

  function outcomeText(match) {
    if (!match.state.finished)
      return 'You were eliminated. The other players fight on: resolve rounds to keep watching.';
    const winner = match.state.nodes.find((n) => n.owner !== null)?.owner;
    if (winner === undefined) return 'Game over. No players remain.';
    return winner === GameStore.selectors.seatOf(match)
      ? 'Game over. You win!'
      : 'Game over. ' + playerName(winner) + ' wins.';
  }

  function renderReplay(match, replay) {
    clearTimeout(playTimer);
    if (!replay) {
      inspectedNode = null;
      if (dialog.open) dialog.close();
      return;
    }
    const frames = framesFor(match);
    const frame = frames[replay.frame];
    const last = frames.length - 1;
    byId('replayRound').textContent = roundTitle(frame, replay.frame === last, frames);
    byId('replayStandings').replaceChildren(...standings(match, frame.state));
    byId('replayPlay').textContent = replay.playing ? '❚❚ Pause' : '▶ Play';
    byId('replayFirst').disabled = byId('replayBack').disabled = replay.frame === 0;
    byId('replayForward').disabled = byId('replayLast').disabled = replay.frame === last;
    Object.assign(byId('replayScrubber'), { max: last, value: replay.frame });
    renderLog(frame, replay.frame === last, match);
    renderNodeLine(frame.state);
    drawMap(byId('replayMap'), match, frame);
    if (!dialog.open) dialog.showModal();
    if (replay.playing) playTimer = setTimeout(() => store.advanceReplay(), PLAY_INTERVAL_MS);
  }

  function framesFor(match) {
    if (framesOf.replay !== match.replay)
      framesOf = { replay: match.replay, frames: GameStore.selectors.replayFrames(match) };
    return framesOf.frames;
  }

  function roundTitle(frame, isLast, frames) {
    const lastRound = frames.at(-1).state.round;
    if (isLast && frame.state.finished) return 'Final map';
    return 'Round ' + frame.state.round + ' of ' + lastRound;
  }

  function standings(match, state) {
    return Array.from({ length: match.map.playerCount }, (_, owner) => {
      const count = state.nodes.filter((n) => n.owner === owner).length;
      const entry = document.createElement('span');
      entry.className = 'replay-standing' + (count ? '' : ' is-out');
      entry.append(playerBadge(playerName(owner)), ' ' + count);
      return entry;
    });
  }

  function renderLog(frame, isLast, match) {
    const lines = frame.events.length
      ? frame.events
      : [isLast && !match.state.finished ? 'This round is still being played.' : 'Game over.'];
    byId('replayLog').replaceChildren(...lines.map(messageEntry));
  }

  function renderNodeLine(state) {
    const node = state.nodes[inspectedNode];
    byId('replayNode').textContent = node
      ? 'Node ' +
        node.id +
        ' · ' +
        playerName(node.owner) +
        ' · Active ' +
        fmt(node.active) +
        ' · Invested ' +
        fmt(node.invested)
      : 'Tap a node to see its energy.';
  }

  function inspectReplayNode(id) {
    inspectedNode = id;
    const { match, ui } = store.getSnapshot();
    renderNodeLine(framesFor(match)[ui.replay.frame].state);
  }

  function drawMap(svg, match, frame) {
    const { xy, edges, mapSeed } = match.map;
    svg.setAttribute(
      'viewBox',
      xy.length === 14 && mapSeed === 'classic' ? '0 0 800 460' : '0 0 1800 1050',
    );
    svg.replaceChildren();
    const element = (name, attrs, parent = svg) => {
      const e = document.createElementNS(SVG, name);
      for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
      parent.append(e);
      return e;
    };
    for (const [a, b] of edges)
      element('line', {
        x1: xy[a][0],
        y1: xy[a][1],
        x2: xy[b][0],
        y2: xy[b][1],
        class: 'replay-edge',
      });
    for (const node of frame.state.nodes) drawNode(element, xy, node);
    const moves = element('g', { class: 'replay-moves' });
    for (const move of frame.moves) drawPlayerMove(element, moves, xy, 'replay', move);
  }

  function drawNode(element, xy, node) {
    const [x, y] = xy[node.id];
    const group = element('g', { class: 'replay-node', 'data-node': node.id });
    element('title', {}, group).textContent = 'Node ' + node.id + ' · ' + playerName(node.owner);
    element(
      'circle',
      { cx: x, cy: y, r: 30, fill: playerColor(node.owner), 'data-owner': node.owner ?? 'none' },
      group,
    );
    element('text', { x, y: y + 2, 'font-size': 17 }, group).textContent = compactEnergy(
      node.active,
    );
    element('text', { x, y: y + 18, 'font-size': 10 }, group).textContent =
      'I ' + compactEnergy(node.invested);
    element('text', { x, y: y + 48, 'font-size': 12 }, group).textContent = node.id;
    group.addEventListener('click', () => inspectReplayNode(node.id));
  }
})();
