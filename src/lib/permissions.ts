import { PermissionFlag, PermissionMenuId, UserProfile } from '../types';

export type PermissionPreset = 'admin' | 'technician' | 'cashier';
export type PermissionMap = Record<PermissionMenuId, Partial<Record<PermissionFlag, boolean>>>;

export const PERMISSION_FLAGS: Record<PermissionMenuId, Array<{ id: PermissionFlag; label: string }>> = {
  pieces: [
    { id: 'viewBuyPrice', label: "Voir le prix d'achat" },
    { id: 'editSellPrice', label: 'Modifier le prix de vente' },
    { id: 'addEdit', label: 'Ajouter / modifier (nom, catégorie, marque, modèles...)' },
    { id: 'adjustStock', label: 'Ajuster le stock (−/+, + À STOCK)' },
    { id: 'delete', label: 'Supprimer' },
  ],
  products: [
    { id: 'viewBuyPrice', label: "Voir le prix d'achat" },
    { id: 'editSellPrice', label: 'Modifier le prix de vente' },
    { id: 'addEdit', label: 'Ajouter / modifier (nom, catégorie, marque, modèles...)' },
    { id: 'adjustStock', label: 'Ajuster le stock (−/+, + À STOCK)' },
    { id: 'delete', label: 'Supprimer' },
  ],
  reparation: [{ id: 'viewCosts', label: 'Voir les coûts et le bénéfice' }],
  clients: [
    { id: 'addEdit', label: 'Ajouter / modifier' },
    { id: 'delete', label: 'Supprimer' },
  ],
  startup: [
    { id: 'showScreen', label: "Afficher l'écran d'ouverture (Coran & Adhkar)" },
    { id: 'playAudio', label: "Lecture audio à l'ouverture" },
  ],
};

export const DEFAULT_FLAGS: Record<PermissionPreset, PermissionMap> = {
  admin: {
    pieces: { viewBuyPrice: true, editSellPrice: true, addEdit: true, adjustStock: true, delete: true },
    products: { viewBuyPrice: true, editSellPrice: true, addEdit: true, adjustStock: true, delete: true },
    reparation: { viewCosts: true },
    clients: { addEdit: true, delete: true },
    startup: { showScreen: true, playAudio: true },
  },
  technician: {
    pieces: { viewBuyPrice: false, editSellPrice: false, addEdit: true, adjustStock: true, delete: true },
    products: { viewBuyPrice: false, editSellPrice: false, addEdit: true, adjustStock: true, delete: true },
    reparation: { viewCosts: false },
    clients: { addEdit: true, delete: true },
    startup: { showScreen: true, playAudio: false },
  },
  cashier: {
    pieces: { viewBuyPrice: false, editSellPrice: false, addEdit: false, adjustStock: false, delete: false },
    products: { viewBuyPrice: false, editSellPrice: false, addEdit: false, adjustStock: false, delete: false },
    reparation: { viewCosts: false },
    clients: { addEdit: false, delete: false },
    startup: { showScreen: true, playAudio: false },
  },
};

export function permissionPreset(profile: Pick<UserProfile, 'role' | 'allowedMenus'>): PermissionPreset {
  if (profile.role === 'admin') return 'admin';
  const menus = profile.allowedMenus || [];
  return menus.includes('reparation') && !menus.includes('pos')
    ? 'technician'
    : 'cashier';
}

export function permissionsForPreset(preset: PermissionPreset): PermissionMap {
  return structuredClone(DEFAULT_FLAGS[preset]);
}

export function mergePermissions(
  preset: PermissionPreset,
  overrides?: UserProfile['permissions'],
): PermissionMap {
  if (!overrides) return permissionsForPreset(preset);
  const explicitFlags = (menu: PermissionMenuId) => Object.fromEntries(
    PERMISSION_FLAGS[menu].map(({ id }) => [id, overrides[menu]?.[id] === true])
  );
  return {
    pieces: explicitFlags('pieces'),
    products: explicitFlags('products'),
    reparation: explicitFlags('reparation'),
    clients: explicitFlags('clients'),
    startup: { ...permissionsForPreset(preset).startup, ...overrides.startup },
  };
}

export function hasMenuAccess(userProfile: UserProfile | null, menuId: string): boolean {
  if (!userProfile) return false;
  if (userProfile.role === 'admin') return true;

  let allowed = userProfile.allowedMenus || (
    ['dashboard', 'pos', 'products', 'clients', 'sales', 'invoices', 'notes']
  );

  if (menuId === 'pieces' && userProfile.role === 'user' &&
      allowed.length === 1 && allowed[0] === 'reparation') {
    return true;
  }

  if (menuId === 'users') return false;
  return allowed.includes(menuId);
}

export function can(
  userProfile: UserProfile | null,
  menuId: PermissionMenuId,
  flag: PermissionFlag,
): boolean {
  if (!userProfile || (menuId !== 'startup' && !hasMenuAccess(userProfile, menuId))) return false;
  if (userProfile.role === 'admin') return true;
  if (menuId === 'startup' && userProfile.permissions?.startup === undefined) {
    return DEFAULT_FLAGS[permissionPreset(userProfile)].startup[flag] === true;
  }
  if (userProfile.permissions !== undefined) {
    return userProfile.permissions[menuId]?.[flag] === true;
  }
  return DEFAULT_FLAGS[permissionPreset(userProfile)][menuId][flag] === true;
}
