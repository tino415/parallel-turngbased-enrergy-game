import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

function loadStore() {
  const context = createContext({});
  runInContext(read('../src/engine.js'), context);
  runInContext(read('../src/store.js'), context);
  return context.GameStore;
}

function matchWithPolicy(policy) {
  const GameStore = loadStore();
  const store = GameStore.createStore({ selected: null });
  const base = GameStore.classicMatch(() => 0.5, { enabled: true, reserve: '5', invest: '50' });
  const [a, b] = base.map.edges.find(([x, y]) => x === 0 || y === 0);
  const other = a === 0 ? b : a;
  const nodes = base.state.nodes.map((n) =>
    n.id === 0 || n.id === other ? { ...n, owner: 0, active: 0 } : n,
  );
  store.replaceMatch({
    ...base,
    state: { ...base.state, nodes },
    policies: { 0: { ...policy, dest: other } },
  });
  return { GameStore, store, other };
}

test('a transfer policy shows its route before the node has energy to send', () => {
  const { GameStore, store, other } = matchWithPolicy({ enabled: true, reserve: 5, investPct: 40 });
  const routes = [...GameStore.selectors.policyRoutes(store.getSnapshot().match)];
  assert.deepEqual(
    routes.map(({ source, dest, type, pct }) => ({ source, dest, type, pct })),
    [{ source: 0, dest: other, type: 'transfer', pct: 60 }],
  );
});

test('a disabled policy has no route', () => {
  const { GameStore, store } = matchWithPolicy({ enabled: false, reserve: 5, investPct: 40 });
  assert.equal(GameStore.selectors.policyRoutes(store.getSnapshot().match).length, 0);
});

test('the map shows amounts until the player switches to policies', () => {
  const { store } = matchWithPolicy({ enabled: true, reserve: 5, investPct: 40 });
  assert.equal(store.getSnapshot().ui.mapValues, 'absolute');
  store.setMapValues('policy');
  assert.equal(store.getSnapshot().ui.mapValues, 'policy');
  store.setMapValues('anything else');
  assert.equal(store.getSnapshot().ui.mapValues, 'absolute');
});

test('a pressure edge to an enemy node shows its share, minimum and bank', () => {
  const { GameStore, store } = matchWithPolicy({ enabled: true, reserve: 5, investPct: 40 });
  const match = store.getSnapshot().match;
  const enemy = match.map.edges
    .flatMap(([a, b]) => (a === 0 ? [b] : b === 0 ? [a] : []))
    .find((id) => match.state.nodes[id].owner !== 0);
  assert.notEqual(enemy, undefined);
  store.replaceMatch({
    ...match,
    policies: {
      0: { ...match.policies[0], pressure: { [enemy]: { pct: 20, min: 6, bank: 3 } } },
    },
  });
  const attack = GameStore.selectors
    .policyRoutes(store.getSnapshot().match)
    .find((route) => route.type === 'attack');
  assert.equal(attack.dest, enemy);
  assert.equal(attack.pct, 20);
  assert.equal(attack.minimum, 6);
  assert.equal(attack.bank, 3);
});
