'use strict';
/* Kopitiam Agents — the browser side.
 *
 * Everything on screen is a pure function of a stream of normalized events (see server.py `ev()`):
 *   prompt · spawn · brief · think · tool · result · say · usage · done
 * Two sources feed the same `apply()`: the local server (real Claude Code / Codex sessions) and a
 * built-in scripted demo. History already on disk is applied instantly ("replay"); new events animate.
 *
 * Metaphor:  open terminal tab = a hawker at their own stall · what they are doing = their animation + badge
 *            your last message = the order ticket · finished turn = a dish waiting for you · tokens = the bill
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
// name colours in the log/bill: warm = Claude Code, cool = Codex (the hawker art itself is provider-neutral)
const SRC_SHIRTS = { claude: ['#c2472f', '#d08a1e', '#9c3a70', '#8a5a34', '#b5562c'], codex: ['#2b7fa8', '#1f9186', '#3f62a8', '#6d9430', '#2f6f8f'] };
const SRC_NAME = { claude: 'Claude', codex: 'Codex' };
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

/* ───────────────────────── sprites (web/sprites = Kopitiam Mini Sprite Pack, see its README) ─────────────────────────
 * Everything is in logical pixels and drawn with nearest-neighbour sampling. manifest.json is authoritative for clip
 * frames, timing, atlas rectangles and stall anchors; it is loaded in boot() before the first tab is drawn. */
const SP = 'sprites/';
const SKINS = ['hawker01', 'hawker02', 'hawker03'];          // kopi uncle · noodle hawker · rice-stall auntie
const KITS = ['kopi', 'noodle', 'rice'];                     // the stall each skin works at
const SKIN_NAMES = [['Uncle Lim', 'Ah Seng', 'Kumar'], ['Ah Keong', 'Ravi', 'Hafiz'], ['Mak Siti', 'Kak Aisyah', 'Kak Farah']];
let ART = null;                                              // sprites/manifest.json
const PORTRAIT = (p, w, h) => `<img class="px" src="${SP}characters/${SKINS[p.skin || 0]}/reference/portrait.png" width="${w}" height="${h || w}" alt="">`;
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)');

/* ───────────────────────── scene wiring ───────────────────────── */
const sceneEl = $('#scene'), worldEl = $('#world'), hudEl = $('#hud');
const backsEl = $('#backs'), actorsEl = $('#actors'), frontsEl = $('#fronts'), custsEl = $('#custs');
const logEl = $('#log');
let PRICES = { models: [], cacheWrite5m: 1.25, cacheWrite1h: 2 };

/* The shop is a flat bar across the whole bottom band: four stalls in a row with equal gaps (between them and at both
 * edges), hawkers walking in from the left edge. World units are logical pixels: the bar is BAR_H tall and as wide as
 * the band allows at the current zoom (--s, nearest-neighbour); text lives in #hud at screen size.
 * Layers: bar background → stall backs → hawkers (a hawker walking past a stall goes behind its counter) → worktops,
 * fronts, equipment, effects, badges. */
const BAR_H = 148, ROW_Y = 48, STALL_W = 96, N_STALLS = 4, MIN_GAP = 8;   // stall canvases are 96×80; row top at ROW_Y
const LANE_Y = ROW_Y + 52;                                   // hawkers' feet line, behind the counters (stall agent_feet)
const BAR_BG = 'room/bar.png';                               // your bar background: BAR_H px tall, repeats sideways
const DOOR = [-20, LANE_Y];                                  // just off the left edge: where hawkers walk in and out
const DOOR_Q = [[16, 138], [34, 138]];                       // tabs beyond the stalls wait at the left, in front
const WALK_PX_S = 90;                                        // walking speed, logical px per second
let WORLD_W = 512, SLOT_X = [];                              // bar width and stall x positions, set by layoutBar()
const SLOT_OWNER = [];                                       // stall index -> person id
const slotEls = [];

function img(file, x, y, cls) {
  const i = el('img', 'px' + (cls ? ' ' + cls : ''));
  i.src = SP + file; i.alt = ''; i.draggable = false;
  i.style.left = x + 'px'; i.style.top = y + 'px';
  return i;
}
function buildRoom() {
  backsEl.replaceChildren(); frontsEl.replaceChildren(); slotEls.length = 0;
  for (let i = 0; i < N_STALLS; i++) {                      // draw order from layers.json: back, agent, worktop, front, equipment
    const kit = kitOf(KITS[i % KITS.length]);
    const back = el('div', 'slot'), front = el('div', 'slot');
    for (const s of [back, front]) s.style.top = ROW_Y + 'px';
    back.append(img(kit.layers.back, 0, 0));
    front.append(img(kit.layers.worktop, 0, 0), img(kit.layers.front, 0, 0), img(kit.layers.equipment, 0, 0));
    const hit = el('div', 'hit');                            // the whole stall is the click target, whoever runs it
    hit.tabIndex = -1; hit.setAttribute('role', 'button');
    const go = e => { e.stopPropagation(); const p = PEOPLE.get(SLOT_OWNER[i]); if (p && p.onClick) p.onClick(); };
    hit.addEventListener('click', go);
    hit.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(e); } });
    front.appendChild(hit);
    backsEl.appendChild(back); frontsEl.appendChild(front);
    slotEls.push({ kit, back, front, hit });
  }
  const bgImg = new Image();                                 // use the bar background once it exists; until then the placeholder
  bgImg.onload = () => { $('#room').style.backgroundImage = `url(${SP}${BAR_BG})`; $('#room').classList.add('custom'); };
  bgImg.src = SP + BAR_BG;
  layoutBar();
}
/* equal gaps: between the stalls and at both ends of the bar */
function layoutBar() {
  const gap = Math.max(MIN_GAP, (WORLD_W - N_STALLS * STALL_W) / (N_STALLS + 1));
  SLOT_X = Array.from({ length: N_STALLS }, (_, i) => Math.round(gap + i * (STALL_W + gap)));
  slotEls.forEach((s, i) => { s.back.style.left = s.front.style.left = SLOT_X[i] + 'px'; });
  for (const a of PEOPLE.values()) if (a.hawker && !a.leaving) placeTab(a, !a.walking);
}

/* Sizing: the shop fills the whole bottom band. Its zoom is a step chosen with the splitter above it (remembered per
 * browser), capped so the workspace keeps MIN_WORK_H and the four stalls fit across. The window onto the room is as
 * wide as the band allows, centred on the stalls. */
