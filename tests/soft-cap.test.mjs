import assert from 'node:assert/strict';
import test from 'node:test';
import { engine } from './support/simulation.mjs';
import { decayOverflow, fundWithdrawals, resolveSoftCapRound } from './support/soft-cap.mjs';

const close = (actual, expected) =>
  assert.ok(Math.abs(actual - expected) < 1e-8, actual + ' != ' + expected);

function fixture() {
  return {
    round: 1,
    finished: false,
    nodes: [
      { id: 0, owner: 0, active: 2, invested: 20 },
      { id: 1, owner: 0, active: 0, invested: 0 },
      { id: 2, owner: 1, active: 3, invested: 0 },
    ],
  };
}

test('withdrawals move principal into same-round active without creating energy', () => {
  const initial = fixture().nodes;
  const result = fundWithdrawals(initial, { 0: 10 }, 0.05);
  close(result.nodes[0].active, 11.5);
  close(result.nodes[0].invested, 10);
  close(result.withdrawn, 10);
  close(result.feeLoss, 0.5);
  close(initial[0].active, 2);
  close(initial[0].invested, 20);
  close(
    result.nodes[0].active + result.nodes[0].invested + result.feeLoss,
    initial[0].active + initial[0].invested,
  );
});

test('withdrawals reject overspending, neutral nodes and nonfinite amounts', () => {
  const nodes = fixture().nodes;
  assert.throws(() => fundWithdrawals(nodes, { 0: 21 }), /Invalid withdrawal/);
  assert.throws(() => fundWithdrawals(nodes, { 0: Infinity }), /Invalid withdrawal/);
  assert.throws(() => fundWithdrawals(nodes, { 0: -1 }), /Invalid withdrawal/);
  assert.throws(() => fundWithdrawals(nodes, { 99: 1 }), /Invalid withdrawal/);
  assert.throws(() => fundWithdrawals(nodes, { 0: 1 }, 1), /Withdrawal fee/);
  nodes[1].owner = null;
  assert.throws(() => fundWithdrawals(nodes, { 1: 0 }), /Invalid withdrawal/);
});

test('overflow applies to both active and invested, proportionately', () => {
  const nodes = [
    { id: 0, owner: 0, active: 120, invested: 80 },
    { id: 1, owner: null, active: 300, invested: 0 },
    { id: 2, owner: 1, active: 5, invested: 5 },
  ];
  const result = decayOverflow(nodes, 100, 0.25);
  close(result.totalLoss, 25);
  close(result.nodes[0].active, 105);
  close(result.nodes[0].invested, 70);
  close(result.nodes[1].active, 300); // Neutral defenders are exempt.
  close(result.nodes[2].active, 5);
  close(result.losses[0], 25);
  close(nodes[0].active, 120); // No input mutation.
});

test('locked invested principal cannot evade overflow, and parameters are validated', () => {
  const nodes = [{ id: 0, owner: 0, active: 0, invested: 200 }];
  const result = decayOverflow(nodes, 100, 0.25);
  close(result.nodes[0].invested, 175);
  assert.throws(() => decayOverflow(nodes, 0, 0.25), /Capacity/);
  assert.throws(() => decayOverflow(nodes, 100, 1.1), /Overflow decay/);
});

test('a withdrawal can fund an immediate attack, but an incoming transfer cannot', () => {
  const before = fixture();
  const result = resolveSoftCapRound({
    engine,
    state: before,
    withdrawals: { 0: 15 },
    capacity: 100,
    overflowDecay: 0.25,
    withdrawalFee: 0,
    orders: {
      0: { invest: 0, edges: { 1: 12 } },
      1: { invest: 0, edges: { 2: 3 } },
    },
    policies: {},
    links: [
      [0, 1],
      [1, 2],
    ],
    rng: () => 0.5,
    aiOrdersOverride: [],
  });
  close(result.economy.withdrawn, 15);
  close(result.state.nodes[0].invested, 5);
  close(result.state.nodes[1].active, 11.8);
  assert.equal(result.state.nodes[2].owner, 1, 'same-turn forwarded transfer was rejected');
  assert.equal(before.nodes[0].invested, 20);
  const attack = resolveSoftCapRound({
    engine,
    state: {
      round: 1,
      finished: false,
      nodes: [
        { id: 0, owner: 0, active: 2, invested: 20 },
        { id: 1, owner: 1, active: 3, invested: 0 },
      ],
    },
    withdrawals: { 0: 12 },
    capacity: 100,
    overflowDecay: 0.25,
    withdrawalFee: 0,
    orders: { 0: { invest: 0, edges: { 1: 10 } } },
    policies: {},
    links: [[0, 1]],
    rng: () => 0.5,
    aiOrdersOverride: [],
  });
  assert.equal(attack.state.nodes[1].owner, 0, 'reserve was usable in the attack phase');
});

test('normal active decay and income precede end-round overflow loss', () => {
  const result = resolveSoftCapRound({
    engine,
    state: {
      round: 1,
      finished: false,
      nodes: [
        { id: 0, owner: 0, active: 0, invested: 200 },
        { id: 1, owner: 1, active: 2, invested: 0 },
      ],
    },
    capacity: 100,
    overflowDecay: 0.25,
    orders: {},
    policies: {},
    links: [[0, 1]],
    aiOrdersOverride: [],
  });
  close(result.economy.overflowLoss, (221 - 100) * 0.25);
  close(result.state.nodes[0].active + result.state.nodes[0].invested, 221 - (221 - 100) * 0.25);
  assert.ok(result.state.nodes[0].invested < 200);
});

test('no-op adapter at zero loss matches the unmodified production engine exactly', () => {
  const state = fixture();
  const params = {
    state,
    orders: { 0: { invest: 1, edges: {} } },
    policies: {},
    links: [
      [0, 1],
      [1, 2],
    ],
    rng: () => 0.5,
    aiOrdersOverride: [],
  };
  const normal = engine.resolveRound(params);
  const experimental = resolveSoftCapRound({
    engine,
    ...params,
    capacity: 1e9,
    overflowDecay: 0,
  });
  assert.equal(JSON.stringify(experimental.state), JSON.stringify(normal.state));
  assert.equal(JSON.stringify(experimental.events), JSON.stringify(normal.events));
  close(experimental.economy.overflowLoss, 0);
});
