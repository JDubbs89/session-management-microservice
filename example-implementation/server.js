import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomInt, randomUUID } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { SessionApi } from './api.js';
import { MockApi } from './mock-api.js';
import { Game } from './game.js';
import { readToken, expiresAt, cookie, jsonBody } from './cookie-auth.js';

export function createTriviaServer(api, { origin = 'http://127.0.0.1:3000', cleanupRetryMs = 1000, cleanupMaxAttempts = 5, actionIntervalMs = 1100 } = {}) {
  const publicUrl = new URL(origin);
  const allowedOrigins = new Set([publicUrl.origin]);
  if (['localhost', '127.0.0.1', '[::1]'].includes(publicUrl.hostname)) {
    for (const hostname of ['localhost', '127.0.0.1', '[::1]']) {
      const alias = new URL(publicUrl);
      alias.hostname = hostname;
      allowedOrigins.add(alias.origin);
    }
  }
  const rooms = new Map();
  const reservations = new Set();
  const revoked = new Map();
  const pendingCleanup = new Map();
  let stopping = false;
  let shutdownPromise;
  function publicError(error) {
    if (error.status === 401) return 'Sign in again.';
    if (error.status === 429) return 'Too many requests. Wait a moment and try again.';
    if (error.status >= 500 || ['TimeoutError', 'AbortError'].includes(error.name)) return 'Game service unavailable. Try again.';
    return error.message;
  }
  async function retryCleanup(entry) {
    clearTimeout(entry.timer);
    if (entry.running) return entry.running;
    entry.running = (async () => {
      entry.attempts++;
      try {
        await api.deleteSession(entry.token, entry.code, entry.host);
        pendingCleanup.delete(entry.code);
      } catch (error) {
        if (error.status === 404) { pendingCleanup.delete(entry.code); return; }
        entry.error = error.status || 502;
        if (!stopping && entry.attempts < cleanupMaxAttempts && entry.expiry > Date.now()) {
          entry.timer = setTimeout(() => { void retryCleanup(entry); }, cleanupRetryMs * 2 ** (entry.attempts - 1));
          entry.timer.unref();
        }
      } finally { entry.running = null; }
    })();
    return entry.running;
  }
  const fail = (status, message) => Object.assign(new Error(message), { status });
  async function authenticate(token) {
    for (const [key, expiry] of revoked) if (expiry <= Date.now()) revoked.delete(key);
    if (!token || revoked.has(token)) throw fail(401, 'Sign in again.');
    let user;
    try { user = await api.me(token); }
    catch (error) {
      if (error.status === 401 || error.message === 'Unauthenticated') throw fail(401, 'Sign in again.');
      throw error;
    }
    const expiry = expiresAt(token);
    if (expiry <= Date.now() || revoked.has(token)) throw fail(401, 'Sign in again.');
    return { user, token, expiry };
  }
  async function auth(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/json');
    try {
      const path = req.url.slice(6);
      const methods = { me: 'GET', login: 'POST', register: 'POST', logout: 'POST', delete: 'DELETE' };
      if (!Object.hasOwn(methods, path)) throw fail(404, 'Not found.');
      if (req.method !== methods[path]) throw fail(405, 'Method not allowed.');
      if (req.method !== 'GET' && !allowedOrigins.has(req.headers.origin)) throw fail(403, 'Untrusted request origin.');
      if (path === 'login' || path === 'register') {
        const { username, password } = await jsonBody(req);
        if (typeof username !== 'string' || !/^[a-zA-Z0-9_]{3,24}$/.test(username) || typeof password !== 'string' || password.length < 8 || Buffer.byteLength(password) > 72)
          throw fail(400, 'Use a 3–24 character username and an 8–72 byte password.');
        if (path === 'register') await api.register({ user_id: randomUUID(), steam_id: randomUUID(), username, password });
        const session = await authenticate((await api.login(username, password)).access_token);
        res.setHeader('Set-Cookie', cookie(session.token, session.expiry, publicUrl.protocol === 'https:'));
        res.end(JSON.stringify({ user: session.user }));
        return;
      }
      const session = await authenticate(readToken(req));
      if (path === 'me') { res.end(JSON.stringify({ user: session.user })); return; }
      const peers = [...wss.clients].filter(ws => ws.user?.username === session.user.username);
      if (peers.some(ws => ws.busy)) throw fail(409, 'Wait for the current game action to finish.');
      for (const ws of peers) ws.busy = true;
      try {
        for (const ws of peers) await leave(ws);
        if (path === 'delete') await api.deleteMe(session.token); else await api.logout(session.token);
        revoked.set(session.token, session.expiry);
        for (const ws of peers) {
          revoked.set(ws.token, ws.expiry);
          ws.close(4001, 'Signed out');
        }
      } finally { for (const ws of peers) { ws.busy = false; if (ws.readyState === WebSocket.CLOSED) ws.cleanup(); } }
      res.setHeader('Set-Cookie', cookie('', 0, publicUrl.protocol === 'https:'));
      res.end(JSON.stringify({ user: null }));
    } catch (error) {
      const status = error.status || 502;
      if (status === 401) res.setHeader('Set-Cookie', cookie('', 0, publicUrl.protocol === 'https:'));
      res.writeHead(status).end(JSON.stringify({ error: status < 500 ? error.message : 'Authentication service unavailable. Try again.' }));
    }
  }
  const server = http.createServer(async (req, res) => {
    if (stopping) { res.writeHead(503).end('Server restarting. Reconnect shortly.'); return; }
    if (req.url.startsWith('/auth/')) { await auth(req, res); return; }
    const assets = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/styles.css': ['styles.css', 'text/css'] };
    const asset = Object.hasOwn(assets, req.url) ? assets[req.url] : null;
    if (!asset || !['GET', 'HEAD'].includes(req.method)) { res.writeHead(404).end(); return; }
    try {
      const body = await readFile(new URL(`./public/${asset[0]}`, import.meta.url));
      res.setHeader('Content-Type', `${asset[1]}; charset=utf-8`);
      res.setHeader('Cache-Control', 'no-store');
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch { res.writeHead(500).end('Unable to load the game.'); }
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 8192 });
  server.on('upgrade', async (req, socket, head) => {
    socket.on('error', () => {});
    if (stopping) { socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n'); return; }
    if (req.url !== '/play') { socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n'); return; }
    if (!allowedOrigins.has(req.headers.origin)) {
      console.warn('WebSocket origin rejected:', JSON.stringify(req.headers.origin), 'Allowed:', [...allowedOrigins].join(', '));
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      return;
    }
    let session;
    try {
      session = await authenticate(readToken(req));
      if (reservations.has(session.user.username) || [...wss.clients].some(ws => ws.user?.username === session.user.username && ws.readyState !== WebSocket.CLOSED))
        throw fail(409, 'User already connected');
      reservations.add(session.user.username);
      if (stopping) throw fail(503, 'Server restarting');
      if (!socket.destroyed) wss.handleUpgrade(req, socket, head, ws => {
        Object.assign(ws, session);
        wss.emit('connection', ws);
      });
    } catch (error) {
      const status = error.status === 401 ? '401 Unauthorized' : error.status === 409 ? '409 Conflict' : '503 Service Unavailable';
      socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
    } finally { if (session) reservations.delete(session.user.username); }
  });
  function send(ws, data) { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data)); }
  function broadcast(room) { for (const ws of wss.clients) if (ws.room === room) send(ws, { state: { ...room.game.snapshot(), hasAnswered: room.game.answers.has(ws.user?.username) } }); }
  async function publishCount(room) {
    if (room.closing) return;
    try {
      await api.update(room.token, room.game.code, {
        beacon_metadata: { ...room.metadata, player_count: room.game.players.size }
      });
    } catch (error) {
      for (const peer of wss.clients) if (peer.room === room)
        send(peer, { error: `Discovery update failed: ${publicError(error)}`, retryable: true });
    }
  }
  async function leave(ws) {
    const room = ws.room;
    if (!room) return;
    if (room.game.host === ws.user.username) {
      room.closing = true;
      let failure;
      try { await api.deleteSession(ws.token, room.game.code, ws.user.username); } catch (error) { failure = error; }
      rooms.delete(room.game.code);
      for (const peer of wss.clients) if (peer.room === room) { peer.room = null; send(peer, { state: null, notice: 'Host closed the room.' }); }
      ws.room = null;
      if (failure) {
        const entry = { code: room.game.code, host: ws.user.username, token: ws.token, expiry: ws.expiry, attempts: 0 };
        pendingCleanup.set(entry.code, entry);
        void retryCleanup(entry);
        throw failure;
      }
    } else {
      room.game.players.delete(ws.user.username); room.game.answers.delete(ws.user.username); ws.room = null;
      send(ws, { state: null, notice: 'You left the room.' });
      broadcast(room);
      await publishCount(room);
    }
  }
  wss.on('connection', ws => {
    ws.busy = false; ws.lastAction = 0;
    send(ws, { user: ws.user });
    const expiryTimer = setTimeout(() => ws.close(4001, 'Session expired'), Math.min(ws.expiry - Date.now(), 2147483647));
    expiryTimer.unref();
    ws.on('message', async raw => {
      let message;
      try { message = JSON.parse(raw); } catch { return send(ws, { error: 'Invalid request.' }); }
      if (ws.busy || Date.now() - ws.lastAction < actionIntervalMs || stopping) {
        send(ws, { error: stopping ? 'Server restarting. Reconnect shortly.' : ws.busy ? 'Previous action is still running.' : 'Wait one second between actions.', retryable: true });
        if (message.id !== undefined) send(ws, { done: message.id });
        return;
      }
      ws.lastAction = Date.now(); ws.busy = true;
      let requestId;
      try {
        const m = message;
        requestId = m.id;
        {
          if (Date.now() >= ws.expiry || revoked.has(ws.token)) { ws.close(4001, 'Session expired'); throw new Error('Sign in again.'); }
          if (m.action === 'host') {
            if (ws.room) throw new Error('Leave your room first');
            const cleanup = [...pendingCleanup.values()].find(entry => entry.host === ws.user.username);
            if (cleanup) {
              await retryCleanup(cleanup);
              if (pendingCleanup.has(cleanup.code)) throw fail(503, 'Previous room cleanup pending');
            }
            const code = randomInt(100000, 1000000);
            const metadata = { session_flavortext: 'Three-question trivia', player_count: 1, max_player_count: 4, session_start_time: new Date().toISOString(), host_username: ws.user.username, host_steam_id: '' };
            await api.create(ws.token, { session_code: code, host_username: ws.user.username, host_user_id: ws.user.user_id, host_steam_id: '', beacon_metadata: JSON.stringify(metadata), session_passcode: '', session_whitelist: '[]', session_blacklist: '[]', session_status: 'active', allow_join: 'public' }, metadata);
            const room = { game: new Game(ws.user.username, code), token: ws.token, metadata };
            room.game.join(ws.user.username); rooms.set(code, room); ws.room = room; broadcast(room);
          } else if (m.action === 'preview') {
            const data = m.host ? await api.previewHost(ws.token, m.host) : await api.previewCode(ws.token, Number(m.code));
            send(ws, { preview: data });
          } else if (m.action === 'join') {
            if (ws.room) throw new Error('Leave your room first');
            const session = await api.byHost(ws.token, String(m.host));
            const room = rooms.get(session.session_code);
            if (!room || room.closing) throw new Error('Room is not on this game server');
            room.game.join(ws.user.username); ws.room = room; broadcast(room);
            await publishCount(room);
          } else if (m.action === 'next') {
            const room = ws.room;
            if (!room || room.closing || room.game.host !== ws.user.username) throw new Error('Only the room host can advance');
            if (room.game.finished) throw new Error('Game finished');
            await api.update(ws.token, room.game.code, { beacon_metadata: { ...room.metadata, player_count: room.game.players.size }, allow_join: 'private', ...(room.game.round + 1 >= room.game.snapshot().totalQuestions ? {session_status: 'ended'} : {}) });
            room.game.next(ws.user.username); broadcast(room);

          } else if (m.action === 'answer') {
            if (!ws.room) throw new Error('Join a room first');
            ws.room.game.answer(ws.user.username, m.choice); broadcast(ws.room);
          } else if (m.action === 'leave') { await leave(ws); }
          else throw new Error('Unknown action');
        }
      } catch (error) { send(ws, { error: publicError(error), retryable: error.status !== 401 }); if (error.status === 401) ws.close(4001, 'Session expired'); }
      finally { if (requestId !== undefined) send(ws, { done: requestId }); ws.busy = false; if (ws.readyState === WebSocket.CLOSED) cleanup(); }
    });
    let cleaned = false;
    async function cleanup() {
      if (cleaned || ws.busy) return; cleaned = true;
      try { await leave(ws); } catch (error) { console.error(JSON.stringify({event: 'room_cleanup_pending', status: error.status || 502})); }
      clearTimeout(expiryTimer);
    }
    ws.cleanup = cleanup;
    ws.on('close', cleanup);
  });
  function shutdown({ deadlineMs = 5000 } = {}) {
    if (shutdownPromise) return shutdownPromise;
    stopping = true;
    shutdownPromise = (async () => {
      const stopped = new Promise(resolve => server.close(resolve));
      server.closeIdleConnections();
      const work = (async () => {
        // Let in-flight actions finish so a just-created room is also cleaned.
        const until = Date.now() + deadlineMs;
        while ([...wss.clients].some(ws => ws.busy) && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 10));
        await Promise.allSettled([...wss.clients].map(ws => leave(ws)));
        await Promise.allSettled([...pendingCleanup.values()].map(retryCleanup));
        for (const ws of wss.clients) ws.close(1012, 'Server restarting');
        await new Promise(resolve => wss.close(resolve));
        await stopped;
      })();
      let timer;
      await Promise.race([work, new Promise(resolve => { timer = setTimeout(resolve, deadlineMs); })]);
      clearTimeout(timer);
      for (const entry of pendingCleanup.values()) clearTimeout(entry.timer);
      for (const ws of wss.clients) ws.terminate();
      server.closeAllConnections();
      wss.close();
      return { pendingRooms: pendingCleanup.size };
    })();
    return shutdownPromise;
  }
  return { server, wss, rooms, pendingCleanup, shutdown };
}
if (process.argv[1] === new URL(import.meta.url).pathname) {
  const mock = process.env.TRIVIA_MOCK === '1';
  const api = mock ? new MockApi() : new SessionApi(process.env.SESSION_API_URL);
  await api.health();
  const port = Number(process.env.PORT || 3000);
  const { server, shutdown } = createTriviaServer(api, { origin: process.env.PUBLIC_ORIGIN || `http://127.0.0.1:${port}` });
  for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, async () => {
    const result = await shutdown();
    console.log(JSON.stringify({event: 'shutdown', ...result}));
    process.exit(0);
  });
  server.listen(port, process.env.HOST || '127.0.0.1', () => console.log(`Trivia: ${process.env.PUBLIC_ORIGIN || `http://127.0.0.1:${port}`} (${mock ? 'MOCK — no real API calls' : 'real API'})`));
}
