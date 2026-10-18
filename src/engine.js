'use strict';
// Keep engine declarations out of the global lexical scope used by game.js.
(() => {
  // Keep combat labels and map colors tied to the same player identity.
  const players = [
    { name: 'Blue', color: '#3278c8' },
    { name: 'Red', color: '#cc6255' },
    { name: 'Purple', color: '#b18adc' },
    { name: 'Orange', color: '#d9a44d' },
    { name: 'Green', color: '#72b995' },
    { name: 'Pink', color: '#da7dba' },
  ];
  const playerName = (owner) => (owner === null ? 'Neutral' : players[owner].name);
  const playerColor = (owner) => (owner === null ? '#768092' : players[owner].color);

  // Version 2 is enabled for NEW matches; legacy autosaves retain original rules.
  const SOFT_CAP_RULES = Object.freeze({
    version: 2,
    capacity: 250,
    overflowDecay: 0.25,
    withdrawalFee: 0.05,
  });
  const isSoftCap = (state) => state.rulesVersion === SOFT_CAP_RULES.version;

  // Pure, browser-independent map and economy functions.
  function seeded(seed) {
    let h = 2166136261;
    for (const c of String(seed)) {
      h = Math.imul(h ^ c.charCodeAt(0), 16777619);
    }
    return () => {
      h += 0x6d2b79f5;
      let t = h;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function buildMap({ count, players, density, seed }) {
    const random = seeded(seed),
      columns = Math.ceil(Math.sqrt(count * 1.75)),
      rows = Math.ceil(count / columns);
    const cellW = 1680 / columns,
      cellH = 920 / rows,
      cells = [];
    for (let row = 0; row < rows; row++)
      for (let col = 0; col < columns; col++) cells.push([col, row]);
    for (let i = cells.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [cells[i], cells[j]] = [cells[j], cells[i]];
    }
    const positions = cells
      .slice(0, count)
      .map(([col, row]) => [
        60 + (col + 0.5 + (random() - 0.5) * 0.24) * cellW,
        50 + (row + 0.5 + (random() - 0.5) * 0.24) * cellH,
      ]);
    // Spacing is guaranteed by jittered grid cells: ≥ 76% of a cell between neighbors.
    const chosen = new Set([0]),
      links = [];
    while (chosen.size < count) {
      let best = null;
      for (const a of chosen)
        for (let b = 0; b < count; b++) {
          if (chosen.has(b)) continue;
          const d =
            (positions[a][0] - positions[b][0]) ** 2 + (positions[a][1] - positions[b][1]) ** 2;
          if (!best || d < best.d) best = { a, b, d };
        }
      links.push([best.a, best.b]);
      chosen.add(best.b);
    }
    const existing = new Set(links.map(([a, b]) => [a, b].sort((x, y) => x - y).join(':')));
    const candidates = [];
    for (let a = 0; a < count; a++)
      for (let b = a + 1; b < count; b++) {
        if (existing.has(a + ':' + b)) continue;
        const d =
          (positions[a][0] - positions[b][0]) ** 2 + (positions[a][1] - positions[b][1]) ** 2;
        candidates.push({ a, b, score: d * (0.6 + random() * 0.8) });
      }
    candidates.sort((a, b) => a.score - b.score);
    const extra = Math.round(
      count * (density === 'dense' ? 1.25 : density === 'sparse' ? 0.2 : 0.65),
    );
    for (const x of candidates.slice(0, extra)) links.push([x.a, x.b]);
    const starters = [Math.floor(random() * count)];
    while (starters.length < players) {
      let best = -1,
        score = -1;
      for (let i = 0; i < count; i++) {
        if (starters.includes(i)) continue;
        const min = Math.min(
          ...starters.map(
            (j) =>
              (positions[i][0] - positions[j][0]) ** 2 + (positions[i][1] - positions[j][1]) ** 2,
          ),
        );
        if (min > score) {
          score = min;
          best = i;
        }
      }
      starters.push(best);
    }
    const nodes = Array.from({ length: count }, (_, id) => ({
      id,
      owner: null,
      active: 3 + random() * 4,
      invested: 0,
    }));
    for (let p = 0; p < players; p++) {
      nodes[starters[p]].owner = p;
      nodes[starters[p]].active = 24;
      nodes[starters[p]].invested = 14;
    }
    return { positions, links, nodes, seed, players };
  }

  function evaluatePolicy({ policy, node, manualSpent, manualHold, neighbors, owners, source }) {
    if (!policy || !policy.enabled || !node || node.owner !== 0 || manualHold) return [];
    const surplus = Math.max(0, node.active - manualSpent - policy.reserve);
    const invest = (surplus * policy.investPct) / 100;
    const transfer =
      policy.dest !== null && neighbors.includes(policy.dest) && owners[policy.dest] === 0
        ? surplus - invest
        : 0;
    const result = [];
    if (invest > 1e-9)
      result.push({ source, type: 'invest', amount: invest, dest: null, automatic: true });
    if (transfer > 1e-9)
      result.push({
        source,
        type: 'transfer',
        amount: transfer,
        dest: policy.dest,
        automatic: true,
      });
    return result;
  }
  function applyOverflow(node, rules = SOFT_CAP_RULES) {
    const next = { ...node };
    const total = Math.max(0, next.active + next.invested);
    const loss =
      node.owner === null ? 0 : Math.max(0, total - rules.capacity) * rules.overflowDecay;
    if (loss > 0 && total > 0) {
      next.active = Math.max(0, next.active * (1 - loss / total));
      next.invested = Math.max(0, next.invested * (1 - loss / total));
    }
    return { node: next, loss };
  }

  function forecast(node, incoming, outgoing, options = {}) {
    const withdraw = options.softCap
      ? Math.min(node.invested, Math.max(0, options.withdraw || 0))
      : 0;
    const invest = outgoing.filter((o) => o.type === 'invest').reduce((a, o) => a + o.amount, 0);
    const spent = outgoing.reduce((a, o) => a + o.amount, 0);
    const available = node.active + withdraw * (1 - SOFT_CAP_RULES.withdrawalFee);
    const defense = Math.max(0, available - spent);
    const invested = node.invested - withdraw + invest;
    const income = 1 + 0.1 * invested;
    const beforeOverflow = { ...node, active: 0.9 * (defense + incoming) + income, invested };
    const projection = options.softCap
      ? applyOverflow(beforeOverflow)
      : { node: beforeOverflow, loss: 0 };
    return {
      invest,
      withdraw,
      available,
      incoming,
      defense,
      income,
      next: projection.node.active,
      nextInvested: projection.node.invested,
      overflow: projection.loss,
      capacity: options.softCap ? SOFT_CAP_RULES.capacity : null,
      total: projection.node.active + projection.node.invested,
    };
  }
  function aiOrders(nodes, links, includePlayerZero = false) {
    const planned = {};
    const ns = nodes;
    const neighbors = (i) => links.flatMap(([a, b]) => (a === i ? [b] : b === i ? [a] : []));
    for (const node of ns.filter((n) => n.owner !== null && (includePlayerZero || n.owner !== 0))) {
      const adj = neighbors(node.id),
        foes = adj.filter((id) => ns[id].owner !== node.owner),
        friends = adj.filter((id) => ns[id].owner === node.owner);
      let active = node.active;
      if (foes.length) {
        foes.sort((a, b) => ns[a].active - ns[b].active);
        const t = foes[0];
        if (active > ns[t].active * 0.9 + 2) {
          planned[node.id] = {
            source: node.id,
            type: 'attack',
            amount: Math.min(active, ns[t].active * 1.4 + 3),
            dest: t,
          };
          continue;
        }
      }
      if (friends.length && active > 10) {
        const towards = friends.sort(
          (a, b) =>
            neighbors(b).filter((k) => ns[k].owner !== node.owner).length -
            neighbors(a).filter((k) => ns[k].owner !== node.owner).length,
        );
        if (neighbors(towards[0]).some((k) => ns[k].owner !== node.owner)) {
          planned[node.id] = {
            source: node.id,
            type: 'transfer',
            amount: active * 0.5,
            dest: towards[0],
          };
          continue;
        }
      }
      if (active > 3)
        planned[node.id] = { source: node.id, type: 'invest', amount: active * 0.6, dest: null };
    }
    return planned;
  }

  // Capacity-aware AI, separate from the legacy strategy. Every player (not
  // only Blue) gets identical reserve withdrawal and frontier logistics rules.
  function economicAI(nodes, links, includePlayerZero = false) {
    const orders = {};
    const withdrawals = {};
    const adjacent = (id) => links.flatMap(([a, b]) => (a === id ? [b] : b === id ? [a] : []));
    for (const n of nodes) {
      if (n.owner === null || (n.owner === 0 && !includePlayerZero)) continue;
      const near = adjacent(n.id);
      const hostiles = near.filter((id) => nodes[id].owner !== n.owner);
      const owned = near.filter((id) => nodes[id].owner === n.owner);
      const threat = hostiles.reduce(
        (sum, id) => (nodes[id].owner === null ? sum : sum + nodes[id].active),
        0,
      );
      const reserve = Math.max(3, threat * 1.5 + 2);
      const net = 1 - SOFT_CAP_RULES.withdrawalFee;
      const possible = n.active + n.invested * net;
      const defensiveWithdrawal = Math.min(n.invested, Math.max(0, reserve - n.active) / net);
      const targets = hostiles.sort(
        (a, b) =>
          Number(nodes[a].owner !== null) - Number(nodes[b].owner !== null) ||
          nodes[a].active - nodes[b].active ||
          a - b,
      );
      const target = targets[0];
      const attackEnergy = target === undefined ? Infinity : nodes[target].active * 1.5 + 0.5;
      let withdrawal = defensiveWithdrawal;
      let available = n.active + withdrawal * net;
      // Allow limited mobilization for a conquest; don't drain all capital.
      if (target !== undefined && available - reserve < attackEnergy) {
        const mobilize = Math.min(n.invested * 0.3, (reserve + attackEnergy - n.active) / net);
        withdrawal = Math.max(withdrawal, mobilize);
        available = n.active + withdrawal * net;
      }
      if (withdrawal > 1e-9) withdrawals[n.id] = withdrawal;
      const free = Math.max(0, available - Math.min(reserve, possible));
      if (target !== undefined && attackEnergy <= free + 1e-8) {
        const invest = Math.max(0, free - attackEnergy);
        orders[n.id] = [
          { source: n.id, type: 'attack', amount: attackEnergy, dest: target },
          ...(invest > 1e-9 ? [{ source: n.id, type: 'invest', amount: invest, dest: null }] : []),
        ];
        continue;
      }
      // Rear nodes support an under-cap frontier rather than hoarding
      // beyond the soft cap. Transfer cannot finance the receiver this turn.
      const frontier = owned
        .filter((id) => adjacent(id).some((other) => nodes[other].owner !== n.owner))
        .filter((id) => nodes[id].active + nodes[id].invested < SOFT_CAP_RULES.capacity * 0.8)
        .sort(
          (a, b) =>
            nodes[a].active + nodes[a].invested - (nodes[b].active + nodes[b].invested) || a - b,
        )[0];
      if (frontier !== undefined && free > 2) {
        const room = SOFT_CAP_RULES.capacity - nodes[frontier].active - nodes[frontier].invested;
        const amount = Math.max(0, Math.min(free * 0.7, room));
        if (amount > 1e-9) {
          orders[n.id] = { source: n.id, type: 'transfer', amount, dest: frontier };
          continue;
        }
      }
      // Avoid investment when it simply causes preventable over-cap decay.
      const room = Math.max(0, SOFT_CAP_RULES.capacity - n.active - n.invested);
      const amount = Math.min(free * 0.8, room);
      if (amount > 1e-9)
        orders[n.id] = {
          source: n.id,
          type: 'invest',
          amount,
          dest: null,
        };
    }
    return { orders, withdrawals };
  }

  function resolveRound({
    state,
    playerCount = state.playerCount ?? Math.max(2, ...state.nodes.map((n) => (n.owner ?? -1) + 1)),
    orders,
    policies,
    links,
    defaultConquestPolicy = null,
    rng = Math.random,
    aiOrdersOverride = null,
    aiWithdrawalsOverride = null,
  }) {
    if (state.finished) return { state, policies, events: [] };
    const nodes = state.nodes.map((n) => ({ ...n })),
      nextPolicies = { ...policies },
      events = [];
    const neighbors = (i) => links.flatMap(([a, b]) => (a === i ? [b] : b === i ? [a] : []));
    const fmt = (v) => v.toFixed(1),
      log = (message) => events.push(message),
      rnd = (a, b) => a + rng() * (b - a),
      clamp = (v) => Math.max(0, v);
    const softCap = isSoftCap(state);
    const aiPlan = softCap && aiOrdersOverride === null ? economicAI(state.nodes, links) : null;
    // Withdrawal is a start-of-round order: it can fund an action from this
    // source, but neither an incoming transfer nor a later capture can.
    if (softCap) {
      const requested = {};
      for (const [id, p] of Object.entries(orders || {})) {
        if (state.nodes[Number(id)]?.owner === 0) requested[id] = p.withdraw ?? 0;
      }
      const aiWithdrawals = aiWithdrawalsOverride ?? aiPlan?.withdrawals ?? {};
      for (const [id, amount] of Object.entries(aiWithdrawals)) {
        if (state.nodes[Number(id)]?.owner !== null && state.nodes[Number(id)]?.owner !== 0)
          requested[id] = amount;
      }
      for (const [source, amount] of Object.entries(requested)) {
        const n = nodes[Number(source)];
        if (
          !n ||
          n.owner === null ||
          !Number.isFinite(amount) ||
          amount < 0 ||
          amount > n.invested + 1e-8
        )
          continue;
        const withdrawal = Math.min(amount, n.invested);
        n.invested -= withdrawal;
        n.active += withdrawal * (1 - SOFT_CAP_RULES.withdrawalFee);
      }
    }
    const allocated = (p) => p.invest + Object.values(p.edges).reduce((sum, n) => sum + n, 0);
    const manual = Object.entries(orders).flatMap(([source, p]) => [
      ...(p.invest > 0
        ? [{ source: Number(source), type: 'invest', amount: p.invest, dest: null }]
        : []),
      ...Object.entries(p.edges)
        .filter(([, amount]) => amount > 0)
        .map(([dest, amount]) => ({
          source: Number(source),
          type: nodes[Number(dest)].owner === 0 ? 'transfer' : 'attack',
          amount,
          dest: Number(dest),
        })),
    ]);
    const automatic = Object.keys(policies)
      .map(Number)
      .flatMap((source) =>
        evaluatePolicy({
          source,
          policy: policies[source],
          node: nodes[source],
          manualSpent: allocated(orders[source] ?? { invest: 0, edges: {} }),
          manualHold: Boolean(orders[source]?.hold),
          neighbors: neighbors(source),
          owners: nodes.map((n) => n.owner),
        }),
      );
    const ai =
      aiOrdersOverride === null
        ? Object.values(aiPlan ? aiPlan.orders : aiOrders(nodes, links)).flat()
        : aiOrdersOverride;
    const all = [...manual, ...automatic, ...ai];
    const valid = [],
      spent = {};
    for (const o of all) {
      const n = nodes[o.source];
      if (
        !n ||
        n.owner === null ||
        o.amount <= 0 ||
        (spent[o.source] || 0) + o.amount > n.active + 1e-8
      )
        continue;
      if (o.type !== 'invest' && !neighbors(o.source).includes(o.dest)) continue;
      if (o.type === 'transfer' && nodes[o.dest].owner !== n.owner) continue;
      if (o.type === 'attack' && nodes[o.dest].owner === n.owner) continue;
      spent[o.source] = (spent[o.source] || 0) + o.amount;
      valid.push({ ...o, owner: n.owner });
    }
    for (const o of valid) nodes[o.source].active = clamp(nodes[o.source].active - o.amount);
    for (const o of valid.filter((o) => o.type === 'invest')) nodes[o.source].invested += o.amount;
    for (const o of valid.filter((o) => o.type === 'transfer')) nodes[o.dest].active += o.amount;
    const battles = {};
    for (const o of valid.filter((o) => o.type === 'attack')) {
      const key = o.dest + ':' + o.owner;
      if (!battles[key]) battles[key] = { dest: o.dest, owner: o.owner, amount: 0 };
      battles[key].amount += o.amount;
    }
    const byTarget = {};
    for (const attack of Object.values(battles)) (byTarget[attack.dest] ??= []).push(attack);
    for (const [destination, attacks] of Object.entries(byTarget)) {
      const node = nodes[Number(destination)],
        original = node.owner;
      for (let i = attacks.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [attacks[i], attacks[j]] = [attacks[j], attacks[i]];
      }
      for (const a of attacks) {
        if (node.owner === a.owner) {
          node.active += a.amount;
          continue;
        }
        const defenderOwner = node.owner,
          defenderBefore = node.active;
        const atk = a.amount * rnd(0.8, 1.2),
          def = defenderBefore * rnd(0.8, 1.2);
        let attackerSurvived = 0,
          defenderSurvived = 0;
        if (atk > def) {
          attackerSurvived = a.amount * (1 - def / atk);
          node.owner = a.owner;
          node.active = attackerSurvived;
        } else {
          defenderSurvived = defenderBefore * (1 - atk / Math.max(def, 1e-10));
          node.active = defenderSurvived;
        }
        const attackerLoss = a.amount - attackerSurvived;
        const defenderLoss = defenderBefore - defenderSurvived;
        log(
          'Round ' +
            state.round +
            ' · Node ' +
            node.id +
            ': ' +
            playerName(a.owner) +
            ' attacks ' +
            playerName(defenderOwner) +
            ' with ' +
            fmt(a.amount) +
            ' vs ' +
            fmt(defenderBefore) +
            '. ' +
            (atk > def ? 'Captured!' : 'Defended!') +
            ' Attacker lost ' +
            fmt(attackerLoss) +
            ', defender lost ' +
            fmt(defenderLoss) +
            '. Remaining ' +
            fmt(atk > def ? attackerSurvived : defenderSurvived) +
            '.',
        );
      }
      if (node.owner !== original) {
        node.invested *= rnd(0.25, 0.75);
        if (node.owner === 0 && defaultConquestPolicy) {
          nextPolicies[node.id] = { ...defaultConquestPolicy, dest: null };
        }
      }
    }
    for (const n of nodes) {
      const income = 1 + n.invested * 0.1;
      n.active = clamp(n.active * 0.9 + income);
    }
    if (softCap) {
      let totalLoss = 0;
      for (const n of nodes) {
        const projection = applyOverflow(n);
        n.active = projection.node.active;
        n.invested = projection.node.invested;
        totalLoss += projection.loss;
      }
      if (totalLoss > 0.05)
        log('Round ' + state.round + ' · Overflow decay destroyed ' + fmt(totalLoss) + ' energy.');
    }
    for (const id of Object.keys(nextPolicies)) {
      if (nodes[Number(id)].owner !== 0) delete nextPolicies[id];
    }
    const standings = Array.from({ length: playerCount }, (_, owner) => {
      const count = nodes.filter((n) => n.owner === owner).length;
      return playerName(owner) + ' ' + count + ' nodes';
    });
    log('Round ' + state.round + ' complete: ' + standings.join(' / ') + '.');
    // Preserve eliminated players in later summaries, including engine-only callers.
    const nextState = { ...state, playerCount, nodes, round: state.round + 1 };
    const alive = new Set(nodes.filter((n) => n.owner !== null).map((n) => n.owner));
    if (alive.size <= 1) {
      nextState.finished = true;
      log(
        alive.size === 1
          ? playerName([...alive][0]) + ' wins by elimination!'
          : 'No players remain.',
      );
    }
    return { state: nextState, policies: nextPolicies, events };
  }

  globalThis.GameEngine = Object.freeze({
    playerName,
    playerColor,
    seeded,
    buildMap,
    evaluatePolicy,
    forecast,
    aiOrders,
    economicAI,
    SOFT_CAP_RULES,
    applyOverflow,
    resolveRound,
  });
})();
