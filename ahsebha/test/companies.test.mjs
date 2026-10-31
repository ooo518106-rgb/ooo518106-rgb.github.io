// تعدد الشركات: لكل شركة مفاتيحها ونسخها ومرفقاتها، والشركة الأولى بمفاتيحها القديمة، والحذف والتنظيف لا يمسّان شركة أخرى
import test from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../js/license.js';
import { defaultAccounts, defaultSettings } from '../js/core.js';

globalThis.__KENZ_PERSIST__ = true; // في Node لا يُحفظ شيء إلا إن طُلب
L.useStorage(L.memoryStorage());

// ─── IndexedDB وهمية (نفس ما في اختبارات الحفظ الآمن) ───
function installFakeIDB() {
  const data = new Map();
  const ctl = { failNext: 0, commits: 0 };
  let chain = Promise.resolve();
  const tick = (f) => setTimeout(f, 0);
  const factory = {
    open() {
      const req = { result: null, onsuccess: null, onerror: null, onupgradeneeded: null };
      tick(() => {
        req.result = {
          createObjectStore() {},
          transaction(_name, mode) {
            const tx = { oncomplete: null, onerror: null, onabort: null, error: null };
            const ops = [];
            const staged = new Map();
            let aborted = false;
            const read = (k) => (staged.has(k) ? staged.get(k) : { v: data.get(k) });
            const store = {
              get(key) { const r = { result: undefined, onsuccess: null }; ops.push(() => { const x = read(key); r.result = x.del ? undefined : structuredClone(x.v); if (r.onsuccess) r.onsuccess(); }); return r; },
              put(v, key) { const r = {}; ops.push(() => { if (mode !== 'readwrite') throw new Error('readonly transaction'); staged.set(key, { v: structuredClone(v) }); }); return r; },
              getAllKeys() { const r = { result: undefined }; ops.push(() => { const keys = new Set(data.keys()); for (const [k, x] of staged) { if (x.del) keys.delete(k); else keys.add(k); } r.result = [...keys]; }); return r; },
              delete(key) { const r = {}; ops.push(() => { if (mode !== 'readwrite') throw new Error('readonly transaction'); staged.set(key, { del: true }); }); return r; },
            };
            tx.objectStore = () => store;
            tx.abort = () => { aborted = true; };
            chain = chain.then(() => new Promise((resolve) => {
              const finish = (bad) => {
                if (!bad && staged.size && ctl.failNext > 0) { ctl.failNext--; bad = true; tx.error = new Error('QuotaExceededError (simulated)'); }
                if (!bad) { for (const [k, x] of staged) { if (x.del) data.delete(k); else data.set(k, x.v); } if (staged.size) ctl.commits++; }
                tick(() => { (bad ? tx.onabort : tx.oncomplete)?.(); resolve(); });
              };
              const step = () => {
                if (aborted) return finish(true);
                const op = ops.shift();
                if (!op) return finish(false);
                try { op(); } catch (e) { tx.error = e; return finish(true); }
                tick(step);
              };
              tick(step);
            }));
            return tx;
          },
        };
        req.onsuccess?.();
      });
      return req;
    },
  };
  globalThis.indexedDB = factory;
  return { data, ctl };
}

let n = 0;
// نافذة على شركة معيّنة: نسخة جديدة من وحدة التخزين الحقيقية تقرأ معرّف الشركة عند تحميلها
const tab = async (company) => {
  globalThis.__KENZ_COMPANY__ = company;
  const s = await import(`../js/store.js?co=${++n}`);
  globalThis.__KENZ_COMPANY__ = undefined;
  await s.load();
  return s;
};
const base = (name) => ({ app: 'ahsebha-accounting', settings: defaultSettings({ name, startDate: '2026-01-01', vat: false }), accounts: defaultAccounts(), parties: [], products: [], docs: [] });
const mk = (extra = {}) => ({ type: 'sale', date: '2026-02-01', party: null, vatRate: 0, lines: [{ product: null, desc: 'بند', qty: 1, price: 10, disc: 0, tax: 'S' }], paid: 10, payAcc: 'cash', notes: '', ...extra });
const two = async () => {
  const fake = installFakeIDB();
  const A = await tab('main');
  A.replaceDb(base('شركة أ'));
  await A.flush();
  const B = await tab('c2x');
  B.replaceDb(base('شركة ب'));
  await B.flush();
  return { fake, A, B };
};
const oldId = (tag) => (Date.now() - 3 * 864e5).toString(36).padStart(8, '0') + tag; // معرّف ملف عمره ثلاثة أيام
const blob = (t) => new Blob([t], { type: 'text/plain' });
const withFile = (store, id, notes) => store.saveDoc(mk({ notes, files: [{ id, name: 'f.txt', type: 'text/plain', size: 1 }] }));

