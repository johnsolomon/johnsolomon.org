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
    if (error) throw error;
    await nameKey(reg, friendlyName);
    // The invite session isn't a passkey session; sign in again with the new passkey so data unlocks.
    await sb.auth.signOut({ scope: 'local' });
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
const TABS = { home: 'home', accounts: 'accounts', activity: 'activity', plan: 'plan', budget: 'plan', recurring: 'plan', goals: 'plan', more: 'more', invest: 'more', credit: 'more', settings: 'more', cashflow: 'more' };
function route() {
  if (screens.app.hidden) return;
  const r = (location.hash || '#home').slice(1).split('/')[0];
  state.route = TABS[r] ? r : 'home';
  $$('.tabs a').forEach((a) => a.classList.toggle('on', a.dataset.tab === TABS[state.route]));
  const view = $('#view');
  view.innerHTML = '<p class="muted">Loading…</p>';
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
  const [nw, nwh, cf, acc, rec, spend, ls] = await Promise.all([D.nw(), D.nwh(), D.cashflow(), D.accounts(), D.recurring().catch(() => []), D.spend(), D.lastSync()]);
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
        <a class="link small" href="#cashflow">Cash flow by month</a>
      </div>
    </div>
    <div class="card">
      <h2>Coming up</h2>
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

VIEWS.cashflow = async (view) => {
  const [cf, spend] = await Promise.all([D.cashflow(), D.spend()]);
  const months = [...new Set(spend.map((r) => r.month))].sort().reverse();
  const sel = months[0];
  const avg = (k) => cf.length ? cf.reduce((s, r) => s + num(r[k]), 0) / cf.length : 0;
  view.innerHTML = `
    <h1>Cash flow</h1>
    <div class="card">
      <div class="row between wrap"><h2>Money in and out</h2><span class="legend"><span><i style="background:var(--up)"></i>In</span><span><i style="background:var(--bar2)"></i>Out</span></span></div>
      ${barChart(cf, ['income', 'spending'])}
      <div class="row wrap"><span class="stat"><span class="v">${money(avg('income'))}</span><span class="l">avg monthly income</span></span><span style="width:16px"></span><span class="stat"><span class="v">${money(avg('spending'))}</span><span class="l">avg monthly spending</span></span><span style="width:16px"></span><span class="stat"><span class="v ${avg('income') - avg('spending') >= 0 ? 'up' : 'down'}">${signed(avg('income') - avg('spending'))}</span><span class="l">avg left over</span></span></div>
      <p class="muted small">Transfers between your own accounts and credit-card payments are left out, so money isn’t counted twice.</p>
    </div>
    <div class="card">
      <div class="row between wrap"><h2>By category</h2><select id="cf-month">${months.map((m) => `<option value="${m}">${fmtMonth(m)}</option>`).join('')}</select></div>
      <div id="cf-cats"></div>
    </div>`;
  const draw = (m) => {
    const rows = spend.filter((r) => r.month === m).sort((a, b) => num(b.spent) - num(a.spent));
    const total = rows.reduce((s, r) => s + num(r.spent), 0), max = num(rows[0]?.spent) || 1;
    $('#cf-cats').innerHTML = rows.length ? `<p class="muted small">${money(total)} total</p><div class="list">` + rows.map((r) => `<div class="item tap" data-go="#activity/${encodeURIComponent(r.category)}"><span class="t">${h(r.category)}</span><span class="a">${money(num(r.spent))}<span class="s">${(100 * num(r.spent) / total).toFixed(0)}% · ${r.n} items</span></span><span class="s" style="grid-column:1/-1">${progress(num(r.spent), max)}</span></div>`).join('') + '</div>' : '<p class="empty">Nothing for this month.</p>';
    bindGo($('#cf-cats'));
  };
  $('#cf-month').onchange = (e) => draw(e.target.value);
  if (sel) draw(sel);
};

VIEWS.plan = async (view) => { location.hash = '#budget'; };

function subnav(items, on) { return `<div class="sub">${items.map(([k, l]) => `<a href="#${k}" class="${k === on ? 'on' : ''}">${l}</a>`).join('')}</div>`; }
const PLAN_NAV = [['budget', 'Budget'], ['recurring', 'Recurring'], ['goals', 'Goals']];
const MORE_NAV = [['invest', 'Investments'], ['credit', 'Credit & fees'], ['cashflow', 'Cash flow'], ['settings', 'Settings']];

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
  view.onclick = (e) => { const el = e.target.closest('[data-goal]'); if (el) edit(goals.find((x) => String(x.id) === el.dataset.goal)); };
};

