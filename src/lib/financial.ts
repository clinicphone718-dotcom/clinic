export interface FinancialSettings {
  tvaEnabled?: boolean;
  tva?: number;
  tvaOptIn?: boolean;
}

export interface FinancialLine {
  productId?: string;
  price?: number;
  unitPrice?: number;
  quantity?: number;
  total?: number;
}

export interface FinancialTotals {
  subtotal: number;
  discount: number;
  taxableAmount: number;
  tva: number;
  total: number;
}

export interface StoredInvoiceFinancials {
  items?: readonly FinancialLine[];
  total?: number;
  subtotal?: number;
  tva?: number;
  tvaEnabled?: boolean;
  tvaRate?: number;
  discount?: number;
}

export interface SaleCostLine {
  productId: string;
  quantity: number;
  unitBuyPrice: number | null;
}

export interface SaleProfitInput {
  total: number;
  subtotal?: number;
  tva?: number;
  tvaEnabled?: boolean;
  tvaRate?: number;
  discount?: number;
  items: readonly FinancialLine[];
}

export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 1000) / 1000;
}

export function normalizeFinancialSettings(
  settings: FinancialSettings | null | undefined,
): FinancialSettings {
  const enabled = settings?.tvaEnabled === true;
  return {
    tvaEnabled: enabled,
    tva: enabled ? Math.max(0, Number(settings?.tva) || 0) : 0,
    tvaOptIn: enabled,
  };
}

export function computeTotals(
  items: readonly FinancialLine[],
  discount: number,
  settings: FinancialSettings | null | undefined,
): FinancialTotals {
  const subtotal = roundMoney(items.reduce((sum, item) => {
    const lineTotal = typeof item.total === 'number'
      ? item.total
      : (Number(item.price ?? item.unitPrice) || 0) * (Number(item.quantity) || 0);
    return sum + (Number.isFinite(lineTotal) ? lineTotal : 0);
  }, 0));
  const appliedDiscount = roundMoney(Math.min(Math.max(0, Number(discount) || 0), subtotal));
  const taxableAmount = roundMoney(Math.max(0, subtotal - appliedDiscount));
  const rate = settings?.tvaEnabled === true
    ? Math.max(0, Number(settings.tva) || 0) / 100
    : 0;
  const tva = rate > 0 ? roundMoney(taxableAmount * rate) : 0;

  return {
    subtotal,
    discount: appliedDiscount,
    taxableAmount,
    tva,
    total: roundMoney(taxableAmount + tva),
  };
}

export function getInvoiceTotals(invoice: StoredInvoiceFinancials): FinancialTotals & { tvaVisible: boolean } {
  if (typeof invoice.tvaEnabled === 'boolean' && Array.isArray(invoice.items)) {
    return {
      ...computeTotals(invoice.items, invoice.discount || 0, {
        tvaEnabled: invoice.tvaEnabled,
        tva: invoice.tvaRate,
      }),
      tvaVisible: invoice.tvaEnabled,
    };
  }

  const total = roundMoney(Number(invoice.total) || 0);
  const tva = roundMoney(Number(invoice.tva) || 0);
  return {
    subtotal: roundMoney(Number(invoice.subtotal) || (total - tva)),
    discount: roundMoney(Number(invoice.discount) || 0),
    taxableAmount: roundMoney(Number(invoice.subtotal) || (total - tva)),
    tva,
    total,
    tvaVisible: false,
  };
}

export function computeSaleProfit(
  sale: SaleProfitInput,
  costLines: readonly SaleCostLine[] | undefined,
): { revenueExcludingTax: number; cost: number; profit: number | null; complete: boolean } {
  const computedTotals = typeof sale.tvaEnabled === 'boolean'
    ? computeTotals(sale.items, sale.discount || 0, {
      tvaEnabled: sale.tvaEnabled,
      tva: sale.tvaRate,
    })
    : null;
  const revenueExcludingTax = computedTotals
    ? computedTotals.taxableAmount
    : typeof sale.subtotal === 'number'
      ? roundMoney(Math.max(0, sale.subtotal - (Number(sale.discount) || 0)))
      : roundMoney(Math.max(0, sale.total - (Number(sale.tva) || 0)));
  const costsByProduct = new Map((costLines || []).map(line => [line.productId, line]));
  const allLinesCosted = sale.items.every(item => {
    const line = costsByProduct.get(String((item as FinancialLine & { productId?: string }).productId || ''));
    return line && typeof line.unitBuyPrice === 'number' && Number.isFinite(line.unitBuyPrice);
  });
  const cost = roundMoney(sale.items.reduce((sum, item) => {
    const line = costsByProduct.get(String((item as FinancialLine & { productId?: string }).productId || ''));
    if (!line || typeof line.unitBuyPrice !== 'number') return sum;
    return sum + line.unitBuyPrice * (Number(item.quantity) || 0);
  }, 0));

  return {
    revenueExcludingTax,
    cost,
    profit: allLinesCosted ? roundMoney(revenueExcludingTax - cost) : null,
    complete: allLinesCosted,
  };
}
