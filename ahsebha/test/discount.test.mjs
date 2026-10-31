// خصم الفاتورة كلها: يتوزع على البنود فتنحسب الضريبة بعده، ويبقى القيد والمخزون والمرتجع على أرقام البنود
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calcDoc, round, num, validateDoc, buildBooks, balances, trialBalance, cancelCreditNote, inheritedDiscount, returnLines,
  defaultAccounts, defaultSettings, currencyInfo, TAX_CATS,
} from '../js/core.js';

// المحرك القديم قبل خصم الفاتورة: كل ما بلا خصم فاتورة يجب أن يبقى بأرقامه كما هو
function oldCalc(doc, dec = 2) {
  const rate = num(doc.vatRate);
  const inc = !!doc.inclusive;
  const cats = () => ({ S: { net: 0, vat: 0 }, Z: { net: 0, vat: 0 }, E: { net: 0, vat: 0 }, O: { net: 0, vat: 0 } });
  const out = { lines: [], gross: 0, discount: 0, net: 0, vat: 0, total: 0, byCat: cats() };
  for (const l of doc.lines || []) {
    const qty = num(l.qty), price = num(l.price);
    const disc = Math.min(100, Math.max(0, num(l.disc)));
    const cat = TAX_CATS[l.tax] ? l.tax : 'S';
    const r = cat === 'S' ? rate : 0;
    const gross = round(qty * price, dec);
    const discount = round(gross * disc / 100, dec);
    const amount = round(gross - discount, dec);
    const net = inc ? round(amount / (1 + r / 100), dec) : amount;
    const vat = inc ? round(amount - net, dec) : round(net * r / 100, dec);
    const total = round(net + vat, dec);
    out.lines.push({ qty, price, disc, cat, rate: r, gross, discount, net, vat, total });
    out.gross += gross; out.discount += discount; out.net += net; out.vat += vat; out.total += total;
    out.byCat[cat].net += net; out.byCat[cat].vat += vat;
  }
  for (const k of ['gross', 'discount', 'net', 'vat', 'total']) out[k] = round(out[k], dec);
  for (const c of Object.values(out.byCat)) { c.net = round(c.net, dec); c.vat = round(c.vat, dec); }
  return out;
}

// مولّد أرقام عشوائية ثابت البذرة: يعيد نفس المستندات في كل تشغيل
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const randDoc = (r, dec, withDisc) => {
  const lines = Array.from({ length: 1 + Math.floor(r() * 5) }, () => ({
    product: null, desc: 'بند', qty: round(0.5 + r() * 9, 2), price: round(r() * 120, dec === 0 ? 0 : 3), disc: r() < 0.3 ? round(r() * 30, 1) : 0, tax: ['S', 'S', 'S', 'Z', 'E'][Math.floor(r() * 5)],
  }));
  const d = { vatRate: [0, 5, 15, 16][Math.floor(r() * 4)], inclusive: r() < 0.4, lines };
  if (withDisc) {
    const base = oldCalc(d, dec);
    if (r() < 0.5) { d.discMode = 'pct'; d.discVal = round(r() * 60, 2); } else { d.discMode = 'amt'; d.discVal = round(r() * (base.gross - base.discount), dec); }
  }
  return d;
};

test('بلا خصم فاتورة: أرقام الحساب مطابقة تماماً للمحرك القديم على آلاف المستندات العشوائية', () => {
  const r = rng(7);
  for (const dec of [0, 2, 3]) {
    for (let i = 0; i < 1500; i++) {
      const d = randDoc(r, dec, false);
      const a = calcDoc(d, dec);
      const b = oldCalc(d, dec);
      assert.equal(a.docDiscount, 0);
      for (const k of ['gross', 'discount', 'net', 'vat', 'total']) assert.equal(a[k], b[k], `${k} dec=${dec} ${JSON.stringify(d)}`);
      assert.deepEqual(a.byCat, b.byCat);
      a.lines.forEach((l, j) => { assert.equal(l.docDisc, 0); const { docDisc, ...rest } = l; assert.deepEqual(rest, b.lines[j]); });
    }
  }
});

