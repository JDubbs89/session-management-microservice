/** Live integration through the exact client used by the demo; no fetch mocks. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile, readFile } from 'node:fs/promises';
import { SessionApi } from '../../example-implementation/api.js';

const api = new SessionApi(process.env.SESSION_API_URL || 'http://127.0.0.1:8000');
const statePath = process.env.INTEGRATION_STATE || '/tmp/session-api-integration-state.json';
const password = 'integration-test-password-82!';
if (process.argv.includes('--after-restart')) {
  const { username } = JSON.parse(await readFile(statePath, 'utf8'));
  const { access_token: token } = await api.login(username, password);
  assert.equal((await api.me(token)).username, username);
  await api.deleteMe(token);
  console.log('Account survived PostgreSQL restart and was cleaned up.');
  // Repeat the complete route suite after verifying the persisted account.
}
const suffix = randomUUID().slice(0, 8);
const account = name => ({ user_id: randomUUID(), steam_id: `test:${randomUUID()}`, username: `${name}-${suffix}`, password });
const host = account('host'), guest = account('guest'), operator = account('operator');
const expectError = (fn, status) => assert.rejects(fn, error => error.status === status);
assert.equal((await api.health()).status, 'ok');
assert.equal((await fetch(new URL('/health/ready', api.base))).status, 200);
await api.register(host);
await api.register(guest);
await expectError(() => api.register(host), 409);
await expectError(() => api.login(host.username, 'wrong-password'), 401);
const { access_token: hostToken } = await api.login(host.username, password);
const { access_token: guestToken } = await api.login(guest.username, password);
assert.equal((await api.me(hostToken)).username, host.username);
await expectError(() => api.me(), 401);
await expectError(() => api.me(`${hostToken.slice(0, -10)}xxxxxxxxxx`), 401);
const invalidJson = await fetch(new URL('/sessions/create', api.base), {
  method: 'POST', headers: {Authorization: `Bearer ${hostToken}`, 'Content-Type': 'application/json'}, body: '{'
});
assert.equal(invalidJson.status, 422);
assert.deepEqual(await invalidJson.json(), {detail: {code: 'invalid_request'}});
await expectError(() => api.getUser(hostToken, guest.username), 403);
const { access_token: adminToken } = await api.login('integration-admin', process.env.INTEGRATION_ADMIN_PASSWORD);
assert.equal((await api.registerAdmin(adminToken, operator)).role, 'admin');
assert.equal((await api.getUser(adminToken, operator.username)).role, 'admin');
const code = 100000 + Math.floor(Math.random() * 900000);
const metadata = { session_flavortext: 'Integration trivia', player_count: 1, max_player_count: 4,
  session_start_time: new Date().toISOString(), host_username: host.username };
await expectError(() => api.create(guestToken, { session_code: code, host_username: host.username }, metadata), 403);
const created = await api.create(hostToken, { session_code: code, host_username: host.username, session_passcode: 'initial-room' }, metadata);
assert.equal((await api.byHost(guestToken, host.username, 'initial-room')).session_code, code);
await api.update(hostToken, code, {session_passcode: ''});
assert.equal(created.host_username, host.username);
for (const key of ['session_passcode', 'session_whitelist', 'session_blacklist']) assert.equal(key in created, false);
await expectError(() => api.create(hostToken, { session_code: code, host_username: host.username }, metadata), 409);
await expectError(() => api.deleteSession(guestToken, code, guest.username), 403);
await api.update(hostToken, code, { session_passcode: 'protected-room' });
await expectError(() => api.byHost(guestToken, host.username, 'wrong'), 403);
const protectedSession = await api.byHost(guestToken, host.username, 'protected-room');
for (const key of ['session_passcode', 'session_whitelist', 'session_blacklist']) assert.equal(key in protectedSession, false);
await api.update(hostToken, code, { session_passcode: '', allow_join: 'private' });
await expectError(() => api.byHost(guestToken, host.username), 403);
await api.update(hostToken, code, { session_whitelist: [guest.username] });
assert.equal((await api.byHost(guestToken, host.username)).session_code, code);
await api.update(hostToken, code, { session_blacklist: [guest.username] });
await expectError(() => api.byHost(guestToken, host.username), 403);
await api.update(hostToken, code, { allow_join: 'friends only', session_whitelist: [], session_blacklist: [] });
await expectError(() => api.byHost(guestToken, host.username), 403);
await api.update(hostToken, code, { allow_join: 'public' });
assert.equal((await api.byHost(guestToken, host.username)).session_code, code);
assert.equal((await api.previewHost(guestToken, host.username)).session_flavortext, metadata.session_flavortext);
assert.equal((await api.previewCode(guestToken, code)).player_count, 1);
await expectError(() => api.update(guestToken, code, { session_status: 'ended' }), 403);
await expectError(() => api.deleteSession(guestToken, code, host.username), 403);
await expectError(() => api.update(hostToken, code, { host_username: guest.username }), 422);
await api.update(hostToken, code, { beacon_metadata: { ...metadata, player_count: 2 } });
assert.equal((await api.previewCode(guestToken, code)).player_count, 2);
await api.deleteSession(hostToken, code, host.username);
await expectError(() => api.previewCode(hostToken, code), 404);
await api.logout(guestToken);
await expectError(() => api.me(guestToken), 401);
const { access_token: newGuestToken } = await api.login(guest.username, password);
await expectError(() => api.me(guestToken), 401); // Logout stays revoked after another login.
await api.deleteMe(newGuestToken);
await api.deleteUser(adminToken, operator.username, password);
await expectError(() => api.getUser(adminToken, operator.username), 404);
// Keep one account for the restart probe; the state file contains no credentials.
await writeFile(statePath, JSON.stringify({ username: host.username }), { mode: 0o600 });
console.log('All 15 legacy endpoints and readiness exercised against PostgreSQL, including ownership, passcodes, and admission policies.');
