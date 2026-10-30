// ═══ ملخص اليوم: أرقام الفترة من الدفاتر بدقة، ثم كلام عربي بسيط للقراءة أو للسماع ═══
// بلا DOM وبلا إنترنت: كل شيء يُحسب على الجهاز من نفس الدفاتر، فالأرقام دائماً مطابقة للتقارير.
import {
  incomeStatement, salesAnalysis, stockReport, moneyAccounts, paymentList, currencyInfo, isPdc,
  addDays, daysBetween, monthStart, ymd, round, num, dashboard,
} from './core.js';

// ─── الفترات ───
export const PERIODS = {
  today: { label: 'اليوم', prevLabel: 'أمس', when: 'اليوم' },
  yesterday: { label: 'أمس', prevLabel: 'قبل أمس', when: 'أمس' },
  week: { label: 'آخر 7 أيام', prevLabel: 'الأسبوع اللي قبله', when: 'بآخر 7 أيام' },
  month: { label: 'هذا الشهر', prevLabel: 'الفترة اللي قبله', when: 'هذا الشهر لحد اليوم' },
};

// الفترة والفترة السابقة بنفس الطول للمقارنة
export function rangeOf(preset, today) {
  const key = PERIODS[preset] ? preset : 'today';
  let from = today, to = today;
  if (key === 'yesterday') from = to = addDays(today, -1);
  else if (key === 'week') from = addDays(today, -6);
  else if (key === 'month') from = monthStart(today);
  const days = daysBetween(from, to) + 1;
  return { key, from, to, days, prev: { from: addDays(from, -days), to: addDays(from, -1) }, ...PERIODS[key] };
}

const inRange = (d, from, to) => d >= from && d <= to;
const localDay = (iso) => { const t = new Date(iso); return Number.isNaN(t.getTime()) ? '' : ymd(t); };

// مبيعات الفترة بالأرقام: بالإجمالي شاملاً الضريبة، والصافي قبل الضريبة بعد المرتجعات
function salesOf(db, B, from, to) {
  const dec = B.dec;
  const R = (x) => round(x, dec);
  // الفاتورة الملغاة بإشعار دائن وإشعارها لا يُعدّان مبيعة ومرتجعاً في الملخص (صافيهما صفر)
  const voided = new Set(B.cancelled ? [...B.cancelled.keys(), ...B.cancelled.values()] : []);
  const docs = (db.docs || []).filter((d) => d.type === 'sale' && inRange(d.date, from, to) && !voided.has(d.id));
  const rets = (db.docs || []).filter((d) => d.type === 'sreturn' && inRange(d.date, from, to) && !voided.has(d.id));
  const totalOf = (d) => (B.totals.get(d.id) || { total: 0 }).total;
  const gross = R(docs.reduce((s, d) => s + totalOf(d), 0));
  const returns = R(rets.reduce((s, d) => s + totalOf(d), 0));
  // كيف دفع الزبائن عند البيع: لكل حساب، والباقي آجل
  const byAcc = new Map();
  let paid = 0;
  for (const d of docs) {
    let left = totalOf(d);
    for (const p of paymentList(d)) {
      const a = Math.min(num(p.amount), left);
      if (a <= 0 || !p.acc) continue;
      byAcc.set(p.acc, (byAcc.get(p.acc) || 0) + a);
      left = R(left - a);
      paid += a;
    }
  }
  const accName = (id) => (db.accounts || []).find((a) => a.id === id)?.name || id;
  const mix = [...byAcc].map(([acc, amount]) => ({ acc, name: accName(acc), amount: R(amount) })).sort((a, b) => b.amount - a.amount);
  const credit = Math.max(0, R(gross - R(paid)));
  return { count: docs.length, gross, avg: docs.length ? R(gross / docs.length) : 0, returnsCount: rets.length, returns: returns, total: R(gross - returns), mix, credit };
}

