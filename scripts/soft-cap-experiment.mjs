#!/usr/bin/env node
// Reproducible simulation-only sweep. No import from game.js or UX code.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { engine } from '../tests/support/simulation.mjs';
import { defensiveReserve, planStrategyOrders } from '../tests/support/strategies.mjs';
import { resolveSoftCapRound } from '../tests/support/soft-cap.mjs';

const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const match = /^--([a-z-]+)=(.+)$/.exec(arg);
    if (!match) throw new Error('Expected --name=value: ' + arg);
    return [match[1], match[2]];
  }),
);
const matches = Number(args.matches ?? 30);
const maxRounds = Number(args.rounds ?? 300);
const count = Number(args.nodes ?? 20);
const players = Number(args.players ?? 2);
const opponent = args.opponent ?? 'default';
const seed = args.seed ?? 'invest-vs-expand-duel';
const density = args.density ?? 'normal';
const handicap = Number(args.handicap ?? 1);
assert.ok(Number.isSafeInteger(matches) && matches >= 1 && matches <= 1000);
assert.ok(Number.isSafeInteger(maxRounds) && maxRounds >= 1 && maxRounds <= 1000);
assert.ok(Number.isSafeInteger(count) && count >= 10 && count <= 120);
assert.ok(Number.isSafeInteger(players) && players >= 2 && players <= 6);
assert.ok(['default', 'aggressive'].includes(opponent));
assert.ok(['normal', 'dense', 'sparse'].includes(density));
assert.ok(Number.isFinite(handicap) && handicap > 0 && handicap <= 1);

const configurations = [
  { name: 'baseline', capacity: null, decay: 0, fee: 0 },
  ...[50, 100, 250, 500].map((capacity) => ({
    name: 'C' + capacity + '-D25-F5',
    capacity,
    decay: 0.25,
    fee: 0.05,
  })),
  ...[0.15, 0.35].map((decay) => ({
    name: 'C100-D' + Math.round(decay * 100) + '-F5',
    capacity: 100,
    decay,
    fee: 0.05,
  })),
  ...[0, 0.1].map((fee) => ({
    name: 'C100-D25-F' + Math.round(fee * 100),
    capacity: 100,
    decay: 0.25,
    fee,
  })),
];
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};
const precision = (value) => Number(value.toPrecision(5));
const neighborsFor = (links, node) =>
  links.flatMap(([a, b]) => (a === node ? [b] : b === node ? [a] : []));

// A withdraw-aware sibling of Compounding Expander. It follows the same
// reserve/reinvestment policy, but can mobilize 25% of a node's principal
// in one round when an adjacent attack is otherwise unaffordable.
function addWithdrawalAttacks(choices, nodes, links, fee) {
  const withdrawals = {};
  for (const node of nodes) {
    if (node.owner !== 0 || node.invested <= 0) continue;
    const adjacent = neighborsFor(links, node.id);
    const reserve = defensiveReserve(node, nodes, adjacent);
    const targets = adjacent
      .filter((id) => nodes[id].owner !== node.owner)
      .sort(
        (a, b) =>
          Number(nodes[a].owner !== null) - Number(nodes[b].owner !== null) ||
          nodes[a].active - nodes[b].active ||
          a - b,
      );
    for (const target of targets) {
      const strike = nodes[target].active * 1.5 + 0.2;
      const shortfall = Math.max(0, strike + reserve - node.active);
      if (shortfall < 1e-8) continue; // Ordinary expander already handles cheap attacks.
      const needed = shortfall / (1 - fee);
      if (needed > node.invested * 0.25 || needed > node.invested) continue;
      const available = node.active + needed * (1 - fee);
      const savings = Math.max(0, available - reserve - strike);
      withdrawals[node.id] = needed;
      choices[node.id] = [
        { source: node.id, type: 'attack', amount: strike, dest: target },
        ...(savings > 1e-9
          ? [{ source: node.id, type: 'invest', amount: savings, dest: null }]
          : []),
      ];
      break;
    }
  }
  return withdrawals;
}

