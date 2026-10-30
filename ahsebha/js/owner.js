// ═══ لوحة المالك: مفتاحك، زبائنك، وإصدار أكواد الاشتراك ═══
// كل شيء يعمل على جهازك: المفتاح الخاص مشفّر بكلمة سر، وقائمة الزبائن محفوظة هنا ويمكنك تنزيل نسخة منها.
import { CONFIG, FEATURES, PLANS, planFeatures } from './plans.js';
import { PUBLIC_KEYS } from './license-key.js';
import * as lic from './license.js';
import { generateOwnerKeys, importPrivate, wrapKeys, unwrapKeys, buildPayload, signLicense, publicKeyLine, newLicenseId } from './license-sign.js';
import { html, raw, $, $$, modal, confirmBox, toast, field, fmtDate, norm, download } from './ui.js';
import { addDays, addMonths, ymd, daysBetween, isDate } from './core.js';
import { CHANGELOG, VERSION, NUMBERED_LATER_BEFORE, cmpVersion } from './changelog.js';

const LS_KEY = 'ahsebha-owner-key';
const LS_DATA = 'ahsebha-owner-data';
const LS_SEEN = 'ahsebha-owner-seen-version';
const root = document.getElementById('owner');
const today = () => ymd(new Date());

// ─── التخزين على هذا الجهاز ───
const readJSON = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } };
const writeJSON = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { toast('تعذّر الحفظ على هذا الجهاز. نزّل نسخة من بياناتك الآن', 'err'); return false; } };

const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const validLicense = (l) => isObj(l) && typeof l.code === 'string' && !!lic.parseCode(l.code).ok;
const validCustomer = (c) => isObj(c) && typeof c.id === 'string' && /^[\w-]{1,40}$/.test(c.id) && typeof c.name === 'string';
function normData(d) {
  const list = Array.isArray(d && d.customers) ? d.customers.filter(validCustomer) : [];
  const customers = list.map((c) => ({
    id: c.id, name: String(c.name).slice(0, 80), phone: String(c.phone || '').slice(0, 30), notes: String(c.notes || '').slice(0, 300),
    created: String(c.created || ''), licenses: (Array.isArray(c.licenses) ? c.licenses : []).filter(validLicense).map((l) => { const p = lic.parseCode(l.code); return { payload: p.payload, code: p.code, at: String(l.at || ''), paid: Number(l.paid) || 0 }; }),
  }));
  return { v: 1, customers, exportedAt: String((d && d.exportedAt) || ''), keyBackupAt: String((d && d.keyBackupAt) || '') };
}

const readSeen = () => { try { return localStorage.getItem(LS_SEEN) || ''; } catch (e) { return ''; } };
// seen: آخر إصدار فتحتَ سجله. seenBefore: ما كان عند فتح الصفحة، فتبقى علامة «جديد» على البنود الجديدة طوال الجلسة
const state = { tab: 'customers', blob: readJSON(LS_KEY), keys: null, data: normData(readJSON(LS_DATA)), q: '', seen: readSeen(), seenBefore: readSeen() };
const save = () => writeJSON(LS_DATA, state.data);

// ─── مساعدات ───
const latin = (s) => String(s || '').replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d));
function waNumber(phone) {
  const p = latin(phone).replace(/[^\d+]/g, '');
  if (p.startsWith('+')) return p.slice(1);
  if (p.startsWith('00')) return p.slice(2);
  if (p.startsWith('0') && CONFIG.dial) return CONFIG.dial + p.slice(1);
  return p;
}
const waUrl = (phone, text) => `https://wa.me/${waNumber(phone)}?text=${encodeURIComponent(text)}`;
const latest = (c) => c.licenses[c.licenses.length - 1] || null;
// آخر اشتراك حقيقي (بدون أكواد العرض): هو الذي يُبنى عليه التجديد والتعديل
const latestSub = (c) => [...c.licenses].reverse().find((l) => !l.payload.n) || null;
const planName = (p) => (PLANS[p] && PLANS[p].name) || 'مخصّصة';
const DAYS = ['يوم', 'يومان', 'أيام', 'يوماً'];
const daysText = (n) => (n === 0 ? 'اليوم' : n === 1 ? DAYS[0] : n === 2 ? DAYS[1] : n <= 10 ? `${n} ${DAYS[2]}` : `${n} ${DAYS[3]}`);

// حالة الزبون الآن: rank لترتيب القائمة (الأكثر استعجالاً أولاً)
function standing(c) {
  const l = latest(c);
  if (!l) return { key: 'none', label: 'بدون اشتراك', cls: 'muted', rank: 5 };
  const e = lic.entitlementOf(l.payload, today(), CONFIG.graceDays);
  // كود عرض: فرصة بيع تحتاج متابعة، ولا تُحسب اشتراكاً فعّالاً
  if (l.payload.n) return e.status === 'expired' ? { key: 'demo-over', label: 'انتهى العرض', cls: 'warn', rank: 1, e } : { key: 'demo', label: e.daysLeft == null ? 'نسخة عرض' : e.daysLeft === 0 ? 'عرض ينتهي اليوم' : `نسخة عرض · باقي ${daysText(e.daysLeft)}`, cls: 'info', rank: 1, e };
  if (e.status === 'lifetime') return { key: 'lifetime', label: 'دائم', cls: 'info', rank: 4, e };
  if (e.status === 'active') return e.daysLeft <= 7 ? { key: 'soon', label: e.daysLeft === 0 ? 'ينتهي اليوم' : `ينتهي بعد ${daysText(e.daysLeft)}`, cls: 'warn', rank: 1, e } : { key: 'active', label: 'فعّال', cls: 'ok', rank: 3, e };
  if (e.status === 'grace') return { key: 'grace', label: 'في المهلة', cls: 'warn', rank: 0, e };
  return { key: 'expired', label: 'منتهي', cls: 'bad', rank: 2, e };
}

