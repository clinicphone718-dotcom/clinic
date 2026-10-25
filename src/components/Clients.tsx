import React, { useState, useEffect } from 'react';
import { collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, query, orderBy, where, getDocs, runTransaction, serverTimestamp } from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';
import { db, auth } from '../firebase';
import { Client, StoreSettings, UserProfile } from '../types';
import { handleFirestoreError, OperationType } from '../App';
import { Plus, Search, Edit2, Trash2, X, Phone, MapPin, Wallet, Coins, AlertCircle, CheckCircle } from 'lucide-react';
import { cn } from '../lib/utils';
import { can, hasMenuAccess } from '../lib/permissions';
import { addCashSessionTotals, requireOpenCashSession, useCashSession } from '../lib/cashSessions';

interface ClientsProps {
  userProfile: UserProfile | null;
}

export default function Clients({ userProfile }: ClientsProps) {
  const navigate = useNavigate();
  const { session: cashSession, loading: cashSessionLoading } = useCashSession(userProfile);
  const [clients, setClients] = useState<Client[]>([]);
  const [storeSettings, setStoreSettings] = useState<StoreSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [onlyWithDebt, setOnlyWithDebt] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);

  const ownerId = (userProfile?.role === 'admin' ? userProfile?.uid : userProfile?.ownerId) || userProfile?.uid || auth.currentUser?.uid;
  const canAddEdit = can(userProfile, 'clients', 'addEdit');
  const canDelete = can(userProfile, 'clients', 'delete');
  const canCash = hasMenuAccess(userProfile, 'pos');

  // Settlement state
  const [isSettleModalOpen, setIsSettleModalOpen] = useState(false);
  const [settlingClient, setSettlingClient] = useState<Client | null>(null);
  const [settleAmountInput, setSettleAmountInput] = useState('');
  const [settleAmount, setSettleAmount] = useState<number>(0);
  const [settleMode, setSettleMode] = useState('Espèces');
  const [settleError, setSettleError] = useState('');

  // Form state
  const [formData, setFormData] = useState({
    name: '',
    code: '',
    phone: '',
    address: '',
    debt: 0
  });

  const [debtInput, setDebtInput] = useState('');

  useEffect(() => {
    if (!auth.currentUser || !ownerId) return;
    const q = query(collection(db, 'clients'), where('ownerId', '==', ownerId));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const cls = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Client));
      cls.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      setClients(cls);
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'clients');
    });

    const unsubscribeSettings = onSnapshot(doc(db, 'settings', ownerId), (snapshot) => {
      if (snapshot.exists()) {
        setStoreSettings(snapshot.data() as StoreSettings);
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'settings');
    });

    return () => {
      unsubscribe();
      unsubscribeSettings();
    };
  }, [ownerId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canAddEdit) return;
    try {
      if (editingClient) {
        await updateDoc(doc(db, 'clients', editingClient.id), {
          ...formData,
          ownerId,
          userId: userProfile?.uid || ownerId
        });
      } else {
        await addDoc(collection(db, 'clients'), {
          ...formData,
          ownerId,
          userId: userProfile?.uid || ownerId
        });
      }
      closeModal();
    } catch (error) {
      handleFirestoreError(error, editingClient ? OperationType.UPDATE : OperationType.CREATE, 'clients');
    }
  };

  const handleDelete = async (id: string) => {
    if (!canDelete) return;
    if (!confirm('Êtes-vous sûr de vouloir supprimer ce client ?')) return;
    try {
      await deleteDoc(doc(db, 'clients', id));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, 'clients');
    }
  };

  const openModal = (client?: Client) => {
    if (client) {
      setEditingClient(client);
      setFormData({
        name: client.name,
        code: client.code || '',
        phone: client.phone || '',
        address: client.address || '',
        debt: client.debt
      });
      setDebtInput(client.debt.toString());
    } else {
      setEditingClient(null);
      setFormData({
        name: '',
        code: '',
        phone: '',
        address: '',
        debt: 0
      });
      setDebtInput('');
    }
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingClient(null);
  };

  const openSettleModal = (client: Client) => {
    setSettlingClient(client);
    setSettleAmountInput('');
    setSettleAmount(0);
    setSettleMode('Espèces');
    setSettleError('');
    setIsSettleModalOpen(true);
  };

  const closeSettleModal = () => {
    setIsSettleModalOpen(false);
    setSettlingClient(null);
  };

  const handleSettleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!settlingClient) return;
    if (!cashSession || cashSessionLoading) {
      setSettleError(cashSessionLoading
        ? 'Vérification de la caisse en cours…'
        : 'Aucune caisse ouverte. Ouvrez une session avant d’encaisser une dette.');
      return;
    }
    if (!Number.isFinite(settleAmount) || settleAmount <= 0 || settleAmount > settlingClient.debt) {
      setSettleError('Le montant du règlement doit être supérieur à zéro et ne pas dépasser la dette.');
      return;
    }
    try {
      // Répartir le règlement sur les ventes impayées du client (les plus anciennes d'abord),
      // afin que l'historique des transactions reflète le paiement au lieu de rester "dette".
      const salesSnap = await getDocs(query(
        collection(db, 'sales'),
        where('ownerId', '==', ownerId),
        where('clientId', '==', settlingClient.id)
      ));

      const parseSaleDate = (d: any): number => {
        if (!d) return 0;
        if (typeof d.toDate === 'function') return d.toDate().getTime();
        const t = new Date(d).getTime();
        return isNaN(t) ? 0 : t;
      };

      const unpaidSales = salesSnap.docs
        .map(d => ({ ref: d.ref, data: d.data() as any }))
        .filter(s => (s.data.debt || 0) > 0.0005)
        .sort((a, b) => parseSaleDate(a.data.date) - parseSaleDate(b.data.date));

      const clientRef = doc(db, 'clients', settlingClient.id);
      const paymentRef = doc(collection(db, 'client_debts'));
      await runTransaction(db, async transaction => {
        const activeSession = await requireOpenCashSession(
          transaction,
          userProfile?.uid || auth.currentUser?.uid || '',
          ownerId || '',
        );
        const clientSnapshot = await transaction.get(clientRef);
        const saleSnapshots = await Promise.all(unpaidSales.map(sale => transaction.get(sale.ref)));
        if (!clientSnapshot.exists()) throw new Error('Client introuvable.');
        const currentDebt = Number(clientSnapshot.data().debt) || 0;
        if (settleAmount > currentDebt + 0.001) {
          throw new Error('La dette a changé. Actualisez le montant avant de réessayer.');
        }
        let remaining = settleAmount;
        saleSnapshots.forEach((saleSnapshot, index) => {
          if (!saleSnapshot.exists() || remaining <= 0.0005) return;
          const sale = saleSnapshot.data();
          const saleDebt = Number(sale.debt) || 0;
          if (saleDebt <= 0) return;
          const payment = Math.min(remaining, saleDebt);
          const newSaleDebt = Math.round((saleDebt - payment) * 1000) / 1000;
          const newSalePaid = Math.round(((Number(sale.paid) || 0) + payment) * 1000) / 1000;
          transaction.update(unpaidSales[index].ref, { debt: newSaleDebt, paid: newSalePaid });
          if (sale.invoiceId) {
            transaction.update(doc(db, 'invoices', sale.invoiceId), { debt: newSaleDebt, paid: newSalePaid });
          }
          remaining = Math.round((remaining - payment) * 1000) / 1000;
        });
        transaction.update(clientRef, { debt: Math.max(0, currentDebt - settleAmount) });
        transaction.set(paymentRef, {
          ownerId,
          clientId: settlingClient.id,
          type: 'encaissement_dette',
          reference: settlingClient.name,
          amount: settleAmount,
          mode: settleMode,
          date: serverTimestamp(),
          by: userProfile?.uid || auth.currentUser?.uid,
          sessionId: activeSession.id,
        });
        addCashSessionTotals(transaction, activeSession, {
          debtsCollected: settleAmount,
          debtsCollectedCash: settleMode === 'Espèces' ? settleAmount : 0,
        });
      });
      closeSettleModal();
    } catch (error) {
      setSettleError(error instanceof Error ? error.message : 'Impossible d’enregistrer le règlement.');
    }
  };

  const filteredClients = clients.filter(c => {
    const matchesSearch = c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.code?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.phone?.includes(searchTerm);
    
    if (onlyWithDebt) {
      return matchesSearch && c.debt > 0;
    }
    return matchesSearch;
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold text-slate-800 tracking-tight">Clients</h1>
          <p className="text-xs text-slate-400 font-medium uppercase tracking-wider mt-0.5">Gérez vos clients et leurs dettes</p>
        </div>
        {canAddEdit && <button
          onClick={() => openModal()}
          className="inline-flex items-center justify-center gap-2 px-5 py-3 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-black uppercase tracking-wider rounded-xl transition-all duration-300 shadow-lg shadow-indigo-600/15 group hover:-translate-y-0.5"
        >
          <Plus className="w-4 h-4 transition-transform group-hover:rotate-90 duration-300" />
          Nouveau Client
        </button>}
      </div>

      <div className="bg-white rounded-3xl border border-slate-100 shadow-xs overflow-hidden premium-shadow">
        <div className="p-5 border-b border-slate-100 bg-slate-50/20 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4.5 h-4.5 text-slate-400" />
            <input
              type="text"
              placeholder="Rechercher un client..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-11 pr-4 py-2.5 bg-slate-50 border border-slate-100 rounded-xl focus:bg-white text-xs font-semibold text-slate-700 placeholder-slate-400 focus:ring-2 focus:ring-indigo-500/10 focus:border-indigo-500 outline-none transition-all duration-300"
            />
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setOnlyWithDebt(!onlyWithDebt)}
              className={cn(
                "flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-all duration-200 border cursor-pointer select-none",
                onlyWithDebt 
                  ? "bg-rose-50 text-rose-700 border-rose-200 shadow-xs" 
                  : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50 hover:text-slate-800"
              )}
            >
              <Coins className={cn("w-4 h-4 transition-transform duration-300", onlyWithDebt ? "text-rose-500 scale-110" : "text-slate-400")} />
              <span>Clients endettés uniquement</span>
              {onlyWithDebt && (
                <span className="ml-1.5 px-2 py-0.5 bg-rose-200 text-rose-800 text-xs font-black rounded-md">
                  {clients.filter(c => c.debt > 0).length}
                </span>
              )}
            </button>
          </div>
        </div>

        <div className="overflow-x-auto text-[13px] font-medium text-slate-600">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50/50 border-b border-slate-100 text-slate-400 text-[10px] font-extrabold uppercase tracking-widest">
                <th className="px-6 py-4">CLIENT / CONTACT</th>
                <th className="px-6 py-4">DETTE ACTUELLE</th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100/70">
              {loading ? (
                <tr>
                  <td colSpan={3} className="px-6 py-10 text-center text-gray-500">Chargement...</td>
                </tr>
              ) : filteredClients.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-6 py-10 text-center text-gray-500">Aucun client trouvé.</td>
                </tr>
              ) : (
                filteredClients.map((client) => (
                  <tr key={client.id} className="hover:bg-gray-50/50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="font-medium text-gray-900">{client.name}</div>
                      {client.code && <div className="text-[10px] text-gray-400 font-mono uppercase tracking-tighter">Code: {client.code}</div>}
                      {client.address && (
                        <div className="text-xs text-gray-500 flex items-center gap-1 mt-1">
                          <MapPin className="w-3 h-3" />
                          {client.address}
                        </div>
                      )}
                      {client.phone ? (
                        <div className="mt-1 flex items-center gap-1 text-sm text-gray-600">
                          <Phone className="w-3 h-3" />
                          {client.phone}
                        </div>
                      ) : (
                        <span className="mt-1 block text-xs italic text-gray-400">Non renseigné</span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <div className="inline-flex items-center gap-1.5 rounded-full border border-red-100 bg-red-50 px-3.5 py-1.5 font-mono text-base font-black text-red-700">
                        <Wallet className="h-4 w-4 shrink-0" />
                        {client.debt.toFixed(3)} {storeSettings?.currency || 'DT'}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {canCash && client.debt > 0 && (
                          <button
                            onClick={() => openSettleModal(client)}
                            className="p-2 text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors"
                            title="Régler la dette"
                          >
                            <Coins className="w-4 h-4" />
                          </button>
                        )}
                        {canAddEdit && <button
                          onClick={() => openModal(client)}
                          className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>}
                        {canDelete && <button
                          onClick={() => handleDelete(client.id)}
                          className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal */}
      {canAddEdit && isModalOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden border border-gray-100">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
              <h2 className="text-lg font-bold text-gray-900">
                {editingClient ? 'Modifier Client' : 'Nouveau Client'}
              </h2>
              <button onClick={closeModal} className="p-2 text-gray-400 hover:text-gray-650 rounded-lg">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Nom complet</label>
                  <input
                    type="text"
                    required
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none"
                    placeholder="Ahmed Ben Salah"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Code Client</label>
                  <input
                    type="text"
                    value={formData.code}
                    onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none"
                    placeholder="CLI-001"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Téléphone</label>
                <input
                  type="tel"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none"
                  placeholder="Ex: 21 000 000"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Adresse</label>
                <input
                  type="text"
                  value={formData.address}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none"
                  placeholder="Ex: Rue de la Liberté, Tunis"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Dette Initiale ({storeSettings?.currency || 'DT'})</label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={debtInput}
                  onChange={(e) => {
                    const value = e.target.value.replace(',', '.');
                    if (value === '' || /^\d*\.?\d*$/.test(value)) {
                      setDebtInput(value);
                      setFormData({ ...formData, debt: parseFloat(value) || 0 });
                    }
                  }}
                  onBlur={() => {
                    const parsed = parseFloat(debtInput) || 0;
                    setDebtInput(parsed.toString());
                    setFormData({ ...formData, debt: parsed });
                  }}
                  placeholder="0.00"
                  className="w-full px-4 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none"
                />
              </div>

              <div className="pt-4 flex gap-3">
                <button
                  type="button"
                  onClick={closeModal}
                  className="flex-1 px-4 py-2.5 bg-gray-100 text-gray-700 font-semibold rounded-xl hover:bg-gray-200 transition-colors"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2.5 bg-indigo-600 text-white font-semibold rounded-xl hover:bg-indigo-700 transition-colors shadow-lg shadow-indigo-600/15"
                >
                  {editingClient ? 'Enregistrer' : 'Ajouter'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {canCash && isSettleModalOpen && settlingClient && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden border border-gray-100">

            {/* Header */}
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-emerald-50/50">
              <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                <Coins className="w-5 h-5 text-emerald-600" />
                Règlement de Dette
              </h2>
              <button onClick={closeSettleModal} className="p-2 text-gray-400 hover:text-gray-600 rounded-lg">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-5">

              {/* Client info + dette */}
              <div className="bg-slate-50 p-4 rounded-xl space-y-2 border border-slate-100/50">
                <div className="flex justify-between items-center text-xs">
                  <span className="text-slate-400 font-bold uppercase tracking-wider">Client</span>
                  <span className="font-bold text-slate-800">{settlingClient.name}</span>
                </div>
                {settlingClient.code && (
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-slate-400 font-bold uppercase tracking-wider">Code</span>
                    <span className="font-mono text-slate-600">{settlingClient.code}</span>
                  </div>
                )}
                <div className="flex justify-between items-center border-t border-slate-200/60 pt-2">
                  <span className="text-rose-600 font-black uppercase tracking-wider text-xs">Dette Totale</span>
                  <span className="font-black text-rose-600 font-mono text-xl">
                    {settlingClient.debt.toFixed(3)} {storeSettings?.currency || 'DT'}
                  </span>
                </div>
              </div>

              {/* Deux boutons de choix */}
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setSettleAmountInput('');
                    setSettleAmount(0);
                  }}
                  className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border-2 transition-all text-xs font-black uppercase tracking-wider cursor-pointer
                    ${settleAmount < settlingClient.debt && settleAmountInput !== ''
                      ? 'border-amber-400 bg-amber-50 text-amber-700'
                      : settleAmountInput === ''
                        ? 'border-amber-300 bg-amber-50 text-amber-700'
                        : 'border-slate-200 bg-white text-slate-500 hover:border-amber-300 hover:bg-amber-50/50'
                    }`}
                >
                  <AlertCircle className="w-5 h-5" />
                  Paiement partiel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSettleAmountInput(settlingClient.debt.toFixed(3));
                    setSettleAmount(settlingClient.debt);
                  }}
                  className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border-2 transition-all text-xs font-black uppercase tracking-wider cursor-pointer
                    ${settleAmount >= settlingClient.debt
                      ? 'border-emerald-400 bg-emerald-50 text-emerald-700'
                      : 'border-slate-200 bg-white text-slate-500 hover:border-emerald-300 hover:bg-emerald-50/50'
                    }`}
                >
                  <CheckCircle className="w-5 h-5" />
                  Solder totalement
                </button>
              </div>

              {/* Champ de saisie du montant */}
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">
                  Montant payé ({storeSettings?.currency || 'DT'})
                </label>
                <div className="relative">
                  <Coins className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-emerald-500" />
                  <input
                    type="text"
                    inputMode="decimal"
                    value={settleAmountInput}
                    onFocus={(e) => e.target.select()}
                    onChange={(e) => {
                      const value = e.target.value.replace(',', '.');
                      if (value === '' || /^\d*\.?\d*$/.test(value)) {
                        setSettleAmountInput(value);
                        setSettleAmount(parseFloat(value) || 0);
                      }
                    }}
                    placeholder="Saisissez le montant..."
                    className="w-full pl-9 pr-4 py-3 bg-white border-2 border-slate-200 rounded-xl text-sm font-bold text-slate-800 outline-none focus:ring-2 focus:ring-emerald-500/10 focus:border-emerald-500 shadow-sm transition-colors"
                  />
                </div>
              </div>

              <label className="block">
                <span className="mb-1.5 block text-[10px] font-black uppercase tracking-widest text-slate-400">Mode de règlement</span>
                <select value={settleMode} onChange={event => setSettleMode(event.target.value)} className="w-full rounded-xl border-2 border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold">
                  <option>Espèces</option><option>Carte</option><option>Virement</option>
                </select>
              </label>

              {settleError && <div role="alert" className="rounded-xl bg-rose-50 p-3 text-xs font-semibold text-rose-700">
                {settleError}
                {!cashSession && !cashSessionLoading && <button type="button" onClick={() => navigate('/cash-session')} className="ml-2 underline">Ouvrir la caisse</button>}
              </div>}

              {/* Résumé dynamique */}
              {settleAmount > 0 && settleAmount < settlingClient.debt && (
                <div className="p-4 bg-amber-50 rounded-xl border border-amber-200 space-y-2">
                  <div className="flex justify-between items-center text-xs text-amber-700 font-bold uppercase tracking-wider">
                    <span>Montant payé</span>
                    <span className="font-mono">{settleAmount.toFixed(3)} {storeSettings?.currency || 'DT'}</span>
                  </div>
                  <div className="flex justify-between items-center text-sm font-black text-amber-900 border-t border-amber-200 pt-2">
                    <span>Reste à payer</span>
                    <span className="font-mono text-rose-600">{(settlingClient.debt - settleAmount).toFixed(3)} {storeSettings?.currency || 'DT'}</span>
                  </div>
                </div>
              )}

              {settleAmount >= settlingClient.debt && settleAmount > 0 && (
                <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-200 flex items-center gap-2 text-emerald-700">
                  <CheckCircle className="w-4 h-4 shrink-0" />
                  <span className="text-xs font-bold">La dette sera entièrement soldée ✓</span>
                </div>
              )}

              {/* Boutons action */}
              <div className="flex gap-3 pt-1">
                <button
                  type="button"
                  onClick={closeSettleModal}
                  className="flex-1 px-4 py-2.5 bg-gray-100 text-gray-700 text-xs font-bold rounded-xl hover:bg-gray-200 transition-colors uppercase tracking-wider"
                >
                  Annuler
                </button>
                <button
                  type="button"
                  onClick={handleSettleSubmit}
                  disabled={settleAmount <= 0}
                  className="flex-1 px-4 py-2.5 bg-emerald-600 text-white text-xs font-bold rounded-xl hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shadow-lg shadow-emerald-600/15 uppercase tracking-wider"
                >
                  Valider le paiement
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
