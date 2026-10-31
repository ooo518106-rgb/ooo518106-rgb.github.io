import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import worker, { CompanySnapshot, readLimited, MAX_BYTES } from '../../cloud/src/worker.js';

function room() {
  const db = new DatabaseSync(':memory:');
  const storage = {
    sql: { exec(sql, ...params) { const rows = db.prepare(sql).all(...params); return { toArray: () => rows }; } },
    transactionSync(fn) { db.exec('BEGIN'); try { const out = fn(); db.exec('COMMIT'); return out; } catch (e) { db.exec('ROLLBACK'); throw e; } },
  };
  return new CompanySnapshot({ storage });
}
const encrypted = JSON.stringify({ app: 'kenz-encrypted-backup', v: 1, kind: 'zip', kdf: 'PBKDF2-SHA256', iter: 600000, data: 'A'.repeat(24), iv: 'A'.repeat(16), salt: Buffer.alloc(16).toString('base64') });
const put = (version, text = encrypted) => new Request('https://test/v1/companies/shop', { method: 'PUT', body: JSON.stringify({ expectedVersion: version, encrypted: text }) });

test('two devices uploading the same version cannot overwrite each other', async () => {
  const r = room();
  const results = await Promise.all([r.fetch(put(0)), r.fetch(put(0))]);
  assert.deepEqual(results.map((x) => x.status).sort(), [200, 409]);
  const saved = await (await r.fetch(new Request('https://test/v1/companies/shop'))).json();
  assert.equal(saved.version, 1); assert.equal(saved.encrypted, encrypted);
  assert.equal((await r.fetch(put(1))).status, 200);
  assert.equal((await r.fetch(put(0))).status, 409);
});

test('snapshot storage handles multiple chunks and rejects plaintext without touching the saved data', async () => {
  const r = room();
  const big = JSON.stringify({ ...JSON.parse(encrypted), data: 'x'.repeat(180000) });
  assert.equal((await r.fetch(put(0, big))).status, 200);
  assert.equal((await r.fetch(put(1, '{"docs":[]}'))).status, 400);
  const read = await (await r.fetch(new Request('https://test/v1/companies/shop'))).json();
  assert.equal(read.encrypted, big); assert.equal(read.version, 1);
});

test('authentication and origin checks happen before storage access', async () => {
  let calls = 0;
  const token = 't'.repeat(40);
  const env = { APP_ORIGIN: 'https://app.example', SYNC_TOKEN: token, COMPANIES: { idFromName: (x) => x, get() { calls++; return room(); } } };
  assert.equal((await worker.fetch(new Request('https://test/v1/companies/shop'), env)).status, 401);
  assert.equal((await worker.fetch(new Request('https://test/v1/companies/shop', { headers: { Origin: 'https://attacker.example', Authorization: 'Bearer ' + token } }), env)).status, 403);
  assert.equal(calls, 0);
  const allowed = await worker.fetch(new Request('https://test/v1/companies/shop', { headers: { Origin: env.APP_ORIGIN, Authorization: 'Bearer ' + token } }), env);
  assert.equal(allowed.status, 404); assert.equal(calls, 1);
  assert.equal(allowed.headers.get('Access-Control-Allow-Origin'), env.APP_ORIGIN);
});

test('oversized requests are rejected while streaming', async () => {
  const req = new Request('https://test', { method: 'PUT', body: 'x'.repeat(MAX_BYTES + 1) });
  await assert.rejects(() => readLimited(req), (e) => e.status === 413);
});

test('an interrupted chunk update rolls back the snapshot and version together', async () => {
  const r = room(); await r.fetch(put(0));
  const exec = r.sql.exec.bind(r.sql); let writes = 0;
  r.sql.exec = (sql, ...params) => {
    if (sql.startsWith('INSERT INTO chunks') && ++writes === 2) throw new Error('storage failure');
    return exec(sql, ...params);
  };
  const big = JSON.stringify({ ...JSON.parse(encrypted), data: 'x'.repeat(180000) });
  await assert.rejects(() => r.fetch(put(1, big)), /storage failure/);
  r.sql.exec = exec;
  const read = await (await r.fetch(new Request('https://test/v1/companies/shop'))).json();
  assert.equal(read.version, 1); assert.equal(read.encrypted, encrypted);
});

test('company spaces route to isolated Durable Objects', async () => {
  const rooms = new Map(); const token = 't'.repeat(40);
  const env = { APP_ORIGIN: 'https://app.example', SYNC_TOKEN: token, COMPANIES: { idFromName: (x) => x, get(id) { if (!rooms.has(id)) rooms.set(id, room()); return rooms.get(id); } } };
  const headers = { Authorization: 'Bearer ' + token };
  const write = new Request('https://test/v1/companies/first', { method: 'PUT', headers, body: JSON.stringify({ expectedVersion: 0, encrypted }) });
  assert.equal((await worker.fetch(write, env)).status, 200);
  assert.equal((await worker.fetch(new Request('https://test/v1/companies/second', { headers }), env)).status, 404);
  const first = await (await worker.fetch(new Request('https://test/v1/companies/first', { headers }), env)).json();
  assert.equal(first.encrypted, encrypted);
});
