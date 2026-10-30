// الحفظ الآمن بين النوافذ والنسخ التلقائية: نافذتان (نسختان من وحدة التخزين الحقيقية) تتشاركان قاعدة IndexedDB وهمية
import test from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../js/license.js';
import { defaultAccounts, defaultSettings } from '../js/core.js';

globalThis.__KENZ_PERSIST__ = true; // في Node لا يُحفظ شيء إلا إن طُلب
L.useStorage(L.memoryStorage());

// ─── IndexedDB وهمية: المعاملات تُنفَّذ واحدة بعد الأخرى، وكل طلب في دورة حدث، والكتابة تُطبَّق عند الإتمام فقط ───
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
const tab = async () => {
  const s = await import(`../js/store.js?tab=${++n}`);
  await s.load();
  return s;
};
const base = () => ({ app: 'ahsebha-accounting', settings: defaultSettings({ name: 'محل', startDate: '2026-01-01', vat: false }), accounts: defaultAccounts(), parties: [], products: [], docs: [] });
const mk = (type = 'sale', extra = {}) => ({ type, date: '2026-02-01', party: null, vatRate: 0, lines: [{ product: null, desc: 'بند', qty: 1, price: 10, disc: 0, tax: 'S' }], paid: 10, payAcc: 'cash', notes: '', ...extra });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fresh = async () => {
  const fake = installFakeIDB();
  const A = await tab();
  A.replaceDb(base());
  await A.flush();
  const B = await tab();
  return { fake, A, B };
};

test('نافذتان تحفظان فاتورة بالوقت نفسه: تبقى الفاتورتان وتتسلسل أرقامهما', async () => {
  const { A, B } = await fresh();
  assert.equal(B.getDb().docs.length, 0);
  const x = A.saveDoc(mk('sale', { notes: 'من أ' }));
  const y = B.saveDoc(mk('sale', { notes: 'من ب' }));
  assert.equal(x.no, 1); assert.equal(y.no, 1, 'كل نافذة ترى رقمها الأول قبل الدمج');
  await Promise.all([A.flush(), B.flush()]);
  const C = await tab();
  const docs = C.getDb().docs.filter((d) => d.type === 'sale');
  assert.deepEqual(docs.map((d) => d.notes).sort(), ['من أ', 'من ب']);
  assert.deepEqual(docs.map((d) => d.no).sort(), [1, 2], 'الرقمان مختلفان بعد الدمج');
  assert.equal(C.getDb().seq.sale, 3);
  assert.equal(C.getDb().audit.filter((a) => a.act === 'create').length, 2, 'سجل التعديلات فيه الإضافتان');
  // النافذة التي دُمجت تحمل النسخة المدموجة نفسها
  assert.deepEqual(B.getDb().docs.map((d) => d.id).sort(), C.getDb().docs.map((d) => d.id).sort());
});

test('أخذ الإصدار: كل كتابة ناجحة ترفع الرقم، وكتابة بلا جديد لا تكتب', async () => {
  const { fake, A } = await fresh();
  const v0 = fake.data.get('ver');
  A.saveDoc(mk('purchase'));
  await A.flush();
  assert.equal(fake.data.get('ver'), v0 + 1);
  const commits = fake.ctl.commits;
  await A.flush();
  assert.equal(fake.ctl.commits, commits, 'لا عمليات معلّقة: لا كتابة');
});

test('تعديل مستند حذفته نافذة أخرى لا يعيده، والحذف يغلب', async () => {
  const { A, B } = await fresh();
  const p = A.saveDoc(mk('purchase', { notes: 'قبل' }));
  await A.flush();
  await B.syncExternal();
  assert.ok(B.findDoc(p.id));
  A.deleteDoc(p.id);
  B.saveDoc({ ...B.findDoc(p.id), notes: 'تعديل متأخر' });
  await A.flush();
  await B.flush();
  const C = await tab();
  assert.equal(C.findDoc(p.id), null, 'بقي محذوفاً');
  assert.equal(C.getDb().docs.filter((d) => d.type === 'purchase').length, 0);
});

test('إعدادات من نافذتين تندمج حقلاً حقلاً، وتعديل مستند من نافذة والإضافة من أخرى يبقيان', async () => {
  const { A, B } = await fresh();
  A.saveSettings({ name: 'اسم جديد' });
  B.saveSettings({ vatNo: '12345678' });
  const q = B.saveParty({ kind: 'customer', name: 'عميل ب' });
  A.saveParty({ kind: 'customer', name: 'عميل أ' });
  await A.flush(); await B.flush();
  const C = await tab();
  assert.equal(C.getDb().settings.name, 'اسم جديد');
  assert.equal(C.getDb().settings.vatNo, '12345678');
  assert.deepEqual(C.getDb().parties.map((p) => p.name).sort(), ['عميل أ', 'عميل ب']);
  assert.ok(C.findParty(q.id));
});

test('مزامنة: نافذة تقرأ تغيير غيرها وتُنبّه، ونافذة لم يتغير إصدارها لا تعيد القراءة', async () => {
  const { A, B } = await fresh();
  let notified = 0;
  B.onExternalChange(() => { notified++; });
  A.saveDoc(mk('sale', { notes: 'جديدة' }));
  await A.flush();
  await B.syncExternal();
  assert.equal(notified, 1);
  assert.equal(B.getDb().docs.length, 1);
  await B.syncExternal();
  assert.equal(notified, 1, 'لا تغيير جديداً: لا تنبيه');
});

