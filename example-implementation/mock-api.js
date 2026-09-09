// Explicitly in-memory demo adapter; never a substitute for API integration tests.
import { randomUUID, randomBytes, createHmac } from 'node:crypto';
export class MockApi {
  constructor() { this.secret = randomBytes(32); this.users = new Map(); this.tokens = new Map(); this.sessions = new Map(); }
  async health() { return { status: 'mock' }; }
  user(token) { const session = this.tokens.get(token); const u = session && session.exp > Date.now() ? this.users.get(session.username) : null; if (!u) throw Object.assign(new Error('Unauthenticated'), {status: 401}); return u; }
  async register(u) { if (this.users.has(u.username)) throw Object.assign(new Error('Username taken'), {status: 409}); this.users.set(u.username, { ...u, role: 'user' }); return { username: u.username, user_id: u.user_id, role: 'user' }; }
  async login(name, password) { const u = this.users.get(name); if (!u || u.password !== password) throw Object.assign(new Error('Invalid credentials'), {status: 401}); const exp = Math.floor(Date.now() / 1000) + 1800; const header = Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url'); const payload = Buffer.from(JSON.stringify({sub:name,exp,jti:randomUUID()})).toString('base64url'); const input = `${header}.${payload}`; const token = `${input}.${createHmac('sha256',this.secret).update(input).digest('base64url')}`; this.tokens.set(token, { username: name, exp: exp * 1000 }); return { access_token: token }; }
  async me(t) { const { username, user_id, role } = this.user(t); return { username, user_id, role }; }
  async logout(t) { this.user(t); this.tokens.delete(t); }
  async deleteMe(t) { const u = this.user(t); this.users.delete(u.username); this.tokens.delete(t); }
  async create(t, s, b) { if (this.user(t).username !== s.host_username) throw new Error('Forbidden'); if (this.sessions.has(s.session_code)) throw new Error('Code taken'); const out = { ...s, beacon_metadata: b }; this.sessions.set(s.session_code, out); return out; }
  async byHost(t, name) { this.user(t); const s = [...this.sessions.values()].find(s => s.host_username === name); if (!s) throw new Error('Session not found'); return s; }
  async previewHost(t, name) { return (await this.byHost(t, name)).beacon_metadata; }
  async previewCode(t, code) { this.user(t); const s = this.sessions.get(Number(code)); if (!s) throw new Error('Session not found'); return s.beacon_metadata; }
  async update(t, code, settings) { const s = this.sessions.get(code); if (!s || s.host_username !== this.user(t).username) throw new Error('Forbidden'); Object.assign(s, settings); }
  async deleteSession(t, code, name) { if (this.user(t).username !== name) throw new Error('Forbidden'); this.sessions.delete(code); }
}
