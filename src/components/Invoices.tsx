import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { collection, onSnapshot, query, orderBy, limit, doc, runTransaction, serverTimestamp, where, Timestamp, setDoc } from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';
import { db, auth } from '../firebase';
import { apiFetch } from '../lib/api';
import { computeTotals, normalizeFinancialSettings } from '../lib/financial';
import { Invoice, Product, Client, SaleItem, StoreSettings, UserProfile } from '../types';
import { handleFirestoreError, OperationType } from '../App';
import { Search, FileText, Eye, X, Printer, Download, User, Calendar, ShoppingBag, Plus, Trash2, Minus, AlertCircle, CheckCircle2, Paperclip, Wallet, Ban } from 'lucide-react';
import { format } from 'date-fns';
import { APP_NAME } from '../config/brand';
import { fr } from 'date-fns/locale';
import { cn } from '../lib/utils';
import { PrintableTicket } from './PrintableTicket';
import { addCashSessionTotals, requireOpenCashSession, useCashSession } from '../lib/cashSessions';
import { calculatePurchaseTotals, getPurchaseCancellationStock, getPurchasePaymentBalance } from '../lib/purchaseAccounting';

interface InvoicesProps {
  userProfile: UserProfile | null;
}

interface PurchaseInvoiceRecord {
  id: string;
  number?: string;
  invoiceNumber?: string;
  date?: any;
  supplierName?: string;
  supplierId?: string;
  total?: number;
  totalMilli?: number;
  paidMilli?: number;
  debtMilli?: number;
  status?: 'received' | 'cancelled';
  note?: string;
  attachment?: PurchaseAttachment;
  items?: PurchaseLine[];
  sessionId?: string;
  cancelledAt?: any;
  cancelledBy?: string;
  cancellationReason?: string;
}

interface PurchaseAttachment {
  url?: string;
  dataUrl?: string;
  fileName: string;
}

interface PurchaseLine {
  itemId: string;
  itemCollection: 'products' | 'parts';
  nameSnapshot: string;
  quantity: number;
  unitCostMilli: number;
}

interface SupplierRecord {
  id: string;
  name: string;
  phone?: string;
  ownerId: string;
}

interface SupplierPaymentRecord {
  id: string;
  amountMilli: number;
  type: string;
  purchaseNumber?: string;
  createdAt?: any;
  createdBy?: string;
}

interface PurchaseCatalogItem {
  id: string;
  name: string;
  collection: 'products' | 'parts';
  stock: number;
  inventoryType?: string;
}

async function compressPurchaseImage(file: File): Promise<PurchaseAttachment> {
  if (!file.type.startsWith('image/')) throw new Error('Choisissez un fichier image valide.');
  const image = await createImageBitmap(file);
  let scale = Math.min(1, 1600 / Math.max(image.width, image.height));
  let quality = 0.78;
  let blob: Blob | null = null;
  const canvas = document.createElement('canvas');

  for (let attempt = 0; attempt < 8; attempt += 1) {
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Impossible de compresser cette image sur cet appareil.');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (blob && blob.size < 350 * 1024) break;
    quality = Math.max(0.35, quality - 0.08);
    scale *= 0.82;
  }
  image.close();
  if (!blob || blob.size >= 350 * 1024) throw new Error('Image trop volumineuse après compression (limite 500 Ko dans Firestore).');
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Lecture de l’image impossible.'));
    reader.onerror = () => reject(new Error('Lecture de l’image impossible.'));
    reader.readAsDataURL(blob);
  });
  if (dataUrl.length >= 500 * 1024) throw new Error('Image trop volumineuse pour être enregistrée dans Firestore.');
  return { dataUrl, fileName: file.name };
}

function toInvoiceDate(value: unknown): Date | null {
  if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') {
    return value.toDate();
  }
  const parsed = value instanceof Date ? value : value ? new Date(String(value)) : null;
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
}

