// Simulation-only strategies: never loaded by the browser.
export const STRATEGIES = Object.freeze([
  'default',
  'aggressive',
  'balanced',
  'turtle',
  'superturtle',
  'compoundexpand',
  'turtlecounter',
]);

export function normalizeStrategies(value, players) {
  const names =
    value === undefined
      ? Array(players).fill('default')
      : typeof value === 'string'
        ? value.split(',').map((x) => x.trim().toLowerCase())
        : value;
  if (
    !Array.isArray(names) ||
    names.length !== players ||
    names.some((name) => !STRATEGIES.includes(name))
  ) {
    throw new Error(
      'Expected exactly ' +
        players +
        ' strategies, comma-separated, from: ' +
        STRATEGIES.join(', '),
    );
  }
  return [...names];
}

export function defensiveReserve(node, nodes, adjacent) {
  // Conservative worst-case for currently adjacent enemy-owned sources:
  // 1.2x attack roll / 0.8x defense roll = 1.5, even if all attackers cooperate.
  // This is an estimate, not a guarantee against future arrivals or transfers.
  const threatened = adjacent.reduce((sum, id) => {
    const enemy = nodes[id];
    return enemy.owner !== null && enemy.owner !== node.owner ? sum + enemy.active : sum;
  }, 0);
  return Math.min(node.active, Math.max(3, threatened * 1.5 + 2));
}

function planNode(node, name, nodes, adjacent, { round, turtleRounds, attackPct, isHome }) {
  const reserve = defensiveReserve(node, nodes, adjacent);
  const free = Math.max(0, node.active - reserve);
  const enemies = adjacent
    .filter((id) => nodes[id].owner !== node.owner)
    .sort((a, b) => nodes[a].active - nodes[b].active || a - b);
  const invest = (amount) =>
    amount > 1e-9 ? { source: node.id, type: 'invest', amount, dest: null } : null;
  const attack = (dest, amount) =>
    amount > 1e-9 ? { source: node.id, type: 'attack', amount, dest } : null;

  if (name === 'compoundexpand') {
    // Exact same per-node reserve and reinvestment as Super Turtle.
    // Only difference: spend a bounded part of the reinvestable surplus on
    // viable conquest, on *every* owned node including newly captured ones.
    // Prefer neutral territory to minimize the risk of enemy retaliation.
    const budget = Math.min(free, (node.active * attackPct) / 100);
    const viable = enemies
      .filter((id) => budget > nodes[id].active * 1.5 + 0.1)
      .sort((a, b) =>
        Number(nodes[a].owner !== null) - Number(nodes[b].owner !== null) ||
        nodes[a].active - nodes[b].active || a - b
      );
    const dest = viable[0];
    // Use the least viable commitment instead of dumping the full budget.
    const strike = dest === undefined ? null : attack(
      dest, Math.min(budget, nodes[dest].active * 1.5 + 0.2),
    );
    const savings = invest(free - (strike?.amount ?? 0));
    return [savings, strike].filter(Boolean);
  }

  if (name === 'turtlecounter') {
    // Only the starting node follows the two-phase plan; conquered nodes
    // return to the normal AI on their next round.
    if (!isHome) throw new Error('Captured nodes must use default AI');
    if (round <= turtleRounds) return invest(free);

    // Attack at most this fraction of start-of-round ACTIVE energy.
    // Invested principal is locked and can never be spent directly.
    // Continue preserving the original dynamic defense reserve.
    const budget = Math.min(free, (node.active * attackPct) / 100);
    const target = enemies.find((id) => budget > nodes[id].active * 1.5);
    const strike = target === undefined ? null : attack(target, budget);
    const savings = invest(free - (strike?.amount ?? 0));
    return [savings, strike].filter(Boolean);
  }
  if (name === 'superturtle') {
    // No transfers or attacks, ever. On the initial node, reinvest everything
    // above dynamic defense. In an unthreatened position preserve 3 active.
    return invest(free);
  }
  if (name === 'turtle') {
    // Slow, deliberate neutral expansion, but never attack a player.
    // Preserve defense first and invest most of the expendable energy.
    const neutral = enemies.find(
      (id) => nodes[id].owner === null && free * 0.2 > nodes[id].active * 1.5 + 3,
    );
    if (neutral !== undefined)
      return attack(neutral, Math.min(free * 0.2, nodes[neutral].active * 2 + 4));
    return invest(free * 0.85);
  }
  if (name === 'aggressive') {
    const target = enemies[0];
    // Prioritize early conquest, with a small defensive buffer.
    const committed = Math.max(0, node.active - Math.max(2, node.active * 0.15));
    if (target !== undefined && committed > nodes[target].active * 0.9 + 2) {
      return attack(target, Math.min(committed, nodes[target].active * 1.4 + 3));
    }
    return invest(committed * 0.35);
  }
  if (name === 'balanced') {
    const target = enemies[0];
    if (target !== undefined && free > nodes[target].active * 1.1 + 3) {
      return attack(target, Math.min(free * 0.65, nodes[target].active * 1.4 + 3));
    }
    return invest(free * 0.65);
  }
  throw new Error('Unknown strategy: ' + name);
}

export function planStrategyOrders({
  engine,
  nodes,
  links,
  strategies,
  round = 1,
  homeNodes = [],
  turtleRounds = 150,
  attackPct = 5,
}) {
  // The default profile must behave identically to the pre-strategy harness.
  const defaults = engine.aiOrders(nodes, links, true);
  const adjacent = Array.from({ length: nodes.length }, () => []);
  for (const [a, b] of links) {
    adjacent[a].push(b);
    adjacent[b].push(a);
  }
  const result = {};
  for (const node of nodes) {
    if (node.owner === null) continue;
    const name = strategies[node.owner];
    if (name === 'default' || (name === 'turtlecounter' && node.id !== homeNodes[node.owner])) {
      if (defaults[node.id]) result[node.id] = defaults[node.id];
      continue;
    }
    const order = planNode(node, name, nodes, adjacent[node.id], {
      round,
      turtleRounds,
      attackPct,
      isHome: node.id === homeNodes[node.owner],
    });
    if (order) result[node.id] = order;
  }
  return result;
}
