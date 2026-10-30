// ═══ البحث السريع (Ctrl+K أو زر البحث): صفحة أو عميل أو منتج أو مستند ببضعة حروف ═══
import { html, raw, norm, fmtDate } from '../ui.js';
import { icon } from '../icons.js';
import { DOC_TYPES, docNo } from '../core.js';
import { SEG, docHref, partyHref } from '../nav.js';

const GROUPS = [['action', 'إجراءات سريعة'], ['page', 'الصفحات'], ['party', 'العملاء والموردون'], ['product', 'المنتجات والخدمات'], ['doc', 'المستندات']];
const LIMIT = { action: 4, page: 6, party: 6, product: 6, doc: 8 };
const EMPTY_LIMIT = { action: 6, page: 8 }; // قبل الكتابة: أهم الإجراءات والصفحات فقط
const DOC_ICON = {
  sale: 'receipt-text', quote: 'file-pen', sreturn: 'undo-2', purchase: 'shopping-cart', preturn: 'redo-2', expense: 'banknote', receipt: 'arrow-down-to-line',
  payment: 'arrow-up-from-line', transfer: 'arrow-left-right', journal: 'notebook-tabs', adjust: 'scale', sorder: 'clipboard-list', porder: 'clipboard-list', payroll: 'briefcase', stransfer: 'truck',
};

// فهرس البحث: كل عنصر له مجموعة وعنوان وسطر ثانوي ورابط ونص مطبَّع للمطابقة
export function buildIndex({ db, pages = [], actions = [], can = () => true, routePerm = () => '' }) {
  const out = [];
  for (const a of actions) out.push({ g: 'action', ic: a.ic, t: a.t, href: a.href, hay: norm(`${a.t} ${a.kw || ''}`) });
  for (const p of pages) out.push({ g: 'page', ic: p.ic, t: p.t, sub: p.locked ? 'ضمن الاشتراك' : '', href: `#/${p.h}`, hay: norm(p.t), lock: !!p.locked });
  if (!db) return out;
  const s = db.settings || {};
  const partyOf = new Map(db.parties.map((p) => [p.id, p]));
  if (can(routePerm('customers'))) {
    for (const p of db.parties) {
      out.push({ g: 'party', ic: p.kind === 'supplier' ? 'factory' : 'user', t: p.name, sub: [p.kind === 'supplier' ? 'مورد' : 'عميل', p.phone].filter(Boolean).join(' · '), href: partyHref(p), hay: norm([p.name, p.phone, p.vatNo].join(' ')) });
    }
  }
  if (can(routePerm('products'))) {
    for (const p of db.products) {
      out.push({ g: 'product', ic: 'package', t: p.name, sub: [p.barcode, p.type === 'service' ? 'خدمة' : ''].filter(Boolean).join(' · '), href: `#/products/${p.id}`, hay: norm([p.name, p.nameEn, p.barcode, p.code].join(' ')) });
    }
  }
  const docs = db.docs.filter((d) => DOC_TYPES[d.type] && SEG[d.type] && can(routePerm(SEG[d.type])));
  docs.sort((a, b) => String(b.date).localeCompare(String(a.date)) || (b.no || 0) - (a.no || 0));
  for (const d of docs) {
    const party = partyOf.get(d.party);
    const no = d.no ? docNo(d, s) : '';
    out.push({ g: 'doc', ic: DOC_ICON[d.type] || 'file-text', t: `${DOC_TYPES[d.type].name} ${no}`.trim(), sub: [party && party.name, fmtDate(d.date)].filter(Boolean).join(' · '), href: docHref(d), hay: norm([DOC_TYPES[d.type].name, no, d.no, party && party.name, d.notes, d.ref].join(' ')) });
  }
  return out;
}

