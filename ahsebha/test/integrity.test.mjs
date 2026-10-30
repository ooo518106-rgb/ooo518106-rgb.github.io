// سلامة الفواتير: سقف المرتجع، الإلغاء بإشعار دائن، ومنع البيع بأكثر من المخزون
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildBooks, defaultAccounts, defaultSettings, validateDoc, cancelCreditNote, returnableQty, returnLines, stockShortages,
  trialBalance, balanceSheet, vatReport, incomeStatement, balances, calcDoc, round,
} from '../js/core.js';
import * as store from '../js/store.js';
import { summaryFacts } from '../js/insights.js';

let seq = 0;
const doc = (o) => ({ id: 'd' + (++seq), createdAt: `2026-01-01T00:00:${String(seq % 60).padStart(2, '0')}.${String(seq).padStart(4, '0')}Z`, ...o });
// يفعل ما تفعله store.saveDoc عند الحفظ: هوية ورقم تسلسلي ووقت إنشاء (إشعار الإلغاء المبني يصل بلا هذه الحقول)
const issue = (db, d) => {
  d.id = d.id || 'd' + (++seq);
  d.createdAt = d.createdAt || `2026-01-01T00:01:${String(seq % 60).padStart(2, '0')}.${String(seq).padStart(4, '0')}Z`;
  d.no = d.no || db.docs.filter((x) => x.type === d.type).length + 1;
  db.docs.push(d);
  return d;
};
function makeDb(extra = {}) {
  return {
    settings: defaultSettings({ country: 'JO', name: 'متجر', vatNo: '12345678', startDate: '2026-01-01' }),
    accounts: defaultAccounts('JO'),
    parties: [{ id: 'c1', kind: 'customer', name: 'عميل' }, { id: 's1', kind: 'supplier', name: 'مورد' }],
    products: [
      { id: 'P', name: 'منتج', type: 'stock', price: 10, cost: 4, openQty: 100, openCost: 4 },
      { id: 'Q', name: 'منتج آخر', type: 'stock', price: 5, cost: 2, openQty: 50, openCost: 2 },
    ],
    docs: [], ...extra,
  };
}
const sale = (o = {}) => doc({ type: 'sale', no: 1, date: '2026-02-01', party: 'c1', vatRate: 16, paid: 0, lines: [{ product: 'P', qty: 10, price: 10, tax: 'S' }, { product: 'Q', qty: 4, price: 5, tax: 'S' }], ...o });
const ret = (inv, lines, o = {}) => doc({ type: 'sreturn', no: 1, date: '2026-02-05', party: inv.party, refId: inv.id, vatRate: inv.vatRate, paid: 0, lines, ...o });

