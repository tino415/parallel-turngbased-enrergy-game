'use strict';
const { buildMap, playerColor, SOFT_CAP_RULES } = GameEngine;
const { selectors } = GameStore;
const store = GameStore.createStore();
let state, orders, policies, history, xy, edges, N, playerCount, mapSeed;
store.subscribe(({ match }, previous) => {
  if (match === previous.match) return;
  ({ state, orders, policies, history } = match);
  ({ xy, edges, N, playerCount, mapSeed } = match.map);
  saveGame();
});
const currentMatch = () => store.getSnapshot().match;
const neighbors = (i) => selectors.neighbors(currentMatch(), i);
const $ = (id) => document.getElementById(id),
  fmt = (v) => v.toFixed(1);
let clipboard = null,
  selected = null,
  camera = { x: 0, y: 0, scale: 1 },
  currentView = 'map';
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
  selected = null;
  store.replaceMatch(GameStore.classicMatch(Math.random, domDefaults()));
  camera = { x: 0, y: 0, scale: 1 };
  render();
}
function mapOptions() {
  return {
    count: Math.max(10, Math.min(120, Number($('nodeCount').value) || 30)),
    players: Number($('playerCount').value),
    density: $('density').value,
    seed: $('seed').value || 'energy-42',
  };
}
function previewMap() {
  const options = mapOptions(),
    map = buildMap(options),
    svg = $('newGamePreview'),
    ns = 'http://www.w3.org/2000/svg';
  svg.replaceChildren();
  const element = (name, attrs) => {
    const e = document.createElementNS(ns, name);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    svg.append(e);
    return e;
  };
  for (const [a, b] of map.links)
    element('line', {
      x1: map.positions[a][0],
      y1: map.positions[a][1],
      x2: map.positions[b][0],
      y2: map.positions[b][1],
      stroke: '#75859b',
      'stroke-width': 3,
      opacity: '.65',
    });
  for (const n of map.nodes) {
    const [cx, cy] = map.positions[n.id];
    element('circle', {
      cx,
      cy,
      r: 24,
      fill: playerColor(n.owner),
      stroke: '#e0e9fa',
      'stroke-width': 2,
    });
  }
  $('previewCaption').textContent =
    options.count +
    ' nodes · ' +
    options.players +
    ' players · ' +
    map.links.length +
    ' links · seed ' +
    options.seed;
}
function generate() {
  selected = null;
  store.replaceMatch(GameStore.generatedMatch(buildMap(mapOptions()), domDefaults()));
  camera = { x: 0, y: 0, scale: 1 };
  currentView = 'map';
  $('newGameDialog').close();
  render();
}
function openNewGame() {
  previewMap();
  $('newGameDialog').showModal();
}

