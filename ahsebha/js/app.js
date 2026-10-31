// ═══ برنامج محاسبة كنز: الهيكل والتنقل ═══
import * as store from './store.js';
import { BRAND, logoImg } from './brand.js';
import { icon, iconFor, watchIcons } from './icons.js';
import { watchA11y } from './a11y.js';
import { html, raw, setSettings, toast, confirmBox } from './ui.js';
import { SEG, parseHash, guard, setTitle, go } from './nav.js';
import * as auth from './auth.js';
import * as home from './views/home.js';
import * as docs from './views/docs.js';
import * as money from './views/money.js';
import * as ledger from './views/ledger.js';
import * as products from './views/products.js';
import * as parties from './views/parties.js';
import * as reports from './views/reports.js';
import * as settings from './views/settings.js';
import * as pos from './views/pos.js';
import * as importer from './views/importer.js';
import * as collections from './views/collections.js';
import * as users from './views/users.js';
import * as assets from './views/assets.js';
import * as cheques from './views/cheques.js';
import * as recurring from './views/recurring.js';
import * as auditView from './views/audit.js';
import * as payroll from './views/payroll.js';
import * as stockViews from './views/stock.js';
import * as reconcile from './views/reconcile.js';
import * as todayView from './views/today.js';
import * as subscription from './views/subscription.js';
import * as gate from './views/gate.js';
import { openCompanies } from './views/companies.js';
import { openPalette } from './views/palette.js';
import * as license from './license.js';
import { CONFIG } from './plans.js';
import { isInstalled, installHelp } from './views/install.js';

// ─── المسارات ───
const routes = [];
const on = (pattern, fn) => routes.push({ parts: pattern.split('/').filter(Boolean), fn });

on('', home.dashboard);
on('welcome', home.welcome);
const MODULE = { sale: docs, quote: docs, sreturn: docs, purchase: docs, preturn: docs, sorder: docs, porder: docs, expense: money, receipt: money, payment: money, transfer: money, journal: ledger, adjust: products, payroll, stransfer: stockViews };
for (const [type, seg] of Object.entries(SEG)) {
  const m = MODULE[type];
  on(seg, (c) => m.list(type, c));
  on(seg + '/new', (c) => m.form(type, c));
  on(seg + '/:id/edit', (c) => m.form(type, c));
  on(seg + '/:id', (c) => m.show(type, c));
}
for (const [seg, kind] of [['customers', 'customer'], ['suppliers', 'supplier']]) {
  on(seg, (c) => parties.list(kind, c));
  on(seg + '/new', (c) => parties.form(kind, c));
  on(seg + '/:id/edit', (c) => parties.form(kind, c));
  on(seg + '/:id', (c) => parties.show(kind, c));
}
on('products', products.productList);
on('products/new', products.productForm);
on('products/:id/edit', products.productForm);
on('products/:id', products.productShow);
on('accounts', ledger.accounts);
on('accounts/:id', ledger.accountShow);
on('daybook', ledger.daybook);
on('reports', reports.index);
on('reports/:name', reports.report);
on('settings', settings.view);
on('pos', pos.pos);
on('pos/closing', pos.closing);
on('labels', products.labels);
on('import', importer.view);
on('collections', collections.view);
on('users', users.view);
on('assets', assets.list);
on('assets/new', assets.form);
on('assets/:id/edit', assets.form);
on('assets/:id', assets.show);
on('cheques', cheques.view);
on('recurring', recurring.view);
on('audit', auditView.view);
on('employees', payroll.employees);
on('employees/new', payroll.employeeForm);
on('employees/:id/edit', payroll.employeeForm);
on('employees/:id', payroll.employeeShow);
on('reconcile', reconcile.view);
on('today', todayView.view);
on('subscription', subscription.view);
on('activate', subscription.activate);

function match(path) {
  const parts = path.split('/').filter(Boolean);
  for (const r of routes) {
    if (r.parts.length !== parts.length) continue;
    const params = {};
    if (r.parts.every((p, i) => (p.startsWith(':') ? (params[p.slice(1)] = parts[i], true) : p === parts[i]))) return { fn: r.fn, params };
  }
  return null;
}

