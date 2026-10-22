import { LIVE_VALUATION, planEquilibriumAI } from './equilibrium-ai.mjs';
import { resolveEquilibriumRound, startingReserves, totalEnergy } from './equilibrium.mjs';

const CHECKPOINTS = [25, 50, 100, 200];

export function playEquilibriumMatch({
  engine,
  rules,
  count = 20,
  players = 2,
  density = 'normal',
  maxRounds = 300,
  mapSeed,
  combatSeed,
  valuationOf = () => LIVE_VALUATION,
  onRound = () => {},
}) {
  const map = engine.buildMap({ count, players, density, seed: mapSeed });
  const rng = engine.seeded(combatSeed);
  let state = { round: 1, finished: false, nodes: map.nodes };
  let reserves = startingReserves(map.nodes, rules);
  const startTotal = totalEnergy(state.nodes, reserves);
  const owners = Array.from({ length: players }, (_, owner) => owner);
  const captures = [];
  const shares = {};
  const extracted = owners.map(() => 0);
  const combatLoss = owners.map(() => 0);
  let lastCapture = 0;
  let decisiveRound = null;
  const combatByNode = map.nodes.map(() => 0);
  const trace = [];

  while (!state.finished && state.round <= maxRounds) {
    const before = state;
    const beforeReserves = reserves;
    const plan = planEquilibriumAI({
      engine,
      nodes: before.nodes,
      reserves,
      links: map.links,
      valuationOf,
    });
    const result = resolveEquilibriumRound({
      engine,
      state: before,
      reserves,
      links: map.links,
      rules,
      orders: Object.values(plan.orders).flat(),
      withdrawals: plan.withdrawals,
      playerCount: players,
      rng,
    });
    state = result.state;
    reserves = result.reserves;
    for (const node of state.nodes) {
      if (node.owner !== null) extracted[node.owner] += result.flows.extracted[node.id];
      const previous = before.nodes[node.id];
      if (previous.owner !== null) combatLoss[previous.owner] += result.flows.combat[node.id];
      combatByNode[node.id] += result.flows.combat[node.id];
      if (node.owner === previous.owner) continue;
      lastCapture = before.round;
      captures.push({
        round: before.round,
        from: previous.owner,
        to: node.owner,
        richness: richness(before.nodes, beforeReserves, node.id),
      });
    }
    const controlled = controlledEnergy(state.nodes, reserves, owners);
    if (CHECKPOINTS.includes(before.round)) shares[before.round] = shareOf(controlled);
    if (decisiveRound === null && Math.max(...shareOf(controlled)) >= 0.9)
      decisiveRound = before.round;
    if (before.round % 10 === 0) trace.push(composition(before.round, state.nodes, reserves));
    onRound({ state, reserves, flows: result.flows, startTotal });
  }

  const controlled = controlledEnergy(state.nodes, reserves, owners);
  const final = shareOf(controlled);
  const alive = owners.filter((o) => state.nodes.some((n) => n.owner === o));
  const total = totalEnergy(state.nodes, reserves);
  const owned = state.nodes.filter((n) => n.owner !== null);
  return {
    mapSeed,
    combatSeed,
    rounds: state.round - 1,
    finished: state.finished,
    winner: state.finished && alive.length === 1 ? alive[0] : null,
    leader: argmax(final),
    leaderAt50: shares[50] ? argmax(shares[50]) : null,
    shares: { ...shares, final },
    decisiveRound,
    captures: captures.length,
    playerCaptures: captures.filter((c) => c.from !== null).length,
    richCaptures: captures.filter((c) => c.richness >= 2).length,
    medianCaptureRichness: median(captures.map((c) => c.richness)),
    stalemate: !state.finished && state.round - 1 - lastCapture >= 25,
    alive: alive.length,
    startTotal,
    finalTotal: total,
    reserveShare: reserves.reduce((sum, r) => sum + r, 0) / total,
    ownedReserveShare: owned.reduce((sum, n) => sum + reserves[n.id], 0) / total,
    neutralShare:
      state.nodes
        .filter((n) => n.owner === null)
        .reduce((sum, n) => sum + n.active + n.invested + reserves[n.id], 0) / total,
    richestNode:
      Math.max(...state.nodes.map((n) => holding(n, reserves))) /
      medianHolding(state.nodes, reserves),
    activeOnMap: state.nodes.reduce((sum, n) => sum + n.active, 0),
    investedOnMap: state.nodes.reduce((sum, n) => sum + n.invested, 0),
    extracted,
    combatLoss,
    battleConcentration: concentration(combatByNode),
    trace: completed(trace, composition(state.round - 1, state.nodes, reserves), maxRounds),
  };
}

export const median = (values) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

const holding = (n, reserves) => n.active + n.invested + reserves[n.id];
const medianHolding = (nodes, reserves) => median(nodes.map((n) => holding(n, reserves))) || 1;
const richness = (nodes, reserves, id) =>
  holding(nodes[id], reserves) / medianHolding(nodes, reserves);
const argmax = (values) => values.indexOf(Math.max(...values));

function controlledEnergy(nodes, reserves, owners) {
  const controlled = owners.map(() => 0);
  for (const n of nodes) if (n.owner !== null) controlled[n.owner] += holding(n, reserves);
  return controlled;
}

function shareOf(controlled) {
  const sum = controlled.reduce((a, b) => a + b, 0) || 1;
  return controlled.map((c) => c / sum);
}

function composition(round, nodes, reserves) {
  const owned = nodes.filter((n) => n.owner !== null);
  const sum = (items, value) => items.reduce((total, n) => total + value(n), 0);
  return {
    round,
    active: sum(owned, (n) => n.active),
    invested: sum(owned, (n) => n.invested),
    ownedReserve: sum(owned, (n) => reserves[n.id]),
    neutral: sum(
      nodes.filter((n) => n.owner === null),
      (n) => n.active + n.invested + reserves[n.id],
    ),
  };
}

// A finished match keeps its last state for the rest of the round budget, so
// traces of short and long matches can be compared round by round.
function completed(trace, last, maxRounds) {
  const rounds = [];
  for (let round = 10; round <= maxRounds; round += 10)
    rounds.push(trace.find((t) => t.round === round) ?? { ...last, round });
  return rounds;
}

// The share of all combat losses that fell on the fifth of nodes fought over most.
function concentration(perNode) {
  const sorted = [...perNode].sort((a, b) => b - a);
  const total = sorted.reduce((a, b) => a + b, 0) || 1;
  const top = sorted.slice(0, Math.max(1, Math.round(sorted.length / 5)));
  return top.reduce((a, b) => a + b, 0) / total;
}
