// ═══ صفحة تحميل تطبيق اللابتوب: تقترح الملف المناسب لجهازك وتشرح التحذير الذي يظهر أول مرة ═══
import { DOWNLOADS, detectOS, downloadUrl, releasesUrl, forOS, fetchDigests } from './downloads.js';
import { BRAND } from './brand.js';
import { CONFIG } from './plans.js';
import { trialOn, contactLink, invoicesText, previewing } from './license.js';
import { html } from './ui.js';

import { watchIcons } from './icons.js';
watchIcons();
const root = document.getElementById('download');
const os = detectOS();
const mobile = os === 'ios' || os === 'android';

// أسماء الملفات تُقرأ من downloads.js دائماً: لا نكتبها يدوياً في النصوص فلا تتخلف عن الأسماء الحقيقية
const file = (id) => DOWNLOADS.find((d) => d.id === id).file;
const btn = (d, primary, label = `${d.icon} ${d.name}`) => html`<a class="btn ${primary ? 'btn-primary' : 'btn-ghost'}" href="${downloadUrl(d.file)}" data-dl="${d.id}" rel="noopener">⬇️ ${label}</a>`;

function hero() {
  const mine = forOS(os);
  return html`<section class="hero-acc sales-hero"><div class="ic">💻</div>
    <h1>${BRAND.name} على اللابتوب</h1>
    <p>تطبيق مثبّت بأيقونته ونافذته الخاصة، بدون متصفح. يشتغل بدون إنترنت حتى من أول تشغيل، وبياناتك على جهازك.</p>
    ${mobile
    ? html`<p class="note note-info" style="margin-top:16px" data-mobile>📱 هذه الصفحة للابتوب. افتحها من جهاز ويندوز أو ماك أو لينكس. أما على الجوال فافتح البرنامج من المتصفح وثبّته من قائمته.</p>
        <div class="actions" style="justify-content:center"><a class="btn btn-primary" href="./">افتح البرنامج</a></div>`
    : mine.length
      ? html`<div class="actions" style="justify-content:center" data-primary>${mine.map((d, i) => btn(d, i === 0))}</div>
        <p class="muted small" style="margin-top:10px">${os === 'mac' ? 'اختر حسب معالج جهازك (الشرح بالأسفل). ' : ''}الملف من صفحة الإصدارات الرسمية للبرنامج.</p>`
      : html`<div class="actions" style="justify-content:center"><a class="btn btn-primary" href="${releasesUrl}" rel="noopener">⬇️ كل التحميلات</a></div>`}
  </section>`;
}

// نسخة العرض: تظهر للزوار حين يفعّلها المالك، ولجهاز المالك وحده في المعاينة
function demo() {
  if (!trialOn()) return '';
  const wa = contactLink(`السلام عليكم، جرّبت نسخة العرض من برنامج ${BRAND.name} وأريد كود الاشتراك.`);
  const days = CONFIG.demoDays > 0 ? `خلال ${CONFIG.demoDays} يوماً` : 'بلا حد زمني';
  return html`<section class="sales-sec demo-sec" id="demo" data-demo-section>
    ${CONFIG.demoPublic && wa ? '' : html`<p class="note note-warn" data-demo-preview>🚧 <b>معاينة:</b> ${CONFIG.demoPublic ? '' : 'نسخة العرض غير معلنة بعد للزوار، وتظهر لك لأنك شغّلتها على هذا الجهاز من لوحة المالك. '}${wa ? '' : 'وينقصها رقم واتساب البيع (whatsapp في plans.js) ليظهر زر «أريد كود الاشتراك».'}</p>`}
    <div class="sec-head"><h2>🧪 جرّب قبل أن تشترك</h2>
      <p class="muted">نزّل التطبيق وجرّبه مجاناً بكل ميزاته: <b>${invoicesText(CONFIG.demoInvoices)}</b> ${days}. الفواتير في نسخة العرض تحمل علامة «نسخة تجريبية» ولا تصلح للعمل الفعلي.</p></div>
    <ol class="steps">
      <li><b>نزّل التطبيق</b><span>اختر ملف جهازك من الأعلى وثبّته. يعمل مباشرة كنسخة عرض.</span></li>
      <li><b>جرّبه</b><span>أضف عملاءك ومنتجاتك وأنشئ فواتيرك حتى حد نسخة العرض.</span></li>
      <li><b>فعّل اشتراكك</b><span>إذا أعجبك، تواصل معنا فنرسل لك كود التفعيل. الصقه في «اشتراكي» داخل التطبيق فيصير اشتراكاً كاملاً على نفس التطبيق وبياناتك كما هي.</span></li></ol>
    <div class="actions" style="justify-content:center;margin-top:14px">
      ${wa ? html`<a class="btn btn-primary" href="${wa}" target="_blank" rel="noopener" data-demo-wa>💬 أعجبني، أريد كود الاشتراك</a>` : ''}
      ${CONFIG.published || previewing() ? html`<a class="btn ${wa ? 'btn-ghost' : 'btn-primary'}" href="plans.html">💳 الباقات والأسعار</a>` : ''}</div>
  </section>`;
}

