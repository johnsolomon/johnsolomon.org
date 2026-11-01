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
  if (!me.member) return gate('This account isn’t on the household list.');
  if (!me.strong) return setup();
  enter(me);
}

function gate(msg) {
  show('gate');
  $('#gate-msg').textContent = msg || 'Private. Two people have access.';
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
    if (!me?.member) return gate('This account isn’t on the household list.');
    if (!me.strong) return gate('Sign-in didn’t use a passkey. Try again.');
    enter(me);
  } catch (e) { showErr('#gate-err', e.message || 'Sign-in failed.'); }
  finally { b.disabled = false; }
});

$('#btn-register').addEventListener('click', async () => {
  const b = $('#btn-register'); b.disabled = true; showErr('#setup-err', '');
  try {
    const friendlyName = $('#setup-name').value.trim() || 'My device';
    const { data: reg, error } = await sb.auth.registerPasskey();
    if (error) throw new Error(/approval|database error/i.test(error.message) ? 'This account already has a passkey. On a device that is signed in, open More → Settings → Add this device, then try again here within 10 minutes.' : error.message);
    await nameKey(reg, friendlyName);
    // The email session isn't a passkey session; end it everywhere and sign in with the new passkey so data unlocks.
    await sb.auth.signOut({ scope: 'global' });
    const { error: e2 } = await sb.auth.signInWithPasskey();
    if (e2) throw e2;
    const me = await whoami();
    if (!me?.strong || !me.member) throw new Error('Passkey saved, but the sign-in didn’t complete. Tap Sign in with Face ID.');
    enter(me);
  } catch (e) { showErr('#setup-err', e.message || 'Could not create the passkey.'); }
  finally { b.disabled = false; }
});

$('#btn-firsttime').addEventListener('click', () => { $('#firsttime').hidden = !$('#firsttime').hidden; });
$('#btn-sendlink').addEventListener('click', async () => {
  const email = $('#ft-email').value.trim(); if (!email) return;
  const b = $('#btn-sendlink'); b.disabled = true;
  const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: location.origin + '/finance/' } });
  $('#ft-msg').textContent = error ? error.message : 'Sent. Open the link from this device.';
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
  gate('Locked. Sign in again to continue.');
}
$('#btn-lock').addEventListener('click', lock);

