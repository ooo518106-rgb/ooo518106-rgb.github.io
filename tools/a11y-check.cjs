// فحص الوصول (axe-core) لكل صفحات البرنامج ببيانات العرض التجريبية: يطبع المخالفات مرتبة بالأهمية، أو «no violations».
// الاستعمال: شغّل خادماً محلياً على مجلد المستودع ثم:
//   npm i --no-save axe-core playwright
//   python3 -m http.server 8765 &   node tools/a11y-check.cjs
// المتغير BASE: عنوان البرنامج (الافتراضي http://127.0.0.1:8765/ahsebha/). النتيجة المتوقعة الآن: بلا أي مخالفة.
const { chromium } = require('playwright');
const fs = require('fs');
const BASE = process.env.BASE || 'http://127.0.0.1:8765/ahsebha/';
const axe = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, locale: 'ar', serviceWorkers: 'block', colorScheme: 'light' });
  await ctx.addInitScript(() => { try { localStorage.setItem('theme', 'light'); } catch (e) {} });
  await ctx.route(/google-analytics\.com|googletagmanager\.com|analytics\.google\.com/, (r) => r.abort());
  const page = await ctx.newPage();
  await page.goto(BASE); await page.click('[data-demo]'); await page.waitForSelector('#side nav a'); await page.waitForTimeout(2800);
  await page.evaluate(() => document.getElementById('toasts').replaceChildren());
  const ids = await page.evaluate(async () => {
    const s = await import('./js/store.js'); const d = s.getDb(); const f = (t) => (d.docs.find((x) => x.type === t) || {}).id;
    return { sale: f('sale'), purchase: f('purchase'), quote: f('quote'), sreturn: f('sreturn'), expense: f('expense'), receipt: f('receipt'), cust: (d.parties.find((p) => p.kind === 'customer') || {}).id, sup: (d.parties.find((p) => p.kind === 'supplier') || {}).id, prod: (d.products[0] || {}).id, emp: (d.employees[0] || {}).id, asset: (d.assets[0] || {}).id };
  });
  const nav = await page.$$eval('#side nav a[href^="#/"]', (a) => a.map((x) => x.getAttribute('href')));
  const extra = ['#/sales/new', '#/purchases/new', '#/quotes/new', '#/sales-returns/new', '#/purchase-returns/new', '#/expenses/new', '#/receipts/new', '#/payments/new', '#/transfers/new', '#/journal/new', '#/customers/new', '#/suppliers/new', '#/products/new', '#/adjustments/new', '#/stock-transfers/new', '#/payroll/new', '#/import', '#/users', '#/audit', '#/labels', '#/pos/closing', '#/reports', '#/reports/income', '#/reports/balance', '#/reports/trial', '#/reports/vat', '#/reports/aging-ar', '#/reports/aging-ap', '#/reports/sales', '#/reports/cashflow', '#/reports/stock',
    ids.sale && '#/sales/' + ids.sale, ids.sale && '#/sales/' + ids.sale + '/edit', ids.purchase && '#/purchases/' + ids.purchase, ids.cust && '#/customers/' + ids.cust, ids.sup && '#/suppliers/' + ids.sup, ids.prod && '#/products/' + ids.prod, ids.prod && '#/products/' + ids.prod + '/edit', ids.expense && '#/expenses/' + ids.expense, ids.receipt && '#/receipts/' + ids.receipt, ids.asset && '#/assets/' + ids.asset, ids.emp && '#/payroll', '#/subscription', '#/today', '#/settings', '#/accounts', '#/journal', '#/cheques', '#/recurring', '#/collections', '#/assets', '#/employees'].filter(Boolean);
  const routes = [...new Set([...nav, ...extra])];
  const agg = new Map();
  for (const r of routes) {
    await page.evaluate((h) => { document.querySelectorAll('dialog[open]').forEach((d) => d.close()); location.hash = h; }, r);
    await page.waitForTimeout(450);
    const leave = await page.$('dialog.dlg[open] [data-ok]'); if (leave) { await leave.click(); await page.waitForTimeout(300); }
    await page.addScriptTag({ content: axe }).catch(() => {});
    const res = await page.evaluate(async () => (await axe.run(document, { resultTypes: ['violations'], runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'best-practice'] } })).violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, ex: v.nodes.slice(0, 8).map((n) => n.html.slice(0, 120)) })));
    for (const v of res) { const e = agg.get(v.id) || { impact: v.impact, help: v.help, where: [], ex: new Set() }; e.where.push(r); v.ex.forEach((x) => e.ex.add(x)); agg.set(v.id, e); }
  }
  console.log('routes scanned:', routes.length);
  const order = { critical: 0, serious: 1, moderate: 2, minor: 3 };
  for (const [id, e] of [...agg].sort((a, b) => order[a[1].impact] - order[b[1].impact])) console.log(`${e.impact.toUpperCase().padEnd(8)} ${id}  ${e.help}\n   pages: ${e.where.slice(0, 8).join(' ')}\n   e.g.: ${[...e.ex].slice(0, 4).join('\n         ')}`);
  if (!agg.size) console.log('no violations');
  await browser.close();
})();
