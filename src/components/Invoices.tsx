import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { collection, onSnapshot, query, orderBy, limit, doc, runTransaction, serverTimestamp } from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';
import { db, auth } from '../firebase';
import { Invoice, Product, Client, SaleItem, StoreSettings, UserProfile } from '../types';
import { handleFirestoreError, OperationType } from '../App';
import { Search, FileText, Eye, X, Printer, Download, User, Calendar, ShoppingBag, Plus, Trash2, Minus, AlertCircle, CheckCircle2 } from 'lucide-react';
import { format } from 'date-fns';
import { APP_NAME } from '../config/brand';
import { fr } from 'date-fns/locale';
import { cn } from '../lib/utils';
import { PrintableTicket } from './PrintableTicket';
import { where } from 'firebase/firestore';

interface InvoicesProps {
  userProfile: UserProfile | null;
}

export default function Invoices({ userProfile }: InvoicesProps) {
  const navigate = useNavigate();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [storeSettings, setStoreSettings] = useState<StoreSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [isNewInvoiceModalOpen, setIsNewInvoiceModalOpen] = useState(false);
  const [productSearch, setProductSearch] = useState('');

  const ownerId = (userProfile?.role === 'admin' ? userProfile?.uid : userProfile?.ownerId) || userProfile?.uid || auth.currentUser?.uid;
  
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
        setStoreSettings(snapshot.data() as StoreSettings);
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, `settings/${ownerId}`);
    });

    return () => {
      unsubscribe();
      unsubscribeSettings();
    };
  }, [ownerId]);

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

  const subtotal = useMemo(() => {
    const rawSum = cart.reduce((sum, item) => sum + item.total, 0);
    return Math.round(rawSum * 1000) / 1000;
  }, [cart]);
  const tvaRate = storeSettings?.tvaEnabled !== false ? (storeSettings?.tva || 19) / 100 : 0;
  const tvaAmount = Math.round(subtotal * tvaRate * 1000) / 1000;
  const cartTotal = Math.round((subtotal + tvaAmount) * 1000) / 1000;

  useEffect(() => {
    setPaidAmount(cartTotal);
  }, [selectedClient, cartTotal]);

  const remainingDebt = Math.round(Math.max(0, cartTotal - paidAmount) * 1000) / 1000;

  const filteredProducts = useMemo(() => 
    products.filter(p => 
      p.name.toLowerCase().includes(productSearch.toLowerCase()) ||
      (p.barcode && p.barcode.toLowerCase().includes(productSearch.toLowerCase()))
    ), [products, productSearch]
  );

  const validateSale = async () => {
    if (cart.length === 0) return;
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

        for (const update of stockUpdates) {
          transaction.update(update.ref, { stock: update.newStock });
        }

        if (clientUpdate) {
          transaction.update(clientUpdate.ref, { debt: clientUpdate.newDebt });
        }

        const saleRef = doc(collection(db, 'sales'));
        const invoiceRef = doc(collection(db, 'invoices'));

        const saleData = {
          date: serverTimestamp(),
          clientId: selectedClient?.id || null,
          clientCode: selectedClient?.code || '',
          clientName: selectedClient?.name || 'Client de passage',
          total: cartTotal,
          paid: paidAmount,
          debt: remainingDebt,
          tva: tvaAmount,
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
          paid: paidAmount,
          debt: remainingDebt,
          tva: tvaAmount,
          date: serverTimestamp(),
          items: cart,
          ownerId,
          userId: userProfile?.uid || ownerId
        };

        transaction.set(saleRef, saleData);
        transaction.set(invoiceRef, invoiceData);
      });

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

  const downloadPDF = async (invoice: Invoice) => {
    try {
      const currentUser = auth.currentUser;
      if (!currentUser) throw new Error('Session invalide. Veuillez vous reconnecter.');
      const idToken = await currentUser.getIdToken();
      const response = await fetch('/api/invoices/pdf', {
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

  const filteredInvoices = invoices.filter(inv => 
    inv.number.toLowerCase().includes(searchTerm.toLowerCase()) ||
    inv.clientName.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (inv.clientCode && inv.clientCode.toLowerCase().includes(searchTerm.toLowerCase()))
  );

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
          <h1 className="text-3xl font-extrabold text-slate-800 tracking-tight">Factures</h1>
          <p className="text-xs text-slate-400 font-medium uppercase tracking-wider mt-0.5">Gérez et téléchargez vos factures de vente</p>
        </div>
        <button
          onClick={() => setIsNewInvoiceModalOpen(true)}
          className="inline-flex items-center justify-center gap-2 px-5 py-3 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black uppercase tracking-wider rounded-xl transition-all duration-350 shadow-lg shadow-emerald-600/15 group hover:-translate-y-0.5"
        >
          <Plus className="w-4 h-4 transition-transform group-hover:rotate-90 duration-300" />
          Nouvelle Facture
        </button>
      </div>

      <div className="bg-white rounded-3xl border border-slate-100 shadow-xs overflow-hidden premium-shadow">
        <div className="p-5 border-b border-slate-100 bg-slate-50/20">
          <div className="relative max-w-md">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4.5 h-4.5 text-slate-400" />
            <input
              type="text"
              placeholder="Rechercher par numéro ou client..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-11 pr-4 py-2.5 bg-slate-50 border border-slate-100 rounded-xl focus:bg-white text-xs font-semibold text-slate-700 placeholder-slate-400 focus:ring-2 focus:ring-emerald-500/10 focus:border-emerald-500 outline-none transition-all duration-300"
            />
          </div>
        </div>

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
      </div>

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
                    {storeSettings?.tvaEnabled !== false && (
                      <div className="flex justify-between text-xs sm:text-sm">
                        <span className="text-gray-500 font-semibold">Sous-total</span>
                        <span className="font-mono font-bold">{subtotal.toFixed(3)} {storeSettings?.currency || 'DT'}</span>
                      </div>
                    )}
                    {storeSettings?.tvaEnabled !== false && (
                      <div className="flex justify-between text-xs sm:text-sm">
                        <span className="text-gray-500 font-semibold">TVA ({storeSettings?.tva || 19}%)</span>
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
                {selectedInvoice.tva > 0 && (
                  <div className="flex justify-between items-center opacity-70">
                    <span className="text-xs uppercase tracking-widest font-bold">Sous-total</span>
                    <span className="font-mono text-xs sm:text-sm">{(selectedInvoice.total - selectedInvoice.tva).toFixed(3)} {storeSettings?.currency || 'DT'}</span>
                  </div>
                )}
                {selectedInvoice.tva > 0 && (
                  <div className="flex justify-between items-center opacity-70">
                    <span className="text-xs uppercase tracking-widest font-bold">TVA ({storeSettings?.tva || 19}%)</span>
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
