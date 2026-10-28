// ═══ الاشتراك: حالة باقتك وميزاتك، تفعيل الكود، وصفحات القفل للميزات غير المشمولة ═══
// بيانات المحاسبة لا تُقفل أبداً: عند انتهاء الاشتراك تُقفل الميزات المدفوعة فقط، والنسخ الاحتياطي متاح دائماً.
import * as store from '../store.js';
import * as lic from '../license.js';
import { CONFIG, FEATURES, PLANS, featureById, planFeatures } from '../plans.js';
import { html, toast, confirmBox, modal, fmtDate, $ } from '../ui.js';
import { setTitle, go } from '../nav.js';
import { head, countAr } from './common.js';

const DAYS = ['يوم', 'يومان', 'أيام', 'يوماً'];
const daysText = (n) => (n === 0 ? 'اليوم' : countAr(n, DAYS));

// أين يرى الزبون الباقات؟ صفحة الأسعار تظهر فقط بعد أن ينشرها المالك (أو في معاينة المالك)
const showPlansLink = () => CONFIG.published || lic.previewing();
const wantText = (what) => `السلام عليكم، أريد ${what} في برنامج احسبها.`;

// أزرار التواصل لطلب الاشتراك أو التجديد
function actions(what = 'الاشتراك', { extra = '' } = {}) {
  const wa = lic.contactLink(wantText(what));
  return html`${showPlansLink() ? html`<a class="btn btn-primary" href="plans.html" target="_blank" rel="noopener">💳 عرض الباقات والأسعار</a>` : ''}
    ${wa ? html`<a class="btn ${showPlansLink() ? 'btn-ghost' : 'btn-primary'}" href="${wa}" target="_blank" rel="noopener">💬 اطلب عبر واتساب</a>` : ''}${extra}`;
}

// ─── شريط تنبيه على الرئيسية: فقط عند اقتراب الانتهاء أو انتهائه ───
export function banner() {
  if (!lic.enforcing() || !lic.license()) return '';
  const e = lic.entitlement();
  const renew = html` <a href="#/subscription">جدّد من هنا</a>`;
  if (e.status === 'active' && e.daysLeft <= 7) return html`<p class="note note-warn" style="margin-bottom:14px">⏳ اشتراكك (${e.planName}) ينتهي ${e.daysLeft === 0 ? 'اليوم' : `بعد ${daysText(e.daysLeft)}`}. جدّده حتى لا تُقفل الميزات المدفوعة.${renew}</p>`;
  if (e.status === 'grace') return html`<p class="note note-warn" style="margin-bottom:14px">⚠️ انتهى اشتراكك (${e.planName}) وما زالت ميزاته تعمل ${daysText(e.graceLeft)} إضافية ثم تُقفل. بياناتك محفوظة في كل الأحوال.${renew}</p>`;
  if (e.status === 'expired') return html`<p class="note note-warn" style="margin-bottom:14px">🔒 انتهى اشتراكك وعاد البرنامج للباقة المجانية. بياناتك كلها محفوظة وتستطيع تنزيل نسخة احتياطية في أي وقت.${renew}</p>`;
  return '';
}

// ─── نافذة: هذه الميزة ليست ضمن باقتك ───
export async function requireFeature(id) {
  if (lic.has(id)) return true;
  const f = featureById(id) || { name: 'هذه الميزة', desc: '' };
  await modal({
    title: '🔒 ميزة ضمن الاشتراك',
    body: html`<p class="dlg-msg"><b>${f.name}</b> ليست ضمن باقتك الحالية.<br><span class="muted small">${f.desc}</span></p>
      <div class="dlg-actions">${actions(`ميزة «${f.name}»`, { extra: html`<a class="btn btn-ghost" href="#/subscription" data-no>عندي كود تفعيل</a>` })}<button type="button" class="btn btn-ghost" data-no>إغلاق</button></div>`,
    onMount: (dlg, done) => dlg.querySelectorAll('[data-no]').forEach((b) => b.addEventListener('click', () => done(null))),
  });
  return false;
}

// ─── صفحة تظهر مكان الميزة المقفلة ───
export function lockedPage(root, id) {
  const f = featureById(id) || { name: 'هذه الميزة', desc: '', icon: '🔒' };
  setTitle('ميزة ضمن الاشتراك');
  const inPlans = Object.values(PLANS).filter((p) => p.id !== 'free' && planFeatures(p.id).includes(id)).map((p) => p.name);
  root.innerHTML = String(html`<div class="empty lock-page"><div class="empty-ic">🔒</div>
    <h3>«${f.name}» ليست ضمن باقتك الحالية</h3>
    <p>${f.desc}</p>
    ${inPlans.length ? html`<p class="muted small">متوفرة في: ${inPlans.join('، ')}</p>` : ''}
    <div class="actions" style="justify-content:center;margin-top:14px">${actions(`ميزة «${f.name}»`)}<a class="btn btn-ghost" href="#/subscription">🔑 عندي كود تفعيل</a><a class="btn btn-ghost" href="#/">الرئيسية</a></div>
    <p class="muted small" style="margin-top:14px">بياناتك كلها محفوظة وتعمل كما هي، ويمكنك تنزيل نسخة احتياطية من الإعدادات في أي وقت.</p></div>`);
}

