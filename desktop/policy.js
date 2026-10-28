'use strict';
// سياسة التنقل والصلاحيات لنافذة التطبيق: دوال بحتة بلا Electron، لتُختبر بسهولة.
// القاعدة: نافذة التطبيق تعرض صفحات البرنامج فقط. أي رابط خارجه يُفتح في متصفح الجهاز.

function makePolicy(startUrl) {
  const start = new URL(startUrl);
  const base = start.pathname.endsWith('/') ? start.pathname : start.pathname + '/';

  // صفحة من البرنامج نفسه (نفس الموقع ونفس المجلد)
  const isApp = (u) => {
    try {
      const x = new URL(u);
      return x.origin === start.origin && (x.pathname.startsWith(base) || x.pathname === base.slice(0, -1));
    } catch (e) { return false; }
  };
  // أصل البرنامج (للصلاحيات: الكاميرا وغيرها)
  const isOrigin = (o) => {
    try { return new URL(o).origin === start.origin; } catch (e) { return false; }
  };
  // روابط يُسمح بفتحها خارج التطبيق (واتساب، بريد، هاتف، مواقع)
  const isExternal = (u) => {
    try { return ['https:', 'http:', 'mailto:', 'tel:'].includes(new URL(u).protocol); } catch (e) { return false; }
  };
  return { isApp, isOrigin, isExternal };
}

// ما يُسمح للصفحة بطلبه: الكاميرا (للباركود وصور الإيصالات) بدون الميكروفون، والنسخ للحافظة، وملء الشاشة
function permissionAllowed(permission, details = {}) {
  if (permission === 'media') return !(details.mediaTypes || []).includes('audio');
  return ['clipboard-sanitized-write', 'fullscreen'].includes(permission);
}

function parseArgs(argv) {
  const out = { smoke: false, smokeOut: '' };
  for (const a of argv) {
    if (a === '--smoke-test') out.smoke = true;
    else if (a.startsWith('--smoke-out=')) out.smokeOut = a.slice('--smoke-out='.length);
  }
  return out;
}

module.exports = { makePolicy, permissionAllowed, parseArgs };
