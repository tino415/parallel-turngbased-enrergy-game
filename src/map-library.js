'use strict';

// My maps: the hand-made maps kept in this browser. The New game dialog lists
// them next to the generator, starts a game from one, edits, duplicates,
// exports, imports and deletes them, and the map editor saves into the list.
(() => {
  const byId = (id) => document.getElementById(id);
  const STORAGE_KEY = 'parallel-energy-game-maps-v1';
  const { playerName } = GameEngine;

  function readLibrary() {
    try {
      const data = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (!Array.isArray(data?.maps)) return [];
      return data.maps.flatMap((entry) => {
        try {
          return [{ id: String(entry.id), map: CustomMap.parse(entry.map) }];
        } catch {
          return [];
        }
      });
    } catch {
      return [];
    }
  }

  const fileOf = (map) => JSON.parse(CustomMap.serialize(map));

  function writeLibrary(entries) {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ maps: entries.map(({ id, map }) => ({ id, map: fileOf(map) })) }),
    );
  }

  let maps = readLibrary();
  let selectedId = null;
  let editingId = null;
  let pendingEditId = null;
  let source = 'generated';

  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const entryOf = (id) => maps.find((entry) => entry.id === id) ?? null;

  function commitLibrary(next) {
    maps = next;
    writeLibrary(maps);
    renderLibrary();
  }
  function addMap(map) {
    const id = newId();
    commitLibrary([...maps, { id, map }]);
    return id;
  }
  function replaceMap(id, map) {
    commitLibrary(maps.map((entry) => (entry.id === id ? { id, map } : entry)));
  }
  function removeMap(id) {
    commitLibrary(maps.filter((entry) => entry.id !== id));
  }

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

  const dialog = byId('newGameDialog');
  const body = dialog.querySelector('.dialog-body');
  const generatorFields = body.querySelector(':scope > .generator-fields');

  const sourceSwitch = element('div', { className: 'map-source', role: 'group' }, [
    element(
      'button',
      { type: 'button', id: 'sourceGenerated', onclick: () => setSource('generated') },
      ['Generated'],
    ),
    element(
      'button',
      { type: 'button', id: 'sourceLibrary', onclick: () => setSource('library') },
      ['My maps'],
    ),
  ]);
  sourceSwitch.setAttribute('aria-label', 'Map source');
  generatorFields.before(sourceSwitch);

  const library = element('section', { id: 'mapLibrary', hidden: '', 'aria-label': 'My maps' });
  library.innerHTML = `
    <div id="mapLibraryGallery" class="map-gallery"></div>
    <p id="mapLibraryEmpty" class="muted">
      No saved maps yet. Save one from the map editor, start a blank one or import a map file.
    </p>
    <div id="mapLibraryDetails" class="map-library-details" hidden>
      <label>Map name <input id="libraryName" type="text" maxlength="40" autocomplete="off" /></label>
      <label>Your colour <select id="librarySeat"></select></label>
      <span id="libraryCaption" class="muted"></span>
      <div class="map-library-actions">
        <button id="libraryEdit" type="button">Edit</button>
        <button id="libraryDuplicate" type="button">Duplicate</button>
        <button id="libraryExport" type="button">Export</button>
        <button id="libraryDelete" type="button">Delete</button>
      </div>
    </div>
    <input id="libraryImportFile" type="file" accept=".json,application/json" hidden />`;
  body.querySelector('.dialog-actions').before(library);

  byId('libraryName').onchange = (event) => {
    const entry = entryOf(selectedId);
    if (entry) replaceMap(entry.id, CustomMap.rename(entry.map, event.target.value));
  };
  byId('libraryEdit').onclick = () => {
    const entry = entryOf(selectedId);
    if (entry) openEditor(entry.map, entry.id);
  };
  byId('libraryDuplicate').onclick = () => {
    const entry = entryOf(selectedId);
    if (!entry) return;
    selectedId = addMap(CustomMap.rename(entry.map, entry.map.name + ' copy'));
    renderLibrary();
  };
  byId('libraryExport').onclick = () => {
    const entry = entryOf(selectedId);
    if (entry) exportMap(entry.map);
  };
  byId('libraryDelete').onclick = () => {
    const entry = entryOf(selectedId);
    if (!entry || !confirm('Delete the map "' + entry.map.name + '"?')) return;
    selectedId = null;
    removeMap(entry.id);
  };
  byId('libraryImportFile').onchange = async (event) => {
    const [file] = event.target.files;
    event.target.value = '';
    if (!file) return;
    try {
      selectedId = addMap(CustomMap.parse(await file.text()));
      renderLibrary();
    } catch (error) {
      alert(error.message);
    }
  };

  const startGenerated = byId('generate').onclick;
  byId('generate').onclick = () => {
    if (source === 'generated') return startGenerated();
    const entry = entryOf(selectedId);
    if (!entry || !CustomMap.isPlayable(entry.map)) return;
    if (
      state.round > 1 &&
      !confirm(
        'Start a new game? Your current match will be replaced (autosave will also be replaced).',
      )
    )
      return;
    const seat = Number(byId('librarySeat').value) || 0;
    store.batch(() => {
      store.select(null);
      store.replaceMatch(
        GameStore.generatedMatch(
          CustomMap.toGeneratorMap(entry.map, Math.random),
          domDefaults(),
          Math.random,
          seat,
          chosenRules(),
        ),
      );
      store.setCamera({ x: 0, y: 0, scale: 1 });
      store.setView('map');
    });
    dialog.close();
  };

  new MutationObserver(() => {
    if (!dialog.open) return;
    maps = readLibrary();
    renderLibrary();
  }).observe(dialog, { attributes: true, attributeFilter: ['open'] });

  function setSource(next) {
    source = next;
    renderLibrary();
  }

  function renderLibrary() {
    const showingLibrary = source === 'library';
    byId('sourceGenerated').setAttribute('aria-pressed', String(!showingLibrary));
    byId('sourceLibrary').setAttribute('aria-pressed', String(showingLibrary));
    byId('sourceLibrary').textContent = maps.length ? 'My maps (' + maps.length + ')' : 'My maps';
    for (const id of ['newGamePreview', 'previewCaption', 'editGeneratedMap'])
      byId(id).toggleAttribute('hidden', showingLibrary);
    generatorFields.hidden = showingLibrary;
    library.hidden = !showingLibrary;
    if (!entryOf(selectedId)) selectedId = null;
    const entry = entryOf(selectedId);
    const cannotStart = showingLibrary && !(entry && CustomMap.isPlayable(entry.map));
    byId('generate').disabled = cannotStart;
    byId('generateOnline').disabled = cannotStart;
    if (!showingLibrary) return;
    byId('mapLibraryEmpty').hidden = maps.length > 0;
    renderGallery();
    renderDetails(entry);
  }

  function renderGallery() {
    byId('mapLibraryGallery').replaceChildren(
      ...maps.map((entry) => mapCard(entry)),
      element(
        'button',
        {
          type: 'button',
          id: 'libraryNew',
          className: 'map-card map-card-new',
          onclick: () => openEditor(CustomMap.blank(), null),
        },
        ['+ New blank map'],
      ),
      element(
        'button',
        {
          type: 'button',
          id: 'libraryImport',
          className: 'map-card map-card-new',
          onclick: () => byId('libraryImportFile').click(),
        },
        ['Import map file…'],
      ),
    );
  }

  function mapCard({ id, map }) {
    const thumbnail = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    thumbnail.setAttribute(
      'viewBox',
      '0 0 ' + CustomMap.CANVAS.width + ' ' + CustomMap.CANVAS.height,
    );
    thumbnail.setAttribute('aria-hidden', 'true');
    drawMapPreview(
      thumbnail,
      map.positions,
      map.links,
      map.owners.map((owner, node) => ({ id: node, owner })),
    );
    return element(
      'button',
      {
        type: 'button',
        className: 'map-card',
        'data-map-id': id,
        'aria-pressed': String(id === selectedId),
        onclick: () => {
          selectedId = id;
          renderLibrary();
        },
      },
      [
        thumbnail,
        element('span', { className: 'map-card-name' }, [map.name]),
        element('span', { className: 'muted' }, [captionOf(map)]),
      ],
    );
  }

  function captionOf(map) {
    const players = CustomMap.players(map);
    return (
      map.positions.length +
      (map.positions.length === 1 ? ' node · ' : ' nodes · ') +
      players +
      (players === 1 ? ' player' : ' players') +
      (CustomMap.isPlayable(map) ? '' : ' · not playable yet')
    );
  }

  function renderDetails(entry) {
    byId('mapLibraryDetails').hidden = entry === null;
    if (entry === null) return;
    const name = byId('libraryName');
    if (document.activeElement !== name) name.value = entry.map.name;
    const seat = byId('librarySeat');
    const chosen = Number(seat.value) || 0;
    const players = CustomMap.players(entry.map);
    seat.replaceChildren(
      ...Array.from({ length: players }, (_, owner) => {
        const option = document.createElement('option');
        option.value = owner;
        option.textContent = playerName(owner);
        option.selected = owner === Math.min(chosen, players - 1);
        return option;
      }),
    );
    seat.disabled = players === 0;
    byId('libraryCaption').textContent = CustomMap.isPlayable(entry.map)
      ? captionOf(entry.map)
      : CustomMap.problems(entry.map)
          .map((problem) => problem.message)
          .join(' · ');
  }

  function openEditor(map, id) {
    pendingEditId = id;
    dialog.close();
    store.batch(() => {
      store.dismissInspector();
      store.openMapEditor(map);
    });
    byId('fit').click();
  }

  const fileNameOf = (name) =>
    (name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'map') + '.peg-map.json';

  function exportMap(map) {
    const url = URL.createObjectURL(
      new Blob([CustomMap.serialize(map)], { type: 'application/json' }),
    );
    const link = element('a', { href: url, download: fileNameOf(map.name) });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const saveButton = element(
    'button',
    { type: 'button', id: 'mapEditorSave', title: 'Keep this map in My maps' },
    ['Save'],
  );
  byId('mapEditorPlay').before(saveButton);
  saveButton.onclick = () => {
    const { map } = store.getSnapshot().editor;
    if (entryOf(editingId)) replaceMap(editingId, map);
    else editingId = addMap(map);
    store.markMapSaved();
  };

  store.subscribe((snapshot, previous) => {
    const editor = snapshot.editor;
    const opened = editor !== null && (previous?.editor ?? null) === null;
    if (opened) {
      editingId = pendingEditId;
      pendingEditId = null;
      maps = readLibrary();
    }
    if (editor === null) editingId = null;
    else
      saveButton.disabled =
        entryOf(editingId) !== null && !GameStore.selectors.mapEditorDirty(editor);
  });

  globalThis.MapLibrary = Object.freeze({
    playable: () =>
      readLibrary()
        .filter(({ map }) => CustomMap.isPlayable(map))
        .map(({ id, map }) => ({ id, map, file: fileOf(map) })),
    newGameChoice: () => {
      const entry = source === 'library' ? entryOf(selectedId) : null;
      return entry && CustomMap.isPlayable(entry.map) ? fileOf(entry.map) : null;
    },
  });

  renderLibrary();
})();
