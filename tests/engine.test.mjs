import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
const source = readFileSync(new URL('../src/engine.js', import.meta.url), 'utf8');
const engine = runInNewContext(source + ';GameEngine');
test('manual allocations take priority over policies', () => {
  const orders = engine.evaluatePolicy({
    source: 0,
    node: { owner: 0, active: 100 },
    manualSpent: 70,
    manualHold: false,
    policy: { enabled: true, reserve: 20, investPct: 50, dest: 1 },
    neighbors: [1],
    owners: [0, 0],
  });
  assert.equal(orders.length, 2);
  assert.equal(orders[0].amount, 5);
  assert.equal(orders[1].amount, 5);
});
test('hold and disabled policies spend nothing', () => {
  const base = {
    source: 0,
    node: { owner: 0, active: 100 },
    manualSpent: 0,
    neighbors: [1],
    owners: [0, 0],
    policy: { enabled: true, reserve: 0, investPct: 100, dest: 1 },
  };
  assert.equal(engine.evaluatePolicy({ ...base, manualHold: true }).length, 0);
  assert.equal(
    engine.evaluatePolicy({
      ...base,
      manualHold: false,
      policy: { ...base.policy, enabled: false },
    }).length,
    0,
  );
});
test('unfriendly destinations cannot receive automated transfers', () => {
  const orders = engine.evaluatePolicy({
    source: 0,
    node: { owner: 0, active: 100 },
    manualSpent: 0,
    manualHold: false,
    policy: { enabled: true, reserve: 10, investPct: 50, dest: 1 },
    neighbors: [1],
    owners: [0, 1],
  });
  assert.equal(orders.length, 1);
  assert.equal(orders[0].type, 'invest');
});
test('forecast includes invested capital and incoming transfers', () => {
  const result = engine.forecast({ active: 100, invested: 100 }, 10, [
    { type: 'invest', amount: 30 },
    { type: 'transfer', amount: 40 },
  ]);
  assert.equal(result.defense, 30);
  assert.equal(result.income, 14);
  assert.equal(result.next, 50);
});
