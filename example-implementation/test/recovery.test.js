import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { createTriviaServer } from '../server.js';
import { MockApi } from '../mock-api.js';
import { SessionApi } from '../api.js';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate) {
  const deadline = Date.now() + 3000;
  while (!predicate()) { if (Date.now() > deadline) throw new Error('Timed out'); await delay(5); }
}
async function fixture(options = {}) {
  const api = new MockApi();
  const app = createTriviaServer(api, {actionIntervalMs: 0, cleanupRetryMs: 10, ...options});
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  let id = 0;
  async function connect(username) {
    await api.register({username, password: 'password123', user_id: username});
    const {access_token} = await api.login(username, 'password123');
    const ws = new WebSocket(`ws://127.0.0.1:${app.server.address().port}/play`, {
      origin: 'http://127.0.0.1:3000', headers: {Cookie: `trivia_token=${access_token}`}
    });
    ws.messages = []; ws.on('message', raw => ws.messages.push(JSON.parse(raw)));
    await once(ws, 'open'); return ws;
  }
  async function action(ws, action) {
    const start = ws.messages.length, requestId = ++id;
    ws.send(JSON.stringify({...action, id: requestId}));
    await until(() => ws.messages.slice(start).some(m => m.done === requestId));
    return ws.messages.slice(start);
  }
  return {...app, api, connect, action};
}

test('disconnect cleanup retries unavailable API and frees persistent discovery', async () => {
  const app = await fixture();
  try {
    const host = await app.connect('host'); await app.action(host, {action: 'host'});
    const remove = app.api.deleteSession.bind(app.api); let attempts = 0;
    app.api.deleteSession = async (...args) => {
      if (++attempts < 3) throw Object.assign(new Error('Unavailable'), {status: 503});
      return remove(...args);
    };
    host.terminate();
    await until(() => attempts >= 3 && app.pendingCleanup.size === 0);
    assert.equal(app.rooms.size, 0); assert.equal(app.api.sessions.size, 0);
  } finally { await app.shutdown(); }
});

test('retryable create and advance failures acknowledge actions without changing game state', async () => {
  const app = await fixture();
  try {
    const host = await app.connect('host');
    const create = app.api.create.bind(app.api);
    app.api.create = async () => { throw Object.assign(new Error('private upstream detail'), {status: 503}); };
    const failed = await app.action(host, {action: 'host'});
    assert.match(failed.find(m => m.error).error, /unavailable.*Try again/);
    assert.equal(app.rooms.size, 0);
    app.api.create = create; await app.action(host, {action: 'host'});
    const update = app.api.update.bind(app.api);
    for (const status of [429, 504, 503]) {
      app.api.update = async () => { throw Object.assign(new Error('private upstream detail'), {status}); };
      const messages = await app.action(host, {action: 'next'});
      assert.equal(messages.find(m => m.error).retryable, true);
      assert.doesNotMatch(messages.find(m => m.error).error, /private upstream/);
      assert.equal([...app.rooms.values()][0].game.round, -1);
    }
    app.api.update = update; await app.action(host, {action: 'next'});
    assert.equal([...app.rooms.values()][0].game.round, 0);
  } finally { await app.shutdown(); }
});

test('revoked credentials close established websocket with reauthentication code', async () => {
  const app = await fixture();
  try {
    const host = await app.connect('host');
    app.api.create = async () => { throw Object.assign(new Error('revoked'), {status: 401}); };
    const closed = once(host, 'close');
    host.send(JSON.stringify({action:'host', id:1}));
    assert.equal((await closed)[0], 4001);
    assert.equal(host.messages.find(m => m.error).retryable, false);
  } finally { await app.shutdown(); }
});

test('shutdown drains rooms, closes sockets and is idempotent', async () => {
  const app = await fixture();
  const host = await app.connect('host'); await app.action(host, {action: 'host'});
  const closed = once(host, 'close');
  const first = app.shutdown({deadlineMs: 300});
  assert.equal(app.shutdown(), first);
  assert.equal((await closed)[0], 1012);
  assert.deepEqual(await first, {pendingRooms: 0});
  assert.equal(app.api.sessions.size, 0);
});

test('shutdown deadline bounds an unavailable cleanup dependency', async () => {
  const app = await fixture();
  const host = await app.connect('host'); await app.action(host, {action: 'host'});
  app.api.deleteSession = () => new Promise(() => {});
  const start = Date.now();
  await app.shutdown({deadlineMs: 30});
  assert.ok(Date.now() - start < 500);
  await until(() => host.readyState === WebSocket.CLOSED);
});

test('API timeout and network failures are bounded and isolated between principals', async () => {
  let started;
  const began = new Promise(resolve => { started = resolve; });
  const api = new SessionApi('http://example.invalid', async (url, options) => {
    if (options.headers.Authorization === 'Bearer slow') {
      started();
      return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), {once:true}));
    }
    return {ok:true, json: async () => ({status:'ok'})};
  }, {timeoutMs:30});
  const slow = assert.rejects(api.me('slow'), error => error.status === 504);
  await began;
  assert.deepEqual(await api.me('fast'), {status:'ok'});
  // AbortSignal timers are unref'd; retain a timer until the simulated request settles.
  await Promise.all([slow, delay(40)]);
  const unavailable = new SessionApi('http://example.invalid', async () => { throw new TypeError('fetch failed'); });
  await assert.rejects(unavailable.health(), error => error.status === 503);
});
