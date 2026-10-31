// الأرقام التسلسلية والكفالة: طبقة تتبع فوق المخزون، لكل قطعة سجلها: دخولها وبيعها وكفالتها وإرجاعها
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildBooks, validateDoc, serialConflicts, serialChoices, serialReport, returnLines, cancelCreditNote, isSerialTracked, serialKey, lineSerials,
  defaultAccounts, defaultSettings, round,
} from '../js/core.js';

let seq = 0;
const issue = (db, d) => {
  d.id = d.id || 's' + (++seq);
  d.createdAt = d.createdAt || `2026-01-01T00:02:${String(seq % 60).padStart(2, '0')}.${String(seq).padStart(5, '0')}Z`;
  d.no = d.no || db.docs.filter((x) => x.type === d.type).length + 1;
  db.docs.push(d);
  return d;
};
const mkDb = (extra = {}) => ({
  settings: defaultSettings({ country: 'JO', name: 'متجر إلكترونيات', startDate: '2026-01-01' }),
  accounts: defaultAccounts('JO'),
  parties: [{ id: 'c1', kind: 'customer', name: 'أحمد' }, { id: 'c2', kind: 'customer', name: 'سعاد' }, { id: 's1', kind: 'supplier', name: 'المورد' }],
  products: [{ id: 'P', name: 'هاتف', type: 'stock', track: 'serial', warrantyMonths: 12, price: 100, cost: 60, openQty: 0, openCost: 60 }, { id: 'N', name: 'عادي', type: 'stock', price: 5, cost: 2, openQty: 0, openCost: 2 }],
  docs: [],
  warehouses: [],
  ...extra,
});
const buy = (db, date, serials, o = {}) => issue(db, { type: 'purchase', date, party: 's1', vatRate: 0, paid: 0, lines: [{ product: 'P', qty: serials.length, price: 60, serials }], ...o });
const sell = (db, date, serials, o = {}) => issue(db, { type: 'sale', date, party: 'c1', vatRate: 0, paid: 0, lines: [{ product: 'P', qty: serials.length, price: 100, serials }], ...o });
const rec = (B, s, pid = 'P') => (B.serials.get(pid) || new Map()).get(serialKey(s));
const status = (B, pid = 'P') => { const o = {}; for (const r of (B.serials.get(pid) || new Map()).values()) o[r.serial] = r.status; return o; };

test('منتج بلا تتبع بالأرقام: لا طبقة ولا أثر', () => {
  const db = mkDb();
  issue(db, { type: 'purchase', date: '2026-02-01', party: 's1', vatRate: 0, paid: 0, lines: [{ product: 'N', qty: 3, price: 2, serials: ['X1', 'X2', 'X3'] }] });
  const B = buildBooks(db);
  assert.equal(B.serials.size, 0);
  assert.deepEqual(B.serialIssues, []);
  assert.equal(isSerialTracked(db.products[0]), true);
  assert.equal(isSerialTracked(db.products[1]), false);
  assert.equal(isSerialTracked({ type: 'service', track: 'serial' }), false);
  assert.deepEqual(lineSerials({ serials: [' a ', '', null, 'b'] }), ['a', 'b']);
  assert.deepEqual(lineSerials({}), []);
});

