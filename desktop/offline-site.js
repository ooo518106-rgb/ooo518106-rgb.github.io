'use strict';
// ═══ العمل بدون إنترنت من أول تشغيل ═══
// لا يمسّ إلا صفحات البرنامج نفسه (نفس الموقع ونفس المجلد). الشبكة أولاً دائماً فتصل التحديثات فوراً،
// وإذا تعذّرت الشبكة أو أعطى الموقع خطأً من جهته نقدّم بالترتيب:
//   1) آخر نسخة نجحت من الشبكة على هذا الجهاز (تُحفظ تلقائياً مع كل تشغيل بإنترنت)،
//   2) النسخة المرفقة مع التطبيق (مجلد ahsebha داخل ملف التثبيت)، فيعمل التطبيق بلا إنترنت من أول مرة.
// وملف sw.js لا يُقدَّم أبداً من هذه النسخ: يُسجَّل فقط من الشبكة الحقيقية، فلا يبدأ عامل الخدمة بذاكرة فارغة.
// وإذا كان الإنترنت «موصولاً بلا خدمة» لا ننتظر كل ملف: بعد أول فشل نستعمل النسخ المحلية فوراً لعشرين ثانية.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml', '.gz': 'application/gzip',
};
const typeOf = (rel) => TYPES[path.extname(rel).toLowerCase()] || 'application/octet-stream';

const MAX_FILE_BYTES = 25 * 1024 * 1024; // أكبر ملف نحفظه (أكبر ملفات البرنامج نحو 4 ميغا)
const MAX_STORED = 800; // أقصى عدد ملفات محفوظة (البرنامج كله نحو 150 ملفاً)

