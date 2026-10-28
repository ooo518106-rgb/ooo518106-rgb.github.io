import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBooks, defaultAccounts, defaultSettings, calcDoc, incomeStatement } from '../js/core.js';
import { demoData } from '../js/demo.js';
import { PERIODS, rangeOf, summaryFacts, narrate, speechParts, shareText, makeFormat, dayName, headline } from '../js/insights.js';

let seq = 0;
const doc = (o) => ({ id: 'd' + (++seq), no: seq, createdAt: `2026-01-01T00:00:${String(seq % 60).padStart(2, '0')}.${String(seq).padStart(3, '0')}Z`, ...o });
const TODAY = '2026-10-26';

// متجر صغير بأرقام يسهل حسابها بالإيد (الدينار، بدون ضريبة)
function smallShop() {
  seq = 0;
  const accounts = defaultAccounts('JO');
  accounts.find((a) => a.id === 'cash').opening = 500;
  const p1 = { id: 'p1', name: 'سماعة', type: 'stock', unit: 'حبة', price: 25, cost: 10, tax: 'S', openQty: 100, openCost: 10, reorder: 95, active: true };
  const c1 = { id: 'c1', kind: 'customer', name: 'شركة الأفق', phone: '0791111111', opening: 0, createdAt: '2026-01-02T08:00:00.000Z' };
  const sale = (date, qty, extra = {}) => doc({ type: 'sale', date, party: null, vatRate: 0, inclusive: false, lines: [{ product: 'p1', desc: 'سماعة', qty, price: 25, disc: 0, tax: 'S' }], ...extra });
  const s0 = sale('2026-09-16', 4, { party: 'c1', dueDate: '2026-10-16', paid: 0, payAcc: null });
  const docs = [
    s0,
    sale(TODAY, 3, { paid: 75, payAcc: 'cash' }),
    sale(TODAY, 1, { party: 'c1', paid: 0, payAcc: null }),
    doc({ type: 'expense', date: TODAY, account: 'e_rent', amount: 40, tax: 'S', inclusive: false, vatRate: 0, paid: 40, payAcc: 'cash' }),
    doc({ type: 'receipt', date: TODAY, party: 'c1', amount: 30, money: 'cash', link: s0.id }),
  ];
  const db = { settings: defaultSettings({ name: 'محل تجربة', country: 'JO', startDate: '2026-01-01', vat: false, vatRate: 0 }), accounts, parties: [c1], products: [p1], docs, employees: [], warehouses: [], centers: [], seq: {} };
  return { db, B: buildBooks(db, { today: TODAY }) };
}

test('الفترات: اليوم وأمس وآخر 7 أيام والشهر، والفترة السابقة بنفس الطول', () => {
  assert.deepEqual(['today', 'yesterday', 'week', 'month'], Object.keys(PERIODS));
  const t = rangeOf('today', TODAY);
  assert.deepEqual([t.from, t.to, t.days, t.prev.from, t.prev.to], [TODAY, TODAY, 1, '2026-10-25', '2026-10-25']);
  const y = rangeOf('yesterday', TODAY);
  assert.deepEqual([y.from, y.to, y.prev.from], ['2026-10-25', '2026-10-25', '2026-10-24']);
  const w = rangeOf('week', TODAY);
  assert.deepEqual([w.from, w.to, w.days, w.prev.from, w.prev.to], ['2026-10-20', TODAY, 7, '2026-10-13', '2026-10-19']);
  const m = rangeOf('month', TODAY);
  assert.deepEqual([m.from, m.days, m.prev.from, m.prev.to], ['2026-10-01', 26, '2026-09-05', '2026-09-30']);
  assert.equal(rangeOf('غلط', TODAY).key, 'today', 'فترة غير معروفة ترجع لليوم');
  assert.equal(t.prevLabel, 'أمس');
  assert.equal(typeof t.prev, 'object', 'تسمية الفترة السابقة ما تمسح كائنها');
});

