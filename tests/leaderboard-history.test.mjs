import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const plain = (value) => JSON.parse(JSON.stringify(value));
const DEFAULTS = { enabled: true, reserve: '5', invest: '70' };
const LEDGER_FLOWS = [
  'production',
  'decay',
  'overflow',
  'withdrawalFee',
  'attackLoss',
  'defenseLoss',
  'investedCeded',
  'investedCaptured',
];

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

const totalEnergy = (state, owner) =>
  state.nodes
    .filter((node) => node.owner === owner)
    .reduce((total, node) => total + node.active + node.invested, 0);

function reconciledTotal(before, flows) {
  return (
    before +
    flows.production +
    flows.investedCaptured -
    flows.decay -
    flows.overflow -
    flows.withdrawalFee -
    flows.attackLoss -
    flows.defenseLoss -
    flows.investedCeded
  );
}

function everyoneByAI({ GameEngine, rulesVersion, rounds }) {
  const map = GameEngine.buildMap({ count: 120, players: 6, density: 'normal', seed: 'energy-42' });
  let state = { round: 1, nodes: map.nodes, finished: false, rulesVersion };
  const played = [];
  for (let round = 0; round < rounds && !state.finished; round++) {
    const plan = GameEngine.economicAI(state.nodes, map.links, true);
    const result = GameEngine.resolveRound({
      state,
      playerCount: 6,
      orders: {},
      policies: {},
      links: map.links,
      rng: GameEngine.seeded('ledger:' + round),
      aiOrdersOverride: Object.values(plan.orders).flat(),
      aiWithdrawalsOverride: plan.withdrawals,
    });
    played.push({ before: state, after: result.state, ledger: result.ledger });
    state = result.state;
  }
  return played;
}

function assertLedgerReconciles(played) {
  for (const { before, after, ledger } of played)
    for (const [owner, flows] of ledger.entries())
      assert.ok(
        Math.abs(reconciledTotal(totalEnergy(before, owner), flows) - totalEnergy(after, owner)) <
          1e-6,
        'player ' + owner + ' in round ' + before.round,
      );
}

function flowTotals(played) {
  return Object.fromEntries(
    LEDGER_FLOWS.map((flow) => [
      flow,
      played.reduce(
        (total, { ledger }) => total + ledger.reduce((sum, flows) => sum + flows[flow], 0),
        0,
      ),
    ]),
  );
}

test('every round, each player ends with last round’s energy plus production and captures, minus losses', () => {
  const { GameEngine } = loadContext();
  const played = everyoneByAI({
    GameEngine,
    rulesVersion: GameEngine.SOFT_CAP_RULES.version,
    rounds: 120,
  });
  assertLedgerReconciles(played);
  for (const [flow, total] of Object.entries(flowTotals(played)))
    assert.ok(total > 0, flow + ' happens in a long game');
});

test('the ledger reconciles under the legacy rules, which have no overflow and no withdrawal fee', () => {
  const { GameEngine } = loadContext();
  const played = everyoneByAI({ GameEngine, rulesVersion: undefined, rounds: 60 });
  assertLedgerReconciles(played);
  const totals = flowTotals(played);
  assert.equal(totals.overflow, 0);
  assert.equal(totals.withdrawalFee, 0);
  assert.ok(totals.attackLoss > 0);
});

function playedStore({ GameStore, GameEngine, match, rounds }) {
  const store = GameStore.createStore();
  store.replaceMatch(match);
  for (let round = 0; round < rounds && !store.getSnapshot().match.state.finished; round++) {
    const { state, map } = store.getSnapshot().match;
    const { orders } = GameEngine.economicAI(state.nodes, map.edges, true);
    for (const [id, choice] of Object.entries(orders))
      if (state.nodes[Number(id)].owner === 0)
        for (const order of [choice].flat())
          store.setAllocation(
            Number(id),
            order.type === 'invest' ? null : order.dest,
            order.amount,
          );
    store.resolve();
  }
  return store;
}

function generatedGame(rounds) {
  const { GameStore, GameEngine } = loadContext();
  const map = GameEngine.buildMap({ count: 120, players: 6, density: 'normal', seed: 'energy-42' });
  const match = GameStore.generatedMatch(map, DEFAULTS, seededRandom(5));
  return { GameStore, GameEngine, store: playedStore({ GameStore, GameEngine, match, rounds }) };
}

test('the player history has one entry per round with the standings after it', () => {
  const { GameStore, store } = generatedGame(30);
  const match = store.getSnapshot().match;
  const history = GameStore.selectors.playerHistory(match);
  const frames = GameStore.selectors.replayFrames(match);
  assert.equal(history.rounds.length, 30);
  for (const [i, { round, players }] of history.rounds.entries()) {
    assert.equal(round, i + 1);
    const after = { ...match, state: frames[i + 1].state };
    for (const [owner, stats] of players.entries()) {
      const { invested, active, nodes } = GameStore.selectors
        .leaderboard(after)
        .find((standing) => standing.player === owner);
      assert.deepEqual(
        { invested: stats.invested, active: stats.active, nodes: stats.nodes },
        { invested, active, nodes },
      );
    }
  }
});

