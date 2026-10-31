// تتبّع الدفعات وتواريخ الصلاحية: طبقة فوق المخزون لا تغيّر القيود ولا التكلفة، والسحب بالأقرب انتهاءً (FEFO)
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildBooks, validateDoc, stockShortages, lotChoices, lotReport, returnLines, cancelCreditNote, isLotTracked,
  defaultAccounts, defaultSettings, round, MAIN_WH,
} from '../js/core.js';

let seq = 0;
const issue = (db, d) => {
  d.id = d.id || 'd' + (++seq);
  d.createdAt = d.createdAt || `2026-01-01T00:01:${String(seq % 60).padStart(2, '0')}.${String(seq).padStart(5, '0')}Z`;
  d.no = d.no || db.docs.filter((x) => x.type === d.type).length + 1;
  db.docs.push(d);
  return d;
};
const mkDb = (extra = {}) => ({
  settings: defaultSettings({ country: 'JO', name: 'صيدلية', startDate: '2026-01-01' }),
  accounts: defaultAccounts('JO'),
  parties: [{ id: 'c1', kind: 'customer', name: 'عميل' }, { id: 's1', kind: 'supplier', name: 'مورد' }],
  products: [{ id: 'L', name: 'دواء', type: 'stock', track: 'lot', price: 10, cost: 4, openQty: 0, openCost: 4 }, { id: 'N', name: 'عادي', type: 'stock', price: 5, cost: 2, openQty: 0, openCost: 2 }],
  docs: [],
  warehouses: [],
  ...extra,
});
const buy = (db, date, lot, exp, qty, o = {}) => issue(db, { type: 'purchase', date, party: 's1', vatRate: 0, paid: qty * 4, payAcc: 'cash', lines: [{ product: 'L', qty, price: 4, lot, exp, ...(o.line || {}) }], ...(o.doc || {}) });
const sell = (db, date, qty, line = {}, o = {}) => issue(db, { type: 'sale', date, party: 'c1', vatRate: 0, paid: qty * 10, payAcc: 'cash', lines: [{ product: 'L', qty, price: 10, ...line }], ...o });
// كميات الدفعات الحالية: { 'رقم|انتهاء': كمية } (بلا دفعة = '|')
const lots = (B, pid = 'L', wh = null) => {
  const out = {};
  for (const r of (B.lots.get(pid) || new Map()).values()) if (!wh || r.wh === wh) out[`${r.lot}|${r.exp}`] = round((out[`${r.lot}|${r.exp}`] || 0) + r.qty, 6);
  return out;
};
const pieces = (B, doc, i = 0) => (B.lotAlloc.get(`${doc.id}:${i}`) || []).map((p) => `${p.lot || '-'}:${p.qty}`);

test('منتج بلا تتبع: لا طبقة دفعات ولا أي أثر', () => {
  const db = mkDb();
  issue(db, { type: 'purchase', date: '2026-02-01', party: 's1', vatRate: 0, paid: 40, payAcc: 'cash', lines: [{ product: 'N', qty: 10, price: 2, lot: 'X', exp: '2026-12-01' }] });
  sell(db, '2026-02-02', 3, { product: 'N' });
  const B = buildBooks(db);
  assert.equal(B.lots.size, 0);
  assert.equal(B.lotAlloc.size, 0);
  assert.equal(isLotTracked(db.products[0]), true);
  assert.equal(isLotTracked(db.products[1]), false);
  assert.equal(isLotTracked({ type: 'service', track: 'lot' }), false, 'الخدمة لا تتتبع');
});

test('السحب بالأقرب انتهاءً أولاً، وتنفد الدفعة فتختفي من السجل', () => {
  const db = mkDb();
  buy(db, '2026-02-01', 'A', '2026-09-01', 10);
  buy(db, '2026-02-01', 'B', '2026-06-01', 10);
  buy(db, '2026-02-01', 'C', '', 10);
  const s1 = sell(db, '2026-02-05', 12);
  let B = buildBooks(db);
  assert.deepEqual(pieces(B, s1), ['B:10', 'A:2']);
  assert.deepEqual(lots(B), { 'A|2026-09-01': 8, 'C|': 10 }, 'B نفدت فحُذفت، وC بلا تاريخ تُسحب آخراً');
  const s2 = sell(db, '2026-02-06', 10);
  B = buildBooks(db);
  assert.deepEqual(pieces(B, s2), ['A:8', 'C:2']);
  assert.deepEqual(lots(B), { 'C|': 8 });
  assert.deepEqual(B.issues, []);
  assert.deepEqual(B.lotIssues, []);
});

