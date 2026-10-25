import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { collection, onSnapshot, addDoc, updateDoc, doc, query, orderBy, serverTimestamp, runTransaction, getDoc, getDocs, where, getDocFromServer } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { apiFetch } from '../lib/api';
import { computeTotals } from '../lib/financial';
import { Product, Client, SaleItem, Sale, Invoice, Category, StoreSettings, UserProfile } from '../types';
import { handleFirestoreError, OperationType } from '../App';
import { Search, ShoppingCart, Trash2, Plus, Minus, User, CreditCard, CheckCircle, AlertCircle, Printer, X, FileText, Barcode, Filter, Tag, Coins, Percent, TrendingUp, UserCheck, Flame } from 'lucide-react';
import { cn, decodeAzertyBarcode } from '../lib/utils';
import { format } from 'date-fns';
import { PrintableTicket } from './PrintableTicket';
import { can } from '../lib/permissions';

interface POSProps {
  userProfile: UserProfile | null;
}

export default function POS({ userProfile }: POSProps) {
  const ownerId = (userProfile?.role === 'admin' ? userProfile?.uid : userProfile?.ownerId) || userProfile?.uid || auth.currentUser?.uid;
  const isAdmin = userProfile?.role === 'admin';
  const canViewBuyPrice = can(userProfile, 'products', 'viewBuyPrice');
  const canViewCosts = can(userProfile, 'reparation', 'viewCosts');
  const canViewMargin = canViewBuyPrice && canViewCosts;
  const [products, setProducts] = useState<Product[]>([]);
  const productCostsRef = useRef<Record<string, number>>({});
  const [clients, setClients] = useState<Client[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [cart, setCart] = useState<SaleItem[]>([]);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [receivedCash, setReceivedCash] = useState<number>(0);
  const [receivedCashInput, setReceivedCashInput] = useState('0');
  const [isReceivedCashFocused, setIsReceivedCashFocused] = useState(false);

  const [discount, setDiscount] = useState<number>(0);
  const [discountInput, setDiscountInput] = useState('0');
  const [isDiscountFocused, setIsDiscountFocused] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [saleSuccess, setSaleSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastInvoice, setLastInvoice] = useState<Invoice | null>(null);
  const [storeSettings, setStoreSettings] = useState<StoreSettings | null>(null);
  const [scannerActive, setScannerActive] = useState(true);
  const [scanNotification, setScanNotification] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [manualCode, setManualCode] = useState('');
  const [editingQtyId, setEditingQtyId] = useState<string | null>(null);
  const [editingQtyValue, setEditingQtyValue] = useState<string>('');

  // Modale de vente à crédit
  const [isCreditModalOpen, setIsCreditModalOpen] = useState(false);
  const [creditPartialInput, setCreditPartialInput] = useState('');
  const [creditModalError, setCreditModalError] = useState<string | null>(null);

  const handlePrint = () => {
    if (!lastInvoice) {
      console.warn('Aucune facture à imprimer.');
      return;
    }
    // Small delay to ensure the ticket is rendered in the DOM
    setTimeout(() => {
      try {
        window.print();
      } catch (e) {
        console.error('Erreur lors de l\'impression:', e);
        alert('L\'impression a échoué. Veuillez essayer d\'ouvrir l\'application dans un nouvel onglet.');
      }
    }, 500);
  };

  useEffect(() => {
    if (!auth.currentUser || !ownerId) return;
    productCostsRef.current = {};
    const unsubscribeProds = onSnapshot(query(collection(db, 'products'), where('ownerId', '==', ownerId)), (snapshot) => {
      const prods = snapshot.docs.map(item => {
        const publicData = item.data();
        const legacyBuyPrice = isAdmin ? Number(publicData.buyPrice) || 0 : 0;
        delete publicData.buyPrice;
        return {
          id: item.id,
          ...publicData,
          buyPrice: canViewBuyPrice ? (productCostsRef.current[item.id] ?? legacyBuyPrice) : 0,
        } as Product;
      });
      prods.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      setProducts(prods);
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, 'products');
    });
    const unsubscribeCosts = canViewBuyPrice
      ? onSnapshot(query(collection(db, 'product_costs'), where('ownerId', '==', ownerId)), snapshot => {
        const costs = Object.fromEntries(snapshot.docs.map(item => [item.id, Number(item.data().buyPrice) || 0]));
        productCostsRef.current = costs;
        setProducts(current => current.map(product => ({
          ...product,
          buyPrice: costs[product.id] ?? product.buyPrice,
        })));
      }, err => handleFirestoreError(err, OperationType.LIST, 'product_costs'))
      : () => {
        productCostsRef.current = {};
      };
    const unsubscribeClients = onSnapshot(query(collection(db, 'clients'), where('ownerId', '==', ownerId)), (snapshot) => {
      const cls = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Client));
      cls.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      setClients(cls);
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, 'clients');
    });
    const unsubscribeCats = onSnapshot(query(collection(db, 'categories'), where('ownerId', '==', ownerId)), (snapshot) => {
      const cats = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Category));
      cats.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      setCategories(cats);
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, 'categories');
    });
    const unsubscribeStore = onSnapshot(doc(db, 'settings', ownerId), (snapshot) => {
      if (snapshot.exists()) {
        setStoreSettings(snapshot.data() as StoreSettings);
      }
    }, (err) => {
      handleFirestoreError(err, OperationType.GET, `settings/${ownerId}`);
    });
    return () => {
      unsubscribeProds();
      unsubscribeCosts();
      unsubscribeClients();
      unsubscribeCats();
      unsubscribeStore();
    };
  }, [ownerId, isAdmin, canViewBuyPrice]);

  // Auto-clear helper for scan notification
  useEffect(() => {
    if (scanNotification) {
      const timer = setTimeout(() => setScanNotification(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [scanNotification]);

  // Audio synths for scanner beeps
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
        // Double low pitch beep for error
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
            } catch (innerErr) {
              console.warn(innerErr);
            }
          }, delay);
        });
      }
    } catch (err) {
      console.warn('Audio feedback failed (might require user interaction first):', err);
    }
  };

  // Global barcode reader logic for physical laser scanners (douchette)
  useEffect(() => {
    if (!scannerActive) return;

    let buffer = '';
    let lastKeyTime = 0;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      if (e.key === 'Tab' || e.key === 'Escape' || e.key === 'ArrowUp' || e.key === 'ArrowDown') return;

      const now = Date.now();
      const target = e.target as HTMLElement;
      const isInputFocused = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      
      // If user is actively typing in an input, let the browser handle keyboard events natively to prevent conflicts
      if (isInputFocused) {
        return;
      }

      const interval = lastKeyTime ? now - lastKeyTime : 0;
      lastKeyTime = now;

      if (e.key.length === 1) {
        // Physical barcode scanners transmit keyboard events at high speed (usually < 50ms)
        // If the interval is high (> 120ms), it's either the very first character of a scan or human keystrokes.
        // We set it as the new first character of our buffer.
        if (interval > 120) {
          buffer = e.key;
        } else {
          buffer += e.key;
        }
      } else if (e.key === 'Enter') {
        const barcode = decodeAzertyBarcode(buffer.trim());
        buffer = ''; // reset buffer
        lastKeyTime = 0;

        if (barcode.length >= 3) {
          // Find matching product
          const matchedProduct = products.find(p => p.barcode === barcode);
          if (matchedProduct) {
            if (matchedProduct.inventoryType !== 'service' && matchedProduct.stock <= 0) {
              setScanNotification({
                message: `Rupture de Stock pour ${matchedProduct.name}`,
                type: 'error'
              });
              playBeep('error');
            } else {
              addToCart(matchedProduct);
              setScanNotification({
                message: `Code : ${barcode} | Ajouté : ${matchedProduct.name}`,
                type: 'success'
              });
              playBeep('success');
            }
            e.preventDefault();
            e.stopPropagation();
          } else {
            setScanNotification({
              message: `Code non reconnu : ${barcode}`,
              type: 'error'
            });
            playBeep('error');
            e.preventDefault();
            e.stopPropagation();
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [scannerActive, products]);

  // Fréquence de vente par produit (quantités cumulées) pour trier les raccourcis
  const [salesQtyMap, setSalesQtyMap] = useState<Record<string, number>>({});
  useEffect(() => {
    if (!ownerId || ownerId === 'no_user_auth') return;
    getDocs(query(collection(db, 'sales'), where('ownerId', '==', ownerId)))
      .then(snapshot => {
        const map: Record<string, number> = {};
        snapshot.docs.forEach(d => {
          const items = (d.data().items || []) as SaleItem[];
          items.forEach(item => {
            if (item.productId) map[item.productId] = (map[item.productId] || 0) + (item.quantity || 0);
          });
        });
        setSalesQtyMap(map);
      })
      .catch(err => console.error('[POS] Chargement fréquences de vente:', err));
  }, [ownerId]);

  const filteredProducts = useMemo(() => 
    products.filter(p => {
      const searchLower = searchTerm.toLowerCase();
      const decodedSearch = decodeAzertyBarcode(searchTerm).toLowerCase();
      
      const matchesName = p.name.toLowerCase().includes(searchLower);
      const matchesBarcode = p.barcode ? (
        p.barcode.toLowerCase().includes(searchLower) || 
        (decodedSearch && p.barcode.toLowerCase().includes(decodedSearch))
      ) : false;
      
      return (matchesName || matchesBarcode) && 
             (selectedCategory === 'all' || p.category === selectedCategory) &&
             (p.inventoryType === 'service' || p.stock > 0);
    }).sort((a, b) => {
      const qtyDiff = (salesQtyMap[b.id] || 0) - (salesQtyMap[a.id] || 0);
      if (qtyDiff !== 0) return qtyDiff;
      return a.name.localeCompare(b.name);
    }),
    [products, searchTerm, selectedCategory, salesQtyMap]
  );

  // Top 3 des meilleures ventes (badge sur les raccourcis)
  const topSellerIds = useMemo(() => {
    return new Set(
      products
        .filter(p => (salesQtyMap[p.id] || 0) > 0)
        .sort((a, b) => (salesQtyMap[b.id] || 0) - (salesQtyMap[a.id] || 0))
        .slice(0, 3)
        .map(p => p.id)
    );
  }, [products, salesQtyMap]);

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && searchTerm.trim() !== '') {
      const trimmedSearch = searchTerm.trim();
      const decodedSearch = decodeAzertyBarcode(trimmedSearch);
      // Try to find exact barcode match (either original or decoded)
      const product = products.find(p =>
        (p.barcode === trimmedSearch || p.barcode === decodedSearch) &&
        (p.inventoryType === 'service' || p.stock > 0)
      );
      if (product) {
        addToCart(product);
        setSearchTerm('');
        e.preventDefault();
      }
    }
  };

  // Article du panier sélectionné pour le contrôle clavier (flèches)
  const [selectedCartItemId, setSelectedCartItemId] = useState<string | null>(null);

  const addToCart = (product: Product) => {
    setCart(prev => {
      const existing = prev.find(item => item.productId === product.id);
      if (existing) {
        if (product.inventoryType !== 'service' && existing.quantity >= product.stock) {
          setError(`Stock insuffisant pour ${product.name} (Disponible: ${product.stock})`);
          setTimeout(() => setError(null), 3000);
          return prev;
        }
        return prev.map(item => 
          item.productId === product.id 
            ? { ...item, quantity: item.quantity + 1, total: (item.quantity + 1) * item.price }
            : item
        );
      }
      // Le dernier article ajouté apparaît en haut du ticket
      return [{
        productId: product.id,
        name: product.name,
        quantity: 1,
        price: product.sellPrice,
        total: product.sellPrice
      }, ...prev];
    });
    setSelectedCartItemId(product.id);
  };

  const updateQuantity = (productId: string, delta: number) => {
    setCart(prev => prev.map(item => {
      if (item.productId === productId) {
        const product = products.find(p => p.id === productId);
        const newQty = Math.max(1, item.quantity + delta);
        
        if (product) {
          if (product.inventoryType !== 'service' && newQty > product.stock) {
            setError(`Stock insuffisant pour ${item.name} (Disponible: ${product.stock})`);
            setTimeout(() => setError(null), 3000);
            return item;
          }
        }
        
        return { ...item, quantity: newQty, total: newQty * item.price };
      }
      return item;
    }));
  };

  const removeFromCart = (productId: string) => {
    setCart(prev => prev.filter(item => item.productId !== productId));
  };

  // Garde une sélection valide dans le panier (par défaut : l'article en haut, le dernier ajouté)
  useEffect(() => {
    if (cart.length === 0) {
      if (selectedCartItemId !== null) setSelectedCartItemId(null);
      return;
    }
    if (!cart.some(i => i.productId === selectedCartItemId)) {
      setSelectedCartItemId(cart[0].productId);
    }
  }, [cart, selectedCartItemId]);

  // Refs toujours à jour pour éviter les closures périmées dans le handler clavier global
  // (initialisées à vide car validateSale est déclarée plus bas dans le composant)
  const validateSaleRef = useRef<(isCredit?: boolean, creditPaid?: number) => void>(() => {});
  const updateQuantityRef = useRef<(productId: string, delta: number) => void>(() => {});
  useEffect(() => {
    validateSaleRef.current = validateSale;
    updateQuantityRef.current = updateQuantity;
  });

  // Raccourcis clavier globaux du POS :
  // - Entrée = Encaisser & Valider (ou "Nouvelle Vente" si le ticket de succès est affiché)
  // - Flèches ↑/↓ = choisir un article du panier | ←/→ = diminuer/augmenter sa quantité
  useEffect(() => {
    const handleGlobalKeys = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.altKey || e.metaKey) return;

      // Fenêtre ticket (succès) affichée : Entrée = Nouvelle Vente
      if (saleSuccess) {
        if (e.key === 'Enter') {
          e.preventDefault();
          setSaleSuccess(null);
          setLastInvoice(null);
        }
        return;
      }

      // Modale crédit ouverte : laisser le clavier à la modale
      if (isCreditModalOpen) return;

      const target = e.target as HTMLElement;
      const isInputFocused = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable);
      if (isInputFocused) return;

      if (e.key === 'Enter') {
        // Une Entrée déjà consommée par le scanner code-barres (defaultPrevented) est ignorée
        if (e.defaultPrevented) return;
        if (cart.length > 0 && !isProcessing) {
          e.preventDefault();
          validateSaleRef.current(false);
        }
        return;
      }

      if (cart.length === 0) return;
      const idx = cart.findIndex(i => i.productId === selectedCartItemId);
      const currentIdx = idx >= 0 ? idx : 0;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedCartItemId(cart[Math.min(cart.length - 1, currentIdx + 1)].productId);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedCartItemId(cart[Math.max(0, currentIdx - 1)].productId);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        setSelectedCartItemId(cart[currentIdx].productId);
        updateQuantityRef.current(cart[currentIdx].productId, 1);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setSelectedCartItemId(cart[currentIdx].productId);
        updateQuantityRef.current(cart[currentIdx].productId, -1);
      }
    };

    window.addEventListener('keydown', handleGlobalKeys);
    return () => window.removeEventListener('keydown', handleGlobalKeys);
  }, [saleSuccess, isCreditModalOpen, cart, isProcessing, selectedCartItemId]);

  const setQuantityDirect = (productId: string, newQty: number) => {
    const product = products.find(p => p.id === productId);
    if (!product) return;
    if (newQty < 1) {
      removeFromCart(productId);
      return;
    }
    if (product.inventoryType !== 'service' && newQty > product.stock) {
      setError(`Stock insuffisant pour ${product.name} (Disponible: ${product.stock})`);
      setTimeout(() => setError(null), 3000);
      return;
    }
    setCart(prev => prev.map(item =>
      item.productId === productId
        ? { ...item, quantity: newQty, total: newQty * item.price }
        : item
    ));
  };

  const currency = storeSettings?.currency || 'DT';
  const financialTotals = useMemo(
    () => computeTotals(cart, discount, storeSettings),
    [cart, discount, storeSettings?.tvaEnabled, storeSettings?.tva],
  );
  const { subtotal, tva: tvaAmount, total: cartTotal } = financialTotals;

  useEffect(() => {
    setReceivedCash(cartTotal);
  }, [selectedClient, cartTotal]);

  useEffect(() => {
    if (!isReceivedCashFocused) {
      setReceivedCashInput(receivedCash === 0 ? '' : receivedCash.toFixed(3));
    }
  }, [receivedCash, isReceivedCashFocused]);

  useEffect(() => {
    if (!isDiscountFocused) {
      setDiscountInput(discount === 0 ? '' : discount.toFixed(3));
    }
  }, [discount, isDiscountFocused]);

  const paidAmount = useMemo(() => {
    return Math.min(receivedCash, cartTotal);
  }, [receivedCash, cartTotal]);

  const remainingDebt = Math.round(Math.max(0, cartTotal - paidAmount) * 1000) / 1000;

  // Benefice estimé du panier de vente (sellPrice - buyPrice)
  const estimatedBenefit = useMemo(() => {
    if (!canViewMargin) return 0;
    const rawProfit = cart.reduce((sum, item) => {
      const prod = products.find(p => p.id === item.productId);
      const buyP = prod?.buyPrice || 0;
      const profit = (item.price - buyP) * item.quantity;
      return sum + profit;
    }, 0);
    return Math.max(0, Math.round((rawProfit - discount) * 1000) / 1000);
  }, [cart, products, discount, canViewBuyPrice, canViewMargin]);

  const downloadPDF = async (invoice: Invoice) => {
    try {
      const currentUser = auth.currentUser;
      if (!currentUser) throw new Error('Session invalide. Veuillez vous reconnecter.');
      const idToken = await currentUser.getIdToken();
      const response = await apiFetch('/invoices/pdf', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`
        },
        body: JSON.stringify({
          ...invoice,
          storeName: storeSettings?.storeName,
          address: storeSettings?.address,
          phone: storeSettings?.phone,
          date: format(new Date(), 'dd/MM/yyyy HH:mm')
        })
      });
      if (!response.ok) throw new Error('Impossible de générer la facture PDF.');
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `facture-${invoice.number}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (error) {
      console.error('Erreur PDF:', error);
    }
  };

  const validateSale = async (isCredit: boolean = false, creditPaid: number = 0) => {
    if (cart.length === 0) return;

    // Crédit : un client enregistré est obligatoire (impossible pour un client de passage)
    if (isCredit && !selectedClient) {
      setError('Veuillez sélectionner un client. Un crédit ne peut pas être enregistré pour un client de passage.');
      return;
    }

    setIsProcessing(true);
    setError(null);

    // Règle de paiement selon le type de client (ignorée en mode crédit : rien n'est encaissé)
    if (!isCredit) {
      if (!selectedClient) {
        if (Math.abs(paidAmount - cartTotal) > 0.001) {
          setError(`Pour un client passagé, le montant payé doit être obligatoirement égal au montant total de la vente (${cartTotal.toFixed(3)} ${currency}).`);
          setIsProcessing(false);
          return;
        }
      } else {
        if (paidAmount > cartTotal + 0.001) {
          setError(`Le montant payé ne peut pas dépasser le montant total de la vente (${cartTotal.toFixed(3)} ${currency}).`);
          setIsProcessing(false);
          return;
        }
      }
    }

    // Montants effectifs : en mode crédit, la tranche éventuellement payée est encaissée, le reste passe en dette
    const effPaid = isCredit ? Math.min(Math.max(0, Math.round(creditPaid * 1000) / 1000), cartTotal) : paidAmount;
    const effDebt = isCredit ? Math.round((cartTotal - effPaid) * 1000) / 1000 : remainingDebt;

    try {
      let generatedInvoice: Invoice | null = null;

      // Vérifie une VRAIE connexion serveur avant la vente. getDocFromServer force une
      // lecture réseau : hors-ligne (ou faux navigator.onLine), elle échoue → on bloque net,
      // aucune écriture ni mise en file, donc pas de rejeu multiple à la reconnexion.
      try {
        const preflight = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('OFFLINE')), 8000)
        );
        await Promise.race([
          getDocFromServer(doc(db, 'counters', `invoices_${ownerId}`)),
          preflight,
        ]);
      } catch {
        throw new Error('Vérifiez votre connexion Internet.');
      }

      {
        // --- ONLINE SALE FLOW ---
        await runTransaction(db, async (transaction) => {
          
          // 1. ALL READS FIRST
          const counterRef = doc(db, 'counters', `invoices_${ownerId}`);
          const counterSnap = await transaction.get(counterRef);
          
          const productSnaps = await Promise.all(
            cart.map(item => transaction.get(doc(db, 'products', item.productId)))
          );

          let clientSnap = null;
          if (selectedClient && effDebt > 0) {
            clientSnap = await transaction.get(doc(db, 'clients', selectedClient.id));
          }

          // 2. LOGIC & VALIDATION
          let nextNum = 1;
          if (counterSnap.exists()) {
            nextNum = (counterSnap.data().lastNum || 0) + 1;
          }
          
          const year = new Date().getFullYear();
          const invoiceNumber = `FAC-${year}-${nextNum.toString().padStart(4, '0')}`;

          // Validate products and stock
          const stockUpdates: Array<{
            ref: ReturnType<typeof doc>;
            productId: string;
            productName: string;
            newStock: number;
            delta: number;
            version: number;
          }> = [];
          for (let i = 0; i < cart.length; i++) {
            const item = cart[i];
            const productSnap = productSnaps[i];
            if (!productSnap.exists()) throw new Error(`Produit ${item.name} introuvable`);
            if (productSnap.data().inventoryType !== 'service') {
              const currentStock = productSnap.data().stock || 0;
              if (currentStock < item.quantity) throw new Error(`Stock insuffisant pour ${item.name} (Disponible: ${currentStock})`);
              stockUpdates.push({
                ref: doc(db, 'products', item.productId),
                productId: item.productId,
                productName: item.name,
                newStock: currentStock - item.quantity,
                delta: -item.quantity,
                version: (Number(productSnap.data().stockVersion) || 0) + 1,
              });
            }
          }

          // Validate client
          let clientUpdate = null;
          if (selectedClient && effDebt > 0) {
            if (!clientSnap || !clientSnap.exists()) throw new Error(`Client introuvable`);
            const currentDebt = clientSnap.data().debt || 0;
            clientUpdate = {
              ref: doc(db, 'clients', selectedClient.id),
              newDebt: currentDebt + effDebt
            };
          }

          // 3. ALL WRITES LAST
          const saleRef = doc(collection(db, 'sales'));
          const invoiceRef = doc(collection(db, 'invoices'));
          transaction.set(counterRef, { lastNum: nextNum }, { merge: true });

          for (const update of stockUpdates) {
            const movementRef = doc(db, 'stock_movements', `product_${update.productId}_v${update.version}`);
            transaction.update(update.ref, {
              stock: update.newStock,
              stockVersion: update.version,
              lastStockMovementId: movementRef.id,
              ownerId,
              userId: userProfile?.uid || ownerId,
            });
            transaction.set(movementRef, {
              type: 'product_sale',
              inventoryCollection: 'products',
              productId: update.productId,
              productName: update.productName,
              saleId: saleRef.id,
              delta: update.delta,
              quantity: Math.abs(update.delta),
              version: update.version,
              ownerId,
              userId: userProfile?.uid || ownerId,
              userLabel: userProfile?.name || userProfile?.email || 'Utilisateur',
              createdAt: serverTimestamp(),
            });
          }

          if (clientUpdate) {
            transaction.update(clientUpdate.ref, { debt: clientUpdate.newDebt });
          }

          const saleData = {
            id: saleRef.id,
            date: serverTimestamp(),
            clientId: selectedClient?.id || null,
            clientCode: selectedClient?.code || '',
            clientName: selectedClient?.name || 'Client de passage',
            total: cartTotal,
            paid: effPaid,
            debt: effDebt,
            tva: tvaAmount,
            subtotal: financialTotals.subtotal,
            discount: financialTotals.discount,
            tvaEnabled: storeSettings?.tvaEnabled === true,
            tvaRate: storeSettings?.tvaEnabled === true ? Number(storeSettings.tva) || 0 : 0,
            items: cart,
            invoiceId: invoiceRef.id,
            ownerId,
            userId: userProfile?.uid || ownerId
          };

          const invoiceData = {
            id: invoiceRef.id,
            number: invoiceNumber,
            saleId: saleRef.id,
            clientId: selectedClient?.id || null,
            clientCode: selectedClient?.code || '',
            clientName: selectedClient?.name || 'Client de passage',
            clientPhone: selectedClient?.phone || '',
            clientAddress: selectedClient?.address || '',
            total: cartTotal,
            paid: effPaid,
            debt: effDebt,
            tva: tvaAmount,
            subtotal: financialTotals.subtotal,
            discount: financialTotals.discount,
            tvaEnabled: storeSettings?.tvaEnabled === true,
            tvaRate: storeSettings?.tvaEnabled === true ? Number(storeSettings.tva) || 0 : 0,
            date: serverTimestamp(),
            items: cart,
            ownerId,
            userId: userProfile?.uid || ownerId
          };

          transaction.set(saleRef, saleData);
          transaction.set(invoiceRef, invoiceData);
          
          generatedInvoice = invoiceData as any;
        });
      }

      setSaleSuccess(isCredit ? 'Vente enregistrée à crédit !' : 'Vente validée avec succès !');
      setLastInvoice(generatedInvoice);
      setCart([]);
      setReceivedCash(0);
      setReceivedCashInput('0');
      setDiscount(0);
      setDiscountInput('0');
      setSelectedClient(null);
    } catch (err: any) {
      console.error('Validation failed:', err);
      setError(err.message);
      handleFirestoreError(err, OperationType.WRITE, 'sales');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 lg:h-[calc(100vh-130px)] min-h-0 relative">
      {/* Hidden printable ticket for POS - Render outside #root using Portal */}
      {createPortal(
        <div className="print-container">
          {lastInvoice && (
            <PrintableTicket invoice={lastInvoice} ownerId={ownerId} />
          )}
        </div>,
        document.body
      )}

      {/* Floating Scan Notification */}
      {scanNotification && (
        <div className={cn(
          "absolute top-4 left-1/2 -translate-x-1/2 z-[90] flex items-center gap-2 px-3 py-1.5 rounded-full shadow-md border text-[11px] font-black animate-in fade-in slide-in-from-top-4 duration-200 backdrop-blur-md transition-all",
          scanNotification.type === 'success' 
            ? "bg-emerald-50/90 border-emerald-200 text-emerald-800" 
            : "bg-rose-50/90 border-rose-200 text-rose-800"
        )}>
          <div className={cn(
            "w-1.5 h-1.5 rounded-full animate-ping shrink-0",
            scanNotification.type === 'success' ? "bg-emerald-500" : "bg-rose-500"
          )} />
          <span>{scanNotification.message}</span>
        </div>
      )}

      {/* Left: Product Selection (Compact Sidebar) */}
      <div className="order-2 lg:order-1 lg:col-span-4 flex flex-col gap-2.5 min-h-0 h-full">
        {/* Top Controls Box (Highly Compact) */}
        <div className="bg-white p-3 rounded-xl border border-gray-150 shadow-3xs space-y-2">
          {/* Barcode automatic scan status and manual input */}
          <div className="flex flex-col gap-1.5 bg-slate-50 border border-slate-100 p-2 rounded-lg relative">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <div className="relative flex items-center justify-center">
                  <Barcode className={cn("w-4 h-4 text-indigo-600", scannerActive && "animate-pulse")} />
                  {scannerActive && <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 bg-emerald-500 rounded-full animate-ping" />}
                </div>
                <div className="flex flex-col leading-tight">
                  <span className="text-[9px] font-black text-slate-700 uppercase tracking-wider">Lecteur Code à Barre</span>
                </div>
              </div>
              <button
                onClick={() => setScannerActive(!scannerActive)}
                className={cn(
                  "px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-wider transition-all border cursor-pointer",
                  scannerActive
                    ? "bg-emerald-500 text-white border-emerald-500 shadow-sm"
                    : "bg-slate-200 text-slate-600 border-slate-300"
                )}
              >
                {scannerActive ? "Actif" : "Inactif"}
              </button>
            </div>

            {scannerActive && (
              <div className="mt-0.5 bg-emerald-50/50 border border-emerald-100 p-1.5 rounded flex flex-col gap-1 animate-in fade-in duration-200">
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-2 flex items-center pointer-events-none">
                    <Barcode className="h-3.5 w-3.5 text-emerald-600 animate-pulse" />
                  </div>
                  <input
                    type="text"
                    placeholder="Scanner ou saisir code à barre..."
                    value={manualCode}
                    onChange={(e) => setManualCode(decodeAzertyBarcode(e.target.value))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        const code = manualCode.trim();
                        if (code !== '') {
                          const matchedProduct = products.find(p => p.barcode === code);
                          if (matchedProduct) {
                            if (matchedProduct.inventoryType !== 'service' && matchedProduct.stock <= 0) {
                              setScanNotification({
                                message: `Rupture : ${matchedProduct.name}`,
                                type: 'error'
                              });
                            } else {
                              addToCart(matchedProduct);
                              setScanNotification({
                                message: `Flashé : ${matchedProduct.name}`,
                                type: 'success'
                              });
                            }
                          } else {
                            setScanNotification({
                              message: `Code inconnu : ${code}`,
                              type: 'error'
                            });
                          }
                          setManualCode('');
                        }
                        e.preventDefault();
                        e.stopPropagation();
                      }
                    }}
                    className="block w-full pl-7 pr-2 py-0.5 bg-white border border-emerald-200 rounded text-[10px] font-mono font-bold tracking-wider placeholder:text-emerald-400 focus:outline-none focus:ring-1 focus:ring-emerald-500/20 focus:border-emerald-500 text-emerald-950 transition-all"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Search bar */}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Rechercher nom ou code barre..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              className="w-full pl-8 pr-3 py-1.5 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-indigo-500/10 focus:border-indigo-500 outline-none transition-all font-semibold text-xs text-slate-800"
            />
          </div>

          {/* Categories select row (Compact) */}
          <div className="flex items-center gap-1 overflow-x-auto pb-0.5 no-scrollbar">
            <button
              onClick={() => setSelectedCategory('all')}
              className={cn(
                "px-2.5 py-1 rounded text-[10px] font-black uppercase tracking-wider whitespace-nowrap transition-all border cursor-pointer",
                selectedCategory === 'all' 
                  ? "bg-indigo-600 text-white border-indigo-600 shadow-xs" 
                  : "bg-white text-gray-500 border-gray-200 hover:border-indigo-500 hover:text-indigo-600"
              )}
            >
              Tous
            </button>
            {categories.map(cat => (
              <button
                key={cat.id}
                onClick={() => setSelectedCategory(cat.name)}
                className={cn(
                  "px-2.5 py-1 rounded text-[10px] font-black uppercase tracking-wider whitespace-nowrap transition-all border cursor-pointer",
                  selectedCategory === cat.name 
                    ? "bg-indigo-600 text-white border-indigo-600 shadow-xs" 
                    : "bg-white text-gray-500 border-gray-200 hover:border-indigo-500 hover:text-indigo-600"
                )}
              >
                {cat.name}
              </button>
            ))}
          </div>
        </div>

        {/* Products Grid (Extremely Compact) */}
        <div className="flex-1 overflow-y-auto grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 gap-2 pb-2 pr-1 scrollbar-thin">
          {filteredProducts.map((product) => (
            <button
              key={product.id}
              onClick={() => addToCart(product)}
              disabled={product.inventoryType !== 'service' && product.stock <= 0}
              className={cn(
                "relative bg-white rounded-2xl border border-slate-200/80 shadow-3xs text-left flex flex-col justify-between group overflow-hidden h-[110px] min-w-0 w-full cursor-pointer transition-all duration-150",
                "hover:border-transparent hover:shadow-lg hover:shadow-violet-500/15 hover:-translate-y-0.5 hover:ring-2 hover:ring-violet-500/60 active:scale-[0.97]",
                product.inventoryType !== 'service' && product.stock <= 0 && "opacity-60 grayscale cursor-not-allowed"
              )}
            >
              <div className="absolute top-0 left-0 right-0 h-[3px] bg-gradient-to-r from-violet-600 via-fuchsia-500 to-violet-600 opacity-70 group-hover:opacity-100 transition-opacity"></div>

              <div className="w-full flex justify-between items-center gap-1 px-2 pt-2">
                <span className="flex items-center gap-1 text-[7px] font-black uppercase tracking-wider truncate max-w-[60%] text-slate-400">
                  <span className={cn(
                    "w-1.5 h-1.5 rounded-full shrink-0",
                    (() => {
                      const cat = categories.find(c => c.name === product.category);
                      if (!cat) return "bg-violet-500";
                      return cat.type === 'boissons' ? "bg-blue-500" :
                             cat.type === 'entretien' ? "bg-orange-500" :
                             cat.type === 'frais' ? "bg-fuchsia-500" :
                             "bg-violet-500";
                    })()
                  )}></span>
                  {product.category}
                </span>
                {topSellerIds.has(product.id) ? (
                  <span className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-gradient-to-r from-amber-400 to-orange-500 text-white text-[7px] font-black uppercase tracking-wider shadow-xs shrink-0">
                    <Flame className="w-2.5 h-2.5" /> Top
                  </span>
                ) : (salesQtyMap[product.id] || 0) > 0 ? (
                  <span className="text-[7px] font-black text-violet-400 uppercase tracking-wider shrink-0">
                    {salesQtyMap[product.id]} vendus
                  </span>
                ) : null}
              </div>

              <div className="flex-1 flex items-center px-2 py-0.5 min-w-0 w-full">
                <h3 className="font-extrabold text-slate-800 text-[11px] leading-tight break-words whitespace-normal overflow-hidden line-clamp-2 text-ellipsis group-hover:text-violet-700 transition-colors w-full">
                  {product.name}
                </h3>
              </div>

              <div className="w-full px-2 pb-2 flex items-center justify-between gap-1 mt-auto">
                <div className="min-w-0">
                  <span className="text-[12px] font-black bg-gradient-to-r from-violet-700 to-fuchsia-600 bg-clip-text text-transparent truncate block leading-none">
                    {product.sellPrice.toFixed(3)} <span className="text-[8px] font-bold">{currency}</span>
                  </span>
                  {product.inventoryType === 'service' ? <span className="text-[7px] font-black uppercase tracking-wider text-emerald-600">Service</span> : <span className={cn(
                    "text-[7px] font-black uppercase tracking-wider",
                    product.stock <= 5 ? "text-rose-600" : "text-slate-400"
                  )}>
                    Stock {product.stock}
                  </span>}
                </div>
                <div className="w-6 h-6 rounded-full bg-violet-50 text-violet-600 group-hover:bg-gradient-to-r group-hover:from-violet-600 group-hover:to-fuchsia-600 group-hover:text-white group-hover:scale-110 transition-all duration-150 shrink-0 flex items-center justify-center shadow-3xs">
                  <Plus className="w-3.5 h-3.5" />
                </div>
              </div>

              {product.inventoryType !== 'service' && product.stock <= 0 && (
                <div className="absolute inset-0 bg-white/70 backdrop-blur-[1px] rounded-xl flex items-center justify-center p-1 text-center">
                  <div className="bg-rose-600 text-white px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-wider shadow-xs">
                    Rupture
                  </div>
                </div>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Right: Cart, Summary & Checkout Area (Large & Dominant) */}
      <div className="order-1 lg:order-2 lg:col-span-8 flex flex-col gap-2.5 min-h-0 h-full">
        <div className="bg-white rounded-2xl border border-gray-150 shadow-sm flex flex-col flex-1 overflow-hidden h-full">
          
          {/* Header Ticket block */}
          <div className="p-2.5 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
            <h2 className="font-black text-slate-700 flex items-center gap-1.5 text-xs uppercase tracking-wider">
              <ShoppingCart className="w-4.5 h-4.5 text-indigo-600" />
              Ticket de caisse ({cart.length})
            </h2>
            <button 
              onClick={() => {
                setCart([]);
                setDiscount(0);
                setDiscountInput('0');
              }}
              disabled={cart.length === 0}
              className="text-[10px] font-black text-rose-500 hover:text-rose-600 transition-colors uppercase tracking-widest disabled:opacity-30 cursor-pointer"
            >
              Vider le Panier
            </button>
          </div>

          {/* Client Selection */}
          <div className="p-2.5 border-b border-slate-100 bg-slate-50/30 flex items-center gap-2">
            <div className="w-full relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <UserCheck className="h-4.5 w-4.5 text-indigo-600" />
              </div>
              <select
                value={selectedClient?.id || ''}
                onChange={(e) => {
                  const client = clients.find(c => c.id === e.target.value);
                  setSelectedClient(client || null);
                  if (!client) {
                    setReceivedCash(cartTotal);
                    setReceivedCashInput(cartTotal.toFixed(3));
                  }
                }}
                className="w-full pl-9 pr-3 py-1.5 bg-white border border-gray-200 rounded-xl text-xs font-bold text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500/15 focus:border-indigo-500 transition-all shadow-3xs"
              >
                <option value="">👤 Client de passage</option>
                {clients.map(c => (
                  <option key={c.id} value={c.id}>👥 {c.name} ({c.phone || 'Pas de tel'})</option>
                ))}
              </select>
            </div>
          </div>

          {/* Table representing the list of items in the Cart (Ticket columns) */}
          <div className="flex-1 overflow-y-auto p-3 min-h-0 scrollbar-thin">
            {cart.length === 0 ? (
              <div className="h-full py-16 flex flex-col items-center justify-center text-slate-350 gap-2">
                <ShoppingCart className="w-12 h-12 opacity-30" />
                <p className="text-[10px] uppercase tracking-wider font-black">Aucun produit au panier</p>
              </div>
            ) : (
              <div className="w-full overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs min-w-[420px] sm:min-w-0">
                  <thead>
                    <tr className="border-b border-slate-200 text-[10px] font-black text-slate-500 uppercase tracking-wider bg-slate-50">
                      <th className="py-2.5 px-3 text-left">Produit</th>
                      <th className="py-2.5 px-2 text-center w-24">Qté</th>
                      <th className="py-2.5 px-2 text-right w-20">Prix</th>
                      <th className="py-2.5 px-2 text-right w-24">Total</th>
                      <th className="py-2.5 px-3 text-center w-8"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {cart.map((item) => (
                      <tr
                        key={item.productId}
                        onClick={() => setSelectedCartItemId(item.productId)}
                        className={cn(
                          "transition-colors group cursor-pointer",
                          selectedCartItemId === item.productId
                            ? "bg-indigo-50/90 shadow-[inset_2px_0_0_0_theme(colors.indigo.500)]"
                            : "hover:bg-slate-50/75"
                        )}
                      >
                        <td className="py-3 px-3 text-left">
                          <p className="font-extrabold text-slate-800 text-xs sm:text-[13px] leading-snug break-words line-clamp-2" title={item.name}>
                            {item.name}
                          </p>
                        </td>
                        <td className="py-3 px-2 text-center">
                          <div className="inline-flex items-center gap-1.5 bg-slate-100/80 border border-slate-200/60 rounded-lg p-0.5 shadow-3xs">
                            <button 
                              onClick={() => updateQuantity(item.productId, -1)}
                              disabled={item.quantity <= 1}
                              className="w-5.5 h-5.5 rounded-md bg-white text-slate-700 flex items-center justify-center hover:bg-slate-200 transition-colors disabled:opacity-30 disabled:cursor-not-allowed shadow-3xs cursor-pointer font-bold"
                              title="Diminuer la quantité"
                            >
                              <Minus className="w-3 h-3" />
                            </button>

                            {editingQtyId === item.productId ? (
                              <input
                                type="number"
                                min="1"
                                autoFocus
                                onFocus={(e) => e.target.select()}
                                value={editingQtyValue}
                                onChange={(e) => setEditingQtyValue(e.target.value)}
                                onBlur={() => {
                                  const parsed = parseInt(editingQtyValue);
                                  if (!isNaN(parsed) && parsed > 0) {
                                    setQuantityDirect(item.productId, parsed);
                                  }
                                  setEditingQtyId(null);
                                  setEditingQtyValue('');
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    const parsed = parseInt(editingQtyValue);
                                    if (!isNaN(parsed) && parsed > 0) {
                                      setQuantityDirect(item.productId, parsed);
                                    }
                                    setEditingQtyId(null);
                                    setEditingQtyValue('');
                                    e.preventDefault();
                                  }
                                  if (e.key === 'Escape') {
                                    setEditingQtyId(null);
                                    setEditingQtyValue('');
                                  }
                                  e.stopPropagation();
                                }}
                                className="w-10 text-xs font-black text-slate-900 font-mono text-center bg-white border border-indigo-400 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500/30 px-1 py-0.5"
                              />
                            ) : (
                              <span
                                onClick={() => {
                                  setEditingQtyId(item.productId);
                                  setEditingQtyValue(String(item.quantity));
                                }}
                                className="w-8 text-xs sm:text-sm font-black text-slate-850 font-mono text-center cursor-pointer hover:bg-indigo-50 hover:text-indigo-600 rounded px-1 py-0.5 transition-colors select-none border border-transparent hover:border-indigo-200"
                                title="Cliquer pour modifier la quantité"
                              >
                                {item.quantity}
                              </span>
                            )}

                            <button 
                              onClick={() => updateQuantity(item.productId, 1)}
                              disabled={(() => {
                                const p = products.find(prod => prod.id === item.productId);
                                return p ? p.inventoryType !== 'service' && item.quantity >= p.stock : false;
                              })()}
                              className="w-5.5 h-5.5 rounded-md bg-white text-slate-700 flex items-center justify-center hover:bg-slate-200 transition-colors disabled:opacity-30 disabled:cursor-not-allowed shadow-3xs cursor-pointer font-bold"
                              title="Augmenter la quantité"
                            >
                              <Plus className="w-3 h-3" />
                            </button>
                          </div>
                        </td>
                        <td className="py-3 px-2 text-right font-semibold text-slate-550 font-mono text-xs sm:text-[13px]">
                          {item.price.toFixed(3)} <span className="text-[9px] font-medium text-slate-400">{currency}</span>
                        </td>
                        <td className="py-3 px-2 text-right font-black text-indigo-650 font-mono text-xs sm:text-sm">
                          {item.total.toFixed(3)} <span className="text-[10px] font-bold text-indigo-400">{currency}</span>
                        </td>
                        <td className="py-3 px-3 text-center">
                          <button 
                            onClick={() => removeFromCart(item.productId)}
                            className="w-7 h-7 rounded-lg hover:bg-rose-50 text-rose-500 hover:text-rose-600 flex items-center justify-center transition-all cursor-pointer opacity-70 group-hover:opacity-100 shadow-3xs border border-transparent hover:border-rose-100"
                            title="Supprimer du panier"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Summary Cards Panel (Tableau récapitulatif in 4 columns row on desktop, 2x2 on mobile) */}
          <div className="bg-slate-50/50 p-2 border-t border-slate-100 grid grid-cols-2 sm:grid-cols-4 gap-2">
            {/* Card 1: Nombre d'articles */}
            <div className="bg-white border border-slate-150 rounded-lg p-2 flex items-center justify-between shadow-3xs">
              <div className="min-w-0">
                <span className="text-[8px] font-black text-slate-400 uppercase tracking-wider block">Articles</span>
                <span className="text-sm font-black text-slate-800 font-mono block leading-none mt-1">
                  {cart.reduce((sum, item) => sum + item.quantity, 0)} <span className="text-[9px] font-bold text-slate-500 uppercase">pces</span>
                </span>
              </div>
              <div className="w-6 h-6 rounded bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0 ml-1">
                <ShoppingCart className="w-3 h-3" />
              </div>
            </div>

            {/* Card 2: Montant Brut */}
            <div className="bg-white border border-slate-150 rounded-lg p-2 flex items-center justify-between shadow-3xs">
              <div className="min-w-0">
                <span className="text-[8px] font-black text-slate-400 uppercase tracking-wider block">Total Brut</span>
                <span className="text-xs sm:text-sm font-black text-slate-700 font-mono block leading-none mt-1 truncate">
                  {(subtotal + tvaAmount).toFixed(3)} <span className="text-[8px] font-bold text-slate-500">{currency}</span>
                </span>
              </div>
              <div className="w-6 h-6 rounded bg-slate-100 text-slate-600 flex items-center justify-center shrink-0 ml-1">
                <Coins className="w-3 h-3" />
              </div>
            </div>

            {/* Card 3: Remise Appliquée avec champ d'écriture directe (Sleek) */}
            <div className="bg-amber-50/60 border border-amber-200/80 rounded-lg p-2 flex flex-col justify-between shadow-3xs">
              <div className="flex items-center justify-between">
                <span className="text-[8px] font-black text-amber-800 uppercase tracking-wider">Remise (DT)</span>
                <Percent className="w-3 h-3 text-amber-600 shrink-0" />
              </div>
              <div className="flex items-center gap-1 mt-0.5 bg-white border border-amber-200 rounded-md p-0.5">
                <input
                  type="text"
                  inputMode="decimal"
                  value={discountInput}
                  onFocus={(e) => {
                    setIsDiscountFocused(true);
                    e.currentTarget.select();
                  }}
                  onBlur={() => {
                    setIsDiscountFocused(false);
                    const parsed = parseFloat(discountInput) || 0;
                    const rounded = Math.round(parsed * 1000) / 1000;
                    setDiscountInput(rounded === 0 ? '' : rounded.toFixed(3));
                    setDiscount(rounded);
                  }}
                  onChange={(e) => {
                    const value = e.target.value.replace(',', '.');
                    if (value === '' || /^\d*\.?\d*$/.test(value)) {
                      setDiscountInput(value);
                      const parsed = parseFloat(value) || 0;
                      setDiscount(Math.round(parsed * 1000) / 1000);
                    }
                  }}
                  placeholder="0.000"
                  className="w-full bg-transparent px-1 text-[10px] font-black font-mono text-amber-950 focus:outline-none text-right"
                />
              </div>
              {/* Presets remise super compacts */}
              <div className="flex gap-1 mt-1 justify-end">
                <button 
                  type="button"
                  onClick={() => { setDiscount(0); setDiscountInput('0'); }}
                  className="text-[7px] font-bold bg-white hover:bg-amber-100 text-amber-850 px-1 py-0.5 rounded border border-amber-250 cursor-pointer"
                >
                  Clear
                </button>
                <button 
                  type="button"
                  onClick={() => { setDiscount(5); setDiscountInput('5.000'); }}
                  className="text-[7px] font-black bg-amber-600 text-white hover:bg-amber-700 px-1 py-0.5 rounded cursor-pointer"
                >
                  -5DT
                </button>
                <button 
                  type="button"
                  onClick={() => { setDiscount(10); setDiscountInput('10.000'); }}
                  className="text-[7px] font-black bg-amber-600 text-white hover:bg-amber-700 px-1 py-0.5 rounded cursor-pointer"
                >
                  -10DT
                </button>
              </div>
            </div>

            {canViewMargin && <div className="bg-emerald-50/50 border border-emerald-200/60 rounded-lg p-2 flex items-center justify-between shadow-3xs">
              <div className="min-w-0">
                <span className="text-[8px] font-black text-emerald-800 uppercase tracking-wider block">Bénéfice estimé</span>
                <span className="text-xs sm:text-sm font-black text-emerald-700 font-mono block leading-none mt-1 truncate">
                  {estimatedBenefit.toFixed(3)} <span className="text-[8px] font-bold text-emerald-650">{currency}</span>
                </span>
              </div>
              <div className="w-6 h-6 rounded bg-emerald-100 text-emerald-650 flex items-center justify-center shrink-0 ml-1">
                <TrendingUp className="w-3 h-3" />
              </div>
            </div>}
          </div>

          {/* Bottom Checkout Zone (Always Visible & Split for Wide Screens) */}
          <div className="bg-slate-900 border-t border-slate-950 p-3.5 space-y-3 rounded-b-2xl">
            <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
              
              {/* Left Column: Total Net & Real-time Change Calculator */}
              <div className="md:col-span-6 flex flex-col justify-between gap-2.5 bg-slate-850/45 p-3 rounded-xl border border-slate-800/60">
                {/* GIANT DOCK FOR NET TOTAL */}
                <div className="flex flex-col gap-1 text-center animate-in fade-in duration-200">
                  <div className="flex items-center justify-between text-indigo-300 font-black text-[9px] uppercase tracking-widest pb-1 border-b border-slate-800">
                    <span>Total Net à payer</span>
                    <span className="bg-indigo-500/10 text-indigo-300 px-1.5 py-0.5 rounded border border-indigo-500/20 text-[8px]">
                      {storeSettings?.tvaEnabled === true ? `TVA (${storeSettings.tva || 0}%)` : 'Hors taxe'}
                    </span>
                  </div>
                  <div className="flex justify-center items-center gap-1 mt-1.5">
                    <span className="text-3xl sm:text-4xl font-black font-mono tracking-tighter text-white leading-none drop-shadow-sm select-all">
                      {cartTotal.toFixed(3)}
                    </span>
                    <span className="text-sm font-black text-indigo-400 uppercase tracking-wider ml-1">
                      {currency}
                    </span>
                  </div>
                </div>

                {/* REAL-TIME CHANGE CALCULATOR */}
                {receivedCash > 0 && (
                  <div className={cn(
                    "p-2 rounded-lg border flex items-center justify-between text-xs font-bold leading-none shadow-sm transition-all duration-200 mt-1",
                    receivedCash > cartTotal
                      ? "bg-emerald-950/70 border-emerald-900 text-emerald-400"
                      : receivedCash < cartTotal
                        ? "bg-rose-950/70 border-rose-900 text-rose-300"
                        : "bg-indigo-950/70 border-indigo-900 text-indigo-300"
                  )}>
                    <div className="flex items-center gap-1 opacity-90">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                      <span className="uppercase text-[8px] font-black tracking-wider">
                        {receivedCash > cartTotal 
                          ? "A Rendre" 
                          : receivedCash < cartTotal 
                            ? "Reste (Dette)" 
                            : "Exact"}
                      </span>
                    </div>
                    <div className="font-mono text-xs font-black">
                      {receivedCash > cartTotal
                        ? `${(receivedCash - cartTotal).toFixed(3)}`
                        : receivedCash < cartTotal
                          ? `${(cartTotal - receivedCash).toFixed(3)}`
                          : `0.000`}
                    </div>
                  </div>
                )}
              </div>

              {/* Right Column: Cash Received Input & Big Validation Button */}
              <div className="md:col-span-6 flex flex-col justify-between gap-2">
                {/* HIGH CONTRAST RECEIVED AMOUNT INPUT */}
                <div className="bg-slate-800/80 border border-slate-750 rounded-xl p-2 flex flex-col gap-1 shadow-inner">
                  <div className="flex justify-between items-center text-[9px] font-black text-emerald-400 uppercase tracking-wider">
                    <span>Montant Reçu</span>
                    <button 
                      type="button"
                      onClick={() => {
                        setReceivedCash(cartTotal);
                        setReceivedCashInput(cartTotal.toFixed(3));
                      }}
                      className="px-1.5 py-0.5 bg-emerald-600 hover:bg-emerald-700 text-white text-[8px] font-black uppercase tracking-widest rounded transition-colors cursor-pointer"
                    >
                      Tout Payer
                    </button>
                  </div>
                  <div className="flex items-center justify-between border-b border-slate-700 pb-0.5">
                    <CreditCard className="w-4 h-4 text-emerald-500 mr-1.5 shrink-0" />
                    <input
                      type="text"
                      inputMode="decimal"
                      value={receivedCashInput}
                      onFocus={(e) => {
                        setIsReceivedCashFocused(true);
                        e.currentTarget.select();
                      }}
                      onBlur={() => {
                        setIsReceivedCashFocused(false);
                        const parsed = parseFloat(receivedCashInput) || 0;
                        const rounded = Math.round(parsed * 1000) / 1000;
                        setReceivedCashInput(rounded === 0 ? '' : rounded.toFixed(3));
                        setReceivedCash(rounded);
                      }}
                      onChange={(e) => {
                        const value = e.target.value.replace(',', '.');
                        if (value === '' || /^\d*\.?\d*$/.test(value)) {
                          setReceivedCashInput(value);
                          const parsed = parseFloat(value) || 0;
                          setReceivedCash(Math.round(parsed * 1000) / 1000);
                        }
                      }}
                      onKeyDown={(e) => {
                        // Entrée = Encaisser & Valider, même depuis le champ Espèces reçues
                        if (e.key === 'Enter' && cart.length > 0 && !isProcessing) {
                          e.preventDefault();
                          const parsed = parseFloat(receivedCashInput) || 0;
                          const rounded = Math.round(parsed * 1000) / 1000;
                          setReceivedCash(rounded);
                          e.currentTarget.blur();
                          validateSale(false);
                        }
                      }}
                      placeholder="0.000"
                      className="w-full bg-transparent text-right text-lg font-black font-mono text-emerald-400 focus:outline-none focus:ring-0 p-0 select-all"
                    />
                    <span className="text-xs font-black text-emerald-500 ml-1 shrink-0">{currency}</span>
                  </div>
                  {/* Presets de paiement rapide */}
                  <div className="flex gap-1 overflow-x-auto no-scrollbar justify-end">
                    {[5, 10, 20, 50].map((val) => (
                      <button 
                        key={val}
                        type="button"
                        onClick={() => {
                          setReceivedCash(prev => {
                            const updated = prev + val;
                            setReceivedCashInput(updated.toFixed(3));
                            return updated;
                          });
                        }}
                        className="text-[8px] font-black bg-slate-700 hover:bg-slate-650 text-slate-200 px-1.5 py-0.5 rounded cursor-pointer"
                      >
                        +{val} DT
                      </button>
                    ))}
                  </div>
                </div>

                {/* MAIN ACTIONS (Emerald + Credit buttons) */}
                <div className="flex gap-2">
                  <button
                    onClick={() => validateSale(false)}
                    disabled={cart.length === 0 || isProcessing}
                    className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs uppercase tracking-wider rounded-xl transition-all shadow-md shadow-emerald-950/30 active:scale-[0.98] disabled:opacity-40 disabled:scale-100 disabled:shadow-none flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    {isProcessing ? 'Traitement...' : (
                      <>
                        <CheckCircle className="w-4 h-4 shrink-0 animate-pulse" />
                        Encaisser & Valider
                      </>
                    )}
                  </button>
                  <button
                    onClick={() => {
                      if (cart.length === 0) return;
                      if (!selectedClient) {
                        setError('Veuillez sélectionner un client. Un crédit ne peut pas être enregistré pour un client de passage.');
                        return;
                      }
                      setError(null);
                      setCreditPartialInput('');
                      setCreditModalError(null);
                      setIsCreditModalOpen(true);
                    }}
                    disabled={cart.length === 0 || isProcessing}
                    title="Enregistrer la vente en crédit (client requis)"
                    className="px-3 py-2.5 bg-amber-600 hover:bg-amber-500 text-white font-black text-xs uppercase tracking-wider rounded-xl transition-all shadow-md shadow-amber-950/30 active:scale-[0.98] disabled:opacity-40 disabled:scale-100 disabled:shadow-none flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <CreditCard className="w-4 h-4 shrink-0" />
                    Crédité
                  </button>
                </div>
              </div>

            </div>

            {/* Warning de paiement pour client passager */}
            {!selectedClient && Math.abs(paidAmount - cartTotal) > 0.001 && (
              <div className="text-[9px] text-rose-300 font-semibold bg-rose-950/40 border border-rose-900/60 rounded-lg p-2 flex items-center gap-1.5">
                <AlertCircle className="w-3.5 h-3.5 shrink-0 text-rose-400" />
                <span>Le montant reçu doit correspondre exactement au montant total pour un client passager.</span>
              </div>
            )}

            {error && (
              <div className="p-2 bg-rose-950/40 border border-rose-900/60 rounded-lg flex items-center gap-1.5 text-rose-300 text-[10px] font-semibold">
                <AlertCircle className="w-3.5 h-3.5 shrink-0 text-rose-400" />
                <span className="leading-tight">{error}</span>
              </div>
            )}
          </div>

        </div>
      </div>

      {/* Credit Sale Modal */}
      {isCreditModalOpen && selectedClient && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40 backdrop-blur-md animate-in fade-in duration-200">
          <div className="bg-white p-6 rounded-3xl shadow-2xl max-w-sm w-full border border-gray-100 scale-in duration-200">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="text-lg font-black text-gray-900 flex items-center gap-2">
                  <CreditCard className="w-5 h-5 text-amber-600 shrink-0" />
                  Vente à crédit
                </h3>
                <p className="text-xs text-gray-500 font-semibold mt-0.5">
                  Client : <span className="text-gray-800">{selectedClient.name}</span>
                </p>
              </div>
              <button
                onClick={() => setIsCreditModalOpen(false)}
                className="p-1.5 rounded-full hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 mb-4 flex items-center justify-between">
              <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">Total de la vente</span>
              <span className="text-lg font-black text-gray-900">{cartTotal.toFixed(3)} {currency}</span>
            </div>

            {/* Option 1 : tout créditer */}
            <button
              onClick={() => {
                setIsCreditModalOpen(false);
                validateSale(true, 0);
              }}
              disabled={isProcessing}
              className="w-full py-2.5 mb-3 bg-amber-600 hover:bg-amber-500 text-white font-black text-xs uppercase tracking-wider rounded-xl transition-all shadow-md shadow-amber-200 active:scale-[0.98] disabled:opacity-40 flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <CreditCard className="w-4 h-4 shrink-0" />
              Créditer tout le montant
            </button>

            <div className="flex items-center gap-3 mb-3">
              <div className="flex-1 h-px bg-gray-200" />
              <span className="text-[10px] font-black text-gray-400 uppercase">ou</span>
              <div className="flex-1 h-px bg-gray-200" />
            </div>

            {/* Option 2 : tranche payée + reste en crédit */}
            <label className="block text-[10px] font-black text-gray-500 uppercase tracking-wider mb-1.5">
              Le client paie une tranche maintenant
            </label>
            <div className="relative mb-2">
              <Coins className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="number"
                inputMode="decimal"
                min="0"
                step="0.001"
                value={creditPartialInput}
                onChange={(e) => {
                  setCreditPartialInput(e.target.value);
                  setCreditModalError(null);
                }}
                placeholder="0.000"
                className="w-full pl-9 pr-14 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm font-bold text-gray-900 focus:outline-none focus:ring-2 focus:ring-amber-500/40 focus:border-amber-500"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-black text-gray-400">{currency}</span>
            </div>

            {(() => {
              const tranche = parseFloat(creditPartialInput) || 0;
              const reste = Math.max(0, Math.round((cartTotal - tranche) * 1000) / 1000);
              return tranche > 0 && tranche < cartTotal ? (
                <p className="text-[11px] font-bold text-gray-500 mb-3">
                  Reste en crédit : <span className="text-amber-600 font-black">{reste.toFixed(3)} {currency}</span>
                </p>
              ) : null;
            })()}

            {creditModalError && (
              <div className="p-2 mb-3 bg-rose-50 border border-rose-200 rounded-lg flex items-center gap-1.5 text-rose-600 text-[11px] font-semibold">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                <span className="leading-tight">{creditModalError}</span>
              </div>
            )}

            <button
              onClick={() => {
                const tranche = parseFloat(creditPartialInput) || 0;
                if (tranche <= 0) {
                  setCreditModalError('Saisissez le montant payé par le client, ou choisissez « Créditer tout le montant ».');
                  return;
                }
                if (tranche >= cartTotal) {
                  setCreditModalError(`La tranche doit être inférieure au total (${cartTotal.toFixed(3)} ${currency}). Pour un paiement complet, utilisez « Encaisser & Valider ».`);
                  return;
                }
                setIsCreditModalOpen(false);
                validateSale(true, tranche);
              }}
              disabled={isProcessing}
              className="w-full py-2.5 bg-slate-800 hover:bg-slate-700 text-white font-black text-xs uppercase tracking-wider rounded-xl transition-all active:scale-[0.98] disabled:opacity-40 flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <CheckCircle className="w-4 h-4 shrink-0" />
              Encaisser la tranche & créditer le reste
            </button>
          </div>
        </div>
      )}

      {/* Success Overlay */}
      {saleSuccess && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40 backdrop-blur-md animate-in fade-in duration-200">
          <div className="bg-white p-8 rounded-3xl shadow-2xl text-center max-w-sm w-full border border-gray-100 scale-in duration-200">
            <div className="w-20 h-20 bg-emerald-50 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-6">
              <CheckCircle className="w-12 h-12" />
            </div>
            <h3 className="text-2xl font-black text-gray-900 mb-2">Succès !</h3>
            <p className="text-gray-500 mb-8 font-semibold">{saleSuccess}</p>
            
            <div className="space-y-3">
              {lastInvoice && (
                <button 
                  onClick={handlePrint}
                  className="w-full py-3 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-sm"
                >
                  <Printer className="w-5 h-5" />
                  Imprimer Ticket
                </button>
              )}
              {lastInvoice && (
                <button 
                  onClick={() => downloadPDF(lastInvoice)}
                  className="w-full py-3 bg-gray-100 text-gray-700 font-bold rounded-xl hover:bg-gray-200 transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-3xs"
                >
                  <FileText className="w-5 h-5" />
                  Télécharger Facture PDF
                </button>
              )}
              <button 
                onClick={() => {
                  setSaleSuccess(null);
                  setLastInvoice(null);
                }}
                className="w-full py-3 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 transition-colors cursor-pointer shadow-sm"
              >
                Nouvelle Vente
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
