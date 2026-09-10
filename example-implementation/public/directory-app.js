const $ = selector => document.querySelector(selector);
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const initials = name => escape(String(name).slice(0,2).toUpperCase());
document.addEventListener('click',event=>{if(state.busy&&event.target.closest('button')){event.preventDefault();event.stopPropagation();}},true);
const state = {view:'users', users:[], groups:[], query:{users:'',groups:''}, more:{users:false,groups:false}, selected:{users:null,groups:null}, room:null, busy:false, keepAlive:false};
let editorContext, searchTimer;
async function call(path, options={}) {
  let response;
  try { response=await fetch(`/api${path}`,{...options,headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(15000)}); }
  catch { throw new Error('The directory could not be reached. Your changes are still here; refresh before retrying.'); }
  const data=await response.json().catch(()=>null);
  if(!response.ok) throw Object.assign(new Error(data?.error || 'The request failed. Please try again.'),{status:response.status});
  return data;
}
const send = (path,method,body) => call(path,{method,body:body ? JSON.stringify(body) : undefined});
function notice(message,error=false) { const node=$('#status');node.hidden=!message;node.textContent=message;node.classList.toggle('error',error); }
function busy(value) {
  state.busy=value; $('main').setAttribute('aria-busy',String(value));
  for(const button of document.querySelectorAll('button')) {
    if(value) {button.dataset.disabled=String(button.disabled);button.disabled=true;}
    else if('disabled' in button.dataset) {button.disabled=button.dataset.disabled==='true';delete button.dataset.disabled;}
  }
}
async function run(action) {
  if(state.busy) return;
  busy(true);
  try {await action();} catch(error) {notice(error.message,true);} finally {busy(false);}
}
async function load(view,append=false) {
  const rows=await call(`/${view==='users'?'players':'rooms'}?limit=100&offset=${append?state[view].length:0}&q=${encodeURIComponent(state.query[view])}`);
  state[view]=append?[...state[view],...rows]:rows; state.more[view]=rows.length===100;
}
function renderList() {
  const view=state.view;
  for(const type of ['users','groups']) $(`#${type}-count`).textContent=`${state[type].length}${state.more[type]?'+':''}`;
  $('#load-more').hidden=!state.more[view];
  $('#records').innerHTML=state[view].map(item=>{
    const user=view==='users',id=user?item.player_id:item.room_id,name=user?item.subject:item.code;
    const subtitle=user?`${item.groups?.length||0} group${item.groups?.length===1?'':'s'}${item.shared?' · Shared user':''}`:`${item.member_count||0} / ${item.capacity} members · ${item.policy==='private'?'Private':'Public'}`;
    return `<button class="record ${state.selected[view]===id?'selected':''}" data-select="${escape(id)}" aria-pressed="${state.selected[view]===id}"><span class="avatar ${user?'':'group'}">${user?initials(name):'#'}</span><span class="record-text"><strong>${escape(name)}</strong><small>${escape(subtitle)}</small></span><span class="chevron" aria-hidden="true">›</span></button>`;
  }).join('') || `<div class="empty"><strong>${state.query[view]?'No matching '+view:'No '+view+' yet'}</strong><p>${state.query[view]?'Try a different name or clear the search.':view==='users'?'Add your first user, then bring them into a group.':'Create a group to start organizing your users.'}</p>${state.query[view]?'':`<button class="primary" data-new="${view}">+ Add ${view==='users'?'user':'group'}</button>`}</div>`;
}
function switchView(view) {
  state.view=view;
  for(const button of document.querySelectorAll('[data-view]')) {button.classList.toggle('active',button.dataset.view===view);if(button.dataset.view===view)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');}
  $('#page-title').textContent=view==='users'?'Users':'Groups';
  $('#page-description').textContent=view==='users'?'Find people, update their details, and manage group membership.':'Bring users together and keep live groups organized.';
  $('#list-title').textContent=view==='users'?'All users':'Your groups';
  $('#add').textContent=view==='users'?'+ Add user':'+ Add group';
  $('#search').placeholder=`Search ${view}…`; $('#search').value=state.query[view];
  renderList(); renderDetail();
}
const userOptions = excluded => state.users.filter(u=>!excluded.includes(u.player_id)).map(u=>`<option value="${escape(u.player_id)}">${escape(u.subject)}</option>`).join('');
const groupOptions = excluded => state.groups.filter(g=>!excluded.includes(g.room_id)).map(g=>`<option value="${escape(g.room_id)}">${escape(g.code)}</option>`).join('');
function renderDetail() {
  const user=state.users.find(u=>u.player_id===state.selected.users);
  const group=state.room;
  if((state.view==='users'&&!user)||(state.view==='groups'&&(!group||group.room_id!==state.selected.groups))) {
    $('#detail').innerHTML=`<div class="empty-detail"><span class="empty-icon">↗</span><h2>${state.view==='users'?'A place for everyone.':'Better together.'}</h2><p>Select a ${state.view==='users'?'user':'group'} to see details and manage membership.</p></div>`;return;
  }
  if(state.view==='users') {
    const groups=user.groups||[],options=groupOptions(groups.map(g=>g.room_id));
    $('#detail').innerHTML=`<div class="profile-heading"><span class="avatar large">${initials(user.subject)}</span><div class="identity"><h2>${escape(user.subject)}</h2><span class="badge">${user.shared?'Shared user':'Service user'}</span></div><button class="secondary" data-edit="users" ${user.shared?'disabled title="Shared users cannot be renamed"':''}>Edit</button></div>
      <div class="section"><div class="section-heading"><h3>Groups <span class="muted">(${groups.length})</span></h3></div>${groups.map(g=>`<div class="member"><span class="avatar group">#</span><span class="member-name">${escape(g.code)}</span><button class="text-button" data-open-group="${escape(g.room_id)}">View</button><button class="text-danger" data-remove-from="${escape(g.room_id)}">Remove</button></div>`).join('')||'<p class="inline-empty">Not in a group yet. Choose one below to get started.</p>'}
      <form id="membership" class="inline-form"><label><span class="sr-only">Group to add this user to</span><select name="target" required><option value="">Choose a group…</option>${options}</select></label><button class="primary" ${options?'':'disabled'}>Add to group</button></form><p class="help">Missing a group? Open Groups to find or create one.</p></div>
      <div class="section"><details><summary>User identifier</summary><p class="identifier">${escape(user.player_id)}</p></details></div><div class="section danger-zone"><p>${user.shared?'Shared users must be unshared by an operator before deletion.':'Deleting this user also removes their group memberships.'}</p><button class="text-danger" data-delete-user ${user.shared?'disabled':''}>Delete user</button></div>`;
  } else {
    const members=group.member_details || group.members.map(id=>({player_id:id,subject:state.users.find(u=>u.player_id===id)?.subject||'User '+id.slice(0,8)}));
    const options=userOptions(group.members);
    $('#detail').innerHTML=`<div class="profile-heading"><span class="avatar large group">#</span><div class="identity"><h2>${escape(group.code)}</h2><span class="badge ${group.policy==='private'?'private':''}">${group.policy==='private'?'Private group':'Public group'}</span></div><button class="secondary" data-edit="groups">Edit</button></div>
      <div class="section"><dl class="facts"><div><dt>Activity</dt><dd>${escape(group.game)}</dd></div><div><dt>Capacity</dt><dd>${group.members.length} of ${group.capacity} members</dd></div></dl><div class="lease"><div class="lease-row"><span id="lease-time"></span><button class="text-button" data-renew>Renew now</button></div><label class="check-label"><input id="keep-alive" type="checkbox" ${state.keepAlive?'checked':''}>Keep this selected group active while this page is open</label></div></div>
      <div class="section"><div class="section-heading"><h3>Members <span class="muted">(${members.length})</span></h3><button class="text-button" data-create-member>+ Create user</button></div>${members.map(member=>`<div class="member"><span class="avatar">${initials(member.subject)}</span><span class="member-name">${escape(member.subject)}</span><button class="text-danger" data-remove-member="${escape(member.player_id)}">Remove</button><button class="text-danger" data-ban-member="${escape(member.player_id)}">Ban</button></div>`).join('')||'<p class="inline-empty">No members yet. Add an existing user or create one here.</p>'}
      <form id="membership" class="inline-form"><label><span class="sr-only">User to add to this group</span><select name="target" required><option value="">Choose a user…</option>${options}</select></label><button class="primary" ${options&&members.length<group.capacity?'':'disabled'}>Add member</button></form>${members.length>=group.capacity?'<p class="help">This group is full. Edit its capacity to add more members.</p>':'<p class="help">Open Users to search or load additional users.</p>'}</div>
      <div class="section"><details><summary>Connection details</summary><dl class="facts"><div><dt>Protocol</dt><dd>${escape(group.protocol)}</dd></div><div><dt>Public address</dt><dd>${escape(group.public_address||'Not set')}</dd></div></dl><p class="identifier">${escape(group.room_id)}</p></details></div><div class="section danger-zone"><p>Closing a group removes all memberships.</p><button class="text-danger" data-close-group>Close group</button></div>`;
    updateLease();
  }
}
function updateLease() {if(!$('#lease-time')||!state.room)return;const seconds=Math.max(0,Math.ceil((new Date(state.room.lease_until)-Date.now())/1000));$('#lease-time').textContent=seconds?`Lease expires in ${seconds}s`:'Lease expired · refresh this group';}
async function inspect(id) {
  state.selected.groups=id;
  try {state.room=await call(`/rooms/${encodeURIComponent(id)}`);} catch(error) {state.room=null;state.selected.groups=null;renderDetail();throw error;}
  renderList();renderDetail();
}
async function refresh() {
  await load('users');await load('groups');
  if(state.selected.groups) {
    try {await inspect(state.selected.groups);} catch(error) {if(error.status!==404)throw error;notice('The previously selected group has expired or closed.',true);}
  }
  renderList();renderDetail();
}
function openEditor(type,item=null,joinGroup=null) {
  editorContext={type,item,joinGroup};const user=type==='users',editing=!!item;
  $('#editor-title').textContent=`${editing?'Edit': 'Add'} ${user?'user':'group'}`;
  $('#editor-description').textContent=user?'Use a recognizable name so this user is easy to find.':'Set a name and capacity. Connection settings are optional for this demo.';
  $('#save').textContent=editing?'Save changes':user?'Add user':'Create group';
  $('#form-error').hidden=true;
  $('#editor-fields').innerHTML=user?`<label>User name<input name="subject" maxlength="128" value="${escape(item?.subject||'')}" placeholder="e.g. Alex Morgan" autocomplete="off" required></label>${editing?'':`<details><summary>Link an external identity (optional)</summary><label>Provider<input name="provider" maxlength="64" placeholder="e.g. steam"></label><label>External identifier<input name="external_subject" maxlength="256" placeholder="Provider’s user identifier"></label></details>`}`:
    `<label>Group name<input name="code" maxlength="64" pattern="[A-Za-z0-9_-]+" value="${escape(item?.code||'')}" placeholder="e.g. weekend-crew" required><span class="help">Letters, numbers, hyphens, and underscores.</span></label><div class="split"><label>Activity<input name="game" maxlength="64" value="${escape(item?.game||'General')}" required></label><label>Member limit<input name="capacity" type="number" min="${item?.members?.length||1}" max="1000" value="${item?.capacity||8}" required></label></div><label>Visibility<select name="policy"><option value="public" ${item?.policy!=='private'?'selected':''}>Public — appears in the directory</option><option value="private" ${item?.policy==='private'?'selected':''}>Private — managed by this service</option></select></label><details><summary>Connection settings</summary><label>Protocol<input name="protocol" maxlength="64" value="${escape(item?.protocol||'directory-v1')}" required></label><label>Public address<input name="public_address" type="url" maxlength="2048" value="${escape(item?.public_address||'')}" placeholder="wss://play.example.com"></label><p class="help">Addresses must use an origin approved by the service operator. Leave blank for this demo.</p></details>`;
  $('#editor').showModal();$('#editor-fields input').focus();
}
function confirmAction(title,description,label) {
  const dialog=$('#confirmation');$('#confirm-title').textContent=title;$('#confirm-description').textContent=description;$('#confirm-action').textContent=label;dialog.returnValue='cancel';dialog.showModal();
  return new Promise(resolve=>dialog.addEventListener('close',()=>resolve(dialog.returnValue==='confirm'),{once:true}));
}
$('#edit-form').onsubmit=async event=>{
  event.preventDefault();if(state.busy)return;
  const form=new FormData(event.target),context=editorContext,user=context.type==='users';
  const value=name=>String(form.get(name)||'').trim();
  if(user&&Boolean(value('provider'))!==Boolean(value('external_subject'))) {$('#form-error').textContent='Enter both a provider and an external identifier, or leave both blank.';$('#form-error').hidden=false;return;}
  busy(true);$('#form-error').hidden=true;
  try {
    let body=user?{subject:value('subject')}:{code:value('code'),game:value('game'),capacity:Number(form.get('capacity')),policy:value('policy'),protocol:value('protocol'),public_address:value('public_address')};
    if(user&&!context.item) body.external_identities=value('provider')?{[value('provider')]:value('external_subject')}:{};
    if(context.item) body=user?{...body,previous_subject:context.item.subject}:{...body,version:context.item.version};
    const path=user?'/players':'/rooms',id=context.item?(user?context.item.player_id:context.item.room_id):null;
    const saved=await send(path+(id?'/'+encodeURIComponent(id):''),id?'PATCH':'POST',body);
    $('#editor').close();notice(`${user?'User':'Group'} ${context.item?'updated':'created'}.`);
    state.query[context.type]='';
    if(context.joinGroup) {
      try {await send(`/rooms/${encodeURIComponent(context.joinGroup)}/join`,'POST',{player_id:saved.player_id});notice('User created and added to the group.');}
      catch(error){notice('User created, but could not be added to the group. '+error.message,true);}
      await load('users');await load('groups');switchView('groups');await inspect(context.joinGroup);
    } else {
      state.selected[context.type]=user?saved.player_id:saved.room_id;
      await load('users');await load('groups');switchView(context.type);
      if(!user) await inspect(saved.room_id);
    }
    renderList();renderDetail();
  } catch(error) {
    if($('#editor').open) {$('#form-error').textContent=error.message;$('#form-error').hidden=false;}
    else notice('Your change was saved, but the view could not refresh. '+error.message,true);
  } finally {busy(false);}
};
for(const button of document.querySelectorAll('[data-dismiss]')) button.onclick=()=>$('#editor').close();
$('#editor').addEventListener('cancel',event=>{if(state.busy)event.preventDefault();});
$('#add').onclick=()=>openEditor(state.view);
$('#refresh').onclick=()=>run(async()=>{await refresh();notice('Directory refreshed.');});
for(const button of document.querySelectorAll('[data-view]')) button.onclick=()=>{clearTimeout(searchTimer);switchView(button.dataset.view);};
$('#search').oninput=()=>{clearTimeout(searchTimer);const view=state.view;state.query[view]=$('#search').value;const search=()=>{if(state.view!==view)return;if(state.busy){searchTimer=setTimeout(search,150);return;}run(async()=>{await load(view);renderList();renderDetail();});};searchTimer=setTimeout(search,300);};
$('#load-more').onclick=()=>run(async()=>{await load(state.view,true);renderList();});
$('#records').onclick=event=>{
  const card=event.target.closest('[data-select]'),add=event.target.closest('[data-new]');
  if(add) return openEditor(add.dataset.new);
  if(!card)return;
  if(state.view==='users'){state.selected.users=card.dataset.select;renderList();renderDetail();}
  else run(()=>inspect(card.dataset.select));
};
$('#detail').onsubmit=event=>{
  if(event.target.id!=='membership')return;event.preventDefault();const target=new FormData(event.target).get('target');if(!target)return;
  run(async()=>{const id=state.view==='groups'?state.room.room_id:target,player=state.view==='users'?state.selected.users:target;
    await send(`/rooms/${encodeURIComponent(id)}/join`,'POST',{player_id:player});await refresh();notice('User added to the group.');});
};
$('#detail').onchange=event=>{if(event.target.id==='keep-alive')state.keepAlive=event.target.checked;};
$('#detail').onclick=async event=>{
  const button=event.target.closest('button');if(!button||state.busy)return;
  const user=state.users.find(u=>u.player_id===state.selected.users),group=state.room;
  if(button.dataset.edit) return openEditor(button.dataset.edit,button.dataset.edit==='users'?user:group);
  if('createMember' in button.dataset)return openEditor('users',null,group.room_id);
  if(button.dataset.openGroup)return run(async()=>{switchView('groups');await inspect(button.dataset.openGroup);});
  if('deleteUser' in button.dataset) {
    if(!await confirmAction(`Delete ${user.subject}?`,'This removes the user and all their memberships. This cannot be undone.','Delete user'))return;
    return run(async()=>{await send(`/players/${encodeURIComponent(user.player_id)}`,'DELETE');state.selected.users=null;await refresh();notice('User deleted.');});
  }
  if('closeGroup' in button.dataset) {
    if(!await confirmAction(`Close ${group.code}?`,'All members will be removed. You can create a new group with the same name afterwards.','Close group'))return;
    return run(async()=>{await send(`/rooms/${encodeURIComponent(group.room_id)}/close`,'POST',{version:group.version});state.selected.groups=null;state.room=null;await refresh();notice('Group closed.');});
  }
  const removed=button.dataset.removeMember||button.dataset.banMember||('removeFrom' in button.dataset?user.player_id:null);
  if(removed) {
    const ban=!!button.dataset.banMember,id=button.dataset.removeFrom||group.room_id;
    const name=state.users.find(u=>u.player_id===removed)?.subject||group?.member_details?.find(u=>u.player_id===removed)?.subject||'this user';
    if(!await confirmAction(`${ban?'Ban':'Remove'} ${name}?`,ban?'This user cannot rejoin this group. Bans last until the group closes.':'They can be added back to this group later.',ban?'Ban user':'Remove member'))return;
    return run(async()=>{await send(`/rooms/${encodeURIComponent(id)}/${ban?'ban':'leave'}`,'POST',{player_id:removed});await refresh();notice(ban?'User banned from this group.':'User removed from the group.');});
  }
  if('renew' in button.dataset) return run(async()=>{await renew();notice('Group lease renewed for 90 seconds.');});
};
async function renew() {
  const room=state.room;
  if(!room)return;
  const result=await send(`/rooms/${encodeURIComponent(room.room_id)}/heartbeat`,'POST',{version:room.version});
  room.version=result.version;room.lease_until=result.lease_until;updateLease();
}
setInterval(updateLease,1000);
setInterval(()=>{if(state.keepAlive&&state.view==='groups'&&state.room&&!state.busy&&!$('#editor').open&&!$('#confirmation').open)run(renew);},30000);
run(async()=>{await refresh();notice('');});
