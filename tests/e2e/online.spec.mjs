import { test, expect } from '@playwright/test';

const SECRET_INVEST = 1.2345;
const SLOW = { timeout: 15000 };

const friendContext = (browser, project) => {
  const { viewport, userAgent, isMobile, hasTouch, deviceScaleFactor } = project.use;
  return browser.newContext({ viewport, userAgent, isMobile, hasTouch, deviceScaleFactor });
};

const endTurn = (page) => page.locator('#uxDockResolve:visible, #resolve:visible').first().click();
const turnButton = (page) => page.locator('#uxDockResolve:visible, #resolve:visible').first();
const indicator = (page) => page.locator('#uxDockOnline:visible, #onlineIndicator:visible').first();
const round = (page) => page.evaluate(() => state.round);
const ownNodeId = (page) => page.evaluate(() => state.nodes.find((node) => isMine(node.id)).id);
const serverView = (page) =>
  page.evaluate(async () => {
    const id = new URLSearchParams(location.search).get('match');
    const { token } = JSON.parse(localStorage.getItem('parallel-energy-online:' + id));
    const response = await fetch('/api/matches/' + id, {
      headers: { authorization: 'Bearer ' + token },
    });
    return response.text();
  });
const taking = (page, colour) =>
  page.locator('.online-seat', { hasText: colour }).getByRole('button', { name: 'Take' });

async function hostOnlineMatch(page) {
  await page.goto('/');
  await page.getByLabel('More actions').click();
  await page.getByRole('button', { name: 'New game' }).click();
  await page.locator('#nodeCount').fill('14');
  await page.getByRole('button', { name: 'New online match' }).click();
  await expect(page.locator('#onlinePanel')).toBeVisible(SLOW);
  return page.locator('#onlineLink').inputValue();
}

async function takeColour(page, name, colour) {
  await page.locator('#onlineName').fill(name);
  await taking(page, colour).click();
  await expect(page.locator('.online-seat.mine')).toContainText(name);
}

async function startWithFriend(page, browser, testInfo) {
  const link = await hostOnlineMatch(page);
  await takeColour(page, 'Hana', 'Blue');
  const friend = await (await friendContext(browser, testInfo.project)).newPage();
  friend.on('dialog', (dialog) => dialog.accept());
  await friend.goto(link);
  await expect(friend.locator('#onlinePanel')).toBeVisible(SLOW);
  await takeColour(friend, 'Ann', 'Red');
  await expect(page.locator('.online-seat', { hasText: 'Red' })).toContainText('Ann', SLOW);
  return friend;
}

