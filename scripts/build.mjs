import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('../', import.meta.url);
const dist = new URL('../dist/', import.meta.url);
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
for (const path of ['index.html', '_headers', 'manifest.webmanifest', 'sw.js'])
  cpSync(new URL(path, root), new URL(path, dist));
for (const directory of ['src/', 'icons/'])
  cpSync(new URL(directory, root), new URL(directory, dist), { recursive: true });
console.log('Static site built in dist/');
