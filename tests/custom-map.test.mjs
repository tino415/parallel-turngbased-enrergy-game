import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

function loadContext() {
  const context = createContext({ Math });
  runInContext(read('../src/engine.js'), context);
  runInContext(read('../src/custom-map.js'), context);
  runInContext(read('../src/store.js'), context);
  return context;
}

const { CustomMap, GameStore, GameEngine } = loadContext();
const seeded = GameEngine.seeded;

function triangle() {
  let map = CustomMap.blank('Triangle');
  map = CustomMap.addNode(map, [300, 300]);
  map = CustomMap.addNode(map, [600, 300]);
  map = CustomMap.addNode(map, [450, 600]);
  map = CustomMap.toggleLink(map, 0, 1);
  map = CustomMap.toggleLink(map, 1, 2);
  map = CustomMap.setOwner(map, 0, 0);
  map = CustomMap.setOwner(map, 2, 1);
  return map;
}

const codes = (map) => CustomMap.problems(map).map((problem) => problem.code);
const plain = (value) => JSON.parse(JSON.stringify(value));
const same = (actual, expected) => assert.deepEqual(plain(actual), plain(expected));

test('a blank map has a name and nothing else', () => {
  same(CustomMap.blank('  Islands  '), {
    name: 'Islands',
    positions: [],
    links: [],
    owners: [],
  });
  assert.equal(CustomMap.blank('').name, 'Untitled map');
  assert.equal(CustomMap.blank('x'.repeat(60)).name.length, 40);
});

test('adding a node keeps it inside the canvas and neutral', () => {
  const map = CustomMap.addNode(CustomMap.blank(), [-50, 5000]);
  same(map.positions, [[60, 990]]);
  same(map.owners, [null]);
});

test('the node count stops at the maximum', () => {
  let map = CustomMap.blank();
  for (let i = 0; i < CustomMap.MAX_NODES + 5; i++)
    map = CustomMap.addNode(map, [100 + i * 10, 100]);
  assert.equal(map.positions.length, CustomMap.MAX_NODES);
});

test('moving a node rounds and clamps, and a move to the same place changes nothing', () => {
  const map = triangle();
  same(CustomMap.moveNode(map, 1, [1900.4, 10]).positions[1], [1740, 60]);
  assert.equal(CustomMap.moveNode(map, 1, [600, 300]), map);
  assert.equal(CustomMap.moveNode(map, 9, [600, 300]), map);
});

test('snapping lands on the grid', () => {
  same(CustomMap.snapped([44, 76]), [60, 90]);
  same(CustomMap.snapped([0, 0]), [60, 60]);
  same(CustomMap.snapped([1799, 1049]), [1740, 990]);
});

test('removing a node renumbers the ones after it and drops its links', () => {
  const map = CustomMap.removeNode(triangle(), 1);
  same(map.positions, [
    [300, 300],
    [450, 600],
  ]);
  same(map.owners, [0, 1]);
  same(map.links, []);
  const withoutFirst = CustomMap.removeNode(triangle(), 0);
  same(withoutFirst.links, [[0, 1]]);
});

test('a link toggles on and off, stored with the lower node first', () => {
  const map = triangle();
  const linked = CustomMap.toggleLink(map, 2, 0);
  assert.ok(CustomMap.hasLink(linked, 0, 2));
  same(linked.links.at(-1), [0, 2]);
  assert.ok(!CustomMap.hasLink(CustomMap.toggleLink(linked, 0, 2), 0, 2));
  assert.equal(CustomMap.toggleLink(map, 1, 1), map);
  assert.equal(CustomMap.toggleLink(map, 1, 7), map);
});

test('owners cycle through neutral and the six colours', () => {
  let map = triangle();
  const seen = [];
  for (let i = 0; i < 7; i++) {
    map = CustomMap.cycleOwner(map, 1);
    seen.push(map.owners[1]);
  }
  same(seen, [0, 1, 2, 3, 4, 5, null]);
  assert.equal(CustomMap.cycleOwner(map, 1, -1).owners[1], 5);
  assert.equal(CustomMap.setOwner(map, 1, 9), map);
});

test('players is the highest colour in use plus one', () => {
  assert.equal(CustomMap.players(triangle()), 2);
  assert.equal(CustomMap.players(CustomMap.blank()), 0);
  assert.equal(CustomMap.players(CustomMap.setOwner(triangle(), 1, 4)), 5);
});