function play(config, strategy, index) {
  const mapSeed = seed + ':map:' + index;
  const combatSeed = seed + ':combat:' + index;
  const map = engine.buildMap({ count, players, density, seed: mapSeed });
  if (handicap !== 1) {
    const home = map.nodes.find((node) => node.owner === 0);
    home.active *= handicap;
    home.invested *= handicap;
  }
  const homeNodes = Array.from(
    { length: players },
    (_, player) => map.nodes.find((node) => node.owner === player).id,
  );
  const rng = engine.seeded(combatSeed);
  const strategies = [
    strategy === 'withdrawexpand' ? 'compoundexpand' : strategy,
    ...Array(players - 1).fill(opponent),
  ];
  let state = { round: 1, finished: false, nodes: map.nodes };
  let policies = {};
  let peakNodes = 1;
  let captures = 0;
  let lastCapture = 0;
  let cumulativeIncome = 0;
  let overflowLost = 0;
  let feesLost = 0;
  let withdrawn = 0;
  const hash = createHash('sha256');
  hash.update(JSON.stringify(map));
  while (!state.finished && state.round <= maxRounds) {
    const before = state;
    const choices = planStrategyOrders({
      engine,
      nodes: before.nodes,
      links: map.links,
      strategies,
      round: before.round,
      homeNodes,
      attackPct: 5,
    });
    const withdrawals =
      strategy === 'withdrawexpand'
        ? addWithdrawalAttacks(choices, before.nodes, map.links, config.fee)
        : {};
    const orders = {};
    const aiOrdersOverride = [];
    for (const [source, choice] of Object.entries(choices)) {
      const list = Array.isArray(choice) ? choice : [choice];
      if (before.nodes[Number(source)].owner !== 0) {
        aiOrdersOverride.push(...list);
        continue;
      }
      const manual = { invest: 0, edges: {} };
      for (const action of list) {
        if (action.type === 'invest') manual.invest += action.amount;
        else manual.edges[action.dest] = (manual.edges[action.dest] ?? 0) + action.amount;
      }
      orders[source] = manual;
    }
    const parameters = {
      state: before,
      orders,
      policies,
      links: map.links,
      rng,
      aiOrdersOverride,
    };
    const resolved =
      config.capacity === null
        ? engine.resolveRound(parameters)
        : resolveSoftCapRound({
            engine,
            ...parameters,
            withdrawals,
            capacity: config.capacity,
            overflowDecay: config.decay,
            withdrawalFee: config.fee,
          });
    state = resolved.state;
    policies = resolved.policies;
    overflowLost += resolved.economy?.overflowLoss ?? 0;
    feesLost += resolved.economy?.withdrawalFees ?? 0;
    withdrawn += resolved.economy?.withdrawn ?? 0;
    for (let id = 0; id < count; id++) {
      if (before.nodes[id].owner !== state.nodes[id].owner) {
        captures++;
        lastCapture = before.round;
      }
    }
    const owned = state.nodes.filter((node) => node.owner === 0);
    peakNodes = Math.max(peakNodes, owned.length);
    // Snapshot production after every resolved round. Gross is before next
    // active decay, and does not hide energy subsequently lost to overflow.
    cumulativeIncome += owned.reduce((sum, node) => sum + 1 + node.invested * 0.1, 0);
    hash.update(JSON.stringify(state));
  }
  const standings = Array.from({ length: players }, (_, player) => {
    const owned = state.nodes.filter((node) => node.owner === player);
    return {
      nodes: owned.length,
      active: owned.reduce((sum, node) => sum + node.active, 0),
      invested: owned.reduce((sum, node) => sum + node.invested, 0),
      gross: owned.reduce((sum, node) => sum + 1 + node.invested * 0.1, 0),
    };
  });
  const totalGross = standings.reduce((sum, player) => sum + player.gross, 0);
  const surviving = standings.filter((player) => player.nodes > 0);
  return {
    mapSeed,
    combatSeed,
    strategy,
    config: config.name,
    rounds: state.round - 1,
    winner: state.finished && surviving.length === 1 ? standings.indexOf(surviving[0]) : null,
    survived: standings[0].nodes > 0,
    expanded: peakNodes > 1,
    peakNodes,
    captures,
    stalemate: !state.finished && state.round - 1 - lastCapture >= 25,
    incomeShare: totalGross > 0 ? standings[0].gross / totalGross : 0,
    cumulativeIncome,
    overflowLost,
    feesLost,
    withdrawn,
    standings,
    checksum: hash.digest('hex'),
  };
}
const output = {
  metadata: {
    seed,
    matches,
    maxRounds,
    count,
    players,
    opponent,
    density,
    handicap,
    timing:
      'Withdraw at round start; validate/spend all active budgets; transfers and combat; normal income and active decay; proportional overflow loss at round end.',
    caveat:
      'Same map and combat RNG seeds, but divergent order choices can change RNG consumption. Income is gross after loss; comeback requires the separately handicapped suite.',
  },
  configurations: {},
};
for (const config of configurations) {
  const cases = {};
  const modes =
    config.capacity === null
      ? ['superturtle', 'compoundexpand']
      : ['superturtle', 'compoundexpand', 'withdrawexpand'];
  for (const strategy of modes) {
    const results = Array.from({ length: matches }, (_, index) =>
      play(config, strategy, index),
    );
    cases[strategy] = {
      results,
      summary: {
        wins: results.filter((result) => result.winner === 0).length,
        survived: results.filter((result) => result.survived).length,
        expanded: results.filter((result) => result.expanded).length,
        stalemates: results.filter((result) => result.stalemate).length,
        unresolved: results.filter((result) => result.winner === null).length,
        medianRounds: median(results.map((result) => result.rounds)),
        medianNodes: median(results.map((result) => result.standings[0].nodes)),
        medianActive: median(results.map((result) => result.standings[0].active)),
        medianInvested: median(results.map((result) => result.standings[0].invested)),
        medianTotal: median(
          results.map((result) => result.standings[0].active + result.standings[0].invested),
        ),
        medianGross: median(results.map((result) => result.standings[0].gross)),
        medianIncomeSharePct: median(results.map((result) => result.incomeShare)) * 100,
        medianCumulative: median(results.map((result) => result.cumulativeIncome)),
        medianOverflowLost: median(results.map((result) => result.overflowLost)),
        medianWithdrawn: median(results.map((result) => result.withdrawn)),
        medianFeesLost: median(results.map((result) => result.feesLost)),
      },
    };
  }
  const pairs = cases.superturtle.results.map((result, index) => [
    result,
    cases.compoundexpand.results[index],
  ]);
  cases.expanderVsTurtle = {
    comparable: pairs.filter(([a, b]) => a.rounds === maxRounds && b.rounds === maxRounds).length,
    medianGrossRatio: median(
      pairs
        .filter(([a, b]) => a.rounds === b.rounds && a.standings[0].gross > 0)
        .map(([a, b]) => b.standings[0].gross / a.standings[0].gross),
    ),
  };
  output.configurations[config.name] = { config, cases };
}
if (args.json === 'true') {
  console.log(JSON.stringify(output, null, 2));
} else {
  console.log(
    '# Soft-cap economy experiment: ' +
      seed +
      ' / ' +
      count +
      ' nodes / ' +
      players +
      ' players / ' +
      matches +
      ' seeds / handicap ' +
      handicap,
  );
  console.log('');
  console.log(
    '| Rule | Bot | Win | Survive | Expand | Stalemate | Nodes median | Total median | Gross median | Income share | Expander/turtle |',
  );
  console.log('| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const [name, { cases }] of Object.entries(output.configurations)) {
    for (const [strategy, { summary }] of Object.entries(cases)) {
      if (!summary) continue;
      console.log(
        '| ' +
          [
            name,
            strategy,
            summary.wins + '/' + matches,
            summary.survived + '/' + matches,
            summary.expanded + '/' + matches,
            summary.stalemates + '/' + matches,
            summary.medianNodes,
            precision(summary.medianTotal),
            precision(summary.medianGross),
            summary.medianIncomeSharePct.toFixed(2) + '%',
            strategy === 'compoundexpand' ? cases.expanderVsTurtle.medianGrossRatio.toFixed(3) : '—',
          ].join(' | ') +
          ' |',
      );
    }
  }
  console.log('');
  console.log('Gross income is measured after the last resolved round and overflow deduction.');
  console.log('Paired ratios use equal-length runs only; full per-seed data is in the JSON artifact.');
}
