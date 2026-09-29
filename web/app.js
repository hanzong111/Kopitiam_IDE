'use strict';
/* Kopitiam Agents — the browser side.
 *
 * Everything on screen is a pure function of a stream of normalized events (see server.py `ev()`):
 *   prompt · spawn · brief · tool · result · say · usage · done
 * Two sources feed the same `apply()`: the local server (real Claude Code / Codex sessions) and a
 * built-in scripted demo. History already on disk is applied instantly ("replay"); new events animate.
 *
 * Metaphor:  orchestrator = Uncle Lim at the counter · sub-agent = a customer · task = an order chit
 *            tool call = a trip to a stall · result = the dish coming back · tokens = the bill
 */

/* ───────────────────────── constants & helpers ───────────────────────── */
const STALLS = {
  read:  { name: 'Nasi Lemak', dish: '🍛', sub: 'read · grep · glob' },
  run:   { name: 'Roti Canai', dish: '🥞', sub: 'bash · run' },
  edit:  { name: 'Kaya Toast', dish: '🍞', sub: 'edit · write' },
  web:   { name: 'Teh Tarik',  dish: '☕', sub: 'search · fetch' },
  other: { name: 'Cendol',     dish: '🍧', sub: 'mcp · other' },
};
const DISH = { read: '🍛', run: '🥞', edit: '🍞', web: '☕', other: '🍧', delegate: '🧾' };
const NAMES = ['Kumar', 'Siti', 'Ah Seng', 'Mei Ling', 'Ravi', 'Aisyah', 'Ah Beng', 'Farah', 'Suresh', 'Li Na', 'Hafiz', 'Priya'];
const SHIRTS = ['#c2472f', '#2b7fa8', '#6d9430', '#9c3a70', '#d08a1e', '#3f62a8', '#1f9186', '#8a5a34'];
// one terminal = one customer; Claude Code customers wear warm shirts, Codex customers cool ones
const SRC_SHIRTS = { claude: ['#c2472f', '#d08a1e', '#9c3a70', '#8a5a34', '#b5562c'], codex: ['#2b7fa8', '#1f9186', '#3f62a8', '#6d9430', '#2f6f8f'] };
const SRC_NAME = { claude: 'Claude', codex: 'Codex' };
const HAIRS = ['#1b1b1b', '#3b2a1a', '#5a3a22', '#2a2a2a', '#7a7a7a'];
const N_TABLES = 9;
const MAX_FEED = 700;
const MAIN_COLOR = '#1f4f4c';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtN = n => n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e4 ? Math.round(n / 1e3) + 'k' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(Math.round(n));
const fmtT = ms => new Date(ms).toTimeString().slice(0, 8);
const fmtD = ms => ms < 1000 ? ms + 'ms' : ms < 60000 ? (ms / 1000).toFixed(1) + 's' : Math.floor(ms / 60000) + 'm' + String(Math.round(ms % 60000 / 1000)).padStart(2, '0') + 's';
const fmtUsd = v => v < 0.005 ? '<$0.01' : v < 10 ? '$' + v.toFixed(2) : '$' + v.toFixed(1);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const setHTML = (e, h) => { if (e._h !== h) { e._h = h; e.innerHTML = h; } };   // skip no-op rewrites (they flicker)
const short = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const ago = ms => { const s = (Date.now() - ms) / 1000; return s < 90 ? 'just now' : s < 3600 ? Math.round(s / 60) + 'm ago' : s < 86400 ? Math.round(s / 3600) + 'h ago' : Math.round(s / 86400) + 'd ago'; };
const stallKind = k => STALLS[k] ? k : 'other';

/* ───────────────────────── avatars (inline SVG) ───────────────────────── */
function avatarSVG(shirt, hair, o = {}) {
  const skin = o.skin || '#e6b585', w = o.w || 44, h = o.h || 72, vb = o.vb || '0 0 48 78';   // vb crops (card portrait)
  const uncle = o.uncle ? `
    <rect x="14" y="31" width="5" height="13" fill="#b3312a"/>
    <rect x="19" y="31" width="4" height="4" fill="#f7e8bd"/>
    <rect x="19" y="39" width="4" height="4" fill="#f7e8bd"/>
    <rect x="15" y="15" width="8" height="6" fill="none" stroke="#24140d" stroke-width="2"/>
    <rect x="25" y="15" width="8" height="6" fill="none" stroke="#24140d" stroke-width="2"/>
    <rect x="23" y="17" width="2" height="2" fill="#24140d"/>` : '';
  return `<div class="flipper"><svg class="av" viewBox="${vb}" width="${w}" height="${h}" shape-rendering="crispEdges" aria-hidden="true">
    <rect x="9" y="74" width="30" height="4" fill="rgba(0,0,0,.22)"/>
    <g class="legs">
      <rect x="14" y="52" width="8" height="18" fill="#33415c"/><rect x="26" y="52" width="8" height="18" fill="#33415c"/>
      <rect x="12" y="69" width="11" height="5" fill="#24140d"/><rect x="25" y="69" width="11" height="5" fill="#24140d"/>
    </g>
    <g class="arms">
      <rect x="8" y="32" width="6" height="17" fill="${skin}"/><rect x="34" y="32" width="6" height="17" fill="${skin}"/>
      <rect x="8" y="47" width="7" height="6" fill="${skin}"/><rect x="33" y="47" width="7" height="6" fill="${skin}"/>
    </g>
    <rect x="12" y="29" width="24" height="26" fill="${shirt}"/>
    <rect x="15" y="29" width="18" height="3" fill="rgba(255,255,255,.28)"/>
    <rect x="21" y="25" width="6" height="5" fill="${skin}"/>
    <rect x="15" y="8" width="18" height="18" fill="${skin}"/>
    <rect x="12" y="13" width="3" height="8" fill="${skin}"/><rect x="33" y="13" width="3" height="8" fill="${skin}"/>
    <rect x="15" y="5" width="18" height="6" fill="${hair}"/>
    <rect x="12" y="8" width="6" height="8" fill="${hair}"/><rect x="30" y="8" width="6" height="8" fill="${hair}"/>
    <rect x="18" y="16" width="3" height="3" fill="#24140d"/><rect x="27" y="16" width="3" height="3" fill="#24140d"/>
    <rect x="23" y="19" width="3" height="2" fill="#b77a58"/>
    <rect x="20" y="23" width="8" height="2" fill="#8a3b2b"/>
    ${uncle}
  </svg></div>`;
}

/* ───────────────────────── scene wiring ───────────────────────── */
const sceneEl = $('#scene'), peopleEl = $('#people'), stallsEl = $('#stalls'), tablesEl = $('#tables'), railEl = $('#rail');
const logEl = $('#log'), uncleEl = $('#uncle'), uncleBubble = $('#uncleBubble'), uncleStatus = $('#uncleStatus');
const marks = { door: $('#doorMark'), counter: $('#counterFront') };
const stallEls = {}, tableEls = [];
let PRICES = { models: [], cacheWrite5m: 1.25, cacheWrite1h: 2 };

function buildStalls() {
  stallsEl.innerHTML = '';
  for (const [kind, s] of Object.entries(STALLS)) {
    const root = el('div', 'stall');
    root.dataset.kind = kind;
    root.innerHTML = `<div class="awning"></div>
      <div class="body"><span class="dish">${s.dish}</span><div class="info"><span class="name">${s.name}</span><span class="sub">${s.sub}</span></div></div>
      <div class="steam"><i></i><i></i><i></i></div><span class="count">0</span><i class="mark front"></i>`;
    stallsEl.appendChild(root);
    stallEls[kind] = { root, front: $('.front', root), count: $('.count', root), busy: 0, trips: 0 };
  }
}
function buildTables() {
  tablesEl.innerHTML = '';
  tableEls.length = 0;
  for (let i = 0; i < N_TABLES; i++) {
    const t = el('div', 'table');
    t.dataset.empty = 'true';
    t.innerHTML = `<div class="setting"><i class="stool l"></i><i class="stool r"></i>
      <div class="top"><span class="tno">${i + 1}</span><i class="mark seat"></i><div class="ware"></div></div></div>
      <div class="tlabel"></div><div class="tbill"></div>`;
    t.addEventListener('click', e => { e.stopPropagation(); const p = PEOPLE.get(TABLES[i][0]); if (p && p.onClick) p.onClick(); });
    tablesEl.appendChild(t);
    tableEls.push({ root: t, seat: $('.seat', t), ware: $('.ware', t), label: $('.tlabel', t), bill: $('.tbill', t) });
  }
}
$('#uncleAv').innerHTML = avatarSVG('#f4f1e8', '#8c8c8c', { uncle: true, w: 58, h: 96 });

/* The scene is drawn at its native size and CSS-scaled into the mini-map, so on-screen distances are divided by
 * SCALE to get back to scene coordinates (people's left/top live in scene coordinates and survive any rescale). */
const SCENE_W = 960, SCENE_H = 640;
let SCALE = 0.42;
function fitScene() {
  const mm = $('#minimap'), big = mm.classList.contains('expanded');
  SCALE = big ? Math.min((innerWidth - 48) / SCENE_W, (innerHeight - 140) / (SCENE_H + 30), 1.3)
    : innerWidth <= 1080 ? Math.min(1, (innerWidth - 8) / SCENE_W) : 0.42;
  mm.style.setProperty('--s', SCALE.toFixed(4));
  $('#mmToggle').textContent = big ? '⤡ shrink' : '⤢ expand';
}
function toggleMinimap(force) {
  const mm = $('#minimap'), big = force != null ? force : !mm.classList.contains('expanded');
  mm.classList.toggle('expanded', big); fitScene();
}
$('#mmToggle').addEventListener('click', e => { e.stopPropagation(); toggleMinimap(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && $('#minimap').classList.contains('expanded')) toggleMinimap(false); });
function anchor(marker) {
  const s = sceneEl.getBoundingClientRect(), r = marker.getBoundingClientRect();
  return { x: (r.left - s.left + r.width / 2) / SCALE, y: (r.top - s.top + r.height) / SCALE };
}

