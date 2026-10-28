// ═══ الاشتراكات: التحقق من كود التفعيل الموقّع على الجهاز نفسه، وتحديد الميزات المسموحة ═══
// بلا DOM وبلا خادم. المالك يصدر لكل زبون كوداً موقّعاً (باقة + ميزات إضافية أو محذوفة + تاريخ انتهاء)،
// والبرنامج يتحقق من التوقيع بالمفتاح العام ثم يفتح للزبون ما اشتراه فقط. بيانات الزبون لا تُقفل أبداً.
import { ymd, daysBetween, isDate } from './core.js';
import { CONFIG, FEATURES, PLANS, planFeatures, featureById } from './plans.js';
import { PUBLIC_KEYS } from './license-key.js';

export const PREFIX = 'AHS1';
const LS_LICENSE = 'ahsebha-license';
const LS_DEVICE = 'ahsebha-device';
const LS_PREVIEW = 'ahsebha-preview';

// ─── ترميز base64 آمن للروابط ───
const utf8 = new TextEncoder();
const unutf8 = new TextDecoder();
export const b64u = {
  enc(bytes) {
    let s = '';
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  },
  dec(str) {
    const p = String(str).replace(/-/g, '+').replace(/_/g, '/');
    return Uint8Array.from(atob(p + '='.repeat((4 - (p.length % 4)) % 4)), (c) => c.charCodeAt(0));
  },
};
export const textToB64u = (s) => b64u.enc(utf8.encode(s));

// معرّف المفتاح: أول 10 خانات من بصمته، ليعرف البرنامج أي مفتاح وقّع الكود (يسمح بتبديل المفتاح لاحقاً)
export async function keyId(jwk) {
  const canon = JSON.stringify({ crv: 'P-256', kty: 'EC', x: jwk.x, y: jwk.y });
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', utf8.encode(canon)));
  return Array.from(h.slice(0, 5), (b) => b.toString(16).padStart(2, '0')).join('');
}
const importPublic = (jwk) => crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y, ext: true }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);

export const REASONS = {
  format: 'هذا ليس كود اشتراك. انسخه كاملاً من الرسالة التي وصلتك.',
  signature: 'الكود غير صحيح أو مقصوص. تأكد أنك نسخته كاملاً.',
  nokey: 'الاشتراكات غير مفعّلة في هذا الإصدار بعد.',
  bad: 'الكود يحتوي بيانات غير صالحة.',
  device: 'هذا الكود مخصص لجهاز آخر. أرسل «كود جهازك» ليصدروا لك كوداً لهذا الجهاز.',
  future: 'تاريخ جهازك غير صحيح (أقدم من تاريخ إصدار الكود). صحّح التاريخ ثم أعد المحاولة.',
  expired: 'هذا الكود منتهي الصلاحية. اطلب كود تجديد.',
};

// ─── قراءة الكود (بدون تحقق من التوقيع) ───
// يقبل الكود نفسه أو رابط التفعيل كاملاً، ويتجاهل المسافات وفواصل الأسطر التي يضيفها واتساب
export function parseCode(input) {
  const clean = String(input ?? '').replace(/[\s​-‏‪-‮⁦-⁩﻿]/g, '');
  const m = clean.match(new RegExp(`${PREFIX}\\.([A-Za-z0-9_-]{8,})\\.([A-Za-z0-9_-]{80,100})`));
  if (!m) return { ok: false, reason: 'format' };
  let obj;
  try { obj = JSON.parse(unutf8.decode(b64u.dec(m[1]))); } catch (e) { return { ok: false, reason: 'bad' }; }
  const payload = cleanPayload(obj);
  if (!payload) return { ok: false, reason: 'bad' };
  return { ok: true, body: m[1], sig: m[2], payload, code: `${PREFIX}.${m[1]}.${m[2]}` };
}

