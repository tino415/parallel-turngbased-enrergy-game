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
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, actual);
const node = (id, owner, active, invested = 0) => ({ id, owner, active, invested });
const policy = (pressure, fields = {}) => ({
  enabled: true,
  reserve: 10,
  investPct: 0,
  dest: null,
  pressure,
  ...fields,
});

// Node 0 is Blue; node 1 Blue, node 2 Red, node 3 Red, node 4 neutral.
const OWNERS = [0, 0, 1, 1, null];

function plan(pressure, { fields, ...overrides } = {}) {
  const result = engine.planPolicy({
    source: 0,
    node: node(0, 0, 30, 14),
    manualSpent: 0,
    manualHold: false,
    neighbors: [1, 2, 3, 4],
    owners: OWNERS,
    policy: policy(pressure, fields),
    ...overrides,
  });
  const attacks = Object.fromEntries(
    result.orders.filter((o) => o.type === 'attack').map((o) => [o.dest, o.amount]),
  );
  const transfer = result.orders.find((o) => o.type === 'transfer')?.amount ?? 0;
  return { next: result.next, attacks, transfer };
}

test('each pressured edge banks its own share until it reaches its minimum', () => {
  const first = plan({ 2: { pct: 10, min: 10 }, 3: { pct: 20, min: 50 } });
  assert.deepEqual(plain(first.attacks), {});
  close(first.next.pressure[2].bank, 2);
  close(first.next.pressure[3].bank, 4);
  assert.equal(first.next.pressure[2].pct, 10);
  assert.equal(first.next.pressure[3].min, 50);
});

test('an edge fires its whole bank at its minimum and resets only its own bank', () => {
  const fired = plan({ 2: { pct: 10, min: 10, bank: 9 }, 3: { pct: 10, min: 10, bank: 1 } });
  const surplus = 30 - 10 - 9 - 1;
  close(fired.attacks[2], 9 + surplus * 0.1);
  assert.equal(fired.attacks[3], undefined);
  assert.equal(fired.next.pressure[2].bank, 0);
  close(fired.next.pressure[3].bank, 1 + surplus * 0.1);
});

test('a node pressures several neighbours in the same round', () => {
  const both = plan({ 2: { pct: 10, min: 1 }, 3: { pct: 10, min: 1 } });
  close(both.attacks[2], 2);
  close(both.attacks[3], 2);
});

test('a neutral edge can be pressured when the player sets it', () => {
  close(plan({ 4: { pct: 10, min: 1 } }).attacks[4], 2);
});

test('banks shrink to the energy actually left on the node', () => {
  const after = plan(
    { 2: { pct: 10, min: 10, bank: 9 }, 3: { pct: 10, min: 10, bank: 5 } },
    { node: node(0, 0, 22, 14) },
  );
  assert.deepEqual(plain(after.attacks), {});
  close(after.next.pressure[2].bank + after.next.pressure[3].bank, 12);
});

test('an edge whose neighbour became Blue keeps its bank and leaves its share to the rest', () => {
  const idle = plan(
    { 2: { pct: 10, min: 10, bank: 5 } },
    { owners: [0, 0, 0, 1, null], fields: { dest: 1 } },
  );
  assert.deepEqual(plain(idle.attacks), {});
  close(idle.next.pressure[2].bank, 5);
  close(idle.transfer, 30 - 10 - 5);
});

test('edge shares count with investment and defense and scale together above 100%', () => {
  const scaled = plan(
    { 2: { pct: 30, min: 100 }, 3: { pct: 30, min: 100 } },
    { fields: { investPct: 60 } },
  );
  close(scaled.next.pressure[2].bank, 20 * (30 / 120));
});

test('pause and disable keep every bank unchanged', () => {
  const kept = policy({ 2: { pct: 10, min: 10, bank: 5 } });
  const args = {
    source: 0,
    node: node(0, 0, 30, 14),
    manualSpent: 0,
    neighbors: [1, 2, 3, 4],
    owners: OWNERS,
  };
  assert.equal(engine.planPolicy({ ...args, manualHold: true, policy: kept }).next, kept);
  const disabled = { ...kept, enabled: false };
  assert.equal(engine.planPolicy({ ...args, manualHold: false, policy: disabled }).next, disabled);
});

function round({ policies, orders = {}, nodes, links, defaultConquestPolicy = null }) {
  return engine.resolveRound({
    state: { round: 1, finished: false, rulesVersion: 2, nodes },
    playerCount: 2,
    orders,
    policies,
    links,
    rng: () => 0.5,
    aiOrdersOverride: [],
    aiWithdrawalsOverride: {},
    defaultConquestPolicy,
  });
}

const frontier = () => [node(0, 0, 30, 14), node(1, 1, 20), node(2, 1, 5)];
const frontierLinks = [
  [0, 1],
  [1, 2],
];

