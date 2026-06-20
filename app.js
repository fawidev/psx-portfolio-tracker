/* ════════════════════════════════════════════════
   PSX TRACKER — application logic
   Reads APPS_SCRIPT_URL + GOOGLE_CLIENT_ID from config.js
   (both are global because config.js loads first).
   ════════════════════════════════════════════════ */

/* ── State ── */
const state = {
  user: null,
  portfolios: [],
  activePid: null,
  holdings: [],
  investments: [],
  tab: 'overview',
  editingPid: null,
  market: null,        // cached market-watch rows for the session
  marketAt: 0,         // timestamp of last market fetch
  mkt: { q:'', sector:'All', sort:'change' },   // Market tab filters
};

const SECTORS = ['Banking','Energy','Fertilizer','Cement','Tech','Auto','Textile','Pharma','Food','Other'];
const INDEXES = ['KSE-100','KMI-30','KSE-30','PSX All Share','Custom'];
const SIP_WEIGHTS = { Banking:30, Energy:20, Fertilizer:20, Cement:15, Other:15 };

// Friendly label <-> PSX "LISTED IN" code. Custom = no filter (all symbols).
const INDEX_NAME = { KSE100:'KSE-100', KSE30:'KSE-30', KMI30:'KMI-30', KMIALLSHR:'KMI All Share', ALLSHR:'PSX All Share', KSE100PR:'KSE-100 PR' };
const INDEX_CODE = { 'KSE-100':'KSE100', 'KSE-30':'KSE30', 'KMI-30':'KMI30', 'KMI All Share':'KMIALLSHR', 'PSX All Share':'ALLSHR', 'KSE-100 PR':'KSE100PR', 'Custom':null };

function codeForIndexLabel(label){
  if (label === 'Custom' || !label) return null;
  if (label in INDEX_CODE) return INDEX_CODE[label];
  return label;   // label may already be a raw PSX code
}

/* Index labels available to pick — derived from the live market data when loaded,
   else the static fallback list. */
function availableIndexes(){
  const counts = {};
  (state.market || []).forEach(r => (r.indexes || []).forEach(c => { counts[c] = (counts[c]||0) + 1; }));
  const codes = Object.keys(counts).filter(c => counts[c] >= 10);
  if (!codes.length) return INDEXES.slice();
  const order = ['KSE100','KSE30','KMI30','KMIALLSHR','ALLSHR'];
  const ordered = order.filter(c => counts[c]).concat(codes.filter(c => !order.includes(c)).sort());
  return ordered.map(c => INDEX_NAME[c] || c).concat('Custom');
}

function indexOptions(selected){
  return availableIndexes().map(l => `<option ${l===selected?'selected':''}>${escapeHtml(l)}</option>`).join('');
}

const MARKET_TTL = 10 * 60 * 1000;   // reuse market data for 10 min in-session

/* ── Helpers ── */
const $ = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => [...r.querySelectorAll(s)];
const fmt = n => '₨' + Math.round(Number(n)||0).toLocaleString('en-IN');
const fmtN = n => (Math.round(Number(n)||0)).toLocaleString('en-IN');
const pct = n => (n>=0?'+':'') + (Math.round(n*100)/100).toFixed(2) + '%';
const uid = () => crypto.randomUUID ? crypto.randomUUID() : 'id-'+Math.random().toString(36).slice(2);
const today = () => new Date().toISOString().slice(0,10);

function toast(msg, type='') {
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.innerHTML = `<i class="ti ti-${type==='err'?'alert-circle':type==='ok'?'check':'info-circle'}"></i> ${msg}`;
  $('#toasts').appendChild(el);
  setTimeout(()=>{ el.style.opacity='0'; el.style.transform='translateY(10px)'; el.style.transition='.25s'; }, 2400);
  setTimeout(()=> el.remove(), 2800);
}

