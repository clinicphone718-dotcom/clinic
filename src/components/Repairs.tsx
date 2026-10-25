import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  collection, onSnapshot, addDoc, updateDoc, doc, query, where,
  serverTimestamp, runTransaction, getDoc, deleteDoc, type DocumentSnapshot, type Transaction
} from 'firebase/firestore';
import { auth, db } from '../firebase';
import {
  Repair, RepairStatus, RepairPart, RepairLog, Client, Product,
  StoreSettings, UserProfile, REPAIR_STATUS_LABELS
} from '../types';
import { handleFirestoreError, OperationType, canCashRepairs, hasMenuAccess } from '../App';
import {
  Wrench, Plus, Search, X, Smartphone, User, Clock, CheckCircle,
  AlertCircle, Trash2, Package, Shield, FileText, Edit3, Phone,
  Calendar, ChevronRight, History, DollarSign, Filter
} from 'lucide-react';
import { cn, isSparePart, decodeAzertyBarcode } from '../lib/utils';
import { getRepairStockChanges, getRepairStockMovementId } from '../lib/repairInventory';
import { computeTotals, normalizeFinancialSettings } from '../lib/financial';
import { format } from 'date-fns';
import { RepairTicket } from './RepairTicket';
import { can } from '../lib/permissions';
import { apiFetch } from '../lib/api';

interface RepairsProps {
  userProfile: UserProfile | null;
}

type RepairInventoryProduct = Product & {
  inventoryType?: string;
  inventoryCollection: 'products' | 'parts';
  active?: boolean;
  brand?: string;
  compatibleModels?: string[];
};

export const STATUS_STYLES: Record<RepairStatus, string> = {
  recu: 'bg-slate-100 text-slate-700 border-slate-200',
  diagnostic: 'bg-blue-50 text-blue-700 border-blue-200',
  en_attente_piece: 'bg-amber-50 text-amber-700 border-amber-200',
  en_cours: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  termine: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  livre: 'bg-teal-50 text-teal-700 border-teal-200',
  irreparable: 'bg-rose-50 text-rose-700 border-rose-200',
  annule: 'bg-slate-100 text-slate-400 border-slate-200 line-through',
};

export const ACTIVE_STATUSES: RepairStatus[] = ['recu', 'diagnostic', 'en_attente_piece', 'en_cours', 'termine'];

interface RepairStockMovement {
  id: string;
  type: string;
  repairId: string;
  productId: string;
  productName: string;
  delta: number;
  userLabel?: string;
  createdAt?: { toDate?: () => Date } | string;
}

async function applyRepairStockChanges(
  transaction: Transaction,
  args: {
    repairId: string;
    repairNumber: string;
    ownerId: string;
    previousParts: RepairPart[];
    nextParts: RepairPart[];
    stockVersion: number;
    movementType: 'repair_part_adjustment' | 'repair_delete_return';
    userLabel: string;
  }
): Promise<number> {
  const changes = getRepairStockChanges(args.previousParts, args.nextParts);
  if (changes.length === 0) return args.stockVersion;

  const version = args.stockVersion + 1;
  const userId = auth.currentUser?.uid;
  if (!userId) throw new Error('Session utilisateur absente : impossible d’enregistrer le mouvement de stock.');

  const productRefs = new Map(changes.map(change => [
    `${change.inventoryCollection}:${change.productId}`,
    doc(db, change.inventoryCollection, change.productId)
  ]));
  const productSnapshots = new Map<string, DocumentSnapshot>();
  for (const change of changes) {
    const key = `${change.inventoryCollection}:${change.productId}`;
    productSnapshots.set(key, await transaction.get(productRefs.get(key)!));
  }

  const movementRefs = new Map(changes.map(change => [
    `${change.inventoryCollection}:${change.productId}`,
    doc(db, 'stock_movements', getRepairStockMovementId(args.repairId, version, change.productId, change.inventoryCollection))
  ]));
  const movementSnapshots = new Map<string, DocumentSnapshot>();
  for (const change of changes) {
    const key = `${change.inventoryCollection}:${change.productId}`;
    movementSnapshots.set(key, await transaction.get(movementRefs.get(key)!));
  }

  for (const change of changes) {
    const key = `${change.inventoryCollection}:${change.productId}`;
    const productSnapshot = productSnapshots.get(key)!;
    if (!productSnapshot.exists()) {
      throw new Error(`La pièce "${change.name}" n’existe plus dans le stock.`);
    }
    const product = productSnapshot.data();
    if (!product) throw new Error(`Impossible de lire le stock de "${change.name}".`);
    const currentStock = Number(product.stock);
    if (!Number.isInteger(currentStock) || currentStock < 0) {
      throw new Error(`Le stock de "${change.name}" est invalide.`);
    }
    if ((product.ownerId || args.ownerId) !== args.ownerId) {
      throw new Error(`La pièce "${change.name}" n’appartient pas à ce magasin.`);
    }
    if (currentStock + change.delta < 0) {
      throw new Error(`Stock insuffisant pour "${change.name}" : ${currentStock} disponible(s).`);
    }
    if (movementSnapshots.get(key)!.exists()) {
      throw new Error('Un mouvement de stock existe déjà pour cette version. Rechargez la fiche avant de réessayer.');
    }
  }

  for (const change of changes) {
    const key = `${change.inventoryCollection}:${change.productId}`;
    const product = productSnapshots.get(key)!.data();
    if (!product) throw new Error(`Impossible de lire le stock de "${change.name}".`);
    const movementRef = movementRefs.get(key)!;
    const movementId = movementRef.id;
    transaction.update(productRefs.get(key)!, {
      stock: Number(product.stock) + change.delta,
      lastStockMovementId: movementId,
    });
    transaction.set(movementRef, {
      type: args.movementType,
      repairId: args.repairId,
      repairNumber: args.repairNumber,
      productId: change.productId,
      inventoryCollection: change.inventoryCollection,
      productName: change.name,
      delta: change.delta,
      quantity: Math.abs(change.delta),
      version,
      ownerId: args.ownerId,
      userId,
      userLabel: args.userLabel,
      createdAt: serverTimestamp(),
    });
  }

  return version;
}

// Compteur transactionnel partagé entre le module Réparations et son Historique.
export async function generateNextRepairNumber(ownerId: string): Promise<string> {
  const year = new Date().getFullYear();
  const counterRef = doc(db, 'counters', `repairs_${ownerId}`);
  let num = 1;
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(counterRef);
    num = (snap.exists() ? (snap.data().lastNum || 0) : 0) + 1;
    tx.set(counterRef, { lastNum: num }, { merge: true });
  });
  return `REP-${year}-${num.toString().padStart(4, '0')}`;
}

// Suppression d'une réparation + restitution du stock des pièces utilisées,
// partagée entre le module Réparations et son Historique.
export async function deleteRepairAndRestoreStock(r: Repair): Promise<void> {
  await runTransaction(db, async (tx) => {
    const repairRef = doc(db, 'repairs', r.id);
    const repairSnap = await tx.get(repairRef);
    if (!repairSnap.exists()) return;
    const current = repairSnap.data();
    const currentRepair = { ...current, id: repairSnap.id } as Repair;
    await applyRepairStockChanges(tx, {
      repairId: r.id,
      repairNumber: currentRepair.number,
      ownerId: currentRepair.ownerId || '',
      previousParts: currentRepair.parts || [],
      nextParts: [],
      stockVersion: Number(current.stockVersion) || 0,
      movementType: 'repair_delete_return',
      userLabel: auth.currentUser?.email || 'Administrateur',
    });
    tx.delete(repairRef);
  });
}

