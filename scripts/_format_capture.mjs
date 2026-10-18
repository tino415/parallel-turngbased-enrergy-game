import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const files = ['src/tactical-ui.js', 'tests/e2e/ux.spec.mjs'];
execFileSync('npx', ['prettier', '--write', ...files], { stdio: 'inherit' });
for (const file of files) {
  console.log('FORMAT_DATA|' + file + '|' + readFileSync(file).toString('base64'));
}