const STEPS = [1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 3, 3.5, 4], MIN_WORK_H = 240, MM_HEAD = 26;
const SCALE_KEY = 'kopitiam.shopZoom';
let SCALE = 2, WANT = null;
try { WANT = STEPS.includes(+localStorage.getItem(SCALE_KEY)) ? +localStorage.getItem(SCALE_KEY) : null; } catch { /* storage blocked */ }
const bandW = () => $('.bottom').clientWidth || innerWidth - 330;
function maxStep() {
  const need = N_STALLS * STALL_W + (N_STALLS + 1) * MIN_GAP;   // four stalls must fit across
  const ok = STEPS.filter(s => BAR_H * s + MM_HEAD <= innerHeight - 72 - MIN_WORK_H && need * s <= bandW());
  return ok.length ? ok[ok.length - 1] : STEPS[0];
}
const defaultStep = () => STEPS.filter(s => BAR_H * s + MM_HEAD <= (innerHeight - 72) * 0.42).pop() || STEPS[0];
function fitScene() {
  SCALE = Math.min(WANT || defaultStep(), maxStep());
  WORLD_W = Math.floor(bandW() / SCALE);
  const st = sceneEl.style;
  st.setProperty('--s', SCALE); st.height = BAR_H * SCALE + 'px';
  worldEl.style.width = WORLD_W + 'px'; worldEl.style.height = BAR_H + 'px';
  document.documentElement.style.setProperty('--mm-h', BAR_H * SCALE + MM_HEAD + 'px');
  layoutBar();
  const sp = $('#split'); sp.setAttribute('aria-valuenow', SCALE); sp.title = `Drag to resize the shop (now ${SCALE}×) · double-click: default size`;
}
/* splitter between the workspace and the shop: drag (or ↑/↓ when focused) to change the zoom step */
function setStep(s) {
  WANT = s; fitScene();
  try { if (s == null) localStorage.removeItem(SCALE_KEY); else localStorage.setItem(SCALE_KEY, s); } catch { /* storage blocked */ }
}
(() => {
  const sp = $('#split');
  sp.addEventListener('pointerdown', e => {
    e.preventDefault(); try { sp.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ } sp.classList.add('drag');
    const bottom = $('.layout').getBoundingClientRect().bottom, cap = maxStep();
    const move = ev => {                                   // nearest step to where the band's top edge is being dragged
      const want = (bottom - ev.clientY - MM_HEAD) / BAR_H;
      const s = STEPS.filter(x => x <= cap).reduce((b, x) => Math.abs(x - want) < Math.abs(b - want) ? x : b, STEPS[0]);
      if (s !== SCALE) { WANT = s; fitScene(); }
    };
    const up = () => { sp.classList.remove('drag'); sp.removeEventListener('pointermove', move); sp.removeEventListener('pointerup', up); sp.removeEventListener('pointercancel', up); setStep(SCALE); };
    sp.addEventListener('pointermove', move); sp.addEventListener('pointerup', up); sp.addEventListener('pointercancel', up);
  });
  sp.addEventListener('dblclick', () => setStep(null));
  sp.addEventListener('keydown', e => {
    const i = STEPS.indexOf(SCALE), d = e.key === 'ArrowUp' ? 1 : e.key === 'ArrowDown' ? -1 : 0;
    if (!d) return; e.preventDefault();
    const s = STEPS[Math.max(0, Math.min(STEPS.length - 1, i + d))];
    if (s <= maxStep()) setStep(s);
  });
})();

/* ───────────────────────── world state ───────────────────────── */
const PEOPLE = new Map();                                     // person id -> person (one per open terminal tab)
let S = null, conn = { es: null, timers: [], src: '', id: '', opened: false, events: [] };

function freshState() {
  return {
    agents: new Map(), seq: 0, selected: null, filter: null, lastMainT: 0, replaying: false,
    totals: { i: 0, cw: 0, cr: 0, o: 0, th: 0, cost: 0, unpriced: false, trips: 0 },
    burn: [], toolRows: new Map(), chatTools: new Map(), chatFor: 'main', sessionModel: '', mode: 'idle',
  };
}

function ensureAgent(id) {
  let a = S.agents.get(id);
  if (a) return a;
  const main = id === 'main', n = S.seq;
  a = {
    id, main, label: main ? 'Orchestrator' : 'sub-agent', atype: '', model: '', brief: '', parent: 'main',
    name: main ? 'Main agent' : NAMES[n % NAMES.length], color: main ? MAIN_COLOR : SHIRTS[n % SHIRTS.length],
    tools: [], pending: new Map(), usage: { i: 0, cw: 0, cr: 0, o: 0, th: 0 }, cost: 0, unpriced: false, trips: 0,
    startT: 0, endT: 0, done: false, briefed: false, spawned: false, seated: false, lastSay: '',
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
      feedRow(ev, ensureAgent('main'), `🧑 <b>You:</b> ${esc(short(mdPlain(ev.text), 600))}`);
      if (!S.replaying && WS.pending.length) WS.pending.shift().remove();   // the log confirmed a message we showed early
      if (S.chatFor === 'main') chatAdd('u', ev.text, ev.t);
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
      if (S.chatFor === ev.a) chatAdd('u', ev.text, ev.t, 'Brief from ' + (S.agents.get(a.parent) || {}).name);
      break;
    }
    case 'tool': {
      const rec = { id: ev.id, name: ev.name, kind: ev.kind, sum: ev.sum, inp: ev.inp, t: ev.t, pending: true, err: false, n: 0 };
      a.tools.push(rec); a.pending.set(ev.id, rec); a.trips++; S.totals.trips++;
      feedTool(ev, a, rec);
      if (S.chatFor === ev.a) S.chatTools.set(ev.id, chatAdd('t', `${DISH[stallKind(ev.kind)] || '🍽️'} ${ev.sum}`, ev.t));
      break;
    }
    case 'result': {
      const rec = a.pending.get(ev.id);
      if (rec) {
        rec.pending = false; rec.err = !!ev.err; rec.n = ev.n; rec.txt = ev.txt; rec.dur = ev.t - rec.t;
        a.pending.delete(ev.id);
      }
      feedResult(ev, rec);
      if (S.chatFor === ev.a) chatResult(ev);
      break;
    }
    case 'say': {
      a.lastSay = ev.text;
      feedRow(ev, a, `💬 ${esc(short(mdPlain(ev.text), 500))}`);
      if (S.chatFor === ev.a) chatAdd('a', ev.text, ev.t);
      break;
    }
    case 'think': if (S.chatFor === ev.a) chatAdd('t', thinkText(ev), ev.t).classList.add('think'); break;
    case 'usage': addUsage(a, ev); break;
    case 'done': {
      if (a.main || a.done) break;
      a.done = true; a.endT = ev.t;
      feedRow(ev, a, `✅ finished · ${a.trips} trips · ${fmtN(tokTotal(a.usage))} tokens`);
      break;
    }
  }
}

/* ───────────────────────── hawkers & stalls ─────────────────────────
 * One open terminal tab = one hawker at their own stall. The fleet snapshot picks the state (visualFor); the frame
 * loop only draws it. Animation never changes state: a finished one-shot just holds its last frame. */
