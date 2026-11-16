import { firebaseConfig } from './firebase-config.js';

const FB_VERSION = '10.12.2';
const FB_URL = 'https://www.gstatic.com/firebasejs/' + FB_VERSION + '/';
const STORE_KEY = 'deadline-desk-v1';
const INSTALL_DISMISS_KEY = 'deadline-desk-install-dismissed';
const TYPES = ['Assignment','Quiz','Project','Lab','Midterm Exam','Final Exam','Reading','Other'];
const DAY = 86400000;
const HOUR = 3600000;

const $ = (id) => document.getElementById(id);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

/* =========================================================
   State
   ========================================================= */
let data = [];
let loading = true;
const filters = { q:'', type:'all', mode:'all', course:'all' };
let view = 'all';               // all | week | overdue | completed
let editingId = null;
let animateNext = true;

let mode = 'local';             // 'local' or 'cloud'
let fb = null;
let currentUser = null;
let unsubscribe = null;

/* =========================================================
   Storage (local or Firebase)
   ========================================================= */
function uid(){ return Date.now().toString(36) + Math.random().toString(36).slice(2,8); }

function isFirebaseConfigured(){
  return !!(firebaseConfig && firebaseConfig.apiKey && firebaseConfig.apiKey.indexOf('PASTE_') !== 0);
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
function userCol(){ return fb.collection(fb.db, 'users', currentUser.uid, 'deadlines'); }
function stripId(obj){ const o = Object.assign({}, obj); delete o.id; return o; }

function addItem(obj){
  if(mode === 'cloud'){
    return fb.addDoc(userCol(), obj).catch((e) => toast('Could not save. ' + e.message, 'error'));
  }
  data.push(Object.assign({ id: uid() }, obj));
  saveLocal(); render();
  return Promise.resolve();
}
function setItem(id, obj){
  if(mode === 'cloud'){
    return fb.setDoc(fb.doc(userCol(), id), stripId(obj)).catch((e) => toast('Could not save. ' + e.message, 'error'));
  }
  const idx = data.findIndex((x) => x.id === id);
  if(idx >= 0) data[idx] = Object.assign({}, stripId(obj), { id:id });
  else data.push(Object.assign({}, stripId(obj), { id:id }));
  saveLocal(); render();
  return Promise.resolve();
}
function removeItem(id){
  if(mode === 'cloud'){
    return fb.deleteDoc(fb.doc(userCol(), id)).catch((e) => toast('Could not delete. ' + e.message, 'error'));
  }
  data = data.filter((x) => x.id !== id);
  saveLocal(); render();
  return Promise.resolve();
}
function updateDone(id, done){
  if(mode === 'cloud'){
    return fb.updateDoc(fb.doc(userCol(), id), { done: done }).catch((e) => toast('Could not update. ' + e.message, 'error'));
  }
  const item = data.find((x) => x.id === id);
  if(item) item.done = done;
  saveLocal(); render();
  return Promise.resolve();
}

async function initStorage(){
  if(!isFirebaseConfigured()){ startLocal(); return; }
  showShell(true);
  render();
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
    toast('Could not reach the sync service. Saving on this device for now.', 'error');
    return;
  }
  mode = 'cloud';

  fb.onAuthStateChanged(fb.auth, (user) => {
    currentUser = user;
    if(unsubscribe){ unsubscribe(); unsubscribe = null; }
    if(!user){
      data = [];
      showShell(false);
      return;
    }
    setProfile(user.displayName || 'Signed in', user.email || '', user.photoURL);
    setSync('live');
    showShell(true);
    loading = true; animateNext = true; render();
    unsubscribe = fb.onSnapshot(userCol(), (snap) => {
      data = snap.docs.map((d) => Object.assign({}, d.data(), { id: d.id }));
      if(loading){ loading = false; animateNext = true; }
      render();
    }, (err) => {
      console.error(err);
      loading = false; render();
      toast('Sync error. ' + err.message, 'error');
    });
  });
}

function startLocal(){
  mode = 'local';
  data = loadLocal();
  loading = false;
  setProfile('This device', 'Saved in this browser', null);
  setSync('local');
  showShell(true);
  animateNext = true;
  render();
}

