// عامل الخدمة: يشغّل البرنامج بدون إنترنت. الشبكة أولاً دائماً حتى تصل التحديثات فوراً،
// والنسخة المخزنة تُستخدم فقط عند انقطاع الاتصال. وعند التثبيت نحفظ ملفات البرنامج كلها فوراً،
// فيعمل بدون إنترنت بعد أول زيارة (وليس بعد الثانية فقط).
const CACHE = 'ahsebha-accounting-v9';

// الملفات الأساسية، ثم نتتبّع ما تستورده ملفات جافاسكربت (static وdynamic) فنحفظها كلها.
// المكتبات الكبيرة (قراءة النص والباركود) تُحفظ عند أول استخدام لها فقط.
const SHELL = ['./', 'index.html', 'app.css', 'fonts/fonts.css', 'fonts/plex-arabic-400.woff2', 'fonts/plex-arabic-500.woff2', 'fonts/plex-arabic-600.woff2', 'fonts/plex-arabic-700.woff2', 'fonts/plex-latin-400.woff2', 'fonts/plex-latin-500.woff2', 'fonts/plex-latin-600.woff2', 'fonts/plex-latin-700.woff2', 'manifest.json', 'js/app.js', 'vendor/qrcode.js', 'icons/icon.svg', 'icons/icon-192.png'];
const IMPORT_RE = /(?:^|[\s;{}()])(?:import|export)\s*(?:[^'"()]*?\sfrom\s*)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;
async function precache() {
  try {
    const cache = await caches.open(CACHE);
    const seen = new Set();
    const queue = SHELL.map((p) => new URL(p, self.registration.scope).href);
    while (queue.length) {
      const url = queue.shift();
      if (seen.has(url)) continue;
      seen.add(url);
      try {
        const res = await fetch(url, { cache: 'reload' });
        if (!res.ok) continue;
        await cache.put(url, res.clone());
        if (/\.m?js$/.test(new URL(url).pathname)) {
          for (const m of (await res.text()).matchAll(IMPORT_RE)) {
            const spec = m[1] || m[2];
            if (spec && spec.startsWith('.')) queue.push(new URL(spec, url).href);
          }
        }
      } catch (e) { /* ملف واحد فاشل لا يمنع الباقي */ }
    }
  } catch (e) { /* التثبيت يكمل بدون حفظ مسبق */ }
}
self.addEventListener('install', (e) => { self.skipWaiting(); e.waitUntil(precache()); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('ahsebha-accounting-') && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// مشاركة صورة إيصال من تطبيق آخر (واتساب، المعرض) إلى البرنامج المثبّت: نحفظها بنفس قاعدة البيانات
// ونفتح شاشة المصروف لتقرأها (store.takeShared)
function idbPut(key, value) {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open('ahsebha-accounting', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onerror = () => reject(r.error);
    r.onsuccess = () => {
      const tx = r.result.transaction('kv', 'readwrite');
      tx.objectStore('kv').put(value, key);
      tx.oncomplete = () => { r.result.close(); resolve(); };
      tx.onerror = () => { r.result.close(); reject(tx.error); };
    };
  });
}
async function shareTarget(req) {
  const form = await req.formData();
  const files = [];
  for (const f of form.getAll('files')) {
    if (f && typeof f === 'object' && f.size && files.length < 5) files.push({ name: f.name, type: f.type, data: await f.arrayBuffer() });
  }
  if (files.length) await idbPut('shared', { at: Date.now(), files });
  return Response.redirect(new URL(files.length ? './#/expenses/new?shared=1' : './#/', self.registration.scope).href, 303);
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method === 'POST' && url.origin === self.location.origin && url.pathname.endsWith('/share-target')) {
    e.respondWith(shareTarget(req).catch(() => Response.redirect(new URL('./', self.registration.scope).href, 303)));
    return;
  }
  if (req.method !== 'GET') return;
  const sameOrigin = url.origin === self.location.origin;
  const fonts = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  if (!sameOrigin && !fonts) return;
  e.respondWith(
    fetch(req).then((res) => {
      if (res.ok && (sameOrigin || res.type === 'cors' || res.type === 'opaque')) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
      }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit || (req.mode === 'navigate' ? caches.match('./') : Response.error())))
  );
});