// تفعيل بعد التأكد قبل استبدال اشتراك فعّال بآخر
async function tryActivate(input) {
  const v = await lic.verifyCode(input);
  if (!v.ok) return v;
  const bad = lic.rejectReason(v.payload);
  if (bad) return { ok: false, reason: bad };
  const cur = lic.license();
  const e = lic.entitlement();
  if (cur && cur.payload.id !== v.payload.id && e.status !== 'expired') {
    const ok = await confirmBox(`عندك اشتراك مفعّل (${e.planName}${e.exp ? ' حتى ' + fmtDate(e.exp) : ''}). هل تريد استبداله بالكود الجديد؟`, { ok: 'استبدال', title: 'استبدال الاشتراك' });
    if (!ok) return { ok: false, reason: 'cancelled' };
  }
  return lic.activate(v.code);
}
const refreshShell = () => window.dispatchEvent(new Event('acc:shell'));

// ─── رابط التفعيل: #/activate?k=الكود (يعمل حتى قبل إنشاء المنشأة) ───
export async function activate({ root, query }) {
  setTitle('تفعيل الاشتراك');
  root.innerHTML = String(html`<div class="empty"><div class="empty-ic">🔑</div><h3>جارٍ التحقق من الكود…</h3></div>`);
  const r = await tryActivate(query.k || '');
  if (r.ok) {
    refreshShell();
    toast(`تم تفعيل اشتراكك: ${r.entitlement.planName} ✓`);
    go(store.getDb() ? '#/subscription' : '#/welcome');
    return;
  }
  if (r.reason === 'cancelled') { go('#/subscription'); return; }
  root.innerHTML = String(html`<div class="empty"><div class="empty-ic">⚠️</div><h3>تعذّر تفعيل الكود</h3><p>${lic.REASONS[r.reason] || 'حدث خطأ غير متوقع.'}</p>
    <p><a class="btn btn-primary" href="${store.getDb() ? '#/subscription' : '#/welcome'}">${store.getDb() ? 'الصق الكود يدوياً' : 'العودة'}</a></p></div>`);
}

