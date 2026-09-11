import test from 'node:test';
import assert from 'node:assert/strict';
import { EuchreApi } from '../euchre-api.js';
function fixture() {
  const api = new EuchreApi('http://unused', 'secret'); const calls = [];
  api.request = async (method,path,token,body) => {
    calls.push({method,path,body});
    if (path === '/users/me') return {subject:'account-id',user_id:'user-id',username:'alice'};
    if (path === '/v1/players') return {player_id:'player-id'};
    if (path === '/v1/rooms') return {room_id:'room-id',version:1};
    if (path === '/v1/rooms/room-id') return {room_id:'room-id',version:2};
    return {};
  };
  return {api,calls};
}
test('failed legacy creation compensates service membership and uncertain legacy writes', async () => {
  const {api,calls} = fixture(); const request = api.request;
  api.request = async (...args) => { if (args[1] === '/sessions/create') throw Object.assign(new Error('timeout'),{status:504}); return request(...args); };
  await assert.rejects(api.create('token',{session_code:123456},{}),/timeout/);
  assert.equal(api.tables.size,0);
  assert.ok(calls.some(c=>c.path.endsWith('/close')));
  assert.ok(calls.some(c=>c.path==='/sessions/delete'));
});
test('close version conflicts preserve bookkeeping for cleanup retries', async () => {
  const {api,calls} = fixture(); await api.create('token',{session_code:123456},{});
  const request = api.request; let conflict = true;
  api.request = async (...args) => { if (args[1].endsWith('/close') && conflict) throw Object.assign(new Error('conflict'),{status:409}); return request(...args); };
  await assert.rejects(api.deleteSession('token',123456,'alice'),/conflict/);
  assert.equal(api.tables.size,1); assert.ok(!calls.some(c=>c.path==='/sessions/delete'));
  conflict = false; await api.deleteSession('token',123456,'alice'); assert.equal(api.tables.size,0);
});
test('heartbeat and policy mutation serialize and use current versions', async () => {
  const {api,calls} = fixture(); await api.create('token',{session_code:123456},{});
  await Promise.all([api.heartbeat(),api.update('token',123456,{allow_join:'private'})]);
  const heartbeat = calls.find(c=>c.path.endsWith('/heartbeat'));
  const edit = calls.find(c=>c.method==='PATCH');
  assert.equal(heartbeat.body.version,2); assert.equal(edit.body.version,2); assert.equal(edit.body.policy,'private');
  assert.equal(api.locks.size,0);
});
