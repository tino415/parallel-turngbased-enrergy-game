'use strict';
const { buildMap, playerColor, playerName, playerOwners, SOFT_CAP_RULES } = GameEngine;
const { selectors } = GameStore;
const store = GameStore.createStore();
let state, orders, policies, history, xy, edges, N, playerCount, mapSeed;
let { view: currentView, clipboard, selected, camera } = store.getSnapshot().ui;
store.subscribe((snapshot, previous) => {
  ({ view: currentView, clipboard, selected, camera } = snapshot.ui);
  if (!GameStore.changed(snapshot, previous, (s) => s.match)) return;
  ({ state, orders, policies, history } = snapshot.match);
  ({ xy, edges, N, playerCount, mapSeed } = snapshot.match.map);
  if (previous !== null) saveGame();
});
store.subscribe(drawGame);
const currentMatch = () => store.getSnapshot().match;
const neighbors = (i) => selectors.neighbors(currentMatch(), i);
const isMine = (id) => selectors.isOwn(currentMatch(), id);
const mySeat = () => selectors.seatOf(currentMatch());
const $ = (id) => document.getElementById(id),
  { compactEnergy, exactEnergy } = EnergyFormat,
  fmt = exactEnergy;
const softCapEnabled = () => selectors.softCapEnabled(currentMatch());
const withdrawal = (source, p) => selectors.withdrawal(currentMatch(), source, p);
const availableEnergy = (source, p) => selectors.availableEnergy(currentMatch(), source, p);
function domDefaults() {
  return {
    enabled: $('autoConquer').checked,
    reserve: $('defaultReserve').value,
    invest: $('defaultInvest').value,
  };
}
function fresh() {
  store.batch(() => {
    store.select(null);
    store.replaceMatch(GameStore.classicMatch(Math.random, domDefaults()));
    store.setCamera({ x: 0, y: 0, scale: 1 });
  });
}
function mapOptions() {
  return {
    count: Math.max(10, Math.min(120, Number($('nodeCount').value) || 30)),
    players: Number($('playerCount').value),
    density: $('density').value,
    seed: $('seed').value || 'energy-42',
  };
}
function chosenSeat() {
  return Number($('seat').value) || 0;
}
function offerSeats() {
  const chosen = chosenSeat();
  $('seat').replaceChildren(
    ...GameEngine.playerOwners.slice(0, -1).map((owner) => {
      const option = document.createElement('option');
      option.value = owner;
      option.textContent = playerName(owner);
      option.selected = owner === chosen;
      return option;
    }),
  );
}
function previewMap() {
  const options = mapOptions(),
    map = buildMap(options),
    nodes = GameEngine.recoloured(map.nodes, GameEngine.coloursFor(chosenSeat(), options.players));
  drawMapPreview($('newGamePreview'), map.positions, map.links, nodes);
  $('previewCaption').textContent = mapCaption(options, map.links.length);
}
function mapCaption({ count, players, seed }, links) {
  return count + ' nodes · ' + players + ' players · ' + links + ' links · seed ' + seed;
}
function drawMapPreview(svg, positions, links, nodes) {
  const ns = 'http://www.w3.org/2000/svg';
  svg.replaceChildren();
  const element = (name, attrs) => {
    const e = document.createElementNS(ns, name);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    svg.append(e);
    return e;
  };
  for (const [a, b] of links)
    element('line', {
      x1: positions[a][0],
      y1: positions[a][1],
      x2: positions[b][0],
      y2: positions[b][1],
      stroke: '#75859b',
      'stroke-width': 3,
      opacity: '.65',
    });
  for (const n of nodes) {
    const [cx, cy] = positions[n.id];
    element('circle', {
      cx,
      cy,
      r: 24,
      fill: playerColor(n.owner),
      stroke: '#e0e9fa',
      'stroke-width': 2,
    });
  }
}
function generate() {
  store.batch(() => {
    store.select(null);
    store.replaceMatch(
      GameStore.generatedMatch(buildMap(mapOptions()), domDefaults(), Math.random, chosenSeat()),
    );
    store.setCamera({ x: 0, y: 0, scale: 1 });
    store.setView('map');
  });
  $('newGameDialog').close();
}
function openNewGame() {
  offerSeats();
  previewMap();
  $('newGameDialog').showModal();
}