// ─── القائمة الجانبية ───
const NAV = [
  { ic: '🏠', t: 'الرئيسية', h: '' },
  { ic: '🖥️', t: 'الكاشير (نقطة البيع)', h: 'pos' },
  { ic: '🗣️', t: 'ملخص اليوم', h: 'today' },
  { sec: 'المبيعات' },
  { ic: '🧾', t: 'فواتير المبيعات', h: 'sales' },
  { ic: '📝', t: 'عروض الأسعار', h: 'quotes' },
  { ic: '📋', t: 'أوامر البيع', h: 'sales-orders' },
  { ic: '↩️', t: 'مرتجعات المبيعات', h: 'sales-returns' },
  { ic: '👥', t: 'العملاء', h: 'customers' },
  { ic: '📞', t: 'التحصيل والتذكير', h: 'collections' },
  { sec: 'المشتريات والمصروفات' },
  { ic: '🛒', t: 'فواتير المشتريات', h: 'purchases' },
  { ic: '📋', t: 'أوامر الشراء', h: 'purchase-orders' },
  { ic: '↪️', t: 'مرتجعات المشتريات', h: 'purchase-returns' },
  { ic: '🏭', t: 'الموردون', h: 'suppliers' },
  { ic: '💸', t: 'المصروفات', h: 'expenses' },
  { sec: 'النقدية' },
  { ic: '📥', t: 'سندات القبض', h: 'receipts' },
  { ic: '📤', t: 'سندات الصرف', h: 'payments' },
  { ic: '🔁', t: 'التحويلات', h: 'transfers' },
  { ic: '🧾', t: 'الشيكات', h: 'cheques' },
  { ic: '🏦', t: 'مطابقة البنك', h: 'reconcile' },
  { sec: 'المخزون' },
  { ic: '📦', t: 'المنتجات والخدمات', h: 'products' },
  { ic: '🏷️', t: 'ملصقات الباركود', h: 'labels' },
  { ic: '⚖️', t: 'تسويات المخزون', h: 'adjustments' },
  { ic: '🚚', t: 'التحويلات المخزنية', h: 'stock-transfers', need: 'wh' },
  { sec: 'الموظفون والرواتب' },
  { ic: '👷', t: 'الموظفون', h: 'employees' },
  { ic: '💼', t: 'مسيرات الرواتب', h: 'payroll' },
  { sec: 'المحاسبة والتقارير' },
  { ic: '📒', t: 'قيود اليومية', h: 'journal' },
  { ic: '🗂️', t: 'دليل الحسابات', h: 'accounts' },
  { ic: '🏢', t: 'الأصول الثابتة', h: 'assets' },
  { ic: '♻️', t: 'المستندات المتكررة', h: 'recurring' },
  { ic: '📊', t: 'التقارير', h: 'reports' },
  { ic: '🕘', t: 'سجل التعديلات', h: 'audit' },
  { sec: 'الإدارة' },
  { ic: '📥', t: 'الاستيراد من Excel', h: 'import' },
  { ic: '👤', t: 'المستخدمون', h: 'users' },
  { ic: '💳', t: 'اشتراكي', h: 'subscription', need: 'sub' },
  { ic: '⚙️', t: 'الإعدادات', h: 'settings' },
];

// عناصر القائمة المسموحة للمستخدم الحالي، بدون عناوين أقسام فارغة
function navItems() {
  const db = store.getDb();
  const xs = NAV.filter((n) => n.sec || (auth.can(auth.routePerm(n.h)) && (n.need !== 'wh' || (db && db.warehouses.length)) && (n.need !== 'sub' || license.enforcing() || !!license.demo()) && (CONFIG.showLockedInNav || !license.lockedFeature(n.h))));
  return xs.filter((n, i) => !n.sec || (xs[i + 1] && !xs[i + 1].sec));
}

// تثبيت البرنامج كتطبيق (أندرويد والكمبيوتر): المتصفح يعطينا حدثاً نستخدمه عند الضغط على الزر
let installEvt = null;
let justInstalled = false;
// تثبيت من المتصفح بضغطة (Chrome وEdge) إن أتاحه المتصفح
async function promptInstall() {
  if (!installEvt) return;
  const evt = installEvt;
  evt.prompt();
  await evt.userChoice.catch(() => null);
  installEvt = null;
  renderShell();
}
// زر التثبيت: نافذة تعرض تطبيق اللابتوب أولاً، والتثبيت من المتصفح بديلاً
const doInstall = () => installHelp({ canPrompt: !!installEvt, onPrompt: promptInstall });
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; if (store.getDb()) renderShell(); });
  window.addEventListener('appinstalled', () => { installEvt = null; justInstalled = true; renderShell(); toast('تم تثبيت البرنامج ✓ تلاقيه بين تطبيقاتك'); });
  window.addEventListener('acc:install', doInstall);
}

