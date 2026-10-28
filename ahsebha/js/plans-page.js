// ═══ صفحة الباقات والاشتراكات: كل محتواها من js/plans.js، فتعديل الأسعار والميزات هناك يكفي ═══
import { CONFIG, FEATURES, PLANS, planFeatures } from './plans.js';
import { contactLink } from './license.js';
import { html } from './ui.js';

const root = document.getElementById('sales');
const plans = Object.values(PLANS);
const paid = plans.filter((p) => p.id !== 'free');
const hasBoth = (p) => p.price && p.price.monthly != null && p.price.yearly != null;
const hasPrice = (p) => p.price && (p.price.monthly != null || p.price.yearly != null);
const numText = (n) => Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
let cycle = 'monthly';

// ما يتضمنه كل اشتراك دائماً (الميزات الأساسية غير القابلة للقفل)
const BASE = [
  'فواتير مبيعات ضريبية وإشعارات دائنة، مع رمز QR للفواتير السعودية',
  'العملاء وكشوف الحساب وأعمار الديون',
  'المنتجات والخدمات والمخزون بالتكلفة المتوسطة',
  'المصروفات وسندات القبض والصرف والتحويلات',
  'قائمة الدخل والميزانية وإقرار الضريبة وبقية التقارير',
  'نسخ احتياطي كامل وتصدير إلى Excel، وبياناتك على جهازك',
];

const FAQ = [
  ['أين تُحفظ بياناتي؟', 'على جهازك أنت، داخل المتصفح. لا نملك نسخة منها ولا نراها. نزّل نسخة احتياطية من الإعدادات بشكل دوري، فمسح بيانات المتصفح أو فقدان الجهاز يعني فقدان ما لم تنسخه.'],
  ['هل يعمل بدون إنترنت؟', 'نعم. بعد فتح البرنامج مرة واحدة يعمل بدون إنترنت، وتبقى بياناتك على جهازك.'],
  ['ماذا يحدث لبياناتي إذا انتهى الاشتراك؟', `لا يحدث لها شيء: تبقى كلها كما هي وتستطيع تنزيل نسخة احتياطية في أي وقت. بعد انتهاء الاشتراك تبقى الميزات تعمل ${CONFIG.graceDays} أيام مهلة، ثم تُقفل الميزات المدفوعة فقط ويعود البرنامج للباقة المجانية.`],
  ['كيف أشترك؟', `اختر باقتك واضغط «اطلب الاشتراك» لنتواصل معك على واتساب. بعد إتمام الدفع نرسل لك كود تفعيل: تضغط رابط التفعيل فيعمل مباشرة، أو تلصق الكود في البرنامج من «اشتراكي».${CONFIG.paymentNote ? ' ' + CONFIG.paymentNote : ''}`],
  ['هل أستطيع تغيير الباقة أو إضافة ميزة؟', 'نعم. نصدر لك كوداً جديداً بالميزات التي تريدها في أي وقت، ويُحتسب ما تبقى من اشتراكك.'],
  ['هل الكود خاص بي؟', 'يُصدر الكود باسمك، ويمكن ربطه بجهاز واحد إذا رغبت.'],
  ['هل يناسب بلدي؟', 'يدعم السعودية والإمارات والأردن والكويت وقطر والبحرين وعُمان ومصر والعراق، بعملة وضريبة كل بلد، ومصطلحات مناسبة لكل منها.'],
  ['ما الفرق بين الباقات؟', 'الباقة المجانية للبدء بالأساسيات. الباقات المدفوعة تفتح ميزات أكثر مثل الكاشير والمشتريات والرواتب. يمكنك الاطلاع على الجدول أعلاه، وإن احتجت ميزات بعينها فنجهّز لك اشتراكاً مخصصاً.'],
];

