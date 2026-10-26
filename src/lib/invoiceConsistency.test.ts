import assert from 'node:assert/strict';
import test from 'node:test';
import { computeTotals, getInvoiceTotals, type SaleCostLine } from './financial';
import { computeWorkshopSummary } from './workshopReports';
import type { Invoice, Sale, SaleItem } from '../types';

test('one sale has the same TTC total in POS, history, billing, reports, and dashboard', () => {
  const items: SaleItem[] = [{ productId: 'item-1', name: 'Article', quantity: 1, price: 7, total: 7 }];
  const settings = { tvaEnabled: true, tva: 19 };
  const caisse = computeTotals(items, 0, settings);
  const sale: Sale = {
    id: 'sale-1',
    date: new Date(),
    total: caisse.total,
    subtotal: caisse.subtotal,
    paid: caisse.total,
    debt: 0,
    tva: caisse.tva,
    tvaEnabled: settings.tvaEnabled,
    tvaRate: settings.tva,
    items,
  };
  const invoice: Invoice = {
    id: 'invoice-1',
    number: 'FAC-2025-0001',
    saleId: sale.id,
    clientName: 'Client',
    total: sale.total,
    subtotal: sale.subtotal,
    paid: sale.paid,
    debt: sale.debt,
    tva: sale.tva,
    tvaEnabled: sale.tvaEnabled,
    tvaRate: sale.tvaRate,
    date: sale.date,
    items: sale.items,
  };
  const costLines: SaleCostLine[] = [{ productId: 'item-1', quantity: 1, unitBuyPrice: 4 }];
  const summary = computeWorkshopSummary(
    [sale],
    [],
    [],
    { [sale.id]: costLines },
    {},
    'all',
    true,
  );
  const totalsAcrossSurfaces = [
    caisse.total,
    sale.total,
    getInvoiceTotals(invoice).total,
    summary.salesRevenue,
    summary.revenue,
  ];

  assert.deepEqual(totalsAcrossSurfaces, [8.33, 8.33, 8.33, 8.33, 8.33]);
  assert.equal(summary.grossProfit, 3);
});
