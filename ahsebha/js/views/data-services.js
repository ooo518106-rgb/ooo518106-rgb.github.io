import * as store from '../store.js';
import { html, $, toast, askPassword, confirmBox, empty } from '../ui.js';
import { setTitle } from '../nav.js';
import { can } from '../auth.js';
import { head } from './common.js';
import { MIN_PASSWORD } from '../backup-crypto.js';
import { serviceConfig, serviceStatus, enableFolder, backupToFolder, disconnectService, connectCloud, resumeCloudSession, pushCloud, fetchCloudBundle, acceptCloudBundle } from '../data-services.js';

export async function view({ root }) {
  setTitle('النسخ الخارجية والمزامنة');
  if (!can('admin')) { root.innerHTML = String(empty('🔒', 'هذه الإعدادات للمالك فقط')); return; }
  const [folder, cloud] = await Promise.all([serviceConfig('folder'), serviceConfig('cloud')]).catch(() => [null, null]);
  root.innerHTML = String(html`${head('النسخ الخارجية والمزامنة', { actions: html`<a class="btn btn-ghost" href="#/settings">الإعدادات</a>` })}
    <div class="stack">
    <div class="card"><div class="card-h"><h3>نسخ مشفّر تلقائي إلى مجلد</h3></div>
      <p>اختر مجلداً على وسيط خارجي أو ضمن خدمة سحابية مثبّتة على جهازك. تُحفظ نسخة كاملة بالمرفقات بعد تغيّر البيانات والبرنامج مفتوح. ملف لكل يوم يُحدّث خلال اليوم، والملفات القديمة تبقى في المجلد.</p>
      <p class="muted small">هذه الميزة تحتاج متصفحاً يدعم اختيار المجلد مثل Chrome أو Edge على الكمبيوتر. على الجوال استخدم النسخ اليدوي أو الخادم أدناه. التزامن الفعلي للمجلد السحابي تديره الخدمة المثبتة عندك.</p>
      <p class="small" data-folder-status>${folder ? 'المجلد المختار: ' + folder.directory.name : 'لم يُختر مجلد'}</p>
      <div class="actions"><button class="btn btn-primary" data-folder-enable>اختيار المجلد وكلمة السر</button><button class="btn btn-ghost" data-folder-now>نسخ الآن / تجديد الإذن</button><button class="btn btn-ghost" data-folder-off>إيقاف النسخ للمجلد</button></div>
    </div>
    <div class="card"><div class="card-h"><h3>مزامنة نسخة مشفّرة بين الأجهزة</h3></div>
      <p>اربط خادمك بنفس معرّف المنشأة على الأجهزة. ارفع النسخة من جهاز، واسحبها على الآخر. يمنع الخادم الرفع فوق إصدار أحدث؛ عند التعارض اسحب النسخة وراجعها أولاً. السحب يستبدل البيانات بعد تأكيدك ويحفظ نسخة رجوع محلية.</p>
      <p class="muted small">يلزم نشر خدمة كنز السحابية على حسابك أولاً. البيانات والمرفقات تُشفّر قبل الإرسال، ومفتاح وصول الخادم يبقى في هذه الجلسة فقط. الحد الأعلى للنسخة المشفّرة 10 ميجابايت.</p>
      <form class="form-grid" data-cloud-form>
        <label class="fld"><span>عنوان خادمك</span><input class="inp" type="url" name="url" required value="${cloud?.url || ''}" placeholder="https://example.workers.dev" dir="ltr"></label>
        <label class="fld"><span>معرّف المنشأة على الخادم</span><input class="inp" name="space" required value="${cloud?.space || store.companyId}" dir="ltr"></label>
        <label class="fld span2"><span>مفتاح وصول الخادم</span><input class="inp" type="password" name="token" autocomplete="off" required minlength="32"></label>
        <label class="inline span2"><input type="checkbox" name="automatic" ${cloud?.automatic ? html`checked` : ''}> ارفع التغييرات تلقائياً أثناء فتح البرنامج واتصال الجلسة</label>
        <div class="actions span2"><button class="btn btn-primary">حفظ الربط وكلمة سر النسخة</button><button type="button" class="btn btn-ghost" data-cloud-session>توصيل الجلسة فقط</button></div>
      </form>
      <p class="small" data-cloud-status>${cloud ? 'معرّف المنشأة: ' + cloud.space + ' — الإصدار المعروف لهذا الجهاز: ' + cloud.version : 'غير معدّ'}</p>
      <div class="actions"><button class="btn btn-ghost" data-cloud-push>رفع النسخة الكاملة الآن</button><button class="btn btn-ghost" data-cloud-pull>سحب نسخة الخادم ومراجعتها</button><button class="btn btn-ghost" data-cloud-off>إلغاء الربط من هذا الجهاز</button></div>
    </div></div>`);
  const status = () => {
    if (serviceStatus.folder) $('[data-folder-status]', root).textContent = serviceStatus.folder;
    if (serviceStatus.cloud) $('[data-cloud-status]', root).textContent = serviceStatus.cloud;
  };
  const run = (selector, fn) => { const el = $(selector, root); el.onclick = async () => { el.disabled = true; try { await fn(); status(); } catch (e) { toast(e.message, 'err'); } finally { el.disabled = false; } }; };
  run('[data-folder-enable]', async () => {
    if (!window.showDirectoryPicker) throw new Error('اختيار المجلد غير مدعوم هنا. افتح Chrome أو Edge على الكمبيوتر أو استعمل نسخة يدوية');
    const directory = await window.showDirectoryPicker({ mode: 'readwrite' });
    const password = await askPassword({ title: 'كلمة سر النسخ التلقائية', message: 'احفظ هذه الكلمة للاستعادة. تُحفظ إمكانية إنشاء النسخ فقط على الجهاز؛ كلمة السر لا تُحفظ.', confirm: true, min: MIN_PASSWORD });
    if (password == null) return;
    await enableFolder(directory, password); toast('تم حفظ النسخة الكاملة وتفعيل النسخ للمجلد');
  });
  run('[data-folder-now]', () => backupToFolder({ requestPermission: true }));
  run('[data-folder-off]', () => disconnectService('folder'));
  const form = $('[data-cloud-form]', root);
  form.onsubmit = async (e) => {
    e.preventDefault(); if (!can('admin')) return;
    const password = await askPassword({ title: 'كلمة سر النسخة السحابية', message: 'تحتاج هذه الكلمة عند سحب النسخة على جهاز آخر. اختر نفس الكلمة إن كنت تستعمل النسخ الحالية.', confirm: true, min: MIN_PASSWORD });
    if (password == null) return;
    try { await connectCloud({ url: form.url.value, space: form.space.value, accessToken: form.token.value, password, automatic: form.automatic.checked }); form.token.value = ''; status(); }
    catch (err) { toast(err.message, 'err'); }
  };
  run('[data-cloud-session]', async () => { await resumeCloudSession(form.token.value); form.token.value = ''; });
  run('[data-cloud-push]', pushCloud);
  run('[data-cloud-pull]', async () => {
    const password = await askPassword({ title: 'فتح النسخة السحابية', message: 'كلمة السر التي شُفّرت بها آخر نسخة على الخادم' });
    if (password == null) return;
    const bundle = await fetchCloudBundle(password);
    if (!(await confirmBox(`سحب الإصدار ${bundle.version} للمنشأة «${bundle.data.settings.name || ''}» (${bundle.data.docs.length} مستند)؟ ستُستبدل بيانات المنشأة المفتوحة، وتُحفظ نسخة رجوع محلية أولاً.`, { ok: 'حفظ نسخة الرجوع والاستبدال', danger: true }))) return;
    await acceptCloudBundle(bundle); location.reload();
  });
  run('[data-cloud-off]', () => disconnectService('cloud'));
  const listener = () => { if (root.querySelector('[data-cloud-form]')) status(); else window.removeEventListener('acc:data-service-status', listener); };
  window.addEventListener('acc:data-service-status', listener);
}