test('دورة حياة الرقم: يدخل بالشراء، يُباع بكفالة، يرجع من العميل، ثم يُباع من جديد', () => {
  const db = mkDb();
  const p = buy(db, '2026-02-01', ['A1', 'A2', 'A3']);
  const s1 = sell(db, '2026-03-10', ['A1', 'A2']);
  let B = buildBooks(db);
  assert.deepEqual(status(B), { A1: 'sold', A2: 'sold', A3: 'in' });
  const r = rec(B, 'A1');
  assert.deepEqual([r.soldDoc, r.soldDate, r.party, r.warrantyEnd], [s1.id, '2026-03-10', 'c1', '2027-03-10'], 'الكفالة 12 شهراً من تاريخ البيع');
  assert.deepEqual(r.events.map((e) => e.t), ['in', 'sale']);
  assert.equal(r.events[0].doc, p.id);
  // ترجع من العميل
  const ret = issue(db, { type: 'sreturn', date: '2026-03-20', party: 'c1', refId: s1.id, vatRate: 0, paid: 0, lines: [{ product: 'P', qty: 1, price: 100, serials: ['A1'] }] });
  B = buildBooks(db);
  assert.deepEqual(status(B), { A1: 'in', A2: 'sold', A3: 'in' });
  assert.deepEqual([rec(B, 'A1').soldDoc, rec(B, 'A1').party, rec(B, 'A1').warrantyEnd], ['', '', ''], 'بيانات البيع والكفالة تُمسح عند الإرجاع');
  assert.deepEqual(rec(B, 'A1').events.map((e) => e.t), ['in', 'sale', 'return']);
  assert.equal(rec(B, 'A1').events[2].doc, ret.id);
  // تُباع لعميل آخر
  const s2 = sell(db, '2026-04-01', ['A1'], { party: 'c2' });
  B = buildBooks(db);
  assert.deepEqual([rec(B, 'A1').soldDoc, rec(B, 'A1').party, rec(B, 'A1').warrantyEnd], [s2.id, 'c2', '2027-04-01']);
  assert.deepEqual(B.serialIssues, []);
  assert.deepEqual(serialChoices(B, 'P'), ['A3'], 'المباع لا يُعرض للاختيار');
});

test('الكفالة: من تاريخ البيع بأشهر المنتج، وبلا أشهر لا كفالة، ونهاية الشهر تُقصّ', () => {
  const db = mkDb();
  db.products[0].warrantyMonths = 6;
  buy(db, '2026-01-01', ['M1', 'M2']);
  sell(db, '2026-08-31', ['M1']);
  let B = buildBooks(db);
  assert.equal(rec(B, 'M1').warrantyEnd, '2027-02-28', '31 آب + 6 أشهر = 28 شباط');
  db.products[0].warrantyMonths = 0;
  B = buildBuild(db);
  assert.equal(rec(B, 'M1').warrantyEnd, '');
  db.products[0].warrantyMonths = 'abc';
  B = buildBuild(db);
  assert.equal(rec(B, 'M1').warrantyEnd, '');
});
const buildBuild = (db) => buildBooks(db);

test('الأرقام لا تفرّق بين الحروف الكبيرة والصغيرة ولا الفراغات الجانبية', () => {
  const db = mkDb();
  buy(db, '2026-02-01', ['sn-001 ', 'SN-002']);
  sell(db, '2026-02-02', [' SN-001', 'sn-002']);
  const B = buildBooks(db);
  assert.deepEqual(status(B), { 'sn-001': 'sold', 'SN-002': 'sold' }, 'بنفس الرقم رغم اختلاف الكتابة، وبالنص المسجّل أول مرة');
  assert.deepEqual(B.serialIssues, []);
  assert.equal(serialKey(' ab-1 '), 'AB-1');
});

test('الرصيد الافتتاحي بأرقام: لا يتجاوز كمية الافتتاح', () => {
  const db = mkDb();
  db.products[0].openQty = 3;
  db.products[0].openSerials = ['O1', 'O2', 'O3', 'O4', ' '];
  const B = buildBooks(db);
  assert.deepEqual(status(B), { O1: 'in', O2: 'in', O3: 'in' });
  assert.equal(rec(B, 'O1').events[0].t, 'opening');
  db.products[0].openSerials = ['O1'];
  assert.deepEqual(status(buildBooks(db)), { O1: 'in' }, 'ما لم يُكتب رقمه (قطعتان) يبقى بلا رقم');
  assert.equal(buildBooks(db).stock.get('P').qty, 3);
});

