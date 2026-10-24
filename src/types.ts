export interface Category {
  id: string;
  name: string;
  type: 'alimentation' | 'boissons' | 'entretien' | 'frais' | 'autre'; // For styling grocery departments
  ownerId?: string;
}

export interface Product {
  id: string;
  name: string;
  category: string; // Will store category ID or name
  buyPrice: number;
  sellPrice: number;
  barcode?: string;
  reference?: string; // utilisé par Repairs.tsx (recherche de pièces) — à vérifier
  inventoryType?: 'service' | 'spare_part' | 'product';
  stock: number;
  expirationDate?: string;
  lowStockAlert?: number;
  ownerId?: string;
  createdAt?: string;
}

export interface Client {
  id: string;
  code?: string;
  name: string;
  phone?: string;
  address?: string;
  debt: number;
  ownerId?: string;
}

export interface SaleItem {
  productId: string;
  name: string;
  quantity: number;
  price: number;
  total: number;
}

export interface Sale {
  id: string;
  date: any; // Firestore Timestamp
  clientId?: string;
  clientName?: string;
  total: number;
  paid: number;
  debt: number;
  tva: number;
  discount?: number;
  invoiceId?: string;
  items: SaleItem[];
  ownerId?: string;
}

export interface Invoice {
  id: string;
  number: string;
  saleId: string;
  clientId?: string;
  clientCode?: string;
  clientName: string;
  clientPhone?: string;
  clientAddress?: string;
  total: number;
  paid: number;
  debt: number;
  tva: number;
  discount?: number;
  date: any;
  items: SaleItem[];
  ownerId?: string;
}

export interface UserProfile {
  uid: string;
  email: string;
  name?: string;
  role: 'admin' | 'user';
  status?: 'active' | 'banned';
  allowedMenus?: string[];
  permissions?: Partial<Record<PermissionMenuId, Partial<Record<PermissionFlag, boolean>>>>;
  securityCode?: string;
  ownerId?: string;
  creatorId?: string;
  createdAt?: string;
}

export type PermissionMenuId = 'pieces' | 'products' | 'reparation' | 'clients' | 'startup';
export type PermissionFlag =
  | 'viewBuyPrice'
  | 'editSellPrice'
  | 'addEdit'
  | 'adjustStock'
  | 'delete'
  | 'viewCosts'
  | 'showScreen'
  | 'playAudio';

export type StartupSection = 'coran' | 'matin' | 'soir' | 'rizq';

export interface StartupSchedule {
  allDay: boolean;
  start: string;
  end: string;
}

export interface StartupConfig {
  enabled: boolean;
  frequency: 'each_open' | 'daily_period';
  schedule: Record<StartupSection, StartupSchedule>;
  volume: number;
  loop: boolean;
  background: boolean;
  welcomeTitle?: string;
  welcomeText?: string;
  welcomeSource?: string;
  audioUrl?: string;
  updatedAt?: unknown;
}

export interface StartupItem {
  id: string;
  ownerId: string;
  section: StartupSection;
  type: 'text' | 'image' | 'audio';
  title: string;
  text?: string;
  source?: string;
  repeat?: number;
  imageData?: string;
  audioUrl?: string;
  order: number;
  active: boolean;
  createdAt?: unknown;
}

export interface StoreSettings {
  id: string;
  storeName: string;
  currency: string;
  address?: string;
  phone?: string;
  tva: number;
  tvaEnabled?: boolean;
  ownerId?: string;
  deleteCode?: string;
  minStockAlert?: number;
  defaultWarrantyDays?: number; // utilisé par Repairs.tsx — à vérifier
}

export interface Note {
  id: string;
  title: string;
  content: string;
  date: string; // The associated calendar/reminder date
  createdAt: any; // Timestamp or date
  userId: string;
  ownerId?: string;
}


// ============================================================
//  RÉPARATIONS
//  ⚠️ Types RECONSTITUÉS à partir de l'usage dans Repairs.tsx (les types
//  d'origine ont été perdus). Libellés de statut inclus : à vérifier.
// ============================================================
export type RepairStatus =
  | 'recu' | 'diagnostic' | 'en_attente_piece' | 'en_cours'
  | 'termine' | 'livre' | 'irreparable' | 'annule';

export const REPAIR_STATUS_LABELS: Record<RepairStatus, string> = {
  recu: 'Reçu',
  diagnostic: 'Diagnostic',
  en_attente_piece: 'En attente de pièce',
  en_cours: 'En cours',
  termine: 'Terminé',
  livre: 'Livré',
  irreparable: 'Irréparable',
  annule: 'Annulé',
};

export interface RepairPart {
  productId: string;
  name: string;
  quantity: number;
  inventoryCollection?: 'products' | 'parts';
  unitBuyPrice?: number; // prix d'achat figé au moment de l'ajout
  unitPrice: number;
  total: number;
}

export interface RepairLog {
  date: string; // ISO
  status?: RepairStatus;
  note: string;
  by?: string;
}

export interface Repair {
  id: string;
  number: string; // REP-AAAA-0001
  date: any; // Firestore Timestamp
  clientId?: string;
  clientName?: string;
  clientPhone?: string;
  deviceBrand: string;
  deviceModel: string;
  imei?: string;
  devicePassword?: string;
  accessories?: string;
  deviceCondition?: string;
  problem: string;
  diagnostic?: string;
  status: RepairStatus;
  technician?: string;
  estimatedCost?: number;
  laborCost?: number;
  parts: RepairPart[];
  total: number;
  paid: number;
  debt: number;
  discount?: number;
  warrantyDays?: number;
  warrantyUntil?: string | null;
  deliveredAt?: string | null;
  logs: RepairLog[];
  ownerId?: string;
  costsSeparated?: boolean;
}