function escapeHtml(s){ return String(s??'').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

/* Map a PSX sector name to one of our buckets for the dropdown. */
function mapSector(psx){
  const s = (psx||'').toUpperCase();
  if (/BANK/.test(s)) return 'Banking';
  if (/OIL|GAS|REFIN|POWER|ENERGY|ELECTRIC/.test(s)) return 'Energy';
  if (/FERTIL/.test(s)) return 'Fertilizer';
  if (/CEMENT/.test(s)) return 'Cement';
  if (/TECH|COMMUNICAT|SOFTWARE/.test(s)) return 'Tech';
  if (/AUTO|MOTOR/.test(s)) return 'Auto';
  if (/TEXTILE|SPINNING|WEAVING/.test(s)) return 'Textile';
  if (/PHARMA/.test(s)) return 'Pharma';
  if (/FOOD|SUGAR|TOBACCO|PERSONAL/.test(s)) return 'Food';
  return 'Other';
}

/* ── Theme ── */
const savedTheme = localStorage.getItem('psx-theme') || 'light';
if (savedTheme === 'dark') document.documentElement.setAttribute('data-theme','dark');

/* ── API ── */
async function api(action, payload={}) {
  if (!APPS_SCRIPT_URL || APPS_SCRIPT_URL.startsWith('PASTE')) {
    throw new Error('Set APPS_SCRIPT_URL in config.js');
  }
  const body = { action, userEmail: state.user?.email, ...payload };
  const res = await fetch(APPS_SCRIPT_URL, {
    method:'POST',
    // text/plain avoids the CORS preflight that Apps Script doesn't answer
    headers:{ 'Content-Type':'text/plain;charset=utf-8' },
    body: JSON.stringify(body),
  });
  const j = await res.json();
  if (!j.success) throw new Error(j.error || 'API error');
  return j.data;
}

/* Load + cache live PSX market data for the session. */
function decodeEnt(s){
  return String(s??'').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&#39;/g,"'").replace(/&quot;/g,'"');
}

async function loadMarket(force=false){
  if (!force && state.market && (Date.now() - state.marketAt) < MARKET_TTL) return state.market;
  const rows = await api('getMarketWatch');
  state.market = (Array.isArray(rows) ? rows : []).map(r => ({ ...r, name: decodeEnt(r.name), sector: decodeEnt(r.sector) }));
  state.marketAt = Date.now();
  return state.market;
}

/* Companies for a given index label. PSX market-watch is ordered by trading
   activity (most active first), so we preserve that order — "top of the list"
   = most actively traded today. */
function companiesForIndex(indexLabel){
  const code = codeForIndexLabel(indexLabel);
  const all = state.market || [];
  return code ? all.filter(r => r.indexes && r.indexes.includes(code)) : all.slice();
}

function quoteFor(symbol){
  return (state.market || []).find(r => r.symbol === symbol);
}

/* Link to a company's page on the PSX data portal. */
const psxUrl = sym => `https://dps.psx.com.pk/company/${encodeURIComponent(sym)}`;

/* ════════════════════════════════════════════════
   AUTH
   ════════════════════════════════════════════════ */
function decodeJWT(t){ return JSON.parse(atob(t.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))); }

function onCredential(resp) {
  const p = decodeJWT(resp.credential);
  state.user = { email: (p.email||'').toLowerCase(), name: p.name, picture: p.picture, token: resp.credential };
  sessionStorage.setItem('psx-user', JSON.stringify(state.user));
  enterApp();
}

function initGoogle() {
  if (!window.google || !google.accounts) { setTimeout(initGoogle, 200); return; }
  if (!GOOGLE_CLIENT_ID || GOOGLE_CLIENT_ID.startsWith('PASTE')) {
    $('#googleBtn').innerHTML = '<div style="padding:12px;border:1px dashed var(--loss);border-radius:8px;color:var(--loss);font:500 12px var(--mono)">Set GOOGLE_CLIENT_ID in config.js</div>';
    return;
  }
  google.accounts.id.initialize({ client_id: GOOGLE_CLIENT_ID, callback: onCredential });
  google.accounts.id.renderButton($('#googleBtn'), { theme:'outline', size:'large', text:'continue_with', shape:'pill', width:300 });
}

function logout() {
  sessionStorage.removeItem('psx-user');
  if (window.google?.accounts?.id) google.accounts.id.disableAutoSelect();
  location.reload();
}

/* ════════════════════════════════════════════════
   APP ENTRY
   ════════════════════════════════════════════════ */
async function enterApp() {
  $('#login').style.display = 'none';
  $('#app').style.display = 'block';
  $('#userName').textContent = state.user.name;
  $('#userPic').src = state.user.picture;
  try {
    state.portfolios = await api('getPortfolios');
    if (!state.portfolios.length) {
      renderChips();
      renderEmptyState();
      return;
    }
    state.activePid = state.portfolios[0].id;
    await loadPortfolioData();
    renderAll();
  } catch (e) {
    toast(e.message, 'err');
    renderChips();
    renderEmptyState();
  }
  // Warm the market cache in the background (non-blocking).
  loadMarket().catch(()=>{});
}

async function loadPortfolioData() {
  if (!state.activePid) { state.holdings=[]; state.investments=[]; return; }
  const [h, i] = await Promise.all([
    api('getHoldings',    { portfolioId: state.activePid }),
    api('getInvestments', { portfolioId: state.activePid }),
  ]);
  state.holdings = h.map(x => ({ ...x, shares:+x.shares, avgCost:+x.avgCost, currPrice:+x.currPrice }));
  state.investments = i.map(x => ({ ...x, amount:+x.amount }));
}

/* ════════════════════════════════════════════════
   RENDER
   ════════════════════════════════════════════════ */
function renderAll(){ renderChips(); renderTab(); updateFoot(); }

function updateFoot(){
  const p = activePortfolio();
  $('#footMeta').textContent = p ? `${state.portfolios.length} portfolios · active: ${p.name}` : `${state.portfolios.length} portfolios`;
}

function activePortfolio(){ return state.portfolios.find(p => p.id === state.activePid); }

