#!/usr/bin/env node
import { readFileSync } from 'node:fs';

const path = process.argv[2];
if (!path) {
  console.error('Usage: node scripts/summarize-simulation.mjs <report.json>');
  process.exit(1);
}
const report = JSON.parse(readFileSync(path, 'utf8'));
const pct = (value) => value.toFixed(2) + '%';
const markdown = [
  '# Strategy balance simulation',
  '',
  'Seed: `' + report.seed.replaceAll('`', '') + '` · Matches: **' + report.matches + '**',
  '',
  '| Player | Strategy | Wins | Win rate | Survived | Survival rate | Expanded |',
  '| --- | --- | ---: | ---: | ---: | ---: | ---: |',
  ...report.strategies.map(
    (strategy, player) =>
      '| P' +
      player +
      ' | ' +
      strategy +
      ' | ' +
      report.wins[player] +
      ' | ' +
      pct(report.winRates[player]) +
      ' | ' +
      report.survivalCounts[player] +
      ' | ' +
      pct(report.survivalRates[player]) +
      ' | ' +
      report.expansionCounts[player] +
      ' |',
  ),
  '',
  '**Counterattack settings:** turtle for ' +
    report.turtleRounds +
    ' rounds, then attack with at most ' +
    report.attackPct +
    '% of active energy per round',
  '',
  '**Unresolved at round cap:** ' + report.unresolved + ' / ' + report.matches,
  '',
  '**No capture in last 25+ rounds (unresolved):** ' + report.stalledAtCap,
  '',
  '**Rounds:** mean ' +
    report.averageRounds +
    ', min ' +
    report.minRounds +
    ', max ' +
    report.maxRounds,
  '',
  'Survival is not victory. An unresolved match may have multiple surviving players.',
  '',
  'Detailed per-match reproducible seeds and checksums are in `simulation.json`.',
  '',
].join('\n');
console.log(markdown);
