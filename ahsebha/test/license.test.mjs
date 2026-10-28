// اختبارات الاشتراكات: التوقيع والتحقق، الباقات والميزات، الانتهاء والمهلة، ربط الجهاز، والقفل حسب الرابط
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CONFIG, FEATURES, PLANS, planFeatures, featureIds } from '../js/plans.js';
import * as L from '../js/license.js';
import { generateOwnerKeys, buildPayload, signLicense, wrapKeys, unwrapKeys, publicKeyLine, newLicenseId } from '../js/license-sign.js';
import { SEG } from '../js/nav.js';
import { routePerm } from '../js/auth.js';

const TODAY = '2026-10-28';
const owner = await generateOwnerKeys();
const KEYS = [{ kid: owner.kid, jwk: owner.publicJwk }];

async function issue(over = {}, keys = owner) {
  const p = buildPayload({ kid: keys.kid, customer: 'محل النور', plan: 'basic', issued: TODAY, exp: '2026-11-28', ...over });
  return signLicense(p, keys.privateJwk);
}
const reset = () => { L.useStorage(L.memoryStorage()); L.setClock(() => TODAY); CONFIG.enforce = false; };

test('توقيع وتحقق: الكود يتحقق بالمفتاح العام وبيانات الاشتراك محفوظة', async () => {
  const code = await issue({ add: ['payroll'], remove: ['today'] });
  assert.match(code, /^AHS1\.[\w-]+\.[\w-]{86}$/);
  assert.ok(code.length < 600, 'الكود قصير بما يكفي للواتساب: ' + code.length);
  const v = await L.verifyCode(code, { keys: KEYS });
  assert.equal(v.ok, true);
  assert.equal(v.payload.c, 'محل النور');
  assert.equal(v.payload.p, 'basic');
  assert.deepEqual(v.payload.a, ['payroll']);
  assert.deepEqual(v.payload.r, ['today']);
  assert.equal(v.payload.k, owner.kid);
  assert.equal(owner.kid.length, 10);
});

test('العبث بالكود يُكتشف: تعديل الحمولة أو التوقيع أو مفتاح آخر', async () => {
  const code = await issue();
  const [pre, body, sig] = code.split('.');
  // تغيير الباقة داخل الحمولة (أي تعديل بخانة بسيطة)
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  payload.p = 'pro';
  const forged = `${pre}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.${sig}`;
  assert.equal((await L.verifyCode(forged, { keys: KEYS })).reason, 'signature');
  // توقيع مبدّل
  const flipped = sig.slice(0, -2) + (sig.endsWith('AA') ? 'BB' : 'AA');
  assert.equal((await L.verifyCode(`${pre}.${body}.${flipped}`, { keys: KEYS })).reason, 'signature');
  // مفتاح آخر (شخص آخر يوقّع بمفتاحه)
  const other = await generateOwnerKeys();
  const code2 = await issue({}, other);
  assert.equal((await L.verifyCode(code2, { keys: KEYS })).reason, 'signature');
  // لا مفاتيح مضبوطة بالبرنامج بعد
  assert.equal((await L.verifyCode(code, { keys: [] })).reason, 'nokey');
});

test('تدوير المفاتيح: المفتاحان القديم والجديد يعملان معاً', async () => {
  const k2 = await generateOwnerKeys();
  const keys = [...KEYS, { kid: k2.kid, jwk: k2.publicJwk }];
  assert.equal((await L.verifyCode(await issue(), { keys })).ok, true);
  assert.equal((await L.verifyCode(await issue({}, k2), { keys })).ok, true);
});

test('قراءة الكود: تتجاهل المسافات وأسطر واتساب، وتقبل رابط التفعيل', async () => {
  const code = await issue();
  const wrapped = code.replace(/(.{40})/g, '$1\n  ');
  assert.equal(L.parseCode(wrapped).code, code);
  assert.equal(L.parseCode(`‏${code}‏`).code, code);
  assert.equal(L.parseCode(`افتح هذا الرابط:\n${L.activationLink(code)}\nشكراً`).code, code);
  assert.equal(L.parseCode('hello').reason, 'format');
  assert.equal(L.parseCode('').reason, 'format');
  assert.equal(L.parseCode(null).reason, 'format');
  assert.equal(L.parseCode('AHS1.abc.def').reason, 'format');
  // حمولة ليست JSON
  const junk = `AHS1.${Buffer.from('not json at all').toString('base64url')}.${'A'.repeat(86)}`;
  assert.equal(L.parseCode(junk).reason, 'bad');
});