test('نسبة على الفاتورة: تتوزع على البنود بنسبة مبالغها وتنحسب الضريبة بعدها', () => {
  const d = { vatRate: 16, lines: [{ qty: 2, price: 50, tax: 'S' }, { qty: 1, price: 100, tax: 'S' }], discMode: 'pct', discVal: 10 };
  const T = calcDoc(d, 3);
  assert.equal(T.gross, 200); assert.equal(T.discount, 0); assert.equal(T.docDiscount, 20);
  assert.deepEqual(T.lines.map((l) => l.docDisc), [10, 10]);
  assert.deepEqual(T.lines.map((l) => [l.net, l.vat, l.total]), [[90, 14.4, 104.4], [90, 14.4, 104.4]]);
  assert.deepEqual([T.net, T.vat, T.total], [180, 28.8, 208.8]);
  // بند فيه خصم خاص: الخصمان معاً، وحصة الفاتورة على ما بعد خصم البند
  const e = calcDoc({ vatRate: 0, lines: [{ qty: 1, price: 100, disc: 20, tax: 'S' }, { qty: 1, price: 20, tax: 'S' }], discMode: 'pct', discVal: 10 }, 2);
  assert.equal(e.discount, 20); assert.equal(e.docDiscount, 10); assert.deepEqual(e.lines.map((l) => l.docDisc), [8, 2]); assert.equal(e.total, 90);
});

test('مبلغ على الفاتورة: مجموع الحصص يساوي الخصم تماماً، والباقي من التقريب على آخر بند', () => {
  const d = { vatRate: 0, lines: [{ qty: 1, price: 33.33, tax: 'S' }, { qty: 1, price: 33.33, tax: 'S' }, { qty: 1, price: 33.34, tax: 'S' }], discMode: 'amt', discVal: 10 };
  const T = calcDoc(d, 2);
  assert.equal(T.docDiscount, 10);
  assert.equal(round(T.lines.reduce((s, l) => s + l.docDisc, 0), 2), 10);
  assert.deepEqual(T.lines.map((l) => l.docDisc), [3.33, 3.33, 3.34], 'الباقي (0.01) على آخر بند');
  assert.equal(T.total, 90);
  // لا تتجاوز حصة بند مبلغه
  const tiny = calcDoc({ vatRate: 0, lines: [{ qty: 1, price: 0.01, tax: 'S' }, { qty: 1, price: 0.01, tax: 'S' }, { qty: 1, price: 0.01, tax: 'S' }], discMode: 'amt', discVal: 0.02 }, 2);
  assert.equal(tiny.docDiscount, 0.02);
  assert.ok(tiny.lines.every((l) => l.docDisc >= 0 && l.docDisc <= 0.01 && l.net >= 0));
});

test('الأسعار الشاملة: الضريبة تُستخرج من السعر بعد الخصم', () => {
  const T = calcDoc({ vatRate: 16, inclusive: true, lines: [{ qty: 1, price: 116, tax: 'S' }], discMode: 'amt', discVal: 11.6 }, 3);
  assert.deepEqual([T.net, T.vat, T.total, T.docDiscount], [90, 14.4, 104.4, 11.6]);
});

test('فئات ضريبية مختلطة: لكل فئة حصتها، والضريبة على الخاضع فقط', () => {
  const T = calcDoc({ vatRate: 16, lines: [{ qty: 1, price: 100, tax: 'S' }, { qty: 1, price: 100, tax: 'Z' }, { qty: 1, price: 100, tax: 'E' }], discMode: 'pct', discVal: 10 }, 3);
  assert.deepEqual([T.byCat.S.net, T.byCat.Z.net, T.byCat.E.net], [90, 90, 90]);
  assert.deepEqual([T.byCat.S.vat, T.byCat.Z.vat, T.byCat.E.vat], [14.4, 0, 0]);
  assert.equal(T.total, 284.4);
});

