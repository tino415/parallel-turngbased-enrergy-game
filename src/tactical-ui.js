'use strict';

// Contextual presentation layer. The existing game/engine functions remain authoritative.
(() => {
  const byId = (id) => document.getElementById(id);
  const mobile = () => matchMedia('(max-width: 760px)').matches;
  const anOverlayIsOpen = () => Boolean(document.querySelector('dialog[open], :popover-open'));
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
  const ordersCount = document.createElement('span');
  ordersCount.id = 'menuOrdersCount';
  for (const [label, original] of menuItems) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    if (original === 'uxReviewHead') button.append(' ', ordersCount);
    button.onclick = () => {
      menu.open = false;
      menu.querySelector('summary').focus();
      byId(original).click();
    };
    menu.querySelector('.tactical-menu-content').append(button);
  }
  document.querySelector('body > header > div:last-child').append(menu);

  // Planned energy travels along the connection itself; the legacy renderer
  // supplied a second competing stroke over each connection. Retain its
  // direction arrows, values, and economic labels but decorate the base edges
  // instead of drawing any separate flow lines.
  const originalRenderFlows = renderFlows;
  renderFlows = (mapSvg, graph, element) => {
    originalRenderFlows(mapSvg, graph, element);
    const visible = previewOrders().filter(
      (order) => order.dest !== null && order.dest !== undefined && order.amount > 0.01,
    );
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
    if (store.getSnapshot().ui.aiDebug) drawAiPlans(graph, element);
  };

  const aiPlanOrders = () =>
    selectors.aiDebugPlan(currentMatch()).orders.filter((order) => order.amount > 0.01);

  function drawAiPlans(graph, element) {
    const layer = element('g', { class: 'ai-debug-flows' }, graph);
    for (const order of aiPlanOrders())
      drawPlayerMove(element, layer, xy, 'ai-debug', {
        ...order,
        owner: state.nodes[order.source].owner,
      });
  }

  function aiPlanLines(id) {
    const { orders, withdrawals } = selectors.aiDebugPlan(currentMatch());
    const describe = (order) =>
      order.type === 'invest'
        ? 'Invest ' + compactEnergy(order.amount)
        : (order.type === 'attack' ? 'Attack node ' : 'Transfer to node ') +
          order.dest +
          ': ' +
          compactEnergy(order.amount);
    const lines = [
      ...(withdrawals[id] > 0.01 ? ['Withdraw ' + compactEnergy(withdrawals[id])] : []),
      ...orders.filter((order) => order.source === id && order.amount > 0.01).map(describe),
    ];
    const list = document.createElement('ul');
    list.className = 'ai-debug-plan';
    list.dataset.key = 'ai-debug-plan';
    list.append(
      ...(lines.length ? lines : ['Holds: no orders this round']).map((text) =>
        textElement('li', text),
      ),
    );
    return list;
  }

  let { active, editing } = store.getSnapshot().ui.inspector;
  let { groupMode, groupEditing, bulkSelection, bulkEdges } = store.getSnapshot().ui;
  store.subscribe(({ ui }, previous) => {
    ({ active, editing } = ui.inspector);
    ({ groupMode, groupEditing, bulkSelection, bulkEdges } = ui);
    if (ui.camera !== previous.ui.camera) positionInspector();
  });
  const groupIds = () => (groupMode ? bulkSelection : []);
  const groupEdges = () => (groupMode ? bulkEdges : []);
  const showingEdgeGroup = () => groupEditing && groupEdges().length > 0;
  const showingGroup = () => groupEditing && groupIds().length >= 2;
  const editedMember = () => (groupEditing && groupIds().length === 1 ? groupIds()[0] : null);
  let groupMessage = '';
  store.focusNode(state.nodes.find((node) => isMine(node.id))?.id ?? 0);
  let previousRound = state.round;
  const svg = byId('map');
  const viewport = byId('mapViewport');
  // Keep the editor independent of the action dock. Mobile positions it above
  // the dock rather than replacing/hiding the existing Orders/Resolve buttons.
  // Its contents scroll; the document and bottom dock never do.
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

  function edgeOf(element) {
    const hit = element?.closest?.('.tactical-edge-hit');
    return hit ? hit.dataset.edge.split('-').map(Number) : null;
  }

  function toggleGroupItemAt(element) {
    const id = nodeIdOf(element);
    if (id !== null) toggleGroupNode(id);
    else toggleGroupEdge(...edgeOf(element));
  }

  const isGroupItem = (element) => nodeIdOf(element) !== null || edgeOf(element) !== null;

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
      const target = event.target;
      if (event.pointerType !== 'touch' || !isGroupItem(target) || fingers.size > 1) return;
      press = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        timer: setTimeout(() => {
          press = null;
          swallowNextClick = true;
          toggleGroupItemAt(target);
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
    if (isGroupItem(event.target)) event.preventDefault();
  });

  svg.addEventListener(
    'click',
    (event) => {
      if (swallowNextClick) {
        swallowNextClick = false;
        stopEvent(event);
        return;
      }
      const modified = event.shiftKey || event.ctrlKey || event.metaKey;
      if (!isGroupItem(event.target) || !(modified || groupMode)) return;
      stopEvent(event);
      toggleGroupItemAt(event.target);
    },
    true,
  );
  svg.addEventListener(
    'keydown',
    (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      if (!isGroupItem(event.target) || !(event.shiftKey || groupMode)) return;
      stopEvent(event);
      toggleGroupItemAt(event.target);
    },
    true,
  );
  document.addEventListener(
    'keydown',
    (event) => {
      if (event.key !== 'Escape' || !groupMode || anOverlayIsOpen()) return;
      event.stopImmediatePropagation();
      leaveGroup();
    },
    true,
  );

  function toggleGroupNode(id) {
    if (groupEdges().length) {
      showGroupHint('This group holds connections. Done, then pick nodes.');
      return;
    }
    if (!isMine(id)) {
      showGroupHint('Only your nodes join a group.');
      return;
    }
    store.setGroupMode(true);
    store.toggleGroupMember(id);
    changedGroup();
  }

  function toggleGroupEdge(a, b) {
    if (groupIds().length) {
      showGroupHint('This group holds nodes. Done, then pick connections.');
      return;
    }
    if (selectors.edgeSource(currentMatch(), a, b) === null) {
      showGroupHint('Only connections touching your nodes join.');
      return;
    }
    store.setGroupMode(true);
    store.toggleGroupEdge(a, b);
    changedGroup();
  }

  function changedGroup() {
    if (!bulkSelection.length && !bulkEdges.length) store.setGroupEditing(false);
    groupMessage = '';
    store.dismissInspector();
    render();
  }

  function editGroup() {
    store.dismissInspector();
    store.setGroupEditing(true);
    render();
  }

  function closeGroupEditor() {
    store.setGroupEditing(false);
    render();
  }

  function editMemberAlone(id) {
    store.leaveGroupMode();
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
    if (!groupMode) {
      store.setGroupMode(true);
      render();
    }
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
    const action = (label, onclick) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.onclick = onclick;
      return button;
    };
    const edit = action('Edit', editGroup);
    edit.disabled = bulkSelection.length === 0 && bulkEdges.length === 0;
    updateChildrenInPlace(groupBar, [
      textElement('strong', groupCount() + ' selected'),
      edit,
      action('Done', leaveGroup),
      textElement('span', '', 'tactical-group-hint'),
    ]);
  }

  function groupCount() {
    if (!bulkEdges.length) return String(bulkSelection.length);
    return bulkEdges.length + (bulkEdges.length === 1 ? ' connection' : ' connections');
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
  byId('uxDockResolve').before(selectButton);

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
    if (element.classList.contains('tactical-map-swap')) return '.tactical-map-swap';
    return null;
  }

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
      const attributes = trimmedLine(a, b);
      if (active?.kind === 'edge' && active.a === a && active.b === b) {
        svgElement(
          'line',
          {
            ...(active.source === b ? reversed(attributes) : attributes),
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
    for (const [source, destination] of groupEdges())
      svgElement(
        'line',
        {
          ...trimmedLine(source, destination),
          class: 'tactical-group-edge',
          'data-group-edge': source + '-' + destination,
        },
        graph,
      );
    for (const ring of selectionRings()) {
      const [x, y] = xy[ring.id] || [];
      if (x === undefined) continue;
      svgElement(
        'circle',
        {
          cx: x,
          cy: y,
          r: 34,
          class: 'tactical-node-selected' + (ring.role ? ' tactical-node-' + ring.role : ''),
          'data-ring': ring.id,
        },
        graph,
      );
      if (ring.role)
        svgElement('text', { x, y: y - 58, class: 'tactical-node-tag' }, graph).textContent =
          ring.role.toUpperCase();
    }
    drawDirectionArrow(graph);
    drawMapSwap(graph);
  }

  function trimmedLine(from, to) {
    const [ax, ay] = xy[from];
    const [bx, by] = xy[to];
    const dx = bx - ax;
    const dy = by - ay;
    const length = Math.hypot(dx, dy) || 1;
    return {
      x1: ax + (dx * 37) / length,
      y1: ay + (dy * 37) / length,
      x2: bx - (dx * 37) / length,
      y2: by - (dy * 37) / length,
    };
  }

  function drawMapSwap(graph) {
    if (active?.kind !== 'edge' || !bothEndsFriendly(active.a, active.b)) return;
    const { source, destination } = edgeDirection();
    const [ax, ay] = xy[active.a];
    const [bx, by] = xy[active.b];
    const length = Math.hypot(bx - ax, by - ay) || 1;
    const besideTheLine = 38;
    const x = (ax + bx) / 2 + ((by - ay) / length) * besideTheLine;
    const y = (ay + by) / 2 - ((bx - ax) / length) * besideTheLine;
    const button = svgElement(
      'g',
      {
        class: 'tactical-map-swap',
        transform: 'translate(' + x + ' ' + y + ')',
        tabindex: 0,
        role: 'button',
        'aria-label': 'Swap direction: from Node ' + source + ' to Node ' + destination,
      },
      graph,
    );
    svgElement('circle', { r: 22, class: 'tactical-map-swap-hit' }, button);
    svgElement('circle', { r: 16, class: 'tactical-map-swap-face' }, button);
    svgElement('text', { y: 6, class: 'tactical-map-swap-label' }, button).textContent = '⇄';
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      swapDirection();
    });
    button.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      swapDirection();
    });
  }

  function swapDirection() {
    const { destination } = edgeDirection();
    store.setEdgeSource(destination);
    render();
  }

  const bothEndsFriendly = (a, b) => isMine(a) && isMine(b);

  function selectionRings() {
    if (active?.kind === 'node') return [{ id: active.id, role: null }];
    if (active?.kind !== 'edge') return [];
    if (active.source === null)
      return [
        { id: active.a, role: null },
        { id: active.b, role: null },
      ];
    const { source, destination } = edgeDirection();
    return [
      { id: source, role: 'from' },
      { id: destination, role: 'to' },
    ];
  }

  function edgeDirection() {
    return {
      source: active.source,
      destination: active.source === active.a ? active.b : active.a,
    };
  }

  function reversed({ x1, y1, x2, y2 }) {
    return { x1: x2, y1: y2, x2: x1, y2: y1 };
  }

  function drawDirectionArrow(graph) {
    if (active?.kind !== 'edge' || active.source === null) return;
    const { source, destination } = edgeDirection();
    const [sx, sy] = xy[source];
    const [tx, ty] = xy[destination];
    const length = Math.hypot(tx - sx, ty - sy) || 1;
    const along = [(tx - sx) / length, (ty - sy) / length];
    const across = [-along[1], along[0]];
    const tip = [tx - along[0] * 37, ty - along[1] * 37];
    const corner = (side) => [
      tip[0] - along[0] * 18 + across[0] * 10 * side,
      tip[1] - along[1] * 18 + across[1] * 10 * side,
    ];
    svgElement(
      'path',
      {
        d: 'M ' + [tip, corner(1), corner(-1)].map((point) => point.join(' ')).join(' L ') + ' Z',
        class: 'tactical-edge-arrow',
        'data-from': source,
        'data-to': destination,
      },
      graph,
    );
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

  menu.addEventListener('toggle', () => {
    if (menu.open && active) dismiss();
  });

  // Orders is a separate dialog, not another layer on top of the
  // contextual editor. Clear selection before Orders opens; otherwise
  // the editor reappears behind it when Orders closes.
  byId('uxReviewHead').addEventListener(
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
      const bold = textElement('b', typeof amount === 'number' ? numeric(amount) : amount);
      stat.append(label + ' ', bold);
      container.append(stat);
    }
    return container;
  }

  function showNode(body, id, isEditing = editing) {
    if (!isMine(id)) {
      body.append(
        nodeMetrics(id, null),
        textElement('p', 'Inspect only: this node is not yours.', 'tactical-secondary'),
        ...(store.getSnapshot().ui.aiDebug && state.nodes[id].owner !== null
          ? [textElement('h4', 'AI plan this round'), aiPlanLines(id)]
          : []),
      );
      return;
    }
    const policy = policies[id];
    body.append(nodeMetrics(id, projection(id)));
    if (!isEditing) return;
    body.append(
      policyChips(id, policy),
      ...investmentRows(id, policy),
      ...defenseRows(id, policy),
      ...pressureLines(id, policy),
      sharesLine(id, policy),
      divider(),
      ...thisRoundRows(id),
    );
  }

  function nodeMetrics(id, prediction) {
    const node = state.nodes[id];
    return metrics([
      ['Active', node.active],
      ['Invested', node.invested],
      ...(prediction
        ? [
            ['Defense', prediction.defense],
            ['Next', prediction.next],
          ]
        : []),
      ...(softCapEnabled()
        ? [['Capacity', numeric(node.active + node.invested) + ' / ' + SOFT_CAP_RULES.capacity]]
        : []),
      ...(prediction?.overflow > 0 ? [['Overflow loss', prediction.overflow]] : []),
    ]);
  }

  function policyChips(id, policy) {
    const row = document.createElement('div');
    row.className = 'tactical-chips';
    row.dataset.key = 'policy-chips';
    row.append(
      chipToggle({
        id: 'tacticalPolicyEnabled',
        label: 'Policy',
        name: 'Enable policy for node ' + id,
        checked: Boolean(policy?.enabled),
        onChange: (checked) => changePolicy(id, 'enabled', checked),
      }),
      chipToggle({
        id: 'tacticalPolicyPause',
        label: 'Pause round',
        name: 'Pause policy this round',
        checked: Boolean(plan(id).hold),
        onChange: (checked) => {
          store.setHold(id, checked);
          render();
        },
      }),
      chipButton('tacticalCopyPolicy', 'Copy', 'Copy policy', () =>
        store.copyPolicy({ ...defaultPolicy(), enabled: false, ...policy }),
      ),
    );
    if (clipboard)
      row.append(
        chipButton('tacticalPastePolicy', 'Paste', 'Paste policy', () =>
          store.pastePolicy(id, clipboard),
        ),
      );
    return row;
  }

  function investmentRows(id, policy) {
    const percent = policy?.investPct ?? defaultPolicy().investPct;
    const target = policy?.investTarget ?? null;
    const rows = [
      editorRow(
        'Invest',
        [
          policyNumberField({
            id: 'tacticalPolicyPercent',
            key: id + ':investPct',
            label: '% surplus',
            name: 'Invest surplus percent',
            value: percent,
            max: 100,
            onCommit: (value) => value !== null && changeShare(id, 'investPct', value),
          }),
          policyNumberField({
            id: 'tacticalInvestTarget',
            key: id + ':investTarget',
            label: 'until',
            name: 'Until invested reaches',
            value: target,
            placeholder: 'none',
            onCommit: (value) => changePolicy(id, 'investTarget', value),
          }),
          ...(softCapEnabled()
            ? [
                policyNumberField({
                  id: 'tacticalDivestPct',
                  key: id + ':divestPct',
                  label: '↓ % / round',
                  name: 'Above the target, scale down % per round',
                  value: policy?.divestPct ?? 0,
                  max: 100,
                  onCommit: (value) => changePolicy(id, 'divestPct', value ?? 0),
                }),
              ]
            : []),
        ],
        help('Invest', [
          'Share of each round’s surplus the policy invests, until invested energy reaches “until”. Leave “until” empty for no limit.',
          ...(softCapEnabled()
            ? [
                '↓ % / round: above the target, the policy withdraws that share of the excess each round, paying the withdrawal fee.',
              ]
            : []),
        ]),
      ),
      investmentSlider(id, percent),
    ];
    const status = investmentStatusText(id);
    if (status) rows.push(textElement('p', status, 'tactical-secondary'));
    const reserve = policy?.reserve ?? defaultPolicy().reserve;
    if (softCapEnabled() && target !== null && target + reserve > SOFT_CAP_RULES.capacity)
      rows.push(
        textElement(
          'p',
          'Target plus defense floor is above the ' +
            SOFT_CAP_RULES.capacity +
            ' capacity: overflow decay trims invested every round and the policy refills it.',
          'tactical-warning',
        ),
      );
    return rows;
  }

  function investmentSlider(id, percent) {
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '0';
    slider.max = '100';
    slider.step = '1';
    slider.value = String(percent);
    slider.className = 'tactical-slider';
    slider.setAttribute('aria-label', 'Investment percentage slider');
    slider.oninput = () => {
      byId('tacticalPolicyPercent').value = slider.value;
    };
    slider.onchange = () => {
      if (!changeShare(id, 'investPct', Number(slider.value))) slider.value = String(percent);
    };
    return slider;
  }

  function defenseRows(id, policy) {
    const rows = [
      editorRow(
        'Defense',
        [
          policyNumberField({
            id: 'tacticalDefenseFloor',
            key: id + ':reserve',
            label: 'floor',
            name: 'Defense floor',
            value: policy?.reserve ?? defaultPolicy().reserve,
            step: '0.1',
            onCommit: (value) => value !== null && changePolicy(id, 'reserve', value),
          }),
          policyNumberField({
            id: 'tacticalDefensePct',
            key: id + ':defensePct',
            label: 'grow %',
            name: 'Grow by % of surplus',
            value: policy?.defensePct ?? 0,
            max: 100,
            onCommit: (value) => changeShare(id, 'defensePct', value ?? 0),
          }),
          policyNumberField({
            id: 'tacticalDefenseTarget',
            key: id + ':defenseTarget',
            label: 'up to',
            name: 'Up to',
            value: policy?.defenseTarget ?? null,
            placeholder: 'none',
            onCommit: (value) => changePolicy(id, 'defenseTarget', value),
          }),
        ],
        help('Defense floor', [
          'Active energy the policy never spends. It stays on the node and defends.',
          'grow %: share of surplus that raises the floor each round, up to “up to”. Leave “up to” empty to keep the floor fixed.',
        ]),
      ),
    ];
    const status = selectors.defenseStatus(currentMatch(), id);
    if (status) rows.push(textElement('p', defenseStatusText(status), 'tactical-secondary'));
    if (status && status.target > status.sustainable + 0.05)
      rows.push(
        textElement(
          'p',
          'The target is above what this node sustains: the floor stalls near ' +
            numeric(status.sustainable) +
            '.',
          'tactical-warning',
        ),
      );
    return rows;
  }

  function thisRoundRows(id) {
    const node = state.nodes[id];
    const p = plan(id);
    const most = Math.max(node.active, availableEnergy(id, p));
    const error = textElement('p', '', 'tactical-warning');
    error.id = 'tacticalRoundError';
    const clear = chipButton('tacticalClearOrders', 'Clear', 'Clear node orders', () =>
      store.clearNodeOrders(id),
    );
    return [
      editorRow(
        'This round',
        [
          ...(softCapEnabled()
            ? [
                allocationField(id, 'withdraw', {
                  label: 'withdraw',
                  name: 'Withdraw invested to active',
                  value: withdrawal(id, p),
                  max: node.invested,
                }),
                withdrawAllButton(id, node),
              ]
            : []),
          allocationField(id, null, {
            label: 'invest',
            name: 'Invest this round',
            value: p.invest,
            max: most,
          }),
          clear,
        ],
        help('This round', [
          'One-off orders for the next resolve. Manual orders go before the policy.',
          ...(softCapEnabled()
            ? [
                'Withdrawn energy is spendable this round and costs a ' +
                  Math.round(100 * SOFT_CAP_RULES.withdrawalFee) +
                  '% fee. Energy above ' +
                  SOFT_CAP_RULES.capacity +
                  ' decays ' +
                  Math.round(100 * SOFT_CAP_RULES.overflowDecay) +
                  '% at round end, invested energy included.',
              ]
            : []),
          'Attacks and transfers are set on the connection.',
        ]),
        { wraps: true },
      ),
      error,
    ];
  }

  function withdrawAllButton(id, node) {
    const button = chipButton(
      'tacticalWithdrawAll',
      'Withdraw all',
      'Withdraw all invested energy',
      () => store.setAllocation(id, 'withdraw', node.invested),
    );
    button.disabled = node.invested <= 0;
    return button;
  }

  function allocationField(id, target, { label, name, value, max }) {
    const kind = target ?? 'invest';
    const shown = () => String(Number(value.toFixed(2)));
    const field = textElement('label', '', 'tactical-field');
    field.append(textElement('span', label));
    const input = document.createElement('input');
    input.type = 'number';
    input.min = '0';
    input.max = String(max);
    input.step = '0.1';
    input.value = shown();
    input.dataset.allocation = kind;
    input.dataset.key = id + ':' + kind;
    input.setAttribute('aria-label', name);
    input.onchange = () => {
      const amount = Number(input.value);
      if (!Number.isFinite(amount) || amount < 0 || amount > max + 1e-8) {
        input.value = shown();
        byId('tacticalRoundError').textContent = 'Invalid amount';
        return;
      }
      const limit = store.setAllocation(id, target, amount);
      if (limit === undefined) render();
      else {
        input.value = shown();
        byId('tacticalRoundError').textContent =
          'Over budget: allocations cannot exceed ' + numeric(limit);
      }
    };
    field.append(input);
    return field;
  }

  function editorRow(label, controls, helpParts = [], { wraps = false } = {}) {
    const row = document.createElement('div');
    row.className = 'tactical-editor-row';
    row.classList.toggle('tactical-editor-row-wrapping', wraps);
    row.dataset.key = 'row:' + label;
    row.append(textElement('span', label, 'tactical-row-label'), ...controls, ...helpParts);
    return row;
  }

  function help(title, paragraphs) {
    const id = 'tacticalHelp-' + title.toLowerCase().replaceAll(/[^a-z]+/g, '-');
    const button = textElement('button', '?', 'tactical-help');
    button.type = 'button';
    button.setAttribute('popovertarget', id);
    button.setAttribute('aria-label', 'About ' + title.toLowerCase());
    const popover = document.createElement('div');
    popover.id = id;
    popover.className = 'tactical-help-popover';
    popover.setAttribute('popover', '');
    popover.append(
      textElement('strong', title),
      ...paragraphs.map((text) => textElement('p', text)),
    );
    return [button, popover];
  }

  function chipToggle({ id, label, name, checked, onChange }) {
    const chip = textElement('label', '', 'tactical-chip');
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.id = id;
    box.checked = checked;
    box.setAttribute('aria-label', name);
    box.onchange = () => {
      if (onChange(box.checked) === false) box.checked = checked;
    };
    chip.append(box, textElement('span', label));
    return chip;
  }

  function chipButton(id, label, name, act) {
    const button = textElement('button', label, 'tactical-chip');
    button.type = 'button';
    button.id = id;
    button.setAttribute('aria-label', name);
    button.onclick = () => {
      act();
      render();
    };
    return button;
  }

  const divider = () => textElement('hr', '', 'tactical-divider');

  function defenseStatusText({ floor, next, target, sustainable }) {
    const outlook = ' · sustainable ≈ ' + numeric(sustainable);
    if (Math.abs(floor - target) < 0.05) return 'Floor ' + numeric(floor) + ' · target reached';
    if (floor > target)
      return (
        'Floor ' + numeric(floor) + ' → ' + numeric(next) + ', shrinking to ' + numeric(target)
      );
    return 'Floor ' + numeric(floor) + ' → ' + numeric(next) + ' of ' + numeric(target) + outlook;
  }

  function pressureLines(id, policy) {
    return Object.entries(policy?.pressure ?? {}).map(([dest, edge]) =>
      textElement(
        'p',
        'Pressure → Node ' +
          dest +
          ' · ' +
          numeric(edge.pct) +
          '% · ' +
          pressureStatusText(
            selectors.edgePressureStatus(currentMatch(), id, Number(dest)),
            Number(dest),
          ),
        'tactical-secondary',
      ),
    );
  }

  function pressureStatusText({ bank, nextBank, minimum, pulse }, dest) {
    if (isMine(dest)) return 'now yours: the share goes to the rest';
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
      effective.dest !== null && isMine(effective.dest)
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

  function policyNumberField({
    id,
    key,
    label,
    name = label,
    value,
    max = Infinity,
    step = '1',
    placeholder,
    title,
    onCommit,
  }) {
    const field = textElement('label', '', 'tactical-field');
    field.append(textElement('span', label));
    const input = document.createElement('input');
    input.type = 'number';
    input.min = '0';
    if (max !== Infinity) input.max = String(max);
    input.step = step;
    input.id = id;
    input.dataset.key = key;
    input.value = value === null ? '' : String(value);
    if (placeholder) input.placeholder = placeholder;
    if (title) input.title = title;
    input.setAttribute('aria-label', name);
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
    );
    return block;
  }

  const NULLABLE_GROUP_FIELDS = ['investTarget', 'defenseTarget'];
  const shownValue = (value) => (value === null ? 'none' : numeric(value));
  const mixedPlaceholder = ([lowest, highest]) =>
    'mixed (' + shownValue(lowest) + '–' + shownValue(highest) + ')';
  const compactMixed = (mixed) =>
    mixed
      ? {
          placeholder: shownValue(mixed[0]) + '–' + shownValue(mixed[1]),
          title: mixedPlaceholder(mixed),
        }
      : {};

  function groupNumberField(ids, view, field, label, max = Infinity) {
    const { value, mixed } = view[field];
    return policyNumberField({
      id: 'group-' + field,
      key: 'group:' + field,
      label,
      value: mixed ? null : value,
      max,
      placeholder: mixed
        ? mixedPlaceholder(mixed)
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
        'Transfer destinations stay per node. Border pressure starts on a connection.',
        'tactical-secondary',
      ),
      ...pressuredEdgeFields(ids),
      groupButton('Clear destinations', () => store.clearGroupDestinations(ids)),
      groupButton('Stop border pressure', () => store.stopGroupPressure(ids)),
    );
    return block;
  }

  function pressuredEdgeFields(ids) {
    const pairs = selectors.pressuredEdges(currentMatch(), ids);
    if (!pairs.length) return [];
    const view = selectors.groupEdgeView(currentMatch(), pairs);
    return [
      editorRow('Pressure', groupPressureFields(pairs, view)),
      textElement(
        'p',
        'On the ' +
          pairs.length +
          (pairs.length === 1 ? ' pressured connection' : ' pressured connections') +
          ' of these nodes: ' +
          edgeList(pairs) +
          '.',
        'tactical-secondary',
      ),
    ];
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
    return memberList(
      ids.map((id) =>
        memberRow({
          key: 'member:' + id,
          label: 'Node ' + id,
          subject: 'node ' + id,
          detail: nodeMemberDetail(id),
          onOpen: () => editMemberAlone(id),
          onRemove: () => toggleGroupNode(id),
        }),
      ),
    );
  }

  function nodeMemberDetail(id) {
    const node = state.nodes[id];
    return (
      numeric(node.active) +
      ' active · ' +
      numeric(node.invested) +
      ' invested · next ' +
      numeric(projection(id).next) +
      (softCapEnabled()
        ? ' · ' + numeric(node.active + node.invested) + ' / ' + SOFT_CAP_RULES.capacity
        : '')
    );
  }

  function memberList(rows) {
    const list = document.createElement('div');
    list.className = 'tactical-group-members';
    list.append(...rows);
    return list;
  }

  function memberRow({ key, label, subject, detail, onOpen, onRemove, extra = [] }) {
    const row = document.createElement('div');
    row.className = 'tactical-group-member-row';
    row.dataset.key = key;
    const open = textElement('button', label);
    open.type = 'button';
    open.setAttribute('aria-label', 'Edit ' + subject + ' alone');
    open.onclick = onOpen;
    const remove = textElement('button', '×');
    remove.type = 'button';
    remove.setAttribute('aria-label', 'Remove ' + subject + ' from group');
    remove.onclick = onRemove;
    row.append(open, textElement('span', detail, 'tactical-secondary'), ...extra, remove);
    return row;
  }

  function showEdgeGroup(body, pairs) {
    const view = selectors.groupEdgeView(currentMatch(), pairs);
    body.append(
      metrics([
        ['Attacks', view.attacks],
        ['Sending', view.sending],
        ['Pressured', view.pressured],
      ]),
      groupAmountRow(pairs, view),
      ...(view.attacks ? [groupWinChanceRow(pairs)] : []),
      divider(),
      ...(view.attacks ? groupPressureRows(pairs, view) : []),
      groupStopRow(pairs, view),
    );
    if (groupMessage) body.append(textElement('p', groupMessage, 'tactical-warning'));
    body.append(edgeGroupMembers(pairs));
  }

  function groupAmountRow(pairs, view) {
    const { value, mixed } = view.amount;
    const amount = policyNumberField({
      id: 'groupEdgeAmount',
      key: 'group:edgeAmount',
      label: 'energy',
      name: 'Energy on each connection',
      value: mixed ? null : value,
      step: '0.1',
      ...compactMixed(mixed),
      onCommit: (committed) =>
        committed !== null && reportSkipped(pairs, store.sendOnEachEdge(pairs, committed)),
    });
    amount.classList.add('tactical-field-wide');
    const split = (kind, label, name) => {
      const button = textElement('button', label);
      button.type = 'button';
      button.dataset.preset = kind;
      button.setAttribute('aria-label', name);
      button.onclick = () => {
        store.splitOnEachEdge(pairs, kind);
        groupMessage = '';
        render();
      };
      return button;
    };
    const presets = document.createElement('div');
    presets.className = 'tactical-order-presets';
    presets.append(
      split('all', 'All', 'Send all, split between each node’s connections'),
      split('surplus', 'Surplus', 'Send all surplus, split between each node’s connections'),
    );
    return editorRow(
      view.attacks === pairs.length ? 'Attack each' : 'Send each',
      [amount, presets],
      help('Send each', [
        'The amount goes on every selected connection. A connection whose node lacks the energy keeps its order.',
        'All and Surplus split a node’s energy evenly between its selected connections.',
      ]),
    );
  }

  function groupWinChanceRow(pairs) {
    const presets = document.createElement('div');
    presets.className = 'tactical-order-presets';
    presets.append(
      ...[0.7, 0.9, 1].map((chance) => {
        const percent = Math.round(chance * 100);
        const button = textElement('button', percent + '%');
        button.type = 'button';
        button.dataset.preset = 'chance-' + percent;
        button.setAttribute('aria-label', percent + '% success attack on each connection');
        button.onclick = () =>
          reportSkipped(attacksIn(pairs), store.attackChanceOnEachEdge(pairs, chance));
        return button;
      }),
    );
    return editorRow(
      'Win chance',
      [presets],
      help('Win chance on each', [
        'Each attack gets the smallest amount with that chance against its own target’s defense now. Connections between your nodes keep their orders.',
        'Attack and defense strength each roll ×0.8–1.2, and other players’ orders this round can change the outcome.',
      ]),
    );
  }

  const attacksIn = (pairs) => pairs.filter(([, destination]) => !isMine(destination));

  function reportSkipped(pairs, skipped) {
    groupMessage = skipped.length
      ? 'Applied to ' +
        (pairs.length - skipped.length) +
        ' of ' +
        pairs.length +
        '; ' +
        edgeList(skipped) +
        ' lacked energy.'
      : '';
    render();
  }

  const edgeName = ([source, destination]) => source + ' → ' + destination;
  const edgeList = (pairs) => pairs.map(edgeName).join(', ');

  function groupPressureRows(pairs, view) {
    const toggle = chipToggle({
      id: 'groupEdgePressure',
      label: 'Pressure · ' + view.pressured + ' of ' + view.attacks,
      name: 'Pressure every attacked node each round',
      checked: view.pressured === view.attacks,
      onChange: (checked) => {
        if (checked) return applyGroupPressure(pairs, {});
        store.stopEdgePressure(pairs);
        render();
      },
    });
    toggle.querySelector('input').indeterminate =
      view.pressured > 0 && view.pressured < view.attacks;
    const rows = [
      editorRow(
        'Each round',
        [toggle],
        help('Pressure on each', [
          'Every round, each source banks a share of its surplus for the node it attacks and attacks with the bank once it reaches “attack at”.',
          'A value typed here turns pressure on for every attack in the group.',
        ]),
      ),
    ];
    if (view.pressured) rows.push(editorRow('', groupPressureFields(pairs, view)));
    return rows;
  }

  function groupPressureFields(pairs, view) {
    return [
      groupPressureField(pairs, view, 'pct', '% surplus', 'Send % of surplus', 100),
      groupPressureField(
        pairs,
        view,
        'min',
        'attack at',
        'Attack when at least this much is banked',
      ),
    ];
  }

  function groupPressureField(pairs, view, field, label, name, max = Infinity) {
    const { value, mixed } = view[field];
    return policyNumberField({
      id: 'group-pressure-' + field,
      key: 'group:pressure:' + field,
      label,
      name,
      value: mixed ? null : value,
      max,
      ...compactMixed(mixed),
      onCommit: (committed) =>
        committed !== null && applyGroupPressure(pairs, { [field]: committed }),
    });
  }

  function applyGroupPressure(pairs, fields) {
    const rejected = store.setGroupEdgePressure(pairs, fields);
    groupMessage = rejected.length
      ? 'Nothing changed: ' +
        nodeList([...new Set(rejected.map(([source]) => source))]) +
        ' would exceed 100% of surplus or reject this value.'
      : '';
    render();
    return rejected.length === 0;
  }

  function groupStopRow(pairs, view) {
    const buttons = document.createElement('div');
    buttons.className = 'tactical-order-presets';
    buttons.append(
      groupButton('Clear orders', () => store.clearEdgeOrders(pairs)),
      ...(view.pressured
        ? [groupButton('Stop pressure', () => store.stopEdgePressure(pairs))]
        : []),
    );
    return editorRow('Stop', [buttons]);
  }

  function edgeGroupMembers(pairs) {
    return memberList(
      pairs.map(([source, destination]) =>
        memberRow({
          key: 'member:' + source + '-' + destination,
          label: edgeName([source, destination]),
          subject: 'connection ' + edgeName([source, destination]),
          detail: edgeMemberDetail(source, destination),
          onOpen: () => editEdgeAlone(source, destination),
          onRemove: () => toggleGroupEdge(source, destination),
          extra: bothEndsFriendly(source, destination) ? [groupEdgeSwap(source, destination)] : [],
        }),
      ),
    );
  }

  function edgeMemberDetail(source, destination) {
    const amount = plan(source).edges[destination] || 0;
    if (isMine(destination)) return amount ? 'send ' + numeric(amount) : 'nothing sent';
    const pressure = policies[source]?.pressure?.[destination];
    return (
      (amount ? 'attack ' + numeric(amount) : 'no attack') +
      ' · ' +
      (pressure
        ? 'pressure ' + numeric(pressure.pct) + '% at ' + numeric(pressure.min ?? 10)
        : 'no pressure')
    );
  }

  function groupEdgeSwap(source, destination) {
    const swap = textElement('button', '⇄');
    swap.type = 'button';
    swap.setAttribute(
      'aria-label',
      'From Node ' + source + ' to Node ' + destination + '. Swap direction',
    );
    swap.onclick = () => {
      store.swapGroupEdge(source, destination);
      render();
    };
    return swap;
  }

  function editEdgeAlone(source, destination) {
    const [a, b] = [source, destination].sort((x, y) => x - y);
    store.leaveGroupMode();
    store.dismissInspector();
    store.inspectEdge(a, b);
    store.inspectEdge(a, b);
    store.setEdgeSource(source);
    render();
  }

  function directionRow(source, destination, swappable) {
    const row = document.createElement('div');
    row.className = 'tactical-primary-control tactical-direction';
    row.dataset.key = 'direction';
    row.append(nodeChip(source), textElement('span', '→', 'tactical-direction-arrow'));
    row.append(nodeChip(destination));
    const sentence = 'From Node ' + source + ' to Node ' + destination;
    if (swappable) {
      const swap = document.createElement('button');
      swap.type = 'button';
      swap.id = 'tacticalSwapDirection';
      swap.textContent = '⇄';
      swap.setAttribute('aria-label', sentence + '. Swap direction');
      swap.onclick = swapDirection;
      row.append(swap);
    }
    const status = textElement('span', sentence, 'tactical-visually-hidden');
    status.id = 'tacticalDirectionStatus';
    status.setAttribute('aria-live', 'polite');
    row.append(status);
    return row;
  }

  function nodeChip(id) {
    const node = state.nodes[id];
    const chip = document.createElement('span');
    chip.className = 'tactical-node-chip';
    chip.dataset.chip = id;
    const swatch = textElement('span', '', 'tactical-node-swatch');
    swatch.style.background = playerColor(node.owner);
    chip.append(
      swatch,
      textElement('strong', 'Node ' + id),
      textElement(
        'span',
        (isMine(node.id) ? '' : GameEngine.playerName(node.owner) + ' · ') +
          compactEnergy(node.active),
        'tactical-secondary',
      ),
    );
    return chip;
  }

  function showEdge(body, a, b) {
    const source = active.source;
    const destination = source === a ? b : a;
    if (source === null) {
      body.append(
        directionRow(a, b, false),
        textElement('p', 'No friendly source: inspect only.', 'tactical-secondary'),
      );
      return;
    }
    const support = bothEndsFriendly(a, b);
    body.append(directionRow(source, destination, support));
    if (!editing) return;
    body.append(
      ...amountRows(source, destination, support),
      ...(support ? [] : [winChanceRow(source, destination)]),
      ...presetReasons(source, destination),
      divider(),
      ...(support ? surplusRouteRows(source, destination) : pressureRows(source, destination)),
    );
  }

  function amountRows(source, destination, support) {
    const value = plan(source).edges[destination] || 0;
    const limit = availableEnergy(source) - allocated(source) + value;
    const field = textElement('label', '', 'tactical-field tactical-field-wide');
    field.append(textElement('span', 'energy'));
    const input = document.createElement('input');
    input.type = 'number';
    input.min = '0';
    input.step = '0.1';
    input.max = String(Math.max(0, limit));
    input.value = String(value);
    input.id = 'tacticalEdgeAmount';
    input.dataset.key = source + '-' + destination;
    input.setAttribute('aria-label', 'Order energy amount');
    input.onchange = () => {
      const amount = Number(input.value);
      if (!Number.isFinite(amount) || amount < 0 || amount > limit + 1e-8) {
        byId('tacticalEdgeError').textContent = 'Amount exceeds the available allocation budget.';
        input.value = String(value);
        return;
      }
      setAllocation(source, destination, amount);
    };
    field.append(input);
    const error = textElement('p', '', 'tactical-warning');
    error.id = 'tacticalEdgeError';
    const rows = [
      editorRow(
        support ? 'Send' : 'Attack',
        [
          field,
          percentField(source, destination, value, limit),
          presetGroup(source, destination, ['all', 'surplus']),
        ],
        softCapEnabled()
          ? help('Withdrawn energy', [
              'Energy withdrawn on Node ' +
                source +
                ' can fund this order in the same round. Withdraw it in the Node ' +
                source +
                ' editor.',
            ])
          : [],
        { wraps: true },
      ),
      error,
    ];
    const replaced = support ? replacedSupport(source, destination) : null;
    if (replaced?.manual)
      rows.push(
        textElement(
          'p',
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
    rows.push(
      textElement('p', edgeOutcomeText(source, destination, support), 'tactical-secondary'),
    );
    return rows;
  }

  function edgeOutcomeText(source, destination, support) {
    const home =
      availableEnergy(source) -
      allocated(source) -
      policyOrders(source).reduce((sum, order) => sum + order.amount, 0);
    const staysHome = numeric(Math.max(0, home)) + ' stays home';
    if (support) return staysHome;
    const value = plan(source).edges[destination] || 0;
    const defense = state.nodes[destination].active;
    return (
      'Strength ' +
      numeric(value * 0.8) +
      '–' +
      numeric(value * 1.2) +
      ' vs defense ' +
      numeric(defense * 0.8) +
      '–' +
      numeric(defense * 1.2) +
      ' · ' +
      staysHome
    );
  }

  function percentField(source, destination, amount, limit) {
    const percent = selectors.activeSharePercent(currentMatch(), source, amount);
    const field = textElement('label', '', 'tactical-field');
    field.append(textElement('span', '% of active'));
    const input = document.createElement('input');
    input.type = 'number';
    input.min = '0';
    input.max = '100';
    input.step = '1';
    input.id = 'tacticalEdgePercent';
    input.dataset.key = 'percent:' + source + '-' + destination;
    input.value = String(Number(percent.toFixed(1)));
    input.setAttribute('aria-label', 'Order energy as a percentage of active energy');
    input.onchange = () => {
      const share = Number(input.value);
      const wanted = selectors.activeShareAmount(currentMatch(), source, share);
      if (!Number.isFinite(share) || share < 0 || share > 100 || wanted > limit + 1e-8) {
        byId('tacticalEdgeError').textContent =
          'That share exceeds the available allocation budget.';
        input.value = String(Number(percent.toFixed(1)));
        return;
      }
      setAllocation(source, destination, wanted);
    };
    field.append(input);
    return field;
  }

  function winChanceRow(source, destination) {
    const amounts = selectors
      .orderPresets(currentMatch(), source, destination)
      .presets.filter((preset) => preset.kind === 'chance')
      .map((preset) => numeric(preset.amount));
    return editorRow(
      'Win chance',
      [presetGroup(source, destination, ['chance'])],
      help('Win chance', [
        'Each button sets the smallest attack with that chance to take Node ' +
          destination +
          ' against its defense now: ' +
          amounts.join(', ') +
          '.',
        'Attack and defense strength each roll ×0.8–1.2, and other players’ orders this round can change the outcome.',
      ]),
    );
  }

  function presetGroup(source, destination, kinds) {
    const { limit, presets } = selectors.orderPresets(currentMatch(), source, destination);
    const group = document.createElement('div');
    group.className = 'tactical-order-presets';
    group.dataset.key = 'presets:' + kinds.join(',');
    group.append(
      ...presets
        .filter((preset) => kinds.includes(preset.kind))
        .map((preset) => {
          const button = textElement('button', presetLabel(preset));
          button.type = 'button';
          button.dataset.preset = presetKey(preset);
          button.title = presetDescription(preset);
          button.setAttribute('aria-label', presetDescription(preset));
          button.disabled = !presetAffordable(preset, limit);
          button.onclick = () => setAllocation(source, destination, preset.amount);
          return button;
        }),
    );
    return group;
  }

  const presetAffordable = (preset, limit) => preset.amount > 0 && preset.amount <= limit + 1e-8;

  function presetReasons(source, destination) {
    const { limit, presets } = selectors.orderPresets(currentMatch(), source, destination);
    const unmet = presets.filter((preset) => !presetAffordable(preset, limit));
    if (!unmet.length) return [];
    const reasons = textElement(
      'p',
      unmetPresetsReason(unmet, source, limit),
      'tactical-secondary',
    );
    reasons.id = 'tacticalPresetReasons';
    return [reasons];
  }

  function unmetPresetsReason(unmet, source, limit) {
    if (limit <= 0) return 'Node ' + source + ' has no energy left to send.';
    const attacks = unmet.filter((preset) => preset.kind === 'chance');
    const attackReason = attacks.length
      ? 'Node ' +
        source +
        ' can send ' +
        numeric(limit) +
        ', not enough for ' +
        attacks
          .map((preset) => Math.round(preset.chance * 100) + '% (' + numeric(preset.amount) + ')')
          .join(' or ') +
        ' success.'
      : '';
    const surplusReason = unmet.some((preset) => preset.kind === 'surplus')
      ? 'Node ' + source + ' has no energy above its reserve.'
      : '';
    return [attackReason, surplusReason].filter(Boolean).join(' ');
  }

  const presetKey = (preset) =>
    preset.kind === 'chance' ? 'chance-' + Math.round(preset.chance * 100) : preset.kind;

  function presetLabel(preset) {
    if (preset.kind === 'chance') return Math.round(preset.chance * 100) + '%';
    return preset.kind === 'all' ? 'All' : 'Surplus';
  }

  function presetDescription(preset) {
    const name =
      preset.kind === 'chance'
        ? Math.round(preset.chance * 100) + '% success attack'
        : preset.kind === 'all'
          ? 'Send all'
          : 'Send all surplus';
    return name + ' · ' + numeric(preset.amount);
  }

  function surplusRouteRows(source, destination) {
    const current = { ...defaultPolicy(), ...policies[source] };
    const targetsHere = Boolean(policies[source]?.enabled && current.dest === destination);
    const nextTransfer = policyOrders(source).find(
      (order) => order.type === 'transfer' && order.dest === destination,
    );
    const rows = [
      editorRow(
        'Each round',
        [
          chipToggle({
            id: 'tacticalAutoTransfer',
            label: 'Rest of surplus',
            name: 'Automatically send remaining surplus to Node ' + destination + ' each round',
            checked: targetsHere,
            onChange: (checked) => {
              store.routeSurplus(source, destination, checked);
              render();
            },
          }),
          ...(targetsHere
            ? [
                textElement(
                  'span',
                  numeric(nextTransfer?.amount ?? 0) + ' next round',
                  'tactical-row-note',
                ),
              ]
            : []),
        ],
        help('Rest of surplus', [
          'Every round, Node ' +
            source +
            ' sends Node ' +
            destination +
            ' what remains after its manual orders, its defense floor of ' +
            numeric(current.reserve) +
            ' and its ' +
            numeric(current.investPct) +
            '% investment. The amount changes each round.',
          'Change the floor or the investment in the Node ' + source + ' editor.',
        ]),
      ),
    ];
    if (replacedSupport(source, destination).route)
      rows.push(
        textElement(
          'p',
          'Replaces Node ' + destination + ' → ' + source + ' surplus route.',
          'tactical-warning',
        ),
      );
    if (current.dest !== null && current.dest !== destination)
      rows.push(
        textElement(
          'p',
          'Node ' +
            source +
            ' now sends its surplus to Node ' +
            current.dest +
            '. Turning this on replaces that route.',
          'tactical-secondary',
        ),
      );
    if (targetsHere && !nextTransfer)
      rows.push(
        textElement(
          'p',
          'No surplus to send. Lower the investment, the defense floor or manual orders.',
          'tactical-warning',
        ),
      );
    return rows;
  }

  function pressureRows(source, destination) {
    const settings = policies[source]?.pressure?.[destination];
    const warning = textElement('p', '', 'tactical-warning');
    warning.id = 'tacticalEdgePressureWarning';
    const toggle = editorRow(
      'Each round',
      [
        chipToggle({
          id: 'tacticalAutoPressure',
          label: 'Pressure Node ' + destination,
          name: 'Pressure Node ' + destination + ' from Node ' + source + ' each round',
          checked: Boolean(settings),
          onChange: (checked) => changeEdgePressure(source, destination, checked ? {} : null),
        }),
      ],
      help('Pressure', [
        'Every round, banks a share of Node ' +
          source +
          '’s surplus for Node ' +
          destination +
          ' and attacks with the bank once it reaches “attack at”.',
      ]),
    );
    if (!settings) return [toggle, warning];
    const key = source + '-' + destination;
    return [
      toggle,
      editorRow('', [
        policyNumberField({
          id: 'tacticalEdgePressurePct',
          key: key + ':pct',
          label: '% surplus',
          name: 'Send % of surplus',
          value: settings.pct,
          max: 100,
          onCommit: (pct) => pct !== null && changeEdgePressure(source, destination, { pct }),
        }),
        policyNumberField({
          id: 'tacticalEdgePressureMin',
          key: key + ':min',
          label: 'attack at',
          name: 'Attack when at least this much is banked',
          value: settings.min ?? 10,
          onCommit: (min) => min !== null && changeEdgePressure(source, destination, { min }),
        }),
      ]),
      textElement(
        'p',
        pressureStatusText(
          selectors.edgePressureStatus(currentMatch(), source, destination),
          destination,
        ),
        'tactical-secondary',
      ),
      warning,
    ];
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

  const SELECTED_ITEM_MARGIN = 72;

  function selectedItemBox() {
    const matrix = svg.querySelector('g')?.getScreenCTM();
    if (!active || !matrix) return null;
    const ids = active.kind === 'node' ? [active.id] : [active.a, active.b];
    const xs = ids.map((id) => matrix.a * xy[id][0] + matrix.e);
    const ys = ids.map((id) => matrix.d * xy[id][1] + matrix.f);
    const margin = SELECTED_ITEM_MARGIN * matrix.a;
    return {
      left: Math.min(...xs) - margin,
      right: Math.max(...xs) + margin,
      top: Math.min(...ys) - margin,
      bottom: Math.max(...ys) + margin,
    };
  }

  function positionInspector() {
    if (root.hidden || mobile()) return;
    if (showingGroup() || showingEdgeGroup() || editedMember() !== null) {
      root.style.left = Math.max(10, innerWidth - 372) + 'px';
      root.style.top = '70px';
      return;
    }
    if (!active) return;
    const item = selectedItemBox();
    if (!item) return;
    const { left, top } = placementBeside(item);
    root.style.left = left + 'px';
    root.style.top = top + 'px';
  }

  function placementBeside(item) {
    const width = root.offsetWidth;
    const height = Math.min(root.offsetHeight, innerHeight * 0.76);
    const gap = 12;
    const clampLeft = (left) => Math.max(10, Math.min(innerWidth - width - 10, left));
    const clampTop = (top) => Math.max(12, Math.min(innerHeight - height - 12, top));
    const inWindow = ({ left, top }) =>
      left >= 10 &&
      top >= 12 &&
      left + width <= innerWidth - 10 &&
      top + height <= innerHeight - 12;
    const candidates = [
      { left: item.right + gap, top: clampTop(item.top) },
      { left: item.left - gap - width, top: clampTop(item.top) },
      { left: clampLeft(item.left), top: item.bottom + gap },
      { left: clampLeft(item.left), top: item.top - gap - height },
    ];
    return (
      candidates.find(inWindow) ?? { left: clampLeft(item.right + gap), top: clampTop(item.top) }
    );
  }

  function showInspector() {
    // The first tap highlights only. The second tap opens the editor above
    // the unchanged mobile Orders/Resolve dock, or near the edge on desktop.
    const group = showingGroup();
    const edgeGroup = showingEdgeGroup();
    const member = editedMember();
    const groupEditor = group || edgeGroup || member !== null;
    root.hidden =
      !(groupEditor || (active && editing)) ||
      currentView !== 'map' ||
      Boolean(document.querySelector('dialog[open]'));
    document.body.classList.toggle('tactical-selection-active', !root.hidden);
    if (root.hidden) return;
    root.classList.toggle('is-editing', true);
    const subject = group
      ? 'Group · ' + groupIds().length + ' nodes'
      : edgeGroup
        ? 'Group · ' + groupCount()
        : member !== null
          ? 'Node ' + member
          : active.kind === 'node'
            ? 'Node ' + active.id
            : 'Connection ' + active.a + ' — ' + active.b;
    const header = document.createElement('div');
    header.className = 'tactical-inspector-head';
    header.append(textElement('strong', subject));
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = '×';
    close.setAttribute(
      'aria-label',
      groupEditor ? 'Close the group editor' : 'Clear map selection',
    );
    close.onclick = groupEditor ? closeGroupEditor : dismissAndReturnFocus;
    header.append(close);
    const body = document.createElement('div');
    body.className = 'tactical-inspector-body';
    if (group) showGroup(body, groupIds());
    else if (edgeGroup) showEdgeGroup(body, groupEdges());
    else if (member !== null) showNode(body, member, true);
    else if (active.kind === 'node') showNode(body, active.id);
    else showEdge(body, active.a, active.b);
    // No duplicate Orders/Resolve/Collapse buttons. The original bottom dock
    // remains reachable below this editor; × and outside-click dismiss it.
    updateChildrenInPlace(root, [header, body]);
    positionInspector();
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
    ordersCount.textContent = '(' + plannedNodeCount() + ')';
    drawSelection();
    renderGroupBar();
    selectButton.textContent = groupMode ? 'Done' : 'Select';
    showInspector();
    if (focusedMapItem) svg.querySelector(focusedMapItem)?.focus();
  };

  function plannedNodeCount() {
    return state.nodes.filter((node) => isMine(node.id) && (orders[node.id] || policies[node.id]))
      .length;
  }
  byId('generate').addEventListener('click', () => store.closeInspector(), true);
  // Hide the inspector while deliberate Orders/Settings/New game dialogs are open.
  const modalObserver = new MutationObserver(() => {
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
    if (anOverlayIsOpen()) return;
    dismissAndReturnFocus();
  });
  render();
})();