test('مرتجع المورد والتسوية بالنقص يُخرجان الرقم، والتسوية بالزيادة تُدخله', () => {
  const db = mkDb();
  buy(db, '2026-02-01', ['A1', 'A2', 'A3']);
  issue(db, { type: 'preturn', date: '2026-02-05', party: 's1', vatRate: 0, paid: 0, lines: [{ product: 'P', qty: 1, price: 60, serials: ['A1'] }] });
  issue(db, { type: 'adjust', date: '2026-02-06', account: 'adj', lines: [{ product: 'P', qty: -1, serials: ['A2'] }, { product: 'P', qty: 2, cost: '', serials: ['F1', 'F2'] }] });
  const B = buildBooks(db);
  assert.deepEqual(status(B), { A1: 'out', A2: 'out', A3: 'in', F1: 'in', F2: 'in' });
  assert.deepEqual(rec(B, 'A1').events.map((e) => e.t), ['in', 'preturn']);
  assert.deepEqual(rec(B, 'A2').events.map((e) => e.t), ['in', 'adjust']);
  assert.equal(B.stock.get('P').qty, 3);
  assert.deepEqual(B.serialIssues, []);
});

test('التحويل بين المستودعات ينقل الرقم', () => {
  const db = mkDb({ warehouses: [{ id: 'w1', name: 'أ' }, { id: 'w2', name: 'ب' }] });
  buy(db, '2026-02-01', ['A1', 'A2'], { wh: 'w1' });
  issue(db, { type: 'stransfer', date: '2026-02-03', from: 'w1', to: 'w2', lines: [{ product: 'P', qty: 1, serials: ['A2'] }] });
  const B = buildBooks(db);
  assert.equal(rec(B, 'A1').wh, 'w1');
  assert.equal(rec(B, 'A2').wh, 'w2');
  assert.deepEqual(rec(B, 'A2').events.map((e) => e.t), ['in', 'transfer']);
  assert.deepEqual(serialChoices(B, 'P', 'w1'), ['A1']);
  assert.deepEqual(serialChoices(B, 'P', 'w2'), ['A2']);
  assert.deepEqual(serialChoices(B, 'P'), ['A1', 'A2']);
  // رقم غير متوفر للتحويل
  issue(db, { type: 'stransfer', date: '2026-02-04', from: 'w1', to: 'w2', lines: [{ product: 'P', qty: 1, serials: ['ZZ'] }] });
  assert.ok(buildBooks(db).serialIssues.some((x) => /غير متوفر للتحويل/.test(x.msg)));
});

test('الشذوذات تُسجَّل ولا تكسر الدفاتر: شراء مكرر، بيع رقم مجهول، بيع رقم مباع', () => {
  const db = mkDb();
  buy(db, '2026-02-01', ['A1', 'A2']);
  buy(db, '2026-02-02', ['A1']);
  sell(db, '2026-02-03', ['A2']);
  sell(db, '2026-02-04', ['A2']);
  sell(db, '2026-02-05', ['GHOST']);
  const B = buildBooks(db);
  const msgs = B.serialIssues.map((x) => `${x.serial}:${x.msg}`);
  assert.ok(msgs.some((m) => /^A1:.*موجود في المخزون مسبقاً/.test(m)), msgs.join('|'));
  assert.ok(msgs.some((m) => /^A2:.*مباع مسبقاً/.test(m)));
  assert.ok(msgs.some((m) => /^GHOST:.*لم يُسجَّل دخوله/.test(m)));
  assert.deepEqual(B.issues.filter((x) => x.serial), [], 'ليست من ملاحظات القيود');
  assert.equal(serialReport(db, B).issues, 3);
});

test('مرتجع بنفس يوم الفاتورة يلحق بيعها: ينتهي الرقم في المخزون لا قبل بيعه', () => {
  const db = mkDb();
  buy(db, '2026-02-01', ['A1']);
  const s = sell(db, '2026-02-05', ['A1']);
  issue(db, { type: 'sreturn', date: '2026-02-05', party: 'c1', refId: s.id, vatRate: 0, paid: 0, lines: [{ product: 'P', qty: 1, price: 100, serials: ['A1'] }] });
  const B = buildBooks(db);
  assert.equal(rec(B, 'A1').status, 'in');
  assert.deepEqual(rec(B, 'A1').events.map((e) => e.t), ['in', 'sale', 'return']);
  assert.deepEqual(B.serialIssues, []);
});

