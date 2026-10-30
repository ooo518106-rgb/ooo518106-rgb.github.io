// يولّد صور التثبيت والمتجر من الواجهة الحقيقية ببيانات العرض التجريبية:
//   صور الجوال phone-1..5.jpg (1080×1920) وصور الشاشة العريضة wide-1..3.jpg (1920×1080) وصورة العرض feature-graphic.png (1024×500).
// الاستعمال: شغّل خادماً محلياً على مجلد المستودع ثم:
//   python3 -m http.server 8765 &   node tools/store-assets.cjs
// المتغيرات: BASE (عنوان البرنامج، الافتراضي http://127.0.0.1:8765/ahsebha/) و OUT (مجلد الناتج، الافتراضي ahsebha/store).
// الصور مذكورة في ahsebha/manifest.json (نافذة التثبيت) وفي ahsebha/store/README.md (متجر Google Play).
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = process.env.BASE || 'http://127.0.0.1:8765/ahsebha/';
const OUT = path.resolve(process.env.OUT || path.join(__dirname, '../ahsebha/store'));
const FONTS = 'file://' + path.join(__dirname, '../ahsebha/fonts/fonts.css');
const word = (f) => 'data:image/svg+xml;base64,' + fs.readFileSync(path.join(__dirname, 'logo', f)).toString('base64');
fs.mkdirSync(OUT, { recursive: true });

async function open(browser, opts) {
  const ctx = await browser.newContext({ locale: 'ar', serviceWorkers: 'block', colorScheme: 'light', ...opts });
  await ctx.addInitScript(() => { try { localStorage.setItem('theme', 'light'); } catch (e) { /* يبقى الفاتح */ } });
  await ctx.route(/google-analytics\.com|googletagmanager\.com|analytics\.google\.com/, (r) => r.abort());
  const page = await ctx.newPage();
  await page.goto(BASE);
  await page.click('[data-demo]');
  await page.waitForSelector('#side nav a', { timeout: 30000 });
  await page.waitForTimeout(800);
  // صور تسويقية: بلا تنبيه النسخة الاحتياطية ولا رسالة «تم تحميل البيانات»
  await page.evaluate(async () => { const s = await import('./js/store.js'); s.saveSettings({ lastBackupAt: new Date().toISOString() }); });
  return { ctx, page };
}

async function shot(page, file, hash, { quality = 86, prep } = {}) {
  await page.evaluate((h) => { location.hash = h; }, hash);
  await page.waitForTimeout(1100);
  if (prep) await prep(page);
  await page.evaluate(() => {
    document.getElementById('toasts').replaceChildren();
    document.querySelectorAll('#view .page > p.note').forEach((n) => n.remove());
  });
  await page.waitForTimeout(250);
  const buf = await page.screenshot({ type: 'jpeg', quality });
  fs.writeFileSync(path.join(OUT, file), buf);
  console.log('wrote', file, buf.length);
  return buf;
}

// صورة إيصال فيها رمز QR الضريبي، كما يصوّرها الزبون: البرنامج يقرؤه ويعبّي المصروف
async function receiptPng(page) {
  const b64 = await page.evaluate(async () => {
    const { zatcaTLV } = await import('./js/core.js');
    const q = window.qrcode(0, 'M');
    q.addData(zatcaTLV(['سوبرماركت السلام', '300123456700003', '2026-10-24T14:30:00Z', '23.75', '3.28']));
    q.make();
    const n = q.getModuleCount(); const px = 8; const pad = 4;
    const c = document.createElement('canvas');
    c.width = c.height = (n + pad * 2) * px;
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = '#000';
    for (let r = 0; r < n; r++) for (let k = 0; k < n; k++) if (q.isDark(r, k)) g.fillRect((k + pad) * px, (r + pad) * px, px, px);
    return c.toDataURL('image/png').split(',')[1];
  });
  return Buffer.from(b64, 'base64');
}

