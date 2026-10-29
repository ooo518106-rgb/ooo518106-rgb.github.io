'use strict';
// ═══ احسبها لسطح المكتب: برنامج مثبّت بنافذته وأيقونته، لا يفتح في المتصفح ═══
// يعرض واجهة البرنامج من موقعه، فكل تحديث للبرنامج يصل لك تلقائياً بدون إعادة تثبيت،
// ويعمل بدون إنترنت حتى من أول تشغيل: النسخة الكاملة داخل ملف التثبيت (offline-site.js).
// بياناتك المحاسبية تبقى على جهازك.
const { app, BrowserWindow, Menu, net, session, shell } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { makePolicy, permissionAllowed, parseArgs } = require('./policy');
const { createOfflineSite } = require('./offline-site');

const START_URL = process.env.AHSEBHA_URL || 'https://ooo518106-rgb.github.io/ahsebha/';
const policy = makePolicy(START_URL);
const args = parseArgs(process.argv);
const SAFE_PREFS = { contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, spellcheck: false };
let win = null;
let offlineSite = null;

app.setAppUserModelId('io.github.ooo518106-rgb.ahsebha');
if (args.smoke) {
  // اختبار التشغيل: ملف بيانات مؤقت بدل بيانات المستخدم، وبدون تسريع الرسوميات
  app.setPath('userData', args.smokeUserData || fs.mkdtempSync(path.join(os.tmpdir(), 'ahsebha-smoke-')));
  app.disableHardwareAcceleration();
}

const openExternal = (url) => { if (policy.isExternal(url)) shell.openExternal(url).catch(() => {}); };

function buildMenu() {
  const isMac = process.platform === 'darwin';
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(isMac ? [{ role: 'appMenu' }] : []),
    { label: 'تحرير', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: 'عرض', submenu: [{ role: 'reload' }, { role: 'forceReload' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
    { role: 'windowMenu' },
  ]));
}

// الصلاحيات: الكاميرا للباركود وصور الإيصالات فقط، وأي شيء آخر مرفوض
function lockPermissions(ses) {
  ses.setPermissionRequestHandler((wc, permission, callback, details) => callback(policy.isApp(details.requestingUrl || wc.getURL()) && permissionAllowed(permission, details)));
  ses.setPermissionCheckHandler((wc, permission, origin, details) => policy.isOrigin(origin) && permissionAllowed(permission, details || {}));
}

// العمل بدون إنترنت من أول تشغيل: الشبكة أولاً دائماً، وعند تعذّرها نقدّم آخر نسخة محفوظة ثم النسخة المرفقة (offline-site.js)
function setupOfflineSite(ses) {
  if (new URL(START_URL).protocol !== 'https:') return; // اختبارات محلية على http تبقى كما هي
  const bundleDir = app.isPackaged ? path.join(process.resourcesPath, 'ahsebha') : path.join(__dirname, '..', 'ahsebha');
  offlineSite = createOfflineSite({ policy, startUrl: START_URL, bundleDir, storeDir: path.join(app.getPath('userData'), 'offline-site') });
  ses.protocol.handle('https', (request) => offlineSite.respond(request, (r, init) => net.fetch(r, { ...init, bypassCustomProtocolHandlers: true })));
}

// ─── حماية كل نافذة: الرئيسية وما يفتحه البرنامج ───
let pendingOpen = false; // فتح ملف PDF مرفق: يُنزَّل مؤقتاً ثم يُفتح ببرنامج الجهاز
function harden(contents) {
  contents.setWindowOpenHandler(({ url }) => {
    // صفحة من البرنامج (مثل رابط مستند مكرر): نافذة جديدة للبرنامج كأنها تبويب جديد
    if (policy.isApp(url)) return { action: 'allow', overrideBrowserWindowOptions: { width: 1100, height: 760, autoHideMenuBar: true, webPreferences: SAFE_PREFS } };
    // ملف أنشأه البرنامج (مرفق PDF): لا نافذة جديدة، بل يُحفظ مؤقتاً ويُفتح ببرنامج الجهاز
    if (policy.isAppBlob(url)) { pendingOpen = true; contents.downloadURL(url); return { action: 'deny' }; }
    // غير ذلك (واتساب، مواقع): متصفح الجهاز
    openExternal(url);
    return { action: 'deny' };
  });
  const guardNav = (e, url) => { if (!policy.isApp(url)) { e.preventDefault(); openExternal(url); } };
  contents.on('will-navigate', guardNav);
  contents.on('will-redirect', guardNav);
  contents.on('will-attach-webview', (e) => e.preventDefault());
}
app.on('web-contents-created', (e, contents) => harden(contents));