test('سقف المرتجع: لا يتجاوز المباع بعد خصم المرتجعات السابقة', () => {
  const inv = sale();
  const db = makeDb({ docs: [inv] });
  assert.deepEqual(validateDoc(db, ret(inv, [{ product: 'P', qty: 10, price: 10, tax: 'S' }])), {}, 'إرجاع الكمية كلها مسموح');
  const over = validateDoc(db, ret(inv, [{ product: 'P', qty: 11, price: 10, tax: 'S' }]));
  assert.match(over.qty0, /أكبر من المتبقي/);
  // مرتجع سابق 6: المتبقي 4
  const first = ret(inv, [{ product: 'P', qty: 6, price: 10, tax: 'S' }]);
  db.docs.push(first);
  assert.deepEqual([...returnableQty(db, inv.id, 'sreturn')], [['P', 4], ['Q', 4]]);
  assert.match(validateDoc(db, ret(inv, [{ product: 'P', qty: 5, price: 10, tax: 'S' }])).qty0, /\(4\)/);
  assert.deepEqual(validateDoc(db, ret(inv, [{ product: 'P', qty: 4, price: 10, tax: 'S' }])), {});
  // تعديل المرتجع نفسه لا يحسب كمية نفسه مرتين
  assert.deepEqual(validateDoc(db, { ...first, lines: [{ product: 'P', qty: 10, price: 10, tax: 'S' }] }), {});
  // كل الكمية أُرجعت
  db.docs.push(ret(inv, [{ product: 'P', qty: 4, price: 10, tax: 'S' }]));
  assert.match(validateDoc(db, ret(inv, [{ product: 'P', qty: 1, price: 10, tax: 'S' }])).qty0, /أُرجعت كل كمية/);
  // منتج ليس بالفاتورة، وبنود بلا منتج لا تُقيَّد، والوحدات بمعاملها
  assert.match(validateDoc(db, ret(inv, [{ product: 'sv', qty: 1, price: 1, tax: 'S' }])).qty0 || '', /ليس في الفاتورة|^$/);
  const carton = sale({ lines: [{ product: 'P', qty: 2, price: 120, factor: 12, tax: 'S' }] });
  const db2 = makeDb({ docs: [carton] });
  assert.deepEqual(validateDoc(db2, ret(carton, [{ product: 'P', qty: 24, price: 10, tax: 'S' }])), {}, '2 كرتون = 24 حبة');
  assert.ok(validateDoc(db2, ret(carton, [{ product: 'P', qty: 25, price: 10, tax: 'S' }])).qty0);
  assert.deepEqual(validateDoc(db2, ret(carton, [{ desc: 'خصم', qty: 100, price: 1, tax: 'S' }])), {}, 'بند بلا منتج');
  // مرتجع المشتريات له نفس السقف
  const pur = doc({ type: 'purchase', no: 1, date: '2026-02-01', party: 's1', vatRate: 16, paid: 0, lines: [{ product: 'P', qty: 5, price: 4, tax: 'S' }] });
  const db3 = makeDb({ docs: [pur] });
  const pr = (q) => doc({ type: 'preturn', no: 1, date: '2026-02-02', party: 's1', refId: pur.id, vatRate: 16, paid: 0, lines: [{ product: 'P', qty: q, price: 4, tax: 'S' }] });
  assert.deepEqual(validateDoc(db3, pr(5)), {});
  assert.ok(validateDoc(db3, pr(6)).qty0);
  // مرتجع بلا فاتورة أصلية لا يُقيَّد (مرتجع حر)
  assert.deepEqual(validateDoc(db, doc({ type: 'sreturn', date: '2026-02-05', party: 'c1', vatRate: 16, paid: 0, lines: [{ product: 'P', qty: 1000, price: 10, tax: 'S' }] })), {});
});

const net = (db) => {
  const B = buildBooks(db, { today: '2026-12-31' });
  const bal = balances(B, { to: '2026-12-31' });
  const g = (id) => bal.get(id)?.close || 0;
  return { B, ar: g('ar'), sales: g('sales'), sret: g('sret'), vout: g('vout'), inv: g('inv'), cogs: g('cogs'), cash: g('cash') };
};

test('إلغاء فاتورة آجلة: إشعار دائن كامل يصفّر المبيعات والضريبة والذمة ويرجّع المخزون بتكلفته', () => {
  const inv = sale();
  const db = makeDb({ docs: [inv] });
  const before = net(db);
  assert.ok(before.ar > 0 && before.cogs > 0);
  const cn = cancelCreditNote(db, inv, { date: '2026-02-10', reason: 'خطأ بالكمية' });
  assert.equal(cn.type, 'sreturn'); assert.equal(cn.refId, inv.id); assert.equal(cn.cancels, true);
  assert.match(cn.notes, /INV-0001.*خطأ بالكمية/);
  assert.deepEqual(validateDoc(db, cn), {});
  issue(db, cn);
  const after = net(db);
  assert.deepEqual(after.B.issues, []);
  assert.equal(after.ar, 0, 'ذمة العميل صفر');
  assert.equal(round(after.sales + after.sret, 3), 0, 'المبيعات صافيها صفر');
  assert.equal(after.vout, 0, 'ضريبة المخرجات صفر');
  assert.equal(after.cogs, 0, 'تكلفة المبيعات صفر');
  assert.equal(after.inv, before.inv + before.cogs, 'المخزون رجع بتكلفته الأصلية');
  assert.equal(after.B.cancelled.get(inv.id), cn.id);
  assert.equal(after.B.partyBalance.get('c1') || 0, 0);
  assert.ok(trialBalance(db, after.B, { to: '2026-12-31' }).balanced);
  assert.ok(balanceSheet(db, after.B, { to: '2026-12-31' }).balanced);
  // لا يمكن إلغاؤها مرتين: لا بنود متبقية
  assert.equal(cancelCreditNote(db, inv, { date: '2026-02-11' }).lines.length, 0);
});