test('تفعيل التتبع بالأرقام لا يغيّر القيود ولا التكلفة ولا المخزون: نفس الدفاتر حرفياً', () => {
  const build = (track) => {
    seq = 7000;
    const db = mkDb({ warehouses: [{ id: 'w1', name: 'أ' }, { id: 'w2', name: 'ب' }] });
    db.products[0].track = track;
    db.products[0].openQty = 2; db.products[0].openSerials = ['O1', 'O2'];
    buy(db, '2026-02-01', ['A1', 'A2', 'A3'], { wh: 'w1' });
    const s = sell(db, '2026-02-03', ['A1', 'O1'], { wh: 'w1' });
    issue(db, { type: 'sreturn', date: '2026-02-04', party: 'c1', refId: s.id, vatRate: 0, paid: 0, wh: 'w1', lines: [{ product: 'P', qty: 1, price: 100, serials: ['A1'] }] });
    issue(db, { type: 'adjust', date: '2026-02-05', account: 'adj', wh: 'w1', lines: [{ product: 'P', qty: -1, serials: ['A3'] }] });
    issue(db, { type: 'stransfer', date: '2026-02-06', from: 'w1', to: 'w2', lines: [{ product: 'P', qty: 1, serials: ['A2'] }] });
    return buildBooks(db);
  };
  const on = build('serial'), off = build('');
  assert.deepEqual(on.postings, off.postings);
  assert.deepEqual([...on.stock], [...off.stock]);
  assert.deepEqual([...on.lineCosts], [...off.lineCosts]);
  assert.deepEqual(on.moves, off.moves);
  assert.deepEqual([...on.whQty].map(([k, m]) => [k, [...m]]), [...off.whQty].map(([k, m]) => [k, [...m]]));
  assert.deepEqual(on.issues, off.issues);
  assert.ok(on.serials.size > 0 && off.serials.size === 0);
});

