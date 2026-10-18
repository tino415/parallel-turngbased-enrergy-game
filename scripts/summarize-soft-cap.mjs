#!/usr/bin/env node
import { readFileSync } from 'node:fs';

const path = process.argv[2];
if (!path) throw new Error('Usage: summarize-soft-cap.mjs report.json');
const data = JSON.parse(readFileSync(path, 'utf8'));
const meta = data.metadata;
const compact = (value) =>
  new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 3 }).format(value);
const baseline = data.configurations.baseline.cases;
const lines = [
  '# Soft-cap experiment: ' + meta.seed,
  '',
  meta.matches +
    ' seed-matched games · ' +
    meta.count +
    ' nodes · ' +
    meta.players +
    ' players · ' +
    meta.maxRounds +
    ' turns · opponent: ' +
    meta.opponent +
    ' · P0 handicap: ' +
    meta.handicap,
  '',
  '| Rules | Strategy | Wins | Survived | Expanded | Stalemates | Median nodes | Median total | Median gross/round | Gross vs baseline | Expander/Turtle |',
  '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
];
for (const [name, { cases }] of Object.entries(data.configurations)) {
  for (const [strategy, { summary }] of Object.entries(cases)) {
    if (!summary) continue;
    const base = baseline[strategy]?.summary;
    const ratio = base?.medianGross > 0 ? summary.medianGross / base.medianGross : null;
    lines.push(
      '| ' +
        [
          name,
          strategy,
          summary.wins + '/' + meta.matches,
          summary.survived + '/' + meta.matches,
          summary.expanded + '/' + meta.matches,
          summary.stalemates + '/' + meta.matches,
          summary.medianNodes,
          compact(summary.medianTotal),
          compact(summary.medianGross),
          ratio === null ? '—' : ratio.toFixed(3) + '×',
          strategy === 'compoundexpand'
            ? cases.expanderVsTurtle.medianGrossRatio.toFixed(3) + '×'
            : '—',
        ].join(' | ') +
        ' |',
    );
  }
}
lines.push(
  '',
  'Gross income is measured after end-round overflow loss, before future decay.',
  'Paired expander/turtle ratios compare games with equal rounds; view full JSON for per-seed outcomes.',
  'Identical input seeds do not guarantee identical RNG consumption when choices diverge.',
  '',
);
console.log(lines.join('\n'));
