'use strict';

(() => {
  const { planPolicy, forecast, resolveRound, SOFT_CAP_RULES } = GameEngine;
  const HISTORY_LIMIT = 70;
  const TARGET_EPSILON = 1e-6;
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
    return {
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
    };
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
  const policyWithdrawal = (match, source, p = plan(match, source)) =>
    GameEngine.policyWithdrawal({
      policy: match.policies[source],
      node: match.state.nodes[source],
      manualWithdraw: withdrawal(match, source, p),
      manualHold: Boolean(p.hold),
      softCap: softCapEnabled(match),
    });
  const totalWithdrawal = (match, source, p = plan(match, source)) =>
    withdrawal(match, source, p) + policyWithdrawal(match, source, p);
  const availableEnergy = (match, source, p = plan(match, source)) =>
    match.state.nodes[source].active +
    totalWithdrawal(match, source, p) * (1 - SOFT_CAP_RULES.withdrawalFee);

  const policyOrders = (match, source) => policyPlan(match, source).orders;

  function policyPlan(match, source) {
    const node = match.state.nodes[source],
      p = plan(match, source);
    return planPolicy({
      policy: match.policies[source],
      node: {
        ...node,
        active: availableEnergy(match, source),
        invested: node.invested - totalWithdrawal(match, source),
      },
      manualSpent: allocated(match, source),
      manualInvest: p.invest,
      manualWithdraw: withdrawal(match, source),
      manualHold: Boolean(p.hold),
      neighbors: neighbors(match, source),
      owners: match.state.nodes.map((n) => n.owner),
      source,
    });
  }

  function defenseStatus(match, source) {
    const policy = match.policies[source];
    if (!Number.isFinite(policy?.defenseTarget)) return null;
    const outlook = projection(match, source);
    return {
      floor: policy.reserve,
      next: policyPlan(match, source).next.reserve,
      target: policy.defenseTarget,
      sustainable: 10 * (outlook.income + outlook.incoming),
    };
  }

  function investmentStatus(match, source) {
    const policy = match.policies[source];
    if (!Number.isFinite(policy?.investTarget)) return null;
    const invested = match.state.nodes[source].invested,
      target = policy.investTarget,
      withdraw = policyWithdrawal(match, source),
      invest = sum(
        policyOrders(match, source)
          .filter((o) => o.type === 'invest')
          .map((o) => o.amount),
      ),
      after = invested - totalWithdrawal(match, source) + plan(match, source).invest + invest;
    return {
      invested,
      target,
      invest,
      withdraw,
      fee: withdraw * SOFT_CAP_RULES.withdrawalFee,
      roundsToTarget: roundsToTarget(
        invested,
        after,
        target,
        softCapEnabled(match) ? policy.divestPct : 0,
      ),
      blockedByManualWithdrawal:
        withdrawal(match, source) > 0 && invested < target - TARGET_EPSILON,
    };
  }

  function roundsToTarget(invested, after, target, divestPct) {
    if (Math.abs(invested - target) <= TARGET_EPSILON) return 0;
    if (Math.abs(after - target) <= TARGET_EPSILON) return 1;
    if (invested < target || !(divestPct > 0)) return null;
    let rounds = 0;
    for (; invested > target + TARGET_EPSILON; rounds++)
      invested -= Math.min((invested * divestPct) / 100, invested - target);
    return rounds;
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
      { softCap: softCapEnabled(match), withdraw: totalWithdrawal(match, id) },
    );
  }

  function withOrder(match, source, p) {
    const orders = { ...match.orders };
    if (allocated(match, source, p) < 1e-9 && !p.hold && !p.withdraw) delete orders[source];
    else orders[source] = p;
    return { ...match, orders };
  }

  function withPolicy(match, source, policy) {
    return { ...match, policies: { ...match.policies, [source]: policy } };
  }

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
    return { match: withOrder(match, source, p) };
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

  const policyFieldValid = {
    investTarget: (value) => value === null || (Number.isFinite(value) && value >= 0),
    divestPct: (value) => Number.isFinite(value) && value >= 0 && value <= 100,
    defenseTarget: (value) => value === null || (Number.isFinite(value) && value >= 0),
    defensePct: (value) => Number.isFinite(value) && value >= 0 && value <= 100,
  };
  const sharesTotal = (policy) => policy.investPct + (policy.defensePct ?? 0);

  function changePolicy(match, source, key, value) {
    if (Object.hasOwn(policyFieldValid, key) && !policyFieldValid[key](value)) return match;
    const policy = { ...defaultPolicy(), ...match.policies[source], [key]: value };
    if (policy.defensePct > 0 && sharesTotal(policy) > 100) return match;
    return withPolicy(match, source, policy);
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
      changePolicy(source, key, value) {
        const before = snapshot.match;
        commit('match', changePolicy(before, source, key, value));
        return snapshot.match !== before;
      },
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
      policyWithdrawal,
      availableEnergy,
      policyOrders,
      investmentStatus,
      defenseStatus,
      previewOrders,
      projection,
    }),
  });
})();
