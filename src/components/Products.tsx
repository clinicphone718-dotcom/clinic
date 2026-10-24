import React, { useState, useEffect, useRef } from 'react';
import { collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, query, setDoc, getDocs, where, getDocFromServer, deleteField, writeBatch, runTransaction } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { Product, Category, StoreSettings, UserProfile } from '../types';
import { handleFirestoreError, OperationType } from '../App';
import { Plus, Minus, Search, Edit2, Trash2, X, AlertTriangle, Package, Tag, Barcode, Shield, Eye, EyeOff, AlertCircle, History, Loader2, ArrowDown, ArrowUp } from 'lucide-react';
import { cn, decodeAzertyBarcode } from '../lib/utils';
import { can } from '../lib/permissions';

interface ProductsProps {
  userProfile: UserProfile | null;
}

const EAN13_L_PATTERNS = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const EAN13_G_PATTERNS = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111'];
const EAN13_R_PATTERNS = ['1110010', '1100110', '1101100', '1000010', '1011100', '1001110', '1010000', '1000100', '1001000', '1110100'];
const EAN13_PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];

function normalizeEan13(value: string): string | null {
  if (!/^\d{12,13}$/.test(value)) return null;
  const digits = value.slice(0, 12).split('').map(Number);
  const checkDigit = (10 - digits.reduce((sum, digit, index) => sum + digit * (index % 2 === 0 ? 1 : 3), 0) % 10) % 10;
  if (value.length === 13 && Number(value[12]) !== checkDigit) return null;
  return `${value.slice(0, 12)}${checkDigit}`;
}

function ean13Svg(value: string): string {
  const firstDigit = Number(value[0]);
  const left = value.slice(1, 7).split('').map((digit, index) =>
    EAN13_PARITY[firstDigit][index] === 'L' ? EAN13_L_PATTERNS[Number(digit)] : EAN13_G_PATTERNS[Number(digit)]
  ).join('');
  const right = value.slice(7).split('').map(digit => EAN13_R_PATTERNS[Number(digit)]).join('');
  const bits = `101${left}01010${right}101`;
  const bars = [...bits].flatMap((bit, index) => bit === '1'
    ? [`<rect x="${index}" y="0" width="1" height="${index < 3 || (index >= 45 && index < 50) || index >= 92 ? 56 : 50}"/>`]
    : []).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 95 60" role="img" aria-label="${value}"><rect width="95" height="60" fill="white"/><g fill="black">${bars}</g></svg>`;
}

