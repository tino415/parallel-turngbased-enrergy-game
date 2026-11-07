import { test, expect, isMobileLayout } from './support/game.mjs';

const editorNodes = (page) => page.locator('#map .map-editor-node');

async function openEditorFromMenu(page) {
  await page.getByLabel('More actions').click();
  await page.locator('#menuMapEditor').click();
  await expect(page.locator('#mapEditorBar')).toBeVisible();
}

async function clientPoint(page, x, y) {
  return page.evaluate(
    ([x, y]) => {
      const svg = document.getElementById('map');
      const point = new DOMPoint(
        camera.x + x * camera.scale,
        camera.y + y * camera.scale,
      ).matrixTransform(svg.getScreenCTM());
      return { x: point.x, y: point.y };
    },
    [x, y],
  );
}

async function clickCanvasAt(page, x, y) {
  const { x: clientX, y: clientY } = await clientPoint(page, x, y);
  await page.mouse.click(clientX, clientY);
}

test('the ☰ menu opens the running match in the editor and Close returns to it', async ({
  page,
}, testInfo) => {
  await openEditorFromMenu(page);
  await expect(editorNodes(page)).toHaveCount(14);
  await expect(page.locator('#map .node-hit')).toHaveCount(0);
  await expect(page.locator('#mapEditorName')).toHaveValue('classic');
  await expect(page.locator('#mapEditorStatus')).toHaveText('14 nodes · 2 players');
  await expect(page.locator('#mapEditorPlay')).toBeEnabled();
  await expect(page.locator('#resolve')).toBeHidden();
  await expect(page.locator('#uxDockResolve')).toBeHidden();
  await page.locator('#mapEditorClose').click();
  await expect(page.locator('#mapEditorBar')).toBeHidden();
  await expect(page.locator('#map .node-hit')).toHaveCount(14);
  await expect(
    page.locator(isMobileLayout(testInfo) ? '#uxDockResolve' : '#resolve'),
  ).toBeVisible();
});

test('New game offers to edit the map its settings would generate', async ({ page }) => {
  await page.getByLabel('More actions').click();
  await page.getByRole('button', { name: 'New game' }).click();
  await page.locator('#seed').fill('islands');
  await page.locator('#editGeneratedMap').click();
  await expect(page.locator('#newGameDialog')).toBeHidden();
  await expect(page.locator('#mapEditorName')).toHaveValue('islands');
  await expect(editorNodes(page)).toHaveCount(30);
  await expect(page.locator('#mapEditorHead')).toContainText('islands');
});

test('nodes are added, connected, coloured and played', async ({ page }) => {
  await openEditorFromMenu(page);
  const before = await page.evaluate(() => state.nodes.length);
  await page.locator('[data-tool="node"]').click();
  await clickCanvasAt(page, 1400, 150);
  await clickCanvasAt(page, 1700, 150);
  await expect(editorNodes(page)).toHaveCount(before + 2);
  await expect(page.locator('#mapEditorInspector')).toContainText('Node ' + (before + 1));
  await expect(page.locator('#mapEditorIssuesToggle')).toHaveText('⚠ 1 issue');
  await expect(page.locator('#mapEditorIssuesList')).toContainText(
    'Nodes ' + before + ', ' + (before + 1) + ' cannot be reached',
  );
  await expect(page.locator('#mapEditorPlay')).toBeDisabled();

  await page.locator('[data-tool="link"]').click();
  await page.locator(`.editor-node[data-node="${before}"]`).click();
  await expect(page.locator('#mapEditorHint')).toContainText('second node');
  await page.locator(`.editor-node[data-node="${before + 1}"]`).click();
  await page.locator(`.editor-node[data-node="${before + 1}"]`).click();
  await page.locator('.editor-node[data-node="0"]').click();
  await expect(page.locator('#mapEditorIssuesToggle')).toHaveText(/✓ Ready/);
  await expect(page.locator('.map-editor-link-hit')).toHaveCount(
    (await page.evaluate(() => edges.length)) + 2,
  );

  await page.locator('[data-tool="owner"]').click();
  await page.locator(`.editor-node[data-node="${before}"]`).click();
  await expect(page.locator(`.editor-node[data-node="${before}"]`)).toHaveAttribute(
    'aria-label',
    /Blue/,
  );
  await expect(page.locator('#mapEditorStatus')).toContainText('· edited');

  await page.locator('#mapEditorPlay').click();
  await expect(page.locator('#mapEditorBar')).toBeHidden();
  await expect(page.locator('#map .node-hit')).toHaveCount(before + 2);
  expect(await page.evaluate(() => state.nodes[state.nodes.length - 2].owner)).toBe(0);
  expect(await page.evaluate(() => state.round)).toBe(1);
});

test('Delete removes the selected node and Ctrl+Z brings it back', async ({ page }) => {
  await openEditorFromMenu(page);
  await page.locator('.editor-node[data-node="5"]').click();
  await expect(page.locator('#mapEditorInspector')).toContainText('Node 5');
  await page.locator('#mapEditorInspector button[data-key="delete"]').click();
  await expect(editorNodes(page)).toHaveCount(13);
  await expect(page.locator('#mapEditorInspector')).toBeHidden();
  await page.keyboard.press('Control+z');
  await expect(editorNodes(page)).toHaveCount(14);
  await expect(page.locator('#mapEditorUndo')).toBeDisabled();
  await expect(page.locator('#mapEditorRedo')).toBeEnabled();
});

test('the selected node is recoloured and renamed from the panel', async ({ page }) => {
  await openEditorFromMenu(page);
  await page.locator('.editor-node[data-node="7"]').click();
  await page.locator('#mapEditorInspector button[data-key="owner-2"]').click();
  await expect(page.locator('.editor-node[data-node="7"]')).toHaveAttribute('fill', '#b18adc');
  await page.locator('#mapEditorName').fill('Islands');
  await page.locator('#mapEditorName').press('Enter');
  await expect(page.locator('#mapEditorHead')).toHaveText('Map editor · Islands');
});

test('closing with unsaved edits asks first', async ({ page }) => {
  await openEditorFromMenu(page);
  await page.locator('[data-tool="erase"]').click();
  await page.locator('.editor-node[data-node="3"]').click();
  await expect(editorNodes(page)).toHaveCount(13);
  const messages = [];
  page.on('dialog', (dialog) => messages.push(dialog.message()));
  await page.locator('#mapEditorClose').click();
  expect(messages).toEqual(['Leave the map editor? The changes to this map are not kept.']);
  await expect(page.locator('#map .node-hit')).toHaveCount(14);
});

test('the editor keeps the game keyboard shortcuts out', async ({ page }) => {
  await openEditorFromMenu(page);
  await page.locator('[data-tool="erase"]').click();
  await page.keyboard.press('v');
  await expect(page.locator('[data-tool="select"]')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('l');
  await expect(page.locator('#mapEditorBar')).toBeVisible();
  await expect(page.locator('#leaderboardView')).toBeHidden();
});
