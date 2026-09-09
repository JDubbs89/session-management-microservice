// Verify a restarted game server cannot restore a token revoked by the API.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createTriviaServer } from '../../example-implementation/server.js';
import { SessionApi } from '../../example-implementation/api.js';
if(process.env.INTEGRATION_TEST_DATABASE!=='1') throw new Error('Disposable integration database required');
const state=JSON.parse(await readFile(process.env.INTEGRATION_IDENTITY_STATE||'/tmp/session-p1-identity.json','utf8'));
for(let restart=0;restart<2;restart++) {
 const {server,wss}=createTriviaServer(new SessionApi(process.env.SESSION_API_URL));
 server.listen(0,'127.0.0.1');await once(server,'listening');
 try {
  for(const [key,status] of [['revoked',401],['current',200]]) {
   const response=await fetch(`http://127.0.0.1:${server.address().port}/auth/me`,{headers:{Cookie:`trivia_token=${encodeURIComponent(state[key])}`}});
   assert.equal(response.status,status);
  }
 } finally { await new Promise(r=>wss.close(r));await new Promise(r=>server.close(r)); }
}
console.log('Fresh and restarted game servers reject revoked cookies and restore valid identity.');
