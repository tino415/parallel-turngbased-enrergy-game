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
      menu.querySelector('summary').focus();
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

  // Planned energy travels along the connection itself; the legacy renderer
  // supplied a second competing stroke over each connection. Retain its
  // direction arrows, values, and economic labels but decorate the base edges
  // instead of drawing any separate flow lines.
  const originalRenderFlows = renderFlows;
  renderFlows = (mapSvg, graph, element) => {
    originalRenderFlows(mapSvg, graph, element);
    const filter = byId('overlay').value;
    const visible =
      filter === 'none'
        ? []
        : previewOrders().filter((order) => {
            if (order.dest === null || order.dest === undefined || order.amount <= 0.01)
              return false;
            if (filter === 'manual' && order.automatic) return false;
            if (filter === 'policy' && !order.automatic) return false;
            return true;
          });
    const key = (a, b) => [Math.min(a, b), Math.max(a, b)].join(':');
    const byEdge = new Map();
    for (const order of visible) {
      const k = key(order.source, order.dest);
      if (!byEdge.has(k)) byEdge.set(k, []);
      byEdge.get(k).push(order);
    }
    const connections = [...graph.children]
      .filter((child) => child.tagName === 'line')
      .slice(0, edges.length);
    for (const [i, [a, b]] of edges.entries()) {
      const connection = connections[i];
      const flows = byEdge.get(key(a, b));
      if (!connection || !flows?.length) continue;
      const color =
        flows.length > 1
          ? '#b1a2fa'
          : flows[0].type === 'attack'
            ? '#ff987f'
            : flows[0].automatic
              ? '#76b3ff'
              : '#63d9af';
      connection.setAttribute('stroke', color);
      connection.setAttribute('stroke-width', '5');
      connection.setAttribute('opacity', '.95');
      connection.setAttribute(
        'stroke-dasharray',
        flows.length === 1 && flows[0].automatic ? '8 5' : 'none',
      );
      connection.classList.add('tactical-flow-connection');
    }
    graph.querySelectorAll('line.ux-flow-overlay').forEach((line) => line.remove());
  };

  let active = null;
  let editing = false;
  let advancedOpen = false;
  let manualOpen = false;
  let previousRound = state.round;
  let focusedNode = state.nodes.find((node) => node.owner === 0)?.id ?? 0;
  const svg = byId('map');
  const viewport = byId('mapViewport');
  // Keep the editor independent of the action dock. Mobile positions it above
  // the dock rather than replacing/hiding the existing Orders/Resolve buttons.
  // Its contents scroll; the document and bottom dock never do.
  const legacyNodeDialog = byId('nodeDialog');

  // Never let the superseded full-screen node editor stack over the new
  // contextual inspector. Other dialogs (Orders, Settings, New game) are still
  // available from their explicit commands.
  if (legacyNodeDialog.open) legacyNodeDialog.close();
  legacyNodeDialog.addEventListener('toggle', () => {
    if (legacyNodeDialog.open) legacyNodeDialog.close();
  });

  // One-finger drag uses the existing pointer navigation. Two fingers zoom the
  // same camera.
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
    const aOwned = state.nodes[a].owner === 0;
    const bOwned = state.nodes[b].owner === 0;
    if (!aOwned) return bOwned ? b : null;
    if (!bOwned) return a;

    // Both directions are possible on friendly edges. Open an existing
    // automatic surplus transfer in its saved direction instead of always
    // defaulting to the first endpoint (which showed an unchecked box for
    // policies configured in the reverse direction).
    const aToB = policies[a]?.enabled && policies[a].dest === b;
    const bToA = policies[b]?.enabled && policies[b].dest === a;
    if (aToB !== bToA) return aToB ? a : b;

    // An explicitly chosen, but disabled, policy destination is still useful
    // context when no enabled direction exists.
    const aConfigured = policies[a]?.dest === b;
    const bConfigured = policies[b]?.dest === a;
    if (aConfigured !== bConfigured) return aConfigured ? a : b;

    return a;
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

  function dismissAndReturnFocus() {
    const item = activeMapItemSelector();
    dismiss();
    if (item) svg.querySelector(item)?.focus();
  }

  function activeMapItemSelector() {
    if (active?.kind === 'node') return '[data-node="' + active.id + '"]';
    if (active?.kind === 'edge') return '[data-edge="' + active.a + '-' + active.b + '"]';
    return null;
  }

  function mapItemSelector(element) {
    if (!svg.contains(element)) return null;
    if (element.dataset.node !== undefined) return '[data-node="' + element.dataset.node + '"]';
    if (element.dataset.edge !== undefined) return '[data-edge="' + element.dataset.edge + '"]';
    return null;
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
    const width = Math.max(260, viewport.clientWidth);
    const height = Math.max(260, viewport.clientHeight);
    const vh = (vw * height) / width;
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
    const nodeGroup = event.target.closest('g');
    if (
      event.target.closest('.node-hit, .tactical-edge-hit') ||
      nodeGroup?.querySelector(':scope > .node-hit') ||
      !active ||
      pinchInProgress
    )
      return;
    dismiss();
  });

  // Orders is a separate dialog, not another layer on top of the
  // contextual editor. Clear selection before the dock opens Orders; otherwise
  // the editor reappears behind it when Orders closes.
  byId('uxDockOrders').addEventListener(
    'click',
    () => {
      if (active) dismiss();
    },
    true,
  );

  // Clicking elsewhere (header, toolbar or outside the editor) closes it.
  // Map nodes/edges handle their own selection, and dragging should not close it.
  document.addEventListener('click', (event) => {
    if (!active || root.hidden || root.contains(event.target)) return;
    if (event.target.closest('dialog, #tacticalMenu, .ux-dock')) return;
    // render() rebuilds SVG nodes synchronously: the clicked target may already
    // be detached by the time the event bubbles to document. The original
    // composed path still identifies map taps correctly.
    if (event.composedPath().includes(svg)) return;
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
    details.ontoggle = () => onToggle(details.open);
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
          (!policy ? 'Default values · off' : policy.enabled ? 'Enabled' : 'Disabled') +
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
    percent.dataset.key = String(id);
    percent.setAttribute('aria-label', 'Invest surplus percent');
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '0';
    slider.max = '100';
    slider.step = '1';
    slider.value = String(pct);
    slider.setAttribute('aria-label', 'Investment percentage slider');
    slider.oninput = () => {
      byId('tacticalPolicyPercent').value = slider.value;
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
    policyHolder.dataset.mount = 'policy';
    addDetails(body, 'Other policy settings', policyHolder, advancedOpen, (open) => {
      advancedOpen = open;
    });
    const manualHolder = document.createElement('div');
    manualHolder.dataset.mount = 'manual';
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
    const recurring = bothFriendly
      ? policyOrders(source).find((o) => o.type === 'transfer' && o.dest === destination)
      : null;
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
        ...(recurring ? [['Every round', recurring.amount]] : []),
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
    input.dataset.key = source + '-' + destination;
    input.setAttribute('aria-label', 'Order energy amount');
    const error = textElement('small', '', 'tactical-warning');
    error.id = 'tacticalEdgeError';
    input.onchange = () => {
      const amount = Number(input.value);
      if (
        !Number.isFinite(amount) ||
        amount < 0 ||
        amount > budget - allocated(source) + value + 1e-8
      ) {
        byId('tacticalEdgeError').textContent = 'Amount exceeds the available allocation budget.';
        input.value = String(value);
        return;
      }
      setAllocation(source, destination, amount);
    };
    field.append(input, error);
    body.append(field);
    if (bothFriendly) {
      const current = policies[source];
      const targetsHere = Boolean(current?.enabled && current.dest === destination);
      const policyBox = document.createElement('div');
      policyBox.className = 'tactical-primary-control tactical-support-policy';
      const toggle = document.createElement('label');
      const caption = document.createElement('strong');
      caption.textContent = 'Send remaining surplus to Node ' + destination + ' each round';
      const autoTransfer = document.createElement('input');
      autoTransfer.type = 'checkbox';
      autoTransfer.id = 'tacticalAutoTransfer';
      autoTransfer.checked = targetsHere;
      autoTransfer.setAttribute(
        'aria-label',
        'Automatically send remaining surplus to Node ' + destination + ' each round',
      );
      autoTransfer.onchange = () => {
        if (autoTransfer.checked) {
          // Changing destination must never overwrite investment or reserve.
          store.routeSurplus(source, destination, true);
        } else {
          // Disable only this route, leaving other policy settings intact.
          store.routeSurplus(source, destination, false);
        }
        render();
      };
      toggle.append(caption, autoTransfer);
      policyBox.append(toggle);
      if (current?.dest !== null && current?.dest !== undefined && current.dest !== destination) {
        policyBox.append(
          textElement(
            'p',
            'Node ' +
              source +
              ' currently routes its surplus to Node ' +
              current.dest +
              '. Enabling this connection replaces that destination, not the investment policy.',
            'tactical-secondary',
          ),
        );
      }
      if (targetsHere) {
        policyBox.append(
          textElement(
            'p',
            'Uses Node ' +
              source +
              ' policy: reserve ' +
              numeric(current.reserve) +
              ' · invest ' +
              numeric(current.investPct) +
              '% of surplus. To change either value, edit Node ' +
              source +
              '.',
            'tactical-secondary',
          ),
        );
        const nextTransfer = policyOrders(source).find(
          (o) => o.type === 'transfer' && o.dest === destination,
        );
        policyBox.append(
          textElement(
            'p',
            'Projected surplus transfer next round: ' +
              numeric(nextTransfer?.amount ?? 0) +
              ' energy · Reserve ' +
              numeric(current.reserve) +
              '. Manual orders take priority.',
            'tactical-secondary',
          ),
        );
        if (!nextTransfer) {
          policyBox.append(
            textElement(
              'p',
              'No surplus to send. Lower the investment percentage, reserve, or manual allocations.',
              'tactical-warning',
            ),
          );
        }
      } else {
        policyBox.append(
          textElement(
            'p',
            "Send what remains after this source node's manual orders, reserve and investment. The amount can change each round.",
            'tactical-secondary',
          ),
        );
      }
      body.append(policyBox);
    }
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
    // The first tap highlights only. The second tap opens the editor above
    // the unchanged mobile Orders/Resolve dock, or near the edge on desktop.
    root.hidden =
      !active ||
      currentView !== 'map' ||
      !editing ||
      Boolean(document.querySelector('dialog[open]'));
    document.body.classList.toggle('tactical-selection-active', !root.hidden);
    if (root.hidden) {
      mountLegacyControls();
      return;
    }
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
    close.onclick = dismissAndReturnFocus;
    header.append(close);
    const body = document.createElement('div');
    body.className = 'tactical-inspector-body';
    if (active.kind === 'node') showNode(body, active.id);
    else showEdge(body, active.a, active.b);
    // No duplicate Orders/Resolve/Collapse buttons. The original bottom dock
    // remains reachable below this editor; × and outside-click dismiss it.
    updateChildrenInPlace(root, [header, body]);
    mountLegacyControls();
    positionInspector();
  }

  function mountLegacyControls() {
    // A detached control breaks getElementById during the next game render.
    for (const [section, slot] of [
      [policySection, root.hidden ? null : root.querySelector('[data-mount="policy"]')],
      [manualSection, root.hidden ? null : root.querySelector('[data-mount="manual"]')],
    ]) {
      const home = slot ?? nodeControls;
      if (section.parentNode !== home) home.append(section);
    }
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
    const focusedMapItem = mapItemSelector(document.activeElement);
    oldRender();
    // The thumb-reachable control mirrors the authoritative round button.
    byId('uxDockResolve').disabled = byId('resolve').disabled;
    drawSelection();
    showInspector();
    if (focusedMapItem) svg.querySelector(focusedMapItem)?.focus();
  };
  byId('generate').addEventListener(
    'click',
    () => {
      active = null;
      editing = false;
    },
    true,
  );
  // The legacy node dialog must remain mounted for older renderer references,
  // but must never appear together with the contextual node inspector.
  // Hide the inspector while deliberate Orders/Settings/New game dialogs are open.
  const modalObserver = new MutationObserver(() => {
    if (legacyNodeDialog.open) legacyNodeDialog.close();
    showInspector();
  });
  for (const dialog of document.querySelectorAll('dialog')) {
    modalObserver.observe(dialog, { attributes: true, attributeFilter: ['open'] });
  }
  // Expanding policy/manual sections changes the panel's height; reposition
  // it on desktop so the newly expanded controls remain inside the viewport.
  const inspectorResizeObserver = new ResizeObserver(() => {
    if (!root.hidden) positionInspector();
  });
  inspectorResizeObserver.observe(root);
  window.addEventListener('resize', positionInspector);
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !active) return;
    if (document.querySelector('dialog[open]')) return;
    dismissAndReturnFocus();
  });
  render();
})();
