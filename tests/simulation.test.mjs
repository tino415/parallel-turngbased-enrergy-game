import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { engine, assertValidMap, simulateMatch, simulateBatch } from './support/simulation.mjs';

const cli = fileURLToPath(new URL('../scripts/simulate.mjs', import.meta.url));

test('all map densities and player counts create connected, legal, repeatable maps', () => {
  for (const [count, players, density] of [
    [10, 2, 'sparse'],
    [30, 3, 'normal'],
    [60, 4, 'dense'],
    [120, 6, 'sparse'],
  ]) {
    const input = { count, players, density, seed: 'map-check:' + count };
    const a = engine.buildMap(input),
      b = engine.buildMap(input);
    assertValidMap(a, { count, players });
    assert.equal(JSON.stringify(a), JSON.stringify(b), 'map generation changed');
    const c = engine.buildMap({ ...input, seed: input.seed + ':different' });
    assert.notEqual(JSON.stringify(a.positions), JSON.stringify(c.positions));
  }
});

test('player-zero bot is simulation-only; normal AI behavior is unchanged', () => {
  const map = engine.buildMap({ count: 30, players: 3, density: 'normal', seed: 'ai-mode' });
  const normal = engine.aiOrders(map.nodes, map.links);
  const allBots = engine.aiOrders(map.nodes, map.links, true);
  assert.ok(Object.values(normal).every((order) => map.nodes[order.source].owner !== 0));
  assert.ok(Object.values(allBots).some((order) => map.nodes[order.source].owner === 0));
  for (const [source, order] of Object.entries(normal)) {
    assert.equal(
      JSON.stringify(order),
      JSON.stringify(allBots[source]),
      'AI orders for existing opponents should not change',
    );
  }
});

test('same map and combat seeds reproduce the entire multi-round game', () => {
  const options = {
    count: 30,
    players: 3,
    density: 'dense',
    maxRounds: 100,
    mapSeed: 'replay-map',
    combatSeed: 'replay-combat',
  };
  const first = simulateMatch(options),
    second = simulateMatch(options);
  assert.deepEqual(first, second);
  assert.match(first.checksum, /^[a-f0-9]{64}$/);
  assert.ok(first.rounds >= 1 && first.rounds <= 100);
  assert.equal(first.standings.length, 3);
});

test('changing only combat seed changes the reproducible round trace', () => {
  const base = {
    count: 30,
    players: 3,
    density: 'dense',
    maxRounds: 100,
    mapSeed: 'fixed-topology',
  };
  const first = simulateMatch({ ...base, combatSeed: 'combat-A' });
  const second = simulateMatch({ ...base, combatSeed: 'combat-B' });
  assert.notEqual(
    first.checksum,
    second.checksum,
    'combat RNG should influence at least one simulated battle',
  );
  assert.equal(first.mapSeed, second.mapSeed);
});

test('stress simulation validates finite nonnegative energy, ownership and no resurrection', () => {
  for (const [count, players, density] of [
    [10, 2, 'normal'],
    [30, 3, 'sparse'],
    [60, 4, 'dense'],
    [120, 6, 'normal'],
  ]) {
    for (let i = 0; i < 3; i++) {
      const result = simulateMatch({
        mapSeed: 'stress-map-' + count + '-' + i,
        combatSeed: 'stress-rolls-' + count + '-' + i,
        count,
        players,
        density,
        maxRounds: 75,
      });
      assert.ok(result.rounds > 0 && result.rounds <= 75);
      assert.equal(result.standings.reduce((sum, row) => sum + row.nodes, 0) <= count, true);
      assert.equal(result.finished, result.winner !== null);
    }
  }
});

test('round cap does not pretend unresolved games have a winner', () => {
  const result = simulateMatch({
    count: 30,
    players: 4,
    maxRounds: 1,
    mapSeed: 'round-cap',
    combatSeed: 'round-cap',
  });
  assert.equal(result.rounds, 1);
  assert.equal(result.finished, false);
  assert.equal(result.winner, null);
});

test('batch summaries and win rates are repeatable and count every match', () => {
  const input = {
    matches: 8,
    count: 20,
    players: 3,
    density: 'normal',
    maxRounds: 90,
    seed: 'batch-smoke',
  };
  const first = simulateBatch(input),
    second = simulateBatch(input);
  assert.deepEqual(first, second);
  assert.equal(first.results.length, input.matches);
  assert.equal(first.wins.reduce((sum, count) => sum + count, 0) + first.unresolved, input.matches);
});

test('CLI outputs stable machine-readable metrics and rejects bad options', () => {
  const options = [
    '--matches=2',
    '--rounds=25',
    '--nodes=20',
    '--players=3',
    '--seed=cli-test',
    '--json',
  ];
  const command = () => execFileSync(process.execPath, [cli, ...options], { encoding: 'utf8' });
  const first = command(),
    second = command();
  assert.equal(first, second);
  const report = JSON.parse(first);
  assert.equal(report.matches, 2);
  assert.equal(report.results[0].combatSeed, 'cli-test:combat:0');
  const invalid = spawnSync(process.execPath, [cli, '--matches=banana'], { encoding: 'utf8' });
  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stderr, /Expected integer/);
});


