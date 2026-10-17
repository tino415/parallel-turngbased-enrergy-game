import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { engine, assertValidMap, simulateMatch, simulateBatch } from './support/simulation.mjs';

const cli = fileURLToPath(new URL('../scripts/simulate.mjs', import.meta.url));

test('all map densities and player counts create connected, legal, repeatable maps', () => {
  for (const [count, players, density] of [
    [10, 2, 'sparse'], [30, 3, 'normal'], [60, 4, 'dense'], [120, 6, 'sparse']
  ]) {
    const input = { count, players, density, seed: 'map-check:' + count };
    const a = engine.buildMap(input), b = engine.buildMap(input);
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
  assert.ok(Object.values(normal).every(order => map.nodes[order.source].owner !== 0));
  assert.ok(Object.values(allBots).some(order => map.nodes[order.source].owner === 0));
  for (const [source, order] of Object.entries(normal)) {
    assert.equal(JSON.stringify(order), JSON.stringify(allBots[source]),
      'AI orders for existing opponents should not change');
  }
});

test('same map and combat seeds reproduce the entire multi-round game', () => {
  const options = { count: 30, players: 3, density: 'dense', maxRounds: 100,
    mapSeed: 'replay-map', combatSeed: 'replay-combat' };
  const first = simulateMatch(options), second = simulateMatch(options);
  assert.deepEqual(first, second);
  assert.match(first.checksum, /^[a-f0-9]{64}$/);
  assert.ok(first.rounds >= 1 && first.rounds <= 100);
  assert.equal(first.standings.length, 3);
});

test('changing only combat seed changes the reproducible round trace', () => {
  const base = { count: 30, players: 3, density: 'dense', maxRounds: 100,
    mapSeed: 'fixed-topology' };
  const first = simulateMatch({ ...base, combatSeed: 'combat-A' });
  const second = simulateMatch({ ...base, combatSeed: 'combat-B' });
  assert.notEqual(first.checksum, second.checksum,
    'combat RNG should influence at least one simulated battle');
  assert.equal(first.mapSeed, second.mapSeed);
});

test('stress simulation validates finite nonnegative energy, ownership and no resurrection', () => {
  for (const [count, players, density] of [
    [10, 2, 'normal'], [30, 3, 'sparse'], [60, 4, 'dense'], [120, 6, 'normal']
  ]) {
    for (let i = 0; i < 3; i++) {
      const result = simulateMatch({
        mapSeed: 'stress-map-' + count + '-' + i,
        combatSeed: 'stress-rolls-' + count + '-' + i,
        count, players, density, maxRounds: 75
      });
      assert.ok(result.rounds > 0 && result.rounds <= 75);
      assert.equal(result.standings.reduce((sum, row) => sum + row.nodes, 0) <= count, true);
      assert.equal(result.finished, result.winner !== null);
    }
  }
});

test('round cap does not pretend unresolved games have a winner', () => {
  const result = simulateMatch({ count: 30, players: 4, maxRounds: 1,
    mapSeed: 'round-cap', combatSeed: 'round-cap' });
  assert.equal(result.rounds, 1);
  assert.equal(result.finished, false);
  assert.equal(result.winner, null);
});

test('batch summaries and win rates are repeatable and count every match', () => {
  const input = { matches: 8, count: 20, players: 3, density: 'normal',
    maxRounds: 90, seed: 'batch-smoke' };
  const first = simulateBatch(input), second = simulateBatch(input);
  assert.deepEqual(first, second);
  assert.equal(first.results.length, input.matches);
  assert.equal(first.wins.reduce((sum, count) => sum + count, 0) + first.unresolved,
    input.matches);
});

test('CLI outputs stable machine-readable metrics and rejects bad options', () => {
  const options = ['--matches=2', '--rounds=25', '--nodes=20', '--players=3', '--seed=cli-test', '--json'];
  const command = () => execFileSync(process.execPath, [cli, ...options], { encoding: 'utf8' });
  const first = command(), second = command();
  assert.equal(first, second);
  const report = JSON.parse(first);
  assert.equal(report.matches, 2);
  assert.equal(report.results[0].combatSeed, 'cli-test:combat:0');
  const invalid = spawnSync(process.execPath, [cli, '--matches=banana'], { encoding: 'utf8' });
  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stderr, /Expected integer/);
});