// ── عشوائي: عدد الأرقام في المخزون يساوي كمية المنتج دائماً، في كل مستودع، حين تُسجَّل كل الحركات بأرقامها ──
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
test('عشوائياً: الأرقام في المخزون = كمية المنتج في كل مستودع وفي المجموع', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const r = rng(seed * 104729);
    const multi = r() < 0.6;
    const db = mkDb(multi ? { warehouses: [{ id: 'w1', name: 'أ' }, { id: 'w2', name: 'ب' }] } : {});
    const whs = multi ? ['w1', 'w2'] : [undefined];
    // حالة تُجاري الدفاتر لنولّد حركات صحيحة فقط: الأرقام الموجودة في كل مستودع، والمباعة
    const inWh = new Map(whs.map((w) => [w || 'main', []]));
    const sold = [];
    let n = 0;
    const days = [];
    for (let i = 0; i < 40 + Math.floor(r() * 30); i++) days.push(1 + Math.floor(r() * 27));
    days.sort((a, b) => a - b);
    for (const dd of days) {
      const date = `2026-03-${String(dd).padStart(2, '0')}`;
      const w = whs[Math.floor(r() * whs.length)];
      const key = w || 'main';
      const whp = w ? { wh: w } : {};
      const x = r();
      const have = inWh.get(key);
      if (x < 0.35 || !have.length) {
        const k = 1 + Math.floor(r() * 3);
        const sn = Array.from({ length: k }, () => 'SN' + (++n));
        buy(db, date, sn, whp); have.push(...sn);
      } else if (x < 0.65) {
        const k = Math.min(have.length, 1 + Math.floor(r() * 2));
        const sn = have.splice(0, k);
        const d = sell(db, date, sn, whp); sold.push({ d, sn: [...sn], key });
      } else if (x < 0.78 && sold.length) {
        const sdx = sold.splice(Math.floor(r() * sold.length), 1)[0];
        const one = sdx.sn.splice(0, 1);
        issue(db, { type: 'sreturn', date: date < sdx.d.date ? sdx.d.date : date, party: 'c1', refId: sdx.d.id, vatRate: 0, paid: 0, ...(sdx.d.wh ? { wh: sdx.d.wh } : {}), lines: [{ product: 'P', qty: 1, price: 100, serials: one }] });
        inWh.get(sdx.key).push(...one);
        if (sdx.sn.length) sold.push(sdx);
      } else if (x < 0.86 && have.length) {
        const sn = have.splice(0, 1);
        issue(db, { type: 'adjust', date, account: 'adj', ...whp, lines: [{ product: 'P', qty: -1, serials: sn }] });
      } else if (x < 0.93) {
        const sn = ['AD' + (++n)];
        issue(db, { type: 'adjust', date, account: 'adj', ...whp, lines: [{ product: 'P', qty: 1, cost: '', serials: sn }] });
        have.push(...sn);
      } else if (multi && have.length) {
        const to = key === 'w1' ? 'w2' : 'w1';
        const sn = have.splice(0, 1);
        issue(db, { type: 'stransfer', date, from: key, to, lines: [{ product: 'P', qty: 1, serials: sn }] });
        inWh.get(to).push(...sn);
      }
    }
    // كل مستند يمرّ من التحقق، ولا مخالفات
    for (const d of db.docs) assert.deepEqual(validateDoc(db, d), {}, `seed ${seed} ${d.type}`);
    const B = buildBooks(db);
    assert.deepEqual(B.serialIssues, [], `seed ${seed}`);
    const perWh = new Map();
    let total = 0;
    for (const x of (B.serials.get('P') || new Map()).values()) if (x.status === 'in') { perWh.set(x.wh, (perWh.get(x.wh) || 0) + 1); total++; }
    assert.equal(total, round(B.stock.get('P')?.qty || 0, 6), `seed ${seed}: المجموع`);
    for (const [wh, q] of B.whQty.get('P') || []) assert.equal(perWh.get(wh) || 0, round(q, 6), `seed ${seed}: ${wh}`);
    // وما هو عندنا في المحاكاة هو نفسه في الدفاتر
    for (const [key, list] of inWh) for (const sn of list) { const rr = rec(B, sn); assert.ok(rr && rr.status === 'in' && rr.wh === key, `seed ${seed}: ${sn} في ${key}`); }
  }
});

