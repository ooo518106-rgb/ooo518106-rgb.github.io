// سجل التحديثات: يبقى مرتّباً وكاملاً، ورقم تطبيق سطح المكتب فيه هو الحقيقي، فلا يكذب على صاحب البرنامج
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CHANGELOG, VERSION, DESKTOP_VERSION, NUMBERED_LATER_BEFORE, cmpVersion } from '../js/changelog.js';

const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));

test('مقارنة الأرقام: بالترتيب الرقمي لا النصي', () => {
  assert.ok(cmpVersion('1.10.0', '1.9.0') > 0, '10 أكبر من 9');
  assert.ok(cmpVersion('1.6.0', '1.6.1') < 0);
  assert.ok(cmpVersion('2.0.0', '1.99.99') > 0);
  assert.equal(cmpVersion('1.6.0', '1.6.0'), 0);
  assert.equal(cmpVersion('1.6', '1.6.0'), 0);
});

test('كل بند له رقم وتاريخ وعنوان وشرح، والأرقام فريدة والأحدث أولاً', () => {
  assert.ok(CHANGELOG.length >= 8);
  const seen = new Set();
  for (const e of CHANGELOG) {
    assert.match(e.v, /^\d+\.\d+\.\d+$/, `رقم غير صالح: ${e.v}`);
    assert.ok(!seen.has(e.v), `رقم مكرر: ${e.v}`);
    seen.add(e.v);
    assert.ok(isDate(e.date), `تاريخ غير صالح في ${e.v}: ${e.date}`);
    assert.ok(typeof e.title === 'string' && e.title.length >= 5 && e.title.length <= 80, `عنوان ${e.v}`);
    assert.ok(Array.isArray(e.items) && e.items.length >= 1, `لا شرح في ${e.v}`);
    for (const t of e.items) assert.ok(typeof t === 'string' && t.length >= 15 && t.length <= 400, `بند قصير أو طويل في ${e.v}: ${t}`);
  }
  for (let i = 1; i < CHANGELOG.length; i++) {
    assert.ok(cmpVersion(CHANGELOG[i - 1].v, CHANGELOG[i].v) > 0, `الترتيب: ${CHANGELOG[i - 1].v} قبل ${CHANGELOG[i].v}`);
    assert.ok(CHANGELOG[i - 1].date >= CHANGELOG[i].date, `تاريخ ${CHANGELOG[i - 1].v} أقدم من تاريخ ${CHANGELOG[i].v}`);
  }
});

test('رقم الإصدار الحالي هو رقم أول بند، ولا بند بتاريخ في المستقبل', () => {
  assert.equal(VERSION, CHANGELOG[0].v);
  const now = new Date();
  const tomorrow = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)).toISOString().slice(0, 10);
  assert.ok(CHANGELOG[0].date <= tomorrow, 'تاريخ أحدث بند في المستقبل');
  assert.ok(cmpVersion(NUMBERED_LATER_BEFORE, VERSION) <= 0 && CHANGELOG.some((e) => e.v === NUMBERED_LATER_BEFORE), 'بداية الترقيم الفعلي موجودة في السجل');
});

test('رقم تطبيق سطح المكتب في السجل هو رقم التطبيق الحقيقي (desktop/package.json)', () => {
  const real = JSON.parse(readFileSync(new URL('../../desktop/package.json', import.meta.url), 'utf8')).version;
  assert.equal(DESKTOP_VERSION, real, 'أضف الحقل desktop في بند التحديث الذي أصدر نسخة التطبيق الجديدة');
  const desk = CHANGELOG.filter((e) => e.desktop);
  for (let i = 1; i < desk.length; i++) assert.ok(cmpVersion(desk[i - 1].desktop, desk[i].desktop) > 0, 'أرقام التطبيق متصاعدة مع الزمن');
});

test('لوحة المالك تعرض السجل', () => {
  const src = readFileSync(new URL('../js/owner.js', import.meta.url), 'utf8');
  assert.match(src, /from '\.\/changelog\.js'/);
  assert.match(src, /\['updates', '🆕 التحديثات'\]/);
});