async function signIn(){
  if(!fb) return;
  const provider = new fb.GoogleAuthProvider();
  try{
    await fb.signInWithPopup(fb.auth, provider);
  }catch(e){
    if(e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment'){
      fb.signInWithRedirect(fb.auth, provider);
    } else if(e.code !== 'auth/popup-closed-by-user' && e.code !== 'auth/cancelled-popup-request'){
      toast('Sign-in failed. ' + e.message, 'error');
    }
  }
}
function signOut(){
  closeMenu();
  if(fb) fb.signOut(fb.auth);
}

/* =========================================================
   Shell / profile
   ========================================================= */
function showShell(show){
  $('shell').hidden = !show;
  $('gate').hidden = show;
}
function initialOf(name){ return (name || '?').trim().charAt(0).toUpperCase() || '?'; }
function setProfile(name, sub, photo){
  $('profileName').textContent = name;
  $('profileSub').textContent = sub;
  $('menuName').textContent = name;
  $('menuEmail').textContent = sub;
  [['avatarImg','avatarInitial'],['topAvatarImg','topAvatarInitial']].forEach(([img, ini]) => {
    $(ini).textContent = initialOf(name);
    if(photo){ $(img).src = photo; $(img).hidden = false; $(ini).hidden = true; }
    else { $(img).hidden = true; $(ini).hidden = false; }
  });
  const signedIn = mode === 'cloud';
  $('signOutBtn').hidden = !signedIn;
  $('menuSignOut').hidden = !signedIn;
}
function setSync(state){
  const el = $('syncStatus');
  el.className = 'sync ' + (state === 'live' ? 'live' : 'local');
  el.innerHTML = '<span class="dot"></span>' + (state === 'live' ? 'Synced across your devices' : 'Saved on this device only');
}

/* =========================================================
   Date helpers — one consistent format everywhere
   ========================================================= */
const fmtWeekday = new Intl.DateTimeFormat('en-US', { weekday:'short' });
const fmtMonth = new Intl.DateTimeFormat('en-US', { month:'short' });
const fmtDayLong = new Intl.DateTimeFormat('en-US', { weekday:'short', month:'short', day:'numeric' });
const fmtTimeF = new Intl.DateTimeFormat('en-US', { hour:'numeric', minute:'2-digit' });

function parseDue(d){
  const dt = new Date(d && d.due);
  return isNaN(dt) ? new Date(8640000000000000) : dt;
}
function fmtTime(dt){ return fmtTimeF.format(dt); }
function fmtFull(dt){ return fmtDayLong.format(dt) + ' · ' + fmtTime(dt); }
function startOfDay(dt){ const x = new Date(dt); x.setHours(0,0,0,0); return x; }
function dayDiff(a, b){ return Math.round((startOfDay(a) - startOfDay(b)) / DAY); }

function relDue(dt, now){
  const ms = dt - now;
  if(ms < 0){
    const late = -ms;
    if(late < HOUR) return Math.max(1, Math.round(late / 60000)) + 'm overdue';
    if(late < DAY) return Math.round(late / HOUR) + 'h overdue';
    const d = Math.round(late / DAY);
    return d + (d === 1 ? ' day' : ' days') + ' overdue';
  }
  if(ms < HOUR) return 'Due in ' + Math.max(1, Math.round(ms / 60000)) + 'm';
  const days = dayDiff(dt, now);
  if(days === 0) return 'Due in ' + Math.round(ms / HOUR) + 'h';
  if(days === 1) return 'Tomorrow';
  if(days < 7) return 'In ' + days + ' days';
  if(days < 30){ const w = Math.round(days / 7); return 'In ' + w + (w === 1 ? ' week' : ' weeks'); }
  const m = Math.round(days / 30);
  return 'In ' + m + (m === 1 ? ' month' : ' months');
}

/* status for a single deadline */
function statusOf(d, now){
  if(d.done) return 'done';
  const ms = parseDue(d) - now;
  if(ms < 0) return 'overdue';
  if(ms < 7 * DAY) return 'soon';
  return 'upcoming';
}

function courseCode(course){
  return String(course || '').split(/\s+[–—-]\s+/)[0].trim() || String(course || '');
}

/* =========================================================
   Derived numbers (single source of truth)
   ========================================================= */