function priceBlock(p) {
  if (p.id === 'free') return html`<div class="plan-price"><b>مجاناً</b><span>للأبد</span></div>`;
  const pr = p.price || {};
  const useYear = (cycle === 'yearly' && pr.yearly != null) || (pr.monthly == null && pr.yearly != null);
  const v = useYear ? pr.yearly : pr.monthly;
  if (v == null) return html`<div class="plan-price"><b class="plan-ask">تواصل معنا للسعر</b></div>`;
  const save = useYear && pr.monthly != null ? Math.round(pr.monthly * 12 - pr.yearly) : 0;
  return html`<div class="plan-price"><b dir="ltr">${numText(v)}</b><span>${CONFIG.currency} / ${useYear ? 'سنة' : 'شهر'}</span></div>${save > 0 ? html`<div class="plan-save">وفّر ${numText(save)} ${CONFIG.currency} بالسنوي</div>` : ''}`;
}

function cta(p) {
  if (p.id === 'free') return html`<a class="btn btn-ghost" href="./">ابدأ مجاناً</a>`;
  const wa = contactLink(`السلام عليكم، أريد الاشتراك في باقة «${p.name}» من برنامج احسبها.`);
  return wa
    ? html`<a class="btn btn-primary" href="${wa}" target="_blank" rel="noopener" data-cta="${p.id}">💬 اطلب الاشتراك</a>`
    : html`<span class="btn btn-ghost" aria-disabled="true">طريقة الطلب قريباً</span>`;
}

const includedCount = (p) => (p.features === 'all' ? FEATURES.length : planFeatures(p.id).length);

function planCard(p) {
  const n = includedCount(p);
  return html`<article class="plan ${p.badge ? 'plan-featured' : ''}" data-plan="${p.id}">
    ${p.badge ? html`<span class="plan-badge">${p.badge}</span>` : ''}
    <h3>${p.name}</h3><p class="plan-tag">${p.tagline}</p>
    ${priceBlock(p)}
    <ul class="plan-list"><li>✅ كل الميزات الأساسية</li><li>${n ? `✅ ${p.features === 'all' ? 'كل الميزات الإضافية (' + n + ')' : n + ' ميزة إضافية'}` : '➖ بدون ميزات إضافية'}</li></ul>
    <div class="plan-cta">${cta(p)}</div></article>`;
}

function compare() {
  return html`<div class="tbl-wrap"><table class="tbl compare-tbl"><thead><tr><th>الميزة</th>${plans.map((p) => html`<th class="num">${p.name}</th>`)}</tr></thead><tbody>
    <tr class="compare-base"><td><b>الأساسيات</b> <span class="muted small">فواتير، عملاء، منتجات، مصروفات، سندات، تقارير، نسخ احتياطي</span></td>${plans.map(() => html`<td class="num">✅</td>`)}</tr>
    ${FEATURES.map((f) => html`<tr><td><span aria-hidden="true">${f.icon}</span> <b>${f.name}</b><div class="muted small">${f.desc}</div></td>${plans.map((p) => html`<td class="num">${planFeatures(p.id).includes(f.id) ? html`<span aria-label="متوفرة">✅</span>` : html`<span class="muted" aria-label="غير متوفرة">—</span>`}</td>`)}</tr>`)}
    </tbody></table></div>`;
}

function previewNote() {
  if (CONFIG.published) return '';
  const todo = [];
  if (!CONFIG.whatsapp) todo.push('رقم واتساب البيع غير مضبوط');
  for (const p of paid) if (!hasPrice(p)) todo.push(`سعر باقة «${p.name}» غير محدد`);
  if (!CONFIG.enforce) todo.push('الاشتراكات غير مفعّلة داخل البرنامج بعد');
  return html`<div class="note note-warn" data-preview-note>🚧 <b>معاينة:</b> هذه الصفحة غير معلنة بعد ولا تظهر في جوجل ولا من داخل البرنامج. هكذا ستبدو للزوار عند النشر.${todo.length ? html`<br>المتبقي قبل النشر: ${todo.join('، ')}.` : ''}</div>`;
}

