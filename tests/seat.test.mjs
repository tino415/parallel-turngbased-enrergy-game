import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const plain = (value) => JSON.parse(JSON.stringify(value));
const DEFAULTS = { enabled: true, reserve: '5', invest: '70' };
const PURPLE = 2;

const context = createContext({ Math: Object.assign(Object.create(Math), {}) });
runInContext(read('../src/engine.js'), context);
runInContext(read('../src/store.js'), context);
const { GameEngine, GameStore } = runInContext('({ GameEngine, GameStore })', context);

const node = (id, owner, active, invested = 0) => ({ id, owner, active, invested });
const threeNodeLine = [
  [0, 1],
  [1, 2],
];
const threePlayerState = () => ({
  round: 1,
  finished: false,
  nodes: [node(0, 0, 30), node(1, null, 2), node(2, PURPLE, 30)],
});

test('the AI plays Blue when Purple is the human', () => {
  const plan = GameEngine.aiPlan(threePlayerState(), threeNodeLine, PURPLE);
  const planners = new Set(plan.orders.map((order) => order.source));
  assert.ok(planners.has(0));
  assert.ok(!planners.has(2));
});

test('the AI leaves Purple alone and plays Blue in a resolved round', () => {
  const result = GameEngine.resolveRound({
    state: threePlayerState(),
    seat: PURPLE,
    orders: {},
    policies: {},
    links: threeNodeLine,
    rng: () => 0.5,
  });
  assert.ok(result.moves.every((move) => move.owner !== PURPLE));
  assert.ok(result.moves.some((move) => move.owner === 0));
});

test('Purple orders resolve as Purple moves and a Purple transfer lands on a Purple node', () => {
  const state = threePlayerState();
  state.nodes[1].owner = PURPLE;
  const result = GameEngine.resolveRound({
    state,
    seat: PURPLE,
    orders: { 2: { invest: 0, edges: { 1: 10 } } },
    policies: {},
    links: threeNodeLine,
    rng: () => 0.5,
  });
  const transfer = result.moves.find((move) => move.source === 2 && move.dest === 1);
  assert.deepEqual([transfer.type, transfer.owner], ['transfer', PURPLE]);
});

test('Purple policies run, Blue policies are dropped, and a conquered node takes the default policy', () => {
  const state = threePlayerState();
  const result = GameEngine.resolveRound({
    state,
    seat: PURPLE,
    orders: { 2: { invest: 0, edges: { 1: 25 } } },
    policies: {
      2: { enabled: true, reserve: 0, investPct: 100, dest: null },
      0: { enabled: true, reserve: 0, investPct: 100, dest: null },
    },
    links: threeNodeLine,
    defaultConquestPolicy: { enabled: true, reserve: 1, investPct: 50 },
    rng: () => 0.9,
  });
  assert.equal(result.state.nodes[1].owner, PURPLE);
  assert.ok(result.policies[1]);
  assert.ok(result.policies[2]);
  assert.equal(result.policies[0], undefined);
});

test('a policy transfers surplus to a friendly Purple node and presses a foreign one', () => {
  const nodes = [node(0, PURPLE, 100), node(1, PURPLE, 1), node(2, 0, 1)];
  const plan = (dest) =>
    GameEngine.planPolicy({
      policy: { enabled: true, reserve: 5, investPct: 0, dest },
      node: nodes[0],
      manualSpent: 0,
      neighbors: [1, 2],
      owners: nodes.map((n) => n.owner),
      source: 0,
    }).orders;
  assert.equal(plan(1).filter((order) => order.type === 'transfer').length, 1);
  assert.equal(plan(2).filter((order) => order.type === 'transfer').length, 0);
});

test('a new match as Purple greets Purple and owns nodes through isOwn', () => {
  const match = GameStore.classicMatch(() => 0.5, DEFAULTS, 1);
  assert.equal(match.seat, 1);
  assert.match(match.history[0], /You are Red/);
  const redNode = match.state.nodes.find((n) => n.owner === 1).id;
  const blueNode = match.state.nodes.find((n) => n.owner === 0).id;
  assert.ok(GameStore.selectors.isOwn(match, redNode));
  assert.ok(!GameStore.selectors.isOwn(match, blueNode));
});