VIEWS.more = async (view) => {
  view.innerHTML = `<h1>More</h1><div class="card"><div class="list">${[...MORE_NAV].map(([k, l]) => `<a class="item tap" href="#${k}"><span class="t">${l}</span><span class="a muted">›</span></a>`).join('')}</div></div>`;
};

VIEWS.invest = async (view) => {
  const [hold, alloc, acc, nwh] = await Promise.all([D.holdings(), D.alloc(), D.accounts(), D.nwh()]);
  const inv = acc.filter((a) => a.type === 'investment' && !a.hidden);
  const total = inv.reduce((s, a) => s + num(a.current_balance), 0);
  const cost = hold.reduce((s, x) => s + (num(x.cost_basis) || 0), 0), val = hold.reduce((s, x) => s + num(x.institution_value), 0);
  const colors = ['var(--bar2)', 'var(--up)', 'var(--warn)', 'var(--down)', 'var(--muted)', 'var(--bar)'];
  const typeName = { equity: 'Stocks', etf: 'ETFs', mutual_fund: 'Mutual funds', fixed_income: 'Bonds', cash: 'Cash', derivative: 'Options', cryptocurrency: 'Crypto', other: 'Other' };
  view.innerHTML = `
    <h1>Investments</h1>${subnav(MORE_NAV, 'invest')}
    ${inv.length ? `
    <div class="card">
      <div class="hero"><span class="label">Invested</span><span class="big">${money(total)}</span>${cost ? `<span class="small ${val - cost >= 0 ? 'up' : 'down'}">${signed(val - cost)} vs cost (${pct(100 * (val - cost) / cost)})</span>` : ''}</div>
      ${alloc.length ? `<div class="alloc">${alloc.map((a, i) => `<i style="width:${a.pct}%;background:${colors[i % colors.length]}" title="${h(a.asset_type)}"></i>`).join('')}</div>
      <div class="legend" style="flex-wrap:wrap">${alloc.map((a, i) => `<span><i style="background:${colors[i % colors.length]}"></i>${h(typeName[a.asset_type] || a.asset_type)} ${Number(a.pct).toFixed(0)}%</span>`).join('')}</div>` : ''}
      <div class="list">${inv.map((a) => `<div class="item"><span class="t">${h(a.nickname || a.name)}</span><span class="a">${money(num(a.current_balance))}</span><span class="s">${h(a.institution_name)} · ${h(a.subtype || '')}</span></div>`).join('')}</div>
    </div>
    <div class="card"><h2>Holdings</h2><div class="scroll"><table class="data"><thead><tr><th>Security</th><th class="num">Value</th><th class="num">Gain</th><th class="num">Qty</th></tr></thead><tbody>
      ${hold.map((x) => { const g = x.cost_basis != null ? num(x.institution_value) - num(x.cost_basis) : null; return `<tr><td>${h(x.ticker || x.security_name || '')}<br><span class="muted small">${h(x.ticker ? x.security_name : x.account_name)}</span></td><td class="num">${money(num(x.institution_value))}</td><td class="num ${g == null ? '' : g >= 0 ? 'up' : 'down'}">${g == null ? '—' : signed(g)}</td><td class="num">${Number(x.quantity).toLocaleString(undefined, { maximumFractionDigits: 3 })}</td></tr>`; }).join('') || '<tr><td colspan="4" class="empty">No holdings reported yet.</td></tr>'}
    </tbody></table></div></div>` : '<div class="card"><p class="empty">No investment accounts linked. Add a brokerage or retirement account from Accounts.</p></div>'}`;
};

