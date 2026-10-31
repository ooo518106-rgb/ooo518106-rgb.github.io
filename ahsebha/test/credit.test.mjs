// حد دين العميل: يُنبَّه فقط حين تزيد الفاتورة دينه فيتجاوز حده، ولا يُعاد التنبيه عند تعديل لا يزيد الدين
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBooks, creditCheck, defaultAccounts, defaultSettings, calcDoc } from '../js/core.js';

let seq = 0;
const issue = (db, d) => {
  d.id = d.id || 'd' + (++seq);
  d.createdAt = d.createdAt || `2026-01-01T00:01:${String(seq % 60).padStart(2, '0')}.${String(seq).padStart(4, '0')}Z`;
  d.no = d.no || db.docs.filter((x) => x.type === d.type).length + 1;
  db.docs.push(d);
  return d;
};
const mk = (limit) => ({
  settings: defaultSettings({ country: 'JO', name: 'متجر', startDate: '2026-01-01' }),
  accounts: defaultAccounts('JO'),
  parties: [{ id: 'c1', kind: 'customer', name: 'عميل', ...(limit != null ? { creditLimit: limit } : {}) }, { id: 'c2', kind: 'customer', name: 'آخر', creditLimit: 50 }],
  products: [], docs: [],
});
const sale = (price, o = {}) => ({ type: 'sale', date: '2026-02-01', party: 'c1', vatRate: 0, paid: 0, lines: [{ desc: 'بند', qty: 1, price, tax: 'S' }], ...o });
const check = (db, d, existing = null) => creditCheck(db, buildBooks(db, { today: '2026-12-31' }), d, existing);

test('بلا حد أو بلا عميل أو لغير الفواتير: لا تنبيه', () => {
  assert.equal(check(mk(), sale(10_000)), null, 'العميل بلا حد');
  assert.equal(check(mk(0), sale(10_000)), null, 'حد صفر = بلا حد');
  assert.equal(check(mk(100), sale(10_000, { party: '' , paid: 10_000, payAcc: 'cash' })), null, 'بيع نقدي بلا عميل');
  assert.equal(check(mk(100), { ...sale(10_000), type: 'quote' }), null, 'عرض السعر لا يُحتسب');
  assert.equal(check(mk(100), { ...sale(10_000), type: 'purchase' }), null);
});

test('فاتورة آجلة تتجاوز الحد: التفاصيل صحيحة، والمدفوع منها لا يُحتسب ديناً', () => {
  const db = mk(100);
  const over = check(db, sale(150));
  assert.deepEqual(over, { limit: 100, balance: 0, adds: 150, after: 150, over: 50 });
  assert.equal(check(db, sale(150, { paid: 60, payAcc: 'cash' })), null, 'المتبقي 90 داخل الحد');
  assert.equal(check(db, sale(150, { paid: 150, payAcc: 'cash' })), null, 'مدفوعة كاملة');
  assert.equal(check(db, sale(100)), null, 'الوصول للحد تماماً مسموح');
  assert.deepEqual(check(db, sale(100.01)), { limit: 100, balance: 0, adds: 100.01, after: 100.01, over: 0.01 });
  // الضريبة داخلة في ما يستحق على العميل
  assert.equal(check(db, sale(90, { vatRate: 16 }))?.after, calcDoc(sale(90, { vatRate: 16 }), 3).total);
});

test('الرصيد الحالي يُحتسب: دين سابق + فاتورة جديدة', () => {
  const db = mk(100);
  issue(db, sale(80));
  const r = check(db, sale(30));
  assert.deepEqual([r.balance, r.after, r.over], [80, 110, 10]);
  assert.equal(check(db, sale(20)), null, '80 + 20 = الحد تماماً');
  // سند قبض يخفّض الرصيد
  issue(db, { type: 'receipt', date: '2026-02-02', party: 'c1', amount: 50, money: 'cash' });
  assert.equal(check(db, sale(30)), null, 'بعد قبض 50 صار الرصيد 30');
});

test('تعديل فاتورة موجودة: يُطرح أثرها، ولا تنبيه إلا إن زاد الدين', () => {
  const db = mk(100);
  const inv = issue(db, sale(130)); // تجاوزت الحد وقت إنشائها
  assert.equal(check(db, { ...inv, notes: 'تعديل ملاحظة' }, inv), null, 'تعديل لا يزيد الدين');
  assert.equal(check(db, { ...inv, lines: [{ desc: 'بند', qty: 1, price: 120, tax: 'S' }] }, inv), null, 'تخفيض');
  const more = check(db, { ...inv, lines: [{ desc: 'بند', qty: 1, price: 160, tax: 'S' }] }, inv);
  assert.deepEqual([more.balance, more.adds, more.after], [0, 160, 160], 'الرصيد بدون أثر النسخة القديمة');
  // دفع جزء يخفض ما على العميل فلا تنبيه
  assert.equal(check(db, { ...inv, paid: 50, payAcc: 'cash' }, inv), null);
  // تغيير العميل: يُحسب كفاتورة جديدة على العميل الآخر (حدّه 50)
  const moved = check(db, { ...inv, party: 'c2' }, inv);
  assert.deepEqual([moved.limit, moved.balance, moved.after], [50, 0, 130]);
});
