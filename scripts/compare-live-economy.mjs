#!/usr/bin/env node
// Evaluates the ACTUAL versioned production round resolver and AI, not the
// detached simulation-only economy adapter.
import assert from 'node:assert/strict';
import { engine } from '../tests/support/simulation.mjs';

const args = Object.fromEntries(process.argv.slice(2).map((item) => {
  const found = /^--([a-z-]+)=(.+)$/.exec(item);
  if (!found) throw new Error('Expected --name=value: ' + item);
  return [found[1], found[2]];
}));
const matches = Number(args.matches ?? 30);
const rounds = Number(args.rounds ?? 300);
const count = Number(args.nodes ?? 20);
const players = Number(args.players ?? 2);
const seed = args.seed ?? 'real-economy-v2';
assert.ok(Number.isSafeInteger(matches) && matches > 0 && matches <= 1000);
assert.ok(Number.isSafeInteger(rounds) && rounds > 0 && rounds <= 1000);
assert.ok(Number.isSafeInteger(count) && count >= 10 && count <= 120);
assert.ok(Number.isSafeInteger(players) && players >= 2 && players <= 6);
const median = (items) => {
  const sorted = [...items].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};
function play(version, index) {
  const mapSeed = seed + ':map:' + index;
  const combatSeed = seed + ':combat:' + index;
  const map = engine.buildMap({ count, players, density: 'normal', seed: mapSeed });
  let state = {
    round: 1,
    nodes: map.nodes,
    finished: false,
    ...(version === 2 ? { rulesVersion: 2 } : {}),
  };
  const rng = engine.seeded(combatSeed);
  let peakNodes = 1;
  let lastCapture = 0;
  let captures = 0;
  let totalRounds = 0;
  while (!state.finished && state.round <= rounds) {
    const before = state;
    const plan = version === 2
      ? engine.economicAI(before.nodes, map.links, true)
      : { orders: engine.aiOrders(before.nodes, map.links, true), withdrawals: {} };
    const orders = {};
    const aiOrdersOverride = [];
    const aiWithdrawalsOverride = {};
    for (const [rawId, choice] of Object.entries(plan.orders)) {
      const source = Number(rawId);
      const options = Array.isArray(choice) ? choice : [choice];
      if (before.nodes[source].owner === 0) {
        const manual = {
          withdraw: plan.withdrawals[source] ?? 0,
          invest: 0,
          edges: {},
        };
        for (const action of options) {
          if (action.type === 'invest') manual.invest += action.amount;
          else manual.edges[action.dest] = (manual.edges[action.dest] ?? 0) + action.amount;
        }
        orders[source] = manual;
      } else {
        aiOrdersOverride.push(...options);
        if (plan.withdrawals[source]) aiWithdrawalsOverride[source] = plan.withdrawals[source];
      }
    }
    for (const [source, amount] of Object.entries(plan.withdrawals)) {
      if (before.nodes[Number(source)].owner === 0 && !orders[source]) {
        orders[source] = { withdraw: amount, invest: 0, edges: {} };
      }
    }
    const result = engine.resolveRound({
      state: before,
      playerCount: players,
      links: map.links,
      orders,
      policies: {},
      rng,
      aiOrdersOverride,
      aiWithdrawalsOverride,
    });
    state = result.state;
    for (const node of state.nodes) {
      if (node.owner !== before.nodes[node.id].owner) {
        captures++;
        lastCapture = before.round;
      }
      assert.ok(Number.isFinite(node.active) && node.active >= 0);
      assert.ok(Number.isFinite(node.invested) && node.invested >= 0);
    }
    peakNodes = Math.max(peakNodes, state.nodes.filter((node) => node.owner === 0).length);
    totalRounds++;
  }
  const standings = Array.from({ length: players }, (_, owner) => {
    const owned = state.nodes.filter((node) => node.owner === owner);
    return {
      nodes: owned.length,
      active: owned.reduce((sum, n) => sum + n.active, 0),
      invested: owned.reduce((sum, n) => sum + n.invested, 0),
      total: owned.reduce((sum, n) => sum + n.active + n.invested, 0),
      gross: owned.reduce((sum, n) => sum + 1 + n.invested * 0.1, 0),
    };
  });
  const alive = standings.map((s, i) => s.nodes > 0 ? i : null).filter((n) => n !== null);
  const winner = state.finished && alive.length === 1 ? alive[0] : null;
  const totalGross = standings.reduce((sum, n) => sum + n.gross, 0);
  return {
    version,
    mapSeed,
    combatSeed,
    rounds: totalRounds,
    winner,
    survived: standings[0].nodes > 0,
    expanded: peakNodes > 1,
    stalemate: !state.finished && totalRounds - lastCapture >= 25,
    captures,
    standings,
    grossSharePct: totalGross ? standings[0].gross / totalGross * 100 : 0,
  };
}
const output = { metadata: { seed, matches, rounds, count, players,
  caveat: 'Baseline uses old rules AND old AI; treatment uses new rules AND capacity-aware AI. Matched map/combat seeds, divergent draws after differing actions. No isolated causal attribution.' }, versions: {} };
for (const version of [1, 2]) {
  const results = Array.from({ length: matches }, (_, index) => play(version, index));
  output.versions[version] = { results, summary: {
    winsP0: results.filter((r) => r.winner === 0).length,
    winsAll: Array.from({ length: players }, (_, p) => results.filter((r) => r.winner === p).length),
    survivalP0: results.filter((r) => r.survived).length,
    expansionP0: results.filter((r) => r.expanded).length,
    stalemates: results.filter((r) => r.stalemate).length,
    unresolved: results.filter((r) => r.winner === null).length,
    medianRounds: median(results.map((r) => r.rounds)),
    medianNodes: median(results.map((r) => r.standings[0].nodes)),
    medianActive: median(results.map((r) => r.standings[0].active)),
    medianInvested: median(results.map((r) => r.standings[0].invested)),
    medianTotal: median(results.map((r) => r.standings[0].total)),
    medianGross: median(results.map((r) => r.standings[0].gross)),
    medianGrossSharePct: median(results.map((r) => r.grossSharePct)),
  } };
}
if (args.json === 'true') console.log(JSON.stringify(output, null, 2));
else {
  console.log('Live-engine AI comparison: ' + matches + ' paired seeds, ' +
    count + ' nodes, ' + players + ' players, ' + rounds + ' rounds');
  console.log('VERSION | WINS P0 | SURVIVAL P0 | EXPANDED | STALEMATES | MEDIAN TOTAL | MEDIAN GROSS');
  for (const [version, entry] of Object.entries(output.versions)) {
    const s = entry.summary;
    console.log([version, s.winsP0, s.survivalP0, s.expansionP0, s.stalemates,
      s.medianTotal.toFixed(1), s.medianGross.toFixed(1)].join(' | '));
  }
}
