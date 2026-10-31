// ═══ التخزين: كل البيانات على جهاز المستخدم (IndexedDB، وبديله localStorage) ═══
import { SCHEMA, defaultAccounts, defaultSettings, buildBooks, validateDoc, isLockedDate, docAmount, currencyInfo, ymd, addDays, addMonths, monthStart, monthEnd, daysBetween, isDate } from './core.js';
import { BRAND } from './brand.js';
import { docGate, docCreated, demoError } from './license.js';
import { pack, unpack } from './pack.js';

const APP_ID = 'ahsebha-accounting';
const IDB_NAME = 'ahsebha-accounting';
const IDB_STORE = 'kv';

// ─── الشركات: لكل شركة مفاتيحها في نفس قاعدة الجهاز ───
// الشركة الأولى (main) بمفاتيحها القديمة كما هي فلا يلزم أي ترحيل، والبقية بلاحقة @المعرّف. الشركة الفعّالة تُقرأ مرة واحدة عند فتح
// الصفحة (لكل نافذة شركتها)، والتبديل بين الشركات يعيد تحميل الصفحة فلا تختلط بيانات شركتين في الذاكرة.
const COMPANY_KEY = 'ahsebha-company';
const COMPANY_RE = /^[a-z0-9]{3,24}$/;
function readCompany() {
  try {
    const pick = globalThis.__KENZ_COMPANY__
      || (typeof sessionStorage !== 'undefined' && sessionStorage.getItem(COMPANY_KEY))
      || (typeof localStorage !== 'undefined' && localStorage.getItem(COMPANY_KEY))
      || 'main';
    const id = COMPANY_RE.test(pick) ? pick : 'main';
    if (typeof sessionStorage !== 'undefined') sessionStorage.setItem(COMPANY_KEY, id);
    return id;
  } catch (e) { return 'main'; }
}
export const companyId = readCompany();
const SFX = companyId === 'main' ? '' : '@' + companyId;
const KEY = { db: 'db' + SFX, ver: 'ver' + SFX, conflict: 'db-conflict' + SFX, snaps: 'snaps' + SFX };
const snapKey = (id) => 'snap:' + id + SFX; // معرّف النسخة اليومية يتكرر بين الشركات (d:التاريخ) فتُميَّز بلاحقة الشركة
const LS_KEY = 'ahsebha-accounting' + SFX;
const LS_VER = LS_KEY + ':ver';

let db = null;
let rev = 0;
let cache = { rev: -1, day: '', books: null };
let timer = null;
let backend = 'idb';
let failed = false;

// الحفظ الآمن بين النوافذ: لكل نسخة محفوظة رقم إصدار. كل نافذة تتذكر رقم ما بُنيت عليه (baseVer) وتحتفظ بعملياتها التي لم تُحفظ (pending).
// عند الحفظ: إن كان الرقم المخزّن هو نفسه نكتب ما عندنا مباشرة؛ وإن سبقتنا نافذة أخرى نبني على أحدث نسخة مخزّنة ونعيد عليها عملياتنا
// (فتبقى فواتير الاثنتين وتتسلسل الأرقام)، كل ذلك داخل معاملة واحدة فلا تتداخل الكتابات.
let baseVer = 0;
let pending = [];
let inflight = null;
let force = false;
let inflightForce = false;
let queue = Promise.resolve();
let lsLeft = false;
const listeners = new Set();
const tabId = newId();
const channel = typeof window !== 'undefined' && typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(APP_ID + SFX) : null;

export function newId() {
  const a = new Uint8Array(6);
  crypto.getRandomValues(a);
  return Date.now().toString(36) + Array.from(a, (b) => (b % 36).toString(36)).join('');
}
const now = () => new Date().toISOString();
const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
// المعرّفات تدخل في الروابط، فنقبل فقط الحروف اللاتينية والأرقام و _ : -
const okId = (x) => typeof x.id === 'string' && /^[\w:-]{1,80}$/.test(x.id);
const arr = (x) => (Array.isArray(x) ? x.filter((y) => isObj(y) && okId(y)) : []);

export const getDb = () => db;
export function getBooks() {
  const day = ymd(new Date());
  if (cache.rev !== rev || cache.day !== day) cache = { rev, day, books: buildBooks(db, { today: day }) };
  return cache.books;
}
export const onExternalChange = (fn) => listeners.add(fn);

// فهارس المعرّف ← العنصر للمستندات والعملاء والمنتجات والحسابات، تُبنى عند أول بحث بعد كل تغيير.
// البحث الخطي كان يُستدعى داخل حلقات (قوائم العملاء والتحصيل والحركات) فيبطئ مع آلاف المستندات. المعرّف المكرر: الأول يغلب كما في find.
const indexes = {};
function lookup(key, id) {
  if (!db) return null;
  const list = db[key];
  let c = indexes[key];
  if (!c || c.rev !== rev || c.list !== list || c.n !== list.length) {
    const map = new Map();
    for (const x of list) if (!map.has(x.id)) map.set(x.id, x);
    c = indexes[key] = { rev, list, n: list.length, map };
  }
  return c.map.get(id) || null;
}