/* ───────────────────────── world state ───────────────────────── */
const TABLES = Array.from({ length: N_TABLES }, () => []);   // table -> person ids (owned by the tab scene)
const PEOPLE = new Map();                                     // person id -> person (one per open terminal tab)
let S = null, conn = { es: null, timers: [], src: '', id: '', opened: false, events: [] };

function freshState() {
  return {
    agents: new Map(), seq: 0, selected: null, filter: null, lastMainT: 0, replaying: false,
    totals: { i: 0, cw: 0, cr: 0, o: 0, th: 0, cost: 0, unpriced: false, trips: 0 },
    burn: [], toolRows: new Map(), chatTools: new Map(), chits: new Map(), uncleTimer: 0, sessionModel: '', mode: 'idle',
  };
}

function ensureAgent(id) {
  let a = S.agents.get(id);
  if (a) return a;
  const main = id === 'main', n = S.seq;
  a = {
    id, main, label: main ? 'Orchestrator' : 'sub-agent', atype: '', model: '', brief: '', parent: 'main',
    name: main ? 'Main agent' : NAMES[n % NAMES.length], color: main ? MAIN_COLOR : SHIRTS[n % SHIRTS.length], hair: HAIRS[n % HAIRS.length],
    tools: [], pending: new Map(), usage: { i: 0, cw: 0, cr: 0, o: 0, th: 0 }, cost: 0, unpriced: false, trips: 0,
    startT: 0, endT: 0, done: false, briefed: false, spawned: false, seated: false, lastSay: '',
    q: [], pumping: false, cur: null, node: null, at: null, seat: null, seatIdx: 0, jx: ((n % 3) - 1) * 16, state: 'queue', dead: false, waitInfo: null,
  };
  if (!main) S.seq++;
  S.agents.set(id, a);
  return a;
}
const subs = () => [...S.agents.values()].filter(a => !a.main);

/* ───────────────────────── prices ───────────────────────── */
function priceFor(model) {
  const m = (model || '').toLowerCase();
  return PRICES.models.find(p => m.includes(p.match)) || null;
}
function addUsage(a, u) {
  for (const k of ['i', 'cw', 'cr', 'o', 'th']) { a.usage[k] += u[k] || 0; S.totals[k] += u[k] || 0; }
  a.model = u.model || a.model;
  if (u.model) S.sessionModel = a.main ? u.model : S.sessionModel;
  const p = priceFor(u.model);
  if (p) {
    const cw1 = Math.min(u.cw1 || 0, u.cw || 0), cw5 = (u.cw || 0) - cw1;
    const c = ((u.i || 0) * p.in + (u.o || 0) * p.out + (u.cr || 0) * p.cr + cw5 * p.in * PRICES.cacheWrite5m + cw1 * p.in * PRICES.cacheWrite1h) / 1e6;
    a.cost += c; S.totals.cost += c;
    if (p.assumed) { a.assumed = true; S.totals.assumed = true; }
  } else if ((u.i || 0) + (u.cr || 0) + (u.o || 0) > 0) { a.unpriced = true; S.totals.unpriced = true; }
  if (!S.replaying) S.burn.push([Date.now(), (u.i || 0) + (u.cw || 0) + (u.cr || 0) + (u.o || 0)]);
}
const tokTotal = u => u.i + u.cw + u.cr + u.o;

/* ───────────────────────── reducer ───────────────────────── */
function apply(ev, instant) {
  const a = ensureAgent(ev.a);
  switch (ev.k) {
    case 'prompt': {
      feedRow(ev, ensureAgent('main'), `🧑 <b>You:</b> ${esc(short(ev.text, 600))}`);
      if (!S.replaying && WS.pending.length) WS.pending.shift().remove();   // the log confirmed a message we showed early
      chatAdd('u', ev.text, ev.t);
      break;
    }
    case 'spawn': {
      if (ev.label && !a.labelSet) { a.label = ev.label; a.labelSet = true; }
      a.atype = ev.atype || a.atype; a.parent = ev.parent || a.parent;
      if (ev.model) a.model = ev.model;
      if (ev.brief && !a.brief) a.brief = ev.brief;
      if (!a.spawned) {
        a.spawned = true; a.startT = ev.t;
        feedRow(ev, ensureAgent(a.parent), `🧾 ordered <b>${esc(a.name)}</b> → “${esc(short(a.label, 100))}”${a.atype ? ` <span class="res">[${esc(a.atype)}]</span>` : ''}`);
      }
      break;
    }
    case 'brief': {
      a.brief = a.brief || ev.text; a.briefed = true; if (!a.startT) a.startT = ev.t;
      feedRow(ev, a, `📋 got the brief <span class="res">(${fmtN(ev.text.length)} chars)</span>`);
      break;
    }
    case 'tool': {
      const rec = { id: ev.id, name: ev.name, kind: ev.kind, sum: ev.sum, inp: ev.inp, t: ev.t, pending: true, err: false, n: 0 };
      a.tools.push(rec); a.pending.set(ev.id, rec); a.trips++; S.totals.trips++;
      feedTool(ev, a, rec);
      if (a.main) S.chatTools.set(ev.id, chatAdd('t', `${DISH[stallKind(ev.kind)] || '🍽️'} ${ev.sum}`, ev.t));
      break;
    }
    case 'result': {
      const rec = a.pending.get(ev.id);
      if (rec) {
        rec.pending = false; rec.err = !!ev.err; rec.n = ev.n; rec.txt = ev.txt; rec.dur = ev.t - rec.t;
        a.pending.delete(ev.id);
      }
      feedResult(ev, rec);
      const ct = S.chatTools.get(ev.id);
      if (ct) { if (ev.err) { ct.classList.add('err'); ct.textContent += '  ✗'; } S.chatTools.delete(ev.id); }
      break;
    }
    case 'say': {
      a.lastSay = ev.text;
      feedRow(ev, a, `💬 ${esc(short(ev.text, 500))}`);
      if (a.main) chatAdd('a', ev.text, ev.t);
      break;
    }
    case 'usage': addUsage(a, ev); break;
    case 'done': {
      if (a.main || a.done) break;
      a.done = true; a.endT = ev.t;
      feedRow(ev, a, `✅ finished · ${a.trips} trips · ${fmtN(tokTotal(a.usage))} tokens`);
      break;
    }
  }
}

/* ───────────────────────── animation actions ───────────────────────── */
function ensurePerson(a) {
  if (a.main || a.node || a.dead) return a.node;
  const n = el('div', 'person');
  n.dataset.id = a.id; n.dataset.state = 'queue'; n.dataset.dir = 'r'; if (a.src) n.dataset.src = a.src;   // sprite sheets can key on data-src
  n.style.setProperty('--tagc', a.color);
  n.innerHTML = `<div class="bubble" hidden></div><div class="tag">${esc(a.name)}</div><div class="pst"></div><div class="hold"></div>${avatarSVG(a.color, a.hair)}`;
  n.addEventListener('click', e => { e.stopPropagation(); if (a.onClick) a.onClick(); });
  PEOPLE.set(a.id, a);
  peopleEl.appendChild(n);
  a.node = n;
  jump(a, marks.door, 0);
  requestAnimationFrame(() => n.classList.add('show'));
  return n;
}
function setState(a, s) { a.state = s; if (a.node) a.node.dataset.state = s; }
function jump(a, marker, jx) { const p = anchor(marker); const n = a.node; n.style.transitionDuration = '0ms'; n.style.left = (p.x + jx) + 'px'; n.style.top = p.y + 'px'; a.at = marker; a.atJx = jx; }
function go(a, marker, ms, jx = 0) {
  const n = a.node; if (!n || a.dead) return Promise.resolve();
  const p = anchor(marker), x = p.x + jx, cx = parseFloat(n.style.left);
  if (!isNaN(cx) && Math.abs(x - cx) > 2) n.dataset.dir = x < cx ? 'l' : 'r';
  n.style.transitionDuration = ms + 'ms'; n.style.left = x + 'px'; n.style.top = p.y + 'px';
  a.at = marker; a.atJx = jx;
  return ms > 0 ? sleep(ms) : Promise.resolve();
}
function seatFor(a) {
  if (a.seat == null) {
    let best = 0, bl = 1e9;
    TABLES.forEach((occ, i) => { if (occ.length < bl) { bl = occ.length; best = i; } });
    a.seat = best; a.seatIdx = TABLES[best].length; TABLES[best].push(a.id); refreshTable(best);
  }
  return tableEls[a.seat];
}
const seatJx = a => a.seatIdx ? (a.seatIdx % 2 ? 36 : -36) : 0;
function refreshTable(i) {
  const ids = TABLES[i], t = tableEls[i];
  t.root.dataset.empty = ids.length ? 'false' : 'true';
  t.label.textContent = ids.map(id => { const p = PEOPLE.get(id); return p && (p.tabNo ? `Tab ${p.tabNo} · ${p.name}` : p.name); }).filter(Boolean).join(' & ');
  if (!ids.length) { t.bill.textContent = ''; t.ware.innerHTML = ''; }
}
function addPlate(a, kind, err) {
  if (a.seat == null) return;
  const w = tableEls[a.seat].ware;
  w.appendChild(el('span', '', err ? '💥' : DISH[kind] || '🍽️'));
  while (w.children.length > 18) w.removeChild(w.firstChild);
}
function bubble(node, text, o = {}) {
  const b = node.querySelector('.bubble'); if (!b) return;
  b.textContent = text; b.classList.toggle('err', !!o.err); b.hidden = false;
  clearTimeout(node._bt);
  if (o.ms) node._bt = setTimeout(() => { b.hidden = true; }, o.ms);
}
const hideBubble = node => { const b = node.querySelector('.bubble'); if (b) b.hidden = true; clearTimeout(node._bt); };