test('حدود الخصم: 100٪ يصفّر الفاتورة، والمبلغ الأكبر يُقصّ عند قيمتها، والقيم الخاطئة تُهمل في الحساب وتُرفض في التحقق', () => {
  const lines = [{ qty: 2, price: 10, tax: 'S' }, { qty: 1, price: 5, tax: 'S' }];
  const full = calcDoc({ vatRate: 16, lines, discMode: 'pct', discVal: 100 }, 3);
  assert.deepEqual([full.net, full.vat, full.total, full.docDiscount], [0, 0, 0, 25]);
  const over = calcDoc({ vatRate: 0, lines, discMode: 'amt', discVal: 999 }, 3);
  assert.deepEqual([over.docDiscount, over.total], [25, 0]);
  for (const bad of [{ discMode: 'pct', discVal: -5 }, { discMode: 'amt', discVal: 0 }, { discMode: 'xx', discVal: 10 }, { discMode: '', discVal: 10 }, { discVal: 10 }]) {
    assert.equal(calcDoc({ vatRate: 0, lines, ...bad }, 3).docDiscount, 0, JSON.stringify(bad));
  }
  const db = { settings: defaultSettings({ country: 'JO', startDate: '2026-01-01' }), accounts: defaultAccounts('JO'), parties: [], products: [], docs: [] };
  const base = { type: 'sale', date: '2026-02-01', vatRate: 16, paid: 25, payAcc: 'cash', lines };
  assert.deepEqual(validateDoc(db, { ...base, paid: 0, party: null, discMode: '', discVal: '' }).disc, undefined);
  assert.match(validateDoc(db, { ...base, discMode: 'pct', discVal: 101 }).disc, /بين 0 و 100/);
  assert.match(validateDoc(db, { ...base, discMode: 'pct', discVal: -1 }).disc, /سالباً/);
  assert.match(validateDoc(db, { ...base, discMode: 'amt', discVal: 25.001 }).disc, /أكبر من قيمتها/);
  assert.match(validateDoc(db, { ...base, discMode: 'foo', discVal: 5 }).disc, /غير صحيح/);
  assert.equal(validateDoc(db, { ...base, paid: 0, party: null, discMode: 'amt', discVal: 25 }).disc, undefined, 'خصم بقيمة الفاتورة كلها مقبول');
});

const net = (db) => {
  const B = buildBooks(db, { today: '2026-12-31' });
  const bal = balances(B, { to: '2026-12-31' });
  const g = (id) => bal.get(id)?.close || 0;
  return { B, ar: g('ar'), sales: g('sales'), sret: g('sret'), vout: g('vout'), inv: g('inv'), cogs: g('cogs'), cash: g('cash') };
};
let seq = 0;
const issue = (db, d) => {
  d.id = d.id || 'd' + (++seq);
  d.createdAt = d.createdAt || `2026-01-01T00:01:${String(seq % 60).padStart(2, '0')}.${String(seq).padStart(4, '0')}Z`;
  d.no = d.no || db.docs.filter((x) => x.type === d.type).length + 1;
  db.docs.push(d);
  return d;
};
const mkDb = (country) => ({
  settings: defaultSettings({ country, name: 'متجر', vatNo: '12345678', startDate: '2026-01-01' }),
  accounts: defaultAccounts(country),
  parties: [{ id: 'c1', kind: 'customer', name: 'عميل' }],
  products: [{ id: 'P', name: 'منتج', type: 'stock', price: 10, cost: 4, openQty: 1000, openCost: 4 }, { id: 'Q', name: 'آخر', type: 'stock', price: 5, cost: 2, openQty: 1000, openCost: 2 }],
  docs: [],
});

test('القيود: المبيعات بالصافي بعد الخصم والضريبة بعده، والذمة بالإجمالي، والتكلفة لا تتأثر', () => {
  const db = mkDb('JO');
  const inv = issue(db, { type: 'sale', date: '2026-02-01', party: 'c1', vatRate: 16, paid: 0, lines: [{ product: 'P', qty: 10, price: 10, tax: 'S' }, { product: 'Q', qty: 4, price: 5, tax: 'S' }], discMode: 'amt', discVal: 7.77 });
  const T = calcDoc(inv, 3);
  assert.equal(T.docDiscount, 7.77);
  const n = net(db);
  assert.deepEqual(n.B.issues, []);
  assert.equal(-n.sales, T.net, 'المبيعات (دائن) بالصافي بعد الخصم'); assert.equal(-n.vout, T.vat, 'ضريبة المخرجات بعد الخصم'); assert.equal(n.ar, T.total);
  assert.equal(n.cogs, round(10 * 4 + 4 * 2, 3), 'تكلفة المبيعات كما هي');
  assert.ok(trialBalance(db, n.B, { to: '2026-12-31' }).balanced);
  assert.equal(n.B.totals.get(inv.id).docDiscount, 7.77);
});

