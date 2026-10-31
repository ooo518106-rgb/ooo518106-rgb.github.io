// ═══ الاستيراد من Excel: تعريف الأعمدة، التعرّف على العناوين، ومطابقة السجلات الموجودة ═══
// دوال نقية بلا DOM حتى تُختبر في Node.
import { num, round } from './core.js';
import { isEan13, code128Supported } from './barcode.js';

// تطبيع عنوان العمود: حروف صغيرة، بلا مسافات أو رموز، وتوحيد الهمزات
export const normKey = (s) => String(s ?? '').toLowerCase()
  .replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/[ً-ْـ]/g, '')
  .split(/[\s_\-.:()/\\#*]+/).map((w) => w.replace(/^ال(?=\S{3})/, '')).join('');

const PRODUCT_FIELDS = [
  // الترتيب أولوية: «اسم المادة» أقوى من «اسم الصنف»، فإن وُجد الاثنان صار الصنف تصنيفاً (انظر category)
  { k: 'name', t: 'الاسم', req: true, syn: ['اسم المادة', 'المادة', 'اسم المنتج', 'المنتج', 'اسم السلعة', 'السلعة', 'اسم الصنف', 'الصنف', 'صنف', 'اسم', 'البيان', 'مادة', 'منتج', 'سلعة', 'name', 'product', 'product name', 'item', 'item name', 'description'] },
  { k: 'nameEn', t: 'الاسم بالإنجليزي', syn: ['الاسم بالانجليزي', 'اسم انجليزي', 'الاسم الانجليزي', 'english name', 'name en', 'name english'] },
  { k: 'barcode', t: 'الباركود', syn: ['باركود', 'الباركود', 'barcode', 'bar code', 'ean', 'upc', 'gtin'] },
  { k: 'sku', t: 'الرمز (SKU)', syn: ['رمز', 'الرمز', 'كود', 'رقم الصنف', 'كود الصنف', 'sku', 'code', 'item code', 'ref'] },
  { k: 'category', t: 'التصنيف', syn: ['تصنيف', 'التصنيف', 'الفئه', 'فئه', 'القسم', 'قسم', 'مجموعه', 'category', 'group', 'department', 'family', 'نوع الصنف', 'نوع المادة', 'اسم الصنف', 'الصنف', 'صنف'] },
  { k: 'type', t: 'النوع (منتج / خدمة)', syn: ['نوع', 'النوع', 'type', 'kind'] },
  { k: 'unit', t: 'الوحدة', syn: ['وحده', 'الوحده', 'unit', 'uom'] },
  { k: 'price', t: 'سعر البيع', num: true, syn: ['سعر البيع', 'سعر المبيع', 'سعر المفرق', 'سعر', 'السعر', 'المبيع', 'المفرق', 'البيع', 'بيع', 'price', 'sale price', 'selling price', 'sales price', 'retail price'] },
  { k: 'cost', t: 'سعر الشراء (التكلفة)', num: true, syn: ['سعر الشراء', 'سعر التكلفه', 'سعر الكلفه', 'التكلفه', 'الكلفه', 'تكلفه', 'كلفه', 'الشراء', 'شراء', 'cost', 'purchase price', 'buy price', 'cost price'] },
  { k: 'openQty', t: 'الكمية الافتتاحية', num: true, syn: ['كميه', 'الكميه', 'الكميه الافتتاحيه', 'الرصيد', 'رصيد', 'المخزون', 'qty', 'quantity', 'stock', 'on hand', 'opening qty'] },
  { k: 'reorder', t: 'حد إعادة الطلب', num: true, syn: ['حد الطلب', 'حد اعاده الطلب', 'الحد الادني', 'reorder', 'reorder level', 'min', 'minimum'] },
  { k: 'tax', t: 'الضريبة (خاضع / صفري / معفى)', syn: ['ضريبه', 'الضريبه', 'tax', 'vat', 'tax category'] },
];
const partyFields = (kind) => [
  { k: 'name', t: 'الاسم', req: true, syn: ['اسم', 'الاسم', kind === 'customer' ? 'اسم العميل' : 'اسم المورد', kind === 'customer' ? 'العميل' : 'المورد', 'name', kind === 'customer' ? 'customer' : 'supplier', 'company'] },
  { k: 'nameEn', t: 'الاسم بالإنجليزي', syn: ['الاسم بالانجليزي', 'اسم انجليزي', 'english name', 'name en'] },
  { k: 'phone', t: 'الجوال', syn: ['جوال', 'الجوال', 'هاتف', 'الهاتف', 'رقم الجوال', 'موبايل', 'phone', 'mobile', 'tel', 'telephone', 'whatsapp'] },
  { k: 'email', t: 'البريد الإلكتروني', syn: ['بريد', 'البريد', 'البريد الالكتروني', 'ايميل', 'email', 'e-mail', 'mail'] },
  { k: 'vatNo', t: 'الرقم الضريبي', syn: ['رقم ضريبي', 'الرقم الضريبي', 'الرقم الضريبي للعميل', 'vat', 'vat no', 'vat number', 'tax number', 'trn'] },
  { k: 'crNo', t: 'السجل التجاري', syn: ['سجل تجاري', 'السجل التجاري', 'cr', 'cr no', 'commercial register'] },
  { k: 'address', t: 'العنوان', syn: ['عنوان', 'العنوان', 'المدينه', 'address', 'city'] },
  { k: 'opening', t: kind === 'customer' ? 'الرصيد الافتتاحي (عليه لكم)' : 'الرصيد الافتتاحي (له عليكم)', num: true, syn: ['رصيد', 'الرصيد', 'الرصيد الافتتاحي', 'رصيد افتتاحي', 'balance', 'opening', 'opening balance'] },
  { k: 'notes', t: 'ملاحظات', syn: ['ملاحظات', 'ملاحظه', 'notes', 'note', 'remarks'] },
];

export const IMPORT_TYPES = {
  products: { name: 'المنتجات والخدمات', one: 'منتج', fields: PRODUCT_FIELDS, list: '#/products' },
  customers: { name: 'العملاء', one: 'عميل', kind: 'customer', fields: partyFields('customer'), list: '#/customers' },
  suppliers: { name: 'الموردون', one: 'مورد', kind: 'supplier', fields: partyFields('supplier'), list: '#/suppliers' },
};

// ═══ التعرّف على الأعمدة: من العناوين أولاً، ثم من محتوى الأعمدة نفسها ═══
// درجة تطابق عنوان مع حقل: تطابق كامل (والأقدم في قائمة المرادفات أقوى) ثم احتواء كلمة مميّزة
const keysOf = (f) => (f._keys || (f._keys = [f.t, ...f.syn].map(normKey)));
export function headerScore(f, h) {
  if (!h) return 0;
  const keys = keysOf(f);
  const i = keys.indexOf(h);
  if (i >= 0) return 200 - Math.min(i, 60);
  let best = 0;
  keys.forEach((k, j) => { if (k.length >= 3 && h.includes(k)) best = Math.max(best, 100 + Math.min(k.length, 20) - Math.min(j, 40) / 4); });
  return best;
}

// تعيين حريص: أعلى الدرجات أولاً، حقل واحد لكل عمود وعمود واحد لكل حقل
function assignByHeaders(headers, fields) {
  const keys = headers.map(normKey);
  const cands = [];
  for (const f of fields) keys.forEach((h, j) => { const sc = headerScore(f, h); if (sc >= 100) cands.push({ f: f.k, j, sc }); });
  cands.sort((a, b) => b.sc - a.sc || a.j - b.j);
  const map = {}; const used = new Set();
  for (const c of cands) if (map[c.f] == null && !used.has(c.j)) { map[c.f] = c.j; used.add(c.j); }
  return map;
}

// يحدد عمود كل حقل من عناوين الصف الأول (للتوافق مع الاستعمالات القديمة)
export function guessMapping(headers, type) {
  return assignByHeaders(headers, IMPORT_TYPES[type].fields);
}

// رقم من خلية: يقبل الأرقام العربية والفواصل ورموز العملة، وNaN إن لم تكن رقماً
const CURRENCY = /(د\.?\s?[أا]|دينار|ريال|درهم|جنيه|ر\.?\s?س|sar|jod|usd|aed|egp|kd|\$|€|£)/gi;
export function asNumber(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
  const s = String(v ?? '').replace(CURRENCY, '').replace(/[\s ]/g, '');
  if (!s || !/^[-+]?[\d٠-٩۰-۹]+(?:[.,٫٬][\d٠-٩۰-۹]+)*%?$/.test(s)) return NaN;
  const t = s.replace(/%$/, '');
  // فاصلة وحيدة بعدها رقم أو رقمان = فاصلة عشرية («0,25» و«12,5»)؛ غير ذلك الفاصلة للآلاف («1,250»)
  return num(/^[-+]?[\d٠-٩۰-۹]+,[\d٠-٩۰-۹]{1,2}$/.test(t) ? t.replace(',', '.') : t);
}

// بصمة عمود من أول 400 قيمة: نسبة الأرقام، نسبة التنوع، متوسط الطول، هل يشبه الباركود، والوسيط
export function profileColumn(data, col) {
  const vals = [];
  for (let i = 0; i < data.length && vals.length < 400; i++) { const v = data[i] && data[i][col]; if (String(v ?? '').trim() !== '') vals.push(v); }
  const n = vals.length;
  if (!n) return { n: 0, numeric: 0, unique: 0, uniqueCount: 0, avgLen: 0, barcode: false, median: 0 };
  const nums = []; const uniq = new Set(); let len = 0; let codes = 0;
  for (const v of vals) {
    const t = String(v).trim();
    len += t.length;
    uniq.add(normKey(t) || t);
    const x = asNumber(v);
    if (!Number.isNaN(x)) nums.push(x);
    if (/^\d{8,14}$/.test(t.replace(/\.0+$/, ''))) codes++;
  }
  nums.sort((a, b) => a - b);
  return { n, numeric: nums.length / n, unique: uniq.size / n, uniqueCount: uniq.size, avgLen: len / n, barcode: codes / n >= 0.8 && uniq.size / n >= 0.9, median: nums.length ? nums[Math.floor(nums.length / 2)] : 0 };
}

// أي صف هو صف العناوين؟ (قد تسبقه عناوين للجدول أو أسطر فارغة). -1 إن بدا الملف بلا عناوين
export function findHeaderRow(rows, type) {
  const fields = IMPORT_TYPES[type].fields;
  let best = -1; let bestHits = 0;
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const cells = (rows[i] || []).map((c) => String(c ?? '').trim());
    if (cells.filter(Boolean).length < 2) continue;
    let hits = 0;
    for (const h of cells) { const k = normKey(h); if (k && fields.some((f) => headerScore(f, k) >= 100)) hits++; }
    if (hits > bestHits) { best = i; bestHits = hits; }
  }
  if (bestHits > 0) return best;
  // لا عنوان معروف: الصف الأول بيانات إن كان نصفه أرقاماً أو باركوداً (مثل «6291003000011 | 12.5»)
  const first = (rows.find((r) => (r || []).some((c) => String(c ?? '').trim() !== '')) || []).filter((c) => String(c ?? '').trim() !== '');
  const nums = first.filter((c) => !Number.isNaN(asNumber(c))).length;
  return first.length >= 2 && nums / first.length >= 0.5 ? -1 : rows.findIndex((r) => (r || []).some((c) => String(c ?? '').trim() !== ''));
}

// يحلل الجدول كاملاً: صف العناوين، تعيين الأعمدة (من العناوين ثم من المحتوى)، وملاحظات للمستخدم
// rows: كل صفوف الورقة كما قُرئت (بما فيها الفارغة حتى تبقى أرقام الأسطر مطابقة لـExcel)
export function analyzeTable(rows, type, { headerRow } = {}) {
  const T = IMPORT_TYPES[type];
  const isProd = type === 'products';
  const hr = headerRow != null ? headerRow : findHeaderRow(rows, type);
  const width = rows.reduce((m, r) => Math.max(m, (r || []).length), 0);
  const headers = Array.from({ length: width }, (_, i) => (hr >= 0 ? String(((rows[hr] || [])[i]) ?? '').trim() : '') || `عمود ${i + 1}`);
  const first = hr + 1;
  const data = rows.slice(first);
  const rowNos = data.map((_, i) => first + i + 1);
  const mapping = assignByHeaders(hr >= 0 ? headers.map((h, i) => (h === `عمود ${i + 1}` ? '' : h)) : [], T.fields);
  const how = Object.fromEntries(Object.keys(mapping).map((k) => [k, 'header']));
  const notes = [];
  const prof = headers.map((_, i) => profileColumn(data, i));
  const used = () => new Set(Object.values(mapping));
  const drop = (k) => { delete mapping[k]; delete how[k]; };

  // عنوان يقول «سعر» لكن محتواه نصوص (أو العكس): نثق بالمحتوى
  for (const f of T.fields) {
    const j = mapping[f.k];
    if (j == null || !prof[j].n) continue;
    if (f.num && prof[j].numeric < 0.5) { notes.push(`عمود «${headers[j]}» لا يبدو أرقاماً فلم أستعمله لـ«${f.t}»`); drop(f.k); }
    else if (f.k === 'name' && prof[j].numeric > 0.8) { notes.push(`عمود «${headers[j]}» أرقام فقط فلم أستعمله اسماً`); drop(f.k); }
  }

  if (isProd) {
    // الصنف والمادة معاً: العمود الأقل تنوعاً (قيم مكررة) هو التصنيف والأكثر تنوعاً هو الاسم، بغض النظر عن العنوان
    if (mapping.name != null && mapping.category != null) {
      const a = prof[mapping.name]; const b = prof[mapping.category];
      if (a.n && b.n && a.unique < 0.4 && b.unique > 0.7 && b.unique > a.unique + 0.3) {
        [mapping.name, mapping.category] = [mapping.category, mapping.name];
        how.name = how.category = 'content';
        notes.push(`بدّلتُ بين «${headers[mapping.category]}» و«${headers[mapping.name]}»: الأول قيمه متكررة (تصنيف) والثاني أسماء متنوعة`);
      }
    }
  }

  // تعبئة الحقول الناقصة من محتوى الأعمدة غير المستعملة
  const free = () => headers.map((_, i) => i).filter((i) => !used().has(i) && prof[i].n > 0);
  const textual = (i) => prof[i].numeric < 0.3 && !prof[i].barcode;
  if (isProd) {
    if (mapping.barcode == null) { const i = free().find((c) => prof[c].barcode); if (i != null) { mapping.barcode = i; how.barcode = 'content'; } }
    if (mapping.name == null) {
      const t = free().filter(textual).sort((a, b) => prof[b].unique - prof[a].unique || prof[b].avgLen - prof[a].avgLen)[0];
      if (t != null && prof[t].unique >= 0.5) { mapping.name = t; how.name = 'content'; }
    }
    if (mapping.category == null && mapping.name != null) {
      const t = free().filter(textual).find((c) => prof[c].uniqueCount >= 2 && prof[c].unique <= 0.45 && prof[c].avgLen <= 40);
      if (t != null) { mapping.category = t; how.category = 'content'; }
    }
    const nums = free().filter((c) => prof[c].numeric >= 0.8 && !prof[c].barcode).sort((a, b) => prof[a].median - prof[b].median);
    if (mapping.price == null && mapping.cost == null && nums.length >= 2 && prof[nums[0]].median <= prof[nums[1]].median) {
      mapping.cost = nums[0]; mapping.price = nums[1]; how.cost = how.price = 'content';
      notes.push(`عمودا الأرقام بلا عناوين واضحة: اعتبرتُ الأقل «سعر الشراء» والأعلى «سعر البيع». راجعهما`);
    } else if (mapping.price == null && nums.length >= 1 && mapping.cost == null) { mapping.price = nums[0]; how.price = 'content'; }
    else if (mapping.price == null && mapping.cost != null) { const c = nums.find((x) => prof[x].median >= prof[mapping.cost].median); if (c != null) { mapping.price = c; how.price = 'content'; } }
    else if (mapping.cost == null && mapping.price != null) { const c = nums.find((x) => prof[x].median <= prof[mapping.price].median); if (c != null) { mapping.cost = c; how.cost = 'content'; } }
    if (mapping.price != null && mapping.cost != null && prof[mapping.price].n && prof[mapping.cost].n && prof[mapping.cost].median > prof[mapping.price].median) {
      notes.push('سعر الشراء أعلى من سعر البيع في أغلب الصفوف: تأكد أن عمودي السعرين في مكانهما الصحيح');
    }
  } else {
    if (mapping.name == null) {
      const t = free().filter(textual).sort((a, b) => prof[b].unique - prof[a].unique)[0];
      if (t != null && prof[t].unique >= 0.5) { mapping.name = t; how.name = 'content'; }
    }
  }
  return { headerRow: hr, headers, data, rowNos, mapping, how, notes };
}

// طول رقم الجوال بدون الصفر الأول في الدول التي تكتبه
const TRUNK = { SA: 9, AE: 9, JO: 9, EG: 10, IQ: 10 };
const cell = (row, i) => (i == null || i < 0 ? '' : String(row[i] ?? '').trim());
const digits = (s) => String(s || '').replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 1632)).replace(/\D/g, '');
const phoneKey = (s) => { const d = digits(s); return d.length >= 7 ? d.slice(-9) : ''; };
const nameKey = (s) => normKey(s);

