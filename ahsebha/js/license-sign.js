// ═══ جانب المالك: إنشاء المفاتيح وتوقيع أكواد الاشتراك وحفظ المفتاح الخاص مشفّراً ═══
// يُستخدم من لوحة المالك (owner.html) فقط. البرنامج نفسه لا يحتاجه ولا يحمّله.
import { b64u, textToB64u, keyId, cleanPayload, PREFIX } from './license.js';

const ALGO = { name: 'ECDSA', namedCurve: 'P-256' };
const utf8 = new TextEncoder();
const unutf8 = new TextDecoder();

export async function generateOwnerKeys() {
  const pair = await crypto.subtle.generateKey(ALGO, true, ['sign', 'verify']);
  const pub = await crypto.subtle.exportKey('jwk', pair.publicKey);
  const priv = await crypto.subtle.exportKey('jwk', pair.privateKey);
  const publicJwk = { kty: 'EC', crv: 'P-256', x: pub.x, y: pub.y };
  return { kid: await keyId(publicJwk), publicJwk, privateJwk: { kty: 'EC', crv: 'P-256', x: priv.x, y: priv.y, d: priv.d } };
}

export const importPrivate = (jwk) => crypto.subtle.importKey('jwk', { ...jwk, ext: true }, ALGO, false, ['sign']);

const ID_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function newLicenseId(len = 10) {
  const a = new Uint8Array(len);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => ID_CHARS[b % 32]).join('');
}

// حمولة الاشتراك: الباقة + ميزات مضافة ومحذوفة + التواريخ (+ كود جهاز اختياري)
export function buildPayload({ kid, customer = '', plan = '', add = [], remove = [], issued, exp = '', device = '', id = newLicenseId() }) {
  const p = cleanPayload({ v: 1, id, k: kid, c: String(customer).trim().slice(0, 80), p: plan, a: add, r: remove, i: issued, e: exp, d: String(device).trim().toUpperCase() });
  if (!p) throw new Error('بيانات الاشتراك غير صالحة (راجع التواريخ وكود الجهاز)');
  return p;
}

export async function signLicense(payload, privateKey) {
  const p = cleanPayload(payload);
  if (!p) throw new Error('بيانات الاشتراك غير صالحة');
  const key = privateKey && privateKey.type === 'private' ? privateKey : await importPrivate(privateKey);
  const body = textToB64u(JSON.stringify(p));
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, utf8.encode(`${PREFIX}.${body}`)));
  return `${PREFIX}.${body}.${b64u.enc(sig)}`;
}

// ─── حفظ المفتاح الخاص مشفّراً بكلمة سر المالك (PBKDF2 + AES-GCM) ───
async function kdf(pass, salt, iter) {
  const base = await crypto.subtle.importKey('raw', utf8.encode(pass), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function wrapKeys({ kid, publicJwk, privateJwk }, pass, { iter = 310000 } = {}) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await kdf(pass, salt, iter);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, utf8.encode(JSON.stringify(privateJwk))));
  return { v: 1, kid, pub: publicJwk, iter, salt: b64u.enc(salt), iv: b64u.enc(iv), data: b64u.enc(ct) };
}

// يرجّع { kid, publicJwk, privateKey } (مفتاح توقيع غير قابل للتصدير). كلمة سر خاطئة = خطأ
export async function unwrapKeys(blob, pass) {
  if (!blob || blob.v !== 1 || !blob.pub || !blob.data || !Number.isInteger(blob.iter) || blob.iter < 1000 || blob.iter > 5000000) throw new Error('ملف المفتاح غير صالح');
  let privateJwk;
  try {
    const key = await kdf(pass, b64u.dec(blob.salt), blob.iter);
    privateJwk = JSON.parse(unutf8.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64u.dec(blob.iv) }, key, b64u.dec(blob.data))));
  } catch (e) { throw new Error('كلمة السر غير صحيحة'); }
  return { kid: blob.kid, publicJwk: blob.pub, privateKey: await importPrivate(privateJwk) };
}

// سطر جاهز للصق في js/license-key.js
export const publicKeyLine = (kid, publicJwk) => `{ kid: '${kid}', jwk: ${JSON.stringify({ kty: 'EC', crv: 'P-256', x: publicJwk.x, y: publicJwk.y })} },`;
