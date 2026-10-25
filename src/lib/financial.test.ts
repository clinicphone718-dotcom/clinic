import assert from 'node:assert/strict';
import test from 'node:test';
import { computeTotals } from './financial';

test('TVA is off unless settings explicitly enable it', () => {
  assert.deepEqual(computeTotals([{ price: 7, quantity: 1 }], 0, undefined), {
    subtotal: 7,
    discount: 0,
    taxableAmount: 7,
    tva: 0,
    total: 7,
  });
  assert.equal(computeTotals([{ price: 7, quantity: 1 }], 0, { tvaEnabled: false, tva: 19 }).total, 7);
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
