import { useEffect, useMemo, useState } from 'react';
import {
  addDoc, collection, deleteDoc, doc, getDocs, onSnapshot, query, runTransaction,
  serverTimestamp, setDoc, updateDoc, where, writeBatch,
} from 'firebase/firestore';
import { PackagePlus, Search, Pencil, Trash2, Plus, Minus, X, Boxes, ArrowDownToLine, History, Barcode } from 'lucide-react';
import { auth, db } from '../firebase';
import { Product, UserProfile } from '../types';
import { cn, decodeAzertyBarcode, isSparePart } from '../lib/utils';
import { can } from '../lib/permissions';

interface SparePart {
  id: string;
  name: string;
  description?: string;
  brand: string;
  category: string;
  compatibleModels: string[];
  reference?: string;
  barcode?: string;
  sellPrice: number;
  stock: number;
  lowStockAlert: number;
  stockVersion?: number;
  legacyProductId?: string;
  active?: boolean;
  ownerId: string;
}

type LegacyProduct = Product & {
  brand?: string;
  compatibleModels?: string[] | string;
  inventoryType?: string;
  active?: boolean;
};

interface PartCost {
  buyPrice: number;
  ownerId: string;
}

interface PartsProps {
  userProfile: UserProfile | null;
}

const BRANDS = ['HONOR', 'Huawei', 'Infinix', 'Iphone', 'Itel', 'Nokia', 'Oppo', 'Poco', 'Realme', 'Redmi', 'Samsung', 'Standard', 'Techno', 'Tout-Standard'];
const CATEGORIES = ['AFF JK', 'Afficheur TFT', 'SUB', 'Batterie'];
const BARCODE_L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const BARCODE_G = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111'];
const BARCODE_R = ['1110010', '1100110', '1101100', '1000010', '1011100', '1001110', '1010000', '1000100', '1001000', '1110100'];
const BARCODE_PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];

const emptyForm = {
  description: '',
  brand: BRANDS[0],
  category: CATEGORIES[0],
  compatibleModels: '',
  reference: '',
  barcode: '',
  buyPrice: '',
  sellPrice: '0',
  stock: '0',
  lowStockAlert: '0',
};

function makeEan13(): string {
  const digits = `619${Math.floor(100000000 + Math.random() * 900000000)}`;
  const checksum = (10 - [...digits].reduce((sum, digit, index) => sum + Number(digit) * (index % 2 === 0 ? 1 : 3), 0) % 10) % 10;
  return `${digits}${checksum}`;
}

function ean13Svg(value: string): string {
  const left = value.slice(1, 7).split('').map((digit, index) =>
    BARCODE_PARITY[Number(value[0])][index] === 'L' ? BARCODE_L[Number(digit)] : BARCODE_G[Number(digit)]
  ).join('');
  const right = value.slice(7).split('').map(digit => BARCODE_R[Number(digit)]).join('');
  const bits = `101${left}01010${right}101`;
  const bars = [...bits].map((bit, index) => bit === '1'
    ? `<rect x="${index}" y="0" width="1" height="${index < 3 || (index >= 45 && index < 50) || index >= 92 ? 56 : 50}"/>`
    : '').join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 95 60"><rect width="95" height="60" fill="white"/><g fill="black">${bars}</g></svg>`;
}

function money(value: number): string {
  return `${(Math.round(value * 1000) / 1000).toFixed(3)} DT`;
}

function inferBrand(name: string): string {
  const brand = name.match(/\b(Apple|Honor|Huawei|iPhone|Oppo|Samsung|Xiaomi|Redmi|Realme|Tecno|Infinix)\b/i)?.[0];
  if (!brand) return 'Autre';
  return brand.toLowerCase() === 'apple' ? 'iPhone' : brand;
}

