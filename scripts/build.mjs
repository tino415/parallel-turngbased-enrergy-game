import { cpSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('../', import.meta.url);
const dist = new URL('../dist/', import.meta.url);
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
for (const path of ['index.html', '_headers']) cpSync(new URL(path, root), new URL(path, dist));
cpSync(new URL('src/', root), new URL('src/', dist), { recursive: true });
console.log('Static site built in dist/');

// Serve one versioned JavaScript bundle to avoid engine/UI asset mismatches.
const engine = readFileSync(new URL('src/engine.js', root), 'utf8');
const game = readFileSync(new URL('src/game.js', root), 'utf8');
writeFileSync(new URL('src/app.js', dist), engine + '\n;\n' + game);