function renderChips() {
  const c = $('#chips');
  c.innerHTML = '';
  state.portfolios.forEach(p => {
    const b = document.createElement('button');
    b.className = 'chip' + (p.id === state.activePid ? ' active' : '');
    b.innerHTML = `<span>${escapeHtml(p.name)}</span><span class="idx">${escapeHtml(p.index)}</span>`;
    b.onclick = async () => {
      state.activePid = p.id;
      await loadPortfolioData();
      renderAll();
    };
    c.appendChild(b);
  });
  const nb = document.createElement('button');
  nb.className = 'chip chip-new';
  nb.innerHTML = '<i class="ti ti-plus"></i> New portfolio';
  nb.onclick = () => portfolioModal();
  c.appendChild(nb);
}

function renderEmptyState() {
  $('#main').innerHTML = `
    <div class="card empty">
      <i class="ti ti-folders"></i>
      <h4>No portfolios yet</h4>
      <p>Create your first portfolio to start tracking holdings, SIPs and sector allocation.</p>
      <button class="btn" onclick="portfolioModal()"><i class="ti ti-plus"></i> Create portfolio</button>
    </div>`;
}

function renderTab() {
  if (!state.activePid) return renderEmptyState();
  if (state.tab === 'overview') return renderOverview();
  if (state.tab === 'holdings') return renderHoldings();
  if (state.tab === 'market')   return renderMarket();
  if (state.tab === 'invest')   return renderInvest();
  if (state.tab === 'history')  return renderHistory();
}

function gotoMarket(){ state.tab = 'market'; updateTabs(); renderTab(); }

/* ── Tab: Overview ─────────────────────────────── */
function renderOverview() {
  const p = activePortfolio();
  const invested = state.investments.reduce((s,x)=>s+x.amount,0);
  const currentValue = state.holdings.reduce((s,h)=>s+h.shares*h.currPrice,0);
  const costBasis = state.holdings.reduce((s,h)=>s+h.shares*h.avgCost,0);
  const pnl = currentValue - costBasis;
  const pnlPct = costBasis ? (pnl/costBasis)*100 : 0;
  const sipMonths = p.monthlyTarget>0 ? invested / p.monthlyTarget : 0;

  // Sector allocation
  const bySector = {};
  state.holdings.forEach(h => {
    const v = h.shares*h.currPrice;
    bySector[h.sector] = (bySector[h.sector]||0) + v;
  });
  const sectorTotal = Object.values(bySector).reduce((a,b)=>a+b,0) || 1;
  const sectorBars = Object.entries(bySector).sort((a,b)=>b[1]-a[1])
    .map(([s,v]) => {
      const pc = v/sectorTotal*100;
      return `<div class="bar-item"><span class="nm">${escapeHtml(s)}</span><span class="tr"><span class="fl" style="width:${pc}%"></span></span><span class="pc">${pc.toFixed(1)}%</span></div>`;
    }).join('') || '<div class="muted">No holdings yet.</div>';

  // Cumulative invest chart
  const sorted = [...state.investments].sort((a,b)=>(''+a.date).localeCompare(''+b.date));
  let cum = 0;
  const points = sorted.map(x => { cum+=x.amount; return { date: (''+x.date).slice(0,10), v: cum }; });
  const chart = buildBarChart(points);

  $('#main').innerHTML = `
    <div class="page-head">
      <div>
        <div class="sub">Tab 01 · Overview</div>
        <h2>${escapeHtml(p.name)}</h2>
      </div>
      <div class="row" style="gap:6px"><span class="badge info">${escapeHtml(p.index)}</span>
        <span class="badge">Target ${fmt(p.monthlyTarget)}/mo</span></div>
    </div>

    <div class="metric-grid">
      <div class="metric card hero">
        <span class="corner">PKR</span>
        <div class="lbl">Current Value</div>
        <div class="val">${fmt(currentValue)}</div>
        <div class="delta" style="color:${pnl>=0?'#9ce5c8':'#ffb1b1'}">
          <i class="ti ti-${pnl>=0?'trending-up':'trending-down'}"></i> ${fmt(pnl)} (${pct(pnlPct)})
        </div>
      </div>
      <div class="metric card">
        <span class="corner">01</span>
        <div class="lbl">Total Invested</div><div class="val">${fmt(invested)}</div>
        <div class="delta muted">${state.investments.length} transactions</div>
      </div>
      <div class="metric card">
        <span class="corner">02</span>
        <div class="lbl">Total P&amp;L</div>
        <div class="val ${pnl>=0?'gain':'loss'}">${fmt(pnl)}</div>
        <div class="delta ${pnl>=0?'gain':'loss'}">${pct(pnlPct)}</div>
      </div>
      <div class="metric card">
        <span class="corner">03</span>
        <div class="lbl">SIP Months</div>
        <div class="val">${sipMonths.toFixed(1)}</div>
        <div class="delta muted">at ${fmt(p.monthlyTarget)}/mo</div>
      </div>
    </div>

    <div class="chart-row">
      <div class="card chart">
        <h3><i class="ti ti-chart-bar"></i> Cumulative Investment</h3>
        <div class="sub">PKR · over time</div>
        ${chart}
      </div>
      <div class="card chart">
        <h3><i class="ti ti-chart-pie-2"></i> Sector Allocation</h3>
        <div class="sub">by current value</div>
        ${sectorBars}
      </div>
    </div>
  `;
}

