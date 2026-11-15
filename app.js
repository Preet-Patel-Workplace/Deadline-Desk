import { firebaseConfig } from './firebase-config.js';

const FB_VERSION = '10.12.2';
const FB_URL = 'https://www.gstatic.com/firebasejs/' + FB_VERSION + '/';
const STORE_KEY = 'deadline-desk-v1';
const TYPES = ['Assignment','Quiz','Project','Lab','Midterm Exam','Final Exam','Reading','Other'];

const $ = (id) => document.getElementById(id);

let data = [];
let filters = { q:'', type:'all', mode:'all', course:'all', showDone:false };
let editingId = null;
let pendingDeleteId = null;

/* ================= storage =================
   Two modes:
   - "cloud": Firebase is configured -> Google sign-in + Firestore (users/{uid}/deadlines)
   - "local": Firebase not configured -> localStorage on this device only
*/
let mode = 'local';
let fb = null;        // firebase modules + instances
let currentUser = null;
let unsubscribe = null;

function uid(){ return Date.now().toString(36) + Math.random().toString(36).slice(2,8); }

function isFirebaseConfigured(){
  return firebaseConfig && firebaseConfig.apiKey && firebaseConfig.apiKey.indexOf('PASTE_') !== 0;
}

function loadLocal(){
  try{
    const parsed = JSON.parse(localStorage.getItem(STORE_KEY) || '[]');
    if(Array.isArray(parsed)) return parsed;
  }catch(e){}
  return [];
}
function saveLocal(){
  try{ localStorage.setItem(STORE_KEY, JSON.stringify(data)); }catch(e){}
}

function userCol(){
  return fb.collection(fb.db, 'users', currentUser.uid, 'deadlines');
}

function addItem(obj){
  if(mode === 'cloud'){
    fb.addDoc(userCol(), obj).catch((e) => toast('Could not save: ' + e.message));
  } else {
    data.push(Object.assign({ id: uid() }, obj));
    saveLocal(); render();
  }
}
function setItem(id, obj){
  if(mode === 'cloud'){
    fb.setDoc(fb.doc(userCol(), id), obj).catch((e) => toast('Could not save: ' + e.message));
  } else {
    const idx = data.findIndex((x) => x.id === id);
    if(idx >= 0) data[idx] = Object.assign({ id:id }, obj);
    saveLocal(); render();
  }
}
function removeItem(id){
  if(mode === 'cloud'){
    fb.deleteDoc(fb.doc(userCol(), id)).catch((e) => toast('Could not delete: ' + e.message));
  } else {
    data = data.filter((x) => x.id !== id);
    saveLocal(); render();
  }
}
function toggleDone(id, done){
  if(mode === 'cloud'){
    fb.updateDoc(fb.doc(userCol(), id), { done: done }).catch((e) => toast('Could not update: ' + e.message));
  } else {
    const item = data.find((x) => x.id === id);
    if(item) item.done = done;
    saveLocal(); render();
  }
}

function setSyncBadge(state){
  const el = $('syncStatus');
  el.className = 'sync-status ' + (state === 'live' ? 'live' : 'local');
  el.textContent = state === 'live' ? 'Synced across your devices' : 'Saved on this device only';
}

function showApp(show){
  $('app').hidden = !show;
  $('headerActions').hidden = !show;
  $('gate').hidden = show;
}

async function initStorage(){
  if(!isFirebaseConfigured()){
    startLocal();
    return;
  }
  try{
    const [appMod, authMod, fsMod] = await Promise.all([
      import(FB_URL + 'firebase-app.js'),
      import(FB_URL + 'firebase-auth.js'),
      import(FB_URL + 'firebase-firestore.js')
    ]);
    const app = appMod.initializeApp(firebaseConfig);
    fb = Object.assign({}, authMod, fsMod);
    fb.auth = authMod.getAuth(app);
    fb.db = fsMod.getFirestore(app);
  }catch(e){
    console.error('Firebase failed to load', e);
    startLocal();
    toast('Could not reach sync service — saving on this device.');
    return;
  }
  mode = 'cloud';

  fb.onAuthStateChanged(fb.auth, (user) => {
    currentUser = user;
    if(unsubscribe){ unsubscribe(); unsubscribe = null; }
    if(!user){
      data = [];
      $('syncStatus').textContent = '';
      $('userChip').hidden = true;
      showApp(false);
      return;
    }
    setSyncBadge('live');
    $('userName').textContent = user.displayName || user.email || 'Signed in';
    if(user.photoURL){ $('userPhoto').src = user.photoURL; $('userPhoto').hidden = false; }
    $('userChip').hidden = false;
    showApp(true);
    const q = fb.query(userCol(), fb.orderBy('due'));
    unsubscribe = fb.onSnapshot(q, (snap) => {
      data = snap.docs.map((d) => Object.assign({}, d.data(), { id: d.id }));
      render();
    }, (err) => {
      console.error(err);
      toast('Sync error: ' + err.message);
    });
  });
}