test('إلغاء فاتورة بخصم: الإشعار الدائن يرث الخصم ويعكس الفاتورة تماماً (مبلغ ونسبة، بثلاث عملات)', () => {
  for (const country of ['JO', 'SA', 'IQ']) {
    const dec = currencyInfo(defaultSettings({ country }).currency).dec;
    for (const disc of [{ discMode: 'amt', discVal: round(7.77, dec) || 1 }, { discMode: 'pct', discVal: 12.5 }]) {
      const db = mkDb(country);
      const inv = issue(db, { type: 'sale', date: '2026-02-01', party: 'c1', vatRate: 15, paid: 0, lines: [{ product: 'P', qty: 7, price: 13.37, tax: 'S' }, { product: 'Q', qty: 3, price: 9.99, disc: 5, tax: 'S' }, { desc: 'خدمة', qty: 1, price: 21.5, tax: 'Z' }], ...disc });
      const cn = cancelCreditNote(db, inv, { date: '2026-02-10' });
      assert.equal(cn.discMode, 'pct');
      assert.deepEqual(validateDoc(db, cn), {}, country);
      assert.equal(calcDoc(cn, dec).total, calcDoc(inv, dec).total, `${country} ${disc.discMode}: الإشعار بنفس إجمالي الفاتورة`);
      issue(db, cn);
      const n = net(db);
      assert.deepEqual(n.B.issues, []);
      assert.equal(n.ar, 0, `${country} ${disc.discMode}: الذمة صفر`);
      assert.equal(round(n.sales + n.sret, dec), 0);
      assert.equal(n.vout, 0);
    }
  }
});

test('مرتجع جزئي ثم إلغاء الباقي: يرث الخصم متناسباً، والذمة تعود صفراً (حتى فلس تقريب واحد)', () => {
  const db = mkDb('JO');
  const inv = issue(db, { type: 'sale', date: '2026-02-01', party: 'c1', vatRate: 16, paid: 0, lines: [{ product: 'P', qty: 10, price: 10, tax: 'S' }, { product: 'Q', qty: 4, price: 5, tax: 'S' }], discMode: 'amt', discVal: 13 });
  const inh = inheritedDiscount(db, inv);
  assert.equal(inh.discMode, 'pct');
  const lines = returnLines(db, inv, 'sreturn').map((l) => (l.product === 'P' ? { ...l, qty: 3 } : { ...l, qty: 0 })).filter((l) => l.qty > 0);
  const part = issue(db, { type: 'sreturn', date: '2026-02-05', party: 'c1', refId: inv.id, vatRate: 16, paid: 0, lines, ...inh });
  assert.deepEqual(validateDoc(db, part), {});
  // المرتجع الجزئي يعكس حصته من الخصم: 3 من 10 من البند الأول
  const T0 = calcDoc(inv, 3);
  const Tp = calcDoc(part, 3);
  assert.ok(Math.abs(Tp.docDiscount - round(T0.lines[0].docDisc * 3 / 10, 3)) <= 0.002, 'حصة الخصم متناسبة');
  const cn = cancelCreditNote(db, inv, { date: '2026-02-10' });
  assert.deepEqual(validateDoc(db, cn), {});
  issue(db, cn);
  const n = net(db);
  assert.ok(Math.abs(n.ar) <= 0.002, 'الذمة بعد المرتجع والإلغاء: ' + n.ar);
  assert.ok(Math.abs(n.vout) <= 0.002 && Math.abs(round(n.sales + n.sret, 3)) <= 0.002);
});

