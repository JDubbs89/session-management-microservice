import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../game.js';
import { SessionApi } from '../api.js';
import { MockApi } from '../mock-api.js';
test('three rounds, authoritative scores, duplicate and unauthorized actions', () => {
 const g = new Game('host',123); g.join('host'); g.join('guest');
 assert.throws(()=>g.next('guest'),/Only the host/);
 assert.throws(()=>g.answer('guest',1),/No active/);
 for(const answer of [1,2,0]) {g.next('host');assert.equal('correct' in g.snapshot().question,false);g.answer('guest',answer);assert.throws(()=>g.answer('guest',answer),/Already/);}
 g.next('host');assert.equal(g.snapshot().finished,true);assert.equal(g.players.get('guest'),3);
 assert.throws(()=>g.answer('guest',0),/No active/);
});
test('capacity and late joins are rejected',()=>{const g=new Game('a',1);for(const n of ['a','b','c','d'])g.join(n);assert.throws(()=>g.join('e'),/full/);g.next('a');assert.throws(()=>g.join('e'),/started/);});
test('client covers all 15 routes and encodes auth, forms, queries, nested bodies',async()=>{
 const calls=[];const api=new SessionApi('http://api.test',async(url,options)=>{calls.push({url,options});return new Response('{}');});
 await api.health();await api.register({username:'a'});await api.registerAdmin('t',{username:'b'});await api.login('a&b','p=word');await api.me('t');await api.getUser('t','a&b');await api.logout('t');await api.deleteUser('t','b','p');await api.deleteMe('t');await api.create('t',{session_code:1},{player_count:1});await api.byHost('t','a&b');await api.previewHost('t','a');await api.previewCode('t',1);await api.update('t',1,{allow_join:'private'});await api.deleteSession('t',1,'a');
 assert.equal(new Set(calls.map(c=>c.options.method+' '+c.url.pathname)).size,15);
 assert.equal(calls[3].options.body,'username=a%26b&password=p%3Dword');
 assert.equal(calls[5].url.searchParams.get('target_username'),'a&b');
 assert.equal(calls[4].options.headers.Authorization,'Bearer t');
 assert.deepEqual(JSON.parse(calls[9].options.body),{session:{session_code:1},beacon_metadata:{player_count:1}});
 assert.equal(calls[14].url.searchParams.get('session_code'),'1');
});
test('API errors propagate without silently switching to mock',async()=>{const api=new SessionApi('http://api.test',async()=>new Response('{"detail":"bad"}',{status:403}));await assert.rejects(api.me('t'),/403/);});
test('mock account and room lifecycle',async()=>{const api=new MockApi();await api.register({username:'a',password:'secret',user_id:'1'});const t=(await api.login('a','secret')).access_token;await api.create(t,{session_code:1,host_username:'a'},{player_count:1});assert.equal((await api.byHost(t,'a')).session_code,1);await api.update(t,1,{allow_join:'private'});assert.equal((await api.previewCode(t,1)).player_count,1);await api.deleteSession(t,1,'a');await assert.rejects(api.previewCode(t,1));await api.deleteMe(t);await assert.rejects(api.me(t));});