let CLIPS = [], FX = {};                 // per skin: clip -> { rects, ms, pb } · effect id -> { file, rects, ms, pb, still }
function loadArt(m) {
  ART = m;
  const rectOf = atlas => new Map(atlas.frames.map(f => [f.file, f.rect]));
  CLIPS = SKINS.map(id => {
    const c = m.characters.find(x => x.id === id), r = rectOf(c.atlas), out = { atlas: c.atlas.file };
    for (const [k, v] of Object.entries(c.clips)) out[k] = { rects: v.frames.map(f => r.get(f)), ms: v.durationMs, pb: v.playback };
    return out;
  });
  for (const e of m.effects) { const r = rectOf(e.atlas); FX[e.id] = { file: e.atlas.file, rects: e.frames.map(f => r.get(f)), ms: e.durationMs, pb: e.playback, still: r.get(e.staticFallback) }; }
}
const kitOf = id => ART.stalls.find(s => s.id === id);

const TEST_RE = /\b(tests?|pytest|jest|vitest|mocha|rspec|ctest|unittest|tox|go test|cargo test|(npm|pnpm|yarn)( run)? test)\b/i;
const BUILD_RE = /\b(make|cmake|build|compile|tsc|webpack|gradle|mvn|colcon|catkin|cargo build|go build|docker build|(npm|pnpm|yarn)( run)? build|(npm|pnpm) (ci|install)|pip install)\b/i;
const WORK_CLIPS = new Set(['thinking', 'reading', 'editing', 'building', 'testing']);
function visualFor(a, s) {                   // fleet snapshot -> { clip, badge, text } (see the pack's state-map.json)
  if (a.leaving) return { clip: 'stopping', badge: 'stopping', text: '👋 tab closed' };
  if (!s) return { clip: 'idle', badge: '', text: '' };
  if (s.status === 'attention') {
    const q = /question|ask|answer/i.test(s.reason || '');
    return { clip: 'asking', badge: q ? 'question' : 'approval', text: '⚠ ' + (s.reason || 'needs you'), att: true };
  }
  if (s.status === 'working') {
    const d = s.now_doing || {}, t = d.text || '', k = d.kind;
    const [clip, badge] = k === 'read' ? ['reading', 'reading'] : k === 'edit' ? ['editing', 'editing'] : k === 'web' ? ['reading', 'tool']
      : k === 'run' ? (TEST_RE.test(t) ? ['testing', 'testing'] : BUILD_RE.test(t) ? ['building', 'building'] : ['editing', 'tool'])
      : k === 'delegate' ? ['idle', 'dependency'] : k === 'other' ? ['editing', 'tool'] : ['thinking', 'thinking'];
    return { clip, badge, text: `${ACT_ICON[k] || '⚙️'} ${short(t || 'working…', 90)}`, since: d.since };
  }
  if (!s.last_prompt && !(s.tokens && s.tokens.total)) return { clip: 'idle', badge: '', text: '' };   // new tab: nothing asked yet
  return { clip: 'review_hold', badge: 'review', text: '✅ done, your turn' };                        // output waiting for you
}
function setClip(a, clip) { if (a.clip !== clip) { a.clip = clip; a.t0 = performance.now(); } }
function setBadge(a, b) {
  if (a.badgeId === b) return; a.badgeId = b;
  a.badge.hidden = !b; if (b) { a.badge.src = `${SP}ui/badges/${b}.png`; a.badge.title = b.replace('_', ' '); }
}

/* where a tab stands: tab N runs stall N (left → right); once all four are taken, the next tabs wait by the door */
function placeOf(a) {
  const i = a.tabNo - 1;
  if (i < SLOT_X.length) { const [fx, fy] = slotEls[i].kit.anchors.agent_feet; return { slot: i, fx: SLOT_X[i] + fx, fy: ROW_Y + fy, x: SLOT_X[i], y: ROW_Y }; }
  const q = i - SLOT_X.length, [fx, fy] = DOOR_Q[Math.min(q, DOOR_Q.length - 1)];
  return { slot: -1, q, fx, fy, x: fx - 16, y: fy - 36 };
}
const refView = (a, dir) => `url(${SP}characters/${SKINS[a.skin]}/reference/${dir}.png)`;
function standAt(a, fx, fy) { const h = a.hawker.style; h.left = (fx - 16) + 'px'; h.top = (fy - 36) + 'px'; h.zIndex = fy; a.at = [fx, fy]; }
/* The pack has no walk cycle (planned for a later milestone), so a walking hawker uses its static diagonal view with a
 * one-pixel step bob. Walking only moves the sprite: it never changes what the tab is doing. */
