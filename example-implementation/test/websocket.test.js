import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { createTriviaServer } from '../server.js';
import { MockApi } from '../mock-api.js';
test('two websocket players complete trivia and host removes room', async () => {
 const api = new MockApi();
 const {server,wss,rooms}=createTriviaServer(api);
 server.listen(0,'127.0.0.1');await once(server,'listening');
 const clients=[]; let requestId=0;
 async function connect(cookie){const ws=new WebSocket(`ws://127.0.0.1:${server.address().port}/play`,{origin:'http://127.0.0.1:3000',headers:{Cookie:cookie}});ws.messages=[];ws.on('message',raw=>ws.messages.push(JSON.parse(raw)));await once(ws,'open');clients.push(ws);return ws;}
 async function action(ws,message,predicate){await new Promise(r=>setTimeout(r,1120));const start=ws.messages.length;const id=++requestId;ws.send(JSON.stringify({...message,id}));const until=Date.now()+3000;while(Date.now()<until){const recent=ws.messages.slice(start);const error=recent.find(m=>m.error);if(error)throw new Error(error.error);const result=recent.find(predicate);if(result && recent.some(m=>m.done===id))return result;await new Promise(r=>setTimeout(r,10));}throw new Error('Response timed out');}
 try {
 for (const [path,type] of [['/','text/html'],['/app.js','text/javascript'],['/styles.css','text/css']]) { const response=await fetch(`http://127.0.0.1:${server.address().port}${path}`);assert.equal(response.status,200);assert.ok(response.headers.get('content-type').startsWith(type)); }
 async function auth(path, cookie, body, method='POST') {return fetch(`http://127.0.0.1:${server.address().port}/auth/${path}`,{method,headers:{Origin:'http://127.0.0.1:3000','Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},...(body?{body:JSON.stringify(body)}:{})});}
 const hostAuth=await auth('register',null,{username:'host',password:'password1'});
 const guestAuth=await auth('register',null,{username:'guest',password:'password2'});
 assert.ok(hostAuth.ok); assert.ok(guestAuth.ok);
 const hostCookie=hostAuth.headers.get('set-cookie').split(';')[0],guestCookie=guestAuth.headers.get('set-cookie').split(';')[0];
 const host=await connect(hostCookie), guest=await connect(guestCookie);
 await action(host,{action:'host'},m=>m.state);
 await action(guest,{action:'preview',host:'host'},m=>m.preview);
 const joined=await action(guest,{action:'join',host:'host'},m=>m.state);assert.equal(joined.state.scores.length,2);assert.equal(api.sessions.get(joined.state.code).beacon_metadata.player_count,2);
 for(const choice of [1,2,0]){await action(host,{action:'next'},m=>m.state);const answered=await action(guest,{action:'answer',choice},m=>m.state);assert.equal(answered.state.hasAnswered,true);assert.equal(answered.state.totalQuestions,3);}
 const result=await action(host,{action:'next'},m=>m.state);assert.equal(result.state.finished,true);assert.equal(api.sessions.get(result.state.code).session_status,'ended');assert.equal(result.state.scores.find(p=>p.name==='guest').score,3);
 await action(host,{action:'leave'},m=>m.notice);assert.equal(rooms.size,0);
 assert.ok((await auth('delete',guestCookie,null,'DELETE')).ok);assert.ok((await auth('logout',hostCookie)).ok);
 } finally {for(const ws of clients)ws.close();await new Promise(resolve=>wss.close(resolve));await new Promise(resolve=>server.close(resolve));}
});
