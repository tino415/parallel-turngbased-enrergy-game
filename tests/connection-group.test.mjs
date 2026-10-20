import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const context = createContext({});
runInContext(read('../src/engine.js'), context);
runInContext(read('../src/store.js'), context);
const { GameStore } = context;
const { selectors, commands } = GameStore;

const plain = (value) => JSON.parse(JSON.stringify(value));
const DEFAULTS = { enabled: true, reserve: '5', invest: '70' };

// Classic map: Blue owns 0, 1, 2 and 4; nodes 3, 5, 6 and 7 are neutral.
const ACTIVE = { 0: 20, 1: 10, 2: 10, 3: 5, 4: 2, 5: 8, 6: 4, 7: 3 };
function blueMatch({ policies = {}, orders = {} } = {}) {
  const match = GameStore.classicMatch(() => 0.5, DEFAULTS);
  const nodes = match.state.nodes.map((n) => ({
    ...n,
    owner: [0, 1, 2, 4].includes(n.id) ? 0 : n.owner,
    active: ACTIVE[n.id] ?? n.active,
  }));
  return { ...match, state: { ...match.state, nodes }, policies, orders };
}

const policy = (fields) => ({ enabled: true, reserve: 0, investPct: 0, dest: null, ...fields });
const sent = (match, source, destination) => match.orders[source]?.edges[destination] ?? 0;

test('the connection group view counts attacks and shows mixed amounts and pressure', () => {
  const match = blueMatch({
    orders: { 1: { invest: 0, edges: { 3: 6 } } },
    policies: {
      2: policy({ pressure: { 5: { pct: 10, min: 10 } } }),
      4: policy({ pressure: { 7: { pct: 20, min: 15 } } }),
    },
  });
  const view = plain(
    selectors.groupEdgeView(match, [
      [1, 3],
      [2, 5],
      [4, 7],
      [0, 1],
    ]),
  );
  assert.equal(view.attacks, 3);
  assert.equal(view.sending, 6);
  assert.deepEqual(view.amount, { mixed: [0, 6] });
  assert.equal(view.pressured, 2);
  assert.deepEqual(view.pct, { mixed: [10, 20] });
  assert.deepEqual(view.min, { mixed: [10, 15] });
  assert.equal(plain(selectors.groupEdgeView(match, [[1, 3]])).pct, null);
});

test('sending on each connection skips the ones whose node lacks energy and leaves them as they were', () => {
  const match = blueMatch({ orders: { 4: { invest: 0, edges: { 7: 1 } } } });
  const { match: next, skipped } = commands.sendOnEachEdge(
    match,
    [
      [1, 3],
      [2, 5],
      [4, 7],
    ],
    3,
  );
  assert.deepEqual(plain(skipped), [[4, 7]]);
  assert.equal(sent(next, 1, 3), 3);
  assert.equal(sent(next, 2, 5), 3);
  assert.equal(sent(next, 4, 7), 1);
});

test('a win chance gives every attack the amount its own target needs and leaves support alone', () => {
  const match = blueMatch();
  const chance70 = (source, destination) =>
    selectors
      .orderPresets(match, source, destination)
      .presets.find((preset) => preset.chance === 0.7).amount;
  const { match: next, skipped } = commands.attackChanceOnEachEdge(
    match,
    [
      [1, 3],
      [2, 5],
      [0, 1],
      [4, 6],
    ],
    0.7,
  );
  assert.deepEqual(plain(skipped), [[4, 6]]);
  assert.equal(sent(next, 1, 3), chance70(1, 3));
  assert.equal(sent(next, 2, 5), chance70(2, 5));
  assert.notEqual(chance70(1, 3), chance70(2, 5));
  assert.equal(sent(next, 0, 1), 0);
});

test('All splits a node’s energy evenly between its selected connections', () => {
  const match = blueMatch({ orders: { 1: { invest: 0, edges: { 3: 7 } } } });
  const next = commands.splitOnEachEdge(
    match,
    [
      [1, 3],
      [1, 4],
      [2, 5],
    ],
    'all',
  );
  assert.equal(sent(next, 1, 3), 5);
  assert.equal(sent(next, 1, 4), 5);
  assert.equal(sent(next, 2, 5), 10);
});

test('Surplus splits what is above the node’s reserve', () => {
  const match = blueMatch({ policies: { 1: policy({ reserve: 4 }) } });
  const next = commands.splitOnEachEdge(
    match,
    [
      [1, 3],
      [1, 4],
    ],
    'surplus',
  );
  assert.equal(sent(next, 1, 3), 3);
  assert.equal(sent(next, 1, 4), 3);
});

