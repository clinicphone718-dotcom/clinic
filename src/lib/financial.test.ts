import assert from 'node:assert/strict';
import test from 'node:test';
import { computeSaleProfit, computeTotals, normalizeFinancialSettings } from './financial';

test('TVA is off unless settings explicitly enable it', () => {
  assert.deepEqual(computeTotals([{ price: 7, quantity: 1 }], 0, undefined), {
    subtotal: 7,
    discount: 0,
    taxableAmount: 7,
    tva: 0,
    total: 7,
  });
  assert.equal(computeTotals([{ price: 7, quantity: 1 }], 0, { tvaEnabled: false, tva: 19 }).total, 7);
  assert.deepEqual(normalizeFinancialSettings({ tvaEnabled: true, tva: 19 }), {
    tvaEnabled: false,
    tva: 0,
    tvaOptIn: false,
  });
  assert.deepEqual(normalizeFinancialSettings({ tvaEnabled: true, tva: 19, tvaOptIn: true }), {
    tvaEnabled: true,
    tva: 19,
    tvaOptIn: true,
  });
});

test('7 DT at 19 percent produces 1.330 DT TVA and 8.330 DT total', () => {
  assert.deepEqual(computeTotals([{ price: 7, quantity: 1 }], 0, { tvaEnabled: true, tva: 19 }), {
    subtotal: 7,
    discount: 0,
    taxableAmount: 7,
    tva: 1.33,
    total: 8.33,
  });
});

test('discount is applied before TVA and all totals round to three decimals', () => {
  assert.deepEqual(computeTotals([{ total: 10.5555 }], 1.111, { tvaEnabled: true, tva: 19 }), {
    subtotal: 10.556,
    discount: 1.111,
    taxableAmount: 9.445,
    tva: 1.795,
    total: 11.24,
  });
});

test('sale profit uses frozen purchase prices and includes a loss-making item', () => {
  const items = [
    { productId: 'charger', total: 35, quantity: 1 },
    { productId: 'phone', total: 400, quantity: 1 },
    { productId: 'case', total: 10, quantity: 1 },
  ];
  const costs = [
    { productId: 'charger', quantity: 1, unitBuyPrice: 15 },
    { productId: 'phone', quantity: 1, unitBuyPrice: 200 },
    { productId: 'case', quantity: 1, unitBuyPrice: 20 },
  ];
  const result = computeSaleProfit({
    total: 445,
    subtotal: 445,
    tva: 0,
    discount: 0,
    items,
  }, costs);

  assert.deepEqual(items.map(item => {
    const cost = costs.find(line => line.productId === item.productId)!;
    return {
      item: item.productId,
      sales: item.total,
      cost: cost.unitBuyPrice,
      profit: item.total - cost.unitBuyPrice,
    };
  }), [
    { item: 'charger', sales: 35, cost: 15, profit: 20 },
    { item: 'phone', sales: 400, cost: 200, profit: 200 },
    { item: 'case', sales: 10, cost: 20, profit: -10 },
  ]);
  assert.deepEqual(result, {
    revenueExcludingTax: 445,
    cost: 235,
    profit: 210,
    complete: true,
  });

  test('sale profit excludes TVA from revenue', () => {
    const result = computeSaleProfit({
      total: 8.33,
      subtotal: 7,
      tva: 1.33,
      tvaEnabled: true,
      tvaRate: 19,
      items: [{ productId: 'item', price: 7, total: 7, quantity: 1 }],
    }, [{ productId: 'item', quantity: 1, unitBuyPrice: 4 }]);

    assert.deepEqual(result, {
      revenueExcludingTax: 7,
      cost: 4,
      profit: 3,
      complete: true,
    });
  });
  assert.equal(computeSaleProfit({
    total: 35,
    items: [{ productId: 'unknown', total: 35, quantity: 1 }],
  }, undefined).profit, null);
});
