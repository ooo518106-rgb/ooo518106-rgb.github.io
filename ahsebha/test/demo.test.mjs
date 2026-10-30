// اختبارات نسخة العرض: كود العرض الموقّع، عدّاد الفواتير، التجربة المفتوحة للجميع، وحد الحفظ في المخزن
import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG, FEATURES } from '../js/plans.js';
import * as L from '../js/license.js';
import { generateOwnerKeys, buildPayload, signLicense } from '../js/license-sign.js';
import { defaultAccounts, defaultSettings, addDays } from '../js/core.js';
import * as store from '../js/store.js';

const SHIPPED = { ...CONFIG }; // الإعدادات كما صدرت، قبل أن تعدّلها الاختبارات
const TODAY = '2026-10-30';
const owner = await generateOwnerKeys();
const KEYS = [{ kid: owner.kid, jwk: owner.publicJwk }];
const issue = (over = {}) => signLicense(buildPayload({ kid: owner.kid, customer: 'محل النور', plan: 'pro', issued: TODAY, exp: '2026-11-13', ...over }), owner.privateJwk);
const activate = (code) => L.activate(code, { keys: KEYS });
const at = (d) => L.setClock(() => d);

function reset() {
  L.useStorage(L.memoryStorage());
  at(TODAY);
  L.clear();
  Object.assign(CONFIG, { enforce: false, demoPublic: false, demoInvoices: 10, demoDays: 14 });
}
const fresh = () => store.replaceDb({ app: 'ahsebha-accounting', settings: defaultSettings({ name: 'x', startDate: '2026-01-01', vat: false }), accounts: defaultAccounts(), parties: [], products: [], docs: [] });
const sale = (o = {}) => ({ type: 'sale', date: TODAY, party: null, vatRate: 0, lines: [{ product: null, desc: 'بند', qty: 1, price: 10, disc: 0, tax: 'S' }], paid: 10, payAcc: 'cash', notes: '', ...o });
const purchase = (o = {}) => ({ ...sale(), type: 'purchase', ...o });
const made = (type, n) => { for (let i = 0; i < n; i++) L.docCreated(type); };

test('الإعدادات المنشورة: نسخة العرض مطفّأة للجميع فلا يتغير شيء عند المستخدمين الحاليين', () => {
  assert.equal(SHIPPED.demoPublic, false);
  assert.ok(SHIPPED.demoInvoices > 0 && SHIPPED.demoDays > 0, 'القيم الافتراضية جاهزة لحين التفعيل');
  reset();
  CONFIG.demoPublic = SHIPPED.demoPublic;
  assert.equal(L.trialOn(), false);
  assert.equal(L.demo(), null);
  assert.equal(L.docGate('sale'), null);
});

test('كود العرض: عدد الفواتير داخل الكود الموقّع، وكود الاشتراك العادي يبقى بشكله', async () => {
  const code = await issue({ demo: 7 });
  const v = await L.verifyCode(code, { keys: KEYS });
  assert.equal(v.ok, true);
  assert.equal(v.payload.n, 7);
  assert.ok(code.length < 600, 'قصير للواتساب: ' + code.length);
  const normal = await L.verifyCode(await issue(), { keys: KEYS });
  assert.equal('n' in normal.payload, false, 'الاشتراك العادي بلا حقل n');
  // رفع العدد بالعبث يفسد التوقيع
  const [pre, body, sig] = code.split('.');
  const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  p.n = 700;
  const forged = `${pre}.${Buffer.from(JSON.stringify(p)).toString('base64url')}.${sig}`;
  assert.equal((await L.verifyCode(forged, { keys: KEYS })).reason, 'signature');
  // حذف n ليصير اشتراكاً كاملاً يفسده أيضاً
  delete p.n;
  const stripped = `${pre}.${Buffer.from(JSON.stringify(p)).toString('base64url')}.${sig}`;
  assert.equal((await L.verifyCode(stripped, { keys: KEYS })).reason, 'signature');
});

