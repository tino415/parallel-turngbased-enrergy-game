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

const playerNames = ['Blue', 'Red', 'Purple', 'Orange', 'Green', 'Pink'];
const playerColors = ['#3278c8', '#cc6255', '#b18adc', '#d9a44d', '#72b995', '#da7dba'];

test('player identities match the map palette and keep Neutral distinct', () => {
  for (let owner = 0; owner < 6; owner++) {
    assert.equal(engine.playerName(owner), playerNames[owner]);
    assert.equal(engine.playerColor(owner), playerColors[owner]);
  }
  assert.equal(engine.playerName(null), 'Neutral');
  assert.equal(engine.playerColor(null), '#768092');
});

for (let players = 2; players <= 6; players++) {
  test(`${players}-player combat labels cover every attacker and defender, including Neutral`, () => {
    for (let attacker = 0; attacker < players; attacker++) {
      for (const defender of [null, ...Array.from({ length: players }, (_, i) => i)]) {
        if (attacker === defender) continue;
        for (const defendingEnergy of [1, 20]) {
          const nodes = Array.from({ length: players }, (_, id) => node(id, id, 20));
          const target = nodes.length;
          nodes.push(node(target, defender, defendingEnergy, 10));
          const result = engine.resolveRound({
            state: { round: 4, finished: false, nodes },
            orders: {},
            policies: {},
            links: [[attacker, target]],
            aiOrdersOverride: [{ source: attacker, type: 'attack', amount: 10, dest: target }],
            rng: () => 0.5,
          });
          const captured = defendingEnergy === 1;
          const label = defender === null ? 'Neutral' : playerNames[defender];
          assert.equal(
            result.events[0],
            `Round 4 · Node ${target}: ${playerNames[attacker]} attacks ${label} with 10.0 vs ${defendingEnergy.toFixed(1)}. ` +
              (captured
                ? 'Captured! Attacker lost 1.0, defender lost 1.0. Remaining 9.0.'
                : 'Defended! Attacker lost 10.0, defender lost 10.0. Remaining 10.0.'),
          );
          // Labels must not affect ownership, losses, capital damage or production.
          assert.equal(result.state.nodes[target].owner, captured ? attacker : defender);
          assert.equal(result.state.nodes[target].invested, captured ? 5 : 10);
          assert.equal(result.state.nodes[target].active, captured ? 9.6 : 11);
          assert.equal(result.state.nodes[attacker].active, 10);
          const summary = playerNames.slice(0, players).map((name, owner) => {
            const extraNode = owner === (captured ? attacker : defender) ? 1 : 0;
            return `${name} ${1 + extraNode} nodes`;
          });
          assert.equal(result.events[1], `Round 4 complete: ${summary.join(' / ')}.`);
          assert.equal(result.state.finished, false);
        }
      }
    }
  });
}

test('successive attacks label the current defender after a neutral node changes hands', () => {
  const result = engine.resolveRound({
    state: {
      round: 1,
      finished: false,
      nodes: [node(0, null, 1), node(1, 2, 10), node(2, 5, 20)],
    },
    orders: {},
    policies: {},
    links: [
      [1, 0],
      [2, 0],
    ],
    aiOrdersOverride: [
      { source: 1, type: 'attack', amount: 10, dest: 0 },
      { source: 2, type: 'attack', amount: 20, dest: 0 },
    ],
    rng: () => 0.5,
  });
  assert.match(result.events[0], /Purple attacks Neutral.*Captured!/);
  assert.match(result.events[1], /Pink attacks Purple.*Captured!/);
  assert.equal(result.state.nodes[0].owner, 5);
});

test('summaries retain eliminated players across rounds and accept saved-match player counts', () => {
  let state = {
    round: 1,
    finished: false,
    nodes: [node(0, 0, 20), node(1, 1, 20), node(2, 5, 1)],
  };
  const args = { orders: {}, policies: {}, links: [[0, 2]], rng: () => 0.5 };
  const first = engine.resolveRound({
    ...args,
    state,
    aiOrdersOverride: [{ source: 0, type: 'attack', amount: 10, dest: 2 }],
  });
  assert.match(
    first.events[1],
    /Purple 0 nodes \/ Orange 0 nodes \/ Green 0 nodes \/ Pink 0 nodes/,
  );
  state = first.state;
  const second = engine.resolveRound({ ...args, state, aiOrdersOverride: [] });
  assert.match(second.events[0], /Pink 0 nodes/);
  // Old browser saves store playerCount separately from state.
  delete state.playerCount;
  const restored = engine.resolveRound({ ...args, state, playerCount: 6, aiOrdersOverride: [] });
  assert.equal(restored.events[0], second.events[0]);
});

for (let winner = 0; winner < 6; winner++) {
  test(`elimination message names ${playerNames[winner]}`, () => {
    const result = engine.resolveRound({
      state: { round: 1, finished: false, nodes: [node(0, winner, 20), node(1, null, 1)] },
      playerCount: 6,
      orders: {},
      policies: {},
      links: [],
      aiOrdersOverride: [],
    });
    assert.equal(result.state.finished, true);
    assert.equal(result.events.at(-1), `${playerNames[winner]} wins by elimination!`);
  });
}