function walkTo(a, fx, fy) {                             // the frame loop moves the hawker (elapsed time, like every clip)
  const hw = a.hawker; if (!hw) return Promise.resolve();
  const [x0, y0] = a.at || [fx, fy], ms = REDUCED.matches ? 0 : Math.round(Math.hypot(fx - x0, fy - y0) / WALK_PX_S * 1000);
  if (a.walk) a.walk.done();                                 // a new walk replaces the old one from where the hawker is now
  a.walking = true; hw.classList.add('walk');
  hw.style.backgroundImage = refView(a, fx >= x0 ? 'se' : 'sw'); hw.style.backgroundPosition = '0 0';
  return new Promise(r => {
    const w = a.walk = { x0, y0, x1: fx, y1: fy, t0: performance.now(), ms, done: () => { clearTimeout(w.timer); if (a.walk === w) a.walk = null; r(); } };
    w.timer = setTimeout(() => { if (a.walk === w && a.hawker) { w.t0 = -Infinity; stepWalk(a, 0); } }, ms + 60);   // arrives even if frames are paused (hidden tab)
  });
}
function stepWalk(a, now) {
  const w = a.walk, k = w.ms && w.t0 > -Infinity ? Math.min(1, Math.max(0, (now - w.t0) / w.ms)) : 1;
  standAt(a, Math.round(w.x0 + (w.x1 - w.x0) * k), Math.round(w.y0 + (w.y1 - w.y0) * k));
  if (k < 1) return;
  a.walking = false; a.hawker.classList.remove('walk');
  a.hawker.style.backgroundImage = `url(${SP}${CLIPS[a.skin].atlas})`; a.hawker._k = null;   // back to the animation frames
  w.done();
}
function mountTab(a, walkIn) {
  const pl = placeOf(a), s = pl.slot >= 0 ? slotEls[pl.slot] : null;
  if (s) { SLOT_OWNER[pl.slot] = a.id; s.hit.tabIndex = 0; s.hit.setAttribute('aria-label', `Tab ${a.tabNo} · ${a.name}`); s.front.dataset.src = a.src || ''; }
  const hw = el('div', 'hawker'); hw.style.backgroundImage = `url(${SP}${CLIPS[a.skin].atlas})`;
  hw.addEventListener('click', e => { e.stopPropagation(); if (a.onClick) a.onClick(); });   // hawkers waiting at the side
  if (pl.slot < 0 && pl.q >= DOOR_Q.length) hw.hidden = true;
  (s ? actorsEl : frontsEl).appendChild(hw);                 // stall hawkers stand behind their counter; waiting ones in front
  // effects + badge ride on the stall's front layer (or next to a waiting hawker)
  const fx = el('div', 'fx');
  const [bx, by] = s ? s.kit.anchors.status_badge : [30, 8];
  const badge = img('ui/badges/idle.png', bx - 12, by - 24, 'badge'); badge.hidden = true; fx.appendChild(badge);
  badge.addEventListener('click', e => { e.stopPropagation(); if (a.onClick) a.onClick(); });
  frontsEl.appendChild(fx);
  // screen-size text: nameplate on the stall's sign, order ticket under the stall, speech bubble above it
  const tag = el('div', 'np'), bub = el('div', 'bub'), chit = el('div', 'tk');
  bub.hidden = true; tag.dataset.src = a.src || '';
  for (const h of [tag, chit]) h.addEventListener('click', e => { e.stopPropagation(); if (a.onClick) a.onClick(); });
  const more = el('div', 'cmore'); more.hidden = true;             // sub-agents with no free stool
  const hud = el('div', 'tabhud' + (s ? '' : ' q')); hud.append(bub, tag, chit, more); if (hw.hidden) hud.hidden = true;
  Object.assign(a, { hawker: hw, badge, fxEl: fx, hud, tagEl: tag, bubEl: bub, chitEl: chit, moreEl: more, kit: s ? s.kit : null, place: pl, badgeId: null, arrived: false });
  setClip(a, 'idle');
  hudEl.appendChild(hud);
  placeTab(a, false);
  const arrive = () => { a.arrived = true; placeTab(a, true); fx.classList.add('show'); hud.classList.add('show'); };
  if (walkIn && !hw.hidden && !REDUCED.matches) {           // a new terminal: the hawker walks in from the left to their stall
    standAt(a, ...DOOR);
    requestAnimationFrame(() => walkTo(a, pl.fx, pl.fy).then(() => { if (!a.leaving) arrive(); }));
  } else { standAt(a, pl.fx, pl.fy); arrive(); }
}
/* put a tab's badge/effects and labels at its stall (again after a resize); snap also moves the hawker there */
function placeTab(a, snap) {
  const pl = a.place = placeOf(a), s = pl.slot >= 0;
  a.fxEl.style.left = pl.x + 'px'; a.fxEl.style.top = pl.y + 'px';
  const cx = pl.x + (s ? 48 : 16), top = pl.y + (s ? 4 : 0), sign = pl.y + (s ? 18 : 2), base = pl.y + (s ? 80 : 42);
  a.tagEl.style.cssText = `--x:${cx};--y:${sign}`; a.chitEl.style.cssText = `--x:${cx};--y:${base}`; a.bubEl.style.cssText = `--x:${cx};--y:${top}`;
  a.moreEl.style.cssText = `--x:${pl.x + 92};--y:${BAR_H - 4}`;
  if (snap) standAt(a, pl.fx, pl.fy);
  if (a.custs && s) for (const c of a.custs.values()) if (c.el && c.phase !== 'walk') placeCustomer(a, c);
}

/* ───────────────────────── sub-agents: customers at the stall ─────────────────────────
 * Each confirmed sub-agent of a tab is a customer (sprites/customers, see its Kopitiam_Subagent_Customers.md) who walks
 * up from the bottom of the bar and sits on a stool in front of its parent's stall, back to us, facing the hawker.
 * The fleet roster is the source of truth: working → seated + activity chip, stopped → stop chip; once it is done it
 * stands up and fades out (its result stays readable from the card and the chat).
 * The runtime reports no per-sub-agent approvals, so the raised hand is not used (nothing is guessed). */
