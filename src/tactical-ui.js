'use strict';

// Contextual presentation layer. The existing game/engine functions remain authoritative.
(() => {
  const byId = (id) => document.getElementById(id);
  const mobile = () => matchMedia('(max-width: 760px)').matches;
  const numeric = (n) =>
    Number(n || 0).toLocaleString('en-US', {
      maximumFractionDigits: 1,
    });
  const root = document.createElement('section');
  root.id = 'tacticalInspector';
  root.hidden = true;
  root.setAttribute('aria-label', 'Selected map item');
  document.body.append(root);

  const style = document.createElement('link');
  style.rel = 'stylesheet';
  style.href = './src/tactical-ui.css';
  document.head.append(style);

  const menu = document.createElement('details');
  menu.id = 'tacticalMenu';
  menu.innerHTML =
    '<summary aria-label="More actions">☰</summary><div class="tactical-menu-content"></div>';
  const menuItems = [
    ['Orders', 'uxReviewHead'],
    ['Settings', 'mobileSettings'],
    ['New game', 'reset'],
  ];
  for (const [label, original] of menuItems) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.onclick = () => {
      menu.open = false;
      byId(original).click();
    };
    menu.querySelector('.tactical-menu-content').append(button);
  }
  document.querySelector('body > header > div:last-child').append(menu);

  // Keep the V2 withdrawal allocator and all existing policy controls reachable.
  const nodeControls = document.createElement('div');
  nodeControls.id = 'tacticalNodeControls';
  nodeControls.hidden = true;
  document.body.append(nodeControls);
  const policySection = byId('uxPolicySection');
  const manualSection = byId('uxManualSection');
  nodeControls.append(policySection, manualSection);

  let active = null;
  let editing = false;
  let advancedOpen = false;
  let manualOpen = false;
  let previousRound = state.round;
  let focusedNode = state.nodes.find((node) => node.owner === 0)?.id ?? 0;
  const svg = byId('map');
  const viewport = byId('mapViewport');

  // One-finger drag uses the existing pointer navigation. Two fingers zoom the
  // same camera; never ask the player to switch between Pan and Scroll modes.
  viewport.classList.add('touch-pan-mode');
  const fingers = new Map();
  let pinch = null;
  let pinchInProgress = false;
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const midpoint = (a, b) => ({
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
  });
  svg.addEventListener(
    'pointerdown',
    (event) => {
      if (event.pointerType !== 'touch') return;
      fingers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (fingers.size !== 2) return;
      const [a, b] = [...fingers.values()];
      pinchInProgress = true;
      pinch = {
        distance: Math.max(1, distance(a, b)),
        center: midpoint(a, b),
        scale: camera.scale,
        x: camera.x,
        y: camera.y,
      };
    },
    true,
  );
  svg.addEventListener(
    'pointermove',
    (event) => {
      if (event.pointerType !== 'touch' || !fingers.has(event.pointerId)) return;
      fingers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (!pinchInProgress) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (fingers.size !== 2 || !pinch) return;
      const [a, b] = [...fingers.values()];
      const center = midpoint(a, b);
      const rect = svg.getBoundingClientRect();
      const factor = svg.viewBox.baseVal.width / rect.width;
      const scale = Math.min(6, Math.max(0.25, (pinch.scale * distance(a, b)) / pinch.distance));
      const ratio = scale / pinch.scale;
      camera = {
        scale,
        x:
          (center.x - rect.left) * factor -
          ((pinch.center.x - rect.left) * factor - pinch.x) * ratio,
        y:
          (center.y - rect.top) * factor - ((pinch.center.y - rect.top) * factor - pinch.y) * ratio,
      };
      const graph = svg.querySelector('g');
      graph?.setAttribute(
        'transform',
        'translate(' + camera.x + ' ' + camera.y + ') scale(' + scale + ')',
      );
    },
    true,
  );
  const endTouch = (event) => {
    if (event.pointerType !== 'touch') return;
    fingers.delete(event.pointerId);
    if (fingers.size === 0) {
      pinchInProgress = false;
      pinch = null;
    }
  };
  svg.addEventListener('pointerup', endTouch, true);
  svg.addEventListener('pointercancel', endTouch, true);

  function chooseNode(id) {
    if (active?.kind === 'node' && active.id === id) {
      editing = true;
    } else {
      active = { kind: 'node', id };
      editing = false;
      advancedOpen = false;
      manualOpen = false;
    }
    focusedNode = id;
    selected = id;
    render();
  }

  function sourceForEdge(a, b) {
    if (state.nodes[a].owner === 0) return a;
    if (state.nodes[b].owner === 0) return b;
    return null;
  }

  function chooseEdge(a, b) {
    if (active?.kind === 'edge' && active.a === a && active.b === b) {
      editing = true;
    } else {
      active = { kind: 'edge', a, b, source: sourceForEdge(a, b) };
      editing = false;
      advancedOpen = false;
      manualOpen = false;
    }
    selected = active.source;
    render();
  }

  function dismiss() {
    active = null;
    selected = null;
    editing = false;
    render();
  }

  // These entry points are also used by Dashboard and the Orders review dialog.
  clickNode = chooseNode;
  showNodeOnMobile = () => {
    if (selected === null) return;
    active = { kind: 'node', id: selected };
    focusedNode = selected;
    editing = true;
    render();
  };

  // Focus tracks the most recently selected node with no full-screen dialog.
  byId('focusMap').onclick = () => {
    if (!xy[focusedNode]) return;
    const rect = viewport.getBoundingClientRect();
    const base = mobile() ? 800 : xy.length === 14 && mapSeed === 'classic' ? 800 : 1800;
    const vw = base;
    const vh = (vw * Math.max(260, viewport.clientHeight)) / Math.max(260, viewport.clientWidth);
    const scale = mobile() ? 2.35 : 1.75;
    camera = {
      scale,
      x: vw / 2 - xy[focusedNode][0] * scale,
      y: vh / 2 - xy[focusedNode][1] * scale,
    };
    render();
  };

  function svgElement(name, attributes, parent) {
    const element = document.createElementNS('http://www.w3.org/2000/svg', name);
    for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
    parent.append(element);
    return element;
  }

  function drawSelection() {
    const graph = svg.querySelector('g');
    if (!graph || currentView !== 'map') return;
    for (const [a, b] of edges) {
      const [ax, ay] = xy[a];
      const [bx, by] = xy[b];
      const dx = bx - ax;
      const dy = by - ay;
      const length = Math.hypot(dx, dy) || 1;
      const attributes = {
        x1: ax + (dx * 37) / length,
        y1: ay + (dy * 37) / length,
        x2: bx - (dx * 37) / length,
        y2: by - (dy * 37) / length,
      };
      if (active?.kind === 'edge' && active.a === a && active.b === b) {
        svgElement(
          'line',
          {
            ...attributes,
            class: 'tactical-edge-selected',
          },
          graph,
        );
      }
      const hit = svgElement(
        'line',
        {
          ...attributes,
          stroke: 'transparent',
          'stroke-width': 24,
          'pointer-events': 'stroke',
          class: 'tactical-edge-hit',
          'data-edge': a + '-' + b,
          tabindex: 0,
          role: 'button',
          'aria-label': 'Select connection between node ' + a + ' and node ' + b,
        },
        graph,
      );
      hit.addEventListener('click', (event) => {
        event.stopPropagation();
        chooseEdge(a, b);
      });
      hit.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        chooseEdge(a, b);
      });
    }
    const ids =
      active?.kind === 'node' ? [active.id] : active?.kind === 'edge' ? [active.a, active.b] : [];
    for (const id of ids) {
      const [x, y] = xy[id] || [];
      if (x === undefined) continue;
      svgElement(
        'circle',
        {
          cx: x,
          cy: y,
          r: 34,
          class: 'tactical-node-selected',
        },
        graph,
      );
    }
  }

  svg.addEventListener('click', (event) => {
    if (event.target.closest('.node-hit, .tactical-edge-hit') || !active || pinchInProgress) return;
    dismiss();
  });

  function textElement(tag, text, className) {
    const element = document.createElement(tag);
    element.textContent = text;
    if (className) element.className = className;
    return element;
  }

  function metrics(values) {
    const container = document.createElement('div');
    container.className = 'tactical-metrics';
    for (const [label, amount] of values) {
      const stat = document.createElement('span');
      const bold = textElement('b', numeric(amount));
      stat.append(label + ' ', bold);
      container.append(stat);
    }
    return container;
  }

  function addDetails(body, title, child, isOpen, onToggle) {
    const details = document.createElement('details');
    details.open = isOpen;
    details.append(textElement('summary', title), child);
    details.addEventListener('toggle', () => onToggle(details.open));
    body.append(details);
  }

  function showNode(body, id) {
    const node = state.nodes[id];
    const prediction = node.owner === 0 ? projection(id) : null;
    body.append(
      metrics([
        ['Active', node.active],
        ['Invested', node.invested],
        ...(prediction ? [['Defense', prediction.defense]] : []),
      ]),
    );
    if (softCapEnabled()) {
      body.append(
        textElement(
          'p',
          'Capacity ' +
            numeric(node.active + node.invested) +
            ' / ' +
            SOFT_CAP_RULES.capacity +
            (prediction ? ' · Projected overflow loss ' + numeric(prediction.overflow) : ''),
          'tactical-secondary',
        ),
      );
    }
    if (node.owner !== 0) {
      body.append(textElement('p', 'Inspect only: this node is not yours.', 'tactical-secondary'));
      return;
    }
    const policy = policies[id];
    body.append(
      textElement(
        'p',
        'Policy: ' +
          (!policy ? 'Not configured' : policy.enabled ? 'Enabled' : 'Disabled') +
          ' · Invest ' +
          (policy?.investPct ?? defaultPolicy().investPct) +
          '% of surplus',
        'tactical-secondary',
      ),
    );
    if (!editing) return;
    const primary = document.createElement('div');
    primary.className = 'tactical-primary-control';
    const toggle = document.createElement('label');
    toggle.append(textElement('strong', 'Persistent investment policy'));
    const enabled = document.createElement('input');
    enabled.type = 'checkbox';
    enabled.checked = Boolean(policy?.enabled);
    enabled.setAttribute('aria-label', 'Enable policy for node ' + id);
    enabled.onchange = () => changePolicy(id, 'enabled', enabled.checked);
    toggle.append(enabled);
    primary.append(toggle);

    const pct = policy?.investPct ?? defaultPolicy().investPct;
    const label = document.createElement('label');
    label.append(textElement('span', 'Invest surplus'));
    const percent = document.createElement('input');
    percent.type = 'number';
    percent.min = '0';
    percent.max = '100';
    percent.step = '1';
    percent.value = String(pct);
    percent.id = 'tacticalPolicyPercent';
    percent.setAttribute('aria-label', 'Invest surplus percent');
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '0';
    slider.max = '100';
    slider.step = '1';
    slider.value = String(pct);
    slider.setAttribute('aria-label', 'Investment percentage slider');
    slider.oninput = () => {
      percent.value = slider.value;
    };
    slider.onchange = () => changePolicy(id, 'investPct', Number(slider.value));
    percent.onchange = () => {
      const value = Number(percent.value);
      if (!Number.isFinite(value) || value < 0 || value > 100) {
        percent.value = String(pct);
        return;
      }
      changePolicy(id, 'investPct', value);
    };
    label.append(percent);
    primary.append(label, slider);
    body.append(primary);
    body.append(
      textElement(
        'p',
        'Preview: Defense ' +
          numeric(prediction.defense) +
          ' · Next active ' +
          numeric(prediction.next) +
          ' · Invest ' +
          numeric(prediction.invest) +
          ' (manual orders take priority)',
        'tactical-secondary',
      ),
    );

    // The original policy and allocator DOM elements are reused, not copied:
    // withdrawals, reserves, policy transfers, hold, and copy/paste still work.
    for (const item of policySection.querySelectorAll('label')) {
      if (item.textContent.includes('Invest % of surplus')) item.hidden = true;
    }
    const policyHolder = document.createElement('div');
    policyHolder.append(policySection);
    addDetails(body, 'Other policy settings', policyHolder, advancedOpen, (open) => {
      advancedOpen = open;
    });
    const manualHolder = document.createElement('div');
    manualHolder.append(manualSection);
    addDetails(
      body,
      'Manual investment, withdrawal and allocations',
      manualHolder,
      manualOpen,
      (open) => {
        manualOpen = open;
      },
    );
  }

  function showEdge(body, a, b) {
    const source = active.source;
    const destination = source === a ? b : a;
    body.append(
      textElement(
        'p',
        'Node ' +
          a +
          ' (' +
          (state.nodes[a].owner === 0 ? 'yours' : 'other') +
          ') — Node ' +
          b +
          ' (' +
          (state.nodes[b].owner === 0 ? 'yours' : 'other') +
          ')',
        'tactical-secondary',
      ),
    );
    if (source === null) {
      body.append(textElement('p', 'No friendly source: inspect only.', 'tactical-secondary'));
      return;
    }
    const bothFriendly = state.nodes[a].owner === 0 && state.nodes[b].owner === 0;
    if (bothFriendly && editing) {
      const direction = document.createElement('label');
      direction.className = 'tactical-primary-control';
      direction.append(textElement('strong', 'Transfer direction'));
      const select = document.createElement('select');
      for (const [from, to] of [
        [a, b],
        [b, a],
      ]) {
        const option = document.createElement('option');
        option.value = String(from);
        option.textContent = 'Node ' + from + ' → Node ' + to;
        select.append(option);
      }
      select.value = String(source);
      select.onchange = () => {
        active.source = Number(select.value);
        selected = active.source;
        render();
      };
      direction.append(select);
      body.append(direction);
    }
    const type = state.nodes[destination].owner === 0 ? 'Support transfer' : 'Attack';
    const value = plan(source).edges[destination] || 0;
    const budget = availableEnergy(source);
    const remaining = Math.max(
      0,
      budget -
        allocated(source) -
        policyOrders(source).reduce((sum, order) => sum + order.amount, 0),
    );
    body.append(
      metrics([
        ['Source active', state.nodes[source].active],
        ['Planned ' + type.toLowerCase(), value],
        ['Defense', remaining],
      ]),
    );
    if (!editing) return;
    const field = document.createElement('label');
    field.className = 'tactical-primary-control';
    field.append(textElement('strong', type + ' · ' + source + ' → ' + destination));
    const input = document.createElement('input');
    input.type = 'number';
    input.min = '0';
    input.step = '0.1';
    input.max = String(Math.max(0, budget - allocated(source) + value));
    input.value = String(value);
    input.id = 'tacticalEdgeAmount';
    input.setAttribute('aria-label', 'Order energy amount');
    const error = textElement('small', '', 'tactical-warning');
    input.onchange = () => {
      const amount = Number(input.value);
      if (
        !Number.isFinite(amount) ||
        amount < 0 ||
        amount > budget - allocated(source) + value + 1e-8
      ) {
        error.textContent = 'Amount exceeds the available allocation budget.';
        input.value = String(value);
        return;
      }
      setAllocation(source, destination, amount);
    };
    field.append(input, error);
    body.append(field);
    if (type === 'Attack') {
      body.append(
        textElement(
          'p',
          'Attack strength ' +
            numeric(value * 0.8) +
            '–' +
            numeric(value * 1.2) +
            ' · Current target defense ' +
            numeric(state.nodes[destination].active * 0.8) +
            '–' +
            numeric(state.nodes[destination].active * 1.2) +
            '. Simultaneous orders can change the outcome.',
          'tactical-secondary',
        ),
      );
    }
    if (softCapEnabled()) {
      body.append(
        textElement(
          'p',
          'Withdrawn reserves (5% fee) can fund this order in the same round. ' +
            'Use the source node editor for withdrawals.',
          'tactical-secondary',
        ),
      );
    }
  }

  function screenAnchor() {
    if (!active) return null;
    const graph = svg.querySelector('g');
    const matrix = graph?.getScreenCTM();
    if (!matrix) return null;
    const location =
      active.kind === 'node'
        ? xy[active.id]
        : [(xy[active.a][0] + xy[active.b][0]) / 2, (xy[active.a][1] + xy[active.b][1]) / 2];
    return {
      x: matrix.a * location[0] + matrix.c * location[1] + matrix.e,
      y: matrix.b * location[0] + matrix.d * location[1] + matrix.f,
    };
  }

  function positionInspector() {
    if (!active || mobile()) return;
    const anchor = screenAnchor();
    if (!anchor) return;
    const width = 360;
    const left = Math.min(innerWidth - width - 12, Math.max(10, anchor.x + 35));
    const top = Math.min(
      innerHeight - Math.min(root.offsetHeight, innerHeight * 0.76) - 12,
      Math.max(12, anchor.y - 50),
    );
    root.style.left = Math.max(10, left) + 'px';
    root.style.top = Math.max(12, top) + 'px';
  }

  function showInspector() {
    root.hidden = !active || currentView !== 'map';
    if (root.hidden) return;
    root.classList.toggle('is-editing', editing);
    const subject =
      active.kind === 'node' ? 'Node ' + active.id : 'Connection ' + active.a + ' — ' + active.b;
    const header = document.createElement('div');
    header.className = 'tactical-inspector-head';
    header.append(textElement('strong', subject));
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = '×';
    close.setAttribute('aria-label', 'Clear map selection');
    close.onclick = dismiss;
    header.append(close);
    // A detached control breaks getElementById during the next game render.
    // Keep legacy controls mounted in the hidden stash unless editing a node.
    if (active.kind !== 'node' || !editing) nodeControls.append(policySection, manualSection);
    const body = document.createElement('div');
    body.className = 'tactical-inspector-body';
    if (active.kind === 'node') showNode(body, active.id);
    else showEdge(body, active.a, active.b);
    const actions = document.createElement('div');
    actions.className = 'tactical-inspector-actions';
    const action = document.createElement('button');
    action.type = 'button';
    action.className = 'primary';
    action.textContent = editing ? 'Collapse' : 'Edit';
    action.onclick = () => {
      editing = !editing;
      render();
    };
    actions.append(action);
    root.replaceChildren(header, body, actions);
    positionInspector();
  }

  const oldRender = render;
  render = function () {
    if (state.round !== previousRound) {
      active = null;
      selected = null;
      editing = false;
      previousRound = state.round;
    }
    if (active?.kind === 'node' && !state.nodes[active.id]) active = null;
    oldRender();
    drawSelection();
    showInspector();
  };
  byId('generate').addEventListener(
    'click',
    () => {
      active = null;
      editing = false;
    },
    true,
  );
  window.addEventListener('resize', positionInspector);
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !active) return;
    if (document.querySelector('dialog[open]')) return;
    dismiss();
  });
  render();
})();