const plan = (source) => selectors.plan(currentMatch(), source);
const allocated = (source, p) => selectors.allocated(currentMatch(), source, p);
function setAllocation(source, destination, value) {
  const before = currentMatch(),
    overBudget = store.setAllocation(source, destination, value);
  if (overBudget !== undefined)
    $('hint').textContent = 'Over budget: allocations cannot exceed ' + fmt(overBudget);
  else if (currentMatch() !== before) render();
}
function numberField(value, max, onChange) {
  const input = document.createElement('input');
  input.type = 'number';
  input.min = '0';
  input.max = String(max);
  input.step = '0.1';
  input.value = String(Number(value.toFixed(2)));
  input.addEventListener('change', () => {
    const amount = Number(input.value);
    if (!Number.isFinite(amount) || amount < 0 || amount > max + 1e-8) {
      input.value = String(Number(value.toFixed(2)));
      $('hint').textContent = 'Invalid amount';
      return;
    }
    onChange(amount);
  });
  return input;
}
function renderAllocator() {
  const container = $('allocator');
  container.replaceChildren();
  if (selected === null || state.nodes[selected].owner !== 0) return;
  const n = state.nodes[selected],
    p = plan(selected),
    used = allocated(selected),
    remain = Math.max(0, availableEnergy(selected, p) - used);
  const summary = document.createElement('div');
  summary.className = 'order-row';
  summary.textContent =
    'Allocated ' +
    fmt(used) +
    ' / ' +
    fmt(availableEnergy(selected, p)) +
    ' · Defense reserve ' +
    fmt(remain) +
    (softCapEnabled()
      ? ' · Total ' + fmt(n.active + n.invested) + ' / ' + SOFT_CAP_RULES.capacity + ' capacity'
      : '');
  container.append(summary);
  const fields = document.createElement('div');
  fields.className = 'order-row';
  const heading = document.createElement('strong');
  heading.textContent = 'Energy allocation';
  fields.append(heading);
  const makeRow = (label, amount, target) => {
    const row = document.createElement('div');
    row.className = 'allocation-line';
    const name = document.createElement('label');
    name.textContent = label;
    const max =
      target === 'withdraw' ? n.invested : Math.max(n.active, availableEnergy(selected, p));
    const input = numberField(amount, max, (value) => setAllocation(selected, target, value));
    input.dataset.allocation =
      target === null ? 'invest' : target === 'withdraw' ? 'withdraw' : 'edge-' + target;
    row.append(name, input);
    fields.append(row);
  };
  if (softCapEnabled()) {
    makeRow('Withdraw invested → active (5% fee)', withdrawal(selected, p), 'withdraw');
    const note = document.createElement('small');
    note.className = 'muted';
    note.textContent =
      'Withdrawn energy is spendable this round; overflow above ' +
      SOFT_CAP_RULES.capacity +
      ' decays ' +
      Math.round(100 * SOFT_CAP_RULES.overflowDecay) +
      '% at round end (including invested principal).';
    fields.append(note);
  }
  makeRow('Invest', p.invest, null);
  for (const dest of neighbors(selected))
    makeRow(
      (state.nodes[dest].owner === 0 ? 'Transfer' : 'Attack') + ' → Node ' + dest,
      p.edges[dest] || 0,
      dest,
    );
  container.append(fields);
  const clear = document.createElement('button');
  clear.textContent = 'Clear node allocations';
  clear.onclick = () => {
    store.clearNodeOrders(selected);
    render();
  };
  container.append(clear);
}

const defaultPolicy = selectors.defaultPolicy;
function policyOrders(source) {
  return selectors.policyOrders(currentMatch(), source);
}
function changePolicy(source, key, value) {
  store.changePolicy(source, key, value);
  render();
}
function renderPolicyEditor() {
  const container = $('policyEditor');
  container.replaceChildren();
  if (selected === null || state.nodes[selected].owner !== 0) return;
  const source = selected,
    p = { ...defaultPolicy(), enabled: false, ...policies[source] },
    box = document.createElement('div');
  box.className = 'policy-box';
  const heading = document.createElement('h3');
  heading.textContent = 'Persistent policy';
  box.append(heading);
  const actions = document.createElement('div');
  actions.className = 'policy-actions';
  function button(label, fn) {
    const b = document.createElement('button');
    b.textContent = label;
    b.onclick = fn;
    actions.append(b);
  }
  // An unconfigured node displays default values without silently activating
  // an automatic order. The Enabled checkbox or an edited field creates the
  // actual policy, so there is no separate Create policy action.
  button('Copy', () => {
    clipboard = { ...p };
    render();
  });
  if (clipboard)
    button('Paste', () => {
      store.pastePolicy(source, clipboard);
      render();
    });
  box.append(actions);
  {
    const add = (title, field) => {
      const label = document.createElement('label');
      label.textContent = title;
      label.append(field);
      box.append(label);
    };
    const enabled = document.createElement('input');
    enabled.type = 'checkbox';
    enabled.checked = p.enabled;
    enabled.onchange = () => changePolicy(source, 'enabled', enabled.checked);
    add(' Enabled every round ', enabled);
    const reserve = numberField(p.reserve, 100000, (value) =>
      changePolicy(source, 'reserve', value),
    );
    add('Active defense reserve', reserve);
    const invest = numberField(p.investPct, 100, (value) =>
      changePolicy(source, 'investPct', value),
    );
    add('Invest % of surplus', invest);
    const dest = document.createElement('select');
    for (const [value, title] of [
      ['', 'Keep remaining surplus'],
      ...neighbors(source)
        .filter((id) => state.nodes[id].owner === 0)
        .map((id) => [String(id), 'Transfer → Node ' + id]),
    ]) {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = title;
      opt.selected = (value === '' ? null : Number(value)) === p.dest;
      dest.append(opt);
    }
    dest.onchange = () =>
      changePolicy(source, 'dest', dest.value === '' ? null : Number(dest.value));
    add('Transfer destination', dest);
    const pause = document.createElement('input');
    pause.type = 'checkbox';
    pause.checked = Boolean(plan(source).hold);
    pause.onchange = () => {
      store.setHold(source, pause.checked);
      render();
    };
    add(' Pause policy this round ', pause);
  }
  const automatic = policyOrders(source),
    spent = automatic.reduce((sum, o) => sum + o.amount, 0);
  const preview = document.createElement('p');
  preview.className = 'muted';
  preview.textContent =
    'Preview: ' +
    (automatic.length
      ? automatic
          .map((o) => o.type + ' ' + fmt(o.amount) + (o.dest === null ? '' : ' → ' + o.dest))
          .join(' · ')
      : 'No automatic spending') +
    ' · Defense ' +
    fmt(Math.max(0, availableEnergy(source) - allocated(source) - spent));
  box.append(preview);
  container.append(box);
}
function renderOrders() {
  const container = $('orders');
  container.replaceChildren();
  const ids = [...new Set([...Object.keys(orders), ...Object.keys(policies)])]
    .map(Number)
    .filter((id) => state.nodes[id].owner === 0)
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
      selected = id;
      render();
    };
    const remove = document.createElement('button');
    remove.textContent = 'Clear ×';
    remove.onclick = () => {
      store.clearNodeOrders(id);
      render();
    };
    top.append(choose, remove);
    row.append(top);
    const details = document.createElement('div');
    details.className = 'muted';
    const parts = [];
    if (p.withdraw > 0) parts.push('Withdraw ' + fmt(p.withdraw));
    if (p.invest > 0) parts.push('Invest ' + fmt(p.invest));
    for (const [dest, amount] of Object.entries(p.edges))
      parts.push(
        (state.nodes[dest].owner === 0 ? 'Transfer' : 'Attack') + ' ' + dest + ': ' + fmt(amount),
      );
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
  if (state.nodes[id].owner === 0) {
    selected = id;
    render();
    showNodeOnMobile();
  } else if (selected !== null && neighbors(selected).includes(id)) {
    $('hint').textContent =
      'Set the attack amount for node ' + id + ' in the selected node allocation panel.';
  }
}

