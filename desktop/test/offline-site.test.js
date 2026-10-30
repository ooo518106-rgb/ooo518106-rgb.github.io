'use strict';
// العمل بدون إنترنت من أول تشغيل: الشبكة أولاً، ثم آخر نسخة محفوظة، ثم النسخة المرفقة مع التطبيق
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { makePolicy } = require('../policy');
const { createOfflineSite, typeOf } = require('../offline-site');

const START = 'https://example.github.io/ahsebha/';
const policy = makePolicy(START);
const U = (p) => `https://example.github.io/ahsebha/${p}`;
const GET = (url, init) => new Request(url, init);

function setup(opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ahsebha-offline-test-'));
  const bundleDir = path.join(dir, 'bundle');
  const storeDir = path.join(dir, 'store');
  fs.mkdirSync(path.join(bundleDir, 'js'), { recursive: true });
  fs.writeFileSync(path.join(bundleDir, 'index.html'), '<title>bundle</title>');
  fs.writeFileSync(path.join(bundleDir, 'js', 'app.js'), 'export const v = "bundle";');
  fs.writeFileSync(path.join(bundleDir, 'sw.js'), '// bundled sw');
  fs.writeFileSync(path.join(bundleDir, 'data.wasm'), Buffer.from([0, 97, 115, 109]));
  let t = 1000;
  const clock = { now: () => t, advance: (ms) => { t += ms; } };
  const site = createOfflineSite({ policy, startUrl: START, bundleDir, storeDir, now: clock.now, timeoutMs: 50, windowMs: 1000, ...opts });
  return { dir, bundleDir, storeDir, site, clock };
}
const online = (body = 'live', type = 'text/javascript') => { const f = async () => new Response(body, { status: 200, headers: { 'content-type': type } }); f.calls = 0; return f; };
const counted = (impl) => { const f = async (...a) => { f.calls++; return impl(...a); }; f.calls = 0; return f; };
const down = () => counted(async () => { throw new TypeError('fetch failed'); });
const text = (r) => r.text();

test('مسار الصفحة داخل البرنامج: الرئيسية والملفات، ويرفض ما هو غير آمن', () => {
  const { site } = setup();
  assert.equal(site.relOf(START), 'index.html');
  assert.equal(site.relOf('https://example.github.io/ahsebha'), 'index.html');
  assert.equal(site.relOf(U('js/app.js?v=3')), 'js/app.js', 'الاستعلام لا يغيّر الملف');
  assert.equal(site.relOf(U('js/')), 'js/index.html');
  assert.equal(site.relOf(U('a%20b.png')), 'a b.png');
  assert.equal(site.relOf('https://example.github.io/other/x.js'), null, 'خارج مجلد البرنامج');
  assert.equal(site.relOf('https://evil.example/ahsebha/x.js'), null, 'موقع آخر');
  assert.equal(site.relOf(U('..%2F..%2Fsecret')), null, 'صعود بمجلدات مشفّرة');
  assert.equal(site.relOf(U('js%5C..%5Cx')), null, 'شرطة عكسية');
  assert.equal(site.relOf(U('x%00.js')), null, 'حرف فارغ');
  assert.equal(site.relOf(U('%E0%A4%A')), null, 'ترميز معطوب');
});

test('أنواع الملفات من الامتداد (ومنها wasm الذي يحتاجه محرك قراءة النص)', () => {
  assert.equal(typeOf('a/b.js'), 'text/javascript; charset=utf-8');
  assert.equal(typeOf('x.wasm'), 'application/wasm');
  assert.equal(typeOf('ocr/ara.traineddata.gz'), 'application/gzip');
  assert.equal(typeOf('icons/a.png'), 'image/png');
  assert.equal(typeOf('noext'), 'application/octet-stream');
});

test('الشبكة تعمل: يُعاد ردّها كما هو وتُحفظ نسخة منه', async () => {
  const { site, storeDir } = setup();
  const net = online('live code');
  const res = await site.respond(GET(U('js/app.js')), net);
  assert.equal(await text(res), 'live code');
  await site.idle();
  assert.equal(site.snapshot().net, 1);
  assert.equal(fs.readdirSync(storeDir).filter((f) => f.endsWith('.bin')).length, 1);
});