function issueMessage(c, rec) {
  const p = rec.payload;
  if (p.n) return `السلام عليكم ${c.name} 👋\nهذه نسخة عرض من برنامج احسبها لتجربته: ${lic.invoicesText(p.n)} خلال ${daysText(daysBetween(p.i, p.e))} وكل الميزات مفتوحة للتجربة.\nلتفعيلها اضغط الرابط التالي من جهازك (أو الصق الكود في: اشتراكي ← تفعيل كود الاشتراك):\n${lic.activationLink(rec.code)}\nوإذا عجبك البرنامج ردّ علينا وبنرسل لك كود الاشتراك الكامل، وبتكمل على نفس بياناتك 🙏`;
  return `السلام عليكم ${c.name} 👋\nتم تفعيل اشتراكك في برنامج احسبها — باقة ${planName(p.p)}${p.e ? ` حتى ${fmtDate(p.e)}` : ' (اشتراك دائم)'}.\nلتفعيله اضغط الرابط التالي من جهازك (أو الصق الكود في: اشتراكي ← تفعيل كود الاشتراك):\n${lic.activationLink(rec.code)}\nشكراً لثقتك 🙏`;
}
function reminderMessage(c, st) {
  if (st.key === 'demo-over') return `السلام عليكم ${c.name} 👋\nانتهت نسخة العرض من برنامج احسبها. إذا عجبك البرنامج ردّ علينا وبنرسل لك كود الاشتراك لتكمل على نفس بياناتك 🙏`;
  if (st.key === 'demo') return `السلام عليكم ${c.name} 👋\nكيف شفت نسخة العرض من برنامج احسبها؟ إذا عجبك أو عندك أي سؤال ردّ علينا، وبنرسل لك كود الاشتراك لتكمل على نفس بياناتك 🙏`;
  const when = st.key === 'expired' || st.key === 'grace' ? `انتهى بتاريخ ${fmtDate(st.e.exp)}` : `ينتهي بتاريخ ${fmtDate(st.e.exp)}`;
  return `السلام عليكم ${c.name} 👋\nنذكّرك أن اشتراكك في برنامج احسبها ${when}. للتجديد ردّ علينا هنا وسنرسل لك كود التجديد فوراً. شكراً لك 🙏`;
}

const copy = async (text, okMsg) => {
  try { await navigator.clipboard.writeText(text); toast(okMsg); } catch (e) { toast('انسخ النص يدوياً من الحقل', 'warn'); }
};

// ─── المفتاح ───
async function createKeys(pw) {
  const k = await generateOwnerKeys();
  state.blob = await wrapKeys(k, pw);
  writeJSON(LS_KEY, state.blob);
  state.keys = { kid: k.kid, publicJwk: k.publicJwk, privateKey: await importPrivate(k.privateJwk) };
  state.data.keyBackupAt = '';
  save();
}
const deployed = () => !!state.keys && PUBLIC_KEYS.some((k) => k.kid === state.keys.kid);

function unlockDialog() {
  return modal({
    title: '🔓 فتح المفتاح',
    body: html`<form novalidate data-form="unlock">${field('كلمة سر المفتاح', html`<input class="inp" type="password" name="pw" autocomplete="current-password" autofocus>`)}
      <small class="fld-e" data-err hidden></small><div class="dlg-actions"><button class="btn btn-primary">فتح</button><button type="button" class="btn btn-ghost" data-no>إلغاء</button></div></form>`,
    onMount: (dlg, done) => {
      const f = $('form', dlg);
      $('[data-no]', dlg).onclick = () => done(false);
      f.onsubmit = async (e) => {
        e.preventDefault();
        const b = $('.btn-primary', f);
        b.disabled = true;
        try { state.keys = await unwrapKeys(state.blob, f.pw.value); done(true); } catch (err) {
          const m = $('[data-err]', f); m.textContent = err.message; m.hidden = false; b.disabled = false;
        }
      };
    },
  }).then((v) => v === true);
}

// لا إصدار بدون مفتاح مفتوح
async function ensureKeys() {
  if (state.keys) return true;
  if (!state.blob) { state.tab = 'key'; render(); toast('أنشئ مفتاحك أولاً', 'warn'); return false; }
  const ok = await unlockDialog();
  if (ok) render();
  return ok;
}

// ─── الشاشة ───
const TABS = [['customers', '👥 الزبائن'], ['key', '🔑 المفتاح'], ['updates', '🆕 التحديثات'], ['tools', '🧰 أدوات ونسخ احتياطي']];
const markSeen = () => { state.seen = VERSION; try { localStorage.setItem(LS_SEEN, VERSION); } catch (e) { /* للجلسة فقط */ } };

function notices() {
  const out = [];
  if (!state.blob) out.push(html`<p class="note note-info" data-note="nokey">👋 ابدأ بإنشاء مفتاحك: هو ما يجعل أكوادك صحيحة وغير قابلة للتزوير. <a href="#" data-tab="key">أنشئ المفتاح</a></p>`);
  else if (!state.keys) out.push(html`<p class="note note-info" data-note="locked">🔒 المفتاح مقفل. افتحه بكلمة السر عند إصدار أول كود. <a href="#" data-act="unlock">افتحه الآن</a></p>`);
  else if (!deployed()) out.push(html`<p class="note note-warn" data-note="undeployed">⚠️ البرنامج لا يعرف مفتاحك بعد، فلن يقبل أكوادك. أرسل «السطر العام» من تبويب المفتاح للمطوّر ليضيفه (مرة واحدة فقط). <a href="#" data-tab="key">افتح التبويب</a></p>`);
  if (state.blob && !state.data.keyBackupAt) out.push(html`<p class="note note-warn" data-note="nobackup">💾 لم تنزّل نسخة من ملف مفتاحك بعد. بدونها إذا فُقد جهازك تضيع كل أكوادك. <a href="#" data-act="key-backup">نزّل النسخة الآن</a></p>`);
  const age = state.data.exportedAt ? daysBetween(state.data.exportedAt.slice(0, 10), today()) : null;
  if (state.data.customers.length && (age == null || age > 14)) out.push(html`<p class="note note-warn" data-note="nocustbackup">💾 ${age == null ? 'لم تنزّل نسخة من قائمة زبائنك بعد' : `آخر نسخة من قائمة زبائنك قبل ${daysText(age)}`}. القائمة محفوظة على هذا المتصفح فقط. <a href="#" data-act="export">نزّل نسخة</a></p>`);
  return out;
}

function render() {
  const unseen = state.seen !== VERSION && state.tab !== 'updates';
  root.innerHTML = String(html`
    <div class="page-head"><div><h2>لوحة المالك <a href="#" class="badge badge-info upd-chip" data-tab="updates" data-version title="سجل التحديثات">الإصدار <span dir="ltr">${VERSION}</span></a></h2><div class="sub">زبائنك واشتراكاتهم وأكوادهم — كلها محفوظة على جهازك فقط</div></div>
      <div class="actions"><button class="btn btn-primary" data-act="new-customer">➕ زبون جديد</button></div></div>
    ${notices().map((n) => html`<div style="margin-bottom:12px">${n}</div>`)}
    <div class="seg owner-tabs" role="tablist">${TABS.map(([k, t]) => html`<button type="button" role="tab" class="${k === state.tab ? 'on' : ''}" aria-selected="${String(k === state.tab)}" data-tab="${k}">${t}${k === 'updates' && unseen ? html` <span class="badge badge-warn" data-new-tab>جديد</span>` : ''}</button>`)}</div>
    <div class="owner-body" data-body>${state.tab === 'key' ? keyTab() : state.tab === 'tools' ? toolsTab() : state.tab === 'updates' ? updatesTab() : customersTab()}</div>`);
  if (state.tab === 'customers') drawList();
  if (state.tab === 'updates') markSeen();
  const theme = document.getElementById('theme');
  if (theme) theme.textContent = document.documentElement.getAttribute('data-theme') === 'dark' ? '☀️ فاتح' : '🌙 داكن';
}

