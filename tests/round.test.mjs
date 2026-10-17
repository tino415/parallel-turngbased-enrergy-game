import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
const source = readFileSync(new URL('../src/engine.js', import.meta.url), 'utf8');
const engine = runInNewContext(source + ';GameEngine');
const node = (id, owner, active, invested = 0) => ({ id, owner, active, invested });
test('multi-orders reserve from starting energy and preserve input', () => {
  const state = {
    round: 1,
    finished: false,
    nodes: [node(0, 0, 20), node(1, null, 1), node(2, 1, 50)],
  };
  const result = engine.resolveRound({
    state,
    orders: { 0: { invest: 5, edges: { 1: 10, 2: 5 } } },
    policies: {},
    links: [
      [0, 1],
      [0, 2],
    ],
    rng: () => 0.5,
  });
  assert.equal(state.nodes[0].active, 20);
  assert.ok(result.state.nodes[0].invested >= 0); // Capital may be damaged if source is captured.
  assert.ok(result.events.some((x) => x.includes('Node 1: Blue attacks')));
  assert.ok(result.events.some((x) => x.includes('Node 2: Blue attacks')));
  assert.ok(result.events.some((x) => x.includes('Node 0: Red attacks'))); // AI also acts simultaneously.
});
test('captured blue nodes inherit configured policy only after combat', () => {
  const state = {
    round: 1,
    finished: false,
    nodes: [node(0, 0, 20), node(1, null, 1), node(2, 1, 50)],
  };
  const result = engine.resolveRound({
    state,
    orders: { 0: { invest: 0, edges: { 1: 10 } } },
    policies: {},
    links: [
      [0, 1],
      [1, 2],
    ],
    rng: () => 0.5,
    defaultConquestPolicy: { enabled: true, reserve: 7, investPct: 60 },
  });
  assert.equal(result.state.nodes[1].owner, 0);
  assert.equal(result.policies[1].reserve, 7);
  assert.equal(result.policies[1].dest, null);
});
test('simultaneous incoming energy cannot fund same-round outbound allocations', () => {
  const state = {
    round: 1,
    finished: false,
    nodes: [node(0, 0, 20), node(1, 0, 5), node(2, null, 20), node(3, 1, 5)],
  };
  const result = engine.resolveRound({
    state,
    orders: { 0: { invest: 0, edges: { 1: 15 } }, 1: { invest: 0, edges: { 2: 10 } } },
    policies: {},
    links: [
      [0, 1],
      [1, 2],
      [2, 3],
    ],
    rng: () => 0.5,
  });
  assert.equal(result.state.nodes[2].owner, null);
  assert.ok(result.state.nodes[1].active > 5);
});
test('player wins only after every opponent eliminated', () => {
  const state = {
    round: 3,
    finished: false,
    nodes: [node(0, 0, 50), node(1, 1, 1), node(2, 2, 1)],
  };
  const result = engine.resolveRound({
    state,
    orders: { 0: { invest: 0, edges: { 1: 10 } } },
    policies: {},
    links: [
      [0, 1],
      [1, 2],
    ],
    rng: () => 0.5,
  });
  assert.equal(result.state.nodes[1].owner, 0);
  assert.equal(result.state.finished, false);
});
test('identical RNG produces repeatable rounds', () => {
  const state = { round: 1, finished: false, nodes: [node(0, 0, 20), node(1, 1, 10)] };
  const args = {
    state,
    orders: { 0: { invest: 0, edges: { 1: 15 } } },
    policies: {},
    links: [[0, 1]],
    rng: () => 0.5,
  };
  const a = engine.resolveRound(args),
    b = engine.resolveRound(args);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});