test('تعذّر الشبكة: آخر نسخة نجحت على الجهاز أولاً (لا الأقدم المرفقة بالتطبيق)', async () => {
  const { site, clock } = setup();
  await site.respond(GET(U('js/app.js')), online('live v2'));
  await site.idle();
  clock.advance(5000);
  const res = await site.respond(GET(U('js/app.js')), down());
  assert.equal(await text(res), 'live v2');
  assert.equal(res.headers.get('x-ahsebha-source'), 'store');
  assert.equal(res.headers.get('content-type'), 'text/javascript');
  assert.equal(res.headers.get('cache-control'), 'no-store', 'لا تدخل ذاكرة المتصفح المؤقتة');
  assert.equal(site.snapshot().store, 1);
});

test('بلا نسخة محفوظة: النسخة المرفقة مع التطبيق (من أول تشغيل بلا إنترنت)', async () => {
  const { site } = setup();
  const home = await site.respond(GET(START), down());
  assert.equal(await text(home), '<title>bundle</title>');
  assert.equal(home.headers.get('content-type'), 'text/html; charset=utf-8');
  assert.equal(home.headers.get('x-ahsebha-source'), 'bundle');
  const js = await site.respond(GET(U('js/app.js')), down());
  assert.equal(await text(js), 'export const v = "bundle";');
  assert.equal(js.headers.get('content-type'), 'text/javascript; charset=utf-8');
  const wasm = await site.respond(GET(U('data.wasm')), down());
  assert.equal(wasm.headers.get('content-type'), 'application/wasm');
  assert.deepEqual([...new Uint8Array(await wasm.arrayBuffer())], [0, 97, 115, 109]);
  assert.equal(site.snapshot().bundle, 3);
  assert.equal(site.snapshot().net, 0);
});

test('لا شبكة ولا نسخة: يفشل الطلب بخطأ الشبكة نفسه (فتظهر صفحة «لا يوجد اتصال»)', async () => {
  const { site } = setup();
  await assert.rejects(() => site.respond(GET(U('js/missing.js')), down()), /fetch failed/);
  assert.equal(site.snapshot().miss, 1);
});

test('خطأ من الخادم (5xx): نسخة محلية إن وُجدت، وإلا الخطأ كما هو', async () => {
  const { site } = setup();
  const boom = async () => new Response('bad gateway', { status: 502 });
  const res = await site.respond(GET(START), boom);
  assert.equal(await text(res), '<title>bundle</title>');
  const none = await site.respond(GET(U('js/missing.js')), boom);
  assert.equal(none.status, 502);
});

test('الأخطاء من جهة الطلب (404 وما شابه) تمر كما هي ولا تُستبدل بنسخة قديمة', async () => {
  const { site } = setup();
  const nf = async () => new Response('not found', { status: 404 });
  const res = await site.respond(GET(U('js/app.js')), nf);
  assert.equal(res.status, 404);
  assert.equal(site.snapshot().bundle, 0);
});

test('عامل الخدمة sw.js: يُسجَّل من الشبكة الحقيقية فقط، ولا يُقدَّم من نسخة محلية ولا يُحفظ', async () => {
  const { site, storeDir } = setup();
  await assert.rejects(() => site.respond(GET(U('sw.js')), down()), /fetch failed/);
  const res = await site.respond(GET(U('sw.js')), online('// live sw'));
  assert.equal(await text(res), '// live sw');
  await site.idle();
  assert.ok(!fs.existsSync(storeDir) || fs.readdirSync(storeDir).length === 0, 'لم يُحفظ');
});

test('ما ليس من البرنامج أو ليس GET يمر كما هو دون أي تدخل', async () => {
  const { site } = setup();
  const seen = [];
  const net = async (req, init) => { seen.push([req.url, req.method, init]); return new Response('x'); };
  await site.respond(GET('https://fonts.googleapis.com/css2?family=Cairo'), net);
  await site.respond(GET(U('share-target'), { method: 'POST', body: 'a' }), net);
  await site.respond(GET('https://example.github.io/other/page.html'), net);
  assert.equal(seen.length, 3);
  assert.deepEqual(seen.map((s) => s[2]), [{}, {}, {}], 'بلا مهلة ولا إلغاء');
  assert.equal(site.snapshot().net, 0);
});