const openDir = () => path.join(app.getPath('temp'), 'ahsebha-open');
let smokePdf = null;
function setupDownloads(ses) {
  // ملفات مؤقتة قديمة (أكثر من أسبوع)
  try { for (const f of fs.readdirSync(openDir())) { const p = path.join(openDir(), f); if (Date.now() - fs.statSync(p).mtimeMs > 7 * 864e5) fs.unlinkSync(p); } } catch (e) { /* لا مجلد بعد */ }
  ses.on('will-download', (event, item) => {
    if (!pendingOpen) return; // تنزيل عادي (نسخة احتياطية مثلاً): نافذة حفظ النظام
    pendingOpen = false;
    if (item.getMimeType() !== 'application/pdf') { item.cancel(); return; }
    fs.mkdirSync(openDir(), { recursive: true });
    const file = path.join(openDir(), `file-${Date.now()}.pdf`);
    item.setSavePath(file);
    item.once('done', (e2, state) => {
      if (state !== 'completed') return;
      if (args.smoke) { smokePdf = { size: fs.statSync(file).size, head: fs.readFileSync(file).subarray(0, 5).toString() }; return; }
      shell.openPath(file).catch(() => {});
    });
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 820, minWidth: 420, minHeight: 560,
    show: false, backgroundColor: '#f8fafc', autoHideMenuBar: true, title: 'احسبها',
    webPreferences: SAFE_PREFS,
  });
  win.once('ready-to-show', () => win.show());

  // لا اتصال عند أول تشغيل: صفحة شرح مع زر إعادة المحاولة
  win.webContents.on('did-fail-load', (e, code, desc, url, isMainFrame) => {
    if (!isMainFrame || code === -3 || url.startsWith('file:')) return;
    if (args.smoke && !args.smokeOffline) { finishSmoke({ ok: false, error: `load failed: ${desc} (${code}) ${url}` }); return; }
    win.loadFile(path.join(__dirname, 'offline.html'), { query: { u: START_URL } }).catch(() => {});
  });
  win.webContents.on('render-process-gone', () => { if (!args.smoke && win) win.reload(); });

  win.on('closed', () => { win = null; });
  win.loadURL(START_URL).catch(() => {});
  // اختبار التشغيل يبدأ عند تحميل الصفحة المقصودة فقط (لا صفحة خطأ المتصفح)
  if (args.smoke) {
    win.webContents.on('did-finish-load', () => {
      const u = win.webContents.getURL();
      if (smokeStarted || !(args.smokeOffline ? u.startsWith('file:') : policy.isApp(u))) return;
      smokeStarted = true;
      if (args.smokeOffline) runOfflineSmoke(); else runSmoke();
    });
  }
}

