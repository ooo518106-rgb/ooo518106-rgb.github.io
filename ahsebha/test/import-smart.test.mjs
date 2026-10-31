// الاستيراد الذكي من Excel: التعرّف على الأعمدة من العناوين ومن المحتوى، وصف العناوين، والأوراق المتعددة
import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeTable, buildRecords, findHeaderRow, asNumber, profileColumn, guessMapping } from '../js/imports.js';
import { writeXlsx, readXlsxSheets, readXlsx } from '../js/xlsx.js';
import { defaultAccounts, defaultSettings } from '../js/core.js';

const db = (products = []) => ({ settings: defaultSettings({ country: 'JO', name: 'م' }), accounts: defaultAccounts('JO'), parties: [], products, docs: [] });
const MATERIALS = [
  ['مشروبات غازية', 'كولا 330 مل', 0.25, 0.4], ['مشروبات غازية', 'سفن اب 330 مل', 0.25, 0.4], ['مشروبات غازية', 'فانتا برتقال 330 مل', 0.25, 0.4],
  ['مشروبات غازية', 'ماء معدني 500 مل', 0.1, 0.2], ['منظفات', 'سائل جلي 750 مل', 1.1, 1.75], ['منظفات', 'مسحوق غسيل 3 كغ', 3.9, 5.5],
  ['منظفات', 'منعم أقمشة 2 لتر', 2.2, 3.1], ['معلبات', 'تونة 185 غ', 0.7, 1.1], ['معلبات', 'فول مدمس 400 غ', 0.35, 0.6], ['معلبات', 'حمص حب 400 غ', 0.4, 0.65],
];

test('ملف المالك: الصنف والمادة وسعر الشراء وسعر البيع — المادة اسم والصنف تصنيف', () => {
  const rows = [['اسم الصنف', 'اسم المادة', 'سعر الشراء', 'سعر البيع'], ...MATERIALS];
  const a = analyzeTable(rows, 'products');
  assert.equal(a.headerRow, 0);
  assert.deepEqual(a.mapping, { name: 1, category: 0, cost: 2, price: 3 });
  assert.deepEqual(a.notes, [], 'لا ملاحظات: العناوين صريحة والمحتوى يؤكدها');
  const recs = buildRecords(a.data, a.mapping, 'products', db(), { rowNos: a.rowNos });
  assert.equal(recs.length, 10);
  assert.ok(recs.every((r) => r.action === 'new'));
  assert.deepEqual([recs[0].rec.name, recs[0].rec.category, recs[0].rec.cost, recs[0].rec.price], ['كولا 330 مل', 'مشروبات غازية', 0.25, 0.4]);
  assert.equal(recs[0].row, 2); assert.equal(recs[9].row, 11);
  assert.equal(recs[0].rec.openCost, 0.25, 'التكلفة تصير تكلفة افتتاحية للمنتج الجديد');
});

test('لو العكس (الصنف أسماء متنوعة والمادة تصنيفات مكررة): المحتوى يغلب العنوان', () => {
  const rows = [['اسم الصنف', 'اسم المادة', 'سعر الشراء', 'سعر البيع'], ...MATERIALS.map(([cat, name, c, p]) => [name, cat, c, p])];
  const a = analyzeTable(rows, 'products');
  assert.equal(a.mapping.name, 0, 'الأسماء المتنوعة هي الاسم');
  assert.equal(a.mapping.category, 1);
  assert.match(a.notes.join(' '), /بدّلتُ/);
  assert.equal(a.how.name, 'content');
});

test('عمود «الصنف» وحده يكون الاسم، ومع عمود التصنيف الصريح يبقى اسماً', () => {
  const a = analyzeTable([['الصنف', 'سعر الشراء', 'سعر البيع'], ['كولا', 1, 2], ['فانتا', 1, 2]], 'products');
  assert.deepEqual(a.mapping, { name: 0, cost: 1, price: 2 });
  const b = analyzeTable([['الصنف', 'التصنيف', 'سعر الشراء', 'سعر البيع'], ['كولا', 'مشروبات', 1, 2], ['فانتا', 'مشروبات', 1, 2], ['تونة', 'معلبات', 1, 2]], 'products');
  assert.deepEqual(b.mapping, { name: 0, category: 1, cost: 2, price: 3 });
});