test('البيع يتخطى الدفعة المنتهية بتاريخ المستند، وتاريخ الانتهاء نفسه ما زال صالحاً', () => {
  const db = mkDb();
  buy(db, '2026-01-10', 'OLD', '2026-02-01', 5);
  buy(db, '2026-01-10', 'NEW', '2026-12-01', 5);
  const s1 = sell(db, '2026-02-01', 3, {}, { id: 'on-expiry-day' });
  let B = buildBooks(db);
  assert.deepEqual(pieces(B, s1), ['OLD:3'], 'يوم الانتهاء نفسه ما زالت صالحة');
  const s2 = sell(db, '2026-02-02', 2);
  B = buildBooks(db);
  assert.deepEqual(pieces(B, s2), ['NEW:2'], 'بعد انتهائها تُتخطى وتبقى ما بقي منها في المخزون');
  assert.deepEqual(lots(B), { 'OLD|2026-02-01': 2, 'NEW|2026-12-01': 3 });
  const s3 = sell(db, '2026-02-03', 4);
  B = buildBooks(db);
  assert.deepEqual(pieces(B, s3), ['NEW:3', '-:1'], 'ما لا تكفيه الصالحة يصير عجزاً بلا دفعة ولا يُسحب من المنتهي');
  assert.equal(lots(B)['|'], -1);
  assert.equal(lots(B)['OLD|2026-02-01'], 2);
  assert.ok(B.lotIssues.some((x) => x.doc === s3.id && /الدفعات الصالحة/.test(x.msg)));
  assert.deepEqual(B.issues, [], 'ليست من ملاحظات القيود');
});

test('دفعة يحددها البند تُسحب كلها حتى لو كان غيرها أقرب انتهاءً، وتصير سالبة إن لم تكف فيظهر الخلل', () => {
  const db = mkDb();
  buy(db, '2026-02-01', 'SOON', '2026-03-01', 10);
  buy(db, '2026-02-01', 'LATE', '2026-12-01', 4);
  const s1 = sell(db, '2026-02-02', 3, { lot: 'LATE' });
  let B = buildBooks(db);
  assert.deepEqual(pieces(B, s1), ['LATE:3']);
  assert.deepEqual(lots(B), { 'SOON|2026-03-01': 10, 'LATE|2026-12-01': 1 });
  const s2 = sell(db, '2026-02-03', 3, { lot: 'LATE', exp: '2026-12-01' });
  B = buildBooks(db);
  assert.equal(lots(B)['LATE|2026-12-01'], -2);
  assert.ok(B.lotIssues.some((x) => x.doc === s2.id && /رصيد الدفعة/.test(x.msg)));
});

test('الرصيد بلا دفعة يُباع أولاً: مخزون ما قبل التتبع ثم الدفعات', () => {
  const db = mkDb();
  db.products[0].openQty = 20;
  buy(db, '2026-02-01', 'A', '2026-09-01', 10);
  const s1 = sell(db, '2026-02-02', 25);
  const B = buildBooks(db);
  assert.deepEqual(pieces(B, s1), ['-:20', 'A:5']);
  assert.deepEqual(lots(B), { 'A|2026-09-01': 5 });
});

test('دفعات الرصيد الافتتاحي: ما يزيد عنها بلا دفعة، ولا تتجاوز كمية الافتتاح', () => {
  const db = mkDb();
  db.products[0].openQty = 12;
  db.products[0].openLots = [{ lot: 'O1', exp: '2026-08-01', qty: 6 }, { lot: 'O2', exp: '2026-10-01', qty: 4 }];
  let B = buildBooks(db);
  assert.deepEqual(lots(B), { 'O1|2026-08-01': 6, 'O2|2026-10-01': 4, '|': 2 });
  // منتجان بكميات افتتاحية: لكل منهما سجله الخاص في الرصيد الافتتاحي
  db.products.push({ id: 'M', name: 'ثان', type: 'stock', track: 'lot', price: 5, cost: 2, openQty: 3, openCost: 2, openLots: [{ lot: 'M1', exp: '2026-09-09', qty: 3 }] });
  const B0 = buildBooks(db);
  assert.deepEqual(B0.lotAlloc.get('opening:L').map((x) => `${x.lot || '-'}:${x.qty}`), ['O1:6', 'O2:4', '-:2']);
  assert.deepEqual(B0.lotAlloc.get('opening:M').map((x) => `${x.lot}:${x.qty}`), ['M1:3']);
  db.products.pop();
  db.products[0].openLots = [{ lot: 'O1', exp: '2026-08-01', qty: 50 }];
  B = buildBooks(db);
  assert.deepEqual(lots(B), { 'O1|2026-08-01': 12 }, 'لا تزيد عن كمية الافتتاح');
  db.products[0].openLots = [{ lot: 'X', exp: 'ليس تاريخا', qty: 3 }, { lot: 'Y', qty: -4 }, { lot: 'Z', qty: 'abc' }];
  B = buildBooks(db);
  assert.deepEqual(lots(B), { 'X|': 3, '|': 9 }, 'تاريخ غير صالح يُهمل والكمية غير الموجبة تُهمل');
});