// تنظيف الحمولة: نقبل فقط الحقول المعروفة بالأشكال المعروفة
export function cleanPayload(o) {
  if (!o || typeof o !== 'object' || o.v !== 1) return null;
  const str = (x, max) => (typeof x === 'string' && x.length <= max ? x : '');
  const id = str(o.id, 20);
  if (!/^[A-Z0-9]{6,20}$/.test(id)) return null;
  const issued = str(o.i, 10);
  if (!isDate(issued)) return null;
  const exp = o.e == null || o.e === '' ? '' : str(o.e, 10);
  if (exp && (!isDate(exp) || exp < issued)) return null;
  const dev = str(o.d, 20);
  if (dev && !/^[A-Z0-9-]{4,20}$/.test(dev)) return null;
  const list = (a) => (Array.isArray(a) ? [...new Set(a.filter((x) => typeof x === 'string' && /^[a-z][a-z0-9-]{0,24}$/.test(x)))].slice(0, 60) : []);
  return { v: 1, id, k: str(o.k, 16), c: str(o.c, 80), p: str(o.p, 20), a: list(o.a), r: list(o.r), i: issued, e: exp, d: dev };
}

// ─── التحقق من التوقيع ───
export async function verifyCode(input, { keys = PUBLIC_KEYS } = {}) {
  const p = parseCode(input);
  if (!p.ok) return p;
  if (!keys.length) return { ok: false, reason: 'nokey' };
  const cands = p.payload.k ? keys.filter((k) => k.kid === p.payload.k) : keys;
  const data = utf8.encode(`${PREFIX}.${p.body}`);
  const sig = b64u.dec(p.sig);
  if (sig.length !== 64) return { ok: false, reason: 'signature' };
  for (const k of cands) {
    try {
      if (await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, await importPublic(k.jwk), sig, data)) return { ok: true, payload: p.payload, code: p.code };
    } catch (e) { /* جرّب المفتاح التالي */ }
  }
  return { ok: false, reason: 'signature' };
}

// ─── الميزات والحالة ───
export function resolveFeatures(payload) {
  const removed = new Set(payload.r || []);
  return new Set([...planFeatures(payload.p), ...(payload.a || [])].filter((id) => featureById(id) && !removed.has(id)));
}

// الحالة بتاريخ معيّن. e = آخر يوم صالح. بعده مهلة بالأيام تبقى فيها الميزات ثم تُقفل
export function entitlementOf(payload, today, graceDays = CONFIG.graceDays) {
  const free = new Set(planFeatures('free'));
  const freeName = PLANS.free ? PLANS.free.name : 'المجانية';
  if (!payload) return { status: 'free', plan: 'free', planName: freeName, features: free, customer: '', id: '', exp: '', issued: '', daysLeft: null, graceLeft: 0 };
  const left = payload.e ? daysBetween(today, payload.e) : null;
  const status = left == null ? 'lifetime' : left >= 0 ? 'active' : -left <= graceDays ? 'grace' : 'expired';
  return {
    status, plan: payload.p || 'custom', planName: (PLANS[payload.p] && PLANS[payload.p].name) || 'مخصّصة',
    features: status === 'expired' ? free : resolveFeatures(payload),
    customer: payload.c, id: payload.id, exp: payload.e, issued: payload.i, daysLeft: left, graceLeft: status === 'grace' ? graceDays + left : 0,
  };
}

// ─── التخزين على الجهاز (منفصل عن بيانات المحاسبة، فلا يُحذف مع «حذف كل البيانات») ───
export function memoryStorage() {
  const m = new Map();
  return { get: (k) => (m.has(k) ? m.get(k) : null), set: (k, v) => { m.set(k, String(v)); }, del: (k) => { m.delete(k); } };
}
let storage = null;
const store = () => {
  if (storage) return storage;
  let ls = null;
  try { ls = typeof localStorage !== 'undefined' ? localStorage : null; if (ls) ls.getItem(LS_LICENSE); } catch (e) { ls = null; }
  storage = ls
    ? {
      get: (k) => { try { return ls.getItem(k); } catch (e) { return null; } },
      set: (k, v) => { try { ls.setItem(k, v); } catch (e) { /* التخزين ممنوع: يبقى للجلسة */ } },
      del: (k) => { try { ls.removeItem(k); } catch (e) { /* لا شيء */ } },
    }
    : memoryStorage();
  return storage;
};
export const useStorage = (s) => { storage = s; };
let clock = () => ymd(new Date());
export const setClock = (fn) => { clock = fn; };
export const todayYmd = () => clock();