export default function Invoices({ userProfile }: InvoicesProps) {
  const navigate = useNavigate();
  const { session: cashSession, loading: cashSessionLoading } = useCashSession(userProfile);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [purchaseInvoices, setPurchaseInvoices] = useState<PurchaseInvoiceRecord[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierRecord[]>([]);
  const [purchaseCatalog, setPurchaseCatalog] = useState<PurchaseCatalogItem[]>([]);
  const [storeSettings, setStoreSettings] = useState<StoreSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeTab, setActiveTab] = useState<'sales' | 'purchases'>('sales');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [isNewInvoiceModalOpen, setIsNewInvoiceModalOpen] = useState(false);
  const [productSearch, setProductSearch] = useState('');
  const [isPurchaseModalOpen, setIsPurchaseModalOpen] = useState(false);
  const [purchaseNumber, setPurchaseNumber] = useState(`ACH-${new Date().getFullYear()}-${Date.now().toString().slice(-6)}`);
  const [purchaseDate, setPurchaseDate] = useState(new Date().toISOString().slice(0, 10));
  const [purchaseSupplierId, setPurchaseSupplierId] = useState('');
  const [quickSupplierName, setQuickSupplierName] = useState('');
  const [purchaseItemId, setPurchaseItemId] = useState('');
  const [purchaseItemQuantity, setPurchaseItemQuantity] = useState('1');
  const [purchaseItemCost, setPurchaseItemCost] = useState('');
  const [purchaseLines, setPurchaseLines] = useState<PurchaseLine[]>([]);
  const [purchasePaidAmount, setPurchasePaidAmount] = useState('0');
  const [purchaseNote, setPurchaseNote] = useState('');
  const [purchaseAttachment, setPurchaseAttachment] = useState<PurchaseAttachment | null>(null);
  const [purchaseAttachmentUrl, setPurchaseAttachmentUrl] = useState('');
  const [purchaseError, setPurchaseError] = useState('');
  const [purchaseSuccess, setPurchaseSuccess] = useState('');
  const [purchaseSaving, setPurchaseSaving] = useState(false);
  const [purchaseFileLoading, setPurchaseFileLoading] = useState(false);
  const [selectedPurchase, setSelectedPurchase] = useState<PurchaseInvoiceRecord | null>(null);
  const [supplierPayments, setSupplierPayments] = useState<SupplierPaymentRecord[]>([]);
  const [supplierPaymentAmount, setSupplierPaymentAmount] = useState('');
  const [paymentSaving, setPaymentSaving] = useState(false);
  const [showPurchaseCancelConfirm, setShowPurchaseCancelConfirm] = useState(false);

  const ownerId = (userProfile?.role === 'admin' ? userProfile?.uid : userProfile?.ownerId) || userProfile?.uid || auth.currentUser?.uid;
  const isStoreAdmin = userProfile?.role === 'admin' && (userProfile.ownerId || userProfile.uid) === userProfile.uid;
  
  const handlePrint = () => {
    if (!selectedInvoice) {
      console.warn('Aucune facture sélectionnée pour l\'impression.');
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
  
  // New Invoice Form State
  const [clients, setClients] = useState<Client[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [cart, setCart] = useState<SaleItem[]>([]);
  const [paidAmount, setPaidAmount] = useState<number>(0);
  const [paidAmountInput, setPaidAmountInput] = useState('0');
  const [isPaidFocused, setIsPaidFocused] = useState(false);

  useEffect(() => {
    if (!isPaidFocused) {
      setPaidAmountInput(paidAmount === 0 ? '' : paidAmount.toFixed(3));
    }
  }, [paidAmount, isPaidFocused]);

  const [isProcessing, setIsProcessing] = useState(false);
  const [saleSuccess, setSaleSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!auth.currentUser || !ownerId) return;
    const q = query(collection(db, 'invoices'), where('ownerId', '==', ownerId));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const invs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Invoice));
      invs.sort((a, b) => {
        const timeA = a.date?.seconds || 0;
        const timeB = b.date?.seconds || 0;
        return timeB - timeA;
      });
      setInvoices(invs);
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'invoices');
    });

    const unsubscribeSettings = onSnapshot(doc(db, 'settings', ownerId), (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data() as StoreSettings;
        setStoreSettings({ ...data, ...normalizeFinancialSettings(data) });
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, `settings/${ownerId}`);
    });
    const unsubscribePurchases = isStoreAdmin
      ? onSnapshot(query(collection(db, 'purchases'), where('ownerId', '==', ownerId)), snapshot => {
        const purchases = snapshot.docs.map(item => ({ id: item.id, ...item.data() } as PurchaseInvoiceRecord));
        purchases.sort((a, b) => (toInvoiceDate(b.date)?.getTime() || 0) - (toInvoiceDate(a.date)?.getTime() || 0));
        setPurchaseInvoices(purchases);
        setSelectedPurchase(current => current ? (purchases.find(item => item.id === current.id) || current) : current);
      }, error => handleFirestoreError(error, OperationType.LIST, 'purchases'))
      : () => setPurchaseInvoices([]);

    return () => {
      unsubscribe();
      unsubscribeSettings();
      unsubscribePurchases();
    };
  }, [ownerId, isStoreAdmin]);

  useEffect(() => {
    if (!isStoreAdmin || !ownerId || !auth.currentUser) {
      setSuppliers([]);
      return;
    }
    return onSnapshot(query(collection(db, 'suppliers'), where('ownerId', '==', ownerId)), snapshot => {
      const records = snapshot.docs.map(item => ({ id: item.id, ...item.data() } as SupplierRecord));
      records.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
      setSuppliers(records);
    }, error => handleFirestoreError(error, OperationType.LIST, 'suppliers'));
  }, [ownerId, isStoreAdmin]);

  useEffect(() => {
    if (!selectedPurchase?.supplierId || !ownerId || !isStoreAdmin) {
      setSupplierPayments([]);
      return;
    }
    return onSnapshot(
      query(
        collection(db, 'supplier_debts', selectedPurchase.supplierId, 'payments'),
        where('ownerId', '==', ownerId),
      ),
      snapshot => {
        const payments = snapshot.docs.map(item => ({ id: item.id, ...item.data() } as SupplierPaymentRecord));
        payments.sort((a, b) => (toInvoiceDate(b.createdAt)?.getTime() || 0) - (toInvoiceDate(a.createdAt)?.getTime() || 0));
        setSupplierPayments(payments.filter(payment => payment.purchaseNumber === selectedPurchase.number));
      },
      error => handleFirestoreError(error, OperationType.LIST, 'supplier_debts/payments'),
    );
  }, [selectedPurchase?.supplierId, selectedPurchase?.number, ownerId, isStoreAdmin]);

  useEffect(() => {
    if (isNewInvoiceModalOpen) {
      const unsubClients = onSnapshot(query(collection(db, 'clients'), where('ownerId', '==', ownerId)), (snap) => {
        const cls = snap.docs.map(d => ({ id: d.id, ...d.data() } as Client));
        cls.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        setClients(cls);
      }, (err) => {
        handleFirestoreError(err, OperationType.LIST, 'clients');
      });
      const unsubProducts = onSnapshot(query(collection(db, 'products'), where('ownerId', '==', ownerId)), (snap) => {
        const prods = snap.docs.map(d => {
          const data = d.data();
          delete data.buyPrice;
          return { id: d.id, ...data, buyPrice: 0 } as Product;
        });
        prods.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        setProducts(prods);
      }, (err) => {
        handleFirestoreError(err, OperationType.LIST, 'products');
      });
      return () => {
        unsubClients();
        unsubProducts();
      };
    }
  }, [isNewInvoiceModalOpen, ownerId]);

  useEffect(() => {
    if (!isPurchaseModalOpen || !isStoreAdmin || !ownerId) return;
    const unsubscribeProducts = onSnapshot(
      query(collection(db, 'products'), where('ownerId', '==', ownerId)),
      snapshot => setPurchaseCatalog(current => [
        ...current.filter(item => item.collection !== 'products'),
        ...snapshot.docs
          .filter(item => item.data().inventoryType !== 'service')
          .map(item => ({ id: item.id, name: String(item.data().name || 'Article'), collection: 'products' as const, stock: Number(item.data().stock) || 0 })),
      ]),
      error => handleFirestoreError(error, OperationType.LIST, 'products'),
    );
    const unsubscribeParts = onSnapshot(
      query(collection(db, 'parts'), where('ownerId', '==', ownerId)),
      snapshot => setPurchaseCatalog(current => [
        ...current.filter(item => item.collection !== 'parts'),
        ...snapshot.docs.map(item => ({ id: item.id, name: String(item.data().name || 'Pièce'), collection: 'parts' as const, stock: Number(item.data().stock) || 0 })),
      ]),
      error => handleFirestoreError(error, OperationType.LIST, 'parts'),
    );
    return () => {
      unsubscribeProducts();
      unsubscribeParts();
    };
  }, [isPurchaseModalOpen, isStoreAdmin, ownerId]);

  const addToCart = (product: Product) => {
    setCart(prev => {
      const existing = prev.find(item => item.productId === product.id);
      if (existing) {
        if (existing.quantity >= product.stock) return prev;
        return prev.map(item => 
          item.productId === product.id 
            ? { ...item, quantity: item.quantity + 1, total: (item.quantity + 1) * item.price }
            : item
        );
      }
      return [...prev, {
        productId: product.id,
        name: product.name,
        quantity: 1,
        price: product.sellPrice,
        total: product.sellPrice
      }];
    });
  };

  const updateQuantity = (productId: string, delta: number) => {
    setCart(prev => prev.map(item => {
      if (item.productId === productId) {
        const product = products.find(p => p.id === productId);
        const newQty = Math.max(1, item.quantity + delta);
        if (product && newQty > product.stock) return item;
        return { ...item, quantity: newQty, total: newQty * item.price };
      }
      return item;
    }));
  };

  const removeFromCart = (productId: string) => {
    setCart(prev => prev.filter(item => item.productId !== productId));
  };

  const financialTotals = useMemo(
    () => computeTotals(cart, 0, storeSettings),
    [cart, storeSettings?.tvaEnabled, storeSettings?.tva],
  );
  const { subtotal, tva: tvaAmount, total: cartTotal } = financialTotals;

  useEffect(() => {
    setPaidAmount(cartTotal);
  }, [selectedClient, cartTotal]);

  const remainingDebt = Math.round(Math.max(0, cartTotal - paidAmount) * 1000) / 1000;
  const purchaseTotalMilli = purchaseLines.reduce((sum, line) => sum + line.quantity * line.unitCostMilli, 0);
  const purchasePaidMilli = Math.round((Number(purchasePaidAmount.replace(',', '.')) || 0) * 1000);
  const purchaseDebtMilli = purchaseTotalMilli - purchasePaidMilli;

  const addPurchaseLine = () => {
    const item = purchaseCatalog.find(candidate => `${candidate.collection}:${candidate.id}` === purchaseItemId);
    const quantity = Number(purchaseItemQuantity);
    const unitCost = Number(purchaseItemCost.replace(',', '.'));
    if (!item || !Number.isInteger(quantity) || quantity <= 0 || !Number.isFinite(unitCost) || unitCost < 0) {
      setPurchaseError('Sélectionnez un article, une quantité entière positive et un coût unitaire valide.');
      return;
    }
    if (purchaseLines.some(line => line.itemId === item.id && line.itemCollection === item.collection)) {
      setPurchaseError('Cet article est déjà dans la facture.');
      return;
    }
    setPurchaseLines(current => [...current, {
      itemId: item.id,
      itemCollection: item.collection,
      nameSnapshot: item.name,
      quantity,
      unitCostMilli: Math.round(unitCost * 1000),
    }]);
    setPurchaseItemId('');
    setPurchaseItemQuantity('1');
    setPurchaseItemCost('');
    setPurchaseError('');
  };

  const filteredProducts = useMemo(() => 
    products.filter(p => 
      p.name.toLowerCase().includes(productSearch.toLowerCase()) ||
      (p.barcode && p.barcode.toLowerCase().includes(productSearch.toLowerCase()))
    ), [products, productSearch]
  );

  const validateSale = async () => {
    if (cart.length === 0) return;
    if (!cashSession) {
      setError(cashSessionLoading
        ? 'Vérification de la caisse en cours…'
        : 'Aucune caisse ouverte. Ouvrez une session avant de créer une facture.');
      return;
    }
    setIsProcessing(true);
    setError(null);

    // Règle de paiement selon le type de client
    if (!selectedClient) {
      if (Math.abs(paidAmount - cartTotal) > 0.001) {
        setError(`Pour un client passagé, le montant payé doit être obligatoirement égal au montant total de la vente (${cartTotal.toFixed(3)} ${storeSettings?.currency || 'DT'}).`);
        setIsProcessing(false);
        return;
      }
    } else {
      if (paidAmount > cartTotal + 0.001) {
        setError(`Le montant payé ne peut pas dépasser le montant total de la vente (${cartTotal.toFixed(3)} ${storeSettings?.currency || 'DT'}).`);
        setIsProcessing(false);
        return;
      }
    }

    try {
      const saleRef = doc(collection(db, 'sales'));
      const invoiceRef = doc(collection(db, 'invoices'));
      await runTransaction(db, async (transaction) => {
        
        // 1. ALL READS FIRST
        const counterRef = doc(db, 'counters', `invoices_${ownerId}`);
        const counterSnap = await transaction.get(counterRef);
        
        const productSnaps = await Promise.all(
          cart.map(item => transaction.get(doc(db, 'products', item.productId)))
        );

        let clientSnap = null;
        if (selectedClient && remainingDebt > 0) {
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
        const stockUpdates: { ref: any, newStock: number }[] = [];
        for (let i = 0; i < cart.length; i++) {
          const item = cart[i];
          const productSnap = productSnaps[i];
          if (!productSnap.exists()) throw new Error(`Produit ${item.name} introuvable`);
          const currentStock = productSnap.data().stock || 0;
          if (currentStock < item.quantity) throw new Error(`Stock insuffisant pour ${item.name} (Disponible: ${currentStock})`);
          stockUpdates.push({
            ref: doc(db, 'products', item.productId),
            newStock: currentStock - item.quantity
          });
        }

        // Validate client
        let clientUpdate = null;
        if (selectedClient && remainingDebt > 0) {
          if (!clientSnap || !clientSnap.exists()) throw new Error(`Client introuvable`);
          const currentDebt = clientSnap.data().debt || 0;
          clientUpdate = {
            ref: doc(db, 'clients', selectedClient.id),
            newDebt: currentDebt + remainingDebt
          };
        }

        // 3. ALL WRITES LAST
        transaction.set(counterRef, { lastNum: nextNum }, { merge: true });
        addCashSessionTotals(transaction, activeCashSession, {
          sales: cartTotal,
          cash: paidAmount,
        });

        for (const update of stockUpdates) {
          transaction.update(update.ref, { stock: update.newStock });
        }

        if (clientUpdate) {
          transaction.update(clientUpdate.ref, { debt: clientUpdate.newDebt });
        }

        const saleData = {
          date: serverTimestamp(),
          clientId: selectedClient?.id || null,
          clientCode: selectedClient?.code || '',
          clientName: selectedClient?.name || 'Client de passage',
          total: cartTotal,
          paid: paidAmount,
          debt: remainingDebt,
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
          paid: paidAmount,
          debt: remainingDebt,
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
      });

      try {
        await apiFetch(`/financial/sales/${encodeURIComponent(saleRef.id)}/costs`, { method: 'POST' });
      } catch (costError) {
        console.error('Invoice sale purchase-cost snapshot failed after commit.');
        setError(`Facture enregistrée, mais le coût d'achat n'a pas pu être figé. ${costError instanceof Error ? costError.message : ''}`);
      }

      setSaleSuccess('Facture créée avec succès !');
      setTimeout(() => {
        setSaleSuccess(null);
        setIsNewInvoiceModalOpen(false);
        setCart([]);
        setPaidAmount(0);
        setSelectedClient(null);
      }, 2000);
    } catch (err: any) {
      console.error('Transaction failed:', err);
      setError(err.message);
      handleFirestoreError(err, OperationType.WRITE, 'sales');
    } finally {
      setIsProcessing(false);
    }
  };

  const createQuickSupplier = async () => {
    const name = quickSupplierName.trim();
    if (!isStoreAdmin || !ownerId || !name) {
      setPurchaseError('Saisissez le nom du fournisseur.');
      return;
    }
    try {
      const supplierRef = doc(collection(db, 'suppliers'));
      await setDoc(supplierRef, {
        ownerId,
        name,
        createdAt: serverTimestamp(),
        createdBy: userProfile?.uid,
      });
      setPurchaseSupplierId(supplierRef.id);
      setQuickSupplierName('');
      setPurchaseError('');
    } catch (cause) {
      setPurchaseError(cause instanceof Error ? cause.message : 'Impossible d’ajouter le fournisseur.');
    }
  };

  const handlePurchaseAttachment = async (file: File | undefined) => {
    setPurchaseError('');
    if (!file) return;
    setPurchaseFileLoading(true);
    try {
      setPurchaseAttachment(await compressPurchaseImage(file));
      setPurchaseAttachmentUrl('');
    } catch (cause) {
      setPurchaseError(cause instanceof Error ? cause.message : 'Impossible de traiter la pièce jointe.');
    } finally {
      setPurchaseFileLoading(false);
    }
  };

  const submitPurchase = async (event: React.FormEvent) => {
    event.preventDefault();
    setPurchaseError('');
    setPurchaseSuccess('');
    if (!isStoreAdmin || !ownerId || !userProfile || !auth.currentUser) {
      setPurchaseError('Seul l’administrateur du magasin peut créer une facture d’achat.');
      return;
    }
    if (!purchaseSupplierId || !purchaseLines.length) {
      setPurchaseError('Choisissez un fournisseur et ajoutez au moins une ligne.');
      return;
    }
    const normalizedNumber = purchaseNumber.trim().toLocaleUpperCase('fr');
    if (!/^[A-Z0-9][A-Z0-9._-]{0,59}$/.test(normalizedNumber)) {
      setPurchaseError('Le numéro doit contenir uniquement des lettres, chiffres, points, tirets ou soulignés.');
      return;
    }
    const paidAmount = Number(purchasePaidAmount.replace(',', '.'));
    let totals;
    try {
      totals = calculatePurchaseTotals(purchaseLines, paidAmount);
    } catch (cause) {
      setPurchaseError(cause instanceof Error ? cause.message : 'Vérifiez les lignes et le montant payé.');
      return;
    }
    let attachment: PurchaseAttachment | undefined;
    if (purchaseAttachmentUrl.trim()) {
      if (!/^https:\/\/\S+$/i.test(purchaseAttachmentUrl.trim())) {
        setPurchaseError('Le lien de la pièce jointe doit commencer par https://.');
        return;
      }
      attachment = { url: purchaseAttachmentUrl.trim(), fileName: 'Lien fournisseur' };
    } else if (purchaseAttachment) {
      attachment = purchaseAttachment;
    }

    setPurchaseSaving(true);
    try {
      const purchaseRef = doc(db, 'purchases', `purchase_${ownerId}_${normalizedNumber}`);
      const supplierRef = doc(db, 'suppliers', purchaseSupplierId);
      const debtRef = doc(db, 'supplier_debts', purchaseSupplierId);
      const paymentRef = doc(collection(db, 'supplier_debts', purchaseSupplierId, 'payments'));
      const itemRefs = purchaseLines.map(line => doc(db, line.itemCollection, line.itemId));
      await runTransaction(db, async transaction => {
        const [purchaseSnapshot, supplierSnapshot, debtSnapshot] = await Promise.all([
          transaction.get(purchaseRef),
          transaction.get(supplierRef),
          transaction.get(debtRef),
        ]);
        if (purchaseSnapshot.exists()) throw new Error('Ce numéro de facture existe déjà.');
        if (!supplierSnapshot.exists() || supplierSnapshot.data().ownerId !== ownerId) {
          throw new Error('Le fournisseur sélectionné est introuvable dans ce magasin.');
        }
        const itemSnapshots = await Promise.all(itemRefs.map(ref => transaction.get(ref)));
        const activeSession = totals.paidMilli > 0
          ? await requireOpenCashSession(transaction, userProfile.uid, ownerId)
          : null;
        const stockUpdates = itemSnapshots.map((snapshot, index) => {
          const line = purchaseLines[index];
          if (!snapshot.exists() || snapshot.data().ownerId !== ownerId) {
            throw new Error(`L’article « ${line.nameSnapshot} » n’existe plus dans ce magasin.`);
          }
          if (snapshot.data().inventoryType === 'service') {
            throw new Error('Les services ne peuvent pas être reçus en stock.');
          }
          const version = (Number(snapshot.data().stockVersion) || 0) + 1;
          return {
            ref: itemRefs[index],
            line,
            stock: (Number(snapshot.data().stock) || 0) + line.quantity,
            version,
            movementId: `${line.itemCollection === 'parts' ? 'part' : 'product'}_${line.itemId}_v${version}`,
          };
        });
        const supplierName = String(supplierSnapshot.data().name || 'Fournisseur');
        const currentDebtMilli = Number(debtSnapshot.data()?.balanceMilli) || 0;
        const debtMilli = currentDebtMilli + totals.debtMilli;
        if (!Number.isSafeInteger(debtMilli)) throw new Error('Le solde fournisseur dépasse la limite autorisée.');
        const purchaseDateValue = Timestamp.fromDate(new Date(`${purchaseDate}T12:00:00`));

        transaction.set(purchaseRef, {
          ownerId,
          number: normalizedNumber,
          date: purchaseDateValue,
          supplierId: purchaseSupplierId,
          supplierName,
          items: purchaseLines,
          totalMilli: totals.totalMilli,
          paidMilli: totals.paidMilli,
          debtMilli: totals.debtMilli,
          note: purchaseNote.trim(),
          ...(attachment ? { attachment } : {}),
          status: 'received',
          createdAt: serverTimestamp(),
          createdBy: userProfile.uid,
          ...(totals.paidMilli > 0 ? { lastPaymentId: paymentRef.id } : {}),
          ...(activeSession ? { sessionId: activeSession.id } : {}),
        });
        transaction.set(debtRef, {
          ownerId,
          supplierId: purchaseSupplierId,
          supplierName,
          balanceMilli: debtMilli,
          lastEntryId: totals.paidMilli > 0 ? paymentRef.id : purchaseRef.id,
          updatedAt: serverTimestamp(),
        }, { merge: true });

        stockUpdates.forEach(({ ref, line, stock, version, movementId }, index) => {
          transaction.update(ref, {
            stock,
            stockVersion: version,
            lastStockMovementId: movementId,
            ownerId,
            userId: userProfile.uid,
          });
          transaction.set(doc(db, 'stock_movements', movementId), {
            type: 'purchase_restock',
            inventoryCollection: line.itemCollection,
            productId: line.itemId,
            productName: line.nameSnapshot,
            purchaseId: purchaseRef.id,
            purchaseNumber: normalizedNumber,
            lineIndex: index,
            delta: line.quantity,
            quantity: line.quantity,
            version,
            ownerId,
            userId: userProfile.uid,
            userLabel: userProfile.name || userProfile.email || 'Administrateur',
            createdAt: serverTimestamp(),
          });
          transaction.set(doc(db, line.itemCollection === 'parts' ? 'part_costs' : 'product_costs', line.itemId), {
            ownerId,
            buyPrice: line.unitCostMilli / 1000,
            currentUnitCostMilli: line.unitCostMilli,
            updatedAt: serverTimestamp(),
            updatedBy: userProfile.uid,
          }, { merge: true });
        });

        if (totals.paidMilli > 0 && activeSession) {
          transaction.set(paymentRef, {
            ownerId,
            supplierId: purchaseSupplierId,
            supplierName,
            purchaseId: purchaseRef.id,
            purchaseNumber: normalizedNumber,
            amountMilli: totals.paidMilli,
            type: 'purchase_initial_payment',
            sessionId: activeSession.id,
            createdAt: serverTimestamp(),
            createdBy: userProfile.uid,
          });
          addCashSessionTotals(transaction, activeSession, {
            expenses: totals.paidMilli / 1000,
            expensesCash: totals.paidMilli / 1000,
          });
        }
      });
      setPurchaseSuccess(`Facture ${normalizedNumber} enregistrée ; le stock et le coût d’achat ont été mis à jour.`);
      setPurchaseLines([]);
      setPurchasePaidAmount('0');
      setPurchaseNote('');
      setPurchaseAttachment(null);
      setPurchaseAttachmentUrl('');
      setPurchaseNumber(`ACH-${new Date().getFullYear()}-${Date.now().toString().slice(-6)}`);
      setIsPurchaseModalOpen(false);
    } catch (cause) {
      setPurchaseError(cause instanceof Error ? cause.message : 'Impossible d’enregistrer la facture d’achat.');
    } finally {
      setPurchaseSaving(false);
    }
  };

  const payPurchaseDebt = async () => {
    if (!selectedPurchase || !selectedPurchase.supplierId || !ownerId || !userProfile || !isStoreAdmin) return;
    setPurchaseError('');
    let paymentMilli: number;
    try {
      paymentMilli = getPurchasePaymentBalance(
        Number(selectedPurchase.debtMilli) || 0,
        Number(supplierPaymentAmount.replace(',', '.')),
      ).paymentMilli;
    } catch (cause) {
      setPurchaseError(cause instanceof Error ? cause.message : 'Montant de règlement invalide.');
      return;
    }

    setPaymentSaving(true);
    try {
      const purchaseRef = doc(db, 'purchases', selectedPurchase.id);
      const debtRef = doc(db, 'supplier_debts', selectedPurchase.supplierId);
      const paymentRef = doc(collection(db, 'supplier_debts', selectedPurchase.supplierId, 'payments'));
      await runTransaction(db, async transaction => {
        const [purchaseSnapshot, debtSnapshot] = await Promise.all([
          transaction.get(purchaseRef),
          transaction.get(debtRef),
        ]);
        if (!purchaseSnapshot.exists()) throw new Error('La facture d’achat est introuvable.');
        const purchase = purchaseSnapshot.data();
        if (purchase.ownerId !== ownerId || purchase.status !== 'received') {
          throw new Error('Cette facture ne peut plus recevoir de règlement.');
        }
        const currentInvoiceDebt = Number(purchase.debtMilli) || 0;
        getPurchasePaymentBalance(currentInvoiceDebt, paymentMilli / 1000);
        if (!debtSnapshot.exists() || debtSnapshot.data().ownerId !== ownerId) {
          throw new Error('La dette fournisseur est introuvable pour ce magasin.');
        }
        const activeSession = await requireOpenCashSession(transaction, userProfile.uid, ownerId);
        const supplierBalance = Number(debtSnapshot.data().balanceMilli) || 0;
        if (supplierBalance < paymentMilli) {
          throw new Error('Le solde de la dette fournisseur est inférieur au règlement demandé.');
        }
        const nextPaid = (Number(purchase.paidMilli) || 0) + paymentMilli;
        const nextInvoiceDebt = currentInvoiceDebt - paymentMilli;
        transaction.update(purchaseRef, {
          paidMilli: nextPaid,
          debtMilli: nextInvoiceDebt,
          lastPaymentId: paymentRef.id,
          updatedAt: serverTimestamp(),
        });
        transaction.update(debtRef, {
          balanceMilli: supplierBalance - paymentMilli,
          lastEntryId: paymentRef.id,
          updatedAt: serverTimestamp(),
        });
        transaction.set(paymentRef, {
          ownerId,
          supplierId: selectedPurchase.supplierId,
          supplierName: purchase.supplierName || selectedPurchase.supplierName || '',
          purchaseId: purchaseRef.id,
          purchaseNumber: purchase.number,
          amountMilli: paymentMilli,
          type: 'purchase_debt_payment',
          sessionId: activeSession.id,
          createdAt: serverTimestamp(),
          createdBy: userProfile.uid,
        });
        addCashSessionTotals(transaction, activeSession, {
          expenses: paymentMilli / 1000,
          expensesCash: paymentMilli / 1000,
        });
      });
      setSupplierPaymentAmount('');
      setPurchaseError('');
    } catch (cause) {
      setPurchaseError(cause instanceof Error ? cause.message : 'Impossible d’enregistrer le règlement.');
    } finally {
      setPaymentSaving(false);
    }
  };

  const cancelPurchaseInvoice = async () => {
    if (!selectedPurchase || !selectedPurchase.supplierId || !ownerId || !userProfile || !isStoreAdmin) return;
    setPurchaseError('');
    setPaymentSaving(true);
    try {
      const purchaseRef = doc(db, 'purchases', selectedPurchase.id);
      const debtRef = doc(db, 'supplier_debts', selectedPurchase.supplierId);
      const lines = selectedPurchase.items || [];
      if (!lines.length) throw new Error('Cette facture ne contient aucune ligne de stock annulable.');
      const itemRefs = lines.map(line => doc(db, line.itemCollection, line.itemId));
      const paymentRef = doc(collection(db, 'supplier_debts', selectedPurchase.supplierId, 'payments'));
      await runTransaction(db, async transaction => {
        const [purchaseSnapshot, debtSnapshot] = await Promise.all([
          transaction.get(purchaseRef),
          transaction.get(debtRef),
        ]);
        if (!purchaseSnapshot.exists()) throw new Error('La facture d’achat est introuvable.');
        const purchase = purchaseSnapshot.data();
        if (purchase.ownerId !== ownerId || purchase.status !== 'received') {
          throw new Error('Cette facture est déjà annulée ou ne relève pas de ce magasin.');
        }
        if (!debtSnapshot.exists() || debtSnapshot.data().ownerId !== ownerId) {
          throw new Error('La dette fournisseur est introuvable pour ce magasin.');
        }
        const snapshots = await Promise.all(itemRefs.map(ref => transaction.get(ref)));
        const stockUpdates = snapshots.map((snapshot, index) => {
          const line = lines[index];
          if (!snapshot.exists() || snapshot.data().ownerId !== ownerId) {
            throw new Error(`Impossible d’annuler : l’article « ${line.nameSnapshot} » n’est plus disponible.`);
          }
          let nextStock: number;
          try {
            nextStock = getPurchaseCancellationStock(Number(snapshot.data().stock) || 0, Number(line.quantity));
          } catch {
            throw new Error(`Annulation impossible : stock insuffisant pour « ${line.nameSnapshot} » (disponible : ${snapshot.data().stock || 0}, à reprendre : ${line.quantity}).`);
          }
          const version = (Number(snapshot.data().stockVersion) || 0) + 1;
          return {
            ref: itemRefs[index],
            line,
            stock: nextStock,
            version,
            movementId: `${line.itemCollection === 'parts' ? 'part' : 'product'}_${line.itemId}_v${version}`,
          };
        });
        const purchaseDebt = Number(purchase.debtMilli) || 0;
        const purchasePaid = Number(purchase.paidMilli) || 0;
        const supplierBalance = Number(debtSnapshot.data().balanceMilli) || 0;
        const newSupplierBalance = supplierBalance - purchaseDebt - purchasePaid;
        if (!Number.isSafeInteger(newSupplierBalance)) throw new Error('Le solde fournisseur dépasse la limite autorisée.');
        const cancellationRecord = {
          ownerId,
          supplierId: selectedPurchase.supplierId,
          supplierName: purchase.supplierName || selectedPurchase.supplierName || '',
          purchaseId: purchaseRef.id,
          purchaseNumber: purchase.number,
          amountMilli: -purchasePaid,
          type: 'purchase_cancellation_credit',
          createdAt: serverTimestamp(),
          createdBy: userProfile.uid,
        };
        transaction.update(purchaseRef, {
          status: 'cancelled',
          debtMilli: 0,
          lastPaymentId: paymentRef.id,
          cancelledAt: serverTimestamp(),
          cancelledBy: userProfile.uid,
          cancellationReason: 'Annulation administrative avec reprise du stock disponible.',
          updatedAt: serverTimestamp(),
        });
        transaction.update(debtRef, {
          balanceMilli: newSupplierBalance,
          lastEntryId: paymentRef.id,
          updatedAt: serverTimestamp(),
        });
        stockUpdates.forEach(({ ref, line, stock, version, movementId }, index) => {
          transaction.update(ref, {
            stock,
            stockVersion: version,
            lastStockMovementId: movementId,
            ownerId,
            userId: userProfile.uid,
          });
          transaction.set(doc(db, 'stock_movements', movementId), {
            type: 'purchase_cancel',
            inventoryCollection: line.itemCollection,
            productId: line.itemId,
            productName: line.nameSnapshot,
            purchaseId: purchaseRef.id,
            purchaseNumber: purchase.number,
            lineIndex: index,
            delta: -line.quantity,
            quantity: line.quantity,
            version,
            ownerId,
            userId: userProfile.uid,
            userLabel: userProfile.name || userProfile.email || 'Administrateur',
            createdAt: serverTimestamp(),
          });
        });
        transaction.set(paymentRef, cancellationRecord);
      });
      setShowPurchaseCancelConfirm(false);
      setSelectedPurchase(null);
      setPurchaseError('');
    } catch (cause) {
      setPurchaseError(cause instanceof Error ? cause.message : 'Impossible d’annuler cette facture.');
    } finally {
      setPaymentSaving(false);
    }
  };

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
          date: invoice.date?.toDate ? format(invoice.date.toDate(), 'dd/MM/yyyy HH:mm') : format(new Date(), 'dd/MM/yyyy HH:mm')
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

  const matchesDateRange = (value: unknown) => {
    const date = toInvoiceDate(value);
    if (!date) return !startDate && !endDate;
    const start = startDate ? new Date(`${startDate}T00:00:00`) : null;
    const end = endDate ? new Date(`${endDate}T23:59:59.999`) : null;
    return (!start || date >= start) && (!end || date <= end);
  };
  const normalizedSearch = searchTerm.trim().toLocaleLowerCase('fr');
  const filteredInvoices = invoices.filter(inv =>
    (!normalizedSearch ||
      inv.number.toLocaleLowerCase('fr').includes(normalizedSearch) ||
      inv.clientName.toLocaleLowerCase('fr').includes(normalizedSearch) ||
      (inv.clientCode || '').toLocaleLowerCase('fr').includes(normalizedSearch)) &&
    matchesDateRange(inv.date)
  );
  const filteredPurchases = purchaseInvoices.filter(purchase => {
    const number = purchase.invoiceNumber || purchase.number || purchase.id;
    const supplier = purchase.supplierName || purchase.supplierId || '';
    return (!normalizedSearch ||
      number.toLocaleLowerCase('fr').includes(normalizedSearch) ||
      supplier.toLocaleLowerCase('fr').includes(normalizedSearch)) &&
      matchesDateRange(purchase.date);
  });

  return (
    <div className="space-y-6 relative">
      {/* Hidden printable ticket for Invoices - Render outside #root using Portal */}
      {createPortal(
        <div className="print-container">
          {selectedInvoice && (
            <PrintableTicket invoice={selectedInvoice} ownerId={ownerId} />
          )}
        </div>,
        document.body
      )}

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold text-slate-800 tracking-tight">Facturation</h1>
          <p className="text-xs text-slate-400 font-medium uppercase tracking-wider mt-0.5">Factures de vente et achats du magasin</p>
        </div>
        {activeTab === 'sales' && <button
          onClick={() => setIsNewInvoiceModalOpen(true)}
          className="inline-flex items-center justify-center gap-2 px-5 py-3 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black uppercase tracking-wider rounded-xl transition-all duration-350 shadow-lg shadow-emerald-600/15 group hover:-translate-y-0.5"
        >
          <Plus className="w-4 h-4 transition-transform group-hover:rotate-90 duration-300" />
          Nouvelle Facture
        </button>}
        {activeTab === 'purchases' && isStoreAdmin && <button
          onClick={() => {
            setPurchaseError('');
            setPurchaseSuccess('');
            setPurchaseLines([]);
            setPurchasePaidAmount('0');
            setPurchaseNumber(`ACH-${new Date().getFullYear()}-${Date.now().toString().slice(-6)}`);
            setIsPurchaseModalOpen(true);
          }}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 py-3 text-xs font-black uppercase tracking-wider text-white shadow-lg shadow-emerald-600/15 transition-all hover:bg-emerald-700"
        >
          <Plus className="h-4 w-4" /> Nouvelle facture d'achat
        </button>}
      </div>
      {purchaseSuccess && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-800">{purchaseSuccess}</p>}

      <div className="bg-white rounded-3xl border border-slate-100 shadow-xs overflow-hidden premium-shadow">
        <div className="flex flex-col gap-4 border-b border-slate-100 bg-slate-50/20 p-5">
          <div className="flex flex-wrap gap-2" role="tablist" aria-label="Type de factures">
            <button type="button" role="tab" aria-selected={activeTab === 'sales'} onClick={() => setActiveTab('sales')}
              className={`min-h-10 rounded-xl px-4 text-sm font-bold ${activeTab === 'sales' ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600 border border-slate-200'}`}>
              Factures de vente
            </button>
            <button type="button" role="tab" aria-selected={activeTab === 'purchases'} onClick={() => setActiveTab('purchases')}
              className={`min-h-10 rounded-xl px-4 text-sm font-bold ${activeTab === 'purchases' ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600 border border-slate-200'}`}>
              Factures d’achat
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-56 flex-1">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4.5 h-4.5 text-slate-400" />
            <input
              type="text"
              placeholder={activeTab === 'sales' ? 'Rechercher par numéro ou client...' : 'Rechercher par numéro ou fournisseur...'}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-11 pr-4 py-2.5 bg-slate-50 border border-slate-100 rounded-xl focus:bg-white text-xs font-semibold text-slate-700 placeholder-slate-400 focus:ring-2 focus:ring-emerald-500/10 focus:border-emerald-500 outline-none transition-all duration-300"
            />
          </div>
          <label className="flex items-center gap-2 text-xs font-bold text-slate-600">
            Du <input type="date" value={startDate} max={endDate || undefined} onChange={event => setStartDate(event.target.value)} className="min-h-10 rounded-xl border border-slate-200 bg-white px-2.5" />
          </label>
          <label className="flex items-center gap-2 text-xs font-bold text-slate-600">
            Au <input type="date" value={endDate} min={startDate || undefined} onChange={event => setEndDate(event.target.value)} className="min-h-10 rounded-xl border border-slate-200 bg-white px-2.5" />
          </label>
          </div>
        </div>

        {activeTab === 'sales' ? (
        <div className="overflow-x-auto text-[13px] font-medium text-slate-600">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50/50 border-b border-slate-100 text-slate-400 text-[10px] font-extrabold uppercase tracking-widest">
                <th className="px-6 py-4">N° Facture</th>
                <th className="px-6 py-4">Date</th>
                <th className="px-6 py-4">Client</th>
                <th className="px-6 py-4">Total</th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100/70">
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-6 py-10 text-center text-gray-500">Chargement...</td>
                </tr>
              ) : filteredInvoices.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-10 text-center text-gray-500">Aucune facture trouvée.</td>
                </tr>
              ) : (
                filteredInvoices.map((invoice) => (
                  <tr key={invoice.id} className="hover:bg-gray-50/50 transition-colors">
                    <td className="px-6 py-4 font-bold text-gray-900">{invoice.number}</td>
                    <td className="px-6 py-4 text-sm text-gray-600">
                      {invoice.date?.toDate ? format(invoice.date.toDate(), 'dd MMM yyyy', { locale: fr }) : 'Inconnue'}
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-sm font-medium text-gray-900">{invoice.clientName}</div>
                      {invoice.clientCode && <div className="text-[10px] text-gray-400 font-mono uppercase tracking-tighter">Code: {invoice.clientCode}</div>}
                    </td>
                    <td className="px-6 py-4 font-black text-gray-900 font-mono">{invoice.total.toFixed(3)} {storeSettings?.currency || 'DT'}</td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => setSelectedInvoice(invoice)}
                          className="p-2 text-gray-400 hover:text-green-700 hover:bg-green-50 rounded-lg transition-colors"
                        >
                          <Eye className="w-5 h-5" />
                        </button>
                        <button
                          onClick={() => downloadPDF(invoice)}
                          className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                        >
                          <Download className="w-5 h-5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        ) : !isStoreAdmin ? (
          <p className="p-8 text-center text-sm font-semibold text-slate-500">Les factures d’achat sont réservées à l’administrateur du magasin.</p>
        ) : (
          <div className="overflow-x-auto text-[13px] font-medium text-slate-600">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50/50 border-b border-slate-100 text-slate-400 text-[10px] font-extrabold uppercase tracking-widest">
                  <th className="px-6 py-4">N° Facture d’achat</th>
                  <th className="px-6 py-4">Date</th>
                  <th className="px-6 py-4">Fournisseur</th>
                  <th className="px-6 py-4 text-right">Total</th>
                  <th className="px-6 py-4 text-right">Reste dû</th>
                  <th className="px-6 py-4">Statut</th>
                  <th className="px-6 py-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100/70">
                {loading ? <tr><td colSpan={7} className="px-6 py-10 text-center text-gray-500">Chargement…</td></tr> :
                  filteredPurchases.length === 0 ? <tr><td colSpan={7} className="px-6 py-10 text-center text-gray-500">Aucune facture d’achat enregistrée.</td></tr> :
                  filteredPurchases.map(purchase => {
                    const purchaseDate = toInvoiceDate(purchase.date);
                    const total = typeof purchase.total === 'number' ? purchase.total : (Number(purchase.totalMilli) || 0) / 1000;
                    const debt = (Number(purchase.debtMilli) || 0) / 1000;
                    return (
                      <tr key={purchase.id} className="hover:bg-slate-50/60">
                        <td className="px-6 py-4 font-bold text-gray-900">{purchase.invoiceNumber || purchase.number || `Achat-${purchase.id.slice(0, 8)}`}</td>
                        <td className="px-6 py-4 text-sm text-gray-600">{purchaseDate ? format(purchaseDate, 'dd MMM yyyy', { locale: fr }) : 'Inconnue'}</td>
                        <td className="px-6 py-4">{purchase.supplierName || purchase.supplierId || 'Fournisseur non renseigné'}</td>
                        <td className="px-6 py-4 text-right font-black font-mono">{total.toFixed(3)} {storeSettings?.currency || 'DT'}</td>
                        <td className="px-6 py-4 text-right font-black font-mono text-rose-700">{debt.toFixed(3)} {storeSettings?.currency || 'DT'}</td>
                        <td className="px-6 py-4">{purchase.status === 'cancelled' ? 'Annulée' : 'Reçue'}</td>
                        <td className="px-6 py-4 text-right">
                          <button type="button" onClick={() => { setSelectedPurchase(purchase); setSupplierPaymentAmount(''); setPurchaseError(''); }}
                            className="min-h-9 rounded-lg border border-slate-200 px-3 text-xs font-bold text-indigo-700 hover:bg-indigo-50">Détails / Régler</button>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {isPurchaseModalOpen && isStoreAdmin && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/50 p-2 sm:p-4">
          <form onSubmit={submitPurchase} className="flex max-h-[96vh] w-full max-w-4xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl">
            <header className="flex items-start justify-between gap-4 border-b border-slate-100 p-5 sm:p-6">
              <div>
                <h2 className="text-xl font-black text-slate-900">Nouvelle facture d'achat</h2>
                <p className="mt-1 text-xs text-slate-500">La réception met à jour le stock et le coût réservé à l’administrateur.</p>
              </div>
              <button type="button" onClick={() => setIsPurchaseModalOpen(false)} disabled={purchaseSaving} aria-label="Fermer" className="rounded-xl p-2 text-slate-500 hover:bg-slate-100"><X className="h-5 w-5" /></button>
            </header>

            <div className="flex-1 space-y-5 overflow-y-auto p-5 sm:p-6">
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="space-y-1.5 text-xs font-bold text-slate-600">
                  Fournisseur
                  <select value={purchaseSupplierId} onChange={event => setPurchaseSupplierId(event.target.value)} required className="min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm">
                    <option value="">Sélectionner un fournisseur</option>
                    {suppliers.map(supplier => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
                  </select>
                </label>
                <div className="flex items-end gap-2">
                  <label className="min-w-0 flex-1 space-y-1.5 text-xs font-bold text-slate-600">
                    Création rapide du fournisseur
                    <input value={quickSupplierName} onChange={event => setQuickSupplierName(event.target.value)} maxLength={120} className="min-h-11 w-full rounded-xl border border-slate-200 px-3 text-sm" placeholder="Nom du fournisseur" />
                  </label>
                  <button type="button" onClick={createQuickSupplier} disabled={!quickSupplierName.trim()} className="min-h-11 shrink-0 rounded-xl border border-indigo-200 bg-indigo-50 px-3 text-xs font-bold text-indigo-700 hover:bg-indigo-100">Ajouter</button>
                </div>
                <label className="space-y-1.5 text-xs font-bold text-slate-600">
                  Numéro de facture
                  <input value={purchaseNumber} onChange={event => setPurchaseNumber(event.target.value)} required maxLength={60} pattern="[A-Za-z0-9][A-Za-z0-9._-]{0,59}" className="min-h-11 w-full rounded-xl border border-slate-200 px-3 text-sm" />
                </label>
                <label className="space-y-1.5 text-xs font-bold text-slate-600">
                  Date
                  <input type="date" value={purchaseDate} onChange={event => setPurchaseDate(event.target.value)} required className="min-h-11 w-full rounded-xl border border-slate-200 px-3 text-sm" />
                </label>
              </div>

              <section className="space-y-3 rounded-2xl border border-slate-200 p-4">
                <h3 className="text-sm font-black text-slate-800">Lignes de facture</h3>
                <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_100px_150px_auto]">
                  <select value={purchaseItemId} onChange={event => setPurchaseItemId(event.target.value)} className="min-h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm">
                    <option value="">Choisir un article ou une pièce</option>
                    {purchaseCatalog.map(item => <option key={`${item.collection}:${item.id}`} value={`${item.collection}:${item.id}`}>{item.collection === 'parts' ? 'Pièce' : 'Article'} — {item.name} (stock {item.stock})</option>)}
                  </select>
                  <input aria-label="Quantité reçue" type="number" min="1" step="1" value={purchaseItemQuantity} onChange={event => setPurchaseItemQuantity(event.target.value)} className="min-h-11 rounded-xl border border-slate-200 px-3 text-sm" />
                  <input aria-label="Prix d'achat unitaire en DT" type="number" min="0" step="0.001" value={purchaseItemCost} onChange={event => setPurchaseItemCost(event.target.value)} placeholder="Coût unitaire (DT)" className="min-h-11 rounded-xl border border-slate-200 px-3 text-sm" />
                  <button type="button" onClick={addPurchaseLine} className="inline-flex min-h-11 items-center justify-center gap-1 rounded-xl bg-indigo-600 px-4 text-sm font-bold text-white hover:bg-indigo-700"><Plus className="h-4 w-4" /> Ajouter</button>
                </div>
                {purchaseLines.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[560px] text-left text-sm">
                      <thead className="text-[10px] uppercase tracking-wide text-slate-500"><tr><th className="py-2">Article</th><th>Qté</th><th>Coût unitaire</th><th className="text-right">Total</th><th /></tr></thead>
                      <tbody className="divide-y divide-slate-100">
                        {purchaseLines.map((line, index) => (
                          <tr key={`${line.itemCollection}:${line.itemId}`}>
                            <td className="py-2 font-semibold">{line.nameSnapshot} <span className="text-[10px] text-slate-400">{line.itemCollection === 'parts' ? 'Pièce' : 'Article'}</span></td>
                            <td>{line.quantity}</td>
                            <td className="font-mono">{(line.unitCostMilli / 1000).toFixed(3)} DT</td>
                            <td className="text-right font-mono font-bold">{(line.quantity * line.unitCostMilli / 1000).toFixed(3)} DT</td>
                            <td className="text-right"><button type="button" onClick={() => setPurchaseLines(current => current.filter((_, itemIndex) => itemIndex !== index))} aria-label={`Retirer ${line.nameSnapshot}`} className="rounded-lg p-2 text-rose-600 hover:bg-rose-50"><Trash2 className="h-4 w-4" /></button></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : <p className="text-xs text-slate-500">Ajoutez au moins un article ou une pièce détachée.</p>}
              </section>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="space-y-1.5 text-xs font-bold text-slate-600">
                  Montant payé (DT)
                  <input type="number" min="0" step="0.001" max={purchaseTotalMilli / 1000} value={purchasePaidAmount} onChange={event => setPurchasePaidAmount(event.target.value)} className="min-h-11 w-full rounded-xl border border-slate-200 px-3 font-mono text-sm" />
                  {Number(purchasePaidAmount.replace(',', '.')) > 0 && !cashSession && <span className="block font-medium text-amber-700">{cashSessionLoading ? 'Vérification de la caisse…' : 'Un paiement nécessite une session de caisse ouverte.'}</span>}
                </label>
                <div className="rounded-xl bg-slate-50 p-3 text-sm">
                  <div className="flex justify-between"><span>Total calculé</span><strong className="font-mono">{(purchaseTotalMilli / 1000).toFixed(3)} DT</strong></div>
                  <div className="mt-2 flex justify-between text-rose-700"><span>Reste à payer</span><strong className="font-mono">{(purchaseDebtMilli / 1000).toFixed(3)} DT</strong></div>
                </div>
                <label className="space-y-1.5 text-xs font-bold text-slate-600 sm:col-span-2">
                  Note
                  <textarea value={purchaseNote} onChange={event => setPurchaseNote(event.target.value)} maxLength={1000} rows={2} className="w-full rounded-xl border border-slate-200 p-3 text-sm" />
                </label>
                <div className="space-y-2 sm:col-span-2">
                  <label className="block space-y-1.5 text-xs font-bold text-slate-600">
                    <span className="flex items-center gap-1"><Paperclip className="h-3.5 w-3.5" /> Pièce jointe optionnelle (lien HTTPS ou image compressée)</span>
                    <input type="url" value={purchaseAttachmentUrl} onChange={event => { setPurchaseAttachmentUrl(event.target.value); setPurchaseAttachment(null); }} placeholder="https://…" className="min-h-11 w-full rounded-xl border border-slate-200 px-3 text-sm" />
                  </label>
                  <input type="file" accept="image/*" disabled={purchaseFileLoading} onChange={event => void handlePurchaseAttachment(event.target.files?.[0])} className="block w-full text-xs text-slate-600 file:mr-3 file:min-h-10 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:font-bold" />
                  {purchaseAttachment && <p className="text-xs font-semibold text-emerald-700">Image compressée jointe : {purchaseAttachment.fileName}</p>}
                  {purchaseFileLoading && <p className="text-xs text-slate-500">Compression de l’image…</p>}
                </div>
              </div>
              {purchaseError && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm font-semibold text-rose-700">{purchaseError}</p>}
            </div>
            <footer className="flex flex-col-reverse justify-end gap-2 border-t border-slate-100 p-4 sm:flex-row sm:p-5">
              <button type="button" onClick={() => setIsPurchaseModalOpen(false)} disabled={purchaseSaving} className="min-h-11 rounded-xl border border-slate-200 px-5 text-sm font-bold text-slate-700 hover:bg-slate-50">Fermer</button>
              <button type="submit" disabled={purchaseSaving || purchaseFileLoading || (purchasePaidMilli > 0 && !cashSession)} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-50">
                <Wallet className="h-4 w-4" /> {purchaseSaving ? 'Enregistrement…' : 'Enregistrer et recevoir le stock'}
              </button>
            </footer>
          </form>
        </div>
      )}

      {selectedPurchase && isStoreAdmin && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/50 p-3 sm:p-5" role="presentation">
          <section role="dialog" aria-modal="true" aria-labelledby="purchase-detail-title" className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl">
            <header className="flex items-start justify-between gap-4 border-b border-slate-100 p-5">
              <div>
                <h2 id="purchase-detail-title" className="text-xl font-black text-slate-900">Facture {selectedPurchase.number || selectedPurchase.invoiceNumber}</h2>
                <p className="mt-1 text-sm text-slate-500">{selectedPurchase.supplierName || 'Fournisseur'} · {toInvoiceDate(selectedPurchase.date) ? format(toInvoiceDate(selectedPurchase.date)!, 'dd MMM yyyy', { locale: fr }) : 'Date inconnue'}</p>
              </div>
              <button type="button" onClick={() => { setSelectedPurchase(null); setShowPurchaseCancelConfirm(false); setPurchaseError(''); }} aria-label="Fermer" className="rounded-xl p-2 text-slate-500 hover:bg-slate-100"><X className="h-5 w-5" /></button>
            </header>
            <div className="space-y-4 overflow-y-auto p-5">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-xl bg-slate-50 p-3"><p className="text-[10px] font-bold uppercase text-slate-500">Total</p><p className="mt-1 font-mono font-black">{((Number(selectedPurchase.totalMilli) || 0) / 1000).toFixed(3)} DT</p></div>
                <div className="rounded-xl bg-emerald-50 p-3"><p className="text-[10px] font-bold uppercase text-emerald-700">Payé</p><p className="mt-1 font-mono font-black text-emerald-800">{((Number(selectedPurchase.paidMilli) || 0) / 1000).toFixed(3)} DT</p></div>
                <div className="rounded-xl bg-rose-50 p-3"><p className="text-[10px] font-bold uppercase text-rose-700">Reste dû</p><p className="mt-1 font-mono font-black text-rose-800">{((Number(selectedPurchase.debtMilli) || 0) / 1000).toFixed(3)} DT</p></div>
              </div>

              <div className="overflow-x-auto rounded-xl border border-slate-100">
                <table className="w-full min-w-[400px] text-left text-sm">
                  <thead className="bg-slate-50 text-[10px] uppercase text-slate-500"><tr><th className="p-3">Article</th><th>Qté</th><th className="text-right">Coût unitaire</th></tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {(selectedPurchase.items || []).map((line, index) => <tr key={`${line.itemCollection}:${line.itemId}:${index}`}><td className="p-3 font-semibold">{line.nameSnapshot}</td><td>{line.quantity}</td><td className="p-3 text-right font-mono">{(line.unitCostMilli / 1000).toFixed(3)} DT</td></tr>)}
                  </tbody>
                </table>
              </div>
              {selectedPurchase.note && <p className="whitespace-pre-wrap rounded-xl bg-slate-50 p-3 text-sm text-slate-700">{selectedPurchase.note}</p>}
              {selectedPurchase.attachment?.url && <a href={selectedPurchase.attachment.url} target="_blank" rel="noreferrer" className="text-sm font-bold text-indigo-700 underline">Ouvrir la pièce jointe</a>}
              {selectedPurchase.attachment?.dataUrl && <a href={selectedPurchase.attachment.dataUrl} target="_blank" rel="noreferrer" className="block"><img src={selectedPurchase.attachment.dataUrl} alt={`Pièce jointe facture ${selectedPurchase.number}`} className="max-h-56 rounded-xl border border-slate-200 object-contain" /></a>}

              {selectedPurchase.status === 'received' && Number(selectedPurchase.debtMilli) > 0 && (
                <div className="space-y-3 rounded-2xl border border-indigo-100 bg-indigo-50/50 p-4">
                  <h3 className="text-sm font-black text-slate-800">Régler la dette fournisseur</h3>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <input type="number" min="0.001" step="0.001" max={(Number(selectedPurchase.debtMilli) || 0) / 1000} value={supplierPaymentAmount} onChange={event => setSupplierPaymentAmount(event.target.value)} placeholder="Montant en DT" className="min-h-11 flex-1 rounded-xl border border-slate-200 px-3 font-mono text-sm" />
                    <button type="button" onClick={() => void payPurchaseDebt()} disabled={paymentSaving || !cashSession || !supplierPaymentAmount} className="min-h-11 rounded-xl bg-indigo-600 px-4 text-sm font-bold text-white hover:bg-indigo-700 disabled:opacity-50">Régler</button>
                  </div>
                  {!cashSession && <p className="text-xs font-semibold text-amber-800">{cashSessionLoading ? 'Vérification de la caisse…' : 'Une caisse ouverte est nécessaire pour enregistrer le paiement.'}</p>}
                </div>
              )}

              <section>
                <h3 className="mb-2 text-sm font-black text-slate-800">Historique des paiements</h3>
                {supplierPayments.length === 0 ? <p className="text-xs text-slate-500">Aucun paiement ni mouvement de règlement.</p> : (
                  <ul className="divide-y divide-slate-100 rounded-xl border border-slate-100">
                    {supplierPayments.map(payment => {
                      const date = toInvoiceDate(payment.createdAt);
                      const amount = (Number(payment.amountMilli) || 0) / 1000;
                      return <li key={payment.id} className="flex flex-wrap justify-between gap-2 p-3 text-xs">
                        <span className="text-slate-600">{date ? format(date, 'dd/MM/yyyy HH:mm', { locale: fr }) : 'Date inconnue'} · {payment.type === 'purchase_cancellation_credit' ? 'Annulation / avoir' : payment.type === 'purchase_initial_payment' ? 'Paiement initial' : 'Règlement'}</span>
                        <strong className={`font-mono ${amount < 0 ? 'text-amber-700' : 'text-emerald-700'}`}>{amount < 0 ? '+' : '−'}{Math.abs(amount).toFixed(3)} DT</strong>
                      </li>;
                    })}
                  </ul>
                )}
              </section>

              {selectedPurchase.status === 'received' && <div className="space-y-3 border-t border-slate-100 pt-4">
                {!showPurchaseCancelConfirm ? (
                  <button type="button" onClick={() => { setShowPurchaseCancelConfirm(true); setPurchaseError(''); }} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-rose-200 px-4 text-sm font-bold text-rose-700 hover:bg-rose-50"><Ban className="h-4 w-4" /> Annuler la facture</button>
                ) : (
                  <div className="space-y-3 rounded-2xl border border-rose-200 bg-rose-50 p-4">
                    <p className="text-sm font-bold text-rose-800">Confirmer l’annulation ? Le stock sera repris uniquement si les quantités sont disponibles. Les paiements déjà effectués seront portés en avoir fournisseur.</p>
                    <div className="flex flex-wrap gap-2">
                      <button type="button" onClick={() => void cancelPurchaseInvoice()} disabled={paymentSaving} className="min-h-10 rounded-xl bg-rose-600 px-4 text-sm font-bold text-white hover:bg-rose-700 disabled:opacity-50">{paymentSaving ? 'Annulation…' : 'Confirmer l’annulation'}</button>
                      <button type="button" onClick={() => setShowPurchaseCancelConfirm(false)} disabled={paymentSaving} className="min-h-10 rounded-xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700">Retour</button>
                    </div>
                  </div>
                )}
              </div>}
              {selectedPurchase.status === 'cancelled' && <p className="rounded-xl bg-rose-50 p-3 text-sm font-bold text-rose-700">Cette facture est annulée. {selectedPurchase.cancellationReason}</p>}
              {purchaseError && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm font-semibold text-rose-700">{purchaseError}</p>}
            </div>
          </section>
        </div>
      )}

      {/* New Invoice Modal */}
      {isNewInvoiceModalOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-2 sm:p-4 bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-5xl overflow-hidden border border-green-850 flex flex-col h-[92vh] sm:h-[90vh]">
            <div className="px-5 py-4 sm:px-8 sm:py-6 border-b border-green-800 flex items-center justify-between bg-gray-50/50">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-green-100 text-green-700 rounded-xl">
                  <Plus className="w-4.5 h-4.5 sm:w-6 sm:h-6" />
                </div>
                <div>
                  <h2 className="text-base sm:text-xl font-black text-gray-900 leading-tight">Nouvelle Facture</h2>
                  <p className="text-[10px] text-gray-500 font-medium uppercase tracking-wider mt-0.5">Création manuelle de facture</p>
                </div>
              </div>
              <button onClick={() => setIsNewInvoiceModalOpen(false)} className="p-2 text-gray-400 hover:text-gray-600 rounded-lg">
                <X className="w-5 h-5 sm:w-6 sm:h-6" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto md:overflow-hidden flex flex-col md:flex-row">
              {/* Left Side: Product Selection */}
              <div className="flex-1 flex flex-col border-b md:border-b-0 md:border-r border-green-800 bg-gray-50/30">
                <div className="p-4 sm:p-6 space-y-4">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                    <input
                      type="text"
                      placeholder="Rechercher un produit..."
                      className="w-full pl-10 pr-4 py-2.5 sm:py-3 bg-white border border-green-800 rounded-2xl focus:ring-2 focus:ring-green-500/20 focus:border-green-500 outline-none transition-all text-xs font-semibold"
                      value={productSearch}
                      onChange={(e) => setProductSearch(e.target.value)}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2.5 sm:gap-3 overflow-y-auto max-h-[35vh] md:max-h-[50vh] pr-1 sm:pr-2">
                    {filteredProducts.map(product => (
                      <button
                        key={product.id}
                        onClick={() => addToCart(product)}
                        disabled={product.stock <= 0}
                        className={cn(
                          "p-2.5 sm:p-3 rounded-2xl border text-left transition-all group relative overflow-hidden flex flex-col justify-between h-[125px] sm:h-[130px] min-w-0 w-full cursor-pointer",
                          product.stock > 0 
                            ? "bg-white border-green-800 hover:border-green-500 hover:shadow-md active:scale-95" 
                            : "bg-gray-50 border-green-800 opacity-60 grayscale cursor-not-allowed"
                        )}
                      >
                        <div className="flex-1 flex items-start min-w-0 w-full mb-1">
                          <div 
                            className="font-extrabold text-gray-900 text-[11px] sm:text-xs leading-tight sm:leading-snug break-words whitespace-normal overflow-hidden line-clamp-2 text-ellipsis group-hover:text-green-700 w-full"
                            style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}
                          >
                            {product.name}
                          </div>
                        </div>
                        <div className="w-full pt-1.5 mt-auto border-t border-green-50 flex flex-col gap-0.5 leading-tight shrink-0">
                          <div className="text-[11px] sm:text-xs text-gray-600 font-bold font-mono truncate">
                            {product.sellPrice.toFixed(3)} {storeSettings?.currency || 'DT'}
                          </div>
                          <div className={cn(
                            "text-[8px] sm:text-[10px] font-extrabold uppercase tracking-wider",
                            product.stock <= (product.lowStockAlert || 5) ? "text-red-500" : "text-green-600"
                          )}>
                            Stock: {product.stock}
                          </div>
                        </div>
                        {product.stock <= 0 && (
                          <div className="absolute inset-0 bg-white/50 backdrop-blur-[1px] flex items-center justify-center p-1 text-center">
                            <span className="bg-red-600 text-white px-1.5 py-0.5 rounded-md text-[8px] sm:text-[9px] font-black uppercase tracking-wider shadow-md">
                              Rupture
                            </span>
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Right Side: Cart & Client */}
              <div className="w-full md:w-[400px] flex flex-col bg-white">
                <div className="p-4 sm:p-6 border-b border-green-800 space-y-4">
                  <div>
                    <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest block mb-2">Client</label>
                    <select
                      className="w-full px-3.5 py-3.5 sm:py-3 bg-gray-50 border border-green-800 rounded-2xl focus:ring-2 focus:ring-green-500/20 focus:border-green-500 outline-none transition-all text-sm font-semibold text-slate-755"
                      value={selectedClient?.id || ''}
                      onChange={(e) => {
                        const client = clients.find(c => c.id === e.target.value);
                        setSelectedClient(client || null);
                        if (!client) {
                          setPaidAmount(cartTotal);
                          setPaidAmountInput(cartTotal.toFixed(3));
                        }
                      }}
                    >
                      <option value="">Client de passage</option>
                      {clients.map(client => (
                        <option key={client.id} value={client.id}>
                          {client.name} {client.code ? `(${client.code})` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
                  <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest block">Articles</label>
                  {cart.length === 0 ? (
                    <div className="text-center py-8 text-gray-400 italic text-xs">Panier vide</div>
                  ) : (
                    <div className="space-y-3">
                      {cart.map(item => (
                        <div key={item.productId} className="flex items-center justify-between p-3 bg-gray-50 rounded-2xl border border-green-800">
                          <div className="flex-1 min-w-0 pr-4">
                            <div className="font-extrabold text-gray-900 text-xs truncate">{item.name}</div>
                            <div className="text-[10px] text-gray-500 font-mono mt-0.5">{item.price.toFixed(3)} {storeSettings?.currency || 'DT'} x {item.quantity}</div>
                          </div>
                          <div className="flex items-center gap-1.5 sm:gap-2">
                            <button onClick={() => updateQuantity(item.productId, -1)} className="w-8 h-8 rounded-lg bg-white border border-slate-150 flex items-center justify-center hover:bg-slate-100 text-slate-500 active:scale-90 transition-transform">
                              <Minus className="w-3.5 h-3.5" />
                            </button>
                            <span className="w-5 text-center font-bold text-xs">{item.quantity}</span>
                            <button onClick={() => updateQuantity(item.productId, 1)} className="w-8 h-8 rounded-lg bg-white border border-slate-150 flex items-center justify-center hover:bg-slate-100 text-slate-500 active:scale-90 transition-transform">
                              <Plus className="w-3.5 h-3.5" />
                            </button>
                            <button onClick={() => removeFromCart(item.productId)} className="ml-1 p-1 text-red-500 hover:text-red-750 hover:bg-red-50 rounded-lg">
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="p-4 sm:p-6 bg-gray-50 border-t border-green-800 space-y-4">
                  <div className="space-y-1.5">
                    {storeSettings?.tvaEnabled === true && (
                      <div className="flex justify-between text-xs sm:text-sm">
                        <span className="text-gray-500 font-semibold">Sous-total</span>
                        <span className="font-mono font-bold">{subtotal.toFixed(3)} {storeSettings?.currency || 'DT'}</span>
                      </div>
                    )}
                    {storeSettings?.tvaEnabled === true && (
                      <div className="flex justify-between text-xs sm:text-sm">
                        <span className="text-gray-500 font-semibold">TVA ({storeSettings?.tva || 0}%)</span>
                        <span className="font-mono font-bold">{tvaAmount.toFixed(3)} {storeSettings?.currency || 'DT'}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-base sm:text-lg pt-1.5 border-t border-green-800">
                      <span className="font-black text-gray-900">TOTAL</span>
                      <span className="font-black text-green-700 font-mono">{cartTotal.toFixed(3)} {storeSettings?.currency || 'DT'}</span>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest block">Montant Payé</label>
                    <input
                      type="text"
                      inputMode="decimal"
                      className="w-full px-4 py-3 bg-white border border-green-800 rounded-2xl focus:ring-2 focus:ring-green-500/20 focus:border-green-500 outline-none font-mono font-black text-sm"
                      value={paidAmountInput}
                      onFocus={() => setIsPaidFocused(true)}
                      onBlur={() => {
                        setIsPaidFocused(false);
                        const parsed = parseFloat(paidAmountInput) || 0;
                        const rounded = Math.round(parsed * 1000) / 1000;
                        setPaidAmountInput(rounded === 0 ? '' : rounded.toFixed(3));
                        setPaidAmount(rounded);
                      }}
                      onChange={(e) => {
                        const value = e.target.value.replace(',', '.');
                        if (value === '' || /^\d*\.?\d*$/.test(value)) {
                          setPaidAmountInput(value);
                          const parsed = parseFloat(value) || 0;
                          setPaidAmount(Math.round(parsed * 1000) / 1000);
                        }
                      }}
                      placeholder="0.000"
                    />
                  </div>

                  {/* Reste à payer / Dette */}
                  <div className="p-3 bg-white border border-slate-150 rounded-2xl flex items-center justify-between">
                    <span className="text-[11px] sm:text-xs font-black text-slate-500 uppercase tracking-wider">Reste à payer</span>
                    <span className={cn(
                      "font-mono font-black text-sm",
                      remainingDebt > 0 ? "text-red-750" : "text-emerald-700"
                    )}>
                      {remainingDebt.toFixed(3)} {storeSettings?.currency || 'DT'}
                    </span>
                  </div>

                  {/* Warning de paiement pour client passager */}
                  {!selectedClient && Math.abs(paidAmount - cartTotal) > 0.001 && (
                    <div className="text-[11px] text-red-700 font-semibold bg-red-50 border border-red-100 rounded-xl p-3 flex items-center gap-1.5 animate-in fade-in duration-200">
                      <AlertCircle className="w-4 h-4 shrink-0 text-red-500" />
                      <span>Le paiement pour un client passager doit correspondre exactement au montant total ({cartTotal.toFixed(3)} {storeSettings?.currency || 'DT'}).</span>
                    </div>
                  )}

                  {error && (
                    <div className="p-3 bg-red-50 rounded-xl border border-red-100 flex items-center gap-2 text-red-700">
                      <AlertCircle className="w-4 h-4 shrink-0" />
                      <span className="text-xs font-bold">{error}</span>
                      {!cashSession && !cashSessionLoading && <button type="button" onClick={() => navigate('/cash-session')} className="ml-auto rounded-lg bg-red-700 px-3 py-2 text-xs font-black text-white">Ouvrir la caisse</button>}
                    </div>
                  )}

                  <button
                    onClick={validateSale}
                    disabled={isProcessing || cart.length === 0}
                    className={cn(
                      "w-full py-4 rounded-2xl font-bold transition-all flex items-center justify-center gap-2 shadow-lg",
                      isProcessing || cart.length === 0
                        ? "bg-gray-200 text-gray-400 cursor-not-allowed"
                        : "bg-green-700 text-white hover:bg-green-800 shadow-green-700/20"
                    )}
                  >
                    {isProcessing ? (
                      <div className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    ) : (
                      <>
                        <CheckCircle2 className="w-5 h-5" />
                        Valider la Facture
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Success Toast */}
      {saleSuccess && (
        <div className="fixed bottom-8 right-8 z-[100] animate-in fade-in slide-in-from-bottom-4 duration-300">
          <div className="bg-green-900 text-white px-6 py-4 rounded-2xl shadow-2xl flex items-center gap-3 border border-green-800">
            <div className="bg-green-800 p-1.5 rounded-lg">
              <CheckCircle2 className="w-5 h-5" />
            </div>
            <span className="font-bold">{saleSuccess}</span>
          </div>
        </div>
      )}

      {/* Invoice Detail Modal */}
      {selectedInvoice && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-2 sm:p-4 bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl overflow-hidden border border-green-800 flex flex-col max-h-[92vh] sm:max-h-[90vh]">
            <div className="px-5 py-4 sm:px-8 sm:py-6 border-b border-green-800 flex items-center justify-between bg-gray-50/50">
              <div>
                <h2 className="text-base sm:text-lg font-black text-gray-900">Facture {selectedInvoice.number}</h2>
                <p className="text-[10px] text-gray-500 font-mono uppercase tracking-widest mt-1">Date: {selectedInvoice.date?.toDate ? format(selectedInvoice.date.toDate(), 'PPP p', { locale: fr }) : 'Inconnue'}</p>
              </div>
              <button onClick={() => setSelectedInvoice(null)} className="p-2 text-gray-400 hover:text-gray-600 rounded-lg">
                <X className="w-5 h-5 sm:w-6 sm:h-6" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 sm:p-8 space-y-5 sm:space-y-8">
              <div className="grid grid-cols-2 gap-4 sm:gap-8">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest block">Client</label>
                  <div className="text-gray-900 font-extrabold text-xs sm:text-sm">{selectedInvoice.clientName}</div>
                  {selectedInvoice.clientCode && <div className="text-[10px] text-gray-500 font-mono">Code: {selectedInvoice.clientCode}</div>}
                  {selectedInvoice.clientPhone && <div className="text-[10px] text-gray-500">{selectedInvoice.clientPhone}</div>}
                  {selectedInvoice.clientAddress && <div className="text-[10px] text-gray-500 italic truncate max-w-[120px] sm:max-w-none">{selectedInvoice.clientAddress}</div>}
                </div>
                <div className="space-y-1 text-right">
                  <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest block">Magasin</label>
                  <div className="text-gray-900 font-bold text-xs sm:text-sm text-green-700">{storeSettings?.storeName || APP_NAME}</div>
                  <div className="text-[10px] text-gray-500">{storeSettings?.address || 'Tunisie'}</div>
                  {storeSettings?.phone && <div className="text-[10px] text-gray-500">{storeSettings.phone}</div>}
                </div>
              </div>

              <div className="space-y-4">
                <div className="bg-gray-50 rounded-2xl border border-green-800 overflow-x-auto">
                  <table className="w-full text-left border-collapse min-w-[380px] sm:min-w-0">
                    <thead>
                      <tr className="text-[10px] font-bold text-gray-400 uppercase tracking-widest border-b border-green-800">
                        <th className="px-4 py-2.5 sm:px-6 sm:py-3">Produit</th>
                        <th className="px-4 py-2.5 sm:px-6 sm:py-3 text-center">Qté</th>
                        <th className="px-4 py-2.5 sm:px-6 sm:py-3 text-right">Prix</th>
                        <th className="px-4 py-2.5 sm:px-6 sm:py-3 text-right">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-green-800/40">
                      {selectedInvoice.items.map((item, idx) => (
                        <tr key={idx} className="text-xs sm:text-sm">
                          <td className="px-4 py-2.5 sm:px-6 sm:py-3 font-bold text-gray-900">{item.name}</td>
                          <td className="px-4 py-2.5 sm:px-6 sm:py-3 text-center font-mono">{item.quantity}</td>
                          <td className="px-4 py-2.5 sm:px-6 sm:py-3 text-right font-mono">{item.price.toFixed(3)}</td>
                          <td className="px-4 py-2.5 sm:px-6 sm:py-3 text-right font-black text-green-700 font-mono">{item.total.toFixed(3)} {storeSettings?.currency || 'DT'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="bg-gray-900 text-white p-5 sm:p-8 rounded-3xl space-y-3 sm:space-y-4 shadow-xl shadow-gray-900/20">
                {selectedInvoice.tvaEnabled === true && selectedInvoice.tva > 0 && (
                  <div className="flex justify-between items-center opacity-70">
                    <span className="text-xs uppercase tracking-widest font-bold">Sous-total</span>
                    <span className="font-mono text-xs sm:text-sm">{(selectedInvoice.subtotal ?? selectedInvoice.total - selectedInvoice.tva).toFixed(3)} {storeSettings?.currency || 'DT'}</span>
                  </div>
                )}
                {selectedInvoice.tvaEnabled === true && selectedInvoice.tva > 0 && (
                  <div className="flex justify-between items-center opacity-70">
                    <span className="text-xs uppercase tracking-widest font-bold">TVA ({storeSettings?.tva || 0}%)</span>
                    <span className="font-mono text-xs sm:text-sm">{selectedInvoice.tva.toFixed(3)} {storeSettings?.currency || 'DT'}</span>
                  </div>
                )}
                <div className="flex justify-between items-center pt-2 border-t border-white/10">
                  <span className="text-xs uppercase tracking-widest font-bold">Total Général</span>
                  <span className="text-base sm:text-2xl font-black font-mono text-green-400">{selectedInvoice.total.toFixed(3)} {storeSettings?.currency || 'DT'}</span>
                </div>
                <div className="flex justify-between items-center opacity-70">
                  <span className="text-xs uppercase tracking-widest font-bold">Payé</span>
                  <span className="font-mono text-xs sm:text-sm">{selectedInvoice.paid.toFixed(3)} {storeSettings?.currency || 'DT'}</span>
                </div>
                {selectedInvoice.debt > 0 && (
                  <div className="flex justify-between items-center text-red-400 pt-2 border-t border-white/10">
                    <span className="text-xs uppercase tracking-widest font-bold">Reste à payer</span>
                    <span className="text-base sm:text-xl font-black font-mono">{selectedInvoice.debt.toFixed(3)} {storeSettings?.currency || 'DT'}</span>
                  </div>
                )}
              </div>
            </div>

            <div className="p-4 sm:p-8 border-t border-green-800 bg-gray-50/50 flex flex-col sm:flex-row gap-3 sm:gap-4">
              <button 
                onClick={() => downloadPDF(selectedInvoice)}
                className="flex-1 py-3.5 sm:py-4 bg-green-700 text-white font-extrabold rounded-2xl hover:bg-green-800 transition-all flex items-center justify-center gap-2 shadow-lg shadow-green-700/20 text-xs sm:text-sm cursor-pointer"
              >
                <Download className="w-4 h-4 sm:w-5 sm:h-5 font-black" />
                Télécharger PDF
              </button>
              <button 
                onClick={handlePrint}
                className="flex-1 py-3.5 sm:py-4 bg-white border border-green-800 text-gray-900 font-extrabold rounded-2xl hover:bg-gray-100 transition-all flex items-center justify-center gap-2 text-xs sm:text-sm cursor-pointer"
              >
                <Printer className="w-4 h-4 sm:w-5 sm:h-5 font-black" />
                Imprimer Ticket
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
