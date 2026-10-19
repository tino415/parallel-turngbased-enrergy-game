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

// Classic map: Blue owns 0, 1, 2 and 4; node 3 neutral; Red keeps node 13.
function blueMatch(policies = {}) {
  const match = GameStore.classicMatch(() => 0.5, DEFAULTS);
  const nodes = match.state.nodes.map((n) =>
    [1, 2, 4].includes(n.id) ? { ...n, owner: 0, active: n.id === 4 ? 2 : 10 } : n,
  );
  return { ...match, state: { ...match.state, nodes }, policies };
}

const policy = (fields) => ({ enabled: true, reserve: 5, investPct: 50, dest: null, ...fields });

test('border and interior split the own nodes by their neighbours', () => {
  const match = blueMatch();
  assert.deepEqual(plain(selectors.ownNodes(match)), [0, 1, 2, 4]);
  assert.deepEqual(plain(selectors.interiorNodes(match)), [0]);
  assert.deepEqual(plain(selectors.borderNodes(match)), [1, 2, 4]);
});

test('the group policy view shows common values and mixed ranges', () => {
  const match = blueMatch({
    0: policy({ investPct: 40, investTarget: 150 }),
    1: policy({ investPct: 20, investTarget: 150, enabled: false }),
  });
  const view = plain(selectors.groupPolicyView(match, [0, 1, 2]));
  assert.deepEqual(view.investPct, { mixed: [20, 50] });
  assert.deepEqual(view.reserve, { value: 5 });
  assert.deepEqual(view.investTarget, { mixed: [null, 150] });
  assert.deepEqual(view.enabled, { mixed: [false, true] });
  assert.deepEqual(plain(selectors.groupPolicyView(match, [0])).investPct, { value: 40 });
});

test('a group edit changes only that field on every node and keeps destinations', () => {
  const match = blueMatch({
    0: policy({ investPct: 40, dest: 1 }),
    1: policy({ reserve: 9, dest: 4 }),
  });
  const { match: next, rejected } = commands.applyGroupPolicyField(match, [0, 1, 2], 'reserve', 3);
  assert.deepEqual(plain(rejected), []);
  assert.deepEqual(plain(next.policies[0]), plain(policy({ investPct: 40, dest: 1, reserve: 3 })));
  assert.deepEqual(plain(next.policies[1]), plain(policy({ reserve: 3, dest: 4 })));
  assert.deepEqual(plain(next.policies[2]), plain(policy({ reserve: 3 })));
});

test('a group edit that breaks one node applies nothing and names the nodes', () => {
  const match = blueMatch({ 1: policy({ defensePct: 30, defenseTarget: 40 }) });
  const result = commands.applyGroupPolicyField(match, [0, 1, 2], 'investPct', 80);
  assert.equal(result.match, match);
  assert.deepEqual(plain(result.rejected), [1]);
});

test('investing on each node reports the nodes that lacked energy', () => {
  const match = blueMatch();
  const { match: next, skipped } = commands.investOnEach(match, [0, 1, 4], 5);
  assert.deepEqual(plain(skipped), [4]);
  assert.deepEqual(plain(next.orders[0]), { invest: 5, withdraw: 0, edges: {} });
  assert.equal(next.orders[1].invest, 5);
  assert.equal(next.orders[4], undefined);
});

test('group actions clear destinations, reset pressure targets, pause and paste', () => {
  const match = blueMatch({
    0: policy({ dest: 1, pressureTarget: 3 }),
    1: policy({ dest: 0 }),
  });
  const cleared = commands.clearGroupDestinations(match, [0, 1]);
  assert.equal(cleared.policies[0].dest, null);
  assert.equal(cleared.policies[1].dest, null);
  assert.equal(commands.weakestPressureForGroup(match, [0, 1]).policies[0].pressureTarget, null);
  const paused = commands.pauseGroup(match, [0, 1]);
  assert.equal(paused.orders[0].hold, true);
  assert.equal(paused.orders[1].hold, true);
  const pasted = commands.pasteGroupPolicy(match, [0, 2], policy({ investPct: 33, dest: 1 }));
  assert.equal(pasted.policies[0].investPct, 33);
  assert.equal(pasted.policies[0].dest, 1);
  assert.equal(pasted.policies[2].dest, null);
});

test('group selection commands keep only own nodes and survive a round', () => {
  const store = GameStore.createStore();
  store.replaceMatch(blueMatch());
  store.setGroupMode(true);
  store.toggleGroupMember(1);
  store.toggleGroupMember(13);
  store.toggleGroupMember(2);
  store.toggleGroupMember(1);
  assert.deepEqual(plain(store.getSnapshot().ui.bulkSelection), [2]);
  store.setBulkSelection([0, 1, 13]);
  assert.deepEqual(plain(store.getSnapshot().ui.bulkSelection), [0, 1]);
  const match = store.getSnapshot().match;
  const nodes = match.state.nodes.map((n) => (n.id === 1 ? { ...n, owner: 1 } : n));
  store.replaceMatch({ ...match, state: { ...match.state, nodes } });
  store.resolve(() => 0.5);
  assert.deepEqual(plain(store.getSnapshot().ui.bulkSelection), [0]);
  assert.equal(store.getSnapshot().ui.groupMode, true);
  store.leaveGroupMode();
  assert.deepEqual(plain(store.getSnapshot().ui.bulkSelection), []);
  assert.equal(store.getSnapshot().ui.groupMode, false);
});
