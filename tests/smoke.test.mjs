import test from 'node:test';
import assert from 'node:assert/strict';
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
  for (const fn of [
    'resolve',
    'policyOrders',
    'generate',
    'renderFlows',
    'renderDashboard',
    'renderPolicyEditor',
  ]) {
    assert.match(js, new RegExp('function\\s+' + fn + '\\s*\\('));
  }
});

test('release version appears in header', () => {
  assert.match(html, /id="version"[^>]*>v\d+\.\d+\.\d+</);
});
