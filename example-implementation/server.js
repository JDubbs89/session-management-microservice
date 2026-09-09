import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomInt, randomUUID } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { SessionApi } from './api.js';
import { MockApi } from './mock-api.js';
import { Game } from './game.js';

export function createTriviaServer(api, { origin = 'http://127.0.0.1:3000' } = {}) {
  const rooms = new Map();
  const reservations = new Set();
  const server = http.createServer(async (req, res) => {
    if (req.url !== '/') { res.writeHead(404).end(); return; }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(await readFile(new URL('./public/index.html', import.meta.url)));
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 8192 });
  server.on('upgrade', (req, socket, head) => {
    if (req.url !== '/play' || req.headers.origin !== origin) { socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws));
  });
  function send(ws, data) { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data)); }
  function broadcast(room) { for (const ws of wss.clients) if (ws.room === room) send(ws, { state: room.game.snapshot() }); }
  async function publishCount(room) {
    if (room.closing) return;
    try {
      await api.update(room.token, room.game.code, {
        beacon_metadata: { ...room.metadata, player_count: room.game.players.size }
      });
    } catch (error) {
      for (const peer of wss.clients) if (peer.room === room)
        send(peer, { error: `Discovery update failed: ${error.message}` });
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
      if (failure) throw failure;
    } else {
      room.game.players.delete(ws.user.username); room.game.answers.delete(ws.user.username); ws.room = null;
      send(ws, { state: null, notice: 'You left the room.' });
      broadcast(room);
      await publishCount(room);
    }
  }
  wss.on('connection', ws => {
    ws.busy = false; ws.lastAction = 0;
    send(ws, { notice: 'Connected. Register or sign in.' });
    ws.on('message', async raw => {
      if (ws.busy) return send(ws, { error: 'Previous action is still running.' });
      if (Date.now() - ws.lastAction < 1100) return send(ws, { error: 'Wait one second between actions.' });
      ws.lastAction = Date.now(); ws.busy = true;
      try {
        const m = JSON.parse(raw);
        if (m.action === 'login' || m.action === 'register') {
          if (ws.token) throw new Error('Sign out first');
          if (typeof m.username !== 'string' || !/^[a-zA-Z0-9_]{3,24}$/.test(m.username) || typeof m.password !== 'string' || m.password.length < 8 || Buffer.byteLength(m.password, 'utf8') > 72) throw new Error('Use a 3–24 character username and an 8–72 character password');
          if (reservations.has(m.username) || [...wss.clients].some(p => p.user?.username === m.username)) throw new Error('User already connected');
          reservations.add(m.username); ws.reserved = m.username;
          if (m.action === 'register') await api.register({ user_id: randomUUID(), steam_id: randomUUID(), username: m.username, password: m.password });
          ws.token = (await api.login(m.username, m.password)).access_token;
          ws.user = await api.me(ws.token);
          send(ws, { user: ws.user });
        } else {
          if (!ws.user) throw new Error('Sign in first');
          if (m.action === 'host') {
            if (ws.room) throw new Error('Leave your room first');
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
            await api.update(ws.token, room.game.code, { beacon_metadata: { ...room.metadata, player_count: room.game.players.size }, allow_join: 'private' });
            room.game.next(ws.user.username); broadcast(room);
            if (room.game.finished) await api.update(ws.token, room.game.code, { session_status: 'ended' });
          } else if (m.action === 'answer') {
            if (!ws.room) throw new Error('Join a room first');
            ws.room.game.answer(ws.user.username, m.choice); broadcast(ws.room);
          } else if (m.action === 'leave') { await leave(ws); }
          else if (m.action === 'logout' || m.action === 'delete_me') {
            await leave(ws);
            if (m.action === 'delete_me') await api.deleteMe(ws.token); else await api.logout(ws.token);
            ws.user = null; ws.token = null; send(ws, { user: null, notice: 'Signed out.' });
          } else throw new Error('Unknown action');
        }
      } catch (error) { send(ws, { error: error.message }); }
      finally { ws.busy = false; reservations.delete(ws.reserved); ws.reserved = null; if (ws.readyState === WebSocket.CLOSED) cleanup(); }
    });
    let cleaned = false;
    async function cleanup() {
      if (cleaned || ws.busy) return; cleaned = true;
      try { await leave(ws); } catch (error) { console.error('Room cleanup failed:', error.message); }
      try { if (ws.token) await api.logout(ws.token); } catch (error) { console.error('Logout failed:', error.message); }
    }
    ws.on('close', cleanup);
  });
  return { server, wss, rooms };
}
if (process.argv[1] === new URL(import.meta.url).pathname) {
  const mock = process.env.TRIVIA_MOCK === '1';
  const api = mock ? new MockApi() : new SessionApi(process.env.SESSION_API_URL);
  await api.health();
  const port = Number(process.env.PORT || 3000);
  const { server } = createTriviaServer(api, { origin: process.env.PUBLIC_ORIGIN || `http://127.0.0.1:${port}` });
  server.listen(port, '127.0.0.1', () => console.log(`Trivia: http://127.0.0.1:${port} (${mock ? 'MOCK — no real API calls' : 'real API'})`));
}
