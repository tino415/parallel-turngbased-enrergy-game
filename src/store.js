'use strict';

(() => {
  const { evaluatePolicy, forecast, resolveRound, SOFT_CAP_RULES } = GameEngine;
  const HISTORY_LIMIT = 70;
  const sum = (values) => values.reduce((total, value) => total + value, 0);

  const CLASSIC_EDGES = [
    [0, 1],
    [0, 2],
    [1, 3],
    [1, 4],
    [2, 4],
    [2, 5],
    [3, 6],
    [4, 6],
    [4, 7],
    [5, 7],
    [6, 8],
    [7, 8],
    [7, 9],
    [8, 10],
    [9, 10],
    [9, 11],
    [10, 12],
    [11, 12],
    [11, 13],
    [12, 13],
  ];
  const CLASSIC_XY = [
    [70, 230],
    [165, 115],
    [165, 355],
    [280, 70],
    [290, 210],
    [280, 385],
    [415, 105],
    [420, 295],
    [520, 170],
    [530, 375],
    [630, 220],
    [640, 405],
    [725, 300],
    [735, 415],
  ];

  function classicMatch(random, defaults) {
    const N = CLASSIC_XY.length,
      playerCount = 2;
    const nodes = Array.from({ length: N }, (_, id) => ({
      id,
      owner: null,
      active: 3 + random() * (7 - 3),
      invested: 0,
    }));
    for (const [owner, id] of [0, N - 1].entries()) {
      nodes[id].owner = owner;
      nodes[id].active = 24;
      nodes[id].invested = 14;
    }
    return {
      state: { round: 1, nodes, finished: false, rulesVersion: SOFT_CAP_RULES.version },
      orders: {},
      policies: {},
      history: ['New match started. You are Blue.'],
      map: { xy: CLASSIC_XY, edges: CLASSIC_EDGES, N, playerCount, mapSeed: 'classic' },
      defaults,
    };
  }

  function generatedMatch(map, defaults) {
    return {
      state: { round: 1, nodes: map.nodes, finished: false, rulesVersion: SOFT_CAP_RULES.version },
      orders: {},
      policies: {},
      history: [
        'Generated ' + map.nodes.length + ' nodes, ' + map.players + ' players, seed ' + map.seed,
      ],
      map: {
        xy: map.positions,
        edges: map.links,
        N: map.nodes.length,
        playerCount: map.players,
        mapSeed: map.seed,
      },
      defaults,
    };
  }

  function matchFromSave(save, defaults) {
    if (
      !save?.state ||
      !Array.isArray(save.state.nodes) ||
      !Array.isArray(save.xy) ||
      !Array.isArray(save.edges)
    )
      return null;
    const { state, xy, edges, N, playerCount, mapSeed } = save;
    return withOneWaySupport({
      state,
      orders: save.orders ?? {},
      policies: save.policies ?? {},
      history: ['Recovered saved match from this browser.', ...(save.history ?? [])],
      map: { xy, edges, N, playerCount, mapSeed },
      defaults: save.defaults
        ? {
            enabled: Boolean(save.defaults.enabled),
            reserve: save.defaults.reserve,
            invest: save.defaults.invest,
          }
        : defaults,
    });
  }

  function withOneWaySupport(match) {
    return withOneWayRoutes(withOneWayManualSupport(match));
  }

  function withOneWayManualSupport(match) {
    return match.map.edges.reduce((next, [a, b]) => {
      const forward = plan(next, a).edges[b] || 0,
        backward = plan(next, b).edges[a] || 0;
      if (!forward || !backward) return next;
      const [source, destination] = forward >= backward ? [a, b] : [b, a],
        p = plan(next, source),
        edges = { ...p.edges, [destination]: Math.abs(forward - backward) };
      if (forward === backward) delete edges[destination];
      return withoutManualSupport(withOrder(next, source, { ...p, edges }), destination, source);
    }, match);
  }

  function withOneWayRoutes(match) {
    return match.map.edges.reduce((next, [a, b]) => {
      if (next.policies[a]?.dest !== b || next.policies[b]?.dest !== a) return next;
      return {
        ...next,
        policies: {
          ...next.policies,
          [a]: { ...next.policies[a], dest: null },
          [b]: { ...next.policies[b], dest: null },
        },
        history: [
          'Node ' + a + ' and Node ' + b + ' sent surplus to each other; both routes were cleared.',
          ...next.history,
        ],
      };
    }, match);
  }

  function saveFromMatch(match, selected) {
    const { state, orders, policies, history, map, defaults } = match;
    return { state, orders, policies, ...map, history, selected, defaults };
  }

  const neighbors = (match, id) =>
    match.map.edges.flatMap(([a, b]) => (a === id ? [b] : b === id ? [a] : []));
  const isOwn = (match, id) => match.state.nodes[id]?.owner === 0;
  const softCapEnabled = (match) => match.state?.rulesVersion === SOFT_CAP_RULES.version;
  const defaultPolicy = () => ({ enabled: true, reserve: 5, investPct: 50, dest: null });
  const plan = (match, source) => match.orders[source] ?? { invest: 0, withdraw: 0, edges: {} };
  const allocated = (match, source, p = plan(match, source)) =>
    p.invest + sum(Object.values(p.edges));
  const withdrawal = (match, source, p = plan(match, source)) =>
    softCapEnabled(match) ? p.withdraw || 0 : 0;
  const availableEnergy = (match, source, p = plan(match, source)) =>
    match.state.nodes[source].active +
    withdrawal(match, source, p) * (1 - SOFT_CAP_RULES.withdrawalFee);

  function policyOrders(match, source) {
    return evaluatePolicy({
      policy: match.policies[source],
      node: { ...match.state.nodes[source], active: availableEnergy(match, source) },
      manualSpent: allocated(match, source),
      manualHold: Boolean(plan(match, source).hold),
      neighbors: neighbors(match, source),
      owners: match.state.nodes.map((n) => n.owner),
      source,
    });
  }

  function previewOrders(match) {
    const manual = Object.entries(match.orders).flatMap(([source, p]) => [
      ...(p.invest > 0
        ? [{ source: Number(source), type: 'invest', amount: p.invest, automatic: false }]
        : []),
      ...Object.entries(p.edges).map(([dest, amount]) => ({
        source: Number(source),
        dest: Number(dest),
        amount,
        type: isOwn(match, Number(dest)) ? 'transfer' : 'attack',
        automatic: false,
      })),
    ]);
    const automatic = Object.keys(match.policies)
      .map(Number)
      .flatMap((source) => policyOrders(match, source));
    return [...manual, ...automatic];
  }

  function projection(match, id) {
    const scheduled = previewOrders(match),
      incoming = sum(
        scheduled.filter((o) => o.dest === id && o.type === 'transfer').map((o) => o.amount),
      );
    return forecast(
      match.state.nodes[id],
      incoming,
      scheduled.filter((o) => o.source === id),
      { softCap: softCapEnabled(match), withdraw: withdrawal(match, id) },
    );
  }

  function withOrder(match, source, p) {
    const orders = { ...match.orders };
    if (allocated(match, source, p) < 1e-9 && !p.hold && !p.withdraw) delete orders[source];
    else orders[source] = p;
    return { ...match, orders };
  }

  function withoutManualSupport(match, source, destination) {
    const p = plan(match, source);
    if (!p.edges[destination]) return match;
    const edges = { ...p.edges };
    delete edges[destination];
    return withOrder(match, source, { ...p, edges });
  }

  function withPolicy(match, source, policy) {
    const policies = { ...match.policies, [source]: policy };
    if (policies[policy.dest]?.dest === source)
      policies[policy.dest] = { ...policies[policy.dest], dest: null };
    return { ...match, policies };
  }

  const replacedSupport = (match, source, destination) => ({
    manual: plan(match, destination).edges[source] || 0,
    route: match.policies[destination]?.dest === source,
  });

  function setAllocation(match, source, destination, value) {
    if (match.state.finished || !isOwn(match, source)) return { match };
    const amount = Number(value),
      node = match.state.nodes[source],
      current = plan(match, source),
      p = {
        invest: current.invest,
        withdraw: withdrawal(match, source),
        edges: { ...current.edges },
        hold: current.hold || false,
      };
    if (!Number.isFinite(amount) || amount < 0) return { match };
    if (destination === 'withdraw' && softCapEnabled(match)) {
      if (amount > node.invested + 1e-8) return { match };
      p.withdraw = amount;
    } else if (destination === null) p.invest = amount;
    else if (neighbors(match, source).includes(destination)) {
      if (amount === 0) delete p.edges[destination];
      else p.edges[destination] = amount;
    } else return { match };
    if (allocated(match, source, p) > availableEnergy(match, source, p) + 1e-8)
      return { match, overBudget: availableEnergy(match, source, p) };
    const next = withOrder(match, source, p);
    if (amount > 0 && isOwn(match, destination))
      return { match: withoutManualSupport(next, destination, source) };
    return { match: next };
  }

  function setHold(match, source, hold) {
    const current = plan(match, source),
      p = { ...current, edges: { ...current.edges }, hold };
    const orders = { ...match.orders };
    if (allocated(match, source, p) === 0 && !p.hold && !p.withdraw) delete orders[source];
    else orders[source] = p;
    return { ...match, orders };
  }

  function clearNodeOrders(match, source) {
    if (!(source in match.orders)) return match;
    const orders = { ...match.orders };
    delete orders[source];
    return { ...match, orders };
  }

  function clearAllOrders(match) {
    return Object.keys(match.orders).length ? { ...match, orders: {} } : match;
  }

  function changePolicy(match, source, key, value) {
    return withPolicy(match, source, {
      ...defaultPolicy(),
      ...match.policies[source],
      [key]: value,
    });
  }

  function enablePolicyWith(match, source, fields) {
    return withPolicy(match, source, {
      ...defaultPolicy(),
      ...match.policies[source],
      enabled: true,
      ...fields,
    });
  }

  function disablePolicy(match, source) {
    if (!match.policies[source]) return match;
    return withPolicy(match, source, { ...match.policies[source], enabled: false });
  }

  function pastePolicy(match, source, copied) {
    const dest =
      neighbors(match, source).includes(copied.dest) && isOwn(match, copied.dest)
        ? copied.dest
        : null;
    return withPolicy(match, source, { ...copied, dest });
  }

  function routeSurplus(match, source, destination, enabled) {
    if (enabled) return enablePolicyWith(match, source, { dest: destination });
    if (match.policies[source]?.dest !== destination) return match;
    return withPolicy(match, source, { ...match.policies[source], dest: null });
  }

  function applyBulkPolicy(match, ids, reserve, investPct) {
    return ids
      .filter((id) => isOwn(match, id))
      .reduce((next, id) => enablePolicyWith(next, id, { reserve, investPct }), match);
  }

  function applyBulkInvestment(match, ids, amount) {
    return ids.reduce((next, id) => {
      const current = plan(next, id),
        p = { ...current, edges: { ...current.edges } },
        available = availableEnergy(next, id, p) - sum(Object.values(p.edges));
      if (amount > available + 1e-8) return next;
      p.invest = amount;
      return withOrder(next, id, p);
    }, match);
  }

  function setDefaults(match, defaults) {
    return { ...match, defaults: { ...match.defaults, ...defaults } };
  }

  function conquestPolicy(defaults) {
    if (!defaults.enabled) return null;
    return {
      enabled: true,
      reserve: Math.max(0, Number(defaults.reserve) || 0),
      investPct: Math.max(0, Math.min(100, Number(defaults.invest) || 0)),
    };
  }

  function resolve(match, rng = Math.random) {
    if (match.state.finished) return match;
    const result = resolveRound({
      state: match.state,
      playerCount: match.map.playerCount,
      orders: match.orders,
      policies: match.policies,
      links: match.map.edges,
      defaultConquestPolicy: conquestPolicy(match.defaults),
      rng,
    });
    const history = result.events
      .reduce((lines, event) => [event, ...lines], match.history)
      .slice(0, HISTORY_LIMIT);
    return { ...match, state: result.state, policies: result.policies, orders: {}, history };
  }

  const INITIAL_UI = { view: 'map', clipboard: null, bulkSelection: [] };

  function createStore() {
    let snapshot = Object.freeze({ match: null, ui: Object.freeze(INITIAL_UI) });
    const listeners = new Set();

    function commit(slice, next) {
      if (snapshot[slice] === next) return;
      const previous = snapshot;
      snapshot = Object.freeze({ ...snapshot, [slice]: next });
      for (const listener of listeners) listener(snapshot, previous);
    }
    const onMatch =
      (command) =>
      (...args) =>
        commit('match', command(snapshot.match, ...args));
    const setUi = (key, value) => {
      if (snapshot.ui[key] !== value) commit('ui', Object.freeze({ ...snapshot.ui, [key]: value }));
    };
    const bulkSelectionWith = (id, selected) => {
      const others = snapshot.ui.bulkSelection.filter((other) => other !== id);
      return selected ? [...others, id] : others;
    };

    return {
      getSnapshot: () => snapshot,
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      replaceMatch: (match) => commit('match', match),
      setAllocation(source, destination, value) {
        const result = setAllocation(snapshot.match, source, destination, value);
        commit('match', result.match);
        return result.overBudget;
      },
      setHold: onMatch(setHold),
      clearNodeOrders: onMatch(clearNodeOrders),
      clearAllOrders: onMatch(clearAllOrders),
      changePolicy: onMatch(changePolicy),
      enablePolicyWith: onMatch(enablePolicyWith),
      disablePolicy: onMatch(disablePolicy),
      pastePolicy: onMatch(pastePolicy),
      routeSurplus: onMatch(routeSurplus),
      applyBulkPolicy: onMatch(applyBulkPolicy),
      applyBulkInvestment: onMatch(applyBulkInvestment),
      setDefaults: onMatch(setDefaults),
      resolve: onMatch(resolve),
      setView: (view) => setUi('view', view),
      copyPolicy: (policy) => setUi('clipboard', { ...policy }),
      setBulkSelected(id, selected) {
        if (snapshot.ui.bulkSelection.includes(id) !== selected)
          setUi('bulkSelection', bulkSelectionWith(id, selected));
      },
    };
  }

  globalThis.GameStore = Object.freeze({
    createStore,
    classicMatch,
    generatedMatch,
    matchFromSave,
    saveFromMatch,
    commands: Object.freeze({
      setAllocation,
      setHold,
      clearNodeOrders,
      clearAllOrders,
      changePolicy,
      enablePolicyWith,
      disablePolicy,
      pastePolicy,
      routeSurplus,
      applyBulkPolicy,
      applyBulkInvestment,
      setDefaults,
      resolve,
    }),
    selectors: Object.freeze({
      neighbors,
      softCapEnabled,
      defaultPolicy,
      plan,
      allocated,
      withdrawal,
      availableEnergy,
      policyOrders,
      previewOrders,
      projection,
      replacedSupport,
    }),
  });
})();
