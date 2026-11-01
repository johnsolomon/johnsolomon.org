/* Household finance portal — johnsolomon.org/finance
   Sign-in is passkey only. All data comes through Supabase row-level rules that require a
   passkey session from a listed household member; this page can't widen that. */
(() => {
'use strict';

const SUPABASE_URL = 'https://noytzrdrvaztjeytdwma.supabase.co';
const SUPABASE_KEY = 'sb_publishable_Isq60HaNXN9zmf78wx2fYg_aC5-W8LO';
const PORTAL_FN = SUPABASE_URL + '/functions/v1/portal';
const IDLE_MS = 5 * 60 * 1000;

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit', experimental: { passkey: true } },
});

// ---------- small helpers ----------
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const h = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n, d = 0) => n == null || isNaN(n) ? '—' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: d, maximumFractionDigits: d }).format(n);
const money2 = (n) => money(n, 2);
const signed = (n, d = 0) => (n > 0 ? '+' : n < 0 ? '−' : '') + money(Math.abs(n), d);
const pct = (n) => n == null || isNaN(n) ? '—' : (n > 0 ? '+' : '') + n.toFixed(0) + '%';
const num = (v) => v == null ? null : Number(v);
const d = (s) => new Date(s.length === 10 ? s + 'T00:00:00' : s);
const fmtDay = (s) => d(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const fmtDayLong = (s) => d(s).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
const fmtMonth = (s) => d(s).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
const fmtMon = (s) => d(s).toLocaleDateString('en-US', { month: 'short' });
const monthStart = (dt = new Date()) => new Date(dt.getFullYear(), dt.getMonth(), 1);
const iso = (dt) => dt.toISOString().slice(0, 10);
const today = () => iso(new Date(Date.now() - new Date().getTimezoneOffset() * 60000));
const toast = (msg, ms = 2200) => { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => t.hidden = true, ms); };
let CATS = [];  // {name, grp, kind} from the categories table, loaded with the first view
const catKind = (name) => (CATS.find((c) => c.name === name) || {}).kind || 'spend';
const catGroup = (name) => (CATS.find((c) => c.name === name) || {}).grp || 'Other';

async function q(view, build) {
  let s = sb.from(view).select('*');
  if (build) s = build(s);
  const { data, error } = await s;
  if (error) throw new Error(error.message);
  return data || [];
}
async function rpc(fn, args) {
  const { data, error } = await sb.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data;
}
async function portal(action, extra = {}) {
  const { data: { session } } = await sb.auth.getSession();
  const r = await fetch(PORTAL_FN, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (session?.access_token || '') }, body: JSON.stringify({ action, ...extra }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || ('Request failed (' + r.status + ')'));
  return j;
}

// ---------- auth & lock ----------
const screens = { gate: $('#gate'), setup: $('#setup'), app: $('#app') };
function show(name) { for (const k in screens) screens[k].hidden = k !== name; }
function showErr(id, msg) { const el = $(id); el.textContent = msg || ''; el.hidden = !msg; }

async function whoami() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return null;
  try { return await rpc('me'); } catch { return null; }
}

async function boot() {
  const params = new URLSearchParams(location.search);
  if (params.get('linked')) { history.replaceState(null, '', location.pathname + '#accounts'); sessionStorage.setItem('justLinked', '1'); }
  // supabase-js consumes an invite/magic-link token from the URL hash on load.
  await new Promise((r) => setTimeout(r, 50));
  const me = await whoami();
  if (!me) return gate();
  if (!me.member) return gate('Account not authorized.');
  if (!me.strong) return setup();
  enter(me);
}

function gate(msg) {
  show('gate');
  $('#gate-msg').textContent = msg || '';
  $('#gate-msg').className = msg ? 'err' : 'muted';
  showErr('#gate-err', '');
}

function setup() {
  show('setup');
  showErr('#setup-err', '');
  $('#setup-name').value = /iPhone/.test(navigator.userAgent) ? 'iPhone' : /iPad/.test(navigator.userAgent) ? 'iPad' : /Mac/.test(navigator.userAgent) ? 'Mac' : '';
}

$('#btn-signin').addEventListener('click', async () => {
  const b = $('#btn-signin'); b.disabled = true; showErr('#gate-err', '');
  try {
    const { error } = await sb.auth.signInWithPasskey();
    if (error) throw error;
    const me = await whoami();
    if (!me?.member) return gate('Account not authorized.');
    if (!me.strong) return gate('Passkey authentication required.');
    enter(me);
  } catch (e) { showErr('#gate-err', e.message || 'Sign-in failed.'); }
  finally { b.disabled = false; }
});

$('#btn-register').addEventListener('click', async () => {
  const b = $('#btn-register'); b.disabled = true; showErr('#setup-err', '');
  try {
    const friendlyName = $('#setup-name').value.trim() || 'My device';
    const { data: reg, error } = await sb.auth.registerPasskey();
    if (error) throw new Error(/approval|database error/i.test(error.message) ? 'A passkey already exists for this account. Approve this registration from a signed-in device (Settings → Approve another device) and retry within 10 minutes.' : error.message);
    await nameKey(reg, friendlyName);
    // The email session isn't a passkey session; end it everywhere and sign in with the new passkey so data unlocks.
    await sb.auth.signOut({ scope: 'global' });
    const { error: e2 } = await sb.auth.signInWithPasskey();
    if (e2) throw e2;
    const me = await whoami();
    if (!me?.strong || !me.member) throw new Error('Passkey registered. Sign in to continue.');
    enter(me);
  } catch (e) { showErr('#setup-err', e.message || 'Could not create the passkey.'); }
  finally { b.disabled = false; }
});

$('#btn-firsttime').addEventListener('click', () => { $('#firsttime').hidden = !$('#firsttime').hidden; });
$('#btn-sendlink').addEventListener('click', async () => {
  const email = $('#ft-email').value.trim(); if (!email) return;
  const b = $('#btn-sendlink'); b.disabled = true;
  const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: location.origin + '/finance/' } });
  $('#ft-msg').textContent = error ? error.message : 'Link sent.';
  b.disabled = false;
});

let lastActive = Date.now(), hiddenAt = 0;
['pointerdown', 'keydown', 'scroll', 'touchstart'].forEach((ev) => addEventListener(ev, () => { lastActive = Date.now(); }, { passive: true }));
document.addEventListener('visibilitychange', () => {
  if (document.hidden) hiddenAt = Date.now();
  else if (hiddenAt && Date.now() - hiddenAt > IDLE_MS && !screens.app.hidden) lock();
});
setInterval(() => { if (!screens.app.hidden && Date.now() - lastActive > IDLE_MS) lock(); }, 15000);
async function lock() {
  state.cache = {}; $('#view').innerHTML = ''; closeSheet();
  await sb.auth.signOut({ scope: 'local' });
  gate('Locked.');
}
$('#btn-lock').addEventListener('click', lock);

// ---------- app shell ----------
const state = { me: null, cache: {}, route: 'home' };
function enter(me) {
  state.me = me; show('app'); lastActive = Date.now();
  route();
  if (sessionStorage.getItem('justLinked')) { sessionStorage.removeItem('justLinked'); portal('finish').then(() => { invalidate(); route(); toast('Linked. Initial sync running.'); }).catch(() => {}); }
}
addEventListener('hashchange', route);
const TABS = { home: 'home', activity: 'activity', insights: 'insights', cycle: 'insights', trends: 'insights', spending: 'insights', income: 'insights', fees: 'insights', plan: 'plan', budget: 'plan', recurring: 'plan', goals: 'plan', debt: 'plan', future: 'plan', invest: 'invest', holdings: 'invest', allocation: 'invest', contributions: 'invest', strategy: 'invest', home_purchase: 'plan', business: 'plan', accounts: 'top', settings: 'top', cashflow: 'insights', credit: 'plan', review: 'insights', cash: 'insights', habits: 'insights', more: 'plan' };
function route() {
  if (screens.app.hidden) return;
  const r = (location.hash || '#home').slice(1).split('/')[0];
  state.route = TABS[r] ? r : 'home';
  $$('.tabs a, .topbar a').forEach((a) => a.classList.toggle('on', a.dataset.tab === TABS[state.route] || a.dataset.tab === state.route));
  const view = $('#view');
  view.innerHTML = '<p class="muted">Loading…</p>';
  if (state.route === 'cashflow') state.route = 'insights'; if (state.route === 'more') state.route = 'budget';
  (CATS.length ? Promise.resolve() : D.cats().catch(() => [])).then(() => (VIEWS[state.route] || VIEWS.home)(view)).catch((e) => { view.innerHTML = '<p class="err">' + h(e.message) + '</p>'; });
  window.scrollTo(0, 0);
}
function invalidate() { state.cache = {}; }
async function cached(key, fn) { if (!(key in state.cache)) state.cache[key] = await fn(); return state.cache[key]; }

const D = {
  accounts: () => cached('accounts', () => q('v_accounts', (s) => s.order('institution_name').order('name'))),
  connections: () => cached('connections', () => q('v_connections', (s) => s.order('created_at'))),
  nw: () => cached('nw', () => q('v_net_worth')),
  nwh: () => cached('nwh', () => q('v_net_worth_history', (s) => s.gte('as_of', iso(new Date(Date.now() - 365 * 864e5))).order('as_of'))),
  cashflow: () => cached('cashflow', () => q('v_monthly_cashflow', (s) => s.gte('month', iso(new Date(new Date().getFullYear(), new Date().getMonth() - 11, 1))).order('month'))),
  spend: () => cached('spend', () => q('v_monthly_spend', (s) => s.gte('month', iso(new Date(new Date().getFullYear(), new Date().getMonth() - 11, 1))))),
  budget: () => cached('budget', () => q('v_budget_status')),
  budgets: () => cached('budgets', () => q('budgets', (s) => s.order('category'))),
  recurring: () => cached('recurring', () => rpc('recurring')),
  holdings: () => cached('holdings', () => q('v_holdings', (s) => s.order('institution_value', { ascending: false }))),
  alloc: () => cached('alloc', () => q('v_allocation')),
  goals: () => cached('goals', () => q('v_goal_progress', (s) => s.order('created_at'))),
  credit: () => cached('credit', () => q('credit_scores', (s) => s.order('as_of'))),
  fees: () => cached('fees', () => q('v_fees_interest', (s) => s.gte('month', iso(new Date(new Date().getFullYear(), new Date().getMonth() - 11, 1))).order('month'))),
  rules: () => cached('rules', () => q('category_rules', (s) => s.order('priority').order('id'))),
  summary: () => cached('summary', () => q('v_monthly_summary', (s) => s.order('month'))),
  nwm: () => cached('nwm', () => q('v_net_worth_monthly', (s) => s.order('month'))),
  weekday: () => cached('weekday', () => q('v_weekday_spend', (s) => s.order('dow'))),
  concentration: () => cached('concentration', () => q('v_concentration')),
  drift: () => cached('drift', () => q('v_allocation_drift')),
  counts: () => cached('counts', () => q('v_monthly_counts', (s) => s.order('month'))),
  settings: () => cached('settings', async () => Object.fromEntries((await q('app_settings')).map((r) => [r.key, r.value]))),
  cats: () => cached('cats', async () => { CATS = await q('categories', (s) => s.order('sort')); return CATS; }),
  lastSync: () => cached('lastSync', () => q('sync_runs', (s) => s.order('id', { ascending: false }).limit(1))),
  tx: (opts) => q('transactions', (s) => {
    s = s.order('date', { ascending: false }).order('amount', { ascending: false }).limit(opts.limit || 200);
    if (opts.from) s = s.gte('date', opts.from);
    if (opts.to) s = s.lte('date', opts.to);
    if (opts.account) s = s.eq('account_id', opts.account);
    if (opts.category) s = s.eq('category', opts.category);
    if (opts.search) s = s.or('name.ilike.%' + opts.search.replace(/[%,.()]/g, '') + '%,merchant_name.ilike.%' + opts.search.replace(/[%,.()]/g, '') + '%');
    return s;
  }),
};

// ---------- chart helpers (all rendered by the interactive engine) ----------
function barChart(rows, keys) {
  if (!rows.length) return '<p class="empty">Nothing yet.</p>';
  const NM = { income: ['Income', C.green], spending: ['Spending', C.blue], fees: ['Fees', C.red], interest_paid: ['Interest', C.amber] };
  return ix({ type: 'cbar', height: 190, yfmt: yMoney, cats: rows.map((r) => monLabel(r.month)), tipCats: rows.map((r) => monLong(r.month)),
    series: keys.map((k, i) => ({ name: (NM[k] || [k])[0], color: (NM[k] || [0, PAL[i]])[1], vals: rows.map((r) => num(r[k]) || 0) })) });
}
function lineChart(pts, W = 640, H = 160, fmt = money, yMin0 = false) {
  if (!pts.length) return '<p class="empty">Nothing yet.</p>';
  return ix({ type: 'xy', height: H + 24, zero: yMin0, legend: false, yfmt: (v, ax) => ax ? short(v) : fmt(v), series: [{ name: 'Value', data: pts.map((p) => [mx(p.t), p.v]), kind: 'area', color: C.blue }] });
}
function topN(items, n = 9) { const xs = items.filter((i) => i.v > 0).sort((a, b) => b.v - a.v); if (xs.length <= n) return xs; const rest = xs.slice(n - 1); return [...xs.slice(0, n - 1), { k: `Other (${rest.length})`, v: rest.reduce((s, i) => s + i.v, 0) }]; }
function pieChart(items, o = {}) {
  return ix({ type: 'donut', items: items.map((it) => ({ k: it.k, v: it.v })), label: o.label, center: o.center,
    onClick: items.some((i) => i.go) ? (k) => { const it = items.find((x) => x.k === k); if (it && it.go) location.hash = it.go; } : undefined });
}
function chart(series, o = {}) {
  const xs = series.flatMap((s) => (s.pts || []).map((p) => +p.x)); const isDate = xs.length && Math.min(...xs) > 1e11;
  const colorOf = (cls = 'line') => cls.includes('alt') ? C.amber : /\bin\b/.test(cls) ? C.green : cls.includes('thin') || cls.includes('fit') ? C.gray : cls.includes('bar-muted') ? '#9fb0d6' : C.blue;
  const out = []; let band;
  series.forEach((s, i) => {
    if (s.band) band = { lo: s.band.map((b) => [+b.x, b.lo]), hi: s.band.map((b) => [+b.x, b.hi]), name: '10th–90th percentile', color: colorOf(s.cls) };
    if (s.pts && s.pts.length) out.push({ name: s.label || s.name || (series.length > 1 ? 'Series ' + (i + 1) : 'Value'), data: s.pts.map((p) => [+p.x, p.y]), kind: s.bars ? 'bar' : 'line', color: s.color || colorOf(s.cls), dash: (s.cls || '').includes('fit'), width: (s.cls || '').includes('thin') ? 1.2 : 2 });
  });
  const marks = series.flatMap((s) => (s.marks || []).map((mk) => ({ x: +mk.x, y: mk.y, label: mk.label })));
  return ix({ type: 'xy', x: isDate ? 'date' : 'num', height: (o.H || 170) + 20, series: out, band, refs: o.refs, marks, zero: !!o.zero, yMax: o.yMax,
    yfmt: o.fmtY ? (v) => o.fmtY(v) : undefined, xfmt: isDate ? undefined : o.fmtX, xtick: isDate ? undefined : o.fmtX, xticks: o.xticks, legend: out.length > 1 });
}
function niceMax(v) { const p = Math.pow(10, Math.floor(Math.log10(v))); const f = v / p; const n = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10; return n * p; }
function short(v) { const a = Math.abs(v); return (v < 0 ? '−' : '') + (a >= 1e6 ? (a / 1e6).toFixed(1) + 'M' : a >= 1e3 ? (a / 1e3).toFixed(a >= 1e4 ? 0 : 1) + 'k' : a.toFixed(0)); }
function progress(v, max, cls = '') { const p = max > 0 ? Math.min(100, (100 * v) / max) : 0; return `<div class="bar"><i class="${cls}" style="width:${p.toFixed(1)}%"></i></div>`; }

// ---------- sheet ----------
function openSheet(html) { $('#sheet-body').innerHTML = html; $('#sheet').hidden = false; }
function closeSheet() { $('#sheet').hidden = true; $('#sheet-body').innerHTML = ''; }
$('#sheet').addEventListener('click', (e) => { if (e.target === $('#sheet')) closeSheet(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });
const catOptions = (sel) => { const groups = []; for (const c of CATS) { let g = groups.find((x) => x.g === c.grp); if (!g) groups.push(g = { g: c.grp, items: [] }); g.items.push(c.name); }
  return groups.map((g) => `<optgroup label="${h(g.g)}">${g.items.map((c) => `<option ${c === sel ? 'selected' : ''}>${h(c)}</option>`).join('')}</optgroup>`).join(''); };

// ---------- inline styles under CSP ----------
// The page CSP (style-src 'self') blocks style="" attributes in parsed HTML; CSSOM writes are allowed.
// Re-apply every style attribute through CSSOM as nodes are inserted.
function applyInlineStyles(root) {
  const els = root.nodeType === 1 ? [root, ...root.querySelectorAll('[style]')] : [];
  for (const el of els) { const s = el.getAttribute && el.getAttribute('style'); if (s && !el.__st) { el.__st = 1; el.style.cssText = s; } }
}
new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) if (n.nodeType === 1) { applyInlineStyles(n); ixMountIn(n); } })
  .observe(document.documentElement, { childList: true, subtree: true });

// ---------- interactive charts ----------
// ix(spec) returns a placeholder; the observer mounts it once it is in the DOM, re-rendering on resize.
// Types: xy (time or numeric x; line/area/step/bar/dots series, band, refs, shaded danger zone, markers, brush zoom),
//        cbar (category bars, grouped or stacked, optional line overlay), donut, hbar, heat.
const IX = { specs: new Map(), n: 0 };
const PAL = ['#1f5cf0', '#1e8e5a', '#b26a12', '#c8382e', '#7c3aed', '#0e9aa7', '#d9488b', '#6b7480', '#8ab4f8', '#a3b18a', '#e0a458', '#5b8dff'];
const C = { blue: '#1f5cf0', green: '#1e8e5a', amber: '#b26a12', red: '#c8382e', gray: '#8a929e', violet: '#7c3aed', teal: '#0e9aa7' };
function ix(spec) { const id = 'ix' + (++IX.n); IX.specs.set(id, spec); return `<div class="ix" data-ix="${id}"></div>`; }
function ixMountIn(node) { const els = node.matches && node.matches('.ix[data-ix]') ? [node] : [...(node.querySelectorAll ? node.querySelectorAll('.ix[data-ix]') : [])]; els.forEach(ixMount); }
function ixMount(el) {
  if (el.__ix) return; const spec = IX.specs.get(el.dataset.ix); if (!spec) return; el.__ix = { spec, state: {} };
  const draw = () => { try { IXR[spec.type](el, spec, el.__ix.state); } catch (e) { el.innerHTML = '<p class="err">' + h(e.message) + '</p>'; } };
  draw(); let w = el.clientWidth;
  if (window.ResizeObserver) new ResizeObserver(() => { if (Math.abs(el.clientWidth - w) > 4) { w = el.clientWidth; draw(); } }).observe(el);
}
function ixTip() { let t = document.getElementById('ixtip'); if (!t) { t = document.createElement('div'); t.id = 'ixtip'; t.className = 'ixtip'; t.hidden = true; document.body.appendChild(t); } return t; }
function ixShowTip(html, ev) {
  const t = ixTip(); t.innerHTML = html; t.hidden = false;
  const r = t.getBoundingClientRect(), vw = document.documentElement.clientWidth, vh = window.innerHeight;
  let x = ev.clientX + 14, y = ev.clientY + 14;
  if (x + r.width > vw - 8) x = ev.clientX - r.width - 14; if (x < 8) x = 8;
  if (y + r.height > vh - 8) y = ev.clientY - r.height - 14; if (y < 8) y = 8;
  t.style.left = x + 'px'; t.style.top = y + 'px';
}
function ixHideTip() { const t = document.getElementById('ixtip'); if (t) t.hidden = true; }
document.addEventListener('scroll', ixHideTip, { passive: true });
const sw = (c, dash) => `<i class="sw${dash ? ' dash' : ''}" data-c="${c}"></i>`;
function paintSwatches(root) { root.querySelectorAll('i.sw[data-c]').forEach((i) => { i.style.background = i.dataset.c; }); }

function niceTicks(lo, hi, n = 4) {
  if (!(hi > lo)) { hi = lo + 1; }
  const span = hi - lo, step0 = span / n, p = Math.pow(10, Math.floor(Math.log10(step0))), f = step0 / p;
  const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
  const a = Math.floor(lo / step) * step, b = Math.ceil(hi / step) * step, out = [];
  for (let v = a; v <= b + step / 2; v += step) out.push(+v.toFixed(10));
  return out;
}
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function dateTicks(x0, x1, maxN) {
  const days = (x1 - x0) / 864e5, out = [];
  const a = new Date(x0);
  if (days > 75) {
    const stepM = Math.max(1, Math.ceil((days / 30.44) / maxN));
    let d0 = new Date(a.getFullYear(), a.getMonth() + (a.getDate() > 1 ? 1 : 0), 1);
    while (d0.getMonth() % stepM) d0 = new Date(d0.getFullYear(), d0.getMonth() + 1, 1);
    for (let d1 = d0; +d1 <= x1; d1 = new Date(d1.getFullYear(), d1.getMonth() + stepM, 1)) out.push(+d1);
  } else {
    const stepD = Math.max(1, Math.ceil(days / maxN));
    for (let t = +new Date(a.getFullYear(), a.getMonth(), a.getDate()); t <= x1; t += stepD * 864e5) if (t >= x0) out.push(t);
  }
  return out;
}
const fmtTickDate = (t, span) => { const d0 = new Date(t); return span > 330 * 864e5 ? (d0.getMonth() === 0 ? String(d0.getFullYear()) : MON[d0.getMonth()]) : span > 75 * 864e5 ? MON[d0.getMonth()] : MON[d0.getMonth()] + ' ' + d0.getDate(); };
const fmtTipDate = (t) => { const d0 = new Date(t); return d0.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }); };
function nearestIdx(arr, v) { let lo = 0, hi = arr.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (arr[m] < v) lo = m; else hi = m; } return Math.abs(arr[lo] - v) <= Math.abs(arr[hi] - v) ? lo : hi; }
const svgEl = (W, H, inner, cls = '') => `<svg class="ixsvg ${cls}" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${inner}</svg>`;
const legendHtml = (items, extra = '') => `<div class="ixlegend">${items.map((it, i) => `<button type="button" class="ixleg${it.off ? ' off' : ''}" data-li="${i}">${sw(it.color, it.dash)}${h(it.name)}</button>`).join('')}${extra}</div>`;

const IXR = {};