function startLocal(){
  mode = 'local';
  setSyncBadge('local');
  data = loadLocal();
  showApp(true);
  render();
}

async function signIn(){
  const provider = new fb.GoogleAuthProvider();
  try{
    await fb.signInWithPopup(fb.auth, provider);
  }catch(e){
    if(e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment'){
      fb.signInWithRedirect(fb.auth, provider);
    } else if(e.code !== 'auth/popup-closed-by-user' && e.code !== 'auth/cancelled-popup-request'){
      toast('Sign-in failed: ' + e.message);
    }
  }
}

/* ================= calendar export (.ics) ================= */

// Escape text per the iCalendar spec
function icsText(s){
  return String(s == null ? '' : s)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

// Date -> 20261115T235900Z (UTC)
function icsDate(dt){
  const p = (n) => (n < 10 ? '0' : '') + n;
  return dt.getUTCFullYear() + p(dt.getUTCMonth()+1) + p(dt.getUTCDate()) + 'T' +
         p(dt.getUTCHours()) + p(dt.getUTCMinutes()) + p(dt.getUTCSeconds()) + 'Z';
}

// Lines longer than 75 bytes must be folded (counted in UTF-8 bytes)
const encoder = new TextEncoder();
function foldLine(line){
  let out = '', count = 0;
  for(const ch of line){
    const size = encoder.encode(ch).length;
    if(count + size > 74){
      out += '\r\n ';
      count = 1;
    }
    out += ch;
    count += size;
  }
  return out;
}

function buildIcs(items){
  const now = icsDate(new Date());
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Deadline Desk//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Deadline Desk'
  ];
  items.forEach((d) => {
    const due = parseDue(d);
    const summary = d.course ? d.course.split('–')[0].trim() + ' — ' + d.title : d.title;
    const desc = [d.course, d.type + ' · ' + d.mode, d.notes].filter(Boolean).join('\n');
    lines.push(
      'BEGIN:VEVENT',
      'UID:' + d.id + '@deadline-desk',
      'DTSTAMP:' + now,
      'DTSTART:' + icsDate(due),
      'DTEND:' + icsDate(due),
      'SUMMARY:' + icsText(summary),
      'DESCRIPTION:' + icsText(desc)
    );
    if(d.loc) lines.push('LOCATION:' + icsText(d.loc));
    // Reminder 1 day before
    lines.push(
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      'DESCRIPTION:' + icsText(summary + ' is due tomorrow'),
      'TRIGGER:-P1D',
      'END:VALARM'
    );
    // Reminder 2 hours before
    lines.push(
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      'DESCRIPTION:' + icsText(summary + ' is due in 2 hours'),
      'TRIGGER:-PT2H',
      'END:VALARM',
      'END:VEVENT'
    );
  });
  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}

function upcomingForCalendar(){
  const now = new Date();
  return data
    .filter((d) => !d.done && parseDue(d) > now)
    .sort((a,b) => parseDue(a) - parseDue(b));
}