test('مرتجع المبيعات بفاتورته الأصلية يعيد كل كمية لدفعتها، ولا يُرجَع لدفعة أكثر مما سُحب منها', () => {
  const db = mkDb();
  buy(db, '2026-02-01', 'A', '2026-09-01', 10);
  buy(db, '2026-02-01', 'B', '2026-06-01', 10);
  const s1 = sell(db, '2026-02-05', 12);
  const r1 = issue(db, { type: 'sreturn', date: '2026-02-06', party: 'c1', refId: s1.id, vatRate: 0, paid: 50, payAcc: 'cash', lines: [{ product: 'L', qty: 5, price: 10 }] });
  let B = buildBooks(db);
  assert.deepEqual(pieces(B, r1), ['B:5']);
  assert.deepEqual(lots(B), { 'A|2026-09-01': 8, 'B|2026-06-01': 5 });
  const r2 = issue(db, { type: 'sreturn', date: '2026-02-07', party: 'c1', refId: s1.id, vatRate: 0, paid: 70, payAcc: 'cash', lines: [{ product: 'L', qty: 7, price: 10 }] });
  B = buildBooks(db);
  assert.deepEqual(pieces(B, r2), ['B:5', 'A:2'], 'الباقي من B ثم A');
  assert.deepEqual(lots(B), { 'A|2026-09-01': 10, 'B|2026-06-01': 10 }, 'رجع كل شيء كما كان');
  // مرتجع ثالث زائد عن الأصل: الزيادة بلا دفعة
  const r3 = issue(db, { type: 'sreturn', date: '2026-02-08', party: 'c1', refId: s1.id, vatRate: 0, paid: 10, payAcc: 'cash', lines: [{ product: 'L', qty: 1, price: 10 }] });
  B = buildBooks(db);
  assert.deepEqual(pieces(B, r3), ['-:1']);
});

test('مرتجع في يوم الفاتورة نفسه يعود لدفعاتها أيضاً (رغم أن الوارد يُعالَج قبل الصادر في اليوم)', () => {
  const db = mkDb();
  buy(db, '2026-02-01', 'A', '2026-09-01', 10);
  buy(db, '2026-02-01', 'B', '2026-06-01', 10);
  const s1 = sell(db, '2026-02-05', 12);
  const r1 = issue(db, { type: 'sreturn', date: '2026-02-05', party: 'c1', refId: s1.id, vatRate: 0, paid: 50, payAcc: 'cash', lines: [{ product: 'L', qty: 5, price: 10 }] });
  const B = buildBooks(db);
  assert.deepEqual(pieces(B, s1), ['B:10', 'A:2']);
  assert.deepEqual(pieces(B, r1), ['B:5'], 'عاد لدفعة الفاتورة لا بلا دفعة');
  assert.deepEqual(lots(B), { 'A|2026-09-01': 8, 'B|2026-06-01': 5 });
  assert.deepEqual(B.lotIssues, []);
});

test('أُرجعت بضاعة وبيعت من جديد في اليوم نفسه: الدفعات تنتهي سليمة بلا عجز ولا رصيد زائد', () => {
  const db = mkDb();
  buy(db, '2026-02-01', 'X', '2026-09-01', 10);
  const a = sell(db, '2026-02-05', 10);
  const r = issue(db, { type: 'sreturn', date: '2026-02-05', party: 'c1', refId: a.id, vatRate: 0, paid: 100, payAcc: 'cash', lines: [{ product: 'L', qty: 10, price: 10 }] });
  const b = sell(db, '2026-02-05', 10);
  const B = buildBooks(db);
  assert.deepEqual(pieces(B, a), ['X:10']);
  assert.deepEqual(pieces(B, r), ['X:10']);
  assert.deepEqual(pieces(B, b), ['X:10']);
  assert.deepEqual(lots(B), {});
  assert.deepEqual(B.lotIssues, []);
  assert.equal(B.stock.get('L').qty, 0);
});

