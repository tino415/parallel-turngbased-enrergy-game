import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const dist = new URL('../dist/', import.meta.url);
const placeholder = 'Build: development';

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
for (const path of ['_headers', 'manifest.webmanifest', 'sw.js'])
  cpSync(new URL(path, root), new URL(path, dist));
for (const directory of ['src/', 'icons/'])
  cpSync(new URL(directory, root), new URL(directory, dist), { recursive: true });
writeFileSync(new URL('index.html', dist), stampedIndex());
console.log(`Static site built in dist/ (${buildLabel()})`);

function stampedIndex() {
  const index = readFileSync(new URL('index.html', root), 'utf8');
  if (!index.includes(placeholder)) throw new Error(`index.html lacks "${placeholder}"`);
  return index.replace(placeholder, `Build: ${buildLabel()}`);
}

function buildLabel() {
  const { version } = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
  const date = new Date().toISOString().slice(0, 10);
  return `v${version} · ${commit()} · ${date}`;
}

function commit() {
  const fromCi = process.env.WORKERS_CI_COMMIT_SHA || process.env.GITHUB_SHA;
  return (fromCi || gitHead() || 'unknown').slice(0, 7);
}

function gitHead() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', stdio: 'pipe' }).trim();
  } catch {
    return '';
  }
}
