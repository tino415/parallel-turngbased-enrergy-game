import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

function loadContext() {
  const context = createContext({ Math });
  runInContext(read('../src/engine.js'), context);
  runInContext(read('../src/custom-map.js'), context);
  runInContext(read('../src/store.js'), context);
  return context;
}

const { CustomMap, GameStore } = loadContext();
const { mapEditorDirty } = GameStore.selectors;
const plain = (value) => JSON.parse(JSON.stringify(value));
const same = (actual, expected) => assert.deepEqual(plain(actual), plain(expected));

function pair() {
  let map = CustomMap.blank('Pair');
  map = CustomMap.addNode(map, [300, 300]);
  map = CustomMap.addNode(map, [600, 300]);
  map = CustomMap.toggleLink(map, 0, 1);
  map = CustomMap.setOwner(map, 0, 0);
  map = CustomMap.setOwner(map, 1, 1);
  return map;
}

function openStore(map = pair()) {
  const store = GameStore.createStore();
  store.replaceMatch(
    GameStore.classicMatch(Math.random, { enabled: true, reserve: 5, invest: 50 }),
  );
  store.openMapEditor(map);
  return store;
}

const editor = (store) => store.getSnapshot().editor;

test('the editor opens on the editor view and closes back to the map', () => {
  const store = openStore();
  assert.equal(store.getSnapshot().ui.view, 'editor');
  same(editor(store).map, pair());
  assert.equal(editor(store).tool, 'select');
  assert.equal(mapEditorDirty(editor(store)), false);
  store.closeMapEditor();
  assert.equal(store.getSnapshot().editor, null);
  assert.equal(store.getSnapshot().ui.view, 'map');
});

test('closing keeps another view the player switched to meanwhile', () => {
  const store = openStore();
  store.setView('messages');
  store.closeMapEditor();
  assert.equal(store.getSnapshot().ui.view, 'messages');
});

test('editor commands do nothing while no editor is open', () => {
  const store = GameStore.createStore();
  const before = store.getSnapshot();
  store.addMapNode([100, 100]);
  store.undoMapEdit();
  assert.equal(store.getSnapshot(), before);
});

test('an added node is selected and can be undone and redone', () => {
  const store = openStore();
  store.addMapNode([900, 300]);
  assert.equal(editor(store).map.positions.length, 3);
  assert.equal(editor(store).selected, 2);
  assert.equal(mapEditorDirty(editor(store)), true);
  store.undoMapEdit();
  assert.equal(editor(store).map.positions.length, 2);
  assert.equal(editor(store).selected, null);
  assert.equal(mapEditorDirty(editor(store)), false);
  store.redoMapEdit();
  assert.equal(editor(store).map.positions.length, 3);
  store.undoMapEdit();
  store.undoMapEdit();
  assert.equal(editor(store).map.positions.length, 2);
});

test('a new edit forgets the redo history', () => {
  const store = openStore();
  store.addMapNode([900, 300]);
  store.undoMapEdit();
  store.setMapOwner(0, 2);
  store.redoMapEdit();
  assert.equal(editor(store).map.positions.length, 2);
  assert.equal(editor(store).map.owners[0], 2);
});

test('undo keeps the last ten edits', () => {
  const store = openStore();
  for (let i = 0; i < 15; i++) store.addMapNode([100 + i * 100, 800]);
  for (let i = 0; i < 15; i++) store.undoMapEdit();
  assert.equal(editor(store).map.positions.length, 7);
});

test('a drag is one undo step: begin remembers, moves do not', () => {
  const store = openStore();
  store.beginMapMove(1);
  store.moveMapNode(1, [700, 300]);
  store.moveMapNode(1, [800, 300]);
  store.moveMapNode(1, [900, 330]);
  same(editor(store).map.positions[1], [900, 330]);
  assert.equal(editor(store).past.length, 1);
  store.undoMapEdit();
  same(editor(store).map.positions[1], [600, 300]);
  store.beginMapMove(5);
  assert.equal(editor(store).past.length, 0);
});

test('removing a node renumbers the selection and the link start', () => {
  const store = openStore();
  store.addMapNode([900, 300]);
  store.selectMapNode(2);
  store.removeMapNode(0);
  assert.equal(editor(store).selected, 1);
  store.removeMapNode(1);
  assert.equal(editor(store).selected, null);
  assert.equal(editor(store).map.positions.length, 1);
});

test('the link tool connects the first and the second node tapped', () => {
  const store = openStore();
  store.addMapNode([900, 300]);
  store.setMapTool('link');
  store.linkMapNode(1);
  assert.equal(editor(store).linkFrom, 1);
  assert.equal(editor(store).selected, 1);
  store.linkMapNode(2);
  assert.ok(CustomMap.hasLink(editor(store).map, 1, 2));
  assert.equal(editor(store).linkFrom, null);
  store.linkMapNode(2);
  store.linkMapNode(1);
  assert.ok(!CustomMap.hasLink(editor(store).map, 1, 2));
});

test('tapping the link start again cancels it, and so does changing tool', () => {
  const store = openStore();
  store.linkMapNode(0);
  store.linkMapNode(0);
  assert.equal(editor(store).linkFrom, null);
  store.linkMapNode(0);
  store.setMapTool('erase');
  assert.equal(editor(store).linkFrom, null);
  assert.equal(editor(store).tool, 'erase');
  store.setMapTool('paint');
  assert.equal(editor(store).tool, 'erase');
});

test('owners cycle and set, and a map is renamed and cleared', () => {
  const store = openStore();
  store.cycleMapOwner(1, 1);
  assert.equal(editor(store).map.owners[1], 2);
  store.setMapOwner(1, null);
  assert.equal(editor(store).map.owners[1], null);
  store.renameMap('Pair two');
  assert.equal(editor(store).map.name, 'Pair two');
  store.selectMapNode(0);
  store.clearMap();
  same(editor(store).map, CustomMap.blank('Pair two'));
  assert.equal(editor(store).selected, null);
  store.undoMapEdit();
  assert.equal(editor(store).map.positions.length, 2);
});

test('marking the map saved clears the dirty flag until the next edit', () => {
  const store = openStore();
  store.addMapNode([900, 300]);
  store.markMapSaved();
  assert.equal(mapEditorDirty(editor(store)), false);
  store.setMapOwner(2, 2);
  assert.equal(mapEditorDirty(editor(store)), true);
  store.undoMapEdit();
  assert.equal(mapEditorDirty(editor(store)), false);
});

test('a command that changes nothing commits nothing', () => {
  const store = openStore();
  const before = editor(store);
  store.moveMapNode(1, [600, 300]);
  store.setMapOwner(0, 0);
  store.selectMapNode(9);
  store.toggleMapLink(0, 0);
  store.redoMapEdit();
  assert.equal(editor(store), before);
});

test('editor changes notify subscribers with the editor slice changed', () => {
  const store = openStore();
  const changes = [];
  store.subscribe((snapshot, previous) => {
    changes.push([
      GameStore.changed(snapshot, previous, (s) => s.editor),
      GameStore.changed(snapshot, previous, (s) => s.match),
    ]);
  });
  store.addMapNode([900, 300]);
  store.setView('map');
  same(changes, [
    [true, false],
    [false, false],
  ]);
});