function parseType(v) {
  const k = normKey(v);
  if (!k) return '';
  return /خدم|service|srv/.test(k) ? 'service' : 'stock';
}
function parseTax(v) {
  const k = normKey(v);
  if (!k) return '';
  if (/معف|exempt|^e$/.test(k)) return 'E';
  if (/خارج|out|^o$/.test(k)) return 'O';
  if (/صفر|zero|^z$|^0%?$/.test(k)) return 'Z';
  return 'S';
}
// الأرقام من Excel قد تأتي نصاً فيه عملة أو فواصل
const numOrBlank = (v) => {
  if (v === '') return '';
  const x = asNumber(v);
  if (!Number.isNaN(x)) return x;
  const clean = String(v).replace(/[^\d٠-٩۰-۹.,٫\-]/g, ''); // نص فيه وحدة بعد الرقم («25 حبة»)
  return clean === '' ? '' : num(clean);
};

// يحوّل الصفوف إلى سجلات جاهزة، مع المطابقة والأخطاء
// النتيجة: [{ row, rec, match, action: 'new'|'update'|'error', errors: [] , notes: [] }]
export function buildRecords(rows, mapping, type, db, { rowNos } = {}) {
  const T = IMPORT_TYPES[type];
  const isProd = type === 'products';
  const existing = isProd ? db.products : db.parties.filter((p) => p.kind === T.kind);
  const byBarcode = new Map(), bySku = new Map(), byName = new Map(), byPhone = new Map(), byVat = new Map();
  for (const x of existing) {
    if (isProd) {
      if (x.barcode) byBarcode.set(String(x.barcode), x);
      if (x.sku) bySku.set(String(x.sku).toLowerCase(), x);
    } else {
      if (phoneKey(x.phone)) byPhone.set(phoneKey(x.phone), x);
      if (x.vatNo) byVat.set(digits(x.vatNo), x);
    }
    byName.set(nameKey(x.name), x);
  }
  const seen = new Map();
  const out = [];
  rows.forEach((row, idx) => {
    const v = {};
    for (const f of T.fields) v[f.k] = f.num ? numOrBlank(cell(row, mapping[f.k])) : cell(row, mapping[f.k]);
    if (T.fields.every((f) => v[f.k] === '' || v[f.k] == null)) return;
    const errors = [];
    const notes = [];
    if (!v.name) errors.push('الاسم فارغ');
    let match = null;
    if (isProd) {
      if (v.barcode) {
        v.barcode = String(v.barcode).replace(/\.0+$/, '').trim();
        if (!isEan13(v.barcode) && !code128Supported(v.barcode)) errors.push('الباركود أرقام وحروف لاتينية فقط');
      }
      match = (v.barcode && byBarcode.get(v.barcode)) || (v.sku && bySku.get(String(v.sku).toLowerCase())) || (v.name && byName.get(nameKey(v.name))) || null;
      for (const k of ['price', 'cost', 'openQty', 'reorder']) if (v[k] !== '' && v[k] < 0) errors.push('قيمة سالبة في ' + T.fields.find((f) => f.k === k).t);
      if (v.barcode && byBarcode.get(v.barcode) && match && byBarcode.get(v.barcode).id !== match.id) errors.push('الباركود مستخدم لمنتج آخر');
    } else {
      match = (v.vatNo && byVat.get(digits(v.vatNo))) || (phoneKey(v.phone) && byPhone.get(phoneKey(v.phone))) || (v.name && byName.get(nameKey(v.name))) || null;
      if (v.email && !/^\S+@\S+\.\S+$/.test(v.email)) errors.push('البريد الإلكتروني غير صحيح');
    }
    // التكرار داخل الملف نفسه
    const key = isProd ? (v.barcode || (v.sku && 'sku:' + String(v.sku).toLowerCase()) || 'n:' + nameKey(v.name)) : (phoneKey(v.phone) || 'n:' + nameKey(v.name));
    if (v.name && seen.has(key)) errors.push(`مكرر في الملف (السطر ${rowNos ? rowNos[seen.get(key)] : seen.get(key) + 2})`);
    else if (v.name) seen.set(key, idx);

    const rec = {};
    if (isProd) {
      rec.name = v.name;
      for (const k of ['nameEn', 'barcode', 'sku', 'category', 'unit']) if (v[k] !== '') rec[k] = v[k];
      const ty = parseType(v.type);
      if (ty) rec.type = ty;
      const tx = parseTax(v.tax);
      if (tx) rec.tax = tx;
      for (const k of ['price', 'cost', 'reorder']) if (v[k] !== '') rec[k] = round(v[k], 4);
      if (match) {
        if (v.openQty !== '' && round(v.openQty, 3) !== round(num(match.openQty), 3)) notes.push('الكمية لا تتغير للمنتجات الموجودة (استخدم تسوية المخزون)');
      } else {
        rec.type = rec.type || 'stock';
        rec.openQty = rec.type === 'stock' && v.openQty !== '' ? round(v.openQty, 3) : 0;
        rec.openCost = num(rec.cost);
        if (rec.openQty && !rec.openCost) notes.push('بدون تكلفة: الكمية الافتتاحية ستُقيَّم بصفر');
        Object.assign(rec, { price: rec.price ?? 0, cost: rec.cost ?? 0, reorder: rec.reorder ?? 0, tax: rec.tax || 'S', unit: rec.unit || '', sku: rec.sku || '', barcode: rec.barcode || '', active: true });
      }
    } else {
      rec.name = v.name;
      for (const k of ['nameEn', 'phone', 'email', 'crNo', 'address', 'notes']) if (v[k] !== '') rec[k] = String(v[k]);
      // Excel يحذف الصفر الأول من أرقام الجوال المخزنة كأرقام
      const raw = mapping.phone != null ? row[mapping.phone] : '';
      const trunk = TRUNK[db.settings?.country];
      if (typeof raw === 'number' && trunk && digits(raw).length === trunk) rec.phone = '0' + digits(raw);
      if (v.vatNo !== '') rec.vatNo = digits(v.vatNo) || String(v.vatNo);
      if (match) {
        if (v.opening !== '' && round(v.opening, 4) !== round(num(match.opening), 4)) notes.push('الرصيد الافتتاحي لا يتغير للموجودين');
      } else {
        rec.kind = T.kind;
        rec.opening = v.opening === '' ? 0 : round(v.opening, 4);
        for (const k of ['phone', 'email', 'vatNo', 'crNo', 'address', 'notes']) rec[k] = rec[k] || '';
      }
    }
    if (match) rec.id = match.id;
    if (isProd && rec.price > 0 && rec.cost > 0 && rec.price < rec.cost) notes.push('سعر البيع أقل من سعر الشراء (خسارة)');
    out.push({ row: rowNos ? rowNos[idx] : idx + 2, rec, match, action: errors.length ? 'error' : match ? 'update' : 'new', errors, notes });
  });
  return out;
}

