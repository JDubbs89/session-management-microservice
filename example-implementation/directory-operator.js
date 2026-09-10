import { randomUUID } from 'node:crypto';
import { SessionApi } from './api.js';

const { ADMIN_USERNAME, ADMIN_PASSWORD, SESSION_API_URL = 'http://127.0.0.1:8000' } = process.env;
if (!ADMIN_USERNAME || !ADMIN_PASSWORD) throw new Error('Set ADMIN_USERNAME and ADMIN_PASSWORD for an existing bootstrap admin');
const api = new SessionApi(SESSION_API_URL);
await api.health();
const admin = (await api.login(ADMIN_USERNAME, ADMIN_PASSWORD)).access_token;
const service = await api.createService(admin, {tenant_id: `directory-${Date.now()}`, scopes:['rooms:read','rooms:write','players:write','players:act'], allowed_origins:[]});
const rotated = await api.rotateService(admin, service.service_id);
const player = await api.createPlayer(rotated.credential, {subject:`demo-${randomUUID()}`, external_identities:{example:randomUUID()}});
await api.grantPlayer(admin, service.service_id, player.player_id);
console.log(JSON.stringify({service_id: service.service_id, credential: rotated.credential, player_id: player.player_id}, null, 2));
console.log('Export SERVICE_CREDENTIAL and run: npm run directory');