test('مرتجع بدفعة صريحة (أو بلا فاتورة أصلية) يدخل الدفعة المكتوبة، وبلا شيء منهما يدخل بلا دفعة', () => {
  const db = mkDb();
  buy(db, '2026-02-01', 'A', '2026-09-01', 10);
  const s1 = sell(db, '2026-02-02', 4);
  const r1 = issue(db, { type: 'sreturn', date: '2026-02-03', party: 'c1', refId: s1.id, vatRate: 0, paid: 10, payAcc: 'cash', lines: [{ product: 'L', qty: 1, price: 10, lot: 'Z', exp: '2027-01-01' }] });
  const r2 = issue(db, { type: 'sreturn', date: '2026-02-03', party: 'c1', vatRate: 0, paid: 20, payAcc: 'cash', lines: [{ product: 'L', qty: 2, price: 10 }] });
  const B = buildBooks(db);
  assert.deepEqual(pieces(B, r1), ['Z:1']);
  assert.deepEqual(pieces(B, r2), ['-:2']);
  assert.deepEqual(lots(B), { 'A|2026-09-01': 6, 'Z|2027-01-01': 1, '|': 2 });
});

test('بنود المرتجع وإشعار الإلغاء تحمل دفعة البند الصريحة، وإلغاء الفاتورة يعيد الدفعات كلها', () => {
  const db = mkDb();
  buy(db, '2026-02-01', 'A', '2026-09-01', 10);
  buy(db, '2026-02-01', 'B', '2026-06-01', 10);
  const pick = sell(db, '2026-02-02', 3, { lot: 'A' });
  assert.equal(returnLines(db, pick, 'sreturn')[0].lot, 'A');
  const auto = sell(db, '2026-02-03', 12);
  const cn = cancelCreditNote(db, auto, { date: '2026-02-04' });
  assert.equal(cn.lines[0].lot, undefined, 'الفاتورة التلقائية لا دفعة صريحة فيها: المحرك يعيدها لدفعاتها');
  issue(db, cn);
  const B = buildBooks(db);
  assert.deepEqual(lots(B), { 'A|2026-09-01': 7, 'B|2026-06-01': 10 }, 'عادت دفعات الفاتورة الملغاة، وبقي سحب الفاتورة الأخرى');
  assert.deepEqual(B.issues, []);
});

test('مرتجع المشتريات: الدفعة المنسوخة تُسحب هي، وبلا دفعة تُسحب الأقرب انتهاءً ولو كانت منتهية', () => {
  const db = mkDb();
  const p1 = buy(db, '2026-01-01', 'EXP', '2026-01-20', 5);
  buy(db, '2026-01-01', 'OK', '2026-12-01', 5);
  const r = returnLines(db, p1, 'preturn')[0];
  assert.equal(r.lot, 'EXP');
  const a = issue(db, { type: 'preturn', date: '2026-02-01', party: 's1', refId: p1.id, vatRate: 0, paid: 8, payAcc: 'cash', lines: [{ product: 'L', qty: 2, price: 4, lot: 'EXP' }] });
  const b = issue(db, { type: 'preturn', date: '2026-02-02', party: 's1', vatRate: 0, paid: 4, payAcc: 'cash', lines: [{ product: 'L', qty: 1, price: 4 }] });
  const B = buildBooks(db);
  assert.deepEqual(pieces(B, a), ['EXP:2']);
  assert.deepEqual(pieces(B, b), ['EXP:1'], 'المنتهية أقرب انتهاءً فتخرج أولاً بلا اختيار');
  assert.deepEqual(lots(B), { 'EXP|2026-01-20': 2, 'OK|2026-12-01': 5 });
});

test('التسوية: الزيادة بدفعة أو بلا، والنقص بدفعة محددة أو بالأقرب انتهاءً (والمنتهية تُتلَف)', () => {
  const db = mkDb();
  buy(db, '2026-01-01', 'EXP', '2026-01-20', 5);
  buy(db, '2026-01-01', 'OK', '2026-12-01', 5);
  const a1 = issue(db, { type: 'adjust', date: '2026-02-01', account: 'adj', lines: [{ product: 'L', qty: 3, cost: '', lot: 'NEW', exp: '2027-03-01' }, { product: 'L', qty: 2, cost: '' }] });
  const a2 = issue(db, { type: 'adjust', date: '2026-02-02', account: 'adj', lines: [{ product: 'L', qty: -5 }] });
  const a3 = issue(db, { type: 'adjust', date: '2026-02-03', account: 'adj', lines: [{ product: 'L', qty: -1, lot: 'OK' }] });
  const B = buildBooks(db);
  assert.deepEqual(pieces(B, a1, 0), ['NEW:3']);
  assert.deepEqual(pieces(B, a1, 1), ['-:2']);
  assert.deepEqual(pieces(B, a2), ['-:2', 'EXP:3'], 'بلا دفعة أولاً ثم المنتهية الأقرب');
  assert.deepEqual(pieces(B, a3), ['OK:1']);
  assert.deepEqual(lots(B), { 'EXP|2026-01-20': 2, 'OK|2026-12-01': 4, 'NEW|2027-03-01': 3 });
});