// ─── تبويب الزبائن ───
function customersTab() {
  const cs = state.data.customers;
  const st = cs.map(standing);
  const n = (k) => st.filter((s) => k.includes(s.key)).length;
  const month = today().slice(0, 7);
  const income = cs.flatMap((c) => c.licenses).filter((l) => l.payload.i.startsWith(month)).reduce((s, l) => s + (l.paid || 0), 0);
  const kpi = (l, v, s = '') => html`<div class="kpi"><span class="kpi-l">${l}</span><span class="kpi-v">${v}</span>${s ? html`<span class="kpi-s">${s}</span>` : ''}</div>`;
  if (!cs.length) {
    return html`<div class="empty"><div class="empty-ic">👥</div><h3>لا يوجد زبائن بعد</h3>
      <p>أضف زبونك الأول، ثم أصدر له كود اشتراك بالباقة والميزات والمدة التي تريدها، وأرسله له بالواتساب.</p>
      <button class="btn btn-primary" data-act="new-customer">➕ أضف أول زبون</button></div>`;
  }
  return html`<div class="grid g4" style="margin-bottom:14px" data-kpis>
      ${kpi('فعّالون', n(['active', 'lifetime', 'soon', 'grace']), 'اشتراكهم يعمل الآن')}
      ${kpi('ينتهون قريباً', n(['soon', 'grace']), 'خلال 7 أيام أو في المهلة')}
      ${kpi('منتهون', n(['expired']), 'يحتاجون تجديداً')}
      ${kpi('مستلم هذا الشهر', income ? income.toLocaleString('en-US') + ' ' + CONFIG.currency : '—', 'من المبالغ التي سجّلتها')}
    </div>
    <div class="toolbar" style="margin-bottom:12px"><input class="inp" type="search" data-search placeholder="🔍 ابحث بالاسم أو الهاتف" value="${state.q}" aria-label="بحث"></div>
    <div class="cust-list" data-list></div>`;
}

function drawList() {
  const box = $('[data-list]', root);
  if (!box) return;
  const q = norm(latin(state.q));
  const rows = state.data.customers
    .map((c) => ({ c, s: standing(c) }))
    .filter(({ c }) => !q || norm(c.name).includes(q) || latin(c.phone).includes(q))
    .sort((a, b) => a.s.rank - b.s.rank || String(a.s.e && a.s.e.exp).localeCompare(String(b.s.e && b.s.e.exp)) || a.c.name.localeCompare(b.c.name, 'ar'));
  box.innerHTML = rows.length ? String(html`${rows.map(({ c, s }) => {
    const l = latest(c);
    const e = s.e;
    const isDemo = !!(l && l.payload.n);
    return html`<div class="cust" data-cust="${c.id}">
      <div class="cust-main"><div class="cust-name"><b>${c.name}</b> <span class="badge badge-${s.cls}">${s.label}</span></div>
        <div class="muted small">${[c.phone ? html`<span dir="ltr">${c.phone}</span>` : '', e ? (isDemo ? `نسخة عرض · ${lic.invoicesText(l.payload.n)}${e.exp ? ' · حتى ' + fmtDate(e.exp) : ''}` : `${planName(l.payload.p)}${e.exp ? ' · حتى ' + fmtDate(e.exp) : ' · دائم'}`) : 'لم يُصدر له اشتراك بعد', l && !isDemo ? `${resolved(l).size} ميزة` : ''].filter(Boolean).map((x, i) => html`${i ? ' · ' : ''}${x}`)}</div>
        ${c.notes ? html`<div class="muted small">📝 ${c.notes}</div>` : ''}</div>
      <div class="cust-acts">
        <button class="btn btn-primary btn-sm" data-act="issue" data-id="${c.id}">🎫 ${l && !isDemo ? 'تجديد / تعديل' : 'إصدار اشتراك'}</button>
        ${!l || isDemo ? html`<button class="btn btn-ghost btn-sm" data-act="demo" data-id="${c.id}">🧪 نسخة عرض</button>` : ''}
        ${l ? html`<button class="btn btn-ghost btn-sm" data-act="code" data-id="${c.id}">📋 الكود</button>` : ''}
        ${l && (s.key === 'soon' || s.key === 'grace' || s.key === 'expired' || isDemo) ? html`<button class="btn btn-ghost btn-sm" data-act="remind" data-id="${c.id}">💬 ${isDemo ? 'متابعة' : 'تذكير'}</button>` : ''}
        <button class="btn btn-ghost btn-sm" data-act="edit-customer" data-id="${c.id}" aria-label="تعديل بيانات ${c.name}">✏️</button>
        <button class="btn btn-ghost btn-sm" data-act="del-customer" data-id="${c.id}" aria-label="حذف ${c.name}">🗑️</button></div></div>`;
  })}`) : String(html`<p class="muted" style="padding:14px 4px">لا نتائج مطابقة.</p>`);
}
const resolved = (l) => lic.resolveFeatures(l.payload);

// ─── نوافذ الزبون ───
function customerDialog(c) {
  return modal({
    title: c ? '✏️ بيانات الزبون' : '➕ زبون جديد',
    body: html`<form novalidate data-form="customer" class="stack">
      ${field('الاسم (اسم المحل أو صاحبه)', html`<input class="inp" name="name" value="${c ? c.name : ''}" maxlength="80" autofocus>`)}
      ${field('رقم واتساب', html`<input class="inp" name="phone" dir="ltr" inputmode="tel" value="${c ? c.phone : ''}" placeholder="مثال: 0791234567 أو 962791234567">`, { hint: 'لإرسال الكود والتذكير. الرقم المحلي يُحوَّل لمفتاح بلدك تلقائياً' })}
      ${field('ملاحظات (لك فقط)', html`<input class="inp" name="notes" value="${c ? c.notes : ''}" maxlength="300" placeholder="مثال: دفع نقداً، يريد فرعين">`)}
      <small class="fld-e" data-err hidden></small>
      <div class="dlg-actions"><button class="btn btn-primary">حفظ</button><button type="button" class="btn btn-ghost" data-no>إلغاء</button></div></form>`,
    onMount: (dlg, done) => {
      const f = $('form', dlg);
      $('[data-no]', dlg).onclick = () => done(null);
      f.onsubmit = (e) => {
        e.preventDefault();
        const name = f.name.value.trim();
        if (!name) { const m = $('[data-err]', f); m.textContent = 'اكتب اسم الزبون'; m.hidden = false; return; }
        if (c) Object.assign(c, { name, phone: f.phone.value.trim(), notes: f.notes.value.trim() });
        else state.data.customers.push({ id: 'C' + newLicenseId(8), name, phone: f.phone.value.trim(), notes: f.notes.value.trim(), created: today(), licenses: [] });
        save();
        done(true);
      };
    },
  });
}