// ─── أرقام الفترة ───
export function summaryFacts(db, B, { preset = 'today', today = ymd() } = {}) {
  const dec = B.dec;
  const R = (x) => round(x, dec);
  const range = rangeOf(preset, today);
  const { from, to } = range;
  const sales = salesOf(db, B, from, to);
  const before = salesOf(db, B, range.prev.from, range.prev.to);
  const sa = salesAnalysis(db, B, { from, to });
  const is = incomeStatement(db, B, { from, to });

  const top = sa.products.filter((p) => p.qty > 0).slice(0, 3).map((p) => ({ name: p.name, qty: p.qty, net: p.net, unit: p.product?.unit || '' }));
  const expenses = {
    total: is.totalExpenses,
    top: [...is.expenses].sort((a, b) => b.amount - a.amount).filter((r) => r.amount > 0).slice(0, 2).map((r) => ({ name: r.account.name, amount: r.amount })),
  };
  const profit = { sales: sa.profit, margin: sa.net ? round(sa.profit / sa.net * 100, 1) : 0, expenses: is.totalExpenses, net: is.net, netSales: sa.net };

  // حركة الصندوق والبنوك بدون التحويلات الداخلية والأرصدة الافتتاحية
  const money = moneyAccounts(db);
  const ids = new Set(money.map((a) => a.id));
  let inn = 0, out = 0;
  for (const p of B.postings) {
    if (!ids.has(p.acc) || !inRange(p.date, from, to) || p.type === 'transfer' || p.type === 'opening') continue;
    inn += p.dr; out += p.cr;
  }
  let balance = 0, cash = 0;
  for (const p of B.postings) {
    if (!ids.has(p.acc) || p.date > to) continue;
    balance += p.dr - p.cr;
    if (p.acc === 'cash') cash += p.dr - p.cr;
  }
  const cashFlow = { in: R(inn), out: R(out), net: R(inn - out), balance: R(balance), cash: R(cash) };

  const counted = (type, ok = () => true) => {
    const ds = (db.docs || []).filter((d) => d.type === type && inRange(d.date, from, to) && ok(d));
    return { count: ds.length, total: R(ds.reduce((s, d) => s + num(d.amount), 0)) };
  };
  const kindOf = (d) => (db.parties || []).find((p) => p.id === d.party)?.kind;
  const collected = counted('receipt', (d) => !isPdc(d) && kindOf(d) === 'customer');
  const paidOut = counted('payment', (d) => !isPdc(d) && kindOf(d) === 'supplier');
  const newCustomers = (db.parties || []).filter((p) => p.kind === 'customer' && p.createdAt && inRange(localDay(p.createdAt), from, to)).length;

  // ما يحتاج انتباهاً الآن (بغض النظر عن الفترة)
  const D = dashboard(db, B, today);
  const owed = new Map();
  for (const d of D.overdue) owed.set(d.party, (owed.get(d.party) || 0) + (B.status.get(d.id)?.due || 0));
  const nameOf = (id) => (db.parties || []).find((p) => p.id === id)?.name || 'عميل';
  const overdue = {
    count: D.overdue.length,
    total: R(D.overdue.reduce((s, d) => s + (B.status.get(d.id)?.due || 0), 0)),
    top: [...owed].map(([id, amount]) => ({ name: nameOf(id), amount: R(amount) })).sort((a, b) => b.amount - a.amount).slice(0, 2),
  };
  const low = stockReport(db, B).rows.filter((r) => r.low).map((r) => ({ name: r.product.name, qty: Number(r.qty.toFixed(3)), unit: r.product.unit || '' }));
  const cheques = (db.docs || []).filter((d) => isPdc(d) && !d.cleared && !d.bounced && d.chequeDue && d.chequeDue <= addDays(today, 7))
    .sort((a, b) => a.chequeDue.localeCompare(b.chequeDue))
    .map((d) => ({ incoming: d.type === 'receipt', amount: R(num(d.amount)), party: (db.parties || []).find((p) => p.id === d.party)?.name || '', days: daysBetween(today, d.chequeDue) }));
  const since = db.settings?.lastBackupAt ? Math.floor((Date.parse(today + 'T12:00:00') - Date.parse(db.settings.lastBackupAt)) / 864e5) : null;
  const attention = {
    overdue, low, cheques,
    vat: db.settings?.vat && D.vatDue > 0 ? D.vatDue : 0,
    issues: (B.issues || []).length,
    backupDays: (db.docs || []).length > 0 && (since == null || since >= 7) ? (since == null ? -1 : since) : null,
  };

  const active = sales.count + sales.returnsCount + expenses.total + collected.count + paidOut.count > 0
    || cashFlow.in > 0 || cashFlow.out > 0;
  return {
    range, currency: db.settings?.currency, country: db.settings?.country, dec,
    sales, before, top, profit, expenses, cashFlow, collected, paid: paidOut, newCustomers, attention, active,
  };
}