const ACT = {
  async arrive(a) { setState(a, 'queue'); if (a.node) bubble(a.node, '⏳ waiting to order…'); },
  async order(a, act, sp) {
    if (a.node) hideBubble(a.node);
    setState(a, 'walking'); await go(a, marks.counter, 1000 * sp, a.jx);
    setState(a, 'happy'); if (a.node) bubble(a.node, '📋 got my order!', { ms: 1400 });
    uncleSays(`📋 ${a.name}: “${short(a.label, 60)}”`, 2200);
    await sleep(850 * sp);
    const t = seatFor(a);
    setState(a, 'walking'); await go(a, t.seat, 1100 * sp, seatJx(a));
    a.seated = true; a.node && (a.node.dataset.dir = 'r'); restPose(a);
  },
  async fetch(a, act, sp) {
    const st = stallEls[act.kind];
    st.trips++; st.count.textContent = st.trips;
    setState(a, 'walking'); if (a.node) hideBubble(a.node);
    await go(a, st.front, 850 * sp, a.jx);
    if (a.dead) return;
    setState(a, 'waiting');
    st.busy++; st.root.classList.add('busy');
    a.waitInfo = { base: `${DISH[act.kind]} ${short(act.sum, 70)}`, since: Date.now() };
    if (a.node) bubble(a.node, a.waitInfo.base);
    if (!act.resolved) await new Promise(r => { act.resolve = r; });
    a.waitInfo = null;
    st.busy = Math.max(0, st.busy - 1); if (!st.busy) st.root.classList.remove('busy');
    if (a.dead || !a.node) return;
    if (act.err) { setState(a, 'sad'); if (a.node) bubble(a.node, '😖 ' + short(act.sum, 50), { err: true, ms: 1600 }); await sleep(750 * sp); }
    setState(a, 'carrying'); a.node.querySelector('.hold').textContent = act.err ? '💥' : DISH[act.kind];
    if (a.node) hideBubble(a.node);
    await go(a, seatFor(a).seat, 950 * sp, seatJx(a));
    addPlate(a, act.kind, act.err);
    a.node && (a.node.dataset.dir = 'r'); restPose(a);
  },
  async leave(a, act, sp) {
    if (a.node) {
      setState(a, 'happy'); bubble(a.node, '👋 tab closed — bye!', { ms: 1600 });
      await sleep(900 * sp);
      setState(a, 'leaving'); await go(a, marks.door, 1300 * sp, 0);
      a.node.classList.add('gone'); await sleep(550); a.node.remove(); a.node = null;
    }
    if (a.seat != null) { const occ = TABLES[a.seat]; occ.splice(occ.indexOf(a.id), 1); tableEls[a.seat].ware.innerHTML = ''; refreshTable(a.seat); }
    a.dead = true; PEOPLE.delete(a.id);
  },
};

function enqueue(a, act) {
  if (a.dead) return;
  ensurePerson(a);
  if (act.t === 'fetch' && !a.seated && !a.q.some(x => x.t === 'order')) a.q.push({ t: 'order' });
  a.q.push(act); pump(a);
}
async function pump(a) {
  if (a.pumping) return; a.pumping = true;
  try {
    while (a.q.length && !a.dead) {
      const act = a.q.shift(), backlog = a.q.length;
      const sp = backlog > 4 ? 0.1 : backlog > 2 ? 0.3 : backlog > 0 ? 0.65 : 1;   // catch up when behind
      a.cur = act; await ACT[act.t](a, act, sp);
    }
  } finally { a.pumping = false; a.cur = null; }
}

/* Seated pose that matches the tab's status: working = eating, ready = relaxed, attention = waving for you. */
function restPose(a) {
  if (!a.node || !a.seated) return;
  setState(a, a.status === 'working' ? 'thinking' : a.status === 'attention' ? 'attention' : 'idle');
}
function settle() { refreshAll(); }
function relayout() {
  for (const a of PEOPLE.values()) if (a.node && a.at) jump(a, a.at, a.atJx || 0);
}

/* ───────────────────────── uncle (orchestrator) ───────────────────────── */
function uncleSays(text, ms = 3000) {
  uncleBubble.textContent = text; uncleBubble.hidden = false;
  clearTimeout(S.uncleTimer); S.uncleTimer = setTimeout(() => { uncleBubble.hidden = true; }, ms);
}
function uncleTick() {                                  // purely cosmetic
  const people = [...PEOPLE.values()].filter(p => !p.leaving), busy = people.filter(p => p.status === 'working').length;
  uncleEl.dataset.state = busy ? 'waiting' : 'idle';
  uncleStatus.textContent = people.length ? `☕ ${headcount().text}` : '☕ sipping kopi';
}

/* ───────────────────────── order rail ───────────────────────── */
function renderRail() {                                 // one order chit per open tab: what you last asked it
  const no = t => (PEOPLE.get(tabPersonId(t)) || {}).tabNo || 1e9;
  const tabs = [...(FL.tabs || [])].sort((x, y) => no(x) - no(y));   // same order as the tab numbers
  const have = railEl._chits || (railEl._chits = new Map()), keep = new Set();
  tabs.forEach((t, i) => {
    const pid = tabPersonId(t), s = FL.byKey.get(t.src + ':' + t.sid), p = PEOPLE.get(pid);
    const st = !s ? 'queued' : s.status === 'working' ? 'cooking' : s.status === 'attention' ? 'attention' : 'served';
    const what = (s && (s.last_prompt || s.title)) || 'new tab — nothing ordered yet';
    const lbl = { queued: 'new', cooking: 'cooking…', attention: '⚠ needs you', served: '✓ served' }[st];
    let c = have.get(pid);
    if (!c) {                                            // only a NEW tab's chit is created (and drops in once)
      c = el('div', 'chit'); c.dataset.pid = pid; have.set(pid, c);
      c.addEventListener('click', e => { e.stopPropagation(); const q = PEOPLE.get(c.dataset.pid); if (q && q.onClick) q.onClick(); });
    }
    keep.add(pid);
    if (c.dataset.s !== st) c.dataset.s = st;
    setHTML(c, `<b title="${esc(what)}">${esc(short(what, 60))}</b><small><span>Tab ${p ? p.tabNo + ' · ' + esc(p.name) : i + 1}</span><span class="st">${lbl}</span></small>`);
    if (railEl.children[i] !== c) railEl.insertBefore(c, railEl.children[i] || null);
  });
  for (const [pid, c] of have) if (!keep.has(pid)) { c.remove(); have.delete(pid); }
  const cnt = `${tabs.length} tab${tabs.length === 1 ? '' : 's'}`;
  if ($('#railCount').textContent !== cnt) $('#railCount').textContent = cnt;
}

/* ───────────────────────── workspace: agent tabs + read-only replies ───────────────────────── */
const chatEl = $('#chat'), MAX_CHAT = 600;
function chatAdd(kind, text, t) {                       // kind: u = you · a = the agent · t = a tool call
  const pinned = chatEl.scrollHeight - chatEl.scrollTop - chatEl.clientHeight < 80;
  const m = el('div', 'msg-' + kind);
  if (kind === 't') m.textContent = text;
  else { m.appendChild(el('small', '', esc((kind === 'u' ? 'You' : (S.agents.get('main') || {}).name || 'Agent') + ' · ' + fmtT(t)))); m.appendChild(document.createTextNode(text)); }
  chatEl.appendChild(m);
  while (chatEl.children.length > MAX_CHAT) chatEl.firstChild.remove();
  if (pinned && !S.replaying) chatEl.scrollTop = chatEl.scrollHeight;
  return m;
}
const PORTRAIT = (p, w, h) => avatarSVG(p.color, p.hair, { vb: '6 2 36 40', w, h });
function renderWork() {
  const strip = $('#wtabs'), have = strip._tabs || (strip._tabs = new Map()), keep = new Set();
  const people = [...PEOPLE.values()].filter(p => p.tabNo && !p.leaving).sort((x, y) => x.tabNo - y.tabNo);
  people.forEach((p, i) => {
    let b = have.get(p.id);
    if (!b) {
      b = el('button', 'wtab'); b.type = 'button'; have.set(p.id, b);
      b.innerHTML = `<span class="w-av" aria-hidden="true">${PORTRAIT(p, 20, 22)}</span><i class="w-dot"></i><span class="w-lbl"></span>`;
      b.dataset.src = p.src || '';
      b.addEventListener('click', () => { const q = PEOPLE.get(p.id); if (q && q.onClick) q.onClick(); });
    }
    keep.add(p.id);
    const lbl = `${p.tabNo} · ${p.name}`, st = p.status || '';
    if ($('.w-lbl', b).textContent !== lbl) $('.w-lbl', b).textContent = lbl;
    if ($('.w-dot', b).dataset.s !== st) $('.w-dot', b).dataset.s = st;
    b.classList.toggle('on', p.id === WS.tab);
    b.title = `Tab ${p.tabNo} · ${SRC_NAME[p.src] || p.src} · ${p.label || ''}`;
    if (strip.children[i] !== b) strip.insertBefore(b, strip.children[i] || null);
  });
  for (const [id, b] of have) if (!keep.has(id)) { b.remove(); have.delete(id); }
  // header for the open session
  const who = curTab(), t = who && tabInfo(who);
  const s = who ? (who.sess ? FL.byKey.get(keyOf(who.sess)) : (t && placeholderFor(t))) : conn.id ? FL.byKey.get(selKey()) : null;
  if (!who && !conn.id) { setHTML($('#whead'), ''); return; }
  const live = canType(who, t);
  const bits = [who ? `<b>Tab ${who.tabNo} · ${esc(who.name)}</b>` : `<b>${esc((s && s.title) || 'Session')}</b>`, SRC_NAME[conn.src] || conn.src,
    (s && s.cwd) ? esc(projectName(s)) : '', s && s.branch && '⎇ ' + esc(s.branch), s && s.model && esc(s.model.replace('claude-', ''))].filter(Boolean).join(' · ');
  setHTML($('#whead'), `${who ? `<span class="c-av" data-src="${esc(who.src)}">${PORTRAIT(who, 30, 33)}</span>` : ''}<span>${bits}${s ? `<br>${esc(s.status === 'attention' ? '⚠ ' + (s.reason || 'needs you') : PILL[s.status] || '')}` : ''}</span>${t && t.detached ? `<span title="Started from this page, so it has no terminal window. This opens it in yours (Ctrl-] to detach).">in a terminal: <code>kopi attach ${t.ctl}</code></span>` : ''}${live ? '<span class="ro live" title="Messages are typed in through kopi, as if you typed them">● live · you can type</span>' : '<span class="ro" title="Replies are read from the session log">read-only · from the log</span>'}`);
}

