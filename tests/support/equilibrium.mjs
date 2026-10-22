// Research adapter for the Equilibrium mode. The browser never loads it.
// It resolves a round with the unmodified engine on legacy rules and then
// replays the live soft-cap economy (withdrawal fee, overflow decay) around it,
// so the only difference between modes is where lost energy goes and how much
// a node may extract.

export const LIVE_ECONOMY = Object.freeze({ closed: false });

export function equilibriumRules({
  startingReserve = 100,
  extractionBase = 1,
  extractionRate = 0.1,
  lossDestination = 'local',
  trickle = 0,
} = {}) {
  if (!['local', 'neighbourhood', 'global'].includes(lossDestination)) {
    throw new RangeError('Unknown loss destination: ' + lossDestination);
  }
  return Object.freeze({
    closed: true,
    startingReserve,
    extractionBase,
    extractionRate,
    lossDestination,
    trickle,
  });
}

export function startingReserves(nodes, rules) {
  return nodes.map(() => (rules.closed ? rules.startingReserve : 0));
}

export function totalEnergy(nodes, reserves) {
  return nodes.reduce((sum, n, id) => sum + n.active + n.invested + reserves[id], 0);
}

export function resolveEquilibriumRound({
  engine,
  state,
  reserves,
  links,
  rules,
  orders,
  withdrawals = {},
  playerCount,
  rng,
}) {
  const { SOFT_CAP_RULES } = engine;
  const funded = withdraw(state.nodes, withdrawals, SOFT_CAP_RULES.withdrawalFee);
  const resolved = engine.resolveRound({
    state: { ...state, rulesVersion: undefined, nodes: funded.nodes },
    playerCount,
    links,
    orders: {},
    policies: {},
    aiOrdersOverride: orders,
    rng,
  });
  const nodes = resolved.state.nodes.map((n) => ({ ...n }));
  const lost = roundLosses(funded.nodes, nodes, resolved.moves);
  const nextReserves = [...reserves];
  const extracted = nodes.map(() => 0);
  for (const n of nodes) {
    const engineIncome = 1 + 0.1 * n.invested;
    const allowed = rules.closed
      ? Math.min(reserves[n.id], rules.extractionBase + rules.extractionRate * n.invested)
      : engineIncome;
    n.active = Math.max(0, n.active + allowed - engineIncome);
    extracted[n.id] = allowed;
    if (rules.closed) nextReserves[n.id] -= allowed;
  }
  const overflow = nodes.map((n) => {
    const { node, loss } = engine.applyOverflow(n);
    nodes[n.id] = { ...n, active: node.active, invested: node.invested };
    return loss;
  });
  const losses = nodes.map((_, id) => lost.combat[id] + lost.decay[id] + overflow[id]);
  for (const [id, fee] of Object.entries(funded.fees)) losses[id] += fee;
  if (rules.closed) {
    returnLosses(nextReserves, losses, links, rules.lossDestination);
    for (const id of nextReserves.keys()) nextReserves[id] += rules.trickle;
  }
  return {
    state: { ...resolved.state, nodes },
    reserves: nextReserves,
    moves: resolved.moves,
    flows: { extracted, combat: lost.combat, decay: lost.decay, overflow, losses },
  };
}

function withdraw(nodes, withdrawals, fee) {
  const funded = nodes.map((n) => ({ ...n }));
  const fees = {};
  for (const [id, requested] of Object.entries(withdrawals)) {
    const node = funded[Number(id)];
    if (!node || node.owner === null || !(requested > 0)) continue;
    const amount = Math.min(node.invested, requested);
    node.invested -= amount;
    node.active += amount * (1 - fee);
    fees[id] = amount * fee;
  }
  return { nodes: funded, fees };
}

// The engine reports only the orders it accepted, so a node's losses follow
// from conservation: what it held, plus what arrived and what it produced,
// minus what left and what it still holds.
function roundLosses(before, after, moves) {
  const arrived = before.map(() => 0);
  const left = before.map(() => 0);
  for (const move of moves) {
    if (move.type === 'invest') continue;
    left[move.source] += move.amount;
    arrived[move.dest] += move.amount;
  }
  const decay = after.map((n) => (0.1 * (n.active - (1 + 0.1 * n.invested))) / 0.9);
  const combat = after.map((n, id) => {
    const held = before[id].active + before[id].invested;
    const income = 1 + 0.1 * n.invested;
    const missing = held + arrived[id] - left[id] + income - n.active - n.invested;
    return Math.max(0, missing - decay[id]);
  });
  return { decay: decay.map((d) => Math.max(0, d)), combat };
}

function returnLosses(reserves, losses, links, destination) {
  const total = losses.reduce((sum, loss) => sum + loss, 0);
  if (destination === 'global') {
    for (const id of reserves.keys()) reserves[id] += total / reserves.length;
    return;
  }
  if (destination === 'local') {
    for (const id of reserves.keys()) reserves[id] += losses[id];
    return;
  }
  const around = reserves.map((_, id) => [id]);
  for (const [a, b] of links) {
    around[a].push(b);
    around[b].push(a);
  }
  for (const [id, loss] of losses.entries())
    for (const near of around[id]) reserves[near] += loss / around[id].length;
}