VIEWS.credit = async (view) => {
  const [credit, fees, acc] = await Promise.all([D.credit(), D.fees(), D.accounts()]);
  const last = credit[credit.length - 1], prev = credit[credit.length - 2];
  const cards = acc.filter((a) => a.type === 'credit' && !a.hidden);
  const util = cards.reduce((s, a) => s + num(a.current_balance), 0), limit = cards.reduce((s, a) => s + (num(a.credit_limit) || 0), 0);
  const feesYear = fees.reduce((s, r) => s + num(r.fees), 0), intYear = fees.reduce((s, r) => s + num(r.interest_paid), 0), earned = fees.reduce((s, r) => s + num(r.interest_earned), 0);
  view.innerHTML = `
    <h1>Credit & fees</h1>${subnav(MORE_NAV, 'credit')}
    <div class="card">
      <div class="row between wrap"><div class="hero"><span class="label">Credit score</span><span class="big">${last ? last.score : '—'}</span><span class="muted small">${last ? `${h(last.bureau || '')} ${fmtDay(last.as_of)}${prev ? ` · <span class="${last.score - prev.score >= 0 ? 'up' : 'down'}">${last.score - prev.score >= 0 ? '+' : ''}${last.score - prev.score}</span> since ${fmtDay(prev.as_of)}` : ''}` : 'Log it from your card’s app whenever you check it'}</span></div><button class="primary" id="btn-score">Log score</button></div>
      ${credit.length > 1 ? lineChart(credit.map((c) => ({ t: c.as_of, v: c.score })), 640, 150, (v) => String(Math.round(v))) : ''}
      ${limit ? `<p class="small">Card balances ${money(util)} of ${money(limit)} limits · <b class="${util / limit > 0.3 ? 'warn' : 'up'}">${(100 * util / limit).toFixed(0)}% used</b> <span class="muted">(under 30% helps the score)</span></p>` : ''}
    </div>
    <div class="card">
      <h2>Fees and interest, last 12 months</h2>
      <div class="row wrap"><span class="stat"><span class="v ${feesYear ? 'down' : ''}">${money2(feesYear)}</span><span class="l">fees paid</span></span><span style="width:16px"></span><span class="stat"><span class="v ${intYear ? 'down' : ''}">${money2(intYear)}</span><span class="l">interest paid</span></span><span style="width:16px"></span><span class="stat"><span class="v up">${money2(earned)}</span><span class="l">interest earned</span></span></div>
      ${barChart(fees.map((r) => ({ month: r.month, fees: num(r.fees), interest_paid: num(r.interest_paid) })), ['fees', 'interest_paid'], 640, 140)}
      <div class="legend"><span><i style="background:var(--bar2)"></i>Fees</span><span><i style="background:var(--bar)"></i>Interest</span></div>
      <div class="list">${cards.map((a) => `<div class="item"><span class="t">${h(a.nickname || a.name)}</span><span class="a">${a.interest_rate != null ? Number(a.interest_rate).toFixed(2) + '% APR' : '—'}</span><span class="s">${a.next_payment_due_date ? 'due ' + fmtDay(a.next_payment_due_date) : ''}${a.minimum_payment_amount ? ' · minimum ' + money2(num(a.minimum_payment_amount)) : ''}${a.is_overdue ? ' · <span class="down">overdue</span>' : ''}</span></div>`).join('')}</div>
    </div>`;
  $('#btn-score').onclick = () => {
    openSheet(`<h2>Log credit score</h2><div class="form">
      <label class="field">Score <input id="c-score" class="short" type="number" inputmode="numeric" min="300" max="850" value="${last ? last.score : ''}"></label>
      <label class="field">Date <input id="c-date" type="date" value="${today()}" style="width:auto"></label>
      <label class="field">Bureau <select id="c-bureau"><option>Experian</option><option>Equifax</option><option>TransUnion</option></select></label>
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

VIEWS.settings = async (view) => {
  const [{ data: pk }, rules, ls] = await Promise.all([sb.auth.passkey.list().catch(() => ({ data: [] })), D.rules(), D.lastSync()]);
  const keys = (pk && (pk.passkeys || pk)) || [];
  view.innerHTML = `
    <h1>Settings</h1>${subnav(MORE_NAV, 'settings')}
    <div class="card"><h2>Signed in as ${h(state.me.display_name || '')}</h2>
      <p class="muted small">Locks itself after 5 minutes without a touch, or when the app has been in the background 5 minutes. Face ID to come back.</p>
      <div class="row wrap"><button class="quiet" id="btn-sync">Refresh from banks now</button><button class="quiet" id="btn-signout">Sign out</button></div>
      <p class="muted small">${ls[0] ? `Last refresh ${relTime(ls[0].finished_at || ls[0].started_at)} (${h(ls[0].status)}, ${ls[0].tx_added} new). Automatic refresh runs every morning.` : ''}</p>
    </div>
    <div class="card"><div class="row between"><h2>Passkeys</h2><button class="quiet" id="btn-addkey">Add this device</button></div>
      <p class="muted small">Each device you sign in from keeps its own passkey. Remove any you don’t recognize.</p>
      <div class="list">${(Array.isArray(keys) ? keys : []).map((k) => `<div class="item"><span class="t">${h(k.friendly_name || k.friendlyName || 'Passkey')}</span><span class="a"><button class="quiet small danger" data-delkey="${h(k.id)}">Remove</button></span><span class="s">added ${k.created_at ? fmtDay(k.created_at) : ''}${k.last_used_at ? ' · last used ' + fmtDay(k.last_used_at) : ''}</span></div>`).join('') || '<p class="empty">No passkeys listed.</p>'}</div>
    </div>
    <div class="card"><h2>Category rules</h2><p class="muted small">Applied to every new transaction whose description contains the text.</p>
      <div class="list">${rules.map((r) => `<div class="item"><span class="t">“${h(r.match)}” → ${h(r.category)}${r.is_transfer ? ' (transfer)' : ''}${r.excluded ? ' (excluded)' : ''}</span><span class="a"><button class="quiet small danger" data-delrule="${r.id}">Remove</button></span></div>`).join('') || '<p class="empty">No rules yet. Make one from any transaction with “Always use this category”.</p>'}</div>
    </div>`;
  $('#btn-sync').onclick = async (e) => { e.target.disabled = true; try { await portal('sync'); toast('Refreshing… numbers update in a minute.'); setTimeout(() => { invalidate(); route(); }, 45000); } catch (err) { toast(err.message); e.target.disabled = false; } };
  $('#btn-signout').onclick = async () => { await sb.auth.signOut({ scope: 'local' }); state.cache = {}; gate(); };
  $('#btn-addkey').onclick = async (e) => { e.target.disabled = true; try { const { data: reg, error } = await sb.auth.registerPasskey(); if (error) throw error; await nameKey(reg, prompt('Name this device', 'New device') || 'New device'); toast('Passkey added'); route(); } catch (err) { toast(err.message); e.target.disabled = false; } };
  view.onclick = async (e) => {
    const dk = e.target.closest('[data-delkey]'), dr = e.target.closest('[data-delrule]');
    if (dk) { if (keys.length <= 1) return toast('Keep at least one passkey'); try { const { error } = await sb.auth.passkey.delete({ passkeyId: dk.dataset.delkey }); if (error) throw error; route(); } catch (err) { toast(err.message); } }
    if (dr) { try { await rpc('delete_rule', { p_id: Number(dr.dataset.delrule) }); invalidate(); route(); } catch (err) { toast(err.message); } }
  };
};

async function nameKey(reg, friendlyName) {
  const id = reg?.passkey?.id || reg?.id || reg?.credential_id;
  if (id) await sb.auth.passkey.update({ passkeyId: id, friendlyName }).catch(() => {});
}
function bindGo(el) { el.addEventListener('click', (e) => { const g = e.target.closest('[data-go]'); if (g) location.hash = g.dataset.go; }); }
function relTime(s) { if (!s) return ''; const m = (Date.now() - new Date(s)) / 60000; return m < 2 ? 'just now' : m < 60 ? Math.round(m) + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' d ago'; }

boot();
})();