test('الإصدار يرفض عدداً غير صالح بدل أن يصدر اشتراكاً كاملاً بالخطأ، والتنظيف يهمل القيم الغريبة', () => {
  const base = { kid: owner.kid, customer: 'x', plan: 'pro', issued: TODAY, exp: '2026-11-13' };
  for (const bad of [1000, 2.5, -1, '5', NaN]) assert.throws(() => buildPayload({ ...base, demo: bad }), /نسخة العرض/, String(bad));
  assert.equal(buildPayload({ ...base, demo: 0 }).n, undefined);
  const obj = { v: 1, id: 'ABCDEFGHJK', i: TODAY, e: '', p: 'pro' };
  for (const bad of [0, -3, 1000, 4.5, '5', null, true, [], {}]) assert.equal('n' in L.cleanPayload({ ...obj, n: bad }), false, JSON.stringify(bad));
  assert.equal(L.cleanPayload({ ...obj, n: 999 }).n, 999);
});

test('نسخة العرض بلا مهلة: تنتهي في اليوم التالي لتاريخ الانتهاء، بعكس الاشتراك العادي', async () => {
  const d = (await L.verifyCode(await issue({ demo: 5 }), { keys: KEYS })).payload;
  const s = (await L.verifyCode(await issue(), { keys: KEYS })).payload;
  assert.equal(L.entitlementOf(d, '2026-11-13').status, 'active');
  assert.equal(L.entitlementOf(d, '2026-11-14').status, 'expired');
  assert.equal(L.entitlementOf(s, '2026-11-14').status, 'grace');
});

test('كود العرض: يُفعَّل ثم يحدّ الفواتير (مبيعات ومشتريات فقط) ويُظهر المتبقي', async () => {
  reset();
  assert.equal((await activate(await issue({ demo: 3 }))).ok, true);
  let d = L.demo();
  assert.deepEqual([d.source, d.limit, d.used, d.left, d.blocked, d.daysLeft], ['code', 3, 0, 3, false, 14]);
  made('sale', 1);
  made('expense', 4); made('quote', 4); made('receipt', 4); made('sreturn', 4); made('journal', 4);
  d = L.demo();
  assert.deepEqual([d.used, d.left], [1, 2], 'لا تُحسب إلا الفواتير');
  made('purchase', 1); made('sale', 1);
  d = L.demo();
  assert.deepEqual([d.used, d.left, d.blocked, d.reason], [3, 0, true, 'limit']);
  assert.ok(L.docGate('sale') && L.docGate('purchase'));
  for (const t of ['expense', 'quote', 'receipt', 'sreturn', 'journal', 'payroll']) assert.equal(L.docGate(t), null, t);
  const e = L.demoError(d);
  assert.equal(e.code, 'DEMO_LIMIT');
  assert.match(e.message, /3 فواتير/);
});

test('كود العرض: انتهاء المدة يمنع الفواتير حتى لو بقي عدد', async () => {
  reset();
  await activate(await issue({ demo: 5 }));
  at('2026-11-13');
  assert.equal(L.demo().blocked, false);
  at('2026-11-14');
  const d = L.demo();
  assert.deepEqual([d.expired, d.blocked, d.reason, d.left], [true, true, 'expired', 5]);
  assert.match(L.demoError(d).message, /انتهت مدة/);
  assert.ok(L.docGate('sale'));
});

test('العدّاد مرتبط بالكود: إلغاء التفعيل وإعادته لا يصفّره، وكود عرض جديد يبدأ من الصفر', async () => {
  reset();
  const a = await issue({ demo: 2 });
  await activate(a);
  made('sale', 2);
  assert.equal(L.demo().blocked, true);
  L.clear();
  assert.equal(L.demo(), null, 'بلا كود وبلا تجربة للجميع: لا عرض');
  await activate(a);
  assert.equal(L.demo().used, 2, 'نفس الكود يتذكر ما استُعمل');
  await activate(await issue({ demo: 2 }));
  assert.deepEqual([L.demo().used, L.demo().blocked], [0, false], 'كود جديد من المالك = حصة جديدة');
  // اشتراك حقيقي يرفع الحدود
  await activate(await issue({ exp: '2026-12-30' }));
  assert.equal(L.demo(), null);
  assert.equal(L.docGate('sale'), null);
});

