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
    const choices = Array.isArray(botChoices[node.id])
      ? botChoices[node.id]
      : [botChoices[node.id]];
    const order = { invest: 0, edges: {} };
    for (const choice of choices) {
      if (choice.type === 'invest') order.invest += choice.amount;
      else order.edges[choice.dest] = (order.edges[choice.dest] ?? 0) + choice.amount;
    }
    orders[node.id] = order;
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
  turtleRounds = 150,
  attackPct = 5,
} = {}) {
  assert.ok(Number.isInteger(count) && count >= 10 && count <= 120, 'count must be 10..120');
  assert.ok(
    Number.isInteger(players) && players >= 2 && players <= 6 && players <= count,
    'players must be 2..6',
  );
  assert.ok(validDensities.has(density), 'invalid density');
  const strategyNames = normalizeStrategies(strategies, players);
  assert.ok(
    Number.isInteger(turtleRounds) && turtleRounds >= 0 && turtleRounds <= 10000,
    'turtleRounds must be an integer from 0 to 10000',
  );
  assert.ok(
    Number.isFinite(attackPct) && attackPct > 0 && attackPct <= 100,
    'attackPct must be greater than 0 and at most 100',
  );
  assert.ok(
    Number.isInteger(maxRounds) && maxRounds > 0 && maxRounds <= 10000,
    'maxRounds must be 1..10000',
  );

  const map = engine.buildMap({ count, players, density, seed: String(mapSeed) });
  assertValidMap(map, { count, players });
  const homeNodes = Array.from(
    { length: players },
    (_, owner) => map.nodes.find((node) => node.owner === owner).id,
  );
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
    firstAttackRound: null,
    firstConquestRound: null,
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
      round: before.round,
      homeNodes,
      turtleRounds,
      attackPct,
    });
    for (const entry of Object.values(botChoices)) {
      for (const order of Array.isArray(entry) ? entry : [entry]) {
        if (order.type !== 'attack') continue;
        const progress = playerProgress[before.nodes[order.source].owner];
        if (progress.firstAttackRound === null) progress.firstAttackRound = before.round;
      }
    }
    const orders = zeroPlayerOrders(before, botChoices);
    const aiOrdersOverride = Object.values(botChoices)
      .flatMap((entry) => (Array.isArray(entry) ? entry : [entry]))
      .filter((order) => before.nodes[order.source].owner !== 0);
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
        const capturingOwner = next.state.nodes[id].owner;
        if (capturingOwner !== null && playerProgress[capturingOwner].firstConquestRound === null) {
          playerProgress[capturingOwner].firstConquestRound = before.round;
        }
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
      // Snapshot after the last resolved round, before next-round orders.
      // Base income is +1 per owned node; invested principal earns 10%.
      // Gross income excludes next-round active-energy decay and battle losses.
      totalEnergy: Number(owned.reduce((total, n) => total + n.active + n.invested, 0).toFixed(3)),
      baseIncome: owned.length,
      investmentIncome: Number(
        (owned.reduce((total, n) => total + n.invested, 0) * 0.1).toFixed(3),
      ),
      grossIncome: Number(
        (owned.length + owned.reduce((total, n) => total + n.invested, 0) * 0.1).toFixed(3),
      ),
    };
  });
  const allIncome = standings.reduce((sum, player) => sum + player.grossIncome, 0);
  for (const entry of standings) {
    entry.incomeSharePct =
      allIncome > 0 ? Number(((entry.grossIncome * 100) / allIncome).toFixed(3)) : 0;
  }
  const playerStats = playerProgress.map((progress) => ({
    ...progress,
    survived: alive.has(progress.player),
    peakInvested: Number(progress.peakInvested.toFixed(3)),
    roundsSurvived: progress.eliminatedRound ?? state.round - 1,
  }));
  return {
    strategies: strategyNames,
    turtleRounds,
    attackPct,
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

function median(sorted) {
  const midpoint = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[midpoint] : (sorted[midpoint - 1] + sorted[midpoint]) / 2;
}

function medianEndingField(results, player, field) {
  const values = results.map((result) => result.standings[player][field]).sort((a, b) => a - b);
  return median(values);
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
    // Medians describe a typical match and avoid a few massive turtle economies
    // masking the rest. Per-match raw values remain available in results.
    medianEndingEconomy: strategies.map((strategy, player) => ({
      player,
      strategy,
      nodes: medianEndingField(results, player, 'nodes'),
      active: medianEndingField(results, player, 'active'),
      invested: medianEndingField(results, player, 'invested'),
      totalEnergy: medianEndingField(results, player, 'totalEnergy'),
      baseIncome: medianEndingField(results, player, 'baseIncome'),
      investmentIncome: medianEndingField(results, player, 'investmentIncome'),
      grossIncome: medianEndingField(results, player, 'grossIncome'),
      incomeSharePct: medianEndingField(results, player, 'incomeSharePct'),
    })),
    turtleRounds: options.turtleRounds ?? 150,
    attackPct: options.attackPct ?? 5,
    expansionCounts: strategies.map(
      (_, player) => results.filter((result) => result.playerStats[player].peakNodes > 1).length,
    ),
    firstAttackCounts: strategies.map(
      (_, player) =>
        results.filter((result) => result.playerStats[player].firstAttackRound !== null).length,
    ),
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