// ─── الكلام ───
const WEEKDAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
export const dayName = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return `${WEEKDAYS[new Date(y, m - 1, d).getDay()]} ${d} ${MONTHS[m - 1]}`;
};
const countAr = (n, [one, two, few, many]) => (n === 1 ? one : n === 2 ? two : n <= 10 ? `${n} ${few}` : `${n} ${many}`);
const INVOICES = ['فاتورة وحدة', 'فاتورتين', 'فواتير', 'فاتورة'];
const DOCS = ['سند واحد', 'سندين', 'سندات', 'سند'];
const DAYS = ['يوم', 'يومين', 'أيام', 'يوم'];

const grouped = (v, dec) => Number(v).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });

// للعرض: «150.500 د.أ»، وللسماع: «150 دينار و500 فلس»
export function makeFormat(currency, mode = 'text') {
  const c = currencyInfo(currency);
  const unit = c.name.split(' ')[0];
  if (mode === 'text') return (v) => `${grouped(v, c.dec)} ${c.sym}`;
  return (v) => {
    const a = round(Math.abs(num(v)), c.dec);
    const whole = Math.floor(a);
    const frac = Math.round((a - whole) * 10 ** c.dec);
    const sign = num(v) < 0 ? 'ناقص ' : '';
    if (!frac || !c.sub) return `${sign}${whole} ${unit}`;
    return whole ? `${sign}${whole} ${unit} و${frac} ${c.sub}` : `${sign}${frac} ${c.sub}`;
  };
}

// الفرق عن الفترة السابقة بكلمات
function versus(now, was, range, m) {
  if (!was) return now ? `وما كان في مبيعات ${range.prevLabel}.` : '';
  const pct = (now - was) / was * 100;
  if (Math.abs(pct) < 3) return `وهاد قريب من ${range.prevLabel}.`;
  if (pct < 0 && range.key === 'today') return `و${range.prevLabel} كان الإجمالي ${m(was)}، واليوم لسّا ما خلص.`;
  if (pct >= 300) return `وهاد أكتر بكتير من ${range.prevLabel}.`;
  const n = Math.round(Math.abs(pct));
  return pct > 0 ? `وهاد أكتر من ${range.prevLabel} بنسبة ${n}%.` : `وهاد أقل من ${range.prevLabel} بنسبة ${n}%.`;
}

