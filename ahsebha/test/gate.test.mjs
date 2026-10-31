// قفل البرنامج بكود المالك: يعمل فقط مع المفتاح العام، ويُفتح بكود صالح على هذا الجهاز، ويُغلق بالغائب والمنتهي والمزوَّر
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../js/plans.js';
import * as L from '../js/license.js';
import { generateOwnerKeys, buildPayload, signLicense } from '../js/license-sign.js';

const TODAY = '2026-10-28';
const owner = await generateOwnerKeys();
const other = await generateOwnerKeys();
const KEYS = [{ kid: owner.kid, jwk: owner.publicJwk }];

const issue = (over = {}, keys = owner) => signLicense(buildPayload({ kid: keys.kid, customer: 'محل النور', plan: 'basic', issued: TODAY, exp: '2026-11-28', ...over }), keys.privateJwk);
const reset = ({ gate = true } = {}) => {
  L.useStorage(L.memoryStorage());
  L.setClock(() => TODAY);
  Object.assign(CONFIG, { enforce: false, requireCode: gate, demoPublic: false });
  return L.init({ keys: KEYS });
};
after(() => { Object.assign(CONFIG, { enforce: false, requireCode: false, demoPublic: false }); });

test('الافتراضي مطفأ: لا يتغير شيء على المستخدمين الحاليين، ولا يُقفل أحد بلا مفتاح المالك', async () => {
  assert.equal(CONFIG.requireCode, false, 'القفل لا يعمل حتى يقرر المالك');
  await reset({ gate: false });
  assert.equal(L.gateOn(KEYS), false);
  assert.equal(L.gateOpen(KEYS), true, 'مطفأ: البرنامج مفتوح بلا كود');
  await reset({ gate: true });
  assert.equal(L.gateOn([]), false, 'مفعّل بلا مفتاح عام: لا يمكن لأي كود أن يُقبل فلا نقفل الجميع');
  assert.equal(L.gateOpen([]), true);
  assert.equal(L.gateOn(KEYS), true);
});

test('بلا كود: مغلق وسببه «لا كود»؛ وبكود صالح يُفتح ويبقى مفتوحاً بعد إعادة التشغيل', async () => {
  await reset();
  assert.equal(L.gateOpen(KEYS), false);
  assert.equal(L.gateWhy(), 'none');
  const r = await L.activate(await issue(), { keys: KEYS });
  assert.equal(r.ok, true);
  assert.equal(L.gateOpen(KEYS), true);
  // «إعادة التشغيل»: الكود المحفوظ يُقرأ من التخزين ويُتحقق من توقيعه من جديد
  const again = await L.init({ keys: KEYS });
  assert.equal(again.ok, true);
  assert.equal(L.gateOpen(KEYS), true);
  L.clear();
  assert.equal(L.gateOpen(KEYS), false, 'إلغاء التفعيل يقفل البرنامج');
  assert.equal(L.gateWhy(), 'none');
});

test('كود دائم، وكود الباقة المجانية، وكود العرض: كلها أكواد صالحة تفتح البرنامج', async () => {
  for (const over of [{ exp: '' }, { plan: 'free' }, { plan: 'pro', exp: '' }, { demo: 5, exp: '2026-11-04' }]) {
    await reset();
    const r = await L.activate(await issue(over), { keys: KEYS });
    assert.equal(r.ok, true, JSON.stringify(over));
    assert.equal(L.gateOpen(KEYS), true, JSON.stringify(over));
  }
});

test('الانتهاء: مهلة 5 أيام تبقي البرنامج مفتوحاً ثم يُقفل، وكود العرض بلا مهلة', async () => {
  await reset();
  await L.activate(await issue({ exp: '2026-11-01' }), { keys: KEYS });
  const at = (d) => { L.setClock(() => d); return L.gateOpen(KEYS); };
  assert.equal(at('2026-11-01'), true, 'آخر يوم صالح');
  assert.equal(at('2026-11-02'), true, 'في المهلة');
  assert.equal(at('2026-11-06'), true, 'آخر يوم في المهلة');
  assert.equal(at('2026-11-07'), false, 'انتهت المهلة');
  assert.equal(L.gateWhy(), 'expired');
  // نافذة بقيت مفتوحة أياماً: الفحص الدوري يرى الانتهاء بلا إعادة تحميل الكود
  assert.equal(at('2026-10-30'), true);

  await reset();
  await L.activate(await issue({ demo: 3, exp: '2026-10-30' }), { keys: KEYS });
  L.setClock(() => '2026-10-31');
  assert.equal(L.gateOpen(KEYS), false, 'كود العرض يُغلق في اليوم التالي بلا مهلة');
});

