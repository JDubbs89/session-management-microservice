const el = id => document.getElementById(id);
let user = null, room = null, preview = null, mode = 'login';
let connected = false, pending = null, cooldown = false, selected = null;
let lastSent = 0, serial = 0;
let ws;

function friendlyError(message) {
  if (!message.startsWith('API ')) return message;
  if (message.includes(': 401 ')) return 'Please check your sign-in details. If you were already playing, sign out and sign in again.';
  if (message.includes(': 429 ')) return 'Things are a little busy. Please wait a moment and try again.';
  if (message.includes(': 404 ')) return 'That room or account could not be found. Check the details and try again.';
  if (message.includes(': 403 ')) return 'You do not have access to this room or action.';
  return 'We couldn’t complete that request. Check your details and try again.';
}
function feedback(message = '', error = false) {
  el('feedback').hidden = !message;
  el('feedback').textContent = message;
  el('feedback').classList.toggle('error', error);
}
function render() {
  el('auth-view').hidden = !!user;
  el('connection').hidden = !user || connected;
  el('home-view').hidden = !user || !!room;
  el('room-view').hidden = !user || !room;
  el('account-button').hidden = !user;
  el('identity').textContent = user?.username || '';
  el('greeting').textContent = user ? `Player: ${user.username}` : 'Ready to play?';
  el('account-name').textContent = user?.username || '';
  el('room-preview').hidden = !preview;
  if (preview) {
    el('preview-title').textContent = `${preview.host_username}’s room`;
    el('preview-detail').textContent = `${preview.player_count} / ${preview.max_player_count} players · ${preview.session_flavortext}`;
  }
  if (room) {
    const host = room.host === user.username;
    const lobby = room.round < 0;
    el('room-phase').textContent = room.finished ? 'That’s a wrap' : lobby ? 'The waiting room' : 'Quiz in progress';
    el('room-title').textContent = `${room.host}’s room`;
    el('leave-button').textContent = host ? 'Close room' : 'Leave room';
    el('round-label').textContent = lobby ? 'Get everyone together' : room.finished ? 'Final results' : `Question ${room.round + 1} of ${room.totalQuestions}`;
    el('invite').hidden = !lobby;
    el('invite-code').textContent = room.code;
    el('choices').replaceChildren();
    el('answer-status').textContent = '';
    el('next-button').hidden = !host || room.finished;
    el('return-button').hidden = !room.finished;
    el('next-button').textContent = lobby ? 'Start quiz' : room.round + 1 === room.totalQuestions ? 'See results' : 'Next question';
    el('score-label').textContent = lobby ? 'Your players' : 'Scoreboard';
    el('player-help').textContent = lobby ? `${room.scores.length} of 4 places filled. You can also play solo.` : 'One point for each correct answer.';
    const ranked = [...room.scores].sort((a, b) => b.score - a.score);
    if (room.finished) {
      const winners = ranked.filter(p => p.score === ranked[0].score).map(p => p.name);
      el('question').textContent = winners.length > 1 ? 'It’s a tie!' : `${winners[0]} takes the win!`;
      el('room-description').textContent = `${winners.join(' & ')} finished with ${ranked[0].score} of ${room.totalQuestions} points. Head back to the lobby to start another room.`;
    } else if (lobby) {
      el('question').textContent = host ? 'Players, ready?' : 'You’re in. Get ready!';
      el('room-description').textContent = host ? 'Share your room code with friends, then start when everyone is here.' : `Invite a friend while you wait for ${room.host} to start the quiz.`;
    } else {
      el('question').textContent = room.question.text;
      el('room-description').textContent = 'Choose your answer. Once submitted, it’s locked in.';
      room.question.choices.forEach((choice, index) => {
        const button = document.createElement('button');
        button.className = 'choice';
        button.textContent = `${String.fromCharCode(65 + index)}. ${choice}`;
        button.classList.toggle('selected', selected === index);
        button.setAttribute('aria-pressed', String(selected === index));
        button.onclick = () => { selected = index; act({ action: 'answer', choice: index }); };
        el('choices').append(button);
      });
      el('answer-status').textContent = `${room.hasAnswered ? 'Answer locked in. ' : ''}${room.answered} of ${room.scores.length} players answered.${!host ? ' The host starts the next question.' : ''}`;
    }
    el('players').replaceChildren();
    (lobby ? room.scores : ranked).forEach(player => {
      const item = document.createElement('li');
      const name = document.createElement('span');
      name.textContent = player.name + (player.name === user.username ? ' (you)' : '');
      if (player.name === room.host) { const badge = document.createElement('small'); badge.textContent = 'Host'; name.append(badge); }
      const score = document.createElement('strong'); score.textContent = lobby ? 'Ready' : `${player.score} pts`;
      item.append(name, score); el('players').append(item);
    });
  }
  document.querySelectorAll('button').forEach(button => {
    button.disabled = (!!user && !connected) || !!pending || cooldown;
  });
  el('close-account').disabled = false;
  el('join-button').disabled ||= !preview || preview.player_count >= preview.max_player_count || ['ended', 'crashed', 'inactive'].includes(preview.session_status);
  document.querySelectorAll('.choice').forEach(button => { button.disabled ||= room?.hasAnswered; });
  el('auth-submit').textContent = pending && ['login', 'register'].includes(pending.action) ? 'Signing you in…' : mode === 'login' ? 'Sign in' : 'Create account & play';
  document.querySelector('main').setAttribute('aria-busy', String(!!pending));
}
async function account(action, body) {
  if (pending) return;
  pending = { action }; feedback(); render();
  try {
    const response = await fetch('/auth/' + (action === 'delete_me' ? 'delete' : action), {
      method: action === 'me' ? 'GET' : action === 'delete_me' ? 'DELETE' : 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    const data = await response.json();
    if (!response.ok) {
      if (response.status === 401) { user = null; room = null; preview = null; ws?.close(); }
      if (action === 'me' && response.status === 401) return;
      throw new Error(data.error || 'Unable to sign in.');
    }
    user = data.user; room = null; preview = null; el('password').value = '';
    if (user) { if (!ws || ws.readyState >= WebSocket.CLOSING) connect(); }
    else { ws?.close(); feedback('Signed out.'); }
  } catch (error) { feedback(error.message, true); }
  finally { pending = null; render(); }
}
function act(message) {
  if (['login', 'register', 'logout', 'delete_me'].includes(message.action)) {
    const { action, ...body } = message;
    return account(action, body);
  }
  if (!connected || pending || cooldown) return;
  feedback();
  pending = { ...message, id: ++serial };
  render();
  // Pace requests here so normal navigation never needs a rate-limit instruction.
  setTimeout(() => {
    if (!connected || !pending) return;
    lastSent = Date.now();
    ws.send(JSON.stringify(pending));
  }, Math.max(0, 1150 - (Date.now() - lastSent)));
}
function authMode(next) {
  mode = next;
  el('login-tab').setAttribute('aria-pressed', String(mode === 'login'));
  el('register-tab').setAttribute('aria-pressed', String(mode === 'register'));
  el('auth-title').textContent = mode === 'login' ? 'Player sign-in' : 'New player';
  el('auth-description').textContent = mode === 'login' ? 'Choose your player name and get ready.' : 'Pick a username your friends will recognize.';
  el('password').autocomplete = mode === 'login' ? 'current-password' : 'new-password';
  feedback(); render();
}
el('login-tab').onclick = () => authMode('login');
el('register-tab').onclick = () => authMode('register');
el('auth-form').onsubmit = event => {
  event.preventDefault();
  act({ action: mode, username: el('username').value.trim(), password: el('password').value });
};
el('host-button').onclick = () => act({ action: 'host' });
el('lookup-type').onchange = () => {
  const code = el('lookup-type').value === 'code';
  el('lookup-label').textContent = code ? 'Room code' : 'Host username';
  el('lookup').placeholder = code ? 'e.g. 123456' : 'e.g. quizmaster';
  el('lookup').inputMode = code ? 'numeric' : 'text';
  el('lookup').value = ''; preview = null; render();
};
el('find-form').onsubmit = event => {
  event.preventDefault(); preview = null;
  const value = el('lookup').value.trim();
  if (el('lookup-type').value === 'code' && !/^\d{6}$/.test(value)) return feedback('Enter the six-digit room code.', true);
  act({ action: 'preview', [el('lookup-type').value]: value });
};
el('join-button').onclick = () => act({ action: 'join', host: preview.host_username });
el('next-button').onclick = () => {
  if (room.round >= 0 && room.answered < room.scores.length && !confirm('Some players haven’t answered. Finish this question anyway?')) return;
  act({ action: 'next' });
};
function leave() {
  if (room.host === user.username && !room.finished && !confirm('Close this room for everyone?')) return;
  act({ action: 'leave' });
}
el('leave-button').onclick = leave;
el('return-button').onclick = leave;
el('copy-button').onclick = async () => {
  try { await navigator.clipboard.writeText(String(room.code)); feedback('Room code copied. Send it to your friends!'); }
  catch { feedback(`Share this room code: ${room.code}`); }
};
el('account-button').onclick = () => el('account-dialog').showModal();
el('close-account').onclick = () => el('account-dialog').close();
el('logout-button').onclick = () => {
  if (room?.host === user.username && !confirm('Sign out and close your room for everyone?')) return;
  el('account-dialog').close(); act({ action: 'logout' });
};
el('delete-button').onclick = () => {
  if (!confirm('Permanently delete your account and leave your room? This cannot be undone.')) return;
  el('account-dialog').close(); act({ action: 'delete_me' });
};
function connect() {
  ws = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/play`);
  ws.onopen = () => { connected = true; el('connection').hidden = true; render(); };
  ws.onmessage = event => {
    const data = JSON.parse(event.data);
    if ('user' in data) { user = data.user; el('password').value = ''; if (!user) { room = null; preview = null; } }
    if ('state' in data) {
      if (room?.round !== data.state?.round || room?.code !== data.state?.code) selected = null;
      room = data.state;
      if (!room) preview = null;
    }
    if (data.preview) preview = data.preview;
    if (data.error) { feedback(friendlyError(data.error), true); if (pending?.action === 'answer' && !room?.hasAnswered) selected = null; }
    if (data.notice && !data.notice.startsWith('Connected.')) feedback(data.notice);
    if (data.done !== undefined && data.done === pending?.id) {
      pending = null;
      cooldown = true;
      setTimeout(() => { cooldown = false; render(); }, Math.max(0, 1150 - (Date.now() - lastSent)));
    }
    render();
  };
  ws.onclose = event => {
    if (event.code === 4001) { user = null; room = null; preview = null; feedback('Your session ended. Sign in again.', true); }
    connected = false; pending = null;
    el('account-dialog').close();
    el('connection').hidden = !user;
    el('connection').textContent = 'Connection lost. Reconnect to return to the lobby.';
    const reload = document.createElement('button'); reload.textContent = 'Reconnect'; reload.className = 'quiet';
    reload.onclick = () => location.reload(); el('connection').append(' ', reload);
    render(); reload.disabled = false;
  };
  ws.onerror = () => feedback('Unable to connect to the game. Check that it is running.', true);
}
render();
account('me');
