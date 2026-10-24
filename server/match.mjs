import '../src/engine.js';
import '../src/store.js';

const { buildMap, firstOwners, playerName } = globalThis.GameEngine;
const { generatedMatch, commands } = globalThis.GameStore;

const MATCH_DEFAULTS = { enabled: true, reserve: 5, invest: 70 };
const DENSITIES = ['sparse', 'normal', 'dense'];
const NAME_LENGTH = 20;
export const TURN_SECONDS = [120, 600, 3600, 86400];
const DEFAULT_TURN_SECONDS = 86400;
const MISSES_BEFORE_AI = 3;
const POLICY_NUMBERS = [
  'reserve',
  'investPct',
  'investTarget',
  'divestPct',
  'defenseTarget',
  'defensePct',
];

export class Refusal extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function createMatch({ id, options, hostTokenHash, random, shortTurns = false }) {
  return {
    id,
    phase: 'lobby',
    revision: 0,
    hostTokenHash,
    shortTurns,
    seatDefaults: {},
    submissions: {},
    misses: {},
    deadline: null,
    ...lobbyMap(options, [], random, shortTurns),
  };
}

export function changeMap(record, { tokenHash, options, random }) {
  requireHost(record, tokenHash);
  if (record.phase !== 'lobby') throw new Refusal(409, 'The match has already started');
  return revised({ ...record, ...lobbyMap(options, record.seats, random, record.shortTurns) });
}

export function cancelMatch(record, { tokenHash }) {
  requireHost(record, tokenHash);
  return { id: record.id, cancelled: true };
}

export function leaveMatch(record, { tokenHash }) {
  const owner = ownerOf(record, tokenHash);
  if (owner === null) throw new Refusal(403, 'You have no colour in this match');
  if (tokenHash === record.hostTokenHash)
    throw new Refusal(409, 'The host cancels the match instead');
  if (record.phase === 'finished') throw new Refusal(409, 'The match is over');
  return vacated(record, owner, freeSeat(owner), ' left');
}

export function freeColour(record, { tokenHash, owner }) {
  return hostChangesSeat(record, tokenHash, owner, openSeat(record, owner), ' was freed');
}

export function handColourToAi(record, { tokenHash, owner }) {
  return hostChangesSeat(record, tokenHash, owner, aiSeat(owner), ' was handed to the AI');
}

export function handOverHosting(record, { tokenHash, owner }) {
  requireHost(record, tokenHash);
  const seat = record.seats[owner];
  if (!seat) throw new Refusal(404, 'No such colour');
  if (record.phase === 'finished') throw new Refusal(409, 'The match is over');
  if (!seat.tokenHash || seat.away) throw new Refusal(409, 'Only a player can become the host');
  if (seat.tokenHash === record.hostTokenHash) throw new Refusal(409, 'You are the host already');
  const { match } = record;
  return revised({
    ...record,
    hostTokenHash: seat.tokenHash,
    match: { ...match, history: [seat.name + ' is the host now.', ...match.history] },
  });
}

function hostChangesSeat(record, tokenHash, owner, replacement, reason) {
  requireHost(record, tokenHash);
  const seat = record.seats[owner];
  if (!seat) throw new Refusal(404, 'No such colour');
  if (record.phase === 'finished') throw new Refusal(409, 'The match is over');
  if (seat.tokenHash && seat.tokenHash === record.hostTokenHash)
    throw new Refusal(409, 'The host keeps their own colour');
  if (!seat.tokenHash) return revised(withSeat(record, replacement));
  return vacated(record, owner, replacement, reason);
}

const withSeat = (record, replacement) => ({
  ...record,
  seats: record.seats.map((seat) => (seat.owner === replacement.owner ? replacement : seat)),
});

function vacated(record, owner, replacement, reason) {
  if (record.phase === 'lobby') return revised(withSeat(record, replacement));
  const next = handedToAi(record, owner, replacement, reason);
  return everyoneEnded(next) ? resolved(next) : next;
}

const everyoneEnded = (record) =>
  waitingFor(record).length === 0 && record.match.humanSeats.length > 0;

