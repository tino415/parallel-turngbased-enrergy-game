#!/usr/bin/env node
// Simulation-only study of the Equilibrium mode. Prints JSON; summarize it
// with scripts/summarize-equilibrium.mjs. No import from the browser code.
import assert from 'node:assert/strict';
import { engine } from '../tests/support/simulation.mjs';
import {
  LIVE_VALUATION,
  RESERVE_INVESTMENT,
  RESERVE_TARGETS,
  RESERVE_VALUATION,
} from '../tests/support/equilibrium-ai.mjs';
import { equilibriumRules, LIVE_ECONOMY } from '../tests/support/equilibrium.mjs';
import { median, playEquilibriumMatch } from '../tests/support/equilibrium-match.mjs';

const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const match = /^--([a-z-]+)=(.+)$/.exec(arg);
    if (!match) throw new Error('Expected --name=value: ' + arg);
    return [match[1], match[2]];
  }),
);
const known = ['matches', 'rounds', 'nodes', 'players', 'seed', 'suite'];
for (const name of Object.keys(args)) assert.ok(known.includes(name), 'Unknown flag --' + name);
const matches = Number(args.matches ?? 30);
const maxRounds = Number(args.rounds ?? 300);
const count = Number(args.nodes ?? 20);
const players = Number(args.players ?? 2);
const seed = args.seed ?? 'equilibrium-duel';
const suite = args.suite ?? 'rules';
assert.ok(Number.isSafeInteger(matches) && matches >= 1 && matches <= 1000);
assert.ok(Number.isSafeInteger(maxRounds) && maxRounds >= 1 && maxRounds <= 1000);
assert.ok(Number.isSafeInteger(count) && count >= 10 && count <= 120);
assert.ok(Number.isSafeInteger(players) && players >= 2 && players <= 6);
assert.ok(['rules', 'valuation'].includes(suite));

const everyoneLive = () => LIVE_VALUATION;
const ruleConfigurations = [
  { name: 'live', rules: LIVE_ECONOMY },
  ...[25, 50, 100, 200, 400].map((startingReserve) => ({
    name: 'R' + startingReserve,
    rules: equilibriumRules({ startingReserve }),
  })),
  { name: 'R100-neighbourhood', rules: equilibriumRules({ lossDestination: 'neighbourhood' }) },
  { name: 'R100-global', rules: equilibriumRules({ lossDestination: 'global' }) },
  {
    name: 'R100-slow',
    rules: equilibriumRules({ extractionBase: 0.5, extractionRate: 0.05 }),
  },
  { name: 'R100-fast', rules: equilibriumRules({ extractionBase: 2, extractionRate: 0.2 }) },
  { name: 'R100-flat', rules: equilibriumRules({ extractionBase: 2, extractionRate: 0 }) },
  { name: 'R100-trickle', rules: equilibriumRules({ trickle: 0.2 }) },
].map((config) => ({ ...config, valuationOf: everyoneLive }));

const oneSeatValuing = (valuation, seat) => (owner) =>
  owner === seat ? valuation : LIVE_VALUATION;
const valuationConfigurations = Array.from({ length: players }, (_, seat) =>
  [
    ['R100-reserve', equilibriumRules(), RESERVE_VALUATION],
    ['R100-targets', equilibriumRules(), RESERVE_TARGETS],
    ['R100-investment', equilibriumRules(), RESERVE_INVESTMENT],
    ['live-reserve', LIVE_ECONOMY, RESERVE_VALUATION],
  ].map(([name, rules, valuation]) => ({
    name: name + '-seat' + seat,
    rules,
    valuationOf: oneSeatValuing(valuation, seat),
    reserveSeat: seat,
  })),
).flat();

const configurations =
  suite === 'rules'
    ? ruleConfigurations
    : [
        { name: 'R100', rules: equilibriumRules(), valuationOf: everyoneLive },
        {
          name: 'R100-all-reserve',
          rules: equilibriumRules(),
          valuationOf: () => RESERVE_VALUATION,
        },
        ...valuationConfigurations,
      ];