test('تنظيف الحمولة: يرفض الأشكال غير الصالحة ويقصّ القوائم', () => {
  const base = { v: 1, id: 'ABCDEF1234', i: '2026-01-01', e: '2026-02-01', p: 'basic', c: 'x', a: [], r: [], d: '' };
  assert.ok(L.cleanPayload(base));
  assert.equal(L.cleanPayload({ ...base, v: 2 }), null);
  assert.equal(L.cleanPayload({ ...base, id: 'abc' }), null);
  assert.equal(L.cleanPayload({ ...base, i: '01/01/2026' }), null);
  assert.equal(L.cleanPayload({ ...base, e: '2025-12-31' }), null, 'الانتهاء قبل الإصدار');
  assert.equal(L.cleanPayload({ ...base, d: '<script>' }), null);
  assert.equal(L.cleanPayload(null), null);
  assert.equal(L.cleanPayload({ ...base, e: null }).e, '', 'بلا تاريخ انتهاء = مدى الحياة');
  const dirty = L.cleanPayload({ ...base, a: ['pos', 'pos', '<b>', 5, 'x'.repeat(40)], r: 'pos' });
  assert.deepEqual(dirty.a, ['pos']);
  assert.deepEqual(dirty.r, []);
});

test('الميزات = ميزات الباقة + المضاف − المحذوف، والمجهول يُهمل', () => {
  const basic = planFeatures('basic');
  const f = (over) => L.resolveFeatures({ p: 'basic', a: [], r: [], ...over });
  assert.deepEqual([...f({})].sort(), [...basic].sort());
  assert.ok(f({ a: ['payroll'] }).has('payroll'));
  assert.ok(!f({ r: ['pos'] }).has('pos'));
  assert.ok(!f({ a: ['nonsense'] }).has('nonsense'));
  assert.equal(f({ p: 'pro' }).size, FEATURES.length, 'الاحترافية = كل الميزات');
  assert.ok(!f({ p: 'pro', r: ['payroll'] }).has('payroll'));
  assert.deepEqual([...f({ p: 'unknown-plan', a: ['pos'] })], ['pos'], 'باقة مجهولة: المضاف فقط');
  assert.equal(L.entitlementOf({ ...{ v: 1, id: 'ABCDEF1234', i: TODAY, e: '', p: 'x', c: '', a: [], r: [], d: '' } }, TODAY).planName, 'مخصّصة');
});

test('الحالة: فعّال، آخر يوم، مهلة، منتهٍ، ومدى الحياة', () => {
  const mk = (e) => ({ v: 1, id: 'ABCDEF1234', i: '2026-01-01', e, p: 'pro', c: 'زبون', a: [], r: [], d: '' });
  const at = (e, today = TODAY) => L.entitlementOf(mk(e), today, 5);
  assert.equal(at('2026-11-28').status, 'active');
  assert.equal(at('2026-11-28').daysLeft, 31);
  assert.equal(at(TODAY).status, 'active', 'آخر يوم صالح');
  assert.equal(at(TODAY).daysLeft, 0);
  const grace = at('2026-10-27');
  assert.equal(grace.status, 'grace');
  assert.equal(grace.graceLeft, 4);
  assert.ok(grace.features.has('payroll'), 'المهلة: الميزات تبقى');
  assert.equal(at('2026-10-23').status, 'grace', 'آخر يوم بالمهلة');
  const ex = at('2026-10-22');
  assert.equal(ex.status, 'expired');
  assert.equal(ex.features.size, 0, 'المنتهي يعود للمجاني');
  assert.equal(at('').status, 'lifetime');
  assert.equal(L.entitlementOf(null, TODAY).status, 'free');
});

test('التفعيل والحفظ وإعادة التحميل', async () => {
  reset();
  assert.equal(L.entitlement().status, 'free');
  const code = await issue();
  const r = await L.activate(code, { keys: KEYS });
  assert.equal(r.ok, true);
  assert.equal(r.entitlement.status, 'active');
  assert.equal(L.entitlement().planName, 'الأساسية');
  assert.equal(L.license().payload.c, 'محل النور');
  // إعادة فتح البرنامج: يقرأ المحفوظ ويتحقق منه من جديد
  const again = await L.init({ keys: KEYS });
  assert.deepEqual(again, { ok: true, active: true });
  assert.equal(L.entitlement().status, 'active');
  // إلغاء التفعيل
  L.clear();
  assert.equal(L.entitlement().status, 'free');
  assert.deepEqual(await L.init({ keys: KEYS }), { ok: true, active: false });
});

