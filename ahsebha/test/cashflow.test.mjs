import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultAccounts, defaultSettings, buildBooks } from '../js/core.js';
import { cashFlowStatement } from '../js/cashflow.js';

function scenario(currency = 'SAR') {
  const db = { settings: defaultSettings({ currency, startDate: '2026-01-01' }), accounts: defaultAccounts(), parties: [], products: [], docs: [] };
  db.accounts.find((a) => a.id === 'cash').opening = 1000;
  const journal = (id, date, account, amount) => ({ id, type: 'journal', no: 1, date, lines: amount > 0 ? [{ account: 'cash', dr: amount }, { account, cr: amount }] : [{ account, dr: -amount }, { account: 'cash', cr: -amount }] });
  db.docs.push(journal('sale', '2026-01-02', 'sales', 500), journal('rent', '2026-01-03', 'e_rent', -100), journal('asset', '2026-01-04', 'equip', -200), journal('loan', '2026-01-05', 'loans', 300));
  db.docs.push({ id: 'transfer', type: 'transfer', date: '2026-01-06', from: 'cash', to: 'bank', amount: 400 });
  return db;
}

test('cash flow reconciles with cash and banks, excludes opening and internal transfers', () => {
  const db = scenario(); const B = buildBooks(db); const c = cashFlowStatement(db, B, { from: '2026-01-01', to: '2026-01-31' });
  assert.deepEqual([c.opening, c.closing, c.net, c.reconciliation], [1000, 1500, 500, 0]);
  assert.deepEqual(c.sections.map((s) => s.net), [400, -200, 300, 0]);
  assert.equal(c.movements.length, 4);
  const later = cashFlowStatement(db, B, { from: '2026-01-04', to: '2026-01-05' });
  assert.deepEqual([later.opening, later.closing, later.net, later.reconciliation], [1400, 1500, 100, 0]);
});

test('mixed activities remain visible until explicitly classified without changing the books', () => {
  const db = scenario('JOD');
  db.docs.push({ id: 'mixed', type: 'journal', date: '2026-01-07', lines: [{ account: 'cash', cr: 50.125 }, { account: 'equip', dr: 25 }, { account: 'e_rent', dr: 25.125 }] });
  const B = buildBooks(db); const c = cashFlowStatement(db, B);
  assert.equal(c.sections.find((x) => x.id === 'unclassified').net, -50.125);
  assert.equal(c.reconciliation, 0);
  db.settings.cashFlowCategories = { mixed: 'investing' };
  const revised = cashFlowStatement(db, B);
  assert.equal(revised.sections.find((x) => x.id === 'unclassified').net, 0);
  assert.equal(revised.sections.find((x) => x.id === 'investing').net, -250.125);
  assert.equal(revised.closing, c.closing);
  assert.deepEqual(B.postings, buildBooks(db).postings);
});