test('معرّف الشركة: الأولى main، وغير الصالح يرجع إليها', async () => {
  installFakeIDB();
  assert.equal((await tab('main')).companyId, 'main');
  assert.equal((await tab('c2x')).companyId, 'c2x');
  for (const bad of ['../x', 'AB', 'a b', 'x'.repeat(40), '', 'شركة']) assert.equal((await tab(bad)).companyId, 'main', JSON.stringify(bad));
});

test('الشركة الأولى بمفاتيحها القديمة والثانية بلاحقة، والبيانات والأرقام منفصلة تماماً', async () => {
  const { fake, A, B } = await two();
  assert.ok(fake.data.has('db') && fake.data.has('ver'), 'main بلا لاحقة');
  assert.ok(fake.data.has('db@c2x') && fake.data.has('ver@c2x'), 'الثانية بلاحقة');
  A.saveDoc(mk({ notes: 'من أ' }));
  B.saveDoc(mk({ notes: 'من ب 1' }));
  const b2 = B.saveDoc(mk({ notes: 'من ب 2' }));
  await Promise.all([A.flush(), B.flush()]);
  assert.equal(b2.no, 2, 'ترقيم الشركة الثانية مستقل');
  const A2 = await tab('main');
  const B2 = await tab('c2x');
  assert.deepEqual(A2.getDb().docs.map((d) => d.notes), ['من أ']);
  assert.deepEqual(B2.getDb().docs.map((d) => d.notes), ['من ب 1', 'من ب 2']);
  assert.equal(A2.getDb().settings.name, 'شركة أ');
  assert.equal(B2.getDb().settings.name, 'شركة ب');
  assert.equal(A2.getDb().seq.sale, 2); assert.equal(B2.getDb().seq.sale, 3);
  // إصدار كل شركة مستقل: كتابة في الثانية لا ترفع إصدار الأولى
  const [v1, v2] = [fake.data.get('ver'), fake.data.get('ver@c2x')];
  B2.saveDoc(mk({ notes: 'ب 3' }));
  await B2.flush();
  assert.equal(fake.data.get('ver'), v1);
  assert.equal(fake.data.get('ver@c2x'), v2 + 1);
});

test('النسخ التلقائية لكل شركة وحدها: نفس معرّف اليوم لا يتصادم', async () => {
  const { fake, A, B } = await two();
  A.saveDoc(mk({ notes: 'أ' })); B.saveDoc(mk({ notes: 'ب' })); B.saveDoc(mk({ notes: 'ب2' }));
  await Promise.all([A.flush(), B.flush()]);
  await A.snapshotNow('d:2026-10-31');
  await B.snapshotNow('d:2026-10-31');
  assert.ok(fake.data.has('snap:d:2026-10-31') && fake.data.has('snap:d:2026-10-31@c2x'), 'سجلان مختلفان');
  assert.equal((await A.listSnapshots()).length, 1);
  assert.equal((await B.listSnapshots()).length, 1);
  assert.equal((await A.readSnapshot('d:2026-10-31')).docs.length, 1);
  assert.equal((await B.readSnapshot('d:2026-10-31')).docs.length, 2);
  await B.deleteSnapshot('d:2026-10-31');
  assert.equal((await B.listSnapshots()).length, 0);
  assert.equal((await A.readSnapshot('d:2026-10-31')).docs.length, 1, 'نسخة الأولى سليمة');
  // الاستعادة تأخذ نسخة «قبل الاستبدال» للشركة الفعّالة فقط
  const before = (await A.listSnapshots()).length;
  B.replaceDb(base('شركة ب جديدة'));
  await B.flush();
  assert.equal((await A.listSnapshots()).length, before, 'استبدال بيانات ب لا يضيف نسخة في أ');
  assert.equal(A.getDb().docs.length, 1);
});

test('مسح بيانات شركة لا يحذف مرفقات ولا بيانات الشركة الأخرى', async () => {
  const { fake, A, B } = await two();
  await A.putFile({ id: 'fileA1', name: 'a.txt', type: 'text/plain' }, blob('a'));
  await B.putFile({ id: 'fileB1', name: 'b.txt', type: 'text/plain' }, blob('b'));
  withFile(A, 'fileA1', 'أ'); withFile(B, 'fileB1', 'ب');
  await Promise.all([A.flush(), B.flush()]);
  await B.wipe();
  assert.ok(!fake.data.has('db@c2x') && !fake.data.has('file:fileB1'), 'ب مسحت مع مرفقها');
  assert.ok(fake.data.has('db') && fake.data.has('file:fileA1'), 'أ وبياناتها ومرفقها سليمة');
  assert.equal((await tab('main')).getDb().docs.length, 1);
});

