import test from 'node:test';
import assert from 'node:assert/strict';
import {
  Refusal,
  cancelMatch,
  changeMap,
  claimSeat,
  createMatch,
  forceResolve,
  freeColour,
  handColourToAi,
  leaveMatch,
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

test('the host changes the map in the lobby and everyone sees its options', () => {
  const options = { count: 20, players: 4, density: 'dense', seed: 'other' };
  refusal(() => changeMap(lobby(), { tokenHash: ANN, options, random: seeded('dice') }));
  const changed = changeMap(lobby(), { tokenHash: HOST, options, random: seeded('dice') });
  assert.equal(changed.match.map.N, 20);
  assert.equal(changed.seats.length, 4);
  assert.deepEqual(viewFor(changed, ANN).options, options);
});

test('a smaller map keeps the colours it still has and frees the rest', () => {
  const claimed = claimSeat(claimSeat(lobby(), { owner: 0, name: 'Hana', tokenHash: HOST }), {
    owner: 2,
    name: 'Ann',
    tokenHash: ANN,
  });
  const smaller = changeMap(claimed, {
    tokenHash: HOST,
    options: { ...OPTIONS, players: 2 },
    random: seeded('dice'),
  });
  assert.deepEqual(
    smaller.seats.map((seat) => seat.name),
    ['Hana', null],
  );
  assert.equal(viewFor(smaller, ANN).you, null);
});

test('the map is fixed once the match runs', () => {
  refusal(() =>
    changeMap(playing(), { tokenHash: HOST, options: OPTIONS, random: seeded('dice') }),
  );
});

test('only the host cancels, and the cancelled match keeps nothing but its id', () => {
  refusal(() => cancelMatch(playing(), { tokenHash: ANN }));
  assert.deepEqual(cancelMatch(playing(), { tokenHash: HOST }), { id: 'abc', cancelled: true });
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
    open: false,
    ai: false,
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

test('the host cannot leave, and a stranger has nothing to leave', () => {
  refusal(() => leaveMatch(playing(), { tokenHash: HOST }));
  refusal(() => leaveMatch(playing(), { tokenHash: 'stranger-hash' }));
});

test('leaving the lobby frees the colour', () => {
  const claimed = claimSeat(lobby(), { owner: 1, name: 'Ann', tokenHash: ANN });
  const left = leaveMatch(claimed, { tokenHash: ANN });
  assert.equal(left.seats[1].tokenHash, null);
  assert.equal(viewFor(left, ANN).you, null);
});

test('a player who leaves mid-match hands the colour to the AI', () => {
  const left = leaveMatch(playing(), { tokenHash: ANN });
  assert.deepEqual(left.match.humanSeats, [0]);
  assert.deepEqual(waitingFor(left), [0]);
  assert.match(left.match.history[0], /Ann left; the AI plays Red/);
});

const withMatch = (record, changes) => ({ ...record, match: { ...record.match, ...changes } });
const keptPolicy = { enabled: true, reserve: 5, investPct: 50, dest: null };

test('a match stored before kept policies existed can still be left', () => {
  const { keptPolicies, ...stored } = playing().match;
  const left = leaveMatch({ ...playing(), match: stored }, { tokenHash: ANN });
  assert.deepEqual(left.match.humanSeats, [0]);
});

test('leaving drops the kept policies of the leaver and keeps the others', () => {
  const record = withMatch(playing(), {
    keptPolicies: { 0: { 3: keptPolicy }, 1: { 4: keptPolicy } },
  });
  const left = leaveMatch(record, { tokenHash: ANN });
  assert.deepEqual(Object.keys(left.match.keptPolicies), ['0']);
});

test('the round resolves when the last player still deciding leaves', () => {
  const left = leaveMatch(turn(playing(), HOST), { tokenHash: ANN });
  assert.equal(left.match.state.round, 2);
});

test('a match someone left replays to the state the server reached', () => {
  const left = leaveMatch(turn(turn(playing(), HOST), ANN), { tokenHash: ANN });
  const record = [1, 2, 3].reduce((current) => turn(current, HOST), left);
  const frames = selectors.replayFrames({ ...record.match, seat: 0 });
  assert.deepEqual(frames.at(-1).state, record.match.state);
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

const BOB = 'bob-hash';

test('only the host frees a colour or hands it to the AI, and never their own', () => {
  refusal(() => freeColour(playing(), { tokenHash: ANN, owner: 0 }));
  refusal(() => handColourToAi(playing(), { tokenHash: ANN, owner: 1 }));
  refusal(() => freeColour(playing(), { tokenHash: HOST, owner: 0 }));
  refusal(() => freeColour(playing(), { tokenHash: HOST, owner: 9 }));
});

test('a freed colour in the lobby can be taken by someone else and the old token loses it', () => {
  const claimed = claimSeat(lobby(), { owner: 1, name: 'Ann', tokenHash: ANN });
  const freed = freeColour(claimed, { tokenHash: HOST, owner: 1 });
  assert.equal(viewFor(freed, ANN).you, null);
  const retaken = claimSeat(freed, { owner: 1, name: 'Bob', tokenHash: BOB });
  assert.equal(viewFor(retaken, BOB).you, 1);
  assert.equal(viewFor(retaken, ANN).you, null);
});

test('a colour handed to the AI cannot be taken until the host frees it', () => {
  const handed = handColourToAi(lobby(), { tokenHash: HOST, owner: 2 });
  assert.equal(viewFor(handed, HOST).seats[2].ai, true);
  refusal(() => claimSeat(handed, { owner: 2, name: 'Bob', tokenHash: BOB }));
  const freed = freeColour(handed, { tokenHash: HOST, owner: 2 });
  assert.equal(claimSeat(freed, { owner: 2, name: 'Bob', tokenHash: BOB }).seats[2].name, 'Bob');
});

test('freeing a playing colour hands it to the AI and nobody waits for it', () => {
  const freed = freeColour(playing(), { tokenHash: HOST, owner: 1 });
  assert.deepEqual(freed.match.humanSeats, [0]);
  assert.deepEqual(waitingFor(freed), [0]);
  assert.equal(viewFor(freed, ANN).you, null);
  assert.match(freed.match.history[0], /Ann was freed; the AI plays Red/);
});

test('a colour handed to the AI mid-match is closed to takers', () => {
  const handed = handColourToAi(playing(), { tokenHash: HOST, owner: 1 });
  assert.deepEqual(handed.match.humanSeats, [0]);
  assert.match(handed.match.history[0], /Ann was handed to the AI/);
  refusal(() => claimSeat(handed, { owner: 1, name: 'Bob', tokenHash: BOB }));
});

test('the round resolves when the host frees the last player still deciding', () => {
  const freed = freeColour(turn(playing(), HOST), { tokenHash: HOST, owner: 1 });
  assert.equal(freed.match.state.round, 2);
});

test('a colour the host freed mid-match is taken by a newcomer who joins the round', () => {
  const freed = freeColour(playing(), { tokenHash: HOST, owner: 1 });
  const joined = claimSeat(freed, { owner: 1, name: 'Bob', tokenHash: BOB });
  assert.deepEqual(joined.match.humanSeats, [0, 1]);
  assert.deepEqual(waitingFor(joined), [0, 1]);
  assert.equal(viewFor(joined, BOB).you, 1);
  assert.equal(viewFor(joined, ANN).you, null);
});

test('mid-match only an open colour can be taken, and only by someone without one', () => {
  refusal(() => claimSeat(playing(), { owner: 2, name: 'Bob', tokenHash: BOB }));
  const opened = freeColour(playing(), { tokenHash: HOST, owner: 1 });
  refusal(() => claimSeat(opened, { owner: 1, name: 'Hana', tokenHash: HOST }));
});

test('a colour freed in the lobby is no more open after the start than one never taken', () => {
  const claimed = claimSeat(lobby(), { owner: 1, name: 'Ann', tokenHash: ANN });
  const freed = freeColour(claimed, { tokenHash: HOST, owner: 1 });
  const started = startMatch(claimSeat(freed, { owner: 0, name: 'Hana', tokenHash: HOST }), {
    tokenHash: HOST,
  });
  refusal(() => claimSeat(started, { owner: 1, name: 'Bob', tokenHash: BOB }));
});
