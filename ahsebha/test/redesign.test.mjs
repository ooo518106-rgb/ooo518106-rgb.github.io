// اختبارات التصميم الجديد: الأيقونات، اسم البرنامج وخطه، والبحث السريع (Ctrl+K)
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { icon, iconFor, iconNames } from '../js/icons.js';
import { ICONS, FILLED, EMOJI } from '../js/icons-data.js';
import { BRAND, logoImg } from '../js/brand.js';
import { buildIndex, search } from '../js/views/palette.js';

const root = new URL('../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');

// ─── الأيقونات ───
test('الأيقونة: وسم SVG باسمها، والاسم الخاطئ يرجّع نصاً فارغاً', () => {
  const s = icon('house');
  assert.match(s, /^<svg class="i" data-icon="house" viewBox="0 0 24 24" aria-hidden="true"/);
  assert.equal(icon('no-such-icon'), '');
  assert.match(icon('house', 'big'), /class="i big"/);
});

test('كل إيموجي في الخريطة يشير إلى أيقونة موجودة فعلاً', () => {
  const names = new Set(iconNames());
  const bad = Object.entries(EMOJI).filter(([, n]) => !names.has(n));
  assert.deepEqual(bad, []);
  assert.ok(Object.keys(ICONS).length >= 100, 'أيقونات Lucide');
  for (const [n, svg] of Object.entries({ ...ICONS, ...FILLED })) assert.ok(svg.length > 10 && !/<script/i.test(svg), `أيقونة سليمة: ${n}`);
});

test('iconFor: يتجاهل محدد الشكل (U+FE0F) في الإيموجي', () => {
  assert.equal(iconFor('🖥️'), 'monitor');
  assert.equal(iconFor('🖥'), 'monitor');
  assert.equal(iconFor('🧾'), 'receipt-text');
  assert.equal(iconFor('لا إيموجي'), '');
});

// ─── الاسم والخط ───
test('الاسم الجديد «كنز» في الإعدادات والواجهات الأساسية', () => {
  assert.equal(BRAND.name, 'كنز');
  assert.equal(BRAND.latin, 'Kenz');
  assert.match(logoImg(40), /src="icons\/icon\.svg"/);
  const man = JSON.parse(read('manifest.json'));
  assert.match(man.name, /كنز/);
  assert.match(man.short_name, /كنز/);
  for (const f of ['index.html', 'plans.html', 'download.html', 'owner.html', 'privacy.html']) {
    const s = read(f);
    assert.match(s.match(/<title>([^<]*)<\/title>/)[1], /كنز/, `عنوان ${f}`);
    assert.doesNotMatch(s.match(/<title>([^<]*)<\/title>/)[1], /احسبها/, `عنوان ${f} بلا الاسم القديم`);
  }
});