test('التجربة للجميع: تبدأ عند أول استخدام وتنتهي بالعدد أو بالمدة، وتُضبط من plans.js', () => {
  reset();
  CONFIG.demoPublic = true;
  CONFIG.demoInvoices = 3;
  CONFIG.demoDays = 14;
  assert.equal(L.trialOn(), true);
  let d = L.demo();
  assert.deepEqual([d.source, d.limit, d.left, d.exp, d.daysLeft], ['trial', 3, 3, '2026-11-13', 14]);
  at('2026-11-04');
  assert.equal(L.demo().daysLeft, 9, 'بداية التجربة محفوظة، لا تتجدد عند كل فتح');
  made('sale', 3);
  assert.deepEqual([L.demo().blocked, L.demo().reason], [true, 'limit']);
  // المدة وحدها
  reset();
  Object.assign(CONFIG, { demoPublic: true, demoInvoices: 3, demoDays: 14 });
  L.demo();
  at('2026-11-14');
  d = L.demo();
  assert.deepEqual([d.expired, d.blocked, d.reason], [true, true, 'expired']);
  // بلا حد زمني
  reset();
  Object.assign(CONFIG, { demoPublic: true, demoInvoices: 3, demoDays: 0 });
  L.demo();
  at('2030-01-01');
  d = L.demo();
  assert.deepEqual([d.exp, d.daysLeft, d.expired, d.blocked], ['', null, false, false]);
  // عدد صفر = لا نسخة عرض
  CONFIG.demoInvoices = 0;
  assert.equal(L.trialOn(), false);
  assert.equal(L.demo(), null);
});

test('معاينة المالك: تشغيل نسخة العرض على جهازه فقط بدون تفعيلها للجميع', () => {
  reset();
  assert.equal(L.demo(), null);
  L.setDemoPreview(true);
  assert.equal(L.demoPreviewing(), true);
  assert.equal(L.demo().source, 'trial');
  L.setDemoPreview(false);
  assert.equal(L.demo(), null);
});

test('الاشتراك الفعّال يوقف التجربة، وإذا انتهى (بعد المهلة) عادت', async () => {
  reset();
  CONFIG.demoPublic = true;
  await activate(await issue({ plan: 'basic', exp: '2026-11-28' }));
  assert.equal(L.demo(), null, 'اشتراك فعّال: لا حد');
  at('2026-12-02'); // في المهلة (5 أيام)
  assert.equal(L.demo(), null);
  at('2026-12-10'); // بعد المهلة: منتهٍ
  const d = L.demo();
  assert.equal(d.source, 'trial');
  assert.ok(L.docGate('sale') === null || d.left > 0);
});

test('الميزات: التجربة تفتح كل شيء لتجربته (مع تفعيل الاشتراكات)، وبعد انتهائها تعود حسب الباقة', async () => {
  reset();
  CONFIG.enforce = true;
  CONFIG.demoPublic = true;
  CONFIG.demoInvoices = 2;
  assert.ok(FEATURES.every((f) => L.has(f.id)), 'كل الميزات مفتوحة أثناء التجربة');
  made('sale', 2);
  assert.ok(FEATURES.every((f) => !L.has(f.id)), 'بعد الحد: الباقة المجانية');
  // كود العرض بباقة كاملة: الميزات مفتوحة طوال العرض ثم تُقفل بانتهائه
  reset();
  CONFIG.enforce = true;
  await activate(await issue({ demo: 5 }));
  assert.ok(FEATURES.every((f) => L.has(f.id)));
  at('2026-11-14');
  assert.ok(FEATURES.every((f) => !L.has(f.id)));
  // الاشتراكات غير مفعّلة: كل شيء مفتوح دائماً (الحد على الفواتير فقط)
  reset();
  await activate(await issue({ demo: 1 }));
  made('sale', 1);
  assert.ok(FEATURES.every((f) => L.has(f.id)));
  assert.ok(L.docGate('sale'));
});