test('إنترنت «موصول بلا خدمة»: بعد أول فشل لا ننتظر كل ملف، ثم نعيد المحاولة بعد المهلة', async () => {
  const { site, clock } = setup();
  const net = down();
  await site.respond(GET(START), net);
  assert.equal(net.calls, 1);
  for (const p of ['js/app.js', 'index.html', 'data.wasm']) await site.respond(GET(U(p)), net);
  assert.equal(net.calls, 1, 'الطلبات التالية لم تنتظر الشبكة');
  assert.equal(site.snapshot().skipped, 3);
  clock.advance(1500);
  const back = online('live again');
  const res = await site.respond(GET(U('js/app.js')), back);
  assert.equal(await text(res), 'live again', 'عادت الشبكة فعادت التحديثات');
});

test('رد الخادم البطيء: نعود للنسخة المحلية بعد المهلة ولا نعلّق التطبيق', async () => {
  const { site } = setup({ timeoutMs: 30 });
  const slow = (req, init) => new Promise((resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(init.signal.reason));
    // لا يرد أبداً
  });
  const res = await site.respond(GET(START), slow);
  assert.equal(await text(res), '<title>bundle</title>');
  assert.equal(site.snapshot().netFail, 1);
});

test('بلا نسخة محلية لا نضع مهلة (نمنح الشبكة وقتها كاملاً)', async () => {
  const { site } = setup({ timeoutMs: 10 });
  const seen = [];
  const net = async (req, init) => { seen.push(init); await new Promise((r) => setTimeout(r, 40)); return new Response('late', { status: 200 }); };
  const res = await site.respond(GET(U('js/new-file.js')), net);
  assert.equal(await text(res), 'late');
  assert.deepEqual(seen, [{}], 'بلا signal');
});

test('إن ألغت الصفحة الطلب بنفسها فهذا ليس انقطاعاً: لا نقدّم نسخة ولا نوقف الشبكة', async () => {
  const { site } = setup();
  const ac = new AbortController();
  const req = GET(START, { signal: ac.signal });
  ac.abort();
  const net = async () => { throw new DOMException('aborted', 'AbortError'); };
  await assert.rejects(() => site.respond(req, net), /abort/i);
  const ok = await site.respond(GET(START), online('<title>live</title>', 'text/html'));
  assert.equal(await text(ok), '<title>live</title>', 'لم يُفعَّل وضع «بلا إنترنت»');
});

test('الحفظ: لا يتجاوز حجماً محدداً، ولا يحفظ غير 200، ولا يؤثر على الرد إن فشل', async () => {
  const { site, storeDir, bundleDir } = setup({ maxFileBytes: 10 });
  await site.respond(GET(U('big.js')), online('0123456789abcdef'));
  await site.respond(GET(U('small.js')), online('tiny'));
  await site.respond(GET(U('nf.js')), async () => new Response('nope', { status: 404 }));
  await site.idle();
  const bins = fs.readdirSync(storeDir).filter((f) => f.endsWith('.bin'));
  assert.equal(bins.length, 1, 'حُفظ الصغير فقط');
  // مجلد الحفظ غير قابل للكتابة: يبقى الرد سليماً
  const bad = createOfflineSite({ policy, startUrl: START, bundleDir, storeDir: path.join(bundleDir, 'index.html', 'x') });
  const res = await bad.respond(GET(U('js/app.js')), online('still fine'));
  assert.equal(await text(res), 'still fine');
  await bad.idle();
});

test('النسخة المحفوظة تتحدّث مع كل تشغيل بإنترنت', async () => {
  const { site, clock } = setup();
  await site.respond(GET(U('js/app.js')), online('v1'));
  await site.idle();
  await site.respond(GET(U('js/app.js')), online('v2'));
  await site.idle();
  clock.advance(5000);
  assert.equal(await text(await site.respond(GET(U('js/app.js')), down())), 'v2');
});