test('عناوين قبل الجدول وأسطر فارغة: يجد صف العناوين ويحفظ أرقام الأسطر الحقيقية', () => {
  const rows = [['قائمة أسعار محل النور'], [], ['التاريخ', '2026-10-30'], ['اسم الصنف', 'اسم المادة', 'سعر الشراء', 'سعر البيع'], ...MATERIALS.slice(0, 3)];
  assert.equal(findHeaderRow(rows, 'products'), 3);
  const a = analyzeTable(rows, 'products');
  assert.equal(a.headerRow, 3);
  assert.deepEqual(a.mapping, { name: 1, category: 0, cost: 2, price: 3 });
  assert.deepEqual(a.rowNos, [5, 6, 7]);
  const recs = buildRecords(a.data, a.mapping, 'products', db(), { rowNos: a.rowNos });
  assert.deepEqual(recs.map((r) => r.row), [5, 6, 7]);
  // التكرار داخل الملف يذكر رقم السطر الحقيقي
  const dup = buildRecords([...a.data, ['مشروبات غازية', 'كولا 330 مل', 1, 2]], a.mapping, 'products', db(), { rowNos: [...a.rowNos, 8] });
  assert.match(dup[3].errors.join(' '), /السطر 5/);
});

test('أرقام عربية وفواصل ورموز عملة ونصوص: asNumber', () => {
  assert.equal(asNumber(3.5), 3.5);
  assert.equal(asNumber('١٢٫٥٠'), 12.5);
  assert.equal(asNumber('1,250.50'), 1250.5);
  assert.equal(asNumber('0,25'), 0.25, 'فاصلة عشرية بأسلوب أوروبي');
  assert.equal(asNumber('12,5'), 12.5);
  assert.equal(asNumber('1,250'), 1250, 'ثلاث خانات بعد الفاصلة = آلاف');
  assert.equal(asNumber('1,250,000'), 1250000);
  assert.equal(asNumber('0.250 د.أ'), 0.25);
  assert.equal(asNumber('15 JOD'), 15);
  assert.equal(asNumber('$ 9.99'), 9.99);
  assert.equal(asNumber('-4'), -4);
  assert.equal(asNumber('كولا'), NaN);
  assert.equal(asNumber('A12'), NaN);
  assert.equal(asNumber(''), NaN);
  assert.equal(asNumber(null), NaN);
  assert.equal(asNumber('12-5'), NaN);
});

test('الأسعار نصوصاً بعملات وأرقام عربية تُستورد صحيحة', () => {
  const rows = [['المادة', 'سعر الشراء', 'سعر البيع'], ['كولا', '٠٫٢٥٠ د.أ', '٠٫٤٠٠ د.أ'], ['تونة', '0.70 JD', '1.100']];
  const a = analyzeTable(rows, 'products');
  const recs = buildRecords(a.data, a.mapping, 'products', db(), { rowNos: a.rowNos });
  assert.deepEqual(recs.map((r) => [r.rec.cost, r.rec.price]), [[0.25, 0.4], [0.7, 1.1]]);
});

test('بلا صف عناوين: يتعرف على الباركود والاسم والسعرين من المحتوى', () => {
  const rows = [
    ['6291003000011', 'كولا 330 مل', 0.25, 0.4], ['6291003000028', 'سفن اب 330 مل', 0.25, 0.4], ['6291003000035', 'تونة 185 غ', 0.7, 1.1],
    ['6291003000042', 'فول مدمس 400 غ', 0.35, 0.6], ['6291003000059', 'حمص حب 400 غ', 0.4, 0.65],
  ];
  const a = analyzeTable(rows, 'products');
  assert.equal(a.headerRow, -1);
  assert.equal(a.data.length, 5, 'الصف الأول بيانات وليس عناوين');
  assert.deepEqual(a.mapping, { barcode: 0, name: 1, cost: 2, price: 3 });
  assert.equal(a.how.barcode, 'content');
  assert.match(a.notes.join(' '), /الأقل «سعر الشراء»/);
  assert.equal(a.headers[1], 'عمود 2');
});

test('عناوين غير مفهومة (A,B,C,D): من المحتوى يعرف الاسم والتصنيف والسعرين', () => {
  const rows = [['A', 'B', 'C', 'D'], ...MATERIALS.map(([cat, name, c, p]) => [name, cat, c, p])];
  const a = analyzeTable(rows, 'products');
  assert.equal(a.headerRow, 0, 'لا عناوين معروفة: الصف الأول عناوين ما دام نصاً');
  assert.deepEqual(a.mapping, { name: 0, category: 1, cost: 2, price: 3 });
  assert.ok(Object.values(a.how).every((h) => h === 'content'));
});

test('عنوان «سعر» محتواه نصوص: لا يُستعمل سعراً، وعنوان «اسم» محتواه أرقام لا يُستعمل اسماً', () => {
  const a = analyzeTable([['اسم', 'سعر البيع', 'ملاحظة'], ['كولا', 'حسب الطلب', 'x'], ['فانتا', 'غير متوفر', 'y'], ['تونة', 'اتصل بنا', 'z']], 'products');
  assert.equal(a.mapping.price, undefined);
  assert.match(a.notes.join(' '), /لا يبدو أرقاماً/);
  const b = analyzeTable([['اسم', 'المادة', 'سعر'], [101, 'كولا', 1], [102, 'فانتا', 1], [103, 'تونة', 2]], 'products');
  assert.equal(b.mapping.name, 1);
  assert.match(b.notes.join(' '), /أرقام فقط/);
});