let CUST = null;                                             // customers/manifest.json: per variant atlas + clips
const SEATS = [18, 48, 78], SEAT_Y = 146, CUST_WALK_MS = 800;  // stool ground x within a stall, ground y, arrival time
// status chip colours = the core badges' colours (the 24 px badges would cover the hawker at this size)
const CHIP_BG = { reading: '#567f96', thinking: '#567f96', editing: '#52754b', tool: '#52754b', testing: '#52754b', building: '#d89d3c', dependency: '#927250', review: '#8b7096', stop: '#b76445' };
const CUST_VIEW = { read: 'reading', edit: 'editing', web: 'reading', delegate: 'dependency', other: 'tool', think: 'thinking', say: 'thinking' };
function loadCustomers(m) {
  CUST = m.customers.map(c => ({ id: c.id, atlas: c.atlas.file, clips: Object.fromEntries(Object.entries(c.clips).map(([k, v]) =>
    [k, { f: v.frameIndices, ms: v.durationMs, pb: v.playback }])) }));
}
function custBadge(r) {                                      // roster entry -> badge id
  if (r.state === 'done') return 'review';
  if (r.state === 'stopped') return 'stop';
  const d = r.doing || {}, k = d.kind;
  if (k === 'run') return TEST_RE.test(d.text || '') ? 'testing' : BUILD_RE.test(d.text || '') ? 'building' : 'tool';
  return CUST_VIEW[k] || 'thinking';
}
function syncCustomers(a, s) {
  if (!CUST || !a.hawker) return;
  const cs = a.custs || (a.custs = new Map()), roster = (s && s.agents) || [], alive = new Set();
  if (a.custSeq == null) a.custSeq = 0;
  for (const r of roster) {
    if (r.state === 'done') continue;                        // finished: it gets up and leaves (still listed in the card)
    alive.add(r.id);
    let c = cs.get(r.id);
    const look = a.custLook || (a.custLook = new Map());     // appearance fixed for life, also if it leaves and comes back
    if (!look.has(r.id)) look.set(r.id, a.custSeq++ % CUST.length);
    if (!c) { c = { id: r.id, variant: look.get(r.id), seat: -1 }; cs.set(r.id, c); }
    c.r = r;
  }
  for (const c of cs.values()) if (!alive.has(c.id) && !c.leaving) retireCustomer(a, c);
  // seats: keep a live customer's seat; waiting ones take free seats in arrival order (only at a real stall)
  const taken = new Set([...cs.values()].filter(c => c.seat >= 0 && !c.leaving).map(c => c.seat));
  for (const c of cs.values()) {
    if (c.leaving || c.seat >= 0 || a.place.slot < 0) continue;
    const free = SEATS.findIndex((_, i) => !taken.has(i));
    if (free < 0) break;
    c.seat = free; taken.add(free); mountCustomer(a, c, !TS.first);
  }
  for (const c of cs.values()) if (c.el && !c.leaving) {
    const b = custBadge(c.r);
    if (c.badgeId !== b) { c.badgeId = b; c.badge.firstChild.src = `${SP}ui/icons/${b}.png`; c.badge.style.setProperty('--bc', CHIP_BG[b] || '#567f96'); c.badge.title = b; }
    c.want = c.r.state === 'working' ? 'seated_idle' : 'seated_hold';
    if (c.phase === 'seated' && c.clip !== c.want) setCustClip(c, c.want);
    c.el.title = `${c.r.label}${c.r.atype ? ' [' + c.r.atype + ']' : ''} · ${c.r.state === 'working' ? (c.r.doing && c.r.doing.text) || 'working' : c.r.state}`;
  }
  const over = [...cs.values()].filter(c => !c.leaving && c.seat < 0).length;
  a.moreEl.hidden = !over; a.moreEl.textContent = `+${over} sub-agent${over === 1 ? '' : 's'}`;
}
const custPos = (a, c) => [SLOT_X[a.place.slot] + SEATS[c.seat], SEAT_Y];
function setCustClip(c, clip) { c.clip = clip; c.t0 = performance.now(); }
function mountCustomer(a, c, walkIn) {
  const V = CUST[c.variant], node = document.createElement('div');
  node.className = 'cust'; node.style.backgroundImage = `url(${SP}customers/${V.atlas})`;
  node.tabIndex = 0; node.setAttribute('role', 'button');
  const open = e => { e.stopPropagation(); selectTab(a.id, c.id); };
  node.addEventListener('click', open);
  node.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(e); } });
  c.stool = img('customers/shared/stool.png', 0, 0, 'stool');
  c.badge = el('div', 'cbadge'); c.badge.appendChild(img('ui/icons/thinking.png', 0, 0)); c.badge.addEventListener('click', open);
  custsEl.append(c.stool, node, c.badge);
  c.el = node; c.phase = 'seated'; c.clip = 'seated_idle'; c.t0 = performance.now();
  placeCustomer(a, c);
  if (walkIn && !REDUCED.matches) {                          // walk north from below the bar, then sit
    c.phase = 'walk'; setCustClip(c, 'walk_north'); c.walkT0 = performance.now(); c.badge.hidden = true;
    c.walkTimer = setTimeout(() => arriveCustomer(a, c), CUST_WALK_MS + 60);   // arrives even if frames are paused
  } else c.clip = c.r && c.r.state === 'working' ? 'seated_idle' : 'seated_hold';
}
function placeCustomer(a, c, dy = 0) {
  const [x, y] = custPos(a, c);
  c.stool.style.left = (x - 16) + 'px'; c.stool.style.top = (y - 36) + 'px'; c.stool.style.zIndex = y - 1;
  c.el.style.left = (x - 16) + 'px'; c.el.style.top = (y - 36 + dy) + 'px'; c.el.style.zIndex = y;
  c.badge.style.left = (x - 9) + 'px'; c.badge.style.top = (y - 46 + dy) + 'px'; c.badge.style.zIndex = y + 1;   // small chip above the head, on the counter front
}
function arriveCustomer(a, c) {
  if (c.phase !== 'walk' || !c.el) return;
  clearTimeout(c.walkTimer); placeCustomer(a, c);
  c.phase = 'sit'; setCustClip(c, 'sit_down'); c.badge.hidden = false;
}
function retireCustomer(a, c) {                              // retired by the runtime: stand up, fade, free the stool
  c.leaving = true; clearTimeout(c.walkTimer);
  if (!c.el) { a.custs.delete(c.id); return; }
  const gone = () => { for (const n of [c.el, c.stool, c.badge]) n && n.remove(); a.custs.delete(c.id); if (a.sess) syncCustomers(a, FL.byKey.get(keyOf(a.sess))); };
  if (REDUCED.matches) return gone();
  c.phase = 'leave'; setCustClip(c, 'stand_up'); c.badge.hidden = true;
  setTimeout(() => { c.el && c.el.classList.add('gone'); c.stool && c.stool.classList.add('gone'); }, 480);
  setTimeout(gone, 760);
}
function paintCustomers(a, now) {
  for (const c of a.custs.values()) {
    if (!c.el) continue;
    if (c.phase === 'walk') {
      const k = Math.min(1, (now - c.walkT0) / CUST_WALK_MS);
      placeCustomer(a, c, Math.round((1 - k) * 48));           // from below the bar up to the stool
      if (k >= 1) arriveCustomer(a, c);
    }
    const C = CUST[c.variant].clips;
    let cl = C[c.clip] || C.seated_hold, i = Math.max(0, Math.floor((now - c.t0) / cl.ms));
    if (REDUCED.matches && c.phase !== 'leave') { cl = C.seated_hold; i = 0; }
    else if (cl.pb === 'loop') i %= cl.f.length;
    else if (i >= cl.f.length) {
      i = cl.f.length - 1;
      if (c.phase === 'sit') { c.phase = 'seated'; setCustClip(c, c.want || 'seated_idle'); }
    }
    const f = cl.f[i], key = f + '';
    if (c.el._k !== key) { c.el._k = key; c.el.style.backgroundPosition = `-${(f % 4) * 32}px -${Math.floor(f / 4) * 40}px`; }
  }
}
function syncCustomerSel() {                                 // highlight the customer whose conversation is open
  for (const a of PEOPLE.values()) if (a.custs) for (const c of a.custs.values())
    c.el && c.el.classList.toggle('sel', !!(S && a.sess && selKey() === keyOf(a.sess) && S.chatFor === c.id));
}

/* continuous effect at the stall (steam while building/testing, stove heat while working) */
const FX_AT = { steam: [22, 44], stove_glow: [24, 53] };   // over the kettle / pot, under the noodle wok (stall coords)
function setLoopFx(a, id) {
  if (a.loopFx === id) return; a.loopFx = id;
  a.fxEl.replaceChildren();
  if (id && a.kit) a.fxEl.prepend(fxNode(id, ...FX_AT[id], true));
}
function fxNode(id, ax, ay, loop) {           // effect canvas is 32×32, anchor [16, 28]
  const f = FX[id], n = el('i', 'fxf');
  n.style.cssText = `left:${ax - 16}px;top:${ay - 28}px;background-image:url(${SP}${f.file})`;
  n._fx = f; n._t0 = performance.now(); n._loop = loop;
  return n;
}
function oneShot(a, id, anchorName) {        // once, for a new event (never on replay, repaint or reselect)
  if (!a.kit || REDUCED.matches) return;
  const [x, y] = a.kit.anchors[anchorName], n = fxNode(id, x, y, false);
  a.fxEl.appendChild(n);
  setTimeout(() => n.remove(), FX[id].ms * FX[id].rects.length + 50);
}

