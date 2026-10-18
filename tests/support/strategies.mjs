// Simulation-only strategies. Never used by the browser gameplay loop.
export const STRATEGIES = Object.freeze([
  'default',
  'turtle',
  'extreme-turtle',
  'aggressive',
  'balanced',
]);

export function resolveStrategies({
  players,
  blueStrategy = 'default',
  opponentStrategy = 'default',
  strategies = null,
}) {
  const chosen = strategies ?? [
    blueStrategy,
    ...Array.from({ length: players - 1 }, () => opponentStrategy),
  ];
  if (!Number.isInteger(players) || chosen.length !== players) {
    throw new Error('Exactly one strategy is required per player');
  }
  for (const strategy of chosen) {
    if (!STRATEGIES.includes(strategy)) {
      throw new Error('Unknown strategy: ' + strategy + '. Choose: ' + STRATEGIES.join(', '));
    }
  }
  return [...chosen];
}

function neighborsFor(links, count) {
  const adjacent = Array.from({ length: count }, () => []);
  for (const [a, b] of links) {
    adjacent[a].push(b);
    adjacent[b].push(a);
  }
  return adjacent;
}

function invest(node, amount) {
  return amount > 1e-9 ? { source: node.id, type: 'invest', amount, dest: null } : null;
}

function defenseReserve(node, neighbors, nodes) {
  const enemyPower = Math.max(
    0,
    ...neighbors
      .filter((id) => nodes[id].owner !== null && nodes[id].owner !== node.owner)
      .map((id) => nodes[id].active),
  );
  // Reserve against neighbors, and retain part of the growing energy pool.
  return Math.min(node.active, Math.max(8, node.active * 0.35, enemyPower * 1.4 + 3));
}

function specializedOrder(strategy, node, neighbors, nodes) {
  const reserve = defenseReserve(node, neighbors, nodes);
  const surplus = Math.max(0, node.active - reserve);
  if (strategy === 'extreme-turtle') {
    // Never attack or transfer. Each player begins with one owned node.
    return invest(node, surplus);
  }
  if (strategy === 'turtle') {
    // Expand only into neutral territory, and only when the defense reserve is safe.
    const neutrals = neighbors
      .filter((id) => nodes[id].owner === null)
      .sort((a, b) => nodes[a].active - nodes[b].active);
    if (neutrals.length) {
      const dest = neutrals[0];
      const required = nodes[dest].active * 1.6 + 4;
      if (surplus >= required + 2) {
        return { source: node.id, type: 'attack', amount: required, dest };
      }
    }
    return invest(node, surplus);
  }
  if (strategy === 'aggressive') {
    const foes = neighbors
      .filter((id) => nodes[id].owner !== node.owner)
      .sort((a, b) => nodes[a].active - nodes[b].active);
    if (foes.length && node.active > nodes[foes[0]].active * 0.75 + 2) {
      const dest = foes[0];
      return {
        source: node.id,
        type: 'attack',
        amount: Math.min(node.active * 0.95, nodes[dest].active * 1.5 + 4),
        dest,
      };
    }
    return invest(node, node.active * 0.35);
  }
  if (strategy === 'balanced') {
    const foes = neighbors
      .filter((id) => nodes[id].owner !== node.owner)
      .sort((a, b) => nodes[a].active - nodes[b].active);
    if (foes.length) {
      const dest = foes[0];
      const required = nodes[dest].active * 1.5 + 4;
      if (surplus >= required + 4) {
        return { source: node.id, type: 'attack', amount: required, dest };
      }
    }
    return invest(node, surplus * 0.65);
  }
  throw new Error('Unhandled strategy: ' + strategy);
}

export function planStrategyOrders({ nodes, links, strategies, engine }) {
  if (strategies.length === 0) throw new Error('No strategies configured');
  const allDefault = engine.aiOrders(nodes, links, true);
  const adjacency = neighborsFor(links, nodes.length);
  const orders = {};
  for (const node of nodes) {
    if (node.owner === null) continue;
    const strategy = strategies[node.owner];
    if (!STRATEGIES.includes(strategy))
      throw new Error('Invalid strategy for player ' + node.owner);
    const order =
      strategy === 'default'
        ? (allDefault[node.id] ?? null)
        : specializedOrder(strategy, node, adjacency[node.id], nodes);
    if (order) orders[node.id] = order;
  }
  return orders;
}
