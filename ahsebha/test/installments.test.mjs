// الأقساط: توزيع المسدد على الأقساط بالترتيب، وتقسيم المفتوح من الفاتورة بحسب استحقاق كل قسط، والتقادم والمتأخر والتحقق
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildBooks, installmentRows, validateDoc, aging, dashboard, cancelCreditNote, calcDoc, round, trialBalance,
  defaultAccounts, defaultSettings,
} from '../js/core.js';

let seq = 0;
const issue = (db, d) => {
  d.id = d.id || 'd' + (++seq);
  d.createdAt = d.createdAt || `2026-01-01T00:01:${String(seq % 60).padStart(2, '0')}.${String(seq).padStart(4, '0')}Z`;
  d.no = d.no || db.docs.filter((x) => x.type === d.type).length + 1;
  db.docs.push(d);
  return d;
};
const mk = () => ({
  settings: defaultSettings({ country: 'JO', name: 'متجر', startDate: '2026-01-01' }),
  accounts: defaultAccounts('JO'),
  parties: [{ id: 'c1', kind: 'customer', name: 'عميل' }, { id: 's1', kind: 'supplier', name: 'مورد' }],
  products: [], docs: [],
});
const INST = (...xs) => xs.map(([due, amount]) => ({ due, amount }));
const sale = (o = {}) => ({ type: 'sale', date: '2026-01-10', party: 'c1', vatRate: 0, paid: 0, lines: [{ desc: 'بند', qty: 1, price: 300, tax: 'S' }], installments: INST(['2026-02-10', 100], ['2026-03-10', 100], ['2026-04-10', 100]), ...o });
const books = (db, today = '2026-12-31') => buildBooks(db, { today });

test('توزيع المسدد على الأقساط بترتيب الاستحقاق', () => {
  const d = { installments: INST(['2026-03-10', 100], ['2026-02-10', 100], ['2026-04-10', 100.5]) };
  assert.equal(installmentRows({}, 10), null);
  assert.equal(installmentRows({ installments: [] }, 10), null);
  const none = installmentRows(d, 300.5);
  assert.deepEqual(none.map((r) => [r.n, r.due, r.amount, r.paid, r.left]), [[1, '2026-02-10', 100, 0, 100], [2, '2026-03-10', 100, 0, 100], [3, '2026-04-10', 100.5, 0, 100.5]], 'مرتبة بالاستحقاق');
  const some = installmentRows(d, 150.5); // سُدِّد 150
  assert.deepEqual(some.map((r) => [r.paid, r.left]), [[100, 0], [50, 50], [0, 100.5]]);
  const all = installmentRows(d, 0);
  assert.deepEqual(all.map((r) => r.left), [0, 0, 0]);
  assert.deepEqual(installmentRows(d, -5).map((r) => r.left), [0, 0, 0], 'المتبقي لا يكون سالباً');
  assert.equal(round(installmentRows(d, 0.1).reduce((s, r) => s + r.paid, 0), 3), 300.4);
});

test('المفتوح من الفاتورة يتقسم بحسب الأقساط، والرصيد لا يتغير، والقيود كما هي بلا أقساط', () => {
  const plain = mk();
  issue(plain, sale({ installments: undefined, dueDate: '2026-02-10' }));
  const db = mk();
  const inv = issue(db, sale());
  const B = books(db);
  const open = B.openItems.get('c1');
  assert.deepEqual(open.map((it) => [it.inst, it.due, it.open, it.doc]), [[1, '2026-02-10', 100, inv.id], [2, '2026-03-10', 100, inv.id], [3, '2026-04-10', 100, inv.id]]);
  assert.equal(B.partyBalance.get('c1'), 300);
  assert.equal(round(open.reduce((s, it) => s + it.open, 0), 3), B.partyBalance.get('c1'), 'مجموع الأجزاء = الرصيد');
  // لا أثر على القيود
  const P = books(plain);
  const strip = (b) => b.postings.map((p) => [p.acc, p.dr, p.cr, p.date]);
  assert.deepEqual(strip(B), strip(P), 'القيود نفسها');
  assert.deepEqual(B.issues, []);
  assert.ok(trialBalance(db, B, { to: '2026-12-31' }).balanced);
});

test('سند قبض يسدّد الأقدم فالأقدم، والحالة تحمل أول قسط غير مسدد والمتأخر', () => {
  const db = mk();
  const inv = issue(db, sale());
  issue(db, { type: 'receipt', date: '2026-02-15', party: 'c1', amount: 130, money: 'cash' });
  const B = books(db, '2026-03-20');
  assert.deepEqual(B.openItems.get('c1').map((it) => [it.inst, it.due, it.open]), [[2, '2026-03-10', 70], [3, '2026-04-10', 100]]);
  const st = B.status.get(inv.id);
  assert.deepEqual([st.due, st.paid, st.state, st.nextDue, st.lateAmt], [170, 130, 'partial', '2026-03-10', 70], 'القسط الثاني متأخر بـ70 في 20 مارس');
  // قبل أي استحقاق: لا متأخر
  const early = books(db, '2026-02-20');
  assert.equal(early.status.get(inv.id).lateAmt, 0);
  assert.equal(early.status.get(inv.id).nextDue, '2026-03-10');
  // بعد السداد الكامل لا حقول أقساط
  issue(db, { type: 'receipt', date: '2026-03-01', party: 'c1', amount: 170, money: 'cash' });
  const paid = books(db, '2026-12-31').status.get(inv.id);
  assert.deepEqual([paid.state, paid.nextDue, paid.lateAmt], ['paid', undefined, undefined]);
  assert.deepEqual(books(db).openItems.get('c1') || [], []);
});