// ── التحقق قبل الحفظ ──
test('عدد الأرقام يساوي الكمية بلا تكرار، والكمية قطع صحيحة، وفي كل أنواع المستندات التي تحرّك المخزون', () => {
  const db = mkDb();
  const doc = (type, line, o = {}) => ({ type, date: '2026-02-01', party: type === 'purchase' || type === 'preturn' ? 's1' : 'c1', vatRate: 0, paid: 0, lines: [{ product: 'P', price: 10, ...line }], ...o });
  for (const type of ['purchase', 'sale', 'sreturn', 'preturn']) {
    assert.ok(validateDoc(db, doc(type, { qty: 2, serials: ['A'] })).serials0, `${type}: ناقص`);
    assert.ok(validateDoc(db, doc(type, { qty: 1, serials: ['A', 'B'] })).serials0, `${type}: زائد`);
    assert.ok(validateDoc(db, doc(type, { qty: 2 })).serials0, `${type}: بلا أرقام`);
    assert.deepEqual(validateDoc(db, doc(type, { qty: 2, serials: ['A', 'B'] })), {}, `${type}: صحيح`);
  }
  assert.ok(validateDoc(db, doc('sale', { qty: 1.5, serials: ['A'] })).qty0, 'كمية كسرية');
  assert.match(validateDoc(db, doc('sale', { qty: 2, serials: ['A', 'a '] })).serials0, /مكرر/, 'تكرار بالحروف');
  assert.match(validateDoc(db, doc('sale', { qty: 1, serials: ['X'] }, { lines: [{ product: 'P', qty: 1, price: 1, serials: ['X'] }, { product: 'P', qty: 1, price: 1, serials: ['x'] }] })).serials1, /مكرر/, 'تكرار بين بندين');
  // وحدة بمعامل: الكرتون 3 قطع = 3 أرقام لكل كرتون
  assert.deepEqual(validateDoc(db, doc('sale', { qty: 1, factor: 3, unit: 'كرتون', serials: ['A', 'B', 'C'] })), {});
  assert.ok(validateDoc(db, doc('sale', { qty: 1, factor: 3, unit: 'كرتون', serials: ['A'] })).serials0);
  // العروض والأوامر لا تُحرّك مخزوناً فلا تُلزم
  assert.deepEqual(validateDoc(db, doc('quote', { qty: 2 })), {});
  assert.deepEqual(validateDoc(db, { ...doc('sorder', { qty: 2 }), party: 'c1' }), {});
  // منتج غير متتبَّع يتجاهل الأرقام
  assert.deepEqual(validateDoc(db, { ...doc('sale', {}), lines: [{ product: 'N', qty: 3, price: 5, serials: ['X'] }] }), {});
  // التسوية: الفرق بالقيمة المطلقة
  const adj = (qty, serials) => validateDoc(db, { type: 'adjust', date: '2026-02-01', account: 'adj', lines: [{ product: 'P', qty, cost: '', serials }] });
  assert.deepEqual(adj(2, ['A', 'B']), {});
  assert.deepEqual(adj(-2, ['A', 'B']), {});
  assert.ok(adj(-2, ['A']).serials0);
  assert.ok(adj(2, []).serials0);
  // التحويل
  const tr = (qty, serials) => validateDoc({ ...db, warehouses: [{ id: 'w1', name: 'أ' }, { id: 'w2', name: 'ب' }] }, { type: 'stransfer', date: '2026-02-01', from: 'w1', to: 'w2', lines: [{ product: 'P', qty, serials }] });
  assert.deepEqual(tr(1, ['A']), {});
  assert.ok(tr(2, ['A']).serials0);
});

test('فاتورة قديمة سبقت التتبع تُعدَّل بلا إلزام، لكن لو كتب فيها أرقاماً وجب أن تطابق الكمية', () => {
  const db = mkDb();
  const old = issue(db, { type: 'sale', date: '2026-02-01', party: 'c1', vatRate: 0, paid: 0, lines: [{ product: 'P', qty: 3, price: 100 }] });
  assert.deepEqual(validateDoc(db, { ...old, notes: 'تعديل' }), {});
  assert.ok(validateDoc(db, { ...old, lines: [{ product: 'P', qty: 3, price: 100, serials: ['A'] }] }).serials0);
  // مستند جديد (بلا id) يُلزَم دائماً
  const { id, ...fresh } = old;
  assert.ok(validateDoc(db, fresh).serials0);
});