function resolve() {
  if (state.finished) return;
  store.resolve();
  render();
}

function previewOrders() {
  return selectors.previewOrders(currentMatch());
}
function projection(id) {
  return selectors.projection(currentMatch(), id);
}
function renderFlows(svg, graph, element) {
  const filter = $('overlay').value;
  if (filter === 'none') return;
  for (const o of previewOrders()) {
    if (
      (filter === 'manual' && o.automatic) ||
      (filter === 'policy' && !o.automatic) ||
      o.dest === undefined ||
      o.dest === null ||
      o.amount <= 0.01
    )
      continue;
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
    label.textContent = fmt(o.amount);
  }
  for (const n of state.nodes) {
    if (n.owner !== 0) continue;
    const p = projection(n.id),
      [x, y] = xy[n.id];
    const t = element('text', { x, y: y + 53, 'font-size': 12, fill: '#92ebc9' }, graph);
    t.textContent = '+' + fmt(p.income) + ' / I ' + fmt(p.invest);
  }
}
function renderDashboard() {
  $('mapViewport').hidden = currentView !== 'map';
  $('dashboard').hidden = currentView !== 'dashboard';
  $('messagesView').hidden = currentView !== 'messages';
  if (currentView !== 'dashboard') return;
  const dashboard = $('dashboard');
  dashboard.replaceChildren();
  const title = document.createElement('h3');
  title.textContent = 'Node dashboard — select several nodes for bulk policies';
  dashboard.append(title);
  const bulk = document.createElement('div');
  bulk.className = 'policy-box';
  bulk.innerHTML =
    '<label>Reserve <input id="bulkReserve" type="number" min="0" value="5"></label><label>Invest % <input id="bulkInvest" type="number" min="0" max="100" value="70"></label><button id="bulkApply">Apply policy to selected</button><hr><label>One-time investment energy per selected node <input id="bulkManualInvest" type="number" min="0" value="5"></label><button id="bulkManualApply">Set manual investments</button>';
  dashboard.append(bulk);
  const table = document.createElement('table'),
    head = document.createElement('tr');
  for (const h of [
    'Select',
    'Node',
    'Active',
    'Invested',
    'Income',
    'Defense',
    'Invest next',
    'Next active',
    'Invest %',
    'Reserve',
    'Policy',
  ]) {
    const th = document.createElement('th');
    th.textContent = h;
    head.append(th);
  }
  table.append(head);
  for (const n of state.nodes.filter((n) => n.owner === 0)) {
    const p = projection(n.id),
      tr = document.createElement('tr');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.dataset.node = n.id;
    checkbox.className = 'bulk-node';
    const makeCell = (child) => {
      const td = document.createElement('td');
      if (typeof child === 'string') td.textContent = child;
      else td.append(child);
      tr.append(td);
    };
    makeCell(checkbox);
    const select = document.createElement('button');
    select.textContent = n.id;
    select.onclick = () => {
      selected = n.id;
      switchView('map');
      showNodeOnMobile();
    };
    makeCell(select);
    for (const value of [n.active, n.invested, p.income, p.defense, p.invest, p.next])
      makeCell(fmt(value));
    const pct = document.createElement('input');
    pct.type = 'number';
    pct.min = 0;
    pct.max = 100;
    pct.step = 5;
    pct.value = policies[n.id]?.investPct ?? 0;
    pct.title = 'Persistent investment percentage';
    pct.onchange = () => {
      const val = Number(pct.value);
      if (!Number.isFinite(val) || val < 0 || val > 100) {
        render();
        return;
      }
      store.enablePolicyWith(n.id, { investPct: val });
      render();
    };
    makeCell(pct);
    const reserve = document.createElement('input');
    reserve.type = 'number';
    reserve.min = 0;
    reserve.step = 1;
    reserve.value = policies[n.id]?.reserve ?? 5;
    reserve.onchange = () => {
      const val = Number(reserve.value);
      if (!Number.isFinite(val) || val < 0) {
        render();
        return;
      }
      store.enablePolicyWith(n.id, { reserve: val });
      render();
    };
    makeCell(reserve);
    const toggle = document.createElement('input');
    toggle.type = 'checkbox';
    toggle.checked = Boolean(policies[n.id]?.enabled);
    toggle.setAttribute('aria-label', 'Enable policy for node ' + n.id);
    toggle.onchange = () => {
      if (toggle.checked) store.enablePolicyWith(n.id, {});
      else store.disablePolicy(n.id);
      render();
    };
    makeCell(toggle);
    table.append(tr);
  }
  dashboard.append(table);
  $('bulkManualApply').onclick = () => {
    const ids = [...dashboard.querySelectorAll('.bulk-node:checked')].map((x) =>
        Number(x.dataset.node),
      ),
      amount = Math.max(0, Number($('bulkManualInvest').value) || 0);
    store.applyBulkInvestment(ids, amount);
    render();
  };
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
      camera.scale = Math.max(0.3, Math.min(5, camera.scale * (e.deltaY < 0 ? 1.12 : 0.89)));
      render();
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
    camera.x = drag.ox + dx * factor;
    camera.y = drag.oy + dy * factor;
    const g = svg.querySelector('g');
    if (g)
      g.setAttribute(
        'transform',
        'translate(' + camera.x + ' ' + camera.y + ') scale(' + camera.scale + ')',
      );
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

const mobileNodeQuery = window.matchMedia('(max-width:760px)');
function positionNodeDetails() {
  const target = mobileNodeQuery.matches ? $('mobileNodeContent') : $('nodeDetailsSlot');
  if (!target) return;
  for (const id of ['selectedTitle', 'details', 'hint', 'allocator', 'policyEditor'])
    target.append($(id));
  if (!mobileNodeQuery.matches && $('nodeDialog').open) $('nodeDialog').close();
}
function showNodeOnMobile() {
  if (mobileNodeQuery.matches && selected !== null && !$('nodeDialog').open)
    $('nodeDialog').showModal();
}
$('closeNodeDialog').onclick = () => $('nodeDialog').close();
window.addEventListener('resize', () => positionNodeDetails());

const SAVE_KEY = 'parallel-energy-game-v1';
function switchView(view) {
  currentView = view;
  render();
}
function setActiveTab() {
  for (const [id, view] of [
    ['mapTab', 'map'],
    ['tableView', 'dashboard'],
    ['messagesTab', 'messages'],
  ]) {
    const button = $(id);
    button.classList.toggle('active', view === currentView);
    button.setAttribute('aria-selected', String(view === currentView));
  }
  $('overlay').closest('label').hidden = currentView !== 'map';
  for (const id of ['fit', 'zoomIn', 'zoomOut']) $(id).hidden = currentView !== 'map';
}
function saveGame() {
  if (!state) return;
  try {
    localStorage.setItem(
      SAVE_KEY,
      JSON.stringify(GameStore.saveFromMatch(currentMatch(), selected)),
    );
  } catch (e) {
    console.warn('Autosave unavailable', e);
  }
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
    selected = save.selected ?? null;
    store.replaceMatch({ ...match, defaults: domDefaults() });
    render();
    return true;
  } catch (e) {
    console.warn('Could not restore save', e);
    return false;
  }
}
for (const id of ['autoConquer', 'defaultReserve', 'defaultInvest'])
  $(id).addEventListener('change', () => store.setDefaults(domDefaults()));
