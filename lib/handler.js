import { timingSafeEqual } from 'node:crypto';

const MODES = ['paper', 'testnet', 'live'];
const num = (v) => (v === null || v === undefined ? null : Number(v));
const iso = (v) => (v ? new Date(v).toISOString() : null);

export function isAuthorized(provided, expected) {
  if (!expected || !provided) return false; // sans clé configurée, l'accès reste fermé
  const a = Buffer.from(String(provided));
  const b = Buffer.from(String(expected));
  return a.length === b.length && timingSafeEqual(a, b);
}

function parseSafety(rows) {
  if (!rows.length) return { known: false };
  let value = rows[0].value;
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { return { known: false }; }
  }
  const reasons = Object.entries(value?.reasons ?? {}).map(([code, message]) => ({ code, message: String(message) }));
  const killSwitch = Boolean(value?.kill_switch);
  return { known: true, tradingEnabled: reasons.length === 0 && !killSwitch, killSwitch, reasons, updatedAt: iso(rows[0].updated_at) };
}

export function createHandler({ getSql, getKey }) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
    if (!isAuthorized(req.headers['x-dashboard-key'], getKey())) return res.status(401).json({ error: 'unauthorized' });
    try {
      const sql = getSql();
      // Le mode vient d'une liste blanche et passe toujours en paramètre SQL, jamais concaténé.
      const asked = new URL(req.url || '/', 'http://localhost').searchParams.get('mode');
      let mode = MODES.includes(asked) ? asked : null;
      if (!mode) {
        const last = await sql`SELECT mode FROM balance_history ORDER BY recorded_at DESC LIMIT 1`;
        mode = MODES.includes(last[0]?.mode) ? last[0].mode : 'paper';
      }
      const [equity, markets, rsi, trades, stats, decisions, safety, modes] = await Promise.all([
        sql`SELECT equity, recorded_at FROM balance_history WHERE mode = ${mode} ORDER BY recorded_at DESC LIMIT 200`,
        sql`SELECT DISTINCT ON (symbol) symbol, price, rsi, ema_fast, ema_slow, recorded_at FROM market_data ORDER BY symbol, recorded_at DESC`,
        sql`SELECT symbol, rsi, recorded_at FROM market_data WHERE rsi IS NOT NULL AND recorded_at > now() - interval '6 hours' ORDER BY recorded_at`,
        sql`SELECT id, symbol, mode, status, entry_price, quantity, sl, tp, rsi, exit_price, pnl, close_reason, opened_at, closed_at FROM trades WHERE mode = ${mode} ORDER BY opened_at DESC LIMIT 50`,
        sql`SELECT count(*) FILTER (WHERE status = 'closed') AS closed,
                   count(*) FILTER (WHERE status = 'closed' AND pnl > 0) AS wins,
                   COALESCE(sum(pnl) FILTER (WHERE status = 'closed'), 0) AS pnl,
                   count(*) FILTER (WHERE status = 'open') AS open,
                   count(*) FILTER (WHERE opened_at >= date_trunc('day', now())) AS today
            FROM trades WHERE mode = ${mode}`,
        sql`SELECT symbol, timeframe, strategy, strategy_version, decision, reason, recorded_at FROM decisions WHERE mode = ${mode} ORDER BY recorded_at DESC LIMIT 20`,
        sql`SELECT value, updated_at FROM system_state WHERE key = 'safety'`,
        sql`SELECT mode FROM balance_history UNION SELECT mode FROM trades ORDER BY mode`,
      ]);
      const s = stats[0] || {};
      const lastTimes = markets.map((m) => new Date(m.recorded_at).getTime());
      return res.status(200).json({
        generatedAt: new Date().toISOString(),
        mode,
        modes: modes.map((m) => m.mode).filter((m) => MODES.includes(m)),
        lastUpdate: lastTimes.length ? new Date(Math.max(...lastTimes)).toISOString() : null,
        safety: parseSafety(safety),
        equity: [...equity].reverse().map((r) => ({ t: iso(r.recorded_at), v: num(r.equity) })),
        markets: markets.map((m) => ({ symbol: m.symbol, price: num(m.price), rsi: num(m.rsi), emaFast: num(m.ema_fast), emaSlow: num(m.ema_slow), t: iso(m.recorded_at) })),
        rsi: rsi.map((r) => ({ symbol: r.symbol, rsi: num(r.rsi), t: iso(r.recorded_at) })),
        trades: trades.map((t) => ({
          id: Number(t.id), symbol: t.symbol, mode: t.mode, status: t.status, entry: num(t.entry_price), qty: num(t.quantity),
          sl: num(t.sl), tp: num(t.tp), rsi: num(t.rsi), exit: num(t.exit_price), pnl: num(t.pnl), reason: t.close_reason,
          openedAt: iso(t.opened_at), closedAt: iso(t.closed_at),
        })),
        decisions: decisions.map((d) => ({ symbol: d.symbol, timeframe: d.timeframe, strategy: d.strategy, version: d.strategy_version, decision: d.decision, reason: d.reason, t: iso(d.recorded_at) })),
        stats: { closed: Number(s.closed || 0), wins: Number(s.wins || 0), pnl: num(s.pnl) ?? 0, open: Number(s.open || 0), today: Number(s.today || 0) },
      });
    } catch (e) {
      console.error('dashboard api error:', e?.name); // jamais le message : il peut contenir des détails de connexion
      return res.status(500).json({ error: 'server_error' });
    }
  };
}
