'use strict';

// The map editor is a mode of the tactical map: while ui.view is 'editor' it
// draws the store's editor slice in #map and offers the tools, the node panel
// and the problems that keep the map from being played.
(() => {
  const byId = (id) => document.getElementById(id);
  const { playerColor, playerName, playerOwners, buildMap } = GameEngine;
  const COLOURS = playerOwners.filter((owner) => owner !== null);
  const { CANVAS, GRID } = CustomMap;
  const svg = byId('map');
  const TOOLS = [
    {
      tool: 'select',
      label: 'Select',
      key: 'V',
      hint: 'Click selects, drag moves a node, drag on empty space pans, double-click adds a node',
    },
    { tool: 'node', label: '+ Node', key: 'N', hint: 'Click on empty space adds a neutral node' },
    {
      tool: 'link',
      label: 'Connect',
      key: 'C',
      hint: 'Click a node, then the node to connect it to; click a connection to remove it',
    },
    {
      tool: 'owner',
      label: 'Owner',
      key: 'O',
      hint:
        'Click cycles ' +
        [null, ...COLOURS].map(playerName).join(' → ') +
        ', Shift-click cycles back',
    },
    { tool: 'erase', label: 'Erase', key: 'X', hint: 'Click a node or a connection to remove it' },
  ];
  const TOOL_KEYS = Object.fromEntries(TOOLS.map(({ tool, key }) => ['Key' + key, tool]));

  let editor = store.getSnapshot().editor;
  const editing = () => editor !== null && currentView === 'editor';

  function element(tag, attributes = {}, children = []) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attributes)) {
      if (key === 'onclick') node.onclick = value;
      else if (key === 'className') node.className = value;
      else node.setAttribute(key, value);
    }
    node.append(...children);
    return node;
  }

  function svgElement(name, attributes, parent) {
    const node = document.createElementNS('http://www.w3.org/2000/svg', name);
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
    parent.append(node);
    return node;
  }

  const head = element('span', { id: 'mapEditorHead', hidden: '' });
  document.querySelector('body > header > div:last-child').prepend(head);

  const menuItem = element('button', { type: 'button', id: 'menuMapEditor' }, ['Map editor']);
  menuItem.onclick = () => {
    byId('tacticalMenu').open = false;
    open(CustomMap.fromMatch(currentMatch(), mapSeed));
  };
  document.querySelector('#tacticalMenu .tactical-menu-content').append(menuItem);

  const editGenerated = element('button', { type: 'button', id: 'editGeneratedMap' }, [
    'Edit this map',
  ]);
  editGenerated.onclick = () => {
    const options = mapOptions();
    byId('newGameDialog').close();
    open(CustomMap.fromGenerated(buildMap(options), options.seed));
  };
  byId('cancelNewGame').after(editGenerated);

  const bar = element('div', { id: 'mapEditorBar', hidden: '' });
  bar.innerHTML = `
    <div class="map-editor-row">
      <label class="map-editor-name">Map name
        <input id="mapEditorName" type="text" maxlength="40" autocomplete="off" />
      </label>
      <span id="mapEditorStatus" class="muted"></span>
      <span class="map-editor-spacer"></span>
      <button id="mapEditorUndo" type="button" title="Undo the last edit (Ctrl+Z)">Undo</button>
      <button id="mapEditorRedo" type="button" title="Redo the undone edit (Ctrl+Shift+Z)">Redo</button>
      <button id="mapEditorClear" type="button" title="Remove every node; Undo brings them back">Clear</button>
      <button id="mapEditorPlay" type="button" class="primary" title="Start a game on this map">Play ▸</button>
      <button id="mapEditorClose" type="button" aria-label="Close the map editor">Close ×</button>
    </div>
    <div id="mapEditorTools" role="toolbar" aria-label="Map editor tools"></div>
    <p id="mapEditorHint" class="muted"></p>
    <div id="mapEditorIssues">
      <button id="mapEditorIssuesToggle" type="button" aria-controls="mapEditorIssuesList"></button>
      <ul id="mapEditorIssuesList"></ul>
    </div>`;
  byId('mapViewport').append(bar);
  for (const { tool, label, key, hint } of TOOLS) {
    const button = element('button', {
      type: 'button',
      'data-tool': tool,
      title: hint + ' (' + key + ')',
      'aria-keyshortcuts': key,
    });
    button.textContent = label;
    button.onclick = () => store.setMapTool(tool);
    byId('mapEditorTools').append(button);
  }
  byId('mapEditorName').onchange = (event) => store.renameMap(event.target.value);
  byId('mapEditorUndo').onclick = () => store.undoMapEdit();
  byId('mapEditorRedo').onclick = () => store.redoMapEdit();
  byId('mapEditorClear').onclick = () => store.clearMap();
  byId('mapEditorPlay').onclick = play;
  byId('mapEditorClose').onclick = close;
  byId('mapEditorIssuesToggle').onclick = () => {
    const opened = bar.classList.toggle('issues-open');
    byId('mapEditorIssuesToggle').setAttribute('aria-expanded', String(opened));
  };

  const panel = element('section', {
    id: 'mapEditorInspector',
    hidden: '',
    'aria-label': 'Selected map node',
  });
  document.body.append(panel);

  function open(map) {
    store.batch(() => {
      store.dismissInspector();
      store.openMapEditor(map);
    });
    byId('fit').click();
  }

  function close() {
    if (
      GameStore.selectors.mapEditorDirty(editor) &&
      !confirm('Leave the map editor? The changes to this map are not kept.')
    )
      return;
    store.closeMapEditor();
    byId('fit').click();
  }

  function play() {
    if (!CustomMap.isPlayable(editor.map)) return;
    if (
      state.round > 1 &&
      !confirm(
        'Start a new game? Your current match will be replaced (autosave will also be replaced).',
      )
    )
      return;
    const generated = CustomMap.toGeneratorMap(editor.map, Math.random);
    store.batch(() => {
      store.select(null);
      store.replaceMatch(
        GameStore.generatedMatch(
          generated,
          domDefaults(),
          Math.random,
          chosenSeat(),
          chosenRules(),
        ),
      );
      store.closeMapEditor();
      store.setView('map');
    });
  }

  function tapNode(id, event) {
    if (editor.tool === 'link') store.linkMapNode(id);
    else if (editor.tool === 'owner') store.cycleMapOwner(id, event.shiftKey ? -1 : 1);
    else if (editor.tool === 'erase') store.removeMapNode(id);
    else store.selectMapNode(id);
  }

  function tapCanvas(event) {
    if (editor.tool === 'node') store.addMapNode(CustomMap.snapped(mapPoint(event)));
    else if (editor.linkFrom !== null) store.linkMapNode(editor.linkFrom);
    else store.selectMapNode(null);
  }

  function mapPoint(event) {
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(
      svg.getScreenCTM().inverse(),
    );
    return [(point.x - camera.x) / camera.scale, (point.y - camera.y) / camera.scale];
  }

  const slop = (pointerType) => (pointerType === 'touch' ? 8 : 4);

  // A press on a node never reaches the map's pan gesture; a move beyond the
  // slop drags the node, a release without one is a tap. The listeners sit on
  // the window because every edit redraws the map and replaces the node.
  function attachNodeGestures(group, id) {
    group.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || !event.isPrimary) return;
      event.stopPropagation();
      event.preventDefault();
      const origin = { x: event.clientX, y: event.clientY };
      let moving = false;
      const move = (next) => {
        if (next.pointerId !== event.pointerId) return;
        if (!moving) {
          const distance = Math.hypot(next.clientX - origin.x, next.clientY - origin.y);
          if (editor.tool !== 'select' || distance < slop(event.pointerType)) return;
          moving = true;
          store.beginMapMove(id);
        }
        store.moveMapNode(id, CustomMap.snapped(mapPoint(next)));
      };
      const end = (next) => {
        if (next.pointerId !== event.pointerId) return;
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', end);
        window.removeEventListener('pointercancel', end);
        if (!moving && next.type === 'pointerup') tapNode(id, next);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', end);
      window.addEventListener('pointercancel', end);
    });
  }

  let canvasPress = null;
  svg.addEventListener('pointerdown', (event) => {
    canvasPress = null;
    if (!editing() || event.button !== 0 || !event.isPrimary) return;
    if (event.target.closest('.map-editor-node, .map-editor-link-hit')) return;
    canvasPress = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      pointerType: event.pointerType,
    };
  });
  svg.addEventListener('pointerup', (event) => {
    const press = canvasPress;
    canvasPress = null;
    if (!press || press.id !== event.pointerId || !editing()) return;
    const distance = Math.hypot(event.clientX - press.x, event.clientY - press.y);
    if (distance < slop(press.pointerType)) tapCanvas(event);
  });
  svg.addEventListener('dblclick', (event) => {
    if (!editing() || editor.tool !== 'select') return;
    if (event.target.closest('.map-editor-node, .map-editor-link-hit')) return;
    store.addMapNode(CustomMap.snapped(mapPoint(event)));
  });
  svg.addEventListener('pointermove', (event) => {
    if (!editing() || editor.linkFrom === null) return;
    const [x, y] = mapPoint(event);
    const line = svg.querySelector('.map-editor-link-pending');
    line?.setAttribute('x2', x);
    line?.setAttribute('y2', y);
  });

  document.addEventListener('keydown', (event) => {
    if (!editing() || event.repeat) return;
    if (document.querySelector('dialog[open], :popover-open')) return;
    if (event.target.closest?.('input, textarea, select, [contenteditable]')) return;
    const action = editorKeyAction(event);
    if (!action) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    action();
  });

  function editorKeyAction(event) {
    const modified = event.ctrlKey || event.metaKey;
    if (modified && event.code === 'KeyZ' && event.shiftKey) return () => store.redoMapEdit();
    if (modified && event.code === 'KeyZ') return () => store.undoMapEdit();
    if (modified && event.code === 'KeyY') return () => store.redoMapEdit();
    if (modified || event.altKey || event.shiftKey) return null;
    if (event.key === 'Escape')
      return editor.linkFrom !== null
        ? () => store.linkMapNode(editor.linkFrom)
        : () => store.selectMapNode(null);
    if (event.key === 'Delete' || event.key === 'Backspace')
      return editor.selected === null ? null : () => store.removeMapNode(editor.selected);
    const tool = TOOL_KEYS[event.code];
    return tool ? () => store.setMapTool(tool) : null;
  }

  store.subscribe((snapshot, previous) => {
    editor = snapshot.editor;
    const changed = (read) => GameStore.changed(snapshot, previous, read);
    if (changed((s) => s.ui.view))
      document.body.classList.toggle('map-editing', currentView === 'editor');
    if (changed((s) => s.editor) || changed((s) => s.ui.view)) draw();
  });

  function draw() {
    const shown = editing();
    bar.hidden = !shown;
    head.hidden = !shown;
    panel.hidden = !shown || editor.selected === null;
    if (!shown) return;
    drawMap();
    drawBar();
    if (!panel.hidden) drawPanel();
  }

  function drawMap() {
    const { map, selected, linkFrom } = editor;
    const focused = svg.contains(document.activeElement)
      ? document.activeElement.dataset.node
      : null;
    const flagged = new Set(CustomMap.problems(map).flatMap((problem) => problem.nodes));
    svg.replaceChildren();
    const graph = svgElement('g', { transform: cameraTransform() }, svg);
    const pattern = svgElement(
      'pattern',
      { id: 'mapEditorGrid', width: GRID, height: GRID, patternUnits: 'userSpaceOnUse' },
      svgElement('defs', {}, graph),
    );
    svgElement(
      'path',
      { d: 'M ' + GRID + ' 0 L 0 0 0 ' + GRID, class: 'map-editor-grid' },
      pattern,
    );
    const canvas = { x: 0, y: 0, width: CANVAS.width, height: CANVAS.height };
    svgElement('rect', { ...canvas, class: 'map-editor-canvas' }, graph);
    svgElement('rect', { ...canvas, fill: 'url(#mapEditorGrid)', 'pointer-events': 'none' }, graph);
    for (const [a, b] of map.links) drawLink(graph, a, b, map.positions);
    if (linkFrom !== null) {
      const [x, y] = map.positions[linkFrom];
      svgElement('line', { x1: x, y1: y, x2: x, y2: y, class: 'map-editor-link-pending' }, graph);
    }
    map.positions.forEach((position, id) =>
      drawNode(graph, id, position, map.owners[id], {
        selected: id === selected,
        linkStart: id === linkFrom,
        flagged: flagged.has(id),
      }),
    );
    if (focused !== null && focused !== undefined)
      svg.querySelector('.editor-node[data-node="' + focused + '"]')?.focus();
  }

  function drawLink(graph, a, b, positions) {
    const line = {
      x1: positions[a][0],
      y1: positions[a][1],
      x2: positions[b][0],
      y2: positions[b][1],
    };
    svgElement('line', { ...line, class: 'map-editor-link' }, graph);
    const hit = svgElement(
      'line',
      {
        ...line,
        class: 'map-editor-link-hit',
        'data-link': a + '-' + b,
        tabindex: 0,
        role: 'button',
        'aria-label': 'Connection between node ' + a + ' and node ' + b,
      },
      graph,
    );
    const tapLink = () => {
      if (editor.tool === 'erase' || editor.tool === 'link') store.toggleMapLink(a, b);
    };
    hit.addEventListener('click', (event) => {
      event.stopPropagation();
      tapLink();
    });
    hit.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      tapLink();
    });
  }

  function drawNode(graph, id, [x, y], owner, { selected, linkStart, flagged }) {
    const group = svgElement('g', { class: 'map-editor-node', 'data-node': id }, graph);
    svgElement('title', {}, group).textContent = 'Node ' + id + ' · ' + playerName(owner);
    if (flagged) svgElement('circle', { cx: x, cy: y, r: 42, class: 'map-editor-flag' }, group);
    if (linkStart)
      svgElement('circle', { cx: x, cy: y, r: 36, class: 'map-editor-link-start' }, group);
    else if (selected)
      svgElement('circle', { cx: x, cy: y, r: 36, class: 'map-editor-selected' }, group);
    const circle = svgElement(
      'circle',
      {
        cx: x,
        cy: y,
        r: 30,
        fill: playerColor(owner),
        class: 'editor-node',
        'data-node': id,
        tabindex: 0,
        role: 'button',
        'aria-label': 'Node ' + id + ', ' + playerName(owner),
      },
      group,
    );
    svgElement('text', { x, y: y - 40, 'font-size': 12 }, group).textContent = id;
    if (owner === null) {
      svgElement('text', { x, y: y + 5, 'font-size': 15 }, group).textContent = '3–7';
    } else {
      svgElement('text', { x, y: y + 2, 'font-size': 17 }, group).textContent =
        CustomMap.START_NODE.active;
      svgElement('text', { x, y: y + 18, 'font-size': 10 }, group).textContent =
        'I ' + CustomMap.START_NODE.invested;
    }
    attachNodeGestures(group, id);
    circle.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      tapNode(id, event);
    });
  }

  function drawBar() {
    const { map, tool, past, future } = editor;
    const name = byId('mapEditorName');
    if (document.activeElement !== name) name.value = map.name;
    head.textContent = 'Map editor · ' + map.name;
    byId('mapEditorStatus').textContent = statusOf(editor);
    for (const button of byId('mapEditorTools').children)
      button.setAttribute('aria-pressed', String(button.dataset.tool === tool));
    byId('mapEditorUndo').disabled = past.length === 0;
    byId('mapEditorRedo').disabled = future.length === 0;
    byId('mapEditorClear').disabled = map.positions.length === 0;
    byId('mapEditorPlay').disabled = !CustomMap.isPlayable(map);
    byId('mapEditorHint').textContent = hintOf(editor);
    drawIssues(CustomMap.problems(map));
  }

  function statusOf({ map }) {
    const players = CustomMap.players(map);
    return (
      map.positions.length +
      (map.positions.length === 1 ? ' node · ' : ' nodes · ') +
      players +
      (players === 1 ? ' player' : ' players') +
      (GameStore.selectors.mapEditorDirty(editor) ? ' · edited' : '')
    );
  }

  function hintOf({ tool, linkFrom }) {
    if (tool === 'link' && linkFrom !== null)
      return 'Connect: click a second node to link it to ' + linkFrom + ' · Esc cancels';
    return TOOLS.find((entry) => entry.tool === tool).hint;
  }

  function drawIssues(problems) {
    const toggle = byId('mapEditorIssuesToggle');
    const players = CustomMap.players(editor.map);
    toggle.textContent = problems.length
      ? '⚠ ' + problems.length + (problems.length === 1 ? ' issue' : ' issues')
      : '✓ Ready: ' + players + ' colours start on this map';
    toggle.classList.toggle('has-issues', problems.length > 0);
    byId('mapEditorIssuesList').replaceChildren(
      ...problems.map((problem) =>
        element('li', {}, [
          problem.nodes.length
            ? element(
                'button',
                { type: 'button', onclick: () => store.selectMapNode(problem.nodes[0]) },
                [problem.message],
              )
            : problem.message,
        ]),
      ),
    );
  }

  function drawPanel() {
    const { map, selected } = editor;
    const owner = map.owners[selected];
    const header = element('div', { className: 'tactical-inspector-head' }, [
      element('strong', {}, ['Node ' + selected]),
      element(
        'button',
        { type: 'button', 'aria-label': 'Deselect node', onclick: () => store.selectMapNode(null) },
        ['×'],
      ),
    ]);
    const body = element('div', { className: 'tactical-inspector-body' }, [
      element('div', { className: 'map-editor-label' }, ['Start colour']),
      element(
        'div',
        { className: 'map-editor-owners' },
        [null, ...COLOURS].map((colour) => ownerChip(selected, colour, colour === owner)),
      ),
      element('p', { className: 'muted map-editor-note' }, [
        owner === null
          ? 'Neutral: starts with 3 to 7 energy'
          : 'Start node: ' +
            CustomMap.START_NODE.active +
            ' energy, ' +
            CustomMap.START_NODE.invested +
            ' invested',
      ]),
      element('div', { className: 'map-editor-label' }, ['Connections']),
      element('div', { className: 'map-editor-chips' }, [
        ...CustomMap.neighbours(map, selected).map((other) =>
          element(
            'button',
            {
              type: 'button',
              'data-key': 'node-' + other,
              title: 'Select node ' + other,
              onclick: () => store.selectMapNode(other),
            },
            [String(other)],
          ),
        ),
        element(
          'button',
          {
            type: 'button',
            'data-key': 'connect',
            onclick: () =>
              store.batch(() => {
                store.setMapTool('link');
                store.linkMapNode(selected);
              }),
          },
          ['Connect…'],
        ),
      ]),
      element('div', { className: 'map-editor-actions' }, [
        element(
          'button',
          { type: 'button', 'data-key': 'delete', onclick: () => store.removeMapNode(selected) },
          ['Delete node'],
        ),
      ]),
    ]);
    updateChildrenInPlace(panel, [header, body]);
  }

  function ownerChip(id, colour, pressed) {
    const swatch = element('span', { className: 'map-editor-swatch' });
    swatch.style.background = playerColor(colour);
    return element(
      'button',
      {
        type: 'button',
        'data-key': 'owner-' + colour,
        'aria-pressed': String(pressed),
        onclick: () => store.setMapOwner(id, colour),
      },
      [swatch, playerName(colour)],
    );
  }

  draw();
})();
