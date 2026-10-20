import test from 'node:test';
import assert from 'node:assert/strict';
import '../src/engine.js';

const { resolveRound, aiPlan } = globalThis.GameEngine;
const node = (id, owner, active, invested = 0) => ({ id, owner, active, invested });
const policy = (investPct) => ({ enabled: true, reserve: 5, investPct, dest: null });
const middle = () => 0.5;
const line = [
  [0, 1],
  [1, 2],
  [2, 3],
];
const fourNodes = () => ({
  round: 1,
  finished: false,
  nodes: [node(0, 0, 30), node(1, 1, 30), node(2, 2, 30), node(3, null, 30)],
});
const resolveFor = (humans, extra = {}) =>
  resolveRound({
    state: fourNodes(),
    playerCount: 3,
    seat: humans,
    orders: {},
    policies: {},
    links: line,
    rng: middle,
    aiOrdersOverride: [],
    ...extra,
  });

test('the AI plans for no human seat', () => {
  const planners = new Set(aiPlan(fourNodes(), line, [0, 1]).orders.map((order) => order.source));
  assert.ok(planners.has(2));
  assert.ok(!planners.has(0) && !planners.has(1));
});

test('each human seat orders its own nodes, and a transfer means the same owner as the source', () => {
  const state = fourNodes();
  state.nodes[2].owner = 1;
  const result = resolveRound({
    state,
    playerCount: 3,
    seat: [0, 1],
    orders: { 1: { invest: 0, edges: { 2: 10 } }, 2: { invest: 0, edges: { 1: 4 } } },
    policies: {},
    links: line,
    rng: middle,
    aiOrdersOverride: [],
  });
  assert.deepEqual(
    result.moves.map(({ source, dest, type, owner }) => ({ source, dest, type, owner })),
    [
      { source: 1, dest: 2, type: 'transfer', owner: 1 },
      { source: 2, dest: 1, type: 'transfer', owner: 1 },
    ],
  );
});

test('policies run for every human seat and for no one else', () => {
  const result = resolveFor([0, 1], { policies: { 0: policy(50), 1: policy(50), 2: policy(50) } });
  assert.deepEqual(Object.keys(result.policies).sort(), ['0', '1']);
  assert.ok(result.state.nodes[0].invested > 0 && result.state.nodes[1].invested > 0);
});

const capturedByZero = (conquestPolicies) => {
  const state = fourNodes();
  state.nodes[1] = node(1, 1, 2);
  return resolveRound({
    state,
    playerCount: 3,
    seat: [0, 1],
    orders: { 0: { invest: 0, edges: { 1: 25 } } },
    policies: { 1: policy(50) },
    links: line,
    conquestPolicies,
    rng: middle,
    aiOrdersOverride: [],
  });
};

test('a policy is dropped when its node changes owner', () => {
  const result = capturedByZero({});
  assert.equal(result.state.nodes[1].owner, 0);
  assert.equal(result.policies[1], undefined);
});

test('the new owner conquest default replaces the dropped policy', () => {
  const result = capturedByZero({ 0: { enabled: true, reserve: 8, investPct: 30 } });
  assert.deepEqual(result.policies[1], { enabled: true, reserve: 8, investPct: 30, dest: null });
});

test('a single seat as a number keeps working', () => {
  const result = resolveFor(0, { policies: { 0: policy(50), 1: policy(50) } });
  assert.deepEqual(Object.keys(result.policies), ['0']);
});
