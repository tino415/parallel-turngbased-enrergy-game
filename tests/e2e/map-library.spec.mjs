import { readFileSync } from 'node:fs';
import { test, expect } from './support/game.mjs';

const STORAGE_KEY = 'parallel-energy-game-maps-v1';

const ringFile = {
  format: 'peg-map/1',
  name: 'Ring',
  positions: [
    [300, 300],
    [600, 300],
    [900, 300],
  ],
  links: [
    [0, 1],
    [1, 2],
  ],
  owners: [0, 1, null],
};

async function openMyMaps(page) {
  await page.getByLabel('More actions').click();
  await page.getByRole('button', { name: 'New game' }).click();
  await page.locator('#sourceLibrary').click();
  await expect(page.locator('#mapLibrary')).toBeVisible();
}

async function saveMatchMapAs(page, name) {
  await page.getByLabel('More actions').click();
  await page.locator('#menuMapEditor').click();
  await page.locator('#mapEditorName').fill(name);
  await page.locator('#mapEditorName').press('Enter');
  await page.locator('#mapEditorSave').click();
  await expect(page.locator('#mapEditorSave')).toBeDisabled();
  await page.locator('#mapEditorClose').click();
  await expect(page.locator('#mapEditorBar')).toBeHidden();
}

const storedNames = (page) =>
  page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)).maps.map((entry) => entry.map.name),
    STORAGE_KEY,
  );

test('Save in the editor keeps the map in My maps and Start game plays it', async ({ page }) => {
  await saveMatchMapAs(page, 'Islands');
  expect(await storedNames(page)).toEqual(['Islands']);
  await openMyMaps(page);
  await expect(page.locator('#sourceLibrary')).toHaveText('My maps (1)');
  await expect(page.locator('#newGamePreview')).toBeHidden();
  await expect(page.locator('#generateOnline')).toBeHidden();
  await expect(page.locator('#generate')).toBeDisabled();
  const card = page.locator('.map-card[data-map-id]');
  await expect(card).toHaveCount(1);
  await expect(card).toContainText('Islands');
  await expect(card).toContainText('14 nodes · 2 players');
  await card.click();
  await expect(page.locator('#librarySeat option')).toHaveCount(2);
  await page.locator('#librarySeat').selectOption('1');
  await page.locator('#generate').click();
  await expect(page.locator('#newGameDialog')).toBeHidden();
  await expect(page.locator('#map .node-hit')).toHaveCount(14);
  expect(await page.evaluate(() => [mapSeed, state.nodes.length, currentMatch().seat])).toEqual([
    'Islands',
    14,
    1,
  ]);
});

test('saved maps survive a reload', async ({ page }) => {
  await saveMatchMapAs(page, 'Islands');
  await page.reload();
  await openMyMaps(page);
  await expect(page.locator('.map-card[data-map-id]')).toHaveText(/Islands/);
});

test('a saved map is renamed, duplicated and deleted from the gallery', async ({ page }) => {
  await saveMatchMapAs(page, 'Islands');
  await openMyMaps(page);
  await page.locator('.map-card[data-map-id]').click();
  await page.locator('#libraryName').fill('Archipelago');
  await page.locator('#libraryName').press('Tab');
  await expect(page.locator('.map-card[data-map-id]')).toContainText('Archipelago');
  await page.locator('#libraryDuplicate').click();
  await expect(page.locator('.map-card[data-map-id]')).toHaveCount(2);
  await expect(page.locator('.map-card[aria-pressed="true"]')).toContainText('Archipelago copy');
  await page.locator('#libraryDelete').click();
  await expect(page.locator('.map-card[data-map-id]')).toHaveCount(1);
  await expect(page.locator('#mapLibraryDetails')).toBeHidden();
  expect(await storedNames(page)).toEqual(['Archipelago']);
});

test('Edit opens the saved map and Save overwrites it instead of adding one', async ({ page }) => {
  await saveMatchMapAs(page, 'Islands');
  await openMyMaps(page);
  await page.locator('.map-card[data-map-id]').click();
  await page.locator('#libraryEdit').click();
  await expect(page.locator('#newGameDialog')).toBeHidden();
  await expect(page.locator('#mapEditorName')).toHaveValue('Islands');
  await expect(page.locator('#mapEditorSave')).toBeDisabled();
  await page.locator('[data-tool="erase"]').click();
  await page.locator('.editor-node[data-node="3"]').click();
  await expect(page.locator('#mapEditorSave')).toBeEnabled();
  await page.locator('#mapEditorSave').click();
  await page.locator('#mapEditorClose').click();
  await openMyMaps(page);
  await expect(page.locator('.map-card[data-map-id]')).toHaveCount(1);
  await expect(page.locator('.map-card[data-map-id]')).toContainText('13 nodes');
});

test('Export downloads the map file and Import reads one', async ({ page }) => {
  await saveMatchMapAs(page, 'Islands');
  await openMyMaps(page);
  await page.locator('.map-card[data-map-id]').click();
  const download = page.waitForEvent('download');
  await page.locator('#libraryExport').click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('islands.peg-map.json');
  const exported = JSON.parse(readFileSync(await file.path(), 'utf8'));
  expect(exported.format).toBe('peg-map/1');
  expect(exported.name).toBe('Islands');
  expect(exported.positions).toHaveLength(14);

  const chooser = page.waitForEvent('filechooser');
  await page.locator('#libraryImport').click();
  await (
    await chooser
  ).setFiles({
    name: 'ring.peg-map.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(ringFile)),
  });
  await expect(page.locator('.map-card[data-map-id]')).toHaveCount(2);
  await expect(page.locator('.map-card[aria-pressed="true"]')).toContainText('Ring');
  await expect(page.locator('#generate')).toBeEnabled();
  await page.locator('#generate').click();
  await expect(page.locator('#map .node-hit')).toHaveCount(3);
});

test('a broken map file is refused with its reason', async ({ page }) => {
  await openMyMaps(page);
  const messages = [];
  page.on('dialog', (dialog) => messages.push(dialog.message()));
  const chooser = page.waitForEvent('filechooser');
  await page.locator('#libraryImport').click();
  await (
    await chooser
  ).setFiles({
    name: 'notes.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"hello":"world"}'),
  });
  await expect.poll(() => messages).toEqual(['This is not a map file']);
  await expect(page.locator('.map-card[data-map-id]')).toHaveCount(0);
});

test('a blank map starts in the editor and an unplayable one cannot start', async ({ page }) => {
  await openMyMaps(page);
  await page.locator('#libraryNew').click();
  await expect(page.locator('#mapEditorBar')).toBeVisible();
  await expect(page.locator('.map-editor-node')).toHaveCount(0);
  await page.locator('#mapEditorSave').click();
  await page.locator('#mapEditorClose').click();
  await openMyMaps(page);
  const card = page.locator('.map-card[data-map-id]');
  await expect(card).toContainText('not playable yet');
  await card.click();
  await expect(page.locator('#generate')).toBeDisabled();
  await expect(page.locator('#libraryCaption')).toContainText('Add at least two nodes');
  await page.locator('#sourceGenerated').click();
  await expect(page.locator('#generate')).toBeEnabled();
  await expect(page.locator('#newGamePreview')).toBeVisible();
});
