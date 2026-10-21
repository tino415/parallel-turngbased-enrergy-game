'use strict';

(() => {
  const POLL_MS = 4000;
  const SESSION_PREFIX = 'parallel-energy-online:';
  const NAME_KEY = 'parallel-energy-online-name';
  const MAP_FIELDS = {
    count: 'onlineNodeCount',
    players: 'onlinePlayerCount',
    density: 'onlineDensity',
    seed: 'onlineSeed',
  };
  const GONE = { 404: 'This match does not exist.', 410: 'The host cancelled this match.' };
  const matchId = new URLSearchParams(location.search).get('match');
  let view = null;
  let polling = null;
  let connectionLost = false;
  let panelOpen = false;
  let sentTurn = null;
  let indicators = [];

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
  const turnOf = ({ orders, policies, defaults }) => JSON.stringify({ orders, policies, defaults });

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

  function startPolling() {
    addIndicators();
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
      else if (view) renderTurnButtons();
    });
  }

  async function refresh() {
    try {
      apply(await api('GET', ''));
      connectionLost = false;
    } catch (error) {
      if (GONE[error.status]) return stopWith(GONE[error.status]);
      connectionLost = true;
    }
    renderOnline();
  }

  function apply(next) {
    if (view && next.revision < view.revision) return;
    const previous = view;
    view = next;
    const reloaded =
      !previous ||
      previous.round !== next.round ||
      previous.phase !== next.phase ||
      previous.you !== next.you ||
      (next.phase === 'lobby' && previous.revision !== next.revision);
    if (reloaded) loadMatch(next, !previous);
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
    sentTurn = submitted ? turnOf(store.getSnapshot().match) : null;
    if (first) store.setCamera({ x: 0, y: 0, scale: 1 });
    store.setView('map');
    render();
  }

  async function endTurn() {
    const { state, orders, policies, defaults } = store.getSnapshot().match;
    try {
      const next = await api('PUT', '/turn', { round: state.round, orders, policies, defaults });
      sentTurn = turnOf({ orders, policies, defaults });
      apply(next);
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

  const chosenMap = () =>
    Object.fromEntries(Object.entries(MAP_FIELDS).map(([key, id]) => [key, byId(id).value]));

  async function cancelMatch() {
    if (!confirm('Cancel this match for every player? It cannot be resumed.')) return;
    try {
      await api('DELETE', '');
      localStorage.removeItem(sessionKey(matchId));
      location.assign(location.pathname);
    } catch (error) {
      showMessage(error.message);
    }
  }

  async function leaveMatch() {
    const seated = view && view.you !== null && view.phase !== 'finished';
    if (
      seated &&
      view.phase === 'playing' &&
      !confirm('Leave the match? The AI takes over your colour.')
    )
      return;
    try {
      if (seated) {
        await api('POST', '/leave');
        localStorage.removeItem(sessionKey(matchId));
      }
      location.assign(location.pathname);
    } catch (error) {
      showMessage(error.message);
    }
  }

  function showPanel(open) {
    panelOpen = open;
    renderOnline();
  }

  function stopWith(text) {
    leaveOnline();
    byId('onlinePanel').hidden = false;
    byId('onlineLeave').hidden = false;
    for (const id of [
      'onlineSetup',
      'onlineWaiting',
      'onlineSeats',
      'onlineCancel',
      'onlineResolve',
      'onlineClose',
      'onlineStart',
    ])
      byId(id).hidden = true;
    showMessage(text);
  }

  function leaveOnline() {
    clearInterval(polling);
    view = null;
    for (const indicator of indicators) indicator.remove();
    indicators = [];
    byId('onlinePanel').hidden = true;
    byId('aiDebug').disabled = false;
    byId('resolve').textContent = 'Resolve round';
    byId('uxDockResolve').textContent = 'Resolve round →';
    for (const id of ['resolve', 'uxDockResolve']) byId(id).classList.add('primary');
  }

  function renderOnline() {
    if (!view) return;
    renderPanel();
    renderIndicators();
    renderTurnButtons();
    byId('aiDebug').disabled = true;
  }

  function renderPanel() {
    const lobby = view.phase === 'lobby';
    byId('onlinePanel').hidden = !lobby && !panelOpen;
    byId('onlineSetup').hidden = !lobby;
    byId('onlineWaiting').hidden = lobby;
    byId('onlineWaiting').textContent = statusText();
    byId('onlineSeats').hidden = false;
    if (lobby) renderSetup();
    renderSeats();
    byId('onlineStart').hidden = !lobby || !view.host;
    byId('onlineStart').disabled = !view.seats.some((seat) => seat.taken);
    byId('onlineResolve').hidden = !view.host || view.phase !== 'playing';
    byId('onlineCancel').hidden = !view.host || view.phase === 'finished';
    byId('onlineClose').hidden = lobby;
    byId('onlineLeave').hidden = view.host && view.phase !== 'finished';
  }

  function renderSetup() {
    byId('onlineLink').value = inviteLink(view.id);
    byId('onlineMap').disabled = !view.host;
    for (const [key, id] of Object.entries(MAP_FIELDS))
      if (document.activeElement !== byId(id)) byId(id).value = view.options[key];
    drawMapPreview(byId('onlinePreview'), view.map.xy, view.map.edges, view.state.nodes);
    byId('onlinePreviewCaption').textContent = mapCaption(view.options, view.map.edges.length);
  }

  function renderSeats() {
    byId('onlineSeats').replaceChildren(
      ...view.seats.map((seat) =>
        element(
          'li',
          { className: 'online-seat' + (seat.owner === view.you ? ' mine' : '') },
          swatch(seat.owner),
          element('span', { className: 'online-seat-name' }, GameEngine.playerName(seat.owner)),
          element('span', { className: 'online-seat-player' }, seatText(seat)),
          view.phase === 'lobby' && !seat.taken
            ? element('button', {
                type: 'button',
                textContent: 'Take',
                onclick: () => takeSeat(seat.owner),
              })
            : '',
        ),
      ),
    );
  }

  function seatText(seat) {
    if (!seat.taken) return view.phase === 'lobby' ? 'free · the AI plays it' : 'AI';
    const player = seat.name + (seat.owner === view.you ? ' (you)' : '');
    if (view.phase !== 'playing') return player;
    if (seat.submitted) return player + ' · turn ended ✓';
    return player + (view.waitingFor.includes(seat.owner) ? ' · deciding…' : ' · out');
  }

  function statusText() {
    if (connectionLost) return 'Connection lost, trying again…';
    if (view.phase === 'finished') return 'The match is over.';
    if (view.you === null) return 'You are watching this match.';
    if (!view.waitingFor.length) return 'Resolving the round…';
    const waiting = view.waitingFor.map((owner) => view.seats[owner].name);
    return 'Waiting for ' + waiting.join(', ');
  }

  function addIndicators() {
    indicators = ['onlineIndicator', 'uxDockOnline'].map((id) =>
      element('button', { id, type: 'button', className: 'online-indicator' }),
    );
    for (const indicator of indicators) indicator.onclick = () => showPanel(true);
    byId('resolve').before(indicators[0]);
    byId('uxDockResolve').before(indicators[1]);
  }

  function renderIndicators() {
    for (const indicator of indicators) {
      indicator.replaceChildren(
        element('span', { className: 'online-dot' + (connectionLost ? ' lost' : '') }),
        readiness(),
      );
      indicator.setAttribute('aria-label', 'Online match, ' + readiness());
    }
  }

  function readiness() {
    if (view.phase === 'lobby') return 'Lobby';
    if (view.phase === 'finished') return 'Over';
    const playing = view.humanSeats.filter((owner) =>
      view.state.nodes.some((node) => node.owner === owner),
    );
    return playing.length - view.waitingFor.length + '/' + playing.length;
  }

  function renderTurnButtons() {
    const { label, ready, disabled } = turnButton();
    byId('resolve').textContent = label;
    byId('uxDockResolve').textContent = ready ? label : label + ' →';
    for (const id of ['resolve', 'uxDockResolve']) {
      byId(id).disabled = disabled;
      byId(id).classList.toggle('primary', !ready);
    }
  }

  function turnButton() {
    if (view.phase !== 'playing' || view.you === null)
      return { label: 'End turn', ready: false, disabled: true };
    if (sentTurn === null) return { label: 'End turn', ready: false, disabled: false };
    if (sentTurn === turnOf(store.getSnapshot().match))
      return { label: 'Turn ended ✓', ready: true, disabled: true };
    return { label: 'Update turn', ready: false, disabled: false };
  }

  function showMessage(text) {
    byId('onlineMessage').textContent = text;
  }

  const element = (tag, attrs = {}, ...children) => {
    const node = Object.assign(document.createElement(tag), attrs);
    node.append(...children);
    return node;
  };
  const swatch = (owner) => {
    const dot = element('span', { className: 'online-swatch', textContent: '●' });
    dot.style.color = GameEngine.playerColor(owner);
    return dot;
  };

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
  for (const id of Object.values(MAP_FIELDS))
    byId(id).addEventListener('change', () => act('PUT', '/map', chosenMap()));
  byId('onlineStart').onclick = () => act('POST', '/start');
  byId('onlineResolve').onclick = () => {
    if (confirm('Resolve the round now, without the players who have not ended their turn?'))
      act('POST', '/resolve');
  };
  byId('onlineCancel').onclick = cancelMatch;
  byId('onlineClose').onclick = () => showPanel(false);
  byId('onlineLeave').onclick = leaveMatch;
  byId('onlineName').value = localStorage.getItem(NAME_KEY) ?? '';

  window.GameOnline = { endTurn };
  if (matchId) startPolling();
})();