/* ───────────────────────── talking to an agent (typed in through its kopi wrapper by the server) ───────────────────────── */
let CFG = { control: false, hook: false, readOnly: false, token: '', home: '~' };
const WS = { tab: null, drafts: new Map(), sending: false, screenOn: false, termES: null, termFor: '', autoScreen: '', pendingNew: null, pending: [] };
const promptEl = $('#prompt');
const curTab = () => { const p = WS.tab && PEOPLE.get(WS.tab); return p && !p.leaving ? p : null; };
const tabInfo = p => (FL.tabs || []).find(t => tabPersonId(t) === p.id) || null;
const canType = (p, t) => !!(CFG.control && p && t && t.ctl);
async function post(path, body) {
  const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Kopitiam-Token': CFG.token }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'HTTP ' + r.status);
  return d;
}
function note(text, ok) { const n = $('#cnote'); n.textContent = text; n.className = 'c-note ' + (ok ? 'ok' : ok === false ? 'err' : ''); n.title = text; }
function setWsTab(id) {                                  // each agent keeps its own draft; switching never retargets a message
  if (id === WS.tab) return;
  if (WS.tab) { if (promptEl.value) WS.drafts.set(WS.tab, promptEl.value); else WS.drafts.delete(WS.tab); }
  WS.tab = id; promptEl.value = (id && WS.drafts.get(id)) || ''; note('');
  if (WS.screenOn) setScreen(false);
  renderComposer();
}
function selectTab(id, agentId) {
  const p = PEOPLE.get(id); if (!p) return;
  if (p.sess) { setWsTab(id); openFleetSession(p.sess, agentId); }
  else {                                                 // a new tab without a log yet: nothing to replay, but you can talk to it
    $('#follow').checked = false; stopAll(); reset(); conn.src = conn.id = '';
    setWsTab(id); setStatus('replay', 'new tab · no messages yet');
  }
  renderWork(); renderComposer();
}
function renderComposer() {
  const p = curTab(), t = p && tabInfo(p), ok = canType(p, t);
  const why = CFG.readOnly ? 'Read-only: the server was started with --read-only.'
    : !p ? (conn.id ? 'This session’s terminal is closed. Pick an open tab to talk to it.' : 'Pick an agent tab, or start one with + Claude / + Codex.')
    : !t || !t.ctl ? `Tab ${p.tabNo} was opened before kopi was set up, so it can only be watched. ` + (CFG.hook
      ? `Open a new terminal and run ${p.src} there, or use + Claude / + Codex.`
      : 'Run once:  python3 ~/kopitiam/kopi.py install-shell  and every new claude / codex terminal can be typed into.') : '';
  const who = p ? `Tab ${p.tabNo} · ${p.name}` : '';
  const ph = ok ? `Message ${who} (${SRC_NAME[p.src] || p.src}). Enter to send · Shift+Enter for a new line${p.status === 'working' ? ' · it is busy: the agent queues your message' : ''}` : why;
  if (promptEl.placeholder !== ph) promptEl.placeholder = ph;
  promptEl.disabled = !ok;
  const btn = $('#sendBtn'), bt = ok ? `Send to ${who}` : 'Send';
  if (btn.textContent !== bt) btn.textContent = bt;
  btn.disabled = !ok || WS.sending;
  $$('#ckeys button').forEach(b => { b.disabled = !ok; });
  $('#wnew').hidden = !CFG.control;
  $('.chat').dataset.hint = p && !p.sess ? `${who} has no messages yet. Say hi below.` : 'Click a customer, a card or a tab to open that agent here.';
  // show the live terminal when it waits on you, and always for agents started here (it is their only screen)
  if (ok && (p.status === 'attention' || t.detached) && WS.autoScreen !== p.id && !WS.screenOn) { WS.autoScreen = p.id; setScreen(true); }
  if (!ok && WS.screenOn) setScreen(false);
}
async function sendNow() {
  const p = curTab(), t = p && tabInfo(p), text = promptEl.value.trim();
  if (!canType(p, t) || !text || WS.sending) return;
  const target = p.id;                                   // the message goes to the tab it was written for, nothing else
  WS.sending = true; renderComposer(); note('sending…');
  WS.drafts.delete(target); promptEl.value = '';         // show it right away; the log confirms it a moment later
  const shown = p.sess && keyOf(p.sess) === selKey(), bubble = shown ? chatAdd('u', text, Date.now()) : null;
  if (bubble) { bubble.classList.add('pending'); bubble.firstChild.textContent = 'You · sending…'; WS.pending.push(bubble); }
  try {
    await post('/api/send', { src: t.src, pid: t.pid, sid: t.sid, text });
    if (bubble) bubble.firstChild.textContent = 'You · sent';
    note(`✓ sent to Tab ${p.tabNo} · ${p.name}`, true);
  } catch (err) {
    if (bubble) { bubble.remove(); WS.pending = WS.pending.filter(b => b !== bubble); }
    if (WS.tab === target) { if (!promptEl.value) promptEl.value = text; }   // give the draft back
    else if (!WS.drafts.get(target)) WS.drafts.set(target, text);
    note('✗ ' + err.message, false);
  }
  finally { WS.sending = false; renderComposer(); }
}
$('#composer').addEventListener('submit', e => { e.preventDefault(); sendNow(); });
promptEl.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendNow(); } });
$('#ckeys').addEventListener('click', async e => {
  const b = e.target.closest('button'); if (!b || b.disabled) return;
  if (b.dataset.k === 'screen') return setScreen(!WS.screenOn);
  const p = curTab(), t = p && tabInfo(p); if (!canType(p, t)) return;
  try { await post('/api/key', { src: t.src, pid: t.pid, sid: t.sid, key: b.dataset.k }); note(`sent ${b.textContent.trim()} to Tab ${p.tabNo}`, true); }
  catch (err) { note('✗ ' + err.message, false); }
});
/* The live terminal: xterm.js fed by the agent's own output (via kopi), and whatever you type in it goes back in. */
let TERM = null;
const TERM_THEME = { background: '#221710', foreground: '#f5e8c8', cursor: '#e0b25a', cursorAccent: '#221710', selectionBackground: '#6b4a2e',
  black: '#2b1d14', red: '#e0634b', green: '#8fc27a', yellow: '#e0b25a', blue: '#6fa8c9', magenta: '#c98bb3', cyan: '#6fc2b4', white: '#e9dcc0',
  brightBlack: '#8a6d4a', brightRed: '#ff8a70', brightGreen: '#b3e39e', brightYellow: '#ffd67a', brightBlue: '#9ccbe6', brightMagenta: '#e6aed2', brightCyan: '#9ce6d8', brightWhite: '#fffaf0' };