test('التحويل بين المستودعات يحمل الدفعات بأرقامها وتواريخها ويتخطى المنتهي', () => {
  const db = mkDb({ warehouses: [{ id: 'w1', name: 'الرئيسي' }, { id: 'w2', name: 'الفرع' }] });
  buy(db, '2026-01-01', 'EXP', '2026-01-20', 4, { doc: { wh: 'w1' } });
  buy(db, '2026-01-01', 'A', '2026-09-01', 6, { doc: { wh: 'w1' } });
  buy(db, '2026-01-01', 'B', '2026-07-01', 6, { doc: { wh: 'w1' } });
  const t = issue(db, { type: 'stransfer', date: '2026-02-01', from: 'w1', to: 'w2', lines: [{ product: 'L', qty: 8 }] });
  const B = buildBooks(db);
  assert.deepEqual(pieces(B, t), ['B:6', 'A:2']);
  assert.deepEqual(lots(B, 'L', 'w1'), { 'EXP|2026-01-20': 4, 'A|2026-09-01': 4 });
  assert.deepEqual(lots(B, 'L', 'w2'), { 'B|2026-07-01': 6, 'A|2026-09-01': 2 });
  assert.equal(B.whQty.get('L').get('w2'), 8);
  // البيع من المستودع الثاني يرى دفعاته هو فقط
  const s = sell(db, '2026-02-02', 7, {}, { wh: 'w2' });
  const B2 = buildBooks(db);
  assert.deepEqual(pieces(B2, s), ['B:6', 'A:1']);
  assert.deepEqual(lots(B2, 'L', 'w1'), { 'EXP|2026-01-20': 4, 'A|2026-09-01': 4 });
});

test('دفعة مسماة تسدّ عجز «بلا دفعة» الناتج عن بيع سبق تسجيل الشراء', () => {
  const db = mkDb();
  sell(db, '2026-02-01', 4);
  buy(db, '2026-02-03', 'LATE', '2026-09-01', 10);
  const B = buildBooks(db);
  assert.deepEqual(lots(B), { 'LATE|2026-09-01': 6 }, 'العجز (4) سُدّ من الدفعة فلا يبقى سجل سالب');
  assert.equal(B.stock.get('L').qty, 6);
});

// القيود والتكلفة المتوسطة وكل ما في الدفاتر لا يتغير بتفعيل التتبع
test('تفعيل التتبع لا يغيّر القيود ولا التكلفة ولا المخزون: نفس الدفاتر حرفياً', () => {
  const build = (track) => {
    seq = 5000; // نفس المعرّفات في النسختين لتقارن القيود حرفياً
    const db = mkDb({ warehouses: [{ id: 'w1', name: 'أ' }, { id: 'w2', name: 'ب' }] });
    db.products[0].track = track;
    db.products[0].openQty = 7; db.products[0].openCost = 3.5;
    buy(db, '2026-02-01', 'A', '2026-09-01', 10, { doc: { wh: 'w1' } });
    buy(db, '2026-02-02', 'B', '2026-06-01', 20, { line: { price: 5 }, doc: { paid: 0, wh: 'w1' } });
    const s = sell(db, '2026-02-03', 12, {}, { wh: 'w1' });
    issue(db, { type: 'sreturn', date: '2026-02-04', party: 'c1', refId: s.id, vatRate: 0, paid: 30, payAcc: 'cash', wh: 'w1', lines: [{ product: 'L', qty: 3, price: 10 }] });
    issue(db, { type: 'adjust', date: '2026-02-05', account: 'adj', wh: 'w1', lines: [{ product: 'L', qty: -4 }, { product: 'L', qty: 2, cost: '' }] });
    issue(db, { type: 'stransfer', date: '2026-02-06', from: 'w1', to: 'w2', lines: [{ product: 'L', qty: 9 }] });
    issue(db, { type: 'preturn', date: '2026-02-07', party: 's1', vatRate: 0, paid: 0, wh: 'w1', lines: [{ product: 'L', qty: 2, price: 5 }] });
    sell(db, '2026-02-08', 5, {}, { wh: 'w2' });
    return buildBooks(db);
  };
  const on = build('lot'), off = build('');
  assert.deepEqual(on.postings, off.postings);
  assert.deepEqual([...on.stock], [...off.stock]);
  assert.deepEqual([...on.lineCosts], [...off.lineCosts]);
  assert.deepEqual(on.moves, off.moves);
  assert.deepEqual([...on.whQty].map(([k, m]) => [k, [...m]]), [...off.whQty].map(([k, m]) => [k, [...m]]));
  assert.deepEqual(on.issues, off.issues);
  assert.ok(on.lots.size > 0 && off.lots.size === 0);
});

