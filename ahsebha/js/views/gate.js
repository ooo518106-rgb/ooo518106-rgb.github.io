// ═══ شاشة القفل: لا يعمل البرنامج إلا بكود تفعيل من المالك ═══
// تظهر قبل أي شيء آخر (قبل رسم القوائم والبيانات)، وتُغلق وحدها حين يُقبل كود صالح.
// بيانات الزبون لا تُحذف ولا تُقفل: يقدر ينزّل نسخة منها بدون كود (إلا إذا كانت منشأته محمية بمستخدمين ورموز دخول).
import * as store from '../store.js';
import * as auth from '../auth.js';
import * as lic from '../license.js';
import { BRAND, logoImg } from '../brand.js';
import { icon } from '../icons.js';
import { html, raw, toast, download, fmtDate } from '../ui.js';
import { ymd } from '../core.js';

// الكود في رابط التفعيل (#/activate?k=…): يُقرأ هنا لأن الموجّه لا يعمل قبل فتح البرنامج
const codeInLink = () => {
  const m = /^#\/?activate\?(?:[^#]*&)?k=([^&#]+)/.exec(location.hash);
  if (!m) return '';
  try { return decodeURIComponent(m[1]); } catch (e) { return m[1]; }
};

// العنوان والشرح حسب سبب الإغلاق
function words() {
  const why = lic.gateWhy();
  if (why === 'expired') {
    const e = lic.entitlement();
    const p = lic.license().payload;
    return p.n
      ? { title: 'انتهت مدة نسخة العرض', text: 'عجبك البرنامج؟ اطلب كود الاشتراك وفعّله لتكمل عملك بنفس بياناتك.' }
      : { title: 'انتهى كود التفعيل', text: `انتهى اشتراك ${e.customer ? e.customer + ' ' : ''}(${e.planName}) في ${fmtDate(e.exp)}. اطلب كود تجديد وفعّله لتكمل عملك بنفس بياناتك.` };
  }
  return { title: 'فعّل برنامجك', text: `${BRAND.name} يعمل بكود تفعيل خاص. اطلب كودك من مزوّد البرنامج ثم الصقه هنا.` };
}

function content() {
  const w = words();
  const problem = lic.gateWhy() === 'bad' ? lic.storedProblem() : '';
  // كود الجهاز يصحب الطلب فيربط المالك الكود بهذا الجهاز، فلا ينفع نسخه إلى جهاز آخر
  const wa = lic.contactLink(`السلام عليكم، أريد كود تفعيل لبرنامج ${BRAND.name}.\nكود جهازي: ${lic.deviceCode()}`);
  const db = store.getDb();
  const safe = !db ? ''
    : auth.usersEnabled()
      ? html`<p class="muted small gate-safe">بياناتك محفوظة على جهازك ولم تُحذف، وتُفتح بمجرد تفعيل الكود.</p>`
      : html`<div class="gate-safe"><p class="muted small">بياناتك محفوظة على جهازك ولم تُحذف. تستطيع تنزيل نسخة منها حتى بدون كود.</p>
        <button type="button" class="btn btn-ghost btn-sm" data-export>${raw(icon('download'))} نزّل نسخة من بياناتي</button></div>`;
  return html`<div class="gate-card">
    <div class="gate-brand"><span class="brand-badge">${raw(logoImg(56))}</span><span>${BRAND.name}</span></div>
    <h1 id="gate-t">${w.title}</h1>
    <p class="gate-text" id="gate-d">${w.text}</p>
    ${problem ? html`<p class="note note-warn">الكود المحفوظ على هذا الجهاز لا يعمل: ${lic.REASONS[problem] || ''}</p>` : ''}
    <form data-form novalidate>
      <label class="fld"><span class="fld-l">الصق الكود أو رابط التفعيل الذي وصلك</span>
        <textarea class="inp" name="code" rows="3" dir="ltr" placeholder="AHS1.…" autocomplete="off" spellcheck="false"></textarea>
        <small class="fld-e" data-err role="alert" hidden></small></label>
      <button class="btn btn-primary gate-go" data-go>${raw(icon('key-round'))} تفعيل</button>
    </form>
    <div class="gate-ask">
      ${wa ? html`<a class="btn btn-ghost" href="${wa}" target="_blank" rel="noopener">${raw(icon('message-circle'))} اطلب كودك عبر واتساب</a>`
    : html`<p class="muted small">لا تملك كوداً؟ تواصل مع من زوّدك بالبرنامج ليرسل لك كود التفعيل.</p>`}
      <div class="gate-dev"><span class="muted small">كود جهازك (أرسله مع طلبك)</span>
        <span class="inline"><code class="dev-code" dir="ltr">${lic.deviceCode()}</code><button type="button" class="btn btn-ghost btn-sm" data-copy>${raw(icon('copy'))} نسخ</button></span></div>
    </div>
    ${safe}
  </div>`;
}

