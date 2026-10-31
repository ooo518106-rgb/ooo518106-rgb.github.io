// قوائم الأسعار: سعر المنتج حسب قائمة العميل (نسبة وسعر خاص ووحدات)، وحفظ القوائم وحذفها وربطها بالعملاء والنسخ الاحتياطي
import test from 'node:test';
import assert from 'node:assert/strict';
import { listPrice, defaultAccounts, defaultSettings } from '../js/core.js';
import * as store from '../js/store.js';
import { FEATURES, PLANS, planFeatures } from '../js/plans.js';
import * as L from '../js/license.js';

L.useStorage(L.memoryStorage());
const dbOf = (country = 'JO', lists = []) => ({ settings: defaultSettings({ country, startDate: '2026-01-01' }), accounts: defaultAccounts(country), priceLists: lists });
const WHOLE = { id: 'pl1', name: 'جملة', pct: -10 };
const VIP = { id: 'pl2', name: 'VIP', pct: -20 };
const MARK = { id: 'pl3', name: 'سياحي', pct: 25 };

test('بلا قائمة أو قائمة مجهولة: السعر الأساسي بلا أي تغيير', () => {
  const p = { id: 'a', price: 12.345 };
  const db = dbOf('JO', [WHOLE]);
  assert.equal(listPrice(db, p, ''), 12.345);
  assert.equal(listPrice(db, p, null), 12.345);
  assert.equal(listPrice(db, p, 'nope'), 12.345);
  assert.equal(listPrice(db, p, 'pl1') !== 12.345, true);
});

test('نسبة القائمة: خصم أو زيادة، ويُقرَّب لخانات العملة', () => {
  const db = dbOf('JO', [WHOLE, VIP, MARK, { id: 'z', name: 'صفر', pct: 0 }, { id: 'all', name: 'مجاني', pct: -100 }, { id: 'over', name: 'أكثر', pct: -150 }]);
  const p = { id: 'a', price: 10 };
  assert.equal(listPrice(db, p, 'pl1'), 9);
  assert.equal(listPrice(db, p, 'pl2'), 8);
  assert.equal(listPrice(db, p, 'pl3'), 12.5);
  assert.equal(listPrice(db, p, 'z'), 10);
  assert.equal(listPrice(db, p, 'all'), 0);
  assert.equal(listPrice(db, p, 'over'), 0, 'لا سعر سالباً');
  assert.equal(listPrice(db, { price: 0.45 }, 'pl1'), 0.405, 'الدينار ثلاث خانات');
  assert.equal(listPrice(dbOf('SA', [WHOLE]), { price: 0.45 }, 'pl1'), 0.41, 'الريال خانتان');
  assert.equal(listPrice(dbOf('IQ', [WHOLE]), { price: 1250 }, 'pl1'), 1125, 'الدينار العراقي بلا كسور');
  assert.equal(listPrice(dbOf('IQ', [WHOLE]), { price: 1255 }, 'pl1'), 1130);
});

test('سعر المنتج الخاص بالقائمة يتقدم على النسبة، وفارغ يتبع النسبة', () => {
  const db = dbOf('JO', [WHOLE, VIP]);
  const p = { id: 'a', price: 10, listPrices: { pl1: 7.5 } };
  assert.equal(listPrice(db, p, 'pl1'), 7.5, 'خاص');
  assert.equal(listPrice(db, p, 'pl2'), 8, 'قائمة أخرى بلا سعر خاص: النسبة');
  assert.equal(listPrice(db, { ...p, listPrices: { pl1: '' } }, 'pl1'), 9, 'فارغ');
  assert.equal(listPrice(db, { ...p, listPrices: { pl1: 0 } }, 'pl1'), 0, 'الصفر سعر صريح (هدية)');
  assert.equal(listPrice(db, { ...p, listPrices: { pl1: -3 } }, 'pl1'), 9, 'السالب يُهمل');
});

