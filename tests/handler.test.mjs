import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandler, isAuthorized } from '../lib/handler.js';

const KEY = 'cle-de-test-1234';
const T = '2026-10-02T10:00:00Z';

function makeSql({ lastMode = 'paper', safetyRows, empty = false } = {}) {
  const calls = [];
  const sql = async (strings, ...values) => {
    const q = strings.join('?').replace(/\s+/g, ' ');
    calls.push({ q, values });
    if (empty) return [];
    if (q.startsWith('SELECT mode FROM balance_history ORDER')) return [{ mode: lastMode }];
    if (q.includes('UNION')) return [{ mode: 'live' }, { mode: 'paper' }, { mode: 'bogus' }];
    if (q.startsWith('SELECT equity')) return [{ equity: '1010.50', recorded_at: '2026-10-02T10:01:00Z' }, { equity: '1000', recorded_at: T }];
    if (q.includes('DISTINCT ON')) return [{ symbol: 'BTC/USDT', price: '65000.1', rsi: '55.2', ema_fast: '1', ema_slow: '2', recorded_at: '2026-10-02T10:01:00Z' }];
    if (q.includes("interval '6 hours'")) return [{ symbol: 'BTC/USDT', rsi: '55.2', recorded_at: '2026-10-02T10:01:00Z' }];
    if (q.includes('FROM trades WHERE mode = ? ORDER')) return [{ id: '7', symbol: 'BTC/USDT', mode: lastMode, status: 'closed', entry_price: '100', quantity: '0.5', sl: '99', tp: '102', rsi: '50', exit_price: '102', pnl: '0.9', close_reason: 'TP', opened_at: '2026-10-02T09:00:00Z', closed_at: '2026-10-02T09:30:00Z' }];
    if (q.includes('FROM decisions')) return [{ symbol: 'BTC/USDT', timeframe: '5m', strategy: 'ema_rsi', strategy_version: '1', decision: 'NO_TRADE', reason: 'data_stale', recorded_at: T }];
    if (q.includes('FROM system_state')) return safetyRows ?? [];
    return [{ closed: '3', wins: '2', pnl: '1.25', open: '1', today: '4' }];
  };
  return { sql, calls };
}
const run = async (handler, { method = 'GET', key, url = '/api/data' } = {}) => {
  const out = { headers: {} };
  const res = { setHeader: (k, v) => (out.headers[k] = v), status(c) { out.code = c; return this; }, json(b) { out.body = b; return this; } };
  await handler({ method, url, headers: key === undefined ? {} : { 'x-dashboard-key': key } }, res);
  return out;
};
const make = (sqlOpts = {}, over = {}) => {
  const { sql, calls } = makeSql(sqlOpts);
  return { handler: createHandler({ getSql: () => sql, getKey: () => KEY, ...over }), calls };
};

test('refuse sans clé, avec mauvaise clé, et si aucune clé n\'est configurée', async () => {
  assert.equal((await run(make().handler)).code, 401);
  assert.equal((await run(make().handler, { key: 'mauvaise' })).code, 401);
  assert.equal((await run(make({}, { getKey: () => undefined }).handler, { key: 'x' })).code, 401);
  assert.equal((await run(make({}, { getKey: () => '' }).handler, { key: '' })).code, 401);
});

test('refuse les méthodes autres que GET', async () => {
  assert.equal((await run(make().handler, { method: 'POST', key: KEY })).code, 405);
});

test('renvoie les données mises en forme (nombres, ordre chronologique, modes valides seulement)', async () => {
  const r = await run(make().handler, { key: KEY });
  assert.equal(r.code, 200);
  assert.equal(r.headers['Cache-Control'], 'no-store');
  assert.deepEqual(r.body.equity.map((e) => e.v), [1000, 1010.5]);
  assert.equal(r.body.mode, 'paper');
  assert.deepEqual(r.body.modes, ['live', 'paper']); // « bogus » est écarté
  assert.equal(r.body.markets[0].price, 65000.1);
  assert.equal(r.body.trades[0].pnl, 0.9);
  assert.deepEqual(r.body.stats, { closed: 3, wins: 2, pnl: 1.25, open: 1, today: 4 });
  assert.equal(r.body.lastUpdate, '2026-10-02T10:01:00.000Z');
  assert.deepEqual(r.body.decisions[0], { symbol: 'BTC/USDT', timeframe: '5m', strategy: 'ema_rsi', version: '1', decision: 'NO_TRADE', reason: 'data_stale', t: '2026-10-02T10:00:00.000Z' });
});