let current = null; // { code, payload } بعد التحقق
let lastError = '';

export async function init({ keys } = {}) {
  current = null;
  lastError = '';
  const code = store().get(LS_LICENSE);
  if (!code) return { ok: true, active: false };
  const v = await verifyCode(code, keys ? { keys } : undefined);
  if (!v.ok) { lastError = v.reason; return { ok: false, reason: v.reason }; }
  if (v.payload.d && v.payload.d !== deviceCode()) { lastError = 'device'; return { ok: false, reason: 'device' }; }
  current = { code: v.code, payload: v.payload };
  return { ok: true, active: true };
}

// هل يُقبل هذا الاشتراك على هذا الجهاز الآن؟ يرجّع سبب الرفض أو '' (لا يُقبل المنتهي ولا المخصص لجهاز آخر)
export function rejectReason(payload) {
  if (payload.d && payload.d !== deviceCode()) return 'device';
  const today = clock();
  if (daysBetween(today, payload.i) > 2) return 'future';
  if (entitlementOf(payload, today).status === 'expired') return 'expired';
  return '';
}

// تفعيل كود جديد
export async function activate(input, { keys } = {}) {
  const v = await verifyCode(input, keys ? { keys } : undefined);
  if (!v.ok) return v;
  const bad = rejectReason(v.payload);
  if (bad) return { ok: false, reason: bad };
  const ent = entitlementOf(v.payload, clock());
  current = { code: v.code, payload: v.payload };
  lastError = '';
  store().set(LS_LICENSE, v.code);
  return { ok: true, entitlement: ent, payload: v.payload };
}

export function clear() { current = null; lastError = ''; store().del(LS_LICENSE); }
export const license = () => (current ? { code: current.code, payload: current.payload } : null);
export const storedProblem = () => lastError;
export const entitlement = (today = clock()) => entitlementOf(current && current.payload, today);

// ─── التفعيل والمعاينة ───
export function setPreview(on) { if (on) store().set(LS_PREVIEW, '1'); else store().del(LS_PREVIEW); }
export const previewing = () => store().get(LS_PREVIEW) === '1';
// الاشتراكات تُطبَّق إذا فعّلها المالك للجميع، أو على هذا الجهاز فقط للمعاينة
export const enforcing = () => !!CONFIG.enforce || previewing();
export const has = (id) => !enforcing() || entitlement().features.has(id);

// أي ميزة تحكم هذا الرابط؟ (null = أساسي لا يُقفل)
const bySeg = () => { const m = new Map(); for (const f of FEATURES) for (const s of f.segs) m.set(s, f.id); return m; };
export const featureOfPath = (path) => bySeg().get(String(path || '').replace(/^#?\/?/, '').split('?')[0].split('/')[0]) || null;
export const lockedFeature = (path) => { const f = featureOfPath(path); return f && !has(f) ? f : null; };

// كود الجهاز: يُرسله الزبون عند الطلب إذا أراد المالك ربط الاشتراك بجهاز واحد
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function deviceCode() {
  let v = store().get(LS_DEVICE);
  if (!/^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(v || '')) {
    const a = new Uint8Array(8);
    crypto.getRandomValues(a);
    const s = Array.from(a, (b) => ALPHABET[b % 32]).join('');
    v = `${s.slice(0, 4)}-${s.slice(4)}`;
    store().set(LS_DEVICE, v);
  }
  return v;
}

// رابط واتساب للتواصل مع المالك (يعمل فقط إذا ضُبط الرقم)
export const contactLink = (text, number = CONFIG.whatsapp) => (number ? `https://wa.me/${String(number).replace(/\D/g, '')}?text=${encodeURIComponent(text)}` : '');
// رابط التفعيل بنقرة واحدة
export const activationLink = (code) => `${CONFIG.siteUrl}#/activate?k=${code}`;
