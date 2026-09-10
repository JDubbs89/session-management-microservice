/** Browser UX smoke test using a deterministic API fixture; not database coverage.
 * PLAYWRIGHT_MODULE can point to a temporary Playwright installation.
 */
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createDirectoryServer } from '../../example-implementation/directory-server.js';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const users=new Map(),groups=new Map();let serial=0,failEdit=false;
const api={
 async listPlayers(c,limit,offset,q){return [...users.values()].filter(u=>u.subject.toLowerCase().includes(q.toLowerCase())).map(u=>({...u,groups:[...groups.values()].filter(g=>g.members.includes(u.player_id)).map(g=>({room_id:g.room_id,code:g.code}))})).slice(offset,offset+limit);},
 async createPlayer(c,body){const existing=[...users.values()].find(u=>u.subject===body.subject);if(existing)return existing;const user={player_id:'u'+ ++serial,subject:body.subject,shared:false};users.set(user.player_id,user);return user;},
 async editPlayer(c,id,body){const user=users.get(id);user.subject=body.subject;return user;},
 async deletePlayer(c,id){users.delete(id);for(const g of groups.values())g.members=g.members.filter(p=>p!==id);return {deleted:true};},
 async listRooms(c,limit,offset,{q}){return [...groups.values()].filter(g=>g.code.includes(q)).map(g=>({...g,member_count:g.members.length})).slice(offset,offset+limit);},
 async createRoom(c,body){const g={...body,room_id:'g'+ ++serial,version:1,members:[],lease_until:new Date(Date.now()+90000).toISOString()};groups.set(g.room_id,g);return g;},
 async getRoom(c,id){const g=groups.get(id);if(!g)throw Object.assign(new Error('Missing'),{status:404});return {...g,member_details:g.members.map(id=>users.get(id))};},
 async editRoom(c,id,body){if(failEdit){failEdit=false;throw Object.assign(new Error('Conflict'),{status:409});}Object.assign(groups.get(id),body,{version:body.version+1});return groups.get(id);},
 async joinRoom(c,id,player){const g=groups.get(id);if(!g.members.includes(player))g.members.push(player);return {joined:true};},
 async leaveRoom(c,id,player){const g=groups.get(id);g.members=g.members.filter(p=>p!==player);return {left:true};},
 async closeRoom(c,id){groups.delete(id);return {closed:true};},
 async heartbeatRoom(c,id){const g=groups.get(id);g.version++;g.lease_until=new Date(Date.now()+90000).toISOString();return g;}
};
const server=createDirectoryServer(api,'server-only-secret');server.listen(0,'127.0.0.1');await once(server,'listening');
const browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
async function settled(){await page.waitForFunction(()=>document.querySelector('main').getAttribute('aria-busy')==='false');}
async function save(){await page.locator('#save').click();await page.locator('#editor').waitFor({state:'hidden'});await settled();}
async function addUser(name){await page.locator('#add').click();await page.locator('[name=subject]').fill(name);await save();}
async function confirm(){const response=page.waitForResponse(r=>r.url().includes('/api/')&&r.request().method()!=='GET');await page.locator('#confirm-action').click();await response;await settled();}
try {
 await page.goto(`http://127.0.0.1:${server.address().port}`);await settled();
 await addUser('Alex Morgan');await addUser('Jordan Lee');
 await page.locator('[data-edit=users]').click();await page.locator('[name=subject]').fill('Jo Lee');await save();
 await page.locator('[data-view=groups]').click();await page.locator('#add').click();
 await page.locator('[name=code]').fill('weekend-crew');await page.locator('[name=policy]').selectOption('private');await save();
 assert.ok((await page.locator('#records').innerText()).includes('Private'));
 await page.locator('#membership select').selectOption({label:'Alex Morgan'});await page.locator('#membership button').click();await settled();
 assert.ok((await page.locator('#detail').innerText()).includes('Alex Morgan'));
 await page.locator('[data-edit=groups]').click();await page.locator('[name=code]').fill('weekend-renamed');await page.locator('[name=capacity]').fill('12');
 failEdit=true;await page.locator('#save').click();await page.locator('#form-error').waitFor({state:'visible'});await settled();
 assert.equal(await page.locator('[name=code]').inputValue(),'weekend-renamed');await save();
 await page.locator('[data-remove-member]').click();await page.locator('#confirmation button[value=cancel]').click();assert.equal([...groups.values()][0].members.length,1);
 await page.locator('[data-remove-member]').click();await confirm();assert.equal([...groups.values()][0].members.length,0);
 await page.locator('[data-create-member]').click();await page.locator('[name=subject]').fill('Casey');await save();
 assert.ok((await page.locator('#detail').innerText()).includes('Casey'));
 await page.screenshot({path:'/tmp/directory-desktop.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'/tmp/directory-mobile.png',fullPage:true});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.locator('[data-view=users]').click();await page.getByRole('button',{name:/Casey.*1 group/}).click();
 await page.locator('[data-remove-from]').click();await confirm();
 await page.locator('[data-view=groups]').click();await page.locator('[data-close-group]').click();await confirm();assert.equal(groups.size,0);
 await page.locator('[data-view=users]').click();await page.getByRole('button',{name:/Jo Lee/}).click();await page.locator('[data-delete-user]').click();await confirm();assert.equal(users.size,2);
 await addUser('<img src=x onerror=alert(1)>');assert.equal(await page.locator('#detail img').count(),0);
 await page.locator('#search').fill('Alex');await page.waitForFunction(()=>document.querySelectorAll('#records .record').length===1);assert.ok((await page.locator('#records').innerText()).includes('Alex Morgan'));
 assert.deepEqual(errors,[]);console.log('Browser UX passed: user/group CRUD, membership, cancellation, retained error form, search, escaping, and mobile layout.');
} finally {await browser.close();await new Promise(r=>server.close(r));}
