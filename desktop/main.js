'use strict';
// ═══ احسبها لسطح المكتب: برنامج مثبّت بنافذته وأيقونته، لا يفتح في المتصفح ═══
// يعرض واجهة البرنامج من موقعه، فكل تحديث للبرنامج يصل لك تلقائياً بدون إعادة تثبيت،
// ويعمل بدون إنترنت بعد أول تشغيل (يحفظ نفسه على الجهاز). بياناتك المحاسبية تبقى على جهازك.
const { app, BrowserWindow, Menu, session, shell } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { makePolicy, permissionAllowed, parseArgs } = require('./policy');

const START_URL = process.env.AHSEBHA_URL || 'https://ooo518106-rgb.github.io/ahsebha/';
const policy = makePolicy(START_URL);
const args = parseArgs(process.argv);
let win = null;

app.setAppUserModelId('io.github.ooo518106-rgb.ahsebha');
if (args.smoke) {
  // اختبار التشغيل: ملف بيانات مؤقت بدل بيانات المستخدم، وبدون تسريع الرسوميات
  app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'ahsebha-smoke-')));
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

function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 820, minWidth: 420, minHeight: 560,
    show: false, backgroundColor: '#f8fafc', autoHideMenuBar: true, title: 'احسبها',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, spellcheck: false },
  });
  win.once('ready-to-show', () => win.show());

  // الروابط الخارجية (واتساب، المواقع) تُفتح في متصفح الجهاز، ولا تحلّ مكان البرنامج
  win.webContents.setWindowOpenHandler(({ url }) => { openExternal(url); return { action: 'deny' }; });
  const guardNav = (e, url) => { if (!policy.isApp(url)) { e.preventDefault(); openExternal(url); } };
  win.webContents.on('will-navigate', guardNav);
  win.webContents.on('will-redirect', guardNav);
  win.webContents.on('will-attach-webview', (e) => e.preventDefault());

  // لا اتصال عند أول تشغيل: صفحة شرح مع زر إعادة المحاولة
  win.webContents.on('did-fail-load', (e, code, desc, url, isMainFrame) => {
    if (!isMainFrame || code === -3) return;
    if (args.smoke) { finishSmoke({ ok: false, error: `load failed: ${desc} (${code}) ${url}` }); return; }
    win.loadFile(path.join(__dirname, 'offline.html'), { query: { u: START_URL } }).catch(() => {});
  });
  win.webContents.on('render-process-gone', () => { if (!args.smoke && win) win.reload(); });

  win.on('closed', () => { win = null; });
  win.loadURL(START_URL).catch(() => {});
  if (args.smoke) win.webContents.once('did-finish-load', runSmoke);
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

let smokeDone = false;
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
    r.ok = !!(r.ui && r.secure && r.subtle && r.idb && r.ecdsa && /احسبها/.test(r.title) && policy.isApp(r.url));
    finishSmoke(r);
  } catch (e) { finishSmoke({ ok: false, error: String(e && e.message || e) }); }
}

if (args.smoke ? true : app.requestSingleInstanceLock()) {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(() => {
    lockPermissions(session.defaultSession);
    buildMenu();
    createWindow();
    if (args.smoke) setTimeout(() => finishSmoke({ ok: false, error: 'timeout' }), 90000);
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
} else {
  app.quit();
}
