// Research copy of the live economicAI with two hooks for the Equilibrium
// mode: how targets are ranked and how much a node invests. With the live
// hooks it plans exactly what engine.economicAI plans, which a test pins.

export const LIVE_VALUATION = Object.freeze({ name: 'live', targets: false, investment: false });
export const RESERVE_VALUATION = Object.freeze({
  name: 'reserve',
  targets: true,
  investment: true,
});
export const RESERVE_TARGETS = Object.freeze({ name: 'targets', targets: true, investment: false });
export const RESERVE_INVESTMENT = Object.freeze({
  name: 'investment',
  targets: false,
  investment: true,
});

export function planEquilibriumAI({
  engine,
  nodes,
  reserves,
  links,
  valuationOf = () => LIVE_VALUATION,
}) {
  const { capacity, withdrawalFee } = engine.SOFT_CAP_RULES;
  const orders = {};
  const withdrawals = {};
  const net = 1 - withdrawalFee;
  const adjacent = nodes.map(() => []);
  for (const [a, b] of links) {
    adjacent[a].push(b);
    adjacent[b].push(a);
  }
  const power = (n) => n.active + n.invested * net;
  const load = (n) => n.active + n.invested;
  const weakerAlly = (ally, node) =>
    load(ally) < load(node) || (load(ally) === load(node) && ally.id > node.id);
  const garrison = (n) => Math.min(12, Math.max(2, power(n) * 0.08));
  const captureForce = (target) => target.active * 1.3 + 2;
  const committed = new Set();
  for (const owner of new Set(nodes.map((n) => n.owner).filter((n) => n !== null))) {
    const valuation = valuationOf(owner) ?? LIVE_VALUATION;
    const byPriority = valuation.targets ? richestPerCost : playersThenWeakest;
    const investRoom = valuation.investment ? drainableRoom : capacityRoom;
    const targets = nodes
      .filter(
        (target) =>
          target.owner !== owner &&
          adjacent[target.id].some((source) => nodes[source].owner === owner),
      )
      .sort(byPriority);

    for (const target of targets) {
      const sources = adjacent[target.id]
        .map((id) => nodes[id])
        .filter((n) => n.owner === owner && !committed.has(n.id))
        .map((n) => ({
          node: n,
          reserve: garrison(n),
          capacity: Math.max(0, power(n) - garrison(n)),
          activeFree: Math.max(0, n.active - garrison(n)),
          amount: 0,
        }))
        .sort((a, b) => b.activeFree - a.activeFree || a.node.id - b.node.id);
      const combined = sources.reduce((sum, s) => sum + s.capacity, 0);
      const force = captureForce(target);
      if (combined + 1e-8 < force) continue;

      let remaining = force;
      for (const s of sources) {
        const amount = Math.min(remaining, s.activeFree);
        s.amount += amount;
        remaining -= amount;
      }
      for (const s of sources) {
        if (remaining <= 1e-8) break;
        const amount = Math.min(remaining, s.capacity - s.amount);
        s.amount += amount;
        remaining -= amount;
      }
      if (remaining > 1e-6) continue;
      for (const s of sources) {
        if (s.amount <= 1e-8) continue;
        const n = s.node;
        const withdrawal = Math.min(
          n.invested,
          Math.max(0, (s.amount + s.reserve - n.active) / net),
        );
        if (withdrawal > 1e-8) withdrawals[n.id] = withdrawal;
        orders[n.id] = { source: n.id, type: 'attack', amount: s.amount, dest: target.id };
        committed.add(n.id);
      }
    }

    const distance = distanceToFrontier(owner);
    for (const n of nodes) {
      if (n.owner !== owner || committed.has(n.id)) continue;
      const near = adjacent[n.id];
      const enemies = near.filter((id) => nodes[id].owner !== owner && nodes[id].owner !== null);
      const highestThreat = Math.max(0, ...enemies.map((id) => nodes[id].active));
      const reserve = Math.min(power(n), Math.max(3, highestThreat * 0.65));
      const withdrawal = Math.min(n.invested, Math.max(0, reserve - n.active) / net);
      if (withdrawal > 1e-8) withdrawals[n.id] = withdrawal;
      const free = Math.max(0, n.active + withdrawal * net - reserve);
      const frontier = near
        .filter((id) => nodes[id].owner === owner)
        .filter((id) => adjacent[id].some((other) => nodes[other].owner !== owner))
        .filter((id) => distance[n.id] > 0 || weakerAlly(nodes[id], n))
        .filter((id) => load(nodes[id]) < capacity * 0.8)
        .sort(
          (a, b) =>
            nodes[a].active + nodes[a].invested - nodes[b].active - nodes[b].invested || a - b,
        )[0];
      if (frontier !== undefined && free > 2) {
        const room = capacity - nodes[frontier].active - nodes[frontier].invested;
        const amount = Math.max(0, Math.min(free * 0.7, room));
        if (amount > 1e-8) {
          orders[n.id] = { source: n.id, type: 'transfer', amount, dest: frontier };
          continue;
        }
      }
      const amount = Math.min(free * 0.8, investRoom(n));
      const invest = amount > 1e-8 ? { source: n.id, type: 'invest', amount, dest: null } : null;
      const surplus = free - (invest?.amount ?? 0);
      const towards = nextHopToFrontier(n, distance);
      const forward =
        towards !== undefined && surplus > 2
          ? { source: n.id, type: 'transfer', amount: surplus, dest: towards }
          : null;
      const planned = [invest, forward].filter(Boolean);
      if (planned.length) orders[n.id] = planned.length === 1 ? planned[0] : planned;
    }
  }
  return { orders, withdrawals };

  function playersThenWeakest(a, b) {
    return (
      Number(a.owner === null) - Number(b.owner === null) || a.active - b.active || a.id - b.id
    );
  }

  // A capture hands over everything on the node, the reserve included, and
  // the attacker's own losses land in that reserve too.
  function richestPerCost(a, b) {
    const yieldOf = (n) => (n.active + n.invested + reserves[n.id]) / captureForce(n);
    return yieldOf(b) - yieldOf(a) || a.id - b.id;
  }

  function capacityRoom(n) {
    return Math.max(0, capacity - n.active - n.invested);
  }

  // At rest a node keeps active at 10 + invested while its reserve lasts, so
  // investing half of what the node holds above 10 turns the most of it into
  // spendable energy; more only locks energy in principal.
  function drainableRoom(n) {
    const held = n.active + n.invested + reserves[n.id];
    return Math.min(capacityRoom(n), Math.max(0, (held - 10) / 2 - n.invested));
  }

  function nextHopToFrontier(n, distance) {
    if (!(distance[n.id] >= 1)) return undefined;
    return adjacent[n.id]
      .filter((id) => distance[id] < distance[n.id])
      .sort((a, b) => power(nodes[a]) - power(nodes[b]) || a - b)[0];
  }

  function distanceToFrontier(owner) {
    const distance = nodes.map(() => Infinity);
    const queue = nodes
      .filter((n) => n.owner === owner && adjacent[n.id].some((id) => nodes[id].owner !== owner))
      .map((n) => n.id);
    for (const id of queue) distance[id] = 0;
    for (const id of queue)
      for (const next of adjacent[id]) {
        if (nodes[next].owner !== owner || distance[next] <= distance[id] + 1) continue;
        distance[next] = distance[id] + 1;
        queue.push(next);
      }
    return distance;
  }
}
