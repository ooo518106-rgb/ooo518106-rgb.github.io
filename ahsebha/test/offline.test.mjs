// حفظ البرنامج للعمل بدون إنترنت: نحاكي ما يفعله عامل الخدمة عند التثبيت على ملفات المستودع الحقيقية
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';

const root = new URL('../', import.meta.url).pathname;
const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
const SHELL = new Function(`return ${sw.match(/const SHELL = (\[.*?\]);/)[1]}`)();
const IMPORT_RE = new Function(`return ${sw.match(/const IMPORT_RE = (\/.*\/g);/)[1]}`)();

// نفس خوارزمية precache() بدون شبكة
function crawl() {
  const seen = new Map();
  const queue = SHELL.map((p) => (p === './' ? 'index.html' : p));
  while (queue.length) {
    const rel = queue.shift();
    if (seen.has(rel)) continue;
    const file = resolve(root, rel);
    if (!existsSync(file)) { seen.set(rel, false); continue; }
    seen.set(rel, true);
    if (/\.m?js$/.test(rel)) {
      for (const m of readFileSync(file, 'utf8').matchAll(IMPORT_RE)) {
        const spec = m[1] || m[2];
        if (spec && spec.startsWith('.')) queue.push(relative(root, resolve(dirname(file), spec)));
      }
    }
  }
  return seen;
}

test('الحفظ المسبق: كل ملفات البرنامج المستوردة تُحفظ عند التثبيت وكلها موجودة', () => {
  const seen = crawl();
  const missing = [...seen].filter(([, ok]) => !ok).map(([f]) => f);
  assert.deepEqual(missing, [], 'استيراد لملف غير موجود');
  const files = [...seen.keys()];
  assert.ok(files.length >= 45, 'عدد الملفات المحفوظة: ' + files.length);
  for (const f of ['index.html', 'app.css', 'manifest.json', 'js/app.js', 'js/core.js', 'js/store.js', 'js/license.js', 'js/plans.js', 'js/insights.js', 'js/views/subscription.js', 'js/views/install.js', 'js/views/today.js', 'js/downloads.js', 'js/xlsx.js', 'js/imports.js', 'vendor/qrcode.js']) {
    assert.ok(seen.has(f), `لا يُحفظ مسبقاً: ${f}`);
  }
});

test('المكتبات الكبيرة لا تُحفظ مسبقاً (تُحفظ عند أول استخدام)، ولا صفحات المالك والباقات', () => {
  const files = [...crawl().keys()];
  assert.ok(!files.some((f) => /tesseract|zxing|\.wasm|traineddata/i.test(f)), 'مكتبات كبيرة بالحفظ المسبق');
  for (const f of ['owner.html', 'js/owner.js', 'plans.html', 'js/plans-page.js', 'download.html', 'js/download-page.js', 'js/license-sign.js']) assert.ok(!files.includes(f), f);
});

test('عامل الخدمة: يحفظ مسبقاً عند التثبيت، ويفضّل الشبكة، ولا يوقف التثبيت بخطأ ملف واحد', () => {
  assert.match(sw, /addEventListener\('install', \(e\) => \{ self\.skipWaiting\(\); e\.waitUntil\(precache\(\)\); \}\)/);
  assert.match(sw, /cache: 'reload'/, 'يجلب أحدث نسخة وليس من ذاكرة المتصفح');
  assert.match(sw, /fetch\(req\)\.then/, 'الشبكة أولاً');
  assert.ok((sw.match(/catch \(e\)/g) || []).length >= 2, 'التقاط الأخطاء داخل الحفظ المسبق');
  assert.match(sw, /const CACHE = 'ahsebha-accounting-v\d+'/);
});
