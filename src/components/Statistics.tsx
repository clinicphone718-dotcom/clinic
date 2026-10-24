import { useState, useEffect, useCallback } from 'react';
import { collection, query, where, getDocs, getCountFromServer } from 'firebase/firestore';
import { db } from '../firebase';
import { UserProfile } from '../types';
import {
  BarChart3, Users as UsersIcon, Database, Activity, RefreshCcw, ChevronDown, ChevronRight,
  Shield, Calendar, Store, Layers, ShieldAlert
} from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { cn } from '../lib/utils';
import { useIsSuperAdmin } from '../lib/useIsSuperAdmin';
import { APP_NAME } from '../config/brand';

// Collections comptabilisées dans la "taille de la base" de chaque magasin
const DATA_COLLECTIONS = ['products', 'sales', 'clients', 'invoices', 'categories', 'notes', 'supplies'];

interface StoreStat {
  owner: UserProfile;
  collaborators: UserProfile[];
  counts: Record<string, number>;
  totalDocs: number;
  activityCount: number;
}

interface StatisticsProps {
  userProfile: UserProfile | null;
}

function formatDate(value?: string) {
  if (!value) return 'Non disponible';
  try {
    return format(new Date(value), 'dd MMM yyyy', { locale: fr });
  } catch {
    return 'Non disponible';
  }
}