// ─── اختبار التشغيل (للبناء الآلي فقط): يتأكد أن البرنامج يفتح فعلاً داخل النافذة ويعمل ───
const PROBE = `(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 120 && !document.querySelector('[data-demo], #side nav a'); i++) await wait(250);
  const out = { url: location.href, title: document.title, ui: !!document.querySelector('[data-demo], #side nav a'),
    secure: window.isSecureContext, subtle: !!(window.crypto && crypto.subtle), speech: 'speechSynthesis' in window, print: typeof window.print === 'function', ua: navigator.userAgent };
  out.idb = await new Promise((res) => {
    try {
      const r = indexedDB.open('smoke-test', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onerror = () => res(false);
      r.onsuccess = () => {
        const db = r.result; const tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').put('ok', 'k');
        tx.oncomplete = () => { const g = db.transaction('kv').objectStore('kv').get('k'); g.onsuccess = () => { db.close(); indexedDB.deleteDatabase('smoke-test'); res(g.result === 'ok'); }; g.onerror = () => res(false); };
        tx.onerror = () => res(false);
      };
    } catch (e) { res(false); }
  });
  // حفظ البرنامج للعمل بدون إنترنت: عامل الخدمة جاهز وملفاته محفوظة
  out.sw = await (async () => {
    try {
      if (!('serviceWorker' in navigator)) return -2;
      // التسجيل يبدأ مع تحميل الصفحة. إن لم يظهر خلال 8 ثوانٍ فلا عامل خدمة (مثل أول تشغيل بلا إنترنت)
      let reg = null;
      for (let i = 0; i < 32 && !(reg = await navigator.serviceWorker.getRegistration()); i++) await wait(250);
      if (!reg) return -3;
      await Promise.race([navigator.serviceWorker.ready, wait(20000)]);
      for (let i = 0; i < 80; i++) { let n = 0; for (const k of await caches.keys()) n += (await (await caches.open(k)).keys()).length; if (n >= 20) return n; await wait(250); }
      return 0;
    } catch (e) { return -1; }
  })();
  out.ecdsa = await (async () => {
    try {
      const k = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
      const d = new TextEncoder().encode('x');
      const s = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, k.privateKey, d);
      return await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, k.publicKey, s, d);
    } catch (e) { return false; }
  })();
  return out;
})()`;
// فتح مرفق PDF كما يفعل زر «فتح الملف»: نافذة جديدة لرابط blob
const PDF_PROBE = `(() => { const u = URL.createObjectURL(new Blob([new TextEncoder().encode('%PDF-1.4\\n%%EOF')], { type: 'application/pdf' })); window.open(u, '_blank', 'noopener'); return true; })()`;

let smokeDone = false;
let smokeStarted = false;
function finishSmoke(result) {
  if (smokeDone) return;
  smokeDone = true;
  const text = JSON.stringify(result, null, 2);
  try { if (args.smokeOut) fs.writeFileSync(args.smokeOut, text); } catch (e) { /* يظهر بالمخرجات */ }
  console.log('SMOKE_RESULT ' + text);
  app.exit(result.ok ? 0 : 1);
}
async function runSmoke() {
  try {
    const r = await win.webContents.executeJavaScript(PROBE, true);
    await win.webContents.executeJavaScript(PDF_PROBE, true);
    for (let i = 0; i < 40 && !smokePdf; i++) await new Promise((res) => setTimeout(res, 250));
    r.pdf = smokePdf;
    r.offlineSite = offlineSite ? offlineSite.snapshot() : null; // من أين جاءت ملفات البرنامج: الشبكة أم النسخة المحفوظة أم المرفقة
    // على نسخة محلية (اختبار كود هذا التعديل نفسه) نشترط أن يكون البرنامج محفوظاً للعمل بدون إنترنت
    const local = new URL(START_URL).hostname === '127.0.0.1';
    r.ok = !!(r.ui && r.secure && r.subtle && r.idb && r.ecdsa && /احسبها/.test(r.title) && policy.isApp(r.url) && smokePdf && smokePdf.head === '%PDF-' && (!local || r.sw >= 20));
    finishSmoke(r);
  } catch (e) { finishSmoke({ ok: false, error: String(e && e.message || e) }); }
}
// بلا اتصال: يجب أن تظهر صفحة الشرح وزرها يعيد لنفس عنوان البرنامج
async function runOfflineSmoke() {
  try {
    const r = await win.webContents.executeJavaScript(`({ url: location.href, title: document.title, retry: (document.getElementById('retry') || {}).href || '' })`, true);
    r.ok = !!(r.url.startsWith('file:') && /لا يوجد اتصال/.test(r.title) && r.retry === START_URL);
    finishSmoke(r);
  } catch (e) { finishSmoke({ ok: false, error: String(e && e.message || e) }); }
}

if (args.smoke ? true : app.requestSingleInstanceLock()) {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(() => {
    lockPermissions(session.defaultSession);
    setupDownloads(session.defaultSession);
    setupOfflineSite(session.defaultSession);
    // اختبار «بدون إنترنت»: لا شبكة أبداً، فيجب أن يظهر البرنامج من النسخة المحفوظة
    if (args.smokeNoNetwork) session.defaultSession.enableNetworkEmulation({ offline: true });
    buildMenu();
    createWindow();
    if (args.smoke) setTimeout(() => finishSmoke({ ok: false, error: 'timeout' }), 90000);
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
} else {
  app.quit();
}