const plan = (source) => selectors.plan(currentMatch(), source);
const allocated = (source, p) => selectors.allocated(currentMatch(), source, p);
const replacedSupport = (source, destination) =>
  selectors.replacedSupport(currentMatch(), source, destination);
const defaultPolicy = selectors.defaultPolicy;
function policyOrders(source) {
  return selectors.policyOrders(currentMatch(), source);
}
function updateChildrenInPlace(parent, nextChildren) {
  let index = 0;
  for (const next of nextChildren) {
    const match = reusableChild(parent, index, next);
    if (match) {
      while (parent.childNodes[index] !== match) parent.childNodes[index].remove();
      updateInPlace(match, next);
    } else parent.insertBefore(next, parent.childNodes[index] ?? null);
    index++;
  }
  while (parent.childNodes.length > index) parent.lastChild.remove();
}
function reusableChild(parent, from, next) {
  for (const current of [...parent.childNodes].slice(from)) {
    if (sameControl(current, next)) return current;
    if (current.contains(document.activeElement)) return null;
  }
  return null;
}
function sameControl(current, next) {
  if (current.nodeType !== next.nodeType) return false;
  if (current.nodeType !== Node.ELEMENT_NODE) return true;
  return (
    current.tagName === next.tagName &&
    current.id === next.id &&
    current.type === next.type &&
    current.dataset.key === next.dataset.key
  );
}
function updateInPlace(current, next) {
  if (current.nodeType !== Node.ELEMENT_NODE) {
    if (current.nodeValue !== next.nodeValue) current.nodeValue = next.nodeValue;
    return;
  }
  updateAttributes(current, next);
  for (const handler of ['onclick', 'onchange', 'oninput', 'ontoggle'])
    current[handler] = next[handler] && handlerSeeingLiveState(current, next, next[handler]);
  if (!next.hasAttribute('data-mount')) updateChildrenInPlace(current, [...next.childNodes]);
  if (isDraftBeingTyped(current)) return;
  if ('checked' in next && current.checked !== next.checked) current.checked = next.checked;
  if (isFormValue(next) && current.value !== next.value) current.value = next.value;
}
function handlerSeeingLiveState(current, next, respond) {
  return (event) => {
    copyFormState(current, next);
    const before = formState(next);
    respond(event);
    const after = formState(next);
    for (const property of Object.keys(after))
      if (after[property] !== before[property]) current[property] = after[property];
  };
}
function formState(element) {
  return Object.fromEntries(
    ['value', 'checked', 'open']
      .filter((property) => property in element)
      .map((property) => [property, element[property]]),
  );
}
function copyFormState(from, to) {
  for (const [property, value] of Object.entries(formState(from)))
    if (to[property] !== value) to[property] = value;
}
function updateAttributes(current, next) {
  for (const { name } of [...current.attributes])
    if (!next.hasAttribute(name)) current.removeAttribute(name);
  for (const { name, value } of next.attributes)
    if (current.getAttribute(name) !== value) current.setAttribute(name, value);
}
function isDraftBeingTyped(element) {
  return (
    element === document.activeElement &&
    element.tagName === 'INPUT' &&
    ['number', 'text'].includes(element.type)
  );
}
function isFormValue(element) {
  return ['INPUT', 'SELECT', 'TEXTAREA'].includes(element.tagName);
}
function renderOrders() {
  const container = $('orders');
  container.replaceChildren();
  const ids = [...new Set([...Object.keys(orders), ...Object.keys(policies)])]
    .map(Number)
    .filter(isMine)
    .sort((a, b) => a - b);
  $('orderCount').textContent = '(' + ids.length + ' nodes)';
  if (!ids.length) {
    const p = document.createElement('p');
    p.className = 'muted';
    p.textContent = 'No allocations planned.';
    container.append(p);
  }
  for (const id of ids) {
    const p = plan(id),
      row = document.createElement('div');
    row.className = 'order-row' + (selected === id ? ' order-selected' : '');
    const top = document.createElement('div');
    top.className = 'order-top';
    const choose = document.createElement('button');
    choose.textContent = 'Edit node ' + id;
    choose.onclick = () => {
      store.select(id);
      $('uxOrdersDialog').close();
      showNodeOnMobile();
    };
    const remove = document.createElement('button');
    remove.textContent = 'Clear ×';
    remove.onclick = () => {
      store.clearNodeOrders(id);
    };
    top.append(choose, remove);
    row.append(top);
    const details = document.createElement('div');
    details.className = 'muted';
    const parts = [];
    if (p.withdraw > 0) parts.push('Withdraw ' + fmt(p.withdraw));
    const scaleDown = selectors.policyWithdrawal(currentMatch(), id);
    if (scaleDown > 0) parts.push('Policy withdraws ' + fmt(scaleDown));
    for (const dest of Object.keys(policies[id]?.pressure ?? {}).map(Number)) {
      const pressure = selectors.edgePressureStatus(currentMatch(), id, dest);
      if (!pressure.pulse)
        parts.push(
          'Pressure → ' + dest + ' banked ' + fmt(pressure.bank) + ' / ' + fmt(pressure.minimum),
        );
    }
    if (p.invest > 0) parts.push('Invest ' + fmt(p.invest));
    for (const [dest, amount] of Object.entries(p.edges))
      parts.push((isMine(dest) ? 'Transfer' : 'Attack') + ' ' + dest + ': ' + fmt(amount));
    const automatic = policyOrders(id),
      spent = automatic.reduce((sum, o) => sum + o.amount, 0);
    details.textContent =
      (p.hold ? 'Policy paused · ' : '') +
      parts.join(' · ') +
      (automatic.length
        ? ' · Auto: ' +
          automatic
            .map((o) => o.type + ' ' + fmt(o.amount) + (o.dest === null ? '' : ' → ' + o.dest))
            .join(', ')
        : '') +
      ' · Defense ' +
      fmt(Math.max(0, availableEnergy(id) - allocated(id) - spent));
    row.append(details);
    container.append(row);
  }
}
function clickNode(id) {
  store.inspectNode(id);
}

