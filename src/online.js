'use strict';

(() => {
  const POLL_MS = 4000;
  const SESSION_PREFIX = 'parallel-energy-online:';
  const NAME_KEY = 'parallel-energy-online-name';
  const matchId = new URLSearchParams(location.search).get('match');
  let view = null;
  let polling = null;
  let connectionLost = false;

  const byId = (id) => document.getElementById(id);
  const sessionKey = (id) => SESSION_PREFIX + id;
  const readToken = (id) => {
    try {
      return JSON.parse(localStorage.getItem(sessionKey(id)))?.token ?? null;
    } catch {
      return null;
    }
  };
  const writeToken = (id, token) => localStorage.setItem(sessionKey(id), JSON.stringify({ token }));
  const inviteLink = (id) => location.origin + location.pathname + '?match=' + id;

  async function api(method, path, body, id = matchId) {
    const token = readToken(id);
    const response = await fetch('/api/matches' + (id ? '/' + id : '') + path, {
      method,
      cache: 'no-store',
      headers: {
        ...(token ? { authorization: 'Bearer ' + token } : {}),
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok)
      throw Object.assign(new Error(result.error ?? 'Request failed'), { status: response.status });
    return result;
  }

  async function createOnlineMatch() {
    const { id, token } = await api('POST', '', mapOptions(), '');
    writeToken(id, token);
    location.assign(inviteLink(id));
  }

  function showMessage(text) {
    byId('onlineMessage').textContent = text;
  }

  async function refresh() {
    try {
      apply(await api('GET', ''));
      connectionLost = false;
    } catch (error) {
      if (error.status === 404) return stopWith('This match does not exist.');
      connectionLost = true;
    }
    renderOnline();
  }

  function stopWith(text) {
    clearInterval(polling);
    byId('onlineLobby').hidden = false;
    showMessage(text);
  }

  function apply(next) {
    const previous = view;
    view = next;
    const changedHands =
      !previous ||
      previous.round !== next.round ||
      previous.phase !== next.phase ||
      previous.you !== next.you;
    if (changedHands) loadMatch(next, !previous);
  }

  function loadMatch(next, first) {
    const submitted = next.submission;
    store.select(null);
    store.replaceMatch({
      state: next.state,
      orders: submitted?.orders ?? {},
      policies: { ...next.policies, ...submitted?.policies },
      history: next.history,
      map: next.map,
      defaults: domDefaults(),
      seat: next.you ?? 0,
      humanSeats: next.humanSeats,
      replay: next.replay,
      online: { id: next.id },
    });
    if (first) store.setCamera({ x: 0, y: 0, scale: 1 });
    store.setView('map');
    render();
  }

  async function endTurn() {
    const { state, orders, policies, defaults } = store.getSnapshot().match;
    try {
      apply(await api('PUT', '/turn', { round: state.round, orders, policies, defaults }));
    } catch (error) {
      await refresh();
      showMessage(error.message);
    }
    renderOnline();
  }

  async function act(method, path, body) {
    try {
      apply(await api(method, path, body));
      showMessage('');
    } catch (error) {
      showMessage(error.message);
    }
    renderOnline();
  }

  async function takeSeat(owner) {
    const name = byId('onlineName').value.trim();
    if (!name) return showMessage('Type a name first.');
    localStorage.setItem(NAME_KEY, name);
    try {
      const result = await api('POST', '/seats/' + owner, { name });
      if (result.token) writeToken(matchId, result.token);
      apply(result.view);
      showMessage('');
    } catch (error) {
      showMessage(error.message);
    }
    renderOnline();
  }

  const seatName = (seat) => seat.name ?? 'AI';
  const element = (tag, attrs = {}, ...children) => {
    const node = Object.assign(document.createElement(tag), attrs);
    node.append(...children);
    return node;
  };
  const swatch = (owner) => {
    const dot = element('span', { className: 'online-swatch', textContent: '\u25CF' });
    dot.style.color = GameEngine.playerColor(owner);
    return dot;
  };

  function renderLobby() {
    byId('onlineLobby').hidden = view.phase !== 'lobby';
    if (view.phase !== 'lobby') return;
    byId('onlineLink').value = inviteLink(view.id);
    byId('onlineStart').hidden = !view.host;
    byId('onlineStart').disabled = !view.seats.some((seat) => seat.taken);
    byId('onlineSeats').replaceChildren(
      ...view.seats.map((seat) =>
        element(
          'li',
          { className: 'online-seat' + (seat.owner === view.you ? ' mine' : '') },
          swatch(seat.owner),
          element('span', { className: 'online-seat-name' }, GameEngine.playerName(seat.owner)),
          element(
            'span',
            { className: 'online-seat-player' },
            seat.taken
              ? seat.name + (seat.owner === view.you ? ' (you)' : '')
              : 'free · the AI plays it',
          ),
          seat.owner === view.you || seat.taken
            ? ''
            : element('button', {
                type: 'button',
                textContent: 'Take',
                onclick: () => takeSeat(seat.owner),
              }),
        ),
      ),
    );
  }

  function statusText() {
    if (connectionLost) return 'Connection lost, trying again…';
    if (view.phase === 'finished') return 'The match is over.';
    if (view.you === null) return 'You are watching this match.';
    const waiting = view.waitingFor.map((owner) => seatName(view.seats[owner]));
    if (!view.waitingFor.length) return 'Resolving the round…';
    const submitted = view.seats[view.you].submitted;
    return (submitted ? 'Turn ended. ' : '') + 'Waiting for ' + waiting.join(', ');
  }

  function renderStatus() {
    const bar = byId('onlineStatus');
    bar.hidden = view?.phase === 'lobby' || !view;
    if (bar.hidden) return;
    byId('onlineSeatChips').replaceChildren(
      ...view.seats
        .filter((seat) => seat.taken)
        .map((seat) =>
          element(
            'span',
            { className: 'online-chip' + (seat.submitted ? ' ready' : '') },
            swatch(seat.owner),
            seat.name + (seat.submitted ? ' ✓' : ''),
          ),
        ),
    );
    byId('onlineWaiting').textContent = statusText();
    byId('onlineResolve').hidden = !view.host || view.phase !== 'playing';
  }

  function renderTurnButtons() {
    const submitted = Boolean(view?.submission);
    const label = submitted ? 'Update turn' : 'End turn';
    byId('resolve').textContent = label;
    byId('uxDockResolve').textContent = label + ' →';
    const blocked = view.phase !== 'playing' || view.you === null;
    byId('resolve').disabled = blocked;
    byId('uxDockResolve').disabled = blocked;
  }

  function renderOnline() {
    if (!view) return;
    renderLobby();
    renderStatus();
    renderTurnButtons();
    byId('aiDebug').disabled = true;
  }

  function startPolling() {
    refresh();
    polling = setInterval(() => {
      if (document.visibilityState === 'visible' && view?.phase !== 'finished') refresh();
    }, POLL_MS);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') refresh();
    });
    window.addEventListener('online', refresh);
    store.subscribe(({ match }, previous) => {
      if (previous.match.online && !match.online) leaveOnline();
    });
  }

  function leaveOnline() {
    clearInterval(polling);
    view = null;
    byId('onlineLobby').hidden = true;
    byId('onlineStatus').hidden = true;
    byId('aiDebug').disabled = false;
    byId('resolve').textContent = 'Resolve round';
    byId('uxDockResolve').textContent = 'Resolve round →';
  }

  const previousRender = render;
  render = function () {
    previousRender();
    renderOnline();
  };

  byId('generateOnline').onclick = () =>
    createOnlineMatch().catch((error) => alert('Could not create the match: ' + error.message));
  byId('onlineCopy').onclick = () => {
    byId('onlineLink').select();
    navigator.clipboard?.writeText(byId('onlineLink').value);
    showMessage('Link copied.');
  };
  byId('onlineStart').onclick = () => act('POST', '/start');
  byId('onlineResolve').onclick = () => {
    if (confirm('Resolve the round now, without the players who have not ended their turn?'))
      act('POST', '/resolve');
  };
  byId('onlineLeave').onclick = () => location.assign(location.pathname);
  byId('onlineName').value = localStorage.getItem(NAME_KEY) ?? '';

  window.GameOnline = { endTurn };
  if (matchId) startPolling();
})();