// الوحدات الشائعة: مفرد، مثنى، جمع (3-10)، وبعد العشرة
const UNITS = {
  'حبة': ['حبة', 'حبتين', 'حبات', 'حبة'], 'علبة': ['علبة', 'علبتين', 'علب', 'علبة'], 'قطعة': ['قطعة', 'قطعتين', 'قطع', 'قطعة'],
  'خدمة': ['خدمة', 'خدمتين', 'خدمات', 'خدمة'], 'مشوار': ['مشوار', 'مشوارين', 'مشاوير', 'مشوار'], 'كرتونة': ['كرتونة', 'كرتونتين', 'كراتين', 'كرتونة'],
  'عبوة': ['عبوة', 'عبوتين', 'عبوات', 'عبوة'], 'زوج': ['زوج', 'زوجين', 'أزواج', 'زوج'], 'طقم': ['طقم', 'طقمين', 'أطقم', 'طقم'],
};
const withUnit = (q, unit) => {
  const forms = UNITS[unit];
  if (forms && Number.isInteger(q)) return q === 1 ? forms[0] : q === 2 ? forms[1] : q <= 10 ? `${q} ${forms[2]}` : `${q} ${forms[3]}`;
  return `${q}${unit ? ' ' + unit : ''}`;
};
const list = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join('، ')} و${xs.at(-1)}`);

// أقسام الملخص: كل قسم عنوان وأيقونة ونص، ورابط اختياري. mode: text للعرض، speech للسماع
export function narrate(f, mode = 'text') {
  const m = makeFormat(f.currency, mode);
  const r = f.range;
  const S = f.sales;
  const out = [];
  const add = (id, icon, title, text, extra = {}) => { if (text) out.push({ id, icon, title, text, ...extra }); };
  const authority = f.country === 'JO' ? 'الدائرة' : 'الهيئة';

  if (!f.active) {
    add('sales', '🛍️', 'المبيعات', `${r.when} ما في أي حركة مسجّلة.`);
  } else {
    if (S.count) {
      const avg = S.count > 1 ? `، بمتوسط ${m(S.avg)} للفاتورة` : '';
      add('sales', '🛍️', 'المبيعات',
        `${r.when} صار ${countAr(S.count, INVOICES)} بيع، إجماليها ${m(S.gross)} شامل الضريبة${avg}. ${versus(S.gross, f.before.gross, r, m)}`
        + (S.returnsCount ? ` ورجّعوا ${countAr(S.returnsCount, INVOICES)} بقيمة ${m(S.returns)}.` : ''), { href: '#/sales' });
    } else {
      add('sales', '🛍️', 'المبيعات', `${r.when} ما في فواتير بيع.${f.before.count ? ` ${r.prevLabel} كان في ${countAr(f.before.count, INVOICES)}.` : ''}`, { href: '#/sales' });
    }

    if (S.count) {
      const parts = S.mix.map((x) => `${x.name} ${m(x.amount)}`);
      if (S.credit > 0) parts.push(`آجل ${m(S.credit)}`);
      add('pay', '💵', 'كيف دفعوا', `${mode === 'speech' ? 'الدفع كان: ' : ''}${list(parts)}.`);
    }

    if (f.top.length) {
      add('top', '🏆', 'الأكثر مبيعاً', `${mode === 'speech' ? 'الأكثر مبيعاً: ' : ''}${list(f.top.map((p) => `${p.name} (${withUnit(p.qty, p.unit)})`))}.`, { href: '#/reports/sales' });
    }

    const P = f.profit;
    if (S.count || f.expenses.total) {
      const bits = [];
      if (S.count) bits.push(`ربح المبيعات بعد تكلفة البضاعة تقريباً ${m(P.sales)}${P.netSales ? ` (هامش ${Math.round(P.margin)}%)` : ''}`);
      if (f.expenses.total) {
        const tops = f.expenses.top.map((e) => `${e.name} ${m(e.amount)}`);
        bits.push(`${S.count ? 'ونزل' : 'نزل'} مصاريف ${m(f.expenses.total)}${tops.length ? `، أكبرها: ${list(tops)}` : ''}`);
      } else bits.push('وما نزل مصاريف');
      const net = f.expenses.total ? ` ${P.net >= 0 ? `فصار الصافي ربح ${m(P.net)}` : `فصار الصافي خسارة ${m(-P.net)}`}.` : '';
      add('profit', '📈', 'الربح والمصاريف', `${bits.join('، ')}.${net} الأرقام تقديرية والتكلفة بالمتوسط.`, { href: '#/reports/income' });
    }

    const C = f.cashFlow;
    if (C.in || C.out) {
      const moved = [C.in ? `دخل على الصندوق والبنوك ${m(C.in)}` : 'ما دخل شي على الصندوق والبنوك', C.out ? `وطلع ${m(C.out)}` : 'وما طلع شي'].join(' ');
      add('cash', '🏦', 'النقدية', `${moved}${C.in && C.out ? ` (${C.net >= 0 ? 'الصافي' : 'الصافي بالناقص'} ${m(Math.abs(C.net))})` : ''}. `
        + `الرصيد ${r.key === 'today' ? 'الآن' : 'بآخر الفترة'} ${m(C.balance)}${C.cash ? `، منه بالصندوق ${m(C.cash)}` : ''}.`, { href: '#/reports/cash' });
    } else {
      add('cash', '🏦', 'النقدية', `ما في حركة نقدية. الرصيد ${r.key === 'today' ? 'الآن' : 'بآخر الفترة'} ${m(C.balance)}.`, { href: '#/reports/cash' });
    }

    const dealings = [];
    if (f.collected.count) dealings.push(`حصّلتوا من العملاء ${countAr(f.collected.count, DOCS)} بقيمة ${m(f.collected.total)}`);
    if (f.paid.count) dealings.push(`وسدّدتوا للموردين ${countAr(f.paid.count, DOCS)} بقيمة ${m(f.paid.total)}`);
    if (f.newCustomers) dealings.push(`وانضاف ${f.newCustomers === 1 ? 'عميل جديد' : `${f.newCustomers} عملاء جدد`}`);
    if (dealings.length) add('dealings', '🤝', 'التحصيل والسداد', `${dealings.join('، ')}.`, { href: '#/collections' });
  }

  // انتبه: لا يرتبط بالفترة
  const A = f.attention;
  const warn = [];
  if (A.overdue.count) {
    const who = !A.overdue.top.length ? '' : A.overdue.count === 1 ? ` على ${A.overdue.top[0].name}` : `، أكبرها على ${list(A.overdue.top.map((t) => `${t.name} (${m(t.amount)})`))}`;
    warn.push({ text: `${countAr(A.overdue.count, ['فاتورة متأخرة وحدة', 'فاتورتين متأخرتين', 'فواتير متأخرة', 'فاتورة متأخرة'])} بمبلغ ${m(A.overdue.total)}${who}.`, href: '#/collections', go: 'افتح التحصيل' });
  }
  if (A.low.length) {
    const some = A.low.slice(0, 3).map((x) => `${x.name} (باقي ${x.qty === 0 ? 'صفر' : withUnit(x.qty, x.unit)})`);
    const more = A.low.length > 3 ? ` و${A.low.length - 3} غيرها` : '';
    warn.push({ text: `بضاعة قاربت تخلص: ${list(some)}${more}.`, href: '#/reports/stock', go: 'افتح المخزون' });
  }
  for (const c of A.cheques.slice(0, 2)) {
    const when = c.days < 0 ? `مرّ موعده من ${countAr(-c.days, DAYS)}` : c.days === 0 ? 'يستحق اليوم' : `يستحق بعد ${countAr(c.days, DAYS)}`;
    warn.push({ text: `شيك ${c.incoming ? 'وارد' : 'صادر'} بقيمة ${m(c.amount)}${c.party ? ` ${c.incoming ? 'من' : 'إلى'} ${c.party}` : ''} ${when}.`, href: '#/cheques', go: 'افتح الشيكات' });
  }
  if (A.vat) warn.push({ text: `الضريبة المستحقة لل${authority.slice(2)} لحد الآن ${m(A.vat)}.`, href: '#/reports/vat', go: 'افتح الإقرار' });
  if (A.issues) warn.push({ text: `في ${countAr(A.issues, ['ملاحظة وحدة', 'ملاحظتين', 'ملاحظات', 'ملاحظة'])} على القيود تحتاج مراجعة.`, href: '#/daybook', go: 'افتح اليومية' });
  if (A.backupDays != null) warn.push({ text: A.backupDays < 0 ? 'ما نزّلت نسخة احتياطية لحد الآن.' : `آخر نسخة احتياطية كانت قبل ${countAr(A.backupDays, DAYS)}.`, href: '#/settings', go: 'نزّل نسخة' });
  if (warn.length) out.push({ id: 'attention', icon: '⚠️', title: 'انتبه', text: warn.map((w) => w.text).join(' '), items: warn });
  else out.push({ id: 'attention', icon: '✅', title: 'انتبه', text: 'ما في شي يحتاج انتباه، كل شي ماشي تمام.', items: [] });
  return out;
}

// الجملة الأولى للبطاقة المختصرة على الصفحة الرئيسية
export function headline(f) {
  const s = narrate(f, 'text');
  return { sales: s.find((x) => x.id === 'sales')?.text || '', warnings: f.attention.overdue.count + f.attention.low.length + f.attention.cheques.length };
}

// نص السماع كاملاً بجمل قصيرة (المتصفح يقطع الجمل الطويلة جداً)
export function speechParts(f) {
  const secs = narrate(f, 'speech');
  const head = f.range.key === 'today' || f.range.key === 'yesterday'
    ? `ملخص يوم ${dayName(f.range.from)}.`
    : `ملخص ${f.range.label}، من ${dayName(f.range.from)} إلى ${dayName(f.range.to)}.`;
  const parts = [{ id: 'intro', text: head }];
  for (const s of secs) {
    const sentences = s.text.split(/(?<=[.؟!])\s+/).map((x) => x.trim()).filter(Boolean);
    sentences.forEach((t, i) => parts.push({ id: s.id, text: i === 0 && s.id === 'attention' && s.items?.length ? `انتبه. ${t}` : t }));
  }
  parts.push({ id: 'end', text: 'وبس. الله يعطيك العافية.' });
  return parts;
}

// نص واحد للمشاركة (واتساب)
export function shareText(f, shopName = '') {
  const lines = [`🗣️ ملخص ${f.range.key === 'today' || f.range.key === 'yesterday' ? 'يوم ' + dayName(f.range.from) : f.range.label}${shopName ? ' — ' + shopName : ''}`, ''];
  for (const s of narrate(f, 'text')) lines.push(`${s.icon} ${s.title}: ${s.text}`);
  return lines.join('\n');
}
