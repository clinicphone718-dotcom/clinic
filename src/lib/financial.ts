export interface FinancialSettings {
  tvaEnabled?: boolean;
  tva?: number;
}

export interface FinancialLine {
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

export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 1000) / 1000;
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