const b64bytes = b => Uint8Array.from(atob(b), c => c.charCodeAt(0));
const bytesb64 = str => btoa(String.fromCharCode(...new TextEncoder().encode(str)));
function ensureTerm() {
  if (TERM || !window.Terminal) return TERM;
  TERM = new Terminal({ theme: TERM_THEME, fontFamily: '"Noto Sans Mono","DejaVu Sans Mono",ui-monospace,monospace', fontSize: 12,
    lineHeight: 1.1, scrollback: 5000, cursorBlink: true, allowProposedApi: false, cols: 120, rows: 36 });
  TERM.open($('#term'));
  let q = '', timer = 0;                                 // batch keystrokes: one request per ~25 ms of typing
  TERM.onData(d => {
    q += d; if (timer) return;
    timer = setTimeout(async () => {
      const data = q; q = ''; timer = 0;
      const p = curTab(), t = p && tabInfo(p); if (!canType(p, t) || WS.termFor !== p.id) return;
      try { await post('/api/input', { src: t.src, pid: t.pid, sid: t.sid, data: bytesb64(data) }); } catch (err) { note('✗ ' + err.message, false); }
    }, 25);
  });
  return TERM;
}
function fitDetached(t) {                                // an agent started here takes the size of the panel
  const box = $('#term'), cell = TERM && TERM._core && TERM._core._renderService && TERM._core._renderService.dimensions;
  const cw = (cell && cell.css && cell.css.cell.width) || 7.2, ch = (cell && cell.css && cell.css.cell.height) || 14.5;
  const cols = Math.max(40, Math.floor((box.clientWidth - 16) / cw)), rows = Math.max(10, Math.floor((box.clientHeight - 12) / ch));
  post('/api/resize', { src: t.src, pid: t.pid, sid: t.sid, cols, rows }).catch(() => {});
}
function setScreen(on) {
  WS.screenOn = on; $('#screenBox').hidden = !on;
  $('#ckeys [data-k=screen]').classList.toggle('on', on);
  if (WS.termES) { WS.termES.close(); WS.termES = null; WS.termFor = ''; }
  if (!on) return;
  const p = curTab(), t = p && tabInfo(p), term = ensureTerm();
  if (!canType(p, t) || !term) return;
  term.reset(); term.write('\x1b[2mconnecting…\x1b[0m\r\n');
  $('#scrHint').textContent = t.detached ? 'started here: this is its only screen. Click it and type' : 'the same screen as its terminal window. Click it and type';
  WS.termFor = p.id;
  const es = WS.termES = new EventSource(`/api/term?src=${encodeURIComponent(t.src)}&pid=${t.pid}`);
  es.onmessage = e => {
    if (WS.termES !== es) return;
    const m = JSON.parse(e.data);
    if (m.op === 'hello') { term.reset(); term.resize(m.cols, m.rows); if (m.detached) setTimeout(() => fitDetached(t), 50); }
    else if (m.op === 'out') term.write(b64bytes(m.data));
    else if (m.op === 'size') term.resize(m.cols, m.rows);            // its terminal was resized: follow it
    else if (m.op === 'exit') { term.write(`\r\n\x1b[33m[the agent exited${m.code != null ? ' with code ' + m.code : ''}]\x1b[0m\r\n`); es.close(); }
    else if (m.op === 'error') { term.write(`\r\n\x1b[31m[${m.error}]\x1b[0m\r\n`); es.close(); }
  };
  es.onerror = () => { if (es.readyState === EventSource.CLOSED && WS.termES === es) term.write('\r\n\x1b[31m[connection lost]\x1b[0m\r\n'); };
  setTimeout(() => term.focus(), 100);
}
// + Claude / + Codex: a new agent under a kopi with no terminal window; the workspace opens it as soon as it shows up
let newSrc = 'claude';
$('#wnew').addEventListener('click', e => {
  const b = e.target.closest('[data-new]'); if (!b) return;
  newSrc = b.dataset.new; $('#newWhat').textContent = SRC_NAME[newSrc];
  let last = ''; try { last = localStorage.getItem('kopi.cwd') || ''; } catch { /* storage blocked */ }
  const cur = curTab() && tabInfo(curTab());
  $('#newCwd').value = last || (cur && cur.cwd) || CFG.home;
  $('#newForm').hidden = false; $('#newCwd').focus();
});
$('#newCancel').addEventListener('click', () => { $('#newForm').hidden = true; });
$('#newForm').addEventListener('submit', async e => {
  e.preventDefault();
  const cwd = $('#newCwd').value.trim() || CFG.home;
  try {
    const d = await post('/api/new', { src: newSrc, cwd });
    try { localStorage.setItem('kopi.cwd', cwd); } catch { /* storage blocked */ }
    $('#newForm').hidden = true; WS.pendingNew = { ctl: d.ctl, t: Date.now() };
    note(`starting ${SRC_NAME[newSrc]}…`, true);
  } catch (err) { note('✗ ' + err.message, false); }
});
function openPendingNew() {
  if (!WS.pendingNew) return;
  const t = (FL.tabs || []).find(x => x.ctl === WS.pendingNew.ctl);
  if (t && PEOPLE.has(tabPersonId(t))) { WS.pendingNew = null; selectTab(tabPersonId(t)); note('✓ new agent ready: say hi', true); }
  else if (Date.now() - WS.pendingNew.t > 30000) { note(`✗ the new agent did not show up (kopi pid ${WS.pendingNew.ctl})`, false); WS.pendingNew = null; }
}

/* ───────────────────────── log feed ───────────────────────── */
function feedRow(ev, a, html, cls = '') {
  const r = el('div', `row k-${ev.k} ${cls}`);
  r.dataset.a = a.id;
  r.innerHTML = `<span class="t">${fmtT(ev.t)}</span><span><span class="who" style="--c:${a.color}">${esc(a.name)}</span><span class="msg">${html}</span></span>`;
  r.addEventListener('click', () => select(a.id, false));
  if (S.filter && S.filter !== a.id) r.classList.add('hide');
  const pane = $('#pane-log'), pinned = pane.scrollHeight - pane.scrollTop - pane.clientHeight < 80;
  logEl.appendChild(r);
  while (logEl.children.length > MAX_FEED) logEl.firstChild.remove();
  if (pinned && !S.replaying) pane.scrollTop = pane.scrollHeight;
  return r;
}
function feedTool(ev, a, rec) {
  const r = feedRow(ev, a, `${DISH[stallKind(ev.kind)] || '🍽️'} ${esc(ev.sum)} <span class="res wait">⏳</span>`);
  r.title = ev.inp || '';
  S.toolRows.set(ev.id, $('.res', r));
}
function feedResult(ev, rec) {
  const s = S.toolRows.get(ev.id); if (!s) return;
  s.className = 'res' + (ev.err ? ' err' : '');
  s.textContent = ev.err ? `✗ error · ${fmtN(ev.n)} chars` : `✓ ${fmtN(ev.n)} chars${rec && rec.dur ? ' · ' + fmtD(rec.dur) : ''}`;
  S.toolRows.delete(ev.id);
}

/* ───────────────────────── bill & ticket ───────────────────────── */
function meter(u) {
  const t = tokTotal(u) || 1, p = x => (100 * x / t).toFixed(1) + '%';
  return `<div class="meter"><i class="m-cr" style="width:${p(u.cr)}"></i><i class="m-cw" style="width:${p(u.cw)}"></i><i class="m-i" style="width:${p(u.i)}"></i><i class="m-o" style="width:${p(u.o)}"></i></div>`;
}
function costText(o) { return o.cost > 0 ? (o.assumed ? '~' : '') + fmtUsd(o.cost) + (o.unpriced ? '+' : '') : (o.unpriced ? 'n/a' : '–'); }
function renderBill() {
  const T = S.totals, all = tokTotal(T);
  const rows = [...S.agents.values()].filter(a => a.main || tokTotal(a.usage) > 0).sort((x, y) => (y.main - x.main) || (x.startT - y.startT));
  const hitDen = T.i + T.cw + T.cr;
  const pane = $('#pane-bill'), before = pane._h;
  setHTML(pane, `<div class="receipt">
    <h3>KOPITIAM AGENTS</h3><div class="sub">— the bill so far —</div><hr>
    ${rows.map(a => {
      const u = a.usage, tt = tokTotal(u);
      return `<div class="rline" data-id="${esc(a.id)}"><div class="nm"><i style="--c:${a.color}"></i><span title="${esc(a.label)}">${esc(a.name)} · ${esc(short(a.main ? 'orchestrator' : a.label, 26))}</span></div>
        <div class="cost">${costText(a)}</div>${meter(u)}
        <div class="det">${esc((a.model || '?').replace('claude-', ''))} · ${a.trips} trips · ${fmtN(tt)} tok (${all ? Math.round(100 * tt / all) : 0}%)<br>
        ♻️ read ${fmtN(u.cr)} · ✍️ write ${fmtN(u.cw)} · new ${fmtN(u.i)} · out ${fmtN(u.o)}${u.th ? ` <span title="thinking is billed as output">(🧠 ${fmtN(u.th)})</span>` : ''}</div></div>`;
    }).join('') || '<div class="empty"><big>🧾</big>Nothing ordered yet.</div>'}
    <hr>
    <div class="rtotal"><span>TOTAL TOKENS</span><span>${fmtN(all)}</span></div>
    <div class="rtotal"><span>cache hit rate</span><span>${hitDen ? Math.round(100 * T.cr / hitDen) + '%' : '–'}</span></div>
    <div class="rtotal"><span>est. API price</span><span>${costText(T)}</span></div>
    <div class="legend"><span><i style="background:#9cc9c1"></i>cache read</span><span><i style="background:#e0b25a"></i>cache write</span><span><i style="background:#c9573f"></i>new input</span><span><i style="background:#3b3b6b"></i>output</span></div>
    <div class="rnote">Tokens are exact (from the session log, de-duplicated per API reply). Prices are estimates from <code>web/prices.json</code>${T.assumed ? ' — “~” marks an assumed price' : ''}${T.unpriced ? ' — “+”/n/a: some models have no price entry' : ''}. On a subscription you are not billed per token.</div>
  </div>`);
  if (pane._h !== before) $$('#pane-bill .rline').forEach(r => r.addEventListener('click', () => select(r.dataset.id, true)));
}
function renderTicket() {
  const a = S.selected && S.agents.get(S.selected), pane = $('#pane-ticket');
  if (!a) { setHTML(pane, '<div class="empty"><big>🎫</big>Click a customer, a table, an order chit or a log line to see its ticket.</div>'); return; }
  const u = a.usage, end = a.endT || Date.now();
  const status = a.main ? 'running the shop' : a.done ? 'finished' : a.pending.size ? 'waiting on ' + [...a.pending.values()].map(r => r.name).join(', ') : 'thinking';
  const before = pane._h;
  setHTML(pane, `<div class="ticket">
    <h3><span style="color:${a.color}">●</span> ${esc(a.name)} <small style="font:500 13px var(--sans)">· ${esc(a.main ? 'orchestrator' : a.atype || 'sub-agent')}</small></h3>
    <div class="meta">${esc(a.main ? 'Main session' : a.label)}<br>${esc(status)}${a.startT ? ' · ' + fmtD(end - a.startT) + (a.done ? ' total' : ' so far') : ''}${a.model ? ' · ' + esc(a.model.replace('claude-', '')) : ''}</div>
    <a href="#" id="tkFilter">show only their log lines →</a>
    <h4>Tokens · ${costText(a)}</h4>${meter(u)}
    <div class="det" style="font:11.5px var(--mono);color:var(--ink-2)">♻️ cache read ${fmtN(u.cr)} · ✍️ write ${fmtN(u.cw)} · new ${fmtN(u.i)} · out ${fmtN(u.o)}${u.th ? ' · 🧠 ' + fmtN(u.th) : ''}</div>
    ${a.brief ? `<h4>The order (what they were told)</h4><pre>${esc(a.brief)}</pre>` : ''}
    <h4>Trips to the stalls · ${a.tools.length}</h4>
    <ul class="tl">${a.tools.slice(-60).reverse().map(t => `<li class="${t.err ? 'err' : ''}" title="${esc(t.inp || '')}"><span>${DISH[stallKind(t.kind)] || '🍽️'}</span><span>${esc(short(t.sum, 70))}</span><span class="dur">${t.pending ? '⏳' : (t.err ? '✗ ' : '') + (t.dur != null ? fmtD(t.dur) : '')}</span></li>`).join('') || '<li><span></span><span>none yet</span></li>'}</ul>
  </div>`);
  if (pane._h !== before) $('#tkFilter').addEventListener('click', e => { e.preventDefault(); setFilter(a.id); tab('log'); });
}

