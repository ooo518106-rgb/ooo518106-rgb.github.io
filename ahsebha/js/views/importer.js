// ═══ استيراد المنتجات والعملاء والموردين من Excel أو CSV ═══
import * as store from '../store.js';
import { html, raw, money, toast, $, download, empty } from '../ui.js';
import { go, setTitle, withQuery } from '../nav.js';
import { head, S } from './common.js';
import { IMPORT_TYPES, analyzeTable, buildRecords, templateRows } from '../imports.js';

const STATUS = { new: ['جديد', 'ok'], update: ['تحديث', 'info'], error: ['خطأ', 'bad'], skip: ['تجاهل', 'muted'] };

export function view({ root, query }) {
  const type = IMPORT_TYPES[query.type] ? query.type : 'products';
  const T = IMPORT_TYPES[type];
  setTitle('استيراد من Excel');
  let sheets = null; // أوراق الملف: [{ name, rows }]
  let pick = 0; // الورقة المختارة، أو -1 = كل الأوراق معاً
  let table = null; // نتيجة التحليل: { headerRow, headers, data, rowNos, mapping, how, notes }
  let fileName = '';
  let mapping = {};
  let how = {};
  let updateExisting = true;

  const hasData = (sh) => sh.rows.filter((r) => r.some((c) => String(c ?? '').trim() !== '')).length >= 2;
  // الصفوف التي تُحلَّل: ورقة واحدة، أو كل الأوراق بعناوين الأولى وعمود إضافي باسم الورقة (يصلح تصنيفاً)
  const rowsOf = () => {
    if (pick >= 0) return sheets[pick].rows;
    const live = sheets.filter(hasData);
    const first = analyzeTable(live[0].rows, type);
    const width = first.headers.length;
    const out = [[...first.headers.map((h, i) => (h === `عمود ${i + 1}` ? '' : h)), 'اسم الورقة']];
    for (const sh of live) {
      for (const r of analyzeTable(sh.rows, type).data) out.push([...Array.from({ length: width }, (_, i) => r[i] ?? ''), sh.name]);
    }
    return out;
  };
  const analyze = (headerRow) => {
    table = analyzeTable(rowsOf(), type, headerRow == null ? {} : { headerRow });
    mapping = { ...table.mapping };
    how = { ...table.how };
  };

  root.innerHTML = String(html`${head('استيراد من Excel', { sub: 'أضف مئات الأصناف أو العملاء دفعة واحدة من ملف xlsx أو csv', actions: html`<a class="btn btn-ghost" href="${T.list}">إلغاء</a>` })}
    <div class="seg" style="margin-bottom:14px">${Object.entries(IMPORT_TYPES).map(([k, t]) => html`<button type="button" data-type="${k}" class="${k === type ? 'on' : ''}">${t.name}</button>`)}</div>
    <div class="card"><div class="card-h"><h3>1. جهّز الملف</h3></div>
      <p class="muted small">اختر ملفك كما هو: يجد البرنامج صف العناوين ويتعرّف على الأعمدة وحده من عناوينها ومن محتواها (اسم المادة، الصنف، سعر الشراء، سعر البيع، الباركود…) ويقرأ كل أوراق الملف، وأنت تراجع قبل الإضافة. نزّل القالب إذا أردت البدء من ملف جاهز.</p>
      <div class="actions" style="margin-top:12px"><button class="btn btn-ghost" data-template>⬇️ تنزيل قالب ${T.name}</button>
        <label class="btn btn-primary">📂 اختيار ملف Excel أو CSV<input type="file" accept=".xlsx,.csv,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" data-file hidden></label>
        <span class="muted small" data-file-name></span></div></div>
    <div data-step2></div>`);

  const step2 = $('[data-step2]', root);

  function draw() {
    if (!table) { step2.innerHTML = ''; return; }
    const { headers, data, rowNos } = table;
    const recs = buildRecords(data, mapping, type, store.getDb(), { rowNos }).map((r) => (r.action === 'update' && !updateExisting ? { ...r, action: 'skip' } : r));
    const count = (a) => recs.filter((r) => r.action === a).length;
    const nameMissing = mapping.name == null;
    const colOpts = (sel) => html`<option value="">— لا يوجد —</option>${headers.map((h, i) => html`<option value="${i}" ${sel === i ? raw('selected') : ''}>${String(h) || 'عمود ' + (i + 1)}</option>`)}`;
    const shown = recs.slice(0, 200);
    const sheetRows = () => (pick >= 0 ? sheets[pick].rows.length : 12);
    const summary = () => {
      const KIND = { content: ['info', 'حسب محتوى العمود'], manual: ['muted', 'اخترته بنفسك'], header: ['ok', 'حسب عنوان العمود'] };
      const parts = T.fields.filter((f) => mapping[f.k] != null).map((f) => { const [k, t] = KIND[how[f.k]] || KIND.header; return html`<span class="badge badge-${k}" title="${t}">${f.t} ← ${headers[mapping[f.k]]}</span>`; });
      return html`<div class="note note-info" style="margin-bottom:10px"><b>تعرّف البرنامج على الأعمدة:</b> <span class="inline" style="flex-wrap:wrap;gap:6px;margin-top:4px">${parts.length ? parts : html`<span class="muted">لم أتعرف على أي عمود، اخترها بنفسك</span>`}</span>
        ${table.notes.length ? html`<ul class="small" style="margin:8px 0 0;padding-inline-start:18px">${table.notes.map((n) => html`<li>${n}</li>`)}</ul>` : ''}</div>`;
    };
    const cols = T.fields.filter((f) => mapping[f.k] != null && f.k !== 'name').slice(0, 4);
    step2.innerHTML = String(html`
      <div class="card"><div class="card-h"><h3>2. طابق الأعمدة</h3><span class="muted small">${fileName} · ${data.length} صف</span></div>
        ${summary()}
        <div class="form-grid" style="margin-bottom:10px">
          ${sheets.length > 1 ? html`<label class="fld"><span class="fld-l">الورقة</span><select class="inp" data-sheet>${sheets.map((x, i) => html`<option value="${i}" ${pick === i ? raw('selected') : ''}>${x.name}</option>`)}<option value="-1" ${pick === -1 ? raw('selected') : ''}>كل الأوراق معاً (اسم الورقة عمود إضافي)</option></select></label>` : ''}
          <label class="fld"><span class="fld-l">صف العناوين</span><select class="inp" data-hrow><option value="-1" ${table.headerRow === -1 ? raw('selected') : ''}>لا يوجد (الصف الأول بيانات)</option>${Array.from({ length: Math.min(12, sheetRows()) }, (_, i) => html`<option value="${i}" ${table.headerRow === i ? raw('selected') : ''}>السطر ${i + 1}</option>`)}</select></label></div>
        <div class="form-grid">${T.fields.map((f) => html`<label class="fld"><span class="fld-l">${f.t}${f.req ? ' *' : ''}</span><select class="inp" data-map="${f.k}">${colOpts(mapping[f.k])}</select></label>`)}</div>
        ${nameMissing ? html`<p class="fld-e" style="margin-top:10px">اختر عمود الاسم للمتابعة.</p>` : ''}</div>
      ${nameMissing ? '' : html`<div class="card"><div class="card-h"><h3>3. راجع ثم استورد</h3>
          <label class="check"><input type="checkbox" data-upd ${updateExisting ? raw('checked') : ''}> تحديث ${T.name} الموجودة بنفس الاسم أو الرمز</label></div>
        <div class="sum-bar"><span>جديد: <b>${count('new')}</b></span><span>تحديث: <b>${count('update')}</b></span>${count('skip') ? html`<span>تجاهل: <b>${count('skip')}</b></span>` : ''}<span class="${count('error') ? 'neg' : ''}">أخطاء: <b>${count('error')}</b></span></div>
        ${recs.length ? html`<div class="tbl-wrap"><table class="tbl"><thead><tr><th class="num">السطر</th><th>الحالة</th><th>الاسم</th>${cols.map((f) => html`<th class="hide-sm">${f.t}</th>`)}<th>ملاحظات</th></tr></thead><tbody>
          ${shown.map((r) => { const [t, k] = STATUS[r.action]; return html`<tr><td class="num">${r.row}</td><td><span class="badge badge-${k}">${t}</span></td><td><b>${r.rec.name || '—'}</b></td>
            ${cols.map((f) => { const v = r.rec[f.k]; return html`<td class="hide-sm">${v === undefined || v === '' ? '' : f.num ? money(v) : f.k === 'type' ? (v === 'service' ? 'خدمة' : 'منتج') : v}</td>`; })}
            <td class="small ${r.errors.length ? 'neg' : 'muted'}">${[...r.errors, ...r.notes].join(' · ')}</td></tr>`; })}
        </tbody></table></div>${recs.length > shown.length ? html`<p class="tbl-note">يُعرض أول ${shown.length} صف من ${recs.length}.</p>` : ''}`
        : html`<p class="muted">لا توجد صفوف فيها بيانات.</p>`}
        <div class="form-actions"><button class="btn btn-primary" data-import ${count('new') + count('update') ? '' : raw('disabled')}>📥 استيراد ${count('new')} جديد${count('update') ? ` وتحديث ${count('update')}` : ''}</button>
          ${count('error') ? html`<span class="muted small">الصفوف التي فيها أخطاء لن تُستورد.</span>` : ''}</div></div>`}`);

    $$map().forEach((sel) => { sel.onchange = () => { const v = sel.value; if (v === '') { delete mapping[sel.dataset.map]; delete how[sel.dataset.map]; } else { mapping[sel.dataset.map] = Number(v); how[sel.dataset.map] = 'manual'; } draw(); }; });
    const sh = $('[data-sheet]', step2);
    if (sh) sh.onchange = () => { pick = Number(sh.value); analyze(); draw(); };
    const hr = $('[data-hrow]', step2);
    if (hr) hr.onchange = () => { analyze(Number(hr.value)); draw(); };
    const upd = $('[data-upd]', step2);
    if (upd) upd.onchange = () => { updateExisting = upd.checked; draw(); };
    const btn = $('[data-import]', step2);
    if (btn) btn.onclick = () => {
      const ok = recs.filter((r) => r.action === 'new' || r.action === 'update').map((r) => r.rec);
      if (!ok.length) return;
      const res = store.importRecords(type === 'products' ? 'products' : 'parties', ok);
      toast(`تم الاستيراد ✓ ${res.added} جديد${res.updated ? ` و${res.updated} تحديث` : ''}`);
      go(T.list);
    };
  }
  const $$map = () => [...step2.querySelectorAll('[data-map]')];

  root.addEventListener('click', (e) => {
    const t = e.target.closest('[data-type]');
    if (t) go(withQuery('import', { type: t.dataset.type }));
  });
  $('[data-template]', root).onclick = async () => {
    const { writeXlsx } = await import('../xlsx.js');
    download(`قالب استيراد ${T.name}.xlsx`, writeXlsx([{ name: T.name, rows: templateRows(type) }]), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  };
  $('[data-file]', root).onchange = async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    if (f.size > 15 * 1048576) { toast('الملف كبير جداً (الحد 15 ميغابايت)', 'err'); return; }
    try {
      const { readSheets } = await import('../xlsx.js');
      const all = (await readSheets(f)).filter(hasData);
      if (!all.length) { toast('الملف فارغ أو فيه صف العناوين فقط', 'err'); return; }
      sheets = all;
      // نبدأ بالورقة الأكثر صفوفاً
      pick = sheets.reduce((best, x, i) => (x.rows.length > sheets[best].rows.length ? i : best), 0);
      fileName = f.name;
      analyze();
      $('[data-file-name]', root).textContent = f.name;
      draw();
      step2.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) { toast(err.message || 'تعذّر قراءة الملف', 'err'); }
  };
  if (!store.getDb().products.length && type === 'products' && S().name) {
    step2.innerHTML = String(empty('📥', 'ابدأ باستيراد منتجاتك', 'عندك قائمة أصناف في Excel؟ اخترها وسيُضاف كل صنف بسعره وكميته وباركوده.'));
  }
}