function handedToAi(record, owner, replacement, reason) {
  const leaving = record.seats[owner];
  const { seats } = withSeat(record, replacement);
  const { match } = record;
  return revised({
    ...record,
    seats,
    submissions: withoutOwner(record.submissions, owner),
    seatDefaults: withoutOwner(record.seatDefaults, owner),
    misses: withoutOwner(record.misses ?? {}, owner),
    match: {
      ...match,
      humanSeats: match.humanSeats.filter((human) => human !== owner),
      keptPolicies: withoutOwner(match.keptPolicies ?? {}, owner),
      policies: Object.fromEntries(
        Object.entries(match.policies).filter(([id]) => match.state.nodes[id]?.owner !== owner),
      ),
      history: [
        leaving.name + reason + '; the AI plays ' + playerName(owner) + '.',
        ...match.history,
      ],
    },
  });
}

function lobbyMap(requested, seatsBefore, random, shortTurns) {
  const options = mapOptions(requested ?? {}, shortTurns);
  const map = buildMap(options);
  const match = generatedMatch(map, MATCH_DEFAULTS, random, 0);
  return {
    options,
    seats: firstOwners(map.players).map((owner) => seatsBefore[owner] ?? freeSeat(owner)),
    match: { ...match, history: ['Online match created.', ...match.history.slice(1)] },
  };
}

export function claimSeat(record, { owner, name, tokenHash }) {
  const seat = record.seats[owner];
  if (!seat) throw new Refusal(404, 'No such colour');
  if (record.phase === 'finished') throw new Refusal(409, 'The match is over');
  if (seat.ai) throw new Refusal(409, 'The host gave that colour to the AI');
  if (seat.tokenHash && seat.tokenHash !== tokenHash) throw new Refusal(409, 'Colour taken');
  const cleanName = String(name ?? '')
    .trim()
    .slice(0, NAME_LENGTH);
  if (!cleanName) throw new Refusal(400, 'Type a name first');
  if (record.phase === 'playing')
    return joinedMidMatch(record, { owner, name: cleanName, tokenHash });
  const seats = record.seats.map((s) =>
    s.owner === owner
      ? { owner, name: cleanName, tokenHash }
      : s.tokenHash === tokenHash
        ? freeSeat(s.owner)
        : s,
  );
  return revised({ ...record, seats });
}

function joinedMidMatch(record, { owner, name, tokenHash }) {
  if (record.seats[owner].away) return returned(record, owner);
  if (record.seats[owner].tokenHash) return revised(withSeat(record, { owner, name, tokenHash }));
  if (!record.seats[owner].open) throw new Refusal(409, 'The match has already started');
  if (ownerOf(record, tokenHash) !== null) throw new Refusal(409, 'You already have a colour');
  if (!record.match.state.nodes.some((node) => node.owner === owner))
    throw new Refusal(409, 'That colour has no nodes left');
  const { match } = record;
  return revised({
    ...withSeat(record, { owner, name, tokenHash }),
    match: {
      ...match,
      humanSeats: [...match.humanSeats, owner],
      history: [name + ' took ' + playerName(owner) + '.', ...match.history],
    },
  });
}

export function startMatch(record, { tokenHash }) {
  requireHost(record, tokenHash);
  if (record.phase !== 'lobby') throw new Refusal(409, 'The match has already started');
  const humanSeats = claimedOwners(record);
  if (!humanSeats.length) throw new Refusal(409, 'Take a colour before starting');
  const { match } = record;
  return revised({
    ...record,
    phase: 'playing',
    deadline: null,
    match: {
      ...match,
      humanSeats,
      replay: { ...match.replay, humanSeats },
      history: ['The match started. The AI plays the free colours.', ...match.history],
    },
  });
}

export function submitTurn(record, { tokenHash, round, orders, policies, defaults }) {
  const owner = ownerOf(record, tokenHash);
  if (owner === null) throw new Refusal(403, 'You have no colour in this match');
  if (record.phase !== 'playing') throw new Refusal(409, 'The match is not running');
  if (round !== record.match.state.round) throw new Refusal(409, 'That round is over');
  const { nodes } = record.match.state;
  const owns = (id) => nodes[id]?.owner === owner;
  const submitted = {
    orders: cleanOrders(orders, owns, record.match.map.edges),
    policies: cleanPolicies(policies, owns, record.match.map.edges),
  };
  const present = record.seats[owner].away ? returned(record, owner) : record;
  const next = revised({
    ...present,
    seatDefaults: { ...present.seatDefaults, [owner]: cleanDefaults(defaults) },
    submissions: { ...present.submissions, [owner]: submitted },
    misses: withoutOwner(present.misses ?? {}, owner),
  });
  return waitingFor(next).length ? next : resolved(next);
}