// ─── إصدار اشتراك أو تعديله ───
const featureBoxes = (checked) => html`<div class="feat-pick" data-feats>${FEATURES.map((f) => html`<label class="check"><input type="checkbox" name="f" value="${f.id}" ${checked.has(f.id) ? raw('checked') : ''}><span>${f.icon} ${f.name}</span></label>`)}</div>`;
const DURS = [['1', 'شهر'], ['3', '3 أشهر'], ['6', '6 أشهر'], ['12', 'سنة'], ['life', 'مدى الحياة'], ['date', 'حتى تاريخ…']];

async function issueDialog(c) {
  if (!(await ensureKeys())) return;
  const cur = latestSub(c); // أكواد العرض لا تُبنى عليها اشتراكات (لا تمديد ولا ميزات سابقة)
  const curEnt = cur ? lic.entitlementOf(cur.payload, today(), CONFIG.graceDays) : null;
  const curAlive = !!curEnt && (curEnt.status === 'active' || curEnt.status === 'lifetime');
  const plans = Object.values(PLANS).filter((p) => p.id !== 'free');
  const firstPlan = cur && (PLANS[cur.payload.p] || cur.payload.p === '') ? (cur.payload.p || 'custom') : (plans[0] ? plans[0].id : 'custom');
  const initial = new Set(cur ? lic.resolveFeatures(cur.payload) : planFeatures(firstPlan));
  await modal({
    title: `🎫 اشتراك ${c.name}`,
    wide: true,
    body: html`<form novalidate data-form="issue" class="stack">
      ${curEnt ? html`<p class="note note-info">اشتراكه الحالي: <b>${planName(cur.payload.p)}</b> — ${curEnt.status === 'lifetime' ? 'دائم' : curEnt.status === 'expired' ? 'منتهي منذ ' + fmtDate(curEnt.exp) : (curEnt.status === 'grace' ? 'في المهلة، انتهى ' : 'ينتهي ') + fmtDate(curEnt.exp)}</p>` : ''}
      <div class="form-grid">
        ${field('الباقة', html`<select class="inp" name="plan">${plans.map((p) => html`<option value="${p.id}" ${p.id === firstPlan ? raw('selected') : ''}>${p.name}</option>`)}<option value="custom" ${firstPlan === 'custom' ? raw('selected') : ''}>مخصّصة (أختار الميزات)</option></select>`)}
        ${field('كود الجهاز (اختياري)', html`<input class="inp" name="device" dir="ltr" placeholder="مثال: K7M2-9QX4" maxlength="20" autocomplete="off">`, { hint: 'اتركه فارغاً ليعمل الكود على أي جهاز' })}
      </div>
      <div><div class="fld-l" style="margin-bottom:6px">الميزات <span class="muted small" data-count></span></div>${featureBoxes(initial)}</div>
      <div><div class="fld-l" style="margin-bottom:6px">المدة</div>
        <div class="dur" role="radiogroup">${[...DURS, ...(cur && curEnt.status !== 'expired' ? [['keep', 'نفس تاريخ الانتهاء (تعديل الميزات فقط)']] : [])].map(([v, t]) => html`<label class="seg-opt"><input type="radio" name="dur" value="${v}" ${v === '1' ? raw('checked') : ''}><span>${t}</span></label>`)}</div>
        <input class="inp" type="date" name="date" min="${today()}" style="margin-top:8px;max-width:220px" hidden aria-label="تاريخ الانتهاء">
        ${curAlive && curEnt.status === 'active' ? html`<label class="check" style="margin-top:8px"><input type="checkbox" name="extend" checked><span>يبدأ بعد انتهاء اشتراكه الحالي (تمديد بدل أن يضيع ما بقي له)</span></label>` : ''}
        <p class="muted small" data-preview style="margin-top:6px"></p></div>
      ${field('المبلغ المستلم (للسجل فقط)', html`<input class="inp" name="paid" dir="ltr" inputmode="decimal" placeholder="اختياري" style="max-width:220px">`, { hint: 'لا يظهر في الكود، يُحسب في «مستلم هذا الشهر»' })}
      <small class="fld-e" data-err hidden></small>
      <div class="dlg-actions"><button class="btn btn-primary">إصدار الكود</button><button type="button" class="btn btn-ghost" data-no>إلغاء</button></div></form>`,
    onMount: (dlg, done) => {
      const f = $('form', dlg);
      $('[data-no]', dlg).onclick = () => done(null);
      const boxes = () => $$('input[name=f]', f);
      const chosen = () => new Set(boxes().filter((b) => b.checked).map((b) => b.value));
      const durVal = () => (f.querySelector('input[name=dur]:checked') || {}).value;
      const calcExp = () => {
        const d = durVal();
        const base = f.extend && f.extend.checked && curAlive && curEnt.exp ? addDays(curEnt.exp, 1) : today();
        if (d === 'life') return '';
        if (d === 'keep') return cur.payload.e;
        if (d === 'date') return f.date.value;
        return addDays(addMonths(base, Number(d)), -1);
      };
      const refresh = () => {
        f.date.hidden = durVal() !== 'date';
        $('[data-count]', f).textContent = `(${chosen().size} من ${FEATURES.length})`;
        const exp = calcExp();
        $('[data-preview]', f).textContent = durVal() === 'life' || (durVal() === 'keep' && !exp) ? 'الاشتراك دائم بلا تاريخ انتهاء.' : isDate(exp) ? `ينتهي في ${fmtDate(exp)} (آخر يوم صالح).` : 'اختر تاريخ الانتهاء.';
      };
      f.plan.onchange = () => { const set = f.plan.value === 'custom' ? chosen() : new Set(planFeatures(f.plan.value)); boxes().forEach((b) => { b.checked = set.has(b.value); }); refresh(); };
      f.addEventListener('change', refresh);
      f.addEventListener('input', refresh);
      refresh();
      f.onsubmit = async (e) => {
        e.preventDefault();
        const err = $('[data-err]', f);
        err.hidden = true;
        const fail = (m) => { err.textContent = m; err.hidden = false; };
        const exp = calcExp();
        if (durVal() === 'date' && (!isDate(exp) || exp < today())) return fail('اختر تاريخ انتهاء من اليوم فصاعداً.');
        const picked = chosen();
        if (!picked.size) return fail('اختر ميزة واحدة على الأقل.');
        const plan = f.plan.value;
        const base = new Set(plan === 'custom' ? [] : planFeatures(plan));
        const add = [...picked].filter((id) => !base.has(id));
        const remove = [...base].filter((id) => !picked.has(id));
        const btn = $('.btn-primary', f);
        btn.disabled = true;
        try {
          const payload = buildPayload({ kid: state.keys.kid, customer: c.name, plan: plan === 'custom' ? '' : plan, add, remove, issued: today(), exp, device: f.device.value });
          const code = await signLicense(payload, state.keys.privateKey);
          const rec = { payload, code, at: new Date().toISOString(), paid: Number(latin(f.paid.value).replace(/[^\d.]/g, '')) || 0 };
          c.licenses.push(rec);
          save();
          $('.dlg-head h2', dlg).textContent = '✅ تم إصدار الكود';
          $('.dlg-body', dlg).innerHTML = String(codeView(c, rec, { fresh: true }));
          bindCodeView(dlg, c, rec, done);
        } catch (ex) { btn.disabled = false; fail(ex.message || 'تعذّر إصدار الكود'); }
      };
    },
  });
  render();
}