// ─── IndexedDB ───
let idbPromise = null;
function idb() {
  if (!idbPromise) {
    idbPromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') return reject(new Error('indexedDB unavailable'));
      const r = indexedDB.open(IDB_NAME, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(IDB_STORE);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.onblocked = () => reject(new Error('blocked'));
    });
  }
  return idbPromise;
}
async function idbGetMany(keys) {
  const d = await idb();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(IDB_STORE, 'readonly');
    const s = tx.objectStore(IDB_STORE);
    const reqs = keys.map((k) => s.get(k));
    tx.oncomplete = () => resolve(reqs.map((r) => r.result));
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
async function idbOp(mode, fn) {
  const d = await idb();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(IDB_STORE, mode);
    const req = fn(tx.objectStore(IDB_STORE));
    tx.oncomplete = () => resolve(req && req.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function load() {
  let data = null;
  let idbVer = 0;
  try {
    const [d, v] = await idbGetMany([KEY.db, KEY.ver]);
    data = d; idbVer = Number(v) || 0; backend = 'idb';
  } catch (e) { backend = 'ls'; }
  // نسخة localStorage تُفضَّل إن كانت أحدث (تُكتب فقط حين تفشل كتابة IndexedDB)
  lsLeft = false;
  let lsVer = 0;
  try {
    const t = localStorage.getItem(LS_KEY);
    if (t) {
      const ls = JSON.parse(t);
      lsLeft = true;
      lsVer = Number(localStorage.getItem(LS_VER)) || 0;
      if (!data || String(ls.updatedAt || '') > String(data.updatedAt || '')) data = ls;
    }
  } catch (e) { /* لا شيء محفوظ */ }
  db = data ? normalize(data) : null;
  baseVer = backend === 'idb' ? idbVer : lsVer; // إصدار المخزن الذي سنكتب إليه، لا إصدار مصدر القراءة
  pending = [];
  force = false;
  rev++;
  if (db) noteCompany().catch(() => {});
  return db;
}

// الإصدار المخزّن الآن (للتحقق من وصول تغيير من نافذة أخرى)
async function storedVersion() {
  if (backend === 'idb') {
    try { const [v] = await idbGetMany([KEY.ver]); return Number(v) || 0; } catch (e) { return baseVer; }
  }
  try { return Number(localStorage.getItem(LS_VER)) || 0; } catch (e) { return baseVer; }
}

// يقرّر ما يُكتب: الإصدار المخزّن هو ما بنينا عليه ← نكتب نسخة الذاكرة، وإلا نبني على المخزّن ونعيد عليه عملياتنا.
// latest: النسخة المخزّنة (تُمرَّر فقط حين يختلف الإصدار)، put(obj, ver, conflict): الكتابة الفعلية في نفس المعاملة.
function commit(stored, latest, put) {
  inflight = pending;
  inflightForce = force;
  pending = [];
  let merged = false;
  let conflict = null;
  if (!force && stored !== baseVer) {
    if (!latest) {
      // البيانات حُذفت من نافذة أخرى: لا نعيدها، وتُسقط عملياتنا
      inflight = [];
      db = null;
      merged = true;
      rev++;
      return { ver: stored, merged, gone: true };
    }
    const prev = db;
    try {
      db = normalize(latest);
      for (const fn of inflight) fn(db);
      db.updatedAt = now();
      merged = true;
    } catch (e) {
      db = prev; // تعذّر الدمج: نكتب نسختنا ونحتفظ بالمخزّنة في خانة التعارض
      conflict = latest;
      console.error('store merge failed', e);
    }
    rev++;
  }
  force = false;
  put(db, stored + 1, conflict);
  return { ver: stored + 1, merged };
}

function casIdb() {
  return idb().then((d) => new Promise((resolve, reject) => {
    const tx = d.transaction(IDB_STORE, 'readwrite');
    const s = tx.objectStore(IDB_STORE);
    let result = null;
    const fail = (e) => { if (inflight) { pending = inflight.concat(pending); inflight = null; if (inflightForce) force = true; } reject(e || tx.error || new Error('write failed')); };
    tx.oncomplete = () => { inflight = null; baseVer = result.ver; resolve(result); };
    tx.onerror = () => fail(tx.error);
    tx.onabort = () => fail(tx.error);
    const put = (obj, ver, conflict) => { s.put(obj, KEY.db); s.put(ver, KEY.ver); if (conflict) s.put(conflict, KEY.conflict); };
    const attempt = (stored, latest) => { try { result = commit(stored, latest, put); } catch (e) { try { tx.abort(); } catch (_) { /* انتهت */ } fail(e); } };
    const rv = s.get(KEY.ver);
    rv.onsuccess = () => {
      const stored = Number(rv.result) || 0;
      if (force || stored === baseVer) return attempt(stored, null);
      const rd = s.get(KEY.db);
      rd.onsuccess = () => attempt(stored, rd.result || null);
    };
  }));
}

function casLocal() {
  const stored = Number(localStorage.getItem(LS_VER)) || 0;
  let latest = null;
  if (!force && stored !== baseVer) { const t = localStorage.getItem(LS_KEY); latest = t ? JSON.parse(t) : null; }
  try {
    const r = commit(stored, latest, (obj, ver) => { localStorage.setItem(LS_KEY, JSON.stringify(obj)); localStorage.setItem(LS_VER, String(ver)); });
    inflight = null;
    baseVer = r.ver;
    return r;
  } catch (e) { pending = (inflight || []).concat(pending); inflight = null; if (inflightForce) force = true; throw e; }
}

async function doWrite() {
  if (!db && !force) return;
  if (!pending.length && !force) return;
  try {
    const r = backend === 'idb' ? await casIdb() : casLocal();
    failed = false;
    if (backend === 'idb' && lsLeft) { try { localStorage.removeItem(LS_KEY); localStorage.removeItem(LS_VER); } catch (e) { /* اختياري */ } lsLeft = false; }
    if (channel) channel.postMessage({ type: 'saved', from: tabId });
    if (r.merged) listeners.forEach((fn) => fn());
    if (db) dailySnapshot();
  } catch (e) {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(db));
      localStorage.setItem(LS_VER, String(baseVer));
      backend = 'ls';
      failed = false;
    } catch (e2) {
      failed = true;
      if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('acc:save-failed'));
    }
  }
}
function write() {
  timer = null;
  const p = queue.then(doWrite, doWrite);
  queue = p.catch(() => {});
  return p;
}
const canPersist = () => typeof window !== 'undefined' || globalThis.__KENZ_PERSIST__ === true; // الاختبارات في Node: بلا حفظ إلا إن طُلب
function schedule() {
  if (!canPersist()) return;
  clearTimeout(timer);
  timer = setTimeout(write, 200);
}
export function flush() {
  if (timer) { clearTimeout(timer); return write(); }
  return queue.then(() => {}, () => {});
}
export const saveFailed = () => failed;

