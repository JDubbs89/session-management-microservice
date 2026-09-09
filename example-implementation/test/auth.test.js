import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { createTriviaServer } from '../server.js';
import { MockApi } from '../mock-api.js';

async function fixture(options) {
  const api = new MockApi();
  const app = createTriviaServer(api, options);
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const origin = options?.origin || 'http://localhost:3000';
  return {
    ...app, api,
    request(path, { cookie, body, method = 'GET', requestOrigin = origin } = {}) {
      return fetch(`${base}/auth/${path}`, { method, headers: {
        ...(requestOrigin ? { Origin: requestOrigin } : {}),
        ...(cookie ? { Cookie: cookie } : {}), 'Content-Type': 'application/json'
      }, ...(body ? { body: JSON.stringify(body) } : {}) });
    },
    socket(cookie) { return new WebSocket(base.replace('http:', 'ws:') + '/play', {origin, headers: cookie ? {Cookie: cookie} : {}}); },
    async close() {
      for (const ws of app.wss.clients) ws.terminate();
      await new Promise(resolve => app.wss.close(resolve));
      app.server.closeAllConnections();
      await new Promise(resolve => app.server.close(resolve));
    }
  };
}
async function register(app, username = 'alice') {
  const response = await app.request('register', {method: 'POST', body: {username, password: 'correct-password'}});
  assert.ok(response.ok, await response.clone().text());
  return { response, cookie: response.headers.get('set-cookie').split(';')[0] };
}
async function rejectedSocket(app, cookie) {
  const ws = app.socket(cookie);
  const [error] = await once(ws, 'error');
  assert.match(error.message, /401/);
}

test('HTTP cookie auth restores identity across reconnects and logout revokes socket access', async () => {
  const app = await fixture();
  try {
    const {response, cookie} = await register(app);
    assert.match(response.headers.get('set-cookie'), /HttpOnly/i);
    assert.match(response.headers.get('set-cookie'), /SameSite=Strict/i);
    assert.match(response.headers.get('set-cookie'), /Path=\//i);
    assert.doesNotMatch(await response.text(), /access_token|correct-password/);
    const ws = app.socket(cookie); await once(ws, 'open');
    ws.close(); await once(ws, 'close');
    const restored = await app.request('me', {cookie});
    assert.equal(restored.status, 200);
    assert.equal((await restored.json()).user.username, 'alice');
    const reconnected = app.socket(cookie); await once(reconnected, 'open');
    const closed = once(reconnected, 'close');
    const logout = await app.request('logout', {cookie, method: 'POST'});
    assert.ok(logout.ok);
    assert.match(logout.headers.get('set-cookie'), /Max-Age=0|Expires=Thu, 01 Jan 1970/i);
    await closed;
    assert.equal((await app.request('me', {cookie})).status, 401);
    await rejectedSocket(app, cookie);
    const login = await app.request('login', {method:'POST',body:{username:'alice',password:'correct-password'}});
    assert.ok(login.ok);
    assert.equal((await app.request('me', {cookie})).status, 401);
    await rejectedSocket(app, cookie);
  } finally { await app.close(); }
});

test('missing and tampered credentials fail HTTP and WebSocket authentication', async () => {
  const app = await fixture();
  try {
    for (const cookie of [undefined, 'trivia_token=tampered', 'trivia_token=%ZZ']) {
      assert.equal((await app.request('me', {cookie})).status, 401);
      await rejectedSocket(app, cookie);
    }
  } finally { await app.close(); }
});

test('auth mutations require a trusted origin and rejected logout leaves the session valid', async () => {
  const app = await fixture();
  try {
    const {cookie} = await register(app);
    for (const requestOrigin of ['http://evil.example', null]) {
      for (const [path, method] of [['register','POST'],['login','POST'],['logout','POST'],['delete','DELETE']]) {
        const response = await app.request(path,{method,cookie,requestOrigin,body:{username:'attacker',password:'password123'}});
        assert.equal(response.status,403);
      }
    }
    assert.equal((await app.request('me',{cookie})).status,200);
    assert.equal(app.api.users.size,1);
  } finally { await app.close(); }
});

test('account deletion closes hosted rooms and invalidates the cookie', async () => {
  const app = await fixture();
  try {
    const {cookie} = await register(app);
    const ws = app.socket(cookie); await once(ws,'open');
    const roomCreated = new Promise((resolve,reject) => ws.on('message',raw => {
      const message=JSON.parse(raw); if(message.error)reject(new Error(message.error)); if(message.state)resolve(message.state);
    }));
    ws.send(JSON.stringify({action:'host',id:1}));
    await roomCreated;
    assert.equal(app.rooms.size,1);
    const closed = once(ws,'close');
    assert.ok((await app.request('delete',{cookie,method:'DELETE'})).ok);
    await closed;
    assert.equal(app.rooms.size,0);
    assert.equal(app.api.sessions.size,0);
    assert.equal(app.api.users.size,0);
    assert.equal((await app.request('me',{cookie})).status,401);
  } finally { await app.close(); }
});

test('HTTPS public origins issue Secure cookies', async () => {
  const app = await fixture({origin:'https://trivia.example'});
  try { const {response}=await register(app); assert.match(response.headers.get('set-cookie'), /; Secure/i); }
  finally { await app.close(); }
});

test('expired and duplicate cookies are rejected and expired sockets close', async () => {
  const app = await fixture();
  try {
    const { cookie } = await register(app);
    const token = decodeURIComponent(cookie.split('=')[1]);
    assert.equal((await app.request('me', {cookie: cookie + '; ' + cookie})).status, 401);
    app.api.tokens.get(token).exp = Date.now() - 1;
    assert.equal((await app.request('me', {cookie})).status, 401);
    await rejectedSocket(app, cookie);

    const originalLogin = app.api.login.bind(app.api);
    app.api.login = async (...args) => {
      const result = await originalLogin(...args);
      const parts = result.access_token.split('.');
      parts[1] = Buffer.from(JSON.stringify({exp: (Date.now() + 200) / 1000})).toString('base64url');
      const shortToken = parts.join('.');
      app.api.tokens.set(shortToken, app.api.tokens.get(result.access_token));
      return {access_token: shortToken};
    };
    const response = await app.request('login', {method: 'POST', body: {username: 'alice', password: 'correct-password'}});
    const ws = app.socket(response.headers.get('set-cookie').split(';')[0]);
    await once(ws, 'open');
    const [code] = await once(ws, 'close');
    assert.equal(code, 4001);
  } finally { await app.close(); }
});

test('upstream outages do not clear valid cookies or expose upstream errors', async () => {
  const app = await fixture();
  try {
    const { cookie } = await register(app);
    app.api.me = async () => { throw new Error('secret upstream detail'); };
    const response = await app.request('me', {cookie});
    assert.equal(response.status, 502);
    assert.equal(response.headers.get('set-cookie'), null);
    assert.doesNotMatch(await response.text(), /secret upstream detail/);
  } finally { await app.close(); }
});