export default function Products({ userProfile }: ProductsProps) {
  const ownerId = (userProfile?.role === 'admin' ? userProfile?.uid : userProfile?.ownerId) || userProfile?.uid || auth.currentUser?.uid;
  const isAdmin = userProfile?.role === 'admin';
  const canViewBuyPrice = can(userProfile, 'products', 'viewBuyPrice');
  const canEditSellPrice = can(userProfile, 'products', 'editSellPrice');
  const canAddEdit = can(userProfile, 'products', 'addEdit');
  const canAdjustStock = can(userProfile, 'products', 'adjustStock');
  const canDelete = can(userProfile, 'products', 'delete');
  const canManage = canAddEdit || canAdjustStock || canDelete;
  const canManageItems = canAddEdit || canDelete;
  const [products, setProducts] = useState<Product[]>([]);
  const [productCosts, setProductCosts] = useState<Record<string, number>>({});
  const productCostsRef = useRef<Record<string, number>>({});
  const [legacyProductPrices, setLegacyProductPrices] = useState<Record<string, number>>({});
  const [productCostsLoaded, setProductCostsLoaded] = useState(false);
  const [migrationPreview, setMigrationPreview] = useState<Array<{ id: string; name: string; buyPrice: number }>>([]);
  const [migrationBackupDownloaded, setMigrationBackupDownloaded] = useState(false);
  const [migrationBusy, setMigrationBusy] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [storeSettings, setStoreSettings] = useState<StoreSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isQuickCategoryModalOpen, setIsQuickCategoryModalOpen] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [scanStatus, setScanStatus] = useState<'idle' | 'scanned' | 'error'>('idle');
  const [scanMessage, setScanMessage] = useState('');
  const [deletingCatId, setDeletingCatId] = useState<string | null>(null);
  const [productToDelete, setProductToDelete] = useState<Product | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  // Empêche le double-clic sur "Enregistrer" / "Confirmer" (évite les ajouts en double)
  const [isSubmitting, setIsSubmitting] = useState(false);

  // States for security code modal (protects edit & delete)
  const [showSecurityModal, setShowSecurityModal] = useState(false);
  const [securityCode, setSecurityCode] = useState('');
  const [securityError, setSecurityError] = useState(false);
  const [showSecurityInput, setShowSecurityInput] = useState(false);
  const [pendingAction, setPendingAction] = useState<'edit' | 'delete' | null>(null);
  const [pendingProduct, setPendingProduct] = useState<Product | null>(null);

  // States for stock replenishment modal
  const [replenishProduct, setReplenishProduct] = useState<Product | null>(null);
  const [replenishQty, setReplenishQty] = useState<string>('');
  const [replenishPrice, setReplenishPrice] = useState<string>('');

  // States for stock history modal (diagnostic: entrées vs ventes vs stock affiché)
  const [historyProduct, setHistoryProduct] = useState<Product | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyMovements, setHistoryMovements] = useState<{ type: 'in' | 'out'; qty: number; date: Date | null; label: string }[]>([]);
  const [historyTotals, setHistoryTotals] = useState<{ totalIn: number; totalOut: number } | null>(null);

  const playBeep = (type: 'success' | 'error') => {
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      if (type === 'success') {
        const oscillator = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();
        oscillator.type = 'sine';
        oscillator.frequency.value = 950;
        gainNode.gain.setValueAtTime(0.08, audioCtx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.12);
        oscillator.connect(gainNode);
        gainNode.connect(audioCtx.destination);
        oscillator.start();
        oscillator.stop(audioCtx.currentTime + 0.12);
      } else {
        [0, 120].forEach((delay) => {
          setTimeout(() => {
            try {
              const osc = audioCtx.createOscillator();
              const gain = audioCtx.createGain();
              osc.type = 'sawtooth';
              osc.frequency.value = 180;
              gain.gain.setValueAtTime(0.12, audioCtx.currentTime);
              gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.15);
              osc.connect(gain);
              gain.connect(audioCtx.destination);
              osc.start();
              osc.stop(audioCtx.currentTime + 0.15);
            } catch (innerErr) {}
          }, delay);
        });
      }
    } catch (err) {}
  };

  useEffect(() => {
    if (!isModalOpen) {
      setScanStatus('idle');
      setScanMessage('');
      return;
    }

    let buffer = '';
    let lastKeyTime = 0;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      if (e.key === 'Tab' || e.key === 'Escape' || e.key === 'ArrowUp' || e.key === 'ArrowDown') return;

      const now = Date.now();
      const target = e.target as HTMLElement;
      const isInputFocused = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT');
      const isBarcodeInputFocused = target && target.tagName === 'INPUT' && (target as HTMLInputElement).placeholder?.includes('douchette');

      const interval = lastKeyTime ? now - lastKeyTime : 0;
      lastKeyTime = now;

      if (e.key.length === 1) {
        if (isInputFocused && !isBarcodeInputFocused && interval > 120) {
          buffer = e.key;
          return;
        }

        if (interval > 120) {
          buffer = e.key;
        } else {
          buffer += e.key;
        }
      } else if (e.key === 'Enter') {
        const barcode = decodeAzertyBarcode(buffer.trim());
        buffer = '';
        lastKeyTime = 0;

        if (barcode.length >= 3) {
          playBeep('success');
          setFormData(prev => ({ ...prev, barcode }));
          setScanStatus('scanned');
          setScanMessage(`Code détecté avec succès : ${barcode}`);
          setTimeout(() => {
            setScanStatus('idle');
            setScanMessage('');
          }, 4500);

          e.preventDefault();
          e.stopPropagation();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [isModalOpen]);

  // Form state
  const [formData, setFormData] = useState({
    name: '',
    category: '',
    buyPrice: 0,
    sellPrice: 0,
    reference: '',
    barcode: '',
    isService: false,
    stock: 0,
    expirationDate: '',
    lowStockAlert: 0
  });

  const [buyPriceInput, setBuyPriceInput] = useState('');
  const [sellPriceInput, setSellPriceInput] = useState('');

  useEffect(() => {
    if (!auth.currentUser || !ownerId) return;
    productCostsRef.current = {};
    const unsubscribeProds = onSnapshot(query(collection(db, 'products'), where('ownerId', '==', ownerId)), (snapshot) => {
      const prods = snapshot.docs.map(item => {
        const data = item.data();
        const { buyPrice: _storedBuyPrice, ...publicData } = data;
        const legacyBuyPrice = isAdmin ? Number(data.buyPrice) || 0 : 0;
        return { id: item.id, ...publicData, buyPrice: canViewBuyPrice ? (productCostsRef.current[item.id] ?? legacyBuyPrice) : 0 } as Product;
      });
      setLegacyProductPrices(Object.fromEntries(snapshot.docs
        .filter(item => isAdmin && Object.prototype.hasOwnProperty.call(item.data(), 'buyPrice'))
        .map(item => [item.id, Number(item.data().buyPrice) || 0])));
      prods.sort((a, b) => {
        const dateA = a.createdAt || '';
        const dateB = b.createdAt || '';
        if (dateA && dateB) {
          return dateB.localeCompare(dateA);
        }
        if (dateA) return -1;
        if (dateB) return 1;
        return (a.name || '').localeCompare(b.name || '');
      });
      setProducts(prods);
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'products');
    });

    const unsubscribeCats = onSnapshot(query(collection(db, 'categories'), where('ownerId', '==', ownerId)), (snapshot) => {
      const cats = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Category));
      cats.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      setCategories(cats);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'categories');
    });

    const unsubscribeSettings = onSnapshot(doc(db, 'settings', ownerId), (snapshot) => {
      if (snapshot.exists()) {
        setStoreSettings(snapshot.data() as StoreSettings);
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'settings');
    });

    const unsubscribeCosts = canViewBuyPrice
      ? onSnapshot(query(collection(db, 'product_costs'), where('ownerId', '==', ownerId)), snapshot => {
        const costMap = Object.fromEntries(snapshot.docs.map(item => [item.id, Number(item.data().buyPrice) || 0]));
        productCostsRef.current = costMap;
        setProductCosts(costMap);
        setProductCostsLoaded(true);
        setProducts(current => current.map(product => ({
          ...product,
          buyPrice: costMap[product.id] ?? product.buyPrice,
        })));
      }, error => {
        setProductCostsLoaded(true);
        handleFirestoreError(error, OperationType.LIST, 'product_costs');
      })
      : () => {
        productCostsRef.current = {};
        setProductCosts({});
        setProductCostsLoaded(false);
      };

    return () => {
      unsubscribeProds();
      unsubscribeCats();
      unsubscribeSettings();
      unsubscribeCosts();
    };
  }, [ownerId, isAdmin, canViewBuyPrice]);

  // Vérifie une VRAIE connexion serveur avant toute écriture.
  // getDocFromServer force une lecture réseau : hors-ligne (ou faux navigator.onLine),
  // elle échoue → on n'écrit rien, donc aucune opération n'est mise en file ni rejouée.
  const ensureOnline = async (timeoutMs = 8000): Promise<void> => {
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('OFFLINE')), timeoutMs);
    });
    try {
      // Lecture serveur d'un doc léger (le compteur du propriétaire). Peu importe qu'il existe.
      await Promise.race([
        getDocFromServer(doc(db, 'counters', `invoices_${ownerId}`)),
        timeout,
      ]);
    } catch {
      throw new Error('OFFLINE');
    } finally {
      clearTimeout(timer!);
    }
  };

  const previewProductCostMigration = () => {
    if (!isAdmin || !productCostsLoaded) return;
    const preview = products
      .filter(product => Object.prototype.hasOwnProperty.call(legacyProductPrices, product.id))
      .map(product => ({
        id: product.id,
        name: product.name,
        buyPrice: productCosts[product.id] ?? legacyProductPrices[product.id] ?? 0,
      }));
    setMigrationPreview(preview);
    setMigrationBackupDownloaded(false);
    setErrorMsg(null);
  };

  const downloadProductCostBackup = () => {
    const backup = migrationPreview.map(item => ({
      ...products.find(product => product.id === item.id),
      buyPrice: item.buyPrice,
    }));
    const blob = new Blob([JSON.stringify({
      createdAt: new Date().toISOString(),
      ownerId,
      products: backup,
    }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `phone-clinic-products-backup-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setMigrationBackupDownloaded(true);
  };

  const confirmProductCostMigration = async () => {
    if (!isAdmin || !migrationBackupDownloaded || migrationBusy || migrationPreview.length === 0) return;
    setMigrationBusy(true);
    setErrorMsg(null);
    try {
      for (let offset = 0; offset < migrationPreview.length; offset += 200) {
        const batch = writeBatch(db);
        const page = migrationPreview.slice(offset, offset + 200);
        page.forEach(item => {
          const productRef = doc(db, 'products', item.id);
          batch.update(productRef, { buyPrice: deleteField() });
          if (productCosts[item.id] === undefined) {
            batch.set(doc(db, 'product_costs', item.id), {
              ownerId,
              buyPrice: item.buyPrice,
            });
          }
        });
        await batch.commit();
      }
      setMigrationPreview([]);
      setMigrationBackupDownloaded(false);
    } catch (error) {
      console.error('[ERROR] Product cost migration failed:', error);
      setErrorMsg(error instanceof Error ? `Migration interrompue : ${error.message}` : `Migration interrompue : ${String(error)}`);
    } finally {
      setMigrationBusy(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    // Empêche un second envoi tant que le premier n'est pas terminé (évite les doublons)
    if (!canAddEdit || isSubmitting) return;

    // Garde-fou : le prix de vente doit être supérieur ou égal au prix d'achat,
    // sinon chaque vente de ce produit génère un bénéfice négatif.
    if (isAdmin && !formData.isService && (formData.sellPrice || 0) < (formData.buyPrice || 0)) {
      setErrorMsg(
        `Le prix de vente (${(formData.sellPrice || 0).toFixed(3)}) doit être supérieur ou égal au prix d'achat (${(formData.buyPrice || 0).toFixed(3)}). Vendre en dessous du prix d'achat génère une perte sur chaque vente.`
      );
      return;
    }
    if (editingProduct && formData.isService !== (editingProduct.inventoryType === 'service')) {
      setErrorMsg('Le type d’article ne peut pas être converti après sa création. Créez un nouvel article avec le type souhaité.');
      return;
    }
    try {
      setIsSubmitting(true);

      // Vérifie une vraie connexion serveur AVANT d'écrire. Hors-ligne → aucune écriture.
      await ensureOnline();
      const { buyPrice: enteredBuyPrice, isService, ...formFields } = formData;
      const buyPrice = isService ? 0 : enteredBuyPrice;
      const productData = {
        ...formFields,
        reference: formData.reference.trim(),
        inventoryType: isService ? 'service' : (editingProduct?.inventoryType === 'spare_part' ? 'spare_part' : 'product'),
        stock: isService ? 0 : formData.stock,
        lowStockAlert: isService ? 0 : formData.lowStockAlert,
      };

      if (editingProduct) {
        const oldStock = editingProduct.stock || 0;
        const newStock = parseInt(formData.stock.toString()) || 0;

        if (newStock !== oldStock) {
          throw new Error('Ajustez le stock avec les boutons + / − pour conserver l’historique des mouvements.');
        }
        if (isAdmin && !isService) {
          const suppliesSnapshot = await getDocs(query(
            collection(db, 'supplies'),
            where('ownerId', '==', ownerId),
            where('productId', '==', editingProduct.id)
          ));
          for (const supply of suppliesSnapshot.docs) {
            const quantity = Number(supply.data().quantity) || 0;
            await updateDoc(doc(db, 'supplies', supply.id), {
              productName: formData.name,
              buyPrice,
              totalCost: quantity * buyPrice,
              ownerId,
              userId: userProfile?.uid || ownerId
            });
          }
          await setDoc(doc(db, 'product_costs', editingProduct.id), { ownerId, buyPrice });
        }

        await updateDoc(doc(db, 'products', editingProduct.id), {
          ...productData,
          ...(isAdmin ? { buyPrice: deleteField() } : {}),
          ownerId,
          userId: userProfile?.uid || ownerId
        });

        // Log d'audit (optionnel — ne bloque pas l'opération)
        try {
          const logRef = doc(collection(db, 'audit_logs'));
          await setDoc(logRef, {
            action: 'UPDATE_PRODUCT',
            userEmail: userProfile?.email || 'unknown',
            userName: userProfile?.name || 'unknown',
            timestamp: new Date().toISOString(),
            productId: editingProduct.id,
            productName: formData.name,
            ownerId,
            userId: userProfile?.uid || ownerId
          });
        } catch (logErr) {
          console.warn('[AUDIT LOG] Failed:', logErr);
        }
      } else {
        const docRef = doc(collection(db, 'products'));
        const stockInt = parseInt(formData.stock.toString()) || 0;
        const movementRef = doc(db, 'stock_movements', `product_${docRef.id}_v1`);
        await runTransaction(db, async transaction => {
          transaction.set(docRef, {
            ...productData,
            stock: stockInt,
            stockVersion: stockInt > 0 ? 1 : 0,
            ...(stockInt > 0 ? { lastStockMovementId: movementRef.id } : {}),
            createdAt: new Date().toISOString(),
            ownerId,
            userId: userProfile?.uid || ownerId
          });
          if (isAdmin && !isService) transaction.set(doc(db, 'product_costs', docRef.id), { ownerId, buyPrice });
          if (stockInt > 0) transaction.set(movementRef, {
            type: 'product_initial_stock',
            inventoryCollection: 'products',
            productId: docRef.id,
            productName: formData.name,
            delta: stockInt,
            quantity: stockInt,
            version: 1,
            ownerId,
            userId: userProfile?.uid || ownerId,
            userLabel: userProfile?.name || userProfile?.email || 'Utilisateur',
            createdAt: new Date(),
          });
        });

        // Log d'audit (optionnel — ne bloque pas l'opération)
        try {
          const logRef = doc(collection(db, 'audit_logs'));
          await setDoc(logRef, {
            action: 'CREATE_PRODUCT',
            userEmail: userProfile?.email || 'unknown',
            userName: userProfile?.name || 'unknown',
            timestamp: new Date().toISOString(),
            productId: docRef.id,
            productName: formData.name,
            ownerId,
            userId: userProfile?.uid || ownerId
          });
        } catch (logErr) {
          console.warn('[AUDIT LOG] Failed:', logErr);
        }
        if (isAdmin && !isService && stockInt > 0) {
          const expenseAmount = stockInt * buyPrice;
          await addDoc(collection(db, 'supplies'), {
            productId: docRef.id,
            productName: formData.name,
            quantity: stockInt,
            buyPrice,
            totalCost: expenseAmount,
            date: new Date(),
            ownerId,
            userId: userProfile?.uid || ownerId
          });
        }
      }
      closeModal();
    } catch (error: any) {
      if (error?.message === 'OFFLINE') {
        setErrorMsg("Vérifiez votre connexion Internet.");
      } else {
        console.error("[ERROR] Failed to save product:", error);
        setErrorMsg(error?.message || String(error));
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReplenishSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canAdjustStock || !replenishProduct || !replenishQty) return;

    // Empêche un second envoi tant que le premier n'est pas terminé (évite les doublons)
    if (isSubmitting) return;

    try {
      setIsSubmitting(true);

      // Vérifie une vraie connexion serveur AVANT d'écrire. Hors-ligne → aucune écriture.
      // Le verrou isSubmitting reste actif pendant toute la vérification : les reclics sont ignorés.
      await ensureOnline();

      const qty = parseInt(replenishQty) || 0;
      const price = isAdmin ? (parseFloat(replenishPrice) || 0) : 0;
      if (qty <= 0) return;
      const expenseAmount = qty * price;

      await runTransaction(db, async transaction => {
        const productRef = doc(db, 'products', replenishProduct.id);
        const current = await transaction.get(productRef);
        if (!current.exists()) throw new Error('Cet article n’existe plus.');
        const version = (Number(current.data().stockVersion) || 0) + 1;
        const movementRef = doc(db, 'stock_movements', `product_${replenishProduct.id}_v${version}`);
        transaction.update(productRef, {
          stock: (Number(current.data().stock) || 0) + qty,
          stockVersion: version,
          lastStockMovementId: movementRef.id,
          ownerId,
          userId: userProfile?.uid || ownerId,
        });
        transaction.set(movementRef, {
          type: 'product_restock',
          inventoryCollection: 'products',
          productId: replenishProduct.id,
          productName: replenishProduct.name,
          delta: qty,
          quantity: qty,
          version,
          ownerId,
          userId: userProfile?.uid || ownerId,
          userLabel: userProfile?.name || userProfile?.email || 'Utilisateur',
          createdAt: new Date(),
        });
      });

      if (isAdmin) {
        await setDoc(doc(db, 'product_costs', replenishProduct.id), { ownerId, buyPrice: price });
        await addDoc(collection(db, 'supplies'), {
          productId: replenishProduct.id,
          productName: replenishProduct.name,
          quantity: qty,
          buyPrice: price,
          totalCost: expenseAmount,
          date: new Date(),
          ownerId,
          userId: userProfile?.uid || ownerId
        });
      }

      // Track in custom offline queue if offline to count pending operations
      // (Bloc conservé sans effet : l'approvisionnement hors-ligne est désormais bloqué en amont.)

      setReplenishProduct(null);
      setReplenishQty('');
      setReplenishPrice('');
      playBeep('success');
    } catch (error: any) {
      playBeep('error');
      if (error?.message === 'OFFLINE') {
        alert("Vérifiez votre connexion Internet.");
      } else {
        console.error("[ERROR] Failed to replenish product stock:", error);
        alert("Échec de l'approvisionnement. Réessayez.");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const adjustProductStock = async (product: Product, delta: number) => {
    if (!canAdjustStock || delta === 0) return;
    try {
      await runTransaction(db, async transaction => {
        const productRef = doc(db, 'products', product.id);
        const current = await transaction.get(productRef);
        if (!current.exists()) throw new Error('Cet article n’existe plus.');
        const stock = Number(current.data().stock) || 0;
        const nextStock = stock + delta;
        if (nextStock < 0) throw new Error('Le stock ne peut pas être négatif.');
        const version = (Number(current.data().stockVersion) || 0) + 1;
        const movementRef = doc(db, 'stock_movements', `product_${product.id}_v${version}`);
        transaction.update(productRef, {
          stock: nextStock,
          stockVersion: version,
          lastStockMovementId: movementRef.id,
          ownerId,
          userId: userProfile?.uid || ownerId,
        });
        transaction.set(movementRef, {
          type: 'product_manual_adjustment',
          inventoryCollection: 'products',
          productId: product.id,
          productName: product.name,
          delta,
          quantity: Math.abs(delta),
          version,
          ownerId,
          userId: userProfile?.uid || ownerId,
          userLabel: userProfile?.name || userProfile?.email || 'Technicien',
          createdAt: new Date(),
        });
      });
    } catch (error) {
      console.error('[ERROR] Product stock adjustment failed:', error);
      setErrorMsg(error instanceof Error ? error.message : String(error));
    }
  };

  // Charge l'historique de stock d'un produit : entrées (supplies) et sorties (ventes),
  // pour comparer le stock théorique (entrées - ventes) au stock affiché.
  const openHistory = async (product: Product) => {
    setHistoryProduct(product);
    setHistoryLoading(true);
    setHistoryError(null);
    setHistoryMovements([]);
    setHistoryTotals(null);

    const toDate = (d: any): Date | null => {
      if (!d) return null;
      if (d instanceof Date) return d;
      if (typeof d?.toDate === 'function') return d.toDate();
      if (typeof d?.seconds === 'number') return new Date(d.seconds * 1000);
      const parsed = new Date(d);
      return isNaN(parsed.getTime()) ? null : parsed;
    };

    try {
      const movements: { type: 'in' | 'out'; qty: number; date: Date | null; label: string }[] = [];
      let totalIn = 0;
      let totalOut = 0;

      if (isAdmin) {
        const suppliesSnap = await getDocs(query(
          collection(db, 'supplies'),
          where('ownerId', '==', ownerId),
          where('productId', '==', product.id)
        ));
        suppliesSnap.forEach(d => {
          const quantity = Number(d.data().quantity) || 0;
          totalIn += quantity;
          movements.push({ type: 'in', qty: quantity, date: toDate(d.data().date), label: 'Entrée / appro.' });
        });

        const salesSnap = await getDocs(query(collection(db, 'sales'), where('ownerId', '==', ownerId)));
        salesSnap.forEach(d => {
          const sale = d.data();
          if (!Array.isArray(sale.items)) return;
          for (const item of sale.items) {
            if (item.productId === product.id) {
              const quantity = Number(item.quantity) || 0;
              totalOut += quantity;
              movements.push({ type: 'out', qty: quantity, date: toDate(sale.date), label: 'Vente' });
            }
          }
        });
      } else {
        const stockMovements = await getDocs(query(
          collection(db, 'stock_movements'),
          where('ownerId', '==', ownerId),
          where('inventoryCollection', '==', 'products'),
          where('productId', '==', product.id)
        ));
        stockMovements.forEach(d => {
          const movement = d.data();
          const delta = Number(movement.delta) || 0;
          if (delta > 0) totalIn += delta;
          else totalOut += Math.abs(delta);
          movements.push({
            type: delta >= 0 ? 'in' : 'out',
            qty: Math.abs(delta),
            date: toDate(movement.createdAt),
            label: String(movement.type || 'Mouvement').replaceAll('_', ' '),
          });
        });
      }

      // Tri chronologique (les mouvements sans date en dernier)
      movements.sort((a, b) => {
        const ta = a.date ? a.date.getTime() : Infinity;
        const tb = b.date ? b.date.getTime() : Infinity;
        return ta - tb;
      });

      setHistoryMovements(movements);
      setHistoryTotals({ totalIn, totalOut });
    } catch (error: any) {
      console.error("[ERROR] Failed to load stock history:", error);
      setHistoryError(error?.message || String(error));
    } finally {
      setHistoryLoading(false);
    }
  };

  const executeProductDelete = async () => {
    if (!canDelete || !productToDelete) return;
    setErrorMsg(null);
    try {
      if (isAdmin) {
        const querySnapshot = await getDocs(query(
          collection(db, 'supplies'),
          where('ownerId', '==', ownerId),
          where('productId', '==', productToDelete.id)
        ));
        for (const supply of querySnapshot.docs) {
          await deleteDoc(doc(db, 'supplies', supply.id));
        }
      }

      await deleteDoc(doc(db, 'products', productToDelete.id));

      // Log d'audit (optionnel — ne bloque pas l'opération)
      try {
        const logRef = doc(collection(db, 'audit_logs'));
        await setDoc(logRef, {
          action: 'DELETE_PRODUCT',
          userEmail: userProfile?.email || 'unknown',
          userName: userProfile?.name || 'unknown',
          timestamp: new Date().toISOString(),
          productId: productToDelete.id,
          productName: productToDelete.name,
          ownerId,
          userId: userProfile?.uid || ownerId
        });
      } catch (logErr) {
        console.warn('[AUDIT LOG] Failed:', logErr);
      }

      setProductToDelete(null);
    } catch (error: any) {
      console.error("[ERROR] Failed to delete product:", error);
      setErrorMsg(error?.message || String(error));
    }
  };

  const executeCategoryDelete = async (categoryId: string, categoryName: string) => {
    if (!canDelete) return;
    try {
      await deleteDoc(doc(db, 'categories', categoryId));
      if (formData.category === categoryName) {
        const remaining = categories.filter(c => c.id !== categoryId);
        setFormData(prev => ({ ...prev, category: remaining[0]?.name || '' }));
      }
      setDeletingCatId(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, 'categories');
    }
  };

  const openModal = (product?: Product) => {
    setErrorMsg(null);
    if (product) {
      setEditingProduct(product);
      setFormData({
        name: product.name,
        category: product.category,
        buyPrice: isAdmin && product.inventoryType !== 'service' ? (productCosts[product.id] ?? product.buyPrice) : 0,
        sellPrice: product.sellPrice,
        reference: product.reference || '',
        barcode: product.barcode || '',
        isService: product.inventoryType === 'service',
        stock: product.stock,
        expirationDate: product.expirationDate || '',
        lowStockAlert: product.lowStockAlert || 5
      });
      setBuyPriceInput(isAdmin && product.inventoryType !== 'service' ? (productCosts[product.id] ?? product.buyPrice).toFixed(3) : '');
      setSellPriceInput(product.sellPrice.toFixed(3));
    } else {
      setEditingProduct(null);
      setFormData({
        name: '',
        category: categories[0]?.name || 'produit',
        buyPrice: 0,
        sellPrice: 0,
        reference: '',
        barcode: '',
        isService: false,
        stock: 0,
        expirationDate: '',
        lowStockAlert: 0
      });
      setBuyPriceInput('');
      setSellPriceInput('');
    }
    setIsModalOpen(true);
  };

  const printBarcode = () => {
    const ean13 = normalizeEan13(formData.barcode.trim());
    if (!ean13) {
      setErrorMsg('Pour imprimer une étiquette, saisissez ou générez un code EAN-13 valide.');
      return;
    }
    const printWindow = window.open('', '_blank', 'width=420,height=320');
    if (!printWindow) {
      setErrorMsg('La fenêtre d’impression a été bloquée par le navigateur.');
      return;
    }
    setFormData(current => ({ ...current, barcode: ean13 }));
    printWindow.document.open();
    printWindow.document.write('<!doctype html><html><head><meta charset="utf-8"><title>Étiquette code-barres</title><style>@page{margin:8mm}body{font-family:Arial,sans-serif;text-align:center;margin:0;padding:12px}.label{width:70mm;margin:auto}.name{font-size:14px;font-weight:700;margin-bottom:5px;overflow-wrap:anywhere}svg{width:100%;height:44mm}.code{font-family:monospace;font-size:13px;letter-spacing:2px;margin-top:2px}@media screen{body{padding:24px}}</style></head><body><main class="label"><div class="name"></div></main></body></html>');
    const nameElement = printWindow.document.querySelector('.name');
    if (nameElement) nameElement.textContent = formData.name || 'Article';
    const label = printWindow.document.querySelector('.label');
    if (label) {
      label.insertAdjacentHTML('beforeend', ean13Svg(ean13));
      const code = printWindow.document.createElement('div');
      code.className = 'code';
      code.textContent = ean13;
      label.append(code);
    }
    printWindow.document.close();
    printWindow.onafterprint = () => printWindow.close();
    printWindow.setTimeout(() => {
      printWindow.focus();
      printWindow.print();
    }, 250);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingProduct(null);
    setErrorMsg(null);
  };

  // Demande le code de sécurité avant d'autoriser une modification ou une suppression.
  // Chaque utilisateur a son propre code (défini par l'admin dans Gestion des Utilisateurs).
  // Si aucun code n'est configuré pour cet utilisateur, l'action est exécutée directement.
  const requestSecureAction = (action: 'edit' | 'delete', product: Product) => {
    const code = userProfile?.securityCode;
    if (code && code.length === 4) {
      setPendingAction(action);
      setPendingProduct(product);
      setSecurityCode('');
      setSecurityError(false);
      setShowSecurityInput(false);
      setShowSecurityModal(true);
    } else {
      if (action === 'edit') {
        openModal(product);
      } else {
        setProductToDelete(product);
      }
    }
  };

  const confirmSecureAction = () => {
    if (!pendingProduct || !pendingAction) return;
    if (securityCode === userProfile?.securityCode) {
      const action = pendingAction;
      const product = pendingProduct;
      setShowSecurityModal(false);
      setPendingAction(null);
      setPendingProduct(null);
      setSecurityCode('');
      setSecurityError(false);
      if (action === 'edit') {
        openModal(product);
      } else {
        setProductToDelete(product);
      }
    } else {
      setSecurityError(true);
      setSecurityCode('');
    }
  };

  const handleQuickCategoryAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canAddEdit) return;
    if (!newCategoryName.trim()) return;

    // Empêche un second envoi tant que le premier n'est pas terminé (évite les doublons)
    if (isSubmitting) return;

    const exists = categories.some(c => c.name.toLowerCase() === newCategoryName.trim().toLowerCase());
    if (exists) {
      alert('Cette catégorie existe déjà.');
      return;
    }
    
    try {
      setIsSubmitting(true);

      // Vérifie une vraie connexion serveur AVANT d'écrire.
      await ensureOnline();

      await addDoc(collection(db, 'categories'), {
        name: newCategoryName.trim(),
        type: 'autre',
        ownerId
      });
      setFormData(prev => ({ ...prev, category: newCategoryName.trim() }));
      setNewCategoryName('');
    } catch (error: any) {
      if (error?.message === 'OFFLINE') {
        alert("Vérifiez votre connexion Internet.");
      } else {
        handleFirestoreError(error, OperationType.CREATE, 'categories');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResetDefaultCategories = async () => {
    if (!confirm('Voulez-vous restaurer les catégories de base par défaut ?')) return;
    const defaults = [
      { id: 'cat_alimentation', name: 'Alimentation' },
      { id: 'cat_boissons', name: 'Boissons' },
      { id: 'cat_entretien', name: 'Entretien' },
      { id: 'cat_produits_frais', name: 'Produits Frais' }
    ];
    for (const cat of defaults) {
      try {
        await setDoc(doc(db, 'categories', cat.id + '_' + ownerId), {
          name: cat.name,
          type: 'autre',
          ownerId
        });
      } catch (err) {
        console.error('Error seeding category:', cat.name, err);
      }
    }
  };



  // Union des catégories Firestore + catégories réellement utilisées par les produits.
  // Garantit que le filtre n'est jamais vide même si la collection `categories`
  // est vide ou que ses documents n'ont pas le bon ownerId.
  const normalizeCat = (s: string) => (s || '').trim().toLowerCase();
  const filterCategories = React.useMemo(() => {
    const map = new Map<string, string>();
    categories.forEach(c => {
      const key = normalizeCat(c.name);
      if (key && !map.has(key)) map.set(key, c.name.trim());
    });
    products.forEach(p => {
      const key = normalizeCat(p.category);
      if (key && !map.has(key)) map.set(key, (p.category || '').trim());
    });
    return Array.from(map.values()).sort((a, b) => a.localeCompare(b));
  }, [categories, products]);

  const filteredProducts = products.filter(p => {
    const matchesSearch =
      p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.category.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (p.reference && p.reference.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (p.barcode && p.barcode.toLowerCase().includes(searchTerm.toLowerCase()));
    const matchesCategory =
      selectedCategory === 'all' || normalizeCat(p.category) === normalizeCat(selectedCategory);
    return matchesSearch && matchesCategory;
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold text-slate-800 tracking-tight">Articles vendables en caisse</h1>
        </div>
        <div className="flex flex-wrap gap-2.5">
          {isAdmin && <button
            onClick={previewProductCostMigration}
            disabled={!productCostsLoaded || migrationBusy}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-black uppercase tracking-wider text-amber-800 disabled:opacity-50"
          >
            <Shield className="h-4 w-4" /> Migrer les prix d’achat
          </button>}
          {canAddEdit && <button
            onClick={() => openModal()}
            className="inline-flex items-center justify-center gap-2 px-5 py-3 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-black uppercase tracking-wider rounded-xl transition-all duration-300 shadow-lg shadow-indigo-600/15 group hover:-translate-y-0.5 cursor-pointer"
          >
            <Plus className="w-4 h-4 transition-transform group-hover:rotate-90 duration-300" />
            + NOUVEL ARTICLE
          </button>}
        </div>
      </div>

      {isAdmin && migrationPreview.length > 0 && <section className="space-y-3 rounded-2xl border border-amber-200 bg-amber-50 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><h2 className="font-black text-amber-900">Aperçu de la séparation des prix</h2><p className="text-xs text-amber-800">{migrationPreview.length} article(s) contiennent encore un prix d’achat dans « products ».</p></div>
          <div className="flex flex-wrap gap-2">
            <button onClick={downloadProductCostBackup} className="rounded-xl border border-amber-300 bg-white px-4 py-2.5 text-sm font-bold text-amber-800">Télécharger la sauvegarde JSON</button>
            <button onClick={() => void confirmProductCostMigration()} disabled={!migrationBackupDownloaded || migrationBusy} className="rounded-xl bg-amber-700 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50">{migrationBusy ? 'Migration…' : 'Confirmer la migration'}</button>
          </div>
        </div>
        <ul className="max-h-40 space-y-1 overflow-y-auto text-xs text-amber-950">{migrationPreview.slice(0, 100).map(item => <li key={item.id} className="rounded-lg bg-white/70 px-3 py-2">{item.name} · {item.buyPrice.toFixed(3)} {storeSettings?.currency || 'DT'}</li>)}</ul>
      </section>}

      <div className="bg-white rounded-3xl border border-slate-100 shadow-xs overflow-hidden premium-shadow">
        <div className="p-5 border-b border-slate-100 bg-slate-50/20">
          <div className="flex flex-col sm:flex-row gap-3">
            {/* Search bar */}
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4.5 h-4.5 text-slate-400" />
              <input
                type="text"
                name="product-search"
                autoComplete="off"
                placeholder="Rechercher un article ou scanner un code-barres..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-11 pr-4 py-2.5 bg-slate-50 border border-slate-100 rounded-xl focus:bg-white text-xs font-semibold text-slate-700 placeholder-slate-400 focus:ring-2 focus:ring-indigo-500/10 focus:border-indigo-500 outline-none transition-all duration-300"
              />
            </div>

            {/* Category filter */}
            <div className="relative">
              <Tag className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-indigo-400 pointer-events-none" />
              <select
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
                className="pl-10 pr-8 py-2.5 bg-slate-50 border border-slate-100 rounded-xl focus:bg-white text-xs font-semibold text-slate-700 focus:ring-2 focus:ring-indigo-500/10 focus:border-indigo-500 outline-none transition-all duration-300 appearance-none cursor-pointer min-w-[180px]"
              >
                <option value="all">Toutes les catégories</option>
                {filterCategories.map(catName => (
                  <option key={catName} value={catName}>{catName}</option>
                ))}
              </select>
              <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center">
                <svg className="w-3.5 h-3.5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </div>

            {/* Active filter badge + reset */}
            {selectedCategory !== 'all' && (
              <button
                onClick={() => setSelectedCategory('all')}
                className="inline-flex items-center gap-1.5 px-3 py-2.5 bg-indigo-50 hover:bg-indigo-100 border border-indigo-100 text-indigo-700 text-xs font-black uppercase tracking-wider rounded-xl transition-all cursor-pointer"
                title="Réinitialiser le filtre"
              >
                <X className="w-3.5 h-3.5" />
                {selectedCategory}
              </button>
            )}
          </div>

          {/* Results summary */}
          {(searchTerm || selectedCategory !== 'all') && (
            <p className="mt-2.5 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
              {filteredProducts.length} résultat{filteredProducts.length !== 1 ? 's' : ''} trouvé{filteredProducts.length !== 1 ? 's' : ''}
              {selectedCategory !== 'all' && <span className="text-indigo-500"> · {selectedCategory}</span>}
            </p>
          )}
        </div>

        <div className="overflow-x-auto text-[13px] font-medium text-slate-600">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50/50 border-b border-slate-100 text-slate-400 text-[10px] font-extrabold uppercase tracking-widest">
                <th className="px-6 py-4">ARTICLE</th>
                <th className="px-6 py-4">CATÉGORIE</th>
                {canViewBuyPrice && <th className="px-6 py-4">PRIX ACHAT</th>}
                <th className="px-6 py-4">PRIX VENTE</th>
                <th className="px-6 py-4">STOCK</th>
                {canManageItems && <th className="px-6 py-4 text-right">ACTIONS</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100/70">
              {loading ? (
                <tr>
                  <td colSpan={4 + (canViewBuyPrice ? 1 : 0) + (canManageItems ? 1 : 0)} className="px-6 py-10 text-center text-gray-500">Chargement...</td>
                </tr>
              ) : filteredProducts.length === 0 ? (
                <tr>
                  <td colSpan={4 + (canViewBuyPrice ? 1 : 0) + (canManageItems ? 1 : 0)} className="px-6 py-10 text-center text-gray-500">Aucun produit trouvé.</td>
                </tr>
              ) : (
                filteredProducts.map((product) => (
                  <tr key={product.id} className="hover:bg-gray-50/50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="font-medium text-gray-900">{product.name}</div>
                      <div className="flex flex-col gap-0.5">
                        {product.reference && (
                          <div className="text-[10px] font-mono text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded w-fit">
                            REF: {product.reference}
                          </div>
                        )}
                        {!product.reference && product.barcode && (
                          <div className="text-[10px] font-mono text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded w-fit">
                            REF: {product.barcode}
                          </div>
                        )}
                        {product.expirationDate && (
                          <div className="text-xs text-gray-500">Exp: {product.expirationDate}</div>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className={cn(
                        "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium capitalize",
                        (() => {
                           const cat = categories.find(c => c.name === product.category);
                           if (!cat) return "bg-indigo-50 text-indigo-700";
                           return cat.type === 'boissons' ? "bg-blue-50 text-blue-700" :
                                  cat.type === 'entretien' ? "bg-orange-50 text-orange-700" :
                                  cat.type === 'frais' ? "bg-purple-50 text-purple-700" :
                                  "bg-indigo-50 text-indigo-700";
                        })()
                      )}>
                        {product.category}
                      </span>
                    </td>
                    {canViewBuyPrice && <td className="px-6 py-4 text-gray-600 font-mono">{product.inventoryType === 'service' ? '—' : `${(productCosts[product.id] ?? product.buyPrice ?? 0).toFixed(3)} ${storeSettings?.currency || 'DT'}`}</td>}
                    <td className="px-6 py-4 text-gray-900 font-bold font-mono">{product.sellPrice.toFixed(3)} {storeSettings?.currency || 'DT'}</td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        {(() => {
                          const threshold = product.lowStockAlert !== undefined && product.lowStockAlert >= 0
                            ? product.lowStockAlert
                            : (storeSettings?.minStockAlert ?? 5);
                          const isLow = product.stock <= threshold;
                          return (
                            <>
                              <span className={cn(
                                "font-medium font-mono",
                                isLow && product.inventoryType !== 'service' ? "text-red-600 font-bold" : "text-gray-900"
                              )}>
                                {product.inventoryType === 'service' ? 'Service' : product.stock}
                              </span>
                              {isLow && product.inventoryType !== 'service' && (
                                <span title={`Alerte stock faible (seuil : ${threshold})`}>
                                  <AlertTriangle className="w-4 h-4 text-red-500 shrink-0" />
                                </span>
                              )}
                            </>
                          );
                        })()}
                      </div>
                      {canAdjustStock && product.inventoryType !== 'service' && <div className="mt-2 flex items-center gap-2">
                        <button onClick={() => void adjustProductStock(product, -1)} disabled={product.stock <= 0} className="rounded-lg border border-slate-200 p-2 text-slate-500 disabled:opacity-40" title="Retirer une unité">−</button>
                        <button onClick={() => void adjustProductStock(product, 1)} className="rounded-lg border border-slate-200 p-2 text-slate-500" title="Ajouter une unité">+</button>
                        <button
                          onClick={() => {
                            setReplenishProduct(product);
                            setReplenishQty('');
                            setReplenishPrice(isAdmin ? (productCosts[product.id] ?? product.buyPrice).toFixed(3) : '');
                          }}
                          className="inline-flex items-center gap-1 rounded-lg border border-emerald-150 bg-emerald-50 px-3 py-1.5 text-xs font-black uppercase tracking-wider text-emerald-700 hover:bg-emerald-100"
                          title="Approvisionner (ajouter du stock) pour cet article"
                        >
                          + À STOCK
                        </button>
                        <button onClick={() => void openHistory(product)} className="rounded-lg border border-slate-200 p-2 text-slate-500" title="Historique du stock"><History className="w-4 h-4" /></button>
                      </div>}
                    </td>
                    {canManageItems && <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {canAddEdit && <button
                          onClick={() => requestSecureAction('edit', product)}
                          className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors border border-transparent"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>}
                        {canDelete && <button
                          onClick={() => requestSecureAction('delete', product)}
                          className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors border border-transparent"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>}
                      </div>
                    </td>}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal */}
      {canAddEdit && isModalOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-2 sm:p-4 bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col max-h-[calc(100vh-24px)] sm:max-h-[85vh] overflow-hidden border border-gray-100 animate-in zoom-in-95 duration-150">
            <div className="flex-shrink-0 px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
              <h2 className="text-lg font-bold text-gray-900">
                {editingProduct ? 'Modifier Article' : 'Nouvel Article'}
              </h2>
              <button onClick={closeModal} className="p-2 text-gray-400 hover:text-gray-600 rounded-lg cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="flex-1 flex flex-col min-h-0 overflow-hidden">
              <div className="flex-1 overflow-y-auto p-6 space-y-4 touch-pan-y">
                {errorMsg && (
                  <div className="p-3.5 bg-red-50 border border-red-100 rounded-xl flex items-start gap-2 text-red-700 text-xs font-medium animate-in fade-in duration-150">
                    <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                    <span className="break-all">{errorMsg}</span>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-4">
                  <div className="col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-1">Nom de l'article</label>
                    <input
                      type="text"
                      required
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      className="w-full px-4 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none"
                    />
                  </div>

                  <div className="col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-1">Référence</label>
                    <input
                      type="text"
                      value={formData.reference}
                      placeholder="Ex: REF-001"
                      onChange={(e) => setFormData({ ...formData, reference: e.target.value })}
                      className="w-full px-4 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none"
                    />
                  </div>

                  <div className="col-span-2 space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="block text-xs font-black uppercase tracking-wider text-slate-700">
                        Code-barres
                      </label>
                      <span className="inline-flex items-center gap-1.5 text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-100">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                        Scanner Douchette Prêt
                      </span>
                    </div>
                    
                    <div className="relative group">
                      <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                        <Barcode className="h-4.5 w-4.5 text-indigo-500 group-focus-within:text-indigo-600" />
                      </div>
                      <input
                        type="text"
                        placeholder="Pointez votre douchette et flashez"
                        value={formData.barcode}
                        onChange={(e) => setFormData({ ...formData, barcode: decodeAzertyBarcode(e.target.value) })}
                        className="w-full pl-11 pr-36 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white text-xs font-bold font-mono text-slate-800 placeholder:text-slate-400 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all duration-300"
                      />
                      <div className="absolute inset-y-1.5 right-1.5 flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            const randomCode = normalizeEan13(`619${Math.floor(100000000 + Math.random() * 900000000).toString()}`) || '';
                            setFormData({ ...formData, barcode: randomCode });
                            playBeep('success');
                          }}
                          className="h-full px-2.5 bg-slate-100 hover:bg-slate-200 text-[10px] font-black uppercase tracking-wider text-slate-600 rounded-lg transition-colors border border-slate-200 cursor-pointer"
                          title="Générer un code-barres aléatoire commençant par 619 Tunisie"
                        >
                          Générer
                        </button>
                        <button
                          type="button"
                          onClick={printBarcode}
                          className="h-full px-2.5 bg-indigo-600 hover:bg-indigo-700 text-[10px] font-black uppercase tracking-wider text-white rounded-lg transition-colors cursor-pointer"
                          title="Imprimer l’étiquette EAN-13"
                        >
                          Imprimer
                        </button>
                      </div>
                    </div>

                    {scanStatus === 'scanned' && (
                      <div className="text-[11px] font-black text-emerald-600 bg-emerald-50/80 px-3 py-1.5 rounded-xl border border-emerald-100 flex items-center gap-2 animate-in fade-in slide-in-from-top-1 duration-300">
                        <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
                        <span>{scanMessage}</span>
                      </div>
                    )}
                    
                    <p className="text-[10px] text-slate-500 font-sans leading-relaxed">
                      Vous pouvez scanner directement le produit à tout moment pendant que ce formulaire est ouvert. La douchette remplira automatiquement ce champ et émettra un signal sonore.
                    </p>
                  </div>

                  <label className="col-span-2 flex items-start gap-3 rounded-xl border border-indigo-100 bg-indigo-50/60 p-3 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={formData.isService}
                      disabled={!!editingProduct}
                      onChange={(e) => setFormData(current => ({
                        ...current,
                        isService: e.target.checked,
                        ...(e.target.checked ? { buyPrice: 0, stock: 0, lowStockAlert: 0 } : {}),
                      }))}
                      className="mt-0.5 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    <span>
                      <span className="block font-bold">C'est un service (main-d'œuvre) — sans prix d'achat ni stock</span>
                      <span className="block text-xs text-slate-500">Les services sont vendables sans suivi ni décrément de stock.</span>
                      {!!editingProduct && <span className="block text-xs text-slate-500">Le type d’article ne peut pas être converti après sa création.</span>}
                    </span>
                  </label>

                  <div className="col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-1">Catégorie</label>
                    <div className="flex gap-2">
                      <select
                        value={formData.category}
                        onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                        className="flex-1 px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none text-slate-800 bg-white"
                        required
                      >
                        {categories.length === 0 ? (
                          <option value="">⚠️ Veuillez créer une catégorie</option>
                        ) : (
                          <>
                            <option value="">-- Choisir une catégorie --</option>
                            {categories.map(cat => (
                              <option key={cat.id} value={cat.name}>{cat.name}</option>
                            ))}
                          </>
                        )}
                      </select>
                      <button
                        type="button"
                        onClick={() => setIsQuickCategoryModalOpen(true)}
                        disabled={!canAddEdit}
                        className="p-2.5 bg-indigo-50 text-indigo-600 rounded-xl hover:bg-indigo-100 transition-colors cursor-pointer"
                        title="Ajouter une catégorie"
                      >
                        <Plus className="w-5 h-5" />
                      </button>
                    </div>
                  </div>

                  {!formData.isService && <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Stock Initial</label>
                    <input
                      type="number"
                      required
                      min="0"
                      value={formData.stock}
                      onChange={(e) => setFormData({ ...formData, stock: parseInt(e.target.value) })}
                      disabled={!!editingProduct}
                      className="w-full px-4 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none"
                    />
                  </div>}

                  {!formData.isService && <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Alerte stock faible (0)</label>
                    <input
                      type="number"
                      min="0"
                      value={formData.lowStockAlert}
                      onChange={(e) => setFormData({ ...formData, lowStockAlert: parseInt(e.target.value) })}
                      className="w-full px-4 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none"
                    />
                  </div>}

                  {canViewBuyPrice && !formData.isService && <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Prix Achat ({storeSettings?.currency || 'DT'})</label>
                    <input
                      type="text"
                      inputMode="decimal"
                      required
                      value={buyPriceInput}
                      onChange={(e) => {
                        const value = e.target.value.replace(',', '.');
                        if (value === '' || /^\d*\.?\d*$/.test(value)) {
                          setBuyPriceInput(value);
                          const parsed = parseFloat(value) || 0;
                          setFormData({ ...formData, buyPrice: Math.round(parsed * 1000) / 1000 });
                        }
                      }}
                      onBlur={() => {
                        const parsed = parseFloat(buyPriceInput) || 0;
                        const rounded = Math.round(parsed * 1000) / 1000;
                        setBuyPriceInput(rounded === 0 ? '' : rounded.toFixed(3));
                        setFormData({ ...formData, buyPrice: rounded });
                      }}
                      placeholder="0.00"
                      readOnly={!isAdmin}
                      className="w-full px-4 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none read-only:bg-gray-100"
                    />
                  </div>}

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Prix Vente ({storeSettings?.currency || 'DT'})</label>
                    <input
                      type="text"
                      inputMode="decimal"
                      required
                      readOnly={!canEditSellPrice}
                      value={sellPriceInput}
                      onChange={(e) => {
                        const value = e.target.value.replace(',', '.');
                        if (value === '' || /^\d*\.?\d*$/.test(value)) {
                          setSellPriceInput(value);
                          const parsed = parseFloat(value) || 0;
                          setFormData({ ...formData, sellPrice: Math.round(parsed * 1000) / 1000 });
                        }
                      }}
                      onBlur={() => {
                        const parsed = parseFloat(sellPriceInput) || 0;
                        const rounded = Math.round(parsed * 1000) / 1000;
                        setSellPriceInput(rounded === 0 ? '' : rounded.toFixed(3));
                        setFormData({ ...formData, sellPrice: rounded });
                      }}
                      placeholder="0.00"
                      className="w-full px-4 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none read-only:bg-slate-100"
                    />
                  </div>

                  <div className="col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-1">Date Expiration</label>
                    <input
                      type="date"
                      value={formData.expirationDate}
                      onChange={(e) => setFormData({ ...formData, expirationDate: e.target.value })}
                      className="w-full px-4 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none box-border"
                    />
                  </div>
                </div>
              </div>

              <div className="flex-shrink-0 border-t border-gray-100 p-4 bg-gray-50/70 flex gap-3 pb-[calc(1rem+env(safe-area-inset-bottom,0px))]">
                <button
                  type="button"
                  onClick={closeModal}
                  className="flex-1 px-4 py-2.5 bg-gray-150 hover:bg-gray-200 text-gray-700 font-bold rounded-xl transition-colors cursor-pointer text-sm"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex-1 px-4 py-2.5 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 transition-colors shadow-lg shadow-indigo-600/15 cursor-pointer text-sm disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {isSubmitting ? 'Enregistrement…' : (editingProduct ? 'Enregistrer' : 'Ajouter')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* Quick Category Modal */}
      {canAddEdit && isQuickCategoryModalOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden border border-slate-100 flex flex-col">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
              <h2 className="text-base font-black text-slate-800 uppercase tracking-wide flex items-center gap-2">
                <Tag className="w-4 h-4 text-indigo-500 animate-pulse" />
                Gérer les Catégories
              </h2>
              <button onClick={() => setIsQuickCategoryModalOpen(false)} className="p-2 text-slate-400 hover:text-slate-600 rounded-lg cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="p-5 space-y-5">
              {/* Add form */}
              <form onSubmit={handleQuickCategoryAdd} className="space-y-2">
                <label className="block text-xs font-black uppercase tracking-wider text-slate-600">Nouveau nom de catégorie</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    autoFocus
                    required
                    value={newCategoryName}
                    onChange={(e) => setNewCategoryName(e.target.value)}
                    className="flex-1 px-3.5 py-2 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none text-xs font-semibold placeholder:text-slate-400 bg-slate-50 focus:bg-white transition-all text-slate-900"
                    placeholder="Ex: Boissons, Fruits..."
                  />
                  <button
                    type="submit"
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-black uppercase tracking-wider rounded-xl transition-all shadow-md shadow-indigo-600/10 cursor-pointer flex items-center gap-1"
                  >
                    <Plus className="w-4 h-4" />
                    Ajouter
                  </button>
                </div>
              </form>

              {/* List of existing categories */}
              <div className="space-y-2.5">
                <span className="block text-xs font-black uppercase tracking-wider text-slate-600 border-b border-slate-100 pb-1.5 mb-1">
                  Catégories existantes ({categories.length})
                </span>
                
                <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                  {categories.length === 0 ? (
                    <p className="text-center py-6 text-slate-400 text-xs font-medium">Aucune catégorie enregistrée.</p>
                  ) : (
                    categories.map((cat) => (
                      <div key={cat.id} className="flex items-center justify-between px-3 py-2 bg-slate-50 hover:bg-slate-100/50 border border-slate-100 rounded-xl transition-all group">
                        {deletingCatId === cat.id ? (
                          <div className="flex items-center justify-between w-full animate-in fade-in slide-in-from-right-1 duration-150">
                            <span className="text-[11px] font-black text-red-600 uppercase tracking-wider flex items-center gap-1">
                              <AlertTriangle className="w-3.5 h-3.5 text-red-500" />
                              Supprimer?
                            </span>
                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => setDeletingCatId(null)}
                                className="px-2 py-1 text-[10px] font-bold text-slate-500 hover:text-slate-700 bg-slate-200 rounded-lg transition-colors cursor-pointer"
                              >
                                Non
                              </button>
                              <button
                                type="button"
                                onClick={() => executeCategoryDelete(cat.id, cat.name)}
                                className="px-2.5 py-1 text-[10px] font-black text-white bg-red-600 hover:bg-red-700 rounded-lg transition-all cursor-pointer"
                              >
                                Oui
                              </button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <span className="text-xs font-bold text-slate-700 flex items-center gap-2">
                              <Tag className="w-3.5 h-3.5 text-slate-400 group-hover:text-indigo-500 transition-colors" />
                              {cat.name}
                            </span>
                            
                            <button
                              type="button"
                              onClick={() => setDeletingCatId(cat.id)}
                              className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
                              title={`Supprimer la catégorie ${cat.name}`}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            <div className="px-6 py-3 border-t border-slate-50 bg-slate-50/50 flex justify-between items-center">
              <button
                type="button"
                onClick={handleResetDefaultCategories}
                className="text-slate-500 hover:text-indigo-600 text-[10px] font-black uppercase tracking-wider underline cursor-pointer"
                title="Restaurer les catégories de base par défaut"
              >
                Réinit. défauts
              </button>
              <button
                type="button"
                onClick={() => {
                  setDeletingCatId(null);
                  setIsQuickCategoryModalOpen(false);
                }}
                className="px-5 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 text-xs font-black uppercase tracking-wider rounded-xl transition-colors cursor-pointer"
              >
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Security Code Modal (protects edit & delete) */}
      {showSecurityModal && pendingProduct && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden border border-slate-100">
            <div className="px-6 py-4 border-b border-slate-100 bg-rose-50/50 flex items-center justify-between">
              <h3 className="text-sm font-black text-slate-800 uppercase tracking-wider flex items-center gap-2">
                <Shield className="w-4 h-4 text-rose-500" />
                Code de sécurité requis
              </h3>
              <button
                onClick={() => { setShowSecurityModal(false); setPendingAction(null); setPendingProduct(null); setSecurityCode(''); setSecurityError(false); }}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-xs text-slate-500 font-medium">
                Saisissez le code de sécurité à 4 chiffres pour autoriser {pendingAction === 'edit' ? 'la modification' : 'la suppression'} du produit <strong className="text-slate-800">"{pendingProduct.name}"</strong>.
              </p>
              <div className="relative">
                <Shield className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-rose-400" />
                <input
                  type={showSecurityInput ? 'text' : 'password'}
                  name="product-security-code"
                  autoComplete="one-time-code"
                  maxLength={4}
                  inputMode="numeric"
                  autoFocus
                  value={securityCode}
                  onChange={(e) => {
                    const val = e.target.value.replace(/[^0-9]/g, '').slice(0, 4);
                    setSecurityCode(val);
                    setSecurityError(false);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && securityCode.length === 4) {
                      confirmSecureAction();
                    }
                  }}
                  placeholder="● ● ● ●"
                  className={`w-full pl-9 pr-10 py-3 border-2 rounded-xl text-center text-xl font-mono font-black tracking-[0.5em] outline-none transition-colors ${
                    securityError
                      ? 'border-red-400 bg-red-50 text-red-700 focus:border-red-500'
                      : 'border-slate-200 bg-white text-slate-800 focus:border-rose-500 focus:ring-2 focus:ring-rose-500/10'
                  }`}
                />
                <button
                  type="button"
                  onClick={() => setShowSecurityInput(!showSecurityInput)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  {showSecurityInput ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" /> }
                </button>
              </div>
              {securityError && (
                <p className="text-xs text-red-600 font-bold flex items-center gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5" />
                  Code incorrect. Veuillez réessayer.
                </p>
              )}
              <div className="flex gap-3 pt-1">
                <button
                  onClick={() => { setShowSecurityModal(false); setPendingAction(null); setPendingProduct(null); setSecurityCode(''); setSecurityError(false); }}
                  className="flex-1 px-4 py-2.5 bg-slate-100 text-slate-700 text-xs font-bold rounded-xl hover:bg-slate-200 transition-colors uppercase tracking-wider"
                >
                  Annuler
                </button>
                <button
                  onClick={confirmSecureAction}
                  className="flex-1 px-4 py-2.5 bg-rose-600 text-white text-xs font-black rounded-xl hover:bg-rose-700 transition-colors uppercase tracking-wider shadow-md shadow-rose-600/20"
                >
                  Valider
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Product Delete Confirmation Modal */}
      {productToDelete && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden border border-slate-100 p-6 space-y-4">
            <div className="flex items-start gap-3">
              <div className="p-2 bg-red-50 text-red-600 rounded-xl">
                <AlertTriangle className="w-6 h-6 animate-pulse" />
              </div>
              <div className="space-y-1">
                <h3 className="text-sm font-black text-slate-800 uppercase tracking-wider">Supprimer le produit ?</h3>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Êtes-vous sûr de vouloir supprimer définitivement le produit <strong className="text-slate-800">"{productToDelete.name}"</strong> ? Cette action est irréversible.
                </p>
              </div>
            </div>

            {errorMsg && (
              <div className="p-3 bg-red-50 border border-red-100 rounded-xl flex items-start gap-2 text-red-700 text-xs font-medium animate-in fade-in duration-150">
                <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span className="break-all">{errorMsg}</span>
              </div>
            )}
            
            <div className="flex gap-3 justify-end pt-2">
              <button
                type="button"
                onClick={() => setProductToDelete(null)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-bold uppercase tracking-wider rounded-xl transition-colors cursor-pointer"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={executeProductDelete}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-xs font-black uppercase tracking-wider rounded-xl transition-colors shadow-md shadow-red-600/10 cursor-pointer"
              >
                Supprimer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Replenish Stock Modal */}
      {replenishProduct && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-2 sm:p-4 bg-black/50 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md flex flex-col max-h-[calc(100vh-24px)] sm:max-h-[85vh] overflow-hidden border border-slate-100">
            <div className="flex-shrink-0 px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-sm font-black text-slate-800 uppercase tracking-wider">
                Approvisionner : {replenishProduct.name}
              </h3>
              <button 
                onClick={() => setReplenishProduct(null)}
                className="p-1 text-gray-400 hover:text-gray-600 rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <form onSubmit={handleReplenishSubmit} className="flex-1 flex flex-col min-h-0 overflow-hidden">
              <div className="flex-1 overflow-y-auto p-6 space-y-4 touch-pan-y">
                <div>
                  <label className="block text-xs font-black uppercase tracking-wider text-slate-600 mb-1">
                    Quantité à ajouter au stock
                  </label>
                  <input
                    type="number"
                    required
                    min="1"
                    placeholder="Ex: 50"
                    value={replenishQty}
                    onChange={(e) => setReplenishQty(e.target.value)}
                    className="w-full px-4 py-2 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500/20 focus:border-indigo-500 outline-none text-xs font-bold"
                  />
                </div>

                {isAdmin && <div>
                  <label className="block text-xs font-black uppercase tracking-wider text-slate-600 mb-1">
                    Prix d'achat unitaire ({storeSettings?.currency || 'DT'})
                  </label>
                  <input
                    type="number"
                    step="0.001"
                    required
                    min="0.001"
                    placeholder="Ex: 2.500"
                    value={replenishPrice}
                    onChange={(e) => setReplenishPrice(e.target.value)}
                    className="w-full px-4 py-2 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500/20 focus:border-indigo-500 outline-none text-xs font-bold font-mono"
                  />
                </div>}

                {isAdmin && replenishQty && replenishPrice && (
                  <div className="p-3.5 bg-slate-50 border border-slate-100 rounded-xl space-y-1 my-2">
                    <div className="flex justify-between text-xs text-slate-500 font-medium">
                      <span>Quantité :</span>
                      <span className="font-bold text-slate-700">{replenishQty}</span>
                    </div>
                    <div className="flex justify-between text-xs text-slate-500 font-medium">
                      <span>Prix unitaire :</span>
                      <span className="font-bold text-slate-700">{parseFloat(replenishPrice).toFixed(3)} {storeSettings?.currency || 'DT'}</span>
                    </div>
                    <div className="border-t border-slate-200/50 my-1.5 pt-1.5 flex justify-between text-xs font-bold text-slate-800">
                      <span>Dépense totale estimée :</span>
                      <span className="text-emerald-700 font-black">
                        {(parseInt(replenishQty) * parseFloat(replenishPrice)).toFixed(3)} {storeSettings?.currency || 'DT'}
                      </span>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex-shrink-0 border-t border-slate-100 p-4 bg-slate-50/70 flex gap-3 justify-end pb-[calc(1rem+env(safe-area-inset-bottom,0px))] animate-in fade-in duration-200">
                <button
                  type="button"
                  onClick={() => setReplenishProduct(null)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-650 text-xs font-bold uppercase tracking-wider rounded-xl transition-colors cursor-pointer"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black uppercase tracking-wider rounded-xl transition-all shadow-md shadow-emerald-600/10 cursor-pointer active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {isSubmitting ? 'En cours…' : 'Confirmer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Stock History Modal (diagnostic) */}
      {historyProduct && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-2 sm:p-4 bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col max-h-[calc(100vh-24px)] sm:max-h-[85vh] overflow-hidden border border-gray-100 animate-in zoom-in-95 duration-150">
            <div className="flex-shrink-0 px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
              <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                <History className="w-5 h-5 text-indigo-600" />
                Historique : {historyProduct.name}
              </h2>
              <button
                onClick={() => setHistoryProduct(null)}
                className="p-2 text-gray-400 hover:text-gray-600 rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-4 touch-pan-y">
              {historyLoading && (
                <div className="flex flex-col items-center justify-center py-10 text-gray-400 gap-3">
                  <Loader2 className="w-8 h-8 animate-spin" />
                  <span className="text-sm font-medium">Chargement de l'historique…</span>
                </div>
              )}

              {!historyLoading && historyError && (
                <div className="p-3.5 bg-red-50 border border-red-100 rounded-xl flex items-start gap-2 text-red-700 text-xs font-medium">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <span>Erreur : {historyError}</span>
                </div>
              )}

              {!historyLoading && !historyError && historyTotals && (() => {
                const displayedStock = historyProduct.stock || 0;
                const theoretical = historyTotals.totalIn - historyTotals.totalOut;
                const gap = displayedStock - theoretical;
                return (
                  <>
                    {/* Résumé */}
                    <div className="grid grid-cols-3 gap-2">
                      <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-100 text-center">
                        <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-700">Entrées</div>
                        <div className="text-xl font-black text-emerald-700">{historyTotals.totalIn}</div>
                      </div>
                      <div className="p-3 rounded-xl bg-blue-50 border border-blue-100 text-center">
                        <div className="text-[10px] font-bold uppercase tracking-wider text-blue-700">Ventes</div>
                        <div className="text-xl font-black text-blue-700">{historyTotals.totalOut}</div>
                      </div>
                      <div className="p-3 rounded-xl bg-slate-50 border border-slate-100 text-center">
                        <div className="text-[10px] font-bold uppercase tracking-wider text-slate-600">Théorique</div>
                        <div className="text-xl font-black text-slate-700">{theoretical}</div>
                      </div>
                    </div>

                    {/* Verdict écart */}
                    <div className={cn(
                      "p-4 rounded-xl border flex items-start gap-3",
                      gap === 0 ? "bg-emerald-50 border-emerald-150" : "bg-amber-50 border-amber-150"
                    )}>
                      {gap === 0
                        ? <Package className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" />
                        : <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />}
                      <div className="text-xs leading-relaxed">
                        <div className="font-bold text-gray-800">
                          Stock affiché : {displayedStock} &nbsp;·&nbsp; Théorique : {theoretical} &nbsp;·&nbsp; Écart : {gap > 0 ? '+' : ''}{gap}
                        </div>
                        <div className="mt-1 text-gray-600">
                          {gap === 0 && "Cohérent : le stock affiché correspond aux mouvements enregistrés."}
                          {gap > 0 && `${gap} unité(s) en trop. Cause probable : édition manuelle du stock, ou vente hors-ligne dont la décrémentation a été écrasée à la synchronisation.`}
                          {gap < 0 && `${-gap} unité(s) manquante(s). Cause probable : vente comptée en double, ou approvisionnement non enregistré.`}
                        </div>
                      </div>
                    </div>

                    {/* Journal des mouvements */}
                    <div>
                      <div className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-2">
                        Mouvements ({historyMovements.length})
                      </div>
                      {historyMovements.length === 0 ? (
                        <div className="text-sm text-gray-400 italic py-4 text-center">
                          Aucun mouvement enregistré. Le stock a probablement été saisi manuellement.
                        </div>
                      ) : (
                        <div className="space-y-1.5">
                          {historyMovements.map((m, i) => (
                            <div
                              key={i}
                              className="flex items-center justify-between px-3 py-2 rounded-lg bg-gray-50 border border-gray-100 text-xs"
                            >
                              <div className="flex items-center gap-2">
                                {m.type === 'in'
                                  ? <ArrowUp className="w-3.5 h-3.5 text-emerald-600" />
                                  : <ArrowDown className="w-3.5 h-3.5 text-blue-600" />}
                                <span className="font-medium text-gray-700">{m.label}</span>
                              </div>
                              <div className="flex items-center gap-3">
                                <span className="text-gray-400">
                                  {m.date ? m.date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—'}
                                </span>
                                <span className={cn(
                                  "font-black tabular-nums",
                                  m.type === 'in' ? "text-emerald-600" : "text-blue-600"
                                )}>
                                  {m.type === 'in' ? '+' : '−'}{m.qty}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </>
                );
              })()}
            </div>

            <div className="flex-shrink-0 border-t border-slate-100 p-4 bg-slate-50/70 flex justify-end pb-[calc(1rem+env(safe-area-inset-bottom,0px))]">
              <button
                type="button"
                onClick={() => setHistoryProduct(null)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-650 text-xs font-bold uppercase tracking-wider rounded-xl transition-colors cursor-pointer"
              >
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