// ─── إصدار كود «نسخة عرض»: كل الميزات للتجربة بعدد فواتير ومدة محدودين ───
async function demoDialog(c) {
  if (!(await ensureKeys())) return;
  const n0 = CONFIG.demoInvoices > 0 ? CONFIG.demoInvoices : 10;
  const d0 = CONFIG.demoDays > 0 ? CONFIG.demoDays : 14;
  await modal({
    title: `🧪 نسخة عرض لـ ${c.name}`,
    body: html`<form novalidate data-form="demo" class="stack">
      <p class="note note-info">كل الميزات مفتوحة له للتجربة، لكن بعدد فواتير ومدة محدودين، وتظهر على فواتيره علامة «نسخة تجريبية» فلا يستفيد منها فعلياً. عندما يعجبه البرنامج أصدر له اشتراكاً كاملاً (زر «إصدار اشتراك») فيكمل على نفس بياناته.</p>
      <div class="form-grid">
        ${field('عدد الفواتير', html`<input class="inp" name="n" type="text" inputmode="numeric" dir="ltr" value="${n0}" maxlength="3" autofocus>`, { hint: 'مبيعات ومشتريات، بما فيها الكاشير' })}
        ${field('المدة بالأيام', html`<input class="inp" name="days" type="text" inputmode="numeric" dir="ltr" value="${d0}" maxlength="3">`, { hint: 'تبدأ من اليوم' })}
        ${field('كود الجهاز (اختياري)', html`<input class="inp" name="device" dir="ltr" placeholder="مثال: K7M2-9QX4" maxlength="20" autocomplete="off">`, { hint: 'اتركه فارغاً ليعمل على أي جهاز' })}
      </div>
      <p class="muted small" data-preview></p>
      <small class="fld-e" data-err hidden></small>
      <div class="dlg-actions"><button class="btn btn-primary">إصدار كود العرض</button><button type="button" class="btn btn-ghost" data-no>إلغاء</button></div></form>`,
    onMount: (dlg, done) => {
      const f = $('form', dlg);
      $('[data-no]', dlg).onclick = () => done(null);
      const num = (v) => parseInt(latin(v).replace(/\D/g, ''), 10) || 0;
      const refresh = () => {
        const days = num(f.days.value);
        $('[data-preview]', f).textContent = days >= 1 && days <= 365 ? `ينتهي في ${fmtDate(addDays(today(), days))}.` : '';
        $('[data-err]', f).hidden = true;
      };
      f.addEventListener('input', refresh);
      refresh();
      f.onsubmit = async (e) => {
        e.preventDefault();
        const err = $('[data-err]', f);
        err.hidden = true;
        const fail = (m) => { err.textContent = m; err.hidden = false; };
        const n = num(f.n.value);
        const days = num(f.days.value);
        if (n < 1 || n > 999) return fail('عدد الفواتير من 1 إلى 999.');
        if (days < 1 || days > 365) return fail('المدة من 1 إلى 365 يوماً.');
        const btn = $('.btn-primary', f);
        btn.disabled = true;
        try {
          // الاحترافية = كل الميزات؛ وإن حُذفت من plans.js نكتب الميزات كلها في الكود
          const all = !!PLANS.pro;
          const payload = buildPayload({ kid: state.keys.kid, customer: c.name, plan: all ? 'pro' : '', add: all ? [] : FEATURES.map((x) => x.id), issued: today(), exp: addDays(today(), days), device: f.device.value, demo: n });
          const code = await signLicense(payload, state.keys.privateKey);
          const rec = { payload, code, at: new Date().toISOString(), paid: 0 };
          c.licenses.push(rec);
          save();
          $('.dlg-head h2', dlg).textContent = '✅ تم إصدار كود العرض';
          $('.dlg-body', dlg).innerHTML = String(codeView(c, rec, { fresh: true }));
          bindCodeView(dlg, c, rec, done);
        } catch (ex) { btn.disabled = false; fail(ex.message || 'تعذّر إصدار الكود'); }
      };
    },
  });
  render();
}

// عرض الكود: نسخ ورابط وإرسال واتساب
function codeView(c, rec, { fresh = false } = {}) {
  const p = rec.payload;
  const feats = [...lic.resolveFeatures(p)].length;
  if (p.n) {
    return html`${fresh ? html`<p class="dlg-msg">كود <b>نسخة عرض</b> للزبون <b>${c.name}</b> — ${lic.invoicesText(p.n)} حتى ${fmtDate(p.e)}${p.d ? html` · مربوط بالجهاز <span dir="ltr">${p.d}</span>` : ''}.</p>` : html`<p class="muted small">نسخة عرض صدرت بتاريخ ${fmtDate(p.i)} · ${lic.invoicesText(p.n)} · حتى ${fmtDate(p.e)}</p>`}
      <label class="fld" style="margin-top:10px"><span class="fld-l">كود نسخة العرض</span><textarea class="inp code-box" readonly rows="5" dir="ltr" data-code>${rec.code}</textarea></label>
      <div class="dlg-actions">
        <a class="btn btn-primary" data-wa href="${waUrl(c.phone, issueMessage(c, rec))}" target="_blank" rel="noopener">💬 أرسل للزبون عبر واتساب</a>
        <button type="button" class="btn btn-ghost" data-copy="code">📋 نسخ الكود</button>
        <button type="button" class="btn btn-ghost" data-copy="link">🔗 نسخ رابط التفعيل</button>
        <button type="button" class="btn btn-ghost" data-no>تم</button></div>
      ${c.phone ? '' : html`<p class="muted small" style="margin-top:8px">لم تُدخل رقم واتساب لهذا الزبون، فسيفتح واتساب لتختار جهة الاتصال بنفسك.</p>`}`;
  }
  return html`${fresh ? html`<p class="dlg-msg">اشتراك <b>${planName(p.p)}</b> للزبون <b>${c.name}</b> — ${feats} ميزة ${p.e ? 'حتى ' + fmtDate(p.e) : '(دائم)'}${p.d ? html` · مربوط بالجهاز <span dir="ltr">${p.d}</span>` : ''}.</p>` : html`<p class="muted small">صدر بتاريخ ${fmtDate(p.i)} · ${planName(p.p)} · ${feats} ميزة ${p.e ? '· حتى ' + fmtDate(p.e) : '· دائم'}</p>`}
    <label class="fld" style="margin-top:10px"><span class="fld-l">كود الاشتراك</span><textarea class="inp code-box" readonly rows="5" dir="ltr" data-code>${rec.code}</textarea></label>
    <div class="dlg-actions">
      <a class="btn btn-primary" data-wa href="${waUrl(c.phone, issueMessage(c, rec))}" target="_blank" rel="noopener">💬 أرسل للزبون عبر واتساب</a>
      <button type="button" class="btn btn-ghost" data-copy="code">📋 نسخ الكود</button>
      <button type="button" class="btn btn-ghost" data-copy="link">🔗 نسخ رابط التفعيل</button>
      <button type="button" class="btn btn-ghost" data-no>تم</button></div>
    ${c.phone ? '' : html`<p class="muted small" style="margin-top:8px">لم تُدخل رقم واتساب لهذا الزبون، فسيفتح واتساب لتختار جهة الاتصال بنفسك.</p>`}`;
}
function bindCodeView(dlg, c, rec, done) {
  $('[data-no]', dlg).onclick = () => done(null);
  $('[data-copy=code]', dlg).onclick = () => copy(rec.code, 'تم نسخ الكود ✓');
  $('[data-copy=link]', dlg).onclick = () => copy(lic.activationLink(rec.code), 'تم نسخ رابط التفعيل ✓');
  $('[data-code]', dlg).onclick = (e) => e.target.select();
}
function showCode(c) {
  const rec = latest(c);
  if (!rec) return;
  return modal({ title: `📋 آخر كود لـ ${c.name}`, body: codeView(c, rec), onMount: (dlg, done) => bindCodeView(dlg, c, rec, done) });
}