test('إلغاء فاتورة مدفوعة: رد المبلغ للعميل من الحساب المختار أو يبقى رصيداً له', () => {
  const inv = sale({ paid: 50, payAcc: 'cash' });
  const db = makeDb({ docs: [inv] });
  const total = calcDoc(inv, 3).total;
  const refund = cancelCreditNote(db, inv, { date: '2026-02-10', refund: { acc: 'bank' } });
  assert.equal(refund.paid, 50); assert.equal(refund.payAcc, 'bank');
  assert.deepEqual(validateDoc(db, refund), {});
  const none = cancelCreditNote(db, inv, { date: '2026-02-10' });
  assert.equal(none.paid, undefined, 'بلا رد: المبلغ يبقى رصيداً للعميل');
  issue(db, none);
  const n = net(db);
  assert.equal(n.B.partyBalance.get('c1'), -50, 'للعميل 50 رصيد دائن');
  assert.equal(round(total - 50 - (total - 50), 3), 0);
});

test('إلغاء بيع نقدي بلا عميل: يُردّ المبلغ كاملاً من نفس طرق الدفع', () => {
  const total = calcDoc({ vatRate: 16, lines: [{ qty: 10, price: 10, tax: 'S' }, { qty: 4, price: 5, tax: 'S' }] }, 3).total;
  const inv = sale({ party: '', payments: [{ acc: 'cash', amount: 100 }, { acc: 'bank', amount: round(total - 100, 3) }] });
  const db = makeDb({ docs: [inv] });
  assert.deepEqual(validateDoc(db, inv), {});
  const cn = cancelCreditNote(db, inv, { date: '2026-02-10' });
  assert.deepEqual(cn.payments.map((p) => [p.acc, p.amount]), [['cash', 100], ['bank', round(total - 100, 3)]]);
  assert.deepEqual(validateDoc(db, cn), {});
  issue(db, cn);
  const n = net(db);
  assert.equal(n.cash, 0, 'الصندوق رجع كما كان'); assert.equal(n.ar, 0); assert.equal(n.vout, 0);
  // دفعة واحدة
  const one = sale({ party: '', paid: round(total, 3), payAcc: 'bank' });
  const c1 = cancelCreditNote(makeDb({ docs: [one] }), one, { date: '2026-02-10' });
  assert.equal(c1.paid, round(total, 3)); assert.equal(c1.payAcc, 'bank');
});

test('إلغاء فاتورة عليها مرتجع جزئي: يلغي المتبقي فقط ولا يتجاوز', () => {
  const inv = sale({ paid: 0 });
  const part = ret(inv, [{ product: 'P', qty: 3, price: 10, tax: 'S' }]);
  const db = makeDb({ docs: [inv, part] });
  const cn = cancelCreditNote(db, inv, { date: '2026-02-10', refund: { acc: 'cash' } });
  assert.deepEqual(cn.lines.map((l) => [l.product, l.qty]), [['P', 7], ['Q', 4]]);
  assert.equal(cn.paid, undefined, 'لا رد تلقائي مع وجود مرتجعات سابقة');
  assert.deepEqual(validateDoc(db, cn), {});
  issue(db, cn);
  const n = net(db);
  assert.equal(n.ar, 0); assert.equal(n.vout, 0); assert.equal(round(n.sales + n.sret, 3), 0);
});

