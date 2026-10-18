import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const engine = runInNewContext(
  readFileSync(new URL('../src/engine.js', import.meta.url), 'utf8') + '\n;GameEngine',
);
const node = (id, owner, active, invested = 0) => ({ id, owner, active, invested });
const near = (actual, expected) =>
  assert.ok(Math.abs(actual - expected) < 1e-8, actual + ' != ' + expected);
const params = (nodes, orders = {}, extra = {}) => ({
  state: { round: 1, nodes, finished: false, rulesVersion: 2 },
  playerCount: 2,
  orders,
  policies: {},
  links: [
    [0, 1],
    [1, 2],
  ],
  aiOrdersOverride: [],
  rng: () => 0.5,
  ...extra,
});

test('new rules use total active plus invested soft cap, never hard clamp', () => {
  const rules = engine.SOFT_CAP_RULES;
  assert.equal(rules.capacity, 250);
  const n = node(0, 0, 120, 180);
  const before = n.active + n.invested;
  const afterProduction = 120 * 0.9 + 1 + 18 + 180;
  const loss = (afterProduction - 250) * 0.25;
  const result = engine.resolveRound(params([n, node(1, 1, 3), node(2, null, 3)]));
  near(result.state.nodes[0].active + result.state.nodes[0].invested, afterProduction - loss);
  assert.ok(result.state.nodes[0].invested < 180, 'invested principal must lose overflow');
  assert.ok(result.state.nodes[0].active + result.state.nodes[0].invested > 250);
  assert.equal(n.active + n.invested, before, 'input must be immutable');
});

test('withdrawal is spendable now, deducts 5 percent, retains valid defense', () => {
  const order = { 0: { withdraw: 100, invest: 0, edges: { 1: 60 } } };
  const result = engine.resolveRound(
    params([node(0, 0, 2, 120), node(1, 1, 4), node(2, null, 4)], order),
  );
  assert.equal(result.state.nodes[1].owner, 0);
  near(result.state.nodes[0].invested, 20);
  near(result.state.nodes[0].active, (2 + 95 - 60) * 0.9 + 1 + 2);
  // Source active + invested + fee before transfer is exactly conserved.
  assert.equal(engine.SOFT_CAP_RULES.withdrawalFee, 0.05);
});

test('withdrawal cannot use non-owned capital, more than invested, or nonfinite amounts', () => {
  for (const amount of [1000, -1, Infinity, NaN]) {
    const r = engine.resolveRound(
      params([node(0, 0, 1, 40), node(1, 1, 4), node(2, null, 4)], {
        0: { withdraw: amount, invest: 0, edges: { 1: 30 } },
      }),
    );
    assert.equal(r.state.nodes[1].owner, 1);
    near(r.state.nodes[0].invested, 40);
  }
  const r = engine.resolveRound(
    params([node(0, 0, 1, 40), node(1, 1, 4, 100), node(2, null, 4)], {
      1: { withdraw: 60, invest: 0, edges: {} },
    }),
  );
  near(r.state.nodes[1].invested, 100); // Blue cannot withdraw Red principal.
});

test('a same-turn friendly incoming transfer cannot fund a second-hop attack', () => {
  const r = engine.resolveRound(
    params([node(0, 0, 40, 0), node(1, 0, 1, 0), node(2, 1, 10)], {
      0: { invest: 0, edges: { 1: 35 } },
      1: { invest: 0, edges: { 2: 20 } },
    }),
  );
  assert.equal(r.state.nodes[2].owner, 1);
  near(r.state.nodes[1].active, (1 + 35) * 0.9 + 1);
});

test('neutral nodes are exempt from overflow until captured', () => {
  const r = engine.resolveRound(params([node(0, 0, 3), node(1, 1, 3), node(2, null, 400)]));
  near(r.state.nodes[2].active, 361);
});

test('legacy saves retain original economy and original AI', () => {
  const nodes = [node(0, 0, 120, 180), node(1, 1, 3), node(2, null, 3)];
  const legacy = engine.resolveRound(
    params(
      nodes,
      {},
      {
        state: { round: 1, nodes, finished: false },
      },
    ),
  );
  near(legacy.state.nodes[0].invested, 180);
  near(legacy.state.nodes[0].active, 120 * 0.9 + 1 + 18);
  const originalAI = engine.aiOrders(
    nodes,
    [
      [0, 1],
      [1, 2],
    ],
    true,
  );
  assert.ok(originalAI[0]);
});

