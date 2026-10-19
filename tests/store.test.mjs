import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

function loadContext(random = Math.random) {
  const context = createContext({ Math: Object.assign(Object.create(Math), { random }) });
  runInContext(read('../src/engine.js'), context);
  runInContext(read('../src/store.js'), context);
  return context;
}

const loadStore = (random) => loadContext(random).GameStore;
const plain = (value) => JSON.parse(JSON.stringify(value));
const assertSameData = (actual, expected) => assert.deepEqual(plain(actual), plain(expected));

function seededRandom(seed = 7) {
  return () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
}

const DEFAULTS = { enabled: true, reserve: '5', invest: '70' };

function deepFreeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

function newStore(GameStore = loadStore()) {
  const store = GameStore.createStore({ selected: null });
  store.replaceMatch(GameStore.classicMatch(seededRandom(), DEFAULTS));
  return store;
}

function playCommands(store) {
  store.changePolicy(0, 'investPct', 40);
  store.setAllocation(0, 'withdraw', 4);
  store.setAllocation(0, null, 2);
  store.setAllocation(0, 1, 12);
  store.setAllocation(0, 2, 10);
  store.setDefaults({ reserve: '2', invest: '60' });
  store.resolve(seededRandom(11));
  store.applyBulkPolicy([0, 1, 2], 4, 55);
  store.applyBulkInvestment([0, 1], 1);
  store.routeSurplus(2, 0, true);
  store.resolve(seededRandom(12));
}

test('identical command sequences produce identical matches', () => {
  const first = newStore(),
    second = newStore();
  playCommands(first);
  playCommands(second);
  assertSameData(first.getSnapshot().match, second.getSnapshot().match);
  assert.equal(first.getSnapshot().match.state.round, 3);
});

test('a resolve command equals a direct engine call with the same inputs', () => {
  const { GameStore, GameEngine } = loadContext(),
    store = newStore(GameStore);
  store.setAllocation(0, 1, 12);
  store.changePolicy(0, 'investPct', 40);
  const before = store.getSnapshot().match;
  store.resolve(seededRandom(3));
  const direct = GameEngine.resolveRound({
    state: before.state,
    playerCount: 2,
    orders: before.orders,
    policies: before.policies,
    links: before.map.edges,
    defaultConquestPolicy: { enabled: true, reserve: 5, investPct: 70 },
    rng: seededRandom(3),
  });
  const after = store.getSnapshot().match;
  assertSameData(after.state, direct.state);
  assertSameData(after.policies, direct.policies);
  assertSameData(after.orders, {});
  assertSameData(after.history, [...direct.events].reverse().concat(before.history));
});

test('commands leave the previous match untouched', () => {
  const store = newStore();
  store.setAllocation(0, 1, 3);
  store.changePolicy(0, 'reserve', 2);
  const frozen = deepFreeze(structuredClone(store.getSnapshot().match));
  store.replaceMatch(frozen);
  assert.doesNotThrow(() => playCommands(store));
  assert.notEqual(store.getSnapshot().match, frozen);
});

test('a command that changes nothing keeps the snapshot and does not notify', () => {
  const store = newStore();
  const calls = [];
  store.subscribe((snapshot, previous) => calls.push([snapshot, previous]));
  const before = store.getSnapshot();
  store.clearAllOrders();
  store.clearNodeOrders(0);
  store.disablePolicy(5);
  store.routeSurplus(0, 1, false);
  store.setAllocation(0, 'withdraw', 999);
  store.setAllocation(5, null, 1);
  store.setAllocation(0, 7, 1);
  assert.equal(store.getSnapshot(), before);
  assert.equal(calls.length, 0);
});

test('a match change keeps the ui slice identity and reports the previous snapshot', () => {
  const store = newStore();
  const before = store.getSnapshot();
  let notified;
  store.subscribe((snapshot, previous) => (notified = { snapshot, previous }));
  store.setAllocation(0, null, 2);
  assert.equal(notified.previous, before);
  assert.notEqual(notified.snapshot.match, before.match);
  assert.equal(notified.snapshot.ui, before.ui);
  assert.equal(notified.snapshot.match.state, before.match.state);
});

test('an over-budget allocation is rejected with the available energy', () => {
  const store = newStore();
  const before = store.getSnapshot();
  assert.equal(store.setAllocation(0, 1, 999), 24);
  assert.equal(store.getSnapshot(), before);
});

test('selectors never draw random numbers', () => {
  let draws = 0;
  const GameStore = loadStore(() => {
    draws += 1;
    return 0.5;
  });
  const store = GameStore.createStore();
  store.replaceMatch(GameStore.classicMatch(seededRandom(), DEFAULTS));
  store.setAllocation(0, 1, 5);
  store.changePolicy(0, 'enabled', true);
  const match = store.getSnapshot().match,
    { selectors } = GameStore;
  for (const node of match.state.nodes) {
    selectors.projection(match, node.id);
    selectors.policyOrders(match, node.id);
  }
  selectors.previewOrders(match);
  assert.equal(draws, 0);
});

test('a save round trip keeps the match and prepends the recovery line', () => {
  const GameStore = loadStore(),
    store = newStore(GameStore);
  playCommands(store);
  const match = store.getSnapshot().match,
    save = JSON.parse(JSON.stringify(GameStore.saveFromMatch(match, 2)));
  assert.equal(save.selected, 2);
  const restored = GameStore.matchFromSave(save, { enabled: false, reserve: '0', invest: '0' });
  assertSameData(restored.history, ['Recovered saved match from this browser.', ...match.history]);
  assertSameData({ ...restored, history: null }, { ...match, history: null });
});

test('an old save without optional fields loads with empty plans and current defaults', () => {
  const GameStore = loadStore();
  const { state, xy, edges, N, playerCount, mapSeed } = GameStore.saveFromMatch(
    GameStore.classicMatch(seededRandom(), DEFAULTS),
    null,
  );
  const legacy = {
    state: { ...state, rulesVersion: undefined },
    xy,
    edges,
    N,
    playerCount,
    mapSeed,
  };
  const restored = GameStore.matchFromSave(legacy, DEFAULTS);
  assertSameData(restored.orders, {});
  assertSameData(restored.policies, {});
  assertSameData(restored.history, ['Recovered saved match from this browser.']);
  assert.equal(restored.defaults, DEFAULTS);
  assert.equal(GameStore.selectors.softCapEnabled(restored), false);
  assert.equal(GameStore.matchFromSave({ state }, DEFAULTS), null);
});
