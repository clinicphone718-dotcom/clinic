import assert from 'node:assert/strict';
import test from 'node:test';
import { getRepairStockChanges, getRepairStockMovementId } from './repairInventory';

test('newly used parts are stock deductions', () => {
  assert.deepEqual(
    getRepairStockChanges([], [{ productId: 'screen', name: 'Screen', quantity: 2 }]),
    [{ productId: 'screen', name: 'Screen', inventoryCollection: 'products', delta: -2 }]
  );
});

test('reducing a part quantity returns only the difference', () => {
  assert.deepEqual(
    getRepairStockChanges(
      [{ productId: 'screen', name: 'Screen', quantity: 4 }],
      [{ productId: 'screen', name: 'Screen', quantity: 1 }]
    ),
    [{ productId: 'screen', name: 'Screen', inventoryCollection: 'products', delta: 3 }]
  );
});

test('saving without changing quantities creates no movement', () => {
  assert.deepEqual(
    getRepairStockChanges(
      [{ productId: 'screen', name: 'Screen', quantity: 1 }],
      [{ productId: 'screen', name: 'Screen', quantity: 1 }]
    ),
    []
  );
});

test('swapping a part records a return and a new deduction', () => {
  assert.deepEqual(
    getRepairStockChanges(
      [{ productId: 'old', name: 'Old part', quantity: 1 }],
      [{ productId: 'new', name: 'New part', quantity: 2 }]
    ),
    [
      { productId: 'old', name: 'Old part', inventoryCollection: 'products', delta: 1 },
      { productId: 'new', name: 'New part', inventoryCollection: 'products', delta: -2 },
    ]
  );
});

test('movement ids are deterministic for a repair version and product', () => {
  assert.equal(getRepairStockMovementId('repair-1', 3, 'screen'), 'repair-1_v3_products_screen');
});
