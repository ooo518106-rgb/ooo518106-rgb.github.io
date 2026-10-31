import { balances, moneyAccounts, accountMap, round } from './core.js';

export const CASH_FLOW_LABELS = Object.freeze({
  operating: 'الأنشطة التشغيلية', investing: 'الأنشطة الاستثمارية',
  financing: 'الأنشطة التمويلية', unclassified: 'حركات تحتاج تصنيفاً',
});

// تصنيف محافظ: القيد الذي يجمع أنشطة مختلفة يحتاج اختيار المستخدم.
export function cashFlowStatement(db, books, { from, to } = {}) {
  const R = (v) => round(v, books.dec);
  const cashIds = new Set(moneyAccounts(db).map((a) => a.id));
  const accounts = accountMap(db);
  const classifyAccount = (id) => {
    const a = accounts.get(id);
    if (!a) return 'unclassified';
    if (a.type === 'equity') return 'financing';
    const seen = new Set();
    let cur = a;
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      if (cur.id === 'loans') return 'financing';
      if (cur.id === 'g12') return 'investing';
      cur = accounts.get(cur.parent);
    }
    if (['asset', 'liability', 'revenue', 'expense'].includes(a.type)) return 'operating';
    return 'unclassified';
  };
  const movements = [];
  let openingAdjustment = 0;
  for (const entry of books.entries.values()) {
    if ((from && entry.date < from) || (to && entry.date > to)) continue;
    const amount = R(entry.lines.filter((l) => cashIds.has(l.acc)).reduce((s, l) => s + l.dr - l.cr, 0));
    if (!amount) continue; // تستبعد التحويلات الداخلية والحركات غير النقدية
    if (entry.doc.type === 'opening') { openingAdjustment += amount; continue; }
    const override = db.settings?.cashFlowCategories?.[entry.doc.id];
    let category;
    if (Object.hasOwn(CASH_FLOW_LABELS, override)) category = override;
    else if (entry.doc.type === 'disposal') category = 'investing';
    else {
      const kinds = new Set(entry.lines.filter((l) => !cashIds.has(l.acc) && (l.dr || l.cr)).map((l) => classifyAccount(l.acc)));
      category = kinds.size === 1 ? [...kinds][0] : 'unclassified';
    }
    movements.push({ doc: entry.doc, date: entry.date, amount, category, overridden: !!override });
  }
  const sections = Object.entries(CASH_FLOW_LABELS).map(([id, name]) => {
    const rows = movements.filter((x) => x.category === id);
    const received = R(rows.reduce((s, x) => s + Math.max(0, x.amount), 0));
    const paid = R(rows.reduce((s, x) => s + Math.max(0, -x.amount), 0));
    return { id, name, rows, received, paid, net: R(received - paid) };
  });
  const m = balances(books, { from, to });
  const opening = R([...cashIds].reduce((s, id) => s + (m.get(id)?.open || 0), openingAdjustment));
  const closing = R([...cashIds].reduce((s, id) => s + (m.get(id)?.close || 0), 0));
  const net = R(sections.reduce((s, x) => s + x.net, 0));
  return { sections, movements, opening, closing, net, reconciliation: R(closing - opening - net) };
}
