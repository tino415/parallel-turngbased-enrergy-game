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
const policy = (fields) => ({ enabled: true, reserve: 0, investPct: 40, dest: null, ...fields });
const SOFT_CAP = 2;

function round({ nodes, policies, orders = {}, links = [[0, 1]], rulesVersion = SOFT_CAP }) {
  return engine.resolveRound({
    state: { round: 1, finished: false, rulesVersion, nodes: [...nodes, node(9, 1, 5)] },
    playerCount: 2,
    orders,
    policies,
    links,
    rng: () => 0.5,
    aiOrdersOverride: [],
    aiWithdrawalsOverride: {},
  });
}

const investOrder = (fields, overrides = {}) =>
  engine
    .evaluatePolicy({
      source: 0,
      node: node(0, 0, 30, 140),
      manualSpent: 0,
      manualHold: false,
      neighbors: [],
      owners: [0],
      policy: policy(fields),
      ...overrides,
    })
    .find((o) => o.type === 'invest');

test('the last step up lands exactly on the investment target', () => {
  assert.equal(investOrder({ investTarget: 150 }).amount, 10);
  assert.equal(investOrder({ investTarget: 200 }).amount, 12);
  assert.equal(investOrder({ investTarget: null }).amount, 12);
});

test('a node at or above its investment target invests nothing', () => {
  assert.equal(investOrder({ investTarget: 140 }), undefined);
  assert.equal(investOrder({ investTarget: 100 }), undefined);
});

test('a manual investment counts towards the target', () => {
  const overrides = { manualSpent: 6, manualInvest: 6 };
  assert.equal(investOrder({ investTarget: 150 }, overrides).amount, 4);
  assert.equal(
    investOrder({ investTarget: 150 }, { manualSpent: 10, manualInvest: 10 }),
    undefined,
  );
});

test('a manual withdrawal stops reinvestment towards the target that round', () => {
  assert.equal(investOrder({ investTarget: 150 }, { manualWithdraw: 5 }), undefined);
  assert.equal(investOrder({}, { manualWithdraw: 5 }).amount, 12);
});

test('surplus above the capped investment goes to the destination', () => {
  const orders = engine.evaluatePolicy({
    source: 0,
    node: node(0, 0, 30, 140),
    manualSpent: 0,
    manualHold: false,
    neighbors: [1],
    owners: [0, 0],
    policy: policy({ investTarget: 150, dest: 1 }),
  });
  assert.deepEqual(plain(orders.map((o) => [o.type, o.amount])), [
    ['invest', 10],
    ['transfer', 20],
  ]);
});

test('scaling down goes 150 → 120 → 100 at 20% per round, then stops', () => {
  const policies = { 0: policy({ investPct: 0, investTarget: 100, divestPct: 20 }) };
  let nodes = [node(0, 0, 10, 150)];
  const invested = [];
  for (let i = 0; i < 3; i++) {
    nodes = round({ nodes, policies, links: [] }).state.nodes.slice(0, 1);
    invested.push(nodes[0].invested);
  }
  assert.deepEqual(invested, [120, 100, 100]);
});

test('the scale-down withdrawal pays the withdrawal fee into active', () => {
  const policies = { 0: policy({ investPct: 0, investTarget: 100, divestPct: 20 }) };
  const after = round({ nodes: [node(0, 0, 10, 150)], policies, links: [] }).state.nodes[0];
  const income = 1 + 0.1 * 120;
  assert.ok(Math.abs(after.active - ((10 + 30 * 0.95) * 0.9 + income)) < 1e-9);
});

test('a manual withdrawal counts towards the scale-down step and is topped up', () => {
  const policies = { 0: policy({ investPct: 0, investTarget: 100, divestPct: 20 }) };
  const withManual = (withdraw) =>
    round({
      nodes: [node(0, 0, 10, 150)],
      policies,
      orders: { 0: { invest: 0, withdraw, edges: {} } },
      links: [],
    }).state.nodes[0].invested;
  assert.equal(withManual(10), 120);
  assert.equal(withManual(40), 110);
});

test('no scale-down under legacy rules, a paused policy or a disabled policy', () => {
  const scaled = { investPct: 0, investTarget: 100, divestPct: 20 };
  const investedAfter = (fields, orders = {}, rulesVersion = SOFT_CAP) =>
    round({
      nodes: [node(0, 0, 10, 150)],
      policies: { 0: policy({ ...scaled, ...fields }) },
      orders,
      links: [],
      rulesVersion,
    }).state.nodes[0].invested;
  assert.equal(investedAfter({}, {}, 1), 150);
  assert.equal(investedAfter({}, { 0: { invest: 0, withdraw: 0, edges: {}, hold: true } }), 150);
  assert.equal(investedAfter({ enabled: false }), 150);
  assert.equal(investedAfter({ divestPct: 0 }), 150);
});