function buildBarChart(points) {
  if (!points.length) return '<div class="muted" style="padding:20px 0">No investments logged yet.</div>';
  const W = 600, H = 200, P = 30;
  const max = Math.max(...points.map(p=>p.v));
  const bw = (W - P*2) / points.length;
  const bars = points.map((p,i) => {
    const h = (p.v / max) * (H - P*2);
    const x = P + i*bw + 2;
    const y = H - P - h;
    return `<rect x="${x}" y="${y}" width="${bw-4}" height="${h}" fill="var(--accent)" rx="2"/>
            <text x="${x+(bw-4)/2}" y="${H-10}" text-anchor="middle" font-size="9" font-family="var(--mono)" fill="var(--ink-soft)">${p.date.slice(5)}</text>`;
  }).join('');
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="max-height:240px">
    <line x1="${P}" y1="${H-P}" x2="${W-P}" y2="${H-P}" stroke="var(--line)"/>
    <text x="${P}" y="20" font-size="10" font-family="var(--mono)" fill="var(--ink-soft)">${fmt(max)}</text>
    ${bars}
  </svg>`;
}

/* ── Tab: Holdings ─────────────────────────────── */
function renderHoldings() {
  const rows = state.holdings.map(h => {
    const value = h.shares * h.currPrice;
    const cost  = h.shares * h.avgCost;
    const pnl   = value - cost;
    const pnlP  = cost ? (pnl/cost*100) : 0;
    return `<tr data-id="${h.id}">
      <td><a href="${psxUrl(h.symbol)}" target="_blank" rel="noopener" title="View ${escapeHtml(h.symbol)} on PSX"><span class="sym">${escapeHtml(h.symbol)}</span> <i class="ti ti-external-link" style="font-size:11px;color:var(--ink-soft)"></i></a><div class="sec">${escapeHtml(h.sector)}</div></td>
      <td class="mono">${fmtN(h.shares)}</td>
      <td class="mono">${fmt(h.avgCost)}</td>
      <td><input class="cell-input" type="number" step="0.01" value="${h.currPrice}" data-field="currPrice" data-id="${h.id}"/></td>
      <td class="mono">${fmt(value)}</td>
      <td class="${pnl>=0?'gain':'loss'} mono">${fmt(pnl)}<br/><span style="font-size:10px">${pct(pnlP)}</span></td>
      <td class="row-actions"><button title="Delete" onclick="deleteHolding('${h.id}')"><i class="ti ti-trash"></i></button></td>
    </tr>`;
  }).join('');

  $('#main').innerHTML = `
    <div class="page-head">
      <div>
        <div class="sub">Tab 02 · Holdings</div>
        <h2>Positions</h2>
      </div>
      <div class="row" style="gap:8px">
        <button class="btn ghost" id="refreshBtn" onclick="refreshPrices()"><i class="ti ti-refresh"></i> Refresh prices</button>
        <button class="btn" onclick="gotoMarket()"><i class="ti ti-plus"></i> Add stock</button>
      </div>
    </div>
    <div class="card">
      ${state.holdings.length ? `
      <div class="table-wrap"><table>
        <thead><tr>
          <th>Symbol</th><th>Shares</th><th>Avg Cost</th><th>Curr Price</th><th>Value</th><th>P&amp;L</th><th></th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table></div>` : `
      <div class="empty">
        <i class="ti ti-chart-candle"></i>
        <h4>No holdings yet</h4>
        <p>Browse the ${escapeHtml(activePortfolio().index)} companies and add your first position.</p>
        <button class="btn" onclick="gotoMarket()"><i class="ti ti-plus"></i> Browse market</button>
      </div>`}
    </div>
  `;

  $$('.cell-input').forEach(inp => {
    inp.addEventListener('change', async (e) => {
      const id = e.target.dataset.id;
      const h = state.holdings.find(x => x.id === id);
      if (!h) return;
      h.currPrice = +e.target.value;
      try {
        await api('saveHolding', { id:h.id, portfolioId:h.portfolioId, symbol:h.symbol, sector:h.sector, shares:h.shares, avgCost:h.avgCost, currPrice:h.currPrice });
        toast('Price updated','ok'); renderHoldings();
      } catch(err){ toast(err.message,'err'); }
    });
  });
}

/* Pull live prices for all holdings from the PSX market watch. */
async function refreshPrices(){
  const btn = $('#refreshBtn');
  if (btn){ btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Fetching…'; }
  try {
    await loadMarket(true);
    let updated = 0;
    for (const h of state.holdings){
      const q = quoteFor(h.symbol);
      if (q && q.price > 0 && q.price !== h.currPrice){
        h.currPrice = q.price;
        updated++;
        await api('saveHolding', { id:h.id, portfolioId:h.portfolioId, symbol:h.symbol, sector:h.sector, shares:h.shares, avgCost:h.avgCost, currPrice:h.currPrice });
      }
    }
    renderHoldings();
    toast(updated ? `Updated ${updated} price${updated>1?'s':''} from PSX` : 'Prices already up to date', 'ok');
  } catch(e){
    toast('Could not fetch live prices: ' + e.message, 'err');
    renderHoldings();
  }
}

async function deleteHolding(id){
  if (!confirm('Delete this holding?')) return;
  try { await api('deleteHolding',{id}); state.holdings = state.holdings.filter(h=>h.id!==id); renderHoldings(); toast('Deleted','ok'); }
  catch(e){ toast(e.message,'err'); }
}

/* ── Tab: Market (browse the index, click to add) ───── */
function renderMarket() {
  const p = activePortfolio();
  $('#main').innerHTML = `
    <div class="page-head">
      <div><div class="sub">Tab 03 · Market</div><h2>Browse ${escapeHtml(p.index === 'Custom' ? 'all PSX' : p.index)}</h2></div>
      <button class="btn ghost sm" onclick="addHoldingModal()"><i class="ti ti-plus"></i> Custom symbol</button>
    </div>
    <div class="mkt-controls">
      <input class="search" id="mktSearch" type="search" placeholder="Search symbol or company…" value="${escapeHtml(state.mkt.q)}"/>
      <select id="mktSector"><option>All sectors</option></select>
      <select id="mktSort">
        <option value="change">Sort · % change</option>
        <option value="price">Sort · price</option>
        <option value="symbol">Sort · symbol</option>
      </select>
      <button class="btn ghost sm" id="mktRefresh" onclick="refreshMarket()" title="Refresh prices"><i class="ti ti-refresh"></i></button>
    </div>
    <div class="card"><div id="mktBody"><div class="fullspin"><span class="spin"></span></div></div></div>
  `;

  $('#mktSort').value = state.mkt.sort;
  $('#mktSearch').addEventListener('input', e => { state.mkt.q = e.target.value; renderMarketRows(); });
  $('#mktSort').addEventListener('change', e => { state.mkt.sort = e.target.value; renderMarketRows(); });

  loadMarket().then(() => { buildSectorFilter(p.index); renderMarketRows(); })
    .catch(e => {
      $('#mktBody').innerHTML = `<div class="empty"><i class="ti ti-cloud-off"></i><h4>Couldn't load market data</h4><p>${escapeHtml(e.message)}</p><button class="btn" onclick="refreshMarket()">Retry</button></div>`;
    });
}

