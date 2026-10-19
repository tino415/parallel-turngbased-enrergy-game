#!/usr/bin/env node
// Blue is played only by node policies, the other players by the live economic AI.
// Each match runs twice on the same map and combat seed: border pressure off, then on.
import assert from 'node:assert/strict';
import { engine } from '../tests/support/simulation.mjs';

const args = Object.fromEntries(
  process.argv.slice(2).map((item) => {
    const found = /^--([a-z-]+)=(.+)$/.exec(item);
    if (!found) throw new Error('Expected --name=value: ' + item);
    return [found[1], found[2]];
  }),
);
const matches = Number(args.matches ?? 30);
const rounds = Number(args.rounds ?? 300);
const count = Number(args.nodes ?? 20);
const players = Number(args.players ?? 2);
const seed = args.seed ?? 'pressure-v1';
assert.ok(Number.isSafeInteger(matches) && matches > 0 && matches <= 1000);
assert.ok(Number.isSafeInteger(rounds) && rounds > 0 && rounds <= 1000);

const bluePolicy = {
  enabled: true,
  reserve: 5,
  investPct: 40,
  investTarget: 150,
  defensePct: 20,
  defenseTarget: 30,
  dest: null,
};

function weakestEnemyNeighbour(state, links, id) {
  return links
    .flatMap(([a, b]) => (a === id ? [b] : b === id ? [a] : []))
    .filter((other) => state.nodes[other].owner !== null && state.nodes[other].owner !== 0)
    .sort((a, b) => state.nodes[a].active - state.nodes[b].active || a - b)[0];
}

function policiesFor(state, links, previous, pressure) {
  const policies = {};
  for (const node of state.nodes.filter((n) => n.owner === 0)) {
    const kept = previous[node.id];
    const target = pressure ? weakestEnemyNeighbour(state, links, node.id) : undefined;
    const bank = target === undefined ? 0 : (kept?.pressure?.[target]?.bank ?? 0);
    policies[node.id] = {
      ...bluePolicy,
      ...(kept ? { reserve: kept.reserve } : {}),
      ...(target === undefined ? {} : { pressure: { [target]: { pct: 10, min: 10, bank } } }),
    };
  }
  return policies;
}

function play(index, pressure) {
  const map = engine.buildMap({ count, players, density: 'normal', seed: seed + ':map:' + index });
  const rng = engine.seeded(seed + ':combat:' + index);
  let state = { round: 1, nodes: map.nodes, finished: false, rulesVersion: 2 };
  let policies = {};
  let peakNodes = 1;
  while (!state.finished && state.round <= rounds) {
    policies = policiesFor(state, map.links, policies, pressure);
    const result = engine.resolveRound({
      state,
      playerCount: players,
      links: map.links,
      orders: {},
      policies,
      rng,
    });
    state = result.state;
    policies = result.policies;
    peakNodes = Math.max(peakNodes, state.nodes.filter((n) => n.owner === 0).length);
  }
  const blue = state.nodes.filter((n) => n.owner === 0);
  return {
    winner: state.finished ? (state.nodes.find((n) => n.owner !== null)?.owner ?? null) : null,
    rounds: state.round - 1,
    blueNodes: blue.length,
    blueEnergy: blue.reduce((sum, n) => sum + n.active + n.invested, 0),
    peakNodes,
  };
}

const median = (items) => {
  const sorted = [...items].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

function summary(results) {
  return {
    blueWins: results.filter((r) => r.winner === 0).length,
    aiWins: results.filter((r) => r.winner !== null && r.winner !== 0).length,
    unfinished: results.filter((r) => r.winner === null).length,
    medianRounds: median(results.map((r) => r.rounds)),
    medianBlueNodes: median(results.map((r) => r.blueNodes)),
    medianBlueEnergy: Number(median(results.map((r) => r.blueEnergy)).toFixed(1)),
    medianPeakNodes: median(results.map((r) => r.peakNodes)),
  };
}

const indexes = Array.from({ length: matches }, (_, i) => i);
const report = {
  matches,
  rounds,
  nodes: count,
  players,
  seed,
  pressureOff: summary(indexes.map((i) => play(i, false))),
  pressureOn: summary(indexes.map((i) => play(i, true))),
};
console.log(JSON.stringify(report, null, 2));
