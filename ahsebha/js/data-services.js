import * as store from './store.js';
import { ymd } from './core.js';
import { zipBytes, unzipEntries, entryText, entryBytes } from './xlsx.js';
import { createBackupWriter, encryptWithWriter, decryptBackup } from './backup-crypto.js';

const CONFIG_DB = 'kenz-data-services';
let token = ''; // للجلسة فقط؛ لا يدخل في قاعدة المنشأة أو نسخها
let timer, running = false, suspended = false, dirty = false;
export const serviceStatus = { folder: '', cloud: '' };
const key = (kind) => store.companyId + ':' + kind;
async function configOp(mode, fn) {
  const db = await new Promise((resolve, reject) => {
    const r = indexedDB.open(CONFIG_DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore('config');
    r.onerror = () => reject(r.error);
    r.onsuccess = () => resolve(r.result);
  });
  try { return await new Promise((resolve, reject) => {
    const tx = db.transaction('config', mode); const req = fn(tx.objectStore('config'));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = tx.onabort = () => reject(tx.error);
  }); } finally { db.close(); }
}
export const serviceConfig = (kind) => configOp('readonly', (s) => s.get(key(kind)));
const saveConfig = (kind, value) => configOp('readwrite', (s) => s.put(value, key(kind)));
export async function disconnectService(kind) {
  await configOp('readwrite', (s) => s.delete(key(kind)));
  if (kind === 'cloud') token = '';
  serviceStatus[kind] = 'غير متصل';
}

// لقطة ثابتة للبيانات والمرفقات؛ لا تعتبر النسخة كاملة إذا فُقد مرفق.
export async function captureBundle() {
  await store.flush();
  if (store.saveFailed()) throw new Error('تعذر حفظ بيانات الجهاز. أصلح الحفظ قبل النسخ');
  const db = store.getDb();
  if (!db) throw new Error('لا توجد بيانات للنسخ');
  const snapshot = JSON.stringify({ ...db, exportedAt: new Date().toISOString() });
  const data = JSON.parse(snapshot);
  const entries = [{ name: 'ahsebha-backup.json', data: snapshot }];
  const ids = new Set();
  for (const doc of data.docs) for (const f of doc.files || []) {
    if (ids.has(f.id)) continue; ids.add(f.id);
    const blob = await store.getFile(f.id);
    if (!blob) throw new Error('مرفق غير موجود: ' + f.name + '. النسخ الآلي متوقف حتى معالجة الملف');
    entries.push({ name: 'files/' + f.id, data: new Uint8Array(await blob.arrayBuffer()) });
  }
  return { bytes: zipBytes(entries), stamp: data.updatedAt };
}

export async function parseEncryptedBundle(encrypted, password) {
  const plain = await decryptBackup(encrypted, password);
  if (plain.kind !== 'zip') throw new Error('المزامنة تحتاج نسخة كاملة بالمرفقات');
  const entries = unzipEntries(plain.bytes);
  const json = await entryText(entries, 'ahsebha-backup.json');
  const data = store.parseBackup(json);
  const files = new Map();
  for (const doc of data.docs) for (const meta of doc.files || []) {
    if (!files.has(meta.id)) {
      const name = [...entries.keys()].find((n) => n === 'files/' + meta.id || n.startsWith('files/' + meta.id + '.'));
      if (!name) throw new Error('النسخة تفتقد مرفقاً، ولم يتم استبدال البيانات');
      files.set(meta.id, { meta, bytes: await entryBytes(entries, name) });
    }
  }
  return { data, files };
}

export async function restoreCloudBundle(bundle) {
  suspended = true;
  try {
    await store.flush();
    // تفشل الاستعادة إن لم يمكن حفظ نسخة الرجوع؛ لا نتجاهل فشلها.
    if (store.getDb()) await store.snapshotNow('before-cloud-restore');
    const ids = new Map();
    for (const [oldId, f] of bundle.files) {
      const meta = { ...f.meta, id: store.newId() }; ids.set(oldId, meta.id);
      await store.putFile(meta, new Blob([f.bytes], { type: meta.type }));
    }
    for (const d of bundle.data.docs) for (const f of d.files || []) f.id = ids.get(f.id);
    store.replaceDb(bundle.data); await store.flush();
    if (store.saveFailed()) throw new Error('تعذر تثبيت النسخة على الجهاز');
  } finally { suspended = false; }
}

export async function writeFolderBackup(directory, writer, bytes, company = store.companyId, date = new Date()) {
  const day = ymd(date);
  const text = await encryptWithWriter(bytes, writer, { kind: 'zip' });
  const handle = await directory.getFileHandle('kenz-' + company + '-' + day + '.json', { create: true });
  const output = await handle.createWritable();
  try { await output.write(text); await output.close(); }
  catch (e) { await output.abort().catch(() => {}); throw e; }
}
export async function enableFolder(directory, password) {
  const writer = await createBackupWriter(password);
  await saveConfig('folder', { directory, writer });
  await backupToFolder();
}
export async function backupToFolder({ requestPermission = false } = {}) {
  const cfg = await serviceConfig('folder');
  if (!cfg) throw new Error('اختر مجلد النسخ أولاً');
  const mode = { mode: 'readwrite' };
  const permission = requestPermission ? await cfg.directory.requestPermission(mode) : await cfg.directory.queryPermission(mode);
  if (permission !== 'granted') throw new Error('النسخ للمجلد متوقف: افتح الإعدادات واسمح بالوصول مجدداً');
  const b = await captureBundle();
  await writeFolderBackup(cfg.directory, cfg.writer, b.bytes);
  serviceStatus.folder = 'آخر نسخة كاملة: ' + new Date().toLocaleString('ar-JO');
}

export function validateCloudConfig(url, space) {
  const u = new URL(url);
  if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash || u.pathname !== '/') throw new Error('اكتب عنوان الخادم الآمن فقط، مثل https://example.workers.dev');
  if (!/^[a-zA-Z0-9_-]{3,80}$/.test(space)) throw new Error('معرّف المنشأة السحابي: 3 إلى 80 حرفاً أو رقماً لاتينياً');
  return { url: u.origin, space };
}
export async function connectCloud({ url, space, accessToken, password, automatic = false }) {
  const config = validateCloudConfig(url, space);
  if (accessToken.length < 32) throw new Error('مفتاح الخادم يجب أن يكون 32 خانة على الأقل');
  const old = await serviceConfig('cloud');
  const same = old?.url === config.url && old?.space === space;
  const writer = await createBackupWriter(password);
  token = accessToken;
  // لا نتبنى إصدار الخادم تلقائياً: الجهاز الجديد يسحب النسخة أولاً أو سيرفض الخادم رفعه.
  await saveConfig('cloud', { ...config, writer, automatic, version: same ? old.version : 0 });
  serviceStatus.cloud = 'متصل لهذه الجلسة؛ ارفع أو اسحب النسخة';
}
export async function resumeCloudSession(accessToken) {
  if (accessToken.length < 32) throw new Error('مفتاح الخادم غير مكتمل');
  token = accessToken; serviceStatus.cloud = 'الجلسة متصلة';
}
async function cloudRequest(cfg, method, body) {
  if (!token) throw new Error('أدخل مفتاح الخادم في الإعدادات لتوصيل هذه الجلسة');
  const res = await fetch(cfg.url + '/v1/companies/' + cfg.space, {
    method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined, cache: 'no-store', credentials: 'omit',
    redirect: 'error', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(30000),
  });
  if (res.status === 409) throw new Error('تعارض: توجد نسخة أحدث على جهاز آخر. اسحبها وراجعها قبل الرفع؛ لم تتغير النسخة السحابية');
  if (res.status === 413) throw new Error('النسخة المشفّرة أكبر من حد الخادم (10 ميجابايت). استعمل النسخ للمجلد لهذه البيانات');
  if (!res.ok) throw new Error(res.status === 404 ? 'لا توجد نسخة على الخادم بعد' : 'الخادم رفض الطلب (' + res.status + ')');
  return res.json();
}
export async function pushCloud() {
  const cfg = await serviceConfig('cloud');
  if (!cfg) throw new Error('أعدّ الخادم أولاً');
  const bundle = await captureBundle();
  const encrypted = await encryptWithWriter(bundle.bytes, cfg.writer, { kind: 'zip' });
  if (new TextEncoder().encode(JSON.stringify({ expectedVersion: cfg.version, encrypted })).byteLength > 10 * 1024 * 1024) throw new Error('النسخة المشفّرة أكبر من 10 ميجابايت. استعمل النسخ للمجلد لهذه البيانات');
  const result = await cloudRequest(cfg, 'PUT', { expectedVersion: cfg.version, encrypted });
  await saveConfig('cloud', { ...cfg, version: result.version });
  serviceStatus.cloud = 'تم رفع النسخة الكاملة، إصدار ' + result.version;
}
export async function fetchCloudBundle(password) {
  const cfg = await serviceConfig('cloud');
  if (!cfg) throw new Error('أعدّ الخادم أولاً');
  const remote = await cloudRequest(cfg, 'GET');
  const bundle = await parseEncryptedBundle(remote.encrypted, password);
  return { ...bundle, version: remote.version };
}
export async function acceptCloudBundle(bundle) {
  const cfg = await serviceConfig('cloud');
  await restoreCloudBundle(bundle);
  await saveConfig('cloud', { ...cfg, version: bundle.version });
  serviceStatus.cloud = 'تم سحب الإصدار ' + bundle.version;
}

async function automaticSave() {
  timer = null;
  if (running || suspended || !store.getDb()) return;
  running = true;
  dirty = false;
  try {
    const folder = await serviceConfig('folder');
    if (folder) try { await backupToFolder(); } catch (e) { serviceStatus.folder = e.message; }
    const cloud = await serviceConfig('cloud');
    if (cloud?.automatic && token) try { await pushCloud(); } catch (e) { serviceStatus.cloud = e.message; }
  } catch (e) { /* غير معدّ على هذا المتصفح */ }
  finally {
    running = false;
    if (dirty && !timer) timer = setTimeout(automaticSave, 5000);
    if (typeof window !== 'undefined') window.dispatchEvent(new Event('acc:data-service-status'));
  }
}
if (typeof window !== 'undefined') window.addEventListener('acc:saved', () => {
  if (suspended) return;
  dirty = true;
  if (!timer && !running) timer = setTimeout(automaticSave, 5000);
});
