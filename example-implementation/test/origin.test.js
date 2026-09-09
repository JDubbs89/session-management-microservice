import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { createTriviaServer } from '../server.js';
import { MockApi } from '../mock-api.js';

test('WebSocket accepts local aliases on the configured port and rejects other origins', async () => {
  const { server, wss } = createTriviaServer(new MockApi());
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = `ws://127.0.0.1:${server.address().port}/play`;
  try {
    const registration = await fetch(`http://127.0.0.1:${server.address().port}/auth/register`, {method: 'POST', headers: {Origin: 'http://localhost:3000', 'Content-Type': 'application/json'}, body: JSON.stringify({username: 'origin_user', password: 'password123'})});
    assert.ok(registration.ok);
    const cookie = registration.headers.get('set-cookie').split(';')[0];
    for (const origin of ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://[::1]:3000']) {
      const ws = new WebSocket(url, { origin, headers: {Cookie: cookie} });
      await once(ws, 'open');
      ws.close();
      await once(ws, 'close');
    }
    for (const origin of ['http://localhost:3001', 'https://localhost:3000', 'http://example.com:3000', 'null']) {
      const ws = new WebSocket(url, { origin, headers: {Cookie: cookie} });
      const [error] = await once(ws, 'error');
      assert.match(error.message, /403/);
    }
  } finally {
    for (const ws of wss.clients) ws.terminate();
    await new Promise(resolve => wss.close(resolve));
    await new Promise(resolve => server.close(resolve));
  }
});
