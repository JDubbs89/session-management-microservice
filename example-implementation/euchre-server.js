import { SessionApi } from './api.js';
import { EuchreApi } from './euchre-api.js';
import { Euchre } from './euchre.js';
import { createTriviaServer } from './server.js';
export function createEuchreServer(api, options = {}) {
  return createTriviaServer(api, {actionIntervalMs: 150, ...options, GameClass: Euchre, gameName: 'euchre', assetsPrefix: 'euchre-'});
}
export async function startEuchre() {
  const bootstrap = new SessionApi(process.env.SESSION_API_URL);
  await bootstrap.health();
  let credential = process.env.SERVICE_CREDENTIAL;
  if (!credential && process.env.DIRECTORY_AUTO_PROVISION === '1') {
    const token = (await bootstrap.login(process.env.DIRECTORY_ADMIN_USERNAME, process.env.DIRECTORY_ADMIN_PASSWORD)).access_token;
    const service = await bootstrap.createService(token, {tenant_id: `euchre-${Date.now()}`, scopes: ['rooms:read', 'rooms:write', 'players:write', 'players:act'], allowed_origins: []});
    credential = (await bootstrap.rotateService(token, service.service_id)).credential;
    await bootstrap.logout(token);
  }
  if (!credential) throw new Error('Set SERVICE_CREDENTIAL, or use run-demo.sh --euchre-example for automatic local provisioning.');
  const api = new EuchreApi(process.env.SESSION_API_URL, credential);
  await api.listRooms(credential, 1, 0);
  const port = Number(process.env.PORT || 3000);
  const app = createEuchreServer(api, {origin: process.env.PUBLIC_ORIGIN || `http://127.0.0.1:${port}`});
  let renewing = false;
  const timer = setInterval(async () => {
    if (renewing) return;
    renewing = true;
    try {
      const results = await api.heartbeat();
      for (const result of results.filter(r => r.status === 'rejected')) {
        for (const ws of app.wss.clients) if (ws.room?.game.code === result.code) {
          ws.send(JSON.stringify({error: 'Table presence renewal failed. Please retry shortly.'}));
          if ([404, 409].includes(result.reason.status) && ws.room.game.host === ws.user.username) ws.close(1012, 'Table lease expired');
        }
      }
    } finally { renewing = false; }
  }, 20000);
  timer.unref();
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { clearInterval(timer); await app.shutdown(); process.exit(0); });
  app.server.listen(port, process.env.HOST || '127.0.0.1', () => console.log(`Euchre: http://127.0.0.1:${port}`));
  return app;
}