export function expireTurn(record) {
  if (record.phase !== 'playing') return record;
  const late = waitingFor(record);
  if (!late.length) return record;
  const misses = { ...record.misses };
  for (const owner of late) misses[owner] = (misses[owner] ?? 0) + 1;
  const absent = late.filter((owner) => misses[owner] >= MISSES_BEFORE_AI);
  const replaced = absent.reduce(
    (current, owner) =>
      handedToAi(current, owner, { ...current.seats[owner], away: true }, ' missed three turns'),
    { ...record, misses },
  );
  return resolved(replaced);
}

export function scheduled(record, now) {
  if (record.phase !== 'playing') return { ...record, deadline: null };
  const seconds = record.options.turnTime;
  if (!seconds || !waitingFor(record).length) return { ...record, deadline: null };
  return { ...record, deadline: record.deadline ?? now + seconds * 1000 };
}

function returned(record, owner) {
  const { match } = record;
  const seat = record.seats[owner];
  return revised({
    ...withSeat(record, { owner, name: seat.name, tokenHash: seat.tokenHash }),
    match: {
      ...match,
      humanSeats: [...match.humanSeats, owner],
      history: [seat.name + ' is back and plays ' + playerName(owner) + '.', ...match.history],
    },
  });
}

export function forceResolve(record, { tokenHash }) {
  requireHost(record, tokenHash);
  if (record.phase !== 'playing') throw new Refusal(409, 'The match is not running');
  return resolved(record);
}

export function viewFor(record, tokenHash, now = null) {
  const you = ownerOf(record, tokenHash);
  const { match } = record;
  return {
    id: record.id,
    phase: record.phase,
    revision: record.revision,
    host: Boolean(tokenHash) && tokenHash === record.hostTokenHash,
    you,
    options: record.options,
    seats: record.seats.map(({ owner, name, tokenHash: taken, open, ai, away }) => ({
      owner,
      name,
      taken: Boolean(taken),
      open: Boolean(open),
      ai: Boolean(ai),
      away: Boolean(away),
      submitted: Boolean(record.submissions[owner]),
    })),
    waitingFor: record.phase === 'playing' ? waitingFor(record) : [],
    secondsLeft: secondsLeft(record, now),
    round: match.state.round,
    state: match.state,
    map: match.map,
    humanSeats: match.humanSeats ?? [],
    history: match.history,
    policies: you === null ? {} : policiesOf(match, you),
    submission: you === null ? null : (record.submissions[you] ?? null),
    defaults: you === null ? null : (record.seatDefaults[you] ?? null),
    replay: record.phase === 'finished' ? match.replay : null,
  };
}

const secondsLeft = (record, now) =>
  record.deadline === null || record.deadline === undefined || now === null
    ? null
    : Math.max(0, Math.ceil((record.deadline - now) / 1000));

export function waitingFor(record) {
  const { nodes } = record.match.state;
  return presentOwners(record).filter(
    (owner) => !record.submissions[owner] && nodes.some((node) => node.owner === owner),
  );
}

function resolved(record) {
  const { match, submissions } = record;
  const humans = match.humanSeats;
  const after = commands.resolve({
    ...match,
    orders: Object.assign({}, ...humans.map((owner) => submissions[owner]?.orders ?? {})),
    policies: mergedPolicies(record),
    seatDefaults: record.seatDefaults,
  });
  const { policies, keptPolicies, history, state, replay } = after;
  return revised({
    ...record,
    phase: state.finished ? 'finished' : 'playing',
    submissions: {},
    deadline: null,
    match: { ...match, orders: {}, policies, keptPolicies, history, state, replay },
  });
}

function mergedPolicies(record) {
  const { match, submissions } = record;
  const replaced = new Set(
    Object.entries(submissions).flatMap(([owner, submitted]) =>
      match.state.nodes
        .filter((node) => node.owner === Number(owner) && submitted)
        .map((node) => node.id),
    ),
  );
  const standing = Object.fromEntries(
    Object.entries(match.policies).filter(([id]) => !replaced.has(Number(id))),
  );
  return Object.assign(standing, ...Object.values(submissions).map((s) => s.policies));
}

const policiesOf = (match, owner) =>
  Object.fromEntries(
    Object.entries(match.policies).filter(([id]) => match.state.nodes[id]?.owner === owner),
  );

