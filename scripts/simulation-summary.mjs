#!/usr/bin/env node
import { appendFileSync, readFileSync } from 'node:fs';

const path = process.argv[2] ?? 'simulation-results.json';
const report = JSON.parse(readFileSync(path, 'utf8'));
const summary = [
  '# Parallel Energy Game — Balance simulation',
  '',
  `**Matches:** ${report.matches} · **Seed:** \`${report.seed}\``,
  '',
  '| Player | Strategy | Wins | Survived (%) | Mean final invested energy |',
  '|---|---|---:|---:|---:|',
  ...report.strategies.map(
    (strategy, i) =>
      `| P${i} | ${strategy} | ${report.wins[i]} | ${report.survivalRate[i]} | ${report.averageInvested[i]} |`,
  ),
  '',
  `**Unresolved by round limit:** ${report.unresolved} of ${report.matches}`,
  '',
  `**Rounds:** average ${report.averageRounds}, min ${report.minRounds}, max ${report.maxRounds}`,
  '',
  'Results were generated using the game engine without changing live gameplay rules.',
  'An Extreme Turtle cannot win through conquest; compare its survival rate and investment growth instead of its wins.',
  '',
  'Download the JSON artifact for individual match seeds, round-state checksums and statistics.',
  '',
].join('\n');
console.log(summary);
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
}
