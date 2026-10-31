export const MAX_BYTES = 10 * 1024 * 1024;
const json = (data, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });

async function equalSecret(a, b) {
  const enc = new TextEncoder();
  const [aa, bb] = await Promise.all([a, b].map((s) => crypto.subtle.digest('SHA-256', enc.encode(s))));
  const x = new Uint8Array(aa), y = new Uint8Array(bb); let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

export async function readLimited(request) {
  if (!request.body) throw Object.assign(new Error('empty body'), { status: 400 });
  const reader = request.body.getReader(); const chunks = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) { await reader.cancel(); throw Object.assign(new Error('snapshot too large'), { status: 413 }); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const data = new Uint8Array(size); let at = 0;
  for (const c of chunks) { data.set(c, at); at += c.byteLength; }
  return new TextDecoder().decode(data);
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    if (!env.APP_ORIGIN || !env.SYNC_TOKEN || env.SYNC_TOKEN.length < 32) return json({ error: 'service not configured' }, 503);
    if (origin && origin !== env.APP_ORIGIN) return json({ error: 'origin rejected' }, 403);
    const cors = { 'Access-Control-Allow-Origin': env.APP_ORIGIN, 'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Vary': 'Origin', 'Cache-Control': 'no-store' };
    const wrap = (r) => { const h = new Headers(r.headers); for (const [k, v] of Object.entries(cors)) h.set(k, v); return new Response(r.body, { status: r.status, headers: h }); };
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const bearer = request.headers.get('Authorization') || '';
    if (!bearer.startsWith('Bearer ') || !(await equalSecret(bearer.slice(7), env.SYNC_TOKEN))) return wrap(json({ error: 'unauthorized' }, 401));
    const path = /^\/v1\/companies\/([a-zA-Z0-9_-]{3,80})$/.exec(new URL(request.url).pathname);
    if (!path) return wrap(json({ error: 'not found' }, 404));
    if (!['GET', 'PUT'].includes(request.method)) return wrap(json({ error: 'method not allowed' }, 405));
    try {
      const id = env.COMPANIES.idFromName(path[1]);
      return wrap(await env.COMPANIES.get(id).fetch(request));
    } catch (e) { return wrap(json({ error: 'storage unavailable' }, 503)); }
  },
};

export class CompanySnapshot {
  constructor(state) {
    this.storage = state.storage;
    this.sql = state.storage.sql;
    this.sql.exec('CREATE TABLE IF NOT EXISTS meta (id INTEGER PRIMARY KEY, version INTEGER NOT NULL, updated TEXT NOT NULL)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS chunks (part INTEGER PRIMARY KEY, payload TEXT NOT NULL)');
  }
  async fetch(request) {
    if (request.method === 'GET') {
      const meta = this.sql.exec('SELECT version, updated FROM meta WHERE id=1').toArray()[0];
      if (!meta) return json({ error: 'not found' }, 404);
      const encrypted = this.sql.exec('SELECT payload FROM chunks ORDER BY part').toArray().map((r) => r.payload).join('');
      return json({ version: meta.version, updatedAt: meta.updated, encrypted });
    }
    if (request.method !== 'PUT') return json({ error: 'method not allowed' }, 405);
    let body;
    try { body = JSON.parse(await readLimited(request)); }
    catch (e) { return json({ error: 'invalid or oversized request' }, e.status || 400); }
    if (!Number.isSafeInteger(body.expectedVersion) || body.expectedVersion < 0 || typeof body.encrypted !== 'string') return json({ error: 'invalid snapshot' }, 400);
    try {
      const cipher = JSON.parse(body.encrypted);
      const b64 = (s) => typeof s === 'string' && s.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(s);
      if (cipher.app !== 'kenz-encrypted-backup' || cipher.v !== 1 || cipher.kind !== 'zip' || cipher.kdf !== 'PBKDF2-SHA256'
        || !Number.isSafeInteger(cipher.iter) || cipher.iter < 1000 || cipher.iter > 5000000
        || !b64(cipher.data) || cipher.data.length < 24 || !b64(cipher.salt) || atob(cipher.salt).length !== 16
        || !b64(cipher.iv) || atob(cipher.iv).length !== 12) return json({ error: 'encrypted full backup required' }, 400);
    } catch (e) { return json({ error: 'encrypted full backup required' }, 400); }
    return this.storage.transactionSync(() => {
      const current = this.sql.exec('SELECT version, updated FROM meta WHERE id=1').toArray()[0];
      const version = current?.version || 0;
      if (body.expectedVersion !== version) return json({ error: 'conflict', version }, 409);
      const updatedAt = new Date().toISOString();
      this.sql.exec('DELETE FROM chunks');
      for (let i = 0; i < body.encrypted.length; i += 60000) this.sql.exec('INSERT INTO chunks (part,payload) VALUES (?,?)', i / 60000, body.encrypted.slice(i, i + 60000));
      this.sql.exec('INSERT OR REPLACE INTO meta (id,version,updated) VALUES (1,?,?)', version + 1, updatedAt);
      return json({ version: version + 1, updatedAt });
    });
  }
}
