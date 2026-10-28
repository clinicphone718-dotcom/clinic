import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { collection, onSnapshot, addDoc, updateDoc, doc, query, orderBy, serverTimestamp, runTransaction, getDoc, getDocs, where, getDocFromServer } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { apiFetch } from '../lib/api';
import { computeTotals, normalizeFinancialSettings } from '../lib/financial';
import { Product, Client, SaleItem, Sale, Invoice, Category, StoreSettings, UserProfile } from '../types';
import { handleFirestoreError, OperationType } from '../App';
import { Search, ShoppingCart, Trash2, Plus, Minus, User, CreditCard, CheckCircle, AlertCircle, Printer, X, FileText, Barcode, Filter, Tag, Coins, Percent, TrendingUp, UserCheck, Flame } from 'lucide-react';
import { cn, decodeAzertyBarcode } from '../lib/utils';
import { format } from 'date-fns';
import { useNavigate } from 'react-router-dom';
import { PrintableTicket } from './PrintableTicket';
import { can } from '../lib/permissions';
import { addCashSessionTotals, requireOpenCashSession, useCashSession } from '../lib/cashSessions';

interface POSProps {
  userProfile: UserProfile | null;
}

export default function POS({ userProfile }: POSProps) {
  const navigate = useNavigate();
  const { session: cashSession, loading: cashSessionLoading } = useCashSession(userProfile);
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
        const data = snapshot.data() as StoreSettings;
        setStoreSettings({ ...data, ...normalizeFinancialSettings(data) });
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
    return Math.round((rawProfit - discount + Number.EPSILON) * 1000) / 1000;
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
    if (!cashSession) {
      setError(cashSessionLoading
        ? 'Vérification de la caisse en cours…'
        : 'Aucune caisse ouverte. Ouvrez une session avant de vendre.');
      return;
    }

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
      let committedSaleId: string | null = null;

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
          const activeCashSession = await requireOpenCashSession(
            transaction,
            userProfile?.uid || auth.currentUser?.uid || '',
            ownerId || '',
          );

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
          committedSaleId = saleRef.id;
          transaction.set(counterRef, { lastNum: nextNum }, { merge: true });
          addCashSessionTotals(transaction, activeCashSession, {
            sales: cartTotal,
            cash: effPaid,
          });

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
            sessionId: activeCashSession.id,
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
            sessionId: activeCashSession.id,
            ownerId,
            userId: userProfile?.uid || ownerId
          };

          transaction.set(saleRef, saleData);
          transaction.set(invoiceRef, invoiceData);
          
          generatedInvoice = invoiceData as any;
        });
      }

      if (committedSaleId) {
        try {
          await apiFetch(`/financial/sales/${encodeURIComponent(committedSaleId)}/costs`, { method: 'POST' });
        } catch (costError) {
          console.error('Sale purchase-cost snapshot failed after sale commit.');
          setError(`Vente enregistrée, mais le coût d'achat n'a pas pu être figé. ${costError instanceof Error ? costError.message : ''}`);
        }
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
    <div className="space-y-4 pb-4">
      <h1 className="font-display text-[34px] font-extrabold leading-tight tracking-tight text-slate-900 lg:text-[52px]">Vente</h1>
      <div className="relative grid min-h-0 grid-cols-1 gap-4 lg:h-[calc(100vh-210px)] lg:grid-cols-12">
      {!cashSession && (
        <div className="order-0 flex items-center justify-between gap-3 rounded-[18px] border border-[#F6C9BE] bg-[#FBDDD5] p-3 text-sm text-[#8A210A] lg:col-span-12">
          <span>{cashSessionLoading ? 'Vérification de la caisse…' : 'Aucune session ouverte : la vente est bloquée.'}</span>
          {!cashSessionLoading && <button type="button" onClick={() => navigate('/cash-session')} className="min-h-11 shrink-0 rounded-full bg-[#0A0A0A] px-4 text-xs font-black text-white">Ouvrir la caisse</button>}
        </div>
      )}
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
          "absolute left-1/2 top-4 z-[90] flex max-w-[calc(100%-1rem)] -translate-x-1/2 items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-black shadow-md backdrop-blur-md transition-all",
          scanNotification.type === 'success' 
            ? "border-[#E2E2DF] bg-white/95 text-[#0A0A0A]"
            : "border-[#F6C9BE] bg-[#FBDDD5]/95 text-[#8A210A]"
        )}>
          <div className={cn(
            "w-1.5 h-1.5 rounded-full animate-ping shrink-0",
            scanNotification.type === 'success' ? "bg-[#5C5C5C]" : "bg-[#B3261E]"
          )} />
          <span>{scanNotification.message}</span>
        </div>
      )}

      {/* Left: Product Selection (Compact Sidebar) */}
      <div className="order-2 lg:order-1 lg:col-span-4 flex flex-col gap-2.5 min-h-0 h-full">
        {/* Top Controls Box (Highly Compact) */}
        <div className="space-y-2 rounded-[20px] border border-slate-800 bg-white p-3">
          {/* Barcode automatic scan status and manual input */}
          <div className="relative flex flex-col gap-1.5 rounded-xl border border-slate-100 bg-slate-50 p-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <div className="relative flex items-center justify-center">
                  <Barcode className={cn("h-4 w-4 text-emerald-600", scannerActive && "animate-pulse")} />
                  {scannerActive && <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-emerald-500" />}
                </div>
                <div className="flex flex-col leading-tight">
                  <span className="text-[9px] font-black uppercase tracking-wider text-slate-800">Lecteur Code à Barre</span>
                </div>
              </div>
              <button
                onClick={() => setScannerActive(!scannerActive)}
                className={cn(
                  "min-h-11 rounded-full border px-3 text-[8px] font-black uppercase tracking-wider transition-all cursor-pointer",
                  scannerActive
                    ? "bg-emerald-600 text-white border-emerald-600"
                    : "bg-white text-slate-500 border-slate-200"
                )}
              >
                {scannerActive ? "Actif" : "Inactif"}
              </button>
            </div>

            {scannerActive && (
              <div className="mt-0.5 flex flex-col gap-1 rounded-lg border border-emerald-100 bg-emerald-50/70 p-1.5">
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-2 flex items-center pointer-events-none">
                    <Barcode className="h-3.5 w-3.5 text-emerald-600" />
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
                    className="block w-full rounded-lg border border-emerald-200 bg-white py-2 pl-7 pr-2 font-mono text-[10px] font-bold tracking-wider text-emerald-700 placeholder:text-emerald-600/70 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/10"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Search bar */}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Rechercher nom ou code barre..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pl-8 pr-3 text-xs font-semibold text-slate-800 outline-none transition-all focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/10"
            />
          </div>

          {/* Categories select row (Compact) */}
          <div className="flex items-center gap-1 overflow-x-auto pb-0.5 no-scrollbar">
            <button
              onClick={() => setSelectedCategory('all')}
              className={cn(
                "min-h-11 whitespace-nowrap rounded-full border px-4 text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer",
                selectedCategory === 'all' 
                  ? "bg-indigo-600 text-white border-indigo-600 shadow-md shadow-indigo-600/20"
                  : "bg-white text-slate-600 border-slate-200 hover:border-indigo-300 hover:text-indigo-700"
              )}
            >
              Tous
            </button>
            {categories.map(cat => (
              <button
                key={cat.id}
                onClick={() => setSelectedCategory(cat.name)}
                className={cn(
                  "min-h-11 whitespace-nowrap rounded-full border px-4 text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer",
                  selectedCategory === cat.name
                    ? "bg-indigo-600 text-white border-indigo-600 shadow-md shadow-indigo-600/20"
                    : "bg-white text-slate-600 border-slate-200 hover:border-indigo-300 hover:text-indigo-700"
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
                "group relative flex h-[110px] w-full min-w-0 cursor-pointer flex-col justify-between overflow-hidden rounded-[18px] border border-slate-100 bg-white text-left shadow-sm transition-colors",
                "hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 active:scale-[0.99]",
                product.inventoryType !== 'service' && product.stock <= 0 && "opacity-60 grayscale cursor-not-allowed"
              )}
            >
              <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-fuchsia-500 to-indigo-500 opacity-80 transition-opacity group-hover:opacity-100"></div>

              <div className="w-full flex justify-between items-center gap-1 px-2 pt-2">
                <span className="flex max-w-[60%] items-center gap-1 truncate text-[7px] font-black uppercase tracking-wider text-slate-400">
                  <span className={cn(
                    "h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-500"
                  )}></span>
                  {product.category}
                </span>
                {topSellerIds.has(product.id) ? (
                  <span className="flex shrink-0 items-center gap-0.5 rounded-full bg-gradient-to-r from-amber-400 to-orange-500 px-1.5 py-0.5 text-[7px] font-black uppercase tracking-wider text-white">
                    <Flame className="w-2.5 h-2.5" /> Top
                  </span>
                ) : (salesQtyMap[product.id] || 0) > 0 ? (
                  <span className="shrink-0 text-[7px] font-black uppercase tracking-wider text-slate-400">
                    {salesQtyMap[product.id]} vendus
                  </span>
                ) : null}
              </div>

              <div className="flex-1 flex items-center px-2 py-0.5 min-w-0 w-full">
                <h3 className="w-full overflow-hidden break-words text-ellipsis text-[11px] font-bold leading-tight text-slate-800 line-clamp-2">
                  {product.name}
                </h3>
              </div>

              <div className="w-full px-2 pb-2 flex items-center justify-between gap-1 mt-auto">
                <div className="min-w-0">
                  <span className="block truncate font-mono text-[12px] font-bold leading-none text-indigo-700 tabular-nums">
                    {product.sellPrice.toFixed(3)} <span className="text-[8px] font-bold">{currency}</span>
                  </span>
                  {product.inventoryType === 'service' ? <span className="text-[7px] font-black uppercase tracking-wider text-[#5C5C5C]">Service</span> : <span className={cn(
                    "text-[7px] font-black uppercase tracking-wider",
                    product.stock <= 5 ? "text-rose-600" : "text-slate-500"
                  )}>
                    Stock {product.stock}
                  </span>}
                </div>
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-indigo-600 transition-colors group-hover:bg-indigo-600 group-hover:text-white">
                  <Plus className="w-3.5 h-3.5" />
                </div>
              </div>

              {product.inventoryType !== 'service' && product.stock <= 0 && (
                <div className="absolute inset-0 bg-white/70 backdrop-blur-[1px] rounded-xl flex items-center justify-center p-1 text-center">
                  <div className="rounded-full bg-[#B3261E] px-2 py-1 text-[8px] font-black uppercase tracking-wider text-white">
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
        <div className="flex h-full flex-1 flex-col overflow-hidden rounded-[24px] border border-[#E2E2DF] bg-white">
          
          {/* Header Ticket block */}
          <div className="flex items-center justify-between border-b border-[#E2E2DF] bg-[#F4F4F2] p-3">
            <h2 className="flex items-center gap-1.5 text-xs font-black uppercase tracking-wider text-[#0A0A0A]">
              <ShoppingCart className="h-4 w-4 text-[#0A0A0A]" />
              Ticket de caisse ({cart.length})
            </h2>
            <button 
              onClick={() => {
                setCart([]);
                setDiscount(0);
                setDiscountInput('0');
              }}
              disabled={cart.length === 0}
              className="min-h-11 cursor-pointer rounded-full px-3 text-[10px] font-black uppercase tracking-widest text-[#8A210A] transition-colors hover:bg-[#FBDDD5] disabled:opacity-30"
            >
              Vider le Panier
            </button>
          </div>

          {/* Client Selection */}
          <div className="flex items-center gap-2 border-b border-[#E2E2DF] bg-[#F4F4F2] p-3">
            <div className="w-full relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <UserCheck className="h-4.5 w-4.5 text-[#5C5C5C]" />
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
                className="w-full rounded-xl border border-[#E2E2DF] bg-white py-2 pl-9 pr-3 text-xs font-bold text-[#0A0A0A] outline-none transition-all focus:border-[#0A0A0A] focus:ring-2 focus:ring-[#0A0A0A]/10"
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
              <div className="flex h-full flex-col items-center justify-center gap-2 py-16 text-[#5C5C5C]">
                <ShoppingCart className="h-12 w-12 opacity-30" />
                <p className="text-[10px] font-black uppercase tracking-wider">Aucun produit au panier</p>
              </div>
            ) : (
              <div className="w-full overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs min-w-[420px] sm:min-w-0">
                  <thead>
                    <tr className="border-b border-[#E2E2DF] bg-[#F4F4F2] text-[10px] font-black uppercase tracking-wider text-[#5C5C5C]">
                      <th className="py-2.5 px-3 text-left">Produit</th>
                      <th className="py-2.5 px-2 text-center w-24">Qté</th>
                      <th className="py-2.5 px-2 text-right w-20">Prix</th>
                      <th className="py-2.5 px-2 text-right w-24">Total</th>
                      <th className="py-2.5 px-3 text-center w-8"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E2E2DF]">
                    {cart.map((item) => (
                      <tr
                        key={item.productId}
                        onClick={() => setSelectedCartItemId(item.productId)}
                        className={cn(
                          "transition-colors group cursor-pointer",
                          selectedCartItemId === item.productId
                            ? "bg-[#F4F4F2] shadow-[inset_2px_0_0_0_#0A0A0A]"
                            : "hover:bg-[#F4F4F2]"
                        )}
                      >
                        <td className="py-3 px-3 text-left">
                          <p className="break-words text-xs font-bold leading-snug text-[#0A0A0A] line-clamp-2 sm:text-[13px]" title={item.name}>
                            {item.name}
                          </p>
                          {canViewMargin && (products.find(product => product.id === item.productId)?.buyPrice || 0) > item.price && (
                            <span className="mt-1 inline-flex rounded-full bg-[#FBDDD5] px-2 py-0.5 text-[9px] font-black uppercase text-[#8A210A]">Vendu à perte</span>
                          )}
                        </td>
                        <td className="py-3 px-2 text-center">
                          <div className="inline-flex items-center gap-1.5 rounded-lg border border-[#E2E2DF] bg-[#F4F4F2] p-0.5">
                            <button 
                              onClick={() => updateQuantity(item.productId, -1)}
                              disabled={item.quantity <= 1}
                              className="flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-full bg-white font-bold text-[#0A0A0A] transition-colors hover:bg-[#E2E2DF] disabled:cursor-not-allowed disabled:opacity-30"
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
                                className="w-12 rounded-md border border-[#0A0A0A] bg-white px-1 py-0.5 text-center font-mono text-xs font-black text-[#0A0A0A] focus:outline-none focus:ring-2 focus:ring-[#0A0A0A]/20"
                              />
                            ) : (
                              <span
                                onClick={() => {
                                  setEditingQtyId(item.productId);
                                  setEditingQtyValue(String(item.quantity));
                                }}
                                className="min-w-11 cursor-pointer select-none rounded px-1 py-2 text-center font-mono text-xs font-black text-[#0A0A0A] transition-colors hover:bg-white sm:text-sm"
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
                              className="flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-full bg-white font-bold text-[#0A0A0A] transition-colors hover:bg-[#E2E2DF] disabled:cursor-not-allowed disabled:opacity-30"
                              title="Augmenter la quantité"
                            >
                              <Plus className="w-3 h-3" />
                            </button>
                          </div>
                        </td>
                        <td className="py-3 px-2 text-right font-semibold text-slate-550 font-mono text-xs sm:text-[13px]">
                          {item.price.toFixed(3)} <span className="text-[9px] font-medium text-slate-400">{currency}</span>
                        </td>
                        <td className="py-3 px-2 text-right font-display text-xs font-bold text-[#0A0A0A] tabular-nums sm:text-sm">
                          {item.total.toFixed(3)} <span className="text-[10px] font-bold text-[#5C5C5C]">{currency}</span>
                        </td>
                        <td className="py-3 px-3 text-center">
                          <button
                            onClick={() => removeFromCart(item.productId)}
                            className="flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-full border border-transparent text-[#8A210A] transition-colors hover:border-[#F6C9BE] hover:bg-[#FBDDD5]"
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
          <div className="grid grid-cols-2 gap-2 border-t border-[#E2E2DF] bg-[#F4F4F2] p-2 sm:grid-cols-4">
            {/* Card 1: Nombre d'articles */}
            <div className="flex items-center justify-between rounded-xl border border-[#E2E2DF] bg-white p-2">
              <div className="min-w-0">
                <span className="block text-[8px] font-black uppercase tracking-wider text-[#5C5C5C]">Articles</span>
                <span className="mt-1 block font-display text-sm font-bold leading-none text-[#0A0A0A] tabular-nums">
                  {cart.reduce((sum, item) => sum + item.quantity, 0)} <span className="text-[9px] font-bold uppercase text-[#5C5C5C]">pces</span>
                </span>
              </div>
              <div className="ml-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#F4F4F2] text-[#0A0A0A]">
                <ShoppingCart className="h-3 w-3" />
              </div>
            </div>

            {/* Card 2: Montant Brut */}
            <div className="flex items-center justify-between rounded-xl border border-[#E2E2DF] bg-white p-2">
              <div className="min-w-0">
                <span className="block text-[8px] font-black uppercase tracking-wider text-[#5C5C5C]">Total Brut</span>
                <span className="mt-1 block truncate font-display text-xs font-bold leading-none text-[#0A0A0A] tabular-nums sm:text-sm">
                  {(subtotal + tvaAmount).toFixed(3)} <span className="text-[8px] font-bold text-[#5C5C5C]">{currency}</span>
                </span>
              </div>
              <div className="ml-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#F4F4F2] text-[#5C5C5C]">
                <Coins className="h-3 w-3" />
              </div>
            </div>

            {/* Card 3: Remise Appliquée avec champ d'écriture directe (Sleek) */}
            <div className="flex flex-col justify-between rounded-xl border border-amber-200 bg-amber-50 p-2">
              <div className="flex items-center justify-between">
                <span className="text-[8px] font-black uppercase tracking-wider text-amber-800">Remise (DT)</span>
                <Percent className="h-3 w-3 shrink-0 text-amber-600" />
              </div>
              <div className="mt-0.5 flex items-center gap-1 rounded-md border border-amber-200 bg-white p-0.5">
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
                  className="w-full bg-transparent px-1 text-right font-mono text-[10px] font-black text-amber-900 focus:outline-none"
                />
              </div>
              {/* Presets remise super compacts */}
              <div className="mt-1 flex flex-wrap justify-end gap-1">
                <button 
                  type="button"
                  onClick={() => { setDiscount(0); setDiscountInput('0'); }}
                  className="min-h-11 rounded-full border border-amber-300 bg-white px-3 text-[7px] font-bold text-amber-900 cursor-pointer hover:bg-amber-100"
                >
                  Clear
                </button>
                <button 
                  type="button"
                  onClick={() => { setDiscount(5); setDiscountInput('5.000'); }}
                  className="min-h-11 rounded-full bg-amber-600 px-3 text-[7px] font-black text-white cursor-pointer hover:bg-amber-700"
                >
                  -5DT
                </button>
                <button 
                  type="button"
                  onClick={() => { setDiscount(10); setDiscountInput('10.000'); }}
                  className="min-h-11 rounded-full bg-amber-600 px-3 text-[7px] font-black text-white cursor-pointer hover:bg-amber-700"
                >
                  -10DT
                </button>
              </div>
            </div>

            {canViewMargin && <div className="flex items-center justify-between rounded-xl border border-emerald-100 bg-emerald-50 p-2">
              <div className="min-w-0">
                <span className="block text-[8px] font-black uppercase tracking-wider text-[#5C5C5C]">Bénéfice estimé</span>
                <span className={cn(
                  "text-xs sm:text-sm font-black font-mono block leading-none mt-1 truncate",
                  estimatedBenefit < 0 ? "text-rose-700" : "text-emerald-800",
                )}>
                  {estimatedBenefit.toFixed(3)} <span className={cn(
                    "text-[8px] font-bold",
                    estimatedBenefit < 0 ? "text-rose-700" : "text-emerald-800",
                  )}>{currency}</span>
                </span>
              </div>
              <div className="ml-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                <TrendingUp className="h-3 w-3" />
              </div>
            </div>}
          </div>

          {/* Bottom Checkout Zone (Always Visible & Split for Wide Screens) */}
          <div className="space-y-3 rounded-b-[24px] border-t border-slate-800 bg-slate-900 p-3.5">
            <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
              
              {/* Left Column: Total Net & Real-time Change Calculator */}
              <div className="md:col-span-6 flex flex-col justify-between gap-2.5 rounded-xl border border-slate-800 bg-slate-900 p-3">
                {/* GIANT DOCK FOR NET TOTAL */}
                <div className="flex flex-col gap-1 text-center animate-in fade-in duration-200">
                  <div className="flex items-center justify-between border-b border-slate-700 pb-1 text-[9px] font-black uppercase tracking-widest text-indigo-200">
                    <span>Total Net à payer</span>
                    <span className="rounded-full border border-indigo-400/20 bg-indigo-500/15 px-2 py-1 text-[8px] text-indigo-200">
                      {storeSettings?.tvaEnabled === true ? `TVA (${storeSettings.tva || 0}%)` : 'Hors taxe'}
                    </span>
                  </div>
                  <div className="flex justify-center items-center gap-1 mt-1.5">
                    <span className="select-all font-mono text-3xl font-bold leading-none tracking-tighter text-white tabular-nums sm:text-4xl">
                      {cartTotal.toFixed(3)}
                    </span>
                    <span className="ml-1 text-sm font-black uppercase tracking-wider text-indigo-300">
                      {currency}
                    </span>
                  </div>
                </div>

                {/* REAL-TIME CHANGE CALCULATOR */}
                {receivedCash > 0 && (
                  <div className={cn(
                    "mt-1 flex items-center justify-between rounded-lg border p-2 text-xs font-bold leading-none transition-all",
                    receivedCash > cartTotal
                      ? "bg-emerald-900/40 border-emerald-700/50 text-emerald-100"
                      : receivedCash < cartTotal
                        ? "bg-[#FBDDD5] border-[#F6C9BE] text-[#8A210A]"
                        : "bg-emerald-900/40 border-emerald-700/50 text-emerald-100"
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
                <div className="flex flex-col gap-1 rounded-xl border border-slate-800 bg-slate-800/80 p-2">
                  <div className="flex items-center justify-between text-[9px] font-black uppercase tracking-wider text-emerald-300">
                    <span>Montant Reçu</span>
                    <button 
                      type="button"
                      onClick={() => {
                        setReceivedCash(cartTotal);
                        setReceivedCashInput(cartTotal.toFixed(3));
                      }}
                      className="min-h-11 rounded-full border border-emerald-600 bg-emerald-600 px-3 text-[8px] font-black uppercase tracking-widest text-white transition-colors cursor-pointer hover:bg-emerald-700"
                    >
                      Tout Payer
                    </button>
                  </div>
                  <div className="flex items-center justify-between border-b border-slate-700 pb-1">
                    <CreditCard className="mr-1.5 h-4 w-4 shrink-0 text-emerald-400" />
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
                      className="w-full select-all bg-transparent p-0 text-right font-mono text-lg font-bold tabular-nums text-emerald-300 focus:outline-none focus:ring-0"
                    />
                    <span className="ml-1 shrink-0 text-xs font-black text-emerald-300">{currency}</span>
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
                        className="min-h-11 shrink-0 rounded-full border border-slate-700 bg-slate-700 px-3 text-[8px] font-black text-slate-100 cursor-pointer hover:bg-slate-600"
                      >
                        +{val} DT
                      </button>
                    ))}
                  </div>
                </div>

                {/* MAIN ACTIONS */}
                <div className="flex gap-2">
                  <button
                    onClick={() => validateSale(false)}
                    disabled={cart.length === 0 || isProcessing}
                    className="flex min-h-11 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-full bg-emerald-600 px-4 text-xs font-black uppercase tracking-wider text-white shadow-lg shadow-emerald-600/20 transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
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
                    className="min-h-11 cursor-pointer rounded-full bg-amber-500 px-4 text-xs font-black uppercase tracking-wider text-white shadow-lg shadow-amber-500/20 transition-colors hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <CreditCard className="w-4 h-4 shrink-0" />
                    Crédité
                  </button>
                </div>
              </div>

            </div>

            {/* Warning de paiement pour client passager */}
            {!selectedClient && Math.abs(paidAmount - cartTotal) > 0.001 && (
              <div className="flex items-center gap-1.5 rounded-lg border border-[#F6C9BE] bg-[#FBDDD5] p-2 text-[9px] font-semibold text-[#8A210A]">
                <AlertCircle className="h-3.5 w-3.5 shrink-0 text-[#B3261E]" />
                <span>Le montant reçu doit correspondre exactement au montant total pour un client passager.</span>
              </div>
            )}

            {error && (
              <div className="flex items-center gap-1.5 rounded-lg border border-[#F6C9BE] bg-[#FBDDD5] p-2 text-[10px] font-semibold text-[#8A210A]">
                <AlertCircle className="h-3.5 w-3.5 shrink-0 text-[#B3261E]" />
                <span className="leading-tight">{error}</span>
                {!cashSession && !cashSessionLoading && <button type="button" onClick={() => navigate('/cash-session')} className="ml-auto min-h-11 rounded-full bg-[#0A0A0A] px-3 text-white">Ouvrir</button>}
              </div>
            )}
          </div>

        </div>
      </div>

      {/* Credit Sale Modal */}
      {isCreditModalOpen && selectedClient && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40 backdrop-blur-md animate-in fade-in duration-200">
          <div className="w-full max-w-sm rounded-[24px] border border-[#E2E2DF] bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="flex items-center gap-2 font-display text-lg font-bold text-[#0A0A0A]">
                  <CreditCard className="h-5 w-5 shrink-0 text-[#5C5C5C]" />
                  Vente à crédit
                </h3>
                <p className="mt-0.5 text-xs font-semibold text-[#5C5C5C]">
                  Client : <span className="text-[#0A0A0A]">{selectedClient.name}</span>
                </p>
              </div>
              <button
                onClick={() => setIsCreditModalOpen(false)}
                className="min-h-11 min-w-11 cursor-pointer rounded-full text-[#5C5C5C] transition-colors hover:bg-[#F4F4F2]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="mb-4 flex items-center justify-between rounded-xl border border-[#E2E2DF] bg-[#F4F4F2] p-3">
              <span className="text-xs font-bold uppercase tracking-wider text-[#5C5C5C]">Total de la vente</span>
              <span className="font-display text-lg font-bold tabular-nums text-[#0A0A0A]">{cartTotal.toFixed(3)} {currency}</span>
            </div>

            {/* Option 1 : tout créditer */}
            <button
              onClick={() => {
                setIsCreditModalOpen(false);
                validateSale(true, 0);
              }}
              disabled={isProcessing}
              className="mb-3 flex min-h-11 w-full cursor-pointer items-center justify-center gap-1.5 rounded-full bg-[#0A0A0A] py-2.5 text-xs font-black uppercase tracking-wider text-white transition-colors hover:bg-[#2A2A2A] disabled:opacity-40"
            >
              <CreditCard className="w-4 h-4 shrink-0" />
              Créditer tout le montant
            </button>

            <div className="flex items-center gap-3 mb-3">
              <div className="h-px flex-1 bg-[#E2E2DF]" />
              <span className="text-[10px] font-black uppercase text-[#5C5C5C]">ou</span>
              <div className="h-px flex-1 bg-[#E2E2DF]" />
            </div>

            {/* Option 2 : tranche payée + reste en crédit */}
            <label className="mb-1.5 block text-[10px] font-black uppercase tracking-wider text-[#5C5C5C]">
              Le client paie une tranche maintenant
            </label>
            <div className="relative mb-2">
              <Coins className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#5C5C5C]" />
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
                className="w-full rounded-xl border border-[#E2E2DF] bg-[#F4F4F2] py-2.5 pl-9 pr-14 text-sm font-bold text-[#0A0A0A] focus:border-[#0A0A0A] focus:outline-none focus:ring-2 focus:ring-[#0A0A0A]/10"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-black text-[#5C5C5C]">{currency}</span>
            </div>

            {(() => {
              const tranche = parseFloat(creditPartialInput) || 0;
              const reste = Math.max(0, Math.round((cartTotal - tranche) * 1000) / 1000);
              return tranche > 0 && tranche < cartTotal ? (
                <p className="mb-3 text-[11px] font-bold text-[#5C5C5C]">
                  Reste en crédit : <span className="font-black text-[#8A210A]">{reste.toFixed(3)} {currency}</span>
                </p>
              ) : null;
            })()}

            {creditModalError && (
              <div className="mb-3 flex items-center gap-1.5 rounded-lg border border-[#F6C9BE] bg-[#FBDDD5] p-2 text-[11px] font-semibold text-[#8A210A]">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" />
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
              className="flex min-h-11 w-full cursor-pointer items-center justify-center gap-1.5 rounded-full border border-[#E2E2DF] bg-white py-2.5 text-xs font-black uppercase tracking-wider text-[#0A0A0A] transition-colors hover:bg-[#F4F4F2] disabled:opacity-40"
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
          <div className="w-full max-w-sm rounded-[24px] border border-[#E2E2DF] bg-white p-8 text-center shadow-2xl">
            <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-[#F4F4F2] text-[#0A0A0A]">
              <CheckCircle className="h-12 w-12" />
            </div>
            <h3 className="mb-2 font-display text-2xl font-bold text-[#0A0A0A]">Succès !</h3>
            <p className="mb-8 font-semibold text-[#5C5C5C]">{saleSuccess}</p>
            
            <div className="space-y-3">
              {lastInvoice && (
                <button 
                  onClick={handlePrint}
                  className="flex min-h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-full bg-[#0A0A0A] py-3 font-bold text-white transition-colors hover:bg-[#2A2A2A]"
                >
                  <Printer className="w-5 h-5" />
                  Imprimer Ticket
                </button>
              )}
              {lastInvoice && (
                <button 
                  onClick={() => downloadPDF(lastInvoice)}
                  className="flex min-h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-full border border-[#E2E2DF] bg-white py-3 font-bold text-[#0A0A0A] transition-colors hover:bg-[#F4F4F2]"
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
                className="min-h-11 w-full cursor-pointer rounded-full bg-[#0A0A0A] py-3 font-bold text-white transition-colors hover:bg-[#2A2A2A]"
              >
                Nouvelle Vente
              </button>
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
