import assert from 'node:assert/strict';
import test from 'node:test';
import { engine } from './support/simulation.mjs';
import { planEquilibriumAI, RESERVE_VALUATION } from './support/equilibrium-ai.mjs';
import {
  equilibriumRules,
  LIVE_ECONOMY,
  resolveEquilibriumRound,
  totalEnergy,
} from './support/equilibrium.mjs';
import { playEquilibriumMatch } from './support/equilibrium-match.mjs';

const seeds = ['eq-a', 'eq-b', 'eq-c'];

test('the research AI plans what the live economic AI plans', () => {
  for (const seed of seeds) {
    const map = engine.buildMap({ count: 20, players: 2, density: 'normal', seed });
    const rng = engine.seeded(seed);
    let state = { round: 1, finished: false, nodes: map.nodes, rulesVersion: 2 };
    while (!state.finished && state.round <= 80) {
      const live = engine.economicAI(state.nodes, map.links, true);
      const copy = planEquilibriumAI({
        engine,
        nodes: state.nodes,
        reserves: state.nodes.map(() => 0),
        links: map.links,
      });
      assert.deepEqual(JSON.parse(JSON.stringify(copy)), JSON.parse(JSON.stringify(live)));
      state = engine.resolveRound({
        state,
        playerCount: 2,
        links: map.links,
        orders: {},
        policies: {},
        aiOrdersOverride: Object.values(live.orders).flat(),
        aiWithdrawalsOverride: live.withdrawals,
        seat: -1,
        rng,
      }).state;
    }
  }
});

test('the live economy through the adapter matches the live engine round for round', () => {
  for (const seed of seeds) {
    const map = engine.buildMap({ count: 20, players: 2, density: 'normal', seed });
    const liveRng = engine.seeded(seed);
    const adapterRng = engine.seeded(seed);
    let live = { round: 1, finished: false, nodes: map.nodes, rulesVersion: 2 };
    let adapted = { round: 1, finished: false, nodes: map.nodes };
    let reserves = map.nodes.map(() => 0);
    while (!live.finished && live.round <= 120) {
      const plan = engine.economicAI(live.nodes, map.links, true);
      const orders = Object.values(plan.orders).flat();
      live = engine.resolveRound({
        state: live,
        playerCount: 2,
        links: map.links,
        orders: {},
        policies: {},
        aiOrdersOverride: orders,
        aiWithdrawalsOverride: plan.withdrawals,
        seat: -1,
        rng: liveRng,
      }).state;
      const result = resolveEquilibriumRound({
        engine,
        state: adapted,
        reserves,
        links: map.links,
        rules: LIVE_ECONOMY,
        orders,
        withdrawals: plan.withdrawals,
        playerCount: 2,
        rng: adapterRng,
      });
      adapted = result.state;
      reserves = result.reserves;
      for (const [id, node] of live.nodes.entries()) {
        assert.equal(adapted.nodes[id].owner, node.owner);
        assert.ok(Math.abs(adapted.nodes[id].active - node.active) < 1e-9);
        assert.ok(Math.abs(adapted.nodes[id].invested - node.invested) < 1e-9);
      }
    }
  }
});

for (const lossDestination of ['local', 'neighbourhood', 'global']) {
  test('a closed map keeps its total energy with losses returned ' + lossDestination, () => {
    for (const seed of seeds) {
      playEquilibriumMatch({
        engine,
        rules: equilibriumRules({ lossDestination }),
        count: 20,
        players: 2,
        maxRounds: 150,
        mapSeed: seed,
        combatSeed: seed,
        valuationOf: (owner) => (owner === 0 ? RESERVE_VALUATION : undefined),
        onRound: ({ state, reserves, flows, startTotal }) => {
          const total = totalEnergy(state.nodes, reserves);
          assert.ok(Math.abs(total - startTotal) < startTotal * 1e-9, total + ' vs ' + startTotal);
          for (const reserve of reserves) assert.ok(reserve >= -1e-9);
          for (const amount of flows.extracted) assert.ok(amount >= 0);
        },
      });
    }
  });
}

test('both sides of a battle feed the reserve of the node fought over', () => {
  const links = [[0, 1]];
  const state = {
    round: 1,
    finished: false,
    nodes: [
      { id: 0, owner: 0, active: 40, invested: 0 },
      { id: 1, owner: 1, active: 20, invested: 10 },
    ],
  };
  const result = resolveEquilibriumRound({
    engine,
    state,
    reserves: [100, 100],
    links,
    rules: equilibriumRules(),
    orders: [{ source: 0, type: 'attack', amount: 30, dest: 1 }],
    playerCount: 2,
    rng: () => 0.5,
  });
  const [attacker, battlefield] = result.state.nodes;
  assert.equal(battlefield.owner, 0);
  assert.ok(result.flows.combat[1] > 20, 'defender losses, attacker losses and ceded principal');
  assert.equal(result.flows.combat[0], 0);
  assert.ok(
    Math.abs(result.reserves[1] - (100 - result.flows.extracted[1] + result.flows.losses[1])) <
      1e-9,
  );
  assert.ok(Math.abs(result.reserves[0] - (100 - 1 + (0.1 * (attacker.active - 1)) / 0.9)) < 1e-9);
});

test('a node extracts no more than its reserve holds', () => {
  const result = resolveEquilibriumRound({
    engine,
    state: { round: 1, finished: false, nodes: [{ id: 0, owner: 0, active: 0, invested: 50 }] },
    reserves: [2],
    links: [],
    rules: equilibriumRules(),
    orders: [],
    playerCount: 1,
    rng: () => 0.5,
  });
  assert.equal(result.flows.extracted[0], 2);
  assert.equal(result.state.nodes[0].active, 2);
  assert.ok(Math.abs(result.reserves[0] - 0) < 1e-12);
});