// قالب فارغ مع مثال، للتنزيل
export function templateRows(type) {
  const T = IMPORT_TYPES[type];
  const head = T.fields.map((f) => f.t);
  const ex = type === 'products'
    ? { name: 'شاحن سريع 20 واط', nameEn: 'Fast Charger 20W', barcode: '', sku: 'CH-20', category: 'إكسسوارات', type: 'منتج', unit: 'حبة', price: 45, cost: 28, openQty: 10, reorder: 3, tax: 'خاضع' }
    : { name: type === 'customers' ? 'مؤسسة الريادة التجارية' : 'شركة التوريدات المتحدة', nameEn: '', phone: '0500000001', email: '', vatNo: '', crNo: '', address: 'الرياض', opening: 0, notes: '' };
  return [head, T.fields.map((f) => ex[f.k] ?? '')];
}

// ═══ كشف حساب البنك: قراءة الأعمدة والمطابقة التلقائية مع الحركات ═══
const DATE_KEYS = ['تاريخ', 'التاريخ', 'تاريخ العمليه', 'تاريخ القيد', 'تاريخ الحركه', 'date', 'value date', 'posting date', 'transaction date'];
const DEBIT_KEYS = ['مدين', 'سحب', 'مسحوبات', 'المبلغ المدين', 'خصم', 'debit', 'withdrawal', 'withdrawals', 'dr'];
const CREDIT_KEYS = ['دائن', 'ايداع', 'ايداعات', 'المبلغ الدائن', 'اضافه', 'credit', 'deposit', 'deposits', 'cr'];
const AMOUNT_KEYS = ['المبلغ', 'مبلغ', 'القيمه', 'amount', 'value'];
const DESC_KEYS = ['البيان', 'الوصف', 'التفاصيل', 'بيان', 'description', 'details', 'narration', 'memo', 'reference'];
const findCol = (keys, heads) => heads.findIndex((h) => h && keys.map(normKey).some((k) => h === k || (k.length > 2 && h.includes(k))));

