import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

function seededRandom(seed) {
  const generator = () => {
    generator.calls += 1;
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  generator.calls = 0;
  return generator;
}

function loadStore(random) {
  const context = createContext({ Math: Object.assign(Object.create(Math), { random }) });
  runInContext(read('../src/engine.js'), context);
  runInContext(read('../src/store.js'), context);
  return context.GameStore;
}

function newMatch() {
  const random = seededRandom(7);
  const GameStore = loadStore(random);
  const store = GameStore.createStore({ selected: null });
  store.replaceMatch(GameStore.classicMatch(random, { enabled: true, reserve: '5', invest: '70' }));
  return { GameStore, store, random };
}

test('the AI debug plan names orders for AI nodes only', () => {
  const { GameStore, store } = newMatch();
  const match = store.getSnapshot().match;
  const { orders } = GameStore.selectors.aiDebugPlan(match);
  assert.ok(orders.length > 0);
  for (const order of orders) assert.notEqual(match.state.nodes[order.source].owner, 0);
});

test('reading the AI debug plan changes neither the match nor the random stream', () => {
  const { GameStore, store, random } = newMatch();
  const before = JSON.stringify(store.getSnapshot().match);
  const callsBefore = random.calls;
  GameStore.selectors.aiDebugPlan(store.getSnapshot().match);
  store.setAiDebug(true);
  assert.equal(JSON.stringify(store.getSnapshot().match), before);
  assert.equal(random.calls, callsBefore);
});

test('a seeded match plays out identically with the AI debug view on and off', () => {
  const off = newMatch();
  const on = newMatch();
  on.store.setAiDebug(true);
  const plan = () => on.GameStore.selectors.aiDebugPlan(on.store.getSnapshot().match);
  const played = [];
  for (let i = 0; i < 5; i++) {
    plan();
    on.store.resolve(on.random);
    off.store.resolve(off.random);
    played.push(
      JSON.stringify(on.store.getSnapshot().match) ===
        JSON.stringify(off.store.getSnapshot().match),
    );
  }
  assert.deepEqual(played, [true, true, true, true, true]);
  assert.equal(on.random.calls, off.random.calls);
});
