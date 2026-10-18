#!/usr/bin/env node
import { readFileSync } from 'node:fs';

const path = process.argv[2];
if (!path) {
  console.error('Usage: node scripts/summarize-simulation.mjs <report.json>');
  process.exit(1);
}
const report = JSON.parse(readFileSync(path, 'utf8'));
const pct = (value) => value.toFixed(2) + '%';
const compact = (value) => new Intl.NumberFormat('en', {
  notation: 'compact',
  maximumFractionDigits: 2,
}).format(value);
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
  '## Final economy (median across matches)',
  '',
  '| Player | Nodes | Active energy | Invested energy | Total controlled | Base +1 | Invested yield | Gross / round | Income share |',
  '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
  ...report.medianEndingEconomy.map((entry) =>
    '| P' + entry.player +
    ' | ' + compact(entry.nodes) +
    ' | ' + compact(entry.active) +
    ' | ' + compact(entry.invested) +
    ' | ' + compact(entry.totalEnergy) +
    ' | ' + compact(entry.baseIncome) +
    ' | ' + compact(entry.investmentIncome) +
    ' | ' + compact(entry.grossIncome) +
    ' | ' + pct(entry.incomeSharePct) + ' |',
  ),
  '',
  'Gross income = owned nodes × 1 + invested energy × 10%. Total controlled = active + invested.',
  'The figures are separate per-player medians across matches, so columns may not add up exactly.',
  'They describe each game at its last resolved round (which may be earlier than the round cap).',
  'Gross income does not subtract the next turn’s 10% active-energy decay or future combat losses.',
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