function resolve() {
  if (state.finished) return;
  if (currentMatch().online) return GameOnline.endTurn();
  store.resolve();
}

function previewOrders() {
  return selectors.previewOrders(currentMatch());
}
function projection(id) {
  return selectors.projection(currentMatch(), id);
}
function renderFlows(svg, graph, element) {
  for (const o of previewOrders()) {
    if (o.dest === undefined || o.dest === null || o.amount <= 0.01) continue;
    const [ax, ay] = xy[o.source],
      [bx, by] = xy[o.dest],
      dx = bx - ax,
      dy = by - ay,
      length = Math.hypot(dx, dy) || 1;
    const fromX = ax + (dx / length) * 32,
      fromY = ay + (dy / length) * 32,
      toX = bx - (dx / length) * 35,
      toY = by - (dy / length) * 35;
    const color = o.type === 'attack' ? '#ef886a' : o.automatic ? '#31c9a0' : '#7fbeff';
    element(
      'line',
      {
        x1: fromX,
        y1: fromY,
        x2: toX,
        y2: toY,
        stroke: color,
        'stroke-width': 3,
        'stroke-dasharray': o.automatic ? '8 5' : 'none',
      },
      graph,
    );
    const arrow = element(
      'path',
      {
        d:
          'M ' +
          toX +
          ' ' +
          toY +
          ' l ' +
          ((-dx / length) * 12 - (dy / length) * 5) +
          ' ' +
          ((-dy / length) * 12 + (dx / length) * 5) +
          ' l ' +
          (dy / length) * 10 +
          ' ' +
          (-dx / length) * 10 +
          ' Z',
        fill: color,
      },
      graph,
    );
    const label = element(
      'text',
      {
        x: (ax + bx) / 2 - (dy / length) * 15,
        y: (ay + by) / 2 + (dx / length) * 15,
        class: 'flow-label',
      },
      graph,
    );
    label.textContent = compactEnergy(o.amount);
  }
  for (const n of state.nodes) {
    if (!isMine(n.id)) continue;
    const p = projection(n.id),
      [x, y] = xy[n.id];
    const t = element('text', { x, y: y + 53, 'font-size': 12, fill: '#92ebc9' }, graph);
    t.textContent = '+' + compactEnergy(p.income) + ' / I ' + compactEnergy(p.invest);
  }
}
function drawPlayerMove(element, layer, positions, kind, move) {
  const color = playerColor(move.owner);
  const marked = (part, attrs) => ({
    ...attrs,
    class: 'move-' + part + ' ' + kind + '-' + part,
    'data-source': move.source,
    'data-type': move.type,
    ...(move.type === 'invest' ? {} : { 'data-dest': move.dest }),
  });
  if (move.type === 'invest') {
    const [x, y] = positions[move.source];
    element('text', marked('label', { x, y: y - 40, fill: color }), layer).textContent =
      'I ' + compactEnergy(move.amount);
    return;
  }
  const [ax, ay] = positions[move.source],
    [bx, by] = positions[move.dest],
    length = Math.hypot(bx - ax, by - ay) || 1,
    ux = (bx - ax) / length,
    uy = (by - ay) / length;
  const along = (x, y, distance, side = 7) => [
    x + ux * distance - uy * side,
    y + uy * distance + ux * side,
  ];
  const [x1, y1] = along(ax, ay, 36),
    [x2, y2] = along(bx, by, -48),
    tip = along(bx, by, -33);
  element(
    'line',
    marked('flow', {
      x1,
      y1,
      x2,
      y2,
      stroke: color,
      'stroke-width': 4,
      'stroke-dasharray': move.type === 'attack' ? 'none' : '3 5',
    }),
    layer,
  );
  element(
    'polygon',
    marked('arrow', {
      points: [tip, [x2 - uy * 7, y2 + ux * 7], [x2 + uy * 7, y2 - ux * 7]].join(' '),
      fill: color,
    }),
    layer,
  );
  const [labelX, labelY] = along(ax, ay, length * 0.35, 14);
  element('text', marked('label', { x: labelX, y: labelY, fill: color }), layer).textContent =
    (move.type === 'attack' ? '⚔ ' : '→ ') + compactEnergy(move.amount);
}
function renderViews() {
  $('mapViewport').hidden = currentView !== 'map';
  $('messagesView').hidden = currentView !== 'messages';
  $('leaderboardView').hidden = currentView !== 'leaderboard';
}
function attachNavigation() {
  const svg = $('map');
  let drag = null;
  let suppressClick = false;
  svg.addEventListener(
    'wheel',
    (e) => {
      // Normal page scrolling must not zoom the map.
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      store.setCamera({
        ...camera,
        scale: Math.max(0.3, Math.min(5, camera.scale * (e.deltaY < 0 ? 1.12 : 0.89))),
      });
    },
    { passive: false },
  );

  svg.addEventListener('pointerdown', (e) => {
    // Only an actual drag pans the map. Touch taps on nodes must remain clicks.
    suppressClick = false;
    if (e.button !== 0) return;
    const onNode = Boolean(e.target.closest('.node-hit'));
    if (e.pointerType !== 'touch' && onNode) return;
    drag = {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      ox: camera.x,
      oy: camera.y,
      panning: false,
      pointerType: e.pointerType,
    };
  });

  svg.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (!drag.panning) {
      // Avoid hijacking the browser's synthesized click from a stationary tap.
      const threshold = drag.pointerType === 'touch' ? 8 : 4;
      if (Math.hypot(dx, dy) < threshold) return;
      drag.panning = true;
      svg.setPointerCapture(e.pointerId);
    }
    const rect = svg.getBoundingClientRect();
    const factor = svg.viewBox.baseVal.width / rect.width;
    store.setCamera({ ...camera, x: drag.ox + dx * factor, y: drag.oy + dy * factor });
  });

  const stop = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    // A completed drag should not accidentally activate a node under the finger.
    if (drag.panning) suppressClick = true;
    drag = null;
    if (svg.hasPointerCapture(e.pointerId)) svg.releasePointerCapture(e.pointerId);
  };
  svg.addEventListener('pointerup', stop);
  svg.addEventListener('pointercancel', stop);
  window.addEventListener('pointerup', stop);
  svg.addEventListener(
    'click',
    (e) => {
      if (!suppressClick) return;
      suppressClick = false;
      e.preventDefault();
      e.stopImmediatePropagation();
    },
    true,
  );
}

