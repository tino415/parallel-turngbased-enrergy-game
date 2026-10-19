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
const policy = (fields) => ({
  enabled: true,
  reserve: 10,
  investPct: 0,
  dest: null,
  pressurePct: 10,
  pressureMin: 10,
  ...fields,
});

// Node 0 is Blue; node 1 Blue, node 2 Red (active 8), node 3 Red (active 5), node 4 neutral (active 1).
const OWNERS = [0, 0, 1, 1, null];
const ACTIVES = [30, 0, 8, 5, 1];

function plan(fields, overrides = {}) {
  const result = engine.planPolicy({
    source: 0,
    node: node(0, 0, 30, 14),
    manualSpent: 0,
    manualHold: false,
    neighbors: [1, 2, 3, 4],
    owners: OWNERS,
    actives: ACTIVES,
    policy: policy(fields),
    ...overrides,
  });
  const order = (type) => result.orders.find((o) => o.type === type);
  return { next: result.next, attack: order('attack'), transfer: order('transfer') };
}

test('the automatic target is the weakest eligible neighbour, ties to the lowest id', () => {
  assert.equal(plan({ pressureBank: 9 }).attack.dest, 3);
  assert.equal(plan({ pressureBank: 9, pressureNeutral: true }).attack.dest, 4);
  assert.equal(plan({ pressureBank: 9 }, { actives: [30, 0, 5, 5, 1] }).attack.dest, 2);
});

test('a pinned target is used while eligible and falls back to automatic otherwise', () => {
  assert.equal(plan({ pressureBank: 9, pressureTarget: 2 }).attack.dest, 2);
  assert.equal(plan({ pressureBank: 9, pressureTarget: 1 }).attack.dest, 3);
  assert.equal(plan({ pressureBank: 9, pressureTarget: 4 }).attack.dest, 3);
});

test('the pressure share is banked until it reaches the minimum', () => {
  const first = plan({});
  assert.equal(first.attack, undefined);
  close(first.next.pressureBank, 2);
  const fired = plan({ pressureBank: 9 });
  close(fired.attack.amount, 9 + (30 - 10 - 9) * 0.1);
  assert.equal(fired.next.pressureBank, 0);
});

test('the bank shrinks to the energy actually left on the node', () => {
  const after = plan({ pressureBank: 9 }, { node: node(0, 0, 12, 14) });
  assert.equal(after.attack, undefined);
  close(after.next.pressureBank, 2);
});

test('without an eligible target the bank is kept and the share goes to the rest', () => {
  const owners = [0, 0, 0, 0, null];
  const idle = plan({ pressureBank: 5, dest: 1 }, { owners });
  assert.equal(idle.attack, undefined);
  close(idle.next.pressureBank, 5);
  close(idle.transfer.amount, 30 - 10 - 5);
});

test('turning pressure off releases the bank into the surplus', () => {
  const off = plan({ pressurePct: 0, pressureBank: 5, dest: 1 });
  assert.equal(off.attack, undefined);
  assert.equal(off.next.pressureBank, 0);
  close(off.transfer.amount, 20);
});

test('pause and disable keep the bank unchanged', () => {
  const kept = policy({ pressureBank: 5 });
  const args = {
    source: 0,
    node: node(0, 0, 30, 14),
    manualSpent: 0,
    neighbors: [1, 2, 3, 4],
    owners: OWNERS,
    actives: ACTIVES,
  };
  assert.equal(engine.planPolicy({ ...args, manualHold: true, policy: kept }).next, kept);
  const disabled = { ...kept, enabled: false };
  assert.equal(engine.planPolicy({ ...args, manualHold: false, policy: disabled }).next, disabled);
});

test('investment, defense and pressure shares are scaled together above 100%', () => {
  const scaled = plan({ investPct: 60, pressurePct: 60, pressureMin: 100 });
  close(scaled.next.pressureBank, 10);
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
    policies: { 0: policy({ pressureBank: 9, pressureTarget: 1 }) },
    nodes: frontier(),
    links: frontierLinks,
  });
  assert.equal(result.policies[0].pressureBank, 0);
  assert.ok(
    result.events.some((line) => /Pressure: Node 0 → Node 1 \(10\.1, defended\)/.test(line)),
  );
  assert.ok(!result.events.some((line) => line.includes('Blue attacks Red')));
});

test('a pulse merges with a manual attack on the same target', () => {
  const result = round({
    policies: { 0: policy({ pressureBank: 9.6, pressureTarget: 1 }) },
    orders: { 0: { invest: 0, withdraw: 0, edges: { 1: 3 } } },
    nodes: frontier(),
    links: frontierLinks,
  });
  assert.ok(result.events.some((line) => line.includes('Blue attacks Red with 13.3')));
});

test('a pulse can capture and the conquest policy then applies', () => {
  const result = round({
    policies: { 0: policy({ pressureBank: 9, pressureTarget: 1 }) },
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

test('pressure status reports the bank, the minimum and the next target', () => {
  const status = plain(
    selectors.pressureStatus(storeMatch({ 0: policy({ investPct: 0, pressureBank: 3 }) }), 0),
  );
  assert.deepEqual(status, { bank: 3, nextBank: 4.7, minimum: 10, target: 1, pulse: 0 });
  const pulsing = plain(
    selectors.pressureStatus(storeMatch({ 0: policy({ investPct: 0, pressureBank: 9 }) }), 0),
  );
  assert.equal(pulsing.pulse, 10.1);
  assert.equal(
    selectors.pressureStatus(storeMatch({ 0: { ...policy({}), pressurePct: 0 } }), 0),
    null,
  );
});

test('pasting a policy resets the bank and keeps only an eligible pinned target', () => {
  const match = storeMatch({});
  const copied = policy({ pressureBank: 7, pressureTarget: 1 });
  const pasted = commands.pastePolicy(match, 0, copied).policies[0];
  assert.equal(pasted.pressureBank, 0);
  assert.equal(pasted.pressureTarget, 1);
  assert.equal(
    commands.pastePolicy(match, 0, { ...copied, pressureTarget: 5 }).policies[0].pressureTarget,
    null,
  );
});

test('pressure from an edge pins the target and enables pressure with defaults', () => {
  const match = storeMatch({ 0: { enabled: true, reserve: 4, investPct: 30, dest: null } });
  const on = commands.pressureFrom(match, 0, 1, true).policies[0];
  assert.deepEqual(plain(on), {
    enabled: true,
    reserve: 4,
    investPct: 30,
    dest: null,
    pressureTarget: 1,
    pressurePct: 10,
    pressureMin: 10,
  });
  const off = commands.pressureFrom(commands.pressureFrom(match, 0, 1, true), 0, 1, false);
  assert.equal(off.policies[0].pressurePct, 0);
  assert.equal(off.policies[0].pressureTarget, null);
  assert.equal(commands.pressureFrom(match, 0, 2, true), match);
});

test('pressure fields reject values outside their range and shares above 100%', () => {
  const match = storeMatch({ 0: { enabled: true, reserve: 4, investPct: 95, dest: null } });
  assert.equal(commands.changePolicy(match, 0, 'pressurePct', 10), match);
  assert.equal(commands.changePolicy(match, 0, 'pressureMin', 0), match);
  assert.equal(commands.changePolicy(match, 0, 'pressureTarget', 7), match);
  assert.equal(commands.changePolicy(match, 0, 'pressurePct', 5).policies[0].pressurePct, 5);
});
