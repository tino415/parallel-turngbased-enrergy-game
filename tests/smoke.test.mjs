import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const js = readFileSync(new URL('../src/game.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

test('entry point loads local assets', () => {
  assert.match(html, /href="\.\/src\/styles\.css"/);
  assert.match(html, /src="\.\/src\/game\.js" defer/);
  assert.ok(css.length > 100);
});

test('game JavaScript parses', () => {
  assert.doesNotThrow(() => new Script(js));
});

test('planning, automation, procedural generation and combat still exist', () => {
  for (const fn of ['resolve', 'policyOrders', 'generate', 'renderFlows', 'renderViews']) {
    assert.match(js, new RegExp('function\\s+' + fn + '\\s*\\('));
  }
});

test('the build stamps version, commit and date into the built index.html', () => {
  assert.match(html, /id="buildVersion"[^>]*>Build: development</);
  const build = spawnSync(process.execPath, ['scripts/build.mjs'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, GITHUB_SHA: 'abcdef0123456789' },
  });
  assert.equal(build.status, 0, String(build.stderr));
  const built = readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8');
  assert.match(
    built,
    /id="buildVersion"[^>]*>Build: v\d+\.\d+\.\d+ · abcdef0 · \d{4}-\d{2}-\d{2}</,
  );
});