function buildSectorFilter(index) {
  const buckets = [...new Set(companiesForIndex(index).map(r => mapSector(r.sector)))].sort();
  const sel = $('#mktSector');
  if (!sel) return;
  sel.innerHTML = `<option value="All">All sectors</option>` + buckets.map(b => `<option ${state.mkt.sector===b?'selected':''}>${b}</option>`).join('');
  sel.value = state.mkt.sector;
  sel.addEventListener('change', e => { state.mkt.sector = e.target.value; renderMarketRows(); });
}

function renderMarketRows() {
  const body = $('#mktBody'); if (!body) return;
  const p = activePortfolio();
  let list = companiesForIndex(p.index);

  const q = state.mkt.q.trim().toUpperCase();
  if (q) list = list.filter(r => r.symbol.includes(q) || (r.name||'').toUpperCase().includes(q));
  if (state.mkt.sector !== 'All') list = list.filter(r => mapSector(r.sector) === state.mkt.sector);

  const sort = state.mkt.sort;
  list = list.slice().sort((a,b) =>
    sort === 'price'  ? b.price - a.price :
    sort === 'symbol' ? a.symbol.localeCompare(b.symbol) :
                        (b.changePct||0) - (a.changePct||0));

  const owned = new Set(state.holdings.map(h => h.symbol));
  const rows = list.map(r => {
    const cls = r.changePct >= 0 ? 'gain' : 'loss';
    return `<tr>
      <td><a href="${psxUrl(r.symbol)}" target="_blank" rel="noopener" title="View ${escapeHtml(r.symbol)} on PSX"><span class="sym">${escapeHtml(r.symbol)}</span> <i class="ti ti-external-link" style="font-size:10px;color:var(--ink-soft)"></i></a>${owned.has(r.symbol)?' <span class="owned-badge">● owned</span>':''}</td>
      <td class="muted" style="max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(r.name)}</td>
      <td><span class="sec">${escapeHtml(mapSector(r.sector))}</span></td>
      <td class="mono">${fmt(r.price)}</td>
      <td class="mono ${cls}">${pct(r.changePct)}</td>
      <td class="row-actions"><button class="btn sm" onclick="marketAdd('${escapeHtml(r.symbol)}')"><i class="ti ti-plus"></i> Add</button></td>
    </tr>`;
  }).join('');

  const filtered = q || state.mkt.sector !== 'All';
  body.innerHTML = list.length ? `
    <div class="table-wrap mkt-scroll"><table>
      <thead><tr><th>Symbol</th><th>Company</th><th>Sector</th><th>Price</th><th>Chg%</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    <div class="mkt-foot muted">${list.length} ${list.length===1?'company':'companies'}${filtered?' · filtered':''}</div>
  ` : `<div class="empty"><i class="ti ti-search-off"></i><h4>No matches</h4><p>Try a different search or sector.</p></div>`;
}