/* frame loop: frames come from elapsed time, not from the number of repaints */
let FROZEN = false;                          // server unreachable: freeze the last reliable frame
function clipRect(a, now) {
  const C = CLIPS[a.skin];
  let c = C[a.clip] || C.idle, i = Math.max(0, Math.floor((now - a.t0) / c.ms));   // rAF time can precede t0
  const n = c.rects.length;
  if (REDUCED.matches) {                     // resting poses; waits keep their raised-hand / review / error hold
    if (c.pb === 'loop') { c = C.idle; i = 0; } else if (a.clip === 'review') { c = C.review_hold; i = 0; } else i = n - 1;
  } else if (c.pb === 'loop') i %= n;
  else if (i >= n) {
    if (a.clip === 'review') { c = C.review_hold; i = 0; }
    else if (c.pb === 'once_idle') { c = C.idle; i = Math.floor((now - a.t0 - n * C[a.clip].ms) / c.ms) % c.rects.length; }
    else i = n - 1;
  }
  return c.rects[i];
}
function paint(now) {
  requestAnimationFrame(paint);
  if (!FROZEN && ART) {
    for (const a of PEOPLE.values()) {
      if (!a.hawker) continue;
      if (a.walk) stepWalk(a, now);
      if (a.custs) paintCustomers(a, now);
      const r = clipRect(a, now), k = r[0] + ',' + r[1];
      if (!a.walking && a.hawker._k !== k) { a.hawker._k = k; a.hawker.style.backgroundPosition = `-${r[0]}px -${r[1]}px`; }
      for (const f of a.fxEl.querySelectorAll('.fxf')) {
        const F = f._fx, j = Math.max(0, Math.floor((now - f._t0) / F.ms)), rr = REDUCED.matches ? F.still : F.rects[f._loop ? j % F.rects.length : Math.min(j, F.rects.length - 1)];
        const fk = rr[0] + ',' + rr[1];
        if (f._k !== fk) { f._k = fk; f.style.backgroundPosition = `-${rr[0]}px -${rr[1]}px`; }
      }
    }
  }
}

function showBubble(a, text, o = {}) {
  const b = a.bubEl; if (!b) return;
  clearTimeout(a._bt);
  if (!text) { b.hidden = true; return; }
  b.textContent = text; b.classList.toggle('att', !!o.att); b.hidden = false;
  a._bt = o.ms ? setTimeout(() => { b.hidden = true; a._bt = 0; }, o.ms) : 0;
}
function removeTab(a) {                                  // tab closed: pack up, walk back out through the door
  if (a.custs) for (const c of [...a.custs.values()]) if (!c.leaving) retireCustomer(a, c);
  const pl = a.place;
  if (pl && pl.slot >= 0 && SLOT_OWNER[pl.slot] === a.id) { SLOT_OWNER[pl.slot] = null; const s = slotEls[pl.slot]; s.hit.tabIndex = -1; s.hit.removeAttribute('aria-label'); }
  setBadge(a, 'stopping'); setLoopFx(a, null); showBubble(a, '👋 tab closed');
  const out = () => {
    a.hud && a.hud.classList.add('gone'); a.fxEl && a.fxEl.classList.remove('show');
    const gone = () => { a.hawker && a.hawker.classList.add('gone'); setTimeout(() => {
      for (const n of [a.hawker, a.hud, a.fxEl]) n && n.remove();
      a.hawker = null; a.dead = true; if (PEOPLE.get(a.id) === a) PEOPLE.delete(a.id);
    }, 500); };
    if (a.hawker && !a.hawker.hidden && !REDUCED.matches) {
      walkTo(a, ...DOOR).then(gone);
    } else gone();
  };
  if (a.arrived) { setClip(a, 'stopping'); setTimeout(out, 700); } else out();
}
function signTick() {                                    // headcount in the shop's title bar
  const hc = headcount(), t = hc.total ? hc.text : 'buka 24 jam';
  if ($('#signCount').textContent !== t) $('#signCount').textContent = t;
  const extra = [...PEOPLE.values()].filter(p => !p.leaving && p.place && p.place.slot < 0 && p.place.q >= DOOR_Q.length).length;
  const dq = $('#doorMore'); dq.hidden = !extra; dq.textContent = `+${extra} more`;
}

/* ───────────────────────── markdown ─────────────────────────
 * Replies and prompts are Markdown (vendor/marked). Session logs also carry tool output and fetched web text, so the
 * HTML is always sanitized (vendor/purify): no scripts, styles, forms or embeds, and no images (a remote image would
 * make this page call out to that server). Links open in a new tab. Without the libraries, text is shown as-is. */
const MD_OK = typeof marked !== 'undefined' && typeof DOMPurify !== 'undefined';
const PURIFY = { FORBID_TAGS: ['img', 'svg', 'math', 'style', 'form', 'button', 'textarea', 'select', 'iframe', 'object', 'embed', 'video', 'audio', 'source', 'picture'],
                 FORBID_ATTR: ['style', 'class', 'id'] };
