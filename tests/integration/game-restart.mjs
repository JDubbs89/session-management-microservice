// Verify a restarted game server cannot restore a token revoked by the API.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createTriviaServer } from '../../example-implementation/server.js';
import { SessionApi } from '../../example-implementation/api.js';
if(process.env.INTEGRATION_TEST_DATABASE!=='1') throw new Error('Disposable integration database required');
const state=JSON.parse(await readFile(process.env.INTEGRATION_IDENTITY_STATE||'/tmp/session-p1-identity.json','utf8'));
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function request(path, options) {
 for (let attempt = 0; attempt < 3; attempt++) {
  const response = await fetch(path, options);
  if (response.status !== 429 || attempt === 2) return response;
  const retryAfter = Number(response.headers.get('retry-after'));
  await wait(Math.max(1000, (Number.isFinite(retryAfter) ? retryAfter : 1) * 1000));
 }
}
for(let restart=0;restart<2;restart++) {
 const {server,wss}=createTriviaServer(new SessionApi(process.env.SESSION_API_URL));
 server.listen(0,'127.0.0.1');await once(server,'listening');
 try {
  for(const [key,status] of [['revoked',401],['current',200]]) {
    const response=await request(`http://127.0.0.1:${server.address().port}/auth/me`,{headers:{Cookie:`trivia_token=${encodeURIComponent(state[key])}`}});
   assert.equal(response.status,status);
  }
 } finally { await new Promise(r=>wss.close(r));await new Promise(r=>server.close(r)); }
}
console.log('Fresh and restarted game servers reject revoked cookies and restore valid identity.');
