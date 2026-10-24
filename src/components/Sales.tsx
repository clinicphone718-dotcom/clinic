import { useState, useEffect } from 'react';
import { collection, onSnapshot, query, orderBy, limit, doc, getDoc, where, deleteDoc, setDoc, updateDoc, runTransaction, writeBatch, serverTimestamp } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { Sale, Invoice, UserProfile, Product } from '../types';
import { handleFirestoreError, OperationType } from '../App';
import { Search, Calendar, User, ShoppingBag, Eye, X, Printer, Download, TrendingUp, Receipt, AlertCircle, CheckCircle2, Clock, Trash2, Shield, EyeOff, Package } from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { cn } from '../lib/utils';
import { addPendingOperation } from '../lib/offlineManager';

interface SalesProps {
  userProfile: UserProfile | null;
}

export default function Sales({ userProfile }: SalesProps) {
  const [sales, setSales] = useState<Sale[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [productCode, setProductCode] = useState('');
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedSale, setSelectedSale] = useState<Sale | null>(null);
  const [filterStatus, setFilterStatus] = useState<'all' | 'paid' | 'partial'>('all');

  // Deletion states
  const [saleToDelete, setSaleToDelete] = useState<Sale | null>(null);
  const [showSecurityModal, setShowSecurityModal] = useState(false);
  const [securityCode, setSecurityCode] = useState('');
  const [securityError, setSecurityError] = useState(false);
  const [showSecurityInput, setShowSecurityInput] = useState(false);
  const [pendingDeleteSale, setPendingDeleteSale] = useState<Sale | null>(null);
  const [deleting, setDeleting] = useState(false);

  const ownerId = userProfile?.ownerId || userProfile?.uid || 'no_user_auth';

  const handleDeleteConfirm = async () => {
    if (!saleToDelete) return;
    setDeleting(true);
    
    const isOffline = !navigator.onLine;
    const userEmail = userProfile?.email || 'unknown';
    const userName = userProfile?.name || 'unknown';

    try {
      if (isOffline) {
        // --- OFFLINE DELETE FLOW ---
        // 1. Revert stock locally
        for (const item of saleToDelete.items) {
          const productRef = doc(db, 'products', item.productId);
          const productSnap = await getDoc(productRef);
          if (productSnap.exists()) {
            const currentStock = productSnap.data().stock || 0;
            await updateDoc(productRef, { stock: currentStock + item.quantity });
          }
        }

        // 2. Revert client debt locally
        if (saleToDelete.clientId && saleToDelete.debt > 0) {
          const clientRef = doc(db, 'clients', saleToDelete.clientId);
          const clientSnap = await getDoc(clientRef);
          if (clientSnap.exists()) {
            const currentDebt = clientSnap.data().debt || 0;
            await updateDoc(clientRef, { debt: Math.max(0, currentDebt - saleToDelete.debt) });
          }
        }

        // 3. Delete invoice locally
        let invoiceNumber = 'N/A';
        if (saleToDelete.invoiceId) {
          const invoiceRef = doc(db, 'invoices', saleToDelete.invoiceId);
          const invoiceSnap = await getDoc(invoiceRef);
          if (invoiceSnap.exists()) {
            invoiceNumber = invoiceSnap.data().number || 'N/A';
          }
          await deleteDoc(doc(db, 'invoices', saleToDelete.invoiceId));
        }

        // 4. Create Audit Log locally (optionnel — ne bloque pas la suppression)
        try {
          const logRef = doc(collection(db, 'audit_logs'));
          await setDoc(logRef, {
            action: 'DELETE_SALE',
            userEmail,
            userName,
            timestamp: new Date().toISOString(),
            ticketId: saleToDelete.id,
            invoiceId: saleToDelete.invoiceId || 'N/A',
            invoiceNumber,
            total: saleToDelete.total,
            ownerId,
            userId: userProfile?.uid || ownerId
          });
        } catch (logErr) {
          console.warn('[AUDIT LOG OFFLINE] Failed:', logErr);
        }

        // 5. Delete sale locally
        await deleteDoc(doc(db, 'sales', saleToDelete.id));

        // 6. Queue offline sync
        addPendingOperation('DELETE_SALE', {
          saleId: saleToDelete.id,
          userEmail,
          userName
        });

        console.log('[SALES OFFLINE] Sale deleted and queued successfully!');

      } else {
        // --- ONLINE DELETE FLOW ---
        // writeBatch : atomique mais sans les contraintes read-before-write de runTransaction

        // ── PHASE 1 : READS ──────────────────────────────────────────────
        const saleRef = doc(db, 'sales', saleToDelete.id);
        const saleSnap = await getDoc(saleRef);
        if (!saleSnap.exists()) throw new Error("Cette vente n'existe plus.");

        // Lire les stocks actuels
        const productData: { ref: ReturnType<typeof doc>, newStock: number }[] = [];
        for (const item of saleToDelete.items) {
          try {
            const productRef = doc(db, 'products', item.productId);
            const productSnap = await getDoc(productRef);
            if (productSnap.exists()) {
              const currentStock = productSnap.data().stock || 0;
              productData.push({ ref: productRef, newStock: currentStock + item.quantity });
            }
          } catch (e) { console.warn('stock read failed:', e); }
        }

        // Lire la dette client
        let clientRef = null;
        let newDebt = 0;
        if (saleToDelete.clientId && saleToDelete.debt > 0) {
          try {
            clientRef = doc(db, 'clients', saleToDelete.clientId);
            const clientSnap = await getDoc(clientRef);
            if (clientSnap.exists()) {
              const currentDebt = clientSnap.data().debt || 0;
              newDebt = Math.max(0, currentDebt - saleToDelete.debt);
            }
          } catch (e) { console.warn('client debt read failed:', e); clientRef = null; }
        }

        // Lire la facture
        let invoiceRef = null;
        let invoiceNumber = 'N/A';
        if (saleToDelete.invoiceId) {
          try {
            invoiceRef = doc(db, 'invoices', saleToDelete.invoiceId);
            const invoiceSnap = await getDoc(invoiceRef);
            if (invoiceSnap.exists()) {
              invoiceNumber = invoiceSnap.data().number || 'N/A';
            }
          } catch (e) { console.warn('invoice read failed:', e); invoiceRef = null; }
        }

        // ── PHASE 2 : WRITES séquentiels ────────────────────────────────

        // Restaurer stocks (updateDoc simple, pas de batch)
        for (const { ref, newStock } of productData) {
          try { await updateDoc(ref, { stock: newStock }); } catch (e) { console.warn('stock update failed:', e); }
        }

        // Restaurer dette client
        if (clientRef) {
          try { await updateDoc(clientRef, { debt: newDebt }); } catch (e) { console.warn('debt update failed:', e); }
        }

        // Supprimer facture
        if (invoiceRef) {
          try { await deleteDoc(invoiceRef); } catch (e) { console.warn('invoice delete failed:', e); }
        }

        // Supprimer la vente (opération principale)
        await deleteDoc(saleRef);

        // Log d'audit (optionnel)
        try {
          const logRef = doc(collection(db, 'audit_logs'));
          await setDoc(logRef, {
            action: 'DELETE_SALE',
            userEmail,
            userName,
            timestamp: new Date().toISOString(),
            ticketId: saleToDelete.id,
            invoiceId: saleToDelete.invoiceId || 'N/A',
            invoiceNumber,
            total: saleToDelete.total,
            ownerId,
            userId: userProfile?.uid || ownerId
          });
        } catch (logErr) {
          console.warn('[AUDIT LOG] Failed:', logErr);
        }
      }

      setSaleToDelete(null);
    } catch (err: any) {
      console.error("Failed to delete sale:", err);
      alert("Erreur lors de la suppression de la vente: " + err.message);
    } finally {
      setDeleting(false);
    }
  };

  const downloadPDF = async (sale: Sale) => {
    try {
      if (!sale.invoiceId) {
        alert("Aucune facture associée à cette vente.");
        return;
      }
      const invoiceSnap = await getDoc(doc(db, 'invoices', sale.invoiceId));
      if (!invoiceSnap.exists()) {
        alert("Facture introuvable.");
        return;
      }
      const invoice = { id: invoiceSnap.id, ...invoiceSnap.data() } as Invoice;
      const currentUser = auth.currentUser;
      if (!currentUser) throw new Error('Session invalide. Veuillez vous reconnecter.');
      const [idToken, settingsSnap] = await Promise.all([
        currentUser.getIdToken(),
        getDoc(doc(db, 'settings', ownerId))
      ]);
      const storeSettings = settingsSnap.exists() ? settingsSnap.data() : {};
      const response = await fetch('/api/invoices/pdf', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`
        },
        body: JSON.stringify({
          ...invoice,
          storeName: storeSettings.storeName,
          address: storeSettings.address,
          phone: storeSettings.phone,
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

  useEffect(() => {
    if (!auth.currentUser || !userProfile) return;
    const tenantOwnerId = userProfile.ownerId || userProfile.uid;
    const q = query(collection(db, 'sales'), where('ownerId', '==', tenantOwnerId));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const sls = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Sale));
      sls.sort((a, b) => {
        const timeA = a.date?.seconds || 0;
        const timeB = b.date?.seconds || 0;
        return timeB - timeA;
      });
      setSales(sls);
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'sales');
      setLoading(false);
    });
    return unsubscribe;
  }, [userProfile]);

  // Charge les produits pour permettre la recherche d'historique par code produit (code-barres / ID / nom)
  useEffect(() => {
    if (!auth.currentUser || !userProfile) return;
    const tenantOwnerId = userProfile.ownerId || userProfile.uid;
    const q = query(collection(db, 'products'), where('ownerId', '==', tenantOwnerId));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setProducts(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Product)));
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'products');
    });
    return unsubscribe;
  }, [userProfile]);

  // Résout le code saisi (code-barres, ID ou nom) vers les identifiants de produits correspondants
  const matchedProductIds = (() => {
    const code = productCode.trim().toLowerCase();
    if (!code) return null;
    const ids = new Set<string>();
    products.forEach(p => {
      if (
        (p.barcode && p.barcode.toLowerCase() === code) ||
        p.id.toLowerCase() === code ||
        p.name.toLowerCase().includes(code)
      ) {
        ids.add(p.id);
      }
    });
    return ids;
  })();

  const filteredSales = sales.filter(s => {
    const matchSearch =
      s.clientName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      s.id.toLowerCase().includes(searchTerm.toLowerCase());
    const matchFilter =
      filterStatus === 'all' ||
      (filterStatus === 'paid' && s.debt === 0) ||
      (filterStatus === 'partial' && s.debt > 0);
    // Filtre par code produit : ne garde que les ventes contenant l'article recherché
    const code = productCode.trim().toLowerCase();
    const matchProduct =
      !code ||
      (s.items || []).some(item =>
        (matchedProductIds && matchedProductIds.has(item.productId)) ||
        item.productId?.toLowerCase() === code ||
        item.name?.toLowerCase().includes(code)
      );
    return matchSearch && matchFilter && matchProduct;
  });

  // Stats
  const totalRevenue = sales.reduce((sum, s) => sum + s.paid, 0);
  const totalDebt = sales.reduce((sum, s) => sum + s.debt, 0);
  const paidCount = sales.filter(s => s.debt === 0).length;

  return (
    <div className="space-y-6 font-sans">

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-indigo-500 mb-1">Boutique</p>
          <h1 className="text-3xl font-black text-slate-900 tracking-tight leading-none">Historique des ventes</h1>
          <p className="text-xs text-slate-400 font-medium mt-1.5">{sales.length} transaction{sales.length > 1 ? 's' : ''} enregistrée{sales.length > 1 ? 's' : ''}</p>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* Chiffre encaissé */}
        <div className="bg-gradient-to-br from-indigo-600 to-indigo-500 rounded-2xl p-5 text-white shadow-lg shadow-indigo-600/20 relative overflow-hidden">
          <div className="absolute -top-4 -right-4 w-24 h-24 bg-white/5 rounded-full" />
          <div className="absolute -bottom-6 -right-2 w-16 h-16 bg-white/5 rounded-full" />
          <div className="relative z-10">
            <div className="flex items-center justify-between mb-3">
              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-indigo-200">Encaissé</p>
              <div className="w-8 h-8 bg-white/15 rounded-xl flex items-center justify-center">
                <TrendingUp className="w-4 h-4 text-white" />
              </div>
            </div>
            <p className="text-2xl font-black font-mono tracking-tight">{totalRevenue.toFixed(3)}<span className="text-sm font-bold text-indigo-200 ml-1">DT</span></p>
          </div>
        </div>

        {/* Ventes payées */}
        <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-xs premium-shadow">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Payées</p>
            <div className="w-8 h-8 bg-emerald-50 rounded-xl flex items-center justify-center">
              <CheckCircle2 className="w-4 h-4 text-emerald-500" />
            </div>
          </div>
          <p className="text-2xl font-black text-slate-900 font-mono">{paidCount}<span className="text-sm font-bold text-slate-400 ml-1">/ {sales.length}</span></p>
          <div className="mt-3 h-1.5 bg-slate-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-emerald-500 rounded-full transition-all duration-700"
              style={{ width: sales.length ? `${(paidCount / sales.length) * 100}%` : '0%' }}
            />
          </div>
        </div>

        {/* Dettes */}
        <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-xs premium-shadow">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Dettes</p>
            <div className="w-8 h-8 bg-rose-50 rounded-xl flex items-center justify-center">
              <AlertCircle className="w-4 h-4 text-rose-500" />
            </div>
          </div>
          <p className="text-2xl font-black text-slate-900 font-mono">{totalDebt.toFixed(3)}<span className="text-sm font-bold text-slate-400 ml-1">DT</span></p>
          <p className="text-[10px] text-rose-400 font-bold mt-1">{sales.filter(s => s.debt > 0).length} vente{sales.filter(s => s.debt > 0).length > 1 ? 's' : ''} en attente</p>
        </div>
      </div>

      {/* Recherche par code produit — affiche l'historique des ventes d'un article */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-xs premium-shadow p-5">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
          <div className="w-full sm:max-w-md">
            <label className="text-[10px] font-black uppercase tracking-[0.18em] text-indigo-500 mb-1.5 flex items-center gap-1.5">
              <Package className="w-3.5 h-3.5" />
              Historique par code produit
            </label>
            <div className="relative">
              <Package className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                name="product-code-search"
                placeholder="Code-barres, ID ou nom du produit…"
                value={productCode}
                onChange={(e) => setProductCode(e.target.value)}
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                className="w-full pl-10 pr-10 py-2.5 bg-slate-50 border border-slate-100 rounded-xl text-xs font-semibold text-slate-700 placeholder-slate-400 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 outline-none transition-all"
              />
              {productCode && (
                <button
                  onClick={() => setProductCode('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
          {productCode.trim() && (
            <div className="text-xs font-bold text-slate-500 shrink-0 bg-indigo-50 text-indigo-600 px-3 py-2 rounded-xl">
              {filteredSales.length} vente{filteredSales.length > 1 ? 's' : ''} trouvée{filteredSales.length > 1 ? 's' : ''}
            </div>
          )}
        </div>
      </div>

      {/* Table Card */}
      <div className="bg-white rounded-3xl border border-slate-100 shadow-xs overflow-hidden premium-shadow">
        {/* Toolbar */}
        <div className="p-5 border-b border-slate-100 flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
          <div className="relative w-full sm:max-w-xs">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              name="sales-search"
              placeholder="Client ou ID…"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-100 rounded-xl text-xs font-semibold text-slate-700 placeholder-slate-400 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 outline-none transition-all"
            />
          </div>

          {/* Filter pills */}
          <div className="flex items-center gap-2">
            {(['all', 'paid', 'partial'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilterStatus(f)}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all",
                  filterStatus === f
                    ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/20"
                    : "bg-slate-50 text-slate-500 hover:bg-slate-100"
                )}
              >
                {f === 'all' ? 'Tout' : f === 'paid' ? '✓ Payé' : '⚠ Partiel'}
              </button>
            ))}
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-slate-50/60 border-b border-slate-100">
                <th className="px-6 py-3.5 text-[10px] font-black uppercase tracking-[0.15em] text-slate-400">Date</th>
                <th className="px-6 py-3.5 text-[10px] font-black uppercase tracking-[0.15em] text-slate-400">Client</th>
                <th className="px-6 py-3.5 text-[10px] font-black uppercase tracking-[0.15em] text-slate-400">Total</th>
                <th className="px-6 py-3.5 text-[10px] font-black uppercase tracking-[0.15em] text-slate-400">Statut</th>
                <th className="px-6 py-3.5 text-[10px] font-black uppercase tracking-[0.15em] text-slate-400 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {loading ? (
                // Skeleton rows
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 5 }).map((_, j) => (
                      <td key={j} className="px-6 py-4">
                        <div className="h-3 bg-slate-100 rounded-full animate-pulse" style={{ width: `${60 + Math.random() * 30}%` }} />
                      </td>
                    ))}
                  </tr>
                ))
              ) : filteredSales.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-16 text-center">
                    <Receipt className="w-10 h-10 text-slate-200 mx-auto mb-3" />
                    <p className="text-sm font-bold text-slate-400">Aucune vente trouvée</p>
                    <p className="text-xs text-slate-300 mt-1">Essayez un autre terme de recherche</p>
                  </td>
                </tr>
              ) : (
                filteredSales.map((sale) => (
                  <tr
                    key={sale.id}
                    className="hover:bg-indigo-50/30 transition-colors group cursor-pointer"
                    onClick={() => setSelectedSale(sale)}
                  >
                    <td className="px-6 py-4">
                      <div className="text-sm font-bold text-slate-800">
                        {sale.date?.toDate ? format(sale.date.toDate(), 'dd MMM yyyy', { locale: fr }) : '—'}
                      </div>
                      <div className="flex items-center gap-1 mt-0.5">
                        <Clock className="w-3 h-3 text-slate-300" />
                        <span className="text-[10px] text-slate-400 font-mono">
                          {sale.date?.toDate ? format(sale.date.toDate(), 'HH:mm') : '—'}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-100 to-cyan-100 flex items-center justify-center text-[10px] font-black text-indigo-600 shrink-0">
                          {sale.clientName?.[0]?.toUpperCase() || '?'}
                        </div>
                        <span className="text-sm font-bold text-slate-700">{sale.clientName || 'Client inconnu'}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-sm font-black text-slate-900 font-mono">{sale.total.toFixed(3)}</span>
                      <span className="text-[10px] text-slate-400 font-bold ml-1">DT</span>
                    </td>
                    <td className="px-6 py-4">
                      {sale.debt > 0 ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-black bg-rose-50 text-rose-600 border border-rose-100">
                          <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" />
                          -{sale.debt.toFixed(3)} DT
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-black bg-emerald-50 text-emerald-600 border border-emerald-100">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                          Payé
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={(e) => { e.stopPropagation(); setSelectedSale(sale); }}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-lg transition-colors"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          Voir
                        </button>

                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            const code = userProfile?.securityCode;
                            if (code && code.length === 4) {
                              setPendingDeleteSale(sale);
                              setSecurityCode('');
                              setSecurityError(false);
                              setShowSecurityInput(false);
                              setShowSecurityModal(true);
                            } else {
                              setSaleToDelete(sale);
                            }
                          }}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-red-600 bg-red-50 hover:bg-red-100 rounded-lg transition-colors border border-red-100"
                          title="Supprimer cette vente"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          Supprimer
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Footer count */}
        {!loading && filteredSales.length > 0 && (
          <div className="px-6 py-3 border-t border-slate-50 bg-slate-50/30">
            <p className="text-[10px] font-bold text-slate-400">{filteredSales.length} résultat{filteredSales.length > 1 ? 's' : ''}</p>
          </div>
        )}
      </div>

      {/* Sale Detail Modal */}
      {selectedSale && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
          <div
            className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl overflow-hidden border border-slate-100 flex flex-col max-h-[90vh]"
            style={{ animation: 'modalIn 0.2s cubic-bezier(0.34,1.56,0.64,1)' }}
          >
            {/* Modal Header */}
            <div className="px-8 py-5 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-indigo-600 to-cyan-500 flex items-center justify-center shadow-md shadow-indigo-600/20">
                  <Receipt className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h2 className="text-base font-black text-slate-900 leading-none">Détails de la vente</h2>
                  <p className="text-[10px] text-slate-400 font-mono uppercase tracking-wider mt-0.5">{selectedSale.id.slice(0, 12)}…</p>
                </div>
              </div>
              <button
                onClick={() => setSelectedSale(null)}
                className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-8 space-y-6">
              {/* Client + Date */}
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-slate-50 rounded-2xl p-4 border border-slate-100">
                  <p className="text-[10px] font-black uppercase tracking-[0.15em] text-slate-400 mb-2">Client</p>
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-indigo-100 to-cyan-100 flex items-center justify-center text-xs font-black text-indigo-600">
                      {selectedSale.clientName?.[0]?.toUpperCase() || '?'}
                    </div>
                    <span className="font-black text-slate-800 text-sm">{selectedSale.clientName}</span>
                  </div>
                </div>
                <div className="bg-slate-50 rounded-2xl p-4 border border-slate-100">
                  <p className="text-[10px] font-black uppercase tracking-[0.15em] text-slate-400 mb-2">Date & heure</p>
                  <div className="flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-indigo-500 shrink-0" />
                    <span className="font-bold text-slate-800 text-sm">
                      {selectedSale.date?.toDate ? format(selectedSale.date.toDate(), 'PPP p', { locale: fr }) : 'Inconnue'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Items Table */}
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.15em] text-slate-400 mb-3 flex items-center gap-2">
                  <ShoppingBag className="w-3.5 h-3.5" /> Articles vendus
                </p>
                <div className="rounded-2xl border border-slate-100 overflow-hidden">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-100">
                        <th className="px-5 py-3 text-[10px] font-black uppercase tracking-wider text-slate-400">Produit</th>
                        <th className="px-5 py-3 text-[10px] font-black uppercase tracking-wider text-slate-400 text-center">Qté</th>
                        <th className="px-5 py-3 text-[10px] font-black uppercase tracking-wider text-slate-400 text-right">P.U</th>
                        <th className="px-5 py-3 text-[10px] font-black uppercase tracking-wider text-slate-400 text-right">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {selectedSale.items.map((item, idx) => (
                        <tr key={idx} className="hover:bg-slate-50/50 transition-colors">
                          <td className="px-5 py-3 text-sm font-bold text-slate-800">{item.name}</td>
                          <td className="px-5 py-3 text-center">
                            <span className="inline-flex items-center justify-center w-7 h-7 bg-indigo-50 text-indigo-700 text-xs font-black rounded-lg">{item.quantity}</span>
                          </td>
                          <td className="px-5 py-3 text-right text-xs font-mono text-slate-500">{item.price.toFixed(3)}</td>
                          <td className="px-5 py-3 text-right text-sm font-black text-indigo-600 font-mono">{item.total.toFixed(3)} DT</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Summary */}
              <div className="bg-slate-900 rounded-2xl p-6 text-white space-y-3">
                <div className="flex justify-between items-center text-slate-400 text-sm">
                  <span className="font-bold uppercase tracking-wider text-xs">Total vente</span>
                  <span className="font-mono">{selectedSale.total.toFixed(3)} DT</span>
                </div>
                <div className="flex justify-between items-center border-t border-white/10 pt-3">
                  <span className="font-black uppercase tracking-wider text-xs">Montant payé</span>
                  <span className="text-xl font-black font-mono text-emerald-400">{selectedSale.paid.toFixed(3)} DT</span>
                </div>
                {selectedSale.debt > 0 && (
                  <div className="flex justify-between items-center border-t border-white/10 pt-3">
                    <span className="font-black uppercase tracking-wider text-xs text-rose-400">Reste à payer</span>
                    <span className="text-xl font-black font-mono text-rose-400">{selectedSale.debt.toFixed(3)} DT</span>
                  </div>
                )}
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-6 border-t border-slate-100 bg-slate-50/50 flex gap-3">
              <button
                onClick={() => downloadPDF(selectedSale)}
                className="flex-1 py-3 bg-indigo-600 text-white font-black text-xs uppercase tracking-wider rounded-2xl hover:bg-indigo-700 transition-all flex items-center justify-center gap-2 shadow-lg shadow-indigo-600/20"
              >
                <Download className="w-4 h-4" />
                Télécharger PDF
              </button>
              <button
                onClick={() => window.print()}
                className="flex-1 py-3 bg-white border border-slate-200 text-slate-700 font-black text-xs uppercase tracking-wider rounded-2xl hover:bg-slate-50 transition-all flex items-center justify-center gap-2"
              >
                <Printer className="w-4 h-4" />
                Imprimer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Security Code Modal */}
      {showSecurityModal && pendingDeleteSale && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden border border-slate-100">
            <div className="px-6 py-4 border-b border-slate-100 bg-rose-50/50 flex items-center justify-between">
              <h3 className="text-sm font-black text-slate-800 uppercase tracking-wider flex items-center gap-2">
                <Shield className="w-4 h-4 text-rose-500" />
                Code de sécurité requis
              </h3>
              <button onClick={() => { setShowSecurityModal(false); setPendingDeleteSale(null); }} className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-xs text-slate-500 font-medium">
                Saisissez le code de sécurité à 4 chiffres pour autoriser la suppression de cette vente.
              </p>
              <div className="relative">
                <Shield className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-rose-400" />
                <input
                  type={showSecurityInput ? 'text' : 'password'}
                  name="sale-security-code"
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
                      if (securityCode === userProfile?.securityCode) {
                        setShowSecurityModal(false);
                        setSaleToDelete(pendingDeleteSale);
                        setPendingDeleteSale(null);
                      } else {
                        setSecurityError(true);
                        setSecurityCode('');
                      }
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
                  onClick={() => { setShowSecurityModal(false); setPendingDeleteSale(null); setSecurityCode(''); setSecurityError(false); }}
                  className="flex-1 px-4 py-2.5 bg-slate-100 text-slate-700 text-xs font-bold rounded-xl hover:bg-slate-200 transition-colors uppercase tracking-wider"
                >
                  Annuler
                </button>
                <button
                  onClick={() => {
                    if (securityCode === userProfile?.securityCode) {
                      setShowSecurityModal(false);
                      setSaleToDelete(pendingDeleteSale);
                      setPendingDeleteSale(null);
                      setSecurityCode('');
                      setSecurityError(false);
                    } else {
                      setSecurityError(true);
                      setSecurityCode('');
                    }
                  }}
                  disabled={securityCode.length !== 4}
                  className="flex-1 px-4 py-2.5 bg-rose-600 text-white text-xs font-bold rounded-xl hover:bg-rose-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors uppercase tracking-wider"
                >
                  Confirmer
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Sale Delete Confirmation Modal */}
      {saleToDelete && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden border border-slate-100 p-6 space-y-4">
            <div className="flex items-start gap-3">
              <div className="p-2.5 bg-red-50 text-red-600 rounded-xl">
                <AlertCircle className="w-6 h-6 animate-pulse" />
              </div>
              <div className="space-y-1">
                <h3 className="text-sm font-black text-slate-800 uppercase tracking-wider">Supprimer la vente ?</h3>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Êtes-vous sûr de vouloir supprimer définitivement la vente <strong className="text-slate-800">#{saleToDelete.id.slice(0, 8)}...</strong> d'un montant de <strong className="text-slate-800">{saleToDelete.total.toFixed(3)} DT</strong> ?
                </p>
                <p className="text-[10px] text-red-600 font-extrabold leading-normal bg-red-50/50 p-2 rounded-lg border border-red-100/50 mt-1">
                  Cette opération va restaurer automatiquement les stocks, recalculer les rapports financiers, et soustraire la dette associée à ce client.
                </p>
              </div>
            </div>
            
            <div className="flex gap-3 justify-end pt-2">
              <button
                disabled={deleting}
                onClick={() => setSaleToDelete(null)}
                className="px-4 py-2 bg-slate-50 hover:bg-slate-100 text-slate-500 hover:text-slate-700 text-xs font-bold rounded-xl transition-all border border-slate-100 cursor-pointer disabled:opacity-50"
              >
                Annuler
              </button>
              <button
                disabled={deleting}
                onClick={handleDeleteConfirm}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-xs font-black rounded-xl transition-all shadow-md shadow-red-600/10 cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
              >
                {deleting ? (
                  <>
                    <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    <span>Suppression...</span>
                  </>
                ) : (
                  <span>Confirmer</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes modalIn {
          from { opacity: 0; transform: scale(0.95) translateY(8px); }
          to   { opacity: 1; transform: scale(1)    translateY(0); }
        }
      `}</style>
    </div>
  );
}