import { normalizeStrategies, defensiveReserve, planStrategyOrders } from './support/strategies.mjs';

test('strategy profiles require one known strategy per player', () => {
  assert.deepEqual(normalizeStrategies(undefined, 4), ['default', 'default', 'default', 'default']);
  assert.deepEqual(
    normalizeStrategies('superturtle,default,aggressive,turtle', 4),
    ['superturtle', 'default', 'aggressive', 'turtle'],
  );
  assert.throws(() => normalizeStrategies('superturtle,default', 4), /exactly 4 strategies/);
  assert.throws(() => normalizeStrategies('magic,default', 2), /strategies/);
});

test('superturtle only invests, maintains dynamic defense and never attacks or transfers', () => {
  const nodes = [
    { id: 0, owner: 0, active: 100, invested: 100 },
    { id: 1, owner: 1, active: 20, invested: 10 },
    { id: 2, owner: null, active: 5, invested: 0 },
  ];
  const links = [[0, 1], [0, 2]];
  const reserve = defensiveReserve(nodes[0], nodes, [1, 2]);
  assert.equal(reserve, 32);
  const choices = planStrategyOrders({
    engine, nodes, links, strategies: ['superturtle', 'default'],
  });
  assert.equal(choices[0].type, 'invest');
  assert.equal(choices[0].amount, 68);
  assert.equal(choices[0].dest, null);
  const threatened = planStrategyOrders({
    engine, nodes: [{ ...nodes[0], active: 20 }, nodes[1], nodes[2]],
    links, strategies: ['superturtle', 'default'],
  });
  assert.equal(threatened[0], undefined, 'no energy is spent below defensive reserve');
});

test('strategy names produce different decisions for identical positions', () => {
  const nodes = [
    { id: 0, owner: 0, active: 100, invested: 10 },
    { id: 1, owner: 1, active: 8, invested: 10 },
    { id: 2, owner: null, active: 4, invested: 0 },
  ];
  const links = [[0, 1], [0, 2]];
  const choice = (strategy) => planStrategyOrders({
    engine, nodes, links, strategies: [strategy, 'default'],
  })[0];
  assert.equal(choice('superturtle').type, 'invest');
  assert.equal(choice('aggressive').type, 'attack');
  assert.equal(choice('balanced').type, 'attack');
  assert.equal(choice('turtle').type, 'attack');
  assert.equal(nodes[0].active, 100, 'planning must not mutate nodes');
});

test('super turtle stays at one node, cannot conquer, and yields repeatable survival metrics', () => {
  const input = {
    count: 40, players: 4, density: 'normal', maxRounds: 80,
    mapSeed: 'super-map', combatSeed: 'super-rolls',
    strategies: ['superturtle', 'default', 'default', 'default'],
  };
  const a = simulateMatch(input);
  const b = simulateMatch(input);
  assert.deepEqual(a, b);
  assert.equal(a.playerStats[0].strategy, 'superturtle');
  assert.equal(a.playerStats[0].peakNodes, 1);
  assert.ok(a.playerStats[0].peakInvested >= 14);
  assert.equal(a.playerStats[0].survived, a.standings[0].nodes > 0);
  assert.ok(a.playerStats[0].roundsSurvived <= a.rounds);
});

test('mixed strategy batches distinguish winning, survival and stalled games', () => {
  const args = {
    seed: 'strategies-batch', matches: 5, count: 40, players: 4, maxRounds: 35,
    strategies: ['superturtle', 'default', 'aggressive', 'balanced'],
  };
  const a = simulateBatch(args), b = simulateBatch(args);
  assert.deepEqual(a, b);
  assert.deepEqual(a.strategies, args.strategies);
  assert.equal(a.survivalCounts.length, 4);
  for (let p = 0; p < 4; p++) {
    assert.ok(a.survivalCounts[p] >= a.wins[p]);
    assert.equal(a.survivalRates[p], Number((a.survivalCounts[p] * 100 / 5).toFixed(2)));
  }
  assert.ok(a.stalledAtCap <= a.unresolved);
  assert.equal(a.results.length, 5);
});

test('CLI accepts mixed strategies and rejects mismatched player count', () => {
  const args = [
    cli, '--matches=2', '--nodes=40', '--players=4', '--rounds=30',
    '--strategies=superturtle,default,default,default', '--seed=mixed-cli', '--json',
  ];
  const report = JSON.parse(execFileSync(process.execPath, args, { encoding: 'utf8' }));
  assert.equal(report.strategies[0], 'superturtle');
  assert.equal(report.results[0].playerStats[0].peakNodes, 1);
  const invalid = spawnSync(process.execPath, [
    cli, '--players=4', '--strategies=superturtle,default',
  ], { encoding: 'utf8' });
  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stderr, /exactly 4 strategies/);
});
