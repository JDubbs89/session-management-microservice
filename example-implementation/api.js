export class SessionApi {
  constructor(base = 'http://127.0.0.1:8000', fetcher = fetch) { this.base = base; this.fetcher = fetcher; this.queue = Promise.resolve(); this.lastRequest = 0; this.spacing = fetcher === fetch ? 1100 : 0; }
  request(method, path, token, body, query) {
    const run = this.queue.then(async () => {
      const delay = this.spacing - (Date.now() - this.lastRequest);
      if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
      this.lastRequest = Date.now();
      return this.perform(method, path, token, body, query);
    });
    this.queue = run.catch(() => {});
    return run;
  }
  async perform(method, path, token, body, query) {
    const url = new URL(path, this.base);
    if (query) url.search = new URLSearchParams(query);
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    if (body) headers['Content-Type'] = body instanceof URLSearchParams ? 'application/x-www-form-urlencoded' : 'application/json';
    const response = await this.fetcher(url, { method, headers, body: body ? body instanceof URLSearchParams ? body.toString() : JSON.stringify(body) : undefined, signal: AbortSignal.timeout(10000) });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(`API ${method} ${path}: ${response.status} ${JSON.stringify(data)}`);
    return data;
  }
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
  byHost(token, friend_name, session_passcode = '') { return this.request('GET', '/sessions/read_friend_session', token, null, { friend_name, session_passcode }); }
  previewHost(token, friend_name) { return this.request('GET', '/sessions/read_friend_session_data', token, null, { friend_name }); }
  previewCode(token, session_code) { return this.request('GET', '/sessions/read_session_data', token, null, { session_code }); }
  update(token, session_code, settings_to_update) { return this.request('PUT', '/sessions/update', token, { session_code, session_passcode: '', settings_to_update }); }
  deleteSession(token, session_code, host_username) { return this.request('DELETE', '/sessions/delete', token, null, { session_code, host_username, session_passcode: '' }); }
}
