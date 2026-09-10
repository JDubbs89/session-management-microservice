import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { SessionApi } from './api.js';

const json = (res, status, body) => { res.writeHead(status, {'Content-Type':'application/json','Cache-Control':'no-store'}); res.end(JSON.stringify(body)); };
async function readJson(req) {
  let raw = ''; let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 16384) throw Object.assign(new Error('Request too large.'), {status:413});
    raw += chunk;
  }
  try { return raw ? JSON.parse(raw) : {}; }
  catch { throw Object.assign(new Error('Invalid JSON.'), {status:400}); }
}
const messages = {
  400:'Check the form and try again.', 401:'The directory connection needs a new service credential. Contact the demo operator.',
  403:'This service cannot perform that action. Public addresses must use an approved origin.',
  404:'This item is no longer available. The group may have expired. Refresh the list.',
  409:'The item changed, the name is in use, or a membership limit was reached. Refresh and check your changes. Shared users cannot be edited or deleted.',
  422:'Check the names, capacity, and connection settings.', 429:'Too many requests. Wait a moment and try again.',
  503:'The directory is unavailable. Your form has been kept; try again shortly.',
  504:'The directory took too long to respond. Refresh before retrying a change.'
};

export function createDirectoryServer(api, credential) {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://directory.local');
      const path = url.pathname;
      const assets = {'/':'directory.html','/directory.js':'directory-app.js','/directory.css':'directory.css'};
      if (Object.hasOwn(assets,path) && req.method === 'GET') {
        const file = assets[path];
        const body = await readFile(new URL(`./public/${file}`, import.meta.url));
        res.writeHead(200, {'Content-Type':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html'});
        res.end(body); return;
      }
      if (!path.startsWith('/api/')) return json(res,404,{error:'Not found'});
      if (!['GET','HEAD'].includes(req.method) && req.headers.origin && req.headers.origin !== `http://${req.headers.host}` && req.headers.origin !== `https://${req.headers.host}`)
        return json(res,403,{error:'Open this page from the directory’s own address to make changes.'});
      const parts = path.split('/').filter(Boolean);
      const [ , resource, id, action] = parts;
      const body = req.method === 'GET' ? {} : await readJson(req);
      const limit = Number(url.searchParams.get('limit') || 100), offset = Number(url.searchParams.get('offset') || 0), q = url.searchParams.get('q') || '';
      let result;
      if(path==='/api/players' && req.method==='GET') result=await api.listPlayers(credential,limit,offset,q);
      else if(path==='/api/players' && req.method==='POST') result=await api.createPlayer(credential,body);
      else if(resource==='players' && id && parts.length===3 && req.method==='PATCH') result=await api.editPlayer(credential,id,body);
      else if(resource==='players' && id && parts.length===3 && req.method==='DELETE') result=await api.deletePlayer(credential,id);
      else if(path==='/api/rooms' && req.method==='GET') result=await api.listRooms(credential,limit,offset,{owned:true,q});
      else if(path==='/api/rooms' && req.method==='POST') result=await api.createRoom(credential,body);
      else if(resource==='rooms' && id && parts.length===3 && req.method==='GET') result=await api.getRoom(credential,id);
      else if(resource==='rooms' && id && parts.length===3 && req.method==='PATCH') result=await api.editRoom(credential,id,body);
      else if(resource==='rooms' && id && parts.length===4 && req.method==='POST') {
        const methods={join:'joinRoom',leave:'leaveRoom',ban:'banPlayer',heartbeat:'heartbeatRoom',close:'closeRoom'};
        if(!Object.hasOwn(methods,action)) return json(res,404,{error:'Unknown group action'});
        result=await api[methods[action]](credential,id,['heartbeat','close'].includes(action)?body.version:body.player_id);
      } else return json(res,404,{error:'Unknown directory operation'});
      json(res,200,result);
    } catch(error) { json(res,error.status || 503,{error:messages[error.status] || 'The request failed. Refresh and try again.'}); }
  });
}

async function start() {
  const api = new SessionApi(process.env.SESSION_API_URL, fetch, {spacingMs:0});
  let credential = process.env.SERVICE_CREDENTIAL;
  await api.health();
  if(!credential && process.env.DIRECTORY_AUTO_PROVISION==='1') {
    const username=process.env.DIRECTORY_ADMIN_USERNAME,password=process.env.DIRECTORY_ADMIN_PASSWORD;
    if(!username||!password) throw new Error('Directory auto-provisioning requires administrator credentials.');
    const admin=(await api.login(username,password)).access_token;
    const service=await api.createService(admin,{tenant_id:`directory-${Date.now()}`,scopes:['rooms:read','rooms:write','players:write','players:act'],allowed_origins:[]});
    credential=(await api.rotateService(admin,service.service_id)).credential;
  }
  if(!credential) throw new Error('Set SERVICE_CREDENTIAL or enable DIRECTORY_AUTO_PROVISION.');
  await api.listRooms(credential,1,0);
  const port=Number(process.env.PORT||3000);
  createDirectoryServer(api,credential).listen(port,process.env.HOST||'127.0.0.1',()=>console.log(`Service directory: http://127.0.0.1:${port}`));
}
const entry=process.argv[1] && resolve(process.argv[1]);
if(entry===fileURLToPath(import.meta.url)||entry===fileURLToPath(new URL('./launcher.js',import.meta.url))) await start();