const precision = (value) => (value === null ? null : Number(value.toPrecision(4)));
const outcome = (r) => r.winner ?? r.leader;
const fraction = (items, predicate) =>
  items.length ? precision(items.filter(predicate).length / items.length) : null;

function summarize(config, results) {
  const finished = results.filter((r) => r.finished);
  const seatOutcomes = Array.from(
    { length: players },
    (_, seat) => results.filter((r) => outcome(r) === seat).length,
  );
  return {
    name: config.name,
    rules: config.rules,
    reserveSeat: config.reserveSeat ?? null,
    eliminations: finished.length,
    medianFinishRound: precision(median(finished.map((r) => r.rounds))),
    stalemates: results.filter((r) => r.stalemate).length,
    medianCaptures: precision(median(results.map((r) => r.captures))),
    medianPlayerCaptures: precision(median(results.map((r) => r.playerCaptures))),
    leaderAt50Holds: fraction(
      results.filter((r) => r.leaderAt50 !== null),
      (r) => outcome(r) === r.leaderAt50,
    ),
    decisive: results.filter((r) => r.decisiveRound !== null).length,
    medianDecisiveRound: precision(
      median(results.filter((r) => r.decisiveRound !== null).map((r) => r.decisiveRound)),
    ),
    medianLeaderShareAt50: precision(
      median(results.filter((r) => r.shares[50]).map((r) => Math.max(...r.shares[50]))),
    ),
    medianReserveShare: precision(median(results.map((r) => r.reserveShare))),
    medianOwnedReserveShare: precision(median(results.map((r) => r.ownedReserveShare))),
    medianNeutralShare: precision(median(results.map((r) => r.neutralShare))),
    medianCaptureRichness: precision(
      median(results.map((r) => r.medianCaptureRichness).filter((x) => x !== null)),
    ),
    medianRichCaptures: precision(median(results.map((r) => r.richCaptures))),
    medianRichestNode: precision(median(results.map((r) => r.richestNode))),
    medianBattleConcentration: precision(median(results.map((r) => r.battleConcentration))),
    medianActiveOnMap: precision(median(results.map((r) => r.activeOnMap))),
    medianInvestedOnMap: precision(median(results.map((r) => r.investedOnMap))),
    medianTrace: results[0].trace.map(({ round }, index) => ({
      round,
      ...Object.fromEntries(
        ['active', 'invested', 'ownedReserve', 'neutral'].map((part) => [
          part,
          precision(median(results.map((r) => r.trace[index][part]))),
        ]),
      ),
    })),
    seatOutcomes,
    reserveSeatOutcomes: config.reserveSeat === undefined ? null : seatOutcomes[config.reserveSeat],
    reserveSeatEliminatedOthers:
      config.reserveSeat === undefined
        ? null
        : finished.filter((r) => r.winner === config.reserveSeat).length,
  };
}

const output = {
  metadata: {
    suite,
    seed,
    matches,
    maxRounds,
    count,
    players,
    caveat:
      'Bots, not people. Every configuration replays the same map and combat seeds; combat ' +
      'rolls diverge once the economies diverge. An outcome is the eliminating winner, or the ' +
      'player controlling the most energy when the round cap ends the match.',
  },
  configurations: configurations.map((config) => {
    const results = Array.from({ length: matches }, (_, index) =>
      playEquilibriumMatch({
        engine,
        rules: config.rules,
        count,
        players,
        maxRounds,
        mapSeed: seed + ':map:' + index,
        combatSeed: seed + ':combat:' + index,
        valuationOf: config.valuationOf,
      }),
    );
    return { summary: summarize(config, results), results };
  }),
};
process.stdout.write(JSON.stringify(output, null, 2) + '\n');
