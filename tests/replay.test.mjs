import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const plain = (value) => JSON.parse(JSON.stringify(value));
const DEFAULTS = { enabled: true, reserve: '5', invest: '70' };

function loadContext() {
  const context = createContext({ Math: Object.assign(Object.create(Math), {}) });
  runInContext(read('../src/engine.js'), context);
  runInContext(read('../src/store.js'), context);
  return context;
}

function seededRandom(seed = 7) {
  return () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
}

function playedGame({ match, rounds, GameStore, GameEngine }) {
  const store = GameStore.createStore();
  store.replaceMatch(match);
  const live = [];
  const random = seededRandom(99);
  while (!store.getSnapshot().match.state.finished && live.length < rounds) {
    issueOrdersLikeAPlayer(store, GameEngine, random);
    const before = store.getSnapshot().match;
    store.resolve();
    const after = store.getSnapshot().match;
    live.push({
      state: before.state,
      history: after.history,
      after: after.state,
    });
  }
  return { store, live };
}

function issueOrdersLikeAPlayer(store, GameEngine, random) {
  const { state, map } = store.getSnapshot().match;
  const { orders, withdrawals } = GameEngine.economicAI(state.nodes, map.edges, true);
  for (const [id, choice] of Object.entries(orders)) {
    const source = Number(id);
    if (state.nodes[source].owner !== 0 || random() < 0.4) continue;
    if (withdrawals[id]) store.setAllocation(source, 'withdraw', withdrawals[id]);
    for (const order of [choice].flat())
      store.setAllocation(source, order.type === 'invest' ? null : order.dest, order.amount);
  }
  const own = state.nodes.filter((n) => n.owner === 0).map((n) => n.id);
  if (own.length && random() < 0.3)
    store.changePolicy(own[Math.floor(random() * own.length)], 'reserve', Math.round(random() * 9));
  if (random() < 0.1) store.setDefaults({ reserve: String(Math.round(random() * 8)) });
}

function reloaded(GameStore, match) {
  return GameStore.matchFromSave(plain(GameStore.saveFromMatch(match, null)), DEFAULTS);
}

function assertReplayReproduces(GameStore, match, live) {
  const frames = GameStore.selectors.replayFrames(reloaded(GameStore, match));
  assert.equal(frames.length, live.length + 1);
  for (const [round, played] of live.entries()) {
    assert.deepEqual(plain(frames[round].state), plain(played.state), 'state of frame ' + round);
    const newestFirst = plain(frames[round].events).reverse();
    assert.match(newestFirst[0], new RegExp('^Round ' + played.state.round + ' complete|wins'));
    assert.deepEqual(
      newestFirst,
      plain(played.history.slice(0, newestFirst.length)),
      'log of ' + round,
    );
    assert.deepEqual(plain(frames[round + 1].state), plain(played.after));
  }
  assert.deepEqual(plain(frames.at(-1).state), plain(match.state));
}

test('replaying the recorded orders reproduces every round of a classic game exactly', () => {
  const { GameStore, GameEngine } = loadContext();
  const match = GameStore.classicMatch(seededRandom(), DEFAULTS);
  const { store, live } = playedGame({ match, rounds: 200, GameStore, GameEngine });
  assert.ok(live.length >= 10);
  assertReplayReproduces(GameStore, store.getSnapshot().match, live);
});

test('replaying the recorded orders reproduces every round on the 120-node map exactly', () => {
  const { GameStore, GameEngine } = loadContext();
  const map = GameEngine.buildMap({ count: 120, players: 6, density: 'normal', seed: 'energy-42' });
  const match = GameStore.generatedMatch(map, DEFAULTS, seededRandom(5));
  const { store, live } = playedGame({ match, rounds: 80, GameStore, GameEngine });
  assert.equal(live.length, 80);
  assertReplayReproduces(GameStore, store.getSnapshot().match, live);
});

test('each frame carries the moves of its round, the AI players included', () => {
  const { GameStore, GameEngine } = loadContext();
  const match = GameStore.classicMatch(seededRandom(), DEFAULTS);
  const { store } = playedGame({ match, rounds: 12, GameStore, GameEngine });
  const frames = GameStore.selectors.replayFrames(store.getSnapshot().match);
  const moves = frames.flatMap((frame) =>
    frame.moves.map((move) => ({ ...move, sourceOwner: frame.state.nodes[move.source].owner })),
  );
  assert.ok(moves.some((move) => move.owner === 0));
  assert.ok(moves.some((move) => move.owner === 1));
  assert.ok(moves.some((move) => move.type === 'invest'));
  for (const move of moves) assert.equal(move.owner, move.sourceOwner);
  assert.deepEqual(plain(frames.at(-1).moves), []);
});

test('a round records only the policies the player changed', () => {
  const { GameStore } = loadContext();
  const store = GameStore.createStore();
  store.replaceMatch(GameStore.classicMatch(seededRandom(), DEFAULTS));
  store.changePolicy(0, 'reserve', 3);
  store.resolve();
  store.resolve();
  const [first, second] = store.getSnapshot().match.replay.rounds;
  assert.deepEqual(Object.keys(first.policies), ['0']);
  assert.deepEqual(plain(second.policies), {});
});