test('متجر صغير: كل رقم بالملخص يطابق الحساب بالإيد', () => {
  const { db, B } = smallShop();
  const f = summaryFacts(db, B, { preset: 'today', today: TODAY });
  assert.equal(f.active, true);
  assert.deepEqual([f.sales.count, f.sales.gross, f.sales.avg, f.sales.returnsCount, f.sales.credit], [2, 100, 50, 0, 25]);
  assert.deepEqual(f.sales.mix.map((x) => [x.acc, x.amount]), [['cash', 75]]);
  assert.deepEqual(f.top.map((x) => [x.name, x.qty, x.net]), [['سماعة', 4, 100]]);
  assert.deepEqual([f.profit.netSales, f.profit.sales, f.profit.margin, f.profit.expenses, f.profit.net], [100, 60, 60, 40, 20]);
  assert.deepEqual([f.cashFlow.in, f.cashFlow.out, f.cashFlow.net, f.cashFlow.balance, f.cashFlow.cash], [105, 40, 65, 565, 565]);
  assert.deepEqual([f.collected.count, f.collected.total, f.paid.count], [1, 30, 0]);
  assert.equal(f.newCustomers, 0);
  assert.deepEqual([f.attention.overdue.count, f.attention.overdue.total, f.attention.overdue.top[0].name], [1, 70, 'شركة الأفق']);
  assert.deepEqual(f.attention.low, [{ name: 'سماعة', qty: 92, unit: 'حبة' }]);
  assert.equal(f.attention.backupDays, -1, 'ما في نسخة احتياطية');
  assert.equal(f.attention.vat, 0, 'الضريبة مطفية');
  assert.equal(f.before.count, 0, 'أمس بلا مبيعات');
  // القيد نفسه: نفس صافي قائمة الدخل
  assert.equal(f.profit.net, incomeStatement(db, B, { from: TODAY, to: TODAY }).net);
});

test('الكلام: أرقام وعبارات المتجر الصغير للعرض وللسماع', () => {
  const { db, B } = smallShop();
  const f = summaryFacts(db, B, { preset: 'today', today: TODAY });
  const text = Object.fromEntries(narrate(f, 'text').map((s) => [s.id, s.text]));
  assert.match(text.sales, /^اليوم صار فاتورتين بيع، إجماليها 100\.000 د\.أ شامل الضريبة، بمتوسط 50\.000 د\.أ للفاتورة\./);
  assert.match(text.sales, /وما كان في مبيعات أمس/);
  assert.match(text.pay, /^الصندوق 75\.000 د\.أ وآجل 25\.000 د\.أ\.$/, 'العنوان ما ينعاد داخل الجملة بالعرض');
  assert.match(text.top, /^سماعة \(4 حبات\)\.$/);
  assert.match(text.profit, /ربح المبيعات بعد تكلفة البضاعة تقريباً 60\.000 د\.أ \(هامش 60%\)، ونزل مصاريف 40\.000 د\.أ، أكبرها: الإيجار 40\.000 د\.أ\. فصار الصافي ربح 20\.000 د\.أ\./);
  assert.match(text.cash, /دخل على الصندوق والبنوك 105\.000 د\.أ وطلع 40\.000 د\.أ \(الصافي 65\.000 د\.أ\)\. الرصيد الآن 565\.000 د\.أ، منه بالصندوق 565\.000 د\.أ\./);
  assert.match(text.dealings, /حصّلتوا من العملاء سند واحد بقيمة 30\.000 د\.أ/);
  assert.match(text.attention, /فاتورة متأخرة وحدة بمبلغ 70\.000 د\.أ على شركة الأفق\./);
  assert.match(text.attention, /بضاعة قاربت تخلص: سماعة \(باقي 92 حبة\)\./);
  assert.match(text.attention, /ما نزّلت نسخة احتياطية لحد الآن\./);
  const speech = Object.fromEntries(narrate(f, 'speech').map((s) => [s.id, s.text]));
  assert.match(speech.sales, /إجماليها 100 دينار شامل الضريبة/);
  assert.match(speech.pay, /^الدفع كان: الصندوق 75 دينار وآجل 25 دينار\.$/);
  assert.match(speech.top, /^الأكثر مبيعاً: سماعة \(4 حبات\)\.$/);
  assert.doesNotMatch(Object.values(speech).join(' '), /د\.أ|\.\d{3}/, 'للسماع: بدون رموز وكسور بالأرقام');
});

test('صيغة المبلغ: عرض بالرمز وسماع بالوحدة والكسور', () => {
  const t = makeFormat('JOD', 'text');
  assert.equal(t(1348.759), '1,348.759 د.أ');
  assert.equal(makeFormat('SAR', 'text')(12.5), '12.50 ر.س');
  const s = makeFormat('JOD', 'speech');
  assert.equal(s(150.5), '150 دينار و500 فلس');
  assert.equal(s(150), '150 دينار');
  assert.equal(s(0.75), '750 فلس');
  assert.equal(s(-20), 'ناقص 20 دينار');
  assert.equal(makeFormat('SAR', 'speech')(12.34), '12 ريال و34 هللة');
  assert.equal(makeFormat('AED', 'speech')(5), '5 درهم');
  assert.equal(makeFormat('IQD', 'speech')(1500), '1500 دينار');
  assert.equal(makeFormat('USD', 'speech')(9.05), '9 دولار و5 سنت');
});