export default function Statistics({ userProfile }: StatisticsProps) {
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [loadingStats, setLoadingStats] = useState(false);
  const [allUsers, setAllUsers] = useState<UserProfile[]>([]);
  const [storeStats, setStoreStats] = useState<StoreStat[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isSuper = useIsSuperAdmin();

  // 1. Charger la liste de tous les comptes (une seule fois, lecture directe)
  useEffect(() => {
    if (!isSuper) return;
    setLoadingUsers(true);
    getDocs(collection(db, 'users'))
      .then((snap) => {
        const users = snap.docs.map((d) => ({ ...(d.data() as UserProfile), uid: d.id }));
        setAllUsers(users);
      })
      .catch((err) => {
        console.error('[Statistics] Erreur chargement utilisateurs:', err);
        setError("Impossible de charger la liste des comptes.");
      })
      .finally(() => setLoadingUsers(false));
  }, [isSuper]);

  // 2. Pour chaque magasin (compte admin), calculer la taille de la base et l'activité
  const computeStats = useCallback(async () => {
    if (!isSuper || allUsers.length === 0) return;
    setLoadingStats(true);
    setError(null);

    const owners = allUsers.filter((u) => u.role === 'admin');

    try {
      const results: StoreStat[] = [];

      for (const owner of owners) {
        const collaborators = allUsers.filter((u) => u.role === 'user' && u.ownerId === owner.uid);
        const counts: Record<string, number> = {};

        for (const collectionName of DATA_COLLECTIONS) {
          try {
            const q = query(collection(db, collectionName), where('ownerId', '==', owner.uid));
            const countSnap = await getCountFromServer(q);
            counts[collectionName] = countSnap.data().count;
          } catch (err) {
            console.error(`Unable to count documents in ${collectionName}.`);
            counts[collectionName] = 0;
          }
        }

        let activityCount = 0;
        try {
          const auditQ = query(collection(db, 'audit_logs'), where('ownerId', '==', owner.uid));
          const auditSnap = await getCountFromServer(auditQ);
          activityCount = auditSnap.data().count;
        } catch (err) {
          console.error('Unable to count audit records.');
        }

        const totalDocs = Object.values(counts).reduce((sum, n) => sum + n, 0);

        results.push({ owner, collaborators, counts, totalDocs, activityCount });
      }

      results.sort((a, b) => b.totalDocs - a.totalDocs);
      setStoreStats(results);
      setLastRefresh(new Date());
    } catch (err) {
      console.error('[Statistics] Erreur globale de calcul:', err);
      setError("Une erreur est survenue lors du calcul des statistiques.");
    } finally {
      setLoadingStats(false);
    }
  }, [isSuper, allUsers]);

  useEffect(() => {
    if (allUsers.length > 0) {
      computeStats();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allUsers]);

  const toggleExpand = (uid: string) => setExpanded((prev) => ({ ...prev, [uid]: !prev[uid] }));

  // --- Garde-fou : accès strictement réservé ---
  if (!isSuper) {
    return (
      <div className="max-w-lg mx-auto mt-16 text-center space-y-3">
        <ShieldAlert className="w-10 h-10 text-rose-400 mx-auto" />
        <h2 className="font-bold text-slate-700">Accès réservé</h2>
        <p className="text-sm text-slate-400">Cette rubrique n'est disponible que pour l'administrateur principal de la plateforme.</p>
      </div>
    );
  }

  // --- Totaux globaux ---
  const totalStores = storeStats.length;
  const totalCollaborators = storeStats.reduce((sum, s) => sum + s.collaborators.length, 0);
  const totalUsers = totalStores + totalCollaborators;
  const totalDocsAll = storeStats.reduce((sum, s) => sum + s.totalDocs, 0);
  const totalActivityAll = storeStats.reduce((sum, s) => sum + s.activityCount, 0);

  const perCollectionTotals: Record<string, number> = {};
  DATA_COLLECTIONS.forEach((c) => {
    perCollectionTotals[c] = storeStats.reduce((sum, s) => sum + (s.counts[c] || 0), 0);
  });

  const maxTotalDocs = Math.max(1, ...storeStats.map((s) => s.totalDocs));

  const collectionLabels: Record<string, string> = {
    products: 'Produits',
    sales: 'Ventes',
    clients: 'Clients',
    invoices: 'Factures',
    categories: 'Catégories',
    notes: 'Notes',
    supplies: 'Approvisionnements',
  };

  return (
    <div className="space-y-6 pb-10">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black text-slate-800 tracking-tight flex items-center gap-2">
            <BarChart3 className="w-7 h-7 text-indigo-600" />
            Statistique
          </h1>
          <p className="text-xs text-slate-400 font-semibold mt-1">
            Vue d'ensemble de tous les magasins utilisant {APP_NAME}
          </p>
        </div>
        <button
          onClick={computeStats}
          disabled={loadingStats || loadingUsers}
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-black uppercase tracking-wider rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <RefreshCcw className={cn('w-3.5 h-3.5', loadingStats && 'animate-spin')} />
          {loadingStats ? 'Calcul en cours...' : 'Actualiser'}
        </button>
      </div>

      {error && (
        <div className="p-4 bg-rose-50 border border-rose-100 rounded-xl text-rose-700 text-xs font-bold">
          {error}
        </div>
      )}

      {lastRefresh && (
        <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">
          Dernière mise à jour : {format(lastRefresh, 'dd MMM yyyy HH:mm', { locale: fr })}
        </p>
      )}

      {/* Cartes de synthèse globale */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-2xl border border-slate-100 p-5 shadow-xs">
          <div className="flex items-center gap-2 text-slate-400 mb-2">
            <Store className="w-4 h-4" />
            <span className="text-[10px] font-black uppercase tracking-widest">Magasins</span>
          </div>
          <p className="text-2xl font-black text-slate-800">{totalStores}</p>
        </div>
        <div className="bg-white rounded-2xl border border-slate-100 p-5 shadow-xs">
          <div className="flex items-center gap-2 text-slate-400 mb-2">
            <UsersIcon className="w-4 h-4" />
            <span className="text-[10px] font-black uppercase tracking-widest">Comptes</span>
          </div>
          <p className="text-2xl font-black text-slate-800">{totalUsers}</p>
          <p className="text-[10px] text-slate-400 font-semibold mt-0.5">{totalCollaborators} collaborateur(s)</p>
        </div>
        <div className="bg-white rounded-2xl border border-slate-100 p-5 shadow-xs">
          <div className="flex items-center gap-2 text-slate-400 mb-2">
            <Database className="w-4 h-4" />
            <span className="text-[10px] font-black uppercase tracking-widest">Documents totaux</span>
          </div>
          <p className="text-2xl font-black text-slate-800">{totalDocsAll.toLocaleString('fr-FR')}</p>
        </div>
        <div className="bg-white rounded-2xl border border-slate-100 p-5 shadow-xs">
          <div className="flex items-center gap-2 text-slate-400 mb-2">
            <Activity className="w-4 h-4" />
            <span className="text-[10px] font-black uppercase tracking-widest">Actions journalisées</span>
          </div>
          <p className="text-2xl font-black text-slate-800">{totalActivityAll.toLocaleString('fr-FR')}</p>
        </div>
      </div>

      {/* Trafic général par type de donnée */}
      <div className="bg-white rounded-3xl border border-slate-100 shadow-xs p-6">
        <h2 className="text-sm font-black text-slate-700 uppercase tracking-wider flex items-center gap-2 mb-4">
          <Layers className="w-4 h-4 text-indigo-500" />
          Trafic général (toutes plateformes confondues)
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
          {DATA_COLLECTIONS.map((c) => (
            <div key={c} className="p-3 bg-slate-50 rounded-xl border border-slate-100 text-center">
              <p className="text-lg font-black text-indigo-600">{perCollectionTotals[c]?.toLocaleString('fr-FR') || 0}</p>
              <p className="text-[9px] font-black text-slate-400 uppercase tracking-wider mt-1">{collectionLabels[c]}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Liste des magasins / utilisateurs */}
      <div className="bg-white rounded-3xl border border-slate-100 shadow-xs overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center gap-2">
          <Shield className="w-4 h-4 text-indigo-500" />
          <h2 className="text-sm font-black text-slate-700 uppercase tracking-wider">Détail par magasin</h2>
        </div>

        {(loadingUsers || (loadingStats && storeStats.length === 0)) ? (
          <div className="p-16 flex items-center justify-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
          </div>
        ) : storeStats.length === 0 ? (
          <div className="p-16 text-center text-sm text-slate-400 font-semibold">Aucun magasin trouvé.</div>
        ) : (
          <div className="divide-y divide-slate-100">
            {storeStats.map((s) => {
              const isOpen = !!expanded[s.owner.uid];
              const barWidth = Math.max(4, Math.round((s.totalDocs / maxTotalDocs) * 100));
              return (
                <div key={s.owner.uid}>
                  <button
                    onClick={() => toggleExpand(s.owner.uid)}
                    className="w-full text-left px-6 py-4 hover:bg-slate-50/60 transition-colors flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-6"
                  >
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      {isOpen ? <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" /> : <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />}
                      <div className="w-9 h-9 rounded-xl bg-indigo-50 flex items-center justify-center font-black text-xs text-indigo-600 border border-indigo-100 shrink-0">
                        {(s.owner.name || s.owner.email)?.[0]?.toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <p className="font-bold text-xs text-slate-800 truncate">{s.owner.name || 'Sans nom'}</p>
                        <p className="text-[10px] text-slate-400 font-semibold truncate">{s.owner.email}</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 text-[10px] text-slate-400 font-bold shrink-0">
                      <Calendar className="w-3.5 h-3.5" />
                      {formatDate(s.owner.createdAt)}
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="px-2 py-1 bg-blue-50 text-blue-700 border border-blue-100 rounded-lg text-[9px] font-black uppercase tracking-wider">
                        {s.collaborators.length} collab.
                      </span>
                      <span className="px-2 py-1 bg-emerald-50 text-emerald-700 border border-emerald-100 rounded-lg text-[9px] font-black uppercase tracking-wider">
                        {s.activityCount} action(s)
                      </span>
                    </div>

                    <div className="flex-1 min-w-[120px] max-w-[220px] shrink-0">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[9px] font-black text-slate-400 uppercase tracking-wider">Base</span>
                        <span className="text-[10px] font-black text-slate-700">{s.totalDocs.toLocaleString('fr-FR')} docs</span>
                      </div>
                      <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div className="h-full bg-gradient-to-r from-indigo-500 to-cyan-500 rounded-full" style={{ width: `${barWidth}%` }} />
                      </div>
                    </div>
                  </button>

                  {isOpen && (
                    <div className="px-6 pb-5 pt-1 bg-slate-50/40 space-y-4">
                      {/* Détail des collections pour ce magasin */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
                        {DATA_COLLECTIONS.map((c) => (
                          <div key={c} className="p-2.5 bg-white rounded-lg border border-slate-100 text-center">
                            <p className="text-sm font-black text-slate-700">{s.counts[c] || 0}</p>
                            <p className="text-[8px] font-black text-slate-400 uppercase tracking-wider mt-0.5">{collectionLabels[c]}</p>
                          </div>
                        ))}
                      </div>

                      {/* Collaborateurs */}
                      {s.collaborators.length > 0 && (
                        <div>
                          <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider mb-2">Collaborateurs</p>
                          <div className="space-y-1.5">
                            {s.collaborators.map((c) => (
                              <div key={c.uid} className="flex items-center justify-between bg-white border border-slate-100 rounded-lg px-3 py-2">
                                <div className="min-w-0">
                                  <p className="text-xs font-bold text-slate-700 truncate">{c.name || 'Sans nom'}</p>
                                  <p className="text-[10px] text-slate-400 truncate">{c.email}</p>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                  <span className={cn(
                                    'px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-wider',
                                    c.status === 'banned' ? 'bg-rose-50 text-rose-600' : 'bg-emerald-50 text-emerald-600'
                                  )}>
                                    {c.status === 'banned' ? 'Banni' : 'Actif'}
                                  </span>
                                  <span className="text-[9px] text-slate-400 font-bold flex items-center gap-1">
                                    <Calendar className="w-3 h-3" />
                                    {formatDate(c.createdAt)}
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