test('وراثة الخصم: لا شيء بلا خصم، ونفس النسبة لخصم نسبة، والمبلغ يتحول إلى نسبة من القيمة قبله', () => {
  const db = mkDb('JO');
  const plain = issue(db, { type: 'sale', date: '2026-02-01', party: 'c1', vatRate: 16, paid: 0, lines: [{ product: 'P', qty: 1, price: 10, tax: 'S' }] });
  assert.equal(inheritedDiscount(db, plain), null);
  const pct = issue(db, { type: 'sale', date: '2026-02-01', party: 'c1', vatRate: 16, paid: 0, lines: [{ product: 'P', qty: 1, price: 10, tax: 'S' }], discMode: 'pct', discVal: 7.5 });
  assert.deepEqual(inheritedDiscount(db, pct), { discMode: 'pct', discVal: 7.5 });
  const amt = issue(db, { type: 'sale', date: '2026-02-01', party: 'c1', vatRate: 16, paid: 0, lines: [{ product: 'P', qty: 4, price: 25, disc: 10, tax: 'S' }], discMode: 'amt', discVal: 9 });
  assert.deepEqual(inheritedDiscount(db, amt), { discMode: 'pct', discVal: 10 }, '9 من 90 (بعد خصم البند) = 10٪');
});

test('عشوائي: مجموع الحصص = الخصم، وصافي + ضريبة = إجمالي، وإلغاء كل الفواتير يصفّر الدفاتر (3 عملات)', () => {
  const r = rng(2026);
  for (const country of ['JO', 'SA', 'IQ']) {
    const dec = currencyInfo(defaultSettings({ country }).currency).dec;
    const db = mkDb(country);
    const invs = [];
    for (let i = 0; i < 120; i++) {
      const d = randDoc(r, dec, true);
      const T = calcDoc(d, dec);
      const sum = round(T.gross - T.discount, dec);
      const want = Math.min(sum, d.discMode === 'pct' ? round(sum * d.discVal / 100, dec) : round(d.discVal, dec));
      assert.equal(T.docDiscount, want, `${country} ${JSON.stringify(d)}`);
      assert.equal(round(T.lines.reduce((s, l) => s + l.docDisc, 0), dec), T.docDiscount);
      for (const l of T.lines) {
        assert.ok(l.docDisc >= 0 && l.net >= 0 && l.vat >= 0, JSON.stringify(l));
        assert.equal(round(l.net + l.vat, dec), l.total);
      }
      assert.equal(round(T.lines.reduce((s, l) => s + l.total, 0), dec), T.total);
      assert.equal(round(T.byCat.S.net + T.byCat.Z.net + T.byCat.E.net + T.byCat.O.net, dec), T.net);
      if (sum > 0) invs.push(issue(db, { type: 'sale', date: '2026-02-01', party: i % 3 ? 'c1' : '', vatRate: d.vatRate, inclusive: d.inclusive, lines: d.lines.map((l) => ({ ...l, product: null })), discMode: d.discMode, discVal: d.discVal, ...(i % 3 ? { paid: 0 } : { paid: T.total, payAcc: 'cash' }) }));
    }
    const n1 = net(db);
    assert.deepEqual(n1.B.issues, [], country);
    assert.ok(trialBalance(db, n1.B, { to: '2026-12-31' }).balanced, country);
    for (const inv of invs) { const cn = cancelCreditNote(db, inv, { date: '2026-02-20' }); assert.deepEqual(validateDoc(db, cn), {}, `${country} ${JSON.stringify(inv.lines)}`); issue(db, cn); }
    const n2 = net(db);
    assert.deepEqual(n2.B.issues, [], country);
    const tol = dec === 0 ? 0 : 10 ** -dec;
    assert.ok(Math.abs(n2.ar) <= tol * invs.length && Math.abs(n2.vout) <= tol * invs.length, `${country}: ar ${n2.ar} vout ${n2.vout}`);
    assert.equal(n2.ar, 0, `${country}: الذمة صفر تماماً بعد إلغاء الكل`);
    assert.equal(n2.vout, 0, `${country}: ضريبة المخرجات صفر تماماً`);
    assert.equal(round(n2.sales + n2.sret, dec), 0, `${country}: المبيعات صفر تماماً`);
  }
});
