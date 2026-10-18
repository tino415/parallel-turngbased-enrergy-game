import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const file = 'tests/e2e/ux.spec.mjs';
execFileSync('npx', ['prettier', '--write', file], { stdio: 'inherit' });
console.log('FORMAT_DATA|' + file + '|' + readFileSync(file).toString('base64'));