test('the dice of a round come from the match, so the same orders resolve the same way', () => {
  const { GameStore } = loadContext();
  const resolvedOnce = () => {
    const store = GameStore.createStore();
    store.replaceMatch(GameStore.classicMatch(seededRandom(), DEFAULTS));
    store.setAllocation(0, 1, 20);
    store.resolve();
    return plain(store.getSnapshot().match);
  };
  assert.deepEqual(resolvedOnce(), resolvedOnce());
});

test('a save from before the replay loads, plays on and offers no replay', () => {
  const { GameStore } = loadContext();
  const save = plain(GameStore.saveFromMatch(GameStore.classicMatch(seededRandom(), DEFAULTS)));
  delete save.replay;
  const store = GameStore.createStore();
  store.replaceMatch(GameStore.matchFromSave(save, DEFAULTS));
  store.resolve();
  const { match } = store.getSnapshot();
  assert.equal(match.state.round, 2);
  assert.equal(match.replay, null);
  assert.equal(GameStore.saveFromMatch(match, null).replay, null);
  store.openReplay();
  assert.equal(store.getSnapshot().ui.replay, null);
});

test('replay navigation stays within the recorded rounds and playing stops at the end', () => {
  const { GameStore } = loadContext();
  const store = GameStore.createStore();
  store.replaceMatch(GameStore.classicMatch(seededRandom(), DEFAULTS));
  store.resolve();
  store.resolve();
  const replay = () => plain(store.getSnapshot().ui.replay);
  store.openReplay();
  assert.deepEqual(replay(), { frame: 0, playing: false });
  store.showReplayFrame(-3);
  assert.deepEqual(replay(), { frame: 0, playing: false });
  store.showReplayFrame(99);
  assert.deepEqual(replay(), { frame: 2, playing: false });
  store.toggleReplayPlaying();
  assert.deepEqual(replay(), { frame: 0, playing: true });
  store.advanceReplay();
  assert.deepEqual(replay(), { frame: 1, playing: true });
  store.advanceReplay();
  assert.deepEqual(replay(), { frame: 2, playing: false });
  store.closeReplay();
  assert.equal(store.getSnapshot().ui.replay, null);
});

function playedLoseAndRetake(GameStore) {
  const base = GameStore.classicMatch(seededRandom(), DEFAULTS);
  const nodes = [
    { id: 0, owner: 0, active: 2, invested: 0 },
    { id: 1, owner: 1, active: 30, invested: 0 },
    { id: 2, owner: 0, active: 60, invested: 0 },
  ];
  const state = { ...base.state, nodes };
  const store = GameStore.createStore();
  store.replaceMatch({
    ...base,
    state,
    map: {
      ...base.map,
      xy: base.map.xy.slice(0, 3),
      edges: [
        [0, 1],
        [0, 2],
      ],
      N: 3,
    },
    humanSeats: [0, 1],
    policies: { 0: { enabled: true, reserve: 0, investPct: 50, dest: null } },
    replay: { ...base.replay, start: state, keptPoliciesFrom: 1000 },
  });
  const attackOn0 = (source, amount) => ({
    [source]: { invest: 0, withdraw: 0, edges: { 0: amount } },
  });
  for (const orders of [attackOn0(1, 29), attackOn0(2, 50), {}]) {
    store.replaceMatch({ ...store.getSnapshot().match, orders });
    store.resolve();
  }
  return store.getSnapshot().match;
}

const savedBeforeKeptPolicies = (GameStore, match, keptPoliciesFrom) => {
  const { keptPolicies, ...save } = plain(GameStore.saveFromMatch(match, null));
  const { keptPoliciesFrom: _stamp, ...replay } = save.replay;
  return { ...save, replay: keptPoliciesFrom ? { ...replay, keptPoliciesFrom } : replay };
};

test('a replay recorded before policies were kept rebuilds to the match as played', () => {
  const { GameStore } = loadContext();
  const played = playedLoseAndRetake(GameStore);
  assert.equal(played.state.nodes[0].owner, 0);
  const legacy = GameStore.matchFromSave(savedBeforeKeptPolicies(GameStore, played), DEFAULTS);
  const frames = GameStore.selectors.replayFrames(legacy);
  assert.deepEqual(plain(frames.at(-1).state), plain(played.state));
  const underNewRule = GameStore.matchFromSave(
    savedBeforeKeptPolicies(GameStore, played, 1),
    DEFAULTS,
  );
  const newFrames = GameStore.selectors.replayFrames(underNewRule);
  assert.notDeepEqual(plain(newFrames.at(-1).state), plain(played.state));
});

test('a replay without keptPoliciesFrom never applied the rule, even without loading a save', () => {
  const { GameStore } = loadContext();
  const played = playedLoseAndRetake(GameStore);
  const { keptPoliciesFrom, ...replay } = played.replay;
  const frames = GameStore.selectors.replayFrames({ ...played, replay });
  assert.deepEqual(plain(frames.at(-1).state), plain(played.state));
});

test('resolving a match stored without kept policies starts the rule at that round', () => {
  const { GameStore } = loadContext();
  const match = GameStore.classicMatch(seededRandom(), DEFAULTS);
  const { keptPolicies, ...storedReplay } = match.replay;
  const { keptPoliciesFrom, ...replay } = storedReplay;
  const { keptPolicies: _dropped, ...stored } = match;
  const resolved = GameStore.commands.resolve({ ...stored, replay });
  assert.deepEqual(plain(resolved.keptPolicies), {});
  assert.equal(resolved.replay.keptPoliciesFrom, match.state.round);
});