const all = () => html`<section class="sales-sec"><div class="sec-head"><h2>كل التحميلات</h2></div>
  <div class="plan-grid dl-grid">${DOWNLOADS.map((d) => html`<article class="plan" data-os="${d.os}"><h3>${d.icon} ${d.name}</h3><p class="plan-tag">${d.note}</p><div class="plan-cta">${btn(d, d.os === os, 'تحميل')}</div></article>`)}</div></section>`;

const steps = () => html`<section class="sales-sec"><div class="sec-head"><h2>أول مرة تفتح الملف</h2>
    <p class="muted">الملفات غير موقّعة رقمياً بعد، فيعرض النظام تحذيراً عند أول تشغيل. هذا متوقع وليس فيروساً، وهذه خطوات المتابعة:</p></div>
  <div class="dl-steps">
    <details ${os === 'windows' ? 'open' : ''} data-help="windows"><summary>🪟 ويندوز</summary><ol class="install-steps">
      <li>شغّل الملف <b dir="ltr">${file('win')}</b> من مجلد التنزيلات. إن حظره المتصفح فاضغط ⋯ بجانب التنزيل ثم «الاحتفاظ».</li>
      <li>إن ظهرت شاشة «Windows protected your PC»: اضغط «مزيد من المعلومات» ثم «تشغيل على أي حال».</li>
      <li>يتثبت تلقائياً، وتظهر أيقونة «${BRAND.name}» على سطح المكتب وفي قائمة ابدأ، ويفتح البرنامج.</li></ol></details>
    <details ${os === 'mac' ? 'open' : ''} data-help="mac"><summary>🍎 ماك</summary><ol class="install-steps">
      <li>لمعرفة معالج جهازك: شعار Apple ← «حول هذا الـ Mac». إن كُتب «Apple M…» فنزّل ملف Apple، وإن كُتب «Intel» فنزّل ملف Intel.</li>
      <li>افتح ملف <b dir="ltr">.dmg</b> واسحب «${BRAND.name}» (<span dir="ltr">${BRAND.latin}</span>) إلى مجلد Applications.</li>
      <li>أول مرة: من Applications اضغط بالزر الأيمن على «${BRAND.name}» ← «فتح» ← «فتح».</li>
      <li>إن لم يظهر خيار الفتح (ماك 15 وما بعده): إعدادات النظام ← «الخصوصية والأمان» ← انزل للأسفل واضغط «فتح على أي حال»، ثم أدخل كلمة سر الجهاز.</li>
      <li>عند أول استخدام للكاميرا (قراءة الباركود) سيطلب النظام الإذن، وافق.</li></ol></details>
    <details ${os === 'linux' ? 'open' : ''} data-help="linux"><summary>🐧 لينكس</summary><ol class="install-steps">
      <li>اجعل الملف قابلاً للتنفيذ: خصائص الملف ← السماح بتنفيذه، أو <b dir="ltr">chmod +x ${file('linux')}</b>.</li>
      <li>شغّله بنقرتين. إن لم يعمل على أوبونتو فثبّت <b dir="ltr">sudo apt install libfuse2t64</b> (أو <b dir="ltr">libfuse2</b>).</li></ol></details>
  </div></section>`;