test('two browsers play two rounds of an online match', async ({ page, browser }, testInfo) => {
  page.on('dialog', (dialog) => dialog.accept());
  const friend = await startWithFriend(page, browser, testInfo);
  await testInfo.attach('lobby', { body: await page.screenshot(), contentType: 'image/png' });

  await page.getByRole('button', { name: 'Start match' }).click();
  await expect(indicator(friend)).toContainText('0/2', SLOW);
  await expect(friend.locator('#onlinePanel')).toBeHidden();
  expect(await round(page)).toBe(1);

  await endTurn(page);
  await expect(turnButton(page)).toHaveText('Turn ended ✓');
  await expect(indicator(friend)).toContainText('1/2', SLOW);
  await indicator(page).click();
  await expect(page.locator('#onlineWaiting')).toHaveText(/^Waiting for Ann · 23:59:\d\d$/);
  await page.getByRole('button', { name: 'Close' }).click();
  expect(await round(friend)).toBe(1);
  await endTurn(friend);
  await expect.poll(() => round(page), SLOW).toBe(2);
  await expect.poll(() => round(friend), SLOW).toBe(2);
  await expect(turnButton(page)).toHaveText(/End turn/);

  const secretNode = await ownNodeId(page);
  await page.evaluate(
    ([id, amount]) => store.setAllocation(id, null, amount),
    [secretNode, SECRET_INVEST],
  );
  await endTurn(page);
  await expect(indicator(friend)).toContainText('1/2', SLOW);
  expect(await serverView(page)).toContain(String(SECRET_INVEST));
  expect(await serverView(friend)).not.toContain(String(SECRET_INVEST));

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

test('an order changed after ending the turn waits to be sent again', async ({
  page,
  browser,
}, testInfo) => {
  page.on('dialog', (dialog) => dialog.accept());
  await startWithFriend(page, browser, testInfo);
  await page.getByRole('button', { name: 'Start match' }).click();
  await expect(indicator(page)).toContainText('0/2', SLOW);

  await endTurn(page);
  await expect(turnButton(page)).toHaveText('Turn ended ✓');
  await expect(turnButton(page)).toBeDisabled();
  const node = await ownNodeId(page);
  await page.evaluate((id) => store.setAllocation(id, null, 1), node);
  await expect(turnButton(page)).toHaveText(/Update turn/);
  await endTurn(page);
  await expect(turnButton(page)).toHaveText('Turn ended ✓');
});

test('the lobby never scrolls sideways', async ({ page }) => {
  await hostOnlineMatch(page);
  const panel = page.locator('#onlinePanel');
  const overflow = await panel.evaluate((element) => element.scrollWidth - element.clientWidth);
  expect(overflow).toBe(0);
});

test('the host changes the map in the lobby and the friend sees it', async ({
  page,
  browser,
}, testInfo) => {
  page.on('dialog', (dialog) => dialog.accept());
  const friend = await startWithFriend(page, browser, testInfo);
  await expect(friend.locator('#onlineNodeCount')).toBeDisabled();

  await page.locator('#onlinePlayerCount').selectOption('2');
  await page.locator('#onlineNodeCount').fill('20');
  await page.locator('#onlineNodeCount').press('Enter');
  await expect(page.locator('#onlinePreviewCaption')).toContainText('20 nodes · 2 players');
  await expect(friend.locator('#onlinePreviewCaption')).toContainText('20 nodes', SLOW);
  await expect.poll(() => friend.evaluate(() => state.nodes.length), SLOW).toBe(20);
  await expect(friend.locator('.online-seat', { hasText: 'Red' })).toContainText('Ann (you)');
});

test('the host cancels the match and the friend is told', async ({ page, browser }, testInfo) => {
  page.on('dialog', (dialog) => dialog.accept());
  const friend = await startWithFriend(page, browser, testInfo);
  await expect(friend.getByRole('button', { name: 'Cancel match' })).toBeHidden();
  await page.getByRole('button', { name: 'Start match' }).click();
  await expect(indicator(page)).toContainText('0/2', SLOW);

  await indicator(page).click();
  await page.getByRole('button', { name: 'Cancel match' }).click();
  await expect(page).not.toHaveURL(/match=/, SLOW);
  await expect(friend.locator('#onlineMessage')).toHaveText('The host cancelled this match.', SLOW);
});

test('a friend who leaves hands their colour to the AI and nobody waits for them', async ({
  page,
  browser,
}, testInfo) => {
  page.on('dialog', (dialog) => dialog.accept());
  const friend = await startWithFriend(page, browser, testInfo);
  await page.getByRole('button', { name: 'Start match' }).click();
  await expect(indicator(page)).toContainText('0/2', SLOW);
  await indicator(page).click();
  await expect(page.getByRole('button', { name: 'Leave' })).toBeHidden();
  await page.getByRole('button', { name: 'Close' }).click();

  await indicator(friend).click(SLOW);
  await friend.getByRole('button', { name: 'Leave' }).click();
  await expect(friend).not.toHaveURL(/match=/, SLOW);
  await expect(indicator(page)).toContainText('0/1', SLOW);
  await endTurn(page);
  await expect.poll(() => round(page), SLOW).toBe(2);
  await indicator(page).click();
  await expect(page.locator('.online-seat', { hasText: 'Red' })).toContainText('AI');
});

test('the host resolves a round without a stuck player', async ({ page, browser }, testInfo) => {
  page.on('dialog', (dialog) => dialog.accept());
  const friend = await startWithFriend(page, browser, testInfo);
  await page.getByRole('button', { name: 'Start match' }).click();
  await expect(indicator(page)).toContainText('0/2', SLOW);

  await endTurn(page);
  await indicator(page).click();
  await page.getByRole('button', { name: 'Resolve now' }).click();
  await expect.poll(() => round(page), SLOW).toBe(2);
  await indicator(friend).click();
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
  await expect(indicator(page)).toContainText('0/1', SLOW);

  const stranger = await (await friendContext(browser, testInfo.project)).newPage();
  await stranger.goto(link);
  await indicator(stranger).click(SLOW);
  await expect(stranger.locator('#onlineWaiting')).toContainText('watching', SLOW);
  await expect(turnButton(stranger)).toBeDisabled();
});

test('nothing of the online match covers the map during play', async ({
  page,
  browser,
}, testInfo) => {
  page.on('dialog', (dialog) => dialog.accept());
  await startWithFriend(page, browser, testInfo);
  await page.getByRole('button', { name: 'Start match' }).click();
  await expect(indicator(page)).toContainText('0/2', SLOW);
  await expect(page.locator('#onlinePanel')).toBeHidden();
  const topLeftOfMap = await page.evaluate(() => {
    const box = document.getElementById('mapViewport').getBoundingClientRect();
    const clearance = parseFloat(
      getComputedStyle(document.body).getPropertyValue('--header-clearance'),
    );
    return (
      document.elementFromPoint(box.left + 30, box.top + clearance + 20).closest('#mapViewport') !==
      null
    );
  });
  expect(topLeftOfMap).toBe(true);
});

async function distanceFromMapCentre(page, id) {
  return page.evaluate((nodeId) => {
    const node = document.querySelector(`#map [data-node="${nodeId}"]`).getBoundingClientRect();
    const map = document.querySelector('#map').getBoundingClientRect();
    return Math.abs(node.x + node.width / 2 - (map.x + map.width / 2));
  }, id);
}

test('an online match centres each player on their own node and Focus finds it', async ({
  page,
  browser,
}, testInfo) => {
  page.on('dialog', (dialog) => dialog.accept());
  const friend = await startWithFriend(page, browser, testInfo);
  await page.getByRole('button', { name: 'Start match' }).click();
  await expect(indicator(friend)).toContainText('0/2', SLOW);

  for (const player of [page, friend]) {
    const own = await ownNodeId(player);
    expect(await distanceFromMapCentre(player, own)).toBeLessThan(40);
    await player.getByRole('button', { name: 'Fit' }).click();
    await player.getByRole('button', { name: 'Focus' }).click();
    expect(await distanceFromMapCentre(player, own)).toBeLessThan(40);
  }

  await friend.reload();
  await expect(friend.locator('#score')).toContainText('Red', SLOW);
  expect(await distanceFromMapCentre(friend, await ownNodeId(friend))).toBeLessThan(40);
});

test('the seat link continues the same colour on another device', async ({
  page,
  browser,
}, testInfo) => {
  page.on('dialog', (dialog) => dialog.accept());
  const link = await hostOnlineMatch(page);
  await takeColour(page, 'Hana', 'Blue');
  await page.getByRole('button', { name: 'Start match' }).click();
  await expect(indicator(page)).toContainText('0/1', SLOW);

  await page.getByLabel('More actions').click();
  await page.getByRole('button', { name: 'My seat link' }).click();
  const seatLink = await page.getByLabel('My seat link', { exact: true }).inputValue();
  expect(seatLink).toContain(new URL(link).search + '#seat=');

  const phone = await (await friendContext(browser, testInfo.project)).newPage();
  await phone.goto(seatLink);
  await expect(turnButton(phone)).toBeEnabled(SLOW);
  await expect.poll(() => phone.evaluate(() => location.hash)).toBe('');
  expect(await phone.evaluate(() => state.nodes.some((node) => isMine(node.id)))).toBe(true);

  await endTurn(phone);
  await expect.poll(() => round(page), SLOW).toBe(2);
});

test('the host frees a colour and a second device takes it from the link', async ({
  page,
  browser,
}, testInfo) => {
  page.on('dialog', (dialog) => dialog.accept());
  const friend = await startWithFriend(page, browser, testInfo);
  const host = (colour) => page.locator('.online-seat', { hasText: colour });
  await host('Red').getByRole('button', { name: 'Free' }).click();
  await expect(host('Red')).toContainText('free', SLOW);
  await expect(friend.locator('.online-seat.mine')).toHaveCount(0, SLOW);

  const link = new URL(friend.url());
  const newcomer = await (await friendContext(browser, testInfo.project)).newPage();
  await newcomer.goto(link.origin + link.pathname + link.search);
  await expect(newcomer.locator('#onlinePanel')).toBeVisible(SLOW);
  await takeColour(newcomer, 'Bob', 'Red');
  await expect(host('Red')).toContainText('Bob', SLOW);
});

test('the host hands a colour to the AI during play and nobody waits for it', async ({
  page,
  browser,
}, testInfo) => {
  page.on('dialog', (dialog) => dialog.accept());
  await startWithFriend(page, browser, testInfo);
  await page.getByRole('button', { name: 'Start match' }).click();
  await expect(indicator(page)).toContainText('0/2', SLOW);
  await indicator(page).click();
  await page
    .locator('.online-seat', { hasText: 'Red' })
    .getByRole('button', { name: 'To AI' })
    .click();
  await expect(page.locator('.online-seat', { hasText: 'Red' })).toContainText('closed', SLOW);
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(indicator(page)).toContainText('0/1', SLOW);
  await endTurn(page);
  await expect.poll(() => round(page), SLOW).toBe(2);
});

async function hostTimedMatch(page, turnTime) {
  await page.goto('/');
  const link = await page.evaluate(async (seconds) => {
    const response = await fetch('/api/matches', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ count: 14, players: 2, turnTime: seconds }),
    });
    const { id, token } = await response.json();
    localStorage.setItem('parallel-energy-online:' + id, JSON.stringify({ token }));
    return location.origin + location.pathname + '?match=' + id;
  }, turnTime);
  await page.goto(link);
  await expect(page.locator('#onlinePanel')).toBeVisible(SLOW);
  return link;
}

test('the round resolves when the turn timer runs out and the screens count down', async ({
  page,
  browser,
}, testInfo) => {
  page.on('dialog', (dialog) => dialog.accept());
  const link = await hostTimedMatch(page, 6);
  await takeColour(page, 'Hana', 'Blue');
  const friend = await (await friendContext(browser, testInfo.project)).newPage();
  await friend.goto(link);
  await expect(friend.locator('#onlinePanel')).toBeVisible(SLOW);
  await takeColour(friend, 'Ann', 'Red');
  await expect(page.locator('.online-seat', { hasText: 'Red' })).toContainText('Ann', SLOW);

  await page.getByRole('button', { name: 'Start match' }).click();
  await expect(indicator(friend)).toContainText(/0\/2 · 0:0\d/, SLOW);
  await expect(indicator(page)).toContainText(/0\/2 · 0:0\d/, SLOW);
  expect(await round(friend)).toBe(1);

  await endTurn(page);
  await expect.poll(() => round(friend), SLOW).toBe(2);
  await expect.poll(() => round(page), SLOW).toBe(2);
  await expect(turnButton(friend)).toHaveText(/End turn/);
});
