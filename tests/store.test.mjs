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
  store.resolve();
  store.applyGroupPolicyField([0, 1, 2], 'reserve', 4);
  store.applyGroupPolicyField([0, 1, 2], 'investPct', 55);
  store.investOnEach([0, 1], 1);
  store.routeSurplus(2, 0, true);
  store.resolve();
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
  store.resolve();
  const direct = GameEngine.resolveRound({
    state: before.state,
    playerCount: 2,
    orders: before.orders,
    policies: before.policies,
    links: before.map.edges,
    defaultConquestPolicy: { enabled: true, reserve: 5, investPct: 70 },
    rng: GameEngine.seeded(before.replay.diceSeed + ':1'),
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

test('a batch notifies once with the snapshot from before its first command', () => {
  const store = newStore();
  const calls = [];
  store.subscribe((snapshot, previous) => calls.push([snapshot, previous]));
  const before = store.getSnapshot();
  store.batch(() => {
    store.select(0);
    store.setAllocation(0, null, 2);
    store.setView('messages');
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], store.getSnapshot());
  assert.equal(calls[0][1], before);
  store.batch(() => store.clearAllOrders() && store.clearAllOrders());
  store.batch(() => {});
  assert.equal(calls.length, 2);
});

test('a command from a listener reaches every listener after the current change', () => {
  const store = newStore();
  const seen = [];
  store.subscribe((snapshot) => {
    if (snapshot.ui.selected === 0) store.select(1);
  });
  store.subscribe((snapshot, previous) => seen.push([previous.ui.selected, snapshot.ui.selected]));
  store.select(0);
  assert.deepEqual(seen, [
    [null, 0],
    [0, 1],
  ]);
});

test('refresh notifies every listener without a previous snapshot', () => {
  const store = newStore();
  const calls = [];
  store.subscribe((snapshot, previous) => calls.push([snapshot, previous]));
  store.refresh();
  assert.deepEqual(calls, [[store.getSnapshot(), null]]);
  const { changed } = loadStore();
  assert.equal(
    changed(store.getSnapshot(), null, (s) => s.match),
    true,
  );
  assert.equal(
    changed(store.getSnapshot(), store.getSnapshot(), (s) => s.match),
    false,
  );
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

test('derived previews are computed once per match and again after a commit', () => {
  const GameStore = loadStore(),
    store = newStore(GameStore),
    { selectors } = GameStore;
  store.changePolicy(0, 'enabled', true);
  const match = store.getSnapshot().match;
  assert.equal(selectors.previewOrders(match), selectors.previewOrders(match));
  assert.equal(selectors.projection(match, 0), selectors.projection(match, '0'));
  assert.equal(selectors.policyOrders(match, 0), selectors.policyOrders(match, 0));

  store.setAllocation(0, 1, 5);
  const next = store.getSnapshot().match;
  assert.notEqual(selectors.previewOrders(next), selectors.previewOrders(match));
  assert.ok(selectors.previewOrders(next).some((o) => o.dest === 1 && o.amount === 5));
  assert.ok(!selectors.previewOrders(match).some((o) => o.dest === 1 && o.amount === 5));
  assertSameData(selectors.projection(next, 0), loadStore().selectors.projection(plain(next), 0));
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
  assertSameData(restored.keptPolicies, {});
  assertSameData(restored.history, ['Recovered saved match from this browser.']);
  assert.equal(restored.defaults, DEFAULTS);
  assert.equal(GameStore.selectors.softCapEnabled(restored), false);
  assert.equal(GameStore.matchFromSave({ state }, DEFAULTS), null);
});

test('a save carrying the removed flow filter loads like one without it', () => {
  const GameStore = loadStore(),
    store = newStore(GameStore);
  playCommands(store);
  const save = JSON.parse(JSON.stringify(GameStore.saveFromMatch(store.getSnapshot().match, 2)));
  const withFilter = { ...save, overlay: 'manual', ui: { overlay: 'none' } };
  assertSameData(
    GameStore.matchFromSave(withFilter, DEFAULTS),
    GameStore.matchFromSave(save, DEFAULTS),
  );
});

test('ui commands change only the ui slice and ignore repeated values', () => {
  const store = newStore();
  const calls = [];
  store.subscribe((snapshot, previous) => calls.push({ snapshot, previous }));
  const before = store.getSnapshot();
  store.setView('map');
  store.setBulkSelection([]);
  store.toggleGroupMember(5);
  assert.equal(store.getSnapshot(), before);

  store.setView('messages');
  store.toggleGroupMember(0);
  store.copyPolicy({ enabled: true, reserve: 1, investPct: 9, dest: null });
  const after = store.getSnapshot();
  assert.equal(calls.length, 3);
  assert.equal(after.match, before.match);
  const { view, clipboard, bulkSelection } = after.ui;
  assertSameData(
    { view, clipboard, bulkSelection },
    {
      view: 'messages',
      clipboard: { enabled: true, reserve: 1, investPct: 9, dest: null },
      bulkSelection: [0],
    },
  );
  store.toggleGroupMember(0);
  assertSameData(store.getSnapshot().ui.bulkSelection, []);
});

test('inspecting a node highlights first and edits on the second selection', () => {
  const store = newStore();
  store.inspectNode(0);
  let { selected, inspector } = store.getSnapshot().ui;
  assert.equal(selected, 0);
  assertSameData(inspector, {
    active: { kind: 'node', id: 0 },
    editing: false,
    focusedNode: 0,
  });
  store.inspectNode(0);
  ({ inspector } = store.getSnapshot().ui);
  assert.equal(inspector.editing, true);

  store.inspectNode(13);
  ({ selected, inspector } = store.getSnapshot().ui);
  assert.equal(selected, 13);
  assertSameData(inspector, {
    active: { kind: 'node', id: 13 },
    editing: false,
    focusedNode: 13,
  });
});

test('inspecting an edge selects its friendly source, which a direction change replaces', () => {
  const store = newStore();
  store.inspectEdge(0, 1);
  assert.equal(store.getSnapshot().ui.selected, 0);
  assertSameData(store.getSnapshot().ui.inspector.active, { kind: 'edge', a: 0, b: 1, source: 0 });
  store.inspectEdge(0, 1);
  assert.equal(store.getSnapshot().ui.inspector.editing, true);
  store.setEdgeSource(1);
  assert.equal(store.getSnapshot().ui.selected, 1);
  assert.equal(store.getSnapshot().ui.inspector.active.source, 1);

  store.inspectEdge(3, 6);
  assert.equal(store.getSnapshot().ui.selected, null);
  assert.equal(store.getSnapshot().ui.inspector.active.source, null);
});

test('an edge between friendly nodes opens in the direction of its surplus route', () => {
  const { selectors } = loadStore(),
    owned = (match, ids) => ({
      ...match,
      state: {
        ...match.state,
        nodes: match.state.nodes.map((n) => (ids.includes(n.id) ? { ...n, owner: 0 } : n)),
      },
    });
  const store = newStore();
  store.replaceMatch(owned(store.getSnapshot().match, [1]));
  const match = store.getSnapshot().match;
  assert.equal(selectors.edgeSource(match, 0, 1), 0);
  store.routeSurplus(1, 0, true);
  assert.equal(selectors.edgeSource(store.getSnapshot().match, 0, 1), 1);
  store.disablePolicy(1);
  assert.equal(selectors.edgeSource(store.getSnapshot().match, 0, 1), 1);
});

test('dismissing clears selection and editing but keeps focus', () => {
  const store = newStore();
  store.inspectNode(0);
  store.inspectNode(0);
  store.dismissInspector();
  const { selected, inspector } = store.getSnapshot().ui;
  assert.equal(selected, null);
  assertSameData(inspector, {
    active: null,
    editing: false,
    focusedNode: 0,
  });
  const before = store.getSnapshot();
  store.dismissInspector();
  store.editSelectedNode();
  store.setCamera({ x: 0, y: 0, scale: 1 });
  assert.equal(store.getSnapshot(), before);
});

function storeWithBlueNodes(ids, GameStore = loadStore()) {
  const store = newStore(GameStore),
    match = store.getSnapshot().match,
    nodes = match.state.nodes.map((n) => (ids.includes(n.id) ? { ...n, owner: 0, active: 20 } : n));
  store.replaceMatch({ ...match, state: { ...match.state, nodes } });
  return store;
}

test('a manual support replaces the manual support in the opposite direction', () => {
  const store = storeWithBlueNodes([0, 1]);
  store.setAllocation(0, null, 2);
  store.setAllocation(0, 1, 3);
  store.setAllocation(1, 0, 4);
  assertSameData(store.getSnapshot().match.orders, {
    0: { invest: 2, withdraw: 0, edges: {}, hold: false },
    1: { invest: 0, withdraw: 0, edges: { 0: 4 }, hold: false },
  });
  store.setAllocation(0, 1, 5);
  assertSameData(Object.keys(store.getSnapshot().match.orders[1]?.edges ?? {}), []);
});

test('a surplus route replaces the surplus route in the opposite direction', () => {
  const store = storeWithBlueNodes([0, 1, 2]);
  store.routeSurplus(0, 1, true);
  store.routeSurplus(1, 0, true);
  assert.equal(store.getSnapshot().match.policies[0].dest, null);
  assert.equal(store.getSnapshot().match.policies[1].dest, 0);
  store.changePolicy(0, 'dest', 1);
  assert.equal(store.getSnapshot().match.policies[1].dest, null);
  store.pastePolicy(1, { ...store.getSnapshot().match.policies[0], dest: 0 });
  assert.equal(store.getSnapshot().match.policies[0].dest, null);
  assert.equal(store.getSnapshot().match.policies[0].reserve, 5);
});

test('a manual support and a surplus route never cancel each other', () => {
  const store = storeWithBlueNodes([0, 1]);
  store.routeSurplus(1, 0, true);
  store.setAllocation(0, 1, 3);
  store.routeSurplus(1, 0, true);
  const { orders, policies } = store.getSnapshot().match;
  assert.equal(policies[1].dest, 0);
  assert.equal(orders[0].edges[1], 3);
});

test('the reverse support a new order would replace is reported before it is set', () => {
  const GameStore = loadStore(),
    store = storeWithBlueNodes([0, 1], GameStore);
  const replaced = () => GameStore.selectors.replacedSupport(store.getSnapshot().match, 0, 1);
  assertSameData(replaced(), { manual: 0, route: false });
  store.setAllocation(1, 0, 4);
  store.routeSurplus(1, 0, true);
  assertSameData(replaced(), { manual: 4, route: true });
});

test('a save with support both ways keeps the net manual support and clears both routes', () => {
  const GameStore = loadStore(),
    store = storeWithBlueNodes([0, 1], GameStore),
    save = JSON.parse(JSON.stringify(GameStore.saveFromMatch(store.getSnapshot().match, null)));
  save.orders = {
    0: { invest: 1, withdraw: 0, edges: { 1: 3 }, hold: false },
    1: { invest: 0, withdraw: 0, edges: { 0: 5 }, hold: false },
  };
  save.policies = {
    0: { enabled: true, reserve: 4, investPct: 30, dest: 1 },
    1: { enabled: true, reserve: 6, investPct: 20, dest: 0 },
  };
  const restored = GameStore.matchFromSave(save, DEFAULTS);
  assertSameData(restored.orders, {
    0: { invest: 1, withdraw: 0, edges: {}, hold: false },
    1: { invest: 0, withdraw: 0, edges: { 0: 2 }, hold: false },
  });
  assertSameData(restored.policies, {
    0: { enabled: true, reserve: 4, investPct: 30, dest: null },
    1: { enabled: true, reserve: 6, investPct: 20, dest: null },
  });
  assert.equal(
    restored.history[0],
    'Node 0 and Node 1 sent surplus to each other; both routes were cleared.',
  );
});

const leaderboardMatch = {
  map: { playerCount: 3 },
  state: {
    nodes: [
      { id: 0, owner: 0, active: 10, invested: 30 },
      { id: 1, owner: 0, active: 5, invested: 0 },
      { id: 2, owner: 1, active: 40, invested: 2 },
      { id: 3, owner: null, active: 99, invested: 99 },
    ],
  },
};
const leaderboardOrder = (sort) =>
  loadStore()
    .selectors.leaderboard(leaderboardMatch, sort)
    .map((standing) => standing.name);

test('the leaderboard totals each player, keep eliminated players and skip neutral nodes', () => {
  assertSameData(loadStore().selectors.leaderboard(leaderboardMatch), [
    { player: 0, name: 'Blue', invested: 30, active: 15, nodes: 2 },
    { player: 1, name: 'Red', invested: 2, active: 40, nodes: 1 },
    { player: 2, name: 'Purple', invested: 0, active: 0, nodes: 0 },
  ]);
});

test('the leaderboard sorts by any column and break ties by player order', () => {
  assertSameData(leaderboardOrder({ column: 'invested', direction: 'desc' }), [
    'Blue',
    'Red',
    'Purple',
  ]);
  assertSameData(leaderboardOrder({ column: 'active', direction: 'desc' }), [
    'Red',
    'Blue',
    'Purple',
  ]);
  assertSameData(leaderboardOrder({ column: 'nodes', direction: 'asc' }), [
    'Purple',
    'Red',
    'Blue',
  ]);
  assertSameData(leaderboardOrder({ column: 'player', direction: 'desc' }), [
    'Purple',
    'Red',
    'Blue',
  ]);
  const tied = { ...leaderboardMatch, map: { playerCount: 4 } };
  assertSameData(
    loadStore()
      .selectors.leaderboard(tied, { column: 'nodes', direction: 'desc' })
      .map((standing) => standing.name),
    ['Blue', 'Red', 'Purple', 'Orange'],
  );
});

test('sorting the leaderboard starts numbers high, flips on repeat and leaves the match alone', () => {
  const store = newStore();
  const before = store.getSnapshot();
  const sorts = [];
  for (const column of ['invested', 'invested', 'player', 'player', 'unknown'])
    sorts.push((store.sortLeaderboard(column), store.getSnapshot().ui.leaderboardSort));
  assertSameData(before.ui.leaderboardSort, { column: 'player', direction: 'asc' });
  assertSameData(sorts, [
    { column: 'invested', direction: 'desc' },
    { column: 'invested', direction: 'asc' },
    { column: 'player', direction: 'asc' },
    { column: 'player', direction: 'desc' },
    { column: 'player', direction: 'desc' },
  ]);
  assert.equal(store.getSnapshot().match, before.match);
});

test('standings of a played match add up to the nodes each player owns', () => {
  const store = newStore();
  playCommands(store);
  const { match } = store.getSnapshot();
  const owned = (owner) => match.state.nodes.filter((node) => node.owner === owner);
  for (const standing of loadStore().selectors.leaderboard(match)) {
    const nodes = owned(standing.player);
    assert.equal(standing.nodes, nodes.length);
    assert.ok(Math.abs(standing.active - nodes.reduce((t, n) => t + n.active, 0)) < 1e-9);
    assert.ok(Math.abs(standing.invested - nodes.reduce((t, n) => t + n.invested, 0)) < 1e-9);
  }
});

function storeWithBlueAttacker({ defense, policy = null }) {
  const store = newStore(),
    match = store.getSnapshot().match,
    nodes = match.state.nodes.map((n) => {
      if (n.id === 0) return { ...n, owner: 0, active: 20, invested: 0 };
      if (n.id === 1) return { ...n, owner: 1, active: defense };
      return n;
    });
  store.replaceMatch({ ...match, state: { ...match.state, nodes }, policies: { 0: policy } });
  return store;
}

const orderPresets = (store, destination = 1) =>
  loadStore().selectors.orderPresets(store.getSnapshot().match, 0, destination);

const presetAmounts = (store, destination) =>
  Object.fromEntries(
    orderPresets(store, destination).presets.map((p) => [
      p.kind === 'chance' ? p.chance : p.kind,
      p.amount,
    ]),
  );

function engineWinRate(attack, defense) {
  const random = seededRandom(11),
    roll = () => 0.8 + random() * 0.4,
    battles = 200000;
  let wins = 0;
  for (let i = 0; i < battles; i++) if (attack * roll() > defense * roll()) wins++;
  return wins / battles;
}

test('success presets send the smallest attack that wins that often under the combat rolls', () => {
  const amounts = presetAmounts(storeWithBlueAttacker({ defense: 10 }));
  assert.equal(amounts[1], 15);
  for (const chance of [0.7, 0.9]) {
    assert.ok(engineWinRate(amounts[chance], 10) >= chance - 0.005, `${chance} reaches its odds`);
    assert.ok(engineWinRate(amounts[chance] - 0.2, 10) < chance, `${chance} is the smallest`);
  }
  assert.ok(amounts[0.7] < amounts[0.9]);
});

test('send all fills the source budget and send all surplus keeps the policy reserve', () => {
  const store = storeWithBlueAttacker({
    defense: 10,
    policy: { enabled: true, reserve: 5, investPct: 0, dest: null },
  });
  store.setAllocation(0, null, 3);
  assert.equal(orderPresets(store).limit, 17);
  const amounts = presetAmounts(store);
  assert.equal(amounts.all, 17);
  assert.equal(amounts.surplus, 12);
});

test('an empty defense still needs a positive attack', () => {
  assertSameData(presetAmounts(storeWithBlueAttacker({ defense: 0 })), {
    0.7: 0.1,
    0.9: 0.1,
    1: 0.1,
    all: 20,
    surplus: 20,
  });
});

test('a support transfer offers only send all and send all surplus', () => {
  const store = storeWithBlueNodes([0, 1]);
  assertSameData(
    orderPresets(store).presets.map((p) => p.kind),
    ['all', 'surplus'],
  );
});

test('a percentage order is taken from the active energy before the policy reserve', () => {
  const store = storeWithBlueAttacker({
    defense: 10,
    policy: { enabled: true, reserve: 5, investPct: 0, dest: null },
  });
  const { selectors } = loadStore();
  const match = () => store.getSnapshot().match;
  assert.equal(selectors.activeShareAmount(match(), 0, 40), 8);
  assert.equal(selectors.activeSharePercent(match(), 0, 5), 25);
});
