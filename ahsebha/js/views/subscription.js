// ═══ الاشتراك: حالة باقتك وميزاتك، تفعيل الكود، وصفحات القفل للميزات غير المشمولة ═══
// بيانات المحاسبة لا تُقفل أبداً: عند انتهاء الاشتراك تُقفل الميزات المدفوعة فقط، والنسخ الاحتياطي متاح دائماً.
import * as store from '../store.js';
import { BRAND } from '../brand.js';
import * as lic from '../license.js';
import { CONFIG, FEATURES, PLANS, featureById, planFeatures } from '../plans.js';
import { html, raw, toast, confirmBox, modal, fmtDate, $ } from '../ui.js';
import { icon } from '../icons.js';
import { daysBetween } from '../core.js';
import { setTitle, go, SEG } from '../nav.js';
import { head, countAr } from './common.js';

const DAYS = ['يوم', 'يومان', 'أيام', 'يوماً'];
const daysText = (n) => (n === 0 ? 'اليوم' : countAr(n, DAYS));

// أين يرى الزبون الباقات؟ صفحة الأسعار تظهر فقط بعد أن ينشرها المالك (أو في معاينة المالك)
const showPlansLink = () => CONFIG.published || lic.previewing();
const wantText = (what) => `السلام عليكم، أريد ${what} في برنامج ${BRAND.name}.`;

// أزرار التواصل لطلب الاشتراك أو التجديد
function actions(what = 'الاشتراك', { extra = '' } = {}) {
  const wa = lic.contactLink(wantText(what));
  return html`${showPlansLink() ? html`<a class="btn btn-primary" href="plans.html" target="_blank" rel="noopener">💳 عرض الباقات والأسعار</a>` : ''}
    ${wa ? html`<a class="btn ${showPlansLink() ? 'btn-ghost' : 'btn-primary'}" href="${wa}" target="_blank" rel="noopener">💬 اطلب عبر واتساب</a>` : ''}${extra}`;
}

// ─── شريط تنبيه على الرئيسية: فقط عند اقتراب الانتهاء أو انتهائه ───
export function banner() {
  if (!lic.enforcing() || !lic.license() || lic.demo()) return '';
  const e = lic.entitlement();
  const renew = html` <a href="#/subscription">جدّد من هنا</a>`;
  if (e.status === 'active' && e.daysLeft <= 7) return html`<p class="note note-warn" style="margin-bottom:14px">⏳ اشتراكك (${e.planName}) ينتهي ${e.daysLeft === 0 ? 'اليوم' : `بعد ${daysText(e.daysLeft)}`}. جدّده حتى لا تُقفل الميزات المدفوعة.${renew}</p>`;
  if (e.status === 'grace') return html`<p class="note note-warn" style="margin-bottom:14px">⚠️ انتهى اشتراكك (${e.planName}) وما زالت ميزاته تعمل ${daysText(e.graceLeft)} إضافية ثم تُقفل. بياناتك محفوظة في كل الأحوال.${renew}</p>`;
  if (e.status === 'expired') return html`<p class="note note-warn" style="margin-bottom:14px">🔒 انتهى اشتراكك وعاد البرنامج للباقة المجانية. بياناتك كلها محفوظة وتستطيع تنزيل نسخة احتياطية في أي وقت.${renew}</p>`;
  return '';
}

// ─── نسخة العرض: شريط أعلى الصفحات، وصفحة ونافذة عند الوصول للحد ───
const demoTime = (d) => (d.daysLeft == null ? '' : d.expired ? 'انتهت مدتها' : d.daysLeft === 0 ? 'تنتهي اليوم' : `تنتهي بعد ${daysText(d.daysLeft)}`);
// شرح الحالة بجملة: ماذا بقي أو لماذا توقفت
const demoWhy = (d) => (d.reason === 'expired' ? 'انتهت مدة نسخة العرض.' : d.reason === 'limit' ? `وصلت لحد نسخة العرض: ${lic.invoicesText(d.limit)}.` : `باقي ${lic.invoicesText(d.left)} من ${d.limit}.`);