test('battle and inefficiency losses with production account for each player’s change in energy', () => {
  const { GameStore, store } = generatedGame(80);
  const history = GameStore.selectors.playerHistory(store.getSnapshot().match);
  let previous = history.rounds[0].players.map(() => null);
  for (const { players } of history.rounds) {
    for (const [owner, stats] of players.entries()) {
      const total = stats.active + stats.invested;
      if (previous[owner] !== null) {
        const unexplained =
          total - previous[owner] - stats.production + stats.battleLoss + stats.inefficiencyLoss;
        assert.ok(unexplained > -1e-6, 'only captured investment is left unexplained');
      }
      previous[owner] = total;
    }
  }
  const lost = (key) => history.rounds.reduce((total, round) => total + round.players[0][key], 0);
  assert.ok(lost('battleLoss') > 0);
  assert.ok(lost('inefficiencyLoss') > 0);
});

test('a history picked up from the last round reuses the known rounds and equals a full rebuild', () => {
  const { GameStore, GameEngine, store } = generatedGame(20);
  const known = GameStore.selectors.playerHistory(store.getSnapshot().match);
  const later = playedStore({
    GameStore,
    GameEngine,
    match: store.getSnapshot().match,
    rounds: 3,
  }).getSnapshot().match;

  const resumed = GameStore.selectors.playerHistory(later, known);
  assert.equal(resumed.rounds.length, 23);
  assert.equal(resumed.rounds[19], known.rounds[19]);
  assert.deepEqual(plain(resumed.rounds), plain(GameStore.selectors.playerHistory(later).rounds));
});

test('a history of another match is rebuilt from that match', () => {
  const { GameStore, store } = generatedGame(5);
  const known = GameStore.selectors.playerHistory(store.getSnapshot().match);
  const other = GameStore.classicMatch(seededRandom(3), DEFAULTS);
  const otherStore = GameStore.createStore();
  otherStore.replaceMatch(other);
  otherStore.resolve();
  const history = GameStore.selectors.playerHistory(otherStore.getSnapshot().match, known);
  assert.equal(history.rounds.length, 1);
  assert.equal(history.rounds[0].players.length, 2);
});

test('a reloaded save rebuilds the same history, and a save from before the replay has none', () => {
  const { GameStore, store } = generatedGame(10);
  const match = store.getSnapshot().match;
  const save = plain(GameStore.saveFromMatch(match, null));
  const reloaded = GameStore.matchFromSave(save, DEFAULTS);
  assert.deepEqual(
    plain(GameStore.selectors.playerHistory(reloaded).rounds),
    plain(GameStore.selectors.playerHistory(match).rounds),
  );
  delete save.replay;
  assert.equal(GameStore.selectors.playerHistory(GameStore.matchFromSave(save, DEFAULTS)), null);
});

function historyOf(rows) {
  return {
    rounds: rows.map((players, i) => ({
      round: i + 1,
      players: players.map(([nodes, production]) => ({ nodes, production })),
    })),
  };
}

test('a chart line has one point per round and ends in the round the player lost their last node', () => {
  const { GameStore } = loadContext();
  const history = historyOf([
    [
      [3, 4],
      [2, 3],
    ],
    [
      [4, 5],
      [0, 1],
    ],
    [
      [6, 6],
      [0, 0],
    ],
  ]);
  const lines = GameStore.selectors.chartLines(history, { series: 'nodes', runningTotal: false });
  assert.deepEqual(plain(lines), [
    [3, 4, 6],
    [2, 0],
  ]);
});

test('a running total adds up flows round by round and leaves the standings as they are', () => {
  const { GameStore } = loadContext();
  const history = historyOf([[[3, 4]], [[4, 5]], [[6, 6]]]);
  const { chartLines } = GameStore.selectors;
  assert.deepEqual(plain(chartLines(history, { series: 'production', runningTotal: true })), [
    [4, 9, 15],
  ]);
  assert.deepEqual(plain(chartLines(history, { series: 'nodes', runningTotal: true })), [
    [3, 4, 6],
  ]);
});

test('the chart settings accept only known series and players and leave the match alone', () => {
  const { GameStore } = loadContext();
  const store = GameStore.createStore();
  store.replaceMatch(GameStore.classicMatch(seededRandom(), DEFAULTS));
  const match = store.getSnapshot().match;
  const chart = () => store.getSnapshot().ui.leaderboardChart;
  assert.deepEqual(plain(chart()), { series: 'invested', runningTotal: false, focus: null });

  store.setLeaderboardChart({ series: 'battleLoss', runningTotal: true, focus: 1 });
  assert.deepEqual(plain(chart()), { series: 'battleLoss', runningTotal: true, focus: 1 });
  for (const fields of [
    { series: 'score' },
    { focus: 2 },
    { focus: -1 },
    { runningTotal: 'yes' },
  ]) {
    const before = chart();
    store.setLeaderboardChart(fields);
    assert.equal(chart(), before, JSON.stringify(fields));
  }
  store.setLeaderboardChart({ focus: null });
  assert.equal(chart().focus, null);
  assert.equal(store.getSnapshot().match, match);
});