test('بنود المرتجع تحمل الأرقام التي لم تُرجَع بعد فقط، وإشعار الإلغاء يرجّع ما بقي', () => {
  const db = mkDb();
  buy(db, '2026-02-01', ['A1', 'A2', 'A3', 'A4']);
  const s = sell(db, '2026-02-02', ['A1', 'A2', 'A3']);
  let lines = returnLines(db, s, 'sreturn');
  assert.deepEqual(lines[0].serials, ['A1', 'A2', 'A3']);
  // إرجاع جزئي: قطعتان، ثم ما تبقى
  issue(db, { type: 'sreturn', date: '2026-02-03', party: 'c1', refId: s.id, vatRate: 0, paid: 0, lines: [{ product: 'P', qty: 2, price: 100, serials: ['A2', 'A1'] }] });
  lines = returnLines(db, s, 'sreturn');
  assert.equal(lines[0].qty, 1);
  assert.deepEqual(lines[0].serials, ['A3'], 'الأرقام المُرجَعة لا تُنسخ ثانية');
  const cn = cancelCreditNote(db, s, { date: '2026-02-04' });
  assert.deepEqual(cn.lines[0].serials, ['A3']);
  assert.deepEqual(validateDoc(db, cn), {});
  issue(db, cn);
  const B = buildBooks(db);
  assert.deepEqual(status(B), { A1: 'in', A2: 'in', A3: 'in', A4: 'in' });
  assert.deepEqual(B.serialIssues, []);
  // مرتجع قديم بلا أرقام (قبل التتبع) أنقص الكمية المتاحة: لا تُنسخ أرقام أكثر من الكمية
  const db2 = mkDb();
  buy(db2, '2026-02-01', ['B1', 'B2', 'B3']);
  const s2 = sell(db2, '2026-02-02', ['B1', 'B2', 'B3']);
  issue(db2, { type: 'sreturn', date: '2026-02-03', party: 'c1', refId: s2.id, vatRate: 0, paid: 0, lines: [{ product: 'P', qty: 2, price: 100 }] });
  const l2 = returnLines(db2, s2, 'sreturn');
  assert.equal(l2[0].qty, 1);
  assert.equal(l2[0].serials.length, 1, 'رقم واحد لقطعة واحدة');
  // بند بلا أرقام (فاتورة قبل التتبع) لا يتأثر
  const noSn = issue(db, { type: 'sale', date: '2026-02-05', party: 'c1', vatRate: 0, paid: 0, lines: [{ product: 'N', qty: 2, price: 5 }] });
  assert.equal(returnLines(db, noSn, 'sreturn')[0].serials, undefined);
});

test('تعارضات الحفظ: دخول رقم موجود، وخروج رقم مجهول أو مباع أو خارج، وتكرار داخل المستند', () => {
  const db = mkDb();
  buy(db, '2026-02-01', ['A1', 'A2', 'A3']);
  const s = sell(db, '2026-02-02', ['A1']);
  issue(db, { type: 'preturn', date: '2026-02-03', party: 's1', vatRate: 0, paid: 0, lines: [{ product: 'P', qty: 1, price: 60, serials: ['A3'] }] });
  const base = { date: '2026-02-10', vatRate: 0, paid: 0 };
  const kinds = (doc, existing) => serialConflicts(db, doc, existing).map((x) => `${x.kind}:${x.serial}`);
  assert.deepEqual(kinds({ type: 'purchase', party: 's1', ...base, lines: [{ product: 'P', qty: 2, serials: ['A2', 'NEW'] }] }), ['dup-in:A2'], 'A2 في المخزون');
  assert.deepEqual(kinds({ type: 'purchase', party: 's1', ...base, lines: [{ product: 'P', qty: 2, serials: ['A1', 'A3'] }] }), [], 'المباع والخارج يجوز استلامهما من جديد');
  assert.deepEqual(kinds({ type: 'sale', party: 'c1', ...base, lines: [{ product: 'P', qty: 4, serials: ['A2', 'A1', 'A3', 'ZZ'] }] }), ['sold:A1', 'gone:A3', 'unknown:ZZ']);
  assert.deepEqual(kinds({ type: 'sale', party: 'c1', ...base, lines: [{ product: 'P', qty: 2, serials: ['A2', 'a2'] }] }), ['dup-doc:a2']);
  assert.deepEqual(kinds({ type: 'sreturn', party: 'c1', ...base, lines: [{ product: 'P', qty: 1, serials: ['A1'] }] }), [], 'ارتجاع المباع سليم');
  assert.deepEqual(kinds({ type: 'adjust', account: 'adj', ...base, lines: [{ product: 'P', qty: -1, serials: ['A1'] }] }), ['sold:A1']);
  assert.deepEqual(kinds({ type: 'sale', party: 'c1', ...base, lines: [{ product: 'N', qty: 1 }] }), [], 'منتج بلا تتبع');
  // تعديل فاتورة البيع نفسها: رقمها لا يُحسب مباعاً من نفسها
  assert.deepEqual(kinds({ ...s, notes: 'تعديل' }, s), []);
  assert.deepEqual(kinds({ ...s, lines: [{ product: 'P', qty: 1, price: 100, serials: ['A2'] }] }, s), [], 'تغيير الرقم المباع إلى رقم في المخزون');
  assert.deepEqual(kinds({ ...s, lines: [{ product: 'P', qty: 1, price: 100, serials: ['A3'] }] }, s), ['gone:A3']);
  // الدفاتر الأصلية لم تُمسّ
  assert.equal(rec(buildBooks(db), 'A1').status, 'sold');
});

