'use strict';
// Keep engine declarations out of the global lexical scope used by game.js.
(() => {
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
  function forecast(node, incoming, outgoing) {
    const invest = outgoing.filter((o) => o.type === 'invest').reduce((a, o) => a + o.amount, 0);
    const spent = outgoing.reduce((a, o) => a + o.amount, 0);
    const defense = Math.max(0, node.active - spent);
    return {
      invest,
      incoming,
      defense,
      income: 1 + 0.1 * (node.invested + invest),
      next: 0.9 * (defense + incoming) + 1 + 0.1 * (node.invested + invest),
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

  function resolveRound({
    state,
    orders,
    policies,
    links,
    defaultConquestPolicy = null,
    rng = Math.random,
    aiOrdersOverride = null,
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
    const ai = aiOrdersOverride === null ? Object.values(aiOrders(nodes, links)) : aiOrdersOverride;
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
            (a.owner === 0 ? 'Blue' : 'Red') +
            ' attacks ' +
            (defenderOwner === null ? 'Neutral' : defenderOwner === 0 ? 'Blue' : 'Red') +
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
    for (const id of Object.keys(nextPolicies)) {
      if (nodes[Number(id)].owner !== 0) delete nextPolicies[id];
    }
    let blue = nodes.filter((n) => n.owner === 0).length,
      red = nodes.filter((n) => n.owner !== null && n.owner !== 0).length;
    log('Round ' + state.round + ' complete: Blue ' + blue + ' nodes / Red ' + red + ' nodes.');
    const nextState = { ...state, nodes, round: state.round + 1 };
    const alive = new Set(nodes.filter((n) => n.owner !== null).map((n) => n.owner));
    if (alive.size <= 1) {
      nextState.finished = true;
      log(alive.has(0) ? 'Blue wins by elimination!' : 'An AI player wins by elimination!');
    }
    return { state: nextState, policies: nextPolicies, events };
  }

  globalThis.GameEngine = Object.freeze({
    seeded,
    buildMap,
    evaluatePolicy,
    forecast,
    aiOrders,
    resolveRound,
  });
})();
