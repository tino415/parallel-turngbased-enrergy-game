'use strict';

// A hand-made map: node positions on the generator's canvas, the connections
// between them and the colour that starts on each node. Pure functions, shared
// by the editor in the browser and by the server that accepts a map.
(() => {
  const { playerName, playerOwners } = GameEngine;
  const FORMAT = 'peg-map/1';
  const CANVAS = Object.freeze({ width: 1800, height: 1050, margin: 60 });
  const GRID = 30;
  const MAX_NODES = 120;
  const MIN_DISTANCE = 75;
  const NAME_LENGTH = 40;
  const COLOURS = playerOwners.filter((owner) => owner !== null);
  const START_NODE = Object.freeze({ active: 24, invested: 14 });

  const blank = (name = 'Untitled map') => ({
    name: cleanName(name),
    positions: [],
    links: [],
    owners: [],
  });

  const fromGenerated = (map, name) => ({
    name: cleanName(name),
    positions: map.positions.map(rounded),
    links: map.links.map(([a, b]) => [a, b]),
    owners: map.nodes.map((node) => node.owner),
  });

  const fromMatch = (match, name) => ({
    name: cleanName(name),
    positions: match.map.xy.map(rounded),
    links: match.map.edges.map(([a, b]) => [a, b]),
    owners: match.state.nodes.map((node) => node.owner),
  });

  const cleanName = (name) =>
    String(name ?? '')
      .trim()
      .slice(0, NAME_LENGTH) || 'Untitled map';

  const rounded = ([x, y]) => [Math.round(x), Math.round(y)];
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
  const insideCanvas = ([x, y]) => [
    clamp(Math.round(x), CANVAS.margin, CANVAS.width - CANVAS.margin),
    clamp(Math.round(y), CANVAS.margin, CANVAS.height - CANVAS.margin),
  ];
  const isInsideCanvas = ([x, y]) =>
    x >= CANVAS.margin &&
    x <= CANVAS.width - CANVAS.margin &&
    y >= CANVAS.margin &&
    y <= CANVAS.height - CANVAS.margin;
  const snapped = ([x, y]) =>
    insideCanvas([Math.round(x / GRID) * GRID, Math.round(y / GRID) * GRID]);

  function addNode(map, position) {
    if (map.positions.length >= MAX_NODES) return map;
    return {
      ...map,
      positions: [...map.positions, insideCanvas(position)],
      owners: [...map.owners, null],
    };
  }

  function moveNode(map, id, position) {
    if (!map.positions[id]) return map;
    const next = insideCanvas(position);
    if (next[0] === map.positions[id][0] && next[1] === map.positions[id][1]) return map;
    return { ...map, positions: map.positions.map((xy, i) => (i === id ? next : xy)) };
  }

  function removeNode(map, id) {
    if (!map.positions[id]) return map;
    const shifted = (node) => (node > id ? node - 1 : node);
    return {
      ...map,
      positions: map.positions.filter((_, i) => i !== id),
      owners: map.owners.filter((_, i) => i !== id),
      links: map.links
        .filter(([a, b]) => a !== id && b !== id)
        .map(([a, b]) => [shifted(a), shifted(b)]),
    };
  }

  const linkKey = (a, b) => Math.min(a, b) + ':' + Math.max(a, b);
  const hasLink = (map, a, b) => map.links.some((link) => linkKey(...link) === linkKey(a, b));

  function toggleLink(map, a, b) {
    if (a === b || !map.positions[a] || !map.positions[b]) return map;
    if (hasLink(map, a, b))
      return { ...map, links: map.links.filter((link) => linkKey(...link) !== linkKey(a, b)) };
    return { ...map, links: [...map.links, [Math.min(a, b), Math.max(a, b)]] };
  }

  function setOwner(map, id, owner) {
    if (!map.positions[id] || !playerOwners.includes(owner) || map.owners[id] === owner) return map;
    return { ...map, owners: map.owners.map((current, i) => (i === id ? owner : current)) };
  }

  function cycleOwner(map, id, step = 1) {
    const cycle = [null, ...COLOURS];
    const at = cycle.indexOf(map.owners[id]);
    return setOwner(map, id, cycle[(at + step + cycle.length) % cycle.length]);
  }

  const rename = (map, name) =>
    cleanName(name) === map.name ? map : { ...map, name: cleanName(name) };

  const players = (map) => {
    const colours = map.owners.filter((owner) => owner !== null);
    return colours.length ? Math.max(...colours) + 1 : 0;
  };

  const neighbours = (map, id) =>
    map.links.flatMap(([a, b]) => (a === id ? [b] : b === id ? [a] : []));

  function unreachableNodes(map) {
    if (!map.positions.length) return [];
    const reached = new Set([0]),
      queue = [0];
    while (queue.length) {
      for (const next of neighbours(map, queue.shift()))
        if (!reached.has(next)) {
          reached.add(next);
          queue.push(next);
        }
    }
    return map.positions.map((_, id) => id).filter((id) => !reached.has(id));
  }

  function overlappingPairs(map) {
    const pairs = [];
    map.positions.forEach(([ax, ay], a) => {
      for (let b = a + 1; b < map.positions.length; b++) {
        const [bx, by] = map.positions[b];
        if (Math.hypot(ax - bx, ay - by) < MIN_DISTANCE) pairs.push([a, b]);
      }
    });
    return pairs;
  }

  const missingColours = (map) => {
    const used = new Set(map.owners.filter((owner) => owner !== null));
    return COLOURS.slice(0, players(map)).filter((owner) => !used.has(owner));
  };

  const listOf = (ids) => ids.join(', ');

  function problems(map) {
    const found = [];
    const problem = (code, message, nodes = []) => found.push({ code, message, nodes });
    if (map.positions.length < 2) problem('too-few-nodes', 'Add at least two nodes');
    if (map.positions.length > MAX_NODES)
      problem(
        'too-many-nodes',
        'At most ' + MAX_NODES + ' nodes; this map has ' + map.positions.length,
      );
    const colours = new Set(map.owners.filter((owner) => owner !== null)).size;
    if (colours < 2) problem('too-few-players', 'Give at least two colours a start node', []);
    for (const owner of missingColours(map))
      problem('missing-colour', playerName(owner) + ' has no start node, colours go in order');
    const unreachable = unreachableNodes(map);
    if (unreachable.length)
      problem(
        'unreachable',
        (unreachable.length === 1 ? 'Node ' : 'Nodes ') +
          listOf(unreachable) +
          ' cannot be reached',
        unreachable,
      );
    for (const [a, b] of overlappingPairs(map))
      problem('overlap', 'Nodes ' + a + ' and ' + b + ' overlap', [a, b]);
    map.positions.forEach((xy, id) => {
      if (!isInsideCanvas(xy)) problem('outside', 'Node ' + id + ' is outside the map', [id]);
    });
    return found;
  }

  const isPlayable = (map) => problems(map).length === 0;

  function toGeneratorMap(map, random) {
    return {
      positions: map.positions.map(([x, y]) => [x, y]),
      links: map.links.map(([a, b]) => [a, b]),
      nodes: map.owners.map((owner, id) =>
        owner === null
          ? { id, owner, active: 3 + random() * 4, invested: 0 }
          : { id, owner, ...START_NODE },
      ),
      seed: map.name,
      players: players(map),
    };
  }

  const serialize = (map) =>
    JSON.stringify(
      {
        format: FORMAT,
        name: map.name,
        positions: map.positions,
        links: map.links,
        owners: map.owners,
      },
      null,
      2,
    );

  const isPoint = (value) =>
    Array.isArray(value) && value.length === 2 && value.every(Number.isFinite);
  const isIndex = (value, count) => Number.isInteger(value) && value >= 0 && value < count;

  function parse(text) {
    let data;
    try {
      data = typeof text === 'string' ? JSON.parse(text) : text;
    } catch {
      throw new Error('This is not a map file');
    }
    if (!data || typeof data !== 'object' || data.format !== FORMAT)
      throw new Error('This is not a map file');
    if (!Array.isArray(data.positions) || !data.positions.every(isPoint))
      throw new Error('The map file has broken node positions');
    const count = data.positions.length;
    if (
      !Array.isArray(data.owners) ||
      data.owners.length !== count ||
      !data.owners.every((owner) => playerOwners.includes(owner))
    )
      throw new Error('The map file has broken start colours');
    const links = Array.isArray(data.links) ? data.links : null;
    if (
      !links ||
      !links.every(
        ([a, b, ...rest]) => rest.length === 0 && isIndex(a, count) && isIndex(b, count) && a !== b,
      )
    )
      throw new Error('The map file has broken connections');
    const unique = new Map(
      links.map(([a, b]) => [linkKey(a, b), [Math.min(a, b), Math.max(a, b)]]),
    );
    return {
      name: cleanName(data.name),
      positions: data.positions.map(([x, y]) => [x, y]),
      links: [...unique.values()],
      owners: [...data.owners],
    };
  }

  globalThis.CustomMap = Object.freeze({
    FORMAT,
    CANVAS,
    GRID,
    MAX_NODES,
    MIN_DISTANCE,
    blank,
    fromGenerated,
    fromMatch,
    snapped,
    addNode,
    moveNode,
    removeNode,
    toggleLink,
    hasLink,
    setOwner,
    cycleOwner,
    rename,
    players,
    neighbours,
    problems,
    isPlayable,
    toGeneratorMap,
    serialize,
    parse,
  });
})();