test('الخط والأيقونات ملفات حقيقية تُخزَّن للعمل بلا إنترنت', () => {
  const css = read('fonts/fonts.css');
  const files = [...css.matchAll(/url\(["']?([^)"']+\.woff2)["']?\)/g)].map((m) => m[1]);
  assert.ok(files.length >= 4, 'ملفات الخط معرّفة');
  for (const f of files) assert.ok(existsSync(new URL('fonts/' + f.replace(/^\.?\//, ''), root)), `موجود: ${f}`);
  assert.ok(existsSync(new URL('fonts/OFL.txt', root)), 'ترخيص الخط مرفق');
  const sw = read('sw.js');
  for (const f of files) assert.ok(sw.includes('fonts/' + f.replace(/^\.?\//, '')), `يُخزَّن مسبقاً: ${f}`);
  assert.doesNotMatch(read('app.css'), /Cairo/, 'لا اعتماد على خط خارجي');
  assert.ok(existsSync(new URL('icons/icon.svg', root)));
});

// ─── البحث السريع ───
const db = {
  settings: { name: 'متجر' },
  parties: [
    { id: 'c1', kind: 'customer', name: 'أحمد الخطيب', phone: '0791234567' },
    { id: 'c2', kind: 'customer', name: 'مؤسسة النور' },
    { id: 's1', kind: 'supplier', name: 'شركة الأمل للتوريد' },
  ],
  products: [
    { id: 'p1', name: 'قهوة عربية 500غ', barcode: '6291003000011' },
    { id: 'p2', name: 'شاي أخضر', barcode: '6291003000028' },
  ],
  docs: [
    { id: 'd1', type: 'sale', no: 1, date: '2026-10-01', party: 'c1' },
    { id: 'd2', type: 'sale', no: 2, date: '2026-10-03', party: 'c2' },
    { id: 'd3', type: 'purchase', no: 1, date: '2026-10-02', party: 's1' },
    { id: 'd4', type: 'nonsense', no: 1, date: '2026-10-02' },
  ],
};
const pages = [{ ic: 'house', t: 'الرئيسية', h: '' }, { ic: 'receipt-text', t: 'فواتير المبيعات', h: 'sales' }, { ic: 'users', t: 'العملاء', h: 'customers' }, { ic: 'lock', t: 'الشيكات', h: 'cheques', locked: true }];
const actions = [{ ic: 'receipt-text', t: 'فاتورة مبيعات', href: '#/sales/new', kw: 'جديد إضافة إنشاء' }, { ic: 'banknote', t: 'مصروف', href: '#/expenses/new', kw: 'جديد إضافة إنشاء' }];
const idx = buildIndex({ db, pages, actions, can: () => true, routePerm: (x) => x });
const titles = (q) => search(idx, q).map((r) => r.t);

test('البحث السريع: بلا كتابة تظهر الإجراءات والصفحات فقط', () => {
  const r = search(idx, '');
  assert.ok(r.length > 0);
  assert.ok(r.every((x) => x.g === 'action' || x.g === 'page'));
  assert.equal(r[0].g, 'action', 'الإجراءات أولاً');
});

test('البحث السريع: يطابق بالتطبيع العربي وبأي ترتيب للكلمات', () => {
  assert.ok(titles('فاتوره').includes('فاتورة مبيعات'), 'ه = ة');
  assert.ok(titles('احمد').includes('أحمد الخطيب'), 'أ = ا');
  assert.ok(titles('الخطيب احمد').includes('أحمد الخطيب'), 'الترتيب لا يهم');
  assert.ok(titles('نور').includes('مؤسسة النور'), 'منتصف الاسم');
  assert.deepEqual(titles('zzzzzz'), []);
});

test('البحث السريع: يجد بالهاتف والباركود ورقم المستند ويفتح الرابط الصحيح', () => {
  const byPhone = search(idx, '0791234567')[0];
  assert.equal(byPhone.t, 'أحمد الخطيب');
  assert.equal(byPhone.href, '#/customers/c1');
  const byCode = search(idx, '6291003000028')[0];
  assert.equal(byCode.t, 'شاي أخضر');
  assert.equal(byCode.href, '#/products/p2');
  const inv = search(idx, 'INV-0002').find((x) => x.g === 'doc');
  assert.ok(inv, 'يجد الفاتورة برقمها');
  assert.equal(inv.href, '#/sales/d2');
  assert.equal(search(idx, 'الأمل')[0].href, '#/suppliers/s1', 'المورد يفتح صفحة الموردين');
});

test('البحث السريع: الكلمات المفتاحية للإجراءات والصفحات المقفلة', () => {
  assert.ok(titles('جديد').includes('مصروف'), 'كلمة «جديد» تظهر الإجراءات');
  const lock = search(idx, 'شيكات').find((x) => x.g === 'page');
  assert.ok(lock && lock.lock, 'الصفحة المقفلة تُعرض بوسمها');
});

test('البحث السريع: المستندات الأحدث أولاً، والنوع المجهول يُهمل', () => {
  const docs = search(idx, 'فاتوره').filter((x) => x.g === 'doc');
  assert.ok(docs.length >= 2);
  assert.match(docs[0].t, /0002/, 'الأحدث تاريخاً أولاً');
  assert.ok(!idx.some((x) => x.g === 'doc' && /nonsense/.test(x.t)));
});

test('البحث السريع: يحترم الصلاحيات فلا يُظهر ما لا يملكه المستخدم', () => {
  const limited = buildIndex({ db, pages, actions, can: (p) => p !== 'customers' && p !== 'purchases', routePerm: (x) => x });
  assert.ok(!limited.some((x) => x.g === 'party'), 'لا عملاء بلا صلاحية');
  assert.ok(!limited.some((x) => x.g === 'doc' && x.href.startsWith('#/purchases')), 'لا مشتريات بلا صلاحية');
  assert.ok(limited.some((x) => x.g === 'product'), 'المنتجات مسموحة');
  const none = buildIndex({ db: null, pages, actions });
  assert.ok(none.every((x) => x.g === 'action' || x.g === 'page'), 'بلا بيانات: صفحات وإجراءات فقط');
});

test('البحث السريع: سقف لعدد كل مجموعة', () => {
  const many = { ...db, parties: Array.from({ length: 40 }, (_, i) => ({ id: 'x' + i, kind: 'customer', name: 'عميل ' + i })) };
  const r = search(buildIndex({ db: many, pages, actions, can: () => true, routePerm: (x) => x }), 'عميل');
  assert.ok(r.filter((x) => x.g === 'party').length <= 6);
});

// ─── لا بقايا من الاسم القديم في نصوص يراها المستخدم ───
test('لا «Ahsebha» بنصوص الواجهة: أسماء الملفات والتطبيق تُقرأ من downloads.js وbrand.js', () => {
  const walk = (dir) => readdirSync(new URL(dir, root), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (['vendor', 'fonts', 'store', 'icons', 'test'].includes(e.name) ? [] : walk(`${dir}${e.name}/`)) : [`${dir}${e.name}`]));
  const files = walk('').filter((f) => /\.(js|html)$/.test(f));
  assert.ok(files.length > 40, 'وجدنا ملفات البرنامج');
  const bad = files.filter((f) => f !== 'js/changelog.js' && /Ahsebha/.test(read(f))); // سجل التحديثات يذكر الاسم القديم تاريخياً
  assert.deepEqual(bad, [], 'الاسم الظاهر «كنز»/Kenz؛ المعرّفات التقنية بحروف صغيرة ahsebha');
  // صفحة التنزيلات تأخذ أسماء الملفات من downloads.js بدل كتابتها يدوياً
  assert.match(read('js/download-page.js'), /file\('win'\)/);
});