export default function Parts({ userProfile }: PartsProps) {
  const ownerId = userProfile?.ownerId || userProfile?.uid || '';
  const isAdmin = userProfile?.role === 'admin';
  const canViewBuyPrice = can(userProfile, 'pieces', 'viewBuyPrice');
  const canEditSellPrice = can(userProfile, 'pieces', 'editSellPrice');
  const canAddEdit = can(userProfile, 'pieces', 'addEdit');
  const canAdjustStock = can(userProfile, 'pieces', 'adjustStock');
  const canDelete = can(userProfile, 'pieces', 'delete');
  const canManage = canAddEdit || canAdjustStock || canDelete;
  const userId = auth.currentUser?.uid;
  const [parts, setParts] = useState<SparePart[]>([]);
  const [costs, setCosts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [brandFilter, setBrandFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [partCategories, setPartCategories] = useState<string[]>(CATEGORIES);
  const [brandInputOpen, setBrandInputOpen] = useState(false);
  const [newBrand, setNewBrand] = useState('');
  const [categoryModalOpen, setCategoryModalOpen] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [deletingCategory, setDeletingCategory] = useState<string | null>(null);
  const [editing, setEditing] = useState<SparePart | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [legacyPreview, setLegacyPreview] = useState<LegacyProduct[]>([]);
  const [legacyBackupDownloaded, setLegacyBackupDownloaded] = useState(false);
  const [importing, setImporting] = useState(false);
  const [historyPart, setHistoryPart] = useState<SparePart | null>(null);
  const [historyRows, setHistoryRows] = useState<Array<{ id: string; type: string; delta: number; createdAt?: { toDate?: () => Date } }>>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const playScanBeep = () => {
    try {
      const audioContext = new AudioContext();
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = 950;
      gain.gain.setValueAtTime(0.08, audioContext.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.12);
      oscillator.connect(gain);
      gain.connect(audioContext.destination);
      oscillator.start();
      oscillator.stop(audioContext.currentTime + 0.12);
    } catch (issue) {
      console.warn('Le bip du scanner est indisponible.', issue);
    }
  };

  useEffect(() => {
    if (!ownerId) return;
    const unsubscribeParts = onSnapshot(
      query(collection(db, 'parts'), where('ownerId', '==', ownerId)),
      snapshot => {
        setParts(snapshot.docs.map(item => ({ id: item.id, ...item.data() } as SparePart)));
        setLoading(false);
      },
      issue => {
        setError(`Impossible de charger les pièces : ${issue.message}`);
        setLoading(false);
      }
    );
    const unsubscribeCategories = onSnapshot(
      query(collection(db, 'categories'), where('ownerId', '==', ownerId)),
      snapshot => {
        const saved = snapshot.docs
          .filter(item => item.data().type === 'part')
          .map(item => String(item.data().name || '').trim())
          .filter(Boolean);
        setPartCategories([...new Set([...CATEGORIES, ...saved])]);
      },
      issue => setError(`Impossible de charger les catégories : ${issue.message}`)
    );
    if (!canViewBuyPrice) {
      setCosts({});
      return () => {
        unsubscribeParts();
        unsubscribeCategories();
      };
    }
    const unsubscribeCosts = onSnapshot(
      query(collection(db, 'part_costs'), where('ownerId', '==', ownerId)),
      snapshot => setCosts(Object.fromEntries(
        snapshot.docs.map(item => [item.id, Number(item.data().buyPrice) || 0])
      )),
      issue => setError(`Impossible de charger les coûts : ${issue.message}`)
    );
    return () => {
      unsubscribeParts();
      unsubscribeCategories();
      unsubscribeCosts();
    };
  }, [ownerId, isAdmin, canViewBuyPrice]);

  const visibleParts = useMemo(() => parts
    .filter(part => part.active !== false)
    .filter(part => !brandFilter || part.brand === brandFilter)
    .filter(part => !categoryFilter || part.category === categoryFilter)
    .filter(part => {
      const term = search.trim().toLowerCase();
      return !term || [
        part.name, part.brand, part.category, part.reference, part.barcode,
        ...(part.compatibleModels || []),
      ].some(value => value?.toLowerCase().includes(term));
    })
    .sort((a, b) => a.name.localeCompare(b.name)), [parts, brandFilter, categoryFilter, search]);
  const availableBrands = [...new Set([...BRANDS, ...parts.map(part => part.brand).filter(Boolean)])].sort();
  const availableCategories = [...new Set([...partCategories, ...parts.map(part => part.category).filter(Boolean)])].sort();

  const openNew = () => {
    setEditing(null);
    setForm(emptyForm);
    setError('');
    setSuccess('');
    setIsModalOpen(true);
  };

  const openEdit = (part: SparePart) => {
    setEditing(part);
    setIsModalOpen(true);
    setForm({
      brand: part.brand,
      description: part.description || part.name,
      category: part.category,
      compatibleModels: part.compatibleModels.join(', '),
      reference: part.reference || '',
      barcode: part.barcode || '',
      buyPrice: String(costs[part.id] ?? ''),
      sellPrice: String(part.sellPrice),
      stock: String(part.stock),
      lowStockAlert: String(part.lowStockAlert),
    });
    setError('');
  };

  const savePart = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canAddEdit || saving) return;
    const sellPrice = Number(form.sellPrice.replace(',', '.'));
    const buyPrice = isAdmin ? Number(form.buyPrice.replace(',', '.')) : 0;
    const stock = Number(form.stock);
    const lowStockAlert = Number(form.lowStockAlert);
    if (!Number.isFinite(sellPrice) || sellPrice < 0 || (isAdmin && (!Number.isFinite(buyPrice) || buyPrice < 0))) {
      setError('Les prix doivent être des nombres positifs.');
      return;
    }
    if (!Number.isInteger(stock) || stock < 0 || !Number.isInteger(lowStockAlert) || lowStockAlert < 0) {
      setError('Le stock et le seuil d’alerte doivent être des entiers positifs.');
      return;
    }
    if (isAdmin && sellPrice < buyPrice) {
      setError('Le prix de vente doit être supérieur ou égal au prix d’achat.');
      return;
    }
    setSaving(true);
    setError('');
    const partData: Record<string, unknown> = {
      name: form.description.trim() || `${form.brand} ${form.category}`,
      description: form.description.trim() || `${form.brand} ${form.category}`,
      brand: form.brand,
      category: form.category,
      compatibleModels: form.compatibleModels.split(/[,\n;]/).map(model => model.trim()).filter(Boolean),
      reference: form.reference.trim(),
      barcode: form.barcode.trim(),
      ...(canEditSellPrice || !editing ? { sellPrice: Math.round(sellPrice * 1000) / 1000 } : {}),
      stock,
      lowStockAlert,
      inventoryType: 'spare_part',
      active: true,
      ownerId,
      updatedAt: serverTimestamp(),
    };
    try {
      if (editing) {
        await runTransaction(db, async transaction => {
          const ref = doc(db, 'parts', editing.id);
          const currentSnapshot = await transaction.get(ref);
          if (!currentSnapshot.exists()) throw new Error('Cette pièce n’existe plus.');
          const currentStock = Number(currentSnapshot.data().stock);
          if (stock !== currentStock) {
            throw new Error('Le stock doit être ajusté avec les boutons + / − pour conserver l’historique des mouvements.');
          }
          transaction.update(ref, partData);
          if (isAdmin) {
            transaction.set(doc(db, 'part_costs', editing.id), {
              buyPrice: Math.round(buyPrice * 1000) / 1000,
              ownerId,
              updatedAt: serverTimestamp(),
            });
          }
        });
        setSuccess('Pièce modifiée.');
      } else {
        const partRef = doc(collection(db, 'parts'));
        const costRef = doc(db, 'part_costs', partRef.id);
        const movementRef = doc(db, 'stock_movements', `part_${partRef.id}_v1`);
        await runTransaction(db, async transaction => {
          transaction.set(partRef, {
            ...partData,
            stockVersion: stock > 0 ? 1 : 0,
            ...(stock > 0 ? { lastStockMovementId: movementRef.id } : {}),
            createdAt: serverTimestamp(),
          });
          if (isAdmin) {
            transaction.set(costRef, {
              buyPrice: Math.round(buyPrice * 1000) / 1000,
              ownerId,
              updatedAt: serverTimestamp(),
            });
          }
          if (stock > 0) {
            transaction.set(movementRef, {
              type: isAdmin ? 'part_initial_stock' : 'part_restock',
              inventoryCollection: 'parts',
              productId: partRef.id,
              productName: partData.name,
              delta: stock,
              quantity: stock,
              version: 1,
              ownerId,
              userId,
              userLabel: userProfile?.name || userProfile?.email || 'Administrateur',
              createdAt: serverTimestamp(),
            });
          }
        });
        setSuccess('Pièce créée et stock initial enregistré.');
      }
      setEditing(null);
      setForm(emptyForm);
      setIsModalOpen(false);
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : String(issue));
    } finally {
      setSaving(false);
    }
  };

  const adjustStock = async (part: SparePart, delta: number) => {
    if (!canAdjustStock || !userId) return;
    setError('');
    const version = (Number(part.stockVersion) || 0) + 1;
    const movementId = `part_${part.id}_v${version}`;
    try {
      await runTransaction(db, async transaction => {
        const partRef = doc(db, 'parts', part.id);
        const movementRef = doc(db, 'stock_movements', movementId);
        const [partSnapshot, movementSnapshot] = await Promise.all([
          transaction.get(partRef),
          transaction.get(movementRef),
        ]);
        if (!partSnapshot.exists()) throw new Error('Cette pièce n’existe plus.');
        if (movementSnapshot.exists()) throw new Error('Cette opération a déjà été enregistrée.');
        const current = partSnapshot.data();
        const nextStock = Number(current.stock) + delta;
        if (!Number.isInteger(nextStock) || nextStock < 0) throw new Error('Le stock ne peut pas être négatif.');
        transaction.update(partRef, {
          stock: nextStock,
          stockVersion: version,
          lastStockMovementId: movementId,
          updatedAt: serverTimestamp(),
        });
        transaction.set(movementRef, {
          type: delta > 0 ? 'part_restock' : 'part_manual_adjustment',
          inventoryCollection: 'parts',
          productId: part.id,
          productName: part.name,
          delta,
          quantity: Math.abs(delta),
          version,
          ownerId,
          userId,
          userLabel: userProfile?.name || userProfile?.email || 'Administrateur',
          createdAt: serverTimestamp(),
        });
      });
      setSuccess(`Stock de « ${part.name} » mis à jour.`);
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : String(issue));
    }
  };

  const archivePart = async (part: SparePart) => {
    if (!canDelete || !window.confirm(`Supprimer « ${part.name} » ? La fiche et son historique seront conservés.`)) return;
    try {
      await updateDoc(doc(db, 'parts', part.id), { active: false, updatedAt: serverTimestamp() });
      setSuccess('Pièce archivée sans supprimer ses données.');
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : String(issue));
    }
  };

  const addCategory = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = newCategoryName.trim();
    if (!canAddEdit || !name) return;
    try {
      await addDoc(collection(db, 'categories'), { name, type: 'part', ownerId });
      setForm(current => ({ ...current, category: name }));
      setNewCategoryName('');
    } catch (issue) {
      setError(`Impossible d’ajouter la catégorie : ${issue instanceof Error ? issue.message : String(issue)}`);
    }
  };

  const removeCategory = async (name: string) => {
    if (!canDelete) return;
    try {
      const snapshot = await getDocs(query(
        collection(db, 'categories'),
        where('ownerId', '==', ownerId),
      ));
      const matches = snapshot.docs.filter(item => item.data().type === 'part' && item.data().name === name);
      await Promise.all(matches.map(item => deleteDoc(item.ref)));
      setDeletingCategory(null);
    } catch (issue) {
      setError(`Impossible de supprimer la catégorie : ${issue instanceof Error ? issue.message : String(issue)}`);
    }
  };

  const resetPartCategories = async () => {
    if (!canDelete) return;
    try {
      const snapshot = await getDocs(query(collection(db, 'categories'), where('ownerId', '==', ownerId)));
      const batch = writeBatch(db);
      snapshot.docs.filter(item => item.data().type === 'part').forEach(item => batch.delete(item.ref));
      CATEGORIES.forEach((name, index) => batch.set(doc(db, 'categories', `part_category_${index}_${ownerId}`), {
        name,
        type: 'part',
        ownerId,
      }));
      await batch.commit();
    } catch (issue) {
      setError(`Impossible de réinitialiser les catégories : ${issue instanceof Error ? issue.message : String(issue)}`);
    }
  };

  const printBarcode = () => {
    const ean = form.barcode.trim();
    if (!/^\d{13}$/.test(ean)) {
      setError('Saisissez ou générez un code-barres EAN-13 valide avant impression.');
      return;
    }
    const printWindow = window.open('', '_blank', 'width=420,height=320');
    if (!printWindow) {
      setError('La fenêtre d’impression a été bloquée par le navigateur.');
      return;
    }
    printWindow.document.open();
    printWindow.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Code-barres</title><style>@page{margin:8mm}body{font-family:Arial,sans-serif;text-align:center;padding:12px}.label{width:70mm;margin:auto}svg{width:100%;height:44mm}.text{font:13px monospace;letter-spacing:2px}</style></head><body><main class="label">${ean13Svg(ean)}<div class="text">${ean}</div></main></body></html>`);
    printWindow.document.close();
    printWindow.onafterprint = () => printWindow.close();
    printWindow.setTimeout(() => {
      printWindow.focus();
      printWindow.print();
    }, 250);
  };

  useEffect(() => {
    if (!isModalOpen) return;
    let buffer = '';
    let lastKeyTime = 0;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.altKey || event.metaKey) return;
      if (['Tab', 'Escape', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      const now = Date.now();
      const interval = lastKeyTime ? now - lastKeyTime : 0;
      lastKeyTime = now;
      const target = event.target as HTMLElement | null;
      const isInputFocused = target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
      const isBarcodeInputFocused = target?.tagName === 'INPUT' &&
        (target as HTMLInputElement).placeholder.toLowerCase().includes('douchette');
      if (event.key.length === 1) {
        if (isInputFocused && !isBarcodeInputFocused && interval > 120) {
          buffer = event.key;
          return;
        }
        buffer = interval > 120 ? event.key : buffer + event.key;
      } else if (event.key === 'Enter') {
        const barcode = decodeAzertyBarcode(buffer.trim());
        buffer = '';
        lastKeyTime = 0;
        if (barcode.length >= 3) {
          playScanBeep();
          setForm(current => ({ ...current, barcode }));
          setSuccess(`Code détecté avec succès : ${barcode}`);
          window.setTimeout(() => setSuccess(''), 4500);
          event.preventDefault();
          event.stopPropagation();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isModalOpen]);

  const openHistory = async (part: SparePart) => {
    setHistoryPart(part);
    setHistoryRows([]);
    setHistoryLoading(true);
    try {
      const snapshot = await getDocs(query(
        collection(db, 'stock_movements'),
        where('ownerId', '==', ownerId),
      ));
      setHistoryRows(snapshot.docs
        .filter(item => item.data().inventoryCollection === 'parts' && item.data().productId === part.id)
        .map(item => ({
          id: item.id,
          type: String(item.data().type || ''),
          delta: Number(item.data().delta) || 0,
          createdAt: item.data().createdAt,
        }))
        .sort((a, b) => (b.createdAt?.toDate?.().getTime() || 0) - (a.createdAt?.toDate?.().getTime() || 0)));
    } catch (issue) {
      setError(issue instanceof Error ? `Historique indisponible : ${issue.message}` : `Historique indisponible : ${String(issue)}`);
    } finally {
      setHistoryLoading(false);
    }
  };

  const previewLegacyImport = async () => {
    if (!isAdmin || importing) return;
    setError('');
    setSuccess('');
    setImporting(true);
    try {
      const [productsSnapshot, partsSnapshot, costsSnapshot] = await Promise.all([
        getDocs(query(collection(db, 'products'), where('ownerId', '==', ownerId))),
        getDocs(query(collection(db, 'parts'), where('ownerId', '==', ownerId))),
        getDocs(query(collection(db, 'product_costs'), where('ownerId', '==', ownerId))),
      ]);
      const productCosts = Object.fromEntries(
        costsSnapshot.docs.map(cost => [cost.id, Number(cost.data().buyPrice) || 0])
      );
      const existingIds = new Set(partsSnapshot.docs.map(part => part.id));
      const importedLegacyIds = new Set(partsSnapshot.docs
        .map(part => part.data().legacyProductId)
        .filter((id): id is string => typeof id === 'string'));
      const candidates = productsSnapshot.docs
        .map(product => ({
          id: product.id,
          ...product.data(),
          buyPrice: productCosts[product.id] ?? Number(product.data().buyPrice) ?? 0,
        } as LegacyProduct))
        .filter(product => isSparePart(product) &&
          !existingIds.has(product.id) &&
          !importedLegacyIds.has(product.id));
      setLegacyPreview(candidates);
      setLegacyBackupDownloaded(false);
      setSuccess(`${candidates.length} pièce(s) à importer. Aucun document n’a été modifié.`);
    } catch (issue) {
      setError(issue instanceof Error ? `Aperçu impossible : ${issue.message}` : `Aperçu impossible : ${String(issue)}`);
    } finally {
      setImporting(false);
    }
  };

  const downloadLegacyImportBackup = () => {
    if (!isAdmin || legacyPreview.length === 0) return;
    const blob = new Blob([JSON.stringify({
      createdAt: new Date().toISOString(),
      ownerId,
      products: legacyPreview,
    }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `phone-clinic-parts-import-backup-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setLegacyBackupDownloaded(true);
  };

  const confirmLegacyImport = async () => {
    if (!isAdmin || importing || !legacyBackupDownloaded || legacyPreview.length === 0) return;
    const userId = auth.currentUser?.uid;
    if (!userId) {
      setError('Session utilisateur absente : impossible d’importer les pièces.');
      return;
    }
    setError('');
    setSuccess('');
    setImporting(true);
    try {
      const currentParts = await getDocs(query(collection(db, 'parts'), where('ownerId', '==', ownerId)));
      const existingIds = new Set(currentParts.docs.map(part => part.id));
      const importedLegacyIds = new Set(currentParts.docs
        .map(part => part.data().legacyProductId)
        .filter((id): id is string => typeof id === 'string'));
      const candidates = legacyPreview.filter(product =>
        !existingIds.has(product.id) && !importedLegacyIds.has(product.id)
      );
      const userLabel = userProfile?.name || userProfile?.email || 'Administrateur';
      let importedCount = 0;

      for (let start = 0; start < candidates.length; start += 150) {
        const batch = writeBatch(db);
        const chunk = candidates.slice(start, start + 150);
        chunk.forEach(product => {
          const brand = product.brand?.trim() || inferBrand(product.name || '');
          const category = product.category?.trim() || 'Pièce importée';
          const partName = `${brand} ${category}`;
          const stockValue = Number(product.stock);
          const stock = Number.isFinite(stockValue) ? Math.max(0, Math.floor(stockValue)) : 0;
          const lowStockValue = Number(product.lowStockAlert);
          const lowStockAlert = Number.isFinite(lowStockValue) ? Math.max(0, Math.floor(lowStockValue)) : 0;
          const sellPriceValue = Number(product.sellPrice);
          const sellPrice = Number.isFinite(sellPriceValue) ? Math.max(0, sellPriceValue) : 0;
          const buyPriceValue = Number(product.buyPrice);
          const buyPrice = Number.isFinite(buyPriceValue) ? Math.max(0, buyPriceValue) : 0;
          const compatibleModels = Array.isArray(product.compatibleModels)
            ? product.compatibleModels
            : typeof product.compatibleModels === 'string'
              ? product.compatibleModels.split(/[,\n;]/).map(model => model.trim()).filter(Boolean)
              : [];
          const partRef = doc(db, 'parts', product.id);
          const costRef = doc(db, 'part_costs', product.id);
          const movementId = `part_${product.id}_v1`;

          batch.set(partRef, {
            name: partName,
            brand,
            category,
            compatibleModels,
            reference: product.reference || '',
            barcode: product.barcode || '',
            sellPrice,
            stock,
            lowStockAlert,
            inventoryType: 'spare_part',
            active: product.active !== false,
            ownerId,
            legacyProductId: product.id,
            stockVersion: stock > 0 ? 1 : 0,
            ...(stock > 0 ? { lastStockMovementId: movementId } : {}),
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
          batch.set(costRef, { buyPrice, ownerId, updatedAt: serverTimestamp() });
          if (stock > 0) {
            batch.set(doc(db, 'stock_movements', movementId), {
              type: 'part_initial_stock',
              inventoryCollection: 'parts',
              productId: product.id,
              productName: partName,
              delta: stock,
              quantity: stock,
              version: 1,
              ownerId,
              userId,
              userLabel,
              createdAt: serverTimestamp(),
            });
          }
        });
        await batch.commit();
        importedCount += chunk.length;
      }

      setLegacyPreview([]);
      setSuccess(`${importedCount} pièce(s) importée(s) dans le catalogue. Les produits d’origine sont conservés.`);
    } catch (issue) {
      setError(issue instanceof Error ? `Import interrompu : ${issue.message}` : `Import interrompu : ${String(issue)}`);
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="mt-1 flex items-center gap-3 text-3xl font-black text-slate-900">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-indigo-600 text-white"><Boxes /></span>
            Pièces détachées
          </h1>
          <p className="mt-1 text-xs font-black uppercase tracking-wider text-slate-500">PIÈCES UTILISÉES POUR LES RÉPARATIONS (ATELIER)</p>
        </div>
        {(canAddEdit || isAdmin) && <div className="flex flex-wrap gap-2">
          {isAdmin && <button onClick={() => void previewLegacyImport()} disabled={importing} className="inline-flex items-center justify-center gap-2 rounded-xl border border-indigo-200 bg-white px-4 py-3 text-sm font-bold text-indigo-700 hover:bg-indigo-50 disabled:opacity-50"><ArrowDownToLine size={17} /> Importer depuis Articles</button>}
          {canAddEdit && <button onClick={openNew} className="inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-bold uppercase text-white hover:bg-indigo-700"><PackagePlus size={17} /> + NOUVELLE PIÈCE</button>}
        </div>}
      </header>

      {(error || success) && <div className={cn('rounded-xl border px-4 py-3 text-sm font-semibold', error ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700')}>{error || success}</div>}

      {isAdmin && legacyPreview.length > 0 && <section className="space-y-3 rounded-2xl border border-amber-200 bg-amber-50 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><h2 className="font-black text-amber-900">Aperçu de l’import</h2><p className="text-xs text-amber-800">{legacyPreview.length} produit(s)-pièce absent(s) de « Pièces Détachées ».</p></div>
          <div className="flex flex-wrap gap-2">
            <button onClick={downloadLegacyImportBackup} className="rounded-xl border border-amber-300 bg-white px-4 py-2.5 text-sm font-bold text-amber-800">Télécharger la sauvegarde JSON</button>
            <button onClick={() => void confirmLegacyImport()} disabled={importing || !legacyBackupDownloaded} className="rounded-xl bg-amber-700 px-4 py-2.5 text-sm font-bold text-white hover:bg-amber-800 disabled:opacity-50">{importing ? 'Import en cours…' : 'Confirmer l’import'}</button>
          </div>
        </div>
        <ul className="max-h-48 space-y-1 overflow-y-auto text-xs text-amber-950">
          {legacyPreview.map(product => <li key={product.id} className="rounded-lg bg-white/70 px-3 py-2">{product.name || product.category || product.id} · Stock {Number.isFinite(Number(product.stock)) ? Math.max(0, Math.floor(Number(product.stock))) : 0}</li>)}
        </ul>
      </section>}

      <section className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm md:grid-cols-[1fr_220px_220px]">
        <label className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Rechercher une pièce..." className="w-full rounded-xl border border-slate-200 py-2.5 pl-10 pr-3 text-sm outline-none focus:border-indigo-400" />
        </label>
        <select value={categoryFilter} onChange={event => setCategoryFilter(event.target.value)} className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm">
          <option value="">Toutes les catégories</option>{availableCategories.map(category => <option key={category}>{category}</option>)}
        </select>
        <select value={brandFilter} onChange={event => setBrandFilter(event.target.value)} className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm">
          <option value="">Toutes les marques</option>{availableBrands.map(brand => <option key={brand}>{brand}</option>)}
        </select>
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h2 className="font-black text-slate-800">Stock des pièces</h2><span className="text-xs font-bold text-slate-400">{visibleParts.length} référence(s)</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[850px] text-left text-sm">
            <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500"><tr>
              <th className="px-5 py-3">PIÈCE</th><th className="px-4 py-3">CATÉGORIE</th>{canViewBuyPrice && <th className="px-4 py-3 text-right">PRIX ACHAT</th>}<th className="px-4 py-3 text-right">PRIX VENTE</th><th className="px-4 py-3 text-center">STOCK</th>{canManage && <th className="px-5 py-3 text-right">ACTIONS</th>}
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? <tr><td colSpan={4 + (canViewBuyPrice ? 1 : 0) + (canManage ? 1 : 0)} className="px-5 py-12 text-center text-slate-400">Chargement...</td></tr>
                : visibleParts.length === 0 ? <tr><td colSpan={4 + (canViewBuyPrice ? 1 : 0) + (canManage ? 1 : 0)} className="px-5 py-12 text-center text-slate-400">Aucune pièce ne correspond à la recherche.</td></tr>
                : visibleParts.map(part => <tr key={part.id} className="hover:bg-slate-50/70">
                  <td className="px-5 py-4"><p className="font-bold text-slate-800">{part.description || part.name}</p><p className="mt-1 text-xs text-slate-400">{part.reference || part.barcode ? `REF: ${part.reference || part.barcode}` : ''}</p><p className="mt-1 text-xs text-slate-500">{part.compatibleModels.join(', ') || '—'}</p></td>
                  <td className="px-4 py-4"><span className="rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-bold text-indigo-700">{part.category}</span></td>
                  {canViewBuyPrice && <td className="px-4 py-4 text-right font-mono text-xs">{money(costs[part.id] || 0)}</td>}
                  <td className="px-4 py-4 text-right font-mono font-bold">{money(part.sellPrice)}</td>
                  <td className="px-4 py-4 text-center"><span className={cn('rounded-lg px-2.5 py-1 font-black tabular-nums', part.stock <= part.lowStockAlert ? 'bg-rose-50 text-rose-600' : 'bg-emerald-50 text-emerald-700')}>{part.stock}</span>{part.stock <= part.lowStockAlert && <p className="mt-1 text-[10px] font-bold text-rose-500">Stock bas</p>}
                    {canAdjustStock && <div className="mt-2 flex items-center justify-center gap-1.5">
                    <button title="Retirer une unité" aria-label="Retirer une unité" onClick={() => void adjustStock(part, -1)} disabled={part.stock <= 0} className="rounded-lg border border-slate-200 p-2 text-slate-500 hover:bg-slate-100 disabled:opacity-40"><Minus size={14} /></button>
                    <button title="Ajouter une unité" onClick={() => void adjustStock(part, 1)} className="rounded-lg border border-slate-200 p-2 text-slate-500 hover:bg-slate-100"><Plus size={14} /></button>
                    <button title="+ À STOCK" onClick={() => void adjustStock(part, 1)} className="inline-flex items-center gap-1 rounded-lg border border-emerald-150 bg-emerald-50 px-2 py-2 text-xs font-bold text-emerald-700 hover:bg-emerald-100">+ À STOCK</button>
                    </div>}
                  </td>
                  {canManage && <td className="px-5 py-4"><div className="flex justify-end gap-1.5">
                    <button title="Historique" onClick={() => void openHistory(part)} className="rounded-lg border border-slate-200 p-2 text-slate-500 hover:bg-slate-100"><History size={14} /></button>
                    {canAddEdit && <button title="Modifier" onClick={() => openEdit(part)} className="rounded-lg border border-indigo-100 p-2 text-indigo-600 hover:bg-indigo-50"><Pencil size={14} /></button>}
                    {canDelete && <button title="Supprimer" onClick={() => void archivePart(part)} className="rounded-lg border border-rose-100 p-2 text-rose-500 hover:bg-rose-50"><Trash2 size={14} /></button>}
                  </div></td>}
                </tr>)}
            </tbody>
          </table>
        </div>
      </section>

      {canAddEdit && isModalOpen && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/50 p-4" onMouseDown={event => { if (event.target === event.currentTarget) { setEditing(null); setForm(emptyForm); setIsModalOpen(false); } }}>
          <form onSubmit={savePart} className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-3xl bg-white shadow-2xl">
            <div className="sticky top-0 flex items-center justify-between border-b border-slate-100 bg-white px-6 py-5">
              <h2 className="text-xl font-black text-slate-900">{editing ? 'Modifier la pièce' : 'Nouvelle Pièce'}</h2>
              <button type="button" onClick={() => { setEditing(null); setForm(emptyForm); setIsModalOpen(false); }} className="rounded-xl p-2 text-slate-400 hover:bg-slate-100"><X /></button>
            </div>
            <div className="space-y-3 px-6 pt-5">
              <div className="flex items-center justify-between gap-2">
                <label className="text-xs font-black uppercase tracking-wider text-slate-700">RÉFÉRENCE / CODE À BARRE</label>
                <span className="rounded-full border border-emerald-100 bg-emerald-50 px-2.5 py-1 text-[10px] font-bold text-emerald-700">Scanner Douchette Prêt</span>
              </div>
              <div className="relative flex gap-2">
                <Barcode className="absolute left-3 top-3 h-4 w-4 text-indigo-500" />
                <input value={form.barcode} onChange={event => setForm({ ...form, barcode: event.target.value })} placeholder="Pointez votre douchette et flashez" className="min-w-0 flex-1 rounded-xl border border-slate-200 py-2.5 pl-10 pr-3 font-mono text-sm" />
                <button type="button" onClick={() => setForm(current => ({ ...current, barcode: makeEan13() }))} className="rounded-lg bg-slate-100 px-3 text-xs font-black uppercase text-slate-700">GÉNÉRER</button>
                <button type="button" onClick={printBarcode} className="rounded-lg bg-indigo-600 px-3 text-xs font-black uppercase text-white">IMPRIMER</button>
              </div>
              <p className="text-[10px] leading-relaxed text-slate-500">Vous pouvez scanner directement le produit à tout moment pendant que ce formulaire est ouvert. La douchette remplira automatiquement ce champ et émettra un signal sonore.</p>
            </div>
            <div className="grid gap-4 p-6 sm:grid-cols-2">
              <label className="space-y-1 text-xs font-bold text-slate-600 sm:col-span-2">Description<input required value={form.description} onChange={event => setForm({ ...form, description: event.target.value })} className="w-full rounded-xl border border-slate-200 px-3 py-3 text-sm" /></label>
              <label className="space-y-1 text-xs font-bold text-slate-600">Marque<div className="flex gap-2"><select required value={form.brand} onChange={event => setForm({ ...form, brand: event.target.value })} className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm">{availableBrands.map(brand => <option key={brand}>{brand}</option>)}</select><button type="button" aria-label="Ajouter une marque" onClick={() => setBrandInputOpen(value => !value)} className="rounded-xl border border-slate-200 px-3 text-lg text-indigo-600">+</button></div>{brandInputOpen && <span className="flex gap-2 pt-2"><input value={newBrand} onChange={event => setNewBrand(event.target.value)} placeholder="Nouvelle marque" className="min-w-0 flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm" /><button type="button" onClick={() => { const value = newBrand.trim(); if (value) setForm(current => ({ ...current, brand: value })); setNewBrand(''); setBrandInputOpen(false); }} className="rounded-xl bg-indigo-600 px-3 text-xs font-bold text-white">+</button></span>}</label>
              <label className="space-y-1 text-xs font-bold text-slate-600">Catégorie<div className="flex gap-2"><select required value={form.category} onChange={event => setForm({ ...form, category: event.target.value })} className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm">{availableCategories.map(category => <option key={category}>{category}</option>)}</select><button type="button" aria-label="Gérer les catégories" onClick={() => setCategoryModalOpen(true)} className="rounded-xl border border-slate-200 px-3 text-lg text-indigo-600">+</button></div></label>
              <label className="space-y-1 text-xs font-bold text-slate-600">Stock initial<input required min="0" step="1" type="number" value={form.stock} onChange={event => setForm({ ...form, stock: event.target.value })} disabled={!!editing} className="w-full rounded-xl border border-slate-200 px-3 py-3 text-sm disabled:bg-slate-50" />{editing && <span className="block text-[10px] font-medium text-slate-400">Ajustez le stock depuis les boutons + / − du tableau.</span>}</label>
              <label className="space-y-1 text-xs font-bold text-slate-600">Alerte stock faible<input required min="0" step="1" type="number" value={form.lowStockAlert} onChange={event => setForm({ ...form, lowStockAlert: event.target.value })} className="w-full rounded-xl border border-slate-200 px-3 py-3 text-sm" /></label>
              {canViewBuyPrice && <label className="space-y-1 text-xs font-bold text-slate-600">Prix achat (DT)<input required min="0" step="0.001" type="number" value={form.buyPrice} onChange={event => setForm({ ...form, buyPrice: event.target.value })} readOnly={!isAdmin} className="w-full rounded-xl border border-slate-200 px-3 py-3 text-sm read-only:bg-slate-100" /></label>}
              <label className="space-y-1 text-xs font-bold text-slate-600">Prix vente (DT)<input required min="0" step="0.001" type="number" value={form.sellPrice} onChange={event => setForm({ ...form, sellPrice: event.target.value })} readOnly={!canEditSellPrice} className="w-full rounded-xl border border-slate-200 px-3 py-3 text-sm read-only:bg-slate-100" /></label>
              <label className="space-y-1 text-xs font-bold text-slate-600 sm:col-span-2">Modèles compatibles<textarea value={form.compatibleModels} onChange={event => setForm({ ...form, compatibleModels: event.target.value })} placeholder="Ex: iPhone 12, 12 Pro" rows={2} className="w-full rounded-xl border border-slate-200 px-3 py-3 text-sm" /></label>
              <label className="space-y-1 text-xs font-bold text-slate-600">Référence<input value={form.reference} onChange={event => setForm({ ...form, reference: event.target.value })} placeholder="Ex: REF-001" className="w-full rounded-xl border border-slate-200 px-3 py-3 text-sm" /></label>
            </div>
            {error && <p className="mx-6 rounded-xl bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">{error}</p>}
            <div className="flex justify-end gap-3 border-t border-slate-100 p-6">
              <button type="button" onClick={() => { setEditing(null); setForm(emptyForm); setIsModalOpen(false); }} className="rounded-xl px-4 py-3 text-sm font-bold text-slate-600 hover:bg-slate-100">Annuler</button>
              <button disabled={saving} className="rounded-xl bg-indigo-600 px-5 py-3 text-sm font-bold text-white hover:bg-indigo-700 disabled:opacity-50">{saving ? 'Enregistrement...' : editing ? 'Enregistrer' : 'Ajouter'}</button>
            </div>
          </form>
        </div>
      )}

      {canAddEdit && categoryModalOpen && <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/50 p-4" onMouseDown={event => { if (event.target === event.currentTarget) setCategoryModalOpen(false); }}>
        <section className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl">
          <header className="flex items-center justify-between border-b border-slate-100 px-5 py-4"><h2 className="text-sm font-black uppercase tracking-wider text-slate-800">GÉRER LES CATÉGORIES</h2><button onClick={() => setCategoryModalOpen(false)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100"><X size={18} /></button></header>
          <form onSubmit={event => void addCategory(event)} className="space-y-2 p-5">
            <label className="block text-xs font-black uppercase tracking-wider text-slate-600">NOUVEAU NOM DE CATÉGORIE</label>
            <div className="flex gap-2"><input required value={newCategoryName} onChange={event => setNewCategoryName(event.target.value)} className="min-w-0 flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm" /><button className="rounded-xl bg-indigo-600 px-3 py-2 text-xs font-black uppercase text-white">+ AJOUTER</button></div>
          </form>
          <div className="px-5 pb-4"><h3 className="mb-2 border-b border-slate-100 pb-2 text-xs font-black uppercase tracking-wider text-slate-600">CATÉGORIES EXISTANTES ({availableCategories.length})</h3><ul className="max-h-48 space-y-1 overflow-y-auto">{availableCategories.map(category => <li key={category} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm"><span>{category}</span>{deletingCategory === category ? <span className="flex gap-2"><button onClick={() => setDeletingCategory(null)} className="text-xs">Non</button><button onClick={() => void removeCategory(category)} className="text-xs font-bold text-rose-600">Oui</button></span> : <button title={`Supprimer la catégorie ${category}`} onClick={() => setDeletingCategory(category)} className="text-slate-400 hover:text-rose-600"><Trash2 size={15} /></button>}</li>)}</ul></div>
          <footer className="flex items-center justify-between border-t border-slate-100 bg-slate-50/70 px-5 py-3"><button onClick={() => void resetPartCategories()} className="text-[10px] font-black uppercase tracking-wider text-slate-500 underline">RÉINIT. DÉFAUTS</button><button onClick={() => setCategoryModalOpen(false)} className="rounded-lg bg-slate-200 px-4 py-2 text-xs font-black uppercase text-slate-700">FERMER</button></footer>
        </section>
      </div>}

      {historyPart && <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/50 p-4" onMouseDown={event => { if (event.target === event.currentTarget) setHistoryPart(null); }}>
        <section className="max-h-[85vh] w-full max-w-2xl overflow-hidden rounded-3xl bg-white shadow-2xl">
          <header className="flex items-center justify-between border-b border-slate-100 px-6 py-5">
            <div><p className="text-xs font-black uppercase tracking-widest text-indigo-600">Mouvements de stock</p><h2 className="text-lg font-black text-slate-900">{historyPart.name}</h2></div>
            <button onClick={() => setHistoryPart(null)} className="rounded-xl p-2 text-slate-400 hover:bg-slate-100"><X /></button>
          </header>
          <div className="max-h-[65vh] overflow-y-auto p-6">
            {historyLoading ? <p className="py-8 text-center text-sm text-slate-400">Chargement de l’historique…</p>
              : historyRows.length === 0 ? <p className="py-8 text-center text-sm text-slate-400">Aucun mouvement enregistré.</p>
              : <ul className="space-y-2">{historyRows.map(row => <li key={row.id} className="flex items-center justify-between gap-4 rounded-xl border border-slate-100 px-4 py-3">
                <div><p className="text-sm font-bold text-slate-700">{row.type.replaceAll('_', ' ')}</p><p className="text-xs text-slate-400">{row.createdAt?.toDate?.().toLocaleString('fr-FR') || 'Date inconnue'}</p></div>
                <span className={cn('font-mono font-black', row.delta > 0 ? 'text-emerald-600' : 'text-rose-600')}>{row.delta > 0 ? '+' : ''}{row.delta}</span>
              </li>)}</ul>}
          </div>
        </section>
      </div>}
    </div>
  );
}