function computeCounts(now){
  const c = { all:0, overdue:0, week:0, upcoming:0, completed:0, next:null };
  data.forEach((d) => {
    if(d.done){ c.completed++; return; }
    c.all++;
    const ms = parseDue(d) - now;
    if(ms < 0){ c.overdue++; return; }
    c.upcoming++;
    if(ms < 7 * DAY) c.week++;
    if(!c.next || parseDue(d) < parseDue(c.next)) c.next = d;
  });
  return c;
}

/* =========================================================
   Rendering
   ========================================================= */
function esc(s){
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function icon(name){ return '<svg class="i" aria-hidden="true"><use href="#i-' + name + '"/></svg>'; }

function renderHeader(c, now){
  const first = currentUser && currentUser.displayName ? currentUser.displayName.split(' ')[0] : '';
  const hi = first ? 'Hi ' + esc(first) + ', ' : '';
  let h;
  if(loading) h = 'Loading your deadlines…';
  else if(data.length === 0) h = (first ? 'Welcome, ' + esc(first) : 'Welcome') + '. Let\u2019s add your first deadline';
  else if(c.week > 0) h = hi + 'you have <span class="hl">' + c.week + (c.week === 1 ? ' deadline' : ' deadlines') + '</span> this week';
  else if(c.overdue > 0) h = hi + 'you have <span class="hl">' + c.overdue + ' overdue</span> to catch up on';
  else h = hi + 'you\u2019re <span class="hl">all caught up</span> this week';
  h = h.charAt(0).toUpperCase() + h.slice(1);
  $('greeting').innerHTML = h;

  const sub = $('welcomeSub');
  if(c.next){
    const dt = parseDue(c.next);
    sub.innerHTML = 'Next up: <strong>' + esc(courseCode(c.next.course)) + ' ' + esc(c.next.title) + '</strong>, ' + esc(fmtFull(dt));
  } else if(!loading && data.length){
    sub.textContent = 'Nothing else is scheduled. Add a deadline when one comes up.';
  } else {
    sub.textContent = loading ? '\u00a0' : 'Track every assignment, quiz and exam in one place.';
  }
}

function renderStats(c, now){
  const ov = $('statOverdue');
  ov.textContent = c.overdue;
  ov.classList.toggle('has', c.overdue > 0);
  $('statOverdueFoot').textContent = c.overdue ? 'Past due' : 'Nothing late';
  $('statWeek').textContent = c.week;
  $('statUpcoming').textContent = c.upcoming;

  const card = $('statNextCard');
  if(c.next){
    const dt = parseDue(c.next);
    $('statNextTitle').textContent = c.next.title;
    $('statNextMeta').innerHTML = esc(courseCode(c.next.course)) + ' · ' + esc(fmtDayLong.format(dt)) + ' · <b>' + esc(relDue(dt, now)) + '</b>';
    card.classList.add('clickable');
    card.tabIndex = 0;
    card.setAttribute('role','button');
    card.dataset.id = c.next.id;
  } else {
    $('statNextTitle').textContent = 'All clear';
    $('statNextMeta').textContent = 'No upcoming deadlines';
    card.classList.remove('clickable');
    card.removeAttribute('tabindex');
    card.removeAttribute('role');
    delete card.dataset.id;
  }

  $$('[data-count]').forEach((el) => {
    const n = c[el.dataset.count];
    el.textContent = n ? n : '';
  });
  $('calBtn').disabled = c.upcoming === 0;
}

function renderFilters(){
  // type select
  const typeSel = $('fType');
  const types = Array.from(new Set(data.map((d) => d.type).filter(Boolean)));
  TYPES.forEach((t) => { if(types.indexOf(t) === -1) types.push(t); });
  const typeHtml = '<option value="all">All types</option>' + types.map((t) => '<option value="' + esc(t) + '">' + esc(t) + '</option>').join('');
  if(typeSel.innerHTML !== typeHtml) typeSel.innerHTML = typeHtml;
  typeSel.value = filters.type;

  // course tabs
  const courses = Array.from(new Set(data.map((d) => d.course).filter(Boolean))).sort((a,b) => a.localeCompare(b));
  if(filters.course !== 'all' && courses.indexOf(filters.course) === -1) filters.course = 'all';
  const counts = {};
  data.forEach((d) => { if(!d.done) counts[d.course] = (counts[d.course] || 0) + 1; });
  const tabs = [{ key:'all', label:'All courses', n:null }].concat(courses.map((c) => ({ key:c, label:courseCode(c), n:counts[c] || 0, title:c })));
  const host = $('courseTabs');
  const keepScroll = host.scrollLeft;
  host.innerHTML = tabs.map((t) =>
    '<button class="tab' + (filters.course === t.key ? ' active' : '') + '" type="button" role="tab" aria-selected="' + (filters.course === t.key) + '" data-course="' + esc(t.key) + '"' + (t.title ? ' title="' + esc(t.title) + '"' : '') + '>' +
      esc(t.label) + (t.n ? '<span class="tab-count">' + t.n + '</span>' : '') +
    '</button>'
  ).join('');
  host.scrollLeft = keepScroll;

  $('courseList').innerHTML = courses.map((c) => '<option value="' + esc(c) + '">').join('');

  // view state in nav
  $$('[data-view]').forEach((el) => {
    if(el.classList.contains('brand')) return;
    el.classList.toggle('active', el.dataset.view === view);
  });
  $('doneToggle').setAttribute('aria-pressed', String(view === 'completed'));
}

function matches(d){
  if(filters.type !== 'all' && d.type !== filters.type) return false;
  if(filters.mode !== 'all' && d.mode !== filters.mode) return false;
  if(filters.course !== 'all' && d.course !== filters.course) return false;
  if(filters.q){
    const q = filters.q.toLowerCase();
    if((d.course + ' ' + d.title + ' ' + (d.type || '') + ' ' + (d.loc || '')).toLowerCase().indexOf(q) === -1) return false;
  }
  return true;
}
function hasActiveFilters(){
  return filters.q || filters.type !== 'all' || filters.mode !== 'all' || filters.course !== 'all';
}

const SECTION_DEFS = {
  overdue:   { label:'Overdue' },
  week:      { label:'This week' },
  later:     { label:'Later this term' },
  completed: { label:'Completed' }
};

function groupFor(d, now){
  const s = statusOf(d, now);
  if(s === 'done') return 'completed';
  if(s === 'overdue') return 'overdue';
  if(s === 'soon') return 'week';
  return 'later';
}

function renderSections(now){
  const host = $('sections');
  host.classList.toggle('enter', animateNext);
  animateNext = false;

  if(loading){
    host.innerHTML = '<div class="section"><div class="cards">' + '<div class="skel-card"></div>'.repeat(4) + '</div></div>';
    return;
  }

  if(data.length === 0){
    host.innerHTML = emptyState('logo', 'No deadlines yet', 'Add your assignments, quizzes and exams, and Deadline Desk will keep them in order.', '<button class="btn btn-primary" data-action="add" type="button">' + icon('plus') + 'Add your first deadline</button>');
    return;
  }

  const visibleGroups = {
    all: ['overdue','week','later'],
    week: ['week'],
    overdue: ['overdue'],
    completed: ['completed']
  }[view];

  const groups = { overdue:[], week:[], later:[], completed:[] };
  data.filter(matches).forEach((d) => groups[groupFor(d, now)].push(d));
  Object.keys(groups).forEach((k) => {
    groups[k].sort((a,b) => k === 'completed' ? parseDue(b) - parseDue(a) : parseDue(a) - parseDue(b));
  });

  const shown = visibleGroups.filter((k) => groups[k].length);
  if(!shown.length){
    if(hasActiveFilters()){
      host.innerHTML = emptyState('search', 'No matches', 'Nothing matches these filters. Try a different search or clear the filters.', '<button class="btn btn-secondary" data-action="clear-filters" type="button">Clear filters</button>');
    } else {
      const msg = {
        all: ['check-circle', 'You\u2019re all caught up', 'Every deadline is done. Add a new one when it comes up.'],
        week: ['week', 'Nothing due this week', 'Enjoy the breathing room. Your next deadlines are further out.'],
        overdue: ['check-circle', 'Nothing overdue', 'Nice work. Everything past due has been completed.'],
        completed: ['check-circle', 'Nothing completed yet', 'Tick the box on a deadline when you finish it and it will show up here.']
      }[view];
      host.innerHTML = emptyState(msg[0], msg[1], msg[2], '');
    }
    return;
  }

  host.innerHTML = shown.map((k) =>
    '<section class="section" data-kind="' + k + '">' +
      '<div class="section-head"><span class="dot"></span><h2>' + SECTION_DEFS[k].label + '</h2><span class="count">' + groups[k].length + '</span><span class="line"></span></div>' +
      '<div class="cards">' + groups[k].map((d) => cardHtml(d, now)).join('') + '</div>' +
    '</section>'
  ).join('');
}

function emptyState(ic, title, text, action){
  return '<div class="empty"><span class="empty-icon">' + icon(ic) + '</span><h3>' + title + '</h3><p>' + text + '</p>' + action + '</div>';
}

function cardHtml(d, now){
  const dt = parseDue(d);
  const st = statusOf(d, now);
  const online = d.mode === 'Online';
  const badge = st === 'done' ? 'Completed' : relDue(dt, now);
  const place = d.loc || (online ? 'Online' : 'In person');
  const label = (d.done ? 'Mark not done: ' : 'Mark done: ') + d.title;
  return '' +
    '<article class="card' + (d.done ? ' is-done' : '') + '" data-status="' + st + '" data-id="' + esc(d.id) + '" tabindex="0" aria-label="' + esc(d.title + ', ' + courseCode(d.course) + ', due ' + fmtFull(dt)) + '">' +
      '<button class="check" type="button" data-action="toggle" aria-label="' + esc(label) + '" aria-pressed="' + !!d.done + '"><span class="check-box">' + icon('check') + '</span></button>' +
      '<div class="date-block" aria-hidden="true"><span class="m">' + fmtMonth.format(dt) + '</span><span class="d">' + dt.getDate() + '</span></div>' +
      '<div class="card-body">' +
        '<div class="card-course"><span class="code">' + esc(courseCode(d.course)) + '</span><span class="sep"></span><span>' + esc(d.type || 'Deadline') + '</span></div>' +
        '<h3 class="card-title">' + esc(d.title) + '</h3>' +
        '<div class="card-meta">' +
          '<span>' + icon(online ? 'monitor' : 'pin') + '<em>' + esc(place) + '</em></span>' +
          '<span>' + icon('clock') + '<em>' + esc(fmtWeekday.format(dt) + ', ' + fmtTime(dt)) + '</em></span>' +
        '</div>' +
      '</div>' +
      '<div class="card-side">' +
        '<span class="badge">' + esc(badge) + '</span>' +
        '<div class="card-actions">' +
          '<button class="icon-btn" type="button" data-action="edit" aria-label="Edit">' + icon('edit') + '</button>' +
          '<button class="icon-btn del" type="button" data-action="delete" aria-label="Delete">' + icon('trash') + '</button>' +
        '</div>' +
      '</div>' +
    '</article>';
}

function render(){
  const now = new Date();
  const c = computeCounts(now);
  renderHeader(c, now);
  renderStats(c, now);
  renderFilters();
  renderSections(now);
}

/* =========================================================
   Actions
   ========================================================= */
function findItem(id){ return data.find((x) => x.id === id); }

function toggleCard(card){
  const id = card.dataset.id;
  const item = findItem(id);
  if(!item) return;
  const next = !item.done;
  card.classList.toggle('is-done', next);
  card.querySelector('.check').setAttribute('aria-pressed', String(next));
  if(next) card.classList.add('leaving');
  setTimeout(() => {
    updateDone(id, next).then(() => {
      toast(next ? 'Marked as done' : 'Moved back to your list', 'success', {
        label:'Undo', fn: () => updateDone(id, !next)
      });
    });
  }, next ? 320 : 120);
}

function deleteWithUndo(id){
  const item = findItem(id);
  if(!item) return;
  const backup = Object.assign({}, item);
  removeItem(id).then(() => {
    toast('Deadline deleted', 'info', { label:'Undo', fn: () => setItem(backup.id, backup) });
  });
}

function setView(v){
  view = v;
  animateNext = true;
  closeDrawer();
  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* =========================================================
   Calendar export (.ics)
   ========================================================= */
function icsText(s){
  return String(s == null ? '' : s).replace(/\\/g,'\\\\').replace(/;/g,'\\;').replace(/,/g,'\\,').replace(/\r?\n/g,'\\n');
}
function icsDate(dt){
  const p = (n) => (n < 10 ? '0' : '') + n;
  return dt.getUTCFullYear() + p(dt.getUTCMonth()+1) + p(dt.getUTCDate()) + 'T' + p(dt.getUTCHours()) + p(dt.getUTCMinutes()) + p(dt.getUTCSeconds()) + 'Z';
}
const encoder = new TextEncoder();
function foldLine(line){
  let out = '', count = 0;
  for(const ch of line){
    const size = encoder.encode(ch).length;
    if(count + size > 74){ out += '\r\n '; count = 1; }
    out += ch; count += size;
  }
  return out;
}
function buildIcs(items){
  const stamp = icsDate(new Date());
  const lines = ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Deadline Desk//EN','CALSCALE:GREGORIAN','METHOD:PUBLISH','X-WR-CALNAME:Deadline Desk'];
  items.forEach((d) => {
    const due = parseDue(d);
    const summary = courseCode(d.course) + ' — ' + d.title;
    const desc = [d.course, (d.type || '') + ' · ' + (d.mode || ''), d.notes].filter(Boolean).join('\n');
    lines.push('BEGIN:VEVENT','UID:' + d.id + '@deadline-desk','DTSTAMP:' + stamp,'DTSTART:' + icsDate(due),'DTEND:' + icsDate(due),'SUMMARY:' + icsText(summary),'DESCRIPTION:' + icsText(desc));
    if(d.loc) lines.push('LOCATION:' + icsText(d.loc));
    lines.push('BEGIN:VALARM','ACTION:DISPLAY','DESCRIPTION:' + icsText(summary + ' is due tomorrow'),'TRIGGER:-P1D','END:VALARM');
    lines.push('BEGIN:VALARM','ACTION:DISPLAY','DESCRIPTION:' + icsText(summary + ' is due in 2 hours'),'TRIGGER:-PT2H','END:VALARM','END:VEVENT');
  });
  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}
function exportCalendar(){
  closeDrawer();
  const now = new Date();
  const items = data.filter((d) => !d.done && parseDue(d) > now).sort((a,b) => parseDue(a) - parseDue(b));
  if(!items.length){ toast('No upcoming deadlines to add', 'info'); return; }
  const blob = new Blob([buildIcs(items)], { type:'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'deadlines.ics';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  toast(items.length + (items.length === 1 ? ' deadline' : ' deadlines') + ' exported. Open the file to add them to your calendar.', 'success');
}

/* =========================================================
   Install (PWA)
   ========================================================= */
let deferredPrompt = null;
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
function installDismissed(){ try{ return localStorage.getItem(INSTALL_DISMISS_KEY) === '1'; }catch(e){ return false; } }

function updateInstallUi(){
  const canInstall = !isStandalone() && (deferredPrompt || isIOS());
  $('navInstall').hidden = !canInstall;
  $('installBanner').hidden = !canInstall || installDismissed();
}
async function doInstall(){
  closeDrawer();
  if(deferredPrompt){
    deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    deferredPrompt = null;
    if(choice.outcome === 'accepted') toast('Installing Deadline Desk', 'success');
    updateInstallUi();
  } else if(isIOS()){
    toast('In Safari, tap Share, then Add to Home Screen', 'info');
  } else {
    toast('Use your browser menu and choose Install app', 'info');
  }
}
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  updateInstallUi();
});
window.addEventListener('appinstalled', () => {
  deferredPrompt = null;
  updateInstallUi();
});
if('serviceWorker' in navigator && location.protocol === 'https:'){
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

/* =========================================================
   Toasts
   ========================================================= */
function toast(msg, tone, action){
  tone = tone || 'info';
  const host = $('toastHost');
  while(host.children.length >= 3) host.firstChild.remove();
  const el = document.createElement('div');
  el.className = 'toast';
  el.dataset.tone = tone;
  el.setAttribute('role', tone === 'error' ? 'alert' : 'status');
  const icons = { success:'check-circle', error:'alert', info:'clock' };
  el.innerHTML = icon(icons[tone] || 'clock') + '<span class="toast-msg"></span>';
  el.querySelector('.toast-msg').textContent = msg;
  let timer;
  const close = () => {
    clearTimeout(timer);
    el.classList.add('out');
    setTimeout(() => el.remove(), 200);
  };
  if(action){
    const b = document.createElement('button');
    b.className = 'toast-action'; b.type = 'button'; b.textContent = action.label;
    b.addEventListener('click', () => { action.fn(); close(); });
    el.appendChild(b);
  }
  host.appendChild(el);
  timer = setTimeout(close, action ? 6000 : 4000);
}

/* =========================================================
   Drawer & menu
   ========================================================= */
function openDrawer(){
  $('sidebar').classList.add('open');
  $('scrim').hidden = false;
  setTimeout(() => { const a = $('sidebar').querySelector('.nav-item.active') || $('sidebar').querySelector('.nav-item'); if(a) a.focus(); }, 50);
}
function closeDrawer(){
  if(!$('sidebar').classList.contains('open')) return;
  $('sidebar').classList.remove('open');
  $('scrim').hidden = true;
}
function toggleMenu(){
  const m = $('accountMenu');
  m.hidden = !m.hidden;
}
function closeMenu(){ $('accountMenu').hidden = true; }

/* =========================================================
   Modal
   ========================================================= */
const overlay = $('overlay');
const form = $('form');
let modalMode = 'Online';
let lastFocus = null;

function setModeSeg(m){
  modalMode = m;
  $$('#fdModeSeg button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.mode === m)));
  $('fdLocLabel').textContent = m === 'Online' ? 'Link or platform' : 'Location';
  $('fdLoc').placeholder = m === 'Online' ? 'e.g. URCourses' : 'e.g. CL 136';
}
function pad(n){ return (n < 10 ? '0' : '') + n; }

function openModal(existing){
  closeDrawer(); closeMenu();
  lastFocus = document.activeElement;
  editingId = existing ? existing.id : null;
  $('modalTitle').textContent = existing ? 'Edit deadline' : 'Add deadline';
  $('saveBtn').textContent = existing ? 'Save changes' : 'Add deadline';
  $('deleteBtn').hidden = !existing;
  $('formError').hidden = true;
  $$('#form input').forEach((i) => i.classList.remove('invalid'));

  $('fdTitle').value = existing ? existing.title : '';
  $('fdCourse').value = existing ? existing.course : (filters.course !== 'all' ? filters.course : '');
  $('fdType').value = existing && TYPES.indexOf(existing.type) !== -1 ? existing.type : 'Assignment';
  $('fdLoc').value = existing ? (existing.loc || '') : '';
  $('fdNotes').value = existing ? (existing.notes || '') : '';
  if(existing){
    const d = parseDue(existing);
    $('fdDate').value = d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate());
    $('fdTime').value = pad(d.getHours()) + ':' + pad(d.getMinutes());
  } else {
    $('fdDate').value = '';
    $('fdTime').value = '23:59';
  }
  setModeSeg(existing ? (existing.mode || 'Online') : 'Online');
  overlay.hidden = false;
  document.body.style.overflow = 'hidden';
  $('fdTitle').focus();
}
function closeModal(){
  overlay.hidden = true;
  document.body.style.overflow = '';
  editingId = null;
  form.reset();
  if(lastFocus && lastFocus.focus) lastFocus.focus();
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const title = $('fdTitle').value.trim();
  const course = $('fdCourse').value.trim();
  const date = $('fdDate').value;
  const missing = [];
  if(!title) missing.push($('fdTitle'));
  if(!course) missing.push($('fdCourse'));
  if(!date) missing.push($('fdDate'));
  $$('#form input').forEach((i) => i.classList.remove('invalid'));
  if(missing.length){
    missing.forEach((i) => i.classList.add('invalid'));
    $('formError').textContent = 'Please fill in the title, course and due date.';
    $('formError').hidden = false;
    missing[0].focus();
    return;
  }
  const item = {
    title, course,
    type: $('fdType').value,
    mode: modalMode,
    due: date + 'T' + ($('fdTime').value || '23:59'),
    loc: $('fdLoc').value.trim(),
    notes: $('fdNotes').value.trim()
  };
  const wasEditing = !!editingId;
  if(editingId){
    const existing = findItem(editingId);
    item.done = existing ? !!existing.done : false;
    setItem(editingId, item);
  } else {
    item.done = false;
    addItem(item);
  }
  closeModal();
  toast(wasEditing ? 'Changes saved' : 'Deadline added', 'success');
});
$$('#form input').forEach((i) => i.addEventListener('input', () => { i.classList.remove('invalid'); $('formError').hidden = true; }));
$$('#fdModeSeg button').forEach((b) => b.addEventListener('click', () => setModeSeg(b.dataset.mode)));
$('cancelBtn').addEventListener('click', closeModal);
$('modalClose').addEventListener('click', closeModal);
overlay.addEventListener('mousedown', (e) => { if(e.target === overlay) closeModal(); });
$('deleteBtn').addEventListener('click', () => {
  const id = editingId;
  closeModal();
  if(id) deleteWithUndo(id);
});

/* =========================================================
   Global event wiring (delegated)
   ========================================================= */
document.addEventListener('click', (e) => {
  const t = e.target;

  const actionEl = t.closest('[data-action]');
  if(actionEl){
    const a = actionEl.dataset.action;
    const card = actionEl.closest('.card');
    if(a === 'add'){ openModal(null); return; }
    if(a === 'calendar'){ exportCalendar(); return; }
    if(a === 'install'){ doInstall(); return; }
    if(a === 'clear-filters'){
      filters.q = ''; filters.type = 'all'; filters.mode = 'all'; filters.course = 'all';
      $('fSearch').value = ''; $('fMode').value = 'all';
      animateNext = true; render(); return;
    }
    if(card){
      e.stopPropagation();
      if(a === 'toggle'){ toggleCard(card); return; }
      if(a === 'edit'){ openModal(findItem(card.dataset.id)); return; }
      if(a === 'delete'){ deleteWithUndo(card.dataset.id); return; }
    }
  }

  const viewEl = t.closest('[data-view]');
  if(viewEl){ e.preventDefault(); setView(viewEl.dataset.view); return; }

  const tab = t.closest('[data-course]');
  if(tab){
    filters.course = tab.dataset.course;
    animateNext = true; render();
    const active = document.querySelector('.tab.active');
    if(active) active.scrollIntoView({ block:'nearest', inline:'nearest', behavior:'smooth' });
    return;
  }

  const card = t.closest('.card');
  if(card){ openModal(findItem(card.dataset.id)); return; }

  const next = t.closest('#statNextCard.clickable');
  if(next){ openModal(findItem(next.dataset.id)); return; }

  if(!t.closest('#accountMenu') && !t.closest('#topAvatar')) closeMenu();
});

document.addEventListener('keydown', (e) => {
  const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement && document.activeElement.tagName);
  if(e.key === 'Escape'){
    if(!overlay.hidden){ closeModal(); return; }
    closeDrawer(); closeMenu();
    return;
  }
  if(!overlay.hidden) return;
  if(e.key === 'Enter' || e.key === ' '){
    const el = document.activeElement;
    if(el && el.classList && (el.classList.contains('card') || el.id === 'statNextCard') && el.dataset.id){
      e.preventDefault(); openModal(findItem(el.dataset.id));
    }
    return;
  }
  if(typing || e.metaKey || e.ctrlKey || e.altKey) return;
  if(e.key === 'n' || e.key === 'N'){ e.preventDefault(); openModal(null); }
  if(e.key === '/'){ e.preventDefault(); $('fSearch').focus(); }
});

$('doneToggle').addEventListener('click', () => setView(view === 'completed' ? 'all' : 'completed'));
$('fSearch').addEventListener('input', (e) => { filters.q = e.target.value.trim(); render(); });
$('fType').addEventListener('change', (e) => { filters.type = e.target.value; animateNext = true; render(); });
$('fMode').addEventListener('change', (e) => { filters.mode = e.target.value; animateNext = true; render(); });
$('menuBtn').addEventListener('click', openDrawer);
$('drawerClose').addEventListener('click', closeDrawer);
$('scrim').addEventListener('click', closeDrawer);
$('topAvatar').addEventListener('click', (e) => { e.stopPropagation(); toggleMenu(); });
$('signInBtn').addEventListener('click', signIn);
$('signOutBtn').addEventListener('click', signOut);
$('menuSignOut').addEventListener('click', signOut);
$('installDismiss').addEventListener('click', () => {
  try{ localStorage.setItem(INSTALL_DISMISS_KEY, '1'); }catch(e){}
  updateInstallUi();
});
window.addEventListener('resize', () => { if(window.innerWidth >= 1024) closeDrawer(); });

// keep countdowns accurate
setInterval(render, 30000);
document.addEventListener('visibilitychange', () => { if(!document.hidden) render(); });

updateInstallUi();
initStorage();
