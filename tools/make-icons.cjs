// يولّد كل ملفات الأيقونات (PNG) من شعار «كنز» الرئيسي في tools/logo.
// الاستعمال: node tools/make-icons.cjs   (يحتاج Playwright لرسم الـSVG)
// الناتج: ahsebha/icons/*.png وأيقونة التطبيق المكتبي desktop/build/icon.png.
// ahsebha/icons/icon.svg نسخة طبق الأصل من tools/logo/icon.svg: عدّل الأصل ثم انسخه هناك وأعد التوليد.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const logo = (f) => path.join(__dirname, 'logo', f);
const b64 = (f) => 'data:image/svg+xml;base64,' + fs.readFileSync(f).toString('base64');
const TARGETS = [
  [path.join(root, 'ahsebha/icons/icon-96.png'), 'icon.svg', 96],
  [path.join(root, 'ahsebha/icons/icon-192.png'), 'icon.svg', 192],
  [path.join(root, 'ahsebha/icons/icon-512.png'), 'icon.svg', 512],
  // الأيقونة القابلة للقص (أندرويد) والآيفون بلا زوايا مدوّرة: الخلفية تملأ المربع كله
  [path.join(root, 'ahsebha/icons/maskable-192.png'), 'icon-bleed.svg', 192],
  [path.join(root, 'ahsebha/icons/maskable-512.png'), 'icon-bleed.svg', 512],
  [path.join(root, 'ahsebha/icons/apple-touch-icon.png'), 'icon-bleed.svg', 180],
  [path.join(root, 'desktop/build/icon.png'), 'icon.svg', 1024],
];

(async () => {
  if (!fs.readFileSync(logo('icon.svg')).equals(fs.readFileSync(path.join(root, 'ahsebha/icons/icon.svg')))) {
    console.error('تنبيه: ahsebha/icons/icon.svg يختلف عن tools/logo/icon.svg. انسخ الأصل إليه.');
    process.exitCode = 1;
  }
  const browser = await chromium.launch();
  for (const [out, file, size] of TARGETS) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    await page.setContent(`<body style="margin:0;background:transparent"><img src="${b64(logo(file))}" width="${size}" height="${size}" style="display:block"></body>`);
    await page.waitForTimeout(150);
    await page.screenshot({ path: out, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
    await page.close();
    console.log('wrote', path.relative(root, out), size);
  }
  await browser.close();
})();