test('المقارنة بالفترة السابقة بكلمات', () => {
  const { db, B } = smallShop();
  const base = summaryFacts(db, B, { preset: 'today', today: TODAY });
  const sales = (over, preset = 'today') => {
    const f = { ...base, range: { ...base.range, ...rangeOf(preset, TODAY) }, sales: { ...base.sales, gross: 120 }, before: { ...base.before, ...over } };
    return narrate(f, 'text').find((s) => s.id === 'sales').text;
  };
  assert.match(sales({ gross: 100 }), /وهاد أكتر من أمس بنسبة 20%\./);
  assert.match(sales({ gross: 118 }), /وهاد قريب من أمس\./);
  assert.match(sales({ gross: 0 }), /وما كان في مبيعات أمس\./);
  assert.match(sales({ gross: 20 }), /وهاد أكتر بكتير من أمس\./);
  assert.match(sales({ gross: 300 }), /وأمس كان الإجمالي 300\.000 د\.أ، واليوم لسّا ما خلص\./, 'اليوم ما خلص: بنذكر إجمالي أمس بدل نسبة مخيفة');
  assert.match(sales({ gross: 300 }, 'yesterday'), /وهاد أقل من قبل أمس بنسبة 60%\./);
  assert.match(sales({ gross: 100 }, 'week'), /^بآخر 7 أيام صار/);
  assert.match(sales({ gross: 100 }, 'week'), /أكتر من الأسبوع اللي قبله بنسبة 20%/);
});

test('يوم فاضي، ومبيعات بدون مبيعات، ومرتجعات', () => {
  const { db, B } = smallShop();
  const empty = summaryFacts(db, B, { preset: 'yesterday', today: TODAY });
  assert.equal(empty.active, false);
  const secs = narrate(empty, 'text');
  assert.equal(secs[0].text, 'أمس ما في أي حركة مسجّلة.');
  assert.equal(secs.at(-1).id, 'attention', 'التنبيهات بتضل ظاهرة حتى باليوم الفاضي');
  // يوم فيه مصروف بس
  const onlyExpense = { ...db, docs: [...db.docs.filter((d) => d.date !== TODAY), doc({ type: 'expense', date: TODAY, account: 'e_tel', amount: 12, tax: 'S', inclusive: false, vatRate: 0, paid: 12, payAcc: 'cash' })] };
  const f = summaryFacts(onlyExpense, buildBooks(onlyExpense, { today: TODAY }), { preset: 'today', today: TODAY });
  const t = Object.fromEntries(narrate(f, 'text').map((s) => [s.id, s.text]));
  assert.match(t.sales, /^اليوم ما في فواتير بيع\./);
  assert.match(t.profit, /^نزل مصاريف 12\.000 د\.أ، أكبرها: الاتصالات والإنترنت 12\.000 د\.أ\. فصار الصافي خسارة 12\.000 د\.أ\./);
  // مرتجع
  const withReturn = { ...db, docs: [...db.docs, doc({ type: 'sreturn', date: TODAY, party: null, refId: db.docs[1].id, vatRate: 0, inclusive: false, lines: [{ product: 'p1', desc: 'سماعة', qty: 1, price: 25, disc: 0, tax: 'S' }], paid: 25, payAcc: 'cash' })] };
  const r = summaryFacts(withReturn, buildBooks(withReturn, { today: TODAY }), { preset: 'today', today: TODAY });
  assert.deepEqual([r.sales.returnsCount, r.sales.returns, r.sales.total], [1, 25, 75]);
  assert.match(narrate(r, 'text')[0].text, /ورجّعوا فاتورة وحدة بقيمة 25\.000 د\.أ\./);
});

test('الوحدات: مفرد ومثنى وجمع، وغير المعروفة بدون تغيير', () => {
  const { db, B } = smallShop();
  const f = summaryFacts(db, B, { preset: 'today', today: TODAY });
  const topText = (top) => narrate({ ...f, top }, 'text').find((s) => s.id === 'top').text;
  assert.equal(topText([{ name: 'أ', qty: 1, unit: 'حبة' }, { name: 'ب', qty: 2, unit: 'حبة' }, { name: 'ج', qty: 5, unit: 'علبة' }]), 'أ (حبة)، ب (حبتين) وج (5 علب).');
  assert.equal(topText([{ name: 'أ', qty: 12, unit: 'حبة' }, { name: 'ب', qty: 2.5, unit: 'كيلو' }]), 'أ (12 حبة) وب (2.5 كيلو).');
  const low = narrate({ ...f, attention: { ...f.attention, low: [0, 1, 2, 3, 4].map((i) => ({ name: 'صنف' + i, qty: i, unit: 'حبة' })) } }, 'text').find((s) => s.id === 'attention').text;
  assert.match(low, /صنف0 \(باقي صفر\)، صنف1 \(باقي حبة\) وصنف2 \(باقي حبتين\) و2 غيرها\./);
});

