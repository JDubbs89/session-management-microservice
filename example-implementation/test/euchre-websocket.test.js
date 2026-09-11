import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';
import { createEuchreServer } from '../euchre-server.js';
import { MockApi } from '../mock-api.js';
import { EuchreApi } from '../euchre-api.js';
import { SessionApi } from '../api.js';
import { suits } from '../euchre.js';
const live = process.env.EUCHRE_LIVE_TEST === '1';
for (const humans of live ? [1, 2] : [1, 2, 3, 4]) test(`Euchre websocket (${humans} humans): private hands, full game, replay and room cleanup`, {timeout: 240000}, async () => {
  let api = new MockApi();
  if (live) {
    const bootstrap = new SessionApi(process.env.SESSION_API_URL);
    const admin = (await bootstrap.login(process.env.DIRECTORY_ADMIN_USERNAME || 'directory-demo-admin', process.env.DIRECTORY_ADMIN_PASSWORD || 'directory-demo-password-123')).access_token;
    const service = await bootstrap.createService(admin, {tenant_id: `test-${randomUUID()}`, scopes:['rooms:read','rooms:write','players:write','players:act'], allowed_origins:[]});
    api = new EuchreApi(process.env.SESSION_API_URL, service.credential);
    await bootstrap.logout(admin);
  }
  const app = createEuchreServer(api, {actionIntervalMs: 0});
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  const base = `http://127.0.0.1:${app.server.address().port}`, clients = [], cookies = [];
  const names = ['host', 'guest', 'third', 'fourth'].slice(0, humans).map(n => n + randomUUID().slice(0,8)); let id = 0;
  async function action(ws, message, allowError = false) {
    const requestId = ++id, start = ws.messages.length;
    ws.send(JSON.stringify({...message, id: requestId}));
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      const messages = ws.messages.slice(start);
      if (messages.some(m => m.done === requestId)) {
        const error = messages.find(m => m.error);
        if (error && !allowError) throw new Error(error.error);
        return messages;
      }
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    throw new Error('Action timed out');
  }
  try {
    const html = await (await fetch(base)).text(); assert.match(html, /Euchre/);
    for (const username of names) {
      const response = await fetch(base + '/auth/register', {method:'POST', headers:{Origin:'http://127.0.0.1:3000','Content-Type':'application/json'}, body:JSON.stringify({username,password:'password123'})});
      assert.equal(response.status, 200, await response.text());
      const cookie = response.headers.get('set-cookie').split(';')[0]; cookies.push(cookie);
      const ws = new WebSocket(base.replace('http','ws') + '/play', {origin:'http://127.0.0.1:3000', headers:{Cookie:cookie}});
      ws.messages = []; ws.on('message', raw => { const data=JSON.parse(raw); ws.messages.push(data); if (data.state) ws.state=data.state; });
      await once(ws,'open'); clients.push(ws);
    }
    const [host, guest] = clients;
    await action(host, {action:'host'});
    const code = host.state.code;
    await action(guest || host, {action:'preview', code});
    for (const client of clients.slice(1)) await action(client, {action:'join', host:names[0]});
    if (live) {
      const tables = await api.discoverTables(); assert.equal(tables[0].member_count, humans);
      assert.ok((await api.heartbeat()).every(r => r.status === 'fulfilled'));
      if (guest) {
      await action(host, {action:'social',operation:'send',username:names[1]});
      const messages = await action(guest, {action:'social',operation:'list'});
      const request = messages.find(m=>m.social).social.requests[0];
      await action(guest, {action:'social',operation:'resolve',requestId:request.id,resolution:'accept'});
      }
    }
    await action(host, {action:'next'});
    assert.ok(host.state.hand.length >= 5); // A solo dealer may already have picked up the upcard.
    if (guest) {
      assert.equal(guest.state.hand.length, 5);
      assert.ok(host.state.hand.every(c => !guest.state.hand.some(other => other.id === c.id)));
    }
    assert.equal('hands' in host.state, false);
    let actions = 0;
    while (!host.state.finished) {
      if (++actions > 2000) assert.fail('Game stalled');
      const state = host.state;
      if (state.phase === 'handEnd') { await action(host, {action:'next'}); continue; }
      const ws = clients[names.indexOf(state.seats[state.turn])]; assert.ok(ws, 'Bots yield to humans');
      const view = ws.state;
      const move = view.phase === 'bid' ? {type:'bid',suit:view.bidRound === 1 ? view.upcard.suit : suits.find(s=>s!==view.upcard.suit)} : {type:view.phase === 'discard' ? 'discard':'play',card:view.legal[0]};
      await action(ws, {action:'card',move});
    }
    assert.ok(Math.max(...host.state.scores) >= 10);
    for (const client of clients.slice(1)) await action(client, {action:'leave'});
    await action(host, {action:'leave'}); assert.equal(app.rooms.size, 0);
    if (live) assert.equal((await api.discoverTables()).length, 0);
    await action(host, {action:'host'}); assert.deepEqual(host.state.scores,[0,0]);
    await action(host, {action:'leave'});
    for (const cookie of cookies) {
      const response = await fetch(base + '/auth/delete', {method:'DELETE',headers:{Origin:'http://127.0.0.1:3000',Cookie:cookie}});
      assert.equal(response.status,200);
    }
  } finally { for (const ws of clients) ws.terminate(); await app.shutdown(); }
});
