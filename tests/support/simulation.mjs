import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { planStrategyOrders, resolveStrategies } from './strategies.mjs';

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

function simulationOrders(state, links, strategies) {
  const decisions = planStrategyOrders({ nodes: state.nodes, links, strategies, engine });
  const orders = {};
  const aiOrdersOverride = {};
  for (const [source, choice] of Object.entries(decisions)) {
    if (state.nodes[Number(source)].owner === 0) {
      // Player zero uses the regular manual-order path, like the live game.
      orders[source] = choice.type === 'invest'
        ? { invest: choice.amount, edges: {} }
        : { invest: 0, edges: { [choice.dest]: choice.amount } };
    } else {
      // Other players use the normal AI-order path, with strategy-specific choices.
      aiOrdersOverride[source] = choice;
    }
  }
  return { orders, aiOrdersOverride };
}

export function simulateMatch({
  mapSeed = 'simulation-map',
  combatSeed = 'simulation-combat',
  count = 30,
  players = 3,
  density = 'normal',
  maxRounds = 200,
  blueStrategy = 'default',
  opponentStrategy = 'default',
  strategies = null,
} = {}) {
  assert.ok(Number.isInteger(count) && count >= 10 && count <= 120, 'count must be 10..120');
  assert.ok(
    Number.isInteger(players) && players >= 2 && players <= 6 && players <= count,
    'players must be 2..6',
  );
  assert.ok(validDensities.has(density), 'invalid density');
  assert.ok(
    Number.isInteger(maxRounds) && maxRounds > 0 && maxRounds <= 10000,
    'maxRounds must be 1..10000',
  );

  const chosenStrategies = resolveStrategies({ players, blueStrategy, opponentStrategy, strategies });
  const map = engine.buildMap({ count, players, density, seed: String(mapSeed) });
  assertValidMap(map, { count, players });
  const rng = engine.seeded(String(combatSeed));
  let state = { round: 1, finished: false, nodes: map.nodes };
  let policies = {},
    captures = 0;
  let alive = new Set(Array.from({ length: players }, (_, i) => i));
  const maxOwnedNodes = Array.from({ length: players }, () => 1);
  const hash = createHash('sha256');
  hash.update(JSON.stringify({ positions: map.positions, links: map.links, nodes: map.nodes }));
  while (!state.finished && state.round <= maxRounds) {
    const before = state;
    const { orders, aiOrdersOverride } = simulationOrders(before, map.links, chosenStrategies);
    const next = engine.resolveRound({
      state: before, orders, aiOrdersOverride, policies, links: map.links, rng,
    });
    assert.equal(before.round + 1, next.state.round, 'round must advance exactly once');
    assertValidState(before, { count, players }); // Input objects must remain valid.
    const nowAlive = assertValidState(next.state, { count, players, previousOwners: alive });
    for (let id = 0; id < count; id++) {
      if (next.state.nodes[id].owner !== before.nodes[id].owner) captures++;
    }
    alive = nowAlive;
    for (let player = 0; player < players; player++) {
      const owned = next.state.nodes.filter((n) => n.owner === player).length;
      maxOwnedNodes[player] = Math.max(maxOwnedNodes[player], owned);
    }
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
  return {
    mapSeed: String(mapSeed),
    combatSeed: String(combatSeed),
    count,
    players,
    density,
    strategies: chosenStrategies,
    maxOwnedNodes,
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
  const results = Array.from({ length: matches }, (_, index) =>
    simulateMatch({
      ...options,
      mapSeed: String(seed) + ':map:' + index,
      combatSeed: String(seed) + ':combat:' + index,
    }),
  );
  const playerCount = options.players ?? 3;
  const wins = Array.from(
    { length: playerCount },
    (_, player) => results.filter((r) => r.winner === player).length,
  );
  const survivalRate = Array.from(
    { length: playerCount },
    (_, player) => Number(
      (100 * results.filter((r) => r.standings[player].nodes > 0).length / matches).toFixed(2),
    ),
  );
  const averageInvested = Array.from(
    { length: playerCount },
    (_, player) => Number(
      (results.reduce((sum, r) => sum + r.standings[player].invested, 0) / matches).toFixed(2),
    ),
  );
  return {
    seed: String(seed),
    matches,
    strategies: results[0].strategies,
    wins,
    survivalRate,
    averageInvested,
    unresolved: results.filter((r) => !r.finished).length,
    averageRounds: Number((results.reduce((sum, r) => sum + r.rounds, 0) / matches).toFixed(2)),
    minRounds: Math.min(...results.map((r) => r.rounds)),
    maxRounds: Math.max(...results.map((r) => r.rounds)),
    results,
  };
}
