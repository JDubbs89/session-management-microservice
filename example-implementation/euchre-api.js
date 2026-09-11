import { SessionApi } from './api.js';
// Legacy discovery and leased service membership are exercised by the same table.
export class EuchreApi extends SessionApi {
  constructor(base, credential, options = {}) {
    super(base, options.fetcher || fetch, options);
    this.credential = credential; this.tables = new Map(); this.players = new Map(); this.locks = new Map();
  }
  serial(code, work) {
    const run = (this.locks.get(code) || Promise.resolve()).catch(() => {}).then(work);
    this.locks.set(code, run);
    return run.finally(() => { if (this.locks.get(code) === run) this.locks.delete(code); });
  }
  async player(user) {
    const subject = user.subject || user.user_id;
    if (!this.players.has(subject)) this.players.set(subject, await this.createPlayer(this.credential, {subject}));
    return this.players.get(subject);
  }
  async create(token, session, metadata) {
    const user = await this.me(token);
    const player = await this.player(user);
    const body = {code: String(session.session_code), game: 'euchre', protocol: 'websocket-v1', capacity: 4, policy: 'public', public_address: ''};
    const room = await this.createRoom(this.credential, body);
    this.tables.set(session.session_code, {room, body});
    try {
      await this.joinRoom(this.credential, room.room_id, player.player_id);
      return await super.create(token, session, metadata);
    } catch (error) {
      await Promise.allSettled([
        this.closeRoom(this.credential, room.room_id, room.version),
        super.deleteSession(token, session.session_code, user.username)
      ]);
      this.tables.delete(session.session_code); throw error;
    }
  }
  async playerJoined(code, user) {
    return this.serial(code, async () => {
      const table = this.tables.get(code);
      if (!table) throw new Error('Table expired');
      await this.getRoom(this.credential, table.room.room_id);
      const player = await this.player(user);
      await this.joinRoom(this.credential, table.room.room_id, player.player_id);
    });
  }
  async playerLeft(code, user) {
    return this.serial(code, async () => {
      const table = this.tables.get(code);
      if (table) await this.leaveRoom(this.credential, table.room.room_id, (await this.player(user)).player_id);
    });
  }
  async update(token, code, changes) {
    return this.serial(code, async () => {
      const table = this.tables.get(code);
      if (table && changes.allow_join) {
        const room = await this.getRoom(this.credential, table.room.room_id);
        const body = {...table.body, policy: changes.allow_join === 'public' ? 'public' : 'private'};
        table.room = await this.editRoom(this.credential, room.room_id, {...body, version: room.version});
        table.body = body;
      }
      return super.update(token, code, changes);
    });
  }
  async deleteSession(token, code, host) {
    return this.serial(code, async () => {
      const table = this.tables.get(code);
      if (table) {
        let room;
        try { room = await this.getRoom(this.credential, table.room.room_id); }
        catch (error) { if (![404, 409].includes(error.status)) throw error; }
        if (room) await this.closeRoom(this.credential, room.room_id, room.version);
        this.tables.delete(code);
      }
      return super.deleteSession(token, code, host);
    });
  }
  async heartbeat() {
    const codes = [...this.tables.keys()];
    const results = await Promise.allSettled(codes.map(code => this.serial(code, async () => {
      const table = this.tables.get(code);
      if (!table) return;
      const room = await this.getRoom(this.credential, table.room.room_id);
      await this.heartbeatRoom(this.credential, room.room_id, room.version);
    })));
    return results.map((result, i) => ({...result, code: codes[i]}));
  }
  async discoverTables() {
    const rooms = await this.listRooms(this.credential, 100, 0);
    return rooms.filter(room => room.game === 'euchre' && this.tables.has(Number(room.code)));
  }
  async banFromTable(code, user) {
    return this.serial(code, async () => {
      const table = this.tables.get(code);
      if (!table) throw new Error('Table expired');
      await this.banPlayer(this.credential, table.room.room_id, (await this.player(user)).player_id);
    });
  }
  async deleteMe(token) {
    const user = await this.me(token), subject = user.subject || user.user_id;
    const player = await this.player(user);
    await this.deletePlayer(this.credential, player.player_id);
    this.players.delete(subject);
    return super.deleteMe(token);
  }
}
