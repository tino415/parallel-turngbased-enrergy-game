import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const context = createContext({});
runInContext(read('../src/engine.js'), context);
runInContext(read('../src/store.js'), context);
const { GameStore } = context;
const { selectors } = GameStore;

const plain = (value) => JSON.parse(JSON.stringify(value));
const DEFAULTS = { enabled: true, reserve: '5', invest: '70' };
const FRONT_LINE = {
  reserve: 12,
  investPct: 30,
  investTarget: 200,
  divestPct: 10,
  defensePct: 40,
  defenseTarget: 90,
};

function storeWithBlueNodes() {
  const store = GameStore.createStore({ selected: null });
  const match = GameStore.classicMatch(() => 0.5, DEFAULTS);
  const nodes = match.state.nodes.map((n) => (n.id === 1 ? { ...n, owner: 0, active: 10 } : n));
  store.replaceMatch({ ...match, state: { ...match.state, nodes } });
  return store;
}
const templatesOf = (store) => plain(store.getSnapshot().ui.templates);
const policiesOf = (store) => plain(store.getSnapshot().match.policies);

test('the template list starts empty', () => {
  assert.deepEqual(templatesOf(storeWithBlueNodes()), []);
});

test('saving a template keeps its numbers and replaces one of the same name', () => {
  const store = storeWithBlueNodes();
  store.saveTemplate('Front line', FRONT_LINE);
  store.saveTemplate('Bank', { reserve: 0, investPct: 90 });
  store.saveTemplate('Front line', { ...FRONT_LINE, reserve: 20 });
  const [front, bank] = templatesOf(store);
  assert.equal(front.reserve, 20);
  assert.equal(bank.investTarget, null);
  assert.equal(templatesOf(store).length, 2);
});

test('a template is renamed and deleted by name, and a taken name is refused', () => {
  const store = storeWithBlueNodes();
  store.saveTemplate('A', FRONT_LINE);
  store.saveTemplate('B', FRONT_LINE);
  store.renameTemplate('A', 'B');
  assert.deepEqual(
    templatesOf(store).map((t) => t.name),
    ['A', 'B'],
  );
  store.renameTemplate('A', 'C');
  store.deleteTemplate('B');
  assert.deepEqual(
    templatesOf(store).map((t) => t.name),
    ['C'],
  );
});

test('stored templates are cleaned on load and junk is dropped', () => {
  const store = storeWithBlueNodes();
  store.setTemplates([{ name: ' Ok ', reserve: 1, investPct: 2 }, { name: '' }, null, 7]);
  assert.deepEqual(
    templatesOf(store).map((t) => t.name),
    ['Ok'],
  );
  store.setTemplates([
    { name: 'A', reserve: 1, investPct: 2 },
    { name: ' A ', reserve: 3, investPct: 4 },
    { name: 'Wild', reserve: 1, investPct: 500 },
    { name: 'Negative', reserve: -1, investPct: 5 },
    { name: 'Target', reserve: 1, investPct: 5, investTarget: -3 },
  ]);
  assert.deepEqual(
    templatesOf(store).map((t) => t.name),
    ['A'],
  );
  assert.equal(templatesOf(store)[0].reserve, 1);
  store.setTemplates('nonsense');
  assert.deepEqual(templatesOf(store), []);
});

test('applying a template copies its values and keeps no link', () => {
  const store = storeWithBlueNodes();
  store.saveTemplate('Front line', FRONT_LINE);
  const [template] = store.getSnapshot().ui.templates;
  store.applyTemplate([0, 1], template);
  store.saveTemplate('Front line', { ...FRONT_LINE, reserve: 99 });
  for (const id of [0, 1]) {
    assert.equal(policiesOf(store)[id].reserve, 12);
    assert.equal(policiesOf(store)[id].investTarget, 200);
    assert.equal(policiesOf(store)[id].defenseTarget, 90);
    assert.equal(policiesOf(store)[id].enabled, true);
  }
});

test('a node keeps its route and pressure when a template is applied', () => {
  const store = storeWithBlueNodes();
  store.routeSurplus(0, 1, true);
  store.saveTemplate('T', { reserve: 3, investPct: 40 });
  store.applyTemplate([0], store.getSnapshot().ui.templates[0]);
  assert.equal(policiesOf(store)[0].dest, 1);
  assert.equal(policiesOf(store)[0].reserve, 3);
});

test('a node whose pressure shares leave no room for the template is skipped and named', () => {
  const store = storeWithBlueNodes();
  const match = store.getSnapshot().match;
  const target = selectors.neighbors(match, 0).find((id) => !selectors.isOwn(match, id));
  store.setEdgePressure(0, target, { pct: 50, min: 10 });
  store.saveTemplate('Greedy', { reserve: 5, investPct: 60 });
  const template = store.getSnapshot().ui.templates[0];
  assert.deepEqual(selectors.templateMisfits(store.getSnapshot().match, [0, 1], template), [0]);
  store.applyTemplate([0, 1], template);
  assert.equal(policiesOf(store)[0].investPct, 50);
  assert.equal(policiesOf(store)[1].investPct, 60);
});

test('a template fills the conquest default as text fields', () => {
  const store = storeWithBlueNodes();
  store.saveTemplate('Front line', FRONT_LINE);
  const defaults = selectors.templateDefaults(store.getSnapshot().ui.templates[0]);
  store.setDefaults(defaults);
  assert.deepEqual(plain(store.getSnapshot().match.defaults), { enabled: true, ...defaults });
  assert.equal(defaults.investTarget, '200');
  assert.equal(selectors.templateDefaults({ reserve: 1, investPct: 2 }).investTarget, '');
});
