export interface RepairPartQuantity {
  productId: string;
  name: string;
  quantity: number;
  inventoryCollection?: 'products' | 'parts';
}

export interface RepairStockChange {
  productId: string;
  delta: number;
  name: string;
  inventoryCollection: 'products' | 'parts';
}

export function getRepairStockChanges(
  previousParts: RepairPartQuantity[],
  nextParts: RepairPartQuantity[]
): RepairStockChange[] {
  const changes = new Map<string, RepairStockChange>();
  for (const part of previousParts) {
    const inventoryCollection = part.inventoryCollection || 'products';
    const key = `${inventoryCollection}:${part.productId}`;
    const change = changes.get(key) || { productId: part.productId, inventoryCollection, delta: 0, name: part.name };
    change.delta += part.quantity;
    changes.set(key, change);
  }
  for (const part of nextParts) {
    const inventoryCollection = part.inventoryCollection || 'products';
    const key = `${inventoryCollection}:${part.productId}`;
    const change = changes.get(key) || { productId: part.productId, inventoryCollection, delta: 0, name: part.name };
    change.delta -= part.quantity;
    change.name = part.name || change.name;
    changes.set(key, change);
  }
  return [...changes.values()].filter(change => change.delta !== 0);
}

export function getRepairStockMovementId(
  repairId: string,
  version: number,
  productId: string,
  inventoryCollection: 'products' | 'parts' = 'products'
): string {
  return `${repairId}_v${version}_${inventoryCollection}_${productId}`;
}