test('نواقص المخزون: تنبيه الكمية الأكبر من المتوفر، مع احتساب كمية المستند عند تعديله والمستودعات', () => {
  const db = makeDb();
  const B = buildBooks(db, { today: '2026-12-31' });
  const d = { type: 'sale', lines: [{ product: 'P', qty: 101, price: 10 }, { product: 'Q', qty: 50, price: 5 }, { desc: 'خدمة', qty: 5, price: 1 }] };
  assert.deepEqual(stockShortages(db, B, d).map((x) => [x.product, x.want, x.have]), [['P', 101, 100]]);
  assert.deepEqual(stockShortages(db, B, { ...d, type: 'quote' }), [], 'عرض السعر لا يحجز مخزوناً');
  // تعديل فاتورة قائمة: كميتها السابقة متاحة لها
  const inv = sale({ lines: [{ product: 'P', qty: 100, price: 10, tax: 'S' }] });
  const db2 = makeDb({ docs: [inv] });
  const B2 = buildBooks(db2, { today: '2026-12-31' });
  assert.deepEqual(stockShortages(db2, B2, { ...inv, lines: [{ product: 'P', qty: 100, price: 10 }] }, inv), []);
  assert.equal(stockShortages(db2, B2, { ...inv, lines: [{ product: 'P', qty: 101, price: 10 }] }, inv).length, 1);
  assert.equal(stockShortages(db2, B2, { ...inv, id: 'new', lines: [{ product: 'P', qty: 1, price: 10 }] }).length, 1, 'فاتورة جديدة: المخزون صفر');
  // مستودعان: المتوفر بحسب مستودع الفاتورة
  const db3 = makeDb({ warehouses: [{ id: 'w1', name: 'أ' }, { id: 'w2', name: 'ب' }], docs: [doc({ type: 'stransfer', date: '2026-01-02', from: 'main', to: 'w2', lines: [{ product: 'P', qty: 30 }] })] });
  const B3 = buildBooks(db3, { today: '2026-12-31' });
  assert.equal(stockShortages(db3, B3, { type: 'sale', wh: 'w2', lines: [{ product: 'P', qty: 31 }] })[0].have, 30);
  assert.equal(stockShortages(db3, B3, { type: 'sale', wh: 'w2', lines: [{ product: 'P', qty: 30 }] }).length, 0);
});

test('الإعدادات الافتراضية الجديدة: حذف الفواتير ممنوع والمخزون السالب تنبيه', () => {
  const s = defaultSettings({ country: 'SA' });
  assert.equal(s.allowDeleteInvoices, false);
  assert.equal(s.negativeStock, 'warn');
  assert.equal(defaultSettings({ country: 'SA', negativeStock: 'block' }).negativeStock, 'block');
});

test('بنود المرتجع المقترحة: المتبقي فقط بعد المرتجعات السابقة، بالوحدات أيضاً', () => {
  const inv = sale({ lines: [{ product: 'P', qty: 10, price: 10, tax: 'S' }, { product: 'Q', qty: 4, price: 5, tax: 'S' }, { desc: 'توصيل', qty: 1, price: 3, tax: 'S' }] });
  const db = makeDb({ docs: [inv] });
  const view = (xs) => xs.map((l) => [l.product || l.desc, l.qty]);
  assert.deepEqual(view(returnLines(db, inv, 'sreturn')), [['P', 10], ['Q', 4], ['توصيل', 1]]);
  const first = ret(inv, [{ product: 'P', qty: 10, price: 10, tax: 'S' }, { product: 'Q', qty: 1, price: 5, tax: 'S' }]);
  db.docs.push(first);
  assert.deepEqual(view(returnLines(db, inv, 'sreturn')), [['Q', 3]], 'المنتج المُرجَع كله يسقط والخدمة لا تتكرر');
  assert.deepEqual(view(returnLines(db, inv, 'sreturn', first.id)), [['P', 10], ['Q', 4], ['توصيل', 1]], 'عند تعديل المرتجع نفسه لا تُحسب كميته على نفسه');
  // وحدة أكبر: كرتونتان (12) سبق إرجاع 12 حبة ⇒ يبقى كرتون
  const carton = sale({ lines: [{ product: 'P', qty: 2, price: 120, factor: 12, unit: 'كرتون', tax: 'S' }] });
  const db2 = makeDb({ docs: [carton, ret(carton, [{ product: 'P', qty: 12, price: 10, tax: 'S' }])] });
  assert.deepEqual(returnLines(db2, carton, 'sreturn').map((l) => [l.qty, l.factor]), [[1, 12]]);
  assert.deepEqual(returnLines(db2, { id: 'none', lines: [] }, 'sreturn'), []);
});