function exportCalendar(){
  const items = upcomingForCalendar();
  if(!items.length){
    toast('No upcoming deadlines to add.');
    return;
  }
  const blob = new Blob([buildIcs(items)], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'deadlines.ics';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  toast(items.length + ' deadline' + (items.length === 1 ? '' : 's') + ' exported — open the file to add them to your calendar.');
}

/* ================= helpers ================= */
let toastTimer = null;
function toast(msg){
  const el = $('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 4000);
}

function esc(s){
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

const ICONS = {
  online: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8M12 17v4"/></svg>',
  pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-7-6.1-7-11a7 7 0 0 1 14 0c0 4.9-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>',
  edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0-1 14a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1L6 6"/><path d="M10 11v6M14 11v6"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>'
};

function parseDue(d){ return new Date(d.due); }

function fmtDate(dt){
  const dstr = dt.toLocaleDateString(undefined, { weekday:'short', month:'short', day:'numeric' });
  const h = dt.getHours(), m = dt.getMinutes();
  if(h === 0 && m === 0) return dstr;
  const hh = (h % 12) || 12;
  const ap = h < 12 ? 'am' : 'pm';
  const mm = m < 10 ? '0' + m : m;
  return dstr + ' · ' + hh + (m ? ':' + mm : '') + ap;
}

function countdownInfo(dt, now, done){
  if(done) return { text:'Done', cls:'' };
  const diffMs = dt - now;
  const diffH = diffMs / 3600000;
  const abs = Math.abs(diffH);
  if(diffMs < 0){
    return { cls:'c-danger', text: abs < 24 ? 'Overdue · ' + Math.max(1, Math.round(abs)) + 'h' : 'Overdue · ' + Math.round(abs/24) + 'd' };
  }
  if(diffH < 24){
    return { cls: diffH < 6 ? 'c-danger' : 'c-warn',
             text: diffH < 1 ? 'Due in ' + Math.max(1, Math.round(diffMs/60000)) + 'm' : 'Due today · ' + Math.round(diffH) + 'h' };
  }
  if(diffH < 48) return { cls:'c-warn', text:'Tomorrow' };
  if(diffH < 24*7) return { cls:'c-warn', text:'In ' + Math.round(diffH/24) + ' days' };
  if(diffH < 24*30) return { cls:'c-safe', text:'In ' + Math.round(diffH/(24*7)) + 'w' };
  return { cls:'', text:'In ' + Math.round(diffH/(24*30)) + 'mo' };
}

function bucketOf(dt, now, done){
  if(done) return 'done';
  const diffH = (dt - now) / 3600000;
  if(diffH < 0) return 'overdue';
  if(dt.toDateString() === now.toDateString()) return 'today';
  if(diffH < 24*7) return 'week';
  return 'later';
}

const BUCKETS = [
  { key:'overdue', label:'Overdue', cls:'overdue-sec' },
  { key:'today', label:'Due today', cls:'today-sec' },
  { key:'week', label:'This week', cls:'' },
  { key:'later', label:'Later this term', cls:'' },
  { key:'done', label:'Completed', cls:'' }
];

function stripeVar(bucket){
  if(bucket === 'overdue' || bucket === 'today') return 'var(--danger)';
  if(bucket === 'week') return 'var(--warn)';
  if(bucket === 'done') return 'var(--done)';
  return 'var(--ink-300)';
}

/* ================= render ================= */
function populateFilterOptions(){
  const typeSel = $('fType');
  const types = Array.from(new Set(data.map((d) => d.type)));
  TYPES.forEach((t) => { if(types.indexOf(t) === -1) types.push(t); });
  typeSel.innerHTML = '<option value="all">All types</option>' +
    types.map((t) => '<option value="' + esc(t) + '">' + esc(t) + '</option>').join('');
  typeSel.value = filters.type;

  const courseSel = $('fCourse');
  const courses = Array.from(new Set(data.map((d) => d.course))).sort();
  courseSel.innerHTML = '<option value="all">All courses</option>' +
    courses.map((c) => '<option value="' + esc(c) + '">' + esc(c) + '</option>').join('');
  courseSel.value = courses.indexOf(filters.course) === -1 ? 'all' : filters.course;

  $('courseList').innerHTML = courses.map((c) => '<option value="' + esc(c) + '">').join('');
}

function computeStats(now){
  let overdue = 0, week = 0, upcoming = 0, next = null;
  data.forEach((d) => {
    if(d.done) return;
    const dt = parseDue(d);
    const diffH = (dt - now) / 3600000;
    if(diffH < 0) overdue++;
    else {
      upcoming++;
      if(diffH < 24*7) week++;
      if(!next || dt < parseDue(next)) next = d;
    }
  });
  $('statOverdue').textContent = overdue;
  $('statWeek').textContent = week;
  $('statUpcoming').textContent = upcoming;
  const nextEl = $('statNext');
  if(next){
    nextEl.textContent = next.course.split('–')[0].trim() + ' — ' + next.title;
    nextEl.title = next.course + ' — ' + next.title;
  } else {
    nextEl.textContent = 'All clear';
    nextEl.title = '';
  }
  $('calBtn').disabled = upcoming === 0;
}

function matchesFilters(d){
  if(filters.type !== 'all' && d.type !== filters.type) return false;
  if(filters.mode !== 'all' && d.mode !== filters.mode) return false;
  if(filters.course !== 'all' && d.course !== filters.course) return false;
  if(!filters.showDone && d.done) return false;
  if(filters.q){
    if((d.course + ' ' + d.title).toLowerCase().indexOf(filters.q.toLowerCase()) === -1) return false;
  }
  return true;
}

function render(){
  const now = new Date();
  computeStats(now);
  populateFilterOptions();

  const list = data.filter(matchesFilters).slice().sort((a,b) => {
    if(!!a.done !== !!b.done) return a.done ? 1 : -1;
    return parseDue(a) - parseDue(b);
  });

  const groups = {};
  BUCKETS.forEach((b) => { groups[b.key] = []; });
  list.forEach((d) => { groups[bucketOf(parseDue(d), now, d.done)].push(d); });

  const host = $('sections');
  host.innerHTML = '';

  if(list.length === 0){
    host.innerHTML = data.length === 0
      ? '<div class="empty">No deadlines yet. Click <b>Add deadline</b> to add your first one.</div>'
      : '<div class="empty">No deadlines match these filters. Try clearing a filter, or add a new one.</div>';
    return;
  }

  BUCKETS.forEach((b) => {
    const items = groups[b.key];
    if(!items.length) return;
    const sec = document.createElement('div');
    sec.className = 'section ' + b.cls;
    sec.innerHTML = '<div class="section-head"><h2>' + b.label + '</h2><span class="count">' + items.length + '</span></div>';
    const cards = document.createElement('div');
    cards.className = 'cards';
    items.forEach((d) => cards.appendChild(renderCard(d, now, b.key)));
    sec.appendChild(cards);
    host.appendChild(sec);
  });
}

function renderCard(d, now, bucket){
  const dt = parseDue(d);
  const card = document.createElement('div');
  card.className = 'card' + (d.done ? ' is-done' : '');
  card.style.setProperty('--stripe', stripeVar(bucket));

  const check = document.createElement('button');
  check.className = 'check';
  check.type = 'button';
  check.setAttribute('aria-label', d.done ? 'Mark not done' : 'Mark done');
  check.innerHTML = ICONS.check;
  check.addEventListener('click', () => toggleDone(d.id, !d.done));
  card.appendChild(check);

  const cd = countdownInfo(dt, now, d.done);
  const isOnline = d.mode === 'Online';
  const body = document.createElement('div');
  body.className = 'card-body';
  body.innerHTML =
    '<div class="card-top"><span class="course-tag">' + esc(d.course) + '</span></div>' +
    '<div class="card-title">' + esc(d.title) + '</div>' +
    '<div class="card-meta">' +
      '<span class="pill type">' + esc(d.type) + '</span>' +
      '<span class="pill ' + (isOnline ? 'mode-online' : 'mode-inperson') + '">' + (isOnline ? ICONS.online : ICONS.pin) + esc(d.mode) + '</span>' +
      '<span class="meta-date">' + fmtDate(dt) + '</span>' +
      (d.loc ? '<span class="meta-date meta-loc">· ' + esc(d.loc) + '</span>' : '') +
    '</div>';
  card.appendChild(body);

  const countdown = document.createElement('div');
  countdown.className = 'countdown ' + cd.cls;
  countdown.textContent = cd.text;
  card.appendChild(countdown);

  const actions = document.createElement('div');
  if(pendingDeleteId === d.id){
    actions.className = 'confirm-row';
    actions.innerHTML = '<span>Delete?</span>';
    const yes = document.createElement('button');
    yes.className = 'yes'; yes.type = 'button'; yes.textContent = 'Delete';
    yes.addEventListener('click', () => { pendingDeleteId = null; removeItem(d.id); });
    const no = document.createElement('button');
    no.className = 'no'; no.type = 'button'; no.textContent = 'Cancel';
    no.addEventListener('click', () => { pendingDeleteId = null; render(); });
    actions.appendChild(yes);
    actions.appendChild(no);
  } else {
    actions.className = 'card-actions';
    const editBtn = document.createElement('button');
    editBtn.className = 'icon-btn'; editBtn.type = 'button'; editBtn.setAttribute('aria-label', 'Edit');
    editBtn.innerHTML = ICONS.edit;
    editBtn.addEventListener('click', () => openModal(d));
    const delBtn = document.createElement('button');
    delBtn.className = 'icon-btn danger'; delBtn.type = 'button'; delBtn.setAttribute('aria-label', 'Delete');
    delBtn.innerHTML = ICONS.trash;
    delBtn.addEventListener('click', () => { pendingDeleteId = d.id; render(); });
    actions.appendChild(editBtn);
    actions.appendChild(delBtn);
  }
  card.appendChild(actions);
  return card;
}

/* ================= filters ================= */
$('fSearch').addEventListener('input', (e) => { filters.q = e.target.value; render(); });
$('fType').addEventListener('change', (e) => { filters.type = e.target.value; render(); });
$('fMode').addEventListener('change', (e) => { filters.mode = e.target.value; render(); });
$('fCourse').addEventListener('change', (e) => { filters.course = e.target.value; render(); });
$('fCompleted').addEventListener('change', (e) => { filters.showDone = e.target.checked; render(); });

/* ================= modal ================= */
const overlay = $('overlay');
const form = $('form');
let modalMode = 'Online';

function setModeSeg(m){
  modalMode = m;
  document.querySelectorAll('#fdModeSeg button').forEach((b) => {
    const on = b.dataset.mode === m;
    b.classList.toggle('on', on);
    b.classList.toggle('online-on', on && m === 'Online');
    b.classList.toggle('inperson-on', on && m === 'In-person');
  });
  $('fdLocLabel').textContent = m === 'Online' ? 'Link / portal (optional)' : 'Location';
}
document.querySelectorAll('#fdModeSeg button').forEach((b) => {
  b.addEventListener('click', () => setModeSeg(b.dataset.mode));
});

function openModal(existing){
  editingId = existing ? existing.id : null;
  $('modalTitle').textContent = existing ? 'Edit deadline' : 'Add deadline';
  $('saveBtn').textContent = existing ? 'Save changes' : 'Add deadline';
  $('deleteBtn').style.display = existing ? 'inline-block' : 'none';
  $('fdCourse').value = existing ? existing.course : '';
  $('fdTitle').value = existing ? existing.title : '';
  $('fdType').value = existing ? existing.type : 'Assignment';
  $('fdLoc').value = existing ? (existing.loc || '') : '';
  $('fdNotes').value = existing ? (existing.notes || '') : '';
  if(existing){
    const d = parseDue(existing);
    const pad = (n) => (n < 10 ? '0' : '') + n;
    $('fdDate').value = d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate());
    $('fdTime').value = pad(d.getHours()) + ':' + pad(d.getMinutes());
  } else {
    $('fdDate').value = '';
    $('fdTime').value = '23:59';
  }
  setModeSeg(existing ? existing.mode : 'Online');
  overlay.hidden = false;
  setTimeout(() => $('fdCourse').focus(), 0);
}
function closeModal(){
  overlay.hidden = true;
  editingId = null;
  form.reset();
}

$('openAdd').addEventListener('click', () => openModal(null));
$('cancelBtn').addEventListener('click', closeModal);
overlay.addEventListener('click', (e) => { if(e.target === overlay) closeModal(); });
document.addEventListener('keydown', (e) => { if(e.key === 'Escape' && !overlay.hidden) closeModal(); });
$('deleteBtn').addEventListener('click', () => {
  if(editingId){ removeItem(editingId); closeModal(); }
});

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const course = $('fdCourse').value.trim();
  const title = $('fdTitle').value.trim();
  const type = $('fdType').value;
  const date = $('fdDate').value;
  const time = $('fdTime').value || '23:59';
  const loc = $('fdLoc').value.trim();
  const notes = $('fdNotes').value.trim();
  if(!course || !title || !date) return;
  const item = { course, title, type, mode: modalMode, due: date + 'T' + time, loc, notes };
  if(editingId){
    const existing = data.find((x) => x.id === editingId);
    item.done = existing ? !!existing.done : false;
    setItem(editingId, item);
  } else {
    item.done = false;
    addItem(item);
  }
  closeModal();
});

/* ================= header buttons ================= */
$('calBtn').addEventListener('click', exportCalendar);
$('signInBtn').addEventListener('click', signIn);
$('signOutBtn').addEventListener('click', () => { if(fb) fb.signOut(fb.auth); });

initStorage();
setInterval(render, 60000);