// ---- xy ----
IXR.xy = (el, spec, st) => {
  const W = Math.max(280, el.clientWidth || 640), H = spec.height || 200;
  const isDate = (spec.x || 'date') === 'date';
  const series = spec.series.map((s, i) => ({ color: s.color || PAL[i % PAL.length], kind: s.kind || 'line', ...s, off: st.off ? st.off.has(i) : !!s.hidden }));
  if (!st.off) st.off = new Set(series.map((s, i) => (s.off ? i : -1)).filter((i) => i >= 0));
  const vis = series.filter((s) => !s.off);
  const hasR = vis.some((s) => s.axis === 'right');
  const m = { t: 12, r: hasR ? 46 : 14, b: 24, l: 50 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  // x domain
  const allX = [...new Set(series.flatMap((s) => s.data.map((p) => +p[0])).concat(spec.band ? spec.band.lo.map((p) => +p[0]) : []))].sort((a, b) => a - b);
  if (!allX.length) { el.innerHTML = '<p class="empty">Nothing in range.</p>'; return; }
  let x0 = allX[0], x1 = allX[allX.length - 1];
  const hasBars = vis.some((s) => s.kind === 'bar');
  let pad = 0;
  if (hasBars) { const gaps = allX.slice(1).map((v, i) => v - allX[i]); pad = (gaps.length ? Math.min(...gaps) : 864e5) / 2; }
  if (x0 === x1) { x0 -= isDate ? 864e5 : 1; x1 += isDate ? 864e5 : 1; }
  let dx0 = x0 - pad, dx1 = x1 + pad;
  if (st.zoom) { dx0 = st.zoom[0]; dx1 = st.zoom[1]; }
  const inX = (v) => v >= dx0 && v <= dx1;
  const X = (v) => m.l + (iw * (v - dx0)) / (dx1 - dx0);
  // y domains
  const yVals = (axis) => {
    const out = [];
    for (const s of vis) { if ((s.axis || 'left') !== axis) continue;
      if (s.stack) continue;
      s.data.forEach((p) => { if (inX(+p[0]) && p[1] != null && isFinite(p[1])) out.push(+p[1]); }); }
    if (axis === 'left') {
      // stacked bars contribute their sums
      const stacks = {}; for (const s of vis) if (s.stack) s.data.forEach((p) => { if (!inX(+p[0])) return; const k = s.stack + '|' + p[0]; stacks[k] = stacks[k] || [0, 0]; if (p[1] >= 0) stacks[k][0] += +p[1]; else stacks[k][1] += +p[1]; });
      Object.values(stacks).forEach(([a, b]) => out.push(a, b));
      if (spec.band) { spec.band.lo.forEach((p) => inX(+p[0]) && out.push(+p[1])); spec.band.hi.forEach((p) => inX(+p[0]) && out.push(+p[1])); }
      (spec.refs || []).forEach((r) => out.push(r.y));
    }
    return out;
  };
  const yl = yVals('left'); let lo = yl.length ? Math.min(...yl) : 0, hi = yl.length ? Math.max(...yl) : 1;
  if (spec.zero !== false && (spec.zero || hasBars)) { lo = Math.min(0, lo); hi = Math.max(0, hi); }
  if (spec.yMin != null) lo = Math.min(lo, spec.yMin); if (spec.yMax != null) hi = Math.max(hi, spec.yMax);
  if (spec.yFix) { lo = spec.yFix[0]; hi = spec.yFix[1]; }
  const ticks = niceTicks(lo, hi, H < 150 ? 3 : 4); lo = Math.min(lo, ticks[0]); hi = Math.max(hi, ticks[ticks.length - 1]);
  if (spec.yFix) { lo = spec.yFix[0]; hi = spec.yFix[1]; }
  const Y = (v) => m.t + ih - (ih * (v - lo)) / ((hi - lo) || 1);
  let Y2 = null, t2 = [];
  // right axis shares the left axis's zero and gridlines: each left tick v maps to v * k on the right
  if (hasR) { const yr = yVals('right'), rmax = Math.max(...yr, 1e-9), rmin = Math.min(0, ...yr);
    const lstep = ticks[1] - ticks[0], up = Math.max(1, ticks.filter((v) => v > 0).length), dn = ticks.filter((v) => v < 0).length;
    const niceUp = (x) => { const p = Math.pow(10, Math.floor(Math.log10(x))), f = x / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p; };
    const rstep = niceUp(Math.max(rmax / up, dn ? -rmin / dn : 0, 1e-9)); const k = rstep / lstep;
    t2 = ticks.map((v) => v * k).filter((v) => v >= Math.min(0, rmin) - 1e-9); Y2 = (v) => Y(v / k); }
  const yf = spec.yfmt || short, y2f = spec.y2fmt || short;
  const xf = spec.xfmt || (isDate ? fmtTipDate : (v) => String(v));
  const xtf = spec.xtick || (isDate ? (t) => fmtTickDate(t, dx1 - dx0) : xf);
  let s = `<defs><clipPath id="c${el.dataset.ix}"><rect x="${m.l}" y="${m.t - 2}" width="${iw}" height="${ih + 4}"/></clipPath></defs>`;
  // danger shading
  if (spec.shadeBelow != null && spec.shadeBelow > lo) s += `<rect class="ixdanger" x="${m.l}" y="${Y(Math.min(spec.shadeBelow, hi))}" width="${iw}" height="${Y(lo) - Y(Math.min(spec.shadeBelow, hi))}"/>`;
  ticks.forEach((v) => { s += `<line class="ixgrid" x1="${m.l}" x2="${W - m.r}" y1="${Y(v)}" y2="${Y(v)}"/><text class="ixax" x="${m.l - 6}" y="${Y(v) + 4}" text-anchor="end">${h(yf(v, true))}</text>`; });
  if (hasR) t2.forEach((v) => { s += `<text class="ixax" x="${W - m.r + 6}" y="${Y2(v) + 4}">${h(y2f(v, true))}</text>`; });
  if (lo < 0 && hi > 0) s += `<line class="ixzero" x1="${m.l}" x2="${W - m.r}" y1="${Y(0)}" y2="${Y(0)}"/>`;
  // x ticks
  const xt = isDate ? dateTicks(dx0, dx1, Math.max(3, Math.floor(iw / 70))) : (spec.xticks || niceTicks(dx0, dx1, Math.max(3, Math.floor(iw / 80)))).filter(inX);
  xt.forEach((t) => { const x = X(t); if (x < m.l - 1 || x > W - m.r + 1) return; s += `<text class="ixax" x="${x}" y="${H - 6}" text-anchor="middle">${h(xtf(t))}</text>`; });
  s += `<g clip-path="url(#c${el.dataset.ix})">`;
  if (spec.band) { const lo2 = spec.band.lo, hi2 = spec.band.hi; s += `<path class="ixband" fill="${spec.band.color || C.blue}" d="${hi2.map((p, i) => (i ? 'L' : 'M') + X(+p[0]).toFixed(1) + ' ' + Y(+p[1]).toFixed(1)).join(' ')} ${[...lo2].reverse().map((p) => 'L' + X(+p[0]).toFixed(1) + ' ' + Y(+p[1]).toFixed(1)).join(' ')} Z"/>`; }
  // bars (grouped by non-stack series, stacks combined)
  const barSeries = vis.filter((s0) => s0.kind === 'bar' && (s0.axis || 'left') === 'left');
  if (barSeries.length) {
    const groups = []; barSeries.forEach((b) => { const g = b.stack || ('_' + b.name); if (!groups.includes(g)) groups.push(g); });
    const stepPx = (iw * (2 * pad)) / (dx1 - dx0), gw = Math.max(2, stepPx * 0.78), bw = gw / groups.length;
    const base = {};
    for (const b of barSeries) { const gi = groups.indexOf(b.stack || ('_' + b.name));
      for (const p of b.data) { const xv = +p[0], v = +p[1]; if (!inX(xv) || !v) continue; const k = gi + '|' + xv; const bse = base[k] || [0, 0]; const from = v >= 0 ? bse[0] : bse[1], to = from + v; if (v >= 0) bse[0] = to; else bse[1] = to; base[k] = bse;
        s += `<rect class="ixbar" fill="${b.color}" x="${(X(xv) - gw / 2 + gi * bw).toFixed(1)}" y="${Math.min(Y(from), Y(to)).toFixed(1)}" width="${Math.max(1, bw - 1).toFixed(1)}" height="${Math.abs(Y(to) - Y(from)).toFixed(1)}" rx="1.5"/>`; } }
  }
  for (const sr of vis) {
    if (sr.kind === 'bar') continue;
    const YY = sr.axis === 'right' ? Y2 : Y;
    const pts = sr.data.filter((p) => p[1] != null && isFinite(p[1]));
    if (sr.kind === 'dots') { pts.forEach((p) => { s += `<circle class="ixdot" cx="${X(+p[0])}" cy="${YY(+p[1])}" r="${sr.r || 3}" fill="${sr.color}"/>`; }); continue; }
    let d = '';
    pts.forEach((p, i) => { const x = X(+p[0]).toFixed(1), y = YY(+p[1]).toFixed(1); if (sr.kind === 'step' && i) d += `H${x}V${y}`; else d += (i ? 'L' : 'M') + x + ' ' + y; });
    if (sr.kind === 'area' && pts.length) s += `<path class="ixarea" fill="${sr.color}" d="${d} L${X(+pts[pts.length - 1][0]).toFixed(1)} ${YY(Math.max(lo, 0)).toFixed(1)} L${X(+pts[0][0]).toFixed(1)} ${YY(Math.max(lo, 0)).toFixed(1)} Z"/>`;
    s += `<path class="ixline${sr.dash ? ' dash' : ''}" stroke="${sr.color}" stroke-width="${sr.width || 2}" d="${d}"/>`;
  }
  (spec.refs || []).forEach((r) => { if (r.y < lo || r.y > hi) return; s += `<line class="ixref" stroke="${r.color || C.gray}" x1="${m.l}" x2="${W - m.r}" y1="${Y(r.y)}" y2="${Y(r.y)}"/><text class="ixreflabel" x="${W - m.r - 4}" y="${Y(r.y) - 4}" text-anchor="end">${h(r.label || '')}</text>`; });
  (spec.marks || []).forEach((mk) => { const x = +mk.x; if (!inX(x)) return; const y = mk.y != null ? Y(mk.y) : m.t + ih; s += `<circle class="ixmark" cx="${X(x)}" cy="${y}" r="${mk.r || 3.5}" fill="${mk.color || C.red}"/>`; });
  s += `</g><line class="ixcross" x1="0" x2="0" y1="${m.t}" y2="${m.t + ih}" visibility="hidden"/><g class="ixhov"></g><rect class="ixbrush" x="0" y="${m.t}" width="0" height="${ih}" visibility="hidden"/><rect class="ixhit" x="${m.l}" y="${m.t}" width="${iw}" height="${ih}"/>`;
  const legendItems = spec.legend === false || series.length < 2 && !spec.band ? [] : series.map((sr) => ({ name: sr.name, color: sr.color, off: sr.off, dash: sr.dash }));
  el.innerHTML = svgEl(W, H, s) + (legendItems.length || st.zoom ? legendHtml(legendItems, st.zoom ? '<button type="button" class="ixleg reset">Reset zoom</button>' : '') : '');
  paintSwatches(el);
  // interaction
  const svg = el.querySelector('svg'), hit = el.querySelector('.ixhit'), cross = el.querySelector('.ixcross'), hov = el.querySelector('.ixhov'), brush = el.querySelector('.ixbrush');
  const visX = allX.filter(inX);
  const toLocal = (ev) => { const r = svg.getBoundingClientRect(); return (ev.clientX - r.left) * (W / r.width); };
  const invX = (px) => dx0 + ((px - m.l) / iw) * (dx1 - dx0);
  let drag = null;
  const show = (ev) => {
    if (!visX.length) return; const px = toLocal(ev); const xv = visX[nearestIdx(visX, invX(px))]; const cx = X(xv);
    cross.setAttribute('x1', cx); cross.setAttribute('x2', cx); cross.setAttribute('visibility', 'visible');
    let dots = '', rows = '';
    for (const sr of vis) { const p = sr.data.find((q) => +q[0] === xv); if (!p || p[1] == null) continue; const YY = sr.axis === 'right' ? Y2 : Y;
      if (sr.kind !== 'bar') dots += `<circle cx="${cx}" cy="${YY(+p[1])}" r="4" fill="${sr.color}" class="ixhovdot"/>`;
      if (sr.tip === false) continue;
      rows += `<div class="r">${sw(sr.color, sr.dash)}<span>${h(sr.name)}</span><b>${h((sr.fmt || (sr.axis === 'right' ? y2f : yf))(+p[1]))}</b></div>`; }
    if (spec.band) { const a = spec.band.lo.find((q) => +q[0] === xv), b = spec.band.hi.find((q) => +q[0] === xv); if (a && b) rows += `<div class="r">${sw(spec.band.color || C.blue)}<span>${h(spec.band.name || 'range')}</span><b>${h(yf(+a[1]))} – ${h(yf(+b[1]))}</b></div>`; }
    (spec.marks || []).filter((mk) => +mk.x === xv && mk.label).forEach((mk) => { rows += `<div class="r">${sw(mk.color || C.red)}<span>${h(mk.label)}</span></div>`; });
    if (spec.extra) rows += spec.extra(xv) || '';
    hov.innerHTML = dots;
    const tip = ixTip(); ixShowTip(`<div class="hd">${h(xf(xv))}</div>${rows}`, ev); paintSwatches(tip);
  };
  const hide = () => { cross.setAttribute('visibility', 'hidden'); hov.innerHTML = ''; ixHideTip(); };
  hit.addEventListener('pointermove', (ev) => {
    if (drag) { const px = Math.max(m.l, Math.min(m.l + iw, toLocal(ev))); brush.setAttribute('x', Math.min(drag, px)); brush.setAttribute('width', Math.abs(px - drag)); brush.setAttribute('visibility', 'visible'); hide(); return; }
    show(ev);
  });
  hit.addEventListener('pointerleave', () => { if (!drag) hide(); });
  hit.addEventListener('pointerdown', (ev) => { if (spec.zoom === false || ev.pointerType !== 'mouse') { show(ev); return; } drag = toLocal(ev); hit.setPointerCapture(ev.pointerId); });
  hit.addEventListener('pointerup', (ev) => {
    if (drag == null) { return; } const px = toLocal(ev), a = Math.min(drag, px), b = Math.max(drag, px); drag = null; brush.setAttribute('visibility', 'hidden');
    if (b - a > 10) { st.zoom = [invX(a), invX(b)]; IXR.xy(el, spec, st); }
    else if (spec.onClick && visX.length) spec.onClick(visX[nearestIdx(visX, invX(px))]);
  });
  hit.addEventListener('dblclick', () => { if (st.zoom) { st.zoom = null; IXR.xy(el, spec, st); } });
  el.querySelectorAll('.ixleg[data-li]').forEach((b) => b.onclick = () => { const i = +b.dataset.li; if (st.off.has(i)) st.off.delete(i); else if (series.length - st.off.size > 1) st.off.add(i); IXR.xy(el, spec, st); });
  const rz = el.querySelector('.ixleg.reset'); if (rz) rz.onclick = () => { st.zoom = null; IXR.xy(el, spec, st); };
};

// ---- category bars ----
// spec: { cats: [label], series: [{ name, vals: [n], color, stack?, kind: 'bar'|'line', fmt }], yfmt, height, onClick(i), tip(i) }
IXR.cbar = (el, spec, st) => {
  const W = Math.max(280, el.clientWidth || 640), H = spec.height || 200;
  if (!st.off) st.off = new Set((spec.series || []).map((s, i) => (s.hidden ? i : -1)).filter((i) => i >= 0));
  const series = spec.series.map((s, i) => ({ color: s.color || PAL[i % PAL.length], kind: s.kind || 'bar', ...s, off: st.off.has(i) }));
  const vis = series.filter((s) => !s.off), n = spec.cats.length;
  if (!n) { el.innerHTML = '<p class="empty">Nothing in range.</p>'; return; }
  const m = { t: 12, r: 12, b: spec.rotate ? 36 : 24, l: 50 }, iw = W - m.l - m.r, ih = H - m.t - m.b;
  const groups = []; vis.filter((s) => s.kind === 'bar').forEach((b) => { const g = b.stack || ('_' + b.name); if (!groups.includes(g)) groups.push(g); });
  const tops = []; for (let i = 0; i < n; i++) { const acc = {}; let mx0 = 0, mn0 = 0; vis.forEach((s) => { const v = +s.vals[i] || 0; if (s.kind === 'line') { mx0 = Math.max(mx0, v); mn0 = Math.min(mn0, v); return; } const g = s.stack || ('_' + s.name); acc[g] = acc[g] || [0, 0]; if (v >= 0) acc[g][0] += v; else acc[g][1] += v; }); Object.values(acc).forEach(([a, b]) => { mx0 = Math.max(mx0, a); mn0 = Math.min(mn0, b); }); tops.push([mn0, mx0]); }
  let lo = Math.min(0, ...tops.map((t) => t[0])), hi = Math.max(...tops.map((t) => t[1]), (spec.refs || []).reduce((a, r) => Math.max(a, r.y), 0), 1);
  const ticks = niceTicks(lo, hi, H < 150 ? 3 : 4); lo = ticks[0]; hi = ticks[ticks.length - 1];
  const Y = (v) => m.t + ih - (ih * (v - lo)) / ((hi - lo) || 1), cw = iw / n, gw = cw * 0.76, bw = gw / Math.max(1, groups.length);
  const cx = (i) => m.l + cw * i + cw / 2;
  const yf = spec.yfmt || short;
  let s = '';
  ticks.forEach((v) => { s += `<line class="ixgrid" x1="${m.l}" x2="${W - m.r}" y1="${Y(v)}" y2="${Y(v)}"/><text class="ixax" x="${m.l - 6}" y="${Y(v) + 4}" text-anchor="end">${h(yf(v, true))}</text>`; });
  if (lo < 0) s += `<line class="ixzero" x1="${m.l}" x2="${W - m.r}" y1="${Y(0)}" y2="${Y(0)}"/>`;
  const every = Math.ceil(n / Math.max(1, Math.floor(iw / (spec.rotate ? 26 : 46))));
  spec.cats.forEach((c, i) => { if (i % every) return; s += spec.rotate ? `<text class="ixax" x="${cx(i)}" y="${H - 6}" text-anchor="end" transform="rotate(-35 ${cx(i)} ${H - 6})">${h(c)}</text>` : `<text class="ixax" x="${cx(i)}" y="${H - 6}" text-anchor="middle">${h(c)}</text>`; });
  for (let i = 0; i < n; i++) { const base = {};
    vis.filter((sr) => sr.kind === 'bar').forEach((sr) => { const v = +sr.vals[i] || 0; if (!v) return; const g = sr.stack || ('_' + sr.name), gi = groups.indexOf(g); const bse = base[g] || [0, 0]; const from = v >= 0 ? bse[0] : bse[1], to = from + v; if (v >= 0) bse[0] = to; else bse[1] = to; base[g] = bse;
      s += `<rect class="ixbar" data-i="${i}" fill="${sr.color}" x="${(cx(i) - gw / 2 + gi * bw).toFixed(1)}" y="${Math.min(Y(from), Y(to)).toFixed(1)}" width="${Math.max(1, bw - 1.5).toFixed(1)}" height="${Math.max(0.5, Math.abs(Y(to) - Y(from))).toFixed(1)}" rx="1.5"/>`; }); }
  vis.filter((sr) => sr.kind === 'line').forEach((sr) => { s += `<path class="ixline${sr.dash ? ' dash' : ''}" stroke="${sr.color}" stroke-width="2" d="${sr.vals.map((v, i) => (i ? 'L' : 'M') + cx(i).toFixed(1) + ' ' + Y(+v || 0).toFixed(1)).join(' ')}"/>`; sr.vals.forEach((v, i) => { s += `<circle cx="${cx(i)}" cy="${Y(+v || 0)}" r="2.5" fill="${sr.color}"/>`; }); });
  (spec.refs || []).forEach((r) => { s += `<line class="ixref" stroke="${r.color || C.gray}" x1="${m.l}" x2="${W - m.r}" y1="${Y(r.y)}" y2="${Y(r.y)}"/><text class="ixreflabel" x="${W - m.r - 4}" y="${Y(r.y) - 4}" text-anchor="end">${h(r.label || '')}</text>`; });
  s += `<rect class="ixcol" x="0" y="${m.t}" width="${cw}" height="${ih}" visibility="hidden"/>`;
  for (let i = 0; i < n; i++) s += `<rect class="ixhitc" data-i="${i}" x="${m.l + cw * i}" y="${m.t}" width="${cw}" height="${ih}"/>`;
  const leg = series.length > 1 && spec.legend !== false ? legendHtml(series.map((sr) => ({ name: sr.name, color: sr.color, off: sr.off, dash: sr.dash }))) : '';
  el.innerHTML = svgEl(W, H, s, spec.onClick ? 'clickable' : '') + leg; paintSwatches(el);
  const col = el.querySelector('.ixcol');
  el.querySelectorAll('.ixhitc').forEach((r) => {
    const i = +r.dataset.i;
    r.addEventListener('pointermove', (ev) => {
      col.setAttribute('x', m.l + cw * i); col.setAttribute('visibility', 'visible');
      let rows = '', tot = 0, nb = 0;
      vis.forEach((sr) => { const v = +sr.vals[i] || 0; if (sr.kind === 'bar' && sr.stack) { tot += v; nb++; } if (sr.tip === false) return; rows += `<div class="r">${sw(sr.color, sr.dash)}<span>${h(sr.name)}</span><b>${h((sr.fmt || yf)(v))}</b></div>`; });
      if (spec.stackTotal && nb > 1) rows += `<div class="r tot"><span>Total</span><b>${h(yf(tot))}</b></div>`;
      if (spec.tip) rows += spec.tip(i) || '';
      ixShowTip(`<div class="hd">${h(spec.tipCats ? spec.tipCats[i] : spec.cats[i])}</div>${rows}`, ev); paintSwatches(ixTip());
    });
    r.addEventListener('pointerleave', () => { col.setAttribute('visibility', 'hidden'); ixHideTip(); });
    if (spec.onClick) r.addEventListener('click', () => { ixHideTip(); spec.onClick(i); });
  });
  el.querySelectorAll('.ixleg[data-li]').forEach((b) => b.onclick = () => { const i = +b.dataset.li; if (st.off.has(i)) st.off.delete(i); else if (series.length - st.off.size > 1) st.off.add(i); IXR.cbar(el, spec, st); });
};

// ---- donut ----
// spec: { items: [{ k, v, color?, sub? }], center?, label, fmt, onClick(k, i), selected? }
IXR.donut = (el, spec) => {
  const items = spec.items.filter((it) => it.v > 0), tot = items.reduce((a, it) => a + it.v, 0), f = spec.fmt || money;
  if (!tot) { el.innerHTML = '<p class="empty">Nothing in range.</p>'; return; }
  const R = 66, r = 42, c = 74, S = 148; let a0 = -Math.PI / 2, paths = '';
  const P = (a, rad) => `${(c + rad * Math.cos(a)).toFixed(2)} ${(c + rad * Math.sin(a)).toFixed(2)}`;
  items.forEach((it, i) => { it.color = it.color || PAL[i % PAL.length]; const fr = it.v / tot, a1 = a0 + fr * 2 * Math.PI, big = fr > 0.5 ? 1 : 0, mid = (a0 + a1) / 2;
    const d = fr > 0.9999 ? `M${P(a0, R)} A${R} ${R} 0 1 1 ${P(a0 + Math.PI, R)} A${R} ${R} 0 1 1 ${P(a0, R)} M${P(a0, r)} A${r} ${r} 0 1 0 ${P(a0 + Math.PI, r)} A${r} ${r} 0 1 0 ${P(a0, r)}` : `M${P(a0, R)} A${R} ${R} 0 ${big} 1 ${P(a1, R)} L${P(a1, r)} A${r} ${r} 0 ${big} 0 ${P(a0, r)} Z`;
    paths += `<path class="ixslice" data-i="${i}" d="${d}" fill="${it.color}" fill-rule="evenodd" data-dx="${(4 * Math.cos(mid)).toFixed(2)}" data-dy="${(4 * Math.sin(mid)).toFixed(2)}"/>`; a0 = a1; });
  const center = spec.center || f(tot);
  const legend = items.map((it, i) => `<div class="ixdrow${spec.onClick ? ' tap' : ''}" data-i="${i}">${sw(it.color)}<span class="k">${h(it.k)}</span><span class="v">${h(f(it.v))}</span><span class="p">${(100 * it.v / tot).toFixed(0)}%</span></div>`).join('');
  el.innerHTML = `<div class="ixdonut"><svg viewBox="0 0 ${S} ${S}" class="ixdsvg">${paths}<text x="${c}" y="${c - 2}" text-anchor="middle" class="ixdc">${h(center)}</text><text x="${c}" y="${c + 13}" text-anchor="middle" class="ixdl">${h(spec.label || '')}</text></svg><div class="ixdleg">${legend}</div></div>`;
  paintSwatches(el);
  const cT = el.querySelector('.ixdc'), lT = el.querySelector('.ixdl');
  const focus = (i, ev) => {
    el.querySelectorAll('.ixslice').forEach((p) => { const on = +p.dataset.i === i; p.setAttribute('transform', on ? `translate(${p.dataset.dx} ${p.dataset.dy})` : ''); p.classList.toggle('dim', i != null && !on); });
    el.querySelectorAll('.ixdrow').forEach((d0) => d0.classList.toggle('on', +d0.dataset.i === i));
    if (i == null) { cT.textContent = center; lT.textContent = spec.label || ''; ixHideTip(); return; }
    const it = items[i]; cT.textContent = (100 * it.v / tot).toFixed(1) + '%'; lT.textContent = it.k.length > 16 ? it.k.slice(0, 15) + '…' : it.k;
    if (ev && ev.pointerType !== undefined) { ixShowTip(`<div class="hd">${h(it.k)}</div><div class="r"><span>Amount</span><b>${h(f(it.v))}</b></div><div class="r"><span>Share</span><b>${(100 * it.v / tot).toFixed(1)}%</b></div>${it.sub ? `<div class="r"><span>${h(it.sub)}</span></div>` : ''}${spec.onClick ? '<div class="r muted"><span>Click to open</span></div>' : ''}`, ev); }
  };
  el.querySelectorAll('.ixslice, .ixdrow').forEach((n0) => {
    n0.addEventListener('pointermove', (ev) => focus(+n0.dataset.i, n0.classList.contains('ixslice') ? ev : null));
    n0.addEventListener('pointerleave', () => focus(null));
    if (spec.onClick) n0.addEventListener('click', () => { ixHideTip(); spec.onClick(items[+n0.dataset.i].k, +n0.dataset.i); });
  });
};

// ---- horizontal bars ----
// spec: { items: [{ k, v, prev?, sub?, color? }], fmt, onClick(k), max }
IXR.hbar = (el, spec) => {
  const items = spec.items, f = spec.fmt || money; if (!items.length) { el.innerHTML = '<p class="empty">Nothing in range.</p>'; return; }
  const mx = Math.max(...items.map((it) => Math.max(it.v, it.prev || 0)), 1);
  el.innerHTML = `<div class="ixhbar">${items.map((it, i) => `<div class="ixhrow${spec.onClick ? ' tap' : ''}" data-i="${i}"><span class="k">${h(it.k)}</span><span class="track"><i class="cur" data-w="${(100 * Math.max(0, it.v) / mx).toFixed(2)}" data-c="${it.color || C.blue}"></i>${it.prev != null ? `<i class="prev" data-w="${(100 * Math.max(0, it.prev) / mx).toFixed(2)}"></i>` : ''}</span><span class="v">${h(f(it.v))}</span></div>`).join('')}</div>${items.some((it) => it.prev != null) ? `<div class="ixlegend"><span class="ixleg">${sw(C.blue)}${h(spec.curLabel || 'This period')}</span><span class="ixleg">${sw('#9aa3af', true)}${h(spec.prevLabel || 'Prior period')}</span></div>` : ''}`;
  el.querySelectorAll('i[data-w]').forEach((i) => { i.style.width = i.dataset.w + '%'; if (i.dataset.c) i.style.background = i.dataset.c; }); paintSwatches(el);
  el.querySelectorAll('.ixhrow').forEach((r) => { const it = items[+r.dataset.i];
    r.addEventListener('pointermove', (ev) => ixShowTip(`<div class="hd">${h(it.k)}</div><div class="r"><span>${h(spec.curLabel || 'This period')}</span><b>${h(f(it.v))}</b></div>${it.prev != null ? `<div class="r"><span>${h(spec.prevLabel || 'Prior period')}</span><b>${h(f(it.prev))}</b></div><div class="r"><span>Change</span><b>${it.prev ? pct(100 * (it.v - it.prev) / it.prev) : 'new'}</b></div>` : ''}${it.sub ? `<div class="r"><span>${h(it.sub)}</span></div>` : ''}`, ev));
    r.addEventListener('pointerleave', ixHideTip);
    if (spec.onClick) r.addEventListener('click', () => { ixHideTip(); spec.onClick(it.k); }); });
};

// ---- heatmap ----
// spec: { rows: [label], cols: [label], vals: [[n]] (rows x cols), fmt, tip(r, c) }
IXR.heat = (el, spec) => {
  const W = Math.max(280, el.clientWidth || 640), lw = 92, ch = 26, H = 22 + spec.rows.length * ch, cw = (W - lw - 4) / spec.cols.length;
  const mx = Math.max(...spec.vals.flat().map((v) => +v || 0), 1), f = spec.fmt || money;
  let s = '';
  spec.cols.forEach((c, j) => { s += `<text class="ixax" x="${lw + cw * j + cw / 2}" y="14" text-anchor="middle">${h(c)}</text>`; });
  spec.rows.forEach((r, i) => { s += `<text class="ixax lab" x="${lw - 8}" y="${22 + ch * i + ch / 2 + 4}" text-anchor="end">${h(r)}</text>`;
    spec.cols.forEach((c, j) => { const v = +spec.vals[i][j] || 0; s += `<rect class="ixcell" data-r="${i}" data-c="${j}" x="${lw + cw * j + 1}" y="${22 + ch * i + 1}" width="${cw - 2}" height="${ch - 2}" rx="3" fill="${spec.color || C.blue}" fill-opacity="${(0.06 + 0.94 * Math.sqrt(v / mx)).toFixed(3)}"/>`; }); });
  el.innerHTML = svgEl(W, H, s);
  el.querySelectorAll('.ixcell').forEach((cell) => { const i = +cell.dataset.r, j = +cell.dataset.c;
    cell.addEventListener('pointermove', (ev) => ixShowTip(`<div class="hd">${h(spec.rows[i])} · ${h(spec.cols[j])}</div><div class="r"><span>${h(spec.valueLabel || 'Value')}</span><b>${h(f(+spec.vals[i][j] || 0))}</b></div>${spec.tip ? spec.tip(i, j) || '' : ''}`, ev));
    cell.addEventListener('pointerleave', ixHideTip); });
};

// ---- helpers for analysis ----
function ols(ys) { const n = ys.length; if (n < 2) return { a: ys[0] || 0, b: 0 }; const xm = (n - 1) / 2, ym = ys.reduce((a, y) => a + y, 0) / n; let sxy = 0, sxx = 0; ys.forEach((y, i) => { sxy += (i - xm) * (y - ym); sxx += (i - xm) ** 2; }); const b = sxx ? sxy / sxx : 0; return { a: ym - b * xm, b }; }
function movAvg(ys, k) { return ys.map((_, i) => { const a = ys.slice(Math.max(0, i - k + 1), i + 1); return a.reduce((s, v) => s + v, 0) / a.length; }); }
const mean = (a) => a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0;
const sum = (a) => a.reduce((s, v) => s + v, 0);
const monLabel = (iso0) => { const d0 = d(iso0); return MON[d0.getMonth()] + (d0.getMonth() === 0 ? ' ' + String(d0.getFullYear()).slice(2) : ''); };
const monLong = (iso0) => d(iso0).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

// ---------- views ----------
const VIEWS = {};

VIEWS.home = async (view) => {
  const [nw, nwh, cf, acc, rec, spend, ls, fc, al, vg, sum] = await Promise.all([D.nw(), D.nwh(), D.cashflow(), D.accounts(), D.recurring().catch(() => []), D.spend(), D.lastSync(), rpc('cash_forecast', { p_days: 30 }).catch(() => []), rpc('alerts').catch(() => []), rpc('visibility_gap', { p_months: 12 }).catch(() => []), D.summary().catch(() => [])]);
  const vgRows = vg.filter((r) => r.bucket && r.bucket !== 'Amazon (not itemized)'); const vgOut = vgRows.reduce((s, r) => s + Math.max(0, num(r.net)), 0);
  const out12 = sum.filter((r) => !r.partial).slice(-12).reduce((s, r) => s + num(r.spending), 0) + vgRows.filter((r) => catKind(r.category) === 'transfer').reduce((s, r) => s + Math.max(0, num(r.net)), 0);
  const byBucket = {}; vgRows.forEach((r) => { byBucket[r.bucket] = (byBucket[r.bucket] || 0) + num(r.net); });
  const low = fc.length ? fc.reduce((m, r) => (num(r.balance) < num(m.balance) ? r : m), fc[0]) : null;
  const n = nw[0] || {};
  const first = nwh[0], last = nwh[nwh.length - 1];
  const change = first && last && first !== last ? num(last.net_worth) - num(first.net_worth) : null;
  const thisM = iso(monthStart()); const prevM = iso(new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1));
  const cur = cf.find((r) => r.month === thisM) || {}, prev = cf.find((r) => r.month === prevM) || {};
  const due = acc.filter((a) => a.next_payment_due_date && d(a.next_payment_due_date) >= d(today())).sort((a, b) => a.next_payment_due_date < b.next_payment_due_date ? -1 : 1);
  const soon = rec.filter((r) => r.next_expected >= today() && d(r.next_expected) - d(today()) < 14 * 864e5);
  const topCats = spend.filter((r) => r.month === thisM).sort((a, b) => num(b.spent) - num(a.spent)).slice(0, 5);
  const needs = acc.filter((a) => a.connection_status !== 'ok');
  if (ls[0]) $('#synced').textContent = 'synced ' + relTime(ls[0].finished_at || ls[0].started_at);
  view.innerHTML = `
    <section class="hero">
      <span class="label">Net worth</span>
      <span class="big">${money(num(n.net_worth))}</span>
      <span class="muted small">${change == null ? 'first snapshot ' + (last ? fmtDay(last.as_of) : '') : `<span class="${change >= 0 ? 'up' : 'down'}">${signed(change)}</span> since ${fmtDay(first.as_of)}`}</span>
    </section>
    ${al.length ? `<div class="card"><div class="list">${al.map((x) => `<a class="item tap" href="${h(x.link)}"><span class="t"><span class="pill ${x.severity === 'bad' ? 'bad' : x.severity === 'warn' ? 'warn' : ''}">${x.severity === 'bad' ? 'action' : x.severity === 'warn' ? 'watch' : 'note'}</span> ${h(x.text)}</span><span class="a muted">›</span></a>`).join('')}</div></div>` : ''}
    ${needs.length && !al.length ? `<div class="card"><div class="row between"><span><span class="pill bad">reconnect</span> ${h(needs[0].institution_name)}${needs.length > 1 ? ' +' + (needs.length - 1) : ''}</span><a class="link" href="#accounts">Accounts</a></div></div>` : ''}
    <div class="grid2">
      <div class="card"><div class="row between"><h2>Assets</h2><span class="stat"><span class="v">${money(num(n.assets))}</span></span></div>
        <div class="row between"><h2>Liabilities</h2><span class="stat"><span class="v">${money(num(n.liabilities))}</span></span></div>
        ${nwh.length > 1 ? lineChart(nwh.map((r) => ({ t: r.as_of, v: num(r.net_worth) })), 640, 140) : '<p class="muted small">History accrues from daily snapshots.</p>'}
      </div>
      <div class="card">
        <div class="row between"><h2>Spending, month to date</h2><span class="stat"><span class="v">${money(num(cur.spending))}</span></span></div>
        <p class="muted small">${prev.spending ? 'prior month ' + money(num(prev.spending)) : 'no prior month'} · income MTD ${money(num(cur.income))}</p>
        <div class="list">${topCats.map((c) => `<div class="item tap" data-go="#activity/${encodeURIComponent(c.category)}"><span class="t">${h(c.category)}</span><span class="a">${money(num(c.spent))}</span></div>`).join('') || '<p class="empty">No spending recorded.</p>'}</div>
        <a class="link small" href="#insights">Cash flow</a>
      </div>
    </div>
    <div class="card">
      <div class="row between wrap"><h2>Upcoming</h2>${low ? `<a class="small ${num(low.balance) < 0 ? 'down' : num(low.balance) < 300 ? 'warn' : 'muted'}" href="#insights">projected cash minimum ${money(num(low.balance))}, ${fmtDay(low.as_of)}</a>` : ''}</div>
      <div class="list">
        ${due.map((a) => `<div class="item"><span class="t">${h(a.nickname || a.name)} payment</span><span class="a">${a.minimum_payment_amount ? money2(num(a.minimum_payment_amount)) + ' min' : ''}</span><span class="s">${fmtDayLong(a.next_payment_due_date)}${a.is_overdue ? ' · <span class="down">overdue</span>' : ''}</span></div>`).join('')}
        ${soon.map((r) => `<div class="item"><span class="t">${h(r.merchant)}</span><span class="a">${money2(num(r.typical_amount))}</span><span class="s">expected ${fmtDayLong(r.next_expected)} · ${h(r.cadence)}</span></div>`).join('')}
        ${!due.length && !soon.length ? '<p class="empty">Nothing due within 14 days.</p>' : ''}
      </div>
    </div>
    ${vgOut > 0 ? `<div class="card"><div class="row between wrap"><h2>Left linked accounts, not itemized</h2><span class="stat"><span class="v">${money(vgOut)}</span><span class="l">12 months${out12 > 0 ? ' · ' + fmtPct(100 * vgOut / out12) + ' of outflows' : ''}</span></span></div>
      <div class="list">${Object.entries(byBucket).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).map(([k, v]) => { const parts = vgRows.filter((r) => r.bucket === k); return `<div class="item"><span class="t">${h(k)}</span><span class="a">${money(v)}</span>${parts.length > 1 ? `<span class="s">${parts.map((r) => `${h(r.category)} ${money(num(r.net))}`).join(' · ')}</span>` : ''}</div>`; }).join('')}</div>
      <p class="muted small">Net of money that came back. Link the card or account to see what it bought.</p></div>` : ''}`;
  bindGo(view);
};