function showNodeOnMobile() {
  if (selected === null) return;
  store.editSelectedNode();
}

const SAVE_KEY = 'parallel-energy-game-v1';
function switchView(view) {
  store.setView(view);
}
function setActiveTab() {
  for (const [id, view] of [
    ['mapTab', 'map'],
    ['messagesTab', 'messages'],
    ['leaderboardTab', 'leaderboard'],
  ]) {
    const button = $(id);
    button.classList.toggle('active', view === currentView);
    button.setAttribute('aria-selected', String(view === currentView));
  }
  for (const id of ['fit', 'zoomIn', 'zoomOut']) $(id).hidden = currentView !== 'map';
}
function saveGame() {
  if (!state || currentMatch().online) return;
  const save = GameStore.saveFromMatch(currentMatch(), store.getSnapshot().ui.selected);
  try {
    writeSave(save);
  } catch (e) {
    console.warn('Autosave without the replay, it does not fit', e);
    tryWriteSave({ ...save, replay: null });
  }
}
function tryWriteSave(save) {
  try {
    writeSave(save);
  } catch (e) {
    console.warn('Autosave unavailable', e);
  }
}
function writeSave(save) {
  localStorage.setItem(SAVE_KEY, JSON.stringify(save));
}
function restoreGame() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return false;
    const save = JSON.parse(raw),
      match = GameStore.matchFromSave(save, domDefaults());
    if (!match) return false;
    // Always recover an existing match; New Game is the explicit way to replace it.
    $('autoConquer').checked = match.defaults.enabled;
    $('defaultReserve').value = match.defaults.reserve;
    $('defaultInvest').value = match.defaults.invest;
    store.batch(() => {
      store.select(save.selected ?? null);
      store.replaceMatch({ ...match, defaults: domDefaults() });
    });
    return true;
  } catch (e) {
    console.warn('Could not restore save', e);
    return false;
  }
}
for (const id of ['autoConquer', 'defaultReserve', 'defaultInvest'])
  $(id).addEventListener('change', () => store.setDefaults(domDefaults()));
