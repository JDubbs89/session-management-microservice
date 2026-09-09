// Explicitly in-memory demo adapter; never a substitute for API integration tests.
import { randomUUID } from 'node:crypto';
export class MockApi {
  constructor() { this.users = new Map(); this.tokens = new Map(); this.sessions = new Map(); }
  async health() { return { status: 'mock' }; }
  user(token) { const u = this.users.get(this.tokens.get(token)); if (!u) throw new Error('Unauthenticated'); return u; }
  async register(u) { if (this.users.has(u.username)) throw new Error('Username taken'); this.users.set(u.username, { ...u, role: 'user' }); return { username: u.username, user_id: u.user_id, role: 'user' }; }
  async login(name, password) { const u = this.users.get(name); if (!u || u.password !== password) throw new Error('Invalid credentials'); const token = randomUUID(); this.tokens.set(token, name); return { access_token: token }; }
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