test('orders on the human seat are accepted and Blue nodes refused when Purple plays', () => {
  const match = generatedAs(PURPLE);
  const store = GameStore.createStore();
  store.replaceMatch(match);
  const own = match.state.nodes.find((n) => n.owner === PURPLE).id;
  const foreign = match.state.nodes.find((n) => n.owner === 0).id;
  store.setAllocation(foreign, null, 1);
  assert.deepEqual(plain(store.getSnapshot().match.orders), {});
  store.setAllocation(own, null, 1);
  assert.equal(store.getSnapshot().match.orders[own].invest, 1);
});

test('resolving a round as Purple never lets the AI act for Purple and keeps the seat', () => {
  const store = GameStore.createStore();
  store.replaceMatch(generatedAs(PURPLE));
  store.resolve();
  const { match } = store.getSnapshot();
  assert.equal(match.seat, PURPLE);
  assert.equal(match.state.round, 2);
  assert.ok(Object.keys(match.policies).every((id) => match.state.nodes[id].owner === PURPLE));
});

test('a save keeps the seat and a save without one loads as Blue', () => {
  const match = generatedAs(PURPLE);
  const save = plain(GameStore.saveFromMatch(match, null));
  assert.equal(GameStore.matchFromSave(save, DEFAULTS).seat, PURPLE);
  delete save.seat;
  assert.equal(GameStore.matchFromSave(save, DEFAULTS).seat, 0);
});

test('a replay of a match played as Purple replays as Purple, and a replay without a seat plays as Blue', () => {
  const store = GameStore.createStore();
  store.replaceMatch(generatedAs(PURPLE));
  const own = () =>
    store.getSnapshot().match.state.nodes.find((n) => n.owner === PURPLE && n.active > 5)?.id;
  for (let round = 0; round < 3 && own() !== undefined; round++) {
    store.setAllocation(own(), null, 3);
    store.resolve();
  }
  const { match } = store.getSnapshot();
  assert.equal(match.replay.seat, PURPLE);
  const frames = GameStore.selectors.replayFrames(match);
  assert.equal(frames.length, match.replay.rounds.length + 1);
  assert.deepEqual(plain(frames.at(-1).state), plain(match.state));

  const oldReplay = { ...match.replay };
  delete oldReplay.seat;
  const blue = GameStore.selectors.replayFrames({ ...match, seat: 0, replay: oldReplay });
  assert.equal(blue.length, frames.length);
});

function generatedAs(seat) {
  let n = 1;
  const random = () => (n = (n * 16807) % 2147483647) / 2147483647;
  const map = GameEngine.buildMap({ count: 20, players: 3, density: 'normal', seed: 'seat' });
  return GameStore.generatedMatch(map, DEFAULTS, random, seat);
}

test('a colour outside the first players still plays against a single AI', () => {
  const GREEN = 4;
  const map = GameEngine.buildMap({ count: 20, players: 2, density: 'normal', seed: 'seat' });
  const match = GameStore.generatedMatch(map, DEFAULTS, () => 0.5, GREEN);
  assert.deepEqual(plain(GameStore.selectors.ownersOf(match)), [0, GREEN]);
  assert.ok(match.state.nodes.some((n) => n.owner === GREEN));
  assert.ok(!match.state.nodes.some((n) => n.owner === 1));
  assert.deepEqual(
    plain(GameStore.selectors.leaderboard(match).map((standing) => standing.player)),
    [0, GREEN],
  );

  const store = GameStore.createStore();
  store.replaceMatch(match);
  store.resolve();
  const resolved = store.getSnapshot().match;
  assert.ok(resolved.history.some((line) => line.includes('Round 1 complete: Blue')));
  assert.ok(resolved.history[0].includes('Green'));

  const reloaded = GameStore.matchFromSave(
    plain(GameStore.saveFromMatch(resolved, null)),
    DEFAULTS,
  );
  assert.deepEqual(plain(GameStore.selectors.ownersOf(reloaded)), [0, GREEN]);
  assert.equal(reloaded.seat, GREEN);
});
