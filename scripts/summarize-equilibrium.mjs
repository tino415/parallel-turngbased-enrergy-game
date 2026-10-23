#!/usr/bin/env node
// Turns one or more equilibrium-experiment JSON files into Markdown tables.
import { readFileSync } from 'node:fs';

const files = process.argv.slice(2);
if (!files.length) throw new Error('Usage: summarize-equilibrium.mjs <experiment.json>...');

const pct = (value) => (value === null ? '–' : Math.round(value * 100) + '%');
const num = (value) => (value === null ? '–' : String(value));

const sections = files.map((file) => {
  const { metadata, configurations } = JSON.parse(readFileSync(file, 'utf8'));
  const summaries = configurations.map((c) => c.summary);
  const outcomesOf = (s) =>
    s.reserveSeat === null
      ? s.seatOutcomes.join(' / ')
      : s.reserveSeatOutcomes + ' of ' + metadata.matches;
  return [
    `## ${metadata.suite}: ${metadata.count} nodes, ${metadata.players} players, ` +
      `${metadata.matches} seeds × ${metadata.maxRounds} rounds (\`${metadata.seed}\`)`,
    '',
    '| Configuration | Eliminations | Median finish | Stalemates | Captures | Leader at 50 holds | Leader share at 50 | Reserve share at end | Capture richness | Richest node | Battle concentration | Active at end | Invested at end | Outcomes |',
    '| --- | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: | --- |',
    ...summaries.map(
      (s) =>
        '| ' +
        [
          s.name,
          s.eliminations + ' of ' + metadata.matches,
          num(s.medianFinishRound),
          s.stalemates,
          num(s.medianCaptures),
          pct(s.leaderAt50Holds),
          pct(s.medianLeaderShareAt50),
          pct(s.medianReserveShare),
          num(s.medianCaptureRichness),
          num(s.medianRichestNode),
          pct(s.medianBattleConcentration),
          num(s.medianActiveOnMap),
          num(s.medianInvestedOnMap),
          outcomesOf(s),
        ].join(' | ') +
        ' |',
    ),
    '',
  ].join('\n');
});
process.stdout.write(sections.join('\n') + '\n');