// وصل تغيير من نافذة أخرى: نحفظ ما عندنا أولاً (يُدمج بأمان)، ثم نقرأ الجديد إن تغيّر الإصدار
export async function syncExternal() {
  if (timer) await flush();
  else await queue.then(() => {}, () => {});
  if ((await storedVersion()) !== baseVer) { await load(); listeners.forEach((fn) => fn()); }
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => { flush(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
}
if (channel) {
  channel.onmessage = (e) => {
    if (!e.data || e.data.from === tabId) return;
    syncExternal();
  };
}

function requestPersist() {
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) { /* اختياري */ }
}

// ─── ضبط شكل البيانات (للنسخ القديمة والملفات المستوردة) ───
export function normalize(d) {
  const out = {
    app: APP_ID,
    schema: SCHEMA,
    createdAt: d.createdAt || now(),
    updatedAt: d.updatedAt || now(),
    settings: defaultSettings(isObj(d.settings) ? d.settings : {}),
    accounts: arr(d.accounts).length ? arr(d.accounts) : defaultAccounts(isObj(d.settings) ? d.settings.country : undefined),
    parties: arr(d.parties),
    products: arr(d.products),
    docs: arr(d.docs).filter((x) => typeof x.type === 'string'),
    seq: isObj(d.seq) ? { ...d.seq } : {},
    users: arr(d.users).filter((u) => typeof u.name === 'string' && isObj(u.pin)),
    recovery: isObj(d.recovery) ? d.recovery : null,
    assets: arr(d.assets).filter((a) => typeof a.name === 'string'),
    employees: arr(d.employees).filter((x) => typeof x.name === 'string'),
    warehouses: arr(d.warehouses).filter((x) => typeof x.name === 'string'),
    priceLists: arr(d.priceLists).filter((x) => typeof x.name === 'string' && typeof x.id === 'string'),
    centers: arr(d.centers).filter((x) => typeof x.name === 'string'),
    recons: arr(d.recons).filter((x) => typeof x.account === 'string'),
    recurring: arr(d.recurring).filter((r) => isObj(r.src) && typeof r.src.type === 'string'),
    audit: arr(d.audit).slice(-AUDIT_MAX),
  };
  // ملفات قديمة أو مستوردة: ما تجاوز أحدث 1500 عملية يفقد نسخة «قبل التعديل» (تبقى للمحذوفات)
  out.audit.forEach((x, i) => { if (i < out.audit.length - AUDIT_KEEP_BEFORE && x.act === 'update') delete x.before; });
  if (d.demo) out.demo = true;
  const byId = new Map(out.accounts.map((a) => [a.id, a]));
  // حسابات النظام الجديدة تُضاف للدليل القديم، والموجود منها يصير أساسياً لا يُحذف
  for (const a of defaultAccounts(out.settings.country)) {
    if (!a.sys) continue;
    if (!byId.has(a.id)) out.accounts.push(a);
    else byId.get(a.id).sys = true;
  }
  for (const x of out.docs) {
    const n = Number(x.no) || 0;
    if ((out.seq[x.type] || 1) <= n) out.seq[x.type] = n + 1;
    if (x.files != null) x.files = cleanFiles(x.files);
  }
  if (out.settings.logo && !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(out.settings.logo)) out.settings.logo = '';
  return out;
}

// وصف المرفقات على المستند: معرّف آمن واسم ونوع وحجم فقط
export const cleanFiles = (xs) => (Array.isArray(xs) ? xs : [])
  .filter((f) => isObj(f) && typeof f.id === 'string' && /^[\w-]{1,40}$/.test(f.id))
  .map((f) => ({ id: f.id, name: String(f.name || 'مرفق').slice(0, 120), type: /^[\w.+-]+\/[\w.+-]+$/.test(f.type || '') ? f.type : 'application/octet-stream', size: Number(f.size) || 0 }))
  .slice(0, 30);

// كل تعديل يُطبَّق الآن ويُحفظ كعملية (دالة على نسخة البيانات d فقط) لتُعاد على أحدث نسخة إن سبقتنا نافذة أخرى
function mutate(fn) {
  fn(db);
  pending.push(fn);
  db.updatedAt = now();
  rev++;
  schedule();
}

// ─── الشركة ───
// الاستبدال الكامل (شركة جديدة، استعادة، استيراد، بيانات تجريبية) يكتب فوق المخزّن، وتُحفظ قبله نسخة من الحالة السابقة للتراجع
function replaceWith(next) {
  const old = db;
  if (old && !old.demo && (old.docs.length || old.parties.length || old.products.length)) putSnapshot('before-replace', old).catch(() => {});
  db = next;
  pending = [];
  force = true;
  rev++;
  schedule();
  requestPersist();
  noteCompany().catch(() => {});
  return db;
}
export function createCompany(settings, extra = {}) {
  return replaceWith(normalize({ settings: defaultSettings(settings), accounts: defaultAccounts(settings.country), ...extra }));
}
export function replaceDb(data) {
  replaceWith(normalize(data));
}
export async function wipe() {
  const mine = usedFileIds(); // مرفقات هذه الشركة وحدها: ملفات الشركات الأخرى لا تُمسّ
  clearTimeout(timer);
  timer = null;
  pending = [];
  force = false;
  db = null;
  rev++;
  await queue.then(() => {}, () => {});
  // حذف البيانات والنسخ التلقائية، ورفع الإصدار ليعرف غيرنا أن البيانات حُذفت فلا يعيدها
  try {
    const d = await idb();
    await new Promise((resolve, reject) => {
      const tx = d.transaction(IDB_STORE, 'readwrite');
      const st = tx.objectStore(IDB_STORE);
      const rv = st.get(KEY.ver);
      const rs = st.get(KEY.snaps);
      rv.onsuccess = () => { const v = (Number(rv.result) || 0) + 1; baseVer = v; st.put(v, KEY.ver); };
      rs.onsuccess = () => { for (const m of rs.result || []) st.delete(snapKey(m.id)); st.delete(KEY.snaps); st.delete(KEY.db); st.delete(KEY.conflict); };
      tx.oncomplete = resolve;
      tx.onerror = tx.onabort = () => reject(tx.error);
    });
  } catch (e) { /* قد لا يكون موجوداً */ }
  try { await deleteFiles([...mine]); } catch (e) { /* لا مرفقات */ }
  try { localStorage.removeItem(LS_KEY); localStorage.removeItem(LS_VER); } catch (e) { /* قد لا يكون موجوداً */ }
  lastSnapDay = '';
  if (channel) channel.postMessage({ type: 'saved', from: tabId });
}
export function saveSettings(patch) { mutate((d) => Object.assign(d.settings, patch)); if ('name' in patch) noteCompany().catch(() => {}); }
// قفل الفترات يُسجَّل في سجل التعديلات (من قفل ومن فتح)
export function setLockDate(date) {
  mutate((d) => {
    const before = d.settings.lockDate || '';
    d.settings.lockDate = date || '';
    d.audit.push({ id: newId(), at: now(), by: actor, act: 'lock', type: 'settings', doc: '', no: 0, date: date || '', amount: 0, from: before });
    trimAudit(d);
  });
}

// ─── سجل التعديلات: من أضاف أو عدّل أو حذف، ومتى، ونسخة المستند قبل التغيير ───
// آخر 10 آلاف عملية تُحفظ بتفاصيلها الأساسية (من وماذا ومتى وكم)، ونسخة المستند الكاملة قبل التعديل لآخر 1500 فقط توفيراً للمساحة.
// نسخ المحذوفات تبقى دائماً (قليلة، وهي ما يُحتاج لاسترجاعه).
export const AUDIT_MAX = 10000;
export const AUDIT_KEEP_BEFORE = 1500;
function trimAudit(d) {
  const a = d.audit;
  if (a.length > AUDIT_MAX) a.splice(0, a.length - AUDIT_MAX);
  const old = a[a.length - 1 - AUDIT_KEEP_BEFORE]; // العملية التي خرجت للتو من أحدث 1500
  if (old && old.act === 'update') delete old.before;
}
function audit(d, act, doc, before) {
  const dec = currencyInfo(d.settings.currency).dec;
  d.audit.push({ id: newId(), at: now(), by: actor, act, type: doc.type, doc: doc.id, no: doc.no, date: doc.date, amount: docAmount(doc, dec), ...(before ? { before } : {}) });
  trimAudit(d);
}
const snapshot = (x) => JSON.parse(JSON.stringify(x));

// الفترة المقفلة: الحماية الأخيرة بعد التحقق في الشاشات
function assertOpen(doc) {
  if (doc && isLockedDate(db.settings, doc.date)) throw new Error(`الفترة مقفلة حتى ${db.settings.lockDate}. لا يمكن إضافة أو تعديل أو حذف مستند بتاريخ ${doc.date}`);
}
export const isLockedDoc = (doc) => !!(db && doc && isLockedDate(db.settings, doc.date));

// ─── المستندات ───
const pad2 = (n) => String(n).padStart(2, '0');
const timeNow = () => { const d = new Date(); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`; };

// المستخدم الحالي يُسجَّل على المستندات (من أنشأها ومن عدّلها)
let actor = null;
export const setActor = (id) => { actor = id || null; };

export function saveDoc(doc) {
  const old = doc.id ? db.docs.find((x) => x.id === doc.id) : null;
  assertOpen(old);
  assertOpen(doc);
  // نسخة العرض: الحماية الأخيرة لحد الفواتير (التعديل على فاتورة موجودة لا يُحسب)
  if (!old) { const g = docGate(doc.type); if (g) throw demoError(g); }
  let creating = null; // تُعاد هذه العملية على أحدث نسخة إن سبقتنا نافذة أخرى: التعديل لا يُنشئ مستنداً حذفته نافذة أخرى
  mutate((d) => {
    const i = doc.id ? d.docs.findIndex((x) => x.id === doc.id) : -1;
    if (creating === null) creating = i < 0;
    if (i >= 0) {
      doc.updatedAt = now();
      if (actor) doc.editedBy = actor;
      audit(d, 'update', doc, snapshot(d.docs[i]));
      d.docs[i] = doc;
      return;
    }
    if (!creating) return;
    // مستند متكرر في موعده أُنشئ من نافذة أخرى: لا يتكرر
    if (doc.recurring && d.docs.some((x) => x.recurring === doc.recurring && x.date === doc.date && x.id !== doc.id)) return;
    doc.id = doc.id || newId();
    doc.createdAt = now();
    if (actor) doc.by = actor;
    doc.no = d.seq[doc.type] || 1;
    d.seq[doc.type] = doc.no + 1;
    if (!doc.time) doc.time = timeNow();
    d.docs.push(doc);
    audit(d, 'create', doc);
  });
  if (!old) docCreated(doc.type);
  return doc;
}

// الفاتورة الصادرة ومرتجعها لا يُحذفان (تُلغى بإشعار دائن) ما لم يسمح المالك من الإعدادات
const KEPT_TYPES = ['sale', 'sreturn'];
export const canDeleteDoc = (doc) => !!doc && (!KEPT_TYPES.includes(doc.type) || !!(db && db.settings.allowDeleteInvoices));

export function deleteDoc(id) {
  const gone = db.docs.find((x) => x.id === id);
  assertOpen(gone);
  if (gone && !canDeleteDoc(gone)) throw new Error('الفاتورة الصادرة لا تُحذف. ألغها بإشعار دائن من صفحتها (أو فعّل «السماح بحذف الفواتير» من الإعدادات)');
  if (gone && gone.files && gone.files.length) deleteFiles(gone.files.map((f) => f.id)).catch(() => {});
  mutate((d) => {
    const doc = d.docs.find((x) => x.id === id);
    if (doc) audit(d, 'delete', doc, snapshot(doc));
    d.docs = d.docs.filter((x) => x.id !== id);
    // رقم المستند المحذوف لا يُعاد استعماله: يبقى فراغاً في التسلسل ظاهراً في سجل التعديلات
    for (const x of d.docs) {
      if (x.refId === id) x.refId = null;
      if (x.link === id) x.link = null;
      if (x.convertedTo === id) x.convertedTo = null;
      if (x.fromQuote === id) x.fromQuote = null;
    }
  });
}

export function patchDoc(id, patch, { log = false } = {}) {
  mutate((d) => {
    const x = d.docs.find((y) => y.id === id);
    if (!x) return;
    const before = log ? snapshot(x) : null;
    Object.assign(x, patch);
    if (log) audit(d, 'update', x, before);
  });
}

export const findDoc = (id) => lookup('docs', id);

// ─── العملاء والموردون ───
export const findParty = (id) => lookup('parties', id);
export function saveParty(p) {
  mutate((d) => {
    const i = p.id ? d.parties.findIndex((x) => x.id === p.id) : -1;
    if (i >= 0) d.parties[i] = { ...d.parties[i], ...p };
    else { p.id = p.id || newId(); p.createdAt = now(); d.parties.push(p); }
  });
  return p;
}
export const partyUsage = (id) => db.docs.filter((x) => x.party === id || (x.lines || []).some((l) => l.party === id)).length;
export function deleteParty(id) {
  if (partyUsage(id)) throw new Error('لا يمكن الحذف: توجد مستندات مسجلة لهذا الطرف');
  mutate((d) => { d.parties = d.parties.filter((x) => x.id !== id); });
}

// ─── المنتجات ───
export const findProduct = (id) => lookup('products', id);
export function saveProduct(p) {
  mutate((d) => {
    const i = p.id ? d.products.findIndex((x) => x.id === p.id) : -1;
    if (i >= 0) d.products[i] = { ...d.products[i], ...p };
    else { p.id = p.id || newId(); p.createdAt = now(); d.products.push(p); }
  });
  return p;
}
export const productUsage = (id) => db.docs.filter((x) => (x.lines || []).some((l) => l.product === id)).length;
export function deleteProduct(id) {
  if (productUsage(id)) throw new Error('لا يمكن الحذف: المنتج مستخدم في مستندات. يمكنك إيقافه بدلاً من ذلك');
  mutate((d) => { d.products = d.products.filter((x) => x.id !== id); });
}

// ─── الحسابات ───
export const findAccount = (id) => lookup('accounts', id);
export function saveAccount(a) {
  mutate((d) => {
    const i = a.id ? d.accounts.findIndex((x) => x.id === a.id) : -1;
    if (i >= 0) d.accounts[i] = { ...d.accounts[i], ...a };
    else { a.id = a.id || 'a' + newId(); d.accounts.push(a); }
  });
  return a;
}
export function accountUsage(id) {
  const used = (x) => x.account === id || x.payAcc === id || x.money === id || x.from === id || x.to === id
    || (x.lines || []).some((l) => l.account === id) || (x.payments || []).some((p) => p.acc === id);
  return db.docs.filter(used).length;
}
export function deleteAccount(id) {
  const a = findAccount(id);
  if (!a) return;
  if (a.sys) throw new Error('هذا حساب أساسي في البرنامج ولا يمكن حذفه');
  if (db.accounts.some((x) => x.parent === id)) throw new Error('احذف الحسابات الفرعية أولاً');
  if (accountUsage(id)) throw new Error('لا يمكن الحذف: الحساب مستخدم في مستندات');
  if (db.assets.some((x) => x.account === id || (x.disposed && x.disposed.money === id))) throw new Error('لا يمكن الحذف: الحساب مستخدم في سجل الأصول');
  mutate((d) => { d.accounts = d.accounts.filter((x) => x.id !== id); });
}

// ─── الاستيراد: إضافة وتحديث دفعة واحدة ───
// items: [{ id?, ...الحقول }]؛ بوجود id يُحدَّث السجل، وإلا يُضاف جديداً
export function importRecords(kind, items) {
  const key = kind === 'products' ? 'products' : 'parties';
  let added = 0, updated = 0;
  mutate((d) => {
    const index = new Map(d[key].map((x, i) => [x.id, i]));
    for (const it of items) {
      if (it.id && index.has(it.id)) { const i = index.get(it.id); d[key][i] = { ...d[key][i], ...it }; updated++; }
      else { const x = { ...it, id: newId(), createdAt: now() }; index.set(x.id, d[key].push(x) - 1); added++; }
    }
  });
  return { added, updated };
}

// ─── الأصول الثابتة ───
export const findAsset = (id) => (db ? db.assets.find((x) => x.id === id) : null);
export function saveAsset(a) {
  mutate((d) => {
    const i = a.id ? d.assets.findIndex((x) => x.id === a.id) : -1;
    if (i >= 0) d.assets[i] = { ...d.assets[i], ...a };
    else { a.id = a.id || 'as' + newId(); a.createdAt = now(); a.no = d.assets.reduce((m, x) => Math.max(m, x.no || 0), 0) + 1; d.assets.push(a); }
  });
  return a;
}
export function deleteAsset(id) { mutate((d) => { d.assets = d.assets.filter((x) => x.id !== id); }); }

// ─── المستندات المتكررة ───
// r: { name, src (قالب المستند), freq: week|month|quarter|year, next, until, day, dueDays, active, count, last }
export function nextRun(date, freq, day) {
  if (freq === 'week') return addDays(date, 7);
  const months = freq === 'quarter' ? 3 : freq === 'year' ? 12 : 1;
  const m = addMonths(monthStart(date), months);
  const last = Number(monthEnd(m).slice(8));
  return m.slice(0, 8) + String(Math.min(Number(day) || Number(date.slice(8)), last)).padStart(2, '0');
}
const DROP = ['id', 'no', 'createdAt', 'updatedAt', 'time', 'by', 'editedBy', 'convertedTo', 'fromQuote', 'refId', 'link', 'tendered', 'change', 'pos', 'recurring', 'cleared', 'bounced', 'files', 'scan'];
export function templateOf(doc) {
  const t = snapshot(doc);
  for (const k of DROP) delete t[k];
  return t;
}
export const findRecurring = (id) => (db ? db.recurring.find((x) => x.id === id) : null);
export function saveRecurring(r) {
  mutate((d) => {
    const i = r.id ? d.recurring.findIndex((x) => x.id === r.id) : -1;
    if (i >= 0) d.recurring[i] = { ...d.recurring[i], ...r };
    else { r.id = 'rc' + newId(); r.createdAt = now(); r.count = 0; d.recurring.push(r); }
  });
  return r;
}
export function deleteRecurring(id) { mutate((d) => { d.recurring = d.recurring.filter((x) => x.id !== id); }); }
// تعديل في مكانه (نفس الكائن) حتى تبقى الحلقة تقرأ القيم الجديدة؛ وعند إعادة العملية على نسخة أحدث نعدّل سجلها بالمعرّف
function patchRecurring(r, patch) {
  Object.assign(r, patch);
  mutate((d) => { const x = d.recurring.find((y) => y.id === r.id); if (x && x !== r) Object.assign(x, patch); });
}

// ينشئ المستندات المستحقة حتى اليوم (عند فتح البرنامج)؛ يتوقف القالب عند أول خطأ ويُظهره
export function runRecurring(today = ymd(new Date()), { only } = {}) {
  const out = { created: [], errors: [] };
  if (!db) return out;
  for (const r of db.recurring) {
    if (r.active === false || (only && r.id !== only)) continue;
    let n = 0;
    while (isDate(r.next) && r.next <= today && (!r.until || r.next <= r.until) && n++ < 60) {
      const doc = { ...snapshot(r.src), date: r.next, recurring: r.id };
      if (r.dueDays != null && r.dueDays !== '') doc.dueDate = addDays(r.next, Number(r.dueDays));
      if (doc.validUntil) doc.validUntil = addDays(r.next, 15);
      const errs = validateDoc(db, doc);
      const msg = Object.values(errs)[0];
      if (msg) { patchRecurring(r, { error: msg }); out.errors.push({ r, msg }); break; }
      try { saveDoc(doc); } catch (e) {
        // نسخة العرض وصلت حدها: لا يُنشأ المستند ويبقى موعده محفوظاً حتى يُفعَّل الاشتراك (بدون وسم القالب بخطأ دائم)
        if (e.code !== 'DEMO_LIMIT') throw e;
        out.errors.push({ r, msg: e.message });
        break;
      }
      out.created.push(doc);
      patchRecurring(r, { count: (r.count || 0) + 1, last: r.next, next: nextRun(r.next, r.freq, r.day), error: '' });
    }
    if (r.until && isDate(r.next) && r.next > r.until && r.active !== false) patchRecurring(r, { active: false });
  }
  return out;
}
export const recurringDue = (today = ymd(new Date())) => (db ? db.recurring.filter((r) => r.active !== false && isDate(r.next) && r.next <= today).length : 0);
export const daysUntil = (date) => daysBetween(ymd(new Date()), date);

// ─── الموظفون ───
export const findEmployee = (id) => (db ? db.employees.find((x) => x.id === id) : null);
export function saveEmployee(e) {
  mutate((d) => {
    const i = e.id ? d.employees.findIndex((x) => x.id === e.id) : -1;
    if (i >= 0) d.employees[i] = { ...d.employees[i], ...e };
    else { e.id = 'em' + newId(); e.createdAt = now(); e.no = d.employees.reduce((m, x) => Math.max(m, x.no || 0), 0) + 1; d.employees.push(e); }
  });
  return e;
}
export const employeeUsage = (id) => db.docs.filter((x) => x.employee === id || (x.type === 'payroll' && (x.lines || []).some((l) => l.employee === id))).length;
export function deleteEmployee(id) {
  if (employeeUsage(id)) throw new Error('لا يمكن الحذف: للموظف مسيرات أو سلف مسجلة. يمكنك إيقافه بدلاً من ذلك');
  mutate((d) => { d.employees = d.employees.filter((x) => x.id !== id); });
}

// ─── المستودعات والفروع (مراكز التكلفة) ───
// kind: warehouses | centers
export function saveListItem(kind, item) {
  mutate((d) => {
    const i = item.id ? d[kind].findIndex((x) => x.id === item.id) : -1;
    if (i >= 0) d[kind][i] = { ...d[kind][i], ...item };
    else { item.id = (kind === 'warehouses' ? 'wh' : 'cc') + newId(); d[kind].push(item); }
  });
  return item;
}
export function listItemUsage(kind, id) {
  if (kind === 'warehouses') return db.docs.filter((x) => x.wh === id || x.from === id || x.to === id).length;
  return db.docs.filter((x) => x.cc === id || (x.lines || []).some((l) => l.cc === id)).length + db.employees.filter((x) => x.cc === id).length + db.assets.filter((x) => x.cc === id).length;
}
export function deleteListItem(kind, id) {
  if (listItemUsage(kind, id)) throw new Error('لا يمكن الحذف: مستخدم في مستندات. يمكنك إعادة تسميته');
  mutate((d) => { d[kind] = d[kind].filter((x) => x.id !== id); });
}

// ─── قوائم الأسعار (لكل عميل قائمة، ولكل منتج سعر خاص بها اختيارياً في product.listPrices) ───
export const findPriceList = (id) => (db && id ? db.priceLists.find((x) => x.id === id) || null : null);
export function savePriceList(l) {
  mutate((d) => {
    const i = l.id ? d.priceLists.findIndex((x) => x.id === l.id) : -1;
    if (i >= 0) d.priceLists[i] = { ...d.priceLists[i], ...l };
    else { l.id = 'pl' + newId(); d.priceLists.push(l); }
  });
  return l;
}
export const priceListUsage = (id) => db.parties.filter((p) => p.priceList === id).length;
// الحذف يفك ارتباط العملاء ويمسح أسعار المنتجات الخاصة بالقائمة، والفواتير القديمة تبقى بأسعارها
export function deletePriceList(id) {
  mutate((d) => {
    d.priceLists = d.priceLists.filter((x) => x.id !== id);
    for (const p of d.parties) if (p.priceList === id) p.priceList = '';
    for (const p of d.products) if (p.listPrices && id in p.listPrices) { const rest = { ...p.listPrices }; delete rest[id]; p.listPrices = rest; }
  });
}

// ─── مطابقة البنك ───
export const findRecon = (id) => (db ? db.recons.find((x) => x.id === id) : null);
export function saveRecon(r) {
  mutate((d) => {
    const i = r.id ? d.recons.findIndex((x) => x.id === r.id) : -1;
    if (i >= 0) d.recons[i] = { ...d.recons[i], ...r };
    else { r.id = 'rn' + newId(); r.createdAt = now(); r.by = actor; d.recons.push(r); }
  });
  return r;
}
export function deleteRecon(id) { mutate((d) => { d.recons = d.recons.filter((x) => x.id !== id); }); }

// ─── المستخدمون ───
export const findUser = (id) => (db && id ? db.users.find((x) => x.id === id) : null);
export function saveUser(u) {
  mutate((d) => {
    const i = u.id ? d.users.findIndex((x) => x.id === u.id) : -1;
    if (i >= 0) d.users[i] = { ...d.users[i], ...u };
    else { u.id = u.id || 'u' + newId(); u.createdAt = now(); d.users.push(u); }
  });
  return u;
}
export function deleteUser(id) { mutate((d) => { d.users = d.users.filter((x) => x.id !== id); }); }
export function setRecovery(secret) { mutate((d) => { d.recovery = secret; }); }
export function clearUsers() { mutate((d) => { d.users = []; d.recovery = null; }); }

// ─── نسخ تلقائية على هذا الجهاز ───
// نسخة يومية لآخر 7 أيام (تُؤخذ عند أول فتح أو حفظ في اليوم)، ونسخة «قبل آخر استبدال» لأي استعادة أو استيراد أو بيانات تجريبية.
// تُحفظ مضغوطة داخل نفس قاعدة المتصفح، فتحميك من الأخطاء لا من ضياع الجهاز؛ والنسخة الاحتياطية خارج الجهاز تبقى هي الأساس.
// قيد الفهرس 'snaps': [{ id, label, at, docs, bytes, name }]؛ والسجل نفسه تحت المفتاح snap:<id>.
const SNAP_DAYS = 7;
let snapBusy = false;
let lastSnapDay = '';
async function snapIndex() {
  try { const [i] = await idbGetMany([KEY.snaps]); return Array.isArray(i) ? i : []; } catch (e) { return []; }
}
export async function listSnapshots() {
  return (await snapIndex()).slice().sort((a, b) => String(b.at).localeCompare(String(a.at)));
}
async function putSnapshot(id, data) {
  const rec = await pack(data);
  const meta = { id, label: id.startsWith('d:') ? 'daily' : id, at: now(), docs: data.docs.length, bytes: rec.bytes, name: (data.settings && data.settings.name) || '' };
  const d = await idb();
  await new Promise((resolve, reject) => {
    const tx = d.transaction(IDB_STORE, 'readwrite');
    const st = tx.objectStore(IDB_STORE);
    const ri = st.get(KEY.snaps);
    ri.onsuccess = () => {
      let index = (Array.isArray(ri.result) ? ri.result : []).filter((m) => m.id !== id);
      index.push(meta);
      const daily = index.filter((m) => m.id.startsWith('d:')).sort((a, b) => b.id.localeCompare(a.id));
      for (const m of daily.slice(SNAP_DAYS)) { st.delete(snapKey(m.id)); index = index.filter((x) => x.id !== m.id); }
      st.put(rec, snapKey(id));
      st.put(index, KEY.snaps);
    };
    tx.oncomplete = resolve;
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
  return meta;
}
// نسخة اليوم: تُؤخذ وقت الفراغ ولا تتكرر في اليوم نفسه
export function dailySnapshot() {
  if (!db || db.demo || backend !== 'idb' || snapBusy || typeof indexedDB === 'undefined') return;
  const day = ymd(new Date());
  if (lastSnapDay === day) return;
  lastSnapDay = day;
  snapBusy = true;
  const run = async () => {
    try {
      if (db && !(await snapIndex()).some((m) => m.id === 'd:' + day)) await putSnapshot('d:' + day, db);
    } catch (e) { lastSnapDay = ''; } finally { snapBusy = false; }
  };
  if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 8000 }); else setTimeout(run, 1500);
}
// يأخذ نسخة الآن (للاختبار ولزر «احفظ نسخة تلقائية الآن» إن أُضيف)
export async function snapshotNow(id = 'd:' + ymd(new Date())) {
  if (!db) throw new Error('لا توجد بيانات');
  return putSnapshot(id, db);
}
export const snapshotsSupported = () => backend === 'idb' && typeof indexedDB !== 'undefined';
export async function readSnapshot(id) {
  const [rec] = await idbGetMany([snapKey(id)]);
  return rec ? unpack(rec) : null;
}
// يستعيد نسخة تلقائية مكان البيانات الحالية (والحالة الحالية تُحفظ تحت «قبل آخر استبدال» فيمكن التراجع)
export async function restoreSnapshot(id) {
  const data = await readSnapshot(id);
  if (!data) throw new Error('هذه النسخة غير موجودة');
  replaceDb(data);
  await flush();
  return db;
}
export async function deleteSnapshot(id) {
  const d = await idb();
  await new Promise((resolve, reject) => {
    const tx = d.transaction(IDB_STORE, 'readwrite');
    const st = tx.objectStore(IDB_STORE);
    const ri = st.get(KEY.snaps);
    ri.onsuccess = () => { st.delete(snapKey(id)); st.put((Array.isArray(ri.result) ? ri.result : []).filter((m) => m.id !== id), KEY.snaps); };
    tx.oncomplete = resolve;
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
}

// ─── قائمة الشركات على هذا الجهاز ───
// السجل (مفتاح companies) يحفظ معرّف كل شركة واسمها لعرضها في المبدّل دون فتح بياناتها. تسجّل الشركة الفعّالة نفسها عند فتحها وعند تغيير اسمها.
const REG_KEY = 'companies';
const LS_REG = 'ahsebha-companies';
const dbKeyOf = (id) => (id === 'main' ? 'db' : 'db@' + id);
const cleanReg = (r) => (Array.isArray(r) ? r.filter((c) => isObj(c) && typeof c.id === 'string' && COMPANY_RE.test(c.id)) : []);
async function readRegistry() {
  if (backend === 'idb') {
    try { const [r] = await idbGetMany([REG_KEY]); return cleanReg(r); } catch (e) { /* نجرّب البديل */ }
  }
  try { return cleanReg(JSON.parse(localStorage.getItem(LS_REG) || '[]')); } catch (e) { return []; }
}
// تعديل السجل داخل معاملة واحدة (قراءة ثم كتابة)، فلا تضيع إضافة نافذة بسبب نافذة أخرى
async function updateRegistry(fn) {
  if (backend === 'idb') {
    const d = await idb();
    await new Promise((resolve, reject) => {
      const tx = d.transaction(IDB_STORE, 'readwrite');
      const st = tx.objectStore(IDB_STORE);
      const r = st.get(REG_KEY);
      r.onsuccess = () => st.put(fn(cleanReg(r.result).map((c) => ({ ...c }))), REG_KEY);
      tx.oncomplete = resolve;
      tx.onerror = tx.onabort = () => reject(tx.error);
    });
    return;
  }
  const reg = await readRegistry();
  localStorage.setItem(LS_REG, JSON.stringify(fn(reg.map((c) => ({ ...c })))));
}
const nameOf = () => String((db && db.settings && db.settings.name) || '').trim();
export async function noteCompany() {
  if (!db || !canPersist()) return;
  const name = nameOf();
  const cur = (await readRegistry()).find((c) => c.id === companyId);
  if (cur && cur.name === name) return;
  await updateRegistry((r) => {
    const i = r.findIndex((c) => c.id === companyId);
    if (i >= 0) r[i] = { ...r[i], name }; else r.push({ id: companyId, name, createdAt: now() });
    return r;
  });
}
// الشركات المحفوظة على الجهاز، والفعّالة منها مُعلَّمة (وتُدرج حتى لو لم تُسجَّل بعد)
export async function listCompanies() {
  const reg = await readRegistry();
  const out = reg.map((c) => ({ id: c.id, name: c.id === companyId && db ? nameOf() : String(c.name || ''), active: c.id === companyId }));
  if (!out.some((c) => c.active)) out.unshift({ id: companyId, name: nameOf(), active: true });
  return out;
}
// شركة جديدة فارغة (تُنشأ بياناتها حين يكمل المستخدم شاشة البدء بعد التبديل إليها)؛ ترجّع معرّفها
export async function addCompany() {
  await flush();
  const id = newId();
  await updateRegistry((r) => {
    if (!r.some((c) => c.id === companyId)) r.unshift({ id: companyId, name: nameOf(), createdAt: now() });
    r.push({ id, name: '', createdAt: now() });
    return r;
  });
  return id;
}
// التبديل يعيد تحميل الصفحة على الشركة الجديدة: نحفظ ما عندنا أولاً (flush) ثم نُعيد الفتح من الرئيسية
export function switchCompany(id) {
  if (!COMPANY_RE.test(id)) throw new Error('شركة غير معروفة');
  try { sessionStorage.setItem(COMPANY_KEY, id); localStorage.setItem(COMPANY_KEY, id); } catch (e) { /* يبقى للجلسة */ }
  if (typeof location !== 'undefined') location.assign(location.pathname + location.search);
}
// حذف شركة غير فعّالة: بياناتها ونسخها التلقائية ومرفقاتها فقط، وبقية الشركات لا تُمسّ
export async function deleteCompany(id) {
  if (id === companyId) throw new Error('بدّل إلى شركة أخرى أولاً ثم احذف هذه');
  if (!COMPANY_RE.test(id)) throw new Error('شركة غير معروفة');
  const sfx = id === 'main' ? '' : '@' + id;
  if (backend === 'idb') {
    const [data, snaps] = await idbGetMany([dbKeyOf(id), 'snaps' + sfx]);
    const files = (data && Array.isArray(data.docs) ? data.docs : []).flatMap((d) => (d.files || []).map((f) => f.id));
    const d = await idb();
    await new Promise((resolve, reject) => {
      const tx = d.transaction(IDB_STORE, 'readwrite');
      const st = tx.objectStore(IDB_STORE);
      for (const m of Array.isArray(snaps) ? snaps : []) st.delete('snap:' + m.id + sfx);
      for (const k of [dbKeyOf(id), 'ver' + sfx, 'db-conflict' + sfx, 'snaps' + sfx]) st.delete(k);
      for (const f of files) st.delete('file:' + f);
      tx.oncomplete = resolve;
      tx.onerror = tx.onabort = () => reject(tx.error);
    });
  }
  try { localStorage.removeItem('ahsebha-accounting' + sfx); localStorage.removeItem('ahsebha-accounting' + sfx + ':ver'); } catch (e) { /* لا شيء */ }
  await updateRegistry((r) => r.filter((c) => c.id !== id));
}

// ─── المرفقات: صور الإيصالات والفواتير وملفات PDF ───
// تُحفظ في IndexedDB بجانب البيانات (المفتاح file:<id>) والمستند يحمل وصفها فقط: files: [{ id, name, type, size }]
export const filesSupported = () => typeof indexedDB !== 'undefined' && backend === 'idb';
export async function putFile(meta, blob) {
  const rec = { ...meta, data: await blob.arrayBuffer() };
  await idbOp('readwrite', (s) => s.put(rec, 'file:' + meta.id));
  return meta;
}
export async function getFile(id) {
  const rec = await idbOp('readonly', (s) => s.get('file:' + id));
  return rec ? new Blob([rec.data], { type: rec.type || 'application/octet-stream' }) : null;
}
export async function deleteFiles(ids) {
  if (!ids.length || typeof indexedDB === 'undefined') return;
  await idbOp('readwrite', (s) => { ids.forEach((id) => s.delete('file:' + id)); });
}
export async function fileIds() {
  if (typeof indexedDB === 'undefined') return [];
  const keys = await idbOp('readonly', (s) => s.getAllKeys());
  return (keys || []).filter((k) => typeof k === 'string' && k.startsWith('file:')).map((k) => k.slice(5));
}
// مرفقات كل الشركات على الجهاز: ملف لا تشير إليه هذه الشركة قد تشير إليه شركة أخرى فلا يُحذف
async function allUsedFileIds() {
  const used = usedFileIds();
  const others = (await readRegistry()).map((c) => c.id).filter((id) => id !== companyId);
  if (!others.length) return used;
  const dbs = await idbGetMany(others.map(dbKeyOf));
  for (const x of dbs) for (const d of (x && Array.isArray(x.docs) ? x.docs : [])) for (const f of d.files || []) used.add(f.id);
  return used;
}
export const usedFileIds = () => new Set((db ? db.docs : []).flatMap((d) => (d.files || []).map((f) => f.id)));
// يحذف الملفات التي لا يشير إليها أي مستند (نموذج أُلغي، أو مرفق أُزيل) بعد يوم من رفعها
export async function gcFiles() {
  if (!db || !filesSupported()) return 0;
  let used;
  try { used = await allUsedFileIds(); } catch (e) { return 0; } // تعذّرت قراءة شركة أخرى: الأمان أهم من التنظيف
  const old = Date.now() - 864e5;
  const orphans = (await fileIds()).filter((id) => !used.has(id) && !(parseInt(id.slice(0, 8), 36) > old));
  await deleteFiles(orphans);
  return orphans.length;
}

// الملفات المشتركة من تطبيق آخر (مشاركة صورة إيصال إلى البرنامج): يضعها عامل الخدمة هنا
export async function takeShared() {
  if (typeof indexedDB === 'undefined') return [];
  const rec = await idbOp('readonly', (s) => s.get('shared'));
  if (!rec) return [];
  await idbOp('readwrite', (s) => s.delete('shared'));
  return (rec.files || []).map((f) => new File([f.data], f.name || 'receipt.jpg', { type: f.type || 'image/jpeg' }));
}

// ─── النسخ الاحتياطي ───
export function backupJSON() {
  saveSettings({ lastBackupAt: now() });
  return JSON.stringify({ ...db, exportedAt: now() });
}
export function parseBackup(text) {
  let d;
  try { d = JSON.parse(text); } catch (e) { throw new Error('الملف ليس نسخة احتياطية صالحة'); }
  if (!isObj(d) || d.app !== APP_ID || !Array.isArray(d.docs)) throw new Error(`هذا الملف ليس نسخة احتياطية من برنامج محاسبة ${BRAND.name}`);
  if ((Number(d.schema) || 1) > SCHEMA) throw new Error('النسخة من إصدار أحدث. حدّث الصفحة ثم حاول مجدداً');
  return normalize(d);
}
