import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { engine, simulateMatch, simulateBatch } from './support/simulation.mjs';
import { planStrategyOrders, resolveStrategies, STRATEGIES } from './support/strategies.mjs';

const cli = fileURLToPath(new URL('../scripts/simulate.mjs', import.meta.url));

test('all five strategies can be assigned to players and invalid choices fail early', () => {
  assert.deepEqual(
    resolveStrategies({
      players: 4,
      blueStrategy: 'extreme-turtle',
      opponentStrategy: 'default',
    }),
    ['extreme-turtle', 'default', 'default', 'default'],
  );
  assert.deepEqual(
    resolveStrategies({
      players: 4,
      strategies: ['turtle', 'balanced', 'aggressive', 'default'],
    }),
    ['turtle', 'balanced', 'aggressive', 'default'],
  );
  assert.equal(STRATEGIES.length, 5);
  assert.throws(
    () => resolveStrategies({ players: 3, strategies: ['default', 'turtle'] }),
    /Exactly one/,
  );
  assert.throws(
    () => resolveStrategies({ players: 2, blueStrategy: 'unknown' }),
    /Unknown strategy/,
  );
});

test('Extreme Turtle only reinvests from its original node and never expands', () => {
  const nodes = [
    { id: 0, owner: 0, active: 80, invested: 14 },
    { id: 1, owner: null, active: 4, invested: 0 },
    { id: 2, owner: 1, active: 20, invested: 14 },
  ];
  const links = [
    [0, 1],
    [0, 2],
  ];
  const orders = planStrategyOrders({
    nodes,
    links,
    strategies: ['extreme-turtle', 'default'],
    engine,
  });
  assert.equal(orders[0].type, 'invest');
  assert.equal(orders[0].dest, null);
  assert.ok(orders[0].amount > 0 && orders[0].amount < nodes[0].active);
  const options = {
    count: 40,
    players: 4,
    density: 'normal',
    maxRounds: 90,
    mapSeed: 'single-node-map',
    combatSeed: 'single-node-combat',
    blueStrategy: 'extreme-turtle',
  };
  const a = simulateMatch(options),
    b = simulateMatch(options);
  assert.deepEqual(a, b);
  assert.equal(a.strategies[0], 'extreme-turtle');
  assert.equal(a.maxOwnedNodes[0], 1);
});

test('Turtle may capture neutral nodes but does not attack enemy players', () => {
  const nodes = [
    { id: 0, owner: 0, active: 100, invested: 14 },
    { id: 1, owner: null, active: 4, invested: 0 },
    { id: 2, owner: 1, active: 10, invested: 14 },
  ];
  const links = [
    [0, 1],
    [0, 2],
  ];
  const orders = planStrategyOrders({ nodes, links, strategies: ['turtle', 'default'], engine });
  assert.equal(orders[0].type, 'attack');
  assert.equal(orders[0].dest, 1);
  const noNeutrals = planStrategyOrders({
    nodes: [{ ...nodes[0] }, { ...nodes[1], owner: 1 }, { ...nodes[2] }],
    links,
    strategies: ['turtle', 'default'],
    engine,
  });
  assert.equal(noNeutrals[0].type, 'invest');
});

test('all custom bots respect their energy allocation limits', () => {
  for (const strategy of STRATEGIES) {
    const map = engine.buildMap({ count: 40, players: 4, density: 'dense', seed: 'plans' });
    const actions = planStrategyOrders({
      nodes: map.nodes,
      links: map.links,
      strategies: [strategy, 'turtle', 'balanced', 'aggressive'],
      engine,
    });
    for (const [index, action] of Object.entries(actions)) {
      assert.ok(Number.isFinite(action.amount) && action.amount > 0);
      assert.ok(action.amount <= map.nodes[Number(index)].active + 1e-8);
      assert.equal(action.source, Number(index));
      if (action.type !== 'invest') {
        assert.ok(
          map.links.some(
            ([a, b]) =>
              (a === action.source && b === action.dest) ||
              (b === action.source && a === action.dest),
          ),
        );
      }
    }
  }
});

test('default simulated AI keeps the engine’s original round resolution unchanged', () => {
  const state = {
    round: 1,
    finished: false,
    nodes: [
      { id: 0, owner: 0, active: 24, invested: 14 },
      { id: 1, owner: 1, active: 24, invested: 14 },
      { id: 2, owner: null, active: 4, invested: 0 },
    ],
  };
  const links = [
    [0, 1],
    [1, 2],
  ];
  const native = engine.resolveRound({
    state,
    links,
    orders: {},
    policies: {},
    rng: () => 0.5,
  });
  const override = engine.resolveRound({
    state,
    links,
    orders: {},
    policies: {},
    rng: () => 0.5,
    aiOrdersOverride: engine.aiOrders(state.nodes, links),
  });
  assert.equal(JSON.stringify(native), JSON.stringify(override));
});

test('strategy runs remain reproducible and batch stats count survival', () => {
  const opts = {
    matches: 6,
    count: 40,
    players: 4,
    seed: 'extreme-turtle-regression',
    maxRounds: 80,
    blueStrategy: 'extreme-turtle',
    opponentStrategy: 'default',
  };
  const first = simulateBatch(opts),
    second = simulateBatch(opts);
  assert.deepEqual(first, second);
  assert.equal(first.strategies[0], 'extreme-turtle');
  assert.equal(first.wins.length, 4);
  assert.equal(first.survivalRate.length, 4);
  assert.equal(first.averageInvested.length, 4);
  assert.ok(first.survivalRate.every((rate) => rate >= 0 && rate <= 100));
  assert.equal(first.results.length, opts.matches);
  assert.ok(first.results.every((match) => match.maxOwnedNodes[0] === 1));
  assert.equal(first.wins.reduce((sum, wins) => sum + wins, 0) + first.unresolved, opts.matches);
});

test('CLI accepts Turtle and Extreme Turtle choices and rejects unknown strategies', () => {
  const args = [
    '--matches=2',
    '--nodes=40',
    '--players=4',
    '--rounds=20',
    '--seed=cli-extreme',
    '--blue=extreme-turtle',
    '--opponents=default',
    '--json',
  ];
  const run = () => execFileSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
  const first = run(),
    second = run();
  assert.equal(first, second);
  const report = JSON.parse(first);
  assert.deepEqual(report.strategies, ['extreme-turtle', 'default', 'default', 'default']);
  assert.equal(report.results[0].maxOwnedNodes[0], 1);
  const invalid = spawnSync(process.execPath, [cli, '--blue=turrtle'], { encoding: 'utf8' });
  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stderr, /Unknown strategy/);
  const csv = JSON.parse(
    execFileSync(
      process.execPath,
      [
        cli,
        '--matches=1',
        '--nodes=20',
        '--players=3',
        '--rounds=1',
        '--strategies=turtle,balanced,aggressive',
        '--json',
      ],
      { encoding: 'utf8' },
    ),
  );
  assert.deepEqual(csv.strategies, ['turtle', 'balanced', 'aggressive']);
});