// ---------- app shell ----------
const state = { me: null, cache: {}, route: 'home' };
function enter(me) {
  state.me = me; show('app'); lastActive = Date.now();
  route();
  if (sessionStorage.getItem('justLinked')) { sessionStorage.removeItem('justLinked'); portal('finish').then(() => { invalidate(); route(); toast('Account linked. First sync running.'); }).catch(() => {}); }
}
addEventListener('hashchange', route);
const TABS = { home: 'home', activity: 'activity', insights: 'insights', spending: 'insights', income: 'insights', fees: 'insights', plan: 'plan', budget: 'plan', recurring: 'plan', goals: 'plan', debt: 'plan', future: 'plan', invest: 'invest', holdings: 'invest', allocation: 'invest', accounts: 'top', settings: 'top', cashflow: 'insights', credit: 'plan', more: 'plan' };
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
  const [nw, nwh, cf, acc, rec, spend, ls, fc] = await Promise.all([D.nw(), D.nwh(), D.cashflow(), D.accounts(), D.recurring().catch(() => []), D.spend(), D.lastSync(), rpc('cash_forecast', { p_days: 30 }).catch(() => [])]);
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
    ${needs.length ? `<div class="card"><div class="row between"><span><span class="pill bad">needs attention</span> ${h(needs[0].institution_name)} ${needs.length > 1 ? 'and ' + (needs.length - 1) + ' more' : ''}</span><a class="link" href="#accounts">Fix</a></div></div>` : ''}
    <div class="grid2">
      <div class="card"><div class="row between"><h2>Cash & investments</h2><span class="stat"><span class="v">${money(num(n.assets))}</span></span></div>
        <div class="row between"><h2>Owed</h2><span class="stat"><span class="v">${money(num(n.liabilities))}</span></span></div>
        ${nwh.length > 1 ? lineChart(nwh.map((r) => ({ t: r.as_of, v: num(r.net_worth) })), 640, 140) : '<p class="muted small">Net worth over time starts after tonight’s sync.</p>'}
      </div>
      <div class="card">
        <div class="row between"><h2>Spent this month</h2><span class="stat"><span class="v">${money(num(cur.spending))}</span></span></div>
        <p class="muted small">${prev.spending ? money(num(prev.spending)) + ' all of ' + fmtMon(prevM) : 'No previous month yet'} · income ${money(num(cur.income))}</p>
        <div class="list">${topCats.map((c) => `<div class="item tap" data-go="#activity/${encodeURIComponent(c.category)}"><span class="t">${h(c.category)}</span><span class="a">${money(num(c.spent))}</span></div>`).join('') || '<p class="empty">No spending yet this month.</p>'}</div>
        <a class="link small" href="#insights">Cash forecast and savings rate</a>
      </div>
    </div>
    <div class="card">
      <div class="row between wrap"><h2>Coming up</h2>${low ? `<a class="small ${num(low.balance) < 0 ? 'down' : num(low.balance) < 300 ? 'warn' : 'muted'}" href="#insights">cash low point ${money(num(low.balance))} on ${fmtDay(low.as_of)}</a>` : ''}</div>
      <div class="list">
        ${due.map((a) => `<div class="item"><span class="t">${h(a.nickname || a.name)} payment</span><span class="a">${a.minimum_payment_amount ? money2(num(a.minimum_payment_amount)) + ' min' : ''}</span><span class="s">${fmtDayLong(a.next_payment_due_date)}${a.is_overdue ? ' · <span class="down">overdue</span>' : ''}</span></div>`).join('')}
        ${soon.map((r) => `<div class="item"><span class="t">${h(r.merchant)}</span><span class="a">${money2(num(r.typical_amount))}</span><span class="s">expected ${fmtDayLong(r.next_expected)} · ${h(r.cadence)}</span></div>`).join('')}
        ${!due.length && !soon.length ? '<p class="empty">Nothing due in the next two weeks.</p>' : ''}
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
            <span class="s">${h(a.subtype || a.type)}${a.interest_rate != null ? ' · ' + Number(a.interest_rate).toFixed(2) + '% APR' : ''}${a.next_payment_due_date ? ' · due ' + fmtDay(a.next_payment_due_date) : ''}</span>
          </div>`).join('')}</div>
      </div>`).join('') || '<div class="card"><p class="empty">No accounts linked yet. Add one to begin.</p></div>'}`;
  $('#btn-add').onclick = () => openSheet(`
    <h2>Add an account</h2>
    <p class="muted small">You’ll pick the institution and log in on Plaid’s page, then come back here. Logins never pass through this site.</p>
    <div class="form">
      <button class="primary" data-link="bank">Bank or credit card</button>
      <button class="primary" data-link="brokerage">Brokerage, retirement or kids’ investment account</button>
      <button class="primary" data-link="loan">Loan or mortgage only</button>
      <p class="muted small">Up to 10 institutions can be linked in total. Removing one does not free its slot.</p>
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
    else if (rm) openSheet(`<h2>Remove ${h(rm.dataset.name)}?</h2><p class="muted">Its accounts and transactions disappear from here. The institution slot is not returned.</p><div class="actions"><button class="quiet" data-cancel>Keep</button><button class="primary danger" data-confirm>Remove</button></div>`),
      $('#sheet-body').onclick = async (ev) => { if (ev.target.closest('[data-cancel]')) closeSheet(); if (ev.target.closest('[data-confirm]')) { try { await portal('remove', { item_id: rm.dataset.remove }); closeSheet(); invalidate(); route(); toast('Removed'); } catch (err) { toast(err.message); } } };
    else if (ac) {
      const a = acc.find((x) => x.account_id === ac.dataset.acct);
      openSheet(`<h2>${h(a.name)}</h2><div class="form">
        <label class="field">Nickname <input id="f-nick" type="text" value="${h(a.nickname || '')}" size="20" placeholder="${h(a.name)}"></label>
        <label class="check"><input id="f-hidden" type="checkbox" ${a.hidden ? 'checked' : ''}> Hide from totals and net worth</label>
        <p class="muted small">${h(a.official_name || '')}${a.available_balance != null ? ' · available ' + money2(num(a.available_balance)) : ''}</p>
        <div class="actions"><button class="quiet" data-cancel>Cancel</button><button class="primary" data-save>Save</button></div></div>`);
      $('#sheet-body').onclick = async (ev) => {
        if (ev.target.closest('[data-cancel]')) closeSheet();
        if (ev.target.closest('[data-save]')) { try { await rpc('set_account', { p_account_id: a.account_id, p_nickname: $('#f-nick').value.trim() || null, p_hidden: $('#f-hidden').checked }); closeSheet(); invalidate(); route(); } catch (err) { toast(err.message); } }
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
        <span class="t">${h(t.merchant_name || t.name)}${t.pending ? ' <span class="pill">pending</span>' : ''}${t.excluded ? ' <span class="pill">excluded</span>' : ''}</span>
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
  await load();
};

function editTx(t, after) {
  openSheet(`<h2>${h(t.merchant_name || t.name)}</h2>
    <p class="muted small">${h(t.name)} · ${fmtDayLong(t.date)} · ${money2(num(t.amount))}</p>
    <div class="form">
      <label class="field">Category <select id="e-cat">${catOptions(t.category || 'Uncategorized')}</select></label>
      <label class="check"><input id="e-transfer" type="checkbox" ${t.is_transfer ? 'checked' : ''}> Transfer between my own accounts (not spending)</label>
      <label class="check"><input id="e-excl" type="checkbox" ${t.excluded ? 'checked' : ''}> Leave out of spending and budgets</label>
      <label class="field">Note <input id="e-notes" type="text" value="${h(t.notes || '')}" size="24"></label>
      <label class="check"><input id="e-rule" type="checkbox"> Always use this category for <b>${h(t.merchant_name || t.name)}</b></label>
      <div class="actions"><button class="quiet" data-cancel>Cancel</button><button class="primary" data-save>Save</button></div>
    </div>`);
  $('#sheet-body').onclick = async (e) => {
    if (e.target.closest('[data-cancel]')) closeSheet();
    if (e.target.closest('[data-save]')) {
      try {
        const cat = $('#e-cat').value, tr = $('#e-transfer').checked, ex = $('#e-excl').checked;
        await rpc('set_transaction', { p_id: t.transaction_id, p_category: cat, p_is_transfer: tr, p_excluded: ex, p_notes: $('#e-notes').value });
        if ($('#e-rule').checked) await rpc('add_rule', { p_match: t.merchant_name || t.name, p_category: cat, p_is_transfer: tr, p_excluded: ex });
        closeSheet(); invalidate(); after(); toast('Saved');
      } catch (err) { toast(err.message); }
    }
  };
}

VIEWS.plan = async (view) => { location.hash = '#budget'; };

function subnav(items, on) { return `<div class="sub">${items.map(([k, l]) => `<a href="#${k}" class="${k === on ? 'on' : ''}">${l}</a>`).join('')}</div>`; }
const PLAN_NAV = [['budget', 'Budget'], ['recurring', 'Recurring'], ['goals', 'Goals'], ['debt', 'Debt'], ['future', 'Future']];

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
      <div class="row between wrap"><div><h2>${fmtMonth(thisM)}</h2><p class="muted small">${money(spent)} of ${money(budgeted)} budgeted · ${(dayFrac * 100).toFixed(0)}% of the month gone</p></div><button class="primary" id="btn-budget">Add category</button></div>
      ${budgeted ? progress(spent, budgeted, spent > budgeted ? 'over' : spent / budgeted <= dayFrac ? 'ok' : '') : ''}
      <div class="list">${rows.sort((a, b) => num(b.available) - num(a.available)).map((r) => {
        const over = num(r.remaining) < 0;
        return `<div class="item tap" data-budget="${h(r.category)}">
          <span class="t">${h(r.category)}${r.rollover ? ' <span class="pill">rolls over</span>' : ''}</span>
          <span class="a ${over ? 'down' : ''}">${over ? money(-num(r.remaining)) + ' over' : money(num(r.remaining)) + ' left'}</span>
          <span class="s">${money(num(r.spent))} of ${money(num(r.available))}</span>
          <span class="s" style="grid-column:1/-1">${progress(num(r.spent), num(r.available), over ? 'over' : '')}</span>
        </div>`; }).join('') || '<p class="empty">No budget yet. Add a category and an amount; unspent money can roll into next month.</p>'}</div>
    </div>
    ${unbudgeted.length ? `<div class="card"><h2>Not budgeted</h2><p class="muted small">Spending this month in categories without a budget.</p><div class="list">${unbudgeted.map((r) => `<div class="item tap" data-budget="${h(r.category)}" data-amount="${num(r.spent).toFixed(0)}"><span class="t">${h(r.category)}</span><span class="a">${money(num(r.spent))}</span></div>`).join('')}</div></div>` : ''}`;
  const edit = (cat, amount, rollover, isNew) => {
    openSheet(`<h2>${isNew ? 'Add budget' : h(cat)}</h2><div class="form">
      ${isNew ? `<label class="field">Category <select id="b-cat">${catOptions(cat)}</select></label>` : ''}
      <label class="field">Monthly amount <input id="b-amt" class="short" type="number" inputmode="decimal" min="0" step="1" value="${amount || ''}"></label>
      <label class="check"><input id="b-roll" type="checkbox" ${rollover ? 'checked' : ''}> Roll unspent money into next month</label>
      <div class="actions">${isNew ? '' : '<button class="quiet danger" data-del>Delete</button>'}<button class="quiet" data-cancel>Cancel</button><button class="primary" data-save>Save</button></div></div>`);
    $('#sheet-body').onclick = async (e) => {
      if (e.target.closest('[data-cancel]')) closeSheet();
      if (e.target.closest('[data-del]')) { try { await rpc('delete_budget', { p_category: cat }); closeSheet(); invalidate(); route(); } catch (err) { toast(err.message); } }
      if (e.target.closest('[data-save]')) { const c = isNew ? $('#b-cat').value : cat; const a = Number($('#b-amt').value); if (!(a >= 0)) return toast('Enter an amount');
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
      <div class="row between wrap"><h2>Recurring charges</h2><span class="stat"><span class="v">${money(monthly)}</span><span class="l">per month, all together</span></span></div>
      <p class="muted small">Found automatically: same merchant, similar amount, regular timing, seen at least three times.</p>
      ${up.length ? `<p class="warn small">${up.length} price increase${up.length > 1 ? 's' : ''}: ${up.map((r) => h(r.merchant) + ' ' + pct(num(r.amount_change_pct))).join(', ')}</p>` : ''}
      <div class="list">${rec.map((r) => `<div class="item tap" data-go="#activity"><span class="t">${h(r.merchant)}</span><span class="a">${money2(num(r.last_amount))}${num(r.amount_change_pct) >= 5 ? `<span class="s warn">was ${money2(num(r.typical_amount))}</span>` : ''}</span><span class="s">${h(r.cadence)} · next ${fmtDay(r.next_expected)} · ${h(accName[r.account_id] || '')} · ${r.occurrences}×</span></div>`).join('') || '<p class="empty">Nothing recurring detected yet. It needs about three months of history.</p>'}</div>
    </div>`;
  bindGo(view);
};