// يعرض الشاشة ويرجّع وعداً يتحقق حين يُقبل كود صالح. لا يوجد زر إغلاق ولا يُفتح البرنامج بغير الكود.
export function show() {
  return new Promise((resolve) => {
    const app = document.getElementById('app');
    const el = document.createElement('div');
    el.className = 'gate';
    el.id = 'gate';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-labelledby', 'gate-t');
    el.setAttribute('aria-describedby', 'gate-d');
    el.innerHTML = String(content());
    // ما خلف الشاشة لا يُلمس بلوحة المفاتيح ولا بقارئ الشاشة
    if (app) { app.inert = true; app.setAttribute('aria-hidden', 'true'); }
    document.body.append(el);

    const form = el.querySelector('[data-form]');
    const err = el.querySelector('[data-err]');
    const go = el.querySelector('[data-go]');
    let done = false;

    const open = (msg) => {
      if (done) return;
      done = true;
      window.removeEventListener('storage', onStorage);
      el.remove();
      if (app) { app.inert = false; app.removeAttribute('aria-hidden'); }
      // رابط التفعيل لا يُعاد تنفيذه في صفحة الاشتراك بعد أن نفّذناه هنا
      if (codeInLink()) history.replaceState(null, '', location.pathname + location.search);
      if (msg) toast(msg);
      resolve();
    };

    async function submit() {
      err.hidden = true;
      go.disabled = true;
      try {
        const r = await lic.activate(form.code.value);
        if (r.ok && lic.gateOpen()) { open('تم التفعيل ✓'); return; }
        err.textContent = r.ok ? lic.REASONS.expired : lic.REASONS[r.reason] || 'تعذّر تفعيل الكود.';
      } catch (e) {
        err.textContent = 'تعذّر التحقق من الكود على هذا الجهاز. جرّب متصفحاً آخر أو افتح البرنامج بعنوانه الآمن (https).';
      }
      err.hidden = false;
      go.disabled = false;
      form.code.focus();
    }
    form.onsubmit = (ev) => { ev.preventDefault(); submit(); };

    // تفعيل من نافذة أخرى لنفس الجهاز يفتح هذه النافذة أيضاً
    const onStorage = (e) => {
      if (e.key !== 'ahsebha-license') return;
      lic.init().then(() => { if (lic.gateOpen()) open(); }).catch(() => {});
    };
    window.addEventListener('storage', onStorage);

    el.querySelector('[data-copy]').onclick = async () => {
      try { await navigator.clipboard.writeText(lic.deviceCode()); toast('تم نسخ كود الجهاز ✓'); } catch (e) { toast('انسخ الكود يدوياً', 'warn'); }
    };
    const exp = el.querySelector('[data-export]');
    if (exp) {
      exp.onclick = () => {
        const name = ((store.getDb().settings || {}).name || 'منشأتي').replace(/[\\/:*?"<>|\s]+/g, '-');
        download(`${BRAND.name}-نسخة-احتياطية-${name}-${ymd(new Date())}.json`, store.backupJSON(), 'application/json');
        toast('تم تنزيل نسخة من بياناتك ✓');
      };
    }

    const linked = codeInLink();
    if (linked) { form.code.value = linked; submit(); } else form.code.focus();
  });
}