VIEWS.accounts = async (view) => {
  const [acc, cons] = await Promise.all([D.accounts(), D.connections()]);
  const byItem = {};
  for (const c of cons) byItem[c.item_id] = { c, accounts: [] };
  for (const a of acc) (byItem[a.item_id] || (byItem[a.item_id] = { c: { institution_name: a.institution_name, status: a.connection_status }, accounts: [] })).accounts.push(a);
  const groups = Object.values(byItem);
  const typeLabel = { depository: 'Cash', credit: 'Credit', loan: 'Loans', investment: 'Investments', other: 'Other' };
  const totals = {};
  for (const a of acc) if (!a.hidden) totals[a.type] = (totals[a.type] || 0) + num(a.current_balance);
  view.innerHTML = `
    <div class="row between wrap"><h1>Accounts</h1><button class="primary" id="btn-add">Add account</button></div>
    <div class="row wrap">${Object.entries(totals).map(([t, v]) => `<span class="stat"><span class="v">${money(v)}</span><span class="l">${typeLabel[t] || t}</span></span>`).join('<span style="width:14px"></span>')}</div>
    ${groups.map((g) => `
      <div class="card">
        <div class="row between wrap">
          <h2>${h(g.c.institution_name || 'Institution')}</h2>
          <span class="row">${g.c.status === 'ok' ? '<span class="pill ok">connected</span>' : g.c.status === 'needs_reauth' ? `<span class="pill bad">reconnect needed</span> <button class="quiet small" data-reauth="${h(g.c.item_id)}">Reconnect</button>` : `<span class="pill bad">error</span> <button class="quiet small" data-reauth="${h(g.c.item_id)}">Reconnect</button>`}
            ${g.c.item_id ? `<button class="quiet small danger" data-remove="${h(g.c.item_id)}" data-name="${h(g.c.institution_name)}">Remove</button>` : ''}</span>
        </div>
        ${g.c.last_synced_at ? `<p class="muted small">synced ${relTime(g.c.last_synced_at)}</p>` : ''}
        <div class="list">${g.accounts.map((a) => `
          <div class="item tap" data-acct="${h(a.account_id)}">
            <span class="t">${h(a.nickname || a.name)} ${a.mask ? '<span class="muted">···' + h(a.mask) + '</span>' : ''} ${a.hidden ? '<span class="pill">hidden</span>' : ''}</span>
            <span class="a">${money2(num(a.current_balance))}${a.credit_limit ? `<span class="s muted">of ${money(num(a.credit_limit))}</span>` : ''}</span>
            <span class="s">${h(a.subtype || a.type)}${a.owner ? ' · ' + h(a.owner) : ''}${a.vehicle && !['cash','taxable'].includes(a.vehicle) ? ' · ' + h(VEHICLES[a.vehicle] || a.vehicle) : ''}${a.interest_rate != null ? ' · ' + Number(a.interest_rate).toFixed(2) + '% APR' : ''}${a.next_payment_due_date ? ' · due ' + fmtDay(a.next_payment_due_date) : ''}</span>
          </div>`).join('')}</div>
      </div>`).join('') || '<div class="card"><p class="empty">No institutions linked.</p></div>'}`;
  $('#btn-add').onclick = () => openSheet(`
    <h2>Link an institution</h2>
    <p class="muted small">Authentication occurs on Plaid. Credentials are not stored here.</p>
    <div class="form">
      <button class="primary" data-link="bank">Bank or credit card</button>
      <button class="primary" data-link="brokerage">Brokerage or retirement account</button>
      <button class="primary" data-link="hsa">HSA (cash and investments)</button>
      <button class="primary" data-link="loan">Loan or mortgage</button>
      <p class="muted small">10 institution slots in total; removal does not release a slot.</p>
    </div>`);
  $('#sheet-body').onclick = async (e) => {
    const b = e.target.closest('[data-link]'); if (!b) return;
    b.disabled = true;
    try { const r = await portal('link', { kind: b.dataset.link }); location.href = r.url; }
    catch (err) { toast(err.message); b.disabled = false; }
  };
  view.onclick = async (e) => {
    const re = e.target.closest('[data-reauth]'); const rm = e.target.closest('[data-remove]'); const ac = e.target.closest('[data-acct]');
    if (re) { re.disabled = true; try { const r = await portal('reauth', { item_id: re.dataset.reauth }); location.href = r.url; } catch (err) { toast(err.message); re.disabled = false; } }
    else if (rm) openSheet(`<h2>Remove ${h(rm.dataset.name)}?</h2><p class="muted">Its accounts and transaction history will be deleted. The institution slot is not released.</p><div class="actions"><button class="quiet" data-cancel>Cancel</button><button class="primary danger" data-confirm>Remove</button></div>`),
      $('#sheet-body').onclick = async (ev) => { if (ev.target.closest('[data-cancel]')) closeSheet(); if (ev.target.closest('[data-confirm]')) { try { await portal('remove', { item_id: rm.dataset.remove }); closeSheet(); invalidate(); route(); toast('Removed.'); } catch (err) { toast(err.message); } } };
    else if (ac) {
      const a = acc.find((x) => x.account_id === ac.dataset.acct); const ppl = await people();
      openSheet(`<h2>${h(a.name)}</h2><div class="form">
        <label class="field">Nickname <input id="f-nick" type="text" value="${h(a.nickname || '')}" size="20" placeholder="${h(a.name)}"></label>
        <label class="field">Owner <select id="f-owner" style="width:auto"><option value="">—</option>${ppl.map((x) => `<option ${a.owner === x.name ? 'selected' : ''}>${h(x.name)}</option>`).join('')}<option ${a.owner === 'joint' ? 'selected' : ''}>joint</option></select></label>
        <label class="field">Vehicle <select id="f-veh" style="width:auto"><option value="">—</option>${Object.entries(VEHICLES).map(([k, v]) => `<option value="${k}" ${a.vehicle === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        <label class="check"><input id="f-hidden" type="checkbox" ${a.hidden ? 'checked' : ''}> Exclude from totals</label>
        <p class="muted small">${h(a.official_name || '')}${a.available_balance != null ? ' · available ' + money2(num(a.available_balance)) : ''}</p>
        <div class="actions"><button class="quiet" data-cancel>Cancel</button><button class="primary" data-save>Save</button></div></div>`);
      $('#sheet-body').onclick = async (ev) => {
        if (ev.target.closest('[data-cancel]')) closeSheet();
        if (ev.target.closest('[data-save]')) { try { await rpc('set_account', { p_account_id: a.account_id, p_nickname: $('#f-nick').value.trim() || null, p_hidden: $('#f-hidden').checked, p_owner: $('#f-owner').value || null, p_vehicle: $('#f-veh').value || null }); closeSheet(); invalidate(); route(); } catch (err) { toast(err.message); } }
      };
    }
  };
};

VIEWS.activity = async (view) => {
  const acc = await D.accounts();
  const preset = decodeURIComponent((location.hash.split('/')[1] || ''));
  const f = { search: '', account: '', category: preset, from: iso(new Date(Date.now() - 90 * 864e5)) };
  const accName = Object.fromEntries(acc.map((a) => [a.account_id, a.nickname || a.name]));
  view.innerHTML = `
    <h1>Activity</h1>
    <div class="toolbar">
      <input type="search" id="f-search" placeholder="Search" aria-label="Search">
      <select id="f-account" aria-label="Account"><option value="">All accounts</option>${acc.map((a) => `<option value="${h(a.account_id)}">${h(a.nickname || a.name)}</option>`).join('')}</select>
      <select id="f-cat" aria-label="Category"><option value="">All categories</option>${catOptions(preset)}</select>
      <select id="f-range" aria-label="Range"><option value="90">Last 90 days</option><option value="30">Last 30 days</option><option value="365">Last year</option><option value="">All</option></select>
      <button class="quiet small" id="f-export">CSV</button>
    </div>
    <div class="card"><div class="list" id="tx-list"></div></div>`;
  let timer;
  const load = async () => {
    const list = $('#tx-list'); list.innerHTML = '<p class="muted">Loading…</p>';
    const rows = await D.tx({ search: f.search, account: f.account, category: f.category, from: f.from, limit: 300 });
    if (!rows.length) { list.innerHTML = '<p class="empty">No transactions match.</p>'; return; }
    let out = '', day = '';
    for (const t of rows) {
      if (t.date !== day) { day = t.date; out += `<div class="day">${fmtDayLong(day)}</div>`; }
      const amt = num(t.amount);
      out += `<div class="item tap" data-tx="${h(t.transaction_id)}">
        <span class="t">${h(t.merchant_name || t.name)}${t.pending ? ' <span class="pill">pending</span>' : ''}${t.excluded ? ' <span class="pill">excluded</span>' : ''}${t.business ? ' <span class="pill">LLC</span>' : ''}</span>
        <span class="a ${amt < 0 ? 'up' : ''}">${amt < 0 ? '+' : ''}${money2(Math.abs(amt))}</span>
        <span class="s">${h(t.category || 'Uncategorized')}${t.is_transfer && catKind(t.category) !== 'transfer' ? ' · transfer' : ''} · ${h(accName[t.account_id] || '')}${t.notes ? ' · ' + h(t.notes) : ''}${t.category_source === 'plaid' ? ' · <span class="warn">unverified</span>' : ''}</span>
      </div>`;
    }
    list.innerHTML = out;
    list.onclick = (e) => { const el = e.target.closest('[data-tx]'); if (!el) return; editTx(rows.find((r) => r.transaction_id === el.dataset.tx), load); };
  };
  $('#f-search').oninput = (e) => { f.search = e.target.value.trim(); clearTimeout(timer); timer = setTimeout(load, 300); };
  $('#f-account').onchange = (e) => { f.account = e.target.value; load(); };
  $('#f-cat').onchange = (e) => { f.category = e.target.value; load(); };
  $('#f-range').onchange = (e) => { f.from = e.target.value ? iso(new Date(Date.now() - Number(e.target.value) * 864e5)) : ''; load(); };
  $('#f-export').onclick = async () => { const rows = await D.tx({ search: f.search, account: f.account, category: f.category, from: f.from, limit: 5000 }); if (!rows.length) return toast('No rows.'); csvDownload('transactions.csv', rows.map((t) => ({ date: t.date, merchant: t.merchant_name || t.name, description: t.name, amount: t.amount, category: t.category, account: accName[t.account_id] || t.account_id, transfer: t.is_transfer, business: t.business, notes: t.notes || '' }))); };
  await load();
};

function editTx(t, after) {
  openSheet(`<h2>${h(t.merchant_name || t.name)}</h2>
    <p class="muted small">${h(t.name)} · ${fmtDayLong(t.date)} · ${money2(num(t.amount))}</p>
    <div class="form">
      <label class="field">Category <select id="e-cat">${catOptions(t.category || 'Uncategorized')}</select></label>
      <label class="check"><input id="e-transfer" type="checkbox" ${t.is_transfer ? 'checked' : ''}> Transfer between own accounts</label>
      <label class="check"><input id="e-excl" type="checkbox" ${t.excluded ? 'checked' : ''}> Exclude from spending</label>
      <label class="check"><input id="e-biz" type="checkbox" ${t.business ? 'checked' : ''}> Business (LLC)</label>
      <label class="field">Note <input id="e-notes" type="text" value="${h(t.notes || '')}" size="24"></label>
      <label class="check"><input id="e-rule" type="checkbox"> Apply this category to all <b>${h(t.merchant_name || t.name)}</b> transactions</label>
      <div class="actions"><button class="quiet" data-cancel>Cancel</button><button class="primary" data-save>Save</button></div>
    </div>`);
  $('#sheet-body').onclick = async (e) => {
    if (e.target.closest('[data-cancel]')) closeSheet();
    if (e.target.closest('[data-save]')) {
      try {
        const cat = $('#e-cat').value, tr = $('#e-transfer').checked, ex = $('#e-excl').checked;
        await rpc('set_transaction', { p_id: t.transaction_id, p_category: cat, p_is_transfer: tr, p_excluded: ex, p_notes: $('#e-notes').value, p_business: $('#e-biz').checked });
        if ($('#e-rule').checked) await rpc('add_rule', { p_match: (t.raw && t.raw.merchant_name) || t.merchant_name || t.name, p_category: cat, p_is_transfer: tr, p_excluded: ex, p_business: $('#e-biz').checked });
        closeSheet(); invalidate(); after(); toast('Saved.');
      } catch (err) { toast(err.message); }
    }
  };
}

VIEWS.plan = async (view) => { location.hash = '#budget'; };

function subnav(items, on) { return `<div class="sub">${items.map(([k, l]) => `<a href="#${k}" class="${k === on ? 'on' : ''}">${l}</a>`).join('')}</div>`; }
const PLAN_NAV = [['budget', 'Budget'], ['recurring', 'Recurring'], ['goals', 'Goals'], ['debt', 'Debt'], ['future', 'Future'], ['home_purchase', 'Home'], ['business', 'LLC']];

VIEWS.budget = async (view) => {
  const [status, budgets, spend] = await Promise.all([D.budget(), D.budgets(), D.spend()]);
  const thisM = iso(monthStart());
  const rows = status.filter((r) => r.month === thisM);
  const budgeted = rows.reduce((s, r) => s + num(r.available), 0), spent = rows.reduce((s, r) => s + num(r.spent), 0);
  const unbudgeted = spend.filter((r) => r.month === thisM && !budgets.some((b) => b.category === r.category) && !['Income', 'Transfer', 'Credit card payment'].includes(r.category)).sort((a, b) => num(b.spent) - num(a.spent));
  const dayFrac = new Date().getDate() / new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
  view.innerHTML = `
    <h1>Plan</h1>${subnav(PLAN_NAV, 'budget')}
    <div class="card">
      <div class="row between wrap"><div><h2>${fmtMonth(thisM)}</h2><p class="muted small">${money(spent)} of ${money(budgeted)} · ${(dayFrac * 100).toFixed(0)}% of month elapsed</p></div><button class="primary" id="btn-budget">Add category</button></div>
      ${budgeted ? progress(spent, budgeted, spent > budgeted ? 'over' : spent / budgeted <= dayFrac ? 'ok' : '') : ''}
      <div class="list">${rows.sort((a, b) => num(b.available) - num(a.available)).map((r) => {
        const over = num(r.remaining) < 0;
        return `<div class="item tap" data-budget="${h(r.category)}">
          <span class="t">${h(r.category)}${r.rollover ? ' <span class="pill">rollover</span>' : ''}</span>
          <span class="a ${over ? 'down' : ''}">${over ? money(-num(r.remaining)) + ' over' : money(num(r.remaining)) + ' left'}</span>
          <span class="s">${money(num(r.spent))} of ${money(num(r.available))}</span>
          <span class="s" style="grid-column:1/-1">${progress(num(r.spent), num(r.available), over ? 'over' : '')}</span>
        </div>`; }).join('') || '<p class="empty">No budget set.</p>'}</div>
    </div>
    ${unbudgeted.length ? `<div class="card"><h2>Unbudgeted spending</h2><div class="list">${unbudgeted.map((r) => `<div class="item tap" data-budget="${h(r.category)}" data-amount="${num(r.spent).toFixed(0)}"><span class="t">${h(r.category)}</span><span class="a">${money(num(r.spent))}</span></div>`).join('')}</div></div>` : ''}`;
  const edit = (cat, amount, rollover, isNew) => {
    openSheet(`<h2>${isNew ? 'Add budget' : h(cat)}</h2><div class="form">
      ${isNew ? `<label class="field">Category <select id="b-cat">${catOptions(cat)}</select></label>` : ''}
      <label class="field">Monthly amount <input id="b-amt" class="short" type="number" inputmode="decimal" min="0" step="1" value="${amount || ''}"></label>
      <label class="check"><input id="b-roll" type="checkbox" ${rollover ? 'checked' : ''}> Roll over unspent balance</label>
      <div class="actions">${isNew ? '' : '<button class="quiet danger" data-del>Delete</button>'}<button class="quiet" data-cancel>Cancel</button><button class="primary" data-save>Save</button></div></div>`);
    $('#sheet-body').onclick = async (e) => {
      if (e.target.closest('[data-cancel]')) closeSheet();
      if (e.target.closest('[data-del]')) { try { await rpc('delete_budget', { p_category: cat }); closeSheet(); invalidate(); route(); } catch (err) { toast(err.message); } }
      if (e.target.closest('[data-save]')) { const c = isNew ? $('#b-cat').value : cat; const a = Number($('#b-amt').value); if (!(a >= 0)) return toast('Amount required.');
        try { await rpc('upsert_budget', { p_category: c, p_amount: a, p_rollover: $('#b-roll').checked }); closeSheet(); invalidate(); route(); } catch (err) { toast(err.message); } }
    };
  };
  $('#btn-budget').onclick = () => edit('Groceries', '', false, true);
  view.onclick = (e) => { const el = e.target.closest('[data-budget]'); if (!el) return; const b = budgets.find((x) => x.category === el.dataset.budget); if (b) edit(b.category, Number(b.amount), b.rollover, false); else edit(el.dataset.budget, el.dataset.amount || '', false, true); };
};

VIEWS.recurring = async (view) => {
  const [rec, acc] = await Promise.all([D.recurring(), D.accounts()]);
  const accName = Object.fromEntries(acc.map((a) => [a.account_id, a.nickname || a.name]));
  const monthly = rec.reduce((s, r) => s + num(r.last_amount) * ({ weekly: 4.33, 'every 2 weeks': 2.17, monthly: 1, 'every 2 months': 0.5, quarterly: 1 / 3, yearly: 1 / 12 }[r.cadence] || 0), 0);
  const up = rec.filter((r) => num(r.amount_change_pct) >= 5);
  view.innerHTML = `
    <h1>Plan</h1>${subnav(PLAN_NAV, 'recurring')}
    <div class="card">
      <div class="row between wrap"><h2>Recurring charges</h2><span class="stat"><span class="v">${money(monthly)}</span><span class="l">monthly equivalent</span></span></div>
      <p class="muted small">Detected from ≥3 occurrences at regular intervals with similar amounts.</p>
      ${up.length ? `<p class="warn small">${up.length} price increase${up.length > 1 ? 's' : ''}: ${up.map((r) => h(r.merchant) + ' ' + pct(num(r.amount_change_pct))).join(', ')}</p>` : ''}
      <div class="list">${rec.map((r) => `<div class="item tap" data-go="#activity"><span class="t">${h(r.merchant)}</span><span class="a">${money2(num(r.last_amount))}${num(r.amount_change_pct) >= 5 ? `<span class="s warn">was ${money2(num(r.typical_amount))}</span>` : ''}</span><span class="s">${h(r.cadence)} · next ${fmtDay(r.next_expected)} · ${h(accName[r.account_id] || '')} · ${r.occurrences}×</span></div>`).join('') || '<p class="empty">No recurring charges detected.</p>'}</div>
    </div>`;
  bindGo(view);
};

VIEWS.goals = async (view) => {
  const [goals, acc, cc, sum] = await Promise.all([D.goals(), D.accounts(), rpc('cushion_curve').catch(() => []), D.summary()]);
  const spend12 = sum.filter((r) => !r.partial).slice(-12).reduce((s, r, _, a) => s + num(r.spending) / a.length, 0);
  const cashIds = acc.filter((a) => a.type === 'depository' && !a.hidden).map((a) => a.account_id);
  const floor = Math.max(500, num((cc.find((r) => num(r.prevented_pct) >= 100) || {}).cushion) || 0);
  const has = (k) => goals.some((g) => g.name.toLowerCase().includes(k));
  const suggest = [
    !has('floor') && { name: 'Checking floor', kind: 'savings', target_amount: Math.round(floor / 50) * 50, account_ids: acc.filter((a) => a.subtype === 'checking').map((a) => a.account_id), target_date: iso(new Date(new Date().getFullYear(), new Date().getMonth() + 3, 1)), why: 'prevents 100% of observed overdrafts' },
    !has('reserve') && spend12 > 0 && { name: '6-month reserve', kind: 'savings', target_amount: Math.round(6 * spend12 / 100) * 100, account_ids: cashIds, target_date: '2028-07-01', why: '6 × mean monthly spending' },
    !has('down payment') && { name: 'Down payment', kind: 'savings', target_amount: 130000, account_ids: cashIds, target_date: '2028-09-01', why: '20% on $650,000; adjust under Plan › Home' },
  ].filter(Boolean);
  view.innerHTML = `
    <h1>Plan</h1>${subnav(PLAN_NAV, 'goals')}
    <div class="row between"><h2>Goals</h2><button class="primary" id="btn-goal">Add goal</button></div>
    ${suggest.length ? `<div class="card"><h3>Suggested</h3><div class="list">${suggest.map((s, i) => `<div class="item"><span class="t">${h(s.name)}</span><span class="a"><button class="quiet small" data-sug="${i}">Add</button></span><span class="s">${money(s.target_amount)} · ${h(s.why)}</span></div>`).join('')}</div></div>` : ''}
    <div class="grid2">${goals.map((g) => {
      const cur = num(g.current_amount), tgt = num(g.target_amount);
      const isCap = g.kind === 'spending_cap', isDebt = g.kind === 'debt_payoff';
      const p = isDebt ? (tgt ? Math.max(0, 1 - cur / tgt) : 0) : tgt ? cur / tgt : 0;
      const months = g.target_date ? Math.max(0, (d(g.target_date) - new Date()) / (30.4 * 864e5)) : null;
      const need = !isCap && tgt && months > 0 ? Math.max(0, (isDebt ? cur : tgt - cur) / months) : null;
      return `<div class="card tap" data-goal="${g.id}">
        <div class="row between"><h3>${h(g.name)}</h3><span class="pill">${g.status === 'paused' ? 'paused' : isCap ? 'spending cap' : isDebt ? 'payoff' : 'savings'}</span></div>
        ${progress(isCap ? cur : isDebt ? tgt - cur : cur, isCap || isDebt ? tgt : tgt, isCap && cur > tgt ? 'over' : p >= 1 ? 'ok' : '')}
        <p class="small">${isCap ? `${money(cur)} spent of ${money(tgt)} this month` : isDebt ? `${money(cur)} left of ${money(tgt)}` : `${money(cur)} of ${money(tgt)}`}${g.target_date ? ' · by ' + fmtDay(g.target_date) + ' ' + d(g.target_date).getFullYear() : ''}</p>
        ${need != null ? `<p class="muted small">required ${money(need)}/mo${g.monthly_amount ? ' · planned ' + money(num(g.monthly_amount)) : ''}</p>` : ''}
      </div>`; }).join('') || '<div class="card"><p class="empty">No goals.</p></div>'}</div>`;
  const edit = (g) => {
    const isNew = !g; g = g || { kind: 'savings', account_ids: [], status: 'active' };
    openSheet(`<h2>${isNew ? 'Add goal' : 'Edit goal'}</h2><div class="form">
      <label class="field">Name <input id="g-name" type="text" value="${h(g.name || '')}" size="24"></label>
      <label class="field">Kind <select id="g-kind"><option value="savings" ${g.kind === 'savings' ? 'selected' : ''}>Savings target</option><option value="debt_payoff" ${g.kind === 'debt_payoff' ? 'selected' : ''}>Debt payoff</option><option value="spending_cap" ${g.kind === 'spending_cap' ? 'selected' : ''}>Category spending cap</option></select></label>
      <label class="field">Target amount <input id="g-target" class="short" type="number" inputmode="decimal" min="0" value="${g.target_amount ?? ''}"></label>
      <label class="field">Target date <input id="g-date" type="date" value="${g.target_date || ''}" style="width:auto"></label>
      <label class="field">Planned contribution / mo <input id="g-monthly" class="short" type="number" inputmode="decimal" min="0" value="${g.monthly_amount ?? ''}"></label>
      <label class="field" id="g-cat-f">Category <select id="g-cat">${catOptions(g.category || 'Restaurants')}</select></label>
      <div class="field" id="g-acc-f">Accounts included ${acc.map((a) => `<label class="check"><input type="checkbox" data-acc="${h(a.account_id)}" ${(g.account_ids || []).includes(a.account_id) ? 'checked' : ''}> ${h(a.nickname || a.name)} <span class="muted">${money(num(a.current_balance))}</span></label>`).join('')}</div>
      <label class="check"><input id="g-paused" type="checkbox" ${g.status === 'paused' ? 'checked' : ''}> Paused</label>
      <div class="actions">${isNew ? '' : '<button class="quiet danger" data-del>Delete</button>'}<button class="quiet" data-cancel>Cancel</button><button class="primary" data-save>Save</button></div></div>`);
    const sync = () => { const k = $('#g-kind').value; $('#g-cat-f').hidden = k !== 'spending_cap'; $('#g-acc-f').hidden = k === 'spending_cap'; $('#g-date').parentElement.hidden = k === 'spending_cap'; };
    $('#g-kind').onchange = sync; sync();
    $('#sheet-body').onclick = async (e) => {
      if (e.target.closest('[data-cancel]')) closeSheet();
      if (e.target.closest('[data-del]')) { try { await rpc('delete_goal', { p_id: g.id }); closeSheet(); invalidate(); route(); } catch (err) { toast(err.message); } }
      if (e.target.closest('[data-save]')) {
        const p = { id: g.id, name: $('#g-name').value.trim(), kind: $('#g-kind').value, target_amount: Number($('#g-target').value) || null, target_date: $('#g-date').value || null,
          monthly_amount: Number($('#g-monthly').value) || null, category: $('#g-cat').value, account_ids: $$('[data-acc]:checked').map((x) => x.dataset.acc), status: $('#g-paused').checked ? 'paused' : 'active' };
        if (!p.name) return toast('Name required.');
        try { await rpc('upsert_goal', { p }); closeSheet(); invalidate(); route(); } catch (err) { toast(err.message); }
      }
    };
  };
  $('#btn-goal').onclick = () => edit(null);
  view.addEventListener('click', async (e) => { const b = e.target.closest('[data-sug]'); if (!b) return; const s = suggest[Number(b.dataset.sug)]; try { await rpc('upsert_goal', { p: { name: s.name, kind: s.kind, target_amount: s.target_amount, target_date: s.target_date, account_ids: s.account_ids, status: 'active' } }); invalidate(); route(); } catch (err) { toast(err.message); } });
  for (const g of goals.filter((x) => x.kind !== 'spending_cap' && x.target_date && x.status !== 'paused')) {
    rpc('goal_odds', { p_goal_id: g.id }).then((o) => { const r = o && o[0]; const el = $(`[data-goal="${g.id}"]`); if (!r || !el) return;
      el.insertAdjacentHTML('beforeend', `<p class="small"><b class="${num(r.p_hit) >= 70 ? 'up' : num(r.p_hit) >= 40 ? 'warn' : 'down'}">${Number(r.p_hit).toFixed(0)}% probability</b> by target date (bootstrap on trailing 12 months) · required ${money(num(r.needed_per_month))}/mo vs median net cash flow ${money(num(r.median_saving))}/mo · 10th–90th percentile outcome ${money(num(r.p10_end))}–${money(num(r.p90_end))}</p>`); }).catch(() => {});
  }
  view.onclick = (e) => { const el = e.target.closest('[data-goal]'); if (el) edit(goals.find((x) => String(x.id) === el.dataset.goal)); };
};

VIEWS.settings = async (view) => {
  const [{ data: pk }, rules, ls, ppl] = await Promise.all([sb.auth.passkey.list().catch(() => ({ data: [] })), D.rules(), D.lastSync(), people()]);
  const keys = (pk && (pk.passkeys || pk)) || [];
  view.innerHTML = `
    <h1>Settings</h1>
    <div class="card"><h2>Signed in as ${h(state.me.display_name || '')}</h2>
      <p class="muted small">Auto-lock after 5 minutes idle or backgrounded.</p>
      <div class="row wrap"><button class="quiet" id="btn-sync">Sync now</button><button class="quiet" id="btn-signout">Sign out</button><button class="quiet" id="btn-signout-all">Sign out everywhere</button></div>
      <p class="muted small">${ls[0] ? `Last sync ${relTime(ls[0].finished_at || ls[0].started_at)} · ${h(ls[0].status)} · ${ls[0].tx_added} new · scheduled daily` : ''}</p>
    </div>
    <div class="card"><div class="row between wrap"><h2>Passkeys</h2><span class="row"><button class="quiet" id="btn-addkey">Add this device</button><button class="quiet" id="btn-approve">Approve another device</button></span></div>
      <p class="muted small">New passkeys are accepted for 10 minutes after approval.</p>
      <p id="approve-msg" class="small up" hidden></p>
      <div class="list">${(Array.isArray(keys) ? keys : []).map((k) => `<div class="item"><span class="t">${h(k.friendly_name || k.friendlyName || 'Passkey')}</span><span class="a"><button class="quiet small danger" data-delkey="${h(k.id)}">Remove</button></span><span class="s">added ${k.created_at ? fmtDay(k.created_at) : ''}${k.last_used_at ? ' · last used ' + fmtDay(k.last_used_at) : ''}</span></div>`).join('') || '<p class="empty">No passkeys.</p>'}</div>
    </div>
    <div class="card"><div class="row between"><h2>Household</h2><button class="quiet small" id="btn-people">Edit</button></div>
      <p class="muted small">${ppl.map((x) => h(x.name) + (x.child ? ' (child)' : '')).join(' · ')}</p></div>
    <div class="card"><h2>Category rules</h2><p class="muted small">Applied where the description contains the match text.</p>
      <div class="list">${rules.map((r) => `<div class="item"><span class="t">“${h(r.match)}” → ${h(r.category)}${r.is_transfer ? ' (transfer)' : ''}${r.excluded ? ' (excluded)' : ''}</span><span class="a"><button class="quiet small danger" data-delrule="${r.id}">Remove</button></span></div>`).join('') || '<p class="empty">No rules.</p>'}</div>
    </div>`;
  $('#btn-people').onclick = () => {
    openSheet(`<h2>Household</h2><p class="muted small">One per line; append (child) for a child.</p><div class="form"><textarea id="hh" rows="5" style="width:100%">${ppl.map((x) => h(x.name) + (x.child ? ' (child)' : '')).join('\n')}</textarea>
      <div class="actions"><button class="quiet" data-cancel>Cancel</button><button class="primary" data-save>Save</button></div></div>`);
    $('#sheet-body').onclick = async (e) => {
      if (e.target.closest('[data-cancel]')) closeSheet();
      if (e.target.closest('[data-save]')) { const list = $('#hh').value.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => ({ name: l.replace(/\s*\(child\)\s*$/i, ''), child: /\(child\)\s*$/i.test(l) })); try { await rpc('set_setting', { p_key: 'household', p_value: { people: list } }); closeSheet(); invalidate(); route(); } catch (err) { toast(err.message); } }
    };
  };
  $('#btn-sync').onclick = async (e) => { e.target.disabled = true; try { await portal('sync'); toast('Sync started.'); setTimeout(() => { invalidate(); route(); }, 45000); } catch (err) { toast(err.message); e.target.disabled = false; } };
  $('#btn-signout').onclick = async () => { await sb.auth.signOut({ scope: 'local' }); state.cache = {}; gate(); };
  $('#btn-signout-all').onclick = async () => { await sb.auth.signOut({ scope: 'global' }); state.cache = {}; gate('All sessions ended.'); };
  $('#btn-approve').onclick = async (e) => { e.target.disabled = true; try { await rpc('open_passkey_window'); const m = $('#approve-msg'); m.textContent = 'Approved for 10 minutes. On the new device: Register a new device.'; m.hidden = false; } catch (err) { toast(err.message); } finally { e.target.disabled = false; } };
  $('#btn-addkey').onclick = async (e) => { e.target.disabled = true; try { await rpc('open_passkey_window'); const { data: reg, error } = await sb.auth.registerPasskey(); if (error) throw error; await nameKey(reg, prompt('Name this device', 'New device') || 'New device'); toast('Passkey registered.'); route(); } catch (err) { toast(err.message); e.target.disabled = false; } };
  view.onclick = async (e) => {
    const dk = e.target.closest('[data-delkey]'), dr = e.target.closest('[data-delrule]');
    if (dk) { if (keys.length <= 1) return toast('At least one passkey is required.'); try { const { error } = await sb.auth.passkey.delete({ passkeyId: dk.dataset.delkey }); if (error) throw error; route(); } catch (err) { toast(err.message); } }
    if (dr) { try { await rpc('delete_rule', { p_id: Number(dr.dataset.delrule) }); invalidate(); route(); } catch (err) { toast(err.message); } }
  };
};

// ---------- Insights ----------
// Each card states a conclusion computed from the data, then the chart that supports it.
const INS_NAV = [['insights', 'Overview'], ['spending', 'Spending'], ['cash', 'Cash'], ['habits', 'Habits'], ['income', 'Income'], ['review', 'Review']];
const fmtPct = (n, d = 0) => n == null || isNaN(n) ? '—' : Number(n).toFixed(d) + '%';
const dayOfMonth = new Date().getDate();
const finding = (title, sub, body, note) => `<div class="card finding"><h2>${title}</h2>${sub ? `<p class="muted small">${sub}</p>` : ''}${body}${note ? `<p class="small note">${note}</p>` : ''}</div>`;
const yMoney = (v, ax) => ax ? short(v) : money(v);
const yMoney2 = (v, ax) => ax ? short(v) : money2(v);
const dShort = (iso0) => d(iso0).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const dLong = (iso0) => d(iso0).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const isOverdraft = (e) => e.kind === 'fee' && /overdraft/i.test(e.label) && num(e.amount) < 0;
const isWaiver = (e) => e.kind === 'fee' && num(e.amount) > 0;
const mainPayer = (ev) => { const by = {}; ev.filter((e) => e.kind === 'income').forEach((e) => { by[e.label] = (by[e.label] || 0) + num(e.amount); }); return Object.entries(by).sort((a, b) => b[1] - a[1])[0]?.[0]; };

VIEWS.insights = async (view) => {
  const y0 = iso(new Date(Date.now() - 365 * 864e5));
  const [liq, flow, hw, ev, bc, cc] = await Promise.all([rpc('liquid_daily', { p_days: 365 }), rpc('monthly_flow', { p_months: 13 }), rpc('habit_weekly', { p_weeks: 52 }),
    rpc('money_events', { p_days: 400 }), rpc('spend_breakdown', { p_from: y0, p_to: today(), p_by: 'category' }), rpc('cushion_curve').catch(() => [])]);
  const cards = [];

  // 1. Liquid position
  if (liq.length > 30) {
    const L = liq.map((r) => num(r.liquid)), f = ols(L), perMo = f.b * 30.44;
    const end = L[L.length - 1], a30 = mean(L.slice(0, 30)), b30 = mean(L.slice(-30));
    const iMax = L.indexOf(Math.max(...L)), iMin = L.indexOf(Math.min(...L));
    const verdict = Math.abs(b30 - a30) < 500 ? 'no lasting gain in 12 months' : b30 > a30 ? `up ${money(b30 - a30)} in 12 months` : `down ${money(a30 - b30)} in 12 months`;
    cards.push(finding(`Cash minus card debt: ${money(end)} today, ${verdict}`,
      `Checking + savings − card balance, end of each day. 30-day average ${money(b30)} now vs ${money(a30)} a year ago; fitted trend ${signed(perMo)}/month. High ${money(L[iMax])} on ${dLong(liq[iMax].as_of)}; low ${money(L[iMin])} on ${dLong(liq[iMin].as_of)}.`,
      ix({ type: 'xy', height: 220, yfmt: yMoney, shadeBelow: 0, series: [
        { name: 'Cash minus card debt', data: liq.map((r) => [mx(r.as_of), num(r.liquid)]), kind: 'area', color: C.blue },
        { name: 'Trend', data: liq.map((r, i) => [mx(r.as_of), f.a + f.b * i]), color: C.gray, dash: true, width: 1.5 },
        { name: 'Checking', data: liq.map((r) => [mx(r.as_of), num(r.checking)]), color: C.teal, width: 1.2, hidden: true },
        { name: 'Savings', data: liq.map((r) => [mx(r.as_of), num(r.savings)]), color: C.green, width: 1.2, hidden: true },
        { name: 'Card balance', data: liq.map((r) => [mx(r.as_of), num(r.cards)]), color: C.red, width: 1.2, hidden: true }] }),
      `${perMo > 50 ? `At ${signed(perMo)}/month a $10,000 reserve is ${(Math.max(0, 10000 - end) / perMo / 12).toFixed(1)} years away.` : b30 - a30 >= 500 ? 'The recent rise is from the last few paychecks; the 12-month trend is still flat, so no reserve is building yet.' : 'Money comes in and goes back out each pay cycle; no reserve is building.'} Drag across the chart to zoom; click legend items to add checking, savings or card balance.`));
  }

  // 2. Money in vs money out
  const full = flow.filter((r) => !r.partial).slice(-12);
  if (full.length) {
    const inc = full.map((r) => num(r.income)), sp = full.map((r) => num(r.spending)), so = full.map((r) => Math.max(0, num(r.sent_out)));
    const out = sp.map((v, i) => v + so[i]), net = inc.map((v, i) => v - out[i]);
    const over = net.filter((v) => v < 0).length, gap = mean(out) - mean(inc);
    cards.push(finding(`Money out exceeded money in during ${over} of the last ${full.length} months`,
      `Average in ${money(mean(inc))}/month. Average out ${money(mean(out))}: ${money(mean(sp))} spending + ${money(mean(so))} sent to people (Zelle to Begum, Revolut, Apple Cash). Card payments and moves between your own accounts are excluded.`,
      ix({ type: 'cbar', height: 230, yfmt: yMoney, stackTotal: false, cats: full.map((r) => monLabel(r.month)), tipCats: full.map((r) => monLong(r.month)),
        series: [{ name: 'Income', vals: inc, color: C.green, stack: 'in' }, { name: 'Spending', vals: sp, color: C.blue, stack: 'out' }, { name: 'Sent to people', vals: so, color: C.amber, stack: 'out' }, { name: 'Net', vals: net, kind: 'line', color: C.violet }],
        tip: (i) => `<div class="r tot"><span>Out total</span><b>${money(out[i])}</b></div>`,
        onClick: (i) => { localStorage.setItem('sp_period', 'm:' + full[i].month); location.hash = '#spending'; } }),
      gap > 0 ? `Average shortfall ${money(gap)}/month, covered by refunds, one-off deposits and savings drawdowns. Click a month to open its spending.` : `Average surplus ${money(-gap)}/month. Click a month to open its spending.`));
  }

  // 3. Composition
  if (full.length) {
    const tot = {}; full.forEach((r) => Object.entries(r.by_group || {}).forEach(([g, v]) => { tot[g] = (tot[g] || 0) + num(v); }));
    const groups = Object.entries(tot).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
    const top = groups.slice(0, 7).map(([g]) => g), incAvg = mean(full.map((r) => num(r.income)));
    const cat = (k) => num((bc.find((r) => r.key === k) || {}).total);
    const deliv = cat('Food delivery') / 12, groc = cat('Groceries') / 12, amz = cat('Amazon') / 12;
    const [g1, v1] = groups[0] || ['—', 0];
    cards.push(finding(`${g1} takes ${fmtPct(100 * v1 / 12 / incAvg)} of income (${money(v1 / 12)}/month)`,
      `Food delivery ${money(deliv)}/month vs groceries ${money(groc)}/month (${groc ? (deliv / groc).toFixed(1) + '×' : '—'}). Amazon ${money(amz)}/month. Trailing 12 months.`,
      ix({ type: 'cbar', height: 230, yfmt: yMoney, stackTotal: true, cats: full.map((r) => monLabel(r.month)), tipCats: full.map((r) => monLong(r.month)),
        series: [...top.map((g, i) => ({ name: g, vals: full.map((r) => num((r.by_group || {})[g])), stack: 's', color: PAL[i] })),
          { name: 'Other', vals: full.map((r) => Object.entries(r.by_group || {}).filter(([g]) => !top.includes(g)).reduce((a, [, v]) => a + num(v), 0)), stack: 's', color: '#b8bec8' }],
        onClick: (i) => { localStorage.setItem('sp_period', 'm:' + full[i].month); location.hash = '#spending'; } }),
      `Halving delivery orders frees about ${money(deliv / 2)}/month. Click legend items to isolate a group; click a month to drill in.`));
  }

  // 4. Checking buffer
  if (liq.length > 30) {
    const ch = liq.map((r) => num(r.checking)), neg = ch.filter((v) => v < 0).length, low = ch.filter((v) => v < 300).length;
    const od = ev.filter((e) => isOverdraft(e) && e.date >= liq[0].as_of), waived = ev.filter((e) => isWaiver(e) && /overdraft/i.test(e.label) && e.date >= liq[0].as_of);
    const net = sum(od.map((e) => -num(e.amount))) - sum(waived.map((e) => num(e.amount)));
    const full100 = (cc || []).find((r) => num(r.prevented_pct) >= 100);
    const chAt = Object.fromEntries(liq.map((r) => [r.as_of, num(r.checking)]));
    cards.push(finding(`Checking was negative on ${neg} days and under $300 on ${low} of the last ${liq.length}`,
      `${od.length} overdraft fees (${money(sum(od.map((e) => -num(e.amount))))}), ${waived.length} waived; net cost ${money(net)}. Median end-of-day balance ${money(quantile(ch, 0.5))}.`,
      ix({ type: 'xy', height: 210, yfmt: yMoney, shadeBelow: 0, refs: [{ y: 300, label: '$300' }],
        series: [{ name: 'Checking', data: liq.map((r) => [mx(r.as_of), num(r.checking)]), color: C.blue, kind: 'area' }],
        marks: od.map((e) => ({ x: mx(e.date), y: chAt[e.date] ?? 0, label: `Overdraft fee ${money(-num(e.amount))}`, color: C.red })) }),
      full100 ? `A standing balance of ${money(num(full100.cushion))} would have prevented every overdraft in the period. Red dots are fees.` : 'Red dots are overdraft fees.'));
  }

  // 5. Purchase frequency
  const wk = hw.slice(0, -1);
  if (wk.length >= 16) {
    const a = wk.slice(0, 8), b = wk.slice(-8), avg = (rows, k) => mean(rows.map((r) => num(r[k])));
    const drivers = [['delivery_n', 'delivery'], ['amazon_n', 'Amazon'], ['cafeteria_n', 'cafeteria']].map(([k, l]) => [l, avg(b, k) - avg(a, k)]).sort((x, y) => y[1] - x[1]);
    const P = wk.map((r) => num(r.purchases_n));
    cards.push(finding(`${avg(b, 'purchases_n').toFixed(0)} purchases a week now, vs ${avg(a, 'purchases_n').toFixed(0)} a year ago`,
      `Last 8 weeks vs first 8 weeks of the year. Average ticket ${money2(avg(b, 'purchases_amt') / Math.max(1, avg(b, 'purchases_n')))} now vs ${money2(avg(a, 'purchases_amt') / Math.max(1, avg(a, 'purchases_n')))}.`,
      ix({ type: 'xy', height: 210, yfmt: (v) => Math.round(v), zoom: true, series: [
        { name: 'Purchases', data: wk.map((r) => [mx(r.week), num(r.purchases_n)]), kind: 'bar', color: '#b8c4e6' },
        { name: '8-week average', data: wk.map((r, i) => [mx(r.week), movAvg(P, 8)[i]]), color: C.blue, fmt: (v) => v.toFixed(1) },
        { name: 'Delivery orders', data: wk.map((r) => [mx(r.week), num(r.delivery_n)]), color: C.amber, width: 1.5 },
        { name: 'Amazon orders', data: wk.map((r) => [mx(r.week), num(r.amazon_n)]), color: C.teal, width: 1.5 },
        { name: 'Cafeteria', data: wk.map((r) => [mx(r.week), num(r.cafeteria_n)]), color: C.gray, width: 1.2, hidden: true }],
        xfmt: (t) => 'Week of ' + dLong(iso(new Date(t))) }),
      `Largest change: ${drivers[0][0]} (${drivers[0][1] >= 0 ? '+' : ''}${drivers[0][1].toFixed(1)} a week).`));
  }

  // 6. Pay
  const payer = mainPayer(ev.filter((e) => e.date >= iso(new Date(Date.now() - 200 * 864e5))));
  const pays = ev.filter((e) => e.kind === 'income' && e.label === payer);
  if (pays.length > 4) {
    const last = num(pays[pays.length - 1].amount), yrAgo = pays.filter((e) => e.date <= iso(new Date(Date.now() - 365 * 864e5))).slice(-1)[0] || pays[0];
    // a level is a paycheck amount repeated on the next check; a change is a new level
    const changes = []; let level = null;
    for (let i = 0; i < pays.length - 1; i++) { const b0 = num(pays[i].amount), c0 = num(pays[i + 1].amount);
      if (Math.abs(c0 - b0) < 40) { if (level != null && Math.abs(b0 - level) > 40) changes.push(`${dLong(pays[i].date)} ${signed(b0 - level)}`); level = b0; } }
    const others = ev.filter((e) => e.kind === 'income' && e.label !== payer);
    cards.push(finding(`Net pay ${money2(last)} per check, ${signed(last - num(yrAgo.amount))} vs ${dLong(yrAgo.date)}`,
      `${titleCase(payer)}. Lasting changes in take-home: ${changes.slice(-5).join(' · ') || 'none'}. Single-check spikes are bonuses, retro pay or adjustments.`,
      ix({ type: 'xy', height: 200, yfmt: yMoney2, series: [
        { name: titleCase(payer), data: pays.map((e) => [mx(e.date), num(e.amount)]), kind: 'step', color: C.green },
        { name: 'Other deposits', data: others.map((e) => [mx(e.date), num(e.amount)]), kind: 'dots', color: C.amber }],
        extra: (x) => { const o = others.filter((e) => mx(e.date) === x); return o.map((e) => `<div class="r"><span>${h(titleCase(e.label))}</span><b>${money2(num(e.amount))}</b></div>`).join(''); } }), ''));
  }
  view.innerHTML = `<h1>Insights</h1>${subnav(INS_NAV, 'insights')}${cards.join('') || '<div class="card"><p class="empty">Not enough history yet.</p></div>'}`;
};

// ---------- Insights › Spending: drill-down ----------
function periodRange(k) { const t = new Date(), y = t.getFullYear(), mo = t.getMonth();
  if (k && k.startsWith('m:')) { const a = d(k.slice(2)); return [iso(a), iso(new Date(a.getFullYear(), a.getMonth() + 1, 0))]; }
  if (k === 'mtd') return [iso(new Date(y, mo, 1)), today()]; if (k === 'prev') return [iso(new Date(y, mo - 1, 1)), iso(new Date(y, mo, 0))];
  if (k === 'ytd') return [`${y}-01-01`, today()]; return [iso(new Date(Date.now() - Number(k || 90) * 864e5)), today()]; }
const PERIODS = [['mtd', 'This month'], ['prev', 'Last month'], ['90', 'Last 90 days'], ['ytd', 'Year to date'], ['365', 'Last 12 months']];
VIEWS.spending = async (view) => {
  let period = localStorage.getItem('sp_period') || '90';
  const path = []; // [group] or [group, category]
  const monthly = await rpc('spend_monthly', { p_months: 13 });
  const months = [...new Set(monthly.map((r) => r.month))].sort();
  const periodOpts = [...PERIODS, ...months.slice().reverse().map((m) => ['m:' + m, monLong(m)])];
  view.innerHTML = `<h1>Insights</h1>${subnav(INS_NAV, 'spending')}
    <div class="card"><div class="row between wrap"><div class="crumbs" id="sp-crumbs"></div><select id="sp-period" aria-label="Period">${periodOpts.map(([k, l]) => `<option value="${k}" ${k === period ? 'selected' : ''}>${h(l)}</option>`).join('')}</select></div>
      <div id="sp-head"></div><div class="grid2"><div id="sp-donut"></div><div id="sp-merch"></div></div></div>
    <div class="card" id="sp-trend"></div>`;
  let cur = [], prev = [];
  const load = async () => {
    const [a, b] = periodRange(period), days = Math.round((d(b) - d(a)) / 864e5) + 1;
    const pa = iso(new Date(d(a).getTime() - days * 864e5)), pb = iso(new Date(d(a).getTime() - 864e5));
    [cur, prev] = await Promise.all([rpc('spend_rows', { p_from: a, p_to: b }), rpc('spend_rows', { p_from: pa, p_to: pb })]);
    draw();
  };
  const inSel = (r) => (!path[0] || r.grp === path[0]) && (!path[1] || r.category === path[1]);
  const keyOf = (r) => !path[0] ? r.grp : !path[1] ? r.category : r.merchant;
  const agg = (rows, kf) => { const o = {}; rows.forEach((r) => { const k = kf(r); o[k] = o[k] || { v: 0, n: 0 }; o[k].v += num(r.total); o[k].n += r.n; }); return o; };
  const draw = () => {
    const [a, b] = periodRange(period), days = Math.round((d(b) - d(a)) / 864e5) + 1;
    const sel = cur.filter(inSel), selP = prev.filter(inSel), all = sum(cur.map((r) => num(r.total)));
    const tot = sum(sel.map((r) => num(r.total))), totP = sum(selP.map((r) => num(r.total))), n = sum(sel.map((r) => r.n));
    const label = path[path.length - 1] || 'All spending';
    $('#sp-crumbs').innerHTML = [['All spending', 0], ...path.map((p0, i) => [p0, i + 1])].map(([l, i], j, arr) => j === arr.length - 1 ? `<b>${h(l)}</b>` : `<a href="#" data-up="${i}">${h(l)}</a> ›`).join(' ');
    $$('#sp-crumbs [data-up]').forEach((x) => x.onclick = (e) => { e.preventDefault(); path.length = +x.dataset.up; draw(); });
    $('#sp-head').innerHTML = `<h2 class="headline">${h(label)}: ${money(tot)} ${totP > 0 ? `<span class="${tot > totP ? 'warn' : 'up'}">${pct(100 * (tot - totP) / totP)}</span>` : ''}</h2>
      <p class="muted small">${dShort(a)} – ${dShort(b)} · ${n} purchases · ${money(tot / days * 30.44)} per 30 days${path.length ? ` · ${fmtPct(100 * tot / all, 1)} of all spending` : ''}${totP > 0 ? ` · prior ${days} days ${money(totP)}` : ''}</p>`;
    const kids = agg(sel, keyOf), kidsP = agg(selP, keyOf);
    const items = Object.entries(kids).filter(([, v]) => v.v > 0).sort((x, y) => y[1].v - x[1].v);
    const top = items.slice(0, 10), rest = items.slice(10);
    const donutItems = [...top.map(([k, v]) => ({ k, v: v.v, sub: `${v.n} purchases · prior ${money((kidsP[k] || {}).v || 0)}` })), ...(rest.length ? [{ k: `Other (${rest.length})`, v: sum(rest.map(([, v]) => v.v)), color: '#b8bec8' }] : [])];
    $('#sp-donut').innerHTML = `<h3>${path.length === 0 ? 'By group' : path.length === 1 ? 'By category' : 'By merchant'}</h3>` + ix({ type: 'donut', items: donutItems, label: label.length > 14 ? '' : label.toLowerCase(),
      onClick: path.length < 2 ? (k) => { if (k.startsWith('Other (')) return; path.push(k); draw(); } : undefined });
    const merch = agg(sel, (r) => r.merchant), merchP = agg(selP, (r) => r.merchant);
    const mItems = Object.entries(merch).filter(([, v]) => v.v > 0).sort((x, y) => y[1].v - x[1].v).slice(0, 12)
      .map(([k, v]) => ({ k, v: v.v, prev: (merchP[k] || {}).v || 0, sub: `${v.n} purchases · ${money2(v.v / Math.max(1, v.n))} average` }));
    $('#sp-merch').innerHTML = `<h3>Top merchants</h3>` + ix({ type: 'hbar', items: mItems, onClick: (k) => { location.hash = '#activity'; setTimeout(() => { const s = $('#f-search'); if (s) { s.value = k; s.dispatchEvent(new Event('input')); } }, 400); } });
    // 12-month trend for the selection
    const full = months.filter((m) => m < iso(monthStart()));
    const byM = full.map((m) => sum(monthly.filter((r) => r.month === m && inSel({ grp: r.grp, category: r.category })).map((r) => num(r.total))));
    const nM = full.map((m) => sum(monthly.filter((r) => r.month === m && inSel({ grp: r.grp, category: r.category })).map((r) => r.n)));
    const f = ols(byM), avg = mean(byM);
    $('#sp-trend').innerHTML = `<h2>${h(label)} by month: ${money(avg)} average, trend ${signed(f.b)}/month</h2>
      <p class="muted small">Complete months. Line is the fitted trend; dashed reference is the 12-month average. Click a month to open it.</p>` +
      ix({ type: 'cbar', height: 200, yfmt: yMoney, cats: full.map(monLabel), tipCats: full.map(monLong), refs: [{ y: avg, label: 'average' }],
        series: [{ name: label, vals: byM, color: C.blue }, { name: 'Trend', vals: byM.map((_, i) => f.a + f.b * i), kind: 'line', color: C.gray, dash: true }],
        tip: (i) => `<div class="r"><span>Purchases</span><b>${nM[i]}</b></div>`, legend: false,
        onClick: (i) => { period = 'm:' + full[i]; localStorage.setItem('sp_period', period); const s = $('#sp-period'); if (s) s.value = period; load(); } });
  };
  $('#sp-period').onchange = (e) => { period = e.target.value; localStorage.setItem('sp_period', period); load(); };
  await load();
};

// ---------- Insights › Cash ----------
VIEWS.cash = async (view) => {
  const [fc, pc, cc, liq, ev, acc] = await Promise.all([rpc('cash_forecast', { p_days: 45 }), rpc('paycycle_profile').catch(() => []), rpc('cushion_curve').catch(() => []),
    rpc('liquid_daily', { p_days: 365 }), rpc('money_events', { p_days: 400 }), D.accounts()]);
  const cards = [];
  if (fc.length) {
    const low = fc.reduce((m0, r) => (num(r.balance) < num(m0.balance) ? r : m0), fc[0]);
    const evDays = fc.filter((r) => r.events && r.events.length);
    cards.push(finding(`Lowest projected cash in the next 45 days: ${money(num(low.balance))} on ${dShort(low.as_of)}`,
      'Scheduled paychecks and recurring charges on their expected dates, card minimums on due dates, plus your trailing-90-day average daily discretionary spend.',
      ix({ type: 'xy', height: 210, yfmt: yMoney, shadeBelow: 0, series: [{ name: 'Projected cash', data: fc.map((r) => [mx(r.as_of), num(r.balance)]), kind: 'area', color: C.blue }],
        marks: evDays.map((r) => ({ x: mx(r.as_of), y: num(r.balance), color: num(r.inflow) > num(r.outflow) ? C.green : C.amber })),
        extra: (x) => { const r = fc.find((q) => mx(q.as_of) === x); if (!r) return ''; return `<div class="r"><span>In</span><b>${money(num(r.inflow))}</b></div><div class="r"><span>Out</span><b>${money(num(r.outflow))}</b></div>${(r.events || []).map((e) => `<div class="r"><span>${h(e)}</span></div>`).join('')}`; } }),
      'Green dots are expected deposits; amber dots are scheduled charges. Hover a dot for the line items.'));
  }
  if (pc.length) {
    const minDay = pc.reduce((m0, r) => (num(r.median_balance) < num(m0.median_balance) ? r : m0), pc[0]);
    const negDays = pc.filter((r) => num(r.pct_days_negative) > 0);
    cards.push(finding(`Checking bottoms out ${minDay.day_in_cycle} days after payday, at a median ${money(num(minDay.median_balance))}`,
      `${pc[0].cycle_days}-day pay cycle (${titleCase(pc[0].source)}). Band is the 10th–90th percentile of end-of-day balance; the red line (right axis) is the share of cycles in which the balance was negative on that day.`,
      ix({ type: 'xy', x: 'num', height: 220, yfmt: yMoney, y2fmt: (v) => Math.round(v) + '%', shadeBelow: 0, xfmt: (x) => `Day ${x} after payday`, xtick: (x) => 'd' + x, xticks: pc.map((r) => r.day_in_cycle),
        band: { lo: pc.map((r) => [r.day_in_cycle, num(r.p10_balance)]), hi: pc.map((r) => [r.day_in_cycle, num(r.p90_balance)]), name: '10th–90th percentile', color: C.blue },
        series: [{ name: 'Median balance', data: pc.map((r) => [r.day_in_cycle, num(r.median_balance)]), color: C.blue },
          { name: 'Share of days negative', data: pc.map((r) => [r.day_in_cycle, num(r.pct_days_negative)]), color: C.red, axis: 'right', kind: 'line', width: 1.5, fmt: (v) => v.toFixed(0) + '%' },
          { name: 'Spend per day', data: pc.map((r) => [r.day_in_cycle, num(r.spend_per_day)]), color: C.amber, width: 1.2, hidden: true }] }),
      negDays.length ? `Negative balances cluster on days ${negDays.map((r) => r.day_in_cycle).join(', ')}.` : ''));
  }
  if (cc.length) {
    const p100 = cc.find((r) => num(r.prevented_pct) >= 100), p80 = cc.find((r) => num(r.prevented_pct) >= 80);
    cards.push(finding(`A ${money(num((p100 || cc[cc.length - 1]).cushion))} standing balance would have prevented every overdraft`,
      `Replays the last 12 months with a fixed amount held back in checking. ${p80 ? money(num(p80.cushion)) + ' prevents 80%.' : ''} ${cc[0].events} overdraft events in the period.`,
      ix({ type: 'xy', x: 'num', height: 190, yfmt: (v) => Math.round(v) + '%', y2fmt: yMoney, yFix: [0, 100], xfmt: (x) => money(x) + ' held back', xtick: (x) => '$' + short(x),
        series: [{ name: 'Overdrafts prevented', data: cc.map((r) => [num(r.cushion), num(r.prevented_pct)]), color: C.blue, fmt: (v) => v.toFixed(0) + '%' },
          { name: 'Fees avoided', data: cc.map((r) => [num(r.cushion), num(r.fees_saved)]), color: C.green, axis: 'right', fmt: money }] }), ''));
  }
  const cardsAcc = acc.filter((a) => a.type === 'credit' && !a.hidden), limit = sum(cardsAcc.map((a) => num(a.credit_limit) || 0));
  if (limit && liq.length) {
    const u = liq.map((r) => Math.max(0, 100 * num(r.cards) / limit)), over30 = u.filter((v) => v > 30).length;
    cards.push(finding(`Card balance averaged ${fmtPct(mean(u))} of the ${money(limit)} limit; over 30% on ${over30} of ${u.length} days`,
      'Utilization is reported to the bureaus at each statement date. Above 30% lowers scores; under 10% scores best.',
      ix({ type: 'xy', height: 190, zero: true, yfmt: (v) => Math.round(v) + '%', refs: [{ y: 30, label: '30%', color: C.amber }, { y: 10, label: '10%', color: C.green }],
        series: [{ name: 'Utilization', data: liq.map((r, i) => [mx(r.as_of), u[i]]), color: C.red, kind: 'area', fmt: (v) => v.toFixed(0) + '%' },
          { name: 'Balance', data: liq.map((r) => [mx(r.as_of), num(r.cards)]), color: C.gray, hidden: true, fmt: money, tip: true }] }),
      limit <= 1500 ? `The limit is the constraint: ${money(mean(liq.map((r) => num(r.cards))))} average balance on ${money(limit)}. A limit of ${money(Math.ceil(mean(liq.map((r) => num(r.cards))) * 10 / 1000) * 1000)} puts the same spending at 10%.` : ''));
  }
  const fees = ev.filter((e) => e.kind === 'fee');
  if (fees.length) {
    const ms = []; for (let i = 11; i >= 0; i--) ms.push(iso(new Date(new Date().getFullYear(), new Date().getMonth() - i, 1)));
    const charged = ms.map((m) => sum(fees.filter((e) => e.date.slice(0, 7) === m.slice(0, 7) && num(e.amount) < 0).map((e) => -num(e.amount))));
    const waived = ms.map((m) => -sum(fees.filter((e) => e.date.slice(0, 7) === m.slice(0, 7) && num(e.amount) > 0).map((e) => num(e.amount))));
    cards.push(finding(`Bank fees: ${money(sum(charged))} charged, ${money(-sum(waived))} waived, ${money(sum(charged) + sum(waived))} net in 12 months`, 'Overdraft, maintenance, foreign transaction and returned-payment fees. Waivers shown below zero.',
      ix({ type: 'cbar', height: 170, yfmt: yMoney, cats: ms.map(monLabel), tipCats: ms.map(monLong), series: [{ name: 'Charged', vals: charged, color: C.red, stack: 'f' }, { name: 'Waived', vals: waived, color: C.green, stack: 'f' }],
        tip: (i) => fees.filter((e) => e.date.slice(0, 7) === ms[i].slice(0, 7)).slice(0, 8).map((e) => `<div class="r"><span>${dShort(e.date)} ${h(e.label)}</span><b>${money(-num(e.amount))}</b></div>`).join('') }), ''));
  }
  view.innerHTML = `<h1>Insights</h1>${subnav(INS_NAV, 'cash')}${cards.join('')}`;
};
VIEWS.cycle = (v) => VIEWS.cash(v); VIEWS.fees = (v) => VIEWS.cash(v);

// ---------- Insights › Habits ----------
VIEWS.habits = async (view) => {
  const [hw, wg, ts] = await Promise.all([rpc('habit_weekly', { p_weeks: 52 }), rpc('weekday_groups', { p_days: 182 }), rpc('ticket_sizes', { p_days: 182 })]);
  const wk = hw.slice(0, -1), cards = [];
  if (wk.length) {
    const b = wk.slice(-8), D0 = wk.map((r) => num(r.delivery_n));
    const perWk = mean(b.map((r) => num(r.delivery_n))), amtWk = mean(b.map((r) => num(r.delivery_amt)));
    cards.push(finding(`Food delivery: ${perWk.toFixed(1)} orders and ${money(amtWk)} a week`, `Last 8 complete weeks. That is ${money(amtWk * 52)} a year. Bars are orders per week; line is spend per week.`,
      ix({ type: 'xy', height: 210, yfmt: (v) => Math.round(v), y2fmt: yMoney, xfmt: (t) => 'Week of ' + dLong(iso(new Date(t))), series: [
        { name: 'Orders', data: wk.map((r) => [mx(r.week), num(r.delivery_n)]), kind: 'bar', color: '#e7c38f' },
        { name: '8-week average', data: wk.map((r, i) => [mx(r.week), movAvg(D0, 8)[i]]), color: C.amber, fmt: (v) => v.toFixed(1) },
        { name: 'Spend', data: wk.map((r) => [mx(r.week), num(r.delivery_amt)]), color: C.red, axis: 'right', width: 1.2, fmt: money }] }), ''));
    const A0 = wk.map((r) => num(r.amazon_n));
    cards.push(finding(`Amazon: ${mean(b.map((r) => num(r.amazon_n))).toFixed(1)} orders and ${money(mean(b.map((r) => num(r.amazon_amt))))} a week`, 'Includes Amazon Fresh. Last 8 complete weeks.',
      ix({ type: 'xy', height: 190, yfmt: (v) => Math.round(v), y2fmt: yMoney, xfmt: (t) => 'Week of ' + dLong(iso(new Date(t))), series: [
        { name: 'Orders', data: wk.map((r) => [mx(r.week), num(r.amazon_n)]), kind: 'bar', color: '#9ad3d9' },
        { name: '8-week average', data: wk.map((r, i) => [mx(r.week), movAvg(A0, 8)[i]]), color: C.teal, fmt: (v) => v.toFixed(1) },
        { name: 'Spend', data: wk.map((r) => [mx(r.week), num(r.amazon_amt)]), color: C.red, axis: 'right', width: 1.2, fmt: money }] }), ''));
  }
  if (wg.length) {
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], groups = [...new Set(wg.map((r) => r.grp))];
    const tot = groups.map((g) => sum(wg.filter((r) => r.grp === g).map((r) => num(r.per_day)))); const order = groups.map((g, i) => [g, tot[i]]).sort((a, b) => b[1] - a[1]).map(([g]) => g);
    const vals = order.map((g) => days.map((_, j) => num((wg.find((r) => r.grp === g && r.dow === j + 1) || {}).per_day)));
    const dayTot = days.map((_, j) => sum(vals.map((row) => row[j]))); const jMax = dayTot.indexOf(Math.max(...dayTot)), jMin = dayTot.indexOf(Math.min(...dayTot));
    cards.push(finding(`${days[jMax]} is the most expensive day (${money(dayTot[jMax])}); ${days[jMin]} the cheapest (${money(dayTot[jMin])})`, 'Average spend per calendar day over 26 weeks, by group. Excludes rent, utilities, fees and unlinked card payments.',
      ix({ type: 'heat', rows: order, cols: days, vals, valueLabel: 'Per day', tip: (i, j) => `<div class="r"><span>Day total</span><b>${money(dayTot[j])}</b></div>` }), ''));
  }
  if (ts.length) {
    const bins = [0, 10, 15, 20, 30, 40, 60, 100, Infinity], lab = ['<$10', '$10–15', '$15–20', '$20–30', '$30–40', '$40–60', '$60–100', '$100+'];
    const groups = ['Delivery', 'Amazon', 'Restaurants', 'Groceries'], cols = [C.amber, C.teal, C.blue, C.green];
    const hist = groups.map((g) => { const a = ts.filter((t) => t.label === g).map((t) => num(t.amount)); return lab.map((_, i) => a.filter((v) => v >= bins[i] && v < bins[i + 1]).length); });
    const amz = ts.filter((t) => t.label === 'Amazon').map((t) => num(t.amount)), del = ts.filter((t) => t.label === 'Delivery').map((t) => num(t.amount));
    cards.push(finding(`${fmtPct(100 * amz.filter((v) => v < 15).length / Math.max(1, amz.length))} of Amazon orders are under $15; median delivery order ${money2(quantile(del, 0.5))}`,
      'Number of purchases by size, last 26 weeks. Many small orders usually means impulse or convenience buying rather than planned purchases.',
      ix({ type: 'cbar', height: 200, yfmt: (v) => Math.round(v), cats: lab, series: groups.map((g, i) => ({ name: g, vals: hist[i], color: cols[i], fmt: (v) => v + ' orders' })) }), ''));
  }
  view.innerHTML = `<h1>Insights</h1>${subnav(INS_NAV, 'habits')}${cards.join('')}`;
};
VIEWS.trends = (v) => VIEWS.habits(v);

// ---------- Insights › Income ----------
VIEWS.income = async (view) => {
  const [src, ev, ib] = await Promise.all([rpc('income_sources'), rpc('money_events', { p_days: 730 }), rpc('income_breakdown', { p_from: iso(new Date(Date.now() - 365 * 864e5)), p_to: today() }).catch(() => [])]);
  const inc = ev.filter((e) => e.kind === 'income'), active = src.filter((s) => d(s.last_date) >= new Date(Date.now() - 75 * 864e5));
  const monthly = sum(active.map((r) => num(r.monthly_equiv)));
  const labels = [...new Set(inc.map((e) => e.label))], byTot = labels.map((l) => [l, sum(inc.filter((e) => e.label === l).map((e) => num(e.amount)))]).sort((a, b) => b[1] - a[1]);
  const ms = []; for (let i = 12; i >= 1; i--) ms.push(iso(new Date(new Date().getFullYear(), new Date().getMonth() - i, 1)));
  const topL = byTot.slice(0, 4).map(([l]) => l);
  const mVals = (l) => ms.map((m) => sum(inc.filter((e) => e.date.slice(0, 7) === m.slice(0, 7) && (l ? e.label === l : !topL.includes(e.label))).map((e) => num(e.amount))));
  view.innerHTML = `<h1>Insights</h1>${subnav(INS_NAV, 'income')}
    ${finding(`Recurring income: ${money(monthly)}/month from ${active.length} source${active.length === 1 ? '' : 's'}`, active.map((s) => `${titleCase(s.source)} ${money2(num(s.typical_amount))} ${s.cadence}`).join(' · '),
      ix({ type: 'xy', height: 220, yfmt: yMoney2, series: byTot.slice(0, 5).map(([l], i) => ({ name: titleCase(l), data: inc.filter((e) => e.label === l).map((e) => [mx(e.date), num(e.amount)]), kind: i === 0 ? 'step' : 'dots', color: [C.green, C.blue, C.amber, C.violet, C.teal][i] })) }),
      'Each deposit over two years. Hover for amounts; drag to zoom into a period.')}
    <div class="grid2">
      <div class="card"><h2>By source, 12 months</h2>${ix({ type: 'donut', items: ib.slice(0, 8).map((r) => ({ k: titleCase(r.key), v: num(r.total), sub: `${r.n} deposits` })), label: 'received' })}</div>
      <div class="card"><h2>By month</h2>${ix({ type: 'cbar', height: 200, yfmt: yMoney, stackTotal: true, cats: ms.map(monLabel), tipCats: ms.map(monLong),
        series: [...topL.map((l, i) => ({ name: titleCase(l), vals: mVals(l), stack: 's', color: [C.green, C.blue, C.amber, C.violet][i] })), { name: 'Other', vals: mVals(null), stack: 's', color: '#b8bec8' }] })}</div>
    </div>`;
};

VIEWS.review = async (view) => {
  const rows = await rpc('merchant_audit', { p_days: 730 });
  const f = { q: '', only: 'all' };
  const n = { rule: 0, plaid: 0, user: 0 }; rows.forEach((r) => { n[r.source] = (n[r.source] || 0) + r.n; });
  view.innerHTML = `
    <h1>Insights</h1>${subnav(INS_NAV, 'review')}
    <div class="card">
      <div class="row between wrap"><h2>Classification audit</h2><span class="stat"><span class="v">${rows.length}</span><span class="l">merchants, 24 months</span></span></div>
      <p class="muted small">${n.rule + n.user} transactions assigned by a rule, ${n.user} by you, ${n.plaid} by Plaid's guess only. Changing a category here writes a rule for that merchant and reassigns every past and future transaction.</p>
      <div class="toolbar">
        <input type="search" id="rv-q" placeholder="Search" aria-label="Search">
        <select id="rv-only" aria-label="Filter"><option value="all">All</option><option value="plaid">Plaid guess only</option><option value="user">Your rules</option><option value="spend">Spending</option><option value="transfer">Transfers</option><option value="income">Income</option></select>
      </div>
      <div class="scroll"><table class="data" id="rv-table"></table></div>
    </div>`;
  const draw = () => {
    const ql = f.q.toLowerCase();
    const xs = rows.filter((r) => (!ql || (r.merchant + ' ' + r.example + ' ' + r.category).toLowerCase().includes(ql)) && (f.only === 'all' || f.only === r.source || f.only === catKind(r.category)));
    $('#rv-table').innerHTML = `<thead><tr><th>Merchant</th><th>Category</th><th>By</th><th class="num">n</th><th class="num">Total</th><th class="num">Last</th></tr></thead><tbody>
      ${xs.slice(0, 400).map((r, i) => `<tr><td><b>${h(r.merchant)}</b><br><span class="muted small">${h(r.example)}${r.accounts ? ' · ' + h(r.accounts) : ''}</span></td>
        <td><select data-i="${i}" class="small">${catOptions(r.category)}</select></td>
        <td><span class="pill ${r.source === 'plaid' ? 'warn' : ''}" title="${h(r.rule || r.plaid || '')}">${r.source === 'plaid' ? 'Plaid' : r.source === 'user' ? 'you' : 'rule'}</span></td>
        <td class="num">${r.n}</td><td class="num ${num(r.total) < 0 ? 'up' : ''}">${num(r.total) < 0 ? '+' : ''}${money(Math.abs(num(r.total)))}</td><td class="num">${fmtDay(r.last_date)}</td></tr>`).join('')}
      ${xs.length > 400 ? `<tr><td colspan="6" class="muted">${xs.length - 400} more; narrow the search.</td></tr>` : ''}</tbody>`;
    $$('#rv-table select').forEach((sel) => sel.onchange = async () => { const r = xs[Number(sel.dataset.i)]; const cat = sel.value;
      try { await rpc('add_rule', { p_match: r.raw_merchant || r.merchant, p_category: cat, p_is_transfer: catKind(cat) === 'transfer', p_excluded: false, p_business: catGroup(cat) === 'Business' });
        r.category = cat; r.source = 'user'; invalidate(); toast(`Rule saved: ${r.merchant} → ${cat}`); draw(); } catch (e) { toast(e.message); } });
  };
  let t; $('#rv-q').oninput = (e) => { f.q = e.target.value.trim(); clearTimeout(t); t = setTimeout(draw, 200); };
  $('#rv-only').onchange = (e) => { f.only = e.target.value; draw(); };
  draw();
};


// ---------- Plan: debt & credit, future ----------
VIEWS.debt = async (view) => {
  const acc = await D.accounts();
  const unl = CATS.filter((c) => c.grp === 'Unlinked accounts').map((c) => c.name);
  let extra = Number(localStorage.getItem('debt_extra') || 100);
  const draw = async () => {
    const plan = await rpc('debt_plan', { p_extra: extra });
    const totMin = plan.reduce((s, r) => s + num(r.interest_min), 0), totPlan = plan.reduce((s, r) => s + num(r.interest_plan), 0);
    const last_pay = plan.reduce((m, r) => Math.max(m, r.months_plan), 0);
    $('#debt-body').innerHTML = plan.length ? `
      <div class="row wrap"><span class="stat"><span class="v">${money(plan.reduce((s, r) => s + num(r.balance), 0))}</span><span class="l">balance, linked debts</span></span><span style="width:16px"></span><span class="stat"><span class="v down">${money2(plan.reduce((s, r) => s + num(r.daily_interest), 0))}</span><span class="l">interest accrual / day</span></span></div>
      <div class="scroll"><table class="data"><thead><tr><th>Debt</th><th class="num">Balance</th><th class="num">APR</th><th class="num">Minimum only</th><th class="num">Minimum + ${money(extra)}</th></tr></thead><tbody>
        ${plan.map((r) => `<tr><td>${h(r.name)}</td><td class="num">${money(num(r.balance))}</td><td class="num">${fmtPct(r.apr, 2)}</td><td class="num">${r.months_min >= 600 ? '<span class="down">never</span>' : r.months_min + ' mo · ' + money(num(r.interest_min)) + ' interest'}</td><td class="num">${r.months_plan >= 600 ? '<span class="down">never</span>' : r.months_plan + ' mo · ' + money(num(r.interest_plan)) + ' interest'}</td></tr>`).join('')}
      </tbody></table></div>
      <p class="small">Minimum only: <b class="down">${money(totMin)}</b> total interest. Minimum + ${money(extra)}, highest APR first: <b>${money(totPlan)}</b> interest, cleared in <b>${last_pay} months</b>; ${money(totMin - totPlan)} saved.</p>` : '<p class="empty">No linked debt balances.</p>';
  };
  view.innerHTML = `
    <h1>Plan</h1>${subnav(PLAN_NAV, 'debt')}
    <div class="card">
      <div class="row between wrap"><h2>Amortization</h2><label class="field" style="display:flex;align-items:center;gap:8px">Additional payment / mo <input id="debt-extra" class="short" type="number" inputmode="numeric" min="0" step="25" value="${extra}" style="width:11ch"></label></div>
      <div id="debt-body"><p class="muted">Calculating…</p></div>
      ${unl.length ? `<p class="muted small">Excluded, not linked: ${unl.map(h).join(', ')}.</p>` : ''}
    </div>
    `;
  await draw();
  let t; $('#debt-extra').oninput = (e) => { extra = Math.max(0, Number(e.target.value) || 0); localStorage.setItem('debt_extra', String(extra)); clearTimeout(t); t = setTimeout(draw, 350); };
};

VIEWS.credit = async (view) => {
  const ppl = await people(); const adults = ppl.filter((x) => !x.child).map((x) => x.name);
  let owner = localStorage.getItem('credit_owner') || adults[0] || 'John';
  const [scores, cs, accts, inq, items, acc] = await Promise.all([q('credit_scores', (s) => s.order('as_of')), rpc('credit_summary', { p_owner: owner }).catch(() => []), q('credit_accounts', (s) => s.eq('owner', owner).order('balance', { ascending: false })), q('credit_inquiries', (s) => s.eq('owner', owner).order('inquired', { ascending: false })), q('credit_items', (s) => s.eq('owner', owner)), D.accounts()]);
  const mine = scores.filter((s) => (s.owner || 'John') === owner);
  const bureaus = ['Equifax', 'Experian', 'TransUnion'];
  const latest = (b) => mine.filter((s) => s.bureau === b).slice(-1)[0];
  const prevOf = (b) => { const xs = mine.filter((s) => s.bureau === b); return xs.length > 1 ? xs[xs.length - 2] : null; };
  const fmtMY = (x) => new Date(+x).toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
  const fmtDMY = (x) => x ? d(x).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
  const lineCls = ['line', 'line alt', 'line in'];
  const series = bureaus.map((b, i) => ({ pts: mine.filter((s) => s.bureau === b).map((s) => ({ x: mx(s.as_of), y: s.score })), cls: lineCls[i], b })).filter((s) => s.pts.length);
  const latestRep = cs.reduce((m, r) => (!m || r.as_of > m.as_of ? r : m), null);
  const repAccts = latestRep ? accts.filter((a) => a.bureau === latestRep.bureau && a.as_of === latestRep.as_of) : [];
  const cards = acc.filter((a) => a.type === 'credit' && !a.hidden);
  const liveUtil = cards.reduce((s, a) => s + num(a.current_balance), 0), liveLimit = cards.reduce((s, a) => s + (num(a.credit_limit) || 0), 0);
  const band = (v) => v >= 800 ? 'exceptional' : v >= 740 ? 'very good' : v >= 670 ? 'good' : v >= 580 ? 'fair' : 'poor';
  view.innerHTML = `
    <h1>Plan</h1>${subnav(PLAN_NAV, 'credit')}
    <div class="card">
      <div class="row between wrap"><h2>Scores</h2><div class="row" style="gap:8px">${adults.length > 1 ? `<select id="cr-owner" aria-label="Person">${adults.map((a) => `<option ${a === owner ? 'selected' : ''}>${h(a)}</option>`).join('')}</select>` : ''}<button class="primary" id="btn-score">Log score</button></div></div>
      <div class="row wrap" style="gap:24px">${bureaus.map((b) => { const l = latest(b), p = prevOf(b); return `<span class="stat"><span class="v">${l ? l.score : '—'}</span><span class="l">${b}${l ? ` · ${h(l.model || '')} · ${fmtDay(l.as_of)}` : ''}${l && p ? ` · <span class="${l.score - p.score >= 0 ? 'up' : 'down'}">${l.score - p.score >= 0 ? '+' : ''}${l.score - p.score}</span>` : ''}</span></span>`; }).join('')}</div>
      ${series.length ? chart(series, { H: 160, fmtY: (v) => String(Math.round(v)), fmtX: fmtMY }) + `<div class="legend">${series.map((sr, i) => `<span><i style="background:${['var(--bar2)', 'var(--warn)', 'var(--up)'][i]}"></i>${sr.b}</span>`).join('')}</div>` : '<p class="empty">No scores logged.</p>'}
      ${mine.length ? `<p class="muted small">${bureaus.filter(latest).map((b) => `${b}: ${band(latest(b).score)}`).join(' · ')}. Bands: 800+ exceptional, 740–799 very good, 670–739 good, 580–669 fair.</p>` : ''}
    </div>
    ${latestRep ? `<div class="card">
      <h2>Score factors, ${h(latestRep.bureau)} report of ${fmtDMY(latestRep.as_of)}</h2>
      <div class="scroll"><table class="data"><thead><tr><th>Factor</th><th>Value</th><th class="num">Weight</th><th>Read</th></tr></thead><tbody>
        <tr><td>Revolving utilization</td><td>${fmtPct(latestRep.utilization_pct)} <span class="muted">(${money(num(latestRep.revolving_balance))} / ${money(num(latestRep.revolving_limit))})</span></td><td class="num">30%</td><td class="${num(latestRep.utilization_pct) > 30 ? 'down' : num(latestRep.utilization_pct) > 10 ? 'warn' : 'up'}">${num(latestRep.utilization_pct) > 30 ? 'above 30%: largest drag' : num(latestRep.utilization_pct) > 10 ? 'under 30%; under 10% scores best' : 'under 10%'}</td></tr>
        <tr><td>Late payments on file</td><td>${latestRep.late_payments}</td><td class="num">35%</td><td class="${latestRep.late_payments ? 'down' : 'up'}">${latestRep.late_payments ? 'each 30-day late stays 7 years' : 'clean'}</td></tr>
        <tr><td>Derogatory / collections</td><td>${latestRep.derogatory} / ${latestRep.collections}</td><td class="num">35%</td><td class="${latestRep.derogatory || latestRep.collections ? 'down' : 'up'}">${latestRep.derogatory || latestRep.collections ? 'dispute or pay-for-delete' : 'none'}</td></tr>
        <tr><td>Average account age</td><td>${latestRep.avg_age_months == null ? '—' : (num(latestRep.avg_age_months) / 12).toFixed(1) + ' yr'}</td><td class="num">15%</td><td>${latestRep.oldest_account ? 'oldest ' + fmtDMY(latestRep.oldest_account) : ''}</td></tr>
        <tr><td>Hard inquiries, 12 months</td><td>${latestRep.inquiries_12m}</td><td class="num">10%</td><td class="${latestRep.inquiries_12m > 2 ? 'warn' : 'up'}">${latestRep.inquiries_12m > 2 ? 'several; each fades after 12 months' : 'low'}</td></tr>
        <tr><td>Open accounts</td><td>${latestRep.open_accounts}</td><td class="num">10%</td><td>${latestRep.installment_balance != null ? 'installment ' + money(num(latestRep.installment_balance)) : ''}</td></tr>
      </tbody></table></div>
      ${liveLimit ? `<p class="small">Linked cards right now: ${money(liveUtil)} of ${money(liveLimit)} · <b class="${liveUtil / liveLimit > 0.3 ? 'warn' : 'up'}">${fmtPct(100 * liveUtil / liveLimit)}</b>. Pay before the statement closes to lower what the bureaus see.</p>` : ''}
    </div>
    <div class="card">
      <h2>Accounts on report</h2>
      <div class="scroll"><table class="data"><thead><tr><th>Creditor</th><th>Type</th><th class="num">Opened</th><th class="num">Limit</th><th class="num">Balance</th><th class="num">Payment</th><th style="padding-left:12px">Status</th><th class="num">30/60/90</th></tr></thead><tbody>
        ${repAccts.map((a) => `<tr><td>${h(a.creditor)}${a.responsibility && a.responsibility !== 'individual' ? ` <span class="pill">${h(a.responsibility)}</span>` : ''}</td><td class="muted">${h(a.account_type || '')}</td><td class="num">${fmtDMY(a.opened)}</td><td class="num">${a.credit_limit != null ? money(num(a.credit_limit)) : '—'}</td><td class="num">${a.balance != null ? money(num(a.balance)) : '—'}</td><td class="num">${a.monthly_payment != null ? money(num(a.monthly_payment)) : '—'}</td><td class="${['charge-off', 'collection'].includes(a.status) || (a.payment_status && !['current', 'ok'].includes(a.payment_status)) ? 'down' : ''}">${h(a.status || '')}${a.payment_status && a.payment_status !== 'current' ? ' · ' + h(a.payment_status) : ''}</td><td class="num ${a.late_30 + a.late_60 + a.late_90 ? 'down' : ''}">${a.late_30 || 0}/${a.late_60 || 0}/${a.late_90 || 0}</td></tr>`).join('')}
      </tbody></table></div>
      ${inq.length ? `<h3>Inquiries</h3><div class="list">${inq.slice(0, 12).map((i) => `<div class="item"><span class="t">${h(i.creditor)}</span><span class="a muted">${fmtDMY(i.inquired)}</span><span class="s">${h(i.bureau)} · ${h(i.kind)}</span></div>`).join('')}</div>` : ''}
      ${items.length ? `<h3>Items</h3><div class="list">${items.map((i) => `<div class="item"><span class="t">${h(i.kind)}${i.creditor ? ' · ' + h(i.creditor) : ''}</span><span class="a">${i.amount != null ? money(num(i.amount)) : ''}</span><span class="s">${h(i.bureau)} · ${h(i.status || '')} ${h(i.detail || '')}</span></div>`).join('')}</div>` : ''}
    </div>` : `<div class="card"><p class="empty">No bureau report loaded for ${h(owner)}. Upload the Equifax, Experian and TransUnion reports in chat and they will be parsed into this page.</p></div>`}`;
  if ($('#cr-owner')) $('#cr-owner').onchange = (e) => { localStorage.setItem('credit_owner', e.target.value); route(); };
  $('#btn-score').onclick = () => {
    const l = mine[mine.length - 1];
    openSheet(`<h2>Log credit score</h2><div class="form">
      <label class="field">Bureau <select id="c-bureau" style="width:auto">${bureaus.map((b) => `<option ${l && l.bureau === b ? 'selected' : ''}>${b}</option>`).join('')}</select></label>
      <label class="field">Model <select id="c-model" style="width:auto">${['FICO 8', 'FICO 9', 'FICO 10T', 'VantageScore 3.0', 'VantageScore 4.0', 'FICO Bankcard 8', 'FICO Auto 8'].map((m) => `<option ${l && l.model === m ? 'selected' : ''}>${m}</option>`).join('')}</select></label>
      <label class="field">Score <input id="c-score" class="short" type="number" inputmode="numeric" min="300" max="850" value="${l ? l.score : ''}" style="width:8ch"></label>
      <label class="field">Date <input id="c-date" type="date" value="${today()}" style="width:auto"></label>
      <label class="field">Source <input id="c-src" type="text" size="18" value="${h(l?.source || 'Experian app')}"></label>
      <div class="actions"><button class="quiet" data-cancel>Cancel</button><button class="primary" data-save>Save</button></div></div>`);
    $('#sheet-body').onclick = async (e) => {
      if (e.target.closest('[data-cancel]')) closeSheet();
      if (e.target.closest('[data-save]')) { const s = Number($('#c-score').value); if (!(s >= 300 && s <= 850)) return toast('Score must be 300–850.');
        try { await rpc('add_credit_score', { p_owner: owner, p_bureau: $('#c-bureau').value, p_model: $('#c-model').value, p_score: s, p_as_of: $('#c-date').value, p_source: $('#c-src').value }); closeSheet(); invalidate(); route(); } catch (err) { toast(err.message); } }
    };
  };
};

VIEWS.future = async (view) => {
  const settings = await D.settings();
  const p = Object.assign({ attending_start: '2028-07-01', attending_net_monthly: 20000, spending_after: 9000, return_pct: 6, years: 15, extra_debts: [] }, settings.projection || {});
  const sum = await D.summary();
  const lastDone = sum.filter((r) => !r.partial).slice(-1)[0] || {};
  const draw = async () => {
    const active = { ...p, extra_debts: p.extra_debts.filter((x) => x.include !== false) };
    const rows = await rpc('projection', { p: active });
    const excluded = p.extra_debts.filter((x) => x.include === false);
    const alt = excluded.length ? await rpc('projection', { p: { ...p, extra_debts: p.extra_debts } }) : null;
    const cross = rows.find((r) => num(r.net_worth) >= 1000000);
    $('#proj-body').innerHTML = `
      ${lineChart(rows.map((r) => ({ t: r.year_end, v: num(r.net_worth) })), 640, 170, money, true)}
      <p class="small">Basis: current balances; trailing-12-month mean income ${money(num(lastDone.income_12m_avg))} and spending ${money(num(lastDone.spending_12m_avg))} until ${fmtDay(p.attending_start)} ${d(p.attending_start).getFullYear()}, then the figures above. Surplus to highest-APR debt first, then invested at ${p.return_pct}%/yr.${cross ? ` $1M crossed <b>${d(cross.year_end).getFullYear()}</b>.` : ''}</p>
      <div class="scroll"><table class="data"><thead><tr><th>Year</th><th class="num">Net worth</th><th class="num">Assets</th><th class="num">Debt</th><th class="num">Net saved</th></tr></thead><tbody>
        ${rows.map((r) => `<tr><td>${d(r.year_end).getFullYear()} <span class="muted">${h(r.age_note)}</span></td><td class="num">${money(num(r.net_worth))}</td><td class="num">${money(num(r.cash_and_invest))}</td><td class="num">${money(num(r.debt))}</td><td class="num">${signed(num(r.saved_year))}</td></tr>`).join('')}
      </tbody></table></div>
      ${alt ? `<h3>Scenario: ${excluded.map((x) => h(x.name)).join(', ')} included</h3><div class="scroll"><table class="data"><thead><tr><th>Year</th><th class="num">Net worth, excluded</th><th class="num">Net worth, included</th><th class="num">Difference</th></tr></thead><tbody>${rows.map((r, i) => `<tr><td>${d(r.year_end).getFullYear()}</td><td class="num">${money(num(r.net_worth))}</td><td class="num">${money(num(alt[i]?.net_worth))}</td><td class="num down">${signed(num(alt[i]?.net_worth) - num(r.net_worth))}</td></tr>`).join('')}</tbody></table></div>` : ''}`;
  };
  view.innerHTML = `
    <h1>Plan</h1>${subnav(PLAN_NAV, 'future')}
    <div class="card">
      <h2>Long-range projection</h2>
      <div class="row wrap" style="gap:14px">
        <label class="field">Income step-up month <input id="pj-start" type="month" value="${p.attending_start.slice(0, 7)}" style="width:auto"></label>
        <label class="field">Net income / mo after <input id="pj-inc" class="short" type="number" inputmode="numeric" step="500" value="${p.attending_net_monthly}" style="width:12ch"></label>
        <label class="field">Spending / mo after <input id="pj-sp" class="short" type="number" inputmode="numeric" step="500" value="${p.spending_after}" style="width:12ch"></label>
        <label class="field">Return % / yr <input id="pj-ret" class="short" type="number" inputmode="decimal" step="0.5" value="${p.return_pct}" style="width:9ch"></label>
        <label class="field">Years <input id="pj-yrs" class="short" type="number" inputmode="numeric" min="2" max="40" value="${p.years}" style="width:10ch"></label>
      </div>
      <div class="row between wrap"><span class="muted small">Unlinked debts can be added.</span><span class="row"><button class="quiet small" id="pj-adddebt">Add a debt</button><button class="primary" id="pj-save">Recalculate</button></span></div>
      ${p.extra_debts.length ? `<div class="list">${p.extra_debts.map((x, i) => `<div class="item"><span class="t">${h(x.name)}</span><span class="a">${money(num(x.bal))}<span class="s">${fmtPct(x.apr, 2)} · ${money(num(x.pay))}/mo</span></span><span class="s"><label class="check" style="display:inline-flex;font-size:13px"><input type="checkbox" data-incdebt="${i}" ${x.include === false ? '' : 'checked'}> include</label> · <button class="link small" data-deldebt="${i}">remove</button></span></div>`).join('')}</div>` : ''}
      <div id="proj-body"><p class="muted">Calculating…</p></div>
    </div>`;
  await draw();
  const read = () => { p.attending_start = $('#pj-start').value + '-01'; p.attending_net_monthly = Number($('#pj-inc').value) || 0; p.spending_after = Number($('#pj-sp').value) || 0; p.return_pct = Number($('#pj-ret').value) || 0; p.years = Math.min(40, Math.max(2, Number($('#pj-yrs').value) || 15)); };
  const save = async () => { read(); try { await rpc('set_setting', { p_key: 'projection', p_value: p }); invalidate(); } catch (e) { toast(e.message); } await draw(); };
  $('#pj-save').onclick = save;
  $('#pj-adddebt').onclick = () => {
    openSheet(`<h2>Add a debt</h2><div class="form">
      <label class="field">Name <input id="xd-name" type="text" size="20" placeholder="Student loans"></label>
      <label class="field">Balance <input id="xd-bal" class="short" type="number" inputmode="numeric" style="width:13ch"></label>
      <label class="field">Interest rate % <input id="xd-apr" class="short" type="number" inputmode="decimal" step="0.01" style="width:10ch"></label>
      <label class="field">Payment per month <input id="xd-pay" class="short" type="number" inputmode="numeric" style="width:11ch"></label>
      <div class="actions"><button class="quiet" data-cancel>Cancel</button><button class="primary" data-save>Add</button></div></div>`);
    $('#sheet-body').onclick = async (e) => {
      if (e.target.closest('[data-cancel]')) closeSheet();
      if (e.target.closest('[data-save]')) { const x = { name: $('#xd-name').value.trim() || 'Debt', bal: Number($('#xd-bal').value) || 0, apr: Number($('#xd-apr').value) || 0, pay: Number($('#xd-pay').value) || 0 }; if (!x.bal) return toast('Balance required.'); p.extra_debts.push(x); closeSheet(); await save(); route(); }
    };
  };
  view.onclick = async (e) => { const b = e.target.closest('[data-deldebt]'); if (b) { p.extra_debts.splice(Number(b.dataset.deldebt), 1); await save(); route(); } };
  view.onchange = async (e) => { const c = e.target.closest('[data-incdebt]'); if (c) { p.extra_debts[Number(c.dataset.incdebt)].include = c.checked; await save(); } };
};

// ---------- Invest ----------
const INV_NAV = [['invest', 'Overview'], ['holdings', 'Holdings'], ['allocation', 'Allocation'], ['contributions', 'Contributions'], ['strategy', 'Strategy']];
const TYPE_NAME = { equity: 'Stocks', etf: 'ETFs', mutual_fund: 'Mutual funds', fixed_income: 'Bonds', cash: 'Cash', derivative: 'Options', cryptocurrency: 'Crypto', other: 'Other' };
const COLORS = ['var(--bar2)', 'var(--up)', 'var(--warn)', 'var(--down)', 'var(--muted)', 'var(--bar)'];

VIEWS.invest = async (view) => {
  const [perf, acc, nwm] = await Promise.all([rpc('investment_performance'), D.accounts(), D.nwm()]);
  const inv = acc.filter((a) => a.type === 'investment' && !a.hidden);
  const total = inv.reduce((s, a) => s + num(a.current_balance), 0);
  const cost = perf.reduce((s, x) => s + (num(x.cost_basis) || 0), 0), val = perf.reduce((s, x) => s + num(x.value), 0);
  view.innerHTML = `
    <h1>Invest</h1>${subnav(INV_NAV, 'invest')}
    ${inv.length ? `
    <div class="card">
      <div class="hero"><span class="label">Invested</span><span class="big">${money(total)}</span>${cost ? `<span class="small ${val - cost >= 0 ? 'up' : 'down'}">${signed(val - cost)} vs cost (${pct(100 * (val - cost) / cost)})</span>` : ''}</div>
      ${nwm.filter((r) => num(r.invested) > 0).length > 1 ? lineChart(nwm.filter((r) => num(r.invested) > 0).map((r) => ({ t: r.as_of, v: num(r.invested) })), 640, 140) : ''}
      <div class="scroll"><table class="data"><thead><tr><th>Account</th><th class="num">Value</th><th class="num">Unrealized</th><th class="num">MWR (XIRR)</th><th class="num">TWR, 12 mo</th></tr></thead><tbody>
        ${perf.map((x) => `<tr><td>${h(x.name)}<br><span class="muted small">${h(x.institution)}</span></td><td class="num">${money(num(x.value))}</td><td class="num ${x.unrealized == null ? '' : num(x.unrealized) >= 0 ? 'up' : 'down'}">${x.unrealized == null ? '—' : signed(num(x.unrealized)) + ' (' + pct(num(x.unrealized_pct)) + ')'}</td><td class="num">${x.xirr_pct == null ? '—' : fmtPct(x.xirr_pct, 1) + '/yr'}</td><td class="num">${x.twr_12m_pct == null ? '—' : fmtPct(x.twr_12m_pct, 1)}</td></tr>`).join('')}
      </tbody></table></div>
      <p class="muted small">MWR: money-weighted return on external flows and current value. TWR: time-weighted from daily balances, flows removed. Both accrue from link date.</p>
      <div class="list">${perf.map((x) => `<div class="item"><span class="t">${h(x.name)}</span><span class="a">${signed(num(x.contributed_12m))}<span class="s">contributions, 12 mo</span></span><span class="s">dividends ${money2(num(x.dividends_12m))} · fees ${money2(num(x.fees_12m))}</span></div>`).join('')}</div>
    </div>` : '<div class="card"><p class="empty">No investment accounts linked.</p></div>'}`;
};

VIEWS.holdings = async (view) => {
  const [hold, conc, px] = await Promise.all([D.holdings(), D.concentration(), rpc('price_returns').catch(() => [])]);
  const c = conc[0] || {};
  const pxBy = Object.fromEntries(px.map((r) => [r.symbol, r]));
  const bench = px.filter((r) => !hold.some((x) => (x.ticker || '').toUpperCase() === r.symbol));
  view.innerHTML = `
    <h1>Invest</h1>${subnav(INV_NAV, 'holdings')}
    <div class="card">
      ${c.positions ? `<div class="row wrap"><span class="stat"><span class="v">${c.positions}</span><span class="l">positions</span></span><span style="width:16px"></span><span class="stat"><span class="v ${num(c.top_pct) > 25 ? 'warn' : ''}">${fmtPct(c.top_pct)}</span><span class="l">largest: ${h(c.top_ticker || '—')}</span></span><span style="width:16px"></span><span class="stat"><span class="v">${fmtPct(c.top5_pct)}</span><span class="l">top 5</span></span></div>` : ''}
      <div class="scroll"><table class="data"><thead><tr><th>Security</th><th class="num">Value</th><th class="num">Unrealized</th><th class="num">Qty</th><th class="num">1 mo</th><th class="num">3 mo</th><th class="num">12 mo</th></tr></thead><tbody>
        ${hold.map((x) => { const g = x.cost_basis != null ? num(x.institution_value) - num(x.cost_basis) : null; const r = pxBy[(x.ticker || '').toUpperCase()] || {}; const rc = (v) => v == null ? '—' : `<span class="${num(v) >= 0 ? 'up' : 'down'}">${pct(num(v))}</span>`; return `<tr><td>${h(x.ticker || x.security_name || '')}<br><span class="muted small">${h(x.ticker ? x.security_name : x.account_name)}</span></td><td class="num">${money(num(x.institution_value))}</td><td class="num ${g == null ? '' : g >= 0 ? 'up' : 'down'}">${g == null ? '—' : signed(g)}</td><td class="num">${Number(x.quantity).toLocaleString(undefined, { maximumFractionDigits: 3 })}</td><td class="num">${rc(r.r_1m)}</td><td class="num">${rc(r.r_3m)}</td><td class="num">${rc(r.r_12m)}</td></tr>`; }).join('') || '<tr><td colspan="7" class="empty">No holdings.</td></tr>'}
      </tbody></table></div>
    </div>
    ${bench.length ? `<div class="card"><h2>Benchmarks</h2><p class="muted small">Daily closes, adjusted. ${bench[0].as_of ? 'As of ' + fmtDay(bench[0].as_of) + '.' : ''}</p>
      <div class="scroll"><table class="data"><thead><tr><th>Symbol</th><th class="num">Close</th><th class="num">1 mo</th><th class="num">3 mo</th><th class="num">YTD</th><th class="num">12 mo</th></tr></thead><tbody>${bench.map((r) => { const rc = (v) => v == null ? '—' : `<span class="${num(v) >= 0 ? 'up' : 'down'}">${pct(num(v))}</span>`; return `<tr><td>${h(r.symbol)}</td><td class="num">${money2(num(r.last_close))}</td><td class="num">${rc(r.r_1m)}</td><td class="num">${rc(r.r_3m)}</td><td class="num">${rc(r.r_ytd)}</td><td class="num">${rc(r.r_12m)}</td></tr>`; }).join('')}</tbody></table></div></div>` : ''}`;
};

VIEWS.allocation = async (view) => {
  const [drift, settings] = await Promise.all([D.drift(), D.settings()]);
  const target = settings.target_allocation || {};
  const rows = drift.filter((r) => num(r.value) > 0 || r.target_pct != null);
  view.innerHTML = `
    <h1>Invest</h1>${subnav(INV_NAV, 'allocation')}
    <div class="card">
      <div class="row between wrap"><h2>Allocation vs target</h2><button class="quiet small" id="btn-target">Set target</button></div>
      ${rows.length ? `<div class="alloc">${rows.filter((r) => num(r.pct) > 0).map((r, i) => `<i style="width:${r.pct}%;background:${COLORS[i % COLORS.length]}" title="${h(r.asset_type)}"></i>`).join('')}</div>
      <div class="list">${rows.map((r, i) => `<div class="item"><span class="t"><i class="legend" style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${COLORS[i % COLORS.length]};margin-right:6px"></i>${h(TYPE_NAME[r.asset_type] || r.asset_type)}</span><span class="a">${fmtPct(r.pct)}${r.target_pct != null ? `<span class="s ${Math.abs(num(r.drift_pct)) >= 5 ? 'warn' : ''}">target ${fmtPct(r.target_pct)} · ${num(r.drift_pct) >= 0 ? '+' : ''}${num(r.drift_pct).toFixed(1)}</span>` : ''}</span><span class="s">${money(num(r.value))}</span></div>`).join('')}</div>
      <p class="muted small">Drift ≥5 pts flagged.</p>` : '<p class="empty">No holdings.</p>'}
    </div>`;
  $('#btn-target').onclick = () => {
    const keys = Object.keys(TYPE_NAME);
    openSheet(`<h2>Target allocation</h2><p class="muted small">Percent of portfolio; must total 100.</p><div class="form">${keys.map((k) => `<label class="field" style="display:flex;align-items:center;justify-content:space-between">${TYPE_NAME[k]} <input data-tk="${k}" class="short" type="number" inputmode="numeric" min="0" max="100" value="${target[k] ?? ''}" style="width:9ch"></label>`).join('')}
      <div class="actions"><button class="quiet" data-cancel>Cancel</button><button class="primary" data-save>Save</button></div></div>`);
    $('#sheet-body').onclick = async (e) => {
      if (e.target.closest('[data-cancel]')) closeSheet();
      if (e.target.closest('[data-save]')) { const t = {}; let sum = 0; $$('[data-tk]').forEach((i) => { const v = Number(i.value); if (i.value !== '' && v >= 0) { t[i.dataset.tk] = v; sum += v; } }); if (Math.round(sum) !== 100) return toast('Total is ' + sum + '%; must be 100%.');
        try { await rpc('set_setting', { p_key: 'target_allocation', p_value: t }); closeSheet(); invalidate(); route(); } catch (err) { toast(err.message); } }
    };
  };
};

function linfit(ys) { const n = ys.length; if (n < 2) return { a: ys[0] || 0, b: 0 }; const xm = (n - 1) / 2, ym = ys.reduce((s, y) => s + y, 0) / n; let sxy = 0, sxx = 0; ys.forEach((y, i) => { sxy += (i - xm) * (y - ym); sxx += (i - xm) ** 2; }); const b = sxx ? sxy / sxx : 0; return { a: ym - b * xm, b }; }
const mx = (s) => +d(s);



// ---------- household / ownership helpers ----------
const VEHICLES = { cash: 'Cash', taxable: 'Taxable brokerage', hsa: 'HSA', employer: '403(b) / 401(k)', ira: 'IRA / Roth', trump: 'Trump account', '529': '529', custodial: 'UTMA / custodial' };
async function people() { const s = await D.settings(); return (s.household && s.household.people) || [{ name: 'John' }, { name: 'Begum' }, { name: 'Euphemia', child: true }]; }
function csvDownload(name, rows) {
  const esc = (v) => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const head = Object.keys(rows[0] || {}); const body = [head.join(','), ...rows.map((r) => head.map((k) => esc(r[k])).join(','))].join('\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([body], { type: 'text/csv' })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
function randn() { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
function quantile(arr, q) { const s = [...arr].sort((a, b) => a - b); const i = (s.length - 1) * q, lo = Math.floor(i); return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (i - lo); }
function pmt(principal, annualRate, years) { const r = annualRate / 12, n = years * 12; return r ? (principal * r) / (1 - Math.pow(1 + r, -n)) : principal / n; }

// ---------- Invest › Contributions ----------
VIEWS.contributions = async (view) => {
  const [room, settings, acc] = await Promise.all([rpc('contribution_room'), D.settings(), D.accounts()]);
  const lim = Object.assign({ hsa: 8750, employer: 24500, ira: 7500, trump: 5000 }, settings.limits || {});
  const untagged = acc.filter((a) => a.type === 'investment' && !a.hidden && (!a.vehicle || a.vehicle === 'taxable'));
  view.innerHTML = `
    <h1>Invest</h1>${subnav(INV_NAV, 'contributions')}
    <div class="card">
      <div class="row between wrap"><h2>Contribution room, ${new Date().getFullYear()}</h2><button class="quiet small" id="btn-limits">Limits</button></div>
      <p class="muted small">Year-to-date inflows into each tax-advantaged account against the annual limit. Pace = limit × (months elapsed / 12).</p>
      ${room.length ? `<div class="scroll"><table class="data"><thead><tr><th>Vehicle</th><th>Owner</th><th class="num">Limit</th><th class="num">YTD</th><th class="num">Remaining</th><th class="num">Required / mo</th></tr></thead><tbody>
        ${room.map((r) => `<tr><td>${h(VEHICLES[r.vehicle] || r.vehicle)}<br><span class="muted small">${h(r.account_names)}</span></td><td>${h(r.owner)}</td><td class="num">${r.annual_limit == null ? '—' : money(num(r.annual_limit))}</td><td class="num">${money(num(r.ytd))}</td><td class="num ${r.remaining != null && num(r.remaining) <= 0 ? 'up' : ''}">${r.remaining == null ? '—' : money(Math.max(0, num(r.remaining)))}</td><td class="num ${r.annual_limit != null && !r.on_pace ? 'warn' : ''}">${r.annual_limit == null ? '—' : money(Math.max(0, num(r.required_monthly)))}</td></tr>`).join('')}
      </tbody></table></div>` : '<p class="empty">No tax-advantaged accounts tagged. Set the vehicle on each account from Accounts.</p>'}
      <p class="muted small">Limits: HSA ${money(lim.hsa)} (family) · 403(b)/401(k) ${money(lim.employer)} · IRA ${money(lim.ira)} · Trump account ${money(lim.trump)} per child. 529 and custodial accounts have no federal annual limit.</p>
      ${untagged.length ? `<p class="small warn">Untagged investment accounts: ${untagged.map((a) => h(a.nickname || a.name)).join(', ')}.</p>` : ''}
    </div>`;
  $('#btn-limits').onclick = () => {
    openSheet(`<h2>Annual limits</h2><div class="form">${['hsa', 'employer', 'ira', 'trump'].map((k) => `<label class="field" style="display:flex;align-items:center;justify-content:space-between">${VEHICLES[k]} <input data-lim="${k}" class="short" type="number" inputmode="numeric" value="${lim[k]}" style="width:12ch"></label>`).join('')}
      <div class="actions"><button class="quiet" data-cancel>Cancel</button><button class="primary" data-save>Save</button></div></div>`);
    $('#sheet-body').onclick = async (e) => {
      if (e.target.closest('[data-cancel]')) closeSheet();
      if (e.target.closest('[data-save]')) { const v = {}; $$('[data-lim]').forEach((i) => v[i.dataset.lim] = Number(i.value) || 0); try { await rpc('set_setting', { p_key: 'limits', p_value: v }); closeSheet(); invalidate(); route(); } catch (err) { toast(err.message); } }
    };
  };
};

// ---------- Invest › Strategy ----------
VIEWS.strategy = async (view) => {
  const [room, cc, acc, debts, drift, sum, settings] = await Promise.all([rpc('contribution_room'), rpc('cushion_curve'), D.accounts(), rpc('debt_plan', { p_extra: 0 }), D.drift(), D.summary(), D.settings()]);
  const inv = Object.assign({ hurdle_apr: 8, match_monthly: 0, marginal_tax: 28, mu: 6, sigma: 15, contribution: null, years: 20 }, settings.invest || {});
  const cash = acc.filter((a) => a.type === 'depository' && !a.hidden).reduce((s, a) => s + num(a.available_balance ?? a.current_balance), 0);
  const checking = acc.filter((a) => a.subtype === 'checking' && !a.hidden).reduce((s, a) => s + num(a.available_balance ?? a.current_balance), 0);
  const floor = Math.max(500, num((cc.find((r) => num(r.prevented_pct) >= 100) || cc[cc.length - 1] || {}).cushion) || 0);
  const done = sum.filter((r) => !r.partial).slice(-12);
  const spend12 = done.reduce((s, r) => s + num(r.spending), 0) / Math.max(1, done.length);
  const net12 = done.reduce((s, r) => s + num(r.net), 0) / Math.max(1, done.length);
  const reserve6 = 6 * spend12;
  const investable = acc.filter((a) => a.type === 'investment' && !a.hidden).reduce((s, a) => s + num(a.current_balance), 0);
  const roomOf = (v) => room.filter((r) => r.vehicle === v && r.annual_limit != null);
  const highApr = debts.filter((d) => num(d.apr) >= inv.hurdle_apr);
  const t = inv.marginal_tax / 100;
  const steps = [
    { n: 'Checking floor', why: `floor that prevents 100% of observed overdrafts`, need: Math.max(0, floor - checking), ok: checking >= floor, detail: `${money(checking)} of ${money(floor)}` },
    { n: 'Employer match', why: 'contributions required to capture the full match', need: inv.match_monthly, ok: inv.match_monthly === 0 || roomOf('employer').some((r) => r.on_pace), detail: inv.match_monthly ? money(inv.match_monthly) + '/mo' : 'not set', monthly: true },
    { n: `Debt above ${inv.hurdle_apr}% APR`, why: 'guaranteed after-tax return equal to the APR', need: highApr.reduce((s, d) => s + num(d.balance), 0), ok: !highApr.length, detail: highApr.map((d) => `${h(d.name)} ${fmtPct(d.apr, 2)}`).join(', ') || 'none' },
    { n: 'HSA', why: `pre-tax in, tax-free growth and withdrawal; ${money(1)} costs ${money2(1 - t)} after tax`, need: roomOf('hsa').reduce((s, r) => s + Math.max(0, num(r.remaining)), 0), ok: roomOf('hsa').length > 0 && roomOf('hsa').every((r) => num(r.remaining) <= 0), detail: roomOf('hsa').length ? `${money(roomOf('hsa').reduce((s, r) => s + Math.max(0, num(r.remaining)), 0))} room` : 'no HSA account tagged' },
    { n: '6-month reserve', why: 'liquid cash equal to six months of mean spending', need: Math.max(0, reserve6 - cash), ok: cash >= reserve6, detail: `${money(cash)} of ${money(reserve6)}` },
    { n: 'IRA / Roth', why: 'tax-free growth; Roth preferred at residency-level marginal rates', need: roomOf('ira').reduce((s, r) => s + Math.max(0, num(r.remaining)), 0), ok: roomOf('ira').length > 0 && roomOf('ira').every((r) => num(r.remaining) <= 0), detail: roomOf('ira').length ? `${money(roomOf('ira').reduce((s, r) => s + Math.max(0, num(r.remaining)), 0))} room` : 'no IRA tagged' },
    { n: 'Children’s accounts', why: 'Trump account limit per child, 529 unlimited', need: roomOf('trump').reduce((s, r) => s + Math.max(0, num(r.remaining)), 0), ok: roomOf('trump').length > 0 && roomOf('trump').every((r) => num(r.remaining) <= 0), detail: roomOf('trump').length ? roomOf('trump').map((r) => `${h(r.owner)} ${money(Math.max(0, num(r.remaining)))}`).join(' · ') : 'none tagged' },
    { n: '403(b) beyond match', why: `pre-tax; ${money(1)} costs ${money2(1 - t)} after tax`, need: roomOf('employer').reduce((s, r) => s + Math.max(0, num(r.remaining)), 0), ok: roomOf('employer').length > 0 && roomOf('employer').every((r) => num(r.remaining) <= 0), detail: roomOf('employer').length ? `${money(roomOf('employer').reduce((s, r) => s + Math.max(0, num(r.remaining)), 0))} room` : 'none tagged' },
    { n: 'Taxable brokerage', why: 'after all tax-advantaged room is used', need: null, ok: false, detail: money(investable) + ' invested' },
  ];
  const first = steps.find((s) => !s.ok);
  // contribution-based rebalancing
  const tot = drift.reduce((s, r) => s + num(r.value), 0);
  const hasTarget = drift.some((r) => r.target_pct != null);
  // Monte Carlo
  const contrib = inv.contribution ?? Math.max(0, net12);
  const mc = (() => {
    const N = 1500, M = inv.years * 12, mu = inv.mu / 100, sg = inv.sigma / 100; const paths = [];
    for (let p = 0; p < N; p++) { let v = investable; const row = []; for (let m = 1; m <= M; m++) { v = v * Math.exp((mu - sg * sg / 2) / 12 + (sg / Math.sqrt(12)) * randn()) + contrib; if (m % 12 === 0) row.push(v); } paths.push(row); }
    const yrs = Array.from({ length: inv.years }, (_, i) => i + 1);
    return yrs.map((y) => { const col = paths.map((r) => r[y - 1]); return { y, p10: quantile(col, 0.1), p50: quantile(col, 0.5), p90: quantile(col, 0.9) }; });
  })();
  const fiTarget = 25 * 12 * spend12;
  const fiYear = mc.find((r) => r.p50 >= fiTarget);
  const yr0 = new Date().getFullYear();
  view.innerHTML = `
    <h1>Invest</h1>${subnav(INV_NAV, 'strategy')}
    <div class="card">
      <div class="row between wrap"><h2>Priority of the next dollar</h2><button class="quiet small" id="btn-inv">Assumptions</button></div>
      <p class="muted small">Evaluated against current balances, contribution room and linked debts. Marginal tax ${inv.marginal_tax}%; debt hurdle ${inv.hurdle_apr}% APR.</p>
      <div class="list">${steps.map((s, i) => `<div class="item"><span class="t">${i + 1}. ${h(s.n)} ${s === first ? '<span class="pill warn">next</span>' : s.ok ? '<span class="pill ok">met</span>' : ''}</span><span class="a">${s.need == null ? '' : s.monthly ? money(s.need) + '/mo' : money(s.need)}</span><span class="s">${s.detail} · ${s.why}</span></div>`).join('')}</div>
    </div>
    <div class="grid2">
      <div class="card">
        <h2>Contribution-based rebalancing</h2>
        ${hasTarget ? `<label class="field" style="display:flex;align-items:center;gap:8px">Contribution <input id="rb-amt" class="short" type="number" inputmode="numeric" step="100" value="${Math.round(contrib)}" style="width:12ch"></label>
        <div id="rb-out"></div>` : '<p class="empty">Set a target allocation under Allocation.</p>'}
      </div>
      <div class="card">
        <h2>Financial independence ratio</h2>
        <div class="row wrap"><span class="stat"><span class="v">${spend12 > 0 ? (investable / (12 * spend12)).toFixed(2) + '×' : '—'}</span><span class="l">investable ÷ annual spending</span></span><span style="width:16px"></span><span class="stat"><span class="v">${money(fiTarget)}</span><span class="l">25× annual spending</span></span></div>
        <p class="small">${fiYear ? `Median path reaches 25× in <b>${yr0 + fiYear.y}</b>.` : `Median path does not reach 25× within ${inv.years} years at current inputs.`}</p>
      </div>
    </div>
    <div class="card">
      <h2>Portfolio projection, Monte Carlo</h2>
      <p class="muted small">1,500 lognormal paths; μ ${inv.mu}%, σ ${inv.sigma}% annual; ${money(contrib)}/mo contributed; from ${money(investable)} invested. Band: 10th–90th percentile; line: median.</p>
      ${chart([{ pts: mc.map((r) => ({ x: r.y, y: r.p50 })), band: mc.map((r) => ({ x: r.y, lo: r.p10, hi: r.p90 })), cls: 'line' }], { zero: true, H: 180, fmtX: (x) => String(yr0 + Math.round(x)), xticks: [1, 5, 10, 15, 20].filter((x) => x <= inv.years), refs: fiTarget < (mc[mc.length - 1]?.p90 || 0) ? [{ y: fiTarget, label: '25×' }] : [] })}
      <div class="scroll"><table class="data"><thead><tr><th>Year</th><th class="num">10th</th><th class="num">Median</th><th class="num">90th</th></tr></thead><tbody>
        ${mc.filter((r) => [5, 10, 15, 20].includes(r.y) || r.y === inv.years).map((r) => `<tr><td>${yr0 + r.y}</td><td class="num">${money(r.p10)}</td><td class="num">${money(r.p50)}</td><td class="num">${money(r.p90)}</td></tr>`).join('')}
      </tbody></table></div>
    </div>`;
  const rb = () => { const amt = Number($('#rb-amt')?.value) || 0; if (!hasTarget) return;
    const rows = drift.filter((r) => r.target_pct != null).map((r) => ({ k: r.asset_type, v: num(r.value), tp: num(r.target_pct) / 100 }));
    const T = tot + amt; const def = rows.map((r) => ({ ...r, d: Math.max(0, r.tp * T - r.v) })); const sd = def.reduce((s, r) => s + r.d, 0);
    const alloc = def.map((r) => ({ ...r, buy: sd > 0 ? (amt * r.d) / sd : amt * r.tp }));
    $('#rb-out').innerHTML = `<div class="scroll"><table class="data"><thead><tr><th>Class</th><th class="num">Now</th><th class="num">Target</th><th class="num">Buy</th><th class="num">After</th></tr></thead><tbody>${alloc.map((r) => `<tr><td>${h(TYPE_NAME[r.k] || r.k)}</td><td class="num">${fmtPct(tot ? 100 * r.v / tot : 0)}</td><td class="num">${fmtPct(100 * r.tp)}</td><td class="num"><b>${money(r.buy)}</b></td><td class="num">${fmtPct(T ? 100 * (r.v + r.buy) / T : 0)}</td></tr>`).join('')}</tbody></table></div><p class="muted small">No sales; the contribution is split in proportion to each class's shortfall from target.</p>`; };
  rb(); if ($('#rb-amt')) $('#rb-amt').oninput = rb;
  $('#btn-inv').onclick = () => {
    openSheet(`<h2>Assumptions</h2><div class="form">
      <label class="field">Marginal tax rate % (federal + state) <input id="iv-tax" class="short" type="number" inputmode="decimal" value="${inv.marginal_tax}" style="width:9ch"></label>
      <label class="field">Debt hurdle APR % <input id="iv-h" class="short" type="number" inputmode="decimal" value="${inv.hurdle_apr}" style="width:9ch"></label>
      <label class="field">Contribution needed for full employer match, $/mo <input id="iv-m" class="short" type="number" inputmode="numeric" value="${inv.match_monthly}" style="width:11ch"></label>
      <label class="field">Monthly contribution for projection (blank = mean net cash flow) <input id="iv-c" class="short" type="number" inputmode="numeric" value="${inv.contribution ?? ''}" style="width:12ch"></label>
      <label class="field">Expected return μ % <input id="iv-mu" class="short" type="number" inputmode="decimal" step="0.5" value="${inv.mu}" style="width:9ch"></label>
      <label class="field">Volatility σ % <input id="iv-sg" class="short" type="number" inputmode="decimal" step="0.5" value="${inv.sigma}" style="width:9ch"></label>
      <label class="field">Years <input id="iv-y" class="short" type="number" inputmode="numeric" min="5" max="40" value="${inv.years}" style="width:9ch"></label>
      <div class="actions"><button class="quiet" data-cancel>Cancel</button><button class="primary" data-save>Save</button></div></div>`);
    $('#sheet-body').onclick = async (e) => {
      if (e.target.closest('[data-cancel]')) closeSheet();
      if (e.target.closest('[data-save]')) { const v = { ...inv, marginal_tax: Number($('#iv-tax').value) || 0, hurdle_apr: Number($('#iv-h').value) || 0, match_monthly: Number($('#iv-m').value) || 0, contribution: $('#iv-c').value === '' ? null : Number($('#iv-c').value), mu: Number($('#iv-mu').value) || 0, sigma: Number($('#iv-sg').value) || 0, years: Math.min(40, Math.max(5, Number($('#iv-y').value) || 20)) };
        try { await rpc('set_setting', { p_key: 'invest', p_value: v }); closeSheet(); invalidate(); route(); } catch (err) { toast(err.message); } }
    };
  };
};

// ---------- Plan › Home ----------
VIEWS.home_purchase = async (view) => {
  const settings = await D.settings();
  const proj = Object.assign({ attending_net_monthly: 20000 }, settings.projection || {});
  const p = Object.assign({ gross_annual: Math.round(proj.attending_net_monthly * 12 / 0.68), other_debt_monthly: 0, price: 650000, down_pct: 20, rate: 6.5, term: 30, tax_pct: 1.1, insurance: 2400, hoa: 0, maint_pct: 1, appreciation: 3.5, alt_return: 6, rent: 3200, rent_growth: 3, buy_cost_pct: 2, sell_cost_pct: 6, horizon: 7 }, settings.home || {});
  const calc = () => {
    const gm = p.gross_annual / 12, loan = p.price * (1 - p.down_pct / 100), pi = pmt(loan, p.rate / 100, p.term);
    const piti = pi + (p.price * p.tax_pct / 100) / 12 + p.insurance / 12 + p.hoa;
    const maxFront = 0.28 * gm, maxBack = 0.36 * gm - p.other_debt_monthly;
    const cap = Math.min(maxFront, maxBack);
    // max price such that PITI = cap (iterate)
    let lo = 0, hi = 5e6; for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; const l = mid * (1 - p.down_pct / 100); const m = pmt(l, p.rate / 100, p.term) + (mid * p.tax_pct / 100) / 12 + p.insurance / 12 + p.hoa; if (m > cap) hi = mid; else lo = mid; }
    // rent vs buy over horizon (monthly)
    let bal = loan, home = p.price, rent = p.rent, buyerOut = p.price * p.down_pct / 100 + p.price * p.buy_cost_pct / 100, renterPort = buyerOut;
    const r = p.rate / 100 / 12, ar = p.alt_return / 100 / 12, ap = Math.pow(1 + p.appreciation / 100, 1 / 12), rg = Math.pow(1 + p.rent_growth / 100, 1 / 12);
    let cumOwner = 0, cumRent = 0;
    for (let m = 1; m <= p.horizon * 12; m++) {
      const interest = bal * r, princ = pi - interest; bal -= princ; home *= ap;
      const ownerCost = pi + (home * p.tax_pct / 100) / 12 + p.insurance / 12 + p.hoa + (home * p.maint_pct / 100) / 12;
      renterPort = renterPort * (1 + ar) + (ownerCost - rent); cumOwner += ownerCost; cumRent += rent; rent *= rg;
    }
    const equity = home - bal - home * p.sell_cost_pct / 100;
    return { pi, piti, gm, cap, maxPrice: lo, frontRatio: piti / gm, backRatio: (piti + p.other_debt_monthly) / gm, equity, renterPort, cumOwner, cumRent, home, bal };
  };
  const draw = () => { const c = calc(); $('#hp-out').innerHTML = `
    <div class="row wrap"><span class="stat"><span class="v">${money(c.piti)}</span><span class="l">PITI + HOA / mo</span></span><span style="width:16px"></span><span class="stat"><span class="v ${c.frontRatio > 0.28 ? 'warn' : ''}">${fmtPct(100 * c.frontRatio)}</span><span class="l">front-end ratio (28%)</span></span><span style="width:16px"></span><span class="stat"><span class="v ${c.backRatio > 0.36 ? 'warn' : ''}">${fmtPct(100 * c.backRatio)}</span><span class="l">back-end ratio (36%)</span></span></div>
    <p class="small">Maximum price at 28/36 with ${p.down_pct}% down, ${p.rate}% / ${p.term} yr: <b>${money(c.maxPrice)}</b> (payment cap ${money(c.cap)}/mo on ${money(c.gm)} gross).</p>
    <h3>Buy vs rent, ${p.horizon} years</h3>
    <div class="scroll"><table class="data"><thead><tr><th></th><th class="num">Buy</th><th class="num">Rent</th></tr></thead><tbody>
      <tr><td>Cash out over period</td><td class="num">${money(c.cumOwner)}</td><td class="num">${money(c.cumRent)}</td></tr>
      <tr><td>Position at end</td><td class="num">${money(c.equity)}<br><span class="muted small">equity after ${p.sell_cost_pct}% selling cost</span></td><td class="num">${money(c.renterPort)}<br><span class="muted small">down payment + monthly difference invested at ${p.alt_return}%</span></td></tr>
      <tr><td><b>Advantage</b></td><td class="num ${c.equity >= c.renterPort ? 'up' : ''}">${c.equity >= c.renterPort ? '<b>' + signed(c.equity - c.renterPort) + '</b>' : ''}</td><td class="num ${c.renterPort > c.equity ? 'up' : ''}">${c.renterPort > c.equity ? '<b>' + signed(c.renterPort - c.equity) + '</b>' : ''}</td></tr>
    </tbody></table></div>
    <p class="muted small">Home value ${money(c.home)} at ${p.appreciation}%/yr; loan balance ${money(c.bal)}. Maintenance ${p.maint_pct}% of value per year. Mortgage interest deduction not applied.</p>`; };
  const F = [['gross_annual', 'Gross household income / yr', 11], ['other_debt_monthly', 'Other debt payments / mo', 8], ['price', 'Price', 10], ['down_pct', 'Down %', 5], ['rate', 'Rate %', 6], ['term', 'Term yrs', 5], ['tax_pct', 'Property tax %', 6], ['insurance', 'Insurance / yr', 8], ['hoa', 'HOA / mo', 7], ['maint_pct', 'Maintenance % / yr', 5], ['appreciation', 'Appreciation % / yr', 5], ['alt_return', 'Alternative return %', 5], ['rent', 'Comparable rent / mo', 8], ['rent_growth', 'Rent growth % / yr', 5], ['buy_cost_pct', 'Buying cost %', 5], ['sell_cost_pct', 'Selling cost %', 5], ['horizon', 'Horizon yrs', 5]];
  view.innerHTML = `
    <h1>Plan</h1>${subnav(PLAN_NAV, 'home_purchase')}
    <div class="card">
      <div class="row between wrap"><h2>Home purchase</h2><button class="primary" id="hp-save">Save inputs</button></div>
      <div class="row wrap" style="gap:12px">${F.map(([k, l, w]) => `<label class="field">${l} <input data-hp="${k}" class="short" type="number" inputmode="decimal" value="${p[k]}" style="width:${w + 4}ch"></label>`).join('')}</div>
      <div id="hp-out"></div>
    </div>`;
  draw();
  $$('[data-hp]').forEach((i) => i.oninput = () => { p[i.dataset.hp] = Number(i.value) || 0; draw(); });
  $('#hp-save').onclick = async () => { try { await rpc('set_setting', { p_key: 'home', p_value: p }); toast('Saved.'); invalidate(); } catch (e) { toast(e.message); } };
};

// ---------- Plan › Business ----------
VIEWS.business = async (view) => {
  const rows = await q('v_business', (s) => s.order('month', { ascending: false }));
  const y0 = new Date().getFullYear();
  const ytd = rows.filter((r) => r.month.startsWith(String(y0)));
  const byCat = {}; ytd.forEach((r) => { const c = byCat[r.category] = byCat[r.category] || { expense: 0, revenue: 0, n: 0 }; c.expense += num(r.expense) || 0; c.revenue += num(r.revenue) || 0; c.n += r.n; });
  const months = {}; rows.forEach((r) => { const m = months[r.month] = months[r.month] || { expense: 0, revenue: 0 }; m.expense += num(r.expense) || 0; m.revenue += num(r.revenue) || 0; });
  const exp = Object.values(byCat).reduce((s, c) => s + c.expense, 0), rev = Object.values(byCat).reduce((s, c) => s + c.revenue, 0);
  view.innerHTML = `
    <h1>Plan</h1>${subnav(PLAN_NAV, 'business')}
    <div class="card">
      <div class="row between wrap"><h2>LLC ledger, ${y0}</h2><button class="quiet small" id="biz-export">Export CSV</button></div>
      <p class="muted small">Transactions flagged as business (edit any transaction, or a rule with the business flag). Schedule C categories are the transaction categories.</p>
      <div class="row wrap"><span class="stat"><span class="v">${money2(rev)}</span><span class="l">revenue</span></span><span style="width:16px"></span><span class="stat"><span class="v">${money2(exp)}</span><span class="l">expenses</span></span><span style="width:16px"></span><span class="stat"><span class="v ${rev - exp < 0 ? 'down' : 'up'}">${signed(rev - exp, 2)}</span><span class="l">net</span></span></div>
      ${Object.keys(byCat).length ? `<div class="scroll"><table class="data"><thead><tr><th>Category</th><th class="num">Expense</th><th class="num">Revenue</th><th class="num">n</th></tr></thead><tbody>${Object.entries(byCat).sort((a, b) => b[1].expense - a[1].expense).map(([c, v]) => `<tr><td>${h(c)}</td><td class="num">${money2(v.expense)}</td><td class="num">${money2(v.revenue)}</td><td class="num">${v.n}</td></tr>`).join('')}</tbody></table></div>` : '<p class="empty">No business transactions flagged.</p>'}
    </div>
    ${Object.keys(months).length ? `<div class="card"><h2>By month</h2>${barChart(Object.entries(months).sort().slice(-12).map(([m, v]) => ({ month: m, income: v.revenue, spending: v.expense })), ['income', 'spending'], 640, 150)}<div class="legend"><span><i style="background:var(--up)"></i>Revenue</span><span><i style="background:var(--bar2)"></i>Expenses</span></div></div>` : ''}`;
  $('#biz-export').onclick = async () => { const tx = await q('transactions', (s) => s.eq('business', true).gte('date', y0 + '-01-01').order('date')); if (!tx.length) return toast('No rows.'); csvDownload(`llc-${y0}.csv`, tx.map((t) => ({ date: t.date, merchant: t.merchant_name || t.name, description: t.name, amount: t.amount, category: t.category, account: t.account_id, notes: t.notes || '' }))); };
};

function stdev(xs) { if (xs.length < 2) return 0; const m = xs.reduce((s, x) => s + x, 0) / xs.length; return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1)); }
function titleCase(s) { return String(s || '').replace(/\b\w/g, (c) => c.toUpperCase()).replace(/^Electronic Deposit /, ''); }

async function nameKey(reg, friendlyName) {
  const id = reg?.passkey?.id || reg?.id || reg?.credential_id;
  if (id) await sb.auth.passkey.update({ passkeyId: id, friendlyName }).catch(() => {});
}
function bindGo(el) { el.addEventListener('click', (e) => { const g = e.target.closest('[data-go]'); if (g) location.hash = g.dataset.go; }); }
function relTime(s) { if (!s) return ''; const m = (Date.now() - new Date(s)) / 60000; return m < 2 ? 'just now' : m < 60 ? Math.round(m) + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' d ago'; }

boot();
})();
