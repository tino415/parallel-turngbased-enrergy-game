import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const context = createContext({});
runInContext(read('../src/engine.js'), context);
runInContext(read('../src/store.js'), context);
const { GameEngine: engine, GameStore } = context;
const { selectors, commands } = GameStore;

const plain = (value) => JSON.parse(JSON.stringify(value));
const node = (id, owner, active, invested = 0) => ({ id, owner, active, invested });
const policy = (fields) => ({ enabled: true, reserve: 10, investPct: 0, dest: null, ...fields });
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, actual);

function plan(fields, { active = 30, dest = false, ...overrides } = {}) {
  const result = engine.planPolicy({
    source: 0,
    node: node(0, 0, active, 14),
    manualSpent: 0,
    manualHold: false,
    neighbors: [1],
    owners: [0, 0],
    policy: policy({ ...fields, dest: dest ? 1 : null }),
    ...overrides,
  });
  const amount = (type) => result.orders.find((o) => o.type === type)?.amount ?? 0;
  return { next: result.next, invest: amount('invest'), transfer: amount('transfer') };
}

test('the defense floor grows by its share of surplus and keeps it on the node', () => {
  const grown = plan({ defensePct: 20, defenseTarget: 50 }, { dest: true });
  close(grown.next.reserve, 14);
  close(grown.transfer, 16);
});

test('the last growth step lands exactly on the defense target', () => {
  close(plan({ reserve: 48, defensePct: 20, defenseTarget: 50 }, { active: 70 }).next.reserve, 50);
});

test('a floor above its target shrinks at the rate and releases the energy that round', () => {
  const released = plan(
    { reserve: 60, defensePct: 20, defenseTarget: 50 },
    { active: 70, dest: true },
  );
  close(released.next.reserve, 50);
  close(released.transfer, 20);
  close(plan({ reserve: 80, defensePct: 20, defenseTarget: 50 }).next.reserve, 64);
});

test('a node below its floor neither grows nor shrinks the floor', () => {
  close(plan({ defensePct: 20, defenseTarget: 50 }, { active: 5 }).next.reserve, 10);
});

test('investment and defense are parallel shares of the same surplus', () => {
  const shares = plan({ investPct: 40, defensePct: 20, defenseTarget: 50 }, { dest: true });
  close(shares.invest, 8);
  close(shares.next.reserve, 14);
  close(shares.transfer, 8);
});

test('shares above 100% are scaled down proportionally', () => {
  const scaled = plan({ investPct: 90, defensePct: 30, defenseTarget: 50 });
  close(scaled.invest, 15);
  close(scaled.next.reserve, 15);
});

test('a reached defense target leaves its share to the rest', () => {
  const reached = plan(
    { reserve: 50, investPct: 40, defensePct: 20, defenseTarget: 50 },
    { active: 70, dest: true },
  );
  close(reached.invest, 8);
  close(reached.transfer, 12);
  close(reached.next.reserve, 50);
});

test('a policy without a defense target is returned unchanged', () => {
  const fixed = policy({ investPct: 40, dest: 1 });
  const args = {
    source: 0,
    node: node(0, 0, 30, 14),
    manualSpent: 0,
    manualHold: false,
    neighbors: [1],
    owners: [0, 0],
    policy: fixed,
  };
  const result = engine.planPolicy(args);
  assert.equal(result.next, fixed);
  assert.deepEqual(plain(result.orders), plain(engine.evaluatePolicy(args)));
});

function round(policies, orders = {}, nodes = [node(0, 0, 30, 14)]) {
  return engine.resolveRound({
    state: { round: 1, finished: false, rulesVersion: 2, nodes: [...nodes, node(9, 1, 5)] },
    playerCount: 2,
    orders,
    policies,
    links: [],
    rng: () => 0.5,
    aiOrdersOverride: [],
    aiWithdrawalsOverride: {},
  });
}

test('a resolved round stores the advanced defense floor', () => {
  const growing = { 0: policy({ defensePct: 20, defenseTarget: 50 }) };
  close(round(growing).policies[0].reserve, 14);
  const paused = round(growing, { 0: { invest: 0, withdraw: 0, edges: {}, hold: true } });
  close(paused.policies[0].reserve, 10);
  const disabled = round({ 0: policy({ enabled: false, defensePct: 20, defenseTarget: 50 }) });
  close(disabled.policies[0].reserve, 10);
});

test('an unreachable defense target stalls without oscillating', () => {
  let policies = { 0: policy({ reserve: 5, defensePct: 100, defenseTarget: 100 }) };
  let nodes = [node(0, 0, 24, 14)];
  const floors = [];
  for (let i = 0; i < 40; i++) {
    const result = round(policies, {}, nodes);
    policies = result.policies;
    nodes = result.state.nodes.slice(0, 1);
    floors.push(policies[0].reserve);
  }
  for (let i = 1; i < floors.length; i++) assert.ok(floors[i] >= floors[i - 1] - 1e-9);
  assert.ok(floors.at(-1) < 25);
});

function storeMatch(policies) {
  const match = GameStore.classicMatch(() => 0.5, { enabled: true, reserve: '5', invest: '70' });
  const nodes = match.state.nodes.map((n) => (n.id === 0 ? { ...n, active: 30, invested: 14 } : n));
  return { ...match, state: { ...match.state, nodes }, policies };
}

test('defense status reports the floor, its next value and the sustainable level', () => {
  const match = storeMatch({ 0: policy({ investPct: 0, defensePct: 20, defenseTarget: 50 }) });
  const status = plain(selectors.defenseStatus(match, 0));
  assert.equal(status.floor, 10);
  close(status.next, 14);
  assert.equal(status.target, 50);
  close(status.sustainable, 10 * (1 + 0.1 * 14));
  assert.equal(selectors.defenseStatus(storeMatch({ 0: policy({}) }), 0), null);
});

test('defense fields reject values outside their range and shares above 100%', () => {
  const match = storeMatch({ 0: policy({ investPct: 60 }) });
  assert.equal(commands.changePolicy(match, 0, 'defenseTarget', -1), match);
  assert.equal(commands.changePolicy(match, 0, 'defensePct', 101), match);
  assert.equal(commands.changePolicy(match, 0, 'defensePct', 50), match);
  const accepted = commands.changePolicy(match, 0, 'defensePct', 40);
  assert.equal(accepted.policies[0].defensePct, 40);
  assert.equal(commands.changePolicy(accepted, 0, 'investPct', 70), accepted);
});

test('the store reports a rejected policy change', () => {
  const store = GameStore.createStore();
  store.replaceMatch(storeMatch({ 0: policy({ investPct: 60 }) }));
  assert.equal(store.changePolicy(0, 'defensePct', 50), false);
  assert.equal(store.changePolicy(0, 'defensePct', 30), true);
});
