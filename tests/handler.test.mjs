import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandler, isAuthorized } from '../lib/handler.js';

const KEY = 'cle-de-test-1234';
const fakeSql = async (strings) => {
  const q = strings.join(' ');
  if (q.includes('FROM balance_history')) return [{ mode: 'paper', equity: '1010.50', recorded_at: '2026-10-02T10:01:00Z' }, { mode: 'paper', equity: '1000', recorded_at: '2026-10-02T10:00:00Z' }];
  if (q.includes('DISTINCT ON')) return [{ symbol: 'BTC/USDT', price: '65000.1', rsi: '55.2', ema_fast: '1', ema_slow: '2', recorded_at: '2026-10-02T10:01:00Z' }];
  if (q.includes('interval')) return [{ symbol: 'BTC/USDT', rsi: '55.2', recorded_at: '2026-10-02T10:01:00Z' }];
  if (q.includes('FROM trades ORDER BY')) return [{ id: '7', symbol: 'BTC/USDT', mode: 'paper', status: 'closed', entry_price: '100', quantity: '0.5', sl: '99', tp: '102', rsi: '50', exit_price: '102', pnl: '0.9', close_reason: 'TP', opened_at: '2026-10-02T09:00:00Z', closed_at: '2026-10-02T09:30:00Z' }];
  return [{ closed: '3', wins: '2', pnl: '1.25', open: '1', today: '4' }];
};
const run = async (handler, { method = 'GET', key } = {}) => {
  const out = { headers: {} };
  const res = { setHeader: (k, v) => (out.headers[k] = v), status(c) { out.code = c; return this; }, json(b) { out.body = b; return this; } };
  await handler({ method, headers: key === undefined ? {} : { 'x-dashboard-key': key } }, res);
  return out;
};
const make = (over = {}) => createHandler({ getSql: () => fakeSql, getKey: () => KEY, ...over });

test('refuse sans clé, avec mauvaise clé, et si aucune clé n\'est configurée', async () => {
  assert.equal((await run(make())).code, 401);
  assert.equal((await run(make(), { key: 'mauvaise' })).code, 401);
  assert.equal((await run(make({ getKey: () => undefined }), { key: 'x' })).code, 401);
  assert.equal((await run(make({ getKey: () => '' }), { key: '' })).code, 401);
});

test('refuse les méthodes autres que GET', async () => {
  assert.equal((await run(make(), { method: 'POST', key: KEY })).code, 405);
});

test('renvoie les données mises en forme (nombres, ordre chronologique)', async () => {
  const r = await run(make(), { key: KEY });
  assert.equal(r.code, 200);
  assert.equal(r.headers['Cache-Control'], 'no-store');
  assert.deepEqual(r.body.equity.map((e) => e.v), [1000, 1010.5]);
  assert.equal(r.body.mode, 'paper');
  assert.equal(r.body.markets[0].price, 65000.1);
  assert.equal(r.body.trades[0].pnl, 0.9);
  assert.deepEqual(r.body.stats, { closed: 3, wins: 2, pnl: 1.25, open: 1, today: 4 });
  assert.equal(r.body.lastUpdate, '2026-10-02T10:01:00.000Z');
});

test('base vide : réponse valide', async () => {
  const empty = async () => [];
  const r = await run(make({ getSql: () => empty }), { key: KEY });
  assert.equal(r.code, 200);
  assert.deepEqual(r.body.stats, { closed: 0, wins: 0, pnl: 0, open: 0, today: 0 });
  assert.equal(r.body.lastUpdate, null);
});

test('erreur base : 500 générique sans fuite du message', async () => {
  const boom = async () => { throw new Error('password=SECRET host=db.internal'); };
  const r = await run(make({ getSql: () => boom }), { key: KEY });
  assert.equal(r.code, 500);
  assert.equal(JSON.stringify(r.body).includes('SECRET'), false);
});

test('isAuthorized : comparaison stricte', () => {
  assert.equal(isAuthorized('abc', 'abc'), true);
  assert.equal(isAuthorized('abd', 'abc'), false);
  assert.equal(isAuthorized('abcd', 'abc'), false);
});
