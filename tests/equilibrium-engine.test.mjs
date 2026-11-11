import assert from 'node:assert/strict';
import test from 'node:test';
import { engine } from './support/simulation.mjs';

const EQUILIBRIUM = { economy: 'equilibrium', startingDeposit: 100 };

function openingState({ count, players, seed, rules = EQUILIBRIUM }) {
  const map = engine.buildMap({ count, players, density: 'normal', seed });
  const deposit = engine.rulesOf({ rules }).startingDeposit;
  const equilibrium = rules.economy === 'equilibrium';
  return {
    links: map.links,
    state: {
      round: 1,
      finished: false,
      rulesVersion: engine.SOFT_CAP_RULES.version,
      ...(equilibrium ? { rules } : {}),
      nodes: map.nodes.map((n) => (equilibrium ? { ...n, deposit } : n)),
    },
  };
}

const totalEnergy = (nodes) => nodes.reduce((sum, n) => sum + n.active + n.invested + n.deposit, 0);

function playRounds({ state, links, players, seed, rounds, onRound }) {
  const rng = engine.seeded(seed);
  let current = state;
  while (!current.finished && current.round <= rounds) {
    current = engine.resolveRound({
      state: current,
      playerCount: players,
      links,
      orders: {},
      policies: {},
      seat: -1,
      rng,
    }).state;
    onRound?.(current);
  }
  return current;
}

for (const [count, players] of [
  [20, 2],
  [40, 4],
]) {
  test('an Equilibrium map of ' + count + ' nodes keeps its total energy', () => {
    for (const seed of ['eq-a', 'eq-b', 'eq-c']) {
      const { state, links } = openingState({ count, players, seed });
      const startTotal = totalEnergy(state.nodes);
      playRounds({
        state,
        links,
        players,
        seed,
        rounds: 150,
        onRound: (next) => {
          const total = totalEnergy(next.nodes);
          assert.ok(Math.abs(total - startTotal) < startTotal * 1e-9, total + ' vs ' + startTotal);
          for (const n of next.nodes) assert.ok(n.deposit >= 0, 'deposit of node ' + n.id);
        },
      });
    }
  });
}

const battleState = (deposits) => ({
  round: 1,
  finished: false,
  rulesVersion: engine.SOFT_CAP_RULES.version,
  rules: EQUILIBRIUM,
  nodes: [
    { id: 0, owner: 0, active: 40, invested: 0, deposit: deposits[0] },
    { id: 1, owner: 1, active: 20, invested: 10, deposit: deposits[1] },
  ],
});

const resolveOnly = (state, aiOrdersOverride = [], links = [[0, 1]]) =>
  engine.resolveRound({
    state,
    playerCount: 2,
    links,
    orders: {},
    policies: {},
    seat: -1,
    aiOrdersOverride,
    aiWithdrawalsOverride: {},
    rng: () => 0.5,
  });

test('both sides of a battle feed the deposit of the node fought over', () => {
  const before = battleState([100, 100]);
  const { state } = resolveOnly(before, [{ source: 0, type: 'attack', amount: 30, dest: 1 }]);
  const [attacker, battlefield] = state.nodes;
  assert.equal(battlefield.owner, 0);
  assert.ok(battlefield.deposit > 100 - 1 + 20, 'defender, attacker and ceded principal land here');
  const decayOfAttacker = (0.1 * (attacker.active - 1)) / 0.9;
  assert.ok(Math.abs(attacker.deposit - (100 - 1 + decayOfAttacker)) < 1e-9);
});

test('a node extracts no more than its deposit holds', () => {
  const state = {
    round: 1,
    finished: false,
    rulesVersion: engine.SOFT_CAP_RULES.version,
    rules: EQUILIBRIUM,
    nodes: [{ id: 0, owner: 0, active: 0, invested: 50, deposit: 2 }],
  };
  const { state: next } = resolveOnly(state, [], []);
  assert.equal(next.nodes[0].active, 2);
  assert.ok(Math.abs(next.nodes[0].deposit) < 1e-12);
});

test('the withdrawal fee goes into the deposit of the node it was paid on', () => {
  const state = {
    round: 1,
    finished: false,
    rulesVersion: engine.SOFT_CAP_RULES.version,
    rules: EQUILIBRIUM,
    nodes: [{ id: 0, owner: 0, active: 0, invested: 100, deposit: 0 }],
  };
  const { state: next } = engine.resolveRound({
    state,
    playerCount: 1,
    links: [],
    orders: {},
    policies: {},
    seat: -1,
    aiOrdersOverride: [],
    aiWithdrawalsOverride: { 0: 60 },
    rng: () => 0.5,
  });
  const [node] = next.nodes;
  const total = node.active + node.invested + node.deposit;
  assert.ok(Math.abs(total - 100) < 1e-9);
  assert.ok(node.deposit >= 3 - 1e-9, 'the 3 of fee, less nothing extracted from an empty deposit');
});

