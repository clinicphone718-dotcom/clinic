import assert from 'node:assert/strict';
import test from 'node:test';
import { UserProfile } from '../types';
import { can, hasMenuAccess, permissionsForPreset } from './permissions';

const technician: UserProfile = {
  uid: 'tech-1',
  email: 'tech@example.test',
  role: 'user',
  allowedMenus: ['reparation', 'pieces'],
};

test('technician preset allows repair and spare-parts screens only', () => {
  assert.equal(hasMenuAccess(technician, 'reparation'), true);
  assert.equal(hasMenuAccess(technician, 'pieces'), true);
  for (const menu of ['dashboard', 'pos', 'products', 'clients', 'sales', 'invoices', 'users', 'statistics']) {
    assert.equal(hasMenuAccess(technician, menu), false, `unexpected technician access to ${menu}`);
  }
});

test('legacy repair-only technicians gain spare-parts access without rewriting profile', () => {
  const legacy = { ...technician, allowedMenus: ['reparation'] };
  assert.equal(hasMenuAccess(legacy, 'pieces'), true);
  assert.deepEqual(legacy.allowedMenus, ['reparation']);
});

test('new technician and cashier presets expose their requested menus only', () => {
  const technicianWithCatalog: UserProfile = {
    ...technician,
    allowedMenus: ['reparation', 'pieces', 'products', 'clients'],
  };
  for (const menu of ['reparation', 'pieces', 'products', 'clients']) {
    assert.equal(hasMenuAccess(technicianWithCatalog, menu), true);
  }
  for (const menu of ['pos', 'sales', 'invoices', 'users', 'dashboard']) {
    assert.equal(hasMenuAccess(technicianWithCatalog, menu), false);
  }

  const cashier: UserProfile = {
    uid: 'cashier-repair-1',
    email: 'cashier-repair@example.test',
    role: 'user',
    allowedMenus: ['pos', 'reparation', 'pieces', 'products', 'clients'],
  };
  for (const menu of ['pos', 'reparation', 'pieces', 'products', 'clients']) {
    assert.equal(hasMenuAccess(cashier, menu), true);
  }
  for (const menu of ['sales', 'invoices', 'users', 'dashboard']) {
    assert.equal(hasMenuAccess(cashier, menu), false);
  }
});

test('cashier defaults remain unchanged and admins retain full repair access', () => {
  const cashier: UserProfile = { uid: 'cashier-1', email: 'cashier@example.test', role: 'user' };
  assert.equal(hasMenuAccess(cashier, 'pos'), true);
  assert.equal(hasMenuAccess(cashier, 'products'), true);
  assert.equal(hasMenuAccess(cashier, 'reparation'), false);
  const admin: UserProfile = { uid: 'admin-1', email: 'admin@example.test', role: 'admin', allowedMenus: [] };
  assert.equal(hasMenuAccess(admin, 'users'), true);
  assert.equal(hasMenuAccess(admin, 'reparation'), true);
  assert.equal(hasMenuAccess(admin, 'pieces'), true);
});

test('permission defaults distinguish technicians and cashiers and deny unspecified explicit flags', () => {
  const legacyTech = { ...technician, allowedMenus: ['reparation'] };
  assert.equal(can(legacyTech, 'pieces', 'adjustStock'), true);
  assert.equal(can(legacyTech, 'pieces', 'viewBuyPrice'), false);

  const cashier: UserProfile = {
    uid: 'cashier-flags',
    email: 'cashier@example.test',
    role: 'user',
    allowedMenus: ['pos', 'reparation', 'pieces', 'products', 'clients'],
  };
  assert.equal(can(cashier, 'products', 'addEdit'), false);
  assert.equal(can(cashier, 'products', 'viewBuyPrice'), false);

  const updatedTech: UserProfile = {
    ...legacyTech,
    allowedMenus: ['reparation', 'pieces', 'products', 'clients'],
    permissions: { pieces: { viewBuyPrice: true, adjustStock: false } },
  };
  assert.equal(can(updatedTech, 'pieces', 'viewBuyPrice'), true);
  assert.equal(can(updatedTech, 'pieces', 'adjustStock'), false);
  assert.equal(can(updatedTech, 'products', 'addEdit'), false);
});

test('admin permissions are unconditional and preset maps are independent copies', () => {
  const admin: UserProfile = { uid: 'admin-flags', email: 'admin@example.test', role: 'admin', allowedMenus: [] };
  assert.equal(can(admin, 'products', 'delete'), true);
  assert.equal(can(admin, 'reparation', 'viewCosts'), true);

  const first = permissionsForPreset('technician');
  first.products.addEdit = false;
  assert.equal(permissionsForPreset('technician').products.addEdit, true);
});

test('explicit cost, price and client flags are enforced per menu', () => {
  const profile: UserProfile = {
    uid: 'custom-1',
    email: 'custom@example.test',
    role: 'user',
    allowedMenus: ['pieces', 'products', 'reparation', 'clients'],
    permissions: {
      pieces: { viewBuyPrice: true, editSellPrice: false },
      products: { viewBuyPrice: false, editSellPrice: true },
      reparation: { viewCosts: true },
      clients: { addEdit: true, delete: false },
    },
  };

  assert.equal(can(profile, 'pieces', 'viewBuyPrice'), true);
  assert.equal(can(profile, 'pieces', 'editSellPrice'), false);
  assert.equal(can(profile, 'products', 'viewBuyPrice'), false);
  assert.equal(can(profile, 'products', 'editSellPrice'), true);
  assert.equal(can(profile, 'reparation', 'viewCosts'), true);
  assert.equal(can(profile, 'clients', 'addEdit'), true);
  assert.equal(can(profile, 'clients', 'delete'), false);
  assert.equal(can({ ...profile, allowedMenus: ['clients'] }, 'pieces', 'viewBuyPrice'), false);
});

test('startup screen and audio use independent role defaults and explicit flags', () => {
  const admin: UserProfile = { uid: 'admin-startup', email: 'admin@example.test', role: 'admin' };
  const cashier: UserProfile = { ...technician, allowedMenus: ['pos', 'products', 'clients'] };
  const technicianProfile: UserProfile = { ...technician, permissions: {} };

  assert.equal(can(admin, 'startup', 'showScreen'), true);
  assert.equal(can(admin, 'startup', 'playAudio'), true);
  assert.equal(can(cashier, 'startup', 'showScreen'), true);
  assert.equal(can(cashier, 'startup', 'playAudio'), false);
  assert.equal(can(technicianProfile, 'startup', 'showScreen'), true);
  assert.equal(can(technicianProfile, 'startup', 'playAudio'), false);
  assert.equal(can({ ...technicianProfile, permissions: { startup: { showScreen: false, playAudio: true } } }, 'startup', 'showScreen'), false);
  assert.equal(can({ ...technicianProfile, permissions: { startup: { showScreen: false, playAudio: true } } }, 'startup', 'playAudio'), true);
});
