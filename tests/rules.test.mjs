import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const plain = (value) => JSON.parse(JSON.stringify(value));
const close = (actual, expected) =>
  assert.ok(Math.abs(actual - expected) < 1e-9, actual + ' != ' + expected);

function loadContext() {
  const context = createContext({});
  runInContext(read('../src/engine.js'), context);
  runInContext(read('../src/store.js'), context);
  return context;
}

const { GameEngine, GameStore } = loadContext();
const DEFAULTS = { enabled: true, reserve: '5', invest: '70' };
const CUSTOM = { production: 3, interest: 0.2, capacity: 100, overflowDecay: 0.5 };
const smallMap = () =>
  GameEngine.buildMap({ count: 12, players: 2, density: 'normal', seed: 'rules' });

function quietRound(state) {
  return GameEngine.resolveRound({
    state,
    orders: {},
    policies: {},
    links: [],
    rng: () => 0.5,
    aiOrdersOverride: [],
    aiWithdrawalsOverride: {},
  });
}

const softCapState = (nodes, rules) => ({
  round: 1,
  finished: false,
  rulesVersion: GameEngine.SOFT_CAP_RULES.version,
  nodes,
  ...(rules ? { rules } : {}),
});

test('a state without rules plays by the default rules', () => {
  assert.deepEqual(plain(GameEngine.rulesOf({})), {
    production: 1,
    interest: 0.1,
    capacity: 250,
    overflowDecay: 0.25,
  });
  const next = quietRound(softCapState([{ id: 0, owner: 0, active: 10, invested: 20 }]));
  close(next.state.nodes[0].active, 0.9 * 10 + 1 + 0.1 * 20);
});

test('a round produces with the production and interest of the state rules', () => {
  const next = quietRound(softCapState([{ id: 0, owner: 0, active: 10, invested: 20 }], CUSTOM));
  close(next.state.nodes[0].active, 0.9 * 10 + 3 + 0.2 * 20);
  close(next.ledger[0].production, 3 + 0.2 * 20);
});

test('a round decays overflow above the capacity of the state rules', () => {
  const next = quietRound(softCapState([{ id: 0, owner: 0, active: 100, invested: 50 }], CUSTOM));
  const total = 0.9 * 100 + 3 + 0.2 * 50 + 50;
  close(next.ledger[0].overflow, (total - 100) * 0.5);
  close(next.state.nodes[0].active + next.state.nodes[0].invested, total - (total - 100) * 0.5);
  assert.deepEqual(plain(next.state.rules), CUSTOM);
});

test('the forecast projects with the rules it is given', () => {
  const node = { id: 0, owner: 0, active: 100, invested: 50 };
  const prediction = GameEngine.forecast(node, 0, [], { softCap: true, rules: CUSTOM });
  const total = 0.9 * 100 + 3 + 0.2 * 50 + 50;
  close(prediction.income, 3 + 0.2 * 50);
  close(prediction.overflow, (total - 100) * 0.5);
  assert.equal(prediction.capacity, 100);
});

test('a generated match keeps custom rules in its state and replay start', () => {
  const match = GameStore.generatedMatch(smallMap(), DEFAULTS, () => 0.5, 0, CUSTOM);
  assert.deepEqual(plain(match.state.rules), CUSTOM);
  assert.deepEqual(plain(match.replay.start.rules), CUSTOM);
  assert.deepEqual(plain(GameStore.selectors.rules(match)), CUSTOM);
});

test('a generated match with the default rules stores none, like before', () => {
  const rules = { ...GameEngine.DEFAULT_RULES };
  const match = GameStore.generatedMatch(smallMap(), DEFAULTS, () => 0.5, 0, rules);
  assert.equal('rules' in match.state, false);
  assert.equal('rules' in GameStore.generatedMatch(smallMap(), DEFAULTS, () => 0.5).state, false);
});

test('custom rules survive a save and reload', () => {
  const match = GameStore.generatedMatch(smallMap(), DEFAULTS, () => 0.5, 0, CUSTOM);
  const save = JSON.parse(JSON.stringify(GameStore.saveFromMatch(match, null)));
  const restored = GameStore.matchFromSave(save, DEFAULTS);
  assert.deepEqual(plain(GameStore.selectors.rules(restored)), CUSTOM);
});

test('a save from before custom rules loads with the default rules', () => {
  const match = GameStore.generatedMatch(smallMap(), DEFAULTS, () => 0.5);
  const save = JSON.parse(JSON.stringify(GameStore.saveFromMatch(match, null)));
  delete save.state.rules;
  const restored = GameStore.matchFromSave(save, DEFAULTS);
  assert.deepEqual(
    plain(GameStore.selectors.rules(restored)),
    plain({ ...GameEngine.DEFAULT_RULES }),
  );
});

test('the node projection uses the match rules', () => {
  const store = GameStore.createStore({ selected: null });
  store.replaceMatch(GameStore.generatedMatch(smallMap(), DEFAULTS, () => 0.5, 0, CUSTOM));
  const match = store.getSnapshot().match;
  const own = match.state.nodes.find((node) => node.owner === 0);
  assert.equal(GameStore.selectors.projection(match, own.id).capacity, 100);
});

test('a rule that is not a finite number falls back to its default', () => {
  const rules = GameEngine.rulesOf({
    rules: { production: '2', interest: null, capacity: Infinity, overflowDecay: 0.5 },
  });
  assert.deepEqual(plain(rules), {
    production: 1,
    interest: 0.1,
    capacity: 250,
    overflowDecay: 0.5,
  });
});
