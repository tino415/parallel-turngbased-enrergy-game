import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { chromium } from '@playwright/test';
import { seedMathRandom } from '../tests/e2e/support/game.mjs';

const PORT = 4175;
const BASE = 'http://127.0.0.1:' + PORT;
const output = process.argv[2];

const viewports = {
  desktop: { viewport: { width: 1440, height: 900 } },
  mobile: { viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true },
};
const generate120 = (page) =>
  page.evaluate(() => {
    document.getElementById('nodeCount').value = '120';
    document.getElementById('seed').value = 'measure-120';
    generate();
  });
const maps = {
  'classic 14': async () => {},
  'generated 120': generate120,
  'generated 120, Blue owns 40 with policies': async (page) => {
    await generate120(page);
    await page.evaluate(giveBlueTerritoryWithPolicies, 40);
  },
};

function giveBlueTerritoryWithPolicies(count) {
  const start = state.nodes.find((node) => node.owner === 0).id;
  const reached = [start];
  for (let i = 0; i < reached.length && reached.length < count; i++)
    for (const next of neighbors(reached[i]))
      if (!reached.includes(next) && state.nodes[next].owner === null && reached.length < count)
        reached.push(next);
  for (const id of reached) {
    Object.assign(state.nodes[id], { owner: 0, active: 12, invested: 6 });
    policies[id] = { enabled: true, reserve: 3, investPct: 40, dest: null };
  }
  render();
}

const results = await withServer(async () => {
  const browser = await chromium.launch();
  const rows = [];
  for (const [viewportName, contextOptions] of Object.entries(viewports))
    for (const [mapName, prepareMap] of Object.entries(maps)) {
      const context = await browser.newContext(contextOptions);
      const page = await context.newPage();
      rows.push(
        ...(await measureInteractions(page, prepareMap, contextOptions.hasTouch)).map((row) => ({
          viewport: viewportName,
          map: mapName,
          ...row,
        })),
      );
      await context.close();
    }
  await browser.close();
  return rows;
});

console.log(markdownTable(results));
if (output) {
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify(results, null, 2) + '\n');
}

async function measureInteractions(page, prepareMap, touch) {
  await page.addInitScript(seedMathRandom);
  await page.addInitScript(installStorageAndMutationCounters);
  page.on('dialog', (dialog) => dialog.accept());
  await page.goto(BASE + '/');
  await prepareMap(page);
  await page.reload();
  await settle(page);
  const rows = [{ interaction: 'page load (restore save)', ...(await readCounters(page)) }];
  await page.evaluate(installRenderCounters);

  const step = async (interaction, action) => {
    await page.evaluate(() => window.measure.reset());
    const before = await page.evaluate(() => JSON.stringify(camera));
    await action();
    await settle(page);
    const cameraMoved = before !== (await page.evaluate(() => JSON.stringify(camera)));
    rows.push({ interaction, cameraMoved, ...(await readCounters(page)) });
  };
  const blueNode = page.locator('#map .node-hit[fill="#3278c8"]').first();

  await step('camera: drag pan', () => dragMap(page, touch));
  await step('camera: zoom in button', () => page.locator('#zoomIn').click());
  if (!touch)
    await step('camera: ctrl+wheel zoom', async () => {
      const box = await page.locator('#map').boundingBox();
      await page.mouse.move(box.x + 20, box.y + 20);
      await page.keyboard.down('Control');
      await page.mouse.wheel(0, -100);
      await page.keyboard.up('Control');
    });
  await step('camera: fit button', () => page.locator('#fit').click());
  await step('view: messages tab', () => page.locator('#messagesTab').click());
  await step('view: map tab', () => page.locator('#mapTab').click());
  await step('view: flow filter', () => page.locator('#overlay').selectOption('manual'));
  await page.locator('#overlay').selectOption('all');
  await step('select node (first tap)', () => blueNode.click());
  await step('open node editor (second tap)', () => blueNode.click());
  await step('policy edit: invest %', async () => {
    const percent = page.locator('#tacticalPolicyPercent');
    await percent.fill('61');
    await percent.blur();
  });
  await page.getByText('Manual investment, withdrawal and allocations').click();
  await step('order edit: manual invest', async () => {
    const invest = page.locator('#uxManualSection [data-allocation="invest"]');
    await invest.fill('2');
    await invest.blur();
  });
  await step('close editor (Escape)', () => page.keyboard.press('Escape'));
  await step('resolve round', () =>
    page.locator('#uxDockResolve:visible, #resolve:visible').first().click(),
  );
  return rows;
}