const revised = (record) => ({ ...record, revision: record.revision + 1 });
const freeSeat = (owner) => ({ owner, name: null, tokenHash: null });
const openSeat = (record, owner) => ({ ...freeSeat(owner), open: record.phase === 'playing' });
const aiSeat = (owner) => ({ ...freeSeat(owner), ai: true });
const withoutOwner = (byOwner, owner) =>
  Object.fromEntries(Object.entries(byOwner).filter(([key]) => Number(key) !== owner));
const claimedOwners = (record) => record.seats.filter((s) => s.tokenHash).map((s) => s.owner);
const presentOwners = (record) =>
  record.seats.filter((s) => s.tokenHash && !s.away).map((s) => s.owner);

function ownerOf(record, tokenHash) {
  if (!tokenHash) return null;
  return record.seats.find((seat) => seat.tokenHash === tokenHash)?.owner ?? null;
}

function requireHost(record, tokenHash) {
  if (!tokenHash || tokenHash !== record.hostTokenHash)
    throw new Refusal(403, 'Only the host can do that');
}

function mapOptions({ count, players, density, seed, turnTime }, shortTurns) {
  const clamped = (value, low, high, fallback) =>
    Math.max(low, Math.min(high, Math.round(Number(value)) || fallback));
  return {
    count: clamped(count, 10, 120, 30),
    players: clamped(players, 2, 6, 4),
    density: DENSITIES.includes(density) ? density : 'normal',
    seed: String(seed || 'energy-42').slice(0, 40),
    turnTime: turnSeconds(turnTime, shortTurns),
  };
}

function turnSeconds(requested, shortTurns) {
  const seconds = Number(requested);
  if (shortTurns && Number.isInteger(seconds) && seconds > 0 && seconds < TURN_SECONDS[0])
    return seconds;
  return TURN_SECONDS.includes(seconds) ? seconds : DEFAULT_TURN_SECONDS;
}

const amount = (value) => (Number.isFinite(value) && value > 0 ? value : 0);
const isNeighbor = (edges, a, b) =>
  edges.some(([x, y]) => (x === a && y === b) || (x === b && y === a));

function cleanOrders(orders, owns, edges) {
  const entries = Object.entries(orders && typeof orders === 'object' ? orders : {})
    .filter(([id]) => owns(Number(id)))
    .map(([id, order]) => [
      id,
      {
        invest: amount(order?.invest),
        withdraw: amount(order?.withdraw),
        ...(order?.hold ? { hold: true } : {}),
        edges: Object.fromEntries(
          Object.entries(order?.edges ?? {})
            .filter(([dest]) => isNeighbor(edges, Number(id), Number(dest)))
            .map(([dest, value]) => [dest, amount(value)])
            .filter(([, value]) => value > 0),
        ),
      },
    ]);
  return Object.fromEntries(entries);
}

function cleanPolicies(policies, owns, edges) {
  const entries = Object.entries(policies && typeof policies === 'object' ? policies : {})
    .filter(([id, policy]) => owns(Number(id)) && policy && typeof policy === 'object')
    .map(([id, policy]) => [id, cleanPolicy(policy, Number(id), edges)]);
  return Object.fromEntries(entries);
}

function cleanPolicy(policy, source, edges) {
  const numbers = POLICY_NUMBERS.filter((key) => Number.isFinite(policy[key])).map((key) => [
    key,
    policy[key],
  ]);
  const dest =
    Number.isInteger(policy.dest) && isNeighbor(edges, source, policy.dest) ? policy.dest : null;
  const pressure = Object.entries(policy.pressure ?? {})
    .filter(([to]) => isNeighbor(edges, source, Number(to)))
    .map(([to, edge]) => [
      to,
      {
        pct: amount(edge?.pct),
        min: amount(edge?.min),
        bank: amount(edge?.bank),
      },
    ]);
  return {
    enabled: Boolean(policy.enabled),
    ...Object.fromEntries(numbers),
    dest,
    ...(pressure.length ? { pressure: Object.fromEntries(pressure) } : {}),
  };
}

function cleanDefaults(defaults) {
  return {
    enabled: Boolean(defaults?.enabled),
    reserve: amount(Number(defaults?.reserve)),
    invest: Math.min(100, amount(Number(defaults?.invest))),
  };
}