test('group pressure turns on every attack, keeps existing values and skips support', () => {
  const match = blueMatch({
    policies: { 2: policy({ pressure: { 5: { pct: 20, min: 15 } } }) },
  });
  const pairs = [
    [1, 3],
    [2, 5],
    [1, 4],
  ];
  const on = commands.setGroupEdgePressure(match, pairs, {});
  assert.deepEqual(plain(on.rejected), []);
  assert.deepEqual(plain(on.match.policies[1].pressure), { 3: { pct: 10, min: 10 } });
  assert.deepEqual(plain(on.match.policies[2].pressure), { 5: { pct: 20, min: 15 } });
  const set = commands.setGroupEdgePressure(on.match, pairs, { pct: 30 });
  assert.equal(set.match.policies[1].pressure[3].pct, 30);
  assert.equal(set.match.policies[2].pressure[5].pct, 30);
  assert.equal(set.match.policies[2].pressure[5].min, 15);
});

test('group pressure that would push one node over 100% changes nothing and names it', () => {
  const match = blueMatch({ policies: { 1: policy({ investPct: 80 }) } });
  const result = commands.setGroupEdgePressure(
    match,
    [
      [1, 3],
      [2, 5],
    ],
    { pct: 30 },
  );
  assert.equal(result.match, match);
  assert.deepEqual(plain(result.rejected), [[1, 3]]);
});

test('stopping and clearing touch only the selected connections', () => {
  const match = blueMatch({
    orders: { 1: { invest: 2, edges: { 3: 2, 4: 1 } } },
    policies: { 1: policy({ pressure: { 3: { pct: 10, min: 10 } } }) },
  });
  const cleared = commands.clearEdgeOrders(match, [
    [1, 3],
    [2, 5],
  ]);
  assert.deepEqual(plain(cleared.orders[1].edges), { 4: 1 });
  assert.equal(cleared.orders[1].invest, 2);
  const stopped = commands.stopEdgePressure(match, [
    [1, 3],
    [2, 5],
  ]);
  assert.deepEqual(plain(stopped.policies[1].pressure), {});
});

test('the pressured connections of a node group can be edited together', () => {
  const match = blueMatch({
    policies: {
      1: policy({ pressure: { 3: { pct: 10, min: 10 } } }),
      2: policy({ pressure: { 5: { pct: 15, min: 12 } } }),
    },
  });
  const pairs = selectors.pressuredEdges(match, [0, 1, 2]);
  assert.deepEqual(plain(pairs), [
    [1, 3],
    [2, 5],
  ]);
  const { match: next } = commands.setGroupEdgePressure(match, pairs, { min: 25 });
  assert.equal(next.policies[1].pressure[3].min, 25);
  assert.equal(next.policies[2].pressure[5].min, 25);
});

test('a group holds connections touching own nodes, directed away from them, never with nodes', () => {
  const store = GameStore.createStore();
  store.replaceMatch(blueMatch());
  const bulkEdges = () => plain(store.getSnapshot().ui.bulkEdges);
  store.setGroupMode(true);
  store.toggleGroupEdge(3, 1);
  store.toggleGroupEdge(5, 7);
  store.toggleGroupEdge(0, 1);
  assert.deepEqual(bulkEdges(), [
    [1, 3],
    [0, 1],
  ]);
  store.swapGroupEdge(0, 1);
  store.swapGroupEdge(1, 3);
  assert.deepEqual(bulkEdges(), [
    [1, 3],
    [1, 0],
  ]);
  store.toggleGroupMember(2);
  assert.deepEqual(plain(store.getSnapshot().ui.bulkSelection), []);
  store.toggleGroupEdge(1, 3);
  assert.deepEqual(bulkEdges(), [[1, 0]]);
  store.leaveGroupMode();
  assert.deepEqual(bulkEdges(), []);
  store.toggleGroupMember(2);
  store.toggleGroupEdge(1, 3);
  assert.deepEqual(bulkEdges(), []);
});

test('after a round, connections that no longer touch own nodes leave the group', () => {
  const store = GameStore.createStore();
  store.replaceMatch(blueMatch());
  store.setBulkEdges([
    [1, 3],
    [1, 0],
    [2, 5],
    [6, 8],
  ]);
  assert.deepEqual(plain(store.getSnapshot().ui.bulkEdges), [
    [1, 3],
    [1, 0],
    [2, 5],
  ]);
  const match = store.getSnapshot().match;
  const nodes = match.state.nodes.map((n) => (n.id === 1 ? { ...n, owner: 1 } : n));
  store.replaceMatch({ ...match, state: { ...match.state, nodes } });
  store.resolve();
  assert.deepEqual(plain(store.getSnapshot().ui.bulkEdges), [
    [0, 1],
    [2, 5],
  ]);
});