test('a pulse is one summary line, and the bank resets after it fires', () => {
  const result = round({
    policies: { 0: policy({ 1: { pct: 10, min: 10, bank: 9 } }) },
    nodes: frontier(),
    links: frontierLinks,
  });
  assert.equal(result.policies[0].pressure[1].bank, 0);
  assert.ok(
    result.events.some((line) => /Pressure: Node 0 → Node 1 \(10\.1, defended\)/.test(line)),
  );
  assert.ok(!result.events.some((line) => line.includes('Blue attacks Red')));
});

test('a pulse merges with a manual attack on the same edge', () => {
  const result = round({
    policies: { 0: policy({ 1: { pct: 10, min: 10, bank: 9.6 } }) },
    orders: { 0: { invest: 0, withdraw: 0, edges: { 1: 3 } } },
    nodes: frontier(),
    links: frontierLinks,
  });
  assert.ok(result.events.some((line) => line.includes('Blue attacks Red with 13.3')));
});

test('a pulse can capture and the conquest policy then applies', () => {
  const result = round({
    policies: { 0: policy({ 1: { pct: 10, min: 10, bank: 9 } }) },
    nodes: [node(0, 0, 30, 14), node(1, 1, 2), node(2, 1, 5)],
    links: frontierLinks,
    defaultConquestPolicy: { enabled: true, reserve: 3, investPct: 40 },
  });
  assert.equal(result.state.nodes[1].owner, 0);
  assert.equal(result.policies[1].reserve, 3);
  assert.ok(result.events.some((line) => line.includes('captured')));
});

function storeMatch(policies) {
  const match = GameStore.classicMatch(() => 0.5, { enabled: true, reserve: '5', invest: '70' });
  const nodes = match.state.nodes.map((n) =>
    n.id === 1 ? { ...n, owner: 1, active: 4 } : n.id === 0 ? { ...n, active: 30 } : n,
  );
  return { ...match, state: { ...match.state, nodes }, policies };
}

test('edge pressure status reports the bank, the minimum and this round’s pulse', () => {
  const banking = storeMatch({ 0: policy({ 1: { pct: 10, min: 10, bank: 3 } }) });
  assert.deepEqual(plain(selectors.edgePressureStatus(banking, 0, 1)), {
    pct: 10,
    bank: 3,
    nextBank: 4.7,
    minimum: 10,
    pulse: 0,
  });
  const pulsing = storeMatch({ 0: policy({ 1: { pct: 10, min: 10, bank: 9 } }) });
  assert.equal(selectors.edgePressureStatus(pulsing, 0, 1).pulse, 10.1);
  assert.equal(selectors.edgePressureStatus(pulsing, 0, 2), null);
});

test('setting edge pressure enables it with defaults and keeps the rest of the policy', () => {
  const match = storeMatch({ 0: { enabled: true, reserve: 4, investPct: 30, dest: null } });
  const on = commands.setEdgePressure(match, 0, 1, {}).policies[0];
  assert.deepEqual(plain(on), {
    enabled: true,
    reserve: 4,
    investPct: 30,
    dest: null,
    pressure: { 1: { pct: 10, min: 10 } },
  });
  const tuned = commands.setEdgePressure(match, 0, 1, { pct: 25, min: 6 });
  assert.deepEqual(plain(tuned.policies[0].pressure), { 1: { pct: 25, min: 6 } });
  const off = commands.setEdgePressure(tuned, 0, 1, null);
  assert.deepEqual(plain(off.policies[0].pressure), {});
});

test('edge pressure rejects own neighbours, bad values and shares above 100%', () => {
  const match = storeMatch({ 0: { enabled: true, reserve: 4, investPct: 85, dest: null } });
  const ownNeighbour = {
    ...match,
    state: {
      ...match.state,
      nodes: match.state.nodes.map((n) => (n.id === 2 ? { ...n, owner: 0 } : n)),
    },
  };
  assert.equal(commands.setEdgePressure(ownNeighbour, 0, 2, {}), ownNeighbour);
  assert.equal(commands.setEdgePressure(match, 0, 7, {}), match);
  assert.equal(commands.setEdgePressure(match, 0, 1, { pct: 20 }), match);
  assert.equal(commands.setEdgePressure(match, 0, 1, { pct: 10, min: 0 }), match);
  assert.equal(commands.setEdgePressure(match, 0, 1, { pct: 101 }), match);
  const fits = commands.setEdgePressure(match, 0, 1, { pct: 15 });
  assert.equal(fits.policies[0].pressure[1].pct, 15);
  assert.equal(commands.changePolicy(fits, 0, 'investPct', 90), fits);
});

test('pasting a policy keeps only edges the paste target borders and resets their banks', () => {
  const match = storeMatch({});
  const copied = policy({ 1: { pct: 10, min: 10, bank: 7 }, 9: { pct: 10, min: 10, bank: 2 } });
  assert.deepEqual(plain(commands.pastePolicy(match, 0, copied).policies[0].pressure), {
    1: { pct: 10, min: 10, bank: 0 },
  });
});