test('تقرير الأرقام: الحالات والكفالة (سارية، قريبة، منتهية) وحدودها، والعدّ والترتيب', () => {
  const db = mkDb();
  db.parties.push({ id: 'c3', kind: 'customer', name: 'ليلى' });
  buy(db, '2025-01-01', ['S1', 'S2', 'S3', 'S4', 'S5', 'S6']);
  sell(db, '2025-02-01', ['S1'], { party: 'c1' });         // كفالتها حتى 2026-02-01
  sell(db, '2025-03-01', ['S2'], { party: 'c2' });         // حتى 2026-03-01
  sell(db, '2025-06-01', ['S3'], { party: 'c3' });         // حتى 2026-06-01
  issue(db, { type: 'preturn', date: '2026-01-05', party: 's1', vatRate: 0, paid: 0, lines: [{ product: 'P', qty: 1, price: 60, serials: ['S6'] }] });
  const B = buildBooks(db);
  const R = serialReport(db, B, { today: '2026-02-20', alertDays: 30 });
  const by = Object.fromEntries(R.rows.map((r) => [r.serial, r]));
  assert.equal(by.S1.warranty, 'expired');
  assert.equal(by.S2.warranty, 'soon');
  assert.equal(by.S3.warranty, 'active');
  assert.equal(by.S4.warranty, 'none', 'في المخزون بلا كفالة');
  assert.deepEqual([by.S1.days, by.S2.days], [-19, 9]);
  assert.equal(by.S2.partyName, 'سعاد');
  assert.equal(by.S2.inDate, '2025-01-01', 'تاريخ أول دخول للمخزون');
  assert.equal(by.S2.inDoc, db.docs[0].id);
  assert.equal(by.S2.soldDoc, db.docs[2].id);
  assert.equal(by.S2.soldDate, '2025-03-01');
  assert.deepEqual([R.inStock, R.sold, R.gone], [2, 3, 1]);
  assert.deepEqual([R.active, R.soon, R.expired], [1, 1, 1]);
  assert.deepEqual(R.rows.map((r) => r.serial), ['S1', 'S2', 'S3', 'S4', 'S5', 'S6'], 'مرتبة بالمنتج ثم الرقم رقمياً');
  // حدود النافذة: الكفالة تنتهي بعد 9 أيام تماماً
  assert.equal(serialReport(db, B, { today: '2026-02-20', alertDays: 9 }).soon, 1);
  assert.equal(serialReport(db, B, { today: '2026-02-20', alertDays: 8 }).soon, 0);
  assert.equal(serialReport(db, B, { today: '2026-03-01', alertDays: 0 }).rows.find((r) => r.serial === 'S2').warranty, 'soon', 'يوم الانتهاء نفسه ما زالت سارية وتُنبَّه (آخر يوم)');
  assert.equal(serialReport(db, B, { today: '2026-02-28', alertDays: 0 }).rows.find((r) => r.serial === 'S2').warranty, 'active', 'قبل يوم من الانتهاء وبلا مهلة تنبيه: سارية');
  assert.equal(serialReport(db, B, { today: '2026-03-02', alertDays: 0 }).rows.find((r) => r.serial === 'S2').warranty, 'expired');
});
