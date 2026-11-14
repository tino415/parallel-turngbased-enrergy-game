import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { claimSeat, createMatch, startMatch, submitTurn } from '../server/match.mjs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const context = createContext({});
runInContext(read('../src/engine.js'), context);
runInContext(read('../src/store.js'), context);
const { GameStore, GameEngine } = context;

const plain = (value) => JSON.parse(JSON.stringify(value));
const TARGETS = {
  enabled: true,
  reserve: '5',
  invest: '50',
  investTarget: '200',
  divestPct: '10',
  defensePct: '30',
  defenseTarget: '80',
};

function storeWith(defaults) {
  const store = GameStore.createStore({ selected: null });
  store.replaceMatch(GameStore.classicMatch(GameEngine.seeded('conquest'), defaults));
  return store;
}
const defaultsOf = (store) => plain(store.getSnapshot().match.defaults);

test('a conquest default carries the investment and defense targets', () => {
  const policy = GameStore.conquestPolicy(TARGETS);
  assert.deepEqual(plain(policy), {
    enabled: true,
    reserve: 5,
    investPct: 50,
    defensePct: 30,
    investTarget: 200,
    divestPct: 10,
    defenseTarget: 80,
  });
});

test('empty target fields mean no target', () => {
  const policy = GameStore.conquestPolicy({ ...TARGETS, investTarget: '', defenseTarget: '' });
  assert.equal('investTarget' in policy, false);
  assert.equal('defenseTarget' in policy, false);
});

test('defaults saved before the targets existed still produce a plain policy', () => {
  const policy = GameStore.conquestPolicy({ enabled: true, reserve: '5', invest: '70' });
  assert.deepEqual(plain(policy), { enabled: true, reserve: 5, investPct: 70 });
});

test('defaults whose invest and grow shares exceed 100 are refused', () => {
  const store = storeWith(TARGETS);
  store.setDefaults({ defensePct: '60' });
  assert.equal(defaultsOf(store).defensePct, '30');
  store.setDefaults({ defensePct: '50' });
  assert.equal(defaultsOf(store).defensePct, '50');
});

test('a save restores the targets and an old save loads without them', () => {
  const store = storeWith(TARGETS);
  const save = plain(GameStore.saveFromMatch(store.getSnapshot().match));
  assert.equal(GameStore.matchFromSave(save, TARGETS).defaults.investTarget, '200');
  const old = { ...save, defaults: { enabled: true, reserve: '5', invest: '70' } };
  const blank = { enabled: true, reserve: '5', invest: '70', investTarget: '', divestPct: '0' };
  const restored = GameStore.matchFromSave(old, blank).defaults;
  assert.equal(restored.investTarget, '');
  assert.equal(restored.divestPct, '0');
});

test('the online turn keeps the targets, clamped like a node policy', () => {
  const random = GameEngine.seeded('dice');
  const lobby = createMatch({
    id: 'abc',
    options: { count: 14, players: 2, density: 'normal', seed: 'online-test' },
    hostTokenHash: 'host',
    random,
  });
  const record = startMatch(claimSeat(lobby, { owner: 0, name: 'Hana', tokenHash: 'host' }), {
    tokenHash: 'host',
  });
  const next = submitTurn(record, {
    tokenHash: 'host',
    round: record.match.state.round,
    orders: {},
    policies: {},
    defaults: { ...TARGETS, investTarget: '-4', divestPct: '400', defensePct: '90' },
  });
  const kept = next.seatDefaults[0];
  assert.equal(kept.investTarget, '');
  assert.equal(kept.divestPct, 100);
  assert.equal(kept.defensePct, 50);
  assert.equal(kept.defenseTarget, 80);
});