window.addEventListener('beforeunload', (event) => {
  if (!state || state.finished || currentMatch().online) return;
  saveGame();
  event.preventDefault();
  event.returnValue = '';
});
window.addEventListener('pagehide', saveGame);

function render() {
  store.refresh();
}
function drawGame(snapshot, previous) {
  if (!snapshot.match) return;
  const changed = (read) => GameStore.changed(snapshot, previous, read);
  if (changed((s) => s.ui.camera)) moveCamera();
  if (changed((s) => s.match)) renderScore();
  if (
    currentView === 'map' &&
    [(s) => s.match, (s) => s.ui.view, (s) => s.ui.aiDebug].some(changed)
  )
    renderMap();
  if (changed((s) => s.match) || changed((s) => s.ui.selected)) renderOrders();
  if (changed((s) => s.ui.view)) {
    renderViews();
    setActiveTab();
  }
  if (changed((s) => s.match?.history)) renderLog();
}
function renderScore() {
  const nodes = state.nodes,
    mine = nodes.filter((n) => isMine(n.id)).length,
    opponents = nodes.filter((n) => n.owner !== null && !isMine(n.id)).length;
  $('scoreRound').textContent = 'Round ' + state.round;
  $('scoreCounts').textContent =
    ' · ' + playerName(mySeat()) + ' ' + mine + ' · Opponents ' + opponents;
  $('resolve').disabled = state.finished;
}
let lostMapFocus = null;
function takeLostMapFocus() {
  const focused = lostMapFocus;
  lostMapFocus = null;
  return focused;
}
function mapItemSelector(element) {
  if (!$('map').contains(element)) return null;
  if (element.dataset.node !== undefined) return '[data-node="' + element.dataset.node + '"]';
  if (element.dataset.edge !== undefined) return '[data-edge="' + element.dataset.edge + '"]';
  if (element.classList.contains('tactical-map-swap')) return '.tactical-map-swap';
  return null;
}
function renderMap() {
  const nodes = state.nodes;
  const svg = $('map');
  lostMapFocus = mapItemSelector(document.activeElement) ?? lostMapFocus;
  svg.innerHTML = '';
  svg.setAttribute(
    'viewBox',
    xy.length === 14 && mapSeed === 'classic' ? '0 0 800 460' : '0 0 1800 1050',
  );
  const ns = 'http://www.w3.org/2000/svg';
  const element = (name, attrs, parent = svg) => {
    const e = document.createElementNS(ns, name);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    parent.append(e);
    return e;
  };
  const graph = element('g', { transform: cameraTransform() });
  for (const [a, b] of edges)
    element(
      'line',
      {
        x1: xy[a][0],
        y1: xy[a][1],
        x2: xy[b][0],
        y2: xy[b][1],
        stroke: '#71849d',
        'stroke-width': 3,
        opacity: 0.55,
      },
      graph,
    );
  for (const n of nodes) {
    const [x, y] = xy[n.id],
      group = element('g', {}, graph);
    element('title', {}, group).textContent = nodeTooltip(n);
    const cir = element(
      'circle',
      {
        cx: x,
        cy: y,
        r: 30,
        fill: playerColor(n.owner),
        // The modal identifies the node under inspection; a map selection
        // ring would be hidden behind that modal and adds no useful feedback.
        class: 'node node-hit' + (orders[n.id] ? ' node-ordered' : ''),
        'data-node': n.id,
        tabindex: 0,
        role: 'button',
        'aria-label': 'Select node ' + n.id,
      },
      group,
    );
    const t = element('text', { x, y: y + 2, 'font-size': 17 }, group);
    t.textContent = compactEnergy(n.active);
    const t2 = element('text', { x, y: y + 18, 'font-size': 10 }, group);
    t2.textContent = 'I ' + compactEnergy(n.invested);
    const t3 = element('text', { x, y: y - 40, 'font-size': 12 }, group);
    t3.textContent = n.id;
    group.style.cursor = 'pointer';
    group.addEventListener('click', () => clickNode(n.id));
    cir.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      clickNode(n.id);
    });
  }
  renderFlows(svg, graph, element);
}
function cameraTransform() {
  return 'translate(' + camera.x + ' ' + camera.y + ') scale(' + camera.scale + ')';
}
function moveCamera() {
  $('map').querySelector('g')?.setAttribute('transform', cameraTransform());
}
function renderLog() {
  $('log').replaceChildren(...history.map(messageEntry));
}
const ownerByPlayerName = new Map(playerOwners.map((owner) => [playerName(owner), owner]));
const playerNamePattern = new RegExp('\\b(' + [...ownerByPlayerName.keys()].join('|') + ')\\b');
function messageEntry(line) {
  const entry = document.createElement('div');
  const parts = line.split(playerNamePattern);
  entry.append(...parts.map((part, index) => (index % 2 === 1 ? playerBadge(part) : part)));
  return entry;
}
function playerBadge(name) {
  const badge = document.createElement('span');
  badge.className = 'player-badge';
  badge.style.background = playerColor(ownerByPlayerName.get(name));
  badge.textContent = name;
  return badge;
}
function nodeTooltip(n) {
  const lines = ['Node ' + n.id, 'Active ' + fmt(n.active), 'Invested ' + fmt(n.invested)];
  if (isMine(n.id)) {
    const p = projection(n.id);
    lines.push('Next round income +' + fmt(p.income), 'Next round investment ' + fmt(p.invest));
  }
  return lines.join('\n');
}
$('clearAll').onclick = () => {
  store.clearAllOrders();
};
$('resolve').onclick = resolve;
$('reset').onclick = openNewGame;
$('generate').onclick = () => {
  if (
    state.round > 1 &&
    !confirm(
      'Start a new game? Your current match will be replaced (autosave will also be replaced).',
    )
  )
    return;
  generate();
};
for (const id of ['nodeCount', 'playerCount', 'density', 'seed', 'seat'])
  $(id).addEventListener('input', previewMap);