export function renderShell() {
  const db = store.getDb();
  setSettings(db && db.settings);
  const side = document.getElementById('side');
  const brand = html`<a class="side-brand" href="#/"><span class="brand-badge">${raw(logoImg(40))}</span><span>${BRAND.name}<span class="brand-sub">${BRAND.tagline}</span></span></a>`;
  const foot = html`<div class="side-foot">${isInstalled() || justInstalled ? '' : html`<button type="button" class="btn btn-ghost btn-sm side-install" data-install>💻 ثبّت البرنامج على اللابتوب</button>`}<p class="muted small" style="padding:0 12px">🔒 بياناتك محفوظة على هذا الجهاز فقط. نزّل نسخة احتياطية من <a href="#/settings">الإعدادات</a> بشكل دوري. <a href="privacy.html">سياسة الخصوصية</a>${CONFIG.published ? html` · <a href="plans.html" target="_blank" rel="noopener">الباقات</a>` : ''}</p></div>`;
  side.innerHTML = String(db
    ? html`${brand}<button type="button" class="side-co" data-companies title="الشركات" aria-label="الشركة الحالية: ${db.settings.name || 'منشأتي'}. افتح قائمة الشركات">🏢 <span class="co-n">${db.settings.name || 'منشأتي'}</span><span class="co-more" aria-hidden="true">▾</span></button>
      <nav>${navItems().map((n) => (n.sec ? html`<div class="nav-sec">${n.sec}</div>` : html`<a class="nav-a${license.lockedFeature(n.h) ? ' locked' : ''}" data-h="${n.h}" href="#/${n.h}"><span class="ic">${n.ic}</span>${n.t}${license.lockedFeature(n.h) ? html`<span class="lk" title="ضمن الاشتراك" aria-label="ضمن الاشتراك">🔒</span>` : ''}</a>`))}</nav>${foot}`
    : html`${brand}<button type="button" class="side-co" data-companies aria-label="قائمة الشركات">🏢 <span class="co-n">الشركات</span><span class="co-more" aria-hidden="true">▾</span></button><nav><a class="nav-a on" href="#/welcome"><span class="ic">👋</span>ابدأ هنا</a></nav>${foot}`);
  const quick = document.getElementById('quick');
  quick.querySelectorAll('.quick-menu a').forEach((a) => {
    const f = a.dataset.feature || license.featureOfPath(a.getAttribute('href'));
    a.hidden = !auth.can(auth.routePerm(a.getAttribute('href'))) || !!(f && !license.has(f));
  });
  quick.hidden = !db || !quick.querySelector('.quick-menu a:not([hidden])');
  document.getElementById('search-btn').hidden = !db;
  renderTabbar();
  renderDemoBar();
  const u = auth.currentUser();
  const lockBtn = document.getElementById('lock-btn');
  lockBtn.hidden = !auth.usersEnabled();
  lockBtn.innerHTML = String(html`🔒<span class="hide-sm">${u ? ' ' + u.name : ''}</span>`);
  markNav();
}

// شريط نسخة العرض أعلى الصفحات (يختفي إن لم تكن هذه النسخة نسخة عرض أو لم تُنشأ المنشأة بعد)
function renderDemoBar() {
  const bar = document.getElementById('demo-bar');
  if (!store.getDb()) { if (bar) bar.hidden = true; return; }
  subscription.demoBar(bar);
}