test('تنظيف المرفقات اليتيمة يحسب كل الشركات: ملف عليه إشارة من شركة أخرى لا يُحذف', async () => {
  const { fake, A, B } = await two();
  const idMain = oldId('mainfl'); const idOrphan = oldId('orphan'); const idMine = oldId('minefl');
  for (const [s, id] of [[A, idMain], [B, idOrphan], [B, idMine]]) await s.putFile({ id, name: id, type: 'text/plain' }, blob(id));
  withFile(A, idMain, 'تشير إليه أ'); withFile(B, idMine, 'تشير إليه ب');
  await Promise.all([A.flush(), B.flush(), A.noteCompany(), B.noteCompany()]);
  const deleted = await B.gcFiles();
  assert.equal(deleted, 1);
  assert.ok(fake.data.has('file:' + idMain), 'ملف الشركة الأولى باقٍ رغم أن ب لا تشير إليه');
  assert.ok(fake.data.has('file:' + idMine));
  assert.ok(!fake.data.has('file:' + idOrphan), 'اليتيم الحقيقي حُذف');
  // ملف حديث (قبل أقل من يوم) لا يُحذف حتى لو لم يشر إليه أحد
  await B.putFile({ id: (Date.now()).toString(36).padStart(8, '0') + 'newfl', name: 'n', type: 'text/plain' }, blob('n'));
  assert.equal(await B.gcFiles(), 0);
});

test('القائمة: تضيف الشركة الفعّالة نفسها وتحمل اسمها، والإضافة والحذف', async () => {
  const { fake, A, B } = await two();
  await Promise.all([A.noteCompany(), B.noteCompany()]);
  let list = await A.listCompanies();
  assert.deepEqual(list.map((c) => [c.id, c.name, c.active]), [['main', 'شركة أ', true], ['c2x', 'شركة ب', false]]);
  // اسم يتغيّر فيُسجَّل
  B.saveSettings({ name: 'شركة ب الجديدة' });
  await B.flush();
  await B.noteCompany();
  list = await A.listCompanies();
  assert.equal(list.find((c) => c.id === 'c2x').name, 'شركة ب الجديدة');
  // إضافة شركة فارغة
  const id = await A.addCompany();
  assert.match(id, /^[a-z0-9]{3,24}$/);
  list = await A.listCompanies();
  assert.equal(list.length, 3);
  assert.deepEqual(list.find((c) => c.id === id), { id, name: '', active: false });
  // الشركة الفارغة لا مفاتيح لها بعد
  assert.ok(![...fake.data.keys()].some((k) => k.endsWith('@' + id)));
  // حذف الفارغة، ورفض حذف الفعّالة
  await A.deleteCompany(id);
  assert.equal((await A.listCompanies()).length, 2);
  await assert.rejects(() => A.deleteCompany('main'), /بدّل إلى شركة أخرى/);
  await assert.rejects(() => A.deleteCompany('../x'), /غير معروفة/);
});

test('حذف شركة غير فعّالة بنسخها ومرفقاتها فقط: الأخرى سليمة', async () => {
  const { fake, A, B } = await two();
  await A.putFile({ id: 'fileA2', name: 'a', type: 'text/plain' }, blob('a'));
  await B.putFile({ id: 'fileB2', name: 'b', type: 'text/plain' }, blob('b'));
  withFile(A, 'fileA2', 'أ'); withFile(B, 'fileB2', 'ب');
  await Promise.all([A.flush(), B.flush()]);
  await A.snapshotNow('d:2026-10-31'); await B.snapshotNow('d:2026-10-31'); await B.snapshotNow('before-replace');
  await Promise.all([A.noteCompany(), B.noteCompany()]);
  await A.deleteCompany('c2x');
  const left = [...fake.data.keys()];
  assert.ok(!left.some((k) => k.endsWith('@c2x')), 'لا مفتاح للمحذوفة: ' + left.join(','));
  assert.ok(!left.includes('file:fileB2'), 'مرفق المحذوفة حُذف');
  for (const k of ['db', 'ver', 'snaps', 'snap:d:2026-10-31', 'file:fileA2']) assert.ok(left.includes(k), 'الأولى سليمة: ' + k);
  assert.deepEqual((await A.listCompanies()).map((c) => c.id), ['main']);
  // الأولى قابلة للفتح كما كانت
  const A2 = await tab('main');
  assert.equal(A2.getDb().docs.length, 1);
  assert.equal(A2.getDb().docs[0].files[0].id, 'fileA2');
});

test('حذف الشركة الأولى من نافذة شركة أخرى ممكن، ولا يمس الثانية', async () => {
  const { fake, A, B } = await two();
  B.saveDoc(mk({ notes: 'ب' })); await B.flush(); await Promise.all([A.noteCompany(), B.noteCompany()]);
  await B.deleteCompany('main');
  assert.ok(!fake.data.has('db') && !fake.data.has('ver'));
  assert.ok(fake.data.has('db@c2x'));
  assert.deepEqual((await B.listCompanies()).map((c) => c.id), ['c2x']);
  assert.equal((await tab('c2x')).getDb().docs.length, 1);
});
