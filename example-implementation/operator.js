// Run only against a disposable development database. Credentials stay in this process.
import { randomUUID } from 'node:crypto';
import { SessionApi } from './api.js';
const { ADMIN_USERNAME, ADMIN_PASSWORD, SESSION_API_URL } = process.env;
if (!ADMIN_USERNAME || !ADMIN_PASSWORD) throw new Error('Set ADMIN_USERNAME and ADMIN_PASSWORD for an existing bootstrap admin');
const api = new SessionApi(SESSION_API_URL);
const wait = () => new Promise(resolve => setTimeout(resolve, 1200));
const temporary = { user_id: randomUUID(), steam_id: randomUUID(), username: `demo_admin_${Date.now()}`, password: randomUUID() };
let token; let created = false;
try {
  await api.health();
  token = (await api.login(ADMIN_USERNAME, ADMIN_PASSWORD)).access_token;
  await api.registerAdmin(token, temporary); created = true;
  const user = await api.getUser(token, temporary.username);
  console.log(`Created and inspected temporary admin: ${user.username} (${user.role})`);
} finally {
  if (token) {
    if (created) { await wait(); await api.deleteUser(token, temporary.username, temporary.password); console.log('Temporary admin removed.'); }
    await wait(); await api.logout(token);
  }
}