export function demoBar(el) {
  if (!el) return;
  const d = lic.demo();
  if (!d) { el.hidden = true; el.innerHTML = ''; return; }
  const low = d.blocked || d.left <= 2 || (d.daysLeft != null && d.daysLeft <= 3);
  el.hidden = false;
  el.className = `demo-bar${d.blocked ? ' is-blocked' : low ? ' is-low' : ''}`;
  el.innerHTML = String(html`<span class="demo-txt"><b>🧪 نسخة عرض</b> · ${d.blocked ? demoWhy(d) : html`باقي <b>${d.left}</b> من ${lic.invoicesText(d.limit)}${d.daysLeft != null ? html` · ${demoTime(d)}` : ''}`}</span>
    <a class="btn btn-sm ${d.blocked ? 'btn-primary' : 'btn-ghost'}" href="#/subscription" data-demo-activate>🔑 فعّل اشتراكك</a>`);
}

// الصفحات التي تنشئ فاتورة: تُستبدل بصفحة الحد عندما تنتهي نسخة العرض
const DEMO_ROUTES = new Set(['pos', ...lic.DEMO_TYPES.map((t) => `${SEG[t]}/new`)]);
export function demoBlocksRoute(path) {
  const d = lic.demo();
  return !!d && d.blocked && DEMO_ROUTES.has(String(path || '').split('?')[0].split('/').filter(Boolean).join('/'));
}

// أزرار الصفحة والنافذة عند الوصول للحد
function demoActions(extra = '') {
  const wa = lic.contactLink(wantText('تفعيل الاشتراك بعد تجربة النسخة'));
  return html`${wa ? html`<a class="btn btn-primary" href="${wa}" target="_blank" rel="noopener" data-demo-wa>💬 اطلب كود الاشتراك</a>` : ''}
    <a class="btn ${wa ? 'btn-ghost' : 'btn-primary'}" href="#/subscription" data-demo-code${extra}>🔑 عندي كود تفعيل</a>`;
}
const demoSafe = html`<p class="muted small" style="margin-top:10px">بياناتك كلها محفوظة: تستطيع تصفحها وطباعتها وتنزيل نسخة احتياطية من الإعدادات. وعند التفعيل ترجع الفواتير وتبقى بياناتك كما هي.</p>`;
const demoNoWa = () => (lic.contactLink('x') ? '' : html`<p class="muted small" style="margin-top:10px">لتفعيل الاشتراك تواصل مع من زوّدك بالبرنامج ليرسل لك كود التفعيل.</p>`);

export function demoLimitPage(root) {
  const d = lic.demo();
  setTitle('نسخة العرض');
  root.innerHTML = String(html`<div class="empty lock-page" data-demo-limit><div class="empty-ic">🧪</div>
    <h3>${d && d.reason === 'expired' ? 'انتهت مدة نسخة العرض' : 'وصلت لحد فواتير نسخة العرض'}</h3>
    <p>${d ? demoWhy(d) : ''} عجبك البرنامج؟ اطلب كود الاشتراك وفعّله هنا لتكمل عملك بنفس بياناتك.</p>
    <div class="actions" style="justify-content:center;margin-top:14px">${demoActions()}<a class="btn btn-ghost" href="#/">الرئيسية</a></div>
    ${demoNoWa()}${demoSafe}</div>`);
}

