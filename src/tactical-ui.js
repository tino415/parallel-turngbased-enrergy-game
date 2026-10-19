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
    const filter = overlay;
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

  let { active, editing, advancedOpen, manualOpen, focusedNode } = store.getSnapshot().ui.inspector;
  let { groupMode, bulkSelection } = store.getSnapshot().ui;
  store.subscribe(({ ui }) => {
    ({ active, editing, advancedOpen, manualOpen, focusedNode } = ui.inspector);
    ({ groupMode, bulkSelection } = ui);
  });
  const groupIds = () => (groupMode ? bulkSelection : []);
  const showingGroup = () => groupIds().length >= 2;
  let groupMessage = '';
  store.focusNode(state.nodes.find((node) => node.owner === 0)?.id ?? 0);
  let previousRound = state.round;
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
      if (event.isPrimary) forgetFingers();
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
      store.setCamera({
        scale,
        x:
          (center.x - rect.left) * factor -
          ((pinch.center.x - rect.left) * factor - pinch.x) * ratio,
        y:
          (center.y - rect.top) * factor - ((pinch.center.y - rect.top) * factor - pinch.y) * ratio,
      });
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
    if (fingers.size === 0) forgetFingers();
  };
  function forgetFingers() {
    fingers.clear();
    pinchInProgress = false;
    pinch = null;
  }
  window.addEventListener('pointerup', endTouch, true);
  window.addEventListener('pointercancel', endTouch, true);

  const LONG_PRESS_MS = 450;
  const LONG_PRESS_SLOP = 8;
  let press = null;
  let swallowNextClick = false;

  function nodeIdOf(element) {
    const hit = element?.closest?.('g')?.querySelector(':scope > .node-hit');
    return hit ? Number(hit.dataset.node) : null;
  }

  function stopEvent(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  function cancelPress() {
    clearTimeout(press?.timer);
    press = null;
  }

  svg.addEventListener(
    'pointerdown',
    (event) => {
      swallowNextClick = false;
      cancelPress();
      const id = nodeIdOf(event.target);
      if (event.pointerType !== 'touch' || id === null || fingers.size > 1) return;
      press = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        timer: setTimeout(() => {
          press = null;
          swallowNextClick = true;
          toggleGroupNode(id);
        }, LONG_PRESS_MS),
      };
    },
    true,
  );
  svg.addEventListener(
    'pointermove',
    (event) => {
      if (!press || event.pointerId !== press.pointerId) return;
      if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > LONG_PRESS_SLOP)
        cancelPress();
    },
    true,
  );
  for (const type of ['pointerup', 'pointercancel']) svg.addEventListener(type, cancelPress, true);
  svg.addEventListener('contextmenu', (event) => {
    if (nodeIdOf(event.target) !== null) event.preventDefault();
  });

  svg.addEventListener(
    'click',
    (event) => {
      if (swallowNextClick) {
        swallowNextClick = false;
        stopEvent(event);
        return;
      }
      const id = nodeIdOf(event.target);
      const modified = event.shiftKey || event.ctrlKey || event.metaKey;
      if (id !== null && (modified || groupMode)) {
        stopEvent(event);
        toggleGroupNode(id);
      } else if (groupMode && event.target.closest('.tactical-edge-hit')) {
        stopEvent(event);
        showGroupHint('Only your nodes join a group.');
      }
    },
    true,
  );
  svg.addEventListener(
    'keydown',
    (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const id = nodeIdOf(event.target);
      if (id === null || !(event.shiftKey || groupMode)) return;
      stopEvent(event);
      toggleGroupNode(id);
    },
    true,
  );
  document.addEventListener(
    'keydown',
    (event) => {
      if (event.key !== 'Escape' || !groupMode || document.querySelector('dialog[open]')) return;
      event.stopImmediatePropagation();
      leaveGroup();
    },
    true,
  );

  function toggleGroupNode(id) {
    if (state.nodes[id]?.owner !== 0) {
      showGroupHint('Only your nodes join a group.');
      return;
    }
    store.setGroupMode(true);
    store.toggleGroupMember(id);
    groupMessage = '';
    showSingleMemberOrGroup();
  }

  function setGroup(ids) {
    store.setGroupMode(true);
    store.setBulkSelection(ids);
    groupMessage = '';
    showSingleMemberOrGroup();
  }

  function showSingleMemberOrGroup() {
    store.dismissInspector();
    render();
  }

  function editMemberAlone(id) {
    store.inspectNode(id);
    store.editSelectedNode();
    render();
  }

  function leaveGroup() {
    store.leaveGroupMode();
    store.dismissInspector();
    render();
  }

  function showGroupHint(text) {
    groupBar.querySelector('.tactical-group-hint').textContent = text;
  }

  const groupBar = document.createElement('div');
  groupBar.id = 'tacticalGroupBar';
  groupBar.hidden = true;
  groupBar.setAttribute('role', 'toolbar');
  groupBar.setAttribute('aria-label', 'Node group');
  viewport.append(groupBar);

  function renderGroupBar() {
    groupBar.hidden = !groupMode || currentView !== 'map';
    if (groupBar.hidden) return;
    const match = currentMatch();
    const action = (label, onclick) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.onclick = onclick;
      return button;
    };
    updateChildrenInPlace(groupBar, [
      textElement('strong', bulkSelection.length + ' selected'),
      ...(bulkSelection.length === 1
        ? [action('Edit Node ' + bulkSelection[0], () => editMemberAlone(bulkSelection[0]))]
        : []),
      action('All', () => setGroup(selectors.ownNodes(match))),
      action('Border', () => setGroup(selectors.borderNodes(match))),
      action('Interior', () => setGroup(selectors.interiorNodes(match))),
      action('Clear', () => setGroup([])),
      action('Done', leaveGroup),
      textElement('span', '', 'tactical-group-hint'),
    ]);
  }

  const selectButton = document.createElement('button');
  selectButton.type = 'button';
  selectButton.id = 'uxDockSelect';
  selectButton.onclick = () => {
    if (groupMode) leaveGroup();
    else {
      store.setGroupMode(true);
      render();
    }
  };
  byId('uxDockOrders').after(selectButton);

  function chooseNode(id) {
    store.inspectNode(id);
    render();
  }

  function chooseEdge(a, b) {
    store.inspectEdge(a, b);
    render();
  }

  function dismiss() {
    store.dismissInspector();
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
    store.editSelectedNode();
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
    store.setCamera({
      scale,
      x: vw / 2 - xy[focusedNode][0] * scale,
      y: vh / 2 - xy[focusedNode][1] * scale,
    });
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
    for (const id of groupIds()) {
      const [x, y] = xy[id] || [];
      if (x !== undefined)
        svgElement('circle', { cx: x, cy: y, r: 39, class: 'tactical-group-member' }, graph);
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
    if (!active || root.hidden || event.composedPath().includes(root)) return;
    if (event.target.closest('dialog, #tacticalMenu, .ux-dock, #tacticalGroupBar')) return;
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
    slider.onchange = () => {
      if (!changeShare(id, 'investPct', Number(slider.value))) slider.value = String(pct);
    };
    percent.onchange = () => {
      const value = Number(percent.value);
      if (!Number.isFinite(value) || value < 0 || value > 100) {
        percent.value = String(pct);
        return;
      }
      if (!changeShare(id, 'investPct', value)) percent.value = String(pct);
    };
    label.append(percent);
    primary.append(label, slider, ...investmentTargetControls(id, policy));
    body.append(
      primary,
      defenseControls(id, policy),
      ...pressureControls(id, policy),
      sharesLine(id, policy),
    );
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
    addDetails(body, 'Other policy settings', policyHolder, advancedOpen, (open) =>
      store.setInspectorSection('advancedOpen', open),
    );
    const manualHolder = document.createElement('div');
    manualHolder.dataset.mount = 'manual';
    addDetails(
      body,
      'Manual investment, withdrawal and allocations',
      manualHolder,
      manualOpen,
      (open) => store.setInspectorSection('manualOpen', open),
    );
  }

  function investmentTargetControls(id, policy) {
    const target = policy?.investTarget ?? null;
    const controls = [
      policyNumberField({
        id: 'tacticalInvestTarget',
        key: id + ':investTarget',
        label: 'Until invested reaches',
        value: target,
        placeholder: 'no limit',
        onCommit: (value) => changePolicy(id, 'investTarget', value),
      }),
    ];
    if (softCapEnabled())
      controls.push(
        policyNumberField({
          id: 'tacticalDivestPct',
          key: id + ':divestPct',
          label: 'Above the target, scale down % per round',
          value: policy?.divestPct ?? 0,
          max: 100,
          onCommit: (value) => changePolicy(id, 'divestPct', value ?? 0),
        }),
      );
    const status = investmentStatusText(id);
    if (status) controls.push(textElement('p', status, 'tactical-secondary'));
    const reserve = policy?.reserve ?? defaultPolicy().reserve;
    if (softCapEnabled() && target !== null && target + reserve > SOFT_CAP_RULES.capacity)
      controls.push(
        textElement(
          'p',
          'Target plus defense reserve is above the ' +
            SOFT_CAP_RULES.capacity +
            ' capacity: overflow decay trims invested every round and the policy refills it.',
          'tactical-warning',
        ),
      );
    return controls;
  }

  function defenseControls(id, policy) {
    const block = document.createElement('div');
    block.className = 'tactical-primary-control';
    block.append(
      textElement('strong', 'Defense floor ' + numeric(policy?.reserve ?? defaultPolicy().reserve)),
      policyNumberField({
        id: 'tacticalDefensePct',
        key: id + ':defensePct',
        label: 'Grow by % of surplus',
        value: policy?.defensePct ?? 0,
        max: 100,
        onCommit: (value) => changeShare(id, 'defensePct', value ?? 0),
      }),
      policyNumberField({
        id: 'tacticalDefenseTarget',
        key: id + ':defenseTarget',
        label: 'Up to',
        value: policy?.defenseTarget ?? null,
        placeholder: 'fixed floor',
        onCommit: (value) => changePolicy(id, 'defenseTarget', value),
      }),
    );
    const status = selectors.defenseStatus(currentMatch(), id);
    if (status) block.append(textElement('p', defenseStatusText(status), 'tactical-secondary'));
    if (status && status.target > status.sustainable + 0.05)
      block.append(
        textElement(
          'p',
          'The target is above what this node sustains: the floor stalls near ' +
            numeric(status.sustainable) +
            '.',
          'tactical-warning',
        ),
      );
    return block;
  }

  function defenseStatusText({ floor, next, target, sustainable }) {
    const outlook = ' · sustainable ≈ ' + numeric(sustainable);
    if (Math.abs(floor - target) < 0.05) return 'Floor ' + numeric(floor) + ' · target reached';
    if (floor > target)
      return (
        'Floor ' + numeric(floor) + ' → ' + numeric(next) + ', shrinking to ' + numeric(target)
      );
    return 'Floor ' + numeric(floor) + ' → ' + numeric(next) + ' of ' + numeric(target) + outlook;
  }

  function pressureControls(id, policy) {
    if (!neighbors(id).some((other) => state.nodes[other].owner !== 0)) return [];
    const block = document.createElement('div');
    block.className = 'tactical-primary-control';
    block.append(textElement('strong', 'Border pressure'));
    const edges = Object.keys(policy?.pressure ?? {}).map(Number);
    if (!edges.length)
      block.append(
        textElement(
          'p',
          'Open a connection to an enemy or neutral neighbour to pressure it each round.',
          'tactical-secondary',
        ),
      );
    for (const dest of edges)
      block.append(
        textElement(
          'p',
          'Node ' +
            dest +
            ' · ' +
            numeric(policy.pressure[dest].pct) +
            '% · ' +
            pressureStatusText(selectors.edgePressureStatus(currentMatch(), id, dest), dest),
          'tactical-secondary',
        ),
      );
    return [block];
  }

  function pressureStatusText({ bank, nextBank, minimum, pulse }, dest) {
    if (state.nodes[dest].owner === 0) return 'now yours: the share goes to the rest';
    if (pulse > 0) return 'pulse this round: ' + numeric(pulse) + ' → Node ' + dest;
    return 'banked ' + numeric(bank) + ' → ' + numeric(nextBank) + ' / ' + numeric(minimum);
  }

  function sharesLine(id, policy) {
    const effective = { ...defaultPolicy(), ...policy };
    const invest = effective.investPct;
    const defense = Number.isFinite(effective.defenseTarget) ? (effective.defensePct ?? 0) : 0;
    const pressure = Object.values(effective.pressure ?? {}).reduce(
      (sum, edge) => sum + edge.pct,
      0,
    );
    const total = invest + defense + pressure;
    const destination =
      effective.dest !== null && state.nodes[effective.dest]?.owner === 0
        ? '→ Node ' + effective.dest
        : 'stays on the node';
    const line = textElement(
      'p',
      'Shares: invest ' +
        numeric(invest) +
        '% + defense ' +
        numeric(defense) +
        '%' +
        (pressure > 0 ? ' + pressure ' + numeric(pressure) + '%' : '') +
        ' = ' +
        numeric(total) +
        '% · rest ' +
        numeric(Math.max(0, 100 - total)) +
        '% ' +
        destination,
      'tactical-secondary',
    );
    line.id = 'tacticalShares';
    return line;
  }

  function changeShare(id, key, value) {
    const accepted = changePolicy(id, key, value);
    if (!accepted)
      byId('tacticalShares').textContent =
        'Shares cannot add up to more than 100%. Lower another share first.';
    return accepted;
  }

  function policyNumberField({ id, key, label, value, max = Infinity, placeholder, onCommit }) {
    const field = document.createElement('label');
    field.append(textElement('span', label));
    const input = document.createElement('input');
    input.type = 'number';
    input.min = '0';
    if (max !== Infinity) input.max = String(max);
    input.step = '1';
    input.id = id;
    input.dataset.key = key;
    input.value = value === null ? '' : String(value);
    if (placeholder) input.placeholder = placeholder;
    input.setAttribute('aria-label', label);
    const revert = () => (input.value = value === null ? '' : String(value));
    input.onchange = () => {
      const committed = input.value.trim() === '' ? null : Number(input.value);
      if (committed !== null && !(committed >= 0 && committed <= max)) revert();
      else if (onCommit(committed) === false) revert();
    };
    field.append(input);
    return field;
  }

  function investmentStatusText(id) {
    const status = selectors.investmentStatus(currentMatch(), id);
    if (!status) return null;
    const { invested, target, invest, withdraw, fee, roundsToTarget } = status;
    const progress = 'Invested ' + numeric(invested);
    if (roundsToTarget === 0) return progress + ' · target reached';
    if (status.blockedByManualWithdrawal)
      return (
        progress +
        ' of ' +
        numeric(target) +
        ' · no reinvestment this round after a manual withdrawal. Lower the target to keep it withdrawn.'
      );
    if (invested < target)
      return (
        progress +
        ' of ' +
        numeric(target) +
        ' · +' +
        numeric(invest) +
        ' this round · ' +
        numeric(Math.max(0, target - invested - plan(id).invest - invest)) +
        ' to go'
      );
    if (roundsToTarget === null)
      return (
        progress +
        ', above the target ' +
        numeric(target) +
        (softCapEnabled() ? ' · scale-down is off' : '')
      );
    return (
      progress +
      ' → ' +
      numeric(target) +
      ' · policy withdraws ' +
      numeric(withdraw) +
      ' this round, ' +
      numeric(fee) +
      ' fee · ' +
      roundsToTarget +
      (roundsToTarget === 1 ? ' round' : ' rounds') +
      ' to target'
    );
  }

  function showGroup(body, ids) {
    const forecasts = ids.map((id) => projection(id));
    const total = (values) => values.reduce((sum, value) => sum + value, 0);
    body.append(
      metrics([
        ['Active', total(ids.map((id) => state.nodes[id].active))],
        ['Invested', total(ids.map((id) => state.nodes[id].invested))],
        ['Income', total(forecasts.map((f) => f.income))],
        ['Defense', total(forecasts.map((f) => f.defense))],
        ['Next', total(forecasts.map((f) => f.next))],
        ...(softCapEnabled() ? [['Overflow loss', total(forecasts.map((f) => f.overflow))]] : []),
      ]),
      groupPolicyFields(ids),
      groupNodeChoices(ids),
      groupOneOffOrders(ids),
    );
    if (groupMessage) body.append(textElement('p', groupMessage, 'tactical-warning'));
    body.append(groupMembers(ids));
  }

  function groupPolicyFields(ids) {
    const view = selectors.groupPolicyView(currentMatch(), ids);
    const block = document.createElement('div');
    block.className = 'tactical-primary-control';
    block.append(
      textElement('strong', 'Policy for every node'),
      groupCheckbox(ids, view, 'enabled', 'Policy enabled'),
      groupNumberField(ids, view, 'investPct', 'Invest % of surplus', 100),
      groupNumberField(ids, view, 'investTarget', 'Until invested reaches'),
      ...(softCapEnabled()
        ? [
            groupNumberField(
              ids,
              view,
              'divestPct',
              'Above the target, scale down % per round',
              100,
            ),
          ]
        : []),
      groupNumberField(ids, view, 'reserve', 'Defense floor'),
      groupNumberField(ids, view, 'defensePct', 'Grow the floor by % of surplus', 100),
      groupNumberField(ids, view, 'defenseTarget', 'Floor up to'),
      groupNumberField(ids, view, 'pressurePct', 'Pressure % of surplus', 100),
      groupNumberField(ids, view, 'pressureMin', 'Attack when at least this much is banked'),
      groupCheckbox(ids, view, 'pressureNeutral', 'Pressure includes neutral nodes'),
    );
    return block;
  }

  const NULLABLE_GROUP_FIELDS = ['investTarget', 'defenseTarget'];
  const shownValue = (value) => (value === null ? 'none' : numeric(value));

  function groupNumberField(ids, view, field, label, max = Infinity) {
    const { value, mixed } = view[field];
    return policyNumberField({
      id: 'group-' + field,
      key: 'group:' + field,
      label,
      value: mixed ? null : value,
      max,
      placeholder: mixed
        ? 'mixed (' + shownValue(mixed[0]) + '–' + shownValue(mixed[1]) + ')'
        : NULLABLE_GROUP_FIELDS.includes(field)
          ? 'no limit'
          : undefined,
      onCommit: (committed) => {
        if (committed === null && (mixed || !NULLABLE_GROUP_FIELDS.includes(field))) return false;
        return applyGroupField(ids, field, committed);
      },
    });
  }

  function groupCheckbox(ids, view, field, label) {
    const row = document.createElement('label');
    row.append(textElement('span', label));
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.id = 'group-' + field;
    checkbox.dataset.key = 'group:' + field + (view[field].mixed ? ':mixed' : '');
    checkbox.checked = view[field].value === true;
    checkbox.indeterminate = Boolean(view[field].mixed);
    checkbox.setAttribute('aria-label', label);
    checkbox.onchange = () => applyGroupField(ids, field, checkbox.checked);
    row.append(checkbox);
    return row;
  }

  function applyGroupField(ids, field, value) {
    const rejected = store.applyGroupPolicyField(ids, field, value);
    groupMessage = rejected.length
      ? 'Nothing changed: ' +
        nodeList(rejected) +
        ' would exceed 100% of surplus or reject this value.'
      : '';
    render();
    return rejected.length === 0;
  }

  const nodeList = (ids) => (ids.length === 1 ? 'Node ' : 'Nodes ') + ids.join(', ');

  function groupNodeChoices(ids) {
    const block = document.createElement('div');
    block.className = 'tactical-primary-control';
    block.append(
      textElement(
        'p',
        'Transfer destinations and pinned pressure targets stay per node.',
        'tactical-secondary',
      ),
      groupButton('Clear destinations', () => store.clearGroupDestinations(ids)),
      groupButton('Pressure: weakest enemy for all', () => store.weakestPressureForGroup(ids)),
    );
    return block;
  }

  function groupOneOffOrders(ids) {
    const block = document.createElement('div');
    block.className = 'tactical-primary-control';
    const amount = policyNumberField({
      id: 'groupInvestEach',
      key: 'group:investEach',
      label: 'Invest this round on each',
      value: null,
      placeholder: 'energy',
      onCommit: (value) => {
        if (value === null) return false;
        const skipped = store.investOnEach(ids, value);
        groupMessage = skipped.length
          ? 'Applied to ' +
            (ids.length - skipped.length) +
            ' of ' +
            ids.length +
            '; ' +
            nodeList(skipped) +
            ' lacked energy.'
          : 'Applied to all ' + ids.length + ' nodes.';
        render();
      },
    });
    block.append(
      textElement('strong', 'This round'),
      amount,
      groupButton('Pause policies this round', () => store.pauseGroup(ids)),
      groupButton('Clear orders', () => store.clearGroupOrders(ids)),
      ...(clipboard
        ? [groupButton('Paste policy to group', () => store.pasteGroupPolicy(ids, clipboard))]
        : []),
    );
    return block;
  }

  function groupButton(label, act) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.onclick = () => {
      act();
      groupMessage = '';
      render();
    };
    return button;
  }

  function groupMembers(ids) {
    const list = document.createElement('div');
    list.className = 'tactical-group-members';
    for (const id of ids) {
      const node = state.nodes[id];
      const row = document.createElement('div');
      row.className = 'tactical-group-member-row';
      row.dataset.key = 'member:' + id;
      const open = document.createElement('button');
      open.type = 'button';
      open.textContent = 'Node ' + id;
      open.setAttribute('aria-label', 'Edit node ' + id + ' alone');
      open.onclick = () => {
        store.leaveGroupMode();
        editMemberAlone(id);
      };
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = '×';
      remove.setAttribute('aria-label', 'Remove node ' + id + ' from group');
      remove.onclick = () => toggleGroupNode(id);
      row.append(
        open,
        textElement(
          'span',
          numeric(node.active) +
            ' active · ' +
            numeric(node.invested) +
            ' invested · next ' +
            numeric(projection(id).next) +
            (softCapEnabled()
              ? ' · ' + numeric(node.active + node.invested) + ' / ' + SOFT_CAP_RULES.capacity
              : ''),
          'tactical-secondary',
        ),
        remove,
      );
      list.append(row);
    }
    return list;
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
        store.setEdgeSource(Number(select.value));
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
    const replaced = bothFriendly ? replacedSupport(source, destination) : null;
    if (replaced?.manual)
      field.append(
        textElement(
          'small',
          'Replaces Node ' +
            destination +
            ' → ' +
            source +
            ': ' +
            numeric(replaced.manual) +
            ' manual support.',
          'tactical-warning',
        ),
      );
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
      if (replaced.route)
        policyBox.append(
          textElement(
            'p',
            'Replaces Node ' + destination + ' → ' + source + ' surplus route.',
            'tactical-warning',
          ),
        );
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
    if (type === 'Attack') body.append(pressureToggle(source, destination));
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

  function pressureToggle(source, destination) {
    const settings = policies[source]?.pressure?.[destination];
    const box = document.createElement('div');
    box.className = 'tactical-primary-control';
    const caption = 'Pressure Node ' + destination + ' from Node ' + source + ' each round';
    const toggle = document.createElement('label');
    toggle.append(textElement('strong', caption));
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.id = 'tacticalAutoPressure';
    checkbox.checked = Boolean(settings);
    checkbox.setAttribute('aria-label', caption);
    checkbox.onchange = () => {
      const accepted = changeEdgePressure(source, destination, checkbox.checked ? {} : null);
      if (!accepted) checkbox.checked = false;
    };
    toggle.append(checkbox);
    const warning = textElement('p', '', 'tactical-warning');
    warning.id = 'tacticalEdgePressureWarning';
    box.append(toggle);
    if (!settings) {
      box.append(
        textElement(
          'p',
          'Banks a share of surplus and attacks with it once the bank reaches the minimum.',
          'tactical-secondary',
        ),
        warning,
      );
      return box;
    }
    const key = source + '-' + destination;
    box.append(
      policyNumberField({
        id: 'tacticalEdgePressurePct',
        key: key + ':pct',
        label: 'Send % of surplus',
        value: settings.pct,
        max: 100,
        onCommit: (pct) => pct !== null && changeEdgePressure(source, destination, { pct }),
      }),
      policyNumberField({
        id: 'tacticalEdgePressureMin',
        key: key + ':min',
        label: 'Attack when at least this much is banked',
        value: settings.min ?? 10,
        onCommit: (min) => min !== null && changeEdgePressure(source, destination, { min }),
      }),
    );
    box.append(
      textElement(
        'p',
        pressureStatusText(
          selectors.edgePressureStatus(currentMatch(), source, destination),
          destination,
        ),
        'tactical-secondary',
      ),
      warning,
    );
    return box;
  }

  function changeEdgePressure(source, destination, fields) {
    const before = currentMatch();
    store.setEdgePressure(source, destination, fields);
    const accepted = currentMatch() !== before;
    render();
    if (!accepted)
      byId('tacticalEdgePressureWarning')?.replaceChildren(
        'Node ' +
          source +
          "'s shares cannot add up to more than 100%, and the percentage must be above 0.",
      );
    return accepted;
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
    if (mobile()) return;
    if (showingGroup()) {
      root.style.left = Math.max(10, innerWidth - 372) + 'px';
      root.style.top = '70px';
      return;
    }
    if (!active) return;
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
    const group = showingGroup();
    root.hidden =
      !(group || (active && editing)) ||
      currentView !== 'map' ||
      Boolean(document.querySelector('dialog[open]'));
    document.body.classList.toggle('tactical-selection-active', !root.hidden);
    if (root.hidden) {
      mountLegacyControls();
      return;
    }
    root.classList.toggle('is-editing', true);
    const subject = group
      ? 'Group · ' + groupIds().length + ' nodes'
      : active.kind === 'node'
        ? 'Node ' + active.id
        : 'Connection ' + active.a + ' — ' + active.b;
    const header = document.createElement('div');
    header.className = 'tactical-inspector-head';
    header.append(textElement('strong', subject));
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = '×';
    close.setAttribute('aria-label', group ? 'Leave group' : 'Clear map selection');
    close.onclick = group ? leaveGroup : dismissAndReturnFocus;
    header.append(close);
    const body = document.createElement('div');
    body.className = 'tactical-inspector-body';
    if (group) showGroup(body, groupIds());
    else if (active.kind === 'node') showNode(body, active.id);
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
      store.dismissInspector();
      previousRound = state.round;
    }
    if (active?.kind === 'node' && !state.nodes[active.id]) store.forgetInspectedNode();
    const focusedMapItem = mapItemSelector(document.activeElement);
    oldRender();
    // The thumb-reachable control mirrors the authoritative round button.
    byId('uxDockResolve').disabled = byId('resolve').disabled;
    drawSelection();
    renderGroupBar();
    selectButton.textContent = groupMode ? 'Done' : 'Select';
    showInspector();
    if (focusedMapItem) svg.querySelector(focusedMapItem)?.focus();
  };
  byId('generate').addEventListener('click', () => store.closeInspector(), true);
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
