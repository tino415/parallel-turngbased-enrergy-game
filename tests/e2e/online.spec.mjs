import { test, expect } from '@playwright/test';

const SECRET_INVEST = 7.77;
const SLOW = { timeout: 15000 };

const friendContext = (browser, project) => {
  const { viewport, userAgent, isMobile, hasTouch, deviceScaleFactor } = project.use;
  return browser.newContext({ viewport, userAgent, isMobile, hasTouch, deviceScaleFactor });
};

const endTurn = (page) => page.locator('#uxDockResolve:visible, #resolve:visible').first().click();
const round = (page) => page.evaluate(() => state.round);
const ownNodeId = (page) => page.evaluate(() => state.nodes.find((node) => isMine(node.id)).id);
const taking = (page, colour) =>
  page.locator('.online-seat', { hasText: colour }).getByRole('button', { name: 'Take' });

async function hostOnlineMatch(page) {
  await page.goto('/');
  await page.getByLabel('More actions').click();
  await page.getByRole('button', { name: 'New game' }).click();
  await page.locator('#nodeCount').fill('14');
  await page.getByRole('button', { name: 'New online match' }).click();
  await expect(page.locator('#onlineLobby')).toBeVisible(SLOW);
  return page.locator('#onlineLink').inputValue();
}

async function takeColour(page, name, colour) {
  await page.locator('#onlineName').fill(name);
  await taking(page, colour).click();
  await expect(page.locator('.online-seat.mine')).toContainText(name);
}

test('two browsers play two rounds of an online match', async ({ page, browser }, testInfo) => {
  page.on('dialog', (dialog) => dialog.accept());
  const link = await hostOnlineMatch(page);
  await takeColour(page, 'Hana', 'Blue');

  const friend = await (await friendContext(browser, testInfo.project)).newPage();
  await friend.goto(link);
  await expect(friend.locator('#onlineLobby')).toBeVisible(SLOW);
  await takeColour(friend, 'Ann', 'Red');
  await expect(page.locator('.online-seat', { hasText: 'Red' })).toContainText('Ann', SLOW);
  await testInfo.attach('lobby', { body: await page.screenshot(), contentType: 'image/png' });

  await page.getByRole('button', { name: 'Start match' }).click();
  await expect(friend.locator('#onlineStatus')).toBeVisible(SLOW);
  await expect(friend.locator('#onlineLobby')).toBeHidden();
  expect(await round(page)).toBe(1);

  await endTurn(page);
  await expect(page.locator('#onlineWaiting')).toContainText('Turn ended. Waiting for Ann');
  await expect(friend.locator('#onlineSeatChips')).toContainText('Hana ✓', SLOW);
  expect(await round(friend)).toBe(1);
  await endTurn(friend);
  await expect.poll(() => round(page), SLOW).toBe(2);
  await expect.poll(() => round(friend), SLOW).toBe(2);

  const secretNode = await ownNodeId(page);
  await page.evaluate(
    ([id, amount]) => store.setAllocation(id, 'invest', amount),
    [secretNode, SECRET_INVEST],
  );
  await endTurn(page);
  await expect(friend.locator('#onlineSeatChips')).toContainText('Hana ✓', SLOW);
  const whatFriendCanFetch = await friend.evaluate(async () => {
    const id = new URLSearchParams(location.search).get('match');
    const { token } = JSON.parse(localStorage.getItem('parallel-energy-online:' + id));
    const response = await fetch('/api/matches/' + id, {
      headers: { authorization: 'Bearer ' + token },
    });
    return response.text();
  });
  expect(whatFriendCanFetch).not.toContain(String(SECRET_INVEST));

  await endTurn(friend);
  await expect.poll(() => round(page), SLOW).toBe(3);
  await expect.poll(() => round(friend), SLOW).toBe(3);
  const states = await Promise.all([page, friend].map((p) => p.evaluate(() => state.nodes)));
  expect(states[0]).toEqual(states[1]);
  await testInfo.attach('round-3', { body: await page.screenshot(), contentType: 'image/png' });

  await friend.reload();
  await expect(friend.locator('#score')).toContainText('Red', SLOW);
  expect(await round(friend)).toBe(3);
});

test('the host resolves a round without a stuck player', async ({ page, browser }, testInfo) => {
  page.on('dialog', (dialog) => dialog.accept());
  const link = await hostOnlineMatch(page);
  await takeColour(page, 'Hana', 'Blue');
  const friend = await (await friendContext(browser, testInfo.project)).newPage();
  await friend.goto(link);
  await takeColour(friend, 'Ann', 'Red');
  await expect(page.locator('.online-seat', { hasText: 'Red' })).toContainText('Ann', SLOW);
  await page.getByRole('button', { name: 'Start match' }).click();
  await expect(page.locator('#onlineStatus')).toBeVisible(SLOW);

  await endTurn(page);
  await page.getByRole('button', { name: 'Resolve now' }).click();
  await expect.poll(() => round(page), SLOW).toBe(2);
  await expect(friend.getByRole('button', { name: 'Resolve now' })).toBeHidden();
  await expect.poll(() => round(friend), SLOW).toBe(2);
});

test('a link opened without a colour only watches once the match runs', async ({
  page,
  browser,
}, testInfo) => {
  page.on('dialog', (dialog) => dialog.accept());
  const link = await hostOnlineMatch(page);
  await takeColour(page, 'Hana', 'Blue');
  await page.getByRole('button', { name: 'Start match' }).click();
  await expect(page.locator('#onlineStatus')).toBeVisible(SLOW);

  const stranger = await (await friendContext(browser, testInfo.project)).newPage();
  await stranger.goto(link);
  await expect(stranger.locator('#onlineWaiting')).toContainText('watching', SLOW);
  await expect(stranger.locator('#resolve')).toBeDisabled();
});
