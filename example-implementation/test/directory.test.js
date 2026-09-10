import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createDirectoryServer } from '../directory-server.js';
import { SessionApi } from '../api.js';

test('directory routes user and owned-group workflows without exposing credentials',async()=>{
 const calls=[];
 const api=new Proxy({}, {get:(_,method)=>async(...args)=>{calls.push({method,args});return method==='listPlayers'?[{player_id:'u',subject:'Alex',groups:[]}]:method==='listRooms'?[]:{ok:true};}});
 const server=createDirectoryServer(api,'private-service-credential');
 server.listen(0,'127.0.0.1');await once(server,'listening');
 const base=`http://127.0.0.1:${server.address().port}`;
 try {
  let response=await fetch(base+'/api/players?q=Alex');assert.equal(response.status,200);assert.equal((await response.json())[0].subject,'Alex');
  response=await fetch(base+'/api/rooms');assert.equal(response.status,200);
  await fetch(base+'/api/players/u',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({subject:'Alex M',previous_subject:'Alex'})});
  await fetch(base+'/api/rooms/g',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({version:1,capacity:8})});
  assert.deepEqual(calls.map(c=>c.method),['listPlayers','listRooms','editPlayer','editRoom']);
  assert.equal(calls[1].args[3].owned,true);
  assert.equal(calls[2].args[1],'u');assert.equal(calls[3].args[1],'g');
  assert.equal((await fetch(base+'/api/players/u')).status,404);
  assert.equal((await fetch(base+'/api/rooms/g/join',{method:'POST',headers:{Origin:'http://other.test'},body:'{}'})).status,403);
  const html=await (await fetch(base)).text();assert.ok(html.includes('Users'));assert.ok(html.includes('Groups'));assert.ok(!html.includes('private-service-credential'));
 } finally { await new Promise(r=>server.close(r)); }
});

test('directory preserves actionable errors and rejects malformed JSON',async()=>{
 const server=createDirectoryServer({listPlayers:async()=>{throw Object.assign(new Error('secret upstream details'),{status:503});}},'credential');
 server.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}`;
 try {
  const response=await fetch(base+'/api/players');assert.equal(response.status,503);assert.ok(!(await response.text()).includes('secret upstream'));
  assert.equal((await fetch(base+'/api/players',{method:'POST',body:'{'})).status,400);
 } finally {await new Promise(r=>server.close(r));}
});

test('directory API client supports scoped browsing and versioned edits',async()=>{
 const calls=[];const api=new SessionApi('http://api.test',async(url,options)=>{calls.push({url,options});return new Response('{}');});
 await api.listPlayers('secret',100,0,'Alex & Jo');await api.listRooms('secret',100,0,{owned:true,q:'team'});
 await api.editRoom('secret','room',{version:2,capacity:8});await api.editPlayer('secret','user',{subject:'Jo',previous_subject:'Joe'});
 assert.equal(calls[0].url.searchParams.get('q'),'Alex & Jo');assert.equal(calls[1].url.searchParams.get('owned'),'true');
 assert.equal(calls[2].options.method,'PATCH');assert.equal(JSON.parse(calls[2].options.body).version,2);
 assert.equal(calls[0].options.headers.Authorization,'Service secret');
});