function marketAdd(symbol) {
  const r = quoteFor(symbol);
  addHoldingModal(r ? { symbol:r.symbol, sector:mapSector(r.sector), price:r.price } : { symbol });
}

async function refreshMarket() {
  const btn = $('#mktRefresh');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spin"></span>'; }
  try {
    await loadMarket(true);
    buildSectorFilter(activePortfolio().index);
    renderMarketRows();
    toast('Market refreshed','ok');
  } catch(e) { toast(e.message,'err'); }
}

/* ── Tab: Add Investment ───────────────────────── */
function renderInvest() {
  const p = activePortfolio();
  const target = +p.monthlyTarget || 0;
  const rows = Object.entries(SIP_WEIGHTS).map(([s,w]) => `
    <tr><td><span class="sym" style="font-size:13px">${s}</span></td>
    <td class="mono">${w}%</td>
    <td class="mono">${fmt(target * w / 100)}</td></tr>`).join('');

  $('#main').innerHTML = `
    <div class="page-head">
      <div>
        <div class="sub">Tab 03 · Add Investment</div>
        <h2>Log SIP entry</h2>
      </div>
    </div>
    <div class="chart-row">
      <div class="card" style="padding:22px 24px">
        <h3 style="margin:0 0 16px;font:600 14px var(--sans)"><i class="ti ti-currency-rupee-nepalese"></i> Investment details</h3>
        <div class="form-grid">
          <div class="field"><label>Amount (PKR)</label><input id="invAmt" type="number" placeholder="${target||10000}"/></div>
          <div class="field"><label>Date</label><input id="invDate" type="date" value="${today()}"/></div>
          <div class="field full"><label>Note</label><input id="invNote" type="text" placeholder="e.g. Monthly SIP — May"/></div>
        </div>
        <div class="modal-actions" style="margin-top:18px">
          <button class="btn" onclick="logInvestment()"><i class="ti ti-check"></i> Log Investment</button>
        </div>
      </div>
      <div class="card" style="padding:22px 24px">
        <h3 style="margin:0 0 4px;font:600 14px var(--sans)"><i class="ti ti-bulb"></i> Suggested allocation</h3>
        <div class="sub" style="font:500 10px var(--mono);letter-spacing:.16em;text-transform:uppercase;color:var(--ink-soft);margin-bottom:14px">based on KSE-100 sector weights</div>
        <table>
          <thead><tr><th>Sector</th><th>Weight</th><th>Allocate</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>
  `;
}

async function logInvestment() {
  const amt = +$('#invAmt').value;
  const date = $('#invDate').value;
  const note = $('#invNote').value;
  if (!amt || !date) return toast('Amount and date required','err');
  try {
    const row = await api('saveInvestment', { portfolioId:state.activePid, date, amount:amt, note });
    state.investments.push({ ...row, amount:+row.amount });
    toast('Investment logged','ok');
    state.tab = 'history'; updateTabs(); renderTab();
  } catch(e){ toast(e.message,'err'); }
}

/* ── Tab: History ──────────────────────────────── */
function renderHistory() {
  const sorted = [...state.investments].sort((a,b)=>(''+b.date).localeCompare(''+a.date));
  const total = sorted.reduce((s,x)=>s+x.amount,0);
  const rows = sorted.map(x => `
    <tr><td class="mono">${(''+x.date).slice(0,10)}</td>
    <td class="mono">${fmt(x.amount)}</td>
    <td>${escapeHtml(x.note||'')}</td>
    <td class="row-actions"><button onclick="deleteInvestment('${x.id}')"><i class="ti ti-trash"></i></button></td></tr>
  `).join('');

  $('#main').innerHTML = `
    <div class="page-head">
      <div><div class="sub">Tab 04 · History</div><h2>Investment log</h2></div>
      <span class="badge info">Total ${fmt(total)}</span>
    </div>
    <div class="card">
      ${sorted.length ? `<div class="table-wrap"><table>
        <thead><tr><th>Date</th><th>Amount</th><th>Note</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr><td colspan="4" style="padding:14px 12px;font:600 12px var(--mono);text-transform:uppercase;letter-spacing:.16em;color:var(--ink-soft);border-top:1px solid var(--line)">Total invested · ${fmt(total)}</td></tr></tfoot>
      </table></div>` : `
      <div class="empty"><i class="ti ti-history"></i><h4>No investments logged</h4><p>Head to <b>Add Investment</b> to log your first SIP.</p></div>`}
    </div>
  `;
}