// التاريخ من Excel (رقم تسلسلي) أو نص بصيغ شائعة → YYYY-MM-DD
export function parseDate(v) {
  if (typeof v === 'number' && v > 20000 && v < 80000) return new Date(Math.round((v - 25569) * 864e5)).toISOString().slice(0, 10);
  const s = String(v ?? '').trim().replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 1632));
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return '';
}

// rows: صفوف الملف كما قُرئت؛ النتيجة: [{ date, amount, desc }] حيث الموجب إيداع والسالب سحب
export function parseStatement(rows) {
  let hi = -1, cols = null;
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const heads = rows[i].map(normKey);
    const date = findCol(DATE_KEYS, heads);
    const debit = findCol(DEBIT_KEYS, heads), credit = findCol(CREDIT_KEYS, heads), amount = findCol(AMOUNT_KEYS, heads);
    if (date >= 0 && (amount >= 0 || (debit >= 0 && credit >= 0))) { hi = i; cols = { date, debit, credit, amount, desc: findCol(DESC_KEYS, heads) }; break; }
  }
  if (!cols) return { rows: [], error: 'لم أجد أعمدة التاريخ والمبلغ (أو مدين ودائن) في الملف' };
  const out = [];
  for (const r of rows.slice(hi + 1)) {
    const date = parseDate(r[cols.date]);
    if (!date) continue;
    const n = (x) => { const v = numOrBlank(cell([x], 0)); return v === '' ? 0 : v; };
    const amount = cols.debit >= 0 && cols.credit >= 0 ? round(n(r[cols.credit]) - n(r[cols.debit]), 2) : round(n(r[cols.amount]), 2);
    if (!amount) continue;
    out.push({ date, amount, desc: cols.desc >= 0 ? String(r[cols.desc] ?? '').trim() : '' });
  }
  return { rows: out, error: out.length ? '' : 'لا توجد حركات بتاريخ ومبلغ في الملف' };
}

// مطابقة كل سطر في الكشف مع حركة غير مطابقة بنفس المبلغ وأقرب تاريخ (±days)
export function matchStatement(stmt, items, { days = 5 } = {}) {
  const used = new Set();
  const matches = new Map();
  const unmatched = [];
  const dayNo = (d) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 864e5;
  stmt.forEach((r, i) => {
    let best = null, gap = Infinity;
    for (const it of items) {
      if (used.has(it.pk) || Math.abs(it.amount - r.amount) > 0.005) continue;
      const g = Math.abs(dayNo(it.date) - dayNo(r.date));
      if (g <= days && g < gap) { best = it; gap = g; }
    }
    if (best) { used.add(best.pk); matches.set(i, best.pk); } else unmatched.push(i);
  });
  return { matches, unmatched };
}