// ─── تبويب المفتاح ───
function keyTab() {
  if (!state.blob) {
    return html`<div class="card" data-key="create"><div class="card-h"><h3>🔑 أنشئ مفتاحك</h3></div>
      <p class="today-text">المفتاح هو ما يميّز أكوادك الصحيحة عن المزوّرة. يُنشأ على جهازك الآن ولا يغادره، ويُحفظ هنا مشفّراً بكلمة سر تختارها.</p>
      <form novalidate data-form="create-key" class="stack" style="margin-top:12px;max-width:460px">
        ${field('كلمة السر', html`<input class="inp" type="password" name="pw" autocomplete="new-password">`, { hint: '8 خانات على الأقل. الأفضل جملة طويلة تحفظها.' })}
        ${field('أعد كتابتها', html`<input class="inp" type="password" name="pw2" autocomplete="new-password">`)}
        <label class="check"><input type="checkbox" name="ack"><span>فهمت أنني إذا فقدت كلمة السر أو ملف المفتاح فلن أستطيع استرجاعهما، وسأضطر لإصدار أكواد جديدة لكل زبون.</span></label>
        <small class="fld-e" data-err hidden></small>
        <div><button class="btn btn-primary">إنشاء المفتاح</button></div></form>
      <hr style="border:0;border-top:1px solid var(--border);margin:18px 0">
      <p class="muted small" style="margin-bottom:8px">عندك ملف مفتاح نزّلته سابقاً من جهاز آخر؟</p>
      <label class="btn btn-ghost">📂 استيراد ملف المفتاح<input type="file" accept=".json,application/json" data-key-file hidden></label></div>`;
  }
  if (!state.keys) {
    return html`<div class="card" data-key="locked"><div class="card-h"><h3>🔒 المفتاح مقفل</h3></div>
      <p class="muted small">أدخل كلمة السر لفتحه. يبقى مفتوحاً حتى تغلق هذه الصفحة.</p>
      <form novalidate data-form="unlock-tab" class="stack" style="margin-top:12px;max-width:460px">
        ${field('كلمة السر', html`<input class="inp" type="password" name="pw" autocomplete="current-password">`)}
        <small class="fld-e" data-err hidden></small>
        <div class="inline"><button class="btn btn-primary">فتح</button><button type="button" class="btn btn-ghost" data-act="key-backup">💾 نزّل نسخة المفتاح</button><button type="button" class="btn btn-text-danger" data-act="key-delete">حذف</button></div></form></div>`;
  }
  const ok = deployed();
  const line = publicKeyLine(state.keys.kid, state.keys.publicJwk);
  return html`<div class="card" data-key="ready"><div class="card-h"><h3>✅ المفتاح جاهز</h3><span class="muted small" dir="ltr">${state.keys.kid}</span></div>
      <p class="note ${ok ? 'note-ok' : 'note-warn'}" data-deployed="${String(ok)}">${ok ? '✅ البرنامج يعرف مفتاحك ويقبل أكوادك.' : '⚠️ البرنامج لا يعرف مفتاحك بعد، فلن يقبل أي كود. أرسل السطر التالي للمطوّر ليضيفه إلى البرنامج (مرة واحدة فقط). هذا السطر ليس سراً.'}</p>
      ${ok ? '' : html`<label class="fld" style="margin-top:12px"><span class="fld-l">السطر العام لمفتاحك</span><textarea class="inp code-box" readonly rows="3" dir="ltr" data-publine>${line}</textarea></label>
        <div style="margin-top:8px"><button type="button" class="btn btn-primary btn-sm" data-act="copy-pub">📋 نسخ السطر</button></div>`}
      <div class="actions" style="margin-top:14px">
        <button type="button" class="btn btn-ghost" data-act="key-backup">💾 نزّل نسخة من ملف المفتاح ${state.data.keyBackupAt ? '' : '(مهم)'}</button>
        <button type="button" class="btn btn-ghost" data-act="key-lock">🔒 قفل المفتاح</button>
        <button type="button" class="btn btn-text-danger" data-act="key-delete">حذف المفتاح</button></div>
      <p class="muted small" style="margin-top:10px">${state.data.keyBackupAt ? `آخر نسخة نزّلتها: ${fmtDate(state.data.keyBackupAt.slice(0, 10))}. احفظ الملف في مكان آمن بعيد عن هذا الجهاز.` : 'لم تنزّل نسخة بعد.'}</p></div>`;
}

async function keyFileImport(file) {
  try {
    const blob = JSON.parse(await file.text());
    if (!isObj(blob) || blob.v !== 1 || !isObj(blob.pub) || typeof blob.data !== 'string' || typeof blob.salt !== 'string' || typeof blob.iv !== 'string' || !Number.isInteger(blob.iter) || blob.iter < 1000 || blob.iter > 5000000) throw new Error('bad');
    if (blob.kid !== (await lic.keyId(blob.pub))) throw new Error('bad');
    state.blob = { v: 1, kid: blob.kid, pub: { kty: 'EC', crv: 'P-256', x: blob.pub.x, y: blob.pub.y }, iter: blob.iter, salt: blob.salt, iv: blob.iv, data: blob.data };
    writeJSON(LS_KEY, state.blob);
    state.keys = null;
    toast('تم استيراد المفتاح. افتحه بكلمة سره ✓');
    render();
  } catch (e) { toast('ملف المفتاح غير صالح', 'err'); }
}