test('الأكواد المرفوضة: منتهي، تاريخ إصدار بعيد بالمستقبل، كود جهاز آخر', async () => {
  reset();
  const expired = await issue({ issued: '2026-01-01', exp: '2026-02-01' });
  assert.equal((await L.activate(expired, { keys: KEYS })).reason, 'expired');
  assert.equal(L.rejectReason((await L.verifyCode(expired, { keys: KEYS })).payload), 'expired');
  assert.equal(L.entitlement().status, 'free', 'المرفوض لا يُحفظ');
  const future = await issue({ issued: '2026-12-25', exp: '2027-01-25' });
  assert.equal((await L.activate(future, { keys: KEYS })).reason, 'future');
  const slightlyAhead = await issue({ issued: '2026-10-30', exp: '2026-11-30' });
  assert.equal((await L.activate(slightlyAhead, { keys: KEYS })).ok, true, 'فرق يوم أو يومين بالتوقيت مقبول');
  // ربط الجهاز
  reset();
  const dev = L.deviceCode();
  assert.match(dev, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  assert.equal(L.deviceCode(), dev, 'كود الجهاز ثابت');
  const wrong = await issue({ device: 'ZZZZ-9999' });
  assert.equal((await L.activate(wrong, { keys: KEYS })).reason, 'device');
  const right = await issue({ device: dev.toLowerCase() });
  assert.equal((await L.activate(right, { keys: KEYS })).ok, true, 'الحروف الصغيرة تُحوَّل لكبيرة عند الإصدار');
  // لو تغيّر الجهاز بعد التفعيل، المحفوظ لا يعمل
  L.useStorage((() => { const m = L.memoryStorage(); m.set('ahsebha-license', right); return m; })());
  assert.deepEqual(await L.init({ keys: KEYS }), { ok: false, reason: 'device' });
  assert.equal(L.entitlement().status, 'free');
  assert.equal(L.storedProblem(), 'device');
});

test('القفل: لا يُطبَّق إلا بتفعيل المالك، وبعدها حسب ميزات الزبون', async () => {
  reset();
  // الاشتراكات غير مفعّلة: كل شيء مفتوح حتى بدون كود
  assert.equal(L.enforcing(), false);
  assert.equal(L.has('payroll'), true);
  assert.equal(L.lockedFeature('#/payroll'), null);
  // تفعيل الاشتراكات: الزبون المجاني مقفل عليه المدفوع فقط
  CONFIG.enforce = true;
  assert.equal(L.has('pos'), false);
  assert.equal(L.lockedFeature('#/pos'), 'pos');
  assert.equal(L.lockedFeature('#/sales'), null, 'الفواتير أساسية');
  assert.equal(L.lockedFeature('#/customers/new'), null);
  assert.equal(L.lockedFeature('#/reports/income'), null);
  assert.equal(L.lockedFeature('#/settings'), null);
  // زبون بباقة أساسية + رواتب − كاشير
  await L.activate(await issue({ plan: 'basic', add: ['payroll'], remove: ['pos'] }), { keys: KEYS });
  assert.equal(L.has('payroll'), true);
  assert.equal(L.has('pos'), false);
  assert.equal(L.has('purchases'), true);
  assert.equal(L.has('cheques'), false);
  assert.equal(L.lockedFeature('#/pos/closing'), 'pos');
  assert.equal(L.lockedFeature('#/employees/new'), null);
  assert.equal(L.lockedFeature('#/cheques?tab=out'), 'cheques');
  // بعد المهلة يعود للمجاني
  L.setClock(() => '2026-12-31');
  assert.equal(L.entitlement().status, 'expired');
  assert.equal(L.has('purchases'), false);
  CONFIG.enforce = false;
  assert.equal(L.has('purchases'), true, 'إيقاف التفعيل يفتح الكل');
});

test('معاينة الزبون على جهاز المالك فقط', () => {
  reset();
  assert.equal(L.has('pos'), true);
  L.setPreview(true);
  assert.equal(L.previewing(), true);
  assert.equal(L.enforcing(), true);
  assert.equal(L.has('pos'), false);
  L.setPreview(false);
  assert.equal(L.has('pos'), true);
});

test('خريطة الروابط: كل رابط مقفل موجود فعلاً بالبرنامج، ولا تكرار بين الميزات', () => {
  const ids = featureIds();
  assert.equal(new Set(ids).size, ids.length, 'معرّفات الميزات فريدة');
  const segs = FEATURES.flatMap((f) => f.segs);
  assert.equal(new Set(segs).size, segs.length, 'لا رابط يتبع ميزتين');
  const app = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
  const routed = new Set(Object.values(SEG));
  for (const m of app.matchAll(/\bon\('([a-z-]+)/g)) routed.add(m[1]);
  for (const m of app.matchAll(/\['([a-z-]+)', '(?:customer|supplier)'\]/g)) routed.add(m[1]); // العملاء والموردون يُسجَّلون بحلقة
  for (const s of segs) assert.ok(routed.has(s), `الرابط «${s}» غير موجود بالبرنامج`);
  // كل رابط مقفل له صلاحية معروفة (لا يتجاوز نظام المستخدمين)
  for (const s of segs) assert.ok(routePerm(s) !== undefined, s);
  // الأساسيات لا تُقفل أبداً
  for (const core of ['', 'sales', 'sales-returns', 'customers', 'products', 'expenses', 'receipts', 'payments', 'transfers', 'reports', 'accounts', 'journal', 'daybook', 'settings', 'welcome', 'subscription', 'activate']) {
    assert.equal(L.featureOfPath(core), null, core);
  }
  // الباقات تشير لميزات موجودة فقط
  for (const p of Object.values(PLANS)) if (p.features !== 'all') for (const id of p.features) assert.ok(ids.includes(id), `${p.id}: ${id}`);
  assert.deepEqual(planFeatures('free'), [], 'المجانية بلا ميزات مدفوعة افتراضياً');
});

test('المفتاح الخاص: يُحفظ مشفّراً ولا يُفتح إلا بكلمة السر الصحيحة', async () => {
  const blob = await wrapKeys(owner, 'كلمة سر طويلة 123', { iter: 1000 });
  assert.equal(blob.kid, owner.kid);
  assert.ok(!JSON.stringify(blob).includes(owner.privateJwk.d), 'المفتاح الخاص غير ظاهر في الملف');
  await assert.rejects(() => unwrapKeys(blob, 'خطأ'), /كلمة السر غير صحيحة/);
  await assert.rejects(() => unwrapKeys({ ...blob, data: blob.data.slice(0, -4) + 'AAAA' }, 'كلمة سر طويلة 123'), /كلمة السر غير صحيحة/);
  await assert.rejects(() => unwrapKeys({ v: 9 }, 'x'), /غير صالح/);
  await assert.rejects(() => unwrapKeys({ ...blob, iter: 2e9 }, 'كلمة سر طويلة 123'), /غير صالح/, 'عدد دورات هائل في ملف خبيث يُرفض بدل تجميد الصفحة');
  await assert.rejects(() => unwrapKeys({ ...blob, iter: 10 }, 'كلمة سر طويلة 123'), /غير صالح/);
  const un = await unwrapKeys(blob, 'كلمة سر طويلة 123');
  assert.equal(un.privateKey.extractable, false, 'المفتاح المفتوح لا يمكن تصديره');
  const code = await signLicense(buildPayload({ kid: un.kid, customer: 'تجربة', plan: 'pro', issued: TODAY, exp: '' }), un.privateKey);
  const v = await L.verifyCode(code, { keys: KEYS });
  assert.equal(v.ok, true);
  assert.equal(v.payload.e, '');
  assert.match(publicKeyLine(owner.kid, owner.publicJwk), new RegExp(`^\\{ kid: '${owner.kid}', jwk: \\{"kty":"EC","crv":"P-256","x":"[\\w-]+","y":"[\\w-]+"\\} \\},$`));
});

test('إصدار الكود يرفض البيانات الخاطئة، والمعرّفات فريدة', async () => {
  assert.throws(() => buildPayload({ kid: owner.kid, issued: 'غد', exp: '' }), /غير صالحة/);
  assert.throws(() => buildPayload({ kid: owner.kid, issued: '2026-05-01', exp: '2026-04-01' }), /غير صالحة/);
  assert.throws(() => buildPayload({ kid: owner.kid, issued: TODAY, device: '###' }), /غير صالحة/);
  await assert.rejects(() => signLicense({ v: 1 }, owner.privateJwk), /غير صالحة/);
  const ids = new Set(Array.from({ length: 500 }, () => newLicenseId()));
  assert.equal(ids.size, 500);
  assert.ok([...ids].every((x) => /^[A-Z2-9]{10}$/.test(x)));
});

test('روابط التواصل والتفعيل', async () => {
  const old = CONFIG.whatsapp;
  CONFIG.whatsapp = '';
  assert.equal(L.contactLink('مرحبا'), '', 'بدون رقم لا رابط');
  CONFIG.whatsapp = '+962 79 123 4567';
  assert.equal(L.contactLink('بدي اشترك'), `https://wa.me/962791234567?text=${encodeURIComponent('بدي اشترك')}`);
  CONFIG.whatsapp = old;
  const code = await issue();
  assert.equal(L.activationLink(code), `${CONFIG.siteUrl}#/activate?k=${code}`);
  assert.ok(!/[%?&# ]/.test(code), 'الكود آمن داخل الرابط بدون ترميز');
});