test('البيانات التجريبية: كل الفترات وكل التواريخ بدون أخطاء وبأرقام متطابقة', () => {
  for (const today of ['2026-10-02', '2026-10-26', '2026-03-15', '2026-12-31']) {
    const demo = demoData(today);
    const db = { ...demo, seq: {} };
    const B = buildBooks(db, { today });
    for (const preset of Object.keys(PERIODS)) {
      const f = summaryFacts(db, B, { preset, today });
      const { from, to } = f.range;
      const mine = db.docs.filter((d) => d.type === 'sale' && d.date >= from && d.date <= to);
      assert.equal(f.sales.count, mine.length, `${today}/${preset}: عدد الفواتير`);
      const gross = Math.round(mine.reduce((s, d) => s + calcDoc(d, B.dec).total, 0) * 1000) / 1000;
      assert.equal(f.sales.gross, gross, `${today}/${preset}: إجمالي المبيعات`);
      const paid = f.sales.mix.reduce((s, x) => s + x.amount, 0);
      assert.ok(Math.abs(paid + f.sales.credit - f.sales.gross) < 0.0005, `${today}/${preset}: الدفع + الآجل = الإجمالي`);
      assert.ok(Math.abs(f.profit.net - incomeStatement(db, B, { from, to }).net) < 0.0005, `${today}/${preset}: الصافي`);
      for (const mode of ['text', 'speech']) {
        const secs = narrate(f, mode);
        assert.ok(secs.length >= 2 && secs.every((s) => s.text && !/undefined|NaN|\[object/.test(s.text)), `${today}/${preset}/${mode}: نصوص سليمة`);
      }
      assert.ok(f.cashFlow.balance === Math.round(f.cashFlow.balance * 1000) / 1000);
    }
  }
});

test('نص السماع: جمل قصيرة بلا رموز، والمشاركة فيها اسم المحل', () => {
  const demo = demoData(TODAY);
  const db = { ...demo, seq: {} };
  const B = buildBooks(db, { today: TODAY });
  const f = summaryFacts(db, B, { preset: 'today', today: TODAY });
  const parts = speechParts(f);
  assert.equal(parts[0].text, 'ملخص يوم الاثنين 26 أكتوبر.');
  assert.equal(parts.at(-1).id, 'end');
  assert.ok(parts.every((p) => p.text.length <= 220), 'كل جملة تكفي لقطعة سماع وحدة');
  const all = parts.map((p) => p.text).join(' ');
  assert.doesNotMatch(all, /د\.أ|🛍|⚠|[\u{1F300}-\u{1FAFF}]|\d\.\d{3}/u);
  assert.ok(parts.some((p) => p.text.startsWith('انتبه. ')), 'تنبيه السماع بيبدأ بكلمة «انتبه»');
  const week = speechParts(summaryFacts(db, B, { preset: 'week', today: TODAY }));
  assert.equal(week[0].text, 'ملخص آخر 7 أيام، من الثلاثاء 20 أكتوبر إلى الاثنين 26 أكتوبر.');
  const share = shareText(f, 'محل تجربة');
  assert.match(share, /^🗣️ ملخص يوم الاثنين 26 أكتوبر — محل تجربة\n\n🛍️ المبيعات: /);
  assert.equal(dayName('2026-01-01'), 'الخميس 1 يناير');
  const h = headline(f);
  assert.match(h.sales, /^اليوم صار 8 فواتير بيع/);
  assert.ok(h.warnings >= 1);
});

test('السعودية: «الهيئة» للضريبة، والريال بالسماع', () => {
  const db = { ...demoData(TODAY), seq: {} };
  db.settings = { ...db.settings, country: 'SA', currency: 'SAR' };
  const B = buildBooks(db, { today: TODAY });
  const f = summaryFacts(db, B, { preset: 'today', today: TODAY });
  const att = narrate(f, 'text').find((s) => s.id === 'attention').text;
  assert.match(att, /الضريبة المستحقة للهيئة لحد الآن/);
  assert.match(narrate(f, 'speech')[0].text, /ريال/);
});
