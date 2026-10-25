import assert from 'node:assert/strict';
import test from 'node:test';
import { computeExpectedCash } from './cashSessionMath';
import type { CashSession } from '../types';

test('expected cash includes cash receipts and subtracts only cash expenses', () => {
  const session: CashSession = {
    id: 'session-1',
    ownerId: 'store-1',
    openedBy: 'cashier-1',
    openedAt: new Date(),
    openingFloat: 100,
    status: 'open',
    totals: {
      sales: 80,
      cash: 50,
      debtsCollected: 15,
      debtsCollectedCash: 10,
      repairsCollected: 7,
      repairsCollectedCash: 5,
      expenses: 8,
      expensesCash: 3,
    },
  };

  assert.equal(computeExpectedCash(session), 162);
});