window.addEventListener('beforeunload', (event) => {
  if (!state || state.finished) return;
  saveGame();
  event.preventDefault();
  event.returnValue = '';
});
window.addEventListener('pagehide', saveGame);

function render() {
  const nodes = state.nodes,
    blue = nodes.filter((n) => n.owner === 0).length,
    red = nodes.filter((n) => n.owner !== null && n.owner !== 0).length;
  $('score').textContent = 'Round ' + state.round + ' · Blue ' + blue + ' · Opponents ' + red;
  $('resolve').disabled = state.finished;
  const svg = $('map');
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
  const graph = element('g', {
    transform: 'translate(' + camera.x + ' ' + camera.y + ') scale(' + camera.scale + ')',
  });
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
      },
      group,
    );
    const t = element('text', { x, y: y + 2, 'font-size': 17 }, group);
    t.textContent = fmt(n.active);
    const t2 = element('text', { x, y: y + 18, 'font-size': 10 }, group);
    t2.textContent = 'I ' + fmt(n.invested);
    const t3 = element('text', { x, y: y - 40, 'font-size': 12 }, group);
    t3.textContent = n.id;
    group.style.cursor = 'pointer';
    group.addEventListener('click', () => clickNode(n.id));
  }
  let selectedNode = selected === null ? null : nodes[selected];
  $('selectedTitle').textContent = selectedNode ? 'Node ' + selected : 'Select a blue node';
  $('details').textContent = selectedNode
    ? 'Active ' +
      fmt(selectedNode.active) +
      ' · Invested ' +
      fmt(selectedNode.invested) +
      (softCapEnabled() && selectedNode.owner !== null
        ? ' · Total ' +
          fmt(selectedNode.active + selectedNode.invested) +
          ' / ' +
          SOFT_CAP_RULES.capacity +
          ' sustainable capacity'
        : '')
    : 'Choose a blue node to issue an order.';
  $('hint').textContent = state.finished
    ? 'Game over. Start a new game.'
    : 'Manual allocations take priority; policies automatically use remaining energy. Unspent energy defends.';
  renderAllocator();
  renderPolicyEditor();
  renderOrders();
  renderFlows(svg, graph, element);
  renderDashboard();
  $('log').replaceChildren();
  for (const line of history) {
    const entry = document.createElement('div');
    entry.textContent = line;
    $('log').append(entry);
  }
  setActiveTab();
}
$('clearAll').onclick = () => {
  store.clearAllOrders();
  render();
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
for (const id of ['nodeCount', 'playerCount', 'density', 'seed'])
  $(id).addEventListener('input', previewMap);
$('cancelNewGame').onclick = () => $('newGameDialog').close();
$('tableView').onclick = () => switchView('dashboard');
$('mapTab').onclick = () => switchView('map');
$('messagesTab').onclick = () => switchView('messages');
$('overlay').onchange = render;
$('mobileSettings').onclick = () => {
  $('gameSidebar').classList.add('settings-open');
  document.body.classList.add('settings-active');
};
$('closeMobileSettings').onclick = () => {
  $('gameSidebar').classList.remove('settings-open');
  document.body.classList.remove('settings-active');
};
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') $('closeMobileSettings')?.click();
});
$('zoomIn').onclick = () => {
  camera.scale = Math.min(5, camera.scale * 1.25);
  render();
};
$('zoomOut').onclick = () => {
  camera.scale = Math.max(0.3, camera.scale / 1.25);
  render();
};
$('fit').onclick = () => {
  camera = { x: 0, y: 0, scale: 1 };
  render();
};
positionNodeDetails();
if (!restoreGame()) fresh();
attachNavigation();