// النتائج: كل كلمة مكتوبة يجب أن توجد في العنصر، والأقرب لبداية الكلمة أولاً. بلا كتابة: إجراءات وصفحات
export function search(index, query) {
  const words = norm(query).split(/\s+/).filter(Boolean);
  const per = Object.fromEntries(GROUPS.map(([g]) => [g, []]));
  for (const it of index) {
    if (!words.length) { if (it.g === 'action' || it.g === 'page') per[it.g].push({ it, sc: 0 }); continue; }
    let sc = 0;
    let ok = true;
    for (const w of words) {
      const i = it.hay.indexOf(w);
      if (i < 0) { ok = false; break; }
      sc += i === 0 ? 3 : /\s/.test(it.hay[i - 1]) ? 2 : 1;
    }
    if (ok) per[it.g].push({ it, sc });
  }
  const lim = words.length ? LIMIT : EMPTY_LIMIT;
  const res = [];
  for (const [g] of GROUPS) {
    const list = per[g];
    if (words.length) list.sort((a, b) => b.sc - a.sc);
    res.push(...list.slice(0, lim[g] || 0).map((x) => x.it));
  }
  return res;
}

let open = null;
export function openPalette(ctx) {
  if (open) { open.close(); return; }
  const index = buildIndex(ctx);
  const dlg = document.createElement('dialog');
  dlg.className = 'pal';
  dlg.setAttribute('aria-label', 'بحث سريع');
  dlg.innerHTML = String(html`<div class="pal-box">
    <div class="pal-in">${raw(icon('search'))}<input class="pal-input" type="text" placeholder="ابحث عن عميل أو منتج أو فاتورة أو صفحة…" autocomplete="off" spellcheck="false" role="combobox" aria-expanded="true" aria-controls="pal-list"><kbd>Esc</kbd></div>
    <div class="pal-list" id="pal-list" role="listbox"></div>
    <div class="pal-foot"><span><span class="kk"><kbd>↑</kbd><kbd>↓</kbd></span> للتنقل</span><span><kbd>Enter</kbd> للفتح</span><span><span class="kk"><kbd>Ctrl</kbd><kbd>K</kbd></span> للبحث من أي مكان</span></div></div>`);
  const input = dlg.querySelector('.pal-input');
  const list = dlg.querySelector('.pal-list');
  let rows = [];
  let at = 0;
  const label = Object.fromEntries(GROUPS);
  const draw = () => {
    rows = search(index, input.value);
    at = Math.min(at, Math.max(0, rows.length - 1));
    if (!rows.length) { list.innerHTML = String(html`<div class="pal-none">لا نتائج لـ «${input.value}»</div>`); return; }
    let last = '';
    list.innerHTML = rows.map((r, i) => {
      const head = r.g !== last ? html`<div class="pal-g">${label[r.g]}</div>` : '';
      last = r.g;
      return String(html`${head}<button type="button" class="pal-row${i === at ? ' on' : ''}" role="option" id="pal-${i}" data-i="${i}" aria-selected="${String(i === at)}"><span class="pal-ic">${raw(icon(r.ic))}</span><span class="pal-t">${r.t}${r.lock ? html` <span class="badge badge-muted">${r.sub}</span>` : ''}</span>${r.sub && !r.lock ? html`<span class="pal-sub">${r.sub}</span>` : ''}<span class="pal-k">↵</span></button>`);
    }).join('');
    input.setAttribute('aria-activedescendant', `pal-${at}`);
  };
  const mark = (n) => {
    if (!rows.length) return;
    at = (n + rows.length) % rows.length;
    list.querySelectorAll('.pal-row').forEach((el, i) => { el.classList.toggle('on', i === at); el.setAttribute('aria-selected', String(i === at)); });
    const el = list.querySelector('.pal-row.on');
    if (el) el.scrollIntoView({ block: 'nearest' });
    input.setAttribute('aria-activedescendant', `pal-${at}`);
  };
  const go = (r) => { if (!r) return; dlg.close(); location.hash = r.href; };
  input.addEventListener('input', () => { at = 0; draw(); });
  dlg.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); mark(at + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); mark(at - 1); }
    else if (e.key === 'Enter') { e.preventDefault(); go(rows[at]); }
  });
  list.addEventListener('click', (e) => { const b = e.target.closest('.pal-row'); if (b) go(rows[Number(b.dataset.i)]); });
  list.addEventListener('mousemove', (e) => { const b = e.target.closest('.pal-row'); if (b && Number(b.dataset.i) !== at) mark(Number(b.dataset.i)); });
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  dlg.addEventListener('close', () => { open = null; dlg.remove(); });
  document.body.append(dlg);
  open = dlg;
  dlg.showModal();
  draw();
  input.focus();
}
export const paletteOpen = () => !!open;
