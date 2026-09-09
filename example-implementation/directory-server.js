import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { SessionApi } from './api.js';

const api = new SessionApi(process.env.SESSION_API_URL);
const credential = process.env.SERVICE_CREDENTIAL;
if (!credential) throw new Error('Set SERVICE_CREDENTIAL from directory-operator before starting the directory example');
const json = (res, status, body) => { res.writeHead(status, {'Content-Type':'application/json','Cache-Control':'no-store'}); res.end(JSON.stringify(body)); };
const readJson = req => new Promise((resolve, reject) => { let raw=''; req.on('data', chunk => raw += chunk); req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch (error) { reject(error); } }); req.on('error', reject); });
const route = async (req, res) => {
  try {
    const requestUrl = new URL(req.url, 'http://directory.local');
    const path = requestUrl.pathname;
    const assets = {'/':'directory.html','/directory.js':'directory-app.js','/directory.css':'directory.css'};
    if (assets[path] && req.method === 'GET') { const file = assets[path]; const body = await readFile(new URL(`./public/${file}`, import.meta.url)); res.writeHead(200, {'Content-Type': file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html'}); res.end(body); return; }
    if (!path.startsWith('/api/')) return json(res, 404, {error:'Not found'});
    const parts = path.split('/').filter(Boolean); const roomId = parts[2]; const body = req.method === 'GET' ? {} : await readJson(req); let result;
    if (req.method === 'GET' && path === '/api/rooms') result = await api.listRooms(credential, Number(requestUrl.searchParams.get('limit') || 20), Number(requestUrl.searchParams.get('offset') || 0));
    else if (req.method === 'GET' && roomId) result = await api.getRoom(credential, roomId);
    else if (req.method === 'POST' && path === '/api/players') result = await api.createPlayer(credential, body);
    else if (req.method === 'POST' && path === '/api/rooms') result = await api.createRoom(credential, body);
    else if (req.method === 'POST' && parts[3] === 'join') result = await api.joinRoom(credential, roomId, body.player_id);
    else if (req.method === 'POST' && parts[3] === 'leave') result = await api.leaveRoom(credential, roomId, body.player_id);
    else if (req.method === 'POST' && parts[3] === 'ban') result = await api.banPlayer(credential, roomId, body.player_id);
    else if (req.method === 'POST' && parts[3] === 'heartbeat') result = await api.heartbeatRoom(credential, roomId, body.version);
    else if (req.method === 'POST' && parts[3] === 'close') result = await api.closeRoom(credential, roomId, body.version);
    else return json(res, 404, {error:'Unknown directory operation'});
    json(res, 200, result);
  } catch (error) { json(res, error.status || 502, {error: error.message}); }
};
const port = Number(process.env.PORT || 3000);
await api.health();
http.createServer(route).listen(port, process.env.HOST || '127.0.0.1', () => console.log(`Service directory: http://127.0.0.1:${port}`));