const notes = () => html`<section class="sales-sec"><div class="sec-head"><h2>معلومات مهمة</h2></div>
  <ul class="base-list notes-list">
    <li>النسخة الكاملة من البرنامج داخل ملف التثبيت، فيعمل بدون إنترنت من أول تشغيل. ولما يكون في اتصال يعرض آخر نسخة من موقعه، فكل تحديث للبرنامج يصلك تلقائياً بدون إعادة تثبيت.</li>
    <li>لتحديث التطبيق نفسه نزّل ملف التثبيت الجديد وثبّته فوق القديم، وبياناتك تبقى مكانها.</li>
    <li>بيانات التطبيق منفصلة عن بيانات المتصفح. إن كنت تستخدم البرنامج بالمتصفح فنزّل نسخة احتياطية من «الإعدادات» ثم استعدها داخل التطبيق.</li>
    <li>إلغاء تثبيت التطبيق لا يحذف بياناتك المحاسبية.</li>
    <li>تفضّل عدم التحميل؟ يمكنك تثبيته من متصفح Chrome أو Edge: <a href="./">افتح البرنامج</a> ثم اضغط «ثبّت البرنامج على اللابتوب».</li>
    <li>كل الإصدارات وملاحظاتها: <a href="${releasesUrl}" rel="noopener">صفحة الإصدارات</a>.</li>
  </ul></section>`;

// تأكد أن ملفك أصلي: بصمة كل ملف تُجلب من صفحة الإصدار الرسمية وتتجدد وحدها مع كل إصدار
const verify = () => html`<section class="sales-sec" id="verify"><div class="sec-head"><h2>تأكد أن الملف أصلي</h2>
    <p class="muted">لكل ملف بصمة (SHA-256). احسب بصمة الملف الذي نزّلته وقارنها بالموجودة هنا: إن تطابقت فهو نفس الملف المنشور وما عدّل عليه أحد.</p></div>
  <div class="hash-list" data-hashes aria-live="polite"><p class="muted small">جارٍ جلب البصمات…</p></div>
  <details class="hash-help"><summary>كيف أحسب بصمة ملفي؟</summary><ul class="install-steps">
    <li>ويندوز: افتح مجلد التنزيلات، واكتب بـPowerShell: <b dir="ltr">Get-FileHash ${file('win')}</b></li>
    <li>ماك: افتح Terminal واكتب: <b dir="ltr">cd ~/Downloads &amp;&amp; shasum -a 256 ${file('mac-arm64')}</b></li>
    <li>لينكس: <b dir="ltr">sha256sum ${file('linux')}</b></li></ul></details></section>`;

function showHashes(map) {
  const el = root.querySelector('[data-hashes]');
  if (!el) return;
  el.innerHTML = String(map
    ? html`${DOWNLOADS.filter((d) => map[d.file]).map((d) => html`<div class="hash-row"><b dir="ltr">${d.file}</b><code dir="ltr" data-hash="${d.id}">${map[d.file]}</code></div>`)}`
    : html`<p class="muted small">تعذّر جلب البصمات الآن (تحتاج اتصالاً بالإنترنت). تجدها أيضاً في <a href="${releasesUrl}" rel="noopener">صفحة الإصدارات</a>.</p>`);
}

function render() {
  root.innerHTML = String(html`${hero()}${demo()}${all()}${steps()}${verify()}${notes()}`);
  fetchDigests().then(showHashes);
}

document.getElementById('theme').onclick = () => {
  const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  try { localStorage.setItem('theme', next); } catch (e) { /* للجلسة فقط */ }
  document.getElementById('theme').textContent = next === 'dark' ? '☀️ فاتح' : '🌙 داكن';
};
document.getElementById('theme').textContent = document.documentElement.getAttribute('data-theme') === 'dark' ? '☀️ فاتح' : '🌙 داكن';
render();