test('حذف كل البيانات من نافذة: لا تعيدها نافذة أخرى بحفظ متأخر، وتُحذف النسخ التلقائية', async () => {
  const { fake, A, B } = await fresh();
  A.saveDoc(mk('sale'));
  await A.flush();
  await B.syncExternal();
  await A.snapshotNow('d:2026-02-01');
  assert.ok(fake.data.has('snap:d:2026-02-01'));
  B.saveDoc(mk('sale', { notes: 'متأخر' }));
  await A.wipe();
  assert.equal(fake.data.has('db'), false);
  assert.equal([...fake.data.keys()].some((k) => k.startsWith('snap:')), false, 'النسخ التلقائية حُذفت');
  await B.syncExternal();
  assert.equal(B.getDb(), null, 'النافذة الأخرى لا تعيد البيانات');
  assert.equal(fake.data.has('db'), false);
  // وبعد الحذف يمكن البدء من جديد من أي نافذة
  B.createCompany({ name: 'جديدة', startDate: '2026-01-01' });
  await B.flush();
  assert.equal(fake.data.has('db'), true);
});

test('الاستبدال الكامل (استعادة) يكتب فوق ما سبقه ويحفظ الحالة السابقة للتراجع', async () => {
  const { fake, A, B } = await fresh();
  A.saveDoc(mk('sale', { notes: 'قديمة' }));
  await A.flush();
  await B.syncExternal();
  const restored = base();
  restored.settings.name = 'من نسخة احتياطية';
  restored.parties = [{ id: 'p1', kind: 'customer', name: 'عميل النسخة' }];
  B.replaceDb(restored);
  await B.flush();
  const C = await tab();
  assert.equal(C.getDb().settings.name, 'من نسخة احتياطية');
  assert.equal(C.getDb().docs.length, 0, 'ما قبل الاستعادة لم يعد');
  await sleep(40);
  const snaps = await B.listSnapshots();
  const before = snaps.find((m) => m.id === 'before-replace');
  assert.ok(before, 'نسخة «قبل آخر استبدال» محفوظة');
  assert.equal(before.docs, 1);
  // التراجع: استعادة تلك النسخة تُرجع الفاتورة القديمة
  await B.restoreSnapshot('before-replace');
  assert.equal(B.getDb().docs.length, 1);
  assert.equal(B.getDb().docs[0].notes, 'قديمة');
  const D = await tab();
  assert.equal(D.getDb().docs[0].notes, 'قديمة', 'محفوظة في المخزن أيضاً');
  void fake;
});

test('فشل الكتابة لا يضيّع العمليات: تُحفظ في المحاولة التالية', async () => {
  const { fake, A } = await fresh();
  const x = A.saveDoc(mk('sale', { notes: 'أولى' }));
  fake.ctl.failNext = 1;
  await A.flush();
  assert.equal(A.saveFailed(), true, 'الفشل ظاهر للمستخدم');
  const mid = await tab();
  assert.equal(mid.getDb().docs.length, 0, 'لم يُحفظ شيء');
  A.saveDoc(mk('sale', { notes: 'ثانية' }));
  await A.flush();
  assert.equal(A.saveFailed(), false);
  const C = await tab();
  assert.deepEqual(C.getDb().docs.map((d) => d.notes).sort(), ['أولى', 'ثانية'], 'العمليتان معاً');
  assert.deepEqual(C.getDb().docs.map((d) => d.no).sort(), [1, 2]);
  void x;
});

test('المستند المتكرر لا يتكرر إن أنشأته نافذتان معاً', async () => {
  const { A, B } = await fresh();
  const rc = A.saveRecurring({ name: 'إيجار', src: mk('purchase', { date: '2026-02-01' }), freq: 'month', next: '2026-02-01', day: 1, active: true });
  await A.flush();
  await B.syncExternal();
  const rA = A.runRecurring('2026-02-15');
  const rB = B.runRecurring('2026-02-15');
  assert.equal(rA.created.length, 1); assert.equal(rB.created.length, 1);
  await Promise.all([A.flush(), B.flush()]);
  const C = await tab();
  assert.equal(C.getDb().docs.filter((d) => d.recurring === rc.id).length, 1, 'مستند واحد لشهر واحد');
  assert.equal(C.getDb().recurring[0].next, '2026-03-01');
});

test('النسخ التلقائية: آخر 7 أيام فقط، وتبقى نسخة «قبل الاستبدال»، وتُفك مطابقة للأصل', async () => {
  const { A } = await fresh();
  A.saveDoc(mk('sale', { notes: 'للنسخ' }));
  await A.flush();
  await sleep(1700); // النسخة اليومية التلقائية (وقت الفراغ)
  const today = (await A.listSnapshots()).find((m) => m.id.startsWith('d:'));
  assert.ok(today, 'نسخة اليوم أُخذت تلقائياً');
  for (let i = 1; i <= 9; i++) await A.snapshotNow(`d:2025-12-${String(i).padStart(2, '0')}`);
  const list = await A.listSnapshots();
  const daily = list.filter((m) => m.id.startsWith('d:')).map((m) => m.id).sort();
  assert.equal(daily.length, 7, 'سبع نسخ يومية');
  assert.ok(!daily.includes('d:2025-12-01') && !daily.includes('d:2025-12-02') && !daily.includes('d:2025-12-03'), 'الأقدم حُذف');
  assert.ok(daily.includes(today.id), 'الأحدث بقي');
  const copy = await A.readSnapshot(today.id);
  assert.equal(copy.docs.length, 1);
  assert.equal(copy.docs[0].notes, 'للنسخ');
  assert.ok(list.every((m) => m.docs >= 0 && m.bytes > 0 && m.at));
  await A.deleteSnapshot(today.id);
  assert.ok(!(await A.listSnapshots()).some((m) => m.id === today.id));
});
