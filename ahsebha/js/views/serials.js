// ═══ الأرقام التسلسلية والكفالة: ابحث برقم القطعة فتعرف حالتها وسجل حركتها وكفالتها ═══
// طبقة تتبع فوق المخزون (المنتجات التي فُعّل «أرقام تسلسلية» في بطاقتها)؛ لا تغيّر القيود ولا التكلفة المتوسطة.
import * as store from '../store.js';
import { serialReport, isSerialTracked, docNo } from '../core.js';
import { html, fmtDate, norm, empty, exportTable, modal, $ } from '../ui.js';
import { setTitle, docHref } from '../nav.js';
import { head, S, today, csvName, whLabel, bindRows } from './common.js';
import { alertDays } from './lots.js';

export const report = () => serialReport(store.getDb(), store.getBooks(), { today: today(), alertDays: alertDays() });

const STATUS = { in: ['في المخزون', 'badge-info'], sold: ['مباع', 'badge-ok'], out: ['خرج من المخزون', 'badge-muted'] };
const WARRANTY = { active: ['كفالة سارية', 'badge-ok'], soon: ['تنتهي قريباً', 'badge-warn'], expired: ['كفالة منتهية', 'badge-bad'] };
const FILTERS = { in: 'في المخزون', sold: 'المباعة', 'w-active': 'كفالتها سارية', 'w-soon': 'كفالتها تنتهي قريباً', 'w-expired': 'كفالتها منتهية', out: 'الخارجة من المخزون' };
const match = (r, f) => !f || (f.startsWith('w-') ? r.warranty === f.slice(2) : r.status === f);
const daysText = (d) => (d == null ? '' : d < 0 ? `منذ ${-d} يوم` : d === 0 ? 'تنتهي اليوم' : `بعد ${d} يوم`);

// سجل حركة الرقم: دخل متى ومن أي فاتورة، وبيع لمن ومتى، وما رجع أو خرج
function historyList(r) {
  const s = S();
  const label = (e) => ({
    opening: 'رصيد أول المدة', in: 'دخل المخزون بالشراء', return: 'ارتجعه العميل', sale: 'بِيع', preturn: 'أُرجع للمورد', adjust: 'خرج بتسوية مخزون', transfer: `تحويل إلى ${whLabel(e.wh) || 'مستودع آخر'}`,
  })[e.t] || e.t;
  return html`<div class="list-mini">${r.events.map((e) => {
    const d = e.doc && e.doc !== 'opening' ? store.findDoc(e.doc) : null;
    const who = e.party ? store.findParty(e.party)?.name : '';
    const inner = html`<span>${label(e)}${who ? ` — ${who}` : ''} <span class="meta">${fmtDate(e.date)}</span></span><span class="meta" dir="ltr">${d ? docNo(d, s) : ''}</span>`;
    return d ? html`<a href="${docHref(d)}">${inner}</a>` : html`<div>${inner}</div>`;
  })}</div>`;
}

function detail(r) {
  const sold = r.status === 'sold';
  return modal({
    title: `🛡️ ${r.serial}`,
    body: html`<div class="stack">
      <p><b>${r.product.name}</b> <span class="badge ${STATUS[r.status][1]}">${STATUS[r.status][0]}</span>${WARRANTY[r.warranty] ? html` <span class="badge ${WARRANTY[r.warranty][1]}">${WARRANTY[r.warranty][0]}</span>` : ''}</p>
      ${sold ? html`<p>بِيع بتاريخ <b>${fmtDate(r.soldDate)}</b>${r.partyName ? html` للعميل <b>${r.partyName}</b>` : ''}${r.warrantyEnd ? html`<br>الكفالة حتى <b>${fmtDate(r.warrantyEnd)}</b> <span class="muted small">(${daysText(r.days)})</span>` : html`<br><span class="muted small">لا كفالة محددة لهذا المنتج</span>`}</p>` : ''}
      ${historyList(r)}
      <div class="dlg-actions"><button type="button" class="btn btn-ghost" data-no>إغلاق</button></div></div>`,
    onMount: (dlg, done) => { $('[data-no]', dlg).onclick = () => done(null); },
  });
}