function installStorageAndMutationCounters() {
  const fresh = () => ({
    writes: 0,
    bytes: 0,
    mutations: {},
    seen: { added: new WeakSet(), removed: new WeakSet() },
    calls: {},
    renderMs: 0,
  });
  window.measure = { ...fresh(), reset: () => Object.assign(window.measure, fresh()) };
  const setItem = Storage.prototype.setItem;
  Storage.prototype.setItem = function (key, value) {
    window.measure.writes += 1;
    window.measure.bytes += String(value).length;
    return setItem.call(this, key, value);
  };
  const region = (node) =>
    (node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement)?.closest('[id]')?.id ||
    'document';
  const tally = (key, field, amount) => {
    const entry = (window.measure.mutations[key] ??= { added: 0, removed: 0 });
    entry[field] += amount;
  };
  const unseenElements = (node, field) => {
    if (node.nodeType !== Node.ELEMENT_NODE) return 0;
    const seen = window.measure.seen[field];
    return [node, ...node.getElementsByTagName('*')].filter((element) => {
      if (seen.has(element)) return false;
      seen.add(element);
      return true;
    }).length;
  };
  new MutationObserver((records) => {
    for (const record of records) {
      const key = region(record.target);
      for (const node of record.addedNodes) tally(key, 'added', unseenElements(node, 'added'));
      for (const node of record.removedNodes)
        tally(key, 'removed', unseenElements(node, 'removed'));
    }
  }).observe(document, { childList: true, subtree: true });
}

function installRenderCounters() {
  const counted = [
    'render',
    'renderAllocator',
    'renderPolicyEditor',
    'renderOrders',
    'renderFlows',
    'renderViews',
    'saveGame',
    'previewOrders',
    'policyOrders',
    'projection',
  ];
  for (const name of counted) {
    const original = window[name];
    window[name] = function (...args) {
      window.measure.calls[name] = (window.measure.calls[name] || 0) + 1;
      if (name !== 'render') return original.apply(this, args);
      const started = performance.now();
      try {
        return original.apply(this, args);
      } finally {
        window.measure.renderMs += performance.now() - started;
      }
    };
  }
  window.measure.reset();
}

function readCounters(page) {
  return page.evaluate(() => {
    const { calls, mutations, writes, bytes, renderMs } = window.measure;
    const sum = (field) => Object.values(mutations).reduce((total, m) => total + m[field], 0);
    return {
      renders: calls.render || 0,
      renderMs: Math.round(renderMs * 10) / 10,
      calls: { ...calls },
      elementsAdded: sum('added'),
      elementsRemoved: sum('removed'),
      regions: Object.fromEntries(
        Object.entries(mutations)
          .filter(([, m]) => m.added || m.removed)
          .map(([key, m]) => [key, m.added + m.removed]),
      ),
      storageWrites: writes,
      storageBytes: bytes,
    };
  });
}

function settle(page) {
  return page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );
}

async function dragMap(page, touch) {
  const box = await page.locator('#mapViewport').boundingBox();
  const x = box.x + 12;
  const y = box.y + Math.min(box.height, page.viewportSize().height - box.y) / 2;
  if (!touch) {
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 70, y + 40, { steps: 8 });
    await page.mouse.up();
    return;
  }
  const cdp = await page.context().newCDPSession(page);
  const send = (type, touchPoints) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints });
  await send('touchStart', [{ x, y }]);
  for (let i = 1; i <= 8; i++) await send('touchMove', [{ x: x + 9 * i, y: y + 5 * i }]);
  await send('touchEnd', []);
  await cdp.detach();
}

function markdownTable(rows) {
  const header =
    '| viewport | map | interaction | render passes | via render() | render() ms | policyOrders | projection | elements +/- | top regions | localStorage writes | bytes |';
  const divider = '|' + ' --- |'.repeat(12);
  const lines = rows.map((r) =>
    [
      r.viewport,
      r.map,
      r.interaction,
      r.calls.saveGame || 0,
      r.renders,
      r.renderMs,
      r.calls.policyOrders || 0,
      r.calls.projection || 0,
      r.elementsAdded + ' / ' + r.elementsRemoved,
      topRegions(r.regions),
      r.storageWrites,
      r.storageBytes,
    ].join(' | '),
  );
  return [header, divider, ...lines.map((line) => '| ' + line + ' |')].join('\n');
}

function topRegions(regions) {
  return Object.entries(regions)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([key, count]) => key + ' ' + count)
    .join(', ');
}

async function withServer(run) {
  execFileSync('node', ['scripts/build.mjs'], { stdio: 'ignore' });
  const server = spawn(
    'python3',
    ['-m', 'http.server', String(PORT), '--directory', 'dist', '--bind', '127.0.0.1'],
    { stdio: 'ignore' },
  );
  try {
    await waitFor(BASE);
    return await run();
  } finally {
    server.kill();
  }
}

async function waitFor(url) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    await new Promise((done) => setTimeout(done, 100));
  }
  throw new Error('Static server did not start at ' + url);
}
