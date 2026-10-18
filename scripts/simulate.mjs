#!/usr/bin/env node
import { simulateBatch } from '../tests/support/simulation.mjs';

const usage = `Deterministic AI-vs-AI simulation

Usage: npm run simulate -- [--matches=N] [--rounds=N] [--nodes=N] [--players=N] [--density=sparse|normal|dense] [--seed=TEXT] [--strategies=CSV] [--turtle-rounds=N] [--attack-pct=N] [--json]

Examples:
  npm run simulate -- --matches=50 --rounds=250 --seed=balance-v1
  npm run simulate -- --matches=5 --nodes=60 --players=4 --json
  npm run simulate -- --matches=100 --nodes=40 --players=4 --strategies=superturtle,default,default,default
  npm run simulate -- --matches=100 --nodes=20 --players=2 --rounds=250 --strategies=turtlecounter,default --turtle-rounds=150 --attack-pct=5

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
    const match = /^--(matches|rounds|nodes|players|density|seed|strategies|turtle-rounds|attack-pct)=(.+)$/.exec(arg);
    if (!match) throw new Error('Unrecognized option: ' + arg);
    const [, key, value] = match;
    if (key === 'density' || key === 'seed' || key === 'strategies') options[key] = value;
    else {
      const number = Number(value);
      if (key === 'attack-pct') {
        if (!Number.isFinite(number)) throw new Error('Expected numeric percentage for --' + key);
        options.attackPct = number;
      } else {
        if (!Number.isSafeInteger(number)) throw new Error('Expected integer for --' + key);
        options[
          { rounds: 'maxRounds', nodes: 'count', matches: 'matches',
            players: 'players', 'turtle-rounds': 'turtleRounds' }[key]
        ] = number;
      }
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
    console.log(
      'AI wins per player: ' + report.wins.map((value, id) => 'P' + id + '=' + value).join(' '),
    );
    console.log(
      'Strategies: ' + report.strategies.map((name, player) => 'P' + player + '=' + name).join(' '),
    );
    console.log(
      'Survival: ' +
        report.survivalRates.map((rate, player) => 'P' + player + '=' + rate + '%').join(' '),
    );
    console.log(
      'Expanded beyond home node: ' +
      report.expansionCounts.map((count, player) => 'P' + player + '=' + count).join(' '),
    );
    console.log(
      'Unresolved by round cap: ' + report.unresolved + ' (stalled: ' + report.stalledAtCap + ')',
    );
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
