#!/usr/bin/env node
import { simulateBatch } from '../tests/support/simulation.mjs';

const usage = `Deterministic AI-vs-AI simulation

Usage: npm run simulate -- [--matches=N] [--rounds=N] [--nodes=N] [--players=N] [--density=sparse|normal|dense] [--seed=TEXT] [--blue=STRATEGY] [--opponents=STRATEGY] [--strategies=CSV] [--json]

Examples:
  npm run simulate -- --matches=50 --rounds=250 --seed=balance-v1
  npm run simulate -- --matches=5 --nodes=60 --players=4 --json
  npm run simulate -- --matches=100 --nodes=40 --players=4 --blue=extreme-turtle
  npm run simulate -- --matches=100 --nodes=40 --players=4 --blue=turtle

Strategies: default, turtle, extreme-turtle, aggressive, balanced
--blue configures player 0; --opponents configures all other players.
--strategies=CSV sets every player individually (e.g. extreme-turtle,default,default,default).
Turtle expands defensively into neutral territory; Extreme Turtle never attacks or transfers.

Repeat the same command to reproduce the same maps, combat rolls and results.
Note: the seed controls this simulation only, not browser gameplay.`;

function parse(args) {
  const options = {};
  for (const arg of args) {
    if (arg === '--help' || arg === '-h') return null;
    if (arg === '--json') {
      options.json = true;
      continue;
    }
    const match = /^--(matches|rounds|nodes|players|density|seed|blue|opponents|strategies)=(.+)$/.exec(arg);
    if (!match) throw new Error('Unrecognized option: ' + arg);
    const [, key, value] = match;
    if (key === 'density' || key === 'seed') options[key] = value;
    else if (key === 'blue') options.blueStrategy = value;
    else if (key === 'opponents') options.opponentStrategy = value;
    else if (key === 'strategies') options.strategies = value.split(',');
    else {
      const number = Number(value);
      if (!Number.isSafeInteger(number)) throw new Error('Expected integer for --' + key);
      options[
        { rounds: 'maxRounds', nodes: 'count', matches: 'matches', players: 'players' }[key]
      ] = number;
    }
  }
  return options;
}

try {
  const options = parse(process.argv.slice(2));
  if (options === null) {
    process.stdout.write(usage);
    process.exit(0);
  }
  const { json, ...simulationOptions } = options;
  const report = simulateBatch(simulationOptions);
  if (json) console.log(JSON.stringify(report, null, 2));
  else {
    console.log('Seed: ' + report.seed + ' | Matches: ' + report.matches);
    console.log('Strategies: ' + report.strategies.map((s, i) => 'P' + i + '=' + s).join(' '));
    console.log(
      'AI wins per player: ' + report.wins.map((value, id) => 'P' + id + '=' + value).join(' '),
    );
    console.log('Unresolved by round cap: ' + report.unresolved);
    console.log('Survival at round cap / match end (%): ' +
      report.survivalRate.map((v, i) => 'P' + i + '=' + v).join(' '));
    console.log('Mean final invested energy: ' +
      report.averageInvested.map((v, i) => 'P' + i + '=' + v).join(' '));
    console.log(
      'Rounds: average=' +
        report.averageRounds +
        ', min=' +
        report.minRounds +
        ', max=' +
        report.maxRounds,
    );
    console.log(
      'First match: map=' +
        report.results[0].mapSeed +
        ', combat=' +
        report.results[0].combatSeed +
        ', checksum=' +
        report.results[0].checksum,
    );
  }
} catch (error) {
  console.error(error.message);
  console.error('Use --help to see valid options.');
  process.exitCode = 1;
}
