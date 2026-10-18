import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { normalizeStrategies, planStrategyOrders } from './strategies.mjs';

// Run the exact same browser-independent engine that the live game uses.
const engineSource = readFileSync(new URL('../../src/engine.js', import.meta.url), 'utf8');
export const engine = runInNewContext(engineSource + '\n;GameEngine');

const validDensities = new Set(['sparse', 'normal', 'dense']);
const isOwner = (owner, players) =>
  owner === null || (Number.isInteger(owner) && owner >= 0 && owner < players);

export function assertValidState(state, { count, players, previousOwners = null } = {}) {
  assert.ok(Number.isInteger(state.round) && state.round >= 1, 'invalid round number');
  assert.equal(typeof state.finished, 'boolean', 'invalid finished flag');
  assert.equal(state.nodes.length, count, 'node count changed');
  const alive = new Set();
  for (const [id, node] of state.nodes.entries()) {
    assert.equal(node.id, id, 'node ID/index mismatch');
    assert.ok(isOwner(node.owner, players), 'invalid owner at node ' + id + ': ' + node.owner);
    for (const field of ['active', 'invested']) {
      assert.ok(
        Number.isFinite(node[field]) && node[field] >= 0,
        'invalid ' + field + ' at round ' + state.round + ', node ' + id + ': ' + node[field],
      );
    }
    if (node.owner !== null) alive.add(node.owner);
  }
  if (previousOwners) {
    for (const owner of alive)
      assert.ok(previousOwners.has(owner), 'eliminated player returned: ' + owner);
  }
  if (state.finished) assert.ok(alive.size <= 1, 'finished game still has multiple players');
  return alive;
}

export function assertValidMap(map, { count, players }) {
  assert.equal(map.nodes.length, count);
  assert.equal(map.positions.length, count);
  const seen = new Set();
  const adjacency = Array.from({ length: count }, () => []);
  for (const [a, b] of map.links) {
    assert.ok(
      Number.isInteger(a) &&
        Number.isInteger(b) &&
        a >= 0 &&
        b >= 0 &&
        a < count &&
        b < count &&
        a !== b,
      'invalid edge ' + a + '-' + b,
    );
    const key = Math.min(a, b) + ':' + Math.max(a, b);
    assert.ok(!seen.has(key), 'duplicate edge ' + key);
    seen.add(key);
    adjacency[a].push(b);
    adjacency[b].push(a);
  }
  const reached = new Set([0]),
    queue = [0];
  for (const id of queue)
    for (const next of adjacency[id]) {
      if (!reached.has(next)) {
        reached.add(next);
        queue.push(next);
      }
    }
  assert.equal(reached.size, count, 'map must be connected');
  for (const position of map.positions) {
    assert.equal(position.length, 2);
    assert.ok(position.every(Number.isFinite), 'nonfinite map position');
  }
  const owners = assertValidState(
    { round: 1, finished: false, nodes: map.nodes },
    { count, players },
  );
  assert.equal(owners.size, players, 'not every player has an initial node');
}

function zeroPlayerOrders(state, botChoices) {
  // Player zero uses the normal manual-order shape. The simulation injects
  // explicit AI choices for opponents, leaving live behavior unchanged.
  const orders = {};
  for (const node of state.nodes) {
    if (node.owner !== 0 || !botChoices[node.id]) continue;
    const choice = botChoices[node.id];
    orders[node.id] =
      choice.type === 'invest'
        ? { invest: choice.amount, edges: {} }
        : { invest: 0, edges: { [choice.dest]: choice.amount } };
  }
  return orders;
}

