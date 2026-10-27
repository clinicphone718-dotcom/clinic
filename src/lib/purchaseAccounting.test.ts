import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calculatePurchaseTotals,
  getPurchaseCancellationStock,
  getPurchasePaymentBalance,
} from './purchaseAccounting';

const chargerLine = {
  itemId: 'charger',
  itemCollection: 'products' as const,
  nameSnapshot: 'Chargeur',
  quantity: 10,
  unitCostMilli: 15_000,
};

test('10 chargers at 15 DT paid 100 DT create 50 DT supplier debt', () => {
  assert.deepEqual(calculatePurchaseTotals([chargerLine], 100), {
    subtotalMilli: 150_000,
    totalMilli: 150_000,
    paidMilli: 100_000,
    debtMilli: 50_000,
  });
});

test('a later 50 DT payment clears the supplier balance', () => {
  assert.deepEqual(getPurchasePaymentBalance(50_000, 50), {
    paymentMilli: 50_000,
    remainingMilli: 0,
  });
});

test('purchase cancellation refuses to reduce stock below zero', () => {
  assert.throws(() => getPurchaseCancellationStock(9, 10), /stock disponible est insuffisant/);
  assert.equal(getPurchaseCancellationStock(10, 10), 0);
});
