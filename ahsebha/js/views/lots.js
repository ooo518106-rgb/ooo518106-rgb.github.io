// ═══ الدفعات والصلاحية: كل دفعة فيها رصيد مع تاريخ انتهائها وأيامها المتبقية، وتسوية المنتهي ═══
// الدفعات طبقة تتبع فوق المخزون (المنتجات التي فُعّل «تتبع الدفعات» في بطاقتها)؛ لا تغيّر القيود ولا التكلفة المتوسطة.
import * as store from '../store.js';
import { lotReport, isLotTracked, num, docNo } from '../core.js';
import { html, money, qty, fmtDate, norm, empty, exportTable, $ } from '../ui.js';
import { setTitle } from '../nav.js';
import { head, S, today, csvName, whLabel, bindRows } from './common.js';

// أيام التنبيه قبل الانتهاء (من الإعدادات، 30 افتراضياً، والصفر يعني بلا تنبيه مسبق)
export const alertDays = () => { const v = S().expiryAlertDays; return v == null || v === '' ? 30 : Math.max(0, Math.floor(num(v))); };
export const report = () => lotReport(store.getDb(), store.getBooks(), { today: today(), alertDays: alertDays() });

const STATES = { expired: ['منتهية', 'badge-bad'], soon: ['تنتهي قريباً', 'badge-warn'], ok: ['سليمة', 'badge-ok'], none: ['بلا دفعة', 'badge-muted'] };
export const daysText = (r) => (r.days == null ? '' : r.days < 0 ? `منذ ${-r.days} يوم` : r.days === 0 ? 'تنتهي اليوم' : `بعد ${r.days} يوم`);

export function view({ root, query }) {
  setTitle('الدفعات والصلاحية');
  const db = store.getDb();
  const B = store.getBooks();
  const tracked = db.products.filter(isLotTracked);
  const multi = db.warehouses.length > 0;
  const state = { f: STATES[query.f] ? query.f : '', q: String(query.q || '') };
  if (!tracked.length) {
    root.innerHTML = String(html`${head('الدفعات والصلاحية', { sub: 'تتبّع رقم الدفعة وتاريخ انتهائها' })}
      ${empty('⏳', 'لا توجد منتجات بتتبع الدفعات', 'افتح بطاقة المنتج (أدوية، مواد غذائية، مستحضرات…) وفعّل «تتبع الدفعات وتواريخ الانتهاء». بعدها تكتب رقم الدفعة وتاريخها عند الشراء، فيبيع البرنامج الأقرب انتهاءً أولاً ويمنع بيع المنتهي وينبّهك قبل انتهاء الدفعات.', html`<a class="btn btn-primary" href="#/products">📦 المنتجات</a>`)}`);
    return;
  }
  const R = report();
  const problems = B.lotIssues || [];
  root.innerHTML = String(html`${head('الدفعات والصلاحية', { sub: `${tracked.length} منتج بتتبع الدفعات · التنبيه قبل الانتهاء بـ ${alertDays()} يوماً`,
    actions: html`${R.expired.count ? html`<a class="btn btn-primary" href="#/adjustments/new?expired=1">🗑️ تسوية المنتهي (إتلاف)</a>` : ''}<button class="btn btn-ghost" data-csv>⬇️ Excel</button>` })}
    <div class="grid g4" style="margin-bottom:14px">
      <a class="kpi" href="#/lots?f=expired"><span class="kpi-l">منتهية الصلاحية</span><span class="kpi-v ${R.expired.count ? 'neg' : ''}">${R.expired.count} <small class="cur">دفعة</small></span><span class="kpi-s">${R.expired.count ? html`${qty(R.expired.qty)} وحدة · ${money(R.expired.value, { sym: true })}` : 'لا شيء منتهٍ'}</span></a>
      <a class="kpi" href="#/lots?f=soon"><span class="kpi-l">تنتهي خلال ${alertDays()} يوماً</span><span class="kpi-v">${R.soon.count} <small class="cur">دفعة</small></span><span class="kpi-s">${R.soon.count ? html`${qty(R.soon.qty)} وحدة · ${money(R.soon.value, { sym: true })}` : 'لا شيء قريب'}</span></a>
      <a class="kpi" href="#/lots?f=none"><span class="kpi-l">رصيد بلا دفعة</span><span class="kpi-v">${qty(R.none.qty)}</span><span class="kpi-s">يُباع أولاً. أضف الدفعة لبند الشراء ليظهر هنا بدفعته</span></a>
    </div>
    ${problems.length ? html`<p class="note note-warn" style="margin-bottom:12px">⚠️ ${problems.length} حركة سحبت أكثر مما في الدفعات الصالحة (مثل بيع بعد انتهاء كل الدفعات)، فسُجّل الفرق «بلا دفعة» بالسالب. راجع المشتريات وتواريخ الانتهاء. <span class="muted small">(${[...new Set(problems.map((x) => { const d = store.findDoc(x.doc); return d ? docNo(d, S()) : ''; }).filter(Boolean))].slice(0, 5).join('، ')})</span></p>` : ''}
    <div class="toolbar"><input class="inp grow" type="search" data-q placeholder="بحث باسم المنتج أو رقم الدفعة" value="${state.q}">
      <select class="inp" data-f aria-label="تصفية الدفعات"><option value="">كل الدفعات</option>${Object.entries(STATES).map(([k, v]) => html`<option value="${k}" ${k === state.f ? 'selected' : ''}>${v[0]}</option>`)}</select></div>
    <div data-out></div>`);
  function draw() {
    const q = norm(state.q.trim());
    const rows = R.rows.filter((r) => (!state.f || r.state === state.f) && (!q || norm(`${r.product.name} ${r.lot}`).includes(q)));
    $('[data-out]', root).innerHTML = String(rows.length ? html`<div class="tbl-wrap"><table class="tbl" data-table><thead><tr><th>المنتج</th><th>الدفعة</th><th>الانتهاء</th><th>الحالة</th>${multi ? html`<th class="hide-sm">المستودع</th>` : ''}<th class="num">الكمية</th><th class="num hide-sm">القيمة</th></tr></thead><tbody>
      ${rows.map((r) => html`<tr data-href="#/products/${r.product.id}"><td><b>${r.product.name}</b></td><td dir="auto">${r.lot || '—'}</td><td class="nowrap">${r.exp ? fmtDate(r.exp) : 'بلا تاريخ'}${r.days != null ? html`<small class="c-sub">${daysText(r)}</small>` : ''}</td>
        <td><span class="badge ${STATES[r.state][1]}">${STATES[r.state][0]}</span></td>${multi ? html`<td class="hide-sm">${whLabel(r.wh) || 'الرئيسي'}</td>` : ''}
        <td class="num ${r.qty < 0 ? 'neg' : ''}">${qty(r.qty)} <small class="cur">${r.product.unit || ''}</small></td><td class="num hide-sm">${money(r.value)}</td></tr>`)}
    </tbody></table></div>` : html`<div class="empty"><p>${R.rows.length ? 'لا توجد دفعات مطابقة.' : 'لا توجد دفعات فيها رصيد حالياً.'}</p></div>`);
  }
  draw();
  bindRows(root);
  const sync = () => history.replaceState(null, '', '#/lots?' + new URLSearchParams({ f: state.f, q: state.q }).toString());
  $('[data-q]', root).oninput = (e) => { state.q = e.target.value; draw(); sync(); };
  $('[data-f]', root).onchange = (e) => { state.f = e.target.value; draw(); sync(); };
  $('[data-csv]', root).onclick = () => { const t = $('[data-table]', root); if (t) exportTable(t, csvName('الدفعات والصلاحية')); };
}
