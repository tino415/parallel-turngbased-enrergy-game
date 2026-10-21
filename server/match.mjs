import '../src/engine.js';
import '../src/store.js';

const { buildMap, firstOwners, playerName } = globalThis.GameEngine;
const { generatedMatch, commands } = globalThis.GameStore;

const MATCH_DEFAULTS = { enabled: true, reserve: 5, invest: 70 };
const DENSITIES = ['sparse', 'normal', 'dense'];
const NAME_LENGTH = 20;
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

export function createMatch({ id, options, hostTokenHash, random }) {
  return {
    id,
    phase: 'lobby',
    revision: 0,
    hostTokenHash,
    seatDefaults: {},
    submissions: {},
    ...lobbyMap(options, [], random),
  };
}

export function changeMap(record, { tokenHash, options, random }) {
  requireHost(record, tokenHash);
  if (record.phase !== 'lobby') throw new Refusal(409, 'The match has already started');
  return revised({ ...record, ...lobbyMap(options, record.seats, random) });
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
  const leaving = record.seats[owner];
  const seats = record.seats.map((seat) => (seat === leaving ? freeSeat(owner) : seat));
  if (record.phase === 'lobby') return revised({ ...record, seats });
  const { match } = record;
  const next = revised({
    ...record,
    seats,
    submissions: withoutOwner(record.submissions, owner),
    seatDefaults: withoutOwner(record.seatDefaults, owner),
    match: {
      ...match,
      humanSeats: match.humanSeats.filter((human) => human !== owner),
      keptPolicies: withoutOwner(match.keptPolicies, owner),
      policies: Object.fromEntries(
        Object.entries(match.policies).filter(([id]) => match.state.nodes[id]?.owner !== owner),
      ),
      history: [leaving.name + ' left; the AI plays ' + playerName(owner) + '.', ...match.history],
    },
  });
  const stillWaiting = waitingFor(next).length || !next.match.humanSeats.length;
  return stillWaiting ? next : resolved(next);
}

function lobbyMap(requested, seatsBefore, random) {
  const options = mapOptions(requested ?? {});
  const map = buildMap(options);
  const match = generatedMatch(map, MATCH_DEFAULTS, random, 0);
  return {
    options,
    seats: firstOwners(map.players).map((owner) => seatsBefore[owner] ?? freeSeat(owner)),
    match: { ...match, history: ['Online match created.', ...match.history.slice(1)] },
  };
}

export function claimSeat(record, { owner, name, tokenHash }) {
  if (record.phase !== 'lobby') throw new Refusal(409, 'The match has already started');
  const seat = record.seats[owner];
  if (!seat) throw new Refusal(404, 'No such colour');
  if (seat.tokenHash && seat.tokenHash !== tokenHash) throw new Refusal(409, 'Colour taken');
  const cleanName = String(name ?? '')
    .trim()
    .slice(0, NAME_LENGTH);
  if (!cleanName) throw new Refusal(400, 'Type a name first');
  const seats = record.seats.map((s) =>
    s.owner === owner
      ? { owner, name: cleanName, tokenHash }
      : s.tokenHash === tokenHash
        ? freeSeat(s.owner)
        : s,
  );
  return revised({ ...record, seats });
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
  const next = revised({
    ...record,
    seatDefaults: { ...record.seatDefaults, [owner]: cleanDefaults(defaults) },
    submissions: { ...record.submissions, [owner]: submitted },
  });
  return waitingFor(next).length ? next : resolved(next);
}

export function forceResolve(record, { tokenHash }) {
  requireHost(record, tokenHash);
  if (record.phase !== 'playing') throw new Refusal(409, 'The match is not running');
  return resolved(record);
}

export function viewFor(record, tokenHash) {
  const you = ownerOf(record, tokenHash);
  const { match } = record;
  return {
    id: record.id,
    phase: record.phase,
    revision: record.revision,
    host: Boolean(tokenHash) && tokenHash === record.hostTokenHash,
    you,
    options: record.options,
    seats: record.seats.map(({ owner, name, tokenHash: taken }) => ({
      owner,
      name,
      taken: Boolean(taken),
      submitted: Boolean(record.submissions[owner]),
    })),
    waitingFor: record.phase === 'playing' ? waitingFor(record) : [],
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

export function waitingFor(record) {
  const { nodes } = record.match.state;
  return claimedOwners(record).filter(
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
const withoutOwner = (byOwner, owner) =>
  Object.fromEntries(Object.entries(byOwner).filter(([key]) => Number(key) !== owner));
const claimedOwners = (record) => record.seats.filter((s) => s.tokenHash).map((s) => s.owner);

function ownerOf(record, tokenHash) {
  if (!tokenHash) return null;
  return record.seats.find((seat) => seat.tokenHash === tokenHash)?.owner ?? null;
}

function requireHost(record, tokenHash) {
  if (!tokenHash || tokenHash !== record.hostTokenHash)
    throw new Refusal(403, 'Only the host can do that');
}

function mapOptions({ count, players, density, seed }) {
  const clamped = (value, low, high, fallback) =>
    Math.max(low, Math.min(high, Math.round(Number(value)) || fallback));
  return {
    count: clamped(count, 10, 120, 30),
    players: clamped(players, 2, 6, 4),
    density: DENSITIES.includes(density) ? density : 'normal',
    seed: String(seed || 'energy-42').slice(0, 40),
  };
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
