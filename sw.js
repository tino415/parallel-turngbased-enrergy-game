'use strict';

const CACHE = 'parallel-energy-game';
const NETWORK_TIMEOUT_MS = 4000;
const APP_SHELL = [
  './',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './src/styles.css',
  './src/ux.css',
  './src/tactical-ui.css',
  './src/replay.css',
  './src/online.css',
  './src/engine.js',
  './src/store.js',
  './src/format.js',
  './src/game.js',
  './src/dialogs.js',
  './src/leaderboard.js',
  './src/ux.js',
  './src/tactical-ui.js',
  './src/replay.js',
  './src/rules.js',
  './src/online.js',
  './src/service-worker-registration.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(cacheAppShell().then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  if (isSameOriginGet(event.request)) event.respondWith(networkFirst(event.request));
});

async function cacheAppShell() {
  const cache = await caches.open(CACHE);
  await cache.addAll(APP_SHELL.map((path) => new Request(path, { cache: 'reload' })));
}

function isSameOriginGet(request) {
  const url = new URL(request.url);
  return request.method === 'GET' && url.origin === self.location.origin && !isApiPath(url);
}

const isApiPath = ({ pathname }) => pathname.startsWith('/api/');

async function networkFirst(request) {
  const fromNetwork = fetchAndCache(request);
  const cached = await cachedAfterTimeout(request, fromNetwork);
  return cached ?? fromNetwork;
}

async function fetchAndCache(request) {
  const response = await fetch(request, { cache: 'no-cache' });
  if (response.ok) {
    const cache = await caches.open(CACHE);
    await cache.put(request, response.clone());
  }
  return response;
}

async function cachedAfterTimeout(request, fromNetwork) {
  const networkSettled = fromNetwork.then(
    () => 'network',
    () => 'failed',
  );
  const winner = await Promise.race([networkSettled, delay(NETWORK_TIMEOUT_MS, 'timeout')]);
  if (winner === 'network') return null;
  return caches.match(request, { ignoreSearch: true });
}

function delay(ms, value) {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}