/* ───────────────────────── selection, tabs, filter ───────────────────────── */
function select(id, openTicket) {
  S.selected = id;
  $$('.person.sel').forEach(n => n.classList.remove('sel'));
  tableEls.forEach(t => t.root.classList.remove('sel'));
  const a = S.agents.get(id);
  if (a && a.node) a.node.classList.add('sel');
  if (a && a.seat != null) tableEls[a.seat].root.classList.add('sel');
  renderTicket();
  if (openTicket) tab('ticket');
}
function setFilter(id) {
  S.filter = id;
  $('#filterBar').hidden = !id;
  if (id) $('#filterName').textContent = S.agents.get(id)?.name || id;
  $$('.row', logEl).forEach(r => r.classList.toggle('hide', !!id && r.dataset.a !== id));
}
$('#filterClear').addEventListener('click', e => { e.preventDefault(); setFilter(null); });
function tab(name) {
  $$('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === name));
  ['log', 'bill', 'ticket'].forEach(n => { $('#pane-' + n).hidden = n !== name; });
  if (name === 'bill') renderBill(); if (name === 'ticket') renderTicket();
}
$$('.tabs button').forEach(b => b.addEventListener('click', () => tab(b.dataset.tab)));
sceneEl.addEventListener('click', () => { if (S) select(null, false); });

/* ───────────────────────── chips / status / tick ───────────────────────── */
function setStatus(kind, text) { const s = $('#status'); s.dataset.s = kind; $('span', s).textContent = text; }
function refreshAll() { updateChips(); if (!$('#pane-bill').hidden) renderBill(); if (!$('#pane-ticket').hidden) renderTicket(); }
function updateChips() {
  const T = S.totals, hitDen = T.i + T.cw + T.cr;
  const hc = headcount(); $('#cClaude').textContent = hc.claude; $('#cCodex').textContent = hc.codex;
  $('#cTrips').textContent = fmtN(T.trips);
  $('#cTok').textContent = fmtN(tokTotal(T));
  $('#cHit').textContent = hitDen ? Math.round(100 * T.cr / hitDen) + '%' : '–';
  $('#cCost').textContent = costText(T);
  const cut = Date.now() - 60000; S.burn = S.burn.filter(b => b[0] >= cut);
  $('#cBurn').textContent = S.mode === 'session' && S.live === false ? '–' : fmtN(S.burn.reduce((s, b) => s + b[1], 0));
}
setInterval(() => {
  if (!S) return;
  uncleTick(); updateChips();
  const now = Date.now();
  for (const a of PEOPLE.values()) {
    if (a.waitInfo && a.node) {
      const s = Math.round((now - a.waitInfo.since) / 1000);
      if (s >= 3) bubble(a.node, `${a.waitInfo.base} · ${s}s`);
    }
  }
  if (!$('#pane-bill').hidden) renderBill();
  if (!$('#pane-ticket').hidden) renderTicket();
}, 700);
window.addEventListener('resize', () => { fitScene(); if (S) relayout(); });

/* ───────────────────────── connection: real sessions ───────────────────────── */
function stopAll() {
  if (conn.es) { conn.es.close(); conn.es = null; }
  conn.timers.forEach(clearTimeout); conn.timers = [];
}
function reset() {
  logEl.innerHTML = ''; chatEl.innerHTML = ''; WS.pending = []; $('#filterBar').hidden = true;
  S = freshState(); ensureAgent('main');
  renderTicket(); renderBill(); updateChips();
}
function connect(src, id, live) {
  stopAll(); reset();
  S.mode = 'session'; S.live = live; conn.src = src; conn.id = id; conn.opened = false; conn.events = [];
  fillPicker();
  const who = [...PEOPLE.values()].find(p => p.sess && keyOf(p.sess) === selKey()), m = S.agents.get('main');
  setWsTab(who ? who.id : null);
  m.name = who ? `Tab ${who.tabNo} · ${who.name}` : 'Main agent'; if (who) m.color = who.color;
  setStatus('offline', 'connecting…');
  renderWork();
  const es = conn.es = new EventSource(`/api/stream?src=${encodeURIComponent(src)}&id=${encodeURIComponent(id)}`);
  es.onopen = () => {
    if (conn.opened) reset();                       // auto-reconnect replays from the top, so start clean
    conn.opened = true; S.mode = 'session'; S.live = live;
    setStatus(live ? 'live' : 'replay', live ? 'LIVE' : 'replay · session idle');
  };
  es.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.replay) { S.replaying = true; conn.events.push(...m.events); m.events.forEach(ev => apply(ev, true)); }
    else if (m.replayDone) { S.replaying = false; settle(); chatEl.scrollTop = chatEl.scrollHeight; if (FL.pendingSelect && S.agents.has(FL.pendingSelect)) { select(FL.pendingSelect, true); } FL.pendingSelect = null; tab($$('.tabs .on')[0]?.dataset.tab || 'log'); const p = $('#pane-log'); p.scrollTop = p.scrollHeight; }
    else if (m.events) { conn.events.push(...m.events); m.events.forEach(ev => apply(ev, true)); }
  };
  es.onerror = () => setStatus('offline', 'server disconnected — retrying');
}

/* ───────────────────────── fleet: who is done, who needs you (read-only) ───────────────────────── */
const FL = { view: 'active', tabs: [], pendingSelect: null, byKey: new Map(), cards: new Map(), prev: new Map(), unseen: new Set(), notifyOn: false, first: true, secs: {} };
const keyOf = s => s.src + ':' + s.id;
const selKey = () => conn.src + ':' + conn.id;
const PILL = { attention: '⚠ Needs you', ready: '✅ Ready', working: 'Working' };

