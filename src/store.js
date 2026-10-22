'use strict';

(() => {
  const {
    planPolicy,
    forecast,
    resolveRound,
    seeded,
    playerName,
    aiPlan,
    coloursFor,
    recoloured,
    firstOwners,
    SOFT_CAP_RULES,
  } = GameEngine;
  const HISTORY_LIMIT = 70;
  const TARGET_EPSILON = 1e-6;
  const sum = (values) => values.reduce((total, value) => total + value, 0);
  const oncePerMatch = (derive) => {
    const derived = new WeakMap();
    return (match) => {
      if (!derived.has(match)) derived.set(match, derive(match));
      return derived.get(match);
    };
  };
  const oncePerMatchAndNode = (derive) => {
    const byNode = oncePerMatch(() => new Map());
    return (match, id) => {
      const derived = byNode(match);
      if (!derived.has(Number(id))) derived.set(Number(id), derive(match, Number(id)));
      return derived.get(Number(id));
    };
  };

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

  function classicMatch(random, defaults, seat = 0) {
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
    const state = { round: 1, nodes, finished: false, rulesVersion: SOFT_CAP_RULES.version };
    return {
      state,
      orders: {},
      policies: {},
      keptPolicies: {},
      history: ['New match started. You are ' + playerName(seat) + '.'],
      seat,
      map: { xy: CLASSIC_XY, edges: CLASSIC_EDGES, N, playerCount, mapSeed: 'classic' },
      defaults,
      replay: newReplay(state, random, seat),
    };
  }

  function generatedMatch(map, defaults, random, seat = 0) {
    const colours = coloursFor(seat, map.players);
    const state = {
      round: 1,
      nodes: recoloured(map.nodes, colours),
      finished: false,
      rulesVersion: SOFT_CAP_RULES.version,
    };
    return {
      state,
      orders: {},
      policies: {},
      keptPolicies: {},
      history: [
        'You are ' + playerName(seat) + '.',
        'Generated ' + map.nodes.length + ' nodes, ' + map.players + ' players, seed ' + map.seed,
      ],
      seat,
      map: {
        xy: map.positions,
        edges: map.links,
        N: map.nodes.length,
        playerCount: map.players,
        mapSeed: map.seed,
        ...(sameValue(colours, firstOwners(map.players)) ? {} : { owners: colours }),
      },
      defaults,
      replay: newReplay(state, random, seat),
    };
  }

  function newReplay(start, random, seat) {
    return {
      diceSeed: diceSeed(random),
      seat,
      start,
      rounds: [],
      keptPoliciesFrom: 1,
      policiesAfterLastRound: {},
    };
  }

  const diceSeed = (random) =>
    Array.from({ length: 4 }, () => Math.floor(random() * 2 ** 32).toString(36)).join('-');

  function matchFromSave(save, defaults) {
    if (
      !save?.state ||
      !Array.isArray(save.state.nodes) ||
      !Array.isArray(save.xy) ||
      !Array.isArray(save.edges)
    )
      return null;
    const { state, xy, edges, N, playerCount, mapSeed, owners } = save;
    return withOneWaySupport({
      state,
      orders: save.orders ?? {},
      policies: save.policies ?? {},
      keptPolicies: save.keptPolicies ?? {},
      seat: save.seat ?? 0,
      history: ['Recovered saved match from this browser.', ...(save.history ?? [])],
      map: { xy, edges, N, playerCount, mapSeed, ...(owners ? { owners } : {}) },
      defaults: save.defaults
        ? {
            enabled: Boolean(save.defaults.enabled),
            reserve: save.defaults.reserve,
            invest: save.defaults.invest,
          }
        : defaults,
      replay: Array.isArray(save.replay?.rounds)
        ? keepingPoliciesFrom(save.replay, save.keptPolicies ? 1 : state.round)
        : null,
    });
  }

  const keepingPoliciesFrom = (replay, round) => replay && { keptPoliciesFrom: round, ...replay };

  function withKeptPolicies(match) {
    if (match.keptPolicies) return match;
    return {
      ...match,
      keptPolicies: {},
      replay: keepingPoliciesFrom(match.replay, match.state.round),
    };
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
    const { state, orders, policies, keptPolicies, history, map, defaults, replay, seat } = match;
    const saved = {
      state,
      orders,
      policies,
      keptPolicies,
      ...map,
      history,
      selected,
      defaults,
      replay,
    };
    return seatOf(match) === 0 ? saved : { ...saved, seat };
  }

  const neighbors = (match, id) =>
    match.map.edges.flatMap(([a, b]) => (a === id ? [b] : b === id ? [a] : []));
  const seatOf = (match) => match.seat ?? 0;
  const humansOf = (match) => match.humanSeats ?? [seatOf(match)];
  const ownersOf = (match) => match.map.owners ?? firstOwners(match.map.playerCount);
  const isOwn = (match, id) => match.state.nodes[id]?.owner === seatOf(match);
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

  const policyPlan = oncePerMatchAndNode((match, source) => {
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
  });

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

  const previewOrders = oncePerMatch((match) => {
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
  });

  const aiDebugPlan = (match) =>
    match.online
      ? { orders: [], withdrawals: {} }
      : aiPlan(match.state, match.map.edges, humansOf(match));

  const projection = oncePerMatchAndNode((match, id) => {
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
  });

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

  const activeShareAmount = (match, source, percent) =>
    (match.state.nodes[source].active * percent) / 100;

  const activeSharePercent = (match, source, amount) => {
    const { active } = match.state.nodes[source];
    return active > 0 ? (amount * 100) / active : 0;
  };

  function orderPresets(match, source, destination) {
    const limit = edgeLimit(match, source, destination);
    const defense = match.state.nodes[destination].active;
    const attacks = isOwn(match, destination)
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
      GROUP_FIELDS.map((field) => [
        field,
        spread(ids.map((id) => shownPolicy(match, id)[field] ?? null)),
      ]),
    );
  }

  function spread(values) {
    const distinct = [...new Set(values)].sort(ascending);
    return distinct.length === 1
      ? { value: distinct[0] }
      : { mixed: [distinct[0], distinct.at(-1)] };
  }

  const LEADERBOARD_COLUMNS = ['player', 'invested', 'active', 'nodes'];
  const DEFAULT_LEADERBOARD_SORT = { column: 'player', direction: 'asc' };

  function leaderboard(match, sort = DEFAULT_LEADERBOARD_SORT) {
    const sign = sort.direction === 'asc' ? 1 : -1;
    return ownersOf(match)
      .map((owner) => standingOf(match, owner))
      .sort((a, b) => sign * (a[sort.column] - b[sort.column]) || a.player - b.player);
  }

  function standingOf(match, owner) {
    return { player: owner, name: playerName(owner), ...standingIn(match.state.nodes, owner) };
  }

  function standingIn(allNodes, owner) {
    const nodes = allNodes.filter((node) => node.owner === owner);
    return {
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

  const CHART_SERIES = [
    'invested',
    'active',
    'battleLoss',
    'inefficiencyLoss',
    'production',
    'nodes',
  ];
  const STOCK_SERIES = ['invested', 'active', 'nodes'];
  const DEFAULT_LEADERBOARD_CHART = { series: 'invested', runningTotal: false, focus: null };

  const isFlowSeries = (series) => !STOCK_SERIES.includes(series);

  function chartLines(history, { series, runningTotal }) {
    const playerCount = history.rounds[0]?.players.length ?? 0;
    return Array.from({ length: playerCount }, (_, owner) => {
      const values = roundsInGame(history, owner).map((round) => round.players[owner][series]);
      return runningTotal && isFlowSeries(series) ? runningTotals(values) : values;
    });
  }

  function roundsInGame(history, owner) {
    const knockedOut = history.rounds.findIndex((round) => round.players[owner].nodes === 0);
    return knockedOut === -1 ? history.rounds : history.rounds.slice(0, knockedOut + 1);
  }

  function runningTotals(values) {
    let total = 0;
    return values.map((value) => (total += value));
  }

  function nextLeaderboardChart(chart, fields, owners) {
    const next = { ...chart, ...fields };
    const valid =
      CHART_SERIES.includes(next.series) &&
      typeof next.runningTotal === 'boolean' &&
      (next.focus === null || owners.includes(next.focus));
    return valid ? next : chart;
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

  const isAttack = (match, [, destination]) => !isOwn(match, destination);
  const orderedAmount = (match, [source, destination]) =>
    plan(match, source).edges[destination] || 0;
  const pressureOf = (match, [source, destination]) =>
    match.policies[source]?.pressure?.[destination];

  function groupEdgeView(match, pairs) {
    const pressured = pairs
      .filter((pair) => isAttack(match, pair))
      .map((pair) => pressureOf(match, pair))
      .filter(Boolean);
    return {
      attacks: pairs.filter((pair) => isAttack(match, pair)).length,
      sending: sum(pairs.map((pair) => orderedAmount(match, pair))),
      amount: spread(pairs.map((pair) => orderedAmount(match, pair))),
      pressured: pressured.length,
      pct: pressured.length ? spread(pressured.map((edge) => edge.pct)) : null,
      min: pressured.length ? spread(pressured.map((edge) => edge.min ?? 10)) : null,
    };
  }

  const pressuredEdges = (match, ids) =>
    ids.flatMap((source) =>
      Object.keys(match.policies[source]?.pressure ?? {})
        .map((destination) => [source, Number(destination)])
        .filter(([, destination]) => isPressurable(match, source, destination)),
    );

  const sendOnEachEdge = (match, pairs, amount) => amountsOnEachEdge(match, pairs, () => amount);

  const attackChanceOnEachEdge = (match, pairs, chance) =>
    amountsOnEachEdge(
      match,
      pairs.filter((pair) => isAttack(match, pair)),
      ([, destination]) => attackForChance(match.state.nodes[destination].active, chance),
    );

  function amountsOnEachEdge(match, pairs, amountOf) {
    const skipped = [];
    const next = pairs.reduce((current, pair) => {
      const [source, destination] = pair;
      const amount = amountOf(pair);
      if (!isOwn(current, source) || amount > edgeLimit(current, source, destination) + 1e-8) {
        skipped.push(pair);
        return current;
      }
      return setAllocation(current, source, destination, amount).match;
    }, match);
    return { match: next, skipped };
  }

  function splitOnEachEdge(match, pairs, preset) {
    const sources = [...new Set(pairs.map(([source]) => source))].filter((source) =>
      isOwn(match, source),
    );
    return sources.reduce((current, source) => {
      const destinations = pairs
        .filter(([from]) => from === source)
        .map(([, destination]) => destination);
      const cleared = destinations.reduce(
        (next, destination) => setAllocation(next, source, destination, 0).match,
        current,
      );
      const reserve = preset === 'surplus' ? policyReserve(cleared, source) : 0;
      const pool = Math.max(0, edgeLimit(cleared, source, destinations[0]) - reserve);
      return destinations.reduce(
        (next, destination) =>
          setAllocation(next, source, destination, pool / destinations.length).match,
        cleared,
      );
    }, match);
  }

  const clearEdgeOrders = (match, pairs) =>
    pairs
      .filter((pair) => orderedAmount(match, pair) > 0)
      .reduce(
        (next, [source, destination]) => setAllocation(next, source, destination, 0).match,
        match,
      );

  function setGroupEdgePressure(match, pairs, fields) {
    const rejected = [];
    const next = pairs
      .filter(([source, destination]) => isPressurable(match, source, destination))
      .reduce((current, pair) => {
        const changed = setEdgePressure(current, ...pair, fields);
        if (changed === current) rejected.push(pair);
        return changed;
      }, match);
    return rejected.length ? { match, rejected } : { match: next, rejected };
  }

  const stopEdgePressure = (match, pairs) =>
    pairs.reduce(
      (next, [source, destination]) => setEdgePressure(next, source, destination, null),
      match,
    );

  const orderableEdges = (match, pairs) =>
    pairs.filter(
      ([source, destination]) =>
        isOwn(match, source) && neighbors(match, source).includes(destination),
    );

  const stillOrderableEdges = (match, pairs) =>
    orderableEdges(
      match,
      pairs.map(([source, destination]) =>
        isOwn(match, source) ? [source, destination] : [destination, source],
      ),
    );

  const sameEdge = ([source, destination], a, b) =>
    (source === a && destination === b) || (source === b && destination === a);

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

  function resolve(stored) {
    if (stored.state.finished) return stored;
    const match = withKeptPolicies(stored);
    const result = resolveRoundOf(match, dice(match));
    const history = result.events
      .reduce((lines, event) => [event, ...lines], match.history)
      .slice(0, HISTORY_LIMIT);
    return {
      ...match,
      state: result.state,
      policies: result.policies,
      keptPolicies: result.keptPolicies,
      orders: {},
      history,
      replay: match.replay && withRecordedRound(match.replay, match, result.policies),
    };
  }

  const conquestPoliciesOf = (match) =>
    Object.fromEntries(
      Object.entries(match.seatDefaults ?? {}).map(([owner, defaults]) => [
        owner,
        conquestPolicy(defaults),
      ]),
    );

  function resolveRoundOf(match, rng) {
    return resolveRound({
      state: match.state,
      playerCount: match.map.playerCount,
      owners: ownersOf(match),
      seat: humansOf(match),
      orders: match.orders,
      policies: match.policies,
      keptPolicies: match.replay ? keptPoliciesInRound(match.replay, match) : match.keptPolicies,
      links: match.map.edges,
      defaultConquestPolicy: conquestPolicy(match.defaults),
      conquestPolicies: conquestPoliciesOf(match),
      rng,
    });
  }

  const dice = (match) =>
    match.replay ? diceOfRound(match.replay, match.state.round) : Math.random;
  const diceOfRound = (replay, round) => seeded(replay.diceSeed + ':' + round);

  function withRecordedRound(replay, match, policiesAfterRound) {
    const { orders, defaults, policies, seatDefaults, humanSeats } = match;
    const round = {
      orders,
      defaults,
      ...(seatDefaults ? { seatDefaults } : {}),
      ...(humanSeats ? { humanSeats } : {}),
      policies: policyChanges(replay.policiesAfterLastRound, policies),
    };
    return {
      ...replay,
      rounds: [...replay.rounds, round],
      policiesAfterLastRound: policiesAfterRound,
    };
  }

  function policyChanges(before, after) {
    const ids = [...new Set([...Object.keys(before), ...Object.keys(after)])];
    return Object.fromEntries(
      ids.filter((id) => !sameValue(before[id], after[id])).map((id) => [id, after[id] ?? null]),
    );
  }

  function withPolicyChanges(policies, changes) {
    const next = { ...policies, ...changes };
    for (const [id, policy] of Object.entries(changes)) if (policy === null) delete next[id];
    return next;
  }

  function replayFrames(match) {
    const { rounds, next } = replayedRounds(match, replayStart(match));
    return [
      ...rounds.map(({ before, moves, events }) => ({ state: before, moves, events })),
      { state: next.state, moves: [], events: [] },
    ];
  }

  const replayStart = (match) => ({
    round: 0,
    state: match.replay.start,
    policies: {},
    keptPolicies: {},
  });

  function replayedRounds(match, from) {
    const rounds = [];
    let current = {
      ...match,
      seat: match.replay.seat ?? 0,
      humanSeats: match.replay.humanSeats,
      state: from.state,
      policies: from.policies,
      keptPolicies: from.keptPolicies,
    };
    for (const round of match.replay.rounds.slice(from.round)) {
      const input = {
        ...current,
        orders: round.orders,
        defaults: round.defaults,
        seatDefaults: round.seatDefaults,
        humanSeats: round.humanSeats ?? current.humanSeats,
        policies: withPolicyChanges(current.policies, round.policies),
      };
      const result = resolveRoundOf(input, diceOfRound(match.replay, input.state.round));
      rounds.push({
        before: input.state,
        after: result.state,
        moves: result.moves,
        events: result.events,
        ledger: result.ledger,
      });
      current = {
        ...current,
        state: result.state,
        policies: result.policies,
        keptPolicies: result.keptPolicies,
      };
    }
    const next = {
      round: match.replay.rounds.length,
      state: current.state,
      policies: current.policies,
      keptPolicies: current.keptPolicies,
    };
    return { rounds, next };
  }

  const keptPoliciesInRound = (replay, current) =>
    current.state.round < (replay.keptPoliciesFrom ?? Infinity)
      ? null
      : (current.keptPolicies ?? {});

  function playerHistory(match, known = null) {
    if (!match.replay) return null;
    const from = known && continuesReplay(known.replay, match.replay) ? known : emptyHistory(match);
    const { rounds, next } = replayedRounds(match, from.next);
    return {
      replay: match.replay,
      next,
      owners: ownersOf(match),
      rounds: [...from.rounds, ...rounds.map((round) => roundStats(round, ownersOf(match)))],
    };
  }

  const emptyHistory = (match) => ({ replay: match.replay, next: replayStart(match), rounds: [] });

  function continuesReplay(known, replay) {
    return (
      known.diceSeed === replay.diceSeed &&
      known.start === replay.start &&
      known.rounds.every((round, i) => replay.rounds[i] === round)
    );
  }

  function roundStats({ before, after, ledger }, owners) {
    return {
      round: before.round,
      players: owners.map((owner) => ({
        ...standingIn(after.nodes, owner),
        production: ledger[owner].production,
        battleLoss:
          ledger[owner].attackLoss + ledger[owner].defenseLoss + ledger[owner].investedCeded,
        inefficiencyLoss:
          ledger[owner].decay + ledger[owner].overflow + ledger[owner].withdrawalFee,
      })),
    };
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

  const CLOSED_INSPECTOR = { active: null, editing: false };
  const INITIAL_UI = {
    view: 'map',
    leaderboardSort: DEFAULT_LEADERBOARD_SORT,
    leaderboardChart: DEFAULT_LEADERBOARD_CHART,
    clipboard: null,
    aiDebug: false,
    bulkSelection: [],
    bulkEdges: [],
    groupMode: false,
    groupEditing: false,
    selected: null,
    camera: { x: 0, y: 0, scale: 1 },
    inspector: { ...CLOSED_INSPECTOR, focusedNode: null },
    replay: null,
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

  const lastReplayFrame = (match) => match.replay.rounds.length;
  const clampedFrame = (match, frame) => Math.max(0, Math.min(lastReplayFrame(match), frame));
  const openReplay = (match) => (match.replay ? { frame: 0, playing: false } : null);

  function toggledPlaying(replay, match) {
    if (replay.playing) return { ...replay, playing: false };
    const atEnd = replay.frame === lastReplayFrame(match);
    return { frame: atEnd ? 0 : replay.frame, playing: true };
  }

  function advancedReplay(replay, match) {
    const frame = clampedFrame(match, replay.frame + 1);
    return { frame, playing: frame < lastReplayFrame(match) };
  }

  function createStore() {
    let snapshot = Object.freeze({ match: null, ui: Object.freeze(INITIAL_UI) });
    const listeners = new Set();
    const notifications = [];
    let notifying = false,
      batchDepth = 0,
      beforeBatch = null;

    function commit(slice, next) {
      if (snapshot[slice] === next) return;
      const previous = snapshot;
      snapshot = Object.freeze({ ...snapshot, [slice]: next });
      if (batchDepth === 0) notify(snapshot, previous);
    }
    function notify(next, previous) {
      notifications.push([next, previous]);
      if (notifying) return;
      notifying = true;
      try {
        while (notifications.length) {
          const [current, before] = notifications.shift();
          for (const listener of listeners) listener(current, before);
        }
      } catch (error) {
        notifications.length = 0;
        throw error;
      } finally {
        notifying = false;
      }
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
    const reporting =
      (command, report) =>
      (...args) => {
        const result = command(snapshot.match, ...args);
        commit('match', result.match);
        return result[report];
      };
    const bulkEdgesWith = (a, b) => {
      const others = snapshot.ui.bulkEdges.filter((pair) => !sameEdge(pair, a, b));
      if (others.length < snapshot.ui.bulkEdges.length) return others;
      const source = edgeSource(snapshot.match, a, b);
      return [...others, ...orderableEdges(snapshot.match, [[source, source === a ? b : a]])];
    };

    return {
      getSnapshot: () => snapshot,
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      batch(run) {
        if (batchDepth++ === 0) beforeBatch = snapshot;
        try {
          return run();
        } finally {
          if (--batchDepth === 0 && snapshot !== beforeBatch) notify(snapshot, beforeBatch);
        }
      },
      refresh() {
        notify(snapshot, null);
      },
      replaceMatch(match) {
        commit('match', match);
        if (match.online) setUi('aiDebug', false);
      },
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
      resolve() {
        if (snapshot.match.online) return;
        commit('match', resolve(snapshot.match));
        updateUi({
          bulkSelection: ownOnly(snapshot.ui.bulkSelection),
          bulkEdges: stillOrderableEdges(snapshot.match, snapshot.ui.bulkEdges),
        });
      },
      applyGroupPolicyField: reporting(applyGroupPolicyField, 'rejected'),
      investOnEach: reporting(investOnEach, 'skipped'),
      clearGroupDestinations: onMatch(clearGroupDestinations),
      stopGroupPressure: onMatch(stopGroupPressure),
      pauseGroup: onMatch(pauseGroup),
      clearGroupOrders: onMatch(clearGroupOrders),
      pasteGroupPolicy: onMatch(pasteGroupPolicy),
      sendOnEachEdge: reporting(sendOnEachEdge, 'skipped'),
      attackChanceOnEachEdge: reporting(attackChanceOnEachEdge, 'skipped'),
      splitOnEachEdge: onMatch(splitOnEachEdge),
      clearEdgeOrders: onMatch(clearEdgeOrders),
      setGroupEdgePressure: reporting(setGroupEdgePressure, 'rejected'),
      stopEdgePressure: onMatch(stopEdgePressure),
      setGroupMode: (on) => setUi('groupMode', on),
      leaveGroupMode: () =>
        updateUi({ groupMode: false, groupEditing: false, bulkSelection: [], bulkEdges: [] }),
      setGroupEditing: (on) => setUi('groupEditing', on),
      setBulkSelection: (ids) => setUi('bulkSelection', ownOnly(ids)),
      toggleGroupMember(id) {
        if (!isOwn(snapshot.match, id) || snapshot.ui.bulkEdges.length) return;
        setUi('bulkSelection', bulkSelectionWith(id, !snapshot.ui.bulkSelection.includes(id)));
      },
      setBulkEdges: (pairs) => setUi('bulkEdges', orderableEdges(snapshot.match, pairs)),
      toggleGroupEdge(a, b) {
        if (snapshot.ui.bulkSelection.length) return;
        setUi('bulkEdges', bulkEdgesWith(a, b));
      },
      swapGroupEdge(a, b) {
        setUi(
          'bulkEdges',
          snapshot.ui.bulkEdges.map((pair) =>
            sameEdge(pair, a, b) && isOwn(snapshot.match, pair[1]) ? [pair[1], pair[0]] : pair,
          ),
        );
      },
      setView: (view) => setUi('view', view),
      setAiDebug: (on) => setUi('aiDebug', Boolean(on) && !snapshot.match.online),
      sortLeaderboard: (column) =>
        setUi('leaderboardSort', nextLeaderboardSort(snapshot.ui.leaderboardSort, column)),
      setLeaderboardChart: (fields) =>
        setUi(
          'leaderboardChart',
          nextLeaderboardChart(snapshot.ui.leaderboardChart, fields, ownersOf(snapshot.match)),
        ),
      copyPolicy: (policy) => setUi('clipboard', { ...policy }),
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
      focusNode: (id) => updateUi({ inspector: { ...snapshot.ui.inspector, focusedNode: id } }),
      openReplay: () => setUi('replay', openReplay(snapshot.match)),
      showReplayFrame: (frame) =>
        setUi('replay', { frame: clampedFrame(snapshot.match, frame), playing: false }),
      toggleReplayPlaying: () =>
        setUi('replay', toggledPlaying(snapshot.ui.replay, snapshot.match)),
      advanceReplay: () => setUi('replay', advancedReplay(snapshot.ui.replay, snapshot.match)),
      closeReplay: () => setUi('replay', null),
    };
  }

  const changed = (snapshot, previous, read) =>
    previous === null || read(snapshot) !== read(previous);

  globalThis.GameStore = Object.freeze({
    changed,
    createStore,
    classicMatch,
    generatedMatch,
    matchFromSave,
    saveFromMatch,
    humansOf,
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
      sendOnEachEdge,
      attackChanceOnEachEdge,
      splitOnEachEdge,
      clearEdgeOrders,
      setGroupEdgePressure,
      stopEdgePressure,
      setDefaults,
      resolve,
    }),
    selectors: Object.freeze({
      replayFrames,
      playerHistory,
      chartLines,
      isFlowSeries,
      lastReplayFrame,
      neighbors,
      edgeSource,
      groupPolicyView,
      groupEdgeView,
      pressuredEdges,
      leaderboard,
      isOwn,
      seatOf,
      ownersOf,
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
      aiDebugPlan,
      projection,
      replacedSupport,
      orderPresets,
      activeShareAmount,
      activeSharePercent,
    }),
  });
})();
