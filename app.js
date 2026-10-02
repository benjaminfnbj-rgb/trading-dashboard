const $ = (id) => document.getElementById(id);
const KEY = 'dash_key';
const REFRESH_MS = 15 * 60 * 1000; // chaque lecture réveille Neon (veille après 5 min) : ne jamais rafraîchir plus souvent
const ACTIVE_MAX_MIN = 45; // le bot écrit en base toutes les 30 min par défaut (DB_FLUSH_SECONDS, minimum 900)
let lastLoad = 0;
let selectedMode = null;
const COLORS = ['#f59e0b', '#6366f1', '#00ff9d', '#ff4560'];
let equityChart = null, rsiChart = null;

const fmt = (n, d = 2) => (n == null ? '--' : Number(n).toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d }));
const price = (n) => (n == null ? '--' : fmt(n, n < 10 ? 5 : 2));
const hhmm = (t) => new Date(t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const signed = (n) => (n == null ? '--' : (n >= 0 ? '+' : '') + fmt(n, 2));
const rsiClass = (r) => (r == null ? 'muted' : r > 70 ? 'red' : r < 30 ? 'green' : 'muted');

function setStatus(kind, text) {
  $('status').className = 'pill ' + kind;
  $('statusText').textContent = text;
}

function showLogin(msg) {
  $('content').classList.add('hidden');
  $('login').classList.remove('hidden');
  if (msg) $('loginMsg').textContent = msg;
  setStatus('', 'Verrouillé');
}

function makeChart(canvas, config) {
  return typeof Chart === 'undefined' ? null : new Chart(canvas.getContext('2d'), config);
}
const axis = { ticks: { color: '#64748b', font: { size: 10 }, maxTicksLimit: 6 }, grid: { color: '#1f2d45' } };

function render(d) {
  $('login').classList.add('hidden');
  $('content').classList.remove('hidden');

  const m = $('mode');
  m.textContent = d.mode ? d.mode.toUpperCase() : '--';
  m.className = 'mode ' + (d.mode || '');

  const ageMin = d.lastUpdate ? (Date.now() - new Date(d.lastUpdate).getTime()) / 60000 : null;
  if (ageMin == null) setStatus('', 'En attente de données');
  else if (ageMin < ACTIVE_MAX_MIN) setStatus('ok', `Bot actif · données il y a ${Math.round(ageMin)} min`);
  else setStatus('bad', `Aucune donnée depuis ${Math.round(ageMin)} min`);

  const sel = $('modeSel');
  const modes = [...new Set([...(d.modes || []), d.mode].filter(Boolean))];
  sel.replaceChildren(...modes.map((m) => { const o = document.createElement('option'); o.value = m; o.textContent = m.toUpperCase(); return o; }));
  sel.value = d.mode;
  sel.classList.toggle('hidden', modes.length < 2);

  const sf = $('safety');
  if (!d.safety || !d.safety.known) { sf.className = 'banner'; sf.textContent = 'État d\'arrêt : pas encore enregistré par le bot'; }
  else if (d.safety.tradingEnabled) { sf.className = 'banner ok'; sf.textContent = 'Trading actif'; }
  else {
    sf.className = 'banner bad';
    const why = d.safety.reasons.map((r) => `${r.code} : ${r.message}`).join(' · ');
    sf.textContent = `TRADING SUSPENDU${d.safety.killSwitch ? ' (arrêt d\'urgence)' : ''}${why ? ' — ' + why : ''}`;
  }

  $('decisions').innerHTML = (d.decisions || []).length
    ? d.decisions.map((x) => `<tr><td>${new Date(x.t).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</td><td>${esc(x.symbol)} ${esc(x.timeframe)}</td><td>${esc(x.strategy)} v${esc(x.version)}</td><td><span class="tag ${x.decision === 'BUY' ? 'buy' : x.decision === 'SELL' ? 'sell' : 'hold'}">${esc(x.decision)}</span></td><td>${esc(x.reason)}</td></tr>`).join('')
    : '<tr><td colspan="5"><div class="empty">Aucune décision enregistrée pour ce mode</div></td></tr>';

  const eq = d.equity.length ? d.equity[d.equity.length - 1].v : null;
  const winRate = d.stats.closed ? Math.round((d.stats.wins / d.stats.closed) * 100) + ' %' : '--';
  const cards = [
    ['Capital (équité)', fmt(eq) + ' $', 'green', 'USDT'],
    ['P/L réalisé', signed(d.stats.pnl) + ' $', d.stats.pnl >= 0 ? 'green' : 'red', `${d.stats.closed} trade(s) clos`],
    ['Positions ouvertes', d.stats.open, 'blue', 'en cours'],
    ['Trades aujourd\'hui', d.stats.today, 'blue', 'ouverts ce jour'],
    ['Taux de réussite', winRate, 'gold', `${d.stats.wins} gagnant(s)`],
  ];
  $('kpis').innerHTML = cards.map(([l, v, c, s]) => `<div class="kpi"><div class="label">${esc(l)}</div><div class="value ${c}">${esc(v)}</div><div class="sub">${esc(s)}</div></div>`).join('');

  $('markets').innerHTML = d.markets.length
    ? d.markets.map((k) => `<div class="mrow"><b>${esc(k.symbol)}</b><div><div class="p">${price(k.price)} $</div><div class="r ${rsiClass(k.rsi)}">RSI ${k.rsi == null ? '--' : fmt(k.rsi, 1)}</div></div></div>`).join('')
    : '<div class="empty">Aucune donnée de marché</div>';

  const labels = d.equity.map((e) => hhmm(e.t)), values = d.equity.map((e) => e.v);
  if (!equityChart) {
    equityChart = makeChart($('equityChart'), { type: 'line', data: { labels, datasets: [{ data: values, borderColor: '#00ff9d', backgroundColor: 'rgba(0,255,157,.08)', borderWidth: 2, pointRadius: 0, fill: true, tension: 0.3 }] },
      options: { responsive: true, maintainAspectRatio: false, animation: false, plugins: { legend: { display: false } }, scales: { x: axis, y: axis } } });
  } else if (equityChart) { equityChart.data.labels = labels; equityChart.data.datasets[0].data = values; equityChart.update(); }

  const symbols = [...new Set(d.rsi.map((r) => r.symbol))];
  const times = [...new Set(d.rsi.map((r) => r.t))];
  const datasets = symbols.map((s, i) => {
    const by = new Map(d.rsi.filter((r) => r.symbol === s).map((r) => [r.t, r.rsi]));
    return { label: s, data: times.map((t) => by.get(t) ?? null), borderColor: COLORS[i % COLORS.length], borderWidth: 2, pointRadius: 0, spanGaps: true, tension: 0.3 };
  });
  const rsiLabels = times.map(hhmm);
  if (!rsiChart) {
    rsiChart = makeChart($('rsiChart'), { type: 'line', data: { labels: rsiLabels, datasets },
      options: { responsive: true, maintainAspectRatio: false, animation: false, plugins: { legend: { labels: { color: '#64748b', font: { size: 10 } } } }, scales: { x: axis, y: { ...axis, min: 0, max: 100 } } } });
  } else if (rsiChart) { rsiChart.data.labels = rsiLabels; rsiChart.data.datasets = datasets; rsiChart.update(); }

  $('tradeCount').textContent = `${d.trades.length}`;
  $('trades').innerHTML = d.trades.length
    ? d.trades.map((t) => {
        const tag = t.status === 'open' ? '<span class="tag open">OUVERT</span>' : `<span class="tag ${t.pnl > 0 ? 'win' : 'loss'}">${esc(t.reason || 'CLOS')}</span>`;
        return `<tr><td>${new Date(t.openedAt).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</td><td>${esc(t.symbol)}</td><td>${esc(t.mode)}</td><td>${price(t.entry)}</td><td>${fmt(t.qty, 6)}</td><td>${price(t.sl)}</td><td>${price(t.tp)}</td><td>${price(t.exit)}</td><td class="${t.pnl == null ? 'muted' : t.pnl >= 0 ? 'green' : 'red'}">${signed(t.pnl)}</td><td>${tag}</td></tr>`;
      }).join('')
    : '<tr><td colspan="10"><div class="empty">Aucun trade pour l\'instant — le bot analyse les marchés…</div></td></tr>';
}

async function load() {
  const key = sessionStorage.getItem(KEY);
  if (!key) return showLogin();
  try {
    const r = await fetch('/api/data' + (selectedMode ? '?mode=' + encodeURIComponent(selectedMode) : ''), { headers: { 'x-dashboard-key': key }, cache: 'no-store' });
    if (r.status === 401) { sessionStorage.removeItem(KEY); return showLogin('Clé incorrecte ou non configurée.'); }
    if (!r.ok) throw new Error('HTTP ' + r.status);
    render(await r.json());
    lastLoad = Date.now();
  } catch (e) {
    setStatus('bad', 'Erreur de chargement');
  }
}

$('loginForm').addEventListener('submit', (e) => { e.preventDefault(); sessionStorage.setItem(KEY, $('keyInput').value.trim()); $('keyInput').value = ''; load(); });
$('refresh').addEventListener('click', load);
$('modeSel').addEventListener('change', (e) => { selectedMode = e.target.value; load(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden && Date.now() - lastLoad > REFRESH_MS) load(); });
load();
setInterval(() => { if (!document.hidden) load(); }, REFRESH_MS);