test('الوحدات: السعر الخاص يُضرب بمعامل الوحدة، وسعر الوحدة المكتوب لا يتأثر بالسعر الخاص بل بالنسبة', () => {
  const db = dbOf('JO', [WHOLE]);
  const carton = { name: 'كرتون', factor: 12, price: '' };
  assert.equal(listPrice(db, { id: 'a', price: 2 }, '', carton), 24, 'بلا قائمة: السعر × المعامل');
  assert.equal(listPrice(db, { id: 'a', price: 2 }, 'pl1', carton), 21.6, 'نسبة القائمة على سعر الكرتون المحسوب');
  assert.equal(listPrice(db, { id: 'a', price: 2, listPrices: { pl1: 1.5 } }, 'pl1', carton), 18, 'السعر الخاص للوحدة الأساسية × 12');
  const priced = { name: 'كرتون', factor: 12, price: 20 };
  assert.equal(listPrice(db, { id: 'a', price: 2 }, '', priced), 20, 'سعر الوحدة المكتوب');
  assert.equal(listPrice(db, { id: 'a', price: 2 }, 'pl1', priced), 18, 'النسبة على سعر الوحدة المكتوب');
  assert.equal(listPrice(db, { id: 'a', price: 2, listPrices: { pl1: 1.5 } }, 'pl1', priced), 18, 'السعر الخاص لا يلغي سعر الوحدة المكتوب');
});

test('الحفظ والحذف: العملاء يُفكّ ارتباطهم وأسعار المنتجات الخاصة تُمسح', () => {
  store.replaceDb({ app: 'ahsebha-accounting', settings: defaultSettings({ country: 'JO', name: 'م', startDate: '2026-01-01' }), accounts: defaultAccounts('JO'), parties: [], products: [], docs: [] });
  assert.deepEqual(store.getDb().priceLists, []);
  const a = store.savePriceList({ name: 'جملة', pct: -10 });
  const b = store.savePriceList({ name: 'VIP', pct: -20 });
  assert.match(a.id, /^pl/); assert.notEqual(a.id, b.id);
  assert.equal(store.findPriceList(a.id).name, 'جملة');
  const c1 = store.saveParty({ kind: 'customer', name: 'عميل 1', priceList: a.id });
  store.saveParty({ kind: 'customer', name: 'عميل 2', priceList: b.id });
  store.saveParty({ kind: 'customer', name: 'عميل 3', priceList: a.id });
  const prod = store.saveProduct({ name: 'منتج', type: 'service', price: 10, listPrices: { [a.id]: 7, [b.id]: 6 } });
  assert.equal(store.priceListUsage(a.id), 2);
  // تعديل الاسم والنسبة
  store.savePriceList({ id: a.id, name: 'جملة كبار', pct: -12 });
  assert.deepEqual([store.findPriceList(a.id).name, store.findPriceList(a.id).pct], ['جملة كبار', -12]);
  assert.equal(store.getDb().priceLists.length, 2);
  // السعر من بيانات المخزن الفعلية
  assert.equal(listPrice(store.getDb(), store.findProduct(prod.id), store.findParty(c1.id).priceList), 7);
  // الحذف
  store.deletePriceList(a.id);
  assert.equal(store.findPriceList(a.id), null);
  assert.deepEqual(store.getDb().parties.map((p) => p.priceList).sort(), ['', '', b.id].sort());
  assert.deepEqual(store.findProduct(prod.id).listPrices, { [b.id]: 6 });
  assert.equal(store.priceListUsage(b.id), 1);
  // بعد الحذف يعود العميل للسعر العادي
  assert.equal(listPrice(store.getDb(), store.findProduct(prod.id), store.findParty(c1.id).priceList), 10);
});

test('النسخة الاحتياطية تحفظ القوائم وأسعارها، والملفات القديمة بلا قوائم تُفتح سليمة', () => {
  const json = store.backupJSON();
  const back = store.parseBackup(json);
  assert.equal(back.priceLists.length, 1);
  assert.deepEqual(back.products[0].listPrices && Object.values(back.products[0].listPrices), [6]);
  const old = store.parseBackup(JSON.stringify({ app: 'ahsebha-accounting', settings: { country: 'JO' }, accounts: [], parties: [], products: [], docs: [] }));
  assert.deepEqual(old.priceLists, []);
  const junk = store.parseBackup(JSON.stringify({ app: 'ahsebha-accounting', settings: { country: 'JO' }, accounts: [], parties: [], products: [], docs: [], priceLists: [{ id: 'x' }, { name: 'بلا معرّف' }, { id: 'ok', name: 'سليمة', pct: 5 }, 'text', null] }));
  assert.deepEqual(junk.priceLists.map((l) => l.id), ['ok']);
});

test('قوائم الأسعار ميزة تُباع: موجودة في القائمة وفي الباقة الاحترافية فقط، وتُقفل عند تفعيل الاشتراكات لمن لا يملكها', () => {
  assert.ok(FEATURES.some((f) => f.id === 'pricelists'));
  assert.ok(planFeatures('pro').includes('pricelists'));
  assert.ok(!PLANS.basic.features.includes('pricelists'));
});
