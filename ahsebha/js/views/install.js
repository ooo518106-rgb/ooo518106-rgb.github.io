// ═══ تثبيت البرنامج على اللابتوب: تطبيق مستقل (الأفضل)، أو تثبيت من المتصفح بدون تحميل ═══
// تطبيق سطح المكتب (ويندوز وماك ولينكس) ينزّل من صفحة التحميل. وللتثبيت من المتصفح: Chrome وEdge بضغطة
// (beforeinstallprompt)، وSafari بخطوات يدوية، وFirefox على الكمبيوتر لا يدعم.
import { html, modal } from '../ui.js';
import { detectOS } from '../downloads.js';

// هل البرنامج يعمل الآن كتطبيق مثبّت؟ (تطبيق سطح المكتب، أو نافذة مستقلة مثبّتة من المتصفح)
export function isInstalled() {
  try {
    if (/Electron\//.test(navigator.userAgent)) return true;
    return ['standalone', 'window-controls-overlay', 'minimal-ui'].some((m) => matchMedia(`(display-mode: ${m})`).matches) || navigator.standalone === true;
  } catch (e) { return false; }
}

// نوع المتصفح من هويته. iPad الحديث يعرّف نفسه كـ Mac لكن بلمس متعدد
export function browserKind(ua = typeof navigator !== 'undefined' ? navigator.userAgent : '', touch = typeof navigator !== 'undefined' ? navigator.maxTouchPoints : 0) {
  const u = String(ua);
  if (/iPhone|iPad|iPod/.test(u) || (/Macintosh/.test(u) && touch > 1)) return 'ios';
  if (/Android/.test(u)) return 'android';
  if (/Firefox/.test(u)) return 'firefox';
  if (/Edg\//.test(u)) return 'edge';
  if (/Chrome|Chromium|OPR\//.test(u)) return 'chrome';
  if (/Safari/.test(u)) return 'safari';
  return 'other';
}

export const KINDS = {
  chrome: { name: 'Chrome (ويندوز أو ماك)', steps: ['في شريط العنوان فوق، اضغط أيقونة التثبيت (شاشة صغيرة فيها سهم).', 'أو من قائمة ⋮ ← «حفظ ومشاركة» ← «تثبيت الصفحة كتطبيق».', 'اضغط «تثبيت». يفتح البرنامج بنافذته الخاصة، وتلاقي أيقونته بقائمة ابدأ (ويندوز) أو Launchpad (ماك).'] },
  edge: { name: 'Microsoft Edge (ويندوز أو ماك)', steps: ['في شريط العنوان فوق، اضغط أيقونة التثبيت (شاشة صغيرة فيها علامة +).', 'أو من قائمة ⋯ ← «التطبيقات» ← «تثبيت هذا الموقع كتطبيق».', 'اضغط «تثبيت»، وإن ظهرت خيارات فاختر «إنشاء اختصار على سطح المكتب».'] },
  safari: { name: 'Safari على ماك', steps: ['من شريط القوائم فوق: ملف (File) ← «إضافة إلى Dock» (Add to Dock).', 'يحتاج Safari 17 أو أحدث.', 'يفتح التطبيق بعدها من Dock أو من Launchpad.'] },
  firefox: { name: 'Firefox على الكمبيوتر', steps: ['فايرفوكس على الكمبيوتر لا يدعم تثبيت التطبيقات.', 'افتح هذا الرابط من Chrome أو Edge ثم ثبّته من هناك، أو نزّل تطبيق اللابتوب.'] },
  ios: { name: 'iPhone وiPad', steps: ['افتح الرابط من Safari.', 'اضغط زر المشاركة ⬆️ ← «إضافة إلى الشاشة الرئيسية».'] },
  android: { name: 'أندرويد', steps: ['اضغط قائمة ⋮ في المتصفح.', 'اختر «تثبيت التطبيق» أو «إضافة إلى الشاشة الرئيسية».'] },
  other: { name: 'متصفحك', steps: ['ابحث في قائمة المتصفح عن «تثبيت التطبيق» أو «Install».', 'إن لم تجدها فافتح الرابط من Chrome أو Edge.'] },
};

const list = (steps) => html`<ol class="install-steps">${steps.map((s) => html`<li>${s}</li>`)}</ol>`;
const DESKTOP_OS = ['windows', 'mac', 'linux'];

// canPrompt: المتصفح جاهز للتثبيت بضغطة (beforeinstallprompt)، وonPrompt ينفّذها
export function installHelp({ kind = browserKind(), os = detectOS(), canPrompt = false, onPrompt } = {}) {
  const me = KINDS[kind] || KINDS.other;
  const others = Object.entries(KINDS).filter(([k]) => k !== kind && k !== 'other');
  const desktop = DESKTOP_OS.includes(os);
  return modal({
    title: '💻 ثبّت احسبها على اللابتوب',
    body: html`<p class="dlg-msg">ثبّت احسبها كتطبيق: أيقونة ونافذة لوحده مثل أي برنامج، ويفتح أسرع ويشتغل بدون إنترنت. بياناتك تبقى على جهازك.</p>
      ${desktop ? html`<div class="install-me install-app" data-install-app-card><h3>💻 تطبيق اللابتوب (الأفضل)</h3>
        <p class="small">ملف تثبيت لويندوز أو ماك أو لينكس، تنزّله مرة واحدة فيصير له أيقونة على سطح المكتب ونافذة لوحده بدون متصفح.</p>
        <p style="margin-top:10px"><a class="btn btn-primary" href="download.html" target="_blank" rel="noopener" data-download-link>⬇️ حمّل التطبيق</a></p></div>` : ''}
      <div class="install-alt" data-install-kind="${kind}"><h3>${desktop ? 'أو بدون تحميل: ثبّته من المتصفح' : `طريقتك: ${me.name}`}</h3>
        ${canPrompt ? html`<p style="margin:8px 0"><button type="button" class="btn btn-ghost btn-sm" data-prompt>⚡ ثبّته من المتصفح الآن</button></p>` : ''}
        ${desktop ? html`<h4>${me.name}</h4>` : ''}${list(me.steps)}</div>
      <details class="install-others"><summary>طرق المتصفحات الأخرى</summary>${others.map(([, v]) => html`<h4>${v.name}</h4>${list(v.steps)}`)}</details>
      <p class="note note-info" style="margin-top:12px">بيانات التطبيق منفصلة عن بيانات المتصفح. إن كنت تستخدم البرنامج بالمتصفح فنزّل نسخة احتياطية من «الإعدادات» ثم استعدها داخل التطبيق.</p>
      <div class="dlg-actions"><button type="button" class="btn btn-primary" data-no>تمام</button></div>`,
    onMount: (dlg, done) => {
      dlg.querySelector('[data-no]').addEventListener('click', () => done(null));
      const p = dlg.querySelector('[data-prompt]');
      if (p && onPrompt) p.addEventListener('click', () => { done(null); onPrompt(); });
    },
  });
}