// ─── تبويب التحديثات: رقم كل تحديث وشو تغيّر فيه ───
function updatesTab() {
  const since = state.seenBefore;
  const isNew = (e) => (since ? cmpVersion(e.v, since) > 0 : e === CHANGELOG[0]);
  const cur = CHANGELOG[0];
  return html`<p class="note note-info" data-note="version">الإصدار الحالي من البرنامج: <b dir="ltr">${cur.v}</b> — صدر بتاريخ ${fmtDate(cur.date)}. كل تحديث جديد يُضاف هنا برقمه وشرح لما تغيّر فيه.</p>
    <div data-updates>${CHANGELOG.map((e, i) => html`<div class="card upd${i === 0 ? ' upd-cur' : ''}" data-v="${e.v}">
      <div class="card-h"><h3><span class="badge badge-${i === 0 ? 'ok' : 'muted'} upd-v" dir="ltr">${e.v}</span> ${e.title}${isNew(e) ? html` <span class="badge badge-warn" data-new>جديد</span>` : ''}</h3><span class="muted small">${fmtDate(e.date)}</span></div>
      ${e.desktop ? html`<p class="muted small" data-desktop>💻 مع هذا التحديث صدر تطبيق اللابتوب <span dir="ltr">${e.desktop}</span></p>` : ''}
      <ul class="upd-items">${e.items.map((t) => html`<li>${t}</li>`)}</ul></div>`)}</div>
    <p class="muted small">الأرقام قبل ${NUMBERED_LATER_BEFORE} أُعطيت لاحقاً لترتيب التاريخ، ومن ${NUMBERED_LATER_BEFORE} صار كل تحديث يُرقَّم عند نشره.</p>`;
}

// ─── تبويب الأدوات ───
function toolsTab() {
  return html`<div class="card" data-tool="backup"><div class="card-h"><h3>💾 نسخة احتياطية لقائمة الزبائن</h3><span class="muted small">${state.data.exportedAt ? 'آخر نسخة: ' + fmtDate(state.data.exportedAt.slice(0, 10)) : 'لم تنزّل نسخة بعد'}</span></div>
      <p class="muted small">قائمتك محفوظة على هذا المتصفح فقط. نزّل نسخة بعد كل تعديل مهم، واستعدها على أي جهاز آخر.</p>
      <div class="actions" style="margin-top:10px"><button class="btn btn-primary" data-act="export">⬇️ تنزيل النسخة</button>
        <label class="btn btn-ghost">⬆️ استعادة من ملف<input type="file" accept=".json,application/json" data-import hidden></label></div></div>
    <div class="card" style="margin-top:14px" data-tool="preview"><div class="card-h"><h3>👁️ جرّب البرنامج كزبون</h3></div>
      <p class="muted small">يطبّق الاشتراكات على هذا الجهاز فقط (الباقي من الزبائن لا يتأثر)، فترى الميزات المقفلة وصفحة الاشتراك كما يراها الزبون، وتجرب تفعيل كود حقيقي.</p>
      <label class="check" style="margin-top:10px"><input type="checkbox" data-preview ${lic.previewing() ? raw('checked') : ''}><span>تطبيق الاشتراكات على هذا الجهاز للمعاينة</span></label>
      <div class="actions" style="margin-top:10px"><a class="btn btn-ghost" href="./" target="_blank" rel="noopener">افتح البرنامج ↗</a><a class="btn btn-ghost" href="plans.html" target="_blank" rel="noopener">صفحة الأسعار ↗</a></div></div>
    <div class="card" style="margin-top:14px" data-tool="demo"><div class="card-h"><h3>🧪 نسخة العرض</h3><span class="badge badge-${CONFIG.demoPublic ? 'warn' : 'muted'}" data-demo-public="${String(!!CONFIG.demoPublic)}">${CONFIG.demoPublic ? 'مفعّلة للجميع' : 'مطفّأة للجميع'}</span></div>
      <p class="muted small">نسخة تجريبية بـ ${lic.invoicesText(CONFIG.demoInvoices)}${CONFIG.demoDays > 0 ? ` و${daysText(CONFIG.demoDays)}` : ' وبلا حد زمني'} وكل الميزات مفتوحة. حين تفعّلها للجميع (<span dir="ltr">demoPublic</span> في ملف <span dir="ltr">plans.js</span>) تعمل بها كل نسخة بلا كود اشتراك، ويحوّلها كود الاشتراك الذي ترسله لاشتراك كامل بنفس البيانات. وأكواد العرض التي تصدرها من زر «نسخة عرض» بجانب كل زبون تعمل دائماً.</p>
      <label class="check" style="margin-top:10px"><input type="checkbox" data-demo-preview ${lic.demoPreviewing() ? raw('checked') : ''}><span>تشغيل نسخة العرض على هذا الجهاز فقط للتجربة</span></label>
      <div class="actions" style="margin-top:10px"><a class="btn btn-ghost" href="./" target="_blank" rel="noopener">افتح البرنامج ↗</a><a class="btn btn-ghost" href="download.html" target="_blank" rel="noopener">صفحة التنزيل ↗</a></div></div>
    <div class="card" style="margin-top:14px" data-tool="test"><div class="card-h"><h3>🔍 افحص كوداً</h3></div>
      <p class="muted small">الصق كوداً وصلك من زبون لترى ما بداخله وهل توقيعه سليم.</p>
      <form novalidate data-form="test" class="stack" style="margin-top:10px"><textarea class="inp code-box" name="code" rows="3" dir="ltr" placeholder="AHS1.…" spellcheck="false"></textarea>
        <div><button class="btn btn-primary btn-sm">فحص</button></div></form>
      <div data-test-out style="margin-top:12px"></div></div>`;
}

async function testCode(raw0) {
  const out = $('[data-test-out]', root);
  const p = lic.parseCode(raw0);
  if (!p.ok) { out.innerHTML = String(html`<p class="note note-bad">${lic.REASONS[p.reason]}</p>`); return; }
  const keys = [...PUBLIC_KEYS, ...(state.keys ? [{ kid: state.keys.kid, jwk: state.keys.publicJwk }] : [])];
  const v = await lic.verifyCode(raw0, { keys });
  const e = lic.entitlementOf(p.payload, today(), CONFIG.graceDays);
  const names = [...lic.resolveFeatures(p.payload)].map((id) => (FEATURES.find((f) => f.id === id) || {}).name).filter(Boolean);
  const stText = { lifetime: 'دائم', active: `فعّال (باقي ${daysText(e.daysLeft)})`, grace: 'في المهلة', expired: 'منتهي' }[e.status];
  out.innerHTML = String(html`<p class="note ${v.ok ? 'note-ok' : 'note-bad'}">${v.ok ? '✅ التوقيع سليم: الكود صدر من مفتاحك.' : '❌ التوقيع غير موثّق' + (keys.length ? ': ليس من مفتاحك.' : ': لا مفتاح لديك للمقارنة.')}</p>
    <ul class="test-list"><li><b>الزبون:</b> ${p.payload.c || '—'}</li>${p.payload.n ? html`<li><b>النوع:</b> نسخة عرض (${lic.invoicesText(p.payload.n)})</li>` : html`<li><b>الباقة:</b> ${planName(p.payload.p)}</li>`}<li><b>الحالة:</b> ${stText}</li>
      <li><b>صدر:</b> ${fmtDate(p.payload.i)} · <b>ينتهي:</b> ${p.payload.e ? fmtDate(p.payload.e) : 'دائم'}</li>
      <li><b>كود الجهاز:</b> ${p.payload.d ? html`<span dir="ltr">${p.payload.d}</span>` : 'أي جهاز'}</li>
      <li><b>الميزات (${names.length}):</b> ${names.join('، ') || '—'}</li></ul>`);
}

