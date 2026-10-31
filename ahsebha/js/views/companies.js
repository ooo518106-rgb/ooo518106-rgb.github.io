// ═══ الشركات: قائمة الشركات على هذا الجهاز، والتبديل بينها وإضافة شركة جديدة وحذف شركة ═══
// لكل شركة بياناتها ونسخها التلقائية ومرفقاتها المنفصلة. التبديل يعيد تحميل الصفحة على الشركة المختارة (store.switchCompany).
import * as store from '../store.js';
import { html, modal, toast, confirmBox, $ } from '../ui.js';
import { has } from '../license.js';
import { requireFeature } from './subscription.js';

const label = (c) => c.name || 'شركة جديدة (لم تكتمل)';

export async function openCompanies() {
  const list = await store.listCompanies();
  const row = (c) => html`<div class="co-row${c.active ? ' on' : ''}" data-co="${c.id}">
    <span class="co-name">🏢 ${label(c)}${c.active ? html` <span class="badge badge-info">الحالية</span>` : ''}</span>
    ${c.active ? '' : html`<span class="inline"><button type="button" class="btn btn-ghost btn-sm" data-switch="${c.id}">فتح</button><button type="button" class="btn btn-ghost btn-sm" data-del="${c.id}" aria-label="حذف ${label(c)}">🗑</button></span>`}</div>`;
  await modal({
    title: '🏢 الشركات',
    body: html`<div class="co-list">${list.map(row)}</div>
      <p class="muted small">لكل شركة فواتيرها وعملاؤها ومنتجاتها وحساباتها المنفصلة تماماً على هذا الجهاز. الفتح يحمّل الشركة المختارة. النسخة الاحتياطية من الإعدادات تخص الشركة المفتوحة وحدها.</p>
      <div class="dlg-actions"><button type="button" class="btn btn-primary" data-add>➕ شركة جديدة</button><button type="button" class="btn btn-ghost" data-no>إغلاق</button></div>`,
    onMount: (dlg, done) => {
      $('[data-no]', dlg).onclick = () => done(null);
      dlg.addEventListener('click', async (e) => {
        const sw = e.target.closest('[data-switch]');
        const del = e.target.closest('[data-del]');
        if (e.target.closest('[data-add]')) {
          // الشركة الأولى مجانية، وإضافة غيرها من الميزات القابلة للبيع
          if (!has('companies')) { done(null); await requireFeature('companies'); return; }
          try { const id = await store.addCompany(); store.switchCompany(id); } catch (err) { toast(err.message || 'تعذّرت إضافة الشركة', 'err'); }
        } else if (sw) {
          try { await store.flush(); store.switchCompany(sw.dataset.switch); } catch (err) { toast(err.message || 'تعذّر الفتح', 'err'); }
        } else if (del) {
          const c = list.find((x) => x.id === del.dataset.del);
          const ok = await confirmBox(`حذف «${label(c)}» نهائياً مع كل فواتيرها وعملائها ومنتجاتها ونسخها التلقائية ومرفقاتها من هذا الجهاز؟ لا يمكن التراجع. إن كنت تريد نسخة منها فافتحها أولاً ونزّل نسخة احتياطية من الإعدادات.`, { ok: 'حذف نهائي', danger: true, title: 'حذف شركة' });
          if (!ok) return;
          try { await store.deleteCompany(c.id); toast('تم حذف الشركة'); done(null); openCompanies(); } catch (err) { toast(err.message || 'تعذّر الحذف', 'err'); }
        }
      });
    },
  });
}
