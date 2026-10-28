import type { CashSession, CashSessionTotals } from '../types';

export const EMPTY_CASH_SESSION_TOTALS: CashSessionTotals = {
  sales: 0,
  cash: 0,
  debtsCollected: 0,
  debtsCollectedCash: 0,
  repairsCollected: 0,
  repairsCollectedCash: 0,
  expenses: 0,
  expensesCash: 0,
};

export function computeExpectedCash(session: CashSession): number {
  const totals = { ...EMPTY_CASH_SESSION_TOTALS, ...session.totals };
  return Math.round((
    Number(session.openingFloat || 0) +
    Number(totals.cash || 0) +
    Number(totals.debtsCollectedCash ?? totals.debtsCollected ?? 0) +
    Number(totals.repairsCollectedCash ?? totals.repairsCollected ?? 0) -
    Number(totals.expensesCash || 0) +
    Number.EPSILON
  ) * 1000) / 1000;
}