test('the forecast shows the extraction and the deposit', () => {
  const rules = engine.rulesOf({ rules: EQUILIBRIUM });
  const node = { id: 0, owner: 0, active: 20, invested: 30, deposit: 2 };
  const prediction = engine.forecast(node, 0, [], { softCap: true, rules });
  assert.equal(prediction.extraction, 2);
  assert.equal(prediction.income, 2);
  assert.equal(prediction.deposit, 2);
  assert.ok(Math.abs(prediction.nextDeposit - (2 - 2 + 0.1 * 20)) < 1e-9);
  const rich = engine.forecast({ ...node, deposit: 100 }, 0, [], { softCap: true, rules });
  assert.equal(rich.extraction, 1 + 0.1 * 30);
});

test('the forecast of an open economy carries no deposit', () => {
  const prediction = engine.forecast({ active: 20, invested: 30 }, 0, [], { softCap: true });
  assert.equal('deposit' in prediction, false);
});

test('rulesOf accepts the economy and a starting deposit, and falls back to open', () => {
  assert.equal(engine.rulesOf({}).economy, 'open');
  assert.equal(engine.rulesOf({}).startingDeposit, 100);
  assert.equal(engine.rulesOf({ rules: { economy: 'equilibrium' } }).economy, 'equilibrium');
  assert.equal(engine.rulesOf({ rules: { economy: 'gold' } }).economy, 'open');
  assert.equal(engine.rulesOf({ rules: { startingDeposit: 40 } }).startingDeposit, 40);
  assert.equal(engine.rulesOf({ rules: { startingDeposit: -5 } }).startingDeposit, 100);
});

test('the AI reads the capacity from the match rules', () => {
  const rules = { ...engine.DEFAULT_RULES, capacity: 60 };
  const nodes = [
    { id: 0, owner: 0, active: 100, invested: 0 },
    { id: 1, owner: 0, active: 0, invested: 0 },
    { id: 2, owner: 1, active: 500, invested: 0 },
  ];
  const links = [
    [0, 1],
    [1, 2],
  ];
  const open = engine.economicAI(nodes, links, true, 0, rules);
  const invested = [open.orders[0]].flat().find((o) => o?.type === 'invest')?.amount ?? 0;
  assert.ok(invested <= 60 + 1e-9, 'investment stays within a capacity of 60');
});

test('the Equilibrium AI invests toward (S - 10) / 2 of what a node holds', () => {
  const rules = engine.rulesOf({ rules: EQUILIBRIUM });
  const node = { id: 0, owner: 0, active: 120, invested: 0, deposit: 0 };
  const plan = engine.economicAI([node], [], true, 0, rules);
  const invest = [plan.orders[0]].flat().find((o) => o?.type === 'invest');
  assert.ok(invest.amount <= (120 - 10) / 2 + 1e-9);
  const open = engine.economicAI([node], [], true, 0);
  const openInvest = [open.orders[0]].flat().find((o) => o?.type === 'invest');
  assert.ok(openInvest.amount > invest.amount, 'the open AI invests up to the capacity');
});

// Totals recorded from the engine before the economy rules existed.
const OPEN_GOLDEN = {
  'open-a': [
    [11, 114.76049382084739, 41.63715930292953, 8],
    [41, 237.81520091051797, 992.5361201078747, 12],
    [121, 1345.0996546651877, 3217.596927989558, 12],
  ],
  'open-b': [
    [11, 135.2503740554798, 54.014739167051076, 5],
    [41, 229.14562022328067, 626.506100220116, 6],
    [121, 1097.9344389827045, 2490.174924116123, 5],
  ],
  'open-c': [
    [11, 125.0042910376048, 44.919720534335745, 6],
    [41, 204.98022018765758, 469.10346166599413, 10],
    [121, 1498.0771430691777, 3544.487435489348, 15],
  ],
};

test('the open economy plays out round for round as it did before the economy rules', () => {
  for (const [seed, checkpoints] of Object.entries(OPEN_GOLDEN)) {
    const { state, links } = openingState({ count: 20, players: 2, seed, rules: {} });
    const seen = [];
    playRounds({
      state,
      links,
      players: 2,
      seed,
      rounds: 120,
      onRound: (next) => {
        if ([11, 41, 121].includes(next.round)) {
          const sum = (field) => next.nodes.reduce((total, n) => total + n[field], 0);
          seen.push([next.round, sum('active'), sum('invested'), ownedBy0(next)]);
        }
      },
    });
    assert.equal(seen.length, checkpoints.length);
    for (const [i, expected] of checkpoints.entries())
      for (const [j, value] of expected.entries())
        assert.ok(Math.abs(seen[i][j] - value) < 1e-9, seed + ' round ' + expected[0] + ' #' + j);
  }
});

const ownedBy0 = (state) => state.nodes.filter((n) => n.owner === 0).length;

test('the round log says where losses settled, and stays silent in the open economy', () => {
  const attack = [{ source: 0, type: 'attack', amount: 30, dest: 1 }];
  const { events } = resolveOnly(battleState([100, 100]), attack);
  assert.ok(
    events.some((line) => /Node 1's deposit \+\d/.test(line)),
    events.join('\n'),
  );
  assert.ok(!events.some((line) => /Node 0's deposit/.test(line)), 'decay alone is not logged');

  const open = { ...battleState([100, 100]), rules: undefined };
  const openEvents = resolveOnly(open, attack).events;
  assert.ok(!openEvents.some((line) => /deposit/.test(line)));
});