function render() {
  const toggle = paid.some(hasBoth);
  root.innerHTML = String(html`
    ${previewNote()}
    <section class="hero-acc sales-hero"><div class="ic">📒</div>
      <h1>برنامج محاسبة عربي بسيط لمحلك أو شركتك</h1>
      <p>فواتير ضريبية، كاشير بالباركود، مخزون، مشتريات، رواتب وتقارير مالية كاملة. يعمل من المتصفح، وبياناتك تبقى على جهازك.</p>
      <div class="actions" style="justify-content:center"><a class="btn btn-primary" href="./">🧪 جرّب مجاناً ببيانات تجريبية</a><a class="btn btn-ghost" href="#plans">شاهد الباقات</a></div>
      <ul class="trust"><li>🔒 بياناتك على جهازك فقط</li><li>📴 يعمل بدون إنترنت</li><li>🧾 فواتير ضريبية بالعربي والإنجليزي</li><li>🌍 9 دول عربية</li></ul></section>

    <section id="plans" class="sales-sec"><div class="sec-head"><h2>اختر باقتك</h2><p class="muted">ابدأ مجاناً، وافتح المزيد عندما تحتاجه. تغيير الباقة أو إضافة ميزة في أي وقت.</p>
      ${toggle ? html`<div class="seg" role="tablist" aria-label="دورة الدفع"><button type="button" role="tab" class="${cycle === 'monthly' ? 'on' : ''}" aria-selected="${String(cycle === 'monthly')}" data-cycle="monthly">شهري</button><button type="button" role="tab" class="${cycle === 'yearly' ? 'on' : ''}" aria-selected="${String(cycle === 'yearly')}" data-cycle="yearly">سنوي</button></div>` : ''}</div>
      <div class="plan-grid">${plans.map(planCard)}</div></section>

    <section id="compare" class="sales-sec"><div class="sec-head"><h2>مقارنة الميزات</h2></div>${compare()}
      <div class="card" style="margin-top:14px"><div class="card-h"><h3>✅ تشمله كل الباقات</h3></div><ul class="base-list">${BASE.map((b) => html`<li>${b}</li>`)}</ul></div></section>

    <section class="sales-sec"><div class="sec-head"><h2>كيف تبدأ؟</h2></div>
      <ol class="steps"><li><b>جرّب مجاناً</b><span>افتح البرنامج وجرّبه ببيانات تجريبية بدون تسجيل.</span></li>
        <li><b>اطلب باقتك</b><span>اضغط «اطلب الاشتراك» لنتواصل معك على واتساب ونتفق على الدفع.</span></li>
        <li><b>فعّل الكود</b><span>تصلك رسالة فيها رابط التفعيل. اضغطه فتعمل ميزاتك فوراً.</span></li></ol></section>

    <section id="faq" class="sales-sec"><div class="sec-head"><h2>أسئلة شائعة</h2></div>
      <div class="faq">${FAQ.map(([q, a]) => html`<details><summary>${q}</summary><p>${a}</p></details>`)}</div></section>

    <section class="sales-sec final-cta"><h2>جاهز تبدأ؟</h2><p class="muted">جرّب البرنامج الآن بدون تسجيل، واشترك عندما تحتاج المزيد.</p>
      <div class="actions" style="justify-content:center"><a class="btn btn-primary" href="./">افتح البرنامج</a><a class="btn btn-ghost" href="#plans">الباقات</a></div></section>`);
}

root.addEventListener('click', (e) => {
  const c = e.target.closest('[data-cycle]');
  if (!c) return;
  cycle = c.dataset.cycle;
  const y = window.scrollY;
  render();
  window.scrollTo(0, y);
});
document.getElementById('theme').onclick = () => {
  const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  try { localStorage.setItem('theme', next); } catch (e) { /* للجلسة فقط */ }
  document.getElementById('theme').textContent = next === 'dark' ? '☀️ فاتح' : '🌙 داكن';
};
document.getElementById('theme').textContent = document.documentElement.getAttribute('data-theme') === 'dark' ? '☀️ فاتح' : '🌙 داكن';
render();