(async () => {
  const browser = await chromium.launch();

  // ─── الجوال ───
  {
    const { ctx, page } = await open(browser, { viewport: { width: 360, height: 640 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
    const ids = await page.evaluate(async () => { const s = await import('./js/store.js'); const d = s.getDb(); return { inv: (d.docs.find((x) => x.type === 'sale') || {}).id }; });
    await shot(page, 'phone-1.jpg', '#/');
    await shot(page, 'phone-2.jpg', '#/pos');
    await shot(page, 'phone-3.jpg', '#/sales/' + ids.inv, { prep: (p) => p.evaluate(() => { const e = document.querySelector('.paper'); if (e) window.scrollTo(0, e.getBoundingClientRect().top + scrollY - 76); }) });
    // قراءة الإيصال: نفتح النافذة ونعطيها صورة إيصال فيها رمز QR
    await page.evaluate(() => { location.hash = '#/expenses/new?read=1'; });
    await page.waitForSelector('dialog.dlg[open] input[data-file]', { state: 'attached' });
    await page.locator('dialog.dlg[open] input[data-file]').nth(1).setInputFiles({ name: 'receipt.png', mimeType: 'image/png', buffer: await receiptPng(page) });
    await page.waitForSelector('dialog.dlg[open] [data-step="result"]:not([hidden])', { timeout: 40000 });
    await page.waitForTimeout(700);
    await page.evaluate(() => { document.getElementById('toasts').replaceChildren(); });
    fs.writeFileSync(path.join(OUT, 'phone-4.jpg'), await page.screenshot({ type: 'jpeg', quality: 86 }));
    console.log('wrote phone-4.jpg');
    await page.evaluate(() => { const d = document.querySelector('dialog[open]'); if (d) d.close(); });
    await shot(page, 'phone-5.jpg', '#/reports/income');
    await ctx.close();
  }

  // ─── الشاشة العريضة ───
  let wide1 = null;
  {
    const { ctx, page } = await open(browser, { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1.5 });
    wide1 = await shot(page, 'wide-1.jpg', '#/');
    await shot(page, 'wide-2.jpg', '#/sales');
    await shot(page, 'wide-3.jpg', '#/reports/income');
    await ctx.close();
  }

  // ─── صورة العرض 1024×500 (Google Play) ───
  {
    const page = await browser.newPage({ viewport: { width: 1024, height: 500 }, deviceScaleFactor: 1 });
    const chips = ['فواتير ضريبية QR', 'كاشير بالباركود', 'مخزون', 'تقارير وإقرار ضريبي', 'رواتب'];
    await page.setContent(`<link rel="stylesheet" href="${FONTS}"><body style="margin:0">
      <div style="position:relative;width:1024px;height:500px;overflow:hidden;direction:rtl;font-family:'IBM Plex Sans Arabic',sans-serif;color:#fff;
        background:radial-gradient(900px 520px at 85% 10%, #6d5ff6 0%, rgba(109,95,246,0) 60%), linear-gradient(135deg,#4338ca 0%,#2b2590 55%,#1b1766 100%)">
        <div style="position:absolute;right:56px;top:62px;width:450px">
          <div style="display:flex;align-items:center;gap:20px;margin-bottom:10px">
            <img src="${word('icon.svg')}" width="118" height="118" style="display:block;border-radius:28px;box-shadow:0 14px 30px rgba(8,6,50,.45)">
            <img src="${word('word-white.svg')}" height="132" style="display:block">
          </div>
          <div style="font-size:30px;font-weight:700;line-height:1.5">برنامج محاسبة مجاني ومتكامل</div>
          <div style="font-size:18px;opacity:.85;margin-top:2px">للمحلات والمتاجر والشركات الصغيرة، وبياناتك على جهازك</div>
          <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:22px">${chips.map((c) => `<span style="background:rgba(255,255,255,.16);border:1px solid rgba(255,255,255,.28);padding:5px 14px;border-radius:99px;font-size:16px;font-weight:600">${c}</span>`).join('')}</div>
        </div>
        <div style="position:absolute;left:44px;top:92px;width:470px;height:300px;border-radius:18px;overflow:hidden;box-shadow:0 30px 60px rgba(8,6,50,.55),0 0 0 6px rgba(255,255,255,.14);background:#fff">
          <img src="data:image/jpeg;base64,${wide1.toString('base64')}" style="width:100%;display:block">
        </div></div></body>`);
    await page.waitForTimeout(900);
    await page.screenshot({ path: path.join(OUT, 'feature-graphic.png'), clip: { x: 0, y: 0, width: 1024, height: 500 } });
    console.log('wrote feature-graphic.png');
    await page.close();
  }
  await browser.close();
})();