// نافذة عند محاولة الحفظ بعد الحد (أو عند وصول الحد أثناء العمل): تُرجع true إن كان الخطأ خطأ نسخة العرض
export function handleDemoError(e) {
  if (!e || e.code !== 'DEMO_LIMIT') return false;
  modal({
    title: '🧪 نسخة العرض',
    body: html`<p class="dlg-msg">${demoWhy(e.demo)} عجبك البرنامج؟ اطلب كود الاشتراك وفعّله لتكمل عملك بنفس بياناتك.</p>
      <div class="dlg-actions">${demoActions(' data-no')}<button type="button" class="btn btn-ghost" data-no>إغلاق</button></div>${demoNoWa()}${demoSafe}`,
    onMount: (dlg, done) => dlg.querySelectorAll('[data-no]').forEach((b) => b.addEventListener('click', () => done(null))),
  });
  return true;
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
  // نسخة العرض ليست اشتراكاً: يُستبدل بها أو بغيرها بلا سؤال، والسؤال فقط قبل استبدال اشتراك حقيقي فعّال
  if (cur && cur.payload.id !== v.payload.id && !cur.payload.n && e.status !== 'expired') {
    const what = v.payload.n ? `الكود الجديد نسخة عرض محدودة (${lic.invoicesText(v.payload.n)})` : 'الكود الجديد بديل عنه';
    const ok = await confirmBox(`عندك اشتراك مفعّل (${e.planName}${e.exp ? ' حتى ' + fmtDate(e.exp) : ''}). ${what}. هل تريد استبداله؟`, { ok: 'استبدال', title: 'استبدال الاشتراك' });
    if (!ok) return { ok: false, reason: 'cancelled' };
  }
  return lic.activate(v.code);
}
const refreshShell = () => window.dispatchEvent(new Event('acc:shell'));
const activatedText = (r) => (r.payload.n ? `تم تفعيل نسخة العرض ✓ (${lic.invoicesText(r.payload.n)})` : `تم تفعيل اشتراكك: ${r.entitlement.planName} ✓`);

// ─── رابط التفعيل: #/activate?k=الكود (يعمل حتى قبل إنشاء المنشأة) ───
export async function activate({ root, query }) {
  setTitle('تفعيل الاشتراك');
  root.innerHTML = String(html`<div class="empty"><div class="empty-ic">🔑</div><h3>جارٍ التحقق من الكود…</h3></div>`);
  const r = await tryActivate(query.k || '');
  if (r.ok) {
    refreshShell();
    toast(activatedText(r));
    go(store.getDb() ? '#/subscription' : '#/welcome');
    return;
  }
  if (r.reason === 'cancelled') { go('#/subscription'); return; }
  root.innerHTML = String(html`<div class="empty"><div class="empty-ic">⚠️</div><h3>تعذّر تفعيل الكود</h3><p>${lic.REASONS[r.reason] || 'حدث خطأ غير متوقع.'}</p>
    <p><a class="btn btn-primary" href="${store.getDb() ? '#/subscription' : '#/welcome'}">${store.getDb() ? 'الصق الكود يدوياً' : 'العودة'}</a></p></div>`);
}

