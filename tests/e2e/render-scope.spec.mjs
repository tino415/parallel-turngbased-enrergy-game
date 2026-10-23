import { test, expect, openNodeEditor, inspector } from './support/game.mjs';

async function markMapAndEditor(page) {
  await page.evaluate(() => {
    window.markedGraph = document.querySelector('#map > g');
    window.markedEditor = document.querySelector('#tacticalInspector .tactical-inspector-body');
  });
}

const mapWasRebuilt = (page) =>
  page.evaluate(() => document.querySelector('#map > g') !== window.markedGraph);
const editorWasRebuilt = (page) =>
  page.evaluate(
    () =>
      document.querySelector('#tacticalInspector .tactical-inspector-body') !== window.markedEditor,
  );
const cameraScale = (page) => page.evaluate(() => camera.scale);

test('zoom and fit move the camera without rebuilding the map', async ({ page }) => {
  await markMapAndEditor(page);
  const scale = await cameraScale(page);
  await page.locator('#zoomIn').click();
  const zoomed = await cameraScale(page);
  expect(zoomed).toBeGreaterThan(scale);
  await expect(page.locator('#map > g')).toHaveAttribute(
    'transform',
    new RegExp('scale\\(' + zoomed + '\\)'),
  );
  await page.locator('#fit').click();
  expect(await cameraScale(page)).not.toBe(zoomed);
  expect(await mapWasRebuilt(page)).toBe(false);
});

test('ctrl+wheel zoom keeps a typed policy draft and its focus', async ({ page }, testInfo) => {
  test.skip(testInfo.project.use.hasTouch === true, 'Ctrl+wheel is a desktop gesture.');
  await openNodeEditor(page);
  const percent = page.locator('#tacticalPolicyPercent');
  await percent.click();
  await percent.press('ControlOrMeta+a');
  await percent.pressSequentially('37');
  await markMapAndEditor(page);
  const scale = await cameraScale(page);
  const box = await page.locator('#map').boundingBox();
  await page.mouse.move(box.x + 20, box.y + box.height / 2);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -100);
  await page.keyboard.up('Control');
  await expect.poll(() => cameraScale(page)).toBeGreaterThan(scale);
  await expect(percent).toBeFocused();
  await expect(percent).toHaveValue('37');
  expect(await mapWasRebuilt(page)).toBe(false);
  expect(await editorWasRebuilt(page)).toBe(false);
});

test('a round resolved from the Messages tab shows on the map when it is shown again', async ({
  page,
}) => {
  await openNodeEditor(page);
  const percent = page.locator('#tacticalPolicyPercent');
  await percent.fill('45');
  await percent.blur();
  await inspector(page).getByRole('button', { name: 'Clear map selection' }).click();
  await page.locator('#messagesTab').click();
  await markMapAndEditor(page);
  await page.evaluate(() => resolve());
  await expect(page.locator('#score')).toContainText('Round 2');
  expect(await mapWasRebuilt(page)).toBe(false);
  await expect(page.locator('#log')).toContainText('Round 1');

  await page.locator('#mapTab').click();
  expect(await mapWasRebuilt(page)).toBe(true);
  const labels = await page.evaluate(() =>
    state.nodes.map((node) => [
      document.querySelector(`#map .node-hit[data-node="${node.id}"]`).getAttribute('fill'),
      GameEngine.playerColor(node.owner),
    ]),
  );
  for (const [shown, owner] of labels) expect(shown).toBe(owner);
});

test('a committed policy edit survives a reload after camera and view changes', async ({
  page,
}) => {
  await openNodeEditor(page);
  const percent = page.locator('#tacticalPolicyPercent');
  await percent.fill('52');
  await percent.blur();
  await page.locator('#zoomIn').click();
  await page.locator('#messagesTab').click();
  await page.locator('#mapTab').click();
  await page.reload();
  await openNodeEditor(page);
  await expect(page.locator('#tacticalPolicyPercent')).toHaveValue('52');
});
