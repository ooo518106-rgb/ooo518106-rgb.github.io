// ═══ نسخة احتياطية مشفّرة بكلمة سر ═══
// AES-256-GCM بمفتاح مشتق من كلمة السر عبر PBKDF2-SHA256 (600 ألف دورة)، وكل ذلك داخل المتصفح بدون أي خادم.
// الملف نص JSON فيه الملح والمتجه والبيانات المشفّرة؛ من ينسى كلمة السر لا يمكن استرجاع النسخة (لا بديل ولا باب خلفي).
// البيانات المشفّرة قد تكون نص JSON للنسخة العادية أو ملف ZIP للنسخة الكاملة مع المرفقات (kind).
const APP = 'kenz-encrypted-backup';
export const ITERATIONS = 600000;
export const MIN_PASSWORD = 12;
export const WRONG = 'كلمة السر غير صحيحة، أو الملف تالف';

const b64 = (u8) => {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
};
const unb64 = (t) => Uint8Array.from(atob(t), (c) => c.charCodeAt(0));

async function keyFor(password, salt, iter, usage) {
  // NFC: نفس الحروف العربية تُكتب بترميزات مختلفة أحياناً، فنوحّدها حتى تعمل كلمة السر على أي جهاز
  const raw = new TextEncoder().encode(String(password).normalize('NFC'));
  const base = await crypto.subtle.importKey('raw', raw, 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, usage);
}

// هل النص نسخة مشفّرة من البرنامج؟ (فحص سريع لأول الملف قبل قراءته كله، فالنسخ العادية كبيرة)
export function isEncryptedBackup(text) {
  if (typeof text !== 'string' || !text.slice(0, 300).includes(APP)) return false;
  try { const o = JSON.parse(text); return !!o && o.app === APP && o.v === 1; } catch (e) { return false; }
}

// bytes: Uint8Array (نص JSON مرمّز أو ZIP)؛ يرجّع نص ملف النسخة المشفّرة
export async function encryptBytes(bytes, password, { kind = 'json', iter = ITERATIONS } = {}) {
  if (String(password || '').length < MIN_PASSWORD) throw new Error(`كلمة السر لازم تكون ${MIN_PASSWORD} خانة على الأقل`);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await keyFor(password, salt, iter, ['encrypt']);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes));
  return JSON.stringify({ app: APP, v: 1, kdf: 'PBKDF2-SHA256', iter, kind, salt: b64(salt), iv: b64(iv), data: b64(ct) });
}

// يفك النسخة المشفّرة: { bytes, kind }؛ كلمة سر خاطئة أو تلاعب بالملف يعطي خطأً واضحاً
export async function decryptBackup(text, password) {
  let o;
  try { o = JSON.parse(text); } catch (e) { throw new Error(WRONG); }
  if (!o || o.app !== APP || o.v !== 1 || !(Number(o.iter) >= 1000 && Number(o.iter) <= 5e6)) throw new Error(WRONG);
  try {
    const key = await keyFor(password, unb64(o.salt), Number(o.iter), ['decrypt']);
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(o.iv) }, key, unb64(o.data));
    return { bytes: new Uint8Array(pt), kind: o.kind === 'zip' ? 'zip' : 'json' };
  } catch (e) { throw new Error(WRONG); }
}
