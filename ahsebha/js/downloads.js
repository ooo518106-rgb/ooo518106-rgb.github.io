// ═══ تحميل تطبيق سطح المكتب: الروابط من صفحة Releases الرسمية بأسماء ثابتة، فلا تتغير مع كل إصدار ═══
export const REPO = 'ooo518106-rgb/ooo518106-rgb.github.io';

export const DOWNLOADS = [
  { id: 'win', os: 'windows', icon: '🪟', name: 'ويندوز', note: 'ويندوز 10 أو 11', file: 'Ahsebha-Setup.exe' },
  { id: 'mac-arm64', os: 'mac', icon: '🍎', name: 'ماك — معالج Apple', note: 'الأجهزة الحديثة، من M1 وما بعده', file: 'Ahsebha-mac-arm64.dmg' },
  { id: 'mac-x64', os: 'mac', icon: '🍎', name: 'ماك — معالج Intel', note: 'الأجهزة الأقدم', file: 'Ahsebha-mac-x64.dmg' },
  { id: 'linux', os: 'linux', icon: '🐧', name: 'لينكس', note: 'ملف AppImage', file: 'Ahsebha-linux-x64.AppImage' },
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
