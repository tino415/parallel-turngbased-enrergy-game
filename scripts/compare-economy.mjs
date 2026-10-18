#!/usr/bin/env node
import { readFileSync } from 'node:fs';

if (process.argv.length !== 4) {
  console.error('Usage: node scripts/compare-economy.mjs baseline.json treatment.json');
  process.exit(1);
}
const [baseline, treatment] = process.argv
  .slice(2)
  .map((path) => JSON.parse(readFileSync(path, 'utf8')));
if (
  baseline.matches !== treatment.matches ||
  baseline.results.length !== treatment.results.length
) {
  throw new Error('The simulation batches must have equal sizes');
}
const median = (values) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};
const compact = (n) =>
  new Intl.NumberFormat('en', {
    notation: 'compact',
    maximumFractionDigits: 3,
  }).format(n);
const pct = (n) => n.toFixed(2) + '%';
const pairs = baseline.results.map((a, index) => {
  const b = treatment.results[index];
  if (
    a.mapSeed !== b.mapSeed ||
    a.combatSeed !== b.combatSeed ||
    a.maxRounds !== b.maxRounds ||
    a.count !== b.count ||
    a.players !== b.players
  ) {
    throw new Error('Mismatched seeds, round caps, or map sizes at match ' + index);
  }
  return [a, b];
});
// Income ratios are most meaningful when BOTH games reach the SAME round cap.
const capped = pairs.filter(([a, b]) => a.rounds === a.maxRounds && b.rounds === b.maxRounds);
const incomeRatios = capped
  .filter(([a]) => a.standings[0].grossIncome > 0)
  .map(([a, b]) => b.standings[0].grossIncome / a.standings[0].grossIncome);
const summarize = (index) => {
  const report = index === 0 ? baseline : treatment;
  return [
    report.strategies[0],
    report.wins[0] + '/' + report.matches,
    report.survivalCounts[0] + '/' + report.matches,
    report.expansionCounts[0] + '/' + report.matches,
    compact(report.medianEndingEconomy[0].totalEnergy),
    compact(report.medianEndingEconomy[0].grossIncome),
    pct(report.medianEndingEconomy[0].incomeSharePct),
  ].join(' | ');
};
const output = [
  '## Seed-matched economic comparison (P0)',
  '',
  '**Maps:** ' +
    baseline.results[0].count +
    ' nodes, ' +
    baseline.results[0].players +
    ' players · **matches:** ' +
    baseline.matches +
    ' · **round limit:** ' +
    baseline.results[0].maxRounds +
    ' · **seed:** `' +
    baseline.seed.replaceAll('`', '') +
    '`',
  '',
  '| Strategy | Wins | Survived | Expanded | Median total energy | Median gross income/round | Median income share |',
  '| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
  '| ' + summarize(0) + ' |',
  '| ' + summarize(1) + ' |',
  '',
  '**Comparable full-length pairs:** ' +
    capped.length +
    '/' +
    pairs.length +
    ' (both reached the round cap).',
  '',
  '**Median treatment / baseline gross-income ratio, comparable pairs only:** ' +
    (incomeRatios.length ? compact(median(incomeRatios)) + '×' : 'not available'),
  '',
  'Wins, survival and medians reflect each match’s final resolved round; income ratio uses only',
  'paired matches that **both** reached the same cap. The two strategies have identical',
  'defensive-reserve and reinvestment rules, but expansion spends energy on attacks and',
  'acquires nodes, so actual invested capital and ending resources can differ.',
  '',
].join('\n');
console.log(output);