export function simulateMatch({
  mapSeed = 'simulation-map',
  combatSeed = 'simulation-combat',
  count = 30,
  players = 3,
  density = 'normal',
  maxRounds = 200,
  strategies,
} = {}) {
  assert.ok(Number.isInteger(count) && count >= 10 && count <= 120, 'count must be 10..120');
  assert.ok(
    Number.isInteger(players) && players >= 2 && players <= 6 && players <= count,
    'players must be 2..6',
  );
  assert.ok(validDensities.has(density), 'invalid density');
  const strategyNames = normalizeStrategies(strategies, players);
  assert.ok(
    Number.isInteger(maxRounds) && maxRounds > 0 && maxRounds <= 10000,
    'maxRounds must be 1..10000',
  );

  const map = engine.buildMap({ count, players, density, seed: String(mapSeed) });
  assertValidMap(map, { count, players });
  const rng = engine.seeded(String(combatSeed));
  let state = { round: 1, finished: false, nodes: map.nodes };
  let policies = {},
    captures = 0;
  let alive = new Set(Array.from({ length: players }, (_, i) => i));
  let lastCaptureRound = 0;
  const playerProgress = Array.from({ length: players }, (_, player) => ({
    player,
    strategy: strategyNames[player],
    eliminatedRound: null,
    peakNodes: 1,
    peakInvested: 14,
  }));
  const hash = createHash('sha256');
  hash.update(JSON.stringify({ positions: map.positions, links: map.links, nodes: map.nodes }));
  while (!state.finished && state.round <= maxRounds) {
    const before = state;
    const botChoices = planStrategyOrders({
      engine,
      nodes: before.nodes,
      links: map.links,
      strategies: strategyNames,
    });
    const orders = zeroPlayerOrders(before, botChoices);
    const aiOrdersOverride = Object.values(botChoices).filter(
      (order) => before.nodes[order.source].owner !== 0,
    );
    const next = engine.resolveRound({
      state: before,
      orders,
      policies,
      links: map.links,
      rng,
      aiOrdersOverride,
    });
    assert.equal(before.round + 1, next.state.round, 'round must advance exactly once');
    assertValidState(before, { count, players }); // Input objects must remain valid.
    const nowAlive = assertValidState(next.state, { count, players, previousOwners: alive });
    for (let id = 0; id < count; id++) {
      if (next.state.nodes[id].owner !== before.nodes[id].owner) {
        captures++;
        lastCaptureRound = before.round;
      }
    }
    for (const progress of playerProgress) {
      const owned = next.state.nodes.filter((node) => node.owner === progress.player);
      progress.peakNodes = Math.max(progress.peakNodes, owned.length);
      progress.peakInvested = Math.max(
        progress.peakInvested,
        owned.reduce((sum, node) => sum + node.invested, 0),
      );
      if (!nowAlive.has(progress.player) && progress.eliminatedRound === null)
        progress.eliminatedRound = before.round;
    }
    alive = nowAlive;
    state = next.state;
    policies = next.policies;
    hash.update(JSON.stringify(state));
  }
  const winner = state.finished ? ([...alive][0] ?? null) : null;
  const standings = Array.from({ length: players }, (_, player) => {
    const owned = state.nodes.filter((n) => n.owner === player);
    return {
      player,
      nodes: owned.length,
      active: Number(owned.reduce((total, n) => total + n.active, 0).toFixed(3)),
      invested: Number(owned.reduce((total, n) => total + n.invested, 0).toFixed(3)),
    };
  });
  const playerStats = playerProgress.map((progress) => ({
    ...progress,
    survived: alive.has(progress.player),
    peakInvested: Number(progress.peakInvested.toFixed(3)),
    roundsSurvived: progress.eliminatedRound ?? state.round - 1,
  }));
  return {
    strategies: strategyNames,
    playerStats,
    stalledAtCap: !state.finished && state.round - 1 - lastCaptureRound >= 25,
    roundsWithoutCapture: state.round - 1 - lastCaptureRound,
    mapSeed: String(mapSeed),
    combatSeed: String(combatSeed),
    count,
    players,
    density,
    rounds: state.round - 1,
    maxRounds,
    finished: state.finished,
    winner,
    captures,
    standings,
    checksum: hash.digest('hex'),
  };
}

export function simulateBatch({ matches = 20, seed = 'balance', ...options } = {}) {
  assert.ok(
    Number.isInteger(matches) && matches > 0 && matches <= 10000,
    'matches must be 1..10000',
  );
  const strategies = normalizeStrategies(options.strategies, options.players ?? 3);
  const results = Array.from({ length: matches }, (_, index) =>
    simulateMatch({
      ...options,
      mapSeed: String(seed) + ':map:' + index,
      combatSeed: String(seed) + ':combat:' + index,
    }),
  );
  const wins = Array.from(
    { length: options.players ?? 3 },
    (_, player) => results.filter((r) => r.winner === player).length,
  );
  const survivalCounts = strategies.map(
    (_, player) => results.filter((result) => result.playerStats[player].survived).length,
  );
  return {
    seed: String(seed),
    strategies,
    matches,
    wins,
    winRates: wins.map((count) => Number(((100 * count) / matches).toFixed(2))),
    survivalCounts,
    survivalRates: survivalCounts.map((count) => Number(((100 * count) / matches).toFixed(2))),
    stalledAtCap: results.filter((result) => result.stalledAtCap).length,
    unresolved: results.filter((r) => !r.finished).length,
    averageRounds: Number((results.reduce((sum, r) => sum + r.rounds, 0) / matches).toFixed(2)),
    minRounds: Math.min(...results.map((r) => r.rounds)),
    maxRounds: Math.max(...results.map((r) => r.rounds)),
    results,
  };
}