test('AI plans legal combined spending and withdrawal, including defensive reserve', () => {
  const links = [
    [0, 1],
    [1, 2],
  ];
  const nodes = [node(0, 0, 1, 150), node(1, 1, 20, 100), node(2, null, 4)];
  const planned = engine.economicAI(nodes, links, true);
  for (const [rawId, choices] of Object.entries(planned.orders)) {
    const id = Number(rawId);
    const spent = (Array.isArray(choices) ? choices : [choices]).reduce(
      (sum, action) => sum + action.amount,
      0,
    );
    const withdrawal = planned.withdrawals[id] ?? 0;
    assert.ok(withdrawal >= 0 && withdrawal <= nodes[id].invested);
    assert.ok(spent <= nodes[id].active + withdrawal * 0.95 + 1e-8);
  }
  assert.ok((planned.withdrawals[0] ?? 0) > 0, 'defender must mobilize reserves');
  const result = engine.resolveRound({
    ...params(nodes),
    aiOrdersOverride: null,
  });
  for (const n of result.state.nodes)
    for (const key of ['active', 'invested']) assert.ok(Number.isFinite(n[key]) && n[key] >= 0);
});

test('forecast uses same economic order as round resolution without combat', () => {
  const n = node(0, 0, 110, 180);
  const outgoing = [{ type: 'invest', amount: 10 }];
  const preview = engine.forecast(n, 0, outgoing, { softCap: true, withdraw: 20 });
  const r = engine.resolveRound(
    params([n, node(1, 1, 3), node(2, null, 3)], { 0: { invest: 10, withdraw: 20, edges: {} } }),
  );
  near(preview.next, r.state.nodes[0].active);
  near(preview.nextInvested, r.state.nodes[0].invested);
  near(preview.total, r.state.nodes[0].active + r.state.nodes[0].invested);
});

test('AI attacks an idle human at roughly equal frontier strength', () => {
  const nodes = [node(0, 0, 80, 60), node(1, 1, 80, 60)];
  const links = [[0, 1]];
  const plan = engine.economicAI(nodes, links);
  assert.equal(plan.orders[0], undefined, 'live Blue remains player-controlled');
  const attack = plan.orders[1];
  assert.equal(attack.type, 'attack');
  assert.equal(attack.dest, 0);
  assert.ok(attack.amount >= 80, 'an attack should threaten a comparably strong node');
  assert.ok(plan.withdrawals[1] > 0, 'AI must mobilize principal to fund attack');
  assert.ok(attack.amount <= 80 + plan.withdrawals[1] * 0.95);
  const result = engine.resolveRound({
    ...params(nodes, {}, { links }),
    aiOrdersOverride: null,
  });
  assert.ok(result.events.some((event) => event.includes('Red attacks Blue')));
  near(nodes[0].active, 80);
  near(nodes[1].invested, 60);
});

test('AI coordinates adjacent allies against one strong defended node', () => {
  const nodes = [node(0, 1, 30, 20), node(1, 0, 60, 10), node(2, 1, 30, 20)];
  const links = [
    [0, 1],
    [2, 1],
  ];
  const plan = engine.economicAI(nodes, links);
  const attacks = Object.values(plan.orders)
    .flat()
    .filter((o) => o.type === 'attack');
  assert.equal(attacks.length, 2, 'both neighboring attackers must cooperate');
  assert.ok(attacks.every((o) => o.dest === 1));
  assert.ok(attacks.reduce((sum, o) => sum + o.amount, 0) >= 78);
  const result = engine.resolveRound({
    ...params(nodes, {}, { links }),
    aiOrdersOverride: null,
  });
  assert.equal(result.state.nodes[1].owner, 1, 'combined assault should capture the target');
  assert.ok(result.events.some((event) => event.includes('Red attacks Blue')));
});

test('AI avoids impossible spending and leaves garrisons for every attacking source', () => {
  const nodes = [
    node(0, 1, 1, 90),
    node(1, 0, 65, 200),
    node(2, 1, 4, 40),
    node(3, 2, 90, 180),
    node(4, null, 4),
  ];
  const links = [
    [0, 1],
    [2, 1],
    [3, 2],
    [0, 4],
    [2, 4],
    [3, 4],
  ];
  const plan = engine.economicAI(nodes, links, true);
  for (const n of nodes.filter((n) => n.owner !== null)) {
    const actions = Object.values(plan.orders[n.id] ?? []).flat();
    const spent = actions.reduce((sum, o) => sum + o.amount, 0);
    const withdraw = plan.withdrawals[n.id] ?? 0;
    assert.ok(Number.isFinite(spent) && Number.isFinite(withdraw));
    assert.ok(withdraw >= 0 && withdraw <= n.invested + 1e-8);
    assert.ok(
      spent <= n.active + withdraw * 0.95 + 1e-8,
      'orders must fit initial energy plus withdrawals',
    );
    assert.ok(n.active + withdraw * 0.95 - spent >= -1e-8);
  }
});

test('AI attacks a strong opponent even when no safe immediate conquest exists', () => {
  const nodes = [node(0, 0, 120, 90), node(1, 1, 55, 40)];
  const plan = engine.economicAI(nodes, [[0, 1]]);
  assert.equal(plan.orders[1].type, 'attack');
  assert.ok(plan.orders[1].amount > 15, 'siege pressure should not be zero');
});
