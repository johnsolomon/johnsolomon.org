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
const CATEGORIES = ['Groceries', 'Restaurants', 'Coffee', 'Food & drink', 'Shopping', 'Online shopping', 'Kids', 'Rent', 'Rent & utilities', 'Home',
  'Transportation', 'Transit', 'Rideshare', 'Gas', 'Travel', 'Medical', 'Pharmacy', 'Personal care', 'Entertainment', 'Streaming', 'Services',
  'Education', 'Gifts', 'Government & charity', 'Fees', 'Loan payment', 'Student loan', 'Credit card payment', 'Income', 'Transfer', 'Uncategorized'];

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
const TABS = { home: 'home', activity: 'activity', insights: 'insights', cycle: 'insights', trends: 'insights', spending: 'insights', income: 'insights', fees: 'insights', plan: 'plan', budget: 'plan', recurring: 'plan', goals: 'plan', debt: 'plan', future: 'plan', invest: 'invest', holdings: 'invest', allocation: 'invest', contributions: 'invest', strategy: 'invest', home_purchase: 'plan', business: 'plan', accounts: 'top', settings: 'top', cashflow: 'insights', credit: 'plan', more: 'plan' };
function route() {
  if (screens.app.hidden) return;
  const r = (location.hash || '#home').slice(1).split('/')[0];
  state.route = TABS[r] ? r : 'home';
  $$('.tabs a, .topbar a').forEach((a) => a.classList.toggle('on', a.dataset.tab === TABS[state.route] || a.dataset.tab === state.route));
  const view = $('#view');
  view.innerHTML = '<p class="muted">Loading…</p>';
  if (state.route === 'cashflow') state.route = 'insights'; if (state.route === 'credit') state.route = 'debt'; if (state.route === 'more') state.route = 'budget';
  (VIEWS[state.route] || VIEWS.home)(view).catch((e) => { view.innerHTML = '<p class="err">' + h(e.message) + '</p>'; });
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

// ---------- charts (plain SVG) ----------
function barChart(rows, keys, W = 640, H = 180) {
  if (!rows.length) return '<p class="empty">Nothing yet.</p>';
  const m = { t: 8, r: 8, b: 22, l: 44 };
  const max = Math.max(1, ...rows.flatMap((r) => keys.map((k) => num(r[k]) || 0)));
  const nice = niceMax(max);
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const gw = iw / rows.length, bw = (gw * 0.72) / keys.length;
  let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img">`;
  for (let i = 0; i <= 4; i++) { const y = m.t + ih - (ih * i) / 4; s += `<line class="grid" x1="${m.l}" x2="${W - m.r}" y1="${y}" y2="${y}"/><text x="${m.l - 6}" y="${y + 4}" text-anchor="end">${short(nice * i / 4)}</text>`; }
  rows.forEach((r, i) => {
    const x0 = m.l + i * gw + gw * 0.14;
    keys.forEach((k, j) => { const v = num(r[k]) || 0, bh = (ih * v) / nice; s += `<rect class="${k === 'income' ? 'in' : k === 'interest_paid' ? 'bar-muted' : 'out'}" x="${x0 + j * bw}" y="${m.t + ih - bh}" width="${bw - 1}" height="${bh}" rx="2"><title>${h(fmtMonth(r.month))}: ${money2(v)}</title></rect>`; });
    if (rows.length <= 12 || i % 2 === 0) s += `<text x="${m.l + i * gw + gw / 2}" y="${H - 6}" text-anchor="middle">${fmtMon(r.month)}</text>`;
  });
  return s + '</svg>';
}
function lineChart(pts, W = 640, H = 160, fmt = money, yMin0 = false) {
  if (!pts.length) return '<p class="empty">Nothing yet.</p>';
  const m = { t: 10, r: 10, b: 22, l: 48 };
  const vs = pts.map((p) => p.v);
  let lo = Math.min(...vs), hi = Math.max(...vs);
  if (yMin0) lo = Math.min(0, lo);
  const pad = Math.max((hi - lo) * 0.15, hi === lo ? Math.abs(hi) * 0.1 || 10 : 0);
  lo -= pad; hi += pad;
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const xs = pts.map((p) => d(p.t).getTime()); const x0 = Math.min(...xs), x1 = Math.max(...xs) || x0 + 1;
  const X = (t) => m.l + (x1 === x0 ? iw / 2 : (iw * (t - x0)) / (x1 - x0)), Y = (v) => m.t + ih - (ih * (v - lo)) / (hi - lo);
  let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img">`;
  for (let i = 0; i <= 3; i++) { const v = lo + ((hi - lo) * i) / 3, y = Y(v); s += `<line class="grid" x1="${m.l}" x2="${W - m.r}" y1="${y}" y2="${y}"/><text x="${m.l - 6}" y="${y + 4}" text-anchor="end">${short(v)}</text>`; }
  if (lo < 0 && hi > 0) s += `<line class="axis" x1="${m.l}" x2="${W - m.r}" y1="${Y(0)}" y2="${Y(0)}" stroke-dasharray="3 3"/>`;
  const path = pts.map((p, i) => (i ? 'L' : 'M') + X(d(p.t).getTime()).toFixed(1) + ' ' + Y(p.v).toFixed(1)).join(' ');
  s += `<path class="area" d="${path} L${X(x1).toFixed(1)} ${(m.t + ih).toFixed(1)} L${X(x0).toFixed(1)} ${(m.t + ih).toFixed(1)} Z"/><path class="line" d="${path}"/>`;
  const last = pts[pts.length - 1];
  s += `<circle class="dot" cx="${X(d(last.t).getTime())}" cy="${Y(last.v)}" r="3.5"/>`;
  const lx = X(d(last.t).getTime()); s += `<text class="label" x="${Math.min(lx, W - 60)}" y="${Y(last.v) - 8}" text-anchor="${lx > W - 70 ? 'end' : 'start'}">${fmt(last.v)}</text>`;
  const n = Math.min(5, pts.length); for (let i = 0; i < n; i++) { const p = pts[Math.round((i * (pts.length - 1)) / Math.max(1, n - 1))]; s += `<text x="${X(d(p.t).getTime())}" y="${H - 6}" text-anchor="${i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}">${fmtDay(p.t)}</text>`; }
  return s + '</svg>';
}
function niceMax(v) { const p = Math.pow(10, Math.floor(Math.log10(v))); const f = v / p; const n = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10; return n * p; }
function short(v) { const a = Math.abs(v); return (v < 0 ? '−' : '') + (a >= 1e6 ? (a / 1e6).toFixed(1) + 'M' : a >= 1e3 ? (a / 1e3).toFixed(a >= 1e4 ? 0 : 1) + 'k' : a.toFixed(0)); }
function progress(v, max, cls = '') { const p = max > 0 ? Math.min(100, (100 * v) / max) : 0; return `<div class="bar"><i class="${cls}" style="width:${p.toFixed(1)}%"></i></div>`; }

// ---------- sheet ----------
function openSheet(html) { $('#sheet-body').innerHTML = html; $('#sheet').hidden = false; }
function closeSheet() { $('#sheet').hidden = true; $('#sheet-body').innerHTML = ''; }
$('#sheet').addEventListener('click', (e) => { if (e.target === $('#sheet')) closeSheet(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });
const catOptions = (sel) => CATEGORIES.map((c) => `<option ${c === sel ? 'selected' : ''}>${h(c)}</option>`).join('');

// ---------- views ----------
const VIEWS = {};

VIEWS.home = async (view) => {
  const [nw, nwh, cf, acc, rec, spend, ls, fc, al] = await Promise.all([D.nw(), D.nwh(), D.cashflow(), D.accounts(), D.recurring().catch(() => []), D.spend(), D.lastSync(), rpc('cash_forecast', { p_days: 30 }).catch(() => []), rpc('alerts').catch(() => [])]);
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
    </div>`;
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
      <select id="f-cat" aria-label="Category"><option value="">All categories</option>${CATEGORIES.map((c) => `<option ${c === preset ? 'selected' : ''}>${h(c)}</option>`).join('')}</select>
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
        <span class="s">${h(t.category || 'Uncategorized')}${t.is_transfer && t.category !== 'Transfer' ? ' · transfer' : ''} · ${h(accName[t.account_id] || '')}${t.notes ? ' · ' + h(t.notes) : ''}</span>
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
        if ($('#e-rule').checked) await rpc('add_rule', { p_match: t.merchant_name || t.name, p_category: cat, p_is_transfer: tr, p_excluded: ex, p_business: $('#e-biz').checked });
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
const INS_NAV = [['insights', 'Cash'], ['cycle', 'Pay cycle'], ['trends', 'Trends'], ['spending', 'Spending'], ['income', 'Income'], ['fees', 'Fees']];
const fmtPct = (n, d = 0) => n == null || isNaN(n) ? '—' : Number(n).toFixed(d) + '%';
const dayOfMonth = new Date().getDate();

VIEWS.insights = async (view) => {
  const [fc, sum, nwm, acc] = await Promise.all([rpc('cash_forecast', { p_days: 45 }), D.summary(), D.nwm(), D.accounts()]);
  const cash = acc.filter((a) => a.type === 'depository' && !a.hidden).reduce((s, a) => s + num(a.available_balance ?? a.current_balance), 0);
  const low = fc.reduce((m, r) => (num(r.balance) < num(m.balance) ? r : m), fc[0]);
  const below = fc.filter((r) => num(r.balance) < 0).length;
  const done = sum.filter((r) => !r.partial);
  const last12 = done.slice(-12), last3 = done.slice(-3), last6 = done.slice(-6);
  const rate = (rows) => { const i = rows.reduce((s, r) => s + num(r.income), 0), n = rows.reduce((s, r) => s + num(r.net), 0); return i > 0 ? (100 * n) / i : null; };
  const spend12 = last12.reduce((s, r) => s + num(r.spending), 0) / Math.max(1, last12.length);
  const runway = spend12 > 0 ? cash / spend12 : null;
  const sdNet = stdev(last12.map((r) => num(r.net)));
  const events = fc.filter((r) => r.events && r.events.length).slice(0, 8);
  view.innerHTML = `
    <h1>Insights</h1>${subnav(INS_NAV, 'insights')}
    <div class="grid2">
      <div class="card">
        <div class="row between"><h2>Cash forecast, 45 days</h2><span class="stat"><span class="v">${money(cash)}</span><span class="l">available</span></span></div>
        ${lineChart(fc.map((r) => ({ t: r.as_of, v: num(r.balance) })), 640, 150, money, true)}
        <p class="small">Minimum <b class="${num(low.balance) < 0 ? 'down' : num(low.balance) < 300 ? 'warn' : ''}">${money(num(low.balance))}</b> on ${fmtDayLong(low.as_of)}${below ? ` · <span class="down">${below} day${below > 1 ? 's' : ''} negative</span>` : ''}</p>
        <p class="muted small">Method: scheduled income and recurring charges at expected dates, card minimums at due dates, plus trailing-90-day mean daily discretionary spend. Internal transfers excluded.</p>
        <div class="list">${events.map((r) => `<div class="item"><span class="t">${r.events.map(h).join(', ')}</span><span class="a ${num(r.inflow) > num(r.outflow) ? 'up' : ''}">${signed(num(r.inflow) - num(r.outflow), 0)}</span><span class="s">${fmtDayLong(r.as_of)} · balance after ${money(num(r.balance))}</span></div>`).join('')}</div>
      </div>
      <div class="card">
        <h2>Savings rate</h2>
        <div class="row wrap">
          <span class="stat"><span class="v ${rate(last3) < 0 ? 'down' : ''}">${fmtPct(rate(last3))}</span><span class="l">3 mo</span></span><span style="width:16px"></span>
          <span class="stat"><span class="v ${rate(last6) < 0 ? 'down' : ''}">${fmtPct(rate(last6))}</span><span class="l">6 mo</span></span><span style="width:16px"></span>
          <span class="stat"><span class="v ${rate(last12) < 0 ? 'down' : ''}">${fmtPct(rate(last12))}</span><span class="l">12 mo</span></span>
        </div>
        <p class="muted small">(income − spending) / income. Card purchases count at purchase; card payments and transfers excluded.</p>
        ${barChart(last12.map((r) => ({ month: r.month, income: num(r.income), spending: num(r.spending) })), ['income', 'spending'])}
        <div class="row wrap"><span class="stat"><span class="v">${runway == null ? '—' : runway.toFixed(1) + ' mo'}</span><span class="l">runway: cash / mean monthly spending</span></span><span style="width:16px"></span><span class="stat"><span class="v">${money(sdNet)}</span><span class="l">σ of monthly net cash flow</span></span></div>
      </div>
    </div>
    <div class="card">
      <h2>Monthly cash flow</h2>
      <div class="scroll"><table class="data"><thead><tr><th>Month</th><th class="num">Income</th><th class="num">Spending</th><th class="num">Net</th><th class="num">Rate</th></tr></thead><tbody>
        ${sum.slice(-13).reverse().map((r) => `<tr><td>${fmtMonth(r.month)}${r.partial ? ' <span class="muted">MTD</span>' : ''}</td><td class="num">${money(num(r.income))}</td><td class="num">${money(num(r.spending))}</td><td class="num ${num(r.net) < 0 ? 'down' : 'up'}">${signed(num(r.net))}</td><td class="num">${fmtPct(r.savings_rate_pct)}</td></tr>`).join('')}
      </tbody></table></div>
    </div>
    ${nwm.length > 1 ? `<div class="card"><h2>Net worth attribution</h2>
      <div class="scroll"><table class="data"><thead><tr><th>Month</th><th class="num">Net worth</th><th class="num">Change</th><th class="num">Net cash flow</th><th class="num">Debt reduction</th><th class="num">Investment change</th></tr></thead><tbody>
        ${nwm.slice(-12).reverse().map((r) => `<tr><td>${fmtMonth(r.month)}</td><td class="num">${money(num(r.net_worth))}</td><td class="num ${num(r.change) < 0 ? 'down' : 'up'}">${r.change == null ? '—' : signed(num(r.change))}</td><td class="num">${signed(num(r.saved))}</td><td class="num">${r.debt_paid_down == null ? '—' : signed(num(r.debt_paid_down))}</td><td class="num">${r.investment_change == null ? '—' : signed(num(r.investment_change))}</td></tr>`).join('')}
      </tbody></table></div>
      <p class="muted small">From daily balance snapshots.</p></div>` : ''}`;
};

VIEWS.spending = async (view) => {
  const [cs, ms, wd] = await Promise.all([rpc('category_stats', { p_months: 12 }), rpc('merchant_stats', { p_days: 90 }), D.weekday()]);
  const early = dayOfMonth < 5;
  const flagged = early ? [] : cs.filter((c) => Math.abs(num(c.z)) >= 1.5 && num(c.mean_month) > 50);
  const wmax = Math.max(1, ...wd.map((r) => num(r.per_day)));
  view.innerHTML = `
    <h1>Insights</h1>${subnav(INS_NAV, 'spending')}
    ${flagged.length ? `<div class="card"><h2>Outside normal range, month to date</h2><div class="list">${flagged.map((c) => `<div class="item tap" data-go="#activity/${encodeURIComponent(c.category)}"><span class="t">${h(c.category)}</span><span class="a ${num(c.z) > 0 ? 'down' : 'up'}">${money(num(c.this_month_projected))} <span class="s">projected · mean ${money(num(c.mean_month))}</span></span><span class="s">z = ${num(c.z) > 0 ? '+' : '−'}${Math.abs(num(c.z)).toFixed(1)}</span></div>`).join('')}</div></div>` : ''}
    <div class="card">
      <h2>Category statistics, trailing 12 complete months</h2>
      <p class="muted small">Mean ± SD of monthly spend. Projected = month to date scaled to a full month${early ? ' (insufficient days)' : ''}. Trend = OLS slope per month as % of mean.</p>
      <div class="scroll"><table class="data"><thead><tr><th>Category</th><th class="num">Share</th><th class="num">Mean ± SD</th><th class="num">Projected</th><th class="num">Trend</th></tr></thead><tbody>
        ${cs.filter((c) => num(c.last_12m) > 0).map((c) => `<tr class="tap" data-go="#activity/${encodeURIComponent(c.category)}"><td>${h(c.category)}</td><td class="num">${fmtPct(c.share_pct)}</td><td class="num">${money(num(c.mean_month))} <span class="muted">± ${money(num(c.sd_month))}</span></td><td class="num ${!early && num(c.z) >= 1.5 ? 'down' : ''}">${early ? '—' : money(num(c.this_month_projected))}</td><td class="num ${num(c.trend_pct_per_month) > 3 ? 'warn' : ''}">${c.trend_pct_per_month == null ? '—' : pct(num(c.trend_pct_per_month)) + '/mo'}</td></tr>`).join('')}
      </tbody></table></div>
    </div>
    <div class="grid2">
      <div class="card">
        <h2>Merchants, trailing 90 days</h2>
        <div class="list">${ms.slice(0, 15).map((m) => `<div class="item"><span class="t">${h(m.merchant)}</span><span class="a">${money(num(m.total))}<span class="s">${fmtPct(m.share_pct)} · ${m.n}×</span></span><span class="s">${m.change_pct == null ? 'no prior-period spend' : (num(m.change_pct) >= 0 ? '<span class="warn">+' : '<span class="up">') + Math.abs(num(m.change_pct)).toFixed(0) + '%</span> vs prior 90 days'}</span></div>`).join('')}</div>
      </div>
      <div class="card">
        <h2>Spend by weekday</h2>
        <p class="muted small">Mean spend per active day, trailing 6 months.</p>
        <div class="list">${wd.map((r) => `<div class="item"><span class="t">${h(r.weekday)}</span><span class="a">${money(num(r.per_day))}</span><span class="s" style="grid-column:1/-1">${progress(num(r.per_day), wmax)}</span></div>`).join('')}</div>
      </div>
    </div>`;
  bindGo(view);
};

VIEWS.income = async (view) => {
  const [src, sum] = await Promise.all([rpc('income_sources'), D.summary()]);
  const active = src.filter((s) => d(s.last_date) >= new Date(Date.now() - 75 * 864e5));
  const monthly = active.reduce((s, r) => s + num(r.monthly_equiv), 0);
  const done = sum.filter((r) => !r.partial).slice(-12);
  view.innerHTML = `
    <h1>Insights</h1>${subnav(INS_NAV, 'income')}
    <div class="card">
      <div class="row between wrap"><h2>Income sources</h2><span class="stat"><span class="v">${money(monthly)}</span><span class="l">monthly equivalent, active</span></span></div>
      <div class="list">${src.map((s) => `<div class="item"><span class="t">${h(titleCase(s.source))}${d(s.last_date) < new Date(Date.now() - 75 * 864e5) ? ' <span class="pill">inactive</span>' : ''}</span><span class="a">${money2(num(s.typical_amount))}<span class="s">${h(s.cadence)}</span></span><span class="s">${s.occurrences}× · last ${fmtDay(s.last_date)}${s.next_expected && d(s.next_expected) >= d(today()) ? ' · next ' + fmtDay(s.next_expected) : ''}${s.trend_pct_per_month ? ' · ' + pct(num(s.trend_pct_per_month)) + '/mo trend' : ''}</span></div>`).join('') || '<p class="empty">No recurring deposits detected.</p>'}</div>
      <p class="muted small">Grouped by payer; cadence from median interval. Internal transfers excluded.</p>
    </div>
    <div class="card"><h2>Income by month</h2>${barChart(done.map((r) => ({ month: r.month, income: num(r.income) })), ['income'])}</div>`;
};

VIEWS.fees = async (view) => {
  const [fa, fees, acc] = await Promise.all([rpc('fee_analysis'), D.fees(), D.accounts()]);
  const f = fa[0] || {};
  const cards = acc.filter((a) => a.type === 'credit' && !a.hidden);
  const util = cards.reduce((s, a) => s + num(a.current_balance), 0), limit = cards.reduce((s, a) => s + (num(a.credit_limit) || 0), 0);
  view.innerHTML = `
    <h1>Insights</h1>${subnav(INS_NAV, 'fees')}
    <div class="card">
      <h2>Fees and interest, trailing 12 months</h2>
      <div class="row wrap"><span class="stat"><span class="v ${num(f.fees_12m) ? 'down' : ''}">${money2(num(f.fees_12m))}</span><span class="l">${f.fee_count_12m || 0} fees</span></span><span style="width:16px"></span><span class="stat"><span class="v ${num(f.overdrafts_12m) ? 'down' : ''}">${money2(num(f.overdrafts_12m))}</span><span class="l">${f.overdraft_count_12m || 0} overdrafts</span></span><span style="width:16px"></span><span class="stat"><span class="v">${money2(num(f.interest_12m))}</span><span class="l">card interest</span></span></div>
      ${f.overdraft_count_12m ? `<p class="small">Median overdraft timing: <b>${f.median_days_before_payday} day${f.median_days_before_payday == 1 ? '' : 's'}</b> before payday. Peak month: ${h(f.worst_month)} (${money(num(f.worst_month_fees))}).</p>` : ''}
      ${barChart(fees.map((r) => ({ month: r.month, fees: num(r.fees), interest_paid: num(r.interest_paid) })), ['fees', 'interest_paid'], 640, 140)}
      <div class="legend"><span><i style="background:var(--bar2)"></i>Fees</span><span><i style="background:var(--bar)"></i>Interest</span></div>
    </div>
    ${limit ? `<div class="card"><h2>Credit utilization</h2><p class="small">${money(util)} of ${money(limit)} · <b class="${util / limit > 0.3 ? 'warn' : 'up'}">${(100 * util / limit).toFixed(0)}%</b> <span class="muted">(scoring thresholds 30%, 10%)</span></p>
      <div class="list">${cards.map((a) => `<div class="item"><span class="t">${h(a.nickname || a.name)}</span><span class="a">${money(num(a.current_balance))}<span class="s">of ${money(num(a.credit_limit))}</span></span><span class="s" style="grid-column:1/-1">${progress(num(a.current_balance), num(a.credit_limit), num(a.current_balance) / num(a.credit_limit) > 0.3 ? 'over' : 'ok')}</span></div>`).join('')}</div></div>` : ''}`;
};

// ---------- Plan: debt & credit, future ----------
VIEWS.debt = async (view) => {
  const [credit, acc] = await Promise.all([D.credit(), D.accounts()]);
  const last = credit[credit.length - 1], prev = credit[credit.length - 2];
  const unl = (await D.rules()).filter((r) => r.category === 'Card payment (not linked)').map((r) => r.match);
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
    <div class="card">
      <div class="row between wrap"><div class="hero"><span class="label">Credit score</span><span class="big">${last ? last.score : '—'}</span><span class="muted small">${last ? `${h(last.bureau || '')} ${fmtDay(last.as_of)}${prev ? ` · <span class="${last.score - prev.score >= 0 ? 'up' : 'down'}">${last.score - prev.score >= 0 ? '+' : ''}${last.score - prev.score}</span> since ${fmtDay(prev.as_of)}` : ''}` : 'No score logged'}</span></div><button class="primary" id="btn-score">Log score</button></div>
      ${credit.length > 1 ? lineChart(credit.map((c) => ({ t: c.as_of, v: c.score })), 640, 150, (v) => String(Math.round(v))) : ''}
    </div>`;
  await draw();
  let t; $('#debt-extra').oninput = (e) => { extra = Math.max(0, Number(e.target.value) || 0); localStorage.setItem('debt_extra', String(extra)); clearTimeout(t); t = setTimeout(draw, 350); };
  $('#btn-score').onclick = () => {
    openSheet(`<h2>Log credit score</h2><div class="form">
      <label class="field">Score <input id="c-score" class="short" type="number" inputmode="numeric" min="300" max="850" value="${last ? last.score : ''}"></label>
      <label class="field">Date <input id="c-date" type="date" value="${today()}" style="width:auto"></label>
      <label class="field">Bureau <select id="c-bureau" style="width:auto"><option>Experian</option><option>Equifax</option><option>TransUnion</option></select></label>
      <label class="field">Source <input id="c-src" type="text" size="16" value="${h(last?.source || 'Amex app')}"></label>
      <div class="actions"><button class="quiet" data-cancel>Cancel</button><button class="primary" data-save>Save</button></div></div>`);
    if (last?.bureau) $('#c-bureau').value = last.bureau;
    $('#sheet-body').onclick = async (e) => {
      if (e.target.closest('[data-cancel]')) closeSheet();
      if (e.target.closest('[data-save]')) { const s = Number($('#c-score').value); if (!(s >= 300 && s <= 850)) return toast('Score must be 300–850.');
        try { await rpc('log_credit_score', { p_as_of: $('#c-date').value, p_score: s, p_bureau: $('#c-bureau').value, p_source: $('#c-src').value }); closeSheet(); invalidate(); route(); } catch (err) { toast(err.message); } }
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

// ---------- multi-series chart: lines, optional band, dashed fits, markers, bars ----------
// series: [{pts:[{x,y}], cls:'line'|'line alt'|'fit', band:[{x,lo,hi}], marks:[{x,y,label}], bars:true}]
function chart(series, o = {}) {
  const W = o.W || 640, H = o.H || 170, m = { t: 12, r: 10, b: 24, l: 48 };
  const all = series.flatMap((s) => [...(s.pts || []), ...((s.band || []).flatMap((b) => [{ x: b.x, y: b.lo }, { x: b.x, y: b.hi }]))]).filter((p) => p.y != null && !isNaN(p.y));
  if (!all.length) return '<p class="empty">Nothing yet.</p>';
  const xs = all.map((p) => +p.x); let x0 = Math.min(...xs), x1 = Math.max(...xs); if (x1 === x0) x1 = x0 + 1;
  let lo = Math.min(...all.map((p) => p.y)), hi = Math.max(...all.map((p) => p.y));
  if (o.zero) lo = Math.min(0, lo); if (o.yMax != null) hi = Math.max(hi, o.yMax);
  const pad = (hi - lo) * 0.08 || Math.abs(hi) * 0.1 || 10; lo -= o.zero && lo === 0 ? 0 : pad; hi += pad;
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const X = (x) => m.l + (iw * (+x - x0)) / (x1 - x0), Y = (y) => m.t + ih - (ih * (y - lo)) / (hi - lo);
  const fmtY = o.fmtY || short, fmtX = o.fmtX || ((x) => fmtDay(iso(new Date(+x))));
  let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img">`;
  for (let i = 0; i <= 3; i++) { const v = lo + ((hi - lo) * i) / 3; s += `<line class="grid" x1="${m.l}" x2="${W - m.r}" y1="${Y(v)}" y2="${Y(v)}"/><text x="${m.l - 6}" y="${Y(v) + 4}" text-anchor="end">${fmtY(v)}</text>`; }
  if (lo < 0 && hi > 0) s += `<line class="axis" x1="${m.l}" x2="${W - m.r}" y1="${Y(0)}" y2="${Y(0)}"/>`;
  for (const ref of o.refs || []) s += `<line class="ref" x1="${m.l}" x2="${W - m.r}" y1="${Y(ref.y)}" y2="${Y(ref.y)}" stroke-dasharray="4 4"/><text class="reflabel" x="${W - m.r}" y="${Y(ref.y) - 4}" text-anchor="end">${h(ref.label)}</text>`;
  for (const sr of series) {
    if (sr.band) { const b = sr.band.filter((p) => p.lo != null); s += `<path class="band" d="${b.map((p, i) => (i ? 'L' : 'M') + X(p.x).toFixed(1) + ' ' + Y(p.hi).toFixed(1)).join(' ')} ${[...b].reverse().map((p) => 'L' + X(p.x).toFixed(1) + ' ' + Y(p.lo).toFixed(1)).join(' ')} Z"/>`; }
    if (sr.bars) { const bw = Math.max(2, (iw / sr.pts.length) * 0.6); for (const p of sr.pts) s += `<rect class="${sr.cls || 'out'}" x="${X(p.x) - bw / 2}" y="${Math.min(Y(p.y), Y(0))}" width="${bw}" height="${Math.abs(Y(p.y) - Y(0))}" rx="2"><title>${fmtX(p.x)}: ${fmtY(p.y)}</title></rect>`; continue; }
    if (sr.pts && sr.pts.length) { const pts = sr.pts.filter((p) => p.y != null); s += `<path class="${sr.cls || 'line'}" d="${pts.map((p, i) => (i ? 'L' : 'M') + X(p.x).toFixed(1) + ' ' + Y(p.y).toFixed(1)).join(' ')}"/>`;
      if (sr.label) { const l = pts[pts.length - 1]; s += `<text class="label" x="${Math.min(X(l.x), W - 70)}" y="${Y(l.y) - 6}" text-anchor="${X(l.x) > W - 80 ? 'end' : 'start'}">${h(sr.label)}</text>`; } }
    for (const mk of sr.marks || []) s += `<circle class="mark" cx="${X(mk.x)}" cy="${Y(mk.y)}" r="3"><title>${h(mk.label || '')}</title></circle>`;
  }
  const n = Math.min(o.ticks || 5, all.length); const xt = o.xticks || Array.from({ length: n }, (_, i) => x0 + ((x1 - x0) * i) / Math.max(1, n - 1));
  xt.forEach((x, i) => { s += `<text x="${X(x)}" y="${H - 6}" text-anchor="${i === 0 ? 'start' : i === xt.length - 1 ? 'end' : 'middle'}">${fmtX(x)}</text>`; });
  return s + '</svg>';
}
function linfit(ys) { const n = ys.length; if (n < 2) return { a: ys[0] || 0, b: 0 }; const xm = (n - 1) / 2, ym = ys.reduce((s, y) => s + y, 0) / n; let sxy = 0, sxx = 0; ys.forEach((y, i) => { sxy += (i - xm) * (y - ym); sxx += (i - xm) ** 2; }); const b = sxx ? sxy / sxx : 0; return { a: ym - b * xm, b }; }
const mx = (s) => +d(s);

// ---------- Insights › Cycle ----------
VIEWS.cycle = async (view) => {
  const [pc, cc, db] = await Promise.all([rpc('paycycle_profile'), rpc('cushion_curve'), rpc('daily_balance', { p_days: 600, p_scope: 'checking' })]);
  const n = pc.length ? pc[0].cycle_days : 14;
  const worst = pc.reduce((m, r) => (num(r.pct_days_negative) > num(m.pct_days_negative) ? r : m), pc[0] || {});
  const first = pc[0] || {}, last = pc[pc.length - 1] || {};
  const spendEarly = pc.slice(0, Math.ceil(n / 2)).reduce((s, r) => s + num(r.spend_per_day), 0), spendLate = pc.slice(Math.ceil(n / 2)).reduce((s, r) => s + num(r.spend_per_day), 0);
  const ev = cc[0]?.events || 0;
  const c70 = cc.find((r) => num(r.prevented_pct) >= 70), c100 = cc.find((r) => num(r.prevented_pct) >= 100);
  const od = db.filter((r) => r.overdraft);
  const roll = db.map((r, i) => ({ x: mx(r.as_of), y: db.slice(Math.max(0, i - 29), i + 1).reduce((s, q) => s + num(q.balance), 0) / Math.min(i + 1, 30) }));
  const byMonth = {}; db.forEach((r) => { const k = r.as_of.slice(0, 7); (byMonth[k] = byMonth[k] || []).push(num(r.balance)); });
  const months = Object.keys(byMonth).sort();
  const avgSeries = months.map((k) => ({ x: mx(k + '-15'), y: byMonth[k].reduce((s, v) => s + v, 0) / byMonth[k].length }));
  const minSeries = months.map((k) => ({ x: mx(k + '-15'), y: Math.min(...byMonth[k]) }));
  const peak = avgSeries.reduce((m, p) => (p.y > m.y ? p : m), avgSeries[0]), recent = avgSeries.slice(-3).reduce((s, p) => s + p.y, 0) / 3;
  view.innerHTML = `
    <h1>Insights</h1>${subnav(INS_NAV, 'cycle')}
    <div class="card">
      <h2>Checking balance by day of pay cycle (${n} days)</h2>
      <p class="muted small">Day 0 = ${h(titleCase(first.source || 'main'))} deposit. Median with 10th–90th percentile band, trailing 20 months.</p>
      ${chart([{ pts: pc.map((r) => ({ x: r.day_in_cycle, y: num(r.median_balance) })), band: pc.map((r) => ({ x: r.day_in_cycle, lo: num(r.p10_balance), hi: num(r.p90_balance) })), cls: 'line' }], { zero: true, fmtX: (x) => 'day ' + Math.round(x), xticks: pc.map((r) => r.day_in_cycle).filter((x) => x % 2 === 0), fmtY: short })}
      <div class="row wrap"><span class="stat"><span class="v">${money(num(first.median_balance))}</span><span class="l">median, day 0</span></span><span style="width:16px"></span><span class="stat"><span class="v ${num(last.median_balance) < 200 ? 'down' : ''}">${money(num(last.median_balance))}</span><span class="l">median, day ${last.day_in_cycle}</span></span><span style="width:16px"></span><span class="stat"><span class="v down">${fmtPct(worst.pct_days_negative)}</span><span class="l">negative on day ${worst.day_in_cycle}</span></span></div>
      <h3>Probability of negative balance by cycle day</h3>
      ${chart([{ pts: pc.map((r) => ({ x: r.day_in_cycle, y: num(r.pct_days_negative) })), bars: true, cls: 'out' }], { zero: true, H: 120, fmtX: (x) => 'day ' + Math.round(x), xticks: pc.map((r) => r.day_in_cycle).filter((x) => x % 2 === 0), fmtY: (v) => v.toFixed(0) + '%' })}
      <h3>Spend rate by cycle day</h3>
      <p class="muted small">Mean daily spend, all accounts. First half ${money(spendEarly)}, second half ${money(spendLate)}.</p>
      ${chart([{ pts: pc.map((r) => ({ x: r.day_in_cycle, y: num(r.spend_per_day) })), bars: true, cls: 'out' }], { zero: true, H: 120, fmtX: (x) => 'day ' + Math.round(x), xticks: pc.map((r) => r.day_in_cycle).filter((x) => x % 2 === 0), fmtY: short })}
    </div>
    <div class="grid2">
      <div class="card">
        <h2>Overdraft prevention by cash floor</h2>
        <p class="muted small">Share of the ${ev} overdraft days (trailing 12 months) avoided by a standing checking floor, from observed overdraft depth.</p>
        ${chart([{ pts: cc.map((r) => ({ x: num(r.cushion), y: num(r.prevented_pct) })), cls: 'line' }], { zero: true, yMax: 100, H: 150, fmtX: (x) => money(x), xticks: [0, 250, 500, 750, 1000], fmtY: (v) => v.toFixed(0) + '%' })}
        ${c70 ? `<p class="small"><b>${money(num(c70.cushion))}</b> floor: ${fmtPct(c70.prevented_pct)} prevented, ${money(num(c70.fees_saved))} fees${c100 ? `. <b>${money(num(c100.cushion))}</b>: 100%, ${money(num(c100.fees_saved))}.` : '.'}</p>` : ''}
      </div>
      <div class="card">
        <h2>Checking balance, trailing 20 months</h2>
        <p class="muted small">Reconstructed from the ledger. Grey: daily; blue: 30-day mean; markers: overdraft fees.</p>
        ${chart([{ pts: db.map((r) => ({ x: mx(r.as_of), y: num(r.balance) })), cls: 'line thin' }, { pts: roll, cls: 'line', marks: od.map((r) => ({ x: mx(r.as_of), y: num(r.balance), label: fmtDay(r.as_of) + ' ' + money2(num(r.fee)) })) }], { zero: true, H: 170 })}
        <p class="small">Monthly mean peaked at <b>${money(peak.y)}</b> (${fmtMonth(iso(new Date(peak.x)))}); trailing 3-month mean <b>${money(recent)}</b>.</p>
        ${chart([{ pts: avgSeries, cls: 'line', label: 'monthly mean' }, { pts: minSeries, cls: 'line alt', label: 'monthly minimum' }], { zero: true, H: 140 })}
      </div>
    </div>`;
};

// ---------- Insights › Trends ----------
VIEWS.trends = async (view) => {
  const [cat, mer, sum, counts, cards] = await Promise.all([rpc('trend_series', { p_kind: 'category', p_top: 6, p_months: 18 }), rpc('trend_series', { p_kind: 'merchant', p_top: 4, p_months: 18 }), D.summary(), D.counts(), rpc('card_history', { p_weeks: 78 })]);
  const done = sum.filter((r) => !r.partial).slice(-18);
  const inc = done.map((r) => num(r.income)), sp = done.map((r) => num(r.spending));
  const fi = linfit(inc), fs = linfit(sp);
  const r3 = (arr) => arr.map((_, i) => arr.slice(Math.max(0, i - 2), i + 1).reduce((s, v) => s + v, 0) / Math.min(i + 1, 3));
  const gapNow = fi.a + fi.b * (inc.length - 1) - (fs.a + fs.b * (sp.length - 1)), gap6 = fi.a + fi.b * (inc.length + 5) - (fs.a + fs.b * (sp.length + 5));
  let cum = 0; const cumPts = done.map((r) => ({ x: mx(r.month), y: (cum += num(r.net)) }));
  const panel = (rows) => { const by = {}; rows.forEach((r) => (by[r.name] = by[r.name] || []).push(r)); return Object.entries(by).map(([name, rs]) => {
    const slope = num(rs[0].slope_per_month), mean = rs.reduce((s, r) => s + num(r.spent), 0) / rs.length;
    return `<div class="card"><div class="row between"><h3>${h(name)}</h3><span class="small ${slope > mean * 0.03 ? 'warn' : slope < -mean * 0.03 ? 'up' : 'muted'}">slope ${slope >= 0 ? '+' : '−'}${money(Math.abs(slope))}/mo</span></div>
      ${chart([{ pts: rs.map((r) => ({ x: mx(r.month), y: num(r.spent) })), bars: true, cls: 'bar-muted' }, { pts: rs.map((r) => ({ x: mx(r.month), y: num(r.roll3) })), cls: 'line' }, { pts: rs.map((r) => ({ x: mx(r.month), y: num(r.fit) })), cls: 'fit' }], { zero: true, H: 130, fmtX: (x) => fmtMon(iso(new Date(+x))), ticks: 4 })}
      <p class="muted small">mean ${money(mean)}/mo · last ${money(num(rs[rs.length - 1].spent))}</p></div>`; }).join(''); };
  const cardBy = {}; cards.forEach((r) => (cardBy[r.name] = cardBy[r.name] || []).push(r));
  view.innerHTML = `
    <h1>Insights</h1>${subnav(INS_NAV, 'trends')}
    <div class="card">
      <h2>Income vs spending, trend</h2>
      <p class="muted small">Solid: 3-month rolling mean. Dashed: OLS fit over ${done.length} months, extended 6. Fitted gap: <b class="${gapNow < 0 ? 'down' : 'up'}">${signed(gapNow)}</b> now, <b class="${gap6 < 0 ? 'down' : 'up'}">${signed(gap6)}</b> at +6 months.</p>
      ${chart([
        { pts: done.map((r, i) => ({ x: mx(r.month), y: r3(inc)[i] })), cls: 'line in', label: 'income' },
        { pts: done.map((r, i) => ({ x: mx(r.month), y: r3(sp)[i] })), cls: 'line', label: 'spending' },
        { pts: [...done.map((r, i) => ({ x: mx(r.month), y: fi.a + fi.b * i })), ...[1, 2, 3, 4, 5, 6].map((k) => ({ x: +new Date(d(done[done.length - 1].month).getFullYear(), d(done[done.length - 1].month).getMonth() + k, 1), y: fi.a + fi.b * (inc.length - 1 + k) }))], cls: 'fit in' },
        { pts: [...done.map((r, i) => ({ x: mx(r.month), y: fs.a + fs.b * i })), ...[1, 2, 3, 4, 5, 6].map((k) => ({ x: +new Date(d(done[done.length - 1].month).getFullYear(), d(done[done.length - 1].month).getMonth() + k, 1), y: fs.a + fs.b * (sp.length - 1 + k) }))], cls: 'fit' }],
        { zero: true, H: 180, fmtX: (x) => fmtMon(iso(new Date(+x))), ticks: 6 })}
      <div class="legend"><span><i style="background:var(--up)"></i>Income</span><span><i style="background:var(--bar2)"></i>Spending</span><span><i style="background:var(--muted)"></i>Fitted line</span></div>
    </div>
    <div class="grid2">
      <div class="card"><h2>Cumulative net cash flow</h2><p class="muted small">Σ (income − spending) since ${fmtMonth(done[0]?.month || today())}.</p>
        ${chart([{ pts: cumPts, cls: 'line' }], { zero: true, H: 150, fmtX: (x) => fmtMon(iso(new Date(+x))) })}
        <p class="small">Period total: <b class="${cum < 0 ? 'down' : 'up'}">${signed(cum)}</b></p></div>
      <div class="card"><h2>Transaction count per month</h2><p class="muted small">Split at $20.</p>
        ${chart([{ pts: counts.map((r) => ({ x: mx(r.month), y: r.small_n })), cls: 'line', label: 'under $20' }, { pts: counts.map((r) => ({ x: mx(r.month), y: r.large_n })), cls: 'line alt', label: '$20+' }], { zero: true, H: 140, fmtX: (x) => fmtMon(iso(new Date(+x))), fmtY: (v) => v.toFixed(0) })}
        <p class="small">Last month: ${counts[counts.length - 1]?.small_n ?? 0} under $20 (${money(num(counts[counts.length - 1]?.small_total))}); mean ticket ${money2(num(counts[counts.length - 1]?.avg_ticket))}.</p></div>
    </div>
    <h2>Categories, 18 months</h2><p class="muted small">Bars: monthly. Line: 3-month rolling mean. Dashed: OLS fit; slope shown.</p>
    <div class="grid2">${panel(cat)}</div>
    <h2>Merchants, 18 months</h2>
    <div class="grid2">${panel(mer)}</div>
    ${Object.keys(cardBy).length ? `<h2>Card balance vs limit, weekly</h2><div class="grid2">${Object.entries(cardBy).map(([name, rs]) => { const lim = num(rs[0].credit_limit); const above = rs.filter((r) => lim && num(r.balance) / lim > 0.5).length; return `<div class="card"><h3>${h(name)}</h3>
      ${chart([{ pts: rs.map((r) => ({ x: mx(r.week), y: Math.max(0, num(r.balance)) })), cls: 'line' }], { zero: true, H: 140, refs: lim ? [{ y: lim, label: 'limit ' + money(lim) }, { y: lim * 0.3, label: '30%' }] : [], fmtX: (x) => fmtMon(iso(new Date(+x))) })}
      ${lim ? `<p class="small">Utilization above 50% in <b>${above} of ${rs.length}</b> weeks. Current ${fmtPct(num(rs[rs.length - 1].balance) / lim * 100)}.</p>` : ''}</div>`; }).join('')}</div>` : ''}`;
};

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
