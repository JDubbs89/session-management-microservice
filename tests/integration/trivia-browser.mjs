/** Browser gameplay smoke test using the mock API; not PostgreSQL coverage. */
import assert from 'node:assert/strict';
import { once } from 'node:events';
import net from 'node:net';
import { createTriviaServer } from '../../example-implementation/server.js';
import { MockApi } from '../../example-implementation/mock-api.js';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const reservation=net.createServer();reservation.listen(0,'127.0.0.1');await once(reservation,'listening');
const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
const base=`http://127.0.0.1:${port}`;
const app=createTriviaServer(new MockApi(),{origin:base});app.server.listen(port,'127.0.0.1');await once(app.server,'listening');
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1280,height:1000}}),errors=[];
page.on('pageerror',e=>errors.push(e.message));
async function settled(){await page.waitForFunction(()=>!pending&&!cooldown);}
try {
  await page.goto(base);await settled();
  await page.screenshot({path:'/tmp/trivia-auth.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:'/tmp/trivia-mobile.png',fullPage:true});
  await page.locator('#register-tab').click();await page.locator('#username').fill('arcade_player');await page.locator('#password').fill('password123');await page.locator('#auth-submit').click();
  await page.waitForFunction(()=>connected);await settled();
  await page.locator('#host-button').click();await settled();
  await page.locator('#next-button').click();await settled();
  await page.setViewportSize({width:1280,height:1000});
  await page.screenshot({path:'/tmp/trivia-desktop.png',fullPage:true});
  for(let round=0;round<3;round++){
    await page.locator('.choice').first().click();await settled();
    await page.locator('#next-button').click();await settled();
  }
  assert.equal(await page.evaluate(()=>room.finished),true);
  assert.deepEqual(errors,[]);console.log('Trivia arcade browser game and desktop/mobile layout passed');
} finally {await browser.close();await app.shutdown();}