export default function Repairs({ userProfile }: RepairsProps) {
  const ownerId = userProfile?.ownerId || userProfile?.uid || 'no_user_auth';
  const currentUserLabel = userProfile?.name || userProfile?.email || 'Utilisateur';
  const isAdmin = userProfile?.role === 'admin';
  const canViewProductBuyPrice = can(userProfile, 'products', 'viewBuyPrice');
  const canViewPartBuyPrice = can(userProfile, 'pieces', 'viewBuyPrice');
  const canViewCosts = can(userProfile, 'reparation', 'viewCosts');
  const isTechnician = userProfile?.role === 'user' &&
    (userProfile.allowedMenus || []).includes('reparation') &&
    !(userProfile.allowedMenus || []).includes('pos');
  // Livraison / encaissement / remise : admin ou vendeuse (menu 'pos'), jamais le Technicien.
  const canCash = canCashRepairs(userProfile);

  const [repairs, setRepairs] = useState<Repair[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [legacyProducts, setLegacyProducts] = useState<Product[]>([]);
  const [spareParts, setSpareParts] = useState<RepairInventoryProduct[]>([]);
  const [partCosts, setPartCosts] = useState<Record<string, number>>({});
  const [repairCosts, setRepairCosts] = useState<Record<string, Record<string, number>>>({});
  const productCostsRef = useRef<Record<string, number>>({});
  const [migratingCosts, setMigratingCosts] = useState(false);
  const [settings, setSettings] = useState<StoreSettings | null>(null);
  const products = useMemo(() => [...legacyProducts, ...spareParts], [legacyProducts, spareParts]);

  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | RepairStatus>('all');
  const [technicianFilter, setTechnicianFilter] = useState<'all' | 'mine'>('all');
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingRepair, setEditingRepair] = useState<Repair | null>(null);
  const [detailRepair, setDetailRepair] = useState<Repair | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const playBeep = (type: 'success' | 'error') => {
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.value = type === 'success' ? 950 : 300;
      gain.gain.setValueAtTime(0.08, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.12);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.12);
    } catch { /* ignore : audio non disponible */ }
  };

  // ---- Data listeners ----
  useEffect(() => {
    productCostsRef.current = {};
    const unsubRepairs = onSnapshot(
      isAdmin
        ? query(collection(db, 'repairs'), where('ownerId', '==', ownerId))
        : query(collection(db, 'repairs'), where('ownerId', '==', ownerId), where('costsSeparated', '==', true)),
      (snap) => {
        const list = snap.docs.map(d => ({ id: d.id, ...d.data() } as Repair));
        list.sort((a, b) => {
          const da = a.date?.toMillis ? a.date.toMillis() : 0;
          const dbb = b.date?.toMillis ? b.date.toMillis() : 0;
          return dbb - da;
        });
        setRepairs(list);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'repairs')
    );
    const unsubClients = onSnapshot(
      query(collection(db, 'clients'), where('ownerId', '==', ownerId)),
      (snap) => {
        const list = snap.docs.map(d => ({ id: d.id, ...d.data() } as Client));
        list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        setClients(list);
      }
    );
    const canReadLegacyProducts = hasMenuAccess(userProfile, 'products') || hasMenuAccess(userProfile, 'pos');
    const unsubProducts = canReadLegacyProducts
      ? onSnapshot(
        query(collection(db, 'products'), where('ownerId', '==', ownerId)),
        snap => setLegacyProducts(snap.docs
          .map(d => {
            const data = d.data();
            const legacyBuyPrice = isAdmin ? Number(data.buyPrice) || 0 : 0;
            delete data.buyPrice;
            return {
              id: d.id,
              ...data,
              buyPrice: canViewProductBuyPrice ? (productCostsRef.current[d.id] ?? legacyBuyPrice) : 0,
              inventoryCollection: 'products',
            } as RepairInventoryProduct;
          })
          .filter(isSparePart)
          .sort((a, b) => (a.name || '').localeCompare(b.name || ''))),
        err => handleFirestoreError(err, OperationType.LIST, 'products')
      )
      : () => setLegacyProducts([]);
    const unsubProductCosts = canViewProductBuyPrice
      ? onSnapshot(
        query(collection(db, 'product_costs'), where('ownerId', '==', ownerId)),
        snap => {
          const costs = Object.fromEntries(snap.docs.map(item => [item.id, Number(item.data().buyPrice) || 0]));
          productCostsRef.current = costs;
          setLegacyProducts(current => current.map(product => ({
            ...product,
            buyPrice: costs[product.id] ?? product.buyPrice,
          })));
        },
        err => handleFirestoreError(err, OperationType.LIST, 'product_costs')
      )
      : () => {
        productCostsRef.current = {};
      };
    const unsubSpareParts = hasMenuAccess(userProfile, 'reparation')
      ? onSnapshot(
        query(collection(db, 'parts'), where('ownerId', '==', ownerId)),
        snap => setSpareParts(snap.docs
          .map(d => {
            const part = d.data();
            return {
              id: d.id,
              name: `${part.brand} ${part.category}`,
              category: part.category,
              reference: part.reference,
              barcode: part.barcode,
              buyPrice: 0,
              sellPrice: Number(part.sellPrice) || 0,
              stock: Number(part.stock) || 0,
              ownerId: part.ownerId,
              inventoryType: 'spare_part',
              inventoryCollection: 'parts' as const,
              brand: part.brand,
              compatibleModels: part.compatibleModels || [],
            } as RepairInventoryProduct;
          })
          .filter(part => part.active !== false)
          .sort((a, b) => (a.name || '').localeCompare(b.name || ''))),
        err => handleFirestoreError(err, OperationType.LIST, 'parts')
      )
      : () => setSpareParts([]);
    const unsubPartCosts = canViewPartBuyPrice
      ? onSnapshot(
        query(collection(db, 'part_costs'), where('ownerId', '==', ownerId)),
        snap => setPartCosts(Object.fromEntries(snap.docs.map(d => [d.id, Number(d.data().buyPrice) || 0]))),
        err => handleFirestoreError(err, OperationType.LIST, 'part_costs')
      )
      : () => setPartCosts({});
    const unsubRepairCosts = canViewCosts
      ? onSnapshot(
        query(collection(db, 'repair_costs'), where('ownerId', '==', ownerId)),
        snap => setRepairCosts(Object.fromEntries(snap.docs.map(item => {
          const values = (item.data().parts || []) as Array<{ productId: string; unitBuyPrice: number }>;
          return [item.id, Object.fromEntries(values.map(value => [value.productId, Number(value.unitBuyPrice) || 0]))];
        }))),
        err => handleFirestoreError(err, OperationType.LIST, 'repair_costs')
      )
      : () => setRepairCosts({});
    const unsubSettings = onSnapshot(doc(db, 'settings', ownerId), (snap) => {
      if (snap.exists()) {
        const data = snap.data() as StoreSettings;
        const { id: _storedId, ...settingsData } = data;
        setSettings({
          ...settingsData,
          ...normalizeFinancialSettings(settingsData),
          id: snap.id,
        });
      }
    });
    return () => { unsubRepairs(); unsubClients(); unsubProducts(); unsubProductCosts(); unsubSpareParts(); unsubPartCosts(); unsubRepairCosts(); unsubSettings(); };
  }, [ownerId, isAdmin, canViewProductBuyPrice, canViewPartBuyPrice, canViewCosts, userProfile]);

  const currency = settings?.currency || 'DT';

  useEffect(() => {
    if (success) { const t = setTimeout(() => setSuccess(null), 3500); return () => clearTimeout(t); }
  }, [success]);
  useEffect(() => {
    if (error) { const t = setTimeout(() => setError(null), 5000); return () => clearTimeout(t); }
  }, [error]);

  // ---- Recherche par douchette (scanner code à barre) ----
  // Scanne le code du bon de dépôt (REP-xxxx) OU l'IMEI/série de l'appareil :
  // les deux sont déjà pris en charge par le filtre de recherche ci-dessous.
  useEffect(() => {
    if (isFormOpen || detailRepair) return; // pas de scan pendant l'édition/le détail
    let buffer = '';
    let lastKeyTime = 0;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      if (e.key === 'Tab' || e.key === 'Escape' || e.key === 'ArrowUp' || e.key === 'ArrowDown') return;

      const now = Date.now();
      const target = e.target as HTMLElement;
      const isInputFocused = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT');
      const interval = lastKeyTime ? now - lastKeyTime : 0;
      lastKeyTime = now;

      if (e.key.length === 1) {
        if (isInputFocused && interval > 120) { buffer = e.key; return; }
        buffer = interval > 120 ? e.key : buffer + e.key;
      } else if (e.key === 'Enter') {
        const code = decodeAzertyBarcode(buffer.trim());
        buffer = '';
        lastKeyTime = 0;
        if (code.length >= 3) {
          setSearchTerm(code);
          setStatusFilter('all'); // pour retrouver la réparation même si elle est déjà livrée/annulée
          playBeep('success');
          if (isInputFocused) { e.preventDefault(); e.stopPropagation(); }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isFormOpen, detailRepair]);

  // ---- Filtering ----
  const filtered = useMemo(() => {
    return repairs.filter(r => {
      const matchSearch = !searchTerm ||
        (r.number || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        (r.clientName || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        (r.clientPhone || '').includes(searchTerm) ||
        (r.deviceModel || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        (r.imei || '').includes(searchTerm);
      const matchStatus =
        statusFilter === 'all' ? true :
        statusFilter === 'active' ? ACTIVE_STATUSES.includes(r.status) :
        r.status === statusFilter;
      const technician = (r.technician || '').trim().toLowerCase();
      const myIdentities = [userProfile?.name, userProfile?.email]
        .filter((identity): identity is string => Boolean(identity))
        .map(identity => identity.trim().toLowerCase());
      const matchTechnician = technicianFilter === 'all' || myIdentities.includes(technician);
      return matchSearch && matchStatus && matchTechnician;
    });
  }, [repairs, searchTerm, statusFilter, technicianFilter, userProfile?.name, userProfile?.email]);

  const stats = useMemo(() => {
    const active = repairs.filter(r => ACTIVE_STATUSES.includes(r.status)).length;
    const ready = repairs.filter(r => r.status === 'termine').length;
    return { active, ready, total: repairs.length };
  }, [repairs]);

  // ---- Historiques journaliers des indicateurs ----
  const [statsModal, setStatsModal] = useState<'count' | 'profit' | null>(null);

  const toJsDate = (src: any): Date => {
    if (!src) return new Date();
    if (typeof src.toDate === 'function') return src.toDate();
    return new Date(src);
  };
  const dayKeyOf = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  // Nombre de réparations créées par jour (tous statuts)
  const dailyRepairCounts = useMemo(() => {
    const map: Record<string, { dateStr: string; count: number }> = {};
    repairs.forEach(r => {
      const key = dayKeyOf(toJsDate(r.date));
      if (!map[key]) map[key] = { dateStr: key, count: 0 };
      map[key].count += 1;
    });
    return Object.values(map).sort((a, b) => b.dateStr.localeCompare(a.dateStr));
  }, [repairs]);

  // Les coûts historiques absents restent explicitement incomplets; aucun prix actuel n'est substitué.
  const dailyNetProfit = useMemo(() => {
    if (!canViewCosts) return [];
    const map: Record<string, { dateStr: string; count: number; revenue: number; partsCost: number; profit: number; complete: boolean }> = {};
    repairs.filter(r => r.status === 'livre').forEach(r => {
      const key = dayKeyOf(toJsDate(r.deliveredAt || r.date));
      if (!map[key]) map[key] = { dateStr: key, count: 0, revenue: 0, partsCost: 0, profit: 0, complete: true };
      let partsCost = 0;
      (r.parts || []).forEach(part => {
        const unitCost = repairCosts[r.id]?.[part.productId] ?? part.unitBuyPrice;
        if (typeof unitCost !== 'number' || !Number.isFinite(unitCost)) map[key].complete = false;
        else partsCost += unitCost * (part.quantity || 0);
      });
      const discount = Number(r.discount) || 0;
      const totals = computeTotals([
        { total: Number(r.laborCost) || 0 },
        ...(r.parts || []).map(part => ({ total: Number(part.total) || 0 })),
      ], discount, {
        tvaEnabled: r.tvaEnabled === true && r.tvaOptIn === true,
        tva: r.tvaRate,
      });
      const revenue = totals.taxableAmount;
      map[key].count += 1;
      map[key].revenue += revenue;
      map[key].partsCost += partsCost;
      map[key].profit += (revenue - partsCost);
    });
    return Object.values(map).sort((a, b) => b.dateStr.localeCompare(a.dateStr));
  }, [repairs, repairCosts, canViewCosts]);

  const todayProfit = useMemo(() => {
    const todayKey = dayKeyOf(new Date());
    const today = dailyNetProfit.find(d => d.dateStr === todayKey);
    return today ? (today.complete ? today.profit : null) : 0;
  }, [dailyNetProfit]);

  const todayCount = useMemo(() => {
    const todayKey = dayKeyOf(new Date());
    return dailyRepairCounts.find(d => d.dateStr === todayKey)?.count || 0;
  }, [dailyRepairCounts]);

  // ---- Generate next repair number (transactional counter) ----
  const generateRepairNumber = async (): Promise<string> => generateNextRepairNumber(ownerId);

  const handleDelete = async (r: Repair) => {
    if (userProfile?.role !== 'admin') { setError("Seul un administrateur peut supprimer une réparation."); return; }
    if (!window.confirm(`Supprimer la réparation ${r.number} ? Les pièces utilisées seront restituées au stock.`)) return;
    try {
      await deleteRepairAndRestoreStock(r);
      setSuccess(`Réparation ${r.number} supprimée, stock restitué.`);
      setDetailRepair(null);
    } catch (e: any) {
      setError("Échec de la suppression : " + (e.message || e));
    }
  };

  const legacyRepairsNeedingCostSeparation = isAdmin ? repairs.filter(repair => repair.costsSeparated !== true) : [];

  const separateLegacyRepairCosts = async () => {
    if (!isAdmin || migratingCosts || legacyRepairsNeedingCostSeparation.length === 0) return;
    const count = legacyRepairsNeedingCostSeparation.length;
    if (!window.confirm(
      `Archiver les coûts des ${count} anciennes fiches dans repair_costs et retirer les prix d’achat des fiches lisibles par l’atelier ? Les montants seront conservés dans la collection protégée.`
    )) return;
    setMigratingCosts(true);
    setError(null);
    let completed = 0;
    try {
      for (const item of legacyRepairsNeedingCostSeparation) {
        const repairRef = doc(db, 'repairs', item.id);
        const costsRef = doc(db, 'repair_costs', item.id);
        await runTransaction(db, async transaction => {
          const [repairSnapshot, costsSnapshot] = await Promise.all([
            transaction.get(repairRef),
            transaction.get(costsRef),
          ]);
          if (!repairSnapshot.exists()) return;
          const stored = repairSnapshot.data();
          const sourceParts = Array.isArray(stored.parts) ? stored.parts as Array<Record<string, unknown>> : [];
          const costs = sourceParts.flatMap(part => {
            const value = Number(part.unitBuyPrice);
            return Number.isFinite(value) && value >= 0
              ? [{ productId: String(part.productId || ''), unitBuyPrice: value, quantity: Number(part.quantity) || 0 }]
              : [];
          });
          if (!costsSnapshot.exists()) {
            transaction.set(costsRef, {
              ownerId: stored.ownerId || ownerId,
              repairId: item.id,
              repairNumber: stored.number || item.number,
              parts: costs,
              migratedAt: serverTimestamp(),
              migratedBy: userProfile?.uid || '',
            });
          }
          const safeParts = sourceParts.map(part => {
            const { unitBuyPrice: _privateCost, ...publicPart } = part;
            return publicPart;
          });
          transaction.update(repairRef, { parts: safeParts, costsSeparated: true });
        });
        completed += 1;
      }
      setSuccess(`Séparation terminée : ${completed} fiche(s) traitée(s). Les coûts archivés restent réservés à l’administration.`);
    } catch (issue) {
      setError(`Séparation interrompue après ${completed} fiche(s) : ${issue instanceof Error ? issue.message : String(issue)}. Vous pouvez relancer l’opération; elle est idempotente.`);
    } finally {
      setMigratingCosts(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black font-display text-slate-900 flex items-center gap-3">
            <span className="w-11 h-11 rounded-2xl bg-gradient-to-tr from-indigo-600 to-cyan-500 flex items-center justify-center shadow-lg shadow-indigo-600/20">
              <Wrench className="w-6 h-6 text-white" />
            </span>
            Atelier de réparation
          </h1>
          <p className="text-slate-500 text-sm mt-1 font-medium">Gestion des ordres de réparation et suivi</p>
        </div>
        <button
          onClick={() => { setEditingRepair(null); setIsFormOpen(true); }}
          className="flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-3 rounded-2xl font-bold text-sm shadow-lg shadow-indigo-600/20 transition-all"
        >
          <Plus className="w-5 h-5" /> Nouvelle réparation
        </button>
      </div>

      {/* Stats */}
      <div className={cn("grid grid-cols-2 gap-4", canViewCosts ? "lg:grid-cols-4" : "lg:grid-cols-3")}>
        {[
          { label: 'En cours', value: stats.active, icon: Clock, color: 'from-indigo-500 to-indigo-600' },
          { label: 'Prêts à récupérer', value: stats.ready, icon: CheckCircle, color: 'from-emerald-500 to-emerald-600' },
          { label: 'Réparations du jour', value: todayCount, icon: Package, color: 'from-amber-500 to-amber-600', onClick: () => setStatsModal('count') },
          { label: 'Bénéfice net du jour', value: todayProfit === null ? '—' : `${todayProfit.toFixed(3)} ${currency}`, icon: DollarSign, color: 'from-teal-500 to-cyan-600', onClick: () => setStatsModal('profit') },
        ].filter((s: any) => canViewCosts || s.label !== 'Bénéfice net du jour').map((s: any, i) => {
          const Icon = s.icon;
          return (
            <div key={i} onClick={s.onClick}
              className={cn(
                "bg-white rounded-2xl p-4 border border-slate-100 shadow-sm",
                s.onClick && "cursor-pointer hover:border-indigo-200 hover:shadow-md active:scale-[0.99] transition-all"
              )}>
              <div className={cn("w-10 h-10 rounded-xl bg-gradient-to-tr flex items-center justify-center mb-3", s.color)}>
                <Icon className="w-5 h-5 text-white" />
              </div>
              <p className="text-2xl font-black text-slate-900 font-display">{s.value}</p>
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mt-0.5">{s.label}</p>
              {s.onClick && (
                <p className="text-[9px] font-bold text-slate-300 mt-1 flex items-center gap-1">
                  <History className="w-3 h-3 shrink-0" /> Historique journalier
                </p>
              )}
            </div>
          );
        })}
      </div>

      {/* Notifications */}
      {success && (
        <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 text-emerald-700 px-4 py-3 rounded-xl text-sm font-semibold">
          <CheckCircle className="w-4 h-4" /> {success}
        </div>
      )}
      {error && (
        <div className="flex items-center gap-2 bg-rose-50 border border-rose-200 text-rose-700 px-4 py-3 rounded-xl text-sm font-semibold">
          <AlertCircle className="w-4 h-4" /> {error}
        </div>
      )}

      {/* Search + filter */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Rechercher : n°, client, téléphone, modèle, IMEI... (ou scannez le bon)"
            className="w-full pl-11 pr-4 py-3 bg-white border border-slate-200 rounded-2xl text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
          />
        </div>
        <div className="relative">
          <Filter className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as any)}
            className="pl-11 pr-8 py-3 bg-white border border-slate-200 rounded-2xl text-sm font-semibold focus:ring-2 focus:ring-indigo-500 outline-none appearance-none cursor-pointer"
          >
            <option value="active">En cours (actifs)</option>
            <option value="all">Tous les statuts</option>
            {Object.entries(REPAIR_STATUS_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </div>
        {isTechnician && <select
          aria-label="Filtrer par technicien"
          value={technicianFilter}
          onChange={event => setTechnicianFilter(event.target.value as 'all' | 'mine')}
          className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold focus:ring-2 focus:ring-indigo-500 outline-none"
        >
          <option value="all">Toutes</option>
          <option value="mine">Mes réparations</option>
        </select>}
      </div>

      {isAdmin && legacyRepairsNeedingCostSeparation.length > 0 && (
        <div className="flex flex-col gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-bold text-amber-900">Séparer les coûts historiques</p>
            <p className="mt-1 text-sm text-amber-800">
              {legacyRepairsNeedingCostSeparation.length} fiche(s) historique(s) n’ont pas encore été vérifiées et nettoyées des prix d’achat intégrés.
            </p>
          </div>
          <button onClick={() => void separateLegacyRepairCosts()} disabled={migratingCosts} className="shrink-0 rounded-xl bg-amber-700 px-4 py-3 text-sm font-bold text-white hover:bg-amber-800 disabled:opacity-50">
            {migratingCosts ? 'Séparation en cours...' : 'Séparer les coûts historiques'}
          </button>
        </div>
      )}

      {/* List */}
      <div className="space-y-3">
        {filtered.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-100 p-12 text-center">
            <Wrench className="w-12 h-12 text-slate-200 mx-auto mb-3" />
            <p className="text-slate-400 font-semibold">Aucune réparation trouvée</p>
          </div>
        ) : filtered.map(r => {
          // Réparation terminée/livrée ET entièrement payée (après remise) → ligne en vert
          const isDoneAndPaid = (r.status === 'termine' || r.status === 'livre') &&
            ((r.total || 0) - (r.discount || 0) - (r.paid || 0)) <= 0.001;
          return (
          <div
            key={r.id}
            onClick={() => setDetailRepair(r)}
            className={cn(
              "rounded-2xl border p-4 shadow-sm hover:shadow-md transition-all cursor-pointer group",
              isDoneAndPaid
                ? "bg-emerald-50 border-emerald-300 hover:border-emerald-400"
                : "bg-white border-slate-100 hover:border-indigo-100"
            )}
          >
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-2xl bg-slate-50 flex items-center justify-center shrink-0 group-hover:bg-indigo-50 transition-colors">
                <Smartphone className="w-6 h-6 text-slate-400 group-hover:text-indigo-500" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono font-black text-sm text-indigo-600">{r.number}</span>
                  <span className={cn("px-2 py-0.5 rounded-lg text-[10px] font-black uppercase tracking-wider border", STATUS_STYLES[r.status])}>
                    {REPAIR_STATUS_LABELS[r.status]}
                  </span>
                  {r.warrantyUntil && new Date(r.warrantyUntil) > new Date() && (
                    <span className="flex items-center gap-1 text-[10px] font-black text-teal-600"><Shield className="w-3 h-3" /> Garantie</span>
                  )}
                </div>
                <p className="text-sm font-bold text-slate-800 truncate mt-0.5">
                  {r.deviceBrand} {r.deviceModel} — <span className="text-slate-500 font-medium">{r.problem}</span>
                </p>
                <div className="flex items-center gap-3 text-xs text-slate-400 mt-1 font-medium">
                  <span className="flex items-center gap-1"><User className="w-3 h-3" /> {r.clientName || 'Sans client'}</span>
                  {r.date?.toDate && <span className="flex items-center gap-1"><Calendar className="w-3 h-3" /> {format(r.date.toDate(), 'dd/MM/yyyy HH:mm')}</span>}
                </div>
              </div>
              <div className="text-right shrink-0">
                <p className="font-black text-slate-900">{(r.total || 0).toFixed(2)} {currency}</p>
                {r.debt > 0 && <p className="text-[11px] font-bold text-rose-500">Reste {r.debt.toFixed(2)}</p>}
                <div className="flex items-center justify-end gap-1 mt-1">
                  {userProfile?.role === 'admin' && (
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDelete(r); }}
                      className="p-1.5 rounded-lg text-rose-400 hover:text-rose-600 hover:bg-rose-100 transition-colors"
                      title="Supprimer la réparation"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                  <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-indigo-400 transition-colors" />
                </div>
              </div>
            </div>
          </div>
          );
        })}
      </div>

      {/* Historique journalier des indicateurs */}
      {statsModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-start sm:items-center justify-center p-2 sm:p-4 overflow-y-auto"
          onClick={() => setStatsModal(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <h3 className="font-black text-slate-900 flex items-center gap-2">
                <History className="w-5 h-5 text-indigo-500" />
                {statsModal === 'count' ? 'Réparations par jour' : 'Bénéfice net par jour'}
              </h3>
              <button onClick={() => setStatsModal(null)} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
            </div>
            <div className="overflow-y-auto p-4">
              {statsModal === 'count' ? (
                dailyRepairCounts.length === 0 ? (
                  <p className="text-sm text-slate-400 text-center py-6">Aucune réparation enregistrée.</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-[11px] font-black uppercase tracking-wider text-slate-400 border-b border-slate-100">
                        <th className="text-left py-2">Date</th>
                        <th className="text-right py-2">Réparations</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dailyRepairCounts.map(d => (
                        <tr key={d.dateStr} className="border-b border-slate-50 last:border-0">
                          <td className="py-2 font-semibold text-slate-700">{format(new Date(d.dateStr), 'dd/MM/yyyy')}</td>
                          <td className="py-2 text-right font-black text-slate-900">{d.count}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-slate-200">
                        <td className="py-2 font-black text-slate-500 text-xs uppercase tracking-wider">Total</td>
                        <td className="py-2 text-right font-black text-indigo-600">{stats.total}</td>
                      </tr>
                    </tfoot>
                  </table>
                )
              ) : (
                dailyNetProfit.length === 0 ? (
                  <p className="text-sm text-slate-400 text-center py-6">Aucune réparation livrée.</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-[11px] font-black uppercase tracking-wider text-slate-400 border-b border-slate-100">
                        <th className="text-left py-2">Date</th>
                        <th className="text-right py-2">Livrées</th>
                        <th className="text-right py-2">Facturé</th>
                        <th className="text-right py-2">Coût pièces</th>
                        <th className="text-right py-2">Bénéfice</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dailyNetProfit.map(d => (
                        <tr key={d.dateStr} className="border-b border-slate-50 last:border-0">
                          <td className="py-2 font-semibold text-slate-700">{format(new Date(d.dateStr), 'dd/MM/yyyy')}</td>
                          <td className="py-2 text-right text-slate-600">{d.count}</td>
                          <td className="py-2 text-right text-slate-600">{d.revenue.toFixed(3)}</td>
                          <td className="py-2 text-right text-rose-500">{d.complete ? d.partsCost.toFixed(3) : '—'}</td>
                          <td className="py-2 text-right font-black text-teal-600">{d.complete ? d.profit.toFixed(3) : 'Coûts manquants'}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-slate-200">
                        <td className="py-2 font-black text-slate-500 text-xs uppercase tracking-wider" colSpan={4}>Total</td>
                        <td className="py-2 text-right font-black text-teal-600">
                          {dailyNetProfit.every(d => d.complete)
                            ? `${dailyNetProfit.reduce((s, d) => s + d.profit, 0).toFixed(3)} ${currency}`
                            : 'Coûts historiques manquants'}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                )
              )}
            </div>
          </div>
        </div>
      )}

      {/* Form modal */}
      {isFormOpen && (
        <RepairForm
          repair={editingRepair}
          clients={clients}
          products={products}
          settings={settings}
          currency={currency}
          ownerId={ownerId}
          canCash={canCash}
          canEditProductSellPrice={can(userProfile, 'products', 'editSellPrice')}
          canEditPartSellPrice={can(userProfile, 'pieces', 'editSellPrice')}
          currentUserLabel={currentUserLabel}
          generateRepairNumber={generateRepairNumber}
          onClose={() => setIsFormOpen(false)}
          onSaved={(msg) => { setSuccess(msg); setIsFormOpen(false); }}
          onError={setError}
        />
      )}

      {/* Detail modal */}
      {detailRepair && (
        <RepairDetail
          repair={repairs.find(r => r.id === detailRepair.id) || detailRepair}
          currency={currency}
          canDelete={userProfile?.role === 'admin'}
          canCash={canCash}
          currentUserLabel={currentUserLabel}
          settings={settings}
          ownerId={ownerId}
          clients={clients}
          onEdit={() => { setEditingRepair(detailRepair); setDetailRepair(null); setIsFormOpen(true); }}
          onClose={() => setDetailRepair(null)}
          onDelete={() => handleDelete(detailRepair)}
          onError={setError}
          onSuccess={setSuccess}
        />
      )}
    </div>
  );
}

// ============================================================
//  FORMULAIRE DE RÉPARATION
// ============================================================
export function RepairForm({
  repair, clients, products, settings, currency, ownerId, currentUserLabel, canCash,
  canEditProductSellPrice, canEditPartSellPrice,
  generateRepairNumber, onClose, onSaved, onError
}: {
  repair: Repair | null;
  clients: Client[];
  products: Product[];
  settings: StoreSettings | null;
  currency: string;
  ownerId: string;
  currentUserLabel: string;
  canCash: boolean;
  canEditProductSellPrice: boolean;
  canEditPartSellPrice: boolean;
  generateRepairNumber: () => Promise<string>;
  onClose: () => void;
  onSaved: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const isEdit = !!repair;
  const [clientId, setClientId] = useState(repair?.clientId || '');
  const [clientSearch, setClientSearch] = useState('');
  const [deviceBrand, setDeviceBrand] = useState(repair?.deviceBrand || '');
  const [deviceModel, setDeviceModel] = useState(repair?.deviceModel || '');
  const [imei, setImei] = useState(repair?.imei || '');
  const [devicePassword, setDevicePassword] = useState(repair?.devicePassword || '');
  const [accessories, setAccessories] = useState(repair?.accessories || '');
  const [deviceCondition, setDeviceCondition] = useState(repair?.deviceCondition || '');
  const [problem, setProblem] = useState(repair?.problem || '');
  const [diagnostic, setDiagnostic] = useState(repair?.diagnostic || '');
  const [technician, setTechnician] = useState(repair?.technician || '');
  const [status, setStatus] = useState<RepairStatus>(repair?.status || 'recu');
  const [newRepairId] = useState(() => doc(collection(db, 'repairs')).id);
  const [estimatedCost] = useState(repair?.estimatedCost?.toString() || '');
  const [laborCost, setLaborCost] = useState(repair?.laborCost?.toString() || '');
  const [parts, setParts] = useState<RepairPart[]>(repair?.parts || []);
  const [paid, setPaid] = useState(repair?.paid?.toString() || '');
  const [warrantyDays, setWarrantyDays] = useState(
    repair?.warrantyDays?.toString() || settings?.defaultWarrantyDays?.toString() || '30'
  );
  const [partSearch, setPartSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [printingRepair, setPrintingRepair] = useState<Repair | null>(null);

  // Affiche l'erreur DIRECTEMENT dans la fenêtre (au lieu de seulement sur la page
  // principale, cachée derrière la modale) tout en la remontant aussi au parent.
  const showError = (msg: string) => { setLocalError(msg); onError(msg); };
  useEffect(() => {
    if (localError) { const t = setTimeout(() => setLocalError(null), 6000); return () => clearTimeout(t); }
  }, [localError]);

  // Déclenche automatiquement l'impression du bon de dépôt dès la création.
  useEffect(() => {
    if (printingRepair) {
      const t = setTimeout(() => window.print(), 300);
      return () => clearTimeout(t);
    }
  }, [printingRepair]);

  const selectedClient = clients.find(c => c.id === clientId);
  const filteredClients = clients.filter(c =>
    !clientSearch ||
    c.name.toLowerCase().includes(clientSearch.toLowerCase()) ||
    (c.phone || '').includes(clientSearch)
  ).slice(0, 6);

  const partProducts = products.filter(p =>
    isSparePart(p) && partSearch && (
      p.name.toLowerCase().includes(partSearch.toLowerCase()) ||
      (p.reference || '').toLowerCase().includes(partSearch.toLowerCase()) ||
      (p.barcode || '').includes(partSearch) ||
      ((p as RepairInventoryProduct).compatibleModels || []).some(model =>
        model.toLowerCase().includes(partSearch.toLowerCase())
      )
    )
  ).slice(0, 6);

  const partsTotal = parts.reduce((s, p) => s + p.total, 0);
  const financialSettings = isEdit
    ? {
      tvaEnabled: repair?.tvaEnabled === true && repair?.tvaOptIn === true,
      tva: repair?.tvaOptIn === true ? repair?.tvaRate || 0 : 0,
      tvaOptIn: repair?.tvaOptIn === true,
    }
    : settings;
  const repairTotals = computeTotals([
    { total: parseFloat(laborCost) || 0 },
    ...parts.map(part => ({ total: part.total })),
  ], 0, financialSettings);
  const total = repairTotals.total;
  // Sans droit d'encaissement (Technicien), le montant payé reste celui déjà enregistré.
  const paidValue = canCash ? (parseFloat(paid) || 0) : (repair?.paid || 0);
  const debt = Math.max(0, total - paidValue);

  const addPart = (p: Product) => {
    const existing = parts.find(x => x.productId === p.id);
    const currentQty = existing ? existing.quantity : 0;
    // En édition, le stock affiché exclut déjà ce que CETTE réparation a réservé :
    // la quantité totale disponible pour cette pièce est donc stock + déjà réservé.
    const maxAvailable = (p.stock || 0) + (isEdit ? currentQty : 0);
    if (maxAvailable <= currentQty) {
      showError(`Stock épuisé pour "${p.name}" — impossible d'ajouter cette pièce.`);
      return;
    }
    if (existing) {
      setParts(parts.map(x => x.productId === p.id
        ? { ...x, quantity: x.quantity + 1, total: (x.quantity + 1) * x.unitPrice }
        : x));
    } else {
      setParts([...parts, {
        productId: p.id, name: p.name, quantity: 1,
        inventoryCollection: (p as RepairInventoryProduct).inventoryCollection || 'products',
        unitPrice: p.sellPrice, total: p.sellPrice
      }]);
    }
    setPartSearch('');
  };

  const updatePartQty = (id: string, qty: number) => {
    if (qty <= 0) { setParts(parts.filter(p => p.productId !== id)); return; }
    const product = products.find(pr => pr.id === id);
    const existing = parts.find(p => p.productId === id);
    const currentQty = existing ? existing.quantity : 0;
    const maxAvailable = product ? (product.stock || 0) + (isEdit ? currentQty : 0) : Infinity;
    if (qty > maxAvailable) {
      showError(`Stock insuffisant pour "${product?.name || 'cette pièce'}" — maximum disponible : ${maxAvailable}.`);
      setParts(parts.map(p => p.productId === id ? { ...p, quantity: maxAvailable, total: maxAvailable * p.unitPrice } : p));
      return;
    }
    setParts(parts.map(p => p.productId === id ? { ...p, quantity: qty, total: qty * p.unitPrice } : p));
  };
  const updatePartPrice = (id: string, price: number) => {
    setParts(parts.map(p => p.productId === id ? { ...p, unitPrice: price, total: p.quantity * price } : p));
  };

  const handleSubmit = async () => {
    // Si l'utilisateur a tapé un nom dans la recherche sans cliquer sur le client :
    // - correspond à un seul client existant → sélection automatique
    // - ne correspond à aucun client → le client est CRÉÉ automatiquement avec ce nom
    // - correspond à plusieurs clients → on demande de préciser
    let effectiveClientId = clientId;
    let createdClientName = '';
    if (!effectiveClientId && clientSearch.trim()) {
      const q = clientSearch.trim().toLowerCase();
      const matches = clients.filter(c =>
        c.name.toLowerCase().includes(q) || (c.phone || '').includes(clientSearch.trim())
      );
      if (matches.length === 1) {
        effectiveClientId = matches[0].id;
        setClientId(matches[0].id);
        setClientSearch('');
      } else if (matches.length === 0) {
        try {
          const newClientRef = await addDoc(collection(db, 'clients'), {
            name: clientSearch.trim(), code: '', phone: '', address: '', debt: 0,
            ownerId, userId: ownerId
          });
          effectiveClientId = newClientRef.id;
          createdClientName = clientSearch.trim();
          setClientId(newClientRef.id);
          setClientSearch('');
        } catch (e: any) {
          showError("Impossible de créer le client : " + (e.message || e));
          return;
        }
      }
    }
    if (!effectiveClientId) {
      showError(clientSearch.trim()
        ? "Plusieurs clients correspondent — cliquez sur le bon client dans la liste de résultats."
        : "Sélectionnez un client.");
      return;
    }
    if (status === 'livre' && repair?.status !== 'livre' && !canCash) {
      showError("La livraison et l'encaissement sont réservés à l'administrateur ou à la vendeuse.");
      return;
    }
    if (!deviceBrand.trim()) { showError("Indiquez la marque de l'appareil."); return; }
    if (!deviceModel.trim()) { showError("Indiquez le modèle de l'appareil."); return; }
    setSaving(true);
    try {
      const client = clients.find(c => c.id === effectiveClientId);
      const now = new Date().toISOString();

      // Détecter changement de statut pour l'historique
      const statusChanged = !isEdit || repair?.status !== status;
      // Calcul garantie si livré
      let warrantyUntil = repair?.warrantyUntil;
      let deliveredAt = repair?.deliveredAt;
      if (status === 'livre' && repair?.status !== 'livre') {
        deliveredAt = now;
        const days = parseInt(warrantyDays) || 0;
        if (days > 0) {
          const d = new Date();
          d.setDate(d.getDate() + days);
          warrantyUntil = d.toISOString();
        }
      }

      const newLog: RepairLog = {
        date: now,
        note: isEdit
          ? (statusChanged ? `Statut → ${REPAIR_STATUS_LABELS[status]}` : 'Modification de la fiche')
          : 'Réparation créée',
        by: currentUserLabel,
      };
      // On n'ajoute le champ status au log que s'il a changé (Firestore refuse undefined).
      if (statusChanged) {
        newLog.status = status;
      }
      // Nettoyage défensif : purge toute valeur undefined des anciens logs
      // (des fiches créées avant ce correctif pouvaient contenir status: undefined,
      // ce que Firestore refuse lors de l'update).
      const cleanLogs = [...(repair?.logs || []), newLog].map(l => {
        const clean: RepairLog = { date: l.date, note: l.note };
        if (l.status !== undefined) clean.status = l.status;
        if (l.by !== undefined) clean.by = l.by;
        return clean;
      });
      const logs = cleanLogs;

      const payload: any = {
        clientId: effectiveClientId || '',
        clientName: client?.name || createdClientName || '',
        clientPhone: client?.phone || '',
        deviceBrand: deviceBrand.trim(),
        deviceModel: deviceModel.trim(),
        imei: imei.trim(),
        devicePassword: devicePassword.trim(),
        accessories: accessories.trim(),
        deviceCondition: deviceCondition.trim(),
        problem: problem.trim(),
        diagnostic: diagnostic.trim(),
        status,
        technician: technician.trim(),
        estimatedCost: parseFloat(estimatedCost) || 0,
        laborCost: parseFloat(laborCost) || 0,
        parts: parts.map(part => ({
          productId: part.productId,
          inventoryCollection: part.inventoryCollection || 'products',
          name: part.name,
          quantity: part.quantity,
          unitPrice: part.unitPrice,
          total: part.total,
        })),
        total,
        subtotal: repairTotals.subtotal,
        tva: repairTotals.tva,
        tvaEnabled: financialSettings?.tvaEnabled === true,
        tvaRate: financialSettings?.tvaEnabled === true ? Number(financialSettings.tva) || 0 : 0,
        tvaOptIn: financialSettings?.tvaEnabled === true,
        paid: paidValue,
        debt,
        warrantyDays: parseInt(warrantyDays) || 0,
        warrantyUntil: warrantyUntil || null,
        deliveredAt: deliveredAt || null,
        logs,
        ownerId,
        costsSeparated: true,
      };

      if (isEdit && repair) {
        // Le diff est calculé depuis le document lu dans la transaction : une
        // ancienne copie du formulaire ne peut donc pas appliquer deux fois le même delta.
        await runTransaction(db, async (tx) => {
          const repairRef = doc(db, 'repairs', repair.id);
          const repairSnap = await tx.get(repairRef);
          if (!repairSnap.exists()) throw new Error('La réparation n’existe plus.');
          const current = repairSnap.data();
          if ((current.ownerId || ownerId) !== ownerId) throw new Error('Cette réparation appartient à un autre magasin.');
          const nextVersion = await applyRepairStockChanges(tx, {
            repairId: repair.id,
            repairNumber: repair.number,
            ownerId,
            previousParts: (current.parts || []) as RepairPart[],
            nextParts: parts,
            stockVersion: Number(current.stockVersion) || 0,
            movementType: 'repair_part_adjustment',
            userLabel: currentUserLabel,
          });
          tx.update(repairRef, { ...payload, stockVersion: nextVersion });
        });
        let message = `Réparation ${repair.number} mise à jour.`;
        try {
          await apiFetch(`/financial/repairs/${encodeURIComponent(repair.id)}/costs`, { method: 'POST' });
        } catch {
          message += " Attention : le coût d'achat n'a pas pu être figé.";
        }
        onSaved(message);
      } else {
        const number = await generateRepairNumber();
        const repairRef = doc(db, 'repairs', newRepairId);
        await runTransaction(db, async (tx) => {
          const existingRepair = await tx.get(repairRef);
          if (existingRepair.exists()) {
            throw new Error('Cette demande a déjà été enregistrée. Rechargez la liste des réparations.');
          }
          const nextVersion = await applyRepairStockChanges(tx, {
            repairId: repairRef.id,
            repairNumber: number,
            ownerId,
            previousParts: [],
            nextParts: parts,
            stockVersion: 0,
            movementType: 'repair_part_adjustment',
            userLabel: currentUserLabel,
          });
          tx.set(repairRef, { ...payload, number, stockVersion: nextVersion, date: serverTimestamp() });
        });
        try {
          await apiFetch(`/financial/repairs/${encodeURIComponent(repairRef.id)}/costs`, { method: 'POST' });
        } catch {
          showError("Réparation enregistrée, mais le coût d'achat des pièces n'a pas pu être figé.");
        }
        // Ouvre le bon de dépôt pour impression immédiate (au lieu de fermer directement).
        setPrintingRepair({ ...payload, id: repairRef.id, number, date: { toDate: () => new Date() } } as Repair);
      }
    } catch (e: any) {
      showError("Erreur d'enregistrement : " + (e.message || e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-start sm:items-center justify-center p-2 sm:p-4 overflow-y-auto">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl my-4">
        <div className="flex items-center justify-between p-5 border-b border-slate-100 sticky top-0 bg-white rounded-t-3xl z-10">
          <h2 className="text-lg font-black font-display text-slate-900 flex items-center gap-2">
            <Wrench className="w-5 h-5 text-indigo-600" />
            {isEdit ? `Modifier ${repair?.number}` : 'Nouvelle réparation'}
          </h2>
          <button onClick={onClose} className="p-2 hover:bg-slate-50 rounded-xl"><X className="w-5 h-5 text-slate-400" /></button>
        </div>

        {localError && (
          <div className="mx-5 mt-4 flex items-start gap-2 bg-rose-50 border border-rose-200 text-rose-700 px-4 py-3 rounded-xl text-sm font-bold">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /> {localError}
          </div>
        )}

        <div className="p-5 space-y-5 max-h-[70vh] overflow-y-auto">
          {/* Client */}
          <section>
            <label className="text-xs font-black uppercase tracking-wider text-slate-400 mb-2 block">Client</label>
            {selectedClient ? (
              <div className="flex items-center justify-between bg-indigo-50 border border-indigo-100 rounded-xl px-4 py-2.5">
                <div className="flex items-center gap-2">
                  <User className="w-4 h-4 text-indigo-500" />
                  <span className="font-bold text-sm text-slate-800">{selectedClient.name}</span>
                  {selectedClient.phone && <span className="text-xs text-slate-500">· {selectedClient.phone}</span>}
                </div>
                <button onClick={() => { setClientId(''); setClientSearch(''); }} className="text-xs font-bold text-rose-500">Retirer</button>
              </div>
            ) : (
              <div className="relative">
                <input
                  value={clientSearch}
                  onChange={(e) => setClientSearch(e.target.value)}
                  placeholder="Rechercher un client (nom, téléphone)"
                  className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                />
                {clientSearch && filteredClients.length > 0 && (
                  <div className="absolute z-20 mt-1 w-full bg-white border border-slate-100 rounded-xl shadow-lg overflow-hidden">
                    {filteredClients.map(c => (
                      <button key={c.id} onClick={() => { setClientId(c.id); setClientSearch(''); }}
                        className="w-full text-left px-4 py-2.5 hover:bg-indigo-50 text-sm border-b border-slate-50 last:border-0">
                        <span className="font-bold text-slate-800">{c.name}</span>
                        {c.phone && <span className="text-xs text-slate-400 ml-2">{c.phone}</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </section>

          {/* Appareil */}
          <section className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-black uppercase tracking-wider text-slate-400 mb-2 block">Marque</label>
              <input list="repair-device-brands" value={deviceBrand} onChange={event => setDeviceBrand(event.target.value)}
                placeholder="Samsung, Apple"
                className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none" />
              <datalist id="repair-device-brands">
                {['Samsung', 'Apple', 'Huawei', 'Xiaomi', 'Oppo', 'Infinix', 'Nokia'].map(brand => <option key={brand} value={brand} />)}
              </datalist>
            </div>
            <div>
              <label className="text-xs font-black uppercase tracking-wider text-slate-400 mb-2 block">Modèle</label>
              <input list="repair-device-models" value={deviceModel} onChange={event => setDeviceModel(event.target.value)}
                placeholder="Galaxy S21, iPhone 12"
                className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none" />
              <datalist id="repair-device-models">
                {['Galaxy S21', 'iPhone 12'].map(model => <option key={model} value={model} />)}
              </datalist>
            </div>
            <Field label="IMEI / N° série" value={imei} onChange={setImei} placeholder="Optionnel" />
            <Field label="Code déverrouillage" value={devicePassword} onChange={setDevicePassword} placeholder="Confié par le client" />
            <Field label="Accessoires déposés" value={accessories} onChange={setAccessories} placeholder="Chargeur, coque..." full />
            <Field label="État à la réception" value={deviceCondition} onChange={setDeviceCondition} placeholder="Rayures, écran fissuré..." full />
          </section>

          {/* Panne */}
          <section className="space-y-3">
            <div>
              <label className="text-xs font-black uppercase tracking-wider text-slate-400 mb-2 block">Panne signalée *</label>
              <textarea value={problem} onChange={(e) => setProblem(e.target.value)} rows={2}
                placeholder="Décrivez le problème rapporté par le client"
                className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none resize-none" />
            </div>
            <div>
              <label className="text-xs font-black uppercase tracking-wider text-slate-400 mb-2 block">Diagnostic technicien</label>
              <textarea value={diagnostic} onChange={(e) => setDiagnostic(e.target.value)} rows={2}
                placeholder="Diagnostic après examen"
                className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none resize-none" />
            </div>
          </section>

          <section className="grid grid-cols-2 gap-3">
            <Field label="Technicien assigné" value={technician} onChange={setTechnician} placeholder="Nom du technicien" />
            <div>
              <label className="text-xs font-black uppercase tracking-wider text-slate-400 mb-2 block">Statut</label>
              <select value={status} onChange={(e) => setStatus(e.target.value as RepairStatus)}
                className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold focus:ring-2 focus:ring-indigo-500 outline-none cursor-pointer">
                {Object.entries(REPAIR_STATUS_LABELS)
                  .filter(([k]) => canCash || k !== 'livre' || repair?.status === 'livre')
                  .map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
          </section>

          {/* Pièces utilisées */}
          <section>
            <label className="text-xs font-black uppercase tracking-wider text-slate-400 mb-2 block flex items-center gap-1.5">
              <Package className="w-3.5 h-3.5" /> Pièces utilisées (déduites du stock)
            </label>
            <div className="relative mb-2">
              <input value={partSearch} onChange={(e) => setPartSearch(e.target.value)}
                placeholder="Ajouter une pièce (nom, référence, code-barres)..."
                className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none" />
              {partProducts.length > 0 && (
                <div className="absolute z-20 mt-1 w-full bg-white border border-slate-100 rounded-xl shadow-lg overflow-hidden">
                  {partProducts.map(p => {
                    const reserved = parts.find(x => x.productId === p.id)?.quantity || 0;
                    const outOfStock = ((p.stock || 0) + (isEdit ? reserved : 0)) <= reserved;
                    return (
                      <button key={p.id} onClick={() => addPart(p)} disabled={outOfStock}
                        className={`w-full text-left px-4 py-2.5 text-sm border-b border-slate-50 last:border-0 flex justify-between ${
                          outOfStock
                            ? 'bg-rose-50 cursor-not-allowed opacity-70'
                            : 'hover:bg-indigo-50'
                        }`}>
                        <span className={`font-bold ${outOfStock ? 'text-rose-600' : 'text-slate-800'}`}>{p.name}</span>
                        <span className={`text-xs ${outOfStock ? 'text-rose-500 font-bold' : 'text-slate-400'}`}>
                          {outOfStock ? 'Stock épuisé' : `Stock ${p.stock}`} · {p.sellPrice.toFixed(3)} {currency}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            {parts.length > 0 && (
              <div className="space-y-2">
                {parts.map(p => (
                  <div key={p.productId} className="flex items-center gap-2 bg-slate-50 rounded-xl px-3 py-2">
                    <span className="flex-1 text-sm font-semibold text-slate-700 truncate">{p.name}</span>
                    <input type="number" value={p.quantity} min={1}
                      onChange={(e) => updatePartQty(p.productId, parseInt(e.target.value) || 0)}
                      className="w-14 px-2 py-1 bg-white border border-slate-200 rounded-lg text-sm text-center" />
                    <span className="text-slate-300">×</span>
                    <input type="number" value={p.unitPrice} step="0.01"
                      onChange={(e) => updatePartPrice(p.productId, parseFloat(e.target.value) || 0)}
                      disabled={p.inventoryCollection === 'parts' ? !canEditPartSellPrice : !canEditProductSellPrice}
                      className="w-20 px-2 py-1 bg-white border border-slate-200 rounded-lg text-sm text-right" />
                    <span className="w-20 text-right text-sm font-black text-slate-800">{p.total.toFixed(3)}</span>
                    <button onClick={() => updatePartQty(p.productId, 0)} className="text-rose-400 hover:text-rose-600"><Trash2 className="w-4 h-4" /></button>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Coûts */}
          <section className="grid grid-cols-2 gap-3 bg-slate-50 rounded-2xl p-4">
            <Field label="Main d'œuvre" value={laborCost} onChange={setLaborCost} type="number" placeholder="0" full disabled={!canEditProductSellPrice} />
            {parts.length > 0 && (
              <div className="col-span-2 flex items-center justify-between text-sm border-t border-slate-200 pt-3">
                <span className="text-slate-500 font-semibold">Coût des pièces</span>
                <span className="font-black text-slate-700">{partsTotal.toFixed(3)} {currency}</span>
              </div>
            )}
            <div className="col-span-2 flex items-center justify-between border-t border-slate-200 pt-3">
              <span className="text-slate-800 font-black">TOTAL</span>
              <span className="font-black text-lg text-indigo-600">{total.toFixed(3)} {currency}</span>
            </div>
            {financialSettings?.tvaEnabled === true && (
              <div className="col-span-2 flex items-center justify-between text-xs text-slate-500">
                <span>TVA ({financialSettings.tva || 0}%)</span>
                <span>{repairTotals.tva.toFixed(3)} {currency}</span>
              </div>
            )}
            <Field label="Payé / acompte" value={canCash ? paid : String(paidValue)} onChange={setPaid} type="number" placeholder="0" disabled={!canCash} />
            <div>
              <label className="text-xs font-black uppercase tracking-wider text-slate-400 mb-2 block">Reste dû</label>
              <div className={cn("px-4 py-2.5 rounded-xl text-sm font-black", debt > 0 ? "bg-rose-50 text-rose-600" : "bg-emerald-50 text-emerald-600")}>
                {debt.toFixed(3)} {currency}
              </div>
            </div>
            <Field label="Garantie (jours)" value={warrantyDays} onChange={setWarrantyDays} type="number" placeholder="30" />
          </section>
        </div>

        <div className="flex gap-3 p-5 border-t border-slate-100 sticky bottom-0 bg-white rounded-b-3xl">
          <button onClick={onClose} className="flex-1 py-3 rounded-xl font-bold text-sm text-slate-600 bg-slate-100 hover:bg-slate-200 transition-colors">Annuler</button>
          <button onClick={handleSubmit} disabled={saving}
            className="flex-1 py-3 rounded-xl font-bold text-sm text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 transition-colors shadow-lg shadow-indigo-600/20">
            {saving ? 'Enregistrement...' : (isEdit ? 'Enregistrer' : 'Créer la réparation')}
          </button>
        </div>
      </div>

      {/* Confirmation + impression automatique du bon de dépôt après création */}
      {printingRepair && (
        <div className="fixed inset-0 z-[80] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm p-6 text-center">
            <CheckCircle className="w-12 h-12 text-emerald-500 mx-auto mb-3" />
            <h3 className="text-lg font-black text-slate-900">Réparation créée</h3>
            <p className="text-sm text-slate-500 mt-1">
              N° <span className="font-mono font-bold text-indigo-600">{printingRepair.number}</span>
            </p>
            <p className="text-xs text-slate-400 mt-2">Impression du bon de dépôt en cours...</p>
            <div className="flex gap-2 mt-5">
              <button
                onClick={() => window.print()}
                className="flex-1 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-sm transition-colors"
              >
                Réimprimer
              </button>
              <button
                onClick={() => onSaved(`Réparation ${printingRepair.number} créée.`)}
                className="flex-1 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-sm transition-colors"
              >
                Terminer
              </button>
            </div>
          </div>
        </div>
      )}

      {printingRepair && createPortal(
        <div className="print-container">
          <RepairTicket repair={printingRepair} ownerId={ownerId} />
        </div>,
        document.body
      )}
    </div>
  );
}

function Field({ label, value, onChange, placeholder, type = 'text', full = false, disabled = false }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string; full?: boolean; disabled?: boolean;
}) {
  return (
    <div className={full ? 'col-span-2' : ''}>
      <label className="text-xs font-black uppercase tracking-wider text-slate-400 mb-2 block">{label}</label>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} disabled={disabled}
        className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none disabled:opacity-60 disabled:cursor-not-allowed" />
    </div>
  );
}

// ============================================================
//  DÉTAIL RÉPARATION + suivi + changement rapide de statut
// ============================================================
export function RepairDetail({
  repair, currency, canDelete, canCash, currentUserLabel, settings, ownerId, clients,
  onEdit, onClose, onDelete, onError, onSuccess
}: {
  repair: Repair;
  currency: string;
  canDelete: boolean;
  canCash: boolean;
  currentUserLabel: string;
  settings: StoreSettings | null;
  ownerId: string;
  clients: Client[];
  onEdit: () => void;
  onClose: () => void;
  onDelete: () => void;
  onError: (m: string) => void;
  onSuccess: (m: string) => void;
}) {
  const [quickNote, setQuickNote] = useState('');
  const [updating, setUpdating] = useState(false);
  const [showDeliveryCaisse, setShowDeliveryCaisse] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [stockMovements, setStockMovements] = useState<RepairStockMovement[]>([]);

  // Affiche l'erreur DIRECTEMENT dans la fiche (au lieu de seulement sur la page
  // principale, cachée derrière la modale) tout en la remontant aussi au parent.
  const showError = (msg: string) => { setLocalError(msg); onError(msg); };
  useEffect(() => {
    if (localError) { const t = setTimeout(() => setLocalError(null), 6000); return () => clearTimeout(t); }
  }, [localError]);

  useEffect(() => onSnapshot(
    query(
      collection(db, 'stock_movements'),
      where('ownerId', '==', ownerId),
      where('repairId', '==', repair.id)
    ),
    snapshot => setStockMovements(snapshot.docs.map(item => ({
      id: item.id,
      ...item.data(),
    } as RepairStockMovement)).sort((a, b) => {
      const dateOf = (movement: RepairStockMovement) =>
        typeof movement.createdAt === 'string'
          ? new Date(movement.createdAt).getTime()
          : movement.createdAt?.toDate?.().getTime() || 0;
      return dateOf(b) - dateOf(a);
    })),
    error => setLocalError(`Impossible de charger l’historique des mouvements : ${error.message}`)
  ), [ownerId, repair.id]);

  const repairClient = clients.find(c => c.id === repair.clientId) || null;

  const changeStatus = async (newStatus: RepairStatus) => {
    if (newStatus === repair.status && !quickNote.trim()) return;
    if (newStatus === 'livre' && repair.status !== 'livre' && !canCash) {
      showError("La livraison et l'encaissement sont réservés à l'administrateur ou à la vendeuse.");
      return;
    }
    // La livraison passe systématiquement par la caisse (encaissement/remise/crédit).
    if (newStatus === 'livre' && repair.status !== 'livre') {
      setShowDeliveryCaisse(true);
      return;
    }
    setUpdating(true);
    try {
      const now = new Date().toISOString();
      const log: RepairLog = {
        date: now,
        status: newStatus !== repair.status ? newStatus : undefined,
        note: quickNote.trim() || `Statut → ${REPAIR_STATUS_LABELS[newStatus]}`,
        by: currentUserLabel,
      };
      await updateDoc(doc(db, 'repairs', repair.id), {
        status: newStatus,
        logs: [...(repair.logs || []), log],
      });
      setQuickNote('');
      onSuccess(`Statut mis à jour : ${REPAIR_STATUS_LABELS[newStatus]}`);
    } catch (e: any) {
      showError("Échec de la mise à jour : " + (e.message || e));
    } finally { setUpdating(false); }
  };

  // Confirmation de la livraison depuis la fenêtre de caisse : encaissement + remise.
  // Toute réparation livrée doit être payée : le reste dû éventuel est obligatoirement
  // crédité au compte du client (menu Clients) — jamais laissé comme simple dette sur
  // la fiche réparation, d'où l'exigence d'un client déjà enregistré.
  const confirmDelivery = async (paidNow: number, discount: number) => {
    setUpdating(true);
    try {
      const now = new Date().toISOString();
      const days = repair.warrantyDays || settings?.defaultWarrantyDays || 0;
      let warrantyUntil = repair.warrantyUntil;
      if (days > 0) { const d = new Date(); d.setDate(d.getDate() + days); warrantyUntil = d.toISOString(); }

      const deliveryTotals = computeTotals([
        { total: Number(repair.laborCost) || 0 },
        ...(repair.parts || []).map(part => ({ total: Number(part.total) || 0 })),
      ], discount, {
        tvaEnabled: repair.tvaEnabled === true && repair.tvaOptIn === true,
        tva: repair.tvaOptIn === true ? repair.tvaRate || 0 : 0,
      });
      const actualDiscount = Math.max(0, Math.round((repair.total - deliveryTotals.total) * 1000) / 1000);
      const dueAfterDiscount = Math.max(0, Math.round((repair.debt - actualDiscount) * 1000) / 1000);
      const restAfterPaidNow = Math.max(0, Math.round((dueAfterDiscount - paidNow) * 1000) / 1000);
      const newTotal = deliveryTotals.total;
      const newPaid = Math.round((repair.paid + paidNow) * 1000) / 1000;

      if (restAfterPaidNow > 0 && !repairClient) {
        throw new Error("Un client doit être enregistré sur la fiche pour livrer une réparation avec un reste dû.");
      }

      let note = `Livré — Encaissé ${paidNow.toFixed(3)} ${currency}`;
      if (actualDiscount > 0) note += `, remise ${actualDiscount.toFixed(3)} ${currency}`;
      if (restAfterPaidNow > 0) note += `, ${restAfterPaidNow.toFixed(3)} ${currency} crédités au compte de ${repairClient?.name}`;

      const log: RepairLog = { date: now, status: 'livre', note, by: currentUserLabel };
      const logs = [...(repair.logs || []), log];

      if (restAfterPaidNow > 0) {
        await runTransaction(db, async (tx) => {
          const clientRef = doc(db, 'clients', repairClient!.id);
          const clientSnap = await tx.get(clientRef);
          if (!clientSnap.exists()) throw new Error('Client introuvable');
          const currentClientDebt = clientSnap.data().debt || 0;
          tx.update(doc(db, 'repairs', repair.id), {
            status: 'livre', deliveredAt: now, warrantyUntil: warrantyUntil || null,
            total: newTotal, subtotal: deliveryTotals.subtotal, tva: deliveryTotals.tva,
            tvaEnabled: repair.tvaEnabled === true && repair.tvaOptIn === true,
            tvaRate: repair.tvaOptIn === true ? repair.tvaRate || 0 : 0,
            tvaOptIn: repair.tvaOptIn === true,
            paid: newPaid, debt: 0, discount: actualDiscount, logs,
          });
          tx.update(clientRef, { debt: currentClientDebt + restAfterPaidNow });
          tx.set(doc(collection(db, 'client_debts')), {
            clientId: repairClient!.id,
            type: 'reparation',
            reference: repair.number,
            amount: restAfterPaidNow,
            date: serverTimestamp(),
            by: currentUserLabel,
            ownerId,
          });
        });
      } else {
        await updateDoc(doc(db, 'repairs', repair.id), {
          status: 'livre', deliveredAt: now, warrantyUntil: warrantyUntil || null,
          total: newTotal, subtotal: deliveryTotals.subtotal, tva: deliveryTotals.tva,
          tvaEnabled: repair.tvaEnabled === true && repair.tvaOptIn === true,
          tvaRate: repair.tvaOptIn === true ? repair.tvaRate || 0 : 0,
          tvaOptIn: repair.tvaOptIn === true,
          paid: newPaid, debt: 0, discount: actualDiscount, logs,
        });
      }

      setShowDeliveryCaisse(false);
      onSuccess('Réparation livrée et encaissement enregistré.');
    } catch (e: any) {
      showError("Échec de l'encaissement : " + (e.message || e));
    } finally { setUpdating(false); }
  };

  const addNote = async () => {
    if (!quickNote.trim()) return;
    await changeStatus(repair.status);
  };

  const [printing, setPrinting] = useState(false);
  const handlePrint = () => {
    setPrinting(true);
    setTimeout(() => {
      window.print();
      setTimeout(() => setPrinting(false), 500);
    }, 100);
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-start sm:items-center justify-center p-2 sm:p-4 overflow-y-auto">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl my-4">
        <div className="flex items-center justify-between p-5 border-b border-slate-100 sticky top-0 bg-white rounded-t-3xl z-10">
          <div>
            <h2 className="text-lg font-black font-display text-indigo-600 font-mono">{repair.number}</h2>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <span className={cn("inline-block px-2 py-0.5 rounded-lg text-[10px] font-black uppercase tracking-wider border", STATUS_STYLES[repair.status])}>
                {REPAIR_STATUS_LABELS[repair.status]}
              </span>
              {repair.date?.toDate && (
                <span className="flex items-center gap-1 text-[10px] font-bold text-slate-400">
                  <Calendar className="w-3 h-3" /> Créé le {format(repair.date.toDate(), 'dd/MM/yyyy à HH:mm')}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onEdit} className="p-2 hover:bg-indigo-50 rounded-xl text-indigo-500" title="Modifier"><Edit3 className="w-4 h-4" /></button>
            {canDelete && <button onClick={onDelete} className="p-2 hover:bg-rose-50 rounded-xl text-rose-500" title="Supprimer"><Trash2 className="w-4 h-4" /></button>}
            <button onClick={onClose} className="p-2 hover:bg-slate-50 rounded-xl"><X className="w-5 h-5 text-slate-400" /></button>
          </div>
        </div>

        {localError && (
          <div className="mx-5 mt-4 flex items-start gap-2 bg-rose-50 border border-rose-200 text-rose-700 px-4 py-3 rounded-xl text-sm font-bold">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /> {localError}
          </div>
        )}

        <div className="p-5 space-y-5 max-h-[70vh] overflow-y-auto">
          {/* Client + appareil */}
          <div className="grid grid-cols-2 gap-4">
            <InfoBlock icon={User} label="Client" value={repair.clientName || 'Sans client'} sub={repair.clientPhone} />
            <InfoBlock icon={Smartphone} label="Appareil" value={`${repair.deviceBrand || ''} ${repair.deviceModel || ''}`.trim() || '—'} sub={repair.imei ? `IMEI ${repair.imei}` : undefined} />
          </div>

          <div className="bg-slate-50 rounded-2xl p-4 space-y-2 text-sm">
            <div><span className="font-black text-slate-400 text-xs uppercase tracking-wider">Panne : </span><span className="text-slate-700 font-medium">{repair.problem}</span></div>
            {repair.diagnostic && <div><span className="font-black text-slate-400 text-xs uppercase tracking-wider">Diagnostic : </span><span className="text-slate-700 font-medium">{repair.diagnostic}</span></div>}
            {repair.accessories && <div><span className="font-black text-slate-400 text-xs uppercase tracking-wider">Accessoires : </span><span className="text-slate-700 font-medium">{repair.accessories}</span></div>}
            {repair.deviceCondition && <div><span className="font-black text-slate-400 text-xs uppercase tracking-wider">État : </span><span className="text-slate-700 font-medium">{repair.deviceCondition}</span></div>}
            {repair.technician && <div><span className="font-black text-slate-400 text-xs uppercase tracking-wider">Technicien : </span><span className="text-slate-700 font-medium">{repair.technician}</span></div>}
          </div>

          {/* Pièces */}
          {repair.parts?.length > 0 && (
            <div>
              <p className="text-xs font-black uppercase tracking-wider text-slate-400 mb-2 flex items-center gap-1.5"><Package className="w-3.5 h-3.5" /> Pièces utilisées</p>
              <div className="space-y-1">
                {repair.parts.map((p, i) => (
                  <div key={i} className="flex justify-between text-sm bg-slate-50 rounded-lg px-3 py-1.5">
                    <span className="text-slate-700">{p.name} × {p.quantity}</span>
                    <span className="font-bold text-slate-800">{p.total.toFixed(3)} {currency}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Totaux */}
          <div className="grid grid-cols-3 gap-3">
            <MoneyBlock label="Total" value={repair.total} currency={currency} accent />
            <MoneyBlock label="Payé" value={repair.paid} currency={currency} />
            <MoneyBlock label="Reste dû" value={repair.debt} currency={currency} danger={repair.debt > 0} />
          </div>

          {repair.warrantyUntil && (
            <div className={cn("flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold",
              new Date(repair.warrantyUntil) > new Date() ? "bg-teal-50 text-teal-700" : "bg-slate-50 text-slate-400")}>
              <Shield className="w-4 h-4" />
              Garantie jusqu'au {format(new Date(repair.warrantyUntil), 'dd/MM/yyyy')}
              {new Date(repair.warrantyUntil) < new Date() && ' (expirée)'}
            </div>
          )}

          {/* Changement rapide de statut */}
          <div className="border-t border-slate-100 pt-4">
            <p className="text-xs font-black uppercase tracking-wider text-slate-400 mb-2">Changer le statut</p>
            <div className="flex flex-wrap gap-2 mb-3">
              {(Object.keys(REPAIR_STATUS_LABELS) as RepairStatus[])
                .filter(s => canCash || s !== 'livre' || repair.status === 'livre')
                .map(s => (
                <button key={s} disabled={updating} onClick={() => changeStatus(s)}
                  className={cn("px-3 py-1.5 rounded-lg text-xs font-black uppercase tracking-wider border transition-all disabled:opacity-50",
                    s === repair.status ? STATUS_STYLES[s] + " ring-2 ring-offset-1 ring-indigo-300" : "bg-white text-slate-500 border-slate-200 hover:border-indigo-200")}>
                  {REPAIR_STATUS_LABELS[s]}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <input value={quickNote} onChange={(e) => setQuickNote(e.target.value)}
                placeholder="Ajouter une note de suivi (optionnel)..."
                className="flex-1 px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none" />
              <button onClick={addNote} disabled={updating || !quickNote.trim()}
                className="px-4 py-2.5 bg-slate-800 hover:bg-slate-900 text-white rounded-xl text-sm font-bold disabled:opacity-40">Noter</button>
            </div>
          </div>

          {/* Historique */}
          {repair.logs?.length > 0 && (
            <div className="border-t border-slate-100 pt-4">
              <p className="text-xs font-black uppercase tracking-wider text-slate-400 mb-3 flex items-center gap-1.5"><History className="w-3.5 h-3.5" /> Historique de suivi</p>
              <div className="space-y-3">
                {[...repair.logs].reverse().map((log, i) => (
                  <div key={i} className="flex gap-3">
                    <div className="w-2 h-2 rounded-full bg-indigo-400 mt-1.5 shrink-0" />
                    <div className="flex-1 -mt-0.5">
                      <p className="text-sm text-slate-700 font-medium">{log.note}</p>
                      <p className="text-[11px] text-slate-400 font-medium">
                        {format(new Date(log.date), 'dd/MM/yyyy HH:mm')}{log.by ? ` · ${log.by}` : ''}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {stockMovements.length > 0 && (
            <div className="border-t border-slate-100 pt-4">
              <p className="text-xs font-black uppercase tracking-wider text-slate-400 mb-3 flex items-center gap-1.5">
                <Package className="w-3.5 h-3.5" /> Mouvements de pièces
              </p>
              <div className="space-y-2">
                {stockMovements.map(movement => {
                  const date = typeof movement.createdAt === 'string'
                    ? new Date(movement.createdAt)
                    : movement.createdAt?.toDate?.();
                  return (
                    <div key={movement.id} className="flex items-start justify-between gap-3 text-sm">
                      <div>
                        <p className="font-semibold text-slate-700">{movement.productName} · {movement.delta > 0 ? 'Restitution' : 'Sortie'}</p>
                        <p className="text-[11px] text-slate-400">
                          {date && !Number.isNaN(date.getTime()) ? format(date, 'dd/MM/yyyy HH:mm') : 'Date indisponible'}
                          {movement.userLabel ? ` · ${movement.userLabel}` : ''}
                        </p>
                      </div>
                      <span className={cn('font-black tabular-nums', movement.delta > 0 ? 'text-emerald-600' : 'text-rose-600')}>
                        {movement.delta > 0 ? '+' : ''}{movement.delta}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="flex gap-3 p-5 border-t border-slate-100 sticky bottom-0 bg-white rounded-b-3xl">
          <button onClick={handlePrint} className="flex items-center justify-center gap-2 flex-1 py-3 rounded-xl font-bold text-sm text-slate-600 bg-slate-100 hover:bg-slate-200 transition-colors">
            <FileText className="w-4 h-4" /> Imprimer le bon
          </button>
          <button onClick={onClose} className="flex-1 py-3 rounded-xl font-bold text-sm text-white bg-indigo-600 hover:bg-indigo-700 transition-colors">Fermer</button>
        </div>
      </div>

      {printing && createPortal(
        <div className="print-container">
          <RepairTicket repair={repair} ownerId={repair.ownerId} />
        </div>,
        document.body
      )}

      {showDeliveryCaisse && (
        <DeliveryCaisseModal
          repair={repair}
          client={repairClient}
          currency={currency}
          updating={updating}
          onClose={() => setShowDeliveryCaisse(false)}
          onConfirm={confirmDelivery}
        />
      )}
    </div>
  );
}

// ============================================================
//  FENÊTRE DE CAISSE À LA LIVRAISON (encaissement, remise, crédit client)
// ============================================================
function DeliveryCaisseModal({
  repair, client, currency, updating, onClose, onConfirm
}: {
  repair: Repair;
  client: Client | null;
  currency: string;
  updating: boolean;
  onClose: () => void;
  onConfirm: (paidNow: number, discount: number) => void;
}) {
  const [discountInput, setDiscountInput] = useState('0');
  const [paidInput, setPaidInput] = useState(repair.debt.toFixed(3));
  const [formError, setFormError] = useState<string | null>(null);

  const discount = Math.max(0, parseFloat(discountInput.replace(',', '.')) || 0);
  const dueAfterDiscount = Math.max(0, Math.round((repair.debt - discount) * 1000) / 1000);
  const paidNow = Math.max(0, parseFloat(paidInput.replace(',', '.')) || 0);
  const restDue = Math.max(0, Math.round((dueAfterDiscount - paidNow) * 1000) / 1000);

  const handleLivrer = () => {
    if (discount > repair.debt + 0.001) { setFormError("La remise ne peut pas dépasser le reste dû."); return; }
    if (paidNow > dueAfterDiscount + 0.001) { setFormError("Le montant encaissé ne peut pas dépasser le montant dû après remise."); return; }
    if (restDue > 0.001 && !client) {
      setFormError("Un client doit être enregistré sur la fiche pour livrer avec un reste dû : le montant restant sera automatiquement ajouté à sa dette (menu Clients).");
      return;
    }
    setFormError(null);
    onConfirm(paidNow, discount);
  };

  return (
    <div className="fixed inset-0 z-[60] bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between p-5 border-b border-slate-100">
          <h2 className="text-lg font-black text-slate-900 flex items-center gap-2">
            <DollarSign className="w-5 h-5 text-teal-600" /> Caisse — Livraison
          </h2>
          <button onClick={onClose} className="p-2 hover:bg-slate-50 rounded-xl"><X className="w-5 h-5 text-slate-400" /></button>
        </div>

        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <MoneyBlock label="Total réparation" value={repair.total} currency={currency} accent />
            <MoneyBlock label="Reste dû actuel" value={repair.debt} currency={currency} danger={repair.debt > 0} />
          </div>

          {client ? (
            <p className="text-xs font-bold text-slate-500">Client : <span className="text-slate-800">{client.name}</span></p>
          ) : (
            <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 text-amber-700 px-3 py-2.5 rounded-xl text-xs font-bold">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              Aucun client enregistré sur cette fiche — la livraison ne sera possible que si le montant est encaissé en totalité.
            </div>
          )}

          <div>
            <label className="text-xs font-black uppercase tracking-wider text-slate-400 mb-1.5 block">Remise ({currency})</label>
            <input
              type="text" inputMode="decimal" value={discountInput}
              onChange={(e) => { if (/^[\d.,]*$/.test(e.target.value)) setDiscountInput(e.target.value); }}
              className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold focus:ring-2 focus:ring-indigo-500 outline-none"
            />
          </div>

          <div>
            <label className="text-xs font-black uppercase tracking-wider text-slate-400 mb-1.5 block">Montant encaissé maintenant ({currency})</label>
            <input
              type="text" inputMode="decimal" value={paidInput}
              onChange={(e) => { if (/^[\d.,]*$/.test(e.target.value)) setPaidInput(e.target.value); }}
              className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold focus:ring-2 focus:ring-indigo-500 outline-none"
            />
          </div>

          <div className="bg-slate-50 rounded-xl p-3 flex items-center justify-between">
            <span className="text-xs font-black uppercase tracking-wider text-slate-400">
              {restDue > 0 ? 'Reste à créditer au client' : 'Reste après cet encaissement'}
            </span>
            <span className={cn("font-black text-sm", restDue > 0 ? "text-rose-600" : "text-emerald-600")}>{restDue.toFixed(3)} {currency}</span>
          </div>

          {formError && (
            <div className="flex items-start gap-2 bg-rose-50 text-rose-700 text-xs font-bold px-3 py-2.5 rounded-xl">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /> {formError}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2 p-5 border-t border-slate-100">
          <button
            onClick={handleLivrer} disabled={updating}
            className="w-full py-3 rounded-xl font-bold text-sm text-white bg-teal-600 hover:bg-teal-700 transition-colors disabled:opacity-50"
          >
            {restDue > 0 ? 'Livrer & Créditer le reste au client' : 'Livrer & Encaisser'}
          </button>
          <button onClick={onClose} disabled={updating} className="w-full py-2.5 rounded-xl font-bold text-sm text-slate-500 hover:bg-slate-50 transition-colors">
            Annuler
          </button>
        </div>
      </div>
    </div>
  );
}

function InfoBlock({ icon: Icon, label, value, sub }: { icon: any; label: string; value: string; sub?: string }) {
  return (
    <div className="bg-slate-50 rounded-2xl p-4">
      <div className="flex items-center gap-1.5 text-xs font-black uppercase tracking-wider text-slate-400 mb-1"><Icon className="w-3.5 h-3.5" /> {label}</div>
      <p className="font-bold text-slate-800 truncate">{value}</p>
      {sub && <p className="text-xs text-slate-400 font-medium truncate">{sub}</p>}
    </div>
  );
}

function MoneyBlock({ label, value, currency, accent, danger }: { label: string; value: number; currency: string; accent?: boolean; danger?: boolean }) {
  return (
    <div className={cn("rounded-2xl p-3 text-center", accent ? "bg-indigo-50" : danger ? "bg-rose-50" : "bg-slate-50")}>
      <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">{label}</p>
      <p className={cn("font-black text-sm mt-0.5", accent ? "text-indigo-600" : danger ? "text-rose-600" : "text-slate-700")}>
        {(value || 0).toFixed(2)} {currency}
      </p>
    </div>
  );
}