function markNav() {
  const first = parseHash().path.split('/')[0];
  const seg = first === 'daybook' ? 'journal' : first;
  document.querySelectorAll('.nav-a[data-h], .tab[data-h]').forEach((a) => {
    const on = a.dataset.h === seg;
    a.classList.toggle('on', on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
}

// ─── الشريط السفلي للجوال: الأهم بضغطة، وزر «+» لإنشاء أي مستند ───
const TABS = [
  { ic: 'house', t: 'الرئيسية', h: '' },
  { ic: 'receipt-text', t: 'المبيعات', h: 'sales' },
  { add: true },
  { ic: 'users', t: 'العملاء', h: 'customers' },
  { more: true, ic: 'menu', t: 'المزيد' },
];
// روابط «جديد» المسموحة للمستخدم الحالي (تُحسب صلاحياتها وقفل الاشتراك في renderShell)
const quickLinks = () => [...document.querySelectorAll('#quick .quick-menu a:not([hidden])')];
const linkIcon = (a) => { const s = a.querySelector('svg'); return (s && s.dataset.icon) || 'plus'; };

function renderTabbar() {
  const bar = document.getElementById('tabbar');
  const db = store.getDb();
  const hasNew = quickLinks().length > 0;
  // من لا يملك صلاحية الرئيسية (الكاشير مثلاً) تبدأ شريطه بالكاشير بدلها
  const list = auth.can(auth.routePerm('')) ? TABS : [{ ic: 'monitor', t: 'الكاشير', h: 'pos' }, ...TABS.slice(1)];
  const tabs = list.filter((x) => x.more || (x.add ? hasNew : auth.can(auth.routePerm(x.h)) && !license.lockedFeature(x.h)));
  bar.hidden = !db;
  bar.innerHTML = String(html`${tabs.map((x) => (x.add
    ? html`<button type="button" class="tab tab-add" data-tab="add" aria-label="جديد"><span class="tab-plus">${raw(icon('plus'))}</span></button>`
    : x.more
      ? html`<button type="button" class="tab" data-tab="more" aria-label="المزيد" aria-controls="side"><span class="tab-ic">${raw(icon(x.ic))}</span><span class="tab-t">${x.t}</span></button>`
      : html`<a class="tab" data-h="${x.h}" href="#/${x.h}"><span class="tab-ic">${raw(icon(x.ic))}</span><span class="tab-t">${x.t}</span></a>`))}`);
  markNav();
}

// ورقة «إنشاء جديد» تصعد من أسفل الشاشة بنفس روابط قائمة «جديد»
function quickSheet() {
  const links = quickLinks();
  if (!links.length) return;
  const dlg = document.createElement('dialog');
  dlg.className = 'sheet';
  dlg.setAttribute('aria-label', 'إنشاء جديد');
  dlg.innerHTML = String(html`<div class="sheet-box"><div class="sheet-grip"></div><h3>إنشاء جديد</h3><div class="sheet-grid">${links.map((a) => html`<a class="sheet-a" href="${a.getAttribute('href')}"><span class="sheet-ic">${raw(icon(linkIcon(a)))}</span><span>${a.textContent.trim()}</span></a>`)}</div></div>`);
  dlg.addEventListener('click', (e) => { if (e.target === dlg || e.target.closest('a')) dlg.close(); });
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
}

// الشريط السفلي لا يظهر مع النماذج وشاشة الكاشير حتى لا يزاحم أزرار الحفظ والدفع
const hidesTabbar = (path) => /(^|\/)(new|edit)$/.test(path) || path === 'pos' || path === 'welcome' || path === 'activate';

// ─── البحث السريع (Ctrl+K): صفحات وتقارير وإجراءات وعملاء ومنتجات ومستندات ───
function openSearch() {
  const db = store.getDb();
  if (!db || auth.isLocked() || document.querySelector('dialog[open]:not(.pal)')) return; // لا بحث فوق نافذة أخرى مفتوحة
  const pages = navItems().filter((n) => !n.sec).map((n) => ({ ic: iconFor(n.ic) || 'file-text', t: n.t, h: n.h, locked: !!license.lockedFeature(n.h) }));
  if (auth.can(auth.routePerm('reports')) && !license.lockedFeature('reports')) {
    for (const r of reports.REPORTS) if (!r.sec) pages.push({ ic: iconFor(r.icon) || 'chart-column', t: r.t, h: r.href ? r.href.replace(/^#\//, '') : 'reports/' + r.id });
  }
  const actions = quickLinks().map((a) => ({ ic: linkIcon(a), t: a.textContent.trim(), href: a.getAttribute('href'), kw: 'جديد إضافة إنشاء' }));
  openPalette({ db, pages, actions, can: auth.can, routePerm: auth.routePerm });
}
const typing = (el) => !!el && (/^(input|textarea|select)$/i.test(el.tagName) || el.isContentEditable);

const closeNav = () => document.getElementById('app').classList.remove('nav-open');

// ─── العرض ───
let skipNext = false;
let lastHash = location.hash;
let stale = false;
async function render() {
  if (skipNext) { skipNext = false; return; }
  // البرنامج مقفل: لا تُعرض أي صفحة حتى يُدخل الرمز، وتبقى الصفحة الحالية كما هي تحت القفل
  if (auth.isLocked()) { stale = true; return; }
  const { path, query } = parseHash();
  document.body.classList.toggle('no-tabbar', hidesTabbar(path));
  if (guard.dirty && location.hash !== lastHash) {
    const leave = await confirmBox('في تعديلات غير محفوظة على هذه الصفحة. تريد تركها؟', { ok: 'اترك التعديلات', danger: true, title: 'تعديلات غير محفوظة' });
    if (!leave) { skipNext = true; location.hash = lastHash; return; }
  }
  guard.dirty = false;
  lastHash = location.hash;
  document.querySelectorAll('dialog[open]:not(#lock)').forEach((dlg) => dlg.close());
  document.getElementById('quick').open = false;
  closeNav();

  const view = document.getElementById('view');
  const root = document.createElement('div');
  root.className = 'page';
  view.replaceChildren(root);
  window.scrollTo(0, 0);
  markNav();

  const db = store.getDb();
  let r = match(path);
  if (!db && path !== 'welcome' && path !== 'activate') r = { fn: home.welcome, params: {} };
  if (db && r && !auth.can(auth.routePerm(path))) {
    if (!path) { go(auth.homePath()); return; }
    setTitle('غير مسموح');
    root.innerHTML = String(html`<div class="empty"><div class="empty-ic">🔒</div><h3>لا تملك صلاحية لهذه الصفحة</h3><p>اطلب من المالك تعديل صلاحياتك من صفحة المستخدمين.</p><p><a href="${auth.homePath()}">العودة</a></p></div>`);
    return;
  }
  // نسخة العرض وصلت حدها: بدل نموذج فاتورة جديدة أو شاشة الكاشير تظهر صفحة تشرح وتعرض التفعيل
  // (قبل صفحة القفل: الكاشير والمشتريات تُقفلان أيضاً بعد انتهاء العرض، والسبب الحقيقي هو انتهاؤه)
  if (db && r && subscription.demoBlocksRoute(path)) { subscription.demoLimitPage(root); return; }
  const locked = db && r ? license.lockedFeature(path) : null;
  if (locked) { subscription.lockedPage(root, locked); return; }
  if (!r) {
    setTitle('الصفحة غير موجودة');
    root.innerHTML = String(html`<div class="empty"><div class="empty-ic">🧭</div><h3>الصفحة غير موجودة</h3><p><a href="#/">العودة للرئيسية</a></p></div>`);
    return;
  }
  try {
    await r.fn({ root, params: r.params, query, path });
  } catch (e) {
    console.error(e);
    root.innerHTML = String(html`<div class="empty"><div class="empty-ic">⚠️</div><h3>حدث خطأ غير متوقع</h3><p>${e.message || ''}</p><p><a href="#/">العودة للرئيسية</a></p></div>`);
  }
}
export const rerender = () => { lastHash = location.hash; render(); };

// ─── الوضع الداكن (القيمة الأولى تُضبط في رأس الصفحة) ───
function themeButton() {
  const btn = document.querySelector('.theme-toggle');
  if (btn) btn.textContent = document.documentElement.getAttribute('data-theme') === 'dark' ? '☀️ فاتح' : '🌙 داكن';
}
function toggleTheme() {
  const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  try { localStorage.setItem('theme', next); } catch (e) { /* يبقى للجلسة الحالية فقط */ }
  themeButton();
}

// المستندات المتكررة المستحقة تُنشأ عند فتح البرنامج
function generateRecurring() {
  if (!store.getDb()) return;
  try {
    const res = store.runRecurring();
    if (res.created.length) toast(`تم إنشاء ${res.created.length} مستند متكرر مستحق ♻️`);
    if (res.errors.length) toast(`تعذّر إنشاء مستند متكرر: ${res.errors[0].msg}`, 'warn');
  } catch (e) { console.error(e); }
}

// قبل شاشة القفل أيضاً: حتى يصل الجهاز المقفل أي تحديث لاحق للبرنامج
function registerSw() {
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) navigator.serviceWorker.register('sw.js').catch(() => {});
}

async function boot() {
  watchIcons();
  watchA11y();
  themeButton();
  document.querySelector('.theme-toggle').onclick = toggleTheme;
  document.getElementById('lock-btn').onclick = () => auth.lock();
  document.getElementById('search-btn').onclick = openSearch;
  if (/Mac|iPhone|iPad/.test(navigator.platform)) document.querySelector('.sp-k').textContent = '⌘ K';
  document.getElementById('tabbar').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]');
    if (!b) return;
    if (b.dataset.tab === 'add') quickSheet(); else document.getElementById('app').classList.toggle('nav-open');
  });
  await store.load();
  store.dailySnapshot();
  await license.init().catch(() => {});
  registerSw();
  // البرنامج مقفل بكود المالك: لا قوائم ولا بيانات تُرسم قبل أن يُقبل كود صالح
  if (!license.gateOpen()) await gate.show();
  auth.init({
    onChange: (kind) => {
      if (kind === 'lock') return;
      renderShell();
      if (kind === 'switch' || stale) { stale = false; guard.dirty = false; rerender(); }
    },
  });
  renderShell();
  generateRecurring();
  store.gcFiles().catch(() => {});
  window.addEventListener('hashchange', render);
  // تفعيل اشتراك من نافذة أخرى
  window.addEventListener('storage', (e) => { if (e.key === 'ahsebha-license' || e.key === 'ahsebha-preview' || e.key === 'ahsebha-demo-preview') license.init().then(() => { renderShell(); if (!guard.dirty) rerender(); }).catch(() => {}); else if (e.key === 'ahsebha-demo-used') renderDemoBar(); });
  // بعد كل فاتورة جديدة في نسخة العرض يتحدّث الشريط (والقائمة إن كان الاشتراك سيُقفل شيئاً)
  window.addEventListener('acc:demo', renderDemoBar);
  window.addEventListener('beforeunload', (e) => { if (guard.dirty) { e.preventDefault(); e.returnValue = ''; } });
  window.addEventListener('acc:shell', () => { auth.init(); renderShell(); });
  window.addEventListener('acc:save-failed', () => toast('تعذّر الحفظ على هذا الجهاز. صدّر نسخة احتياطية من الإعدادات فوراً', 'err'));
  store.onExternalChange(() => { auth.init(); renderShell(); if (!guard.dirty) rerender(); toast('تحدّثت البيانات من نافذة أخرى', 'warn'); });
  document.getElementById('menu-btn').onclick = () => document.getElementById('app').classList.toggle('nav-open');
  document.getElementById('side').addEventListener('click', (e) => { if (e.target.closest('[data-install]')) doInstall(); else if (e.target.closest('[data-companies]')) openCompanies(); });
  document.getElementById('scrim').onclick = closeNav;
  document.addEventListener('click', (e) => {
    const q = document.getElementById('quick');
    if (q.open && !q.contains(e.target)) q.open = false;
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeNav();
    // Ctrl/⌘+K من أي مكان، و«/» خارج حقول الكتابة (ما عدا الكاشير: الباركود يكتب أحرفاً). e.code لأن لوحة المفاتيح العربية تغيّر e.key
    if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.code === 'KeyK' || e.key.toLowerCase() === 'k')) { e.preventDefault(); openSearch(); }
    else if (!e.ctrlKey && !e.metaKey && !e.altKey && (e.code === 'Slash' || e.key === '/') && !typing(e.target) && parseHash().path !== 'pos') { e.preventDefault(); openSearch(); }
  });
  // القفل يُفحص عند الفتح، وكل ساعة وعند العودة للنافذة: نافذة تبقى مفتوحة أياماً لا تتجاوز انتهاء الكود
  const recheckGate = () => { if (!license.gateOpen() && !guard.dirty) location.reload(); };
  setInterval(recheckGate, 3600000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) recheckGate(); });
  render();
}

boot();