export function view({ root, query }) {
  setTitle('الأرقام التسلسلية والكفالة');
  const db = store.getDb();
  const multi = db.warehouses.length > 0;
  const state = { f: FILTERS[query.f] ? query.f : '', q: String(query.q || '') };
  if (!db.products.some(isSerialTracked)) {
    root.innerHTML = String(html`${head('الأرقام التسلسلية والكفالة', { sub: 'سجل كل قطعة برقمها وكفالتها' })}
      ${empty('🛡️', 'لا توجد منتجات بأرقام تسلسلية', 'افتح بطاقة المنتج (هواتف، أجهزة، إلكترونيات…) وفعّل «أرقام تسلسلية وكفالة» مع مدة الكفالة بالأشهر. بعدها تكتب رقم كل قطعة عند الشراء والبيع، فتبحث برقم القطعة وتعرف من اشتراها وهل كفالتها سارية.', html`<a class="btn btn-primary" href="#/products">📦 المنتجات</a>`)}`);
    return;
  }
  const R = report();
  root.innerHTML = String(html`${head('الأرقام التسلسلية والكفالة', { sub: `${R.rows.length} قطعة مسجّلة · التنبيه قبل انتهاء الكفالة بـ ${alertDays()} يوماً`, actions: html`<button class="btn btn-ghost" data-csv>⬇️ Excel</button>` })}
    <div class="grid g4" style="margin-bottom:14px">
      <a class="kpi" href="#/serials?f=in"><span class="kpi-l">في المخزون</span><span class="kpi-v">${R.inStock}</span><span class="kpi-s">قطعة برقمها</span></a>
      <a class="kpi" href="#/serials?f=w-active"><span class="kpi-l">كفالات سارية</span><span class="kpi-v">${R.active + R.soon}</span><span class="kpi-s">من ${R.sold} قطعة مباعة</span></a>
      <a class="kpi" href="#/serials?f=w-soon"><span class="kpi-l">تنتهي كفالتها قريباً</span><span class="kpi-v ${R.soon ? 'neg' : ''}">${R.soon}</span><span class="kpi-s">خلال ${alertDays()} يوماً</span></a>
      <a class="kpi" href="#/serials?f=w-expired"><span class="kpi-l">كفالات منتهية</span><span class="kpi-v">${R.expired}</span><span class="kpi-s">قطعة</span></a>
    </div>
    ${R.issues ? html`<p class="note note-warn" style="margin-bottom:12px">⚠️ ${R.issues} ملاحظة على الأرقام (رقم بيع قبل تسجيل شرائه، أو مباع مرتين، أو مكرر في المخزون). راجع فواتير الشراء والبيع لتلك الأرقام.</p>` : ''}
    <div class="toolbar"><input class="inp grow" type="search" data-q placeholder="امسح أو اكتب الرقم التسلسلي، أو اسم المنتج أو العميل" value="${state.q}" autofocus>
      <select class="inp" data-f aria-label="تصفية الأرقام"><option value="">كل الأرقام</option>${Object.entries(FILTERS).map(([k, v]) => html`<option value="${k}" ${k === state.f ? 'selected' : ''}>${v}</option>`)}</select></div>
    <div data-out></div>`);
  let shown = [];
  let limit = 300;
  function draw() {
    const q = norm(state.q.trim());
    shown = R.rows.filter((r) => match(r, state.f) && (!q || norm(`${r.serial} ${r.product.name} ${r.partyName}`).includes(q)));
    $('[data-out]', root).innerHTML = String(shown.length ? html`<div class="tbl-wrap"><table class="tbl" data-table><thead><tr><th>الرقم التسلسلي</th><th>المنتج</th><th>الحالة</th><th class="hide-sm">العميل</th><th>الكفالة حتى</th>${multi ? html`<th class="hide-sm">المستودع</th>` : ''}</tr></thead><tbody>
      ${shown.slice(0, limit).map((r, i) => html`<tr data-i="${i}" class="clickable"><td dir="ltr"><b>${r.serial}</b></td><td>${r.product.name}</td>
        <td><span class="badge ${STATUS[r.status][1]}">${STATUS[r.status][0]}</span></td><td class="hide-sm">${r.partyName || '—'}</td>
        <td class="nowrap">${r.warrantyEnd ? html`${fmtDate(r.warrantyEnd)} ${WARRANTY[r.warranty] ? html`<span class="badge ${WARRANTY[r.warranty][1]}">${WARRANTY[r.warranty][0]}</span>` : ''}` : '—'}</td>${multi ? html`<td class="hide-sm">${r.status === 'in' ? whLabel(r.wh) || 'الرئيسي' : '—'}</td>` : ''}</tr>`)}
    </tbody></table></div>${shown.length > limit ? html`<p style="text-align:center;margin-top:12px"><button class="btn btn-ghost" data-more>عرض المزيد (${shown.length - limit})</button></p>` : ''}`
      : html`<div class="empty"><p>${R.rows.length ? 'لا توجد أرقام مطابقة.' : 'لم تُسجَّل أرقام بعد. اكتبها عند الشراء أو البيع.'}</p></div>`);
  }
  draw();
  const sync = () => history.replaceState(null, '', '#/serials?' + new URLSearchParams({ f: state.f, q: state.q }).toString());
  $('[data-q]', root).oninput = (e) => { state.q = e.target.value; limit = 300; draw(); sync(); };
  // Enter (أو نهاية مسح الباركود) بنتيجة وحيدة يفتح سجلها مباشرة
  $('[data-q]', root).onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); if (shown.length === 1) detail(shown[0]); } };
  $('[data-f]', root).onchange = (e) => { state.f = e.target.value; limit = 300; draw(); sync(); };
  root.addEventListener('click', (e) => {
    if (e.target.closest('[data-more]')) { limit += 300; draw(); return; }
    const tr = e.target.closest('tr[data-i]');
    if (tr && shown[Number(tr.dataset.i)]) detail(shown[Number(tr.dataset.i)]);
  });
  $('[data-csv]', root).onclick = () => { const keep = limit; limit = Infinity; draw(); const t = $('[data-table]', root); if (t) exportTable(t, csvName('الأرقام التسلسلية')); limit = keep; draw(); };
  bindRows(root);
}
