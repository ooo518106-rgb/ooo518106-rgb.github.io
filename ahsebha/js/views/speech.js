// ═══ القراءة بالصوت: صوت عربي من الجهاز نفسه (بدون إنترنت وبدون إرسال أي شي لأي مكان) ═══
const synth = () => (typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window ? window.speechSynthesis : null);
export const speechSupported = () => !!synth();

const voices = () => { try { return synth().getVoices() || []; } catch (e) { return []; } };
const PREFER = ['ar-JO', 'ar-SA', 'ar-EG', 'ar-AE', 'ar-LB', 'ar-SY', 'ar-PS', 'ar-IQ', 'ar-KW', 'ar-QA'];

// أفضل صوت عربي متاح. anyVoices: هل الجهاز أعطانا قائمة أصوات أصلاً (بعض الأجهزة بتتأخر بها)
export function pickVoice() {
  const all = voices();
  const ar = all.filter((v) => /^ar([-_]|$)/i.test(v.lang || ''));
  const rank = (v) => { const i = PREFER.findIndex((p) => p.toLowerCase() === String(v.lang).replace('_', '-').toLowerCase()); return i < 0 ? 99 : i; };
  ar.sort((a, b) => rank(a) - rank(b));
  return { voice: ar[0] || null, anyVoices: all.length > 0 };
}

function waitForVoices(ms = 1200) {
  const s = synth();
  if (!s || voices().length) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => { try { s.removeEventListener('voiceschanged', done); } catch (e) { /* لا شي */ } resolve(); };
    try { s.addEventListener('voiceschanged', done); } catch (e) { /* لا شي */ }
    setTimeout(done, ms);
  });
}

let run = 0;
export function stopSpeaking() {
  run++;
  try { const s = synth(); if (s) s.cancel(); } catch (e) { /* لا شي */ }
}

// يقرأ الجمل واحدة واحدة (المتصفحات بتقطع الجمل الطويلة). parts: [{ id, text }]
// يرجّع { ok, reason }: reason = unsupported | no-arabic-voice
export async function speak(parts, { onPart, onEnd, rate = 0.95 } = {}) {
  const s = synth();
  if (!s) return { ok: false, reason: 'unsupported' };
  stopSpeaking();
  await waitForVoices();
  const { voice, anyVoices } = pickVoice();
  if (anyVoices && !voice) return { ok: false, reason: 'no-arabic-voice' };
  const mine = ++run;
  let i = 0;
  const next = () => {
    if (mine !== run) return;
    if (i >= parts.length) { if (onEnd) onEnd(); return; }
    const p = parts[i++];
    const u = new window.SpeechSynthesisUtterance(p.text);
    u.lang = voice ? voice.lang : 'ar-SA';
    if (voice) u.voice = voice;
    u.rate = rate;
    u.onstart = () => { if (mine === run && onPart) onPart(p, i - 1); };
    u.onend = next;
    u.onerror = (e) => { if (!e || (e.error !== 'canceled' && e.error !== 'interrupted')) next(); };
    s.speak(u);
  };
  next();
  return { ok: true };
}

export const voiceHint = (reason) => (reason === 'unsupported'
  ? 'المتصفح هاد ما بيدعم القراءة بالصوت. جرّب Chrome أو Safari.'
  : reason === 'no-arabic-voice'
    ? 'ما لقينا صوت عربي على جهازك. جرّب من Chrome، أو ثبّت صوت عربي من إعدادات الجهاز (اللغة والإدخال ← تحويل النص إلى كلام).'
    : '');