test('ملخص اليوم: الفاتورة الملغاة وإشعارها لا يُعدّان مبيعة ومرتجعاً، والمرتجع الجزئي يُعدّ', () => {
  const day = '2026-03-05';
  const keep = sale({ date: day });
  const voided = sale({ no: 2, date: day });
  const half = sale({ no: 3, date: day });
  const db = makeDb({ docs: [keep, voided, half] });
  issue(db, cancelCreditNote(db, voided, { date: day }));
  issue(db, ret(half, [{ product: 'P', qty: 1, price: 10, tax: 'S' }], { date: day }));
  const B = buildBooks(db, { today: day });
  const f = summaryFacts(db, B, { preset: 'today', today: day });
  assert.equal(f.sales.count, 2, 'فاتورتان فقط: الملغاة خارج العدّ');
  assert.equal(f.sales.returnsCount, 1, 'مرتجع جزئي واحد، وإشعار الإلغاء لا يُعدّ');
  const each = calcDoc(keep, 3).total;
  assert.equal(f.sales.gross, round(each * 2, 3));
  assert.equal(f.sales.returns, calcDoc(db.docs.find((x) => x.type === 'sreturn' && !x.cancels), 3).total);
});

test('تعديل فاتورة عليها مرتجع: لا تقل الكمية عمّا أُرجع، والملغاة بإشعار دائن لا تُعدَّل', () => {
  const inv = sale();
  const db = makeDb({ docs: [inv, ret(inv, [{ product: 'P', qty: 6, price: 10, tax: 'S' }])] });
  const edit = (qty) => ({ ...inv, lines: [{ product: 'P', qty, price: 10, tax: 'S' }, { product: 'Q', qty: 4, price: 5, tax: 'S' }] });
  assert.deepEqual(validateDoc(db, edit(6)), {}, 'يمكن إنقاصها حتى المُرجَع');
  assert.match(validateDoc(db, edit(5)).qty0, /أقل مما أُرجع.*6/);
  assert.match(validateDoc(db, { ...inv, lines: [{ product: 'Q', qty: 4, price: 5, tax: 'S' }] }).lines, /لا يمكن حذف منتج/);
  const db2 = makeDb({ docs: [inv] });
  assert.deepEqual(validateDoc(db2, { ...inv, notes: 'ملاحظة' }), {}, 'بلا مرتجعات تُعدَّل بحرية');
  issue(db2, cancelCreditNote(db2, inv, { date: '2026-02-10' }));
  assert.match(validateDoc(db2, { ...inv, notes: 'ملاحظة' }).lines, /ملغاة/);
  // الإشعار الدائن نفسه يُعدَّل ضمن سقفه
  const cn = db2.docs.find((x) => x.cancels);
  assert.deepEqual(validateDoc(db2, { ...cn, notes: 'سبب آخر' }), {});
});

test('المخزن: الفاتورة الصادرة لا تُحذف إلا بإذن المالك، وأرقام المحذوف لا تُعاد', () => {
  store.replaceDb({ app: 'ahsebha-accounting', settings: defaultSettings({ name: 'x', startDate: '2026-01-01', vat: false }), accounts: defaultAccounts(), parties: [], products: [], docs: [] });
  const mk = (type) => ({ type, date: '2026-02-01', party: null, vatRate: 0, lines: [{ product: null, desc: 'بند', qty: 1, price: 10, disc: 0, tax: 'S' }], paid: 10, payAcc: 'cash', notes: '' });
  const a = store.saveDoc(mk('sale'));
  const b = store.saveDoc(mk('sale'));
  assert.deepEqual([a.no, b.no], [1, 2]);
  assert.equal(store.canDeleteDoc(b), false);
  assert.throws(() => store.deleteDoc(b.id), /لا تُحذف/);
  assert.equal(store.getDb().docs.length, 2, 'لم يُحذف شيء');
  // غير الفواتير تُحذف، لكن رقمها يبقى مستهلكاً
  const p = store.saveDoc(mk('purchase'));
  assert.equal(store.canDeleteDoc(p), true);
  store.deleteDoc(p.id);
  assert.equal(store.saveDoc(mk('purchase')).no, 2, 'رقم المشتريات المحذوفة لا يُعاد');
  // بإذن المالك تُحذف الفاتورة، وحتى حينها لا يُعاد رقمها ويبقى أثرها في سجل التعديلات
  store.saveSettings({ allowDeleteInvoices: true });
  assert.equal(store.canDeleteDoc(b), true);
  store.deleteDoc(b.id);
  assert.equal(store.saveDoc(mk('sale')).no, 3);
  assert.ok(store.getDb().audit.some((x) => x.act === 'delete' && x.doc === b.id && x.before), 'نسخة المحذوف في السجل');
});