function buildFleet() {
  const list = $('#fleetList');
  list.innerHTML = '';
  const mk = (id, cls, title, det) => {
    const s = el(det ? 'details' : 'div', 'fsec ' + cls);
    s.id = 'sec-' + id; s.dataset.empty = 'true';
    s.innerHTML = `<${det ? 'summary' : 'div'} class="fsec-h"><span>${title}</span><span class="n">0</span></${det ? 'summary' : 'div'}><div class="items"></div>`;
    list.appendChild(s); FL.secs[id] = s; return s;
  };
  mk('tabs', 'opentabs', '🖥 Open terminal tabs'); mk('closed', 'old', 'Closed sessions — resumable', true);
}
function makeCard() {
  const c = el('div', 'card');
  c.innerHTML = `<div class="c-av" aria-hidden="true"></div><div class="c-body"><div class="c-tab"></div><div class="c-top"><span class="pill"></span><span class="c-title"></span><span class="c-tool"></span></div>
    <div class="c-meta"></div><div class="c-reason"></div><div class="c-now"></div><div class="c-say"></div><div class="c-agents"></div><div class="c-stats"></div></div>`;
  c.addEventListener('click', e => {
    const row = e.target.closest('.ag'), pid = c.dataset.pid;
    if (pid && PEOPLE.has(pid)) selectTab(pid, row ? row.dataset.id : null);
    else openFleetSession(FL.byKey.get(c.dataset.key), row ? row.dataset.id : null);
  });
  return c;
}
function openFleetSession(s, agentId) {
  if (!s) return;
  $('#follow').checked = false;
  FL.unseen.delete(keyOf(s));
  if (selKey() !== keyOf(s)) { FL.pendingSelect = agentId || null; connect(s.src, s.id, s.status === 'working'); }
  else if (agentId && S.agents.has(agentId)) select(agentId, true);
  renderFleet();
}
const ACT_ICON = { read: '🍛', run: '🥞', edit: '🍞', web: '☕', other: '🍧', delegate: '🧾', think: '💭', say: '💬', done: '✅', idle: '💤' };
const elapsed = t => t ? fmtD(Math.max(0, Date.now() - t)) : '';
function doingHTML(d, live) {
  if (!d) return '';
  return `<span class="d-ico">${ACT_ICON[d.kind] || '🔧'}</span><span class="d-txt">${esc(d.text)}</span>${live && d.since ? `<span class="d-t">${elapsed(d.since)}</span>` : ''}`;
}
function agentRowsHTML(s) {
  const open = selKey() === keyOf(s) && S;
  return (s.agents || []).map(a => {
    const live = a.state === 'working', sc = open && S.agents.get(a.id);     // scene name/colour when this session is open
    const dur = a.start_t ? fmtD((a.end_t || Date.now()) - a.start_t) : '';
    const who = sc ? `<span class="ag-name" style="--c:${sc.color}">${esc(sc.name)}</span>` : '';
    return `<div class="ag st-${a.state}" data-id="${esc(a.id)}" title="${esc(a.label)}">
      <div class="ag-top"><i class="ag-dot"></i>${who}<b>${esc(a.label)}</b></div>
      <div class="ag-doing">${doingHTML(a.doing, live)}</div>
      <div class="ag-meta">${[a.state === 'stopped' ? 'stopped' : a.state === 'done' ? 'done' : '', a.atype, (a.model || '').replace('claude-', ''), a.trips + ' trips', fmtN(a.tok) + ' tok', dur].filter(Boolean).map(esc).join(' · ')}</div></div>`;
  }).join('');
}
const projectName = s => (s.cwd || '').split('/').filter(Boolean).slice(-1)[0] || '~';
function updateCard(c, s, tab, n) {
  c.className = 'card s-' + s.status + (s.id && selKey() === keyOf(s) ? ' sel' : '') + (c.classList.contains('flash') ? ' flash' : '') + (tab ? ' is-tab' : '');
  const tb = $('.c-tab', c); tb.hidden = !tab;
  const who = tab && PEOPLE.get(tabPersonId(tab));
  const av = $('.c-av', c);                                  // portrait = the same customer as in the scene
  av.dataset.src = (tab && tab.src) || s.src || '';
  setHTML(av, who ? avatarSVG(who.color, who.hair, { vb: '6 2 36 40', w: 44, h: 49 }) : avatarSVG('#b8a98a', '#8c8c8c', { vb: '6 2 36 40', w: 44, h: 49 }));
  if (tab) setHTML(tb, `<b>Tab ${n} · ${SRC_NAME[tab.src] || tab.src}</b>${who ? `<span class="ag-name" style="--c:${who.color}">${esc(who.name)}</span>` : ''}<span>${esc(tab.name || (tab.src === 'codex' ? 'codex' : 'claude'))} · pid ${tab.pid}</span><span class="c-tab-age">${ago(tab.startedAt)}</span>`);
  const pill = $('.pill', c); pill.className = 'pill ' + s.status; pill.textContent = PILL[s.status] + (s.evidence === 'guessed' ? ' (guessed)' : '');
  pill.title = s.evidence === 'guessed' ? 'Codex publishes no status: this is inferred from its session log' : '';
  const t = $('.c-title', c); t.textContent = s.title && s.title !== '(untitled)' ? s.title : projectName(s); t.title = s.title;
  $('.c-tool', c).textContent = s.src === 'codex' ? 'CX' : 'CC';
  $('.c-meta', c).textContent = [projectName(s), s.branch && '⎇ ' + s.branch, (s.model || '').replace('claude-', ''),
    !tab && s.terminal_open === false ? 'closed' : ''].filter(Boolean).join(' · ');
  const why = $('.c-reason', c); why.textContent = s.status === 'attention' ? s.reason : ''; why.hidden = s.status !== 'attention';
  const busy = s.status === 'working';
  const now = $('.c-now', c), d = s.now_doing, dk = busy && d ? d.kind + '|' + d.text + '|' + d.since : '';
  now.hidden = !busy;
  if (now._k === dk && $('.d-t', now)) $('.d-t', now).textContent = elapsed(d.since);   // same activity: just tick the timer
  else { now._k = dk; setHTML(now, busy ? '<span class="d-who">main</span>' + doingHTML(d, true) : ''); }
  const say = $('.c-say', c); say.hidden = busy; say.textContent = busy ? '' : (s.last_say || (s.last_prompt ? '🧑 ' + s.last_prompt : ''));
  const ags = $('.c-agents', c), html = agentRowsHTML(s);
  if (ags.dataset.h !== html) { ags.innerHTML = html; ags.dataset.h = html; }
  ags.hidden = !html;
  setHTML($('.c-stats', c), [
    s.cost > 0 ? `${s.unpriced ? '≥' : ''}~${fmtUsd(s.cost)}` : '', s.ctx ? `ctx ${fmtN(s.ctx)}` : '', `${fmtN(s.tokens.total)} tok`,
    s.subs.total ? `${s.subs.total} sub${s.subs.total > 1 ? 's' : ''}${s.subs.active ? ' (' + s.subs.active + ' active)' : ''}` : '',
    s.last_t ? (s.status === 'ready' ? 'done ' : '') + ago(s.last_t) : ''].filter(Boolean).map(x => `<span>${esc(x)}</span>`).join(''));
}
function placeholderFor(t) {                             // a tab that has not written a session log yet
  const st = t.proc_status === 'busy' ? 'working' : t.proc_status === 'waiting' || t.proc_status === 'starting' ? 'attention' : 'ready';
  return { src: t.src, id: t.sid || '', title: t.proc_status === 'starting' ? 'Starting…' : 'New tab', cwd: t.cwd, branch: '', model: '', status: st, reason: t.waitingFor || 'waiting for you',
           last_say: 'no messages yet', last_prompt: '', tokens: { total: 0 }, subs: { total: 0, active: 0 }, cost: 0, ctx: 0,
           agents: [], last_t: t.startedAt, now_doing: { kind: 'think', text: 'starting…', since: t.startedAt } };
}
function placeCards(sec, cards) {
  const items = $('.items', sec), have = [...items.children];
  if (have.length !== cards.length || cards.some((c, i) => have[i] !== c)) { items.innerHTML = ''; cards.forEach(c => items.appendChild(c)); }
  $('.n', sec).textContent = cards.length;
}
function renderFleet() {
  const tabs = FL.tabs || [], openKeys = new Set(), count = { working: 0, ready: 0, attention: 0 };
  $('#fleetView').hidden = !FL.closedOn;
  const tabNo = t => (PEOPLE.get(tabPersonId(t)) || {}).tabNo || 1e9;
  const tabCards = [...tabs].sort((x, y) => tabNo(x) - tabNo(y)).map((t, i) => {
    const key = t.sid ? t.src + ':' + t.sid : '', s = (key && FL.byKey.get(key)) || placeholderFor(t);
    if (key) openKeys.add(key);
    const ck = 'tab:' + t.src + ':' + t.pid;
    let c = FL.cards.get(ck);
    if (!c) { c = makeCard(); FL.cards.set(ck, c); }
    c.dataset.key = FL.byKey.has(key) ? key : ''; c.dataset.pid = tabPersonId(t);
    count[s.status]++;
    updateCard(c, s, t, tabNo(t) < 1e9 ? tabNo(t) : i + 1);
    return c;
  });
  placeCards(FL.secs.tabs, tabCards);
  FL.secs.tabs.dataset.empty = 'false';
  $('.items', FL.secs.tabs).dataset.none = tabs.length ? '' : 'No Claude Code or Codex tab is open.';

  const closed = [...FL.byKey.values()].filter(s => !openKeys.has(keyOf(s))).sort((a, b) => b.last_t - a.last_t);
  placeCards(FL.secs.closed, closed.map(s => {
    let c = FL.cards.get(keyOf(s));
    if (!c) { c = makeCard(); FL.cards.set(keyOf(s), c); }
    c.dataset.key = keyOf(s);
    updateCard(c, s, null, 0);
    return c;
  }));
  FL.secs.closed.dataset.empty = closed.length && FL.closedOn && FL.view === 'all' ? 'false' : 'true';

  const subsActive = tabs.reduce((n, t) => n + ((FL.byKey.get(t.src + ':' + t.sid) || {}).agents || []).filter(a => a.state === 'working').length, 0);
  $('#subsActive').textContent = subsActive ? `· ${subsActive} sub-agent${subsActive > 1 ? 's' : ''} active` : '';
  $('#fleetEmpty').hidden = true;
  setHTML($('#fleetSum'), [`<span>🖥 ${esc(headcount().text)}</span>`,
    count.attention && `<span class="attn">⚠ ${count.attention} need you</span>`,
    count.working && `<span>⚙ ${count.working} working</span>`,
    count.ready && `<span class="ready">✅ ${count.ready} ready</span>`].filter(Boolean).join(''));
  const alerts = count.attention + [...FL.unseen].filter(k => openKeys.has(k)).length;
  document.title = (alerts ? `(${alerts}) ` : '') + 'Kopitiam Agents';
}
function detectTransitions(list) {
  for (const s of list) {
    const k = keyOf(s), prev = FL.prev.get(k);
    if (!FL.first && prev === 'working' && (s.status === 'ready' || s.status === 'attention')) {
      if (k !== selKey() || document.hidden) FL.unseen.add(k);
      const c = FL.cards.get(k);
      if (c) { c.classList.add('flash'); setTimeout(() => c.classList.remove('flash'), 3400); }
      if (FL.notifyOn && 'Notification' in window && Notification.permission === 'granted' && (document.hidden || k !== selKey())) {
        try { new Notification((s.status === 'ready' ? '✅ Done: ' : '⚠ Needs you: ') + (s.title || projectName(s)), { body: s.status === 'ready' ? short(s.last_say, 140) : s.reason, tag: k }); } catch { /* ignore */ }
      }
    }
    if (s.status === 'working') FL.unseen.delete(k);
    FL.prev.set(k, s.status);
  }
  FL.first = false;
}
async function pollFleet() {
  try {
    const r = await fetch('/api/fleet', { cache: 'no-store' });
    if (!r.ok) throw new Error(r.status);
    const data = await r.json();
    FL.byKey = new Map(data.sessions.map(s => [keyOf(s), s]));
    FL.tabs = data.tabs || []; FL.closedOn = !!data.closed;
    detectTransitions(data.sessions);
    syncTabs();
    const cur = curTab();
    if (cur && cur.sess && selKey() !== keyOf(cur.sess)) connect(cur.sess.src, cur.sess.id, cur.sess.status === 'working');
    openPendingNew();
    renderFleet();
    renderWork();
    renderComposer();
    if (S && S.mode === 'session') {                       // the scene badge follows the fleet's view of the open session
      const cur = FL.byKey.get(selKey());
      if (cur) { const live = cur.status === 'working'; S.live = live; setStatus(live ? 'live' : 'replay', live ? 'LIVE · working' : cur.status === 'attention' ? 'waiting for you' : 'done · idle'); }
    }
  } catch { $('#fleetSum').textContent = 'server not reachable…'; }
}
$$('#fleetView button').forEach(b => b.addEventListener('click', () => {
  FL.view = b.dataset.v;
  $$('#fleetView button').forEach(x => x.classList.toggle('on', x === b));
  renderFleet();
}));
setInterval(() => { if (FL.byKey.size) renderFleet(); }, 1000);   // keep the "12s" timers ticking between polls
$('#notifyBtn').addEventListener('click', async () => {
  if (!('Notification' in window)) return;
  if (Notification.permission !== 'granted') await Notification.requestPermission();
  FL.notifyOn = Notification.permission === 'granted' && !FL.notifyOn;
  $('#notifyBtn').classList.toggle('on', FL.notifyOn);
});
document.addEventListener('visibilitychange', () => { if (!document.hidden) { FL.unseen.delete(selKey()); renderFleet(); } });

