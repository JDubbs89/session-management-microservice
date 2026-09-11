const $ = id => document.getElementById(id);
let user, socket, state, sequence = 0, pending = false, reconnect;
const showError = text => { $('feedback').textContent = text; $('feedback').hidden = !text; };
function button(label, action) { const el = document.createElement('button'); el.textContent = label; el.type = 'button'; el.onclick = action; return el; }
function text(parent, value, tag = 'p') { const el = document.createElement(tag); el.textContent = value; parent.append(el); return el; }
async function auth(action, body) {
  const response = await fetch(`/auth/${action}`, {method: action === 'me' ? 'GET' : action === 'delete' ? 'DELETE' : 'POST', headers: {'Content-Type': 'application/json'}, body: body ? JSON.stringify(body) : undefined});
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Unable to sign in');
  return data;
}
function send(message) {
  if (!socket || socket.readyState !== WebSocket.OPEN) return showError('Disconnected. Reconnect before playing.');
  if (pending) return showError('Wait for your previous action to finish.');
  showError(''); pending = true;
  socket.send(JSON.stringify({...message, id: ++sequence}));
}
function screens() {
  $('auth').hidden = !!user; $('lobby').hidden = !user || !!state;
  $('room').hidden = !state; $('social').hidden = !user;
  $('identity').textContent = user?.username || '';
  $('logout').hidden = $('delete').hidden = !user;
}
function connect() {
  clearTimeout(reconnect);
  socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/play`);
  socket.onopen = () => { $('connection').textContent = 'Connected · Ready to play'; };
  socket.onmessage = event => {
    const data = JSON.parse(event.data);
    if (data.done !== undefined) pending = false;
    if (data.user) { user = data.user; screens(); }
    if (Object.hasOwn(data, 'state')) { state = data.state; screens(); if (state) render(); }
    if (data.error || data.notice) showError(data.error || data.notice);
    if (data.preview) {
      $('preview').replaceChildren();
      const host = data.preview.host_username;
      text($('preview'), `${host}'s table`);
      $('preview').append(button('Join table', () => send({action: 'join', host})));
    }
    if (data.tables) {
      $('tables').replaceChildren();
      if (!data.tables.length) text($('tables'), 'No open tables. Create one and invite a friend.');
      for (const table of data.tables) $('tables').append(button(`${table.code} · ${table.member_count}/4 players`, () => send({action: 'preview', code: table.code})));
    }
    if (data.social) renderSocial(data.social);
  };
  socket.onclose = event => {
    pending = false; state = null; screens(); $('connection').textContent = 'Disconnected';
    if (event.code === 4001) { user = null; screens(); showError('Your session ended. Sign in again.'); }
    else if (user) reconnect = setTimeout(async () => {
      try { user = (await auth('me')).user; connect(); } catch (error) { user = null; screens(); showError(error.message); }
    }, 2500);
  };
  socket.onerror = () => { $('connection').textContent = 'Unable to connect. Close other tabs using this account and try again.'; };
}
function render() {
  $('table-title').textContent = `Table ${state.code}`;
  $('scores').replaceChildren(); state.scores.forEach((score, i) => text($('scores'), `Team ${i + 1} · ${score}`, 'span'));
  $('seats').replaceChildren();
  state.seats.forEach((name, i) => {
    const seat = document.createElement('div'); seat.className = `seat ${state.turn === i && ['bid', 'discard', 'play'].includes(state.phase) ? 'active' : ''}`;
    seat.dataset.position = String((i - state.seats.indexOf(user.username) + 4) % 4);
    text(seat, `${i + 1}. ${name}${name === user.username ? ' (you)' : ''}`, 'strong');
    text(seat, `Team ${i % 2 + 1}${state.dealer === i ? ' · Dealer' : ''}${state.sittingOut === i ? ' · Sitting out' : ''}`, 'small');
    if (state.phase === 'lobby' && state.host === user.username && name !== user.username) seat.append(button('Remove', () => send({action: 'ban', username: name})));
    $('seats').append(seat);
  });
  const myTurn = state.seats[state.turn] === user.username;
  const phases = {lobby: 'Ready to deal', bid: 'Call trump', discard: 'Dealer: discard one card', play: 'Play a card', handEnd: 'Hand complete', finished: 'Game complete'};
  $('phase').textContent = phases[state.phase] + (['bid', 'discard', 'play'].includes(state.phase) ? ` · ${myTurn ? 'Your turn' : state.seats[state.turn] + '’s turn'}` : '');
  $('notice').textContent = state.notice || 'Start now with three bots, or share the table code and wait for friends.';
  $('trump').textContent = state.trump ? `Trump ${state.trump} · Tricks ${state.tricks.join(' – ')}` : state.upcard ? `Turned card: ${state.upcard.id} · Bidding round ${state.bidRound}` : 'Empty seats will be filled by bots.';
  const trickText = trick => (trick || []).map(entry => `${state.seats[entry.seat]}: ${entry.card.id}`).join('   ·   ');
  $('trick').replaceChildren();
  if (!state.trick?.length) text($('trick'), '♣  ♦  ♥  ♠', 'span');
  for (const entry of state.trick || []) {
    const played = document.createElement('div'); played.className = 'played-card';
    text(played, entry.card.id, 'strong'); text(played, state.seats[entry.seat], 'small');
    if (['♥', '♦'].includes(entry.card.suit)) played.classList.add('red');
    $('trick').append(played);
  }
  $('last-trick').textContent = state.lastTrick?.length ? `Previous trick: ${trickText(state.lastTrick)}` : '';
  $('bid').replaceChildren(); $('alone-box').hidden = !(myTurn && state.phase === 'bid');
  if (myTurn && state.phase === 'bid') {
    const choices = ['♣', '♠', '♥', '♦'].filter(s => state.bidRound === 1 ? s === state.upcard.suit : s !== state.upcard.suit);
    for (const suit of choices) $('bid').append(button(`Call ${suit}`, () => send({action: 'card', move: {type: 'bid', suit, alone: $('alone').checked}})));
    if (!(state.bidRound === 2 && state.turn === state.dealer)) $('bid').append(button('Pass', () => send({action: 'card', move: {type: 'pass'}})));
  }
  $('hand').replaceChildren();
  for (const card of state.hand) {
    const el = button(card.id, () => send({action: 'card', move: {type: state.phase === 'discard' ? 'discard' : 'play', card: card.id}}));
    el.replaceChildren(); text(el, card.rank, 'span'); text(el, card.suit, 'b');
    el.className = `playing-card ${['♥', '♦'].includes(card.suit) ? 'red' : ''}`; el.disabled = !state.legal.includes(card.id);
    el.setAttribute('aria-label', `${card.rank} of ${{'♣':'clubs','♠':'spades','♥':'hearts','♦':'diamonds'}[card.suit]}`); $('hand').append(el);
  }
  $('deal').hidden = state.host !== user.username || !['lobby', 'handEnd'].includes(state.phase);
  $('deal').textContent = state.phase === 'lobby' ? (state.seats.length === 1 ? 'Deal · play with bots' : 'Deal · start game') : 'Deal next hand';
}
function renderSocial(data) {
  $('friends').replaceChildren(); $('requests').replaceChildren();
  if (!data.friends.length) text($('friends'), 'Add a friend to find their next game here.');
  for (const friend of data.friends) {
    const row = document.createElement('div'); row.className = 'social-row'; text(row, friend.username, 'strong');
    row.append(button('Find table', () => send({action: 'preview', host: friend.username})), button('Remove friend', () => send({action: 'social', operation: 'remove', friendId: friend.user_id}))); $('friends').append(row);
  }
  if (!data.requests.length) text($('requests'), 'No pending requests.');
  for (const request of data.requests) {
    const row = document.createElement('div'); row.className = 'social-row'; text(row, `${request.sender} → ${request.recipient}`, 'span');
    for (const resolution of request.sender === user.username ? ['cancel'] : ['accept', 'reject']) row.append(button(resolution, () => send({action: 'social', operation: 'resolve', requestId: request.id, resolution})));
    $('requests').append(row);
  }
}
$('auth-form').onsubmit = async event => {
  event.preventDefault(); if (pending) return; pending = true;
  try { user = (await auth(event.submitter.value, {username: $('username').value, password: $('password').value})).user; $('password').value = ''; showError(''); screens(); connect(); }
  catch (error) { showError(error.message); } finally { pending = false; }
};
for (const action of ['logout', 'delete']) $(action).onclick = async () => {
  if (pending) return showError('Wait for the current action to finish.');
  if (action === 'delete' && !confirm('Permanently delete your account and friendships?')) return;
  pending = true;
  try { await auth(action); user = null; state = null; clearTimeout(reconnect); socket?.close(); screens(); }
  catch (error) { showError(error.message); } finally { pending = false; }
};
$('host').onclick = () => send({action: 'host'});
$('leave').onclick = () => send({action: 'leave'});
$('deal').onclick = () => { $('alone').checked = false; send({action: 'next'}); };
$('refresh-tables').onclick = () => send({action: 'tables'});
$('refresh-friends').onclick = () => send({action: 'social', operation: 'list'});
$('friend-form').onsubmit = event => { event.preventDefault(); send({action: 'social', operation: 'send', username: $('friend-name').value}); };
$('find-form').onsubmit = event => { event.preventDefault(); send({action: 'preview', [$('lookup-type').value]: $('lookup').value}); };
(async () => { try { user = (await auth('me')).user; screens(); connect(); } catch { $('connection').textContent = 'Sign in to play'; screens(); } })();
