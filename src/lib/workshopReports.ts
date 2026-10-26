import { computeSaleProfit, computeTotals, roundMoney, type SaleCostLine } from './financial';
import type { Repair, Sale } from '../types';

export type ReportPeriod = 'today' | '7' | '30' | '90' | 'year' | 'all';

export interface WorkshopSummary {
  repairCount: number;
  salesRevenue: number;
  revenue: number;
  collected: number;
  debt: number;
  grossProfit: number | null;
  expenses: number;
  netProfit: number | null;
  laborRevenue: number;
  repairPartsRevenue: number;
  repairPartsCost: number;
  repairRevenue: number;
  incompleteSales: number;
  incompleteRepairs: number;
  salesWithTva: number;
  repairStatuses: Record<string, number>;
}

type ExpenseRecord = { date: unknown; amount: number };
type RepairCostSnapshot = Record<string, number>;

function toDate(value: unknown): Date {
  if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') {
    return value.toDate();
  }
  if (value instanceof Date) return value;
  return new Date((value as string | number | undefined) || 0);
}

export function isWithinReportPeriod(value: unknown, period: ReportPeriod, now = new Date()): boolean {
  const date = toDate(value);
  if (Number.isNaN(date.getTime()) || date > now) return false;
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  if (period === '7') start.setDate(start.getDate() - 6);
  else if (period === '30') start.setDate(start.getDate() - 29);
  else if (period === '90') start.setDate(start.getDate() - 89);
  else if (period === 'year') start.setMonth(0, 1);
  else if (period === 'all') start.setTime(0);
  return date >= start;
}

export function computeWorkshopSummary(
  sales: readonly Sale[],
  repairs: readonly Repair[],
  expenses: readonly ExpenseRecord[],
  saleCostSnapshots: Readonly<Record<string, readonly SaleCostLine[]>>,
  repairCostSnapshots: Readonly<Record<string, RepairCostSnapshot>>,
  period: ReportPeriod,
  canViewMargin: boolean,
  now = new Date(),
): WorkshopSummary {
  const rangeSales = sales.filter(sale => isWithinReportPeriod(sale.date, period, now));
  const rangeRepairs = repairs.filter(repair =>
    isWithinReportPeriod(repair.deliveredAt || repair.date, period, now));
  const deliveredRepairs = rangeRepairs.filter(repair => repair.status === 'livre');
  const rangeExpenses = expenses.filter(expense => isWithinReportPeriod(expense.date, period, now));
  const saleMargins = rangeSales.map(sale => computeSaleProfit(sale, saleCostSnapshots[sale.id]));
  const incompleteSales = saleMargins.filter(result => !result.complete).length;
  const salesProfit = saleMargins.reduce((sum, result) => sum + (result.profit || 0), 0);
  const laborRevenue = deliveredRepairs.reduce((sum, repair) => sum + (Number(repair.laborCost) || 0), 0);
  const repairPartsRevenue = deliveredRepairs.reduce((sum, repair) =>
    sum + (repair.parts || []).reduce((partSum, part) => partSum + (Number(part.total) || 0), 0), 0);
  const repairRevenueExcludingTax = deliveredRepairs.reduce((sum, repair) => sum + computeTotals([
    { total: Number(repair.laborCost) || 0 },
    ...(repair.parts || []).map(part => ({ total: Number(part.total) || 0 })),
  ], Number(repair.discount) || 0, {
    tvaEnabled: repair.tvaEnabled === true,
    tva: repair.tvaRate,
  }).taxableAmount, 0);

  let repairPartsCost = 0;
  let repairsComplete = true;
  deliveredRepairs.forEach(repair => {
    const costs = repairCostSnapshots[repair.id] || {};
    (repair.parts || []).forEach(part => {
      const buyPrice = costs[part.productId] ?? part.unitBuyPrice;
      if (typeof buyPrice !== 'number' || !Number.isFinite(buyPrice)) repairsComplete = false;
      else repairPartsCost += buyPrice * (Number(part.quantity) || 0);
    });
  });

  const grossProfit = canViewMargin && incompleteSales === 0 && repairsComplete
    ? roundMoney(salesProfit + repairRevenueExcludingTax - repairPartsCost)
    : null;
  const expensesTotal = roundMoney(rangeExpenses.reduce((sum, expense) => sum + (Number(expense.amount) || 0), 0));
  const salesRevenue = roundMoney(rangeSales.reduce((sum, sale) => sum + (Number(sale.total) || 0), 0));
  const repairRevenue = deliveredRepairs.reduce((sum, repair) => sum + (Number(repair.total) || 0), 0);
  const revenue = roundMoney(salesRevenue + repairRevenue);
  const repairStatuses = rangeRepairs.reduce<Record<string, number>>((counts, repair) => {
    counts[repair.status] = (counts[repair.status] || 0) + 1;
    return counts;
  }, {});

  return {
    repairCount: rangeRepairs.length,
    salesRevenue,
    revenue,
    collected: roundMoney(rangeSales.reduce((sum, sale) => sum + (Number(sale.paid) || 0), 0) +
      rangeRepairs.reduce((sum, repair) => sum + (Number(repair.paid) || 0), 0)),
    debt: roundMoney(rangeSales.reduce((sum, sale) => sum + (Number(sale.debt) || 0), 0) +
      rangeRepairs.reduce((sum, repair) => sum + (Number(repair.debt) || 0), 0)),
    grossProfit,
    expenses: expensesTotal,
    netProfit: grossProfit === null ? null : roundMoney(grossProfit - expensesTotal),
    laborRevenue: roundMoney(laborRevenue),
    repairPartsRevenue: roundMoney(repairPartsRevenue),
    repairPartsCost: roundMoney(repairPartsCost),
    repairRevenue: roundMoney(repairRevenue),
    incompleteSales,
    incompleteRepairs: repairsComplete ? 0 : 1,
    salesWithTva: rangeSales.filter(sale => Number(sale.tva) > 0).length,
    repairStatuses,
  };
}