// ─── صفحة اشتراكي ───
export function view({ root }) {
  setTitle('اشتراكي');
  const on = lic.enforcing();
  const e = lic.entitlement();
  const problem = lic.storedProblem();
  const lastBackup = store.getDb() && store.getDb().settings.lastBackupAt;

  const statusCard = () => {
    const wait = !on ? html`<p class="note note-info" style="margin-bottom:12px">ℹ️ الاشتراكات لم تبدأ بعد: كل الميزات مفتوحة الآن للجميع.</p>` : '';
    const prob = problem ? html`<p class="note note-warn" style="margin-bottom:12px">⚠️ الكود المحفوظ على هذا الجهاز لا يعمل: ${lic.REASONS[problem] || ''}</p>` : '';
    if (e.status === 'free') {
      return html`<div class="card sub-card">${wait}${prob}<div class="card-h"><h3>💳 باقتك الحالية: ${e.planName}</h3></div>
        <p class="today-text">تعمل كل الميزات الأساسية: الفواتير والعملاء والمنتجات والمصروفات والتقارير والنسخ الاحتياطي. اشترك لتفتح باقي الميزات.</p>
        <div class="actions" style="margin-top:12px">${actions()}</div></div>`;
    }
    const line = e.status === 'lifetime' ? 'اشتراك دائم بلا تاريخ انتهاء'
      : e.status === 'active' ? `ينتهي ${fmtDate(e.exp)} (باقي ${daysText(e.daysLeft)})`
        : e.status === 'grace' ? `انتهى ${fmtDate(e.exp)}، والميزات تعمل ${daysText(e.graceLeft)} إضافية ثم تُقفل`
          : `انتهى في ${fmtDate(e.exp)} وعدت للباقة المجانية`;
    const warn = e.status === 'grace' || e.status === 'expired' || (e.status === 'active' && e.daysLeft <= 7);
    return html`<div class="card sub-card ${warn ? 'sub-warn' : 'sub-ok'}">${wait}${prob}<div class="card-h"><h3>${e.status === 'expired' ? '🔒' : warn ? '⏳' : '✅'} باقتك: ${e.planName}</h3>
      <button type="button" class="btn btn-ghost btn-sm" data-clear>إلغاء التفعيل على هذا الجهاز</button></div>
      <p class="today-text">${line}${e.customer ? html`<br><span class="muted small">مرخّص لـ: ${e.customer}</span>` : ''}</p>
      ${e.status === 'expired' ? html`<p class="muted small" style="margin-top:8px">بياناتك كلها محفوظة. ${lastBackup ? '' : 'نزّل نسخة احتياطية من '}<a href="#/settings">الإعدادات</a>${lastBackup ? ' ← النسخ الاحتياطي متاح دائماً.' : '.'}</p>` : ''}
      ${warn ? html`<div class="actions" style="margin-top:12px">${actions('تجديد الاشتراك')}</div>` : ''}</div>`;
  };

  const rows = FEATURES.map((f) => {
    const has = e.features.has(f.id) || !on;
    const seg = f.segs[0];
    return html`<li class="feat-row ${has ? 'is-on' : 'is-off'}"><span class="feat-ic" aria-hidden="true">${f.icon}</span>
      <div><b>${f.name}</b><div class="muted small">${f.desc}</div></div>
      ${has ? html`<span class="badge badge-ok">متاحة</span>` : seg ? html`<a class="badge badge-muted" href="#/${seg}">🔒 مقفلة</a>` : html`<span class="badge badge-muted">🔒 مقفلة</span>`}</li>`;
  });
  const open = FEATURES.filter((f) => e.features.has(f.id) || !on).length;

  root.innerHTML = String(html`${head('اشتراكي', { sub: 'باقتك وميزاتك وتفعيل كود الاشتراك' })}
    ${statusCard()}
    <div class="card" style="margin-top:14px"><div class="card-h"><h3>🔑 تفعيل كود الاشتراك</h3></div>
      <form data-form novalidate class="stack">
        <label class="fld"><span class="fld-l">الصق الكود أو رابط التفعيل الذي وصلك</span>
          <textarea class="inp" name="code" rows="3" dir="ltr" placeholder="AHS1.…" autocomplete="off" spellcheck="false"></textarea>
          <small class="fld-e" data-err hidden></small></label>
        <div><button class="btn btn-primary">تفعيل</button></div>
      </form></div>
    <div class="card" style="margin-top:14px"><div class="card-h"><h3>✨ الميزات</h3><span class="muted small">${open} من ${FEATURES.length} متاحة</span></div>
      <ul class="feat-list">${rows}</ul>
      <p class="muted small" style="margin-top:10px">الفواتير والعملاء والمنتجات والمصروفات والسندات والتقارير والنسخ الاحتياطي أساسية ومتاحة دائماً.</p></div>
    <div class="card" style="margin-top:14px"><div class="card-h"><h3>📱 كود هذا الجهاز</h3></div>
      <p class="muted small">إذا طلبت اشتراكاً مرتبطاً بجهاز واحد أرسل هذا الكود لمزوّد البرنامج. أغلب الاشتراكات لا تحتاجه.</p>
      <div class="inline" style="margin-top:8px"><code class="dev-code" dir="ltr" data-device>${lic.deviceCode()}</code><button type="button" class="btn btn-ghost btn-sm" data-copy>نسخ</button></div></div>`);

  const form = $('[data-form]', root);
  const err = $('[data-err]', root);
  form.onsubmit = async (ev) => {
    ev.preventDefault();
    err.hidden = true;
    const r = await tryActivate(form.code.value);
    if (r.ok) { refreshShell(); toast(`تم تفعيل اشتراكك: ${r.entitlement.planName} ✓`); view({ root }); return; }
    if (r.reason === 'cancelled') return;
    err.textContent = lic.REASONS[r.reason] || 'تعذّر تفعيل الكود.';
    err.hidden = false;
  };
  const clear = $('[data-clear]', root);
  if (clear) {
    clear.onclick = async () => {
      if (!(await confirmBox('سيعود البرنامج للباقة المجانية على هذا الجهاز. بياناتك لا تتأثر، ويمكنك تفعيل الكود لاحقاً.', { ok: 'إلغاء التفعيل', danger: true, title: 'إلغاء التفعيل' }))) return;
      lic.clear();
      refreshShell();
      view({ root });
    };
  }
  $('[data-copy]', root).onclick = async () => {
    try { await navigator.clipboard.writeText(lic.deviceCode()); toast('تم نسخ كود الجهاز ✓'); } catch (e2) { toast('انسخ الكود يدوياً', 'warn'); }
  };
}