// ─── اختبار عشوائي ثابت (بذور محددة): بعد إلغاء فواتير عشوائية تبقى كل التوازنات سليمة ───
function rng(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
for (const country of ['JO', 'SA', 'IQ']) {
  test(`عشوائي ${country}: إلغاء فواتير عشوائية لا يكسر القيود ولا الأرصدة`, () => {
    for (let s = 0; s < 25; s++) {
      const r = rng(4242 + s); const int = (a, b) => a + Math.floor(r() * (b - a + 1));
      const settings = defaultSettings({ country, name: 'م', vatNo: '12345678', startDate: '2026-01-01' });
      const dec = country === 'IQ' ? 0 : country === 'JO' ? 3 : 2;
      const db = { settings, accounts: defaultAccounts(country), parties: [{ id: 'c1', kind: 'customer', name: 'ع' }, { id: 'c2', kind: 'customer', name: 'ع2' }],
        products: [0, 1, 2].map((i) => ({ id: 'p' + i, name: 'م' + i, type: 'stock', price: 10, cost: 5, openQty: 500, openCost: 5 })), docs: [] };
      const invs = [];
      for (let i = 0; i < int(5, 25); i++) {
        const d = doc({ type: 'sale', no: i + 1, date: `2026-02-${String(int(1, 20)).padStart(2, '0')}`, vatRate: settings.vatRate, inclusive: r() < 0.4, paid: 0,
          party: r() < 0.7 ? 'c' + int(1, 2) : '', lines: Array.from({ length: int(1, 3) }, () => ({ product: 'p' + int(0, 2), qty: int(1, 9) + (r() < 0.3 ? 0.5 : 0), price: round(int(50, 900) / 7, dec), disc: r() < 0.3 ? 10 : 0, tax: r() < 0.8 ? 'S' : 'Z' })) });
        const T = calcDoc(d, dec);
        if (!d.party) { d.paid = T.total; d.payAcc = 'cash'; } else if (r() < 0.4) { d.paid = round(T.total * r(), dec); d.payAcc = 'bank'; }
        db.docs.push(d); invs.push(d);
      }
      let cancelledSet = new Set();
      for (const inv of invs) {
        if (r() < 0.4) {
          const cn = cancelCreditNote(db, inv, { date: '2026-03-01', refund: r() < 0.5 ? { acc: 'cash' } : null });
          assert.deepEqual(validateDoc(db, cn), {}, `${country} s${s}: إشعار صالح`);
          issue(db, cn); cancelledSet.add(inv.id);
        }
      }
      const B = buildBooks(db, { today: '2026-12-31' });
      assert.deepEqual(B.issues, [], `${country} s${s}`);
      for (const e of B.entries.values()) assert.equal(e.dr, e.cr);
      assert.ok(trialBalance(db, B, { from: '2026-01-01', to: '2026-12-31' }).balanced);
      assert.ok(balanceSheet(db, B, { to: '2026-12-31' }).balanced);
      const bal = balances(B, { to: '2026-12-31' });
      const arSum = round([...B.partyBalance.values()].reduce((a, v) => a + v, 0), dec);
      assert.equal(round(bal.get('ar')?.close || 0, dec), arSum, `${country} s${s}: ذمم العملاء = مجموع الأرصدة`);
      assert.equal(B.cancelled.size, cancelledSet.size);
      // الفواتير الملغاة صافي أثرها صفر: المبيعات والضريبة تساوي ما للفواتير غير الملغاة فقط
      const live = invs.filter((i) => !cancelledSet.has(i.id));
      const want = round(live.reduce((t, i) => t + calcDoc(i, dec).net, 0), dec);
      const got = round((bal.get('sales')?.close || 0) * -1 - (bal.get('sret')?.close || 0), dec);
      assert.equal(got, want, `${country} s${s}: صافي المبيعات = الفواتير غير الملغاة`);
      const v = vatReport(db, B, { from: '2026-01-01', to: '2026-12-31' });
      assert.equal(v.output, round(live.reduce((t, i) => t + calcDoc(i, dec).vat, 0), dec), `${country} s${s}: الضريبة`);
      assert.equal(round(incomeStatement(db, B, { from: '2026-01-01', to: '2026-12-31' }).totalRevenue, dec), want);
    }
  });
}