// ── عشوائي: مجموع كميات الدفعات يساوي كمية المنتج دائماً، في كل مستودع ──
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
test('عشوائياً: مجموع الدفعات = كمية المنتج في كل مستودع وفي المجموع، مهما تنوّعت الحركات والترتيب', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const r = rng(seed * 7919);
    const multi = r() < 0.6;
    const db = mkDb(multi ? { warehouses: [{ id: 'w1', name: 'أ' }, { id: 'w2', name: 'ب' }] } : {});
    db.products.push({ id: 'M', name: 'ثان', type: 'stock', track: 'lot', price: 8, cost: 3, openQty: 5, openCost: 3 });
    db.products[0].openQty = Math.floor(r() * 9);
    if (r() < 0.5) db.products[0].openLots = [{ lot: 'O', exp: '2026-04-01', qty: Math.floor(r() * 5) }];
    const whs = multi ? ['w1', 'w2'] : [undefined];
    const sales = [];
    const n = 25 + Math.floor(r() * 25);
    for (let i = 0; i < n; i++) {
      const day = String(1 + Math.floor(r() * 27)).padStart(2, '0');
      const date = `2026-0${2 + Math.floor(r() * 2)}-${day}`;
      const pid = r() < 0.7 ? 'L' : 'M';
      const wh = whs[Math.floor(r() * whs.length)];
      const q = 1 + Math.floor(r() * 9);
      const whp = wh ? { wh } : {};
      const x = r();
      const lot = ['A', 'B', 'C', 'D'][Math.floor(r() * 4)];
      const exp = r() < 0.2 ? '' : `2026-0${3 + Math.floor(r() * 6)}-${day}`;
      if (x < 0.3) issue(db, { type: 'purchase', date, party: 's1', vatRate: 0, paid: q * 4, payAcc: 'cash', ...whp, lines: [{ product: pid, qty: q, price: 4, lot, exp }] });
      else if (x < 0.62) sales.push(issue(db, { type: 'sale', date, party: 'c1', vatRate: 0, paid: q * 10, payAcc: 'cash', ...whp, lines: [{ product: pid, qty: q, price: 10, ...(r() < 0.25 ? { lot } : {}) }] }));
      else if (x < 0.72 && sales.length) { const s = sales[Math.floor(r() * sales.length)]; issue(db, { type: 'sreturn', date, party: 'c1', refId: s.id, vatRate: 0, paid: 10, payAcc: 'cash', ...(s.wh ? { wh: s.wh } : {}), lines: [{ product: s.lines[0].product, qty: 1, price: 10, ...(r() < 0.2 ? { lot, exp } : {}) }] }); }
      else if (x < 0.82) issue(db, { type: 'adjust', date, account: 'adj', ...whp, lines: [{ product: pid, qty: r() < 0.5 ? q : -q, cost: '', ...(r() < 0.4 ? { lot, exp } : {}) }] });
      else if (x < 0.9) issue(db, { type: 'preturn', date, party: 's1', vatRate: 0, paid: 0, ...whp, lines: [{ product: pid, qty: q, price: 4, ...(r() < 0.4 ? { lot } : {}) }] });
      else if (multi) issue(db, { type: 'stransfer', date, from: 'w1', to: 'w2', lines: [{ product: pid, qty: q, ...(r() < 0.3 ? { lot } : {}) }] });
    }
    const B = buildBooks(db);
    for (const pid of ['L', 'M']) {
      const byWh = new Map();
      for (const rec of (B.lots.get(pid) || new Map()).values()) byWh.set(rec.wh, round((byWh.get(rec.wh) || 0) + rec.qty, 6));
      let total = 0;
      for (const [wh, q] of B.whQty.get(pid) || []) { assert.equal(round(byWh.get(wh) || 0, 5), round(q, 5), `seed ${seed} ${pid} ${wh}`); total += q; }
      for (const wh of byWh.keys()) assert.ok((B.whQty.get(pid) || new Map()).has(wh), `seed ${seed}: دفعة في مستودع بلا حركة ${wh}`);
      assert.equal(round(total, 5), round(B.stock.get(pid)?.qty || 0, 5), `seed ${seed} ${pid} المجموع`);
      for (const rec of (B.lots.get(pid) || new Map()).values()) assert.notEqual(rec.qty, 0, 'لا سجل بكمية صفر');
    }
  }
});