test('كود منتهٍ محفوظ من قبل: يُغلق عند الفتح مع سبب «انتهى»، ولا يُقبل كود منتهٍ جديد', async () => {
  await reset();
  await L.activate(await issue({ exp: '2026-11-01' }), { keys: KEYS });
  L.setClock(() => '2027-01-15');
  const r = await L.init({ keys: KEYS });
  assert.equal(r.ok, true, 'التوقيع سليم، المشكلة في التاريخ فقط');
  assert.equal(L.gateOpen(KEYS), false);
  assert.equal(L.gateWhy(), 'expired');
  assert.equal(L.entitlement().customer, 'محل النور');
  await reset();
  L.setClock(() => '2027-01-15');
  const stale = await L.activate(await issue({ exp: '2026-11-01' }), { keys: KEYS });
  assert.deepEqual([stale.ok, stale.reason], [false, 'expired']);
  assert.equal(L.gateOpen(KEYS), false);
});

test('كود مزوَّر أو من مفتاح آخر أو معدَّل: يُرفض ويبقى مغلقاً', async () => {
  await reset();
  const foreign = await issue({}, other);
  assert.deepEqual(((r) => [r.ok, r.reason])(await L.activate(foreign, { keys: KEYS })), [false, 'signature']);
  assert.equal(L.gateOpen(KEYS), false);
  const [pre, body, sig] = (await issue()).split('.');
  const edited = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  edited.e = '2099-01-01';
  const forged = `${pre}.${Buffer.from(JSON.stringify(edited)).toString('base64url')}.${sig}`;
  assert.equal((await L.activate(forged, { keys: KEYS })).ok, false);
  assert.equal((await L.activate('AHS1.garbage', { keys: KEYS })).ok, false);
  assert.equal((await L.activate('', { keys: KEYS })).ok, false);
  assert.equal(L.gateOpen(KEYS), false);
});

test('كود محفوظ تالف أو زرعه أحد بيده في التخزين: مغلق مع سبب «كود لا يعمل»', async () => {
  const mem = L.memoryStorage();
  await reset();
  L.useStorage(mem);
  const good = await issue();
  await L.activate(good, { keys: KEYS });
  const [pre, body, sig] = good.split('.');
  const bad = `${pre}.${body}.${sig.slice(0, -3)}AAA`;
  mem.set('ahsebha-license', bad);
  const r = await L.init({ keys: KEYS });
  assert.deepEqual([r.ok, r.reason], [false, 'signature']);
  assert.equal(L.gateOpen(KEYS), false);
  assert.equal(L.gateWhy(), 'bad');
  assert.equal(L.storedProblem(), 'signature');
  // كود من مفتاح غير مفتاح المالك مزروع في التخزين
  mem.set('ahsebha-license', await issue({}, other));
  assert.equal((await L.init({ keys: KEYS })).ok, false);
  assert.equal(L.gateOpen(KEYS), false);
});

test('كود مربوط بجهاز: يعمل على جهازه فقط، ونسخه إلى جهاز آخر لا ينفع', async () => {
  await reset();
  const mine = L.deviceCode();
  const bound = await issue({ device: mine });
  const r = await L.activate(bound, { keys: KEYS });
  assert.equal(r.ok, true);
  assert.equal(L.gateOpen(KEYS), true);
  // جهاز آخر (تخزين جديد = كود جهاز جديد) يستلم نفس الكود
  L.useStorage(L.memoryStorage());
  await L.init({ keys: KEYS }); // نافذة جديدة على الجهاز الآخر: لا شيء في الذاكرة
  assert.notEqual(L.deviceCode(), mine);
  const copied = await L.activate(bound, { keys: KEYS });
  assert.deepEqual([copied.ok, copied.reason], [false, 'device']);
  assert.equal(L.gateOpen(KEYS), false);
  // ولو نُسخ الكود المحفوظ نفسه إلى تخزين الجهاز الآخر
  const mem = L.memoryStorage();
  L.useStorage(mem);
  mem.set('ahsebha-license', bound);
  const init = await L.init({ keys: KEYS });
  assert.deepEqual([init.ok, init.reason], [false, 'device']);
  assert.equal(L.gateOpen(KEYS), false);
  assert.equal(L.gateWhy(), 'bad');
});

test('القفل يسبق التجربة العامة: بلا كود لا تُفتح نسخة العرض المفتوحة للجميع', async () => {
  await reset();
  CONFIG.demoPublic = true;
  assert.equal(L.gateOpen(KEYS), false);
});

test('تنبيه الانتهاء يُحسب حين تُقفل الميزات بالاشتراك أو يُقفل البرنامج كله', async () => {
  await reset({ gate: false });
  assert.equal(L.tracksExpiry(), false);
  CONFIG.enforce = true;
  assert.equal(L.tracksExpiry(), true);
  CONFIG.enforce = false;
  L.setPreview(true);
  assert.equal(L.tracksExpiry(), true, 'معاينة المالك على جهازه');
  L.setPreview(false);
});
