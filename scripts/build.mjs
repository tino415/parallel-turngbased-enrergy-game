import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('../', import.meta.url);
const dist = new URL('../dist/', import.meta.url);
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
for (const path of ['index.html', '_headers']) cpSync(new URL(path, root), new URL(path, dist));
cpSync(new URL('src/', root), new URL('src/', dist), { recursive: true });
console.log('Static site built in dist/');