test('عناوين إنجليزية، وسعر البيع أقل من الشراء ينبّه', () => {
  const rows = [['Item Name', 'Category', 'Cost Price', 'Sale Price'], ['Cola', 'Drinks', 0.5, 0.4], ['Fanta', 'Drinks', 0.25, 0.4], ['Tuna', 'Cans', 0.7, 1.1]];
  const a = analyzeTable(rows, 'products');
  assert.deepEqual(a.mapping, { name: 0, category: 1, cost: 2, price: 3 });
  const recs = buildRecords(a.data, a.mapping, 'products', db(), { rowNos: a.rowNos });
  assert.match(recs[0].notes.join(' '), /خسارة/);
  assert.equal(recs[1].notes.length, 0);
});

test('سعر الشراء أعلى من سعر البيع في كل الأعمدة: تنبيه أن العمودين ربما مبدّلان', () => {
  const rows = [['المادة', 'سعر الشراء', 'سعر البيع'], ['كولا', 5, 2], ['فانتا', 6, 3], ['تونة', 7, 3]];
  const a = analyzeTable(rows, 'products');
  assert.match(a.notes.join(' '), /سعر الشراء أعلى من سعر البيع/);
});

test('موجود مسبقاً: يطابق بالاسم المطبَّع ويحدّث الأسعار، وغير الموجود جديد', () => {
  const rows = [['اسم الصنف', 'اسم المادة', 'سعر الشراء', 'سعر البيع'], ['مشروبات', 'كولا 330 مل', 0.3, 0.5], ['مشروبات', 'عصير تفاح', 0.4, 0.7]];
  const a = analyzeTable(rows, 'products');
  const have = [{ id: 'p1', name: 'كولا  330 مل', price: 0.4, cost: 0.25, type: 'stock' }];
  const recs = buildRecords(a.data, a.mapping, 'products', db(have), { rowNos: a.rowNos });
  assert.deepEqual(recs.map((r) => r.action), ['update', 'new']);
  assert.equal(recs[0].rec.id, 'p1');
  assert.equal(recs[0].rec.price, 0.5);
});

test('العملاء: التعرّف من العناوين والمحتوى كما كان، ولا يتأثر بالجديد', () => {
  const rows = [['اسم العميل', 'رقم الجوال', 'الرصيد'], ['شركة النور', '0791234567', 120], ['مؤسسة الأمل', '0777654321', 0]];
  const a = analyzeTable(rows, 'customers');
  assert.deepEqual(a.mapping, { name: 0, phone: 1, opening: 2 });
  assert.deepEqual(guessMapping(rows[0], 'customers'), a.mapping);
  const recs = buildRecords(a.data, a.mapping, 'customers', db(), { rowNos: a.rowNos });
  assert.deepEqual(recs.map((r) => r.rec.name), ['شركة النور', 'مؤسسة الأمل']);
});

test('بصمة العمود: تنوع وباركود ووسيط', () => {
  const data = [['كولا', '6291003000011', 1], ['فانتا', '6291003000028', 3], ['تونة', '6291003000035', 2]];
  assert.equal(profileColumn(data, 0).unique, 1);
  assert.equal(profileColumn(data, 1).barcode, true);
  assert.equal(profileColumn(data, 2).median, 2);
  assert.equal(profileColumn([], 0).n, 0);
});

test('ملف Excel حقيقي بأكثر من ورقة: تُقرأ كل الأوراق بأسمائها، والقديم يقرأ الأولى', async () => {
  const bytes = writeXlsx([
    { name: 'مشروبات', rows: [['اسم المادة', 'سعر الشراء', 'سعر البيع'], ['كولا', 0.25, 0.4], ['فانتا', 0.25, 0.4]] },
    { name: 'منظفات', rows: [['اسم المادة', 'سعر الشراء', 'سعر البيع'], ['سائل جلي', 1.1, 1.75]] },
  ]);
  const sheets = await readXlsxSheets(new Uint8Array(bytes));
  assert.deepEqual(sheets.map((s) => s.name), ['مشروبات', 'منظفات']);
  assert.deepEqual(sheets[1].rows[1], ['سائل جلي', 1.1, 1.75]);
  assert.deepEqual((await readXlsx(new Uint8Array(bytes)))[1], ['كولا', 0.25, 0.4]);
});