// ─── صفحة اشتراكي: لوحة الزبون (باقته، المتبقي، التفعيل، الميزات، كود الجهاز) ───
const pctOf = (v) => Math.max(0, Math.min(100, Math.round(v)));
const hero = ({ tone, ic, kicker, title, badge, line, big, small, pct, label, actions: acts, attr = '', meterCls = '' }) => html`<div class="card sub-card sub-hero tone-${tone}" ${raw(attr)}>
  <div class="sub-hero-main"><span class="sub-ic">${raw(icon(ic))}</span>
    <div class="sub-hero-text"><div class="sub-kicker">${kicker}</div>
      <h3 class="sub-plan">${title}${badge ? html` <span class="badge badge-${badge[0]}">${badge[1]}</span>` : ''}</h3>
      <p class="sub-line">${line}</p></div></div>
  ${pct != null ? html`<div class="sub-hero-side"><div class="sub-days"><b class="n">${big}</b><span>${small}</span></div>
    <div class="sub-meter ${meterCls}" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}" aria-label="${label}"><span style="width:${pct}%"></span></div></div>` : ''}
  ${acts ? html`<div class="actions sub-hero-actions">${acts}</div>` : ''}</div>`;

export function view({ root }) {
  setTitle('اشتراكي');
  const on = lic.enforcing();
  const e = lic.entitlement();
  const problem = lic.storedProblem();
  const lastBackup = store.getDb() && store.getDb().settings.lastBackupAt;
  const clearBtn = html`<button type="button" class="btn btn-ghost btn-sm" data-clear>إلغاء التفعيل على هذا الجهاز</button>`;
  const prob = problem ? html`<p class="note note-warn" style="margin-bottom:14px">⚠️ الكود المحفوظ على هذا الجهاز لا يعمل: ${lic.REASONS[problem] || ''}</p>` : '';
  const wait = !on ? html`<p class="note note-info" style="margin-bottom:14px">ℹ️ الاشتراكات لم تبدأ بعد: كل الميزات مفتوحة الآن للجميع.</p>` : '';

  // الاشتراك الحقيقي: الباقة والمتبقي والتجديد
  const statusHero = () => {
    if (e.status === 'free') {
      return hero({
        tone: 'info', ic: 'sparkles', kicker: 'باقتك الحالية', title: e.planName,
        line: 'تعمل كل الميزات الأساسية: الفواتير والعملاء والمنتجات والمصروفات والتقارير والنسخ الاحتياطي. اشترك لتفتح باقي الميزات.',
        actions: actions(),
      });
    }
    const warn = e.status === 'grace' || e.status === 'expired' || (e.status === 'active' && e.daysLeft <= 7);
    const tone = e.status === 'expired' ? 'bad' : warn ? 'warn' : 'ok';
    const total = e.issued && e.exp ? Math.max(1, daysBetween(e.issued, e.exp) + 1) : 0;
    const line = e.status === 'lifetime' ? 'اشتراك دائم بلا تاريخ انتهاء'
      : e.status === 'active' ? `ينتهي ${fmtDate(e.exp)}`
        : e.status === 'grace' ? `انتهى ${fmtDate(e.exp)}، والميزات تعمل مدة إضافية ثم تُقفل`
          : `انتهى في ${fmtDate(e.exp)} وعدت للباقة المجانية. بياناتك كلها محفوظة.`;
    const m = e.status === 'lifetime' ? { big: '∞', small: 'اشتراك دائم', pct: 100 }
      : e.status === 'active' ? { big: e.daysLeft, small: 'يوم متبقٍ', pct: total ? pctOf((e.daysLeft / total) * 100) : 100 }
        : e.status === 'grace' ? { big: e.graceLeft, small: 'يوم مهلة إضافية', pct: pctOf((e.graceLeft / Math.max(1, CONFIG.graceDays)) * 100) }
          : { big: 0, small: 'منتهي', pct: 0 };
    const cust = e.customer ? html` · مرخّص لـ ${e.customer}` : '';
    const acts = html`${warn ? actions('تجديد الاشتراك') : ''}${clearBtn}${e.status === 'expired' ? html`<a class="btn btn-ghost btn-sm" href="#/settings">${lastBackup ? 'النسخ الاحتياطي' : 'نزّل نسخة احتياطية'}</a>` : ''}`;
    return hero({
      tone, ic: e.status === 'expired' ? 'lock' : warn ? 'triangle-alert' : 'badge-check', kicker: 'باقتك الحالية', title: e.planName,
      badge: e.status === 'expired' ? ['bad', 'منتهي'] : e.status === 'grace' ? ['warn', 'في المهلة'] : e.status === 'lifetime' ? ['info', 'دائم'] : warn ? ['warn', 'ينتهي قريباً'] : ['ok', 'ساري'],
      line: html`${line}${cust}`, big: m.big, small: m.small, pct: m.pct, label: 'المدة المتبقية من الاشتراك', actions: acts,
    });
  };

  // نسخة العرض: المتبقي من الفواتير والمدة (والاشتراك الحقيقي المنتهي يبقى ظاهراً تحتها)
  const demoHero = (d) => hero({
    tone: d.blocked ? 'warn' : 'info', ic: 'flask-conical', kicker: 'نسخة العرض', title: d.blocked ? 'انتهت نسخة العرض' : 'أنت تستعمل نسخة العرض',
    badge: d.blocked ? ['warn', 'متوقفة'] : ['info', 'للتجربة'],
    line: html`${demoWhy(d)}${d.exp ? html` ${d.expired ? 'انتهت في' : 'تنتهي في'} ${fmtDate(d.exp)}${d.expired ? '' : d.daysLeft === 0 ? ' (آخر يوم اليوم)' : ` (باقي ${daysText(d.daysLeft)})`}.` : ''} استعملت ${d.used} من ${d.limit}. كل الميزات مفتوحة للتجربة والفواتير تحمل علامة «نسخة تجريبية». عند التفعيل ترتفع الحدود وتبقى بياناتك كما هي.`,
    big: d.left, small: `من ${d.limit} فواتير متبقية`, pct: pctOf((d.used / d.limit) * 100), label: 'الفواتير المستعملة', meterCls: 'demo-meter',
    actions: html`${actions('تفعيل الاشتراك بعد تجربة النسخة')}${d.source === 'code' ? clearBtn : ''}`, attr: 'data-demo-card',
  });
  const demoNow = lic.demo();
  const top = () => (demoNow ? html`${demoHero(demoNow)}${e.status === 'expired' ? html`<div style="margin-top:16px">${statusHero()}</div>` : ''}` : statusHero());

  const rows = FEATURES.map((f) => {
    const has = lic.has(f.id);
    const seg = f.segs[0];
    return html`<li class="feat-row ${has ? 'is-on' : 'is-off'}"><span class="feat-ic" aria-hidden="true">${f.icon}</span>
      <div><b>${f.name}</b><div class="muted small">${f.desc}</div></div>
      ${has ? html`<span class="badge badge-ok">متاحة</span>` : seg ? html`<a class="badge badge-muted" href="#/${seg}">🔒 مقفلة</a>` : html`<span class="badge badge-muted">🔒 مقفلة</span>`}</li>`;
  });
  const open = FEATURES.filter((f) => lic.has(f.id)).length;

  root.innerHTML = String(html`${head('اشتراكي', { sub: 'باقتك وميزاتك وتفعيل كود الاشتراك' })}
    ${wait}${prob}${top()}
    <div class="sub-grid">
      <div class="card"><div class="card-h"><h3>🔑 تفعيل كود الاشتراك</h3></div>
        <form data-form novalidate class="stack">
          <label class="fld"><span class="fld-l">الصق الكود أو رابط التفعيل الذي وصلك</span>
            <textarea class="inp" name="code" rows="3" dir="ltr" placeholder="AHS1.…" autocomplete="off" spellcheck="false"></textarea>
            <small class="fld-e" data-err hidden></small></label>
          <div><button class="btn btn-primary">تفعيل</button></div>
        </form></div>
      <div class="card"><div class="card-h"><h3>📱 كود هذا الجهاز</h3></div>
        <p class="muted small">إذا طلبت اشتراكاً مرتبطاً بجهاز واحد أرسل هذا الكود لمزوّد البرنامج. أغلب الاشتراكات لا تحتاجه.</p>
        <div class="inline" style="margin-top:10px"><code class="dev-code" dir="ltr" data-device>${lic.deviceCode()}</code><button type="button" class="btn btn-ghost btn-sm" data-copy>نسخ</button></div></div>
    </div>
    <div class="card" style="margin-top:16px"><div class="card-h"><h3>✨ الميزات</h3><span class="muted small">${open} من ${FEATURES.length} متاحة</span></div>
      <ul class="feat-list">${rows}</ul>
      <p class="muted small" style="margin-top:12px">الفواتير والعملاء والمنتجات والمصروفات والسندات والتقارير والنسخ الاحتياطي أساسية ومتاحة دائماً.</p></div>`);

  const form = $('[data-form]', root);
  const err = $('[data-err]', root);
  form.onsubmit = async (ev) => {
    ev.preventDefault();
    err.hidden = true;
    const r = await tryActivate(form.code.value);
    if (r.ok) { refreshShell(); toast(activatedText(r)); view({ root }); return; }
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