async function deleteInvestment(id){
  if (!confirm('Delete this investment?')) return;
  try { await api('deleteInvestment',{id}); state.investments = state.investments.filter(x=>x.id!==id); renderHistory(); toast('Deleted','ok'); }
  catch(e){ toast(e.message,'err'); }
}

/* ════════════════════════════════════════════════
   MODALS
   ════════════════════════════════════════════════ */
function openModal(html){ $('#modal').innerHTML = html; $('#modalBg').classList.add('open'); }
function closeModal(){ $('#modalBg').classList.remove('open'); }
$('#modalBg').addEventListener('click', e => { if (e.target.id==='modalBg') closeModal(); });

function portfolioModal(existing) {
  const ed = existing && existing.id ? existing : null;   // chip passes a click event — ignore it
  state.editingPid = ed ? ed.id : null;
  openModal(`
    <h3>${ed ? 'Edit Portfolio' : 'New Portfolio'}</h3>
    <div class="sub">Tracker · isolated book</div>
    <div class="form-grid">
      <div class="field full"><label>Name</label><input id="pName" type="text" placeholder="e.g. Long-term KSE-100" value="${ed ? escapeHtml(ed.name) : ''}"/></div>
      <div class="field"><label>Index <span class="hint" id="pIndexHint"></span></label><select id="pIndex">${indexOptions(ed ? ed.index : 'KSE-100')}</select></div>
      <div class="field"><label>Monthly target (PKR)</label><input id="pTarget" type="number" placeholder="50000" value="${ed ? (ed.monthlyTarget||'') : ''}"/></div>
    </div>
    <div class="modal-actions">
      <button class="btn ghost" onclick="closeModal()">Cancel</button>
      <button class="btn" onclick="savePortfolio()"><i class="ti ti-check"></i> ${ed ? 'Save changes' : 'Create'}</button>
    </div>
  `);
  // Upgrade the index list from live PSX data once it's available.
  loadMarket().then(() => {
    const sel = $('#pIndex'); if (!sel) return;
    const cur = sel.value;
    sel.innerHTML = indexOptions(cur);
    const hint = $('#pIndexHint'); if (hint) hint.textContent = 'live from PSX';
  }).catch(()=>{});
}

async function savePortfolio() {
  const name = $('#pName').value.trim();
  const index = $('#pIndex').value;
  const monthlyTarget = +$('#pTarget').value || 0;
  if (!name) return toast('Name required','err');
  const editId = state.editingPid;
  try {
    const payload = { name, index, monthlyTarget };
    if (editId) payload.id = editId;
    const p = await api('savePortfolio', payload);
    if (editId) {
      const idx = state.portfolios.findIndex(x => x.id === editId);
      if (idx >= 0) state.portfolios[idx] = p;
    } else {
      state.portfolios.push(p);
      state.activePid = p.id;
      await loadPortfolioData();
    }
    state.editingPid = null;
    closeModal(); renderAll(); toast(editId ? 'Portfolio updated' : 'Portfolio created','ok');
  } catch(e){ toast(e.message,'err'); }
}

async function deletePortfolio() {
  const p = activePortfolio(); if (!p) return;
  if (!confirm(`Delete portfolio "${p.name}" and all its holdings + investments?`)) return;
  try {
    await api('deletePortfolio',{ id:p.id });
    state.portfolios = state.portfolios.filter(x=>x.id!==p.id);
    state.activePid = state.portfolios[0]?.id || null;
    await loadPortfolioData();
    renderAll();
    if (!state.activePid) renderEmptyState();
    toast('Portfolio deleted','ok');
  } catch(e){ toast(e.message,'err'); }
}

/* Compact add-to-portfolio form. `prefill` = { symbol, sector, price } from the
   Market browser, or {} for a manual custom symbol. */