// ── التحقق قبل الحفظ ──
test('الشراء لمنتج متتبَّع يحتاج رقم دفعة أو تاريخ انتهاء، وتاريخ الانتهاء يكون صحيحاً', () => {
  const db = mkDb();
  const base = { type: 'purchase', date: '2026-02-01', party: 's1', vatRate: 0, paid: 0 };
  const v = (line, type = 'purchase') => validateDoc(db, { ...base, type, lines: [{ product: 'L', qty: 1, price: 4, ...line }] });
  assert.ok(v({}).lot0, 'بلا دفعة ولا تاريخ');
  assert.ok(v({ lot: '  ' }).lot0);
  assert.equal(v({ lot: 'A1' }).lot0, undefined, 'رقم الدفعة يكفي');
  assert.equal(v({ exp: '2027-01-31' }).lot0, undefined, 'تاريخ الانتهاء يكفي');
  assert.ok(v({ lot: 'A', exp: '2027-13-40' }).exp0, 'تاريخ غير صالح');
  assert.ok(v({ lot: 'x'.repeat(61) }).lot0, 'رقم دفعة طويل');
  // المبيعات والمرتجعات لا تُلزم
  assert.equal(v({}, 'sale').lot0, undefined);
  assert.equal(v({}, 'sreturn').lot0, undefined);
  assert.ok(v({ exp: 'غلط' }, 'sale').exp0, 'التاريخ الخاطئ مرفوض في كل المستندات');
  // منتج غير متتبَّع: الحقول تُهمل
  assert.deepEqual(validateDoc(db, { ...base, lines: [{ product: 'N', qty: 1, price: 2, lot: '', exp: 'غلط' }] }), {});
  // التسوية
  const adj = (line) => validateDoc(db, { type: 'adjust', date: '2026-02-01', account: 'adj', lines: [{ product: 'L', qty: 2, cost: '', ...line }] });
  assert.deepEqual(adj({}), {});
  assert.ok(adj({ exp: 'غلط' }).exp0);
});

test('نواقص البيع تعدّ الصالح فقط للمنتج المتتبَّع، وتفحص رصيد الدفعة التي اختارها البند', () => {
  const db = mkDb();
  buy(db, '2026-01-01', 'EXP', '2026-01-20', 5);
  buy(db, '2026-01-01', 'OK', '2026-12-01', 3);
  const B = buildBooks(db);
  const sale = (qty, line = {}) => ({ type: 'sale', date: '2026-02-01', vatRate: 0, lines: [{ product: 'L', qty, price: 10, ...line }] });
  assert.deepEqual(stockShortages(db, B, sale(3)), []);
  const sh = stockShortages(db, B, sale(4));
  assert.equal(sh.length, 1);
  assert.deepEqual([sh[0].want, sh[0].have, sh[0].expired], [4, 3, 5], 'المتوفر الصالح 3، وفي المخزون 5 منتهية');
  // بيع بتاريخ أقدم من الانتهاء: المنتهية لاحقاً صالحة وقتها
  assert.deepEqual(stockShortages(db, B, { ...sale(8), date: '2026-01-10' }), []);
  // دفعة محددة
  const pick = stockShortages(db, B, sale(4, { lot: 'OK' }));
  assert.ok(pick.some((x) => x.lot === 'OK' && x.have === 3 && x.want === 4));
  assert.deepEqual(stockShortages(db, B, sale(3, { lot: 'OK' })), []);
  // مرتجع المشتريات يعدّ كل المخزون (المنتهي يُرجَع للمورد)
  assert.deepEqual(stockShortages(db, B, { ...sale(8), type: 'preturn' }), []);
  assert.equal(stockShortages(db, B, { ...sale(9), type: 'preturn' }).length, 1);
  // التعديل: كمية المستند نفسه تُرد قبل المقارنة
  const s1 = sell(db, '2026-02-02', 3);
  const B2 = buildBooks(db);
  assert.deepEqual(stockShortages(db, B2, { ...s1 }, s1), [], 'تعديل بلا زيادة لا ينبّه');
  assert.equal(stockShortages(db, B2, sale(1)).length, 1, 'فاتورة جديدة: لم يبق صالح');
  // منتج غير متتبَّع يعمل كما كان
  const bn = stockShortages(db, B, { ...sale(1), lines: [{ product: 'N', qty: 1, price: 5 }] });
  assert.equal(bn.length, 1);
  assert.equal(bn[0].expired, undefined);
});