test('scaled-down energy flows to the policy destination', () => {
  const policies = {
    0: policy({ investPct: 0, reserve: 10, investTarget: 100, divestPct: 20, dest: 1 }),
  };
  const result = round({ nodes: [node(0, 0, 10, 150), node(1, 0, 0)], policies });
  const income = 1;
  assert.ok(Math.abs(result.state.nodes[1].active - (30 * 0.95 * 0.9 + income)) < 1e-9);
});

test('an investment target refills what overflow decay trimmed', () => {
  const policies = { 0: policy({ investPct: 100, investTarget: 240 }) };
  const trimmed = round({ nodes: [node(0, 0, 60, 240)], policies, links: [] }).state.nodes[0];
  assert.ok(trimmed.invested < 240);
  const refill = investOrder({ investPct: 100, investTarget: 240 }, { node: trimmed });
  assert.ok(Math.abs(refill.amount - (240 - trimmed.invested)) < 1e-9);
});

function storeMatch(policies, orders = {}) {
  const match = GameStore.classicMatch(() => 0.5, { enabled: true, reserve: '5', invest: '70' });
  const nodes = match.state.nodes.map((n) =>
    n.id === 0 ? { ...n, active: 10, invested: 150 } : n,
  );
  return { ...match, state: { ...match.state, nodes }, policies, orders };
}

test('previews include the scale-down withdrawal in available energy and projection', () => {
  const match = storeMatch({
    0: policy({ investPct: 0, reserve: 0, investTarget: 100, divestPct: 20 }),
  });
  assert.equal(selectors.policyWithdrawal(match, 0), 30);
  assert.ok(Math.abs(selectors.availableEnergy(match, 0) - (10 + 30 * 0.95)) < 1e-9);
  const projected = selectors.projection(match, 0);
  assert.equal(projected.withdraw, 30);
  assert.equal(projected.nextInvested, 120);
});

test('the preview of a capped node invests only up to the target', () => {
  const match = storeMatch({ 0: policy({ investPct: 100, reserve: 0, investTarget: 155 }) });
  assert.deepEqual(plain(selectors.policyOrders(match, 0).map((o) => [o.type, o.amount])), [
    ['invest', 5],
  ]);
});

test('investment status reports progress towards the target', () => {
  const down = storeMatch({
    0: policy({ investPct: 0, reserve: 0, investTarget: 100, divestPct: 20 }),
  });
  assert.deepEqual(plainStatus(down), {
    invested: 150,
    target: 100,
    invest: 0,
    withdraw: 30,
    fee: 1.5,
    roundsToTarget: 2,
    blockedByManualWithdrawal: false,
  });
  const up = storeMatch({ 0: policy({ investPct: 100, reserve: 0, investTarget: 155 }) });
  assert.equal(plainStatus(up).invest, 5);
  assert.equal(plainStatus(up).roundsToTarget, 1);
  const blocked = storeMatch(
    { 0: policy({ investPct: 100, reserve: 0, investTarget: 200 }) },
    { 0: { invest: 0, withdraw: 5, edges: {} } },
  );
  assert.equal(plainStatus(blocked).blockedByManualWithdrawal, true);
  assert.equal(selectors.investmentStatus(storeMatch({ 0: policy({}) }), 0), null);
});

const plainStatus = (match) => plain(selectors.investmentStatus(match, 0));

test('investment target fields reject values outside their range', () => {
  const match = storeMatch({ 0: policy({}) });
  assert.equal(commands.changePolicy(match, 0, 'investTarget', -1), match);
  assert.equal(commands.changePolicy(match, 0, 'divestPct', 101), match);
  assert.equal(commands.changePolicy(match, 0, 'divestPct', Number.NaN), match);
  assert.equal(commands.changePolicy(match, 0, 'investTarget', 150).policies[0].investTarget, 150);
  assert.equal(
    commands.changePolicy(match, 0, 'investTarget', null).policies[0].investTarget,
    null,
  );
});

test('the default policy keeps its shape without the new fields', () => {
  assert.deepEqual(plain(Object.keys(selectors.defaultPolicy())), [
    'enabled',
    'reserve',
    'investPct',
    'dest',
  ]);
});