function addHoldingModal(prefill) {
  prefill = prefill || {};
  const p = activePortfolio();
  const sym = (prefill.symbol || '').toUpperCase();
  const q = sym ? quoteFor(sym) : null;
  const owned = state.holdings.find(h => h.symbol === sym);
  const sector = prefill.sector || (q ? mapSector(q.sector) : 'Other');
  const price = prefill.price || (q ? q.price : '');

  openModal(`
    <h3>${sym ? 'Add ' + escapeHtml(sym) : 'Add custom symbol'}</h3>
    <div class="sub">${escapeHtml(p.name)} · ${escapeHtml(p.index)}</div>
    ${q ? `<div class="quote-line">
        <span class="px">${fmt(q.price)}</span>
        <span class="${q.changePct>=0?'gain':'loss'}">${pct(q.changePct)}</span>
        <span class="muted">${escapeHtml(q.name)}</span>
        <a href="${psxUrl(sym)}" target="_blank" rel="noopener" style="margin-left:auto;white-space:nowrap">PSX <i class="ti ti-external-link" style="font-size:11px"></i></a>
      </div>` : ''}
    ${owned ? `<div class="hint" style="margin:10px 0 0;color:var(--info)">You own ${fmtN(owned.shares)} @ ${fmt(owned.avgCost)} — adding will average your cost.</div>` : ''}
    <div class="form-grid" style="margin-top:14px">
      <div class="field"><label>Symbol</label><input id="hSym" type="text" value="${escapeHtml(sym)}" placeholder="e.g. HBL" style="text-transform:uppercase" ${sym?'readonly':''}/></div>
      <div class="field"><label>Sector</label><select id="hSec">${SECTORS.map(s=>`<option ${s===sector?'selected':''}>${s}</option>`).join('')}</select></div>
      <div class="field"><label>Shares</label><input id="hShares" type="number" step="1" placeholder="100"/></div>
      <div class="field"><label>Avg cost (PKR)</label><input id="hCost" type="number" step="0.01" placeholder="your buy price"/></div>
      <div class="field full"><label>Current price (PKR)</label><input id="hPrice" type="number" step="0.01" value="${price}"/></div>
    </div>
    <div class="modal-actions">
      <button class="btn ghost" onclick="closeModal()">Cancel</button>
      <button class="btn" onclick="saveHolding()"><i class="ti ti-check"></i> Add to portfolio</button>
    </div>
  `);
  setTimeout(() => { const el = $('#hShares'); if (el) el.focus(); }, 50);
}

async function saveHolding() {
  const symbol = $('#hSym').value.trim().toUpperCase();
  const sector = $('#hSec').value;
  const shares = +$('#hShares').value;
  const avgCost = +$('#hCost').value;
  const currPrice = +$('#hPrice').value;
  if (!symbol || !shares || !avgCost) return toast('Symbol, shares, and avg cost required','err');

  const existing = state.holdings.find(h => h.symbol === symbol);
  try {
    if (existing) {
      // average down
      const totalShares = existing.shares + shares;
      const newAvg = (existing.shares*existing.avgCost + shares*avgCost) / totalShares;
      const saved = await api('saveHolding', {
        id: existing.id, portfolioId: state.activePid, symbol, sector,
        shares: totalShares, avgCost: newAvg, currPrice: currPrice || existing.currPrice
      });
      Object.assign(existing, saved, { shares:+saved.shares, avgCost:+saved.avgCost, currPrice:+saved.currPrice });
      toast('Averaged into ' + symbol,'ok');
    } else {
      const saved = await api('saveHolding', { portfolioId: state.activePid, symbol, sector, shares, avgCost, currPrice: currPrice||avgCost });
      state.holdings.push({ ...saved, shares:+saved.shares, avgCost:+saved.avgCost, currPrice:+saved.currPrice });
      toast('Holding added','ok');
    }
    closeModal();
    // Re-render whichever tab we're on (Market shows the updated "owned" badge).
    if (state.tab === 'market') renderMarketRows(); else renderHoldings();
  } catch(e){ toast(e.message,'err'); }
}

/* ════════════════════════════════════════════════
   WIRING
   ════════════════════════════════════════════════ */
function updateTabs(){
  $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === state.tab));
}
$$('.tab').forEach(t => t.addEventListener('click', () => {
  state.tab = t.dataset.tab; updateTabs(); renderTab();
}));

$('#themeBtn').addEventListener('click', () => {
  const cur = document.documentElement.getAttribute('data-theme');
  const next = cur === 'dark' ? 'light' : 'dark';
  if (next === 'dark') document.documentElement.setAttribute('data-theme','dark');
  else document.documentElement.removeAttribute('data-theme');
  localStorage.setItem('psx-theme', next);
  $('#themeBtn').innerHTML = `<i class="ti ti-${next==='dark'?'moon':'sun'}"></i>`;
});
$('#themeBtn').innerHTML = `<i class="ti ti-${savedTheme==='dark'?'moon':'sun'}"></i>`;

$('#logoutBtn').addEventListener('click', logout);
$('#deletePortfolioBtn').addEventListener('click', deletePortfolio);
$('#editPortfolioBtn').addEventListener('click', () => { const p = activePortfolio(); if (p) portfolioModal(p); });

/* ── Boot ── */
window.addEventListener('load', () => {
  const cached = sessionStorage.getItem('psx-user');
  if (cached) {
    state.user = JSON.parse(cached);
    enterApp();
  } else {
    initGoogle();
  }
});

// expose for inline handlers
window.deleteHolding = deleteHolding;
window.deleteInvestment = deleteInvestment;
window.addHoldingModal = addHoldingModal;
window.portfolioModal = portfolioModal;
window.closeModal = closeModal;
window.savePortfolio = savePortfolio;
window.saveHolding = saveHolding;
window.logInvestment = logInvestment;
window.refreshPrices = refreshPrices;
window.gotoMarket = gotoMarket;
window.marketAdd = marketAdd;
window.refreshMarket = refreshMarket;