test('le mode courant est celui de la dernière équité et filtre toutes les requêtes liées au mode', async () => {
  const { handler, calls } = make({ lastMode: 'live' });
  const r = await run(handler, { key: KEY });
  assert.equal(r.body.mode, 'live');
  const filtered = calls.filter((c) => c.q.includes('WHERE mode = ?'));
  assert.equal(filtered.length, 4); // équité, trades, stats, décisions
  assert.ok(filtered.every((c) => c.values[0] === 'live'));
});

test('?mode= est accepté seulement s\'il est dans la liste blanche, et jamais concaténé au SQL', async () => {
  const ok = make({ lastMode: 'paper' });
  assert.equal((await run(ok.handler, { key: KEY, url: '/api/data?mode=testnet' })).body.mode, 'testnet');
  const evil = make({ lastMode: 'paper' });
  const r = await run(evil.handler, { key: KEY, url: "/api/data?mode=paper';DROP TABLE trades;--" });
  assert.equal(r.body.mode, 'paper');
  assert.equal(evil.calls.some((c) => /DROP|;--/.test(c.q)), false);
});

test('état d\'arrêt : objet JSON, texte JSON, absent et illisible', async () => {
  const stopped = { reasons: { daily_loss: 'perte journalière atteinte' }, kill_switch: false };
  let r = await run(make({ safetyRows: [{ value: stopped, updated_at: T }] }).handler, { key: KEY });
  assert.deepEqual(r.body.safety, { known: true, tradingEnabled: false, killSwitch: false, reasons: [{ code: 'daily_loss', message: 'perte journalière atteinte' }], updatedAt: '2026-10-02T10:00:00.000Z' });
  r = await run(make({ safetyRows: [{ value: JSON.stringify({ reasons: {}, kill_switch: true }), updated_at: T }] }).handler, { key: KEY });
  assert.equal(r.body.safety.tradingEnabled, false);
  assert.equal(r.body.safety.killSwitch, true);
  r = await run(make({ safetyRows: [{ value: { reasons: {}, kill_switch: false }, updated_at: T }] }).handler, { key: KEY });
  assert.equal(r.body.safety.tradingEnabled, true);
  assert.deepEqual((await run(make().handler, { key: KEY })).body.safety, { known: false });
  assert.deepEqual((await run(make({ safetyRows: [{ value: '{pas du json', updated_at: T }] }).handler, { key: KEY })).body.safety, { known: false });
});

test('base vide : réponse valide', async () => {
  const r = await run(make({ empty: true }).handler, { key: KEY });
  assert.equal(r.code, 200);
  assert.equal(r.body.mode, 'paper');
  assert.deepEqual(r.body.stats, { closed: 0, wins: 0, pnl: 0, open: 0, today: 0 });
  assert.deepEqual(r.body.decisions, []);
  assert.equal(r.body.lastUpdate, null);
});

test('erreur base : 500 générique sans fuite du message', async () => {
  const boom = async () => { throw new Error('password=SECRET host=db.internal'); };
  const r = await run(createHandler({ getSql: () => boom, getKey: () => KEY }), { key: KEY });
  assert.equal(r.code, 500);
  assert.equal(JSON.stringify(r.body).includes('SECRET'), false);
});

test('isAuthorized : comparaison stricte', () => {
  assert.equal(isAuthorized('abc', 'abc'), true);
  assert.equal(isAuthorized('abd', 'abc'), false);
  assert.equal(isAuthorized('abcd', 'abc'), false);
});
