// ═══ تحميل تطبيق سطح المكتب: الروابط من صفحة Releases الرسمية بأسماء ثابتة، فلا تتغير مع كل إصدار ═══
export const REPO = 'ooo518106-rgb/ooo518106-rgb.github.io';

export const DOWNLOADS = [
  { id: 'win', os: 'windows', icon: '🪟', name: 'ويندوز', note: 'ويندوز 10 أو 11', file: 'Kenz-Setup.exe' },
  { id: 'mac-arm64', os: 'mac', icon: '🍎', name: 'ماك — معالج Apple', note: 'الأجهزة الحديثة، من M1 وما بعده', file: 'Kenz-mac-arm64.dmg' },
  { id: 'mac-x64', os: 'mac', icon: '🍎', name: 'ماك — معالج Intel', note: 'الأجهزة الأقدم', file: 'Kenz-mac-x64.dmg' },
  { id: 'linux', os: 'linux', icon: '🐧', name: 'لينكس', note: 'ملف AppImage', file: 'Kenz-linux-x64.AppImage' },
];

export const downloadUrl = (file) => `https://github.com/${REPO}/releases/latest/download/${file}`;
export const releasesUrl = `https://github.com/${REPO}/releases/latest`;

// نظام جهاز الزائر. iPad الحديث يعرّف نفسه كـ Mac لكن بلمس متعدد
export function detectOS(ua = typeof navigator !== 'undefined' ? navigator.userAgent : '', touch = typeof navigator !== 'undefined' ? navigator.maxTouchPoints : 0) {
  const u = String(ua);
  if (/iPhone|iPad|iPod/.test(u) || (/Macintosh/.test(u) && touch > 1)) return 'ios';
  if (/Android/.test(u)) return 'android';
  if (/Windows/.test(u)) return 'windows';
  if (/Macintosh|Mac OS X/.test(u)) return 'mac';
  if (/Linux|X11|CrOS/.test(u)) return u.includes('CrOS') ? 'other' : 'linux';
  return 'other';
}

// ما يُنصح به لنظام الزائر (قد يكون أكثر من ملف: ماك فيه معالجان)
export const forOS = (os) => DOWNLOADS.filter((d) => d.os === os);

// بصمة SHA-256 لكل ملف: GitHub يحسبها لكل ملف في الإصدار (الحقل digest بصيغة sha256:…).
// تعرضها صفحة التنزيلات ليتأكد المستخدم أن الملف الذي نزّله هو نفسه المنشور وما عدّل عليه أحد.
export const releaseApi = `https://api.github.com/repos/${REPO}/releases/latest`;
export function digestsOf(release) {
  const out = {};
  for (const a of (release && release.assets) || []) {
    const m = /^sha256:([0-9a-f]{64})$/i.exec((a && a.digest) || '');
    if (m && DOWNLOADS.some((d) => d.file === a.name)) out[a.name] = m[1].toLowerCase();
  }
  return out;
}
// يرجّع { اسم_الملف: البصمة } أو null إن تعذّر الجلب (بلا إنترنت أو تجاوز حد الطلبات) فلا تتأثر الصفحة
export async function fetchDigests(get = (u) => fetch(u, { headers: { Accept: 'application/vnd.github+json' } })) {
  try {
    const r = await get(releaseApi);
    if (!r.ok) return null;
    const out = digestsOf(await r.json());
    return Object.keys(out).length ? out : null;
  } catch (e) { return null; }
}