if (MD_OK) DOMPurify.addHook('afterSanitizeAttributes', n => {
  if (n.tagName === 'A') { n.setAttribute('target', '_blank'); n.setAttribute('rel', 'noopener noreferrer'); }
  if (n.tagName === 'INPUT') { if (n.getAttribute('type') !== 'checkbox') n.remove(); else n.setAttribute('disabled', ''); }   // task lists only
});
function md(text) {
  if (!MD_OK) return `<p class="plain">${esc(text)}</p>`;
  try { return DOMPurify.sanitize(marked.parse(String(text || ''), { gfm: true, breaks: true }), PURIFY); }
  catch { return `<p class="plain">${esc(text)}</p>`; }
}
// one-line snippets (kitchen log, cards, notifications): the words without the Markdown markup
const mdPlain = s => String(s || '')
  .replace(/```[^\n]*\n?/g, '').replace(/`([^`]*)`/g, '$1')
  .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
  .replace(/(\*\*|__)(.+?)\1/g, '$2').replace(/(^|[^\w*])[*_]([^*_\n]+)[*_](?=[^\w*]|$)/g, '$1$2')
  .replace(/^\s{0,3}(#{1,6}|>)\s*/gm, '').replace(/^\s*\|?[\s:|-]*-{3,}[\s:|-]*\|?\s*$/gm, '')
  .replace(/^\s*[-*+]\s+/gm, '• ').replace(/<\/?[a-z][^>]*>/gi, '');

/* ───────────────────────── workspace: agent tabs + read-only replies ───────────────────────── */
const chatEl = $('#chat'), MAX_CHAT = 600;
function chatAdd(kind, text, t, who) {                  // kind: u = you (or a sub-agent's brief) · a = the agent · t = a tool call
  const pinned = chatEl.scrollHeight - chatEl.scrollTop - chatEl.clientHeight < 80;
  const m = el('div', 'msg-' + kind);
  if (kind === 't') m.textContent = text;
  else {
    const me = S.agents.get(S.chatFor) || {};
    who = who || (kind === 'u' ? 'You' : me.main ? me.name || 'Agent' : me.label || me.name || 'Sub-agent');
    m.appendChild(el('small', '', esc(who + ' · ' + fmtT(t)))); m.appendChild(el('div', 'md', md(text)));
  }
  chatEl.appendChild(m);
  while (chatEl.children.length > MAX_CHAT) chatEl.firstChild.remove();
  if (pinned && !S.replaying) chatEl.scrollTop = chatEl.scrollHeight;
  return m;
}
// the transcript keeps only how long the agent thought, not what it thought: the same "Thinking…" the terminal shows
const thinkText = ev => `💭 thinking…${ev.n ? ` (${fmtN(ev.n)} tokens)` : ''}`;
// a tool call's outcome: ✗ on its row, and the file changes it made, like the terminal shows them under the call
const DIFF_SHOWN = 10;
function chatResult(ev) {
  const ct = S.chatTools.get(ev.id); if (!ct) return;
  S.chatTools.delete(ev.id);
  if (ev.err) { ct.classList.add('err'); ct.textContent += '  ✗'; }
  if (!ev.diff) return;
  const box = el('div', 'msg-diff');
  for (const f of ev.diff.files) {
    const add = f.l.filter(x => x[0] === '+').length, del = f.l.filter(x => x[0] === '-').length;
    box.appendChild(el('div', 'df-h', `${esc(f.f.replace(/^\/home\/[^/]+/, '~'))} <span class="df-add">+${add}</span> <span class="df-del">−${del}</span>`));
    const line = x => el('div', x[0] === '+' ? 'df-add' : x[0] === '-' ? 'df-del' : 'df-ctx', esc(x) || '&nbsp;');
    const pre = el('div', 'df-body'); f.l.slice(0, DIFF_SHOWN).forEach(x => pre.appendChild(line(x)));
    const hidden = f.l.length - DIFF_SHOWN + f.more;
    if (hidden > 0) {
      const more = el('div', 'df-more', `… ${hidden} more lines`);
      if (f.l.length > DIFF_SHOWN) {
        more.classList.add('open');
        more.onclick = () => { f.l.slice(DIFF_SHOWN).forEach(x => pre.insertBefore(line(x), more)); more.textContent = f.more ? `… ${f.more} more lines not kept` : ''; more.onclick = null; more.classList.remove('open'); };
      }
      pre.appendChild(more);
    }
    box.appendChild(pre);
  }
  if (ev.diff.more) box.appendChild(el('div', 'df-more', `… ${ev.diff.more} more files changed`));
  ct.after(box);
}
/* The chat shows one agent's conversation: the tab's main agent, or one sub-agent (its brief, replies and tool calls). */
function showChatFor(id) {
  if (!S || !S.agents.has(id)) id = 'main';
  S.chatFor = id; S.chatTools.clear(); chatEl.innerHTML = '';
  const was = S.replaying; S.replaying = true;                      // no auto-scroll per message while rebuilding
  for (const ev of conn.events) {
    if (ev.k === 'prompt' && id === 'main') chatAdd('u', ev.text, ev.t);
    else if (ev.a !== id) continue;
    else if (ev.k === 'brief') chatAdd('u', ev.text, ev.t, 'Brief from ' + ((S.agents.get((S.agents.get(id) || {}).parent) || {}).name || 'main'));
    else if (ev.k === 'say') chatAdd('a', ev.text, ev.t);
    else if (ev.k === 'think') chatAdd('t', thinkText(ev), ev.t).classList.add('think');
    else if (ev.k === 'tool') S.chatTools.set(ev.id, chatAdd('t', `${DISH[stallKind(ev.kind)] || '🍽️'} ${ev.sum}`, ev.t));
    else if (ev.k === 'result') chatResult(ev);
  }
  S.replaying = was; chatEl.scrollTop = chatEl.scrollHeight;
  renderWork(); syncCustomerSel();
}
function renderWork() {
  const sub = S && S.chatFor !== 'main' && S.agents.get(S.chatFor), sb = $('#subbar');
  sb.hidden = !sub;
  if (sub) setHTML(sb, `👤 Viewing sub-agent <b>${esc(sub.label || sub.name)}</b>${sub.atype ? ` <small>[${esc(sub.atype)}]</small>` : ''} · ${sub.done ? '✅ done' : 'working'} <button type="button" data-main>← back to main</button>`);
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
  $('.chat').dataset.hint = p && !p.sess ? `${who} has no messages yet. Say hi below.` : 'Click a hawker, a card or a tab to open that agent here.';
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
  if (!a) { setHTML(pane, '<div class="empty"><big>🎫</big>Click a log line or a sub-agent in the sidebar to see its ticket.</div>'); return; }
  const u = a.usage, end = a.endT || Date.now();
  const status = a.main ? 'running the shop' : a.done ? 'finished' : a.pending.size ? 'waiting on ' + [...a.pending.values()].map(r => r.name).join(', ') : 'thinking';
  const before = pane._h;
  setHTML(pane, `<div class="ticket">
    <h3><span style="color:${a.color}">●</span> ${esc(a.name)} <small style="font:500 13px var(--sans)">· ${esc(a.main ? 'orchestrator' : a.atype || 'sub-agent')}</small></h3>
    <div class="meta">${esc(a.main ? 'Main session' : a.label)}<br>${esc(status)}${a.startT ? ' · ' + fmtD(end - a.startT) + (a.done ? ' total' : ' so far') : ''}${a.model ? ' · ' + esc(a.model.replace('claude-', '')) : ''}</div>
    <a href="#" id="tkFilter">show only their log lines →</a>
    <h4>Tokens · ${costText(a)}</h4>${meter(u)}
    <div class="det" style="font:11.5px var(--mono);color:var(--ink-2)">♻️ cache read ${fmtN(u.cr)} · ✍️ write ${fmtN(u.cw)} · new ${fmtN(u.i)} · out ${fmtN(u.o)}${u.th ? ' · 🧠 ' + fmtN(u.th) : ''}</div>
    ${a.brief ? `<h4>The order (what they were told)</h4><div class="md brief">${md(a.brief)}</div>` : ''}
    <h4>Trips to the stalls · ${a.tools.length}</h4>
    <ul class="tl">${a.tools.slice(-60).reverse().map(t => `<li class="${t.err ? 'err' : ''}" title="${esc(t.inp || '')}"><span>${DISH[stallKind(t.kind)] || '🍽️'}</span><span>${esc(short(t.sum, 70))}</span><span class="dur">${t.pending ? '⏳' : (t.err ? '✗ ' : '') + (t.dur != null ? fmtD(t.dur) : '')}</span></li>`).join('') || '<li><span></span><span>none yet</span></li>'}</ul>
  </div>`);
  if (pane._h !== before) $('#tkFilter').addEventListener('click', e => { e.preventDefault(); setFilter(a.id); tab('log'); });
}

/* ───────────────────────── selection, tabs, filter ───────────────────────── */
function select(id, openTicket) {
  S.selected = id;
  if (S.agents.has(id)) showChatFor(id);                // a sub-agent (a customer, or its row in the card): show its conversation
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
$('#subbar').addEventListener('click', e => { if (e.target.closest('[data-main]')) showChatFor('main'); });
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
  signTick(); updateChips();
  for (const a of PEOPLE.values()) if (a.status === 'working') refreshBubble(a);   // tick the "· 12s" timers
  if (!$('#pane-bill').hidden) renderBill();
  if (!$('#pane-ticket').hidden) renderTicket();
}, 700);
window.addEventListener('resize', fitScene);

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
    else if (m.replayDone) { S.replaying = false; refreshAll(); chatEl.scrollTop = chatEl.scrollHeight; if (FL.pendingSelect && S.agents.has(FL.pendingSelect)) { select(FL.pendingSelect, true); } FL.pendingSelect = null; tab($$('.tabs .on')[0]?.dataset.tab || 'log'); const p = $('#pane-log'); p.scrollTop = p.scrollHeight; }
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
  const av = $('.c-av', c);                                  // portrait = the same hawker as in the scene
  av.dataset.src = (tab && tab.src) || s.src || '';
  setHTML(av, who ? PORTRAIT(who, 40) : '');
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
  const say = $('.c-say', c); say.hidden = busy; say.textContent = busy ? '' : mdPlain(s.last_say || (s.last_prompt ? '🧑 ' + s.last_prompt : ''));
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
        try { new Notification((s.status === 'ready' ? '✅ Done: ' : '⚠ Needs you: ') + (s.title || projectName(s)), { body: s.status === 'ready' ? short(mdPlain(s.last_say), 140) : s.reason, tag: k }); } catch { /* ignore */ }
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
    FL.tabs = data.tabs || []; FL.closedOn = !!data.closed; FROZEN = false;
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
  } catch (e) {
    if (!(e instanceof TypeError && /fetch/i.test(e.message)) && !/^\d+$/.test(e.message)) console.error('fleet update failed:', e);   // a page bug, not the network
    $('#fleetSum').textContent = 'server not reachable…';
    FROZEN = true; for (const a of PEOPLE.values()) if (a.badge) { setBadge(a, 'disconnected'); setLoopFx(a, null); }   // last known frame, marked stale
  }
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

/* ───────────────────────── the scene: one hawker per open terminal tab ───────────────────────── */
const TS = { first: true };
function headcount() {                                   // one open terminal = one hawker
  const tabs = FL.tabs || [], claude = tabs.filter(t => t.src === 'claude').length, codex = tabs.filter(t => t.src === 'codex').length;
  const text = `${tabs.length} terminal${tabs.length === 1 ? '' : 's'} · ${claude} Claude · ${codex} Codex`;
  return { total: tabs.length, claude, codex, text };
}
const tabPersonId = t => 'tab:' + t.src + ':' + t.pid;
function tabPerson(t) {
  let a = PEOPLE.get(tabPersonId(t));
  if (a) return a;
  const used = new Set([...PEOPLE.values()].filter(p => !p.leaving && p.tabNo).map(p => p.tabNo));
  let no = 1; while (used.has(no)) no++;                                       // first free number (and stall), kept for life
  const skin = (no - 1) % SKINS.length, pal = SRC_SHIRTS[t.src] || SHIRTS;
  a = { id: tabPersonId(t), src: t.src, tabNo: no, skin, name: SKIN_NAMES[skin][Math.floor((no - 1) / SKINS.length) % SKIN_NAMES[skin].length],
        color: pal[(no - 1) % pal.length], node: null, dead: false, label: '', status: '', leaving: false, vis: null, prompt: null };
  a.onClick = () => selectTab(a.id);
  PEOPLE.set(a.id, a);
  mountTab(a, !TS.first);                                                     // page load: everyone is already at work
  return a;
}
function syncTabs() {
  if (!ART) return;
  const alive = new Set();
  (FL.tabs || []).forEach(t => {
    const a = tabPerson(t), s = FL.byKey.get(t.src + ':' + t.sid) || placeholderFor(t);
    alive.add(a.id);
    a.sess = FL.byKey.get(t.src + ':' + t.sid) || null; a.label = s.title; a.lastSay = s.last_say;
    const was = a.status; a.status = s.status;
    const v = visualFor(a, s);
    if (t.proc_status === 'starting' && !a.sess) Object.assign(v, { clip: 'asking', badge: 'starting', text: '… starting' });
    // one-shots only for real transitions seen live, never on the first load
    if (!TS.first && was === 'working' && s.status === 'ready' && v.clip === 'review_hold') { v.clip = 'review'; oneShot(a, 'dish_placement', 'dish_output'); }
    if (v.clip === 'review_hold' && a.clip === 'review') v.clip = 'review';                        // let it finish, then it holds
    setClip(a, v.clip); setBadge(a, v.badge);
    setLoopFx(a, !WORK_CLIPS.has(v.clip) ? null : a.kit && a.kit.id === 'noodle' ? 'stove_glow' : 'steam');   // cooking while it works
    const prompt = s.last_prompt || '';
    if (a.prompt != null && prompt && prompt !== a.prompt) oneShot(a, 'ticket_arrival', 'ticket_rail');
    a.prompt = prompt; a.vis = v;
    refreshBubble(a);
    if (!TS.first && was === 'working' && s.status === 'ready') showBubble(a, v.text, { ms: 4000 });
    // HUD text
    setHTML(a.tagEl, `${a.tabNo}<span> · ${esc(a.name)}</span>`);            // the mini-map shows just the number
    a.tagEl.title = `Tab ${a.tabNo} · ${SRC_NAME[t.src] || t.src} · pid ${t.pid}${s.tokens && s.tokens.total ? ' · ' + fmtN(s.tokens.total) + ' tokens' : ''}`;
    const what = prompt || s.title || 'nothing ordered yet';
    setHTML(a.chitEl, `<b>${esc(short(what, 44))}</b>`); a.chitEl.title = what;
    a.chitEl.dataset.s = s.status || '';
    const sel = !!a.sess && selKey() === keyOf(a.sess);
    a.hawker && a.hawker.classList.toggle('sel', sel); a.hud.classList.toggle('sel', sel);
    syncCustomers(a, a.sess ? s : null);
  });
  for (const a of PEOPLE.values()) {
    if (alive.has(a.id) || a.leaving) continue;
    a.leaving = true; removeTab(a);
  }
  syncCustomerSel();
  TS.first = false;
  signTick();
}
function refreshBubble(a) {                              // working: what it is doing right now (+ timer); attention: why
  const v = a.vis; if (!v || a.leaving) return;
  if (v.att) showBubble(a, short(v.text, 60), { att: true });
  else if (v.since && a.status === 'working') { const s = Math.round((Date.now() - v.since) / 1000); showBubble(a, v.text + (s >= 3 ? ` · ${fmtD(s * 1000)}` : '')); }
  else if (!a._bt) showBubble(a, '');                    // keep a "done" bubble until it times out
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
  fitScene(); buildFleet(); reset(); requestAnimationFrame(paint);
  try { const m = await fetch(SP + 'manifest.json'); if (m.ok) { loadArt(await m.json()); buildRoom(); } } catch { /* no sprites: the scene stays empty */ }
  try { const m = await fetch(SP + 'customers/manifest.json'); if (m.ok) loadCustomers(await m.json()); } catch { /* no customers: sub-agents stay in the cards */ }
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