test('a connected map with two colours in order is playable', () => {
  same(codes(triangle()), []);
  assert.ok(CustomMap.isPlayable(triangle()));
});

test('problems name what stops the map from being played', () => {
  same(codes(CustomMap.blank()), ['too-few-nodes', 'too-few-players']);
  const lonely = CustomMap.addNode(triangle(), [900, 900]);
  same(codes(lonely), ['unreachable']);
  same(CustomMap.problems(lonely)[0].nodes, [3]);
  const skipped = CustomMap.setOwner(triangle(), 2, 3);
  same(codes(skipped), ['missing-colour', 'missing-colour']);
  assert.match(CustomMap.problems(skipped)[0].message, /Red has no start node/);
  const crowded = CustomMap.moveNode(triangle(), 1, [340, 300]);
  same(codes(crowded), ['overlap']);
  const oneColour = CustomMap.setOwner(triangle(), 2, null);
  same(codes(oneColour), ['too-few-players']);
});

test('a parsed file can place a node outside the map, and problems say so', () => {
  const outside = CustomMap.parse({
    ...JSON.parse(CustomMap.serialize(triangle())),
    positions: [
      [0, 0],
      [600, 300],
      [450, 600],
    ],
  });
  same(codes(outside), ['outside']);
});

test('serialize and parse round-trip a map', () => {
  const text = CustomMap.serialize(triangle());
  assert.equal(JSON.parse(text).format, 'peg-map/1');
  same(CustomMap.parse(text), triangle());
});

test('parse drops duplicate links and normalises their order', () => {
  const data = JSON.parse(CustomMap.serialize(triangle()));
  data.links = [
    [1, 0],
    [0, 1],
    [2, 1],
  ];
  same(CustomMap.parse(data).links, [
    [0, 1],
    [1, 2],
  ]);
});

test('parse refuses what is not a map file', () => {
  const data = JSON.parse(CustomMap.serialize(triangle()));
  assert.throws(() => CustomMap.parse('nonsense'), /not a map file/);
  assert.throws(() => CustomMap.parse({ ...data, format: 'other' }), /not a map file/);
  assert.throws(() => CustomMap.parse({ ...data, positions: [[1]] }), /node positions/);
  assert.throws(() => CustomMap.parse({ ...data, owners: [0, 1] }), /start colours/);
  assert.throws(() => CustomMap.parse({ ...data, owners: [0, 7, 1] }), /start colours/);
  assert.throws(() => CustomMap.parse({ ...data, links: [[0, 3]] }), /connections/);
  assert.throws(() => CustomMap.parse({ ...data, links: [[0, 0]] }), /connections/);
  assert.throws(() => CustomMap.parse({ ...data, links: 'none' }), /connections/);
});

test('a generated map and a running match become editable maps', () => {
  const generated = GameEngine.buildMap({ count: 12, players: 3, density: 'normal', seed: 'edit' });
  const map = CustomMap.fromGenerated(generated, 'From seed');
  assert.equal(map.positions.length, 12);
  assert.equal(CustomMap.players(map), 3);
  same(codes(map), []);
  const match = GameStore.generatedMatch(
    generated,
    { enabled: true, reserve: 5, invest: 50 },
    seeded(1),
  );
  same(CustomMap.fromMatch(match, 'From match'), { ...map, name: 'From match' });
});

test('a custom map starts a match the engine can resolve', () => {
  const map = triangle();
  const generator = CustomMap.toGeneratorMap(map, seeded(3));
  assert.equal(generator.players, 2);
  assert.equal(generator.seed, 'Triangle');
  same(generator.nodes[0], { id: 0, owner: 0, active: 24, invested: 14 });
  assert.equal(generator.nodes[1].owner, null);
  assert.ok(generator.nodes[1].active >= 3 && generator.nodes[1].active < 7);
  const store = GameStore.createStore();
  store.replaceMatch(
    GameStore.generatedMatch(generator, { enabled: true, reserve: 5, invest: 50 }, seeded(4), 1),
  );
  const before = store.getSnapshot().match;
  same(before.map.xy, map.positions);
  assert.equal(before.map.playerCount, 2);
  assert.equal(before.state.nodes[2].owner, 1);
  store.resolve();
  assert.equal(store.getSnapshot().match.state.round, 2);
});