/* ───────────────────────── the scene: one customer per open terminal tab ───────────────────────── */
const TS = { first: true, seq: 0, bySrc: {} };
function headcount() {                                   // one open terminal = one customer
  const tabs = FL.tabs || [], claude = tabs.filter(t => t.src === 'claude').length, codex = tabs.filter(t => t.src === 'codex').length;
  const text = `${tabs.length} terminal${tabs.length === 1 ? '' : 's'} · ${claude} Claude · ${codex} Codex`;
  return { total: tabs.length, claude, codex, text };
}
const tabPersonId = t => 'tab:' + t.src + ':' + t.pid;
const PST = { working: '⚙️', ready: '✅', attention: '⚠️' };
function tabPerson(t) {
  let a = PEOPLE.get(tabPersonId(t));
  if (a) return a;
  const n = TS.seq++, pal = SRC_SHIRTS[t.src] || SHIRTS, k = TS.bySrc[t.src] = (TS.bySrc[t.src] || 0) + 1;
  const used = new Set([...PEOPLE.values()].filter(p => !p.leaving && p.tabNo).map(p => p.tabNo));
  let no = 1; while (used.has(no)) no++;                                       // first free number, kept for life
  a = { id: tabPersonId(t), src: t.src, tabNo: no, name: NAMES[n % NAMES.length], color: pal[(k - 1) % pal.length], hair: HAIRS[n % HAIRS.length],
        q: [], pumping: false, node: null, seat: null, seatIdx: 0, jx: ((n % 3) - 1) * 16, state: 'queue', dead: false, seated: false,
        label: '', status: '', lastKey: '', trips: null, curAct: null, leaving: false };
  a.onClick = () => selectTab(a.id);
  ensurePerson(a);
  if (TS.first) { a.seated = true; jump(a, seatFor(a).seat, seatJx(a)); }   // page load: everyone is already seated
  else enqueue(a, { t: 'order' });                                            // a new tab walks in and takes a seat
  return a;
}
function syncTabs() {
  const alive = new Set();
  (FL.tabs || []).forEach((t, i) => {
    const a = tabPerson(t), s = FL.byKey.get(t.src + ':' + t.sid) || placeholderFor(t);
    alive.add(a.id);
    a.sess = FL.byKey.get(t.src + ':' + t.sid) || null; a.label = s.title; a.lastSay = s.last_say;
    if (a.node) {
      const tag = $('.tag', a.node); tag.textContent = `${a.tabNo} · ${a.name}`; tag.title = `Tab ${a.tabNo} · ${SRC_NAME[t.src] || t.src} · pid ${t.pid}`;
      const b = $('.pst', a.node); b.textContent = PST[s.status] || ''; b.dataset.s = s.status;
      a.node.classList.toggle('sel', !!a.sess && selKey() === keyOf(a.sess));
    }
    if (a.seat != null) {
      refreshTable(a.seat);
      if (TABLES[a.seat][0] === a.id) tableEls[a.seat].bill.textContent = s.tokens && s.tokens.total ? '🪙 ' + fmtN(s.tokens.total) : '';
    }
    // tool calls -> stall trips.  The current call waits at its stall; calls that started and finished between polls get a quick trip.
    const d = s.now_doing, kind = s.status === 'working' && d && STALLS[d.kind] ? d.kind : null, key = kind ? d.since + '|' + d.text : '';
    if (a.curAct && a.curAct.key !== key) { a.curAct.resolved = true; a.curAct.resolve && a.curAct.resolve(); a.curAct = null; }
    const trips = s.main_trips || 0;
    if (a.trips != null) {
      const fresh = key && key !== a.lastKey ? 1 : 0, missed = Math.min(trips - a.trips - fresh, 2), kinds = s.last_kinds || [];
      for (let m = missed; m > 0; m--) enqueue(a, { t: 'fetch', kind: stallKind(kinds[kinds.length - fresh - m]), sum: 'quick trip', resolved: true });
    }
    if (key && key !== a.lastKey) { a.curAct = { t: 'fetch', kind, sum: d.text, key, resolved: false }; enqueue(a, a.curAct); }
    a.lastKey = key; a.trips = trips;
    // status
    const was = a.status; a.status = s.status;
    if (!a.pumping && !a.q.length) restPose(a);
    if (a.node && s.status === 'attention' && !a.waitInfo) bubble(a.node, '⚠ ' + short(s.reason || 'needs you', 60), { err: true });
    else if (a.node && was === 'attention' && s.status !== 'attention') hideBubble(a.node);
    if (a.node && was === 'working' && s.status === 'ready' && !TS.first) bubble(a.node, '✅ done — your turn', { ms: 4000 });
  });
  for (const a of PEOPLE.values()) {
    if (alive.has(a.id) || a.leaving) continue;
    a.leaving = true;
    if (a.curAct) { a.curAct.resolved = true; a.curAct.resolve && a.curAct.resolve(); }
    a.q.length = 0; enqueue(a, { t: 'leave' });
  }
  TS.first = false;
  renderRail();
}

/* ───────────────────────── session picker & boot ───────────────────────── */
let SESSIONS = [];
function label(s) {
  const who = s.src === 'codex' ? 'Codex' : 'Claude';
  return `${s.live ? '🟢 ' : ''}${who} · ${short(s.title, 34)} · ${(s.cwd || '').split('/').filter(Boolean).slice(-1)[0] || '~'} · ${ago(s.mtime)}`;
}
function fillPicker() {
  const sel = $('#sessionSel'), cur = conn.src + ':' + conn.id;
  setHTML(sel, SESSIONS.map(s => `<option value="${esc(s.src + ':' + s.id)}">${esc(label(s))}</option>`).join(''));
  if ([...sel.options].some(o => o.value === cur)) sel.value = cur;
}
async function loadSessions() {
  const r = await fetch('/api/sessions', { cache: 'no-store' });
  if (!r.ok) throw new Error('sessions ' + r.status);
  SESSIONS = await r.json(); fillPicker();
  return SESSIONS;
}
$('#sessionSel').addEventListener('change', e => {
  const v = e.target.value; $('#follow').checked = false;
  const [src, ...rest] = v.split(':'), id = rest.join(':'), s = SESSIONS.find(x => x.src === src && x.id === id);
  connect(src, id, !!(s && s.live));
});

async function followTick() {
  try {
    const list = await loadSessions();
    if ($('#follow').checked) {
      const newest = list[0];
      if (newest && newest.live && (newest.src !== conn.src || newest.id !== conn.id)) { connect(newest.src, newest.id, true); fillPicker(); }
    }
  } catch { /* server hiccup; try again next tick */ }
}

async function boot() {
  fitScene(); buildStalls(); buildTables(); buildFleet(); reset();
  try { const p = await fetch('prices.json', { cache: 'no-store' }); if (p.ok) PRICES = await p.json(); } catch { /* prices are optional */ }
  try { const c = await fetch('/api/config', { cache: 'no-store' }); if (c.ok) CFG = await c.json(); } catch { /* read-only */ }
  renderComposer();
  try { await loadSessions(); } catch { setStatus('offline', 'server not running'); }
  await pollFleet(); setInterval(pollFleet, 1200);
  setInterval(followTick, 4000);
  const first = [...PEOPLE.values()].filter(p => p.tabNo).sort((x, y) => x.tabNo - y.tabNo)[0];
  if (first) selectTab(first.id);
}
// The script is loaded at the end of <body>, so the scene can be built on the
// first frame instead of waiting an extra load event (important on cold loads).
requestAnimationFrame(boot);