test('الدفع عند الإصدار لا يدخل في الأقساط: الأقساط تغطي المتبقي فقط', () => {
  const db = mk();
  const inv = issue(db, sale({ paid: 60, payAcc: 'cash', installments: INST(['2026-02-10', 120], ['2026-03-10', 120]) }));
  assert.deepEqual(validateDoc(db, inv), {});
  const B = books(db);
  assert.deepEqual(B.openItems.get('c1').map((it) => [it.inst, it.open]), [[1, 120], [2, 120]]);
  assert.equal(B.status.get(inv.id).due, 240);
});

test('التقادم يحسب كل قسط بتاريخه: الفاتورة لا تُعتبر متأخرة كلها', () => {
  const db = mk();
  issue(db, sale({ installments: INST(['2026-02-10', 100], ['2026-04-10', 100], ['2026-07-10', 100]) }));
  const b = (asOf) => { const a = aging(db, books(db, asOf), 'customer', asOf).rows[0]; return [a.current, a.d30, a.d60, a.d90, a.d90p]; };
  assert.deepEqual(b('2026-02-05'), [300, 0, 0, 0, 0], 'قبل أي استحقاق');
  assert.deepEqual(b('2026-02-20'), [200, 100, 0, 0, 0], 'قسط واحد متأخر 10 أيام');
  assert.deepEqual(b('2026-05-01'), [100, 100, 0, 100, 0], 'الأول متأخر 80 يوماً، والثاني 21 يوماً، والثالث لم يحن');
});

test('لوحة المتأخرات: الفاتورة متأخرة فقط إذا تأخر قسط منها', () => {
  const db = mk();
  const inv = issue(db, sale());
  const over = (today) => dashboard(db, books(db, today), today).overdue.map((d) => d.id);
  assert.deepEqual(over('2026-02-09'), []);
  assert.deepEqual(over('2026-02-11'), [inv.id]);
  issue(db, { type: 'receipt', date: '2026-02-12', party: 'c1', amount: 100, money: 'cash' });
  assert.deepEqual(over('2026-02-20'), [], 'سُدِّد القسط الأول فلا متأخر');
  assert.deepEqual(over('2026-03-11'), [inv.id], 'تأخر الثاني');
});

test('فاتورة مشتريات بأقساط: دفعات للمورد تُقسَّم بنفس الطريقة', () => {
  const db = mk();
  const inv = issue(db, { type: 'purchase', date: '2026-01-10', party: 's1', vatRate: 0, paid: 0, lines: [{ desc: 'بضاعة', qty: 1, price: 200, tax: 'S' }], installments: INST(['2026-02-10', 100], ['2026-03-10', 100]) });
  assert.deepEqual(validateDoc(db, inv), {});
  const B = books(db, '2026-02-20');
  assert.deepEqual(B.openItems.get('s1').map((it) => [it.inst, it.due, it.open]), [[1, '2026-02-10', 100], [2, '2026-03-10', 100]]);
  assert.equal(B.status.get(inv.id).nextDue, '2026-02-10');
});

test('الإلغاء بإشعار دائن يصفّر الأقساط', () => {
  const db = mk();
  const inv = issue(db, sale());
  const cn = cancelCreditNote(db, inv, { date: '2026-01-20' });
  assert.equal(cn.installments, undefined, 'الإشعار الدائن بلا أقساط');
  issue(db, cn);
  const B = books(db);
  assert.deepEqual(B.openItems.get('c1') || [], []);
  assert.equal(B.partyBalance.get('c1') || 0, 0);
});

test('قواعد التحقق من الأقساط', () => {
  const db = mk();
  const ok = sale();
  assert.deepEqual(validateDoc(db, ok), {});
  const codes = (o) => validateDoc(db, { ...ok, ...o }).installments || '';
  assert.match(codes({ installments: INST(['2026-02-10', 100], ['2026-03-10', 100]) }), /يجب أن يساوي المتبقي \(300\)/);
  assert.match(codes({ installments: INST(['2026-02-10', 150], ['2026-03-10', 150.5]) }), /مجموع الأقساط \(300.5\)/);
  assert.match(codes({ installments: INST(['2026-02-10', 0], ['2026-03-10', 300]) }), /تاريخ صحيح ومبلغ/);
  assert.match(codes({ installments: INST(['', 150], ['2026-03-10', 150]) }), /تاريخ صحيح/);
  assert.match(codes({ installments: INST(['2026-01-05', 150], ['2026-03-10', 150]) }), /لا يسبق تاريخ الفاتورة/);
  assert.match(codes({ party: '', paid: 0 }), /اختر العميل/);
  assert.match(codes({ paid: 300, payAcc: 'cash' }), /لا متبقٍ للتقسيط/);
  assert.match(validateDoc(db, { ...ok, type: 'quote' }).installments || '', /لفواتير البيع والشراء فقط/);
  assert.equal(codes({ installments: [] }), '', 'قائمة فارغة = بلا أقساط');
  assert.equal(codes({ installments: undefined }), '');
  // ضريبة وخصم: المتبقي يُحسب من الإجمالي الفعلي
  const taxed = { ...ok, vatRate: 16, discMode: 'pct', discVal: 10, installments: undefined };
  const total = calcDoc(taxed, 3).total;
  const half = round(total / 2, 3);
  assert.deepEqual(validateDoc(db, { ...taxed, installments: INST(['2026-02-10', half], ['2026-03-10', round(total - half, 3)]) }), {});
});
