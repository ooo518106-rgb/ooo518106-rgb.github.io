// النسخة الاحتياطية المشفّرة بكلمة سر: الدورة الكاملة، كلمة سر خاطئة، تلاعب بالملف، وحماية المدخلات
import test from 'node:test';
import assert from 'node:assert/strict';
import { encryptBytes, decryptBackup, isEncryptedBackup, ITERATIONS, MIN_PASSWORD, WRONG } from '../js/backup-crypto.js';
import * as L from '../js/license.js';
import * as store from '../js/store.js';
import { defaultAccounts, defaultSettings } from '../js/core.js';

L.useStorage(L.memoryStorage());
const FAST = 1000; // دورات أقل في الاختبارات؛ والقيمة الافتراضية تُختبر مرة واحدة
const enc = (s) => new TextEncoder().encode(s);
const dec = (b) => new TextDecoder().decode(b);

test('دورة كاملة: تشفير ثم فك يرجّع البايتات نفسها، ويبقى نوع المحتوى', async () => {
  const text = await encryptBytes(enc('{"app":"x","docs":[1,2,3]}'), 'سر-قوي-123', { iter: FAST });
  assert.equal(isEncryptedBackup(text), true);
  const o = JSON.parse(text);
  assert.deepEqual([o.app, o.v, o.kdf, o.iter, o.kind], ['kenz-encrypted-backup', 1, 'PBKDF2-SHA256', FAST, 'json']);
  assert.ok(o.salt && o.iv && o.data);
  assert.ok(!text.includes('docs'), 'لا شيء من المحتوى ظاهر');
  const back = await decryptBackup(text, 'سر-قوي-123');
  assert.equal(dec(back.bytes), '{"app":"x","docs":[1,2,3]}');
  assert.equal(back.kind, 'json');
  const zip = await encryptBytes(new Uint8Array([0x50, 0x4b, 3, 4, 9, 9]), 'abcdef', { kind: 'zip', iter: FAST });
  const z = await decryptBackup(zip, 'abcdef');
  assert.equal(z.kind, 'zip');
  assert.deepEqual([...z.bytes], [0x50, 0x4b, 3, 4, 9, 9]);
});

test('كلمة سر خاطئة أو ملف متلاعَب به: خطأ واضح وبدون كشف شيء', async () => {
  const text = await encryptBytes(enc('بيانات المحل'), 'الكلمة-الصحيحة', { iter: FAST });
  await assert.rejects(() => decryptBackup(text, 'كلمة-خطأ'), { message: WRONG });
  await assert.rejects(() => decryptBackup(text, ''), { message: WRONG });
  const o = JSON.parse(text);
  const flip = (k) => JSON.stringify({ ...o, [k]: o[k].slice(0, -4) + (o[k].slice(-4) === 'AAAA' ? 'BBBB' : 'AAAA') });
  for (const k of ['data', 'iv', 'salt']) await assert.rejects(() => decryptBackup(flip(k), 'الكلمة-الصحيحة'), { message: WRONG }, k);
  // تغيير عدد الدورات يغيّر المفتاح فيفشل
  await assert.rejects(() => decryptBackup(JSON.stringify({ ...o, iter: FAST + 1 }), 'الكلمة-الصحيحة'), { message: WRONG });
  // نص ليس JSON، أو JSON لا يخص البرنامج
  await assert.rejects(() => decryptBackup('not json', 'x'), { message: WRONG });
  await assert.rejects(() => decryptBackup('{"app":"other"}', 'x'), { message: WRONG });
  // عدد دورات هائل لا يُنفَّذ (يجمّد الجهاز)
  await assert.rejects(() => decryptBackup(JSON.stringify({ ...o, iter: 1e9 }), 'x'), { message: WRONG });
});

test('كل تشفير له ملح ومتجه جديدان، وكلمة السر لها حد أدنى', async () => {
  const a = JSON.parse(await encryptBytes(enc('نفس النص'), 'abcdef', { iter: FAST }));
  const b = JSON.parse(await encryptBytes(enc('نفس النص'), 'abcdef', { iter: FAST }));
  assert.notEqual(a.salt, b.salt); assert.notEqual(a.iv, b.iv); assert.notEqual(a.data, b.data);
  await assert.rejects(() => encryptBytes(enc('x'), 'abc'), { message: new RegExp(String(MIN_PASSWORD)) });
  await assert.rejects(() => encryptBytes(enc('x'), ''));
});

test('توحيد ترميز الحروف: كلمة السر نفسها بترميزين مختلفين تفتح النسخة', async () => {
  const composed = 'café-سر';
  const decomposed = 'café-سر';
  assert.notEqual(composed, decomposed);
  const text = await encryptBytes(enc('ok'), composed, { iter: FAST });
  assert.equal(dec((await decryptBackup(text, decomposed)).bytes), 'ok');
});

test('كشف النسخة المشفّرة: لا يخلط مع النسخ العادية ولا مع أي نص', () => {
  assert.equal(isEncryptedBackup('{"app":"ahsebha-accounting","docs":[]}'), false);
  assert.equal(isEncryptedBackup('PK\u0003\u0004'), false);
  assert.equal(isEncryptedBackup(''), false);
  assert.equal(isEncryptedBackup(null), false);
  assert.equal(isEncryptedBackup('{"app":"kenz-encrypted-backup","v":2}'), false, 'إصدار غير معروف');
  assert.equal(isEncryptedBackup('{"app":"kenz-encrypted-backup" broken'), false);
});

test('القيمة الافتراضية 600 ألف دورة، وتعمل مع حجم كبير', async () => {
  assert.equal(ITERATIONS, 600000);
  const big = new Uint8Array(3 * 1024 * 1024).map((_, i) => (i * 31) & 255);
  const text = await encryptBytes(big, 'كلمة طويلة وآمنة');
  assert.equal(JSON.parse(text).iter, 600000);
  const back = await decryptBackup(text, 'كلمة طويلة وآمنة');
  assert.equal(back.bytes.length, big.length);
  assert.ok(back.bytes.every((v, i) => v === big[i]));
});

test('نسخة البرنامج الحقيقية: تشفير ثم فك ثم استعادة تعطي البيانات نفسها', async () => {
  const base = { app: 'ahsebha-accounting', settings: defaultSettings({ name: 'محل التشفير', startDate: '2026-01-01', vat: false }), accounts: defaultAccounts(), parties: [{ id: 'c1', kind: 'customer', name: 'عميل' }], products: [], docs: [] };
  store.replaceDb(base);
  store.saveDoc({ type: 'sale', date: '2026-02-01', party: null, vatRate: 0, lines: [{ product: null, desc: 'بند', qty: 2, price: 10, disc: 0, tax: 'S' }], paid: 20, payAcc: 'cash', notes: 'سرّية' });
  const json = store.backupJSON();
  const text = await encryptBytes(enc(json), 'كلمة-سر-النسخة', { iter: FAST });
  assert.ok(!text.includes('سرّية') && !text.includes('محل التشفير'), 'لا تسرّب نصاً من البيانات');
  const restored = store.parseBackup(dec((await decryptBackup(text, 'كلمة-سر-النسخة')).bytes));
  assert.equal(restored.settings.name, 'محل التشفير');
  assert.equal(restored.docs.length, 1);
  assert.equal(restored.docs[0].notes, 'سرّية');
  assert.equal(restored.parties[0].name, 'عميل');
});
