import { roundMoney } from './financial';

export interface PurchaseLineInput {
  itemId: string;
  itemCollection: 'products' | 'parts';
  nameSnapshot: string;
  quantity: number;
  unitCostMilli: number;
}

export interface PurchaseLineTotals {
  subtotalMilli: number;
  totalMilli: number;
  paidMilli: number;
  debtMilli: number;
}

export function calculatePurchaseTotals(
  lines: readonly PurchaseLineInput[],
  paidAmount: number,
): PurchaseLineTotals {
  const subtotalMilli = lines.reduce((sum, line) => {
    if (!Number.isInteger(line.quantity) || line.quantity <= 0 ||
      !Number.isInteger(line.unitCostMilli) || line.unitCostMilli < 0) {
      throw new Error('Chaque ligne doit avoir une quantité entière positive et un coût valide.');
    }
    return sum + line.quantity * line.unitCostMilli;
  }, 0);
  const paidMilli = Math.round(roundMoney(Number(paidAmount) || 0) * 1000);
  if (!Number.isSafeInteger(subtotalMilli) || !Number.isSafeInteger(paidMilli) ||
    paidMilli < 0 || paidMilli > subtotalMilli) {
    throw new Error('Le montant payé doit être compris entre zéro et le total de la facture.');
  }
  return {
    subtotalMilli,
    totalMilli: subtotalMilli,
    paidMilli,
    debtMilli: subtotalMilli - paidMilli,
  };
}

export function getPurchaseCancellationStock(
  currentStock: number,
  purchasedQuantity: number,
): number {
  if (!Number.isInteger(currentStock) || currentStock < purchasedQuantity) {
    throw new Error('Annulation impossible : le stock disponible est insuffisant pour reprendre les articles.');
  }
  return currentStock - purchasedQuantity;
}

export function getPurchaseReceiptStock(
  currentStock: number,
  purchasedQuantity: number,
): number {
  if (!Number.isSafeInteger(currentStock) || currentStock < 0 ||
    !Number.isSafeInteger(purchasedQuantity) || purchasedQuantity <= 0 ||
    !Number.isSafeInteger(currentStock + purchasedQuantity)) {
    throw new Error('La quantité reçue ou le stock actuel est invalide.');
  }
  return currentStock + purchasedQuantity;
}

export function getPurchasePaymentBalance(
  currentDebtMilli: number,
  paymentAmount: number,
): { paymentMilli: number; remainingMilli: number } {
  const paymentMilli = Math.round(roundMoney(Number(paymentAmount) || 0) * 1000);
  if (!Number.isSafeInteger(currentDebtMilli) || currentDebtMilli < 0 ||
    !Number.isSafeInteger(paymentMilli) || paymentMilli <= 0 || paymentMilli > currentDebtMilli) {
    throw new Error('Le règlement doit être supérieur à zéro et ne peut pas dépasser le reste dû.');
  }
  return { paymentMilli, remainingMilli: currentDebtMilli - paymentMilli };
}