test('حفظ الفواتير: store.saveDoc يرفض بعد الحد، والتعديل والحذف والمستندات الأخرى بخلاف ذلك', async () => {
  reset();
  await activate(await issue({ demo: 2 }));
  fresh();
  const first = store.saveDoc(sale());
  store.saveDoc(purchase());
  const before = { n: store.getDb().docs.length, seq: store.getDb().seq.sale };
  assert.throws(() => store.saveDoc(sale()), (e) => e.code === 'DEMO_LIMIT' && /2 فاتورتان|فاتورتان/.test(e.message));
  assert.throws(() => store.saveDoc(purchase()), (e) => e.code === 'DEMO_LIMIT');
  assert.deepEqual({ n: store.getDb().docs.length, seq: store.getDb().seq.sale }, before, 'لا شيء يُحفظ ولا يُستهلك رقم فاتورة');
  // ما عدا الفواتير يعمل
  store.saveDoc({ type: 'expense', date: TODAY, account: 'e_rent', amount: 5, tax: 'O', vatRate: 0, paid: 5, payAcc: 'cash', notes: '' });
  store.saveDoc({ ...sale(), type: 'quote' });
  // تعديل فاتورة موجودة لا يُحسب
  const edited = store.saveDoc({ ...first, notes: 'تعديل' });
  assert.equal(edited.notes, 'تعديل');
  // الحذف لا يُرجع الحصة، وحذف كل البيانات واستيراد شركة جديدة لا يصفّر العدّاد
  store.deleteDoc(first.id);
  assert.throws(() => store.saveDoc(sale()), (e) => e.code === 'DEMO_LIMIT');
  fresh();
  assert.throws(() => store.saveDoc(sale()), (e) => e.code === 'DEMO_LIMIT');
  // وبعد تفعيل اشتراك حقيقي يعمل من جديد
  await activate(await issue({ exp: '2026-12-30' }));
  assert.equal(store.saveDoc(sale()).no, 1);
});

test('حفظ الفواتير بلا عرض: لا يتغير شيء عند المستخدمين العاديين', async () => {
  reset();
  fresh();
  for (let i = 0; i < 25; i++) store.saveDoc(i % 2 ? purchase() : sale());
  assert.equal(store.getDb().docs.length, 25);
  assert.equal(L.demo(), null);
});

test('المستندات المتكررة: عند الحد تتوقف الفواتير مع رسالة، ولا تنهار الأخرى ولا يضيع موعدها', async () => {
  reset();
  await activate(await issue({ demo: 1 }));
  fresh();
  const saleSrc = sale({ date: '2026-01-05' });
  const expSrc = { type: 'expense', date: '2026-01-05', account: 'e_rent', amount: 100, tax: 'O', vatRate: 0, paid: 100, payAcc: 'cash', notes: 'إيجار' };
  store.saveRecurring({ name: 'اشتراك شهري', src: saleSrc, freq: 'month', day: 5, next: '2026-01-05', until: '', active: true });
  store.saveRecurring({ name: 'الإيجار', src: expSrc, freq: 'month', day: 5, next: '2026-01-05', until: '', active: true });
  const res = store.runRecurring('2026-03-10');
  assert.equal(res.created.filter((d) => d.type === 'sale').length, 1, 'فاتورة واحدة فقط (حد العرض)');
  assert.equal(res.created.filter((d) => d.type === 'expense').length, 3, 'المصروفات المتكررة لا تتأثر');
  assert.match(res.errors[0].msg, /نسخة العرض/);
  const r = store.getDb().recurring.find((x) => x.name === 'اشتراك شهري');
  assert.equal(r.next, '2026-02-05', 'موعد الفاتورة التي لم تُنشأ يبقى محفوظاً');
  assert.equal(r.error || '', '', 'لا خطأ دائم على القالب');
  // بعد التفعيل تُنشأ المتأخرة كلها
  await activate(await issue({ exp: '2026-12-30' }));
  const res2 = store.runRecurring('2026-03-10');
  assert.equal(res2.created.filter((d) => d.type === 'sale').length, 2);
  assert.equal(res2.errors.length, 0);
});

test('حالة البداية: قيم نسخة العرض في plans.js صالحة ولا تتعارض مع الاشتراكات', () => {
  assert.ok(Number.isInteger(SHIPPED.demoInvoices) && SHIPPED.demoInvoices >= 0);
  assert.ok(Number.isInteger(SHIPPED.demoDays) && SHIPPED.demoDays >= 0);
  assert.equal(L.invoicesText(1), 'فاتورة واحدة');
  assert.equal(L.invoicesText(2), 'فاتورتان');
  assert.equal(L.invoicesText(10), '10 فواتير');
  assert.equal(L.invoicesText(11), '11 فاتورة');
  assert.deepEqual([...L.DEMO_TYPES], ['sale', 'purchase']);
  assert.equal(addDays('2026-10-30', 14), '2026-11-13');
});
