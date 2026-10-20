import { test, expect } from './support/game.mjs';

test.use({ serviceWorkers: 'allow' });

test('index.html links an installable manifest', async ({ page }) => {
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  const response = await page.request.get(href);
  expect(response.headers()['content-type']).toContain('application/manifest+json');

  const manifest = await response.json();
  expect(manifest).toMatchObject({
    name: 'Parallel Energy Game',
    start_url: '/',
    scope: '/',
    display: 'standalone',
  });
  expect(manifest.icons).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ sizes: '192x192', purpose: 'any' }),
      expect.objectContaining({ sizes: '512x512', purpose: 'any' }),
      expect.objectContaining({ sizes: '512x512', purpose: 'maskable' }),
    ]),
  );
  for (const icon of manifest.icons) {
    const image = await page.request.get(icon.src);
    expect(image.headers()['content-type']).toBe(icon.type);
  }
});

test('the service worker serves the game offline and keeps the save', async ({ page, context }) => {
  await controlledByServiceWorker(page);
  await page.locator('#uxDockResolve:visible, #resolve:visible').first().click();
  await expect.poll(() => page.evaluate(() => state.round)).toBe(2);

  await context.setOffline(true);
  await page.reload();

  await expect(page.locator('#map .node-hit').first()).toBeVisible();
  expect(await page.evaluate(() => state.round)).toBe(2);
});

async function controlledByServiceWorker(page) {
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
}