function createOfflineSite({ policy, startUrl, bundleDir, storeDir, timeoutMs = 5000, windowMs = 20000, maxFileBytes = MAX_FILE_BYTES, now = Date.now }) {
  const base = new URL(startUrl);
  const basePath = base.pathname.endsWith('/') ? base.pathname : base.pathname + '/';
  const stats = { net: 0, netFail: 0, store: 0, bundle: 0, skipped: 0, miss: 0 };
  const pending = new Set();
  let offlineUntil = 0; // حتى هذا الوقت نفترض أن الشبكة غير متاحة
  let storedCount = -1;

  // المسار داخل البرنامج ('' ← index.html)، أو null إن لم يكن صفحة من البرنامج أو كان مساراً غير آمن
  function relOf(url) {
    let u;
    try { u = new URL(url); } catch (e) { return null; }
    if (u.origin !== base.origin) return null;
    if (u.pathname === basePath.slice(0, -1)) return 'index.html';
    if (!u.pathname.startsWith(basePath)) return null;
    let rel;
    try { rel = decodeURIComponent(u.pathname.slice(basePath.length)); } catch (e) { return null; }
    if (rel.includes('\0') || rel.includes('\\') || rel.split('/').some((s) => s === '..' || s === '.')) return null;
    if (rel === '' || rel.endsWith('/')) rel += 'index.html';
    return rel;
  }

  const keyOf = (url) => crypto.createHash('sha256').update(new URL(url).pathname).digest('hex');
  const storeFile = (key, ext) => path.join(storeDir, `${key}.${ext}`);

  function bundleFile(rel) {
    if (!bundleDir) return null;
    const root = path.resolve(bundleDir);
    const file = path.resolve(root, rel);
    if (!file.startsWith(root + path.sep)) return null;
    try { return fs.statSync(file).isFile() ? file : null; } catch (e) { return null; }
  }

  // أين نجد نسخة محلية لهذا الملف (بدون قراءته): المحفوظة من آخر تشغيل بإنترنت أولاً، ثم المرفقة مع التطبيق
  function findLocal(url, rel) {
    if (storeDir) {
      const key = keyOf(url);
      if (fs.existsSync(storeFile(key, 'bin'))) {
        let type = '';
        try { type = fs.readFileSync(storeFile(key, 'type'), 'utf8').trim(); } catch (e) { /* نوع الملف من امتداده */ }
        return { source: 'store', file: storeFile(key, 'bin'), type: /^[\w.+-]+\/[\w.+-]+(;[ \w=.+-]+)?$/.test(type) ? type : typeOf(rel) };
      }
    }
    const file = bundleFile(rel);
    return file ? { source: 'bundle', file, type: typeOf(rel) } : null;
  }

  function serve(local) {
    try {
      const body = fs.readFileSync(local.file);
      stats[local.source]++;
      return new Response(body, { status: 200, headers: { 'content-type': local.type, 'cache-control': 'no-store', 'x-ahsebha-source': local.source } });
    } catch (e) { return null; }
  }

  // نحفظ نسخة كل ملف نجح من الشبكة (في الخلفية ودون التأثير على الصفحة)
  function save(url, rel, res) {
    const job = (async () => {
      try {
        if (Number(res.headers.get('content-length') || 0) > maxFileBytes) return;
        const body = Buffer.from(await res.arrayBuffer());
        if (body.length > maxFileBytes) return;
        fs.mkdirSync(storeDir, { recursive: true });
        if (storedCount < 0) storedCount = fs.readdirSync(storeDir).filter((f) => f.endsWith('.bin')).length;
        const key = keyOf(url);
        const isNew = !fs.existsSync(storeFile(key, 'bin'));
        if (isNew && storedCount >= MAX_STORED) return;
        const tmp = path.join(storeDir, `${key}.${process.pid}.${now()}.tmp`);
        fs.writeFileSync(tmp, body);
        fs.renameSync(tmp, storeFile(key, 'bin'));
        fs.writeFileSync(storeFile(key, 'type'), res.headers.get('content-type') || typeOf(rel));
        if (isNew) storedCount++;
      } catch (e) { /* الحفظ لا يؤثر على عمل البرنامج */ }
    })().finally(() => pending.delete(job));
    pending.add(job);
  }

  // محاولة الشبكة. مع وجود نسخة محلية ننتظر وصول رد الخادم مدة محدودة فقط (الملف نفسه يكمل تنزيله بعدها دون حد)
  async function attempt(request, netFetch, ms) {
    if (!ms) return netFetch(request, {});
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(new Error('timeout')), ms);
    const onAbort = () => ac.abort(request.signal.reason);
    if (request.signal) request.signal.addEventListener('abort', onAbort, { once: true });
    try { return await netFetch(request, { signal: ac.signal }); } finally {
      clearTimeout(timer);
      if (request.signal) request.signal.removeEventListener('abort', onAbort);
    }
  }

  // request: طلب fetch قياسي. netFetch(request, init): يرسله فعلاً إلى الشبكة. يعيد Response أو يرمي خطأ الشبكة كما هو
  async function respond(request, netFetch) {
    const rel = request.method === 'GET' && policy.isApp(request.url) ? relOf(request.url) : null;
    if (rel === null) return netFetch(request, {}); // ليس من البرنامج: يمر كما هو
    const isSw = rel === 'sw.js';
    const local = isSw ? null : findLocal(request.url, rel);

    if (local && now() < offlineUntil) { // الشبكة لا تعمل الآن: لا ننتظرها
      const hit = serve(local);
      if (hit) { stats.skipped++; return hit; }
    }
    let res = null;
    let err = null;
    try { res = await attempt(request, netFetch, local ? timeoutMs : 0); } catch (e) { err = e; }
    if (err && request.signal && request.signal.aborted) throw err; // أغلقت الصفحة الطلب بنفسها: ليس انقطاعاً

    if (res && res.status < 500) {
      offlineUntil = 0;
      stats.net++;
      if (res.status === 200 && !isSw && storeDir) save(request.url, rel, res.clone());
      return res;
    }
    stats.netFail++;
    offlineUntil = now() + windowMs;
    if (local) {
      const hit = serve(local);
      if (hit) return hit;
    }
    if (res) return res; // خطأ من الخادم ولا نسخة محلية: نمرّره كما هو
    stats.miss++;
    throw err || new Error('offline');
  }

  return { respond, relOf, idle: () => Promise.all([...pending]), snapshot: () => ({ ...stats }) };
}

module.exports = { createOfflineSite, typeOf };