test('الدفعات المتاحة للاختيار: الأقرب انتهاءً أولاً، بلا المنتهية ولا «بلا دفعة»، وحسب المستودع', () => {
  const db = mkDb({ warehouses: [{ id: 'w1', name: 'أ' }, { id: 'w2', name: 'ب' }] });
  db.products[0].openQty = 3;
  buy(db, '2026-01-01', 'EXP', '2026-01-20', 5, { doc: { wh: 'w1' } });
  buy(db, '2026-01-01', 'LATE', '2026-12-01', 3, { doc: { wh: 'w1' } });
  buy(db, '2026-01-01', 'SOON', '2026-05-01', 2, { doc: { wh: 'w1' } });
  buy(db, '2026-01-01', 'OTHER', '2026-03-01', 9, { doc: { wh: 'w2' } });
  const B = buildBooks(db);
  const names = (xs) => xs.map((x) => x.lot);
  assert.deepEqual(names(lotChoices(B, 'L', 'w1', '2026-02-01')), ['SOON', 'LATE']);
  assert.deepEqual(names(lotChoices(B, 'L', 'w1', '2026-02-01', { expired: true })), ['EXP', 'SOON', 'LATE']);
  assert.deepEqual(names(lotChoices(B, 'L', 'w2', '2026-02-01')), ['OTHER']);
  assert.deepEqual(names(lotChoices(B, 'L', null, '2026-02-01')), ['OTHER', 'SOON', 'LATE']);
  assert.deepEqual(lotChoices(B, 'N', null, '2026-02-01'), []);
  assert.equal(MAIN_WH, 'main');
});

test('تقرير الدفعات: الحالة حسب أيام التنبيه، والقيمة بمتوسط التكلفة، والترتيب من الأخطر', () => {
  const db = mkDb();
  db.products[0].openQty = 2; db.products[0].openCost = 4;
  buy(db, '2026-01-01', 'EXP', '2026-01-20', 5);
  buy(db, '2026-01-01', 'SOON', '2026-02-20', 4);
  buy(db, '2026-01-01', 'OK', '2026-12-01', 3);
  buy(db, '2026-01-01', 'NOEXP', '', 1);
  const B = buildBooks(db);
  const R = lotReport(db, B, { today: '2026-02-01', alertDays: 30 });
  assert.deepEqual(R.rows.map((x) => [x.lot || '-', x.state]), [['EXP', 'expired'], ['SOON', 'soon'], ['-', 'none'], ['OK', 'ok'], ['NOEXP', 'ok']]);
  assert.deepEqual([R.expired.count, R.expired.qty, R.expired.value], [1, 5, 20]);
  assert.deepEqual([R.soon.count, R.soon.qty, R.soon.value], [1, 4, 16]);
  assert.equal(R.none.qty, 2);
  assert.equal(R.rows[0].days, -12);
  assert.equal(R.rows[1].days, 19);
  assert.equal(R.rows.find((x) => x.lot === 'NOEXP').days, null);
  assert.equal(lotReport(db, B, { today: '2026-02-01', alertDays: 10 }).soon.count, 0, 'ضيّق نافذة التنبيه');
  assert.equal(lotReport(db, B, { today: '2026-02-01', alertDays: 365 }).soon.count, 2);
  // الحد بالضبط: SOON تنتهي بعد 19 يوماً تماماً
  assert.equal(lotReport(db, B, { today: '2026-02-01', alertDays: 19 }).soon.count, 1, 'اليوم الأخير من النافذة يُنبَّه عليه');
  assert.equal(lotReport(db, B, { today: '2026-02-01', alertDays: 18 }).soon.count, 0);
  // اليوم نفسه ليس منتهياً بعد (0 يوم)
  assert.equal(lotReport(db, B, { today: '2026-02-20', alertDays: 30 }).rows.find((x) => x.lot === 'SOON').state, 'soon');
  assert.equal(lotReport(db, B, { today: '2026-02-21', alertDays: 30 }).rows.find((x) => x.lot === 'SOON').state, 'expired');
});

test('العجز السالب (بيع سبق الشراء) يظهر في التقرير بكميته السالبة ولا يُحتسب ضمن الرصيد الفعلي للتنبيه', () => {
  const db = mkDb();
  sell(db, '2026-02-01', 4);
  const B = buildBooks(db);
  const R = lotReport(db, B, { today: '2026-02-05' });
  assert.deepEqual(R.rows.map((x) => [x.state, x.qty]), [['none', -4]]);
  assert.equal(R.none.count, 0, 'السالب ليس رصيداً متوفراً');
});
