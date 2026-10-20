import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const appShell = new Set([...read('sw.js').matchAll(/^\s+'\.\/(.*)',$/gm)].map(([, path]) => path));
const indexAssets = [...read('index.html').matchAll(/(?:href|src)="\.\/([^"]+)"/g)].map(
  ([, path]) => path,
);
const manifestIcons = JSON.parse(read('manifest.webmanifest')).icons.map((icon) => icon.src);

test('the service worker precaches every asset index.html loads', () => {
  for (const asset of indexAssets) assert.ok(appShell.has(asset), `${asset} is not precached`);
});

test('the service worker precaches every manifest icon', () => {
  for (const icon of manifestIcons) assert.ok(appShell.has(icon), `${icon} is not precached`);
});

test('the service worker precaches the start page', () => {
  assert.ok(appShell.has(''));
});
