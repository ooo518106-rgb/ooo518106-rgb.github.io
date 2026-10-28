'use strict';
// اختبارات سياسة نافذة التطبيق: ما يفتح داخلها وما يخرج للمتصفح وما يُسمح للصفحة بطلبه
const test = require('node:test');
const assert = require('node:assert/strict');
const { makePolicy, permissionAllowed, parseArgs } = require('../policy');

const HOST = 'https://ooo518106-rgb.github.io';
const P = makePolicy(`${HOST}/ahsebha/`);

test('داخل النافذة: صفحات البرنامج فقط', () => {
  for (const u of [`${HOST}/ahsebha/`, `${HOST}/ahsebha`, `${HOST}/ahsebha/#/sales`, `${HOST}/ahsebha/plans.html`, `${HOST}/ahsebha/owner.html`, `${HOST}/ahsebha/js/app.js`, `${HOST}/ahsebha/?x=1#/today`]) {
    assert.equal(P.isApp(u), true, u);
  }
  for (const u of [`${HOST}/`, `${HOST}/ahsebhax/`, `${HOST}/other/`, `${HOST}/ahsebha/../other/`, 'https://ooo518106-rgb.github.io.evil.com/ahsebha/', 'http://ooo518106-rgb.github.io/ahsebha/', 'https://evil.com/ahsebha/', 'file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,hi', 'about:blank', '', 'ليس رابطاً']) {
    assert.equal(P.isApp(u), false, u);
  }
});

test('ملفات البرنامج المؤقتة (مرفقات PDF): blob من نفس الموقع فقط', () => {
  assert.equal(P.isAppBlob(`blob:${HOST}/3f2a-uuid`), true);
  assert.equal(P.isAppBlob('blob:https://evil.com/3f2a'), false);
  assert.equal(P.isAppBlob(`blob:${HOST}.evil.com/x`), false);
  assert.equal(P.isAppBlob(`${HOST}/ahsebha/`), false);
  assert.equal(P.isAppBlob(''), false);
  assert.equal(P.isAppBlob(null), false);
  assert.equal(P.isApp(`blob:${HOST}/x`), false, 'blob ليس صفحة تُعرض داخل النافذة');
});

test('الروابط الخارجية: واتساب والمواقع والبريد والهاتف فقط', () => {
  for (const u of ['https://wa.me/962791234567?text=hi', 'https://api.whatsapp.com/send/?phone=1', 'http://example.com', 'mailto:a@b.com', 'tel:+962791234567']) assert.equal(P.isExternal(u), true, u);
  for (const u of ['file:///C:/Windows/System32/calc.exe', 'javascript:alert(1)', 'data:text/html,hi', 'blob:https://x/1', 'ms-msdt:/id', 'smb://host/share', 'vscode://x', '', 'x']) assert.equal(P.isExternal(u), false, u);
});

test('أصل الصفحة (للصلاحيات)', () => {
  assert.equal(P.isOrigin(HOST), true);
  assert.equal(P.isOrigin(`${HOST}/anything`), true);
  assert.equal(P.isOrigin('https://evil.com'), false);
  assert.equal(P.isOrigin('http://ooo518106-rgb.github.io'), false);
  assert.equal(P.isOrigin(''), false);
});

test('الصلاحيات: الكاميرا بدون ميكروفون، والنسخ، وملء الشاشة. غير ذلك مرفوض', () => {
  assert.equal(permissionAllowed('media', { mediaTypes: ['video'] }), true);
  assert.equal(permissionAllowed('media', { mediaTypes: ['video', 'audio'] }), false);
  assert.equal(permissionAllowed('media', { mediaTypes: ['audio'] }), false);
  assert.equal(permissionAllowed('media', {}), true);
  assert.equal(permissionAllowed('clipboard-sanitized-write'), true);
  assert.equal(permissionAllowed('fullscreen'), true);
  for (const p of ['geolocation', 'notifications', 'midi', 'openExternal', 'clipboard-read', 'hid', 'serial', 'usb', 'display-capture', 'unknown']) assert.equal(permissionAllowed(p, {}), false, p);
});

test('وسائط التشغيل: اختبار التشغيل فقط عند طلبه', () => {
  const base = { smoke: false, smokeOffline: false, smokeNoNetwork: false, smokeOut: '', smokeUserData: '' };
  assert.deepEqual(parseArgs(['electron', '.']), base);
  assert.deepEqual(parseArgs(['app', '--smoke-test']), { ...base, smoke: true });
  assert.deepEqual(parseArgs(['app', '--smoke-offline']), { ...base, smoke: true, smokeOffline: true });
  assert.deepEqual(parseArgs(['app', '--smoke-no-network', '--smoke-user-data=/tmp/p']), { ...base, smoke: true, smokeNoNetwork: true, smokeUserData: '/tmp/p' });
  assert.deepEqual(parseArgs(['app', '--smoke-test', '--smoke-out=/tmp/x.json']), { ...base, smoke: true, smokeOut: '/tmp/x.json' });
  assert.deepEqual(parseArgs(['app', '--smoke-out=C:\\a b\\x.json']), { ...base, smokeOut: 'C:\\a b\\x.json' });
});

test('بيئة التطوير المحلية: نفس القواعد على عنوان آخر', () => {
  const L = makePolicy('http://127.0.0.1:8765/ahsebha/');
  assert.equal(L.isApp('http://127.0.0.1:8765/ahsebha/#/pos'), true);
  assert.equal(L.isApp('http://127.0.0.1:8765/'), false);
  assert.equal(L.isApp('http://127.0.0.1:9999/ahsebha/'), false);
  assert.equal(L.isOrigin('http://127.0.0.1:8765'), true);
});