$('cancelNewGame').onclick = () => $('newGameDialog').close();
$('mapTab').onclick = () => switchView('map');
$('messagesTab').onclick = () => switchView('messages');
$('leaderboardTab').onclick = () => switchView('leaderboard');
document.addEventListener(
  'keydown',
  (event) => {
    if (event.repeat || isTypingOrInOverlay(event.target)) return;
    const shortcut = keyboardShortcutOf(event);
    if (!shortcut) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    $(shortcut).click();
  },
  true,
);
function keyboardShortcutOf(event) {
  const modified = event.ctrlKey || event.metaKey;
  if (event.altKey || event.shiftKey) return null;
  if (event.key === 'Enter' && modified) return 'resolve';
  if (event.code !== 'KeyM' || modified) return null;
  return currentView === 'map' ? 'messagesTab' : 'mapTab';
}
function isTypingOrInOverlay(target) {
  if (document.querySelector('dialog[open], :popover-open')) return true;
  return Boolean(target.closest?.('input, textarea, select, [contenteditable]'));
}
$('zoomIn').onclick = () => {
  store.setCamera({ ...camera, scale: Math.min(5, camera.scale * 1.25) });
};
$('zoomOut').onclick = () => {
  store.setCamera({ ...camera, scale: Math.max(0.3, camera.scale / 1.25) });
};
$('fit').onclick = () => {
  store.setCamera({ x: 0, y: 0, scale: 1 });
};
if (!restoreGame()) fresh();
attachNavigation();
