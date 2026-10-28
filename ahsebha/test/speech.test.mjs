// اختبار نصيحة الصوت العربي: تختلف حسب نظام الجهاز لأن أصوات النظام هي مصدر الصوت
import test from 'node:test';
import assert from 'node:assert/strict';
import { voiceHint, speechSupported } from '../js/views/speech.js';

test('نصيحة «لا يوجد صوت عربي» تشرح مكان تثبيته حسب النظام', () => {
  assert.match(voiceHint('no-arabic-voice', 'windows'), /الوقت واللغة ← الكلام/);
  assert.match(voiceHint('no-arabic-voice', 'mac'), /المحتوى المنطوق/);
  assert.match(voiceHint('no-arabic-voice', 'ios'), /المحتوى المنطوق/);
  assert.match(voiceHint('no-arabic-voice', 'android'), /تحويل النص إلى كلام/);
  assert.match(voiceHint('no-arabic-voice', 'linux'), /espeak/);
  assert.match(voiceHint('no-arabic-voice', 'other'), /إعدادات الجهاز/);
  assert.ok(voiceHint('no-arabic-voice', 'windows').startsWith('ما لقينا صوت عربي'));
});

test('نصائح أخرى', () => {
  assert.match(voiceHint('unsupported', 'windows'), /ما بيدعم القراءة بالصوت/);
  assert.equal(voiceHint('', 'windows'), '');
  assert.equal(voiceHint('anything-else', 'mac'), '');
  assert.equal(speechSupported(), false, 'بدون متصفح (Node) لا قراءة بالصوت');
});
