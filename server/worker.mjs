import { DurableObject } from 'cloudflare:workers';
import {
  Refusal,
  cancelMatch,
  changeMap,
  claimSeat,
  createMatch,
  forceResolve,
  leaveMatch,
  startMatch,
  submitTurn,
  viewFor,
} from './match.mjs';

const MATCH_ID = /^[a-z2-9]{10}$/;
const ID_LETTERS = 'abcdefghjkmnpqrstuvwxyz23456789';
const IDLE_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === '/api/matches' && request.method === 'POST')
      return createOnNewObject(request, env);
    const [, api, matches, id, ...rest] = pathname.split('/');
    if (api !== 'api' || matches !== 'matches' || !MATCH_ID.test(id ?? '')) return notFound();
    return matchObject(env, id).fetch(forwarded(request, '/' + rest.join('/')));
  },
};

export class Match extends DurableObject {
  async fetch(request) {
    const tokenHash = await hashOf(bearerOf(request));
    const { pathname, searchParams } = new URL(request.url);
    try {
      if (pathname === '/create')
        return await this.create(request, searchParams.get('id'), tokenHash);
      const record = await this.ctx.storage.get('record');
      if (!record) return notFound();
      if (record.cancelled) return json({ error: 'The host cancelled this match' }, 410);
      return await this.handle(request, pathname, record, tokenHash);
    } catch (error) {
      if (error instanceof Refusal) return json({ error: error.message }, error.status);
      throw error;
    }
  }

  async create(request, id, tokenHash) {
    if (await this.ctx.storage.get('record')) throw new Refusal(409, 'Match exists');
    const token = newToken();
    const record = createMatch({
      id,
      options: await request.json().catch(() => ({})),
      hostTokenHash: await hashOf(token),
      random: randomUnit,
    });
    await this.keep(record);
    return json({ id, token, view: viewFor(record, record.hostTokenHash) }, 201);
  }

  async handle(request, pathname, record, tokenHash) {
    const route = `${request.method} ${pathname.replace(/\/\d+$/, '/:owner')}`;
    if (route === 'GET /') return json(viewFor(record, tokenHash));
    if (route === 'DELETE /') return this.cancel(record, tokenHash);
    const body = request.method === 'GET' ? {} : await request.json().catch(() => ({}));
    if (route === 'POST /seats/:owner') return this.claim(record, tokenHash, pathname, body);
    const change = {
      'PUT /map': () => changeMap(record, { tokenHash, options: body, random: randomUnit }),
      'POST /start': () => startMatch(record, { tokenHash }),
      'PUT /turn': () => submitTurn(record, { tokenHash, ...body }),
      'POST /resolve': () => forceResolve(record, { tokenHash }),
      'POST /leave': () => leaveMatch(record, { tokenHash }),
    }[route];
    if (!change) return notFound();
    return this.saved(change(), tokenHash);
  }

  async claim(record, tokenHash, pathname, { name }) {
    const owner = Number(pathname.split('/').pop());
    const known = tokenHash && viewFor(record, tokenHash);
    const token = known && (known.host || known.you !== null) ? null : newToken();
    const claimingHash = token ? await hashOf(token) : tokenHash;
    const next = claimSeat(record, { owner, name, tokenHash: claimingHash });
    await this.keep(next);
    return json({ token, view: viewFor(next, claimingHash) });
  }

  async cancel(record, tokenHash) {
    await this.keep(cancelMatch(record, { tokenHash }));
    return new Response(null, { status: 204 });
  }

  async saved(record, tokenHash) {
    await this.keep(record);
    return json(viewFor(record, tokenHash));
  }

  async keep(record) {
    await this.ctx.storage.put('record', record);
    await this.ctx.storage.setAlarm(Date.now() + IDLE_LIFETIME_MS);
  }

  async alarm() {
    await this.ctx.storage.deleteAll();
  }
}

function createOnNewObject(request, env) {
  const id = newMatchId();
  return matchObject(env, id).fetch(
    new Request(`https://match/create?id=${id}`, { method: 'POST', body: request.body }),
  );
}

const matchObject = (env, id) => env.MATCHES.get(env.MATCHES.idFromName(id));

const forwarded = (request, path) =>
  new Request('https://match' + path, {
    method: request.method,
    headers: request.headers,
    body: request.method === 'GET' ? undefined : request.body,
  });

const bearerOf = (request) => request.headers.get('authorization')?.replace(/^Bearer /, '') || null;

async function hashOf(token) {
  if (!token) return null;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

const randomBytes = (length) => crypto.getRandomValues(new Uint8Array(length));
const newToken = () =>
  [...randomBytes(16)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
const newMatchId = () =>
  [...randomBytes(10)].map((byte) => ID_LETTERS[byte % ID_LETTERS.length]).join('');
const randomUnit = () => crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32;

const notFound = () => json({ error: 'Not found' }, 404);
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
