'use strict';

(() => {
  const { planPolicy, forecast, resolveRound, playerName, SOFT_CAP_RULES } = GameEngine;
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

  function edgePressureStatus(match, source, dest) {
    const settings = match.policies[source]?.pressure?.[dest];
    if (!settings) return null;
    const { orders, next } = policyPlan(match, source);
    return {
      pct: settings.pct,
      bank: settings.bank ?? 0,
      nextBank: next.pressure?.[dest]?.bank ?? settings.bank ?? 0,
      minimum: settings.min ?? 10,
      pulse: orders.find((o) => o.type === 'attack' && o.dest === dest)?.amount ?? 0,
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

  function orderPresets(match, source, destination) {
    const limit = edgeLimit(match, source, destination);
    const defense = match.state.nodes[destination].active;
    const attacks =
      match.state.nodes[destination].owner === 0
        ? []
        : [0.7, 0.9, 1].map((chance) => ({
            kind: 'chance',
            chance,
            amount: attackForChance(defense, chance),
          }));
    return {
      limit,
      presets: [
        ...attacks,
        { kind: 'all', amount: limit },
        { kind: 'surplus', amount: Math.max(0, limit - policyReserve(match, source)) },
      ],
    };
  }

  const edgeLimit = (match, source, destination) => {
    const p = plan(match, source);
    return Math.max(
      0,
      availableEnergy(match, source, p) - allocated(match, source, p) + (p.edges[destination] || 0),
    );
  };

  const policyReserve = (match, source) =>
    match.policies[source]?.enabled ? Number(match.policies[source].reserve) || 0 : 0;

  const [WEAKEST_ROLL, STRONGEST_ROLL] = [0.8, 1.2];

  function attackForChance(defense, chance) {
    const smallestOrder = 0.1;
    const roundedUp = Math.ceil(defense * strengthRatioForChance(chance) * 10 - 1e-9) / 10;
    return Math.max(smallestOrder, roundedUp);
  }

  function strengthRatioForChance(chance) {
    let [low, high] = [WEAKEST_ROLL / STRONGEST_ROLL, STRONGEST_ROLL / WEAKEST_ROLL];
    if (chance >= 1) return high;
    for (let step = 0; step < 40; step++) {
      const middle = (low + high) / 2;
      if (winChance(middle) < chance) low = middle;
      else high = middle;
    }
    return high;
  }

  function winChance(strengthRatio) {
    const samples = 1000,
      spread = STRONGEST_ROLL - WEAKEST_ROLL;
    let wins = 0;
    for (let i = 0; i < samples; i++) {
      const attackRoll = WEAKEST_ROLL + (spread * (i + 0.5)) / samples;
      const beatenDefenseRolls = (strengthRatio * attackRoll - WEAKEST_ROLL) / spread;
      wins += Math.min(1, Math.max(0, beatenDefenseRolls));
    }
    return wins / samples;
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

  const policyFieldValid = {
    investTarget: (value) => value === null || (Number.isFinite(value) && value >= 0),
    divestPct: (value) => Number.isFinite(value) && value >= 0 && value <= 100,
    defenseTarget: (value) => value === null || (Number.isFinite(value) && value >= 0),
    defensePct: (value) => Number.isFinite(value) && value >= 0 && value <= 100,
  };
  const pressureShares = (policy) =>
    sum(Object.values(policy.pressure ?? {}).map((edge) => edge.pct));
  const addedShares = (policy) => (policy.defensePct ?? 0) + pressureShares(policy);
  const sharesFit = (policy) =>
    addedShares(policy) === 0 || policy.investPct + addedShares(policy) <= 100;
  const isPressurable = (match, source, dest) =>
    neighbors(match, source).includes(dest) && !isOwn(match, dest);

  function changePolicy(match, source, key, value) {
    if (Object.hasOwn(policyFieldValid, key) && !policyFieldValid[key](value, match, source))
      return match;
    const policy = { ...defaultPolicy(), ...match.policies[source], [key]: value };
    return sharesFit(policy) ? withPolicy(match, source, policy) : match;
  }

  function setEdgePressure(match, source, dest, fields) {
    if (!isOwn(match, source) || !isPressurable(match, source, dest)) return match;
    const current = { ...defaultPolicy(), ...match.policies[source] };
    const pressure = { ...current.pressure };
    if (fields === null) {
      if (!pressure[dest]) return match;
      delete pressure[dest];
      return withPolicy(match, source, { ...current, pressure });
    }
    const edge = { pct: 10, min: 10, ...pressure[dest], ...fields };
    const pctValid = Number.isFinite(edge.pct) && edge.pct > 0 && edge.pct <= 100;
    if (!pctValid || !(Number.isFinite(edge.min) && edge.min > 0)) return match;
    const policy = { ...current, enabled: true, pressure: { ...pressure, [dest]: edge } };
    return sharesFit(policy) ? withPolicy(match, source, policy) : match;
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
    const pasted = { ...copied, dest };
    if (copied.pressure)
      pasted.pressure = Object.fromEntries(
        Object.entries(copied.pressure)
          .filter(([target]) => isPressurable(match, source, Number(target)))
          .map(([target, edge]) => [target, { ...edge, bank: 0 }]),
      );
    return withPolicy(match, source, pasted);
  }

  function routeSurplus(match, source, destination, enabled) {
    if (enabled) return enablePolicyWith(match, source, { dest: destination });
    if (match.policies[source]?.dest !== destination) return match;
    return withPolicy(match, source, { ...match.policies[source], dest: null });
  }

  const GROUP_FIELDS = [
    'enabled',
    'investPct',
    'investTarget',
    'divestPct',
    'reserve',
    'defensePct',
    'defenseTarget',
  ];
  const GROUP_FIELD_DEFAULTS = {
    investTarget: null,
    divestPct: 0,
    defensePct: 0,
    defenseTarget: null,
  };
  const shownPolicy = (match, id) => ({
    ...GROUP_FIELD_DEFAULTS,
    ...defaultPolicy(),
    enabled: false,
    ...match.policies[id],
  });
  const ascending = (a, b) => (a === null ? -1 : b === null ? 1 : a < b ? -1 : a > b ? 1 : 0);

  function groupPolicyView(match, ids) {
    return Object.fromEntries(
      GROUP_FIELDS.map((field) => {
        const values = [...new Set(ids.map((id) => shownPolicy(match, id)[field] ?? null))].sort(
          ascending,
        );
        return [
          field,
          values.length === 1 ? { value: values[0] } : { mixed: [values[0], values.at(-1)] },
        ];
      }),
    );
  }

  const LEADERBOARD_COLUMNS = ['player', 'invested', 'active', 'nodes'];
  const DEFAULT_LEADERBOARD_SORT = { column: 'player', direction: 'asc' };

  function leaderboard(match, sort = DEFAULT_LEADERBOARD_SORT) {
    const sign = sort.direction === 'asc' ? 1 : -1;
    return Array.from({ length: match.map.playerCount }, (_, owner) =>
      standingOf(match, owner),
    ).sort((a, b) => sign * (a[sort.column] - b[sort.column]) || a.player - b.player);
  }

  function standingOf(match, owner) {
    const nodes = match.state.nodes.filter((node) => node.owner === owner);
    return {
      player: owner,
      name: playerName(owner),
      invested: sum(nodes.map((node) => node.invested)),
      active: sum(nodes.map((node) => node.active)),
      nodes: nodes.length,
    };
  }

  function nextLeaderboardSort(sort, column) {
    if (!LEADERBOARD_COLUMNS.includes(column)) return sort;
    if (sort.column === column)
      return { column, direction: sort.direction === 'asc' ? 'desc' : 'asc' };
    return { column, direction: column === 'player' ? 'asc' : 'desc' };
  }

  function applyGroupPolicyField(match, ids, key, value) {
    const rejected = [];
    const next = ids
      .filter((id) => isOwn(match, id))
      .reduce((current, id) => {
        const changed = changePolicy(current, id, key, value);
        if (changed === current) rejected.push(id);
        return changed;
      }, match);
    return rejected.length ? { match, rejected } : { match: next, rejected };
  }

  function investOnEach(match, ids, amount) {
    const fits = (id) => isOwn(match, id) && amount <= investBudget(match, id) + 1e-8;
    const next = ids.filter(fits).reduce((current, id) => {
      const p = plan(current, id);
      return withOrder(current, id, { ...p, edges: { ...p.edges }, invest: amount });
    }, match);
    return { match: next, skipped: ids.filter((id) => !fits(id)) };
  }

  const investBudget = (match, id) =>
    availableEnergy(match, id) - sum(Object.values(plan(match, id).edges));

  const ownPolicies = (match, ids, change) =>
    ids
      .filter((id) => match.policies[id] && isOwn(match, id))
      .reduce((next, id) => withPolicy(next, id, change(next.policies[id])), match);
  const clearGroupDestinations = (match, ids) =>
    ownPolicies(match, ids, (policy) => ({ ...policy, dest: null }));
  const stopGroupPressure = (match, ids) =>
    ownPolicies(match, ids, (policy) => (policy.pressure ? { ...policy, pressure: {} } : policy));
  const pauseGroup = (match, ids) =>
    ids.filter((id) => isOwn(match, id)).reduce((next, id) => setHold(next, id, true), match);
  const clearGroupOrders = (match, ids) => ids.reduce(clearNodeOrders, match);
  const pasteGroupPolicy = (match, ids, copied) =>
    ids.filter((id) => isOwn(match, id)).reduce((next, id) => pastePolicy(next, id, copied), match);

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

  function edgeSource(match, a, b) {
    const aOwned = isOwn(match, a);
    const bOwned = isOwn(match, b);
    if (!aOwned) return bOwned ? b : null;
    if (!bOwned) return a;

    // Both directions are possible on friendly edges. Open an existing
    // automatic surplus transfer in its saved direction instead of always
    // defaulting to the first endpoint.
    const { policies } = match;
    const aToB = policies[a]?.enabled && policies[a].dest === b;
    const bToA = policies[b]?.enabled && policies[b].dest === a;
    if (aToB !== bToA) return aToB ? a : b;

    // An explicitly chosen, but disabled, policy destination is still useful
    // context when no enabled direction exists.
    const aConfigured = policies[a]?.dest === b;
    const bConfigured = policies[b]?.dest === a;
    if (aConfigured !== bConfigured) return aConfigured ? a : b;

    return a;
  }

  function sameValue(a, b) {
    if (a === b) return true;
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every((key) => sameValue(a[key], b[key]));
  }

  const CLOSED_INSPECTOR = { active: null, editing: false, advancedOpen: false, manualOpen: false };
  const INITIAL_UI = {
    view: 'map',
    leaderboardSort: DEFAULT_LEADERBOARD_SORT,
    overlay: 'all',
    clipboard: null,
    bulkSelection: [],
    groupMode: false,
    groupEditing: false,
    selected: null,
    camera: { x: 0, y: 0, scale: 1 },
    inspector: { ...CLOSED_INSPECTOR, focusedNode: null },
  };
  const sameTarget = (active, target) =>
    active?.kind === target.kind &&
    (target.kind === 'node'
      ? active.id === target.id
      : active.a === target.a && active.b === target.b);

  function inspect(ui, target) {
    if (sameTarget(ui.inspector.active, target))
      return { inspector: { ...ui.inspector, editing: true } };
    return { inspector: { ...ui.inspector, ...CLOSED_INSPECTOR, active: target } };
  }

  function inspectNode(ui, id) {
    const next = inspect(ui, { kind: 'node', id });
    return { selected: id, inspector: { ...next.inspector, focusedNode: id } };
  }

  function inspectEdge(ui, match, a, b) {
    const next = inspect(ui, { kind: 'edge', a, b, source: edgeSource(match, a, b) });
    return { selected: next.inspector.active.source, inspector: next.inspector };
  }

  function editSelectedNode(ui) {
    if (ui.selected === null) return {};
    return {
      inspector: {
        ...ui.inspector,
        active: { kind: 'node', id: ui.selected },
        focusedNode: ui.selected,
        editing: true,
      },
    };
  }

  function dismissInspector(ui) {
    return {
      selected: null,
      inspector: { ...ui.inspector, active: null, editing: false },
    };
  }

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
    const updateUi = (fields) => {
      if (Object.entries(fields).every(([key, value]) => sameValue(snapshot.ui[key], value)))
        return;
      commit('ui', Object.freeze({ ...snapshot.ui, ...fields }));
    };
    const setUi = (key, value) => updateUi({ [key]: value });
    const onUi =
      (command) =>
      (...args) =>
        updateUi(command(snapshot.ui, ...args));
    const ownOnly = (ids) => [...new Set(ids)].filter((id) => isOwn(snapshot.match, id));
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
      setEdgePressure: onMatch(setEdgePressure),
      setDefaults: onMatch(setDefaults),
      resolve(rng) {
        commit('match', resolve(snapshot.match, rng));
        setUi('bulkSelection', ownOnly(snapshot.ui.bulkSelection));
      },
      applyGroupPolicyField(ids, key, value) {
        const result = applyGroupPolicyField(snapshot.match, ids, key, value);
        commit('match', result.match);
        return result.rejected;
      },
      investOnEach(ids, amount) {
        const result = investOnEach(snapshot.match, ids, amount);
        commit('match', result.match);
        return result.skipped;
      },
      clearGroupDestinations: onMatch(clearGroupDestinations),
      stopGroupPressure: onMatch(stopGroupPressure),
      pauseGroup: onMatch(pauseGroup),
      clearGroupOrders: onMatch(clearGroupOrders),
      pasteGroupPolicy: onMatch(pasteGroupPolicy),
      setGroupMode: (on) => setUi('groupMode', on),
      leaveGroupMode: () => updateUi({ groupMode: false, groupEditing: false, bulkSelection: [] }),
      setGroupEditing: (on) => setUi('groupEditing', on),
      setBulkSelection: (ids) => setUi('bulkSelection', ownOnly(ids)),
      toggleGroupMember(id) {
        if (!isOwn(snapshot.match, id)) return;
        setUi('bulkSelection', bulkSelectionWith(id, !snapshot.ui.bulkSelection.includes(id)));
      },
      setView: (view) => setUi('view', view),
      sortLeaderboard: (column) =>
        setUi('leaderboardSort', nextLeaderboardSort(snapshot.ui.leaderboardSort, column)),
      copyPolicy: (policy) => setUi('clipboard', { ...policy }),
      setOverlay: (overlay) => setUi('overlay', overlay),
      select: (id) => setUi('selected', id),
      setCamera: (camera) => setUi('camera', camera),
      inspectNode: onUi(inspectNode),
      inspectEdge: (a, b) => updateUi(inspectEdge(snapshot.ui, snapshot.match, a, b)),
      editSelectedNode: onUi(editSelectedNode),
      dismissInspector: onUi(dismissInspector),
      closeInspector: () =>
        updateUi({ inspector: { ...snapshot.ui.inspector, active: null, editing: false } }),
      forgetInspectedNode: () =>
        updateUi({ inspector: { ...snapshot.ui.inspector, active: null } }),
      setEdgeSource: (source) =>
        updateUi({
          selected: source,
          inspector: {
            ...snapshot.ui.inspector,
            active: { ...snapshot.ui.inspector.active, source },
          },
        }),
      setInspectorSection: (section, open) =>
        updateUi({ inspector: { ...snapshot.ui.inspector, [section]: open } }),
      focusNode: (id) => updateUi({ inspector: { ...snapshot.ui.inspector, focusedNode: id } }),
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
      setEdgePressure,
      applyGroupPolicyField,
      investOnEach,
      clearGroupDestinations,
      stopGroupPressure,
      pauseGroup,
      clearGroupOrders,
      pasteGroupPolicy,
      setDefaults,
      resolve,
    }),
    selectors: Object.freeze({
      neighbors,
      edgeSource,
      groupPolicyView,
      leaderboard,
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
      edgePressureStatus,
      previewOrders,
      projection,
      replacedSupport,
      orderPresets,
    }),
  });
})();