VIEWS.goals = async (view) => {
  const [goals, acc] = await Promise.all([D.goals(), D.accounts()]);
  view.innerHTML = `
    <h1>Plan</h1>${subnav(PLAN_NAV, 'goals')}
    <div class="row between"><h2>Goals</h2><button class="primary" id="btn-goal">Add goal</button></div>
    <div class="grid2">${goals.map((g) => {
      const cur = num(g.current_amount), tgt = num(g.target_amount);
      const isCap = g.kind === 'spending_cap', isDebt = g.kind === 'debt_payoff';
      const p = isDebt ? (tgt ? Math.max(0, 1 - cur / tgt) : 0) : tgt ? cur / tgt : 0;
      const months = g.target_date ? Math.max(0, (d(g.target_date) - new Date()) / (30.4 * 864e5)) : null;
      const need = !isCap && tgt && months > 0 ? Math.max(0, (isDebt ? cur : tgt - cur) / months) : null;
      return `<div class="card tap" data-goal="${g.id}">
        <div class="row between"><h3>${h(g.name)}</h3><span class="pill">${g.status === 'paused' ? 'paused' : isCap ? 'monthly cap' : isDebt ? 'pay off' : 'save'}</span></div>
        ${progress(isCap ? cur : isDebt ? tgt - cur : cur, isCap || isDebt ? tgt : tgt, isCap && cur > tgt ? 'over' : p >= 1 ? 'ok' : '')}
        <p class="small">${isCap ? `${money(cur)} spent of ${money(tgt)} this month` : isDebt ? `${money(cur)} left of ${money(tgt)}` : `${money(cur)} of ${money(tgt)}`}${g.target_date ? ' · by ' + fmtDay(g.target_date) + ' ' + d(g.target_date).getFullYear() : ''}</p>
        ${need != null ? `<p class="muted small">${money(need)} per month to get there on time${g.monthly_amount ? ' · planned ' + money(num(g.monthly_amount)) : ''}</p>` : ''}
      </div>`; }).join('') || '<div class="card"><p class="empty">No goals yet. Try a savings target tied to an account, a payoff for a card, or a monthly cap on a category.</p></div>'}</div>`;
  const edit = (g) => {
    const isNew = !g; g = g || { kind: 'savings', account_ids: [], status: 'active' };
    openSheet(`<h2>${isNew ? 'Add goal' : 'Edit goal'}</h2><div class="form">
      <label class="field">Name <input id="g-name" type="text" value="${h(g.name || '')}" size="24"></label>
      <label class="field">Kind <select id="g-kind"><option value="savings" ${g.kind === 'savings' ? 'selected' : ''}>Save up to an amount</option><option value="debt_payoff" ${g.kind === 'debt_payoff' ? 'selected' : ''}>Pay a balance down to zero</option><option value="spending_cap" ${g.kind === 'spending_cap' ? 'selected' : ''}>Monthly spending cap on a category</option></select></label>
      <label class="field">Target amount <input id="g-target" class="short" type="number" inputmode="decimal" min="0" value="${g.target_amount ?? ''}"></label>
      <label class="field">Target date <input id="g-date" type="date" value="${g.target_date || ''}" style="width:auto"></label>
      <label class="field">Planned per month <input id="g-monthly" class="short" type="number" inputmode="decimal" min="0" value="${g.monthly_amount ?? ''}"></label>
      <label class="field" id="g-cat-f">Category <select id="g-cat">${catOptions(g.category || 'Restaurants')}</select></label>
      <div class="field" id="g-acc-f">Accounts that count ${acc.map((a) => `<label class="check"><input type="checkbox" data-acc="${h(a.account_id)}" ${(g.account_ids || []).includes(a.account_id) ? 'checked' : ''}> ${h(a.nickname || a.name)} <span class="muted">${money(num(a.current_balance))}</span></label>`).join('')}</div>
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
        if (!p.name) return toast('Give it a name');
        try { await rpc('upsert_goal', { p }); closeSheet(); invalidate(); route(); } catch (err) { toast(err.message); }
      }
    };
  };
  $('#btn-goal').onclick = () => edit(null);
  for (const g of goals.filter((x) => x.kind !== 'spending_cap' && x.target_date && x.status !== 'paused')) {
    rpc('goal_odds', { p_goal_id: g.id }).then((o) => { const r = o && o[0]; const el = $(`[data-goal="${g.id}"]`); if (!r || !el) return;
      el.insertAdjacentHTML('beforeend', `<p class="small"><b class="${num(r.p_hit) >= 70 ? 'up' : num(r.p_hit) >= 40 ? 'warn' : 'down'}">${Number(r.p_hit).toFixed(0)}% chance</b> of making it by then, going by your last 12 months · needs ${money(num(r.needed_per_month))}/mo, you’ve kept a median ${money(num(r.median_saving))}/mo · likely end point ${money(num(r.p10_end))}–${money(num(r.p90_end))}</p>`); }).catch(() => {});
  }
  view.onclick = (e) => { const el = e.target.closest('[data-goal]'); if (el) edit(goals.find((x) => String(x.id) === el.dataset.goal)); };
};

VIEWS.settings = async (view) => {
  const [{ data: pk }, rules, ls] = await Promise.all([sb.auth.passkey.list().catch(() => ({ data: [] })), D.rules(), D.lastSync()]);
  const keys = (pk && (pk.passkeys || pk)) || [];
  view.innerHTML = `
    <h1>Settings</h1>
    <div class="card"><h2>Signed in as ${h(state.me.display_name || '')}</h2>
      <p class="muted small">Locks itself after 5 minutes without a touch, or when the app has been in the background 5 minutes. Face ID to come back.</p>
      <div class="row wrap"><button class="quiet" id="btn-sync">Refresh from banks now</button><button class="quiet" id="btn-signout">Sign out</button><button class="quiet" id="btn-signout-all">Sign out everywhere</button></div>
      <p class="muted small">${ls[0] ? `Last refresh ${relTime(ls[0].finished_at || ls[0].started_at)} (${h(ls[0].status)}, ${ls[0].tx_added} new). Automatic refresh runs every morning.` : ''}</p>
    </div>
    <div class="card"><div class="row between wrap"><h2>Passkeys</h2><span class="row"><button class="quiet" id="btn-addkey">Add this device</button><button class="quiet" id="btn-approve">Approve another device</button></span></div>
      <p class="muted small">Each device keeps its own passkey. A new one is only accepted for 10 minutes after you approve it from here. Remove any you don’t recognize.</p>
      <p id="approve-msg" class="small up" hidden></p>
      <div class="list">${(Array.isArray(keys) ? keys : []).map((k) => `<div class="item"><span class="t">${h(k.friendly_name || k.friendlyName || 'Passkey')}</span><span class="a"><button class="quiet small danger" data-delkey="${h(k.id)}">Remove</button></span><span class="s">added ${k.created_at ? fmtDay(k.created_at) : ''}${k.last_used_at ? ' · last used ' + fmtDay(k.last_used_at) : ''}</span></div>`).join('') || '<p class="empty">No passkeys listed.</p>'}</div>
    </div>
    <div class="card"><h2>Category rules</h2><p class="muted small">Applied to every new transaction whose description contains the text.</p>
      <div class="list">${rules.map((r) => `<div class="item"><span class="t">“${h(r.match)}” → ${h(r.category)}${r.is_transfer ? ' (transfer)' : ''}${r.excluded ? ' (excluded)' : ''}</span><span class="a"><button class="quiet small danger" data-delrule="${r.id}">Remove</button></span></div>`).join('') || '<p class="empty">No rules yet. Make one from any transaction with “Always use this category”.</p>'}</div>
    </div>`;
  $('#btn-sync').onclick = async (e) => { e.target.disabled = true; try { await portal('sync'); toast('Refreshing… numbers update in a minute.'); setTimeout(() => { invalidate(); route(); }, 45000); } catch (err) { toast(err.message); e.target.disabled = false; } };
  $('#btn-signout').onclick = async () => { await sb.auth.signOut({ scope: 'local' }); state.cache = {}; gate(); };
  $('#btn-signout-all').onclick = async () => { await sb.auth.signOut({ scope: 'global' }); state.cache = {}; gate('Signed out on every device.'); };
  $('#btn-approve').onclick = async (e) => { e.target.disabled = true; try { await rpc('open_passkey_window'); const m = $('#approve-msg'); m.textContent = 'Approved. On the other device, use “First time on this device?” and create its passkey within 10 minutes.'; m.hidden = false; } catch (err) { toast(err.message); } finally { e.target.disabled = false; } };
  $('#btn-addkey').onclick = async (e) => { e.target.disabled = true; try { await rpc('open_passkey_window'); const { data: reg, error } = await sb.auth.registerPasskey(); if (error) throw error; await nameKey(reg, prompt('Name this device', 'New device') || 'New device'); toast('Passkey added'); route(); } catch (err) { toast(err.message); e.target.disabled = false; } };
  view.onclick = async (e) => {
    const dk = e.target.closest('[data-delkey]'), dr = e.target.closest('[data-delrule]');
    if (dk) { if (keys.length <= 1) return toast('Keep at least one passkey'); try { const { error } = await sb.auth.passkey.delete({ passkeyId: dk.dataset.delkey }); if (error) throw error; route(); } catch (err) { toast(err.message); } }
    if (dr) { try { await rpc('delete_rule', { p_id: Number(dr.dataset.delrule) }); invalidate(); route(); } catch (err) { toast(err.message); } }
  };
};

// ---------- Insights ----------
const INS_NAV = [['insights', 'Cash'], ['spending', 'Spending'], ['income', 'Income'], ['fees', 'Fees']];
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
        <div class="row between"><h2>Cash, next 45 days</h2><span class="stat"><span class="v">${money(cash)}</span><span class="l">available now</span></span></div>
        ${lineChart(fc.map((r) => ({ t: r.as_of, v: num(r.balance) })), 640, 150, money, true)}
        <p class="small">Lowest point <b class="${num(low.balance) < 0 ? 'down' : num(low.balance) < 300 ? 'warn' : ''}">${money(num(low.balance))}</b> on ${fmtDayLong(low.as_of)}${below ? ` · <span class="down">${below} day${below > 1 ? 's' : ''} below zero</span>` : ''}</p>
        <p class="muted small">Expected paychecks and recurring charges on their usual dates, card minimums on their due dates, plus your average everyday spend of the last 90 days spread over each day. Transfers between your own accounts are ignored.</p>
        <div class="list">${events.map((r) => `<div class="item"><span class="t">${r.events.map(h).join(', ')}</span><span class="a ${num(r.inflow) > num(r.outflow) ? 'up' : ''}">${signed(num(r.inflow) - num(r.outflow), 0)}</span><span class="s">${fmtDayLong(r.as_of)} · balance after ${money(num(r.balance))}</span></div>`).join('')}</div>
      </div>
      <div class="card">
        <h2>How much you keep</h2>
        <div class="row wrap">
          <span class="stat"><span class="v ${rate(last3) < 0 ? 'down' : ''}">${fmtPct(rate(last3))}</span><span class="l">last 3 months</span></span><span style="width:16px"></span>
          <span class="stat"><span class="v ${rate(last6) < 0 ? 'down' : ''}">${fmtPct(rate(last6))}</span><span class="l">last 6</span></span><span style="width:16px"></span>
          <span class="stat"><span class="v ${rate(last12) < 0 ? 'down' : ''}">${fmtPct(rate(last12))}</span><span class="l">last 12</span></span>
        </div>
        <p class="muted small">Share of income left after spending. Card payments and transfers don't count as spending; purchases on linked cards count when they happen.</p>
        ${barChart(last12.map((r) => ({ month: r.month, income: num(r.income), spending: num(r.spending) })), ['income', 'spending'])}
        <div class="row wrap"><span class="stat"><span class="v">${runway == null ? '—' : runway.toFixed(1) + ' mo'}</span><span class="l">cash covers this much spending</span></span><span style="width:16px"></span><span class="stat"><span class="v">${money(sdNet)}</span><span class="l">typical swing in a month’s result</span></span></div>
      </div>
    </div>
    <div class="card">
      <h2>Month by month</h2>
      <div class="scroll"><table class="data"><thead><tr><th>Month</th><th class="num">In</th><th class="num">Out</th><th class="num">Kept</th><th class="num">Rate</th></tr></thead><tbody>
        ${sum.slice(-13).reverse().map((r) => `<tr><td>${fmtMonth(r.month)}${r.partial ? ' <span class="muted">(so far)</span>' : ''}</td><td class="num">${money(num(r.income))}</td><td class="num">${money(num(r.spending))}</td><td class="num ${num(r.net) < 0 ? 'down' : 'up'}">${signed(num(r.net))}</td><td class="num">${fmtPct(r.savings_rate_pct)}</td></tr>`).join('')}
      </tbody></table></div>
    </div>
    ${nwm.length > 1 ? `<div class="card"><h2>Where net worth changes come from</h2>
      <div class="scroll"><table class="data"><thead><tr><th>Month</th><th class="num">Net worth</th><th class="num">Change</th><th class="num">Kept from income</th><th class="num">Debt paid down</th><th class="num">Investments</th></tr></thead><tbody>
        ${nwm.slice(-12).reverse().map((r) => `<tr><td>${fmtMonth(r.month)}</td><td class="num">${money(num(r.net_worth))}</td><td class="num ${num(r.change) < 0 ? 'down' : 'up'}">${r.change == null ? '—' : signed(num(r.change))}</td><td class="num">${signed(num(r.saved))}</td><td class="num">${r.debt_paid_down == null ? '—' : signed(num(r.debt_paid_down))}</td><td class="num">${r.investment_change == null ? '—' : signed(num(r.investment_change))}</td></tr>`).join('')}
      </tbody></table></div>
      <p class="muted small">Balances are snapshotted every morning; this fills in as months pass.</p></div>` : ''}`;
};

VIEWS.spending = async (view) => {
  const [cs, ms, wd] = await Promise.all([rpc('category_stats', { p_months: 12 }), rpc('merchant_stats', { p_days: 90 }), D.weekday()]);
  const early = dayOfMonth < 5;
  const flagged = early ? [] : cs.filter((c) => Math.abs(num(c.z)) >= 1.5 && num(c.mean_month) > 50);
  const wmax = Math.max(1, ...wd.map((r) => num(r.per_day)));
  view.innerHTML = `
    <h1>Insights</h1>${subnav(INS_NAV, 'spending')}
    ${flagged.length ? `<div class="card"><h2>Out of the usual range this month</h2><div class="list">${flagged.map((c) => `<div class="item tap" data-go="#activity/${encodeURIComponent(c.category)}"><span class="t">${h(c.category)}</span><span class="a ${num(c.z) > 0 ? 'down' : 'up'}">${money(num(c.this_month_projected))} <span class="s">on pace · usual ${money(num(c.mean_month))}</span></span><span class="s">${num(c.z) > 0 ? 'above' : 'below'} your normal band by ${Math.abs(num(c.z)).toFixed(1)} standard deviations</span></div>`).join('')}</div></div>` : ''}
    <div class="card">
      <h2>Categories, last 12 complete months</h2>
      <p class="muted small">Mean and standard deviation per month. “On pace” scales this month’s spending to a full month${early ? ' (too early in the month to judge)' : ''}. Trend is the fitted slope per month as a share of the mean.</p>
      <div class="scroll"><table class="data"><thead><tr><th>Category</th><th class="num">Share</th><th class="num">Mean ± sd</th><th class="num">On pace</th><th class="num">Trend</th></tr></thead><tbody>
        ${cs.filter((c) => num(c.last_12m) > 0).map((c) => `<tr class="tap" data-go="#activity/${encodeURIComponent(c.category)}"><td>${h(c.category)}</td><td class="num">${fmtPct(c.share_pct)}</td><td class="num">${money(num(c.mean_month))} <span class="muted">± ${money(num(c.sd_month))}</span></td><td class="num ${!early && num(c.z) >= 1.5 ? 'down' : ''}">${early ? '—' : money(num(c.this_month_projected))}</td><td class="num ${num(c.trend_pct_per_month) > 3 ? 'warn' : ''}">${c.trend_pct_per_month == null ? '—' : pct(num(c.trend_pct_per_month)) + '/mo'}</td></tr>`).join('')}
      </tbody></table></div>
    </div>
    <div class="grid2">
      <div class="card">
        <h2>Merchants, last 90 days</h2>
        <div class="list">${ms.slice(0, 15).map((m) => `<div class="item"><span class="t">${h(m.merchant)}</span><span class="a">${money(num(m.total))}<span class="s">${fmtPct(m.share_pct)} · ${m.n}×</span></span><span class="s">${m.change_pct == null ? 'new in this period' : (num(m.change_pct) >= 0 ? '<span class="warn">+' : '<span class="up">') + Math.abs(num(m.change_pct)).toFixed(0) + '%</span> vs the 90 days before'}</span></div>`).join('')}</div>
      </div>
      <div class="card">
        <h2>Day of the week</h2>
        <p class="muted small">Average spent on days you spent anything, last 6 months.</p>
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
      <div class="row between wrap"><h2>Regular income</h2><span class="stat"><span class="v">${money(monthly)}</span><span class="l">per month from active sources</span></span></div>
      <div class="list">${src.map((s) => `<div class="item"><span class="t">${h(titleCase(s.source))}${d(s.last_date) < new Date(Date.now() - 75 * 864e5) ? ' <span class="pill">stopped</span>' : ''}</span><span class="a">${money2(num(s.typical_amount))}<span class="s">${h(s.cadence)}</span></span><span class="s">${s.occurrences}× · last ${fmtDay(s.last_date)}${s.next_expected && d(s.next_expected) >= d(today()) ? ' · next ' + fmtDay(s.next_expected) : ''}${s.trend_pct_per_month ? ' · ' + pct(num(s.trend_pct_per_month)) + '/mo trend' : ''}</span></div>`).join('') || '<p class="empty">No regular deposits found yet.</p>'}</div>
      <p class="muted small">Deposits grouped by sender; cadence from the median gap between them. Transfers from your own accounts are not income.</p>
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
      <h2>Fees and interest, last 12 months</h2>
      <div class="row wrap"><span class="stat"><span class="v ${num(f.fees_12m) ? 'down' : ''}">${money2(num(f.fees_12m))}</span><span class="l">${f.fee_count_12m || 0} fees</span></span><span style="width:16px"></span><span class="stat"><span class="v ${num(f.overdrafts_12m) ? 'down' : ''}">${money2(num(f.overdrafts_12m))}</span><span class="l">${f.overdraft_count_12m || 0} overdrafts</span></span><span style="width:16px"></span><span class="stat"><span class="v">${money2(num(f.interest_12m))}</span><span class="l">card interest</span></span></div>
      ${f.overdraft_count_12m ? `<p class="small">Overdrafts land a median of <b>${f.median_days_before_payday} day${f.median_days_before_payday == 1 ? '' : 's'}</b> before a paycheck. Worst month: ${h(f.worst_month)} (${money(num(f.worst_month_fees))}). A cushion of about one paycheck in checking, or moving autopays to the day after payday, removes most of this.</p>` : ''}
      ${barChart(fees.map((r) => ({ month: r.month, fees: num(r.fees), interest_paid: num(r.interest_paid) })), ['fees', 'interest_paid'], 640, 140)}
      <div class="legend"><span><i style="background:var(--bar2)"></i>Fees</span><span><i style="background:var(--bar)"></i>Interest</span></div>
    </div>
    ${limit ? `<div class="card"><h2>Card use</h2><p class="small">${money(util)} of ${money(limit)} across linked cards · <b class="${util / limit > 0.3 ? 'warn' : 'up'}">${(100 * util / limit).toFixed(0)}% used</b> <span class="muted">(scores reward staying under 30%, and under 10% is better)</span></p>
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
      <div class="row wrap"><span class="stat"><span class="v">${money(plan.reduce((s, r) => s + num(r.balance), 0))}</span><span class="l">owed on linked debts</span></span><span style="width:16px"></span><span class="stat"><span class="v down">${money2(plan.reduce((s, r) => s + num(r.daily_interest), 0))}</span><span class="l">interest per day right now</span></span></div>
      <div class="scroll"><table class="data"><thead><tr><th>Debt</th><th class="num">Balance</th><th class="num">APR</th><th class="num">Minimum only</th><th class="num">With ${money(extra)} extra</th></tr></thead><tbody>
        ${plan.map((r) => `<tr><td>${h(r.name)}</td><td class="num">${money(num(r.balance))}</td><td class="num">${fmtPct(r.apr, 2)}</td><td class="num">${r.months_min >= 600 ? '<span class="down">never</span>' : r.months_min + ' mo · ' + money(num(r.interest_min)) + ' interest'}</td><td class="num">${r.months_plan >= 600 ? '<span class="down">never</span>' : r.months_plan + ' mo · ' + money(num(r.interest_plan)) + ' interest'}</td></tr>`).join('')}
      </tbody></table></div>
      <p class="small">Paying minimums only costs <b class="down">${money(totMin)}</b> in interest. Adding ${money(extra)} a month, highest APR first, costs <b>${money(totPlan)}</b> and clears everything in <b>${last_pay} months</b> — saving ${money(totMin - totPlan)}.</p>` : '<p class="empty">No balances on linked cards or loans.</p>';
  };
  view.innerHTML = `
    <h1>Plan</h1>${subnav(PLAN_NAV, 'debt')}
    <div class="card">
      <div class="row between wrap"><h2>Paying it down</h2><label class="field" style="display:flex;align-items:center;gap:8px">Extra per month <input id="debt-extra" class="short" type="number" inputmode="numeric" min="0" step="25" value="${extra}" style="width:8ch"></label></div>
      <div id="debt-body"><p class="muted">Calculating…</p></div>
      ${unl.length ? `<p class="muted small">Not included: ${unl.map(h).join(', ')} — those aren’t linked, so their balances and rates are unknown. Link them from Accounts (Apple Card can’t be linked).</p>` : ''}
    </div>
    <div class="card">
      <div class="row between wrap"><div class="hero"><span class="label">Credit score</span><span class="big">${last ? last.score : '—'}</span><span class="muted small">${last ? `${h(last.bureau || '')} ${fmtDay(last.as_of)}${prev ? ` · <span class="${last.score - prev.score >= 0 ? 'up' : 'down'}">${last.score - prev.score >= 0 ? '+' : ''}${last.score - prev.score}</span> since ${fmtDay(prev.as_of)}` : ''}` : 'Log it from your card’s app whenever you check it'}</span></div><button class="primary" id="btn-score">Log score</button></div>
      ${credit.length > 1 ? lineChart(credit.map((c) => ({ t: c.as_of, v: c.score })), 640, 150, (v) => String(Math.round(v))) : ''}
    </div>`;
  await draw();
  let t; $('#debt-extra').oninput = (e) => { extra = Math.max(0, Number(e.target.value) || 0); localStorage.setItem('debt_extra', String(extra)); clearTimeout(t); t = setTimeout(draw, 350); };
  $('#btn-score').onclick = () => {
    openSheet(`<h2>Log credit score</h2><div class="form">
      <label class="field">Score <input id="c-score" class="short" type="number" inputmode="numeric" min="300" max="850" value="${last ? last.score : ''}"></label>
      <label class="field">Date <input id="c-date" type="date" value="${today()}" style="width:auto"></label>
      <label class="field">Bureau <select id="c-bureau" style="width:auto"><option>Experian</option><option>Equifax</option><option>TransUnion</option></select></label>
      <label class="field">Seen in <input id="c-src" type="text" size="16" value="${h(last?.source || 'Amex app')}"></label>
      <div class="actions"><button class="quiet" data-cancel>Cancel</button><button class="primary" data-save>Save</button></div></div>`);
    if (last?.bureau) $('#c-bureau').value = last.bureau;
    $('#sheet-body').onclick = async (e) => {
      if (e.target.closest('[data-cancel]')) closeSheet();
      if (e.target.closest('[data-save]')) { const s = Number($('#c-score').value); if (!(s >= 300 && s <= 850)) return toast('Score is 300–850');
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
    const rows = await rpc('projection', { p });
    const cross = rows.find((r) => num(r.net_worth) >= 1000000);
    $('#proj-body').innerHTML = `
      ${lineChart(rows.map((r) => ({ t: r.year_end, v: num(r.net_worth) })), 640, 170, money, true)}
      <p class="small">Starts from today’s balances, your actual 12-month average income (${money(num(lastDone.income_12m_avg))}) and spending (${money(num(lastDone.spending_12m_avg))}) until ${fmtDay(p.attending_start)} ${d(p.attending_start).getFullYear()}, then the attending figures. Spare cash goes to the highest-rate debt first, then to investments at ${p.return_pct}% a year.${cross ? ` Crosses $1M at the end of <b>${d(cross.year_end).getFullYear()}</b>.` : ''}</p>
      <div class="scroll"><table class="data"><thead><tr><th>Year</th><th class="num">Net worth</th><th class="num">Cash + investments</th><th class="num">Debt</th><th class="num">Saved that year</th></tr></thead><tbody>
        ${rows.map((r) => `<tr><td>${d(r.year_end).getFullYear()} <span class="muted">${h(r.age_note)}</span></td><td class="num">${money(num(r.net_worth))}</td><td class="num">${money(num(r.cash_and_invest))}</td><td class="num">${money(num(r.debt))}</td><td class="num">${signed(num(r.saved_year))}</td></tr>`).join('')}
      </tbody></table></div>`;
  };
  view.innerHTML = `
    <h1>Plan</h1>${subnav(PLAN_NAV, 'future')}
    <div class="card">
      <h2>Residency to attending</h2>
      <div class="row wrap" style="gap:14px">
        <label class="field">First attending month <input id="pj-start" type="month" value="${p.attending_start.slice(0, 7)}" style="width:auto"></label>
        <label class="field">Take-home per month then <input id="pj-inc" class="short" type="number" inputmode="numeric" step="500" value="${p.attending_net_monthly}" style="width:9ch"></label>
        <label class="field">Spending per month then <input id="pj-sp" class="short" type="number" inputmode="numeric" step="500" value="${p.spending_after}" style="width:9ch"></label>
        <label class="field">Investment return %/yr <input id="pj-ret" class="short" type="number" inputmode="decimal" step="0.5" value="${p.return_pct}" style="width:6ch"></label>
        <label class="field">Years <input id="pj-yrs" class="short" type="number" inputmode="numeric" min="2" max="40" value="${p.years}" style="width:7ch"></label>
      </div>
      <div class="row between wrap"><span class="muted small">Debts not linked yet (student loans, etc.) can be added so the plan accounts for them.</span><span class="row"><button class="quiet small" id="pj-adddebt">Add a debt</button><button class="primary" id="pj-save">Recalculate</button></span></div>
      ${p.extra_debts.length ? `<div class="list">${p.extra_debts.map((x, i) => `<div class="item"><span class="t">${h(x.name)}</span><span class="a">${money(num(x.bal))}<span class="s">${fmtPct(x.apr, 2)} · ${money(num(x.pay))}/mo</span></span><span class="s"><button class="link small" data-deldebt="${i}">remove</button></span></div>`).join('')}</div>` : ''}
      <div id="proj-body"><p class="muted">Calculating…</p></div>
    </div>`;
  await draw();
  const read = () => { p.attending_start = $('#pj-start').value + '-01'; p.attending_net_monthly = Number($('#pj-inc').value) || 0; p.spending_after = Number($('#pj-sp').value) || 0; p.return_pct = Number($('#pj-ret').value) || 0; p.years = Math.min(40, Math.max(2, Number($('#pj-yrs').value) || 15)); };
  const save = async () => { read(); try { await rpc('set_setting', { p_key: 'projection', p_value: p }); invalidate(); } catch (e) { toast(e.message); } await draw(); };
  $('#pj-save').onclick = save;
  $('#pj-adddebt').onclick = () => {
    openSheet(`<h2>Add a debt</h2><div class="form">
      <label class="field">Name <input id="xd-name" type="text" size="20" placeholder="Student loans"></label>
      <label class="field">Balance <input id="xd-bal" class="short" type="number" inputmode="numeric" style="width:10ch"></label>
      <label class="field">Interest rate % <input id="xd-apr" class="short" type="number" inputmode="decimal" step="0.01" style="width:7ch"></label>
      <label class="field">Payment per month <input id="xd-pay" class="short" type="number" inputmode="numeric" style="width:8ch"></label>
      <div class="actions"><button class="quiet" data-cancel>Cancel</button><button class="primary" data-save>Add</button></div></div>`);
    $('#sheet-body').onclick = async (e) => {
      if (e.target.closest('[data-cancel]')) closeSheet();
      if (e.target.closest('[data-save]')) { const x = { name: $('#xd-name').value.trim() || 'Debt', bal: Number($('#xd-bal').value) || 0, apr: Number($('#xd-apr').value) || 0, pay: Number($('#xd-pay').value) || 0 }; if (!x.bal) return toast('Enter a balance'); p.extra_debts.push(x); closeSheet(); await save(); route(); }
    };
  };
  view.onclick = async (e) => { const b = e.target.closest('[data-deldebt]'); if (b) { p.extra_debts.splice(Number(b.dataset.deldebt), 1); await save(); route(); } };
};

// ---------- Invest ----------
const INV_NAV = [['invest', 'Overview'], ['holdings', 'Holdings'], ['allocation', 'Allocation']];
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
      <div class="scroll"><table class="data"><thead><tr><th>Account</th><th class="num">Value</th><th class="num">Gain</th><th class="num">Your return</th><th class="num">Investment return, 12 mo</th></tr></thead><tbody>
        ${perf.map((x) => `<tr><td>${h(x.name)}<br><span class="muted small">${h(x.institution)}</span></td><td class="num">${money(num(x.value))}</td><td class="num ${x.unrealized == null ? '' : num(x.unrealized) >= 0 ? 'up' : 'down'}">${x.unrealized == null ? '—' : signed(num(x.unrealized)) + ' (' + pct(num(x.unrealized_pct)) + ')'}</td><td class="num">${x.xirr_pct == null ? '—' : fmtPct(x.xirr_pct, 1) + '/yr'}</td><td class="num">${x.twr_12m_pct == null ? '—' : fmtPct(x.twr_12m_pct, 1)}</td></tr>`).join('')}
      </tbody></table></div>
      <p class="muted small">“Your return” is money-weighted (XIRR): it depends on when you put money in. “Investment return” is time-weighted from daily balances with deposits removed: how the holdings themselves did. Both need deposit history, which builds from the day an account is linked.</p>
      <div class="list">${perf.map((x) => `<div class="item"><span class="t">${h(x.name)}</span><span class="a">${signed(num(x.contributed_12m))}<span class="s">put in, 12 mo</span></span><span class="s">dividends ${money2(num(x.dividends_12m))} · fees ${money2(num(x.fees_12m))}</span></div>`).join('')}</div>
    </div>` : '<div class="card"><p class="empty">No investment accounts linked yet. From Accounts → Add account → “Brokerage, retirement or kids’ investment account”.</p></div>'}`;
};

VIEWS.holdings = async (view) => {
  const [hold, conc] = await Promise.all([D.holdings(), D.concentration()]);
  const c = conc[0] || {};
  view.innerHTML = `
    <h1>Invest</h1>${subnav(INV_NAV, 'holdings')}
    <div class="card">
      ${c.positions ? `<div class="row wrap"><span class="stat"><span class="v">${c.positions}</span><span class="l">positions</span></span><span style="width:16px"></span><span class="stat"><span class="v ${num(c.top_pct) > 25 ? 'warn' : ''}">${fmtPct(c.top_pct)}</span><span class="l">in ${h(c.top_ticker || 'largest')}</span></span><span style="width:16px"></span><span class="stat"><span class="v">${fmtPct(c.top5_pct)}</span><span class="l">in the top 5</span></span></div>` : ''}
      <div class="scroll"><table class="data"><thead><tr><th>Security</th><th class="num">Value</th><th class="num">Gain</th><th class="num">Qty</th></tr></thead><tbody>
        ${hold.map((x) => { const g = x.cost_basis != null ? num(x.institution_value) - num(x.cost_basis) : null; return `<tr><td>${h(x.ticker || x.security_name || '')}<br><span class="muted small">${h(x.ticker ? x.security_name : x.account_name)}</span></td><td class="num">${money(num(x.institution_value))}</td><td class="num ${g == null ? '' : g >= 0 ? 'up' : 'down'}">${g == null ? '—' : signed(g)}</td><td class="num">${Number(x.quantity).toLocaleString(undefined, { maximumFractionDigits: 3 })}</td></tr>`; }).join('') || '<tr><td colspan="4" class="empty">No holdings reported yet.</td></tr>'}
      </tbody></table></div>
    </div>`;
};

VIEWS.allocation = async (view) => {
  const [drift, settings] = await Promise.all([D.drift(), D.settings()]);
  const target = settings.target_allocation || {};
  const rows = drift.filter((r) => num(r.value) > 0 || r.target_pct != null);
  view.innerHTML = `
    <h1>Invest</h1>${subnav(INV_NAV, 'allocation')}
    <div class="card">
      <div class="row between wrap"><h2>Mix vs your target</h2><button class="quiet small" id="btn-target">Set target</button></div>
      ${rows.length ? `<div class="alloc">${rows.filter((r) => num(r.pct) > 0).map((r, i) => `<i style="width:${r.pct}%;background:${COLORS[i % COLORS.length]}" title="${h(r.asset_type)}"></i>`).join('')}</div>
      <div class="list">${rows.map((r, i) => `<div class="item"><span class="t"><i class="legend" style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${COLORS[i % COLORS.length]};margin-right:6px"></i>${h(TYPE_NAME[r.asset_type] || r.asset_type)}</span><span class="a">${fmtPct(r.pct)}${r.target_pct != null ? `<span class="s ${Math.abs(num(r.drift_pct)) >= 5 ? 'warn' : ''}">target ${fmtPct(r.target_pct)} · ${num(r.drift_pct) >= 0 ? '+' : ''}${num(r.drift_pct).toFixed(1)}</span>` : ''}</span><span class="s">${money(num(r.value))}</span></div>`).join('')}</div>
      <p class="muted small">Drift of 5 points or more from target is flagged. Rebalance with new contributions rather than selling when you can.</p>` : '<p class="empty">Nothing to allocate yet.</p>'}
    </div>`;
  $('#btn-target').onclick = () => {
    const keys = Object.keys(TYPE_NAME);
    openSheet(`<h2>Target mix</h2><p class="muted small">Percent of the whole portfolio. Leave blank for none.</p><div class="form">${keys.map((k) => `<label class="field" style="display:flex;align-items:center;justify-content:space-between">${TYPE_NAME[k]} <input data-tk="${k}" class="short" type="number" inputmode="numeric" min="0" max="100" value="${target[k] ?? ''}" style="width:6ch"></label>`).join('')}
      <div class="actions"><button class="quiet" data-cancel>Cancel</button><button class="primary" data-save>Save</button></div></div>`);
    $('#sheet-body').onclick = async (e) => {
      if (e.target.closest('[data-cancel]')) closeSheet();
      if (e.target.closest('[data-save]')) { const t = {}; let sum = 0; $$('[data-tk]').forEach((i) => { const v = Number(i.value); if (i.value !== '' && v >= 0) { t[i.dataset.tk] = v; sum += v; } }); if (Math.round(sum) !== 100) return toast('Targets add up to ' + sum + '%, not 100%');
        try { await rpc('set_setting', { p_key: 'target_allocation', p_value: t }); closeSheet(); invalidate(); route(); } catch (err) { toast(err.message); } }
    };
  };
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
