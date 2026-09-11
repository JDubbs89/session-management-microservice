/** Live browser smoke test. Point EUCHRE_URL at an isolated running Euchre demo. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({headless:true});
const pages = [], errors = [], names = ['host','guest'].map(n=>n+randomUUID().slice(0,8));
const base = process.env.EUCHRE_URL || 'http://127.0.0.1:3307';
async function settle(page) { await page.waitForFunction(() => !pending); await page.waitForTimeout(200); }
try {
  for (const name of names) {
    const context = await browser.newContext({viewport:{width:1280,height:1000}});
    const page = await context.newPage(); pages.push(page); page.on('pageerror',e=>errors.push(e.message));
    await page.goto(base); await page.locator('#username').fill(name); await page.locator('#password').fill('browser-test-password');
    const registered=page.waitForResponse(r=>r.url().endsWith('/auth/register'));
    await page.getByRole('button',{name:'Create account',exact:true}).click();
    const response=await registered;assert.equal(response.status(),200,await response.text());
    await page.locator('#lobby').waitFor({state:'visible'});
    await page.waitForFunction(() => socket?.readyState === WebSocket.OPEN); await settle(page);
  }
  const [host,guest] = pages;
  await host.locator('#friend-name').fill(names[1]); await host.getByRole('button',{name:'Send request',exact:true}).click(); await settle(host);
  await guest.locator('#refresh-friends').click(); await settle(guest);
  await guest.getByRole('button',{name:'accept',exact:true}).click(); await settle(guest);
  assert.match(await guest.locator('#friends').innerText(),new RegExp(names[0]));
  await host.locator('#host').click(); await settle(host);
  const code = (await host.locator('#table-title').innerText()).replace('Table ','');
  await guest.locator('#lookup').fill(code); await guest.locator('#find-form').getByRole('button',{name:'Find table',exact:true}).click(); await settle(guest);
  await guest.getByRole('button',{name:'Join table',exact:true}).click(); await settle(guest);
  await host.locator('#deal').click(); await settle(host);
  assert.equal(await host.locator('.playing-card').count(),5); assert.equal(await guest.locator('.playing-card').count(),5);
  await host.screenshot({path:'/tmp/euchre-desktop.png',fullPage:true});
  await guest.setViewportSize({width:390,height:844});
  assert.equal(await guest.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await guest.screenshot({path:'/tmp/euchre-mobile.png',fullPage:true});
  // Play through a hand from the actual visible bid/card controls.
  for (let i=0;i<40;i++) {
    const phase = await host.evaluate(()=>state.phase);
    if (['handEnd','finished'].includes(phase)) break;
    const turn = await host.evaluate(()=>state.seats[state.turn]);
    const page = pages[names.indexOf(turn)]; assert.ok(page);
    const bid = page.locator('#bid button').first();
    if (await bid.count()) await bid.click();
    else await page.locator('.playing-card:enabled').first().click();
    await settle(page);
  }
  assert.ok(['handEnd','finished'].includes(await host.evaluate(()=>state.phase)));
  await host.locator('#leave').click(); await settle(host);
  // One account starts a new table immediately, with three bot seats.
  await host.locator('#host').click(); await settle(host);
  await host.locator('#deal').click(); await settle(host);
  assert.equal(await host.locator('.seat').count(),4);
  for (let i=0;i<20;i++) {
    if (['handEnd','finished'].includes(await host.evaluate(()=>state.phase))) break;
    const bid=host.locator('#bid button').first();
    if (await bid.count()) await bid.click();
    else await host.locator('.playing-card:enabled').first().click();
    await settle(host);
  }
  assert.ok(['handEnd','finished'].includes(await host.evaluate(()=>state.phase)));
  await host.locator('#leave').click(); await settle(host);
  for (const page of pages) { page.on('dialog',dialog=>dialog.accept()); await page.locator('#delete').click(); await page.locator('#auth').waitFor({state:'visible'}); }
  assert.deepEqual(errors,[]);
  console.log('Euchre browser account/social/table/multiplayer and solo hand/deletion flow passed at desktop and mobile widths');
} finally {
  for (const page of pages) await page.request.delete(base + '/auth/delete', {headers:{Origin:new URL(base).origin}}).catch(()=>{});
  await browser.close();
}