// ─── الأحداث ───
root.addEventListener('click', async (e) => {
  const tab = e.target.closest('[data-tab]');
  if (tab) { e.preventDefault(); state.tab = tab.dataset.tab; render(); return; }
  const a = e.target.closest('[data-act]');
  if (!a) return;
  e.preventDefault();
  const cust = a.dataset.id ? state.data.customers.find((c) => c.id === a.dataset.id) : null;
  switch (a.dataset.act) {
    case 'new-customer': if (await customerDialog(null)) { state.tab = 'customers'; render(); } break;
    case 'edit-customer': if (cust && (await customerDialog(cust))) render(); break;
    case 'del-customer':
      if (cust && (await confirmBox(`حذف «${cust.name}» من قائمتك؟ اشتراكه الحالي لا يُلغى بذلك، فيبقى يعمل حتى ينتهي. نزّل نسخة قبل الحذف إن لم تكن فعلت.`, { ok: 'حذف', danger: true, title: 'حذف زبون' }))) {
        state.data.customers = state.data.customers.filter((c) => c.id !== cust.id); save(); render();
      }
      break;
    case 'issue': if (cust) await issueDialog(cust); break;
    case 'demo': if (cust) await demoDialog(cust); break;
    case 'code': if (cust) await showCode(cust); break;
    case 'remind': { const s = cust && standing(cust); if (s && s.e) window.open(waUrl(cust.phone, reminderMessage(cust, s)), '_blank', 'noopener'); break; }
    case 'unlock': if (await unlockDialog()) render(); break;
    case 'key-lock': state.keys = null; render(); break;
    case 'copy-pub': copy(publicKeyLine(state.keys.kid, state.keys.publicJwk), 'تم نسخ السطر ✓'); break;
    case 'key-backup':
      if (!state.blob) break;
      download(`ahsebha-owner-key-${state.blob.kid}.json`, JSON.stringify(state.blob, null, 2), 'application/json');
      state.data.keyBackupAt = new Date().toISOString(); save(); toast('تم تنزيل ملف المفتاح. احفظه في مكان آمن ✓'); render();
      break;
    case 'key-delete':
      if (await confirmBox('سيُحذف مفتاحك من هذا الجهاز. إن لم يكن عندك ملف نسخة فلن تستطيع إصدار أكواد جديدة تقبلها نسخة البرنامج الحالية. هل أنت متأكد؟', { ok: 'احذف المفتاح', danger: true, title: 'حذف المفتاح' })
        && (await confirmBox('تأكيد أخير: هل نزّلت ملف المفتاح وحفظته؟', { ok: 'نعم، احذف', danger: true, title: 'تأكيد الحذف' }))) {
        try { localStorage.removeItem(LS_KEY); } catch (err) { /* لا شيء */ }
        state.blob = null; state.keys = null; state.data.keyBackupAt = ''; save(); render();
      }
      break;
    case 'export':
      state.data.exportedAt = new Date().toISOString(); save();
      download(`ahsebha-customers-${today()}.json`, JSON.stringify(state.data, null, 2), 'application/json');
      toast('تم تنزيل نسخة الزبائن ✓'); render();
      break;
    default: break;
  }
});

root.addEventListener('submit', async (e) => {
  const f = e.target.closest('form[data-form]');
  if (!f) return;
  const kind = f.dataset.form;
  if (kind !== 'create-key' && kind !== 'unlock-tab' && kind !== 'test') return;
  e.preventDefault();
  const err = $('[data-err]', f);
  const fail = (m) => { if (err) { err.textContent = m; err.hidden = false; } };
  if (kind === 'test') { await testCode(f.code.value); return; }
  if (kind === 'unlock-tab') {
    try { state.keys = await unwrapKeys(state.blob, f.pw.value); render(); } catch (ex) { fail(ex.message); }
    return;
  }
  if (f.pw.value.length < 8) return fail('كلمة السر قصيرة: 8 خانات على الأقل.');
  if (f.pw.value !== f.pw2.value) return fail('كلمتا السر غير متطابقتين.');
  if (!f.ack.checked) return fail('أكّد أنك فهمت تنبيه فقدان المفتاح.');
  const btn = $('button', f);
  btn.disabled = true;
  btn.textContent = 'جارٍ الإنشاء…';
  try { await createKeys(f.pw.value); toast('تم إنشاء مفتاحك ✓ نزّل نسخة منه الآن'); render(); } catch (ex) { btn.disabled = false; fail('تعذّر إنشاء المفتاح: ' + (ex.message || ex)); }
});

root.addEventListener('input', (e) => {
  if (e.target.matches('[data-search]')) { state.q = e.target.value; drawList(); }
});
root.addEventListener('change', async (e) => {
  if (e.target.matches('[data-key-file]')) { const f = e.target.files[0]; e.target.value = ''; if (f) await keyFileImport(f); return; }
  if (e.target.matches('[data-preview]')) { lic.setPreview(e.target.checked); toast(e.target.checked ? 'تُطبَّق الاشتراكات على هذا الجهاز للمعاينة' : 'عاد هذا الجهاز لوضعه العادي'); return; }
  if (e.target.matches('[data-demo-preview]')) { lic.setDemoPreview(e.target.checked); toast(e.target.checked ? 'يعمل البرنامج على هذا الجهاز كنسخة عرض' : 'عاد هذا الجهاز لوضعه العادي'); return; }
  if (e.target.matches('[data-import]')) {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const d = normData(JSON.parse(await file.text()));
      if (!(await confirmBox(`ستُستبدل قائمة زبائن هذا الجهاز بالقائمة الموجودة في الملف (${d.customers.length} زبون). المتابعة؟`, { ok: 'استبدال', danger: true, title: 'استعادة نسخة' }))) return;
      state.data = { ...d, keyBackupAt: state.data.keyBackupAt };
      save(); toast(`تمت استعادة ${d.customers.length} زبون ✓`); render();
    } catch (ex) { toast('الملف غير صالح', 'err'); }
  }
});

document.getElementById('theme').onclick = () => {
  const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  try { localStorage.setItem('theme', next); } catch (e) { /* للجلسة فقط */ }
  document.getElementById('theme').textContent = next === 'dark' ? '☀️ فاتح' : '🌙 داكن';
};

render();
