export class SessionApi {
  constructor(base = 'http://127.0.0.1:8000', fetcher = fetch, { timeoutMs = 10000, spacingMs = fetcher === fetch ? 1100 : 0 } = {}) {
    this.base = base; this.fetcher = fetcher; this.timeoutMs = timeoutMs;
    this.queues = new Map(); this.lastRequests = new Map(); this.spacing = spacingMs;
  }
  request(method, path, token, body, query, extraHeaders) {
    // Independent users must not wait behind another player's network timeout.
    const key = token || 'anonymous';
    const deadline = Date.now() + this.timeoutMs;
    const run = (this.queues.get(key) || Promise.resolve()).then(async () => {
      const delay = this.spacing - (Date.now() - (this.lastRequests.get(key) || 0));
      if (delay > 0) await new Promise(resolve => setTimeout(resolve, Math.min(delay, this.timeoutMs)));
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw Object.assign(new Error('Game service timed out. Try again.'), {status: 504});
      this.lastRequests.set(key, Date.now());
      return this.perform(method, path, token, body, query, extraHeaders, remaining);
    });
    const settled = run.catch(() => {}).finally(() => {
      if (this.queues.get(key) === settled) this.queues.delete(key);
      for (const [principal, timestamp] of this.lastRequests) if (timestamp < Date.now() - 60000) this.lastRequests.delete(principal);
    });
    this.queues.set(key, settled);
    return run;
  }
  async perform(method, path, token, body, query, extraHeaders, timeoutMs = this.timeoutMs) {
    const url = new URL(path, this.base);
    if (query) url.search = new URLSearchParams(query);
    const headers = { ...extraHeaders, ...(token ? { Authorization: `Bearer ${token}` } : {}) };
    if (body) headers['Content-Type'] = body instanceof URLSearchParams ? 'application/x-www-form-urlencoded' : 'application/json';
    let response;
    try { response = await this.fetcher(url, { method, headers, body: body ? body instanceof URLSearchParams ? body.toString() : JSON.stringify(body) : undefined, signal: AbortSignal.timeout(timeoutMs) }); }
    catch (error) {
      const status = ['TimeoutError', 'AbortError'].includes(error.name) ? 504 : 503;
      const message = status === 504
        ? `Session API timed out at ${url.origin}. Check that the API is running.`
        : `Session API is unavailable at ${url.origin}. Start it or set SESSION_API_URL to a reachable API.`;
      throw Object.assign(new Error(message), {status});
    }
    const data = await response.json().catch(() => null);
    if (!response.ok) throw Object.assign(new Error(`API ${method} ${path}: ${response.status}`), { status: response.status, retryAfter: response.headers?.get('retry-after') });
    return data;
  }
  friends(token) { return this.request('GET', '/friends', token); }
  friendRequests(token) { return this.request('GET', '/friends/requests', token); }
  sendFriendRequest(token, username) { return this.request('POST', '/friends/requests', token, {username}); }
  resolveFriendRequest(token, id, action) { return this.request('POST', `/friends/requests/${encodeURIComponent(id)}`, token, {action}); }
  removeFriend(token, id) { return this.request('DELETE', `/friends/${encodeURIComponent(id)}`, token); }
  health() { return this.request('GET', '/'); }
  register(user) { return this.request('POST', '/users/register', null, user); }
  registerAdmin(token, user) { return this.request('POST', '/users/register_admin', token, user); }
  login(username, password) { return this.request('POST', '/users/login', null, new URLSearchParams({ username, password })); }
  me(token) { return this.request('GET', '/users/me', token); }
  getUser(token, username) { return this.request('GET', '/users/get_user', token, null, { target_username: username }); }
  logout(token) { return this.request('POST', '/users/logout', token); }
  deleteUser(token, username, password) { return this.request('DELETE', '/users/delete', token, { username, password }); }
  deleteMe(token) { return this.request('DELETE', '/users/delete_me', token); }
  create(token, session, beacon_metadata) { return this.request('POST', '/sessions/create', token, { session, beacon_metadata }); }
  byHost(token, friend_name, session_passcode = '') { return this.request('GET', '/sessions/read_friend_session', token, null, { friend_name }, session_passcode ? { 'X-Session-Passcode': session_passcode } : {}); }
  previewHost(token, friend_name) { return this.request('GET', '/sessions/read_friend_session_data', token, null, { friend_name }); }
  previewCode(token, session_code) { return this.request('GET', '/sessions/read_session_data', token, null, { session_code }); }
  update(token, session_code, settings_to_update) { return this.request('PUT', '/sessions/update', token, { session_code, session_passcode: '', settings_to_update }); }
  deleteSession(token, session_code, host_username) { return this.request('DELETE', '/sessions/delete', token, null, { session_code, host_username }); }
  createService(token, service) { return this.request('POST', '/v1/services', token, service); }
  rotateService(token, serviceId) { return this.request('POST', `/v1/services/${encodeURIComponent(serviceId)}/rotate`, token); }
  grantPlayer(token, serviceId, playerId) { return this.request('POST', `/v1/services/${encodeURIComponent(serviceId)}/players/${encodeURIComponent(playerId)}`, token); }
  serviceRequest(method, path, credential, body, query) { return this.request(method, `/v1${path}`, null, body, query, { Authorization: `Service ${credential}` }); }
  createPlayer(credential, player) { return this.serviceRequest('POST', '/players', credential, player); }
  listPlayers(credential, limit = 100, offset = 0, q = '') { return this.serviceRequest('GET', '/players', credential, null, {limit, offset, q}); }
  editPlayer(credential, playerId, body) { return this.serviceRequest('PATCH', `/players/${encodeURIComponent(playerId)}`, credential, body); }
  editRoom(credential, roomId, body) { return this.serviceRequest('PATCH', `/rooms/${encodeURIComponent(roomId)}`, credential, body); }
  deletePlayer(credential, playerId) { return this.serviceRequest('DELETE', `/players/${encodeURIComponent(playerId)}`, credential); }
  createRoom(credential, room) { return this.serviceRequest('POST', '/rooms', credential, room); }
  listRooms(credential, limit = 100, offset = 0, extra = {}) { return this.serviceRequest('GET', '/rooms', credential, null, { limit, offset, ...extra }); }
  getRoom(credential, roomId) { return this.serviceRequest('GET', `/rooms/${encodeURIComponent(roomId)}`, credential); }
  joinRoom(credential, roomId, playerId) { return this.serviceRequest('POST', `/rooms/${encodeURIComponent(roomId)}/join`, credential, { player_id: playerId }); }
  leaveRoom(credential, roomId, playerId) { return this.serviceRequest('POST', `/rooms/${encodeURIComponent(roomId)}/leave`, credential, { player_id: playerId }); }
  banPlayer(credential, roomId, playerId) { return this.serviceRequest('POST', `/rooms/${encodeURIComponent(roomId)}/ban`, credential, { player_id: playerId }); }
  heartbeatRoom(credential, roomId, version) { return this.serviceRequest('POST', `/rooms/${encodeURIComponent(roomId)}/heartbeat`, credential, { version }); }
  closeRoom(credential, roomId, version) { return this.serviceRequest('POST', `/rooms/${encodeURIComponent(roomId)}/close`, credential, { version }); }
}
