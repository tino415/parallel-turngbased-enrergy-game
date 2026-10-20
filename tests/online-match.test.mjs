import test from 'node:test';
import assert from 'node:assert/strict';
import {
  Refusal,
  claimSeat,
  createMatch,
  forceResolve,
  startMatch,
  submitTurn,
  viewFor,
  waitingFor,
} from '../server/match.mjs';

const { seeded } = globalThis.GameEngine;
const { selectors } = globalThis.GameStore;

const HOST = 'host-hash';
const ANN = 'ann-hash';
const OPTIONS = { count: 14, players: 3, density: 'normal', seed: 'online-test' };
const noDefaults = { enabled: false, reserve: 5, invest: 70 };

const lobby = () =>
  createMatch({ id: 'abc', options: OPTIONS, hostTokenHash: HOST, random: seeded('dice') });
const playing = () =>
  startMatch(
    claimSeat(claimSeat(lobby(), { owner: 0, name: 'Hana', tokenHash: HOST }), {
      owner: 1,
      name: 'Ann',
      tokenHash: ANN,
    }),
    { tokenHash: HOST },
  );
const ownNode = (record, owner) => record.match.state.nodes.find((n) => n.owner === owner);
const turn = (record, tokenHash, extra = {}) =>
  submitTurn(record, {
    tokenHash,
    round: record.match.state.round,
    orders: {},
    policies: {},
    defaults: noDefaults,
    ...extra,
  });
const refusal = (action) => assert.throws(action, Refusal);

test('a new match is a lobby with every colour free', () => {
  const record = lobby();
  assert.equal(record.phase, 'lobby');
  assert.deepEqual(
    record.seats.map((seat) => seat.name),
    [null, null, null],
  );
});

test('a colour can be taken once, and moving frees the old one', () => {
  const taken = claimSeat(lobby(), { owner: 1, name: 'Ann', tokenHash: ANN });
  refusal(() => claimSeat(taken, { owner: 1, name: 'Bob', tokenHash: 'bob-hash' }));
  const moved = claimSeat(taken, { owner: 2, name: 'Ann', tokenHash: ANN });
  assert.deepEqual(
    moved.seats.map((seat) => seat.name),
    [null, null, 'Ann'],
  );
});

test('only the host starts, and not before someone took a colour', () => {
  const claimed = claimSeat(lobby(), { owner: 1, name: 'Ann', tokenHash: ANN });
  refusal(() => startMatch(claimed, { tokenHash: ANN }));
  refusal(() => startMatch(lobby(), { tokenHash: HOST }));
  assert.equal(startMatch(claimed, { tokenHash: HOST }).phase, 'playing');
});

test('the round resolves when the last human ends their turn, not before', () => {
  const first = turn(playing(), HOST);
  assert.equal(first.match.state.round, 1);
  assert.deepEqual(waitingFor(first), [1]);
  const second = turn(first, ANN);
  assert.equal(second.match.state.round, 2);
  assert.deepEqual(second.submissions, {});
});

test('orders for nodes the sender does not own are dropped', () => {
  const record = playing();
  const theirs = ownNode(record, 1).id;
  const mine = ownNode(record, 0).id;
  const next = turn(record, HOST, {
    orders: {
      [theirs]: { invest: 10, edges: {} },
      [mine]: { invest: 5, edges: {} },
    },
  });
  assert.deepEqual(Object.keys(next.submissions[0].orders), [String(mine)]);
});

test('malformed numbers in orders and policies are cleaned', () => {
  const record = playing();
  const mine = ownNode(record, 0).id;
  const next = turn(record, HOST, {
    orders: { [mine]: { invest: -3, withdraw: 'lots', edges: { 999: 5 } } },
    policies: { [mine]: { enabled: true, reserve: Infinity, investPct: 40, evil: true } },
  });
  assert.deepEqual(next.submissions[0].orders[mine], { invest: 0, withdraw: 0, edges: {} });
  assert.deepEqual(next.submissions[0].policies[mine], {
    enabled: true,
    investPct: 40,
    dest: null,
  });
});

test('a stale round and a stranger are refused', () => {
  const record = playing();
  refusal(() => turn(record, HOST, { round: 7 }));
  refusal(() => turn(record, 'stranger-hash'));
});

test('a seat sees its own policies and orders and nobody else sees them', () => {
  const record = playing();
  const mine = ownNode(record, 0).id;
  const next = turn(record, HOST, {
    orders: { [mine]: { invest: 5, edges: {} } },
    policies: { [mine]: { enabled: true, reserve: 5, investPct: 40 } },
  });
  assert.ok(viewFor(next, HOST).submission.orders[mine]);
  assert.ok(viewFor(next, HOST).submission.policies[mine]);
  const annsView = JSON.stringify(viewFor(next, ANN));
  assert.ok(!annsView.includes('"investPct":40'));
  assert.equal(viewFor(next, ANN).submission, null);
  assert.deepEqual(viewFor(next, ANN).seats[0], {
    owner: 0,
    name: 'Hana',
    taken: true,
    submitted: true,
  });
});

test('the view never carries the dice seed or the order record before the end', () => {
  const view = viewFor(turn(turn(playing(), HOST), ANN), HOST);
  assert.equal(view.replay, null);
  assert.ok(!JSON.stringify(view).includes(playing().match.replay.diceSeed));
});

test('the host resolves without a stuck player, whose standing policies still run', () => {
  const first = turn(turn(playing(), HOST), ANN, {
    policies: {
      [ownNode(playing(), 1).id]: { enabled: true, reserve: 5, investPct: 50, dest: null },
    },
  });
  const annsNode = first.match.state.nodes.find((n) => n.owner === 1 && first.match.policies[n.id]);
  assert.ok(annsNode, 'Ann keeps a standing policy');
  const stuck = turn(first, HOST);
  refusal(() => forceResolve(stuck, { tokenHash: ANN }));
  const forced = forceResolve(stuck, { tokenHash: HOST });
  assert.equal(forced.match.state.round, 3);
  const after = forced.match.state.nodes[annsNode.id];
  assert.ok(after.owner !== 1 || after.invested > 0);
});

test('the recorded rounds replay to the state the server reached', () => {
  const record = [1, 2].reduce((current) => turn(turn(current, HOST), ANN), playing());
  const frames = selectors.replayFrames({ ...record.match, seat: 0 });
  assert.equal(frames.length, 3);
  assert.deepEqual(frames.at(-1).state, record.match.state);
});

test('a finished match hands out its replay', () => {
  const record = playing();
  const conquered = {
    ...record,
    match: {
      ...record.match,
      state: {
        ...record.match.state,
        nodes: record.match.state.nodes.map((n) => ({ ...n, owner: 0 })),
      },
    },
  };
  const finished = turn(conquered, HOST);
  assert.equal(finished.phase, 'finished');
  assert.equal(viewFor(finished, ANN).replay.diceSeed, record.match.replay.diceSeed);
});
