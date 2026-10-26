import assert from 'node:assert/strict';
import test from 'node:test';
import { computeWorkshopSummary } from './workshopReports';

const now = new Date('2025-05-15T12:00:00');

test('workshop summary applies store-wide totals and date period consistently', () => {
  const sales = [{
    id: 'sale-1',
    date: new Date('2025-05-10T12:00:00'),
    total: 8.33,
    subtotal: 7,
    tva: 1.33,
    tvaEnabled: true,
    tvaRate: 19,
    paid: 5,
    debt: 3.33,
    items: [{ productId: 'item-1', name: 'Item', quantity: 1, price: 7, total: 7 }],
  }];
  const repairs = [{
    id: 'repair-1',
    number: 'REP-2025-0001',
    date: '2025-05-12T12:00:00',
    deliveredAt: '2025-05-12T12:00:00',
    status: 'livre' as const,
    deviceBrand: 'Brand',
    deviceModel: 'Model',
    problem: 'Broken screen',
    laborCost: 10,
    parts: [{ productId: 'part-1', name: 'Part', quantity: 1, unitPrice: 4, total: 4, unitBuyPrice: 2 }],
    total: 14,
    paid: 10,
    debt: 4,
    logs: [],
  }];
  const summary = computeWorkshopSummary(
    sales,
    repairs,
    [],
    { 'sale-1': [{ productId: 'item-1', quantity: 1, unitBuyPrice: 4 }] },
    {},
    '30',
    true,
    now,
  );

  assert.equal(summary.repairCount, 1);
  assert.equal(summary.revenue, 22.33);
  assert.equal(summary.collected, 15);
  assert.equal(summary.debt, 7.33);
  assert.equal(summary.grossProfit, 15);
  assert.equal(summary.laborRevenue, 10);
  assert.equal(summary.repairPartsRevenue, 4);
  assert.equal(summary.repairPartsCost, 2);
  assert.equal(summary.repairRevenue, 14);
  assert.equal(summary.repairStatuses.livre, 1);
});
