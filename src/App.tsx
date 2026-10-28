import React, { useEffect, useState, Component } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, Link, useLocation } from 'react-router-dom';
import { onAuthStateChanged, signOut, User } from 'firebase/auth';
import { auth, db } from './firebase';
import { doc, getDoc, setDoc, onSnapshot, collection, query, orderBy, where } from 'firebase/firestore';
import { 
  LayoutDashboard, 
  Package, 
  Users, 
  ShoppingCart, 
  History, 
  LogOut, 
  Menu, 
  X,
  AlertTriangle,
  FileText,
  RefreshCcw,
  Settings as SettingsIcon,
  UserCheck,
  StickyNote,
  Bell,
  Calendar,
  CheckCircle,
  Wifi,
  WifiOff,
  Wrench,
  BookOpen,
  CircleDollarSign,
  BarChart3,
} from 'lucide-react';
import { cn } from './lib/utils';
import type { UserProfile, Note, CashSession as CashSessionRecord } from './types';
import { getPendingOperations, syncPendingOperations } from './lib/offlineManager';
import { hasMenuAccess } from './lib/permissions';
import BrandLogo from './components/BrandLogo';
import { APP_LOGO_URL, APP_NAME } from './config/brand';
import { ALLOW_SELF_SIGNUP } from './config/firebase';
import { useCashSession } from './lib/cashSessions';
export { hasMenuAccess } from './lib/permissions';

const NAV_SECTIONS = [
  {
    title: 'VENTE',
    items: [
      { id: 'dashboard', name: 'Tableau de bord', path: '/', icon: LayoutDashboard },
      { id: 'pos', name: 'Vente (Caisse)', path: '/pos', icon: ShoppingCart },
      { id: 'sales', name: 'Historique ventes', path: '/sales', icon: History },
      { id: 'invoices', name: 'Facturation', path: '/invoices', icon: FileText },
      { id: 'invoices', name: 'Clôture de caisse', path: '/cash-session', icon: CircleDollarSign },
    ],
  },
  {
    title: 'ATELIER',
    items: [
      { id: 'reparation', name: 'Réparations', path: '/repairs', icon: Wrench },
      { id: 'pieces', name: 'Pièces détachées', path: '/parts', icon: Package },
    ],
  },
  {
    title: 'CATALOGUE',
    items: [
      { id: 'products', name: 'Articles / Services', path: '/products', icon: Package },
      { id: 'clients', name: 'Clients', path: '/clients', icon: Users },
    ],
  },
  {
    title: 'OUTILS',
    items: [
      { id: 'notes', name: 'Mémos & Notes', path: '/notes', icon: StickyNote },
      { id: 'startup', name: 'Coran & Adhkar', path: '/settings#startup-settings', icon: BookOpen, adminOnly: true },
    ],
  },
  {
    title: 'ADMINISTRATION',
    items: [
      { id: 'users', name: 'Utilisateurs', path: '/users', icon: UserCheck, adminOnly: true },
      { id: 'reports', name: 'Rapports', path: '/reports', icon: BarChart3, adminOnly: true },
      { id: 'expenses', name: 'Dépenses', path: '/expenses', icon: CircleDollarSign, adminOnly: true },
      { id: 'settings', name: 'Paramètres', path: '/settings', icon: SettingsIcon },
    ],
  },
];

function isAdminOwner(userProfile: UserProfile | null): boolean {
  return userProfile?.role === 'admin' &&
    (userProfile.ownerId || userProfile.uid) === userProfile.uid;
}

function getAccessibleNavigation(userProfile: UserProfile | null) {
  return NAV_SECTIONS.map(section => ({
    ...section,
    items: section.items.filter(item => {
      if (item.adminOnly && !isAdminOwner(userProfile)) return false;
      if (item.id === 'settings') return true;
      if (item.id === 'startup') return isAdminOwner(userProfile);
      return hasMenuAccess(userProfile, item.id);
    }),
  })).filter(section => section.items.length > 0);
}

function getFirstAccessiblePath(userProfile: UserProfile | null): string {
  return getAccessibleNavigation(userProfile).flatMap(section => section.items)[0]?.path || '/settings';
}

// Components
import Dashboard from './components/Dashboard';
import Products from './components/Products';
import Clients from './components/Clients';
import POS from './components/POS';
import Sales from './components/Sales';
import Invoices from './components/Invoices';
import Settings from './components/Settings';
import Login from './components/Login';
import UsersManager from './components/Users';
import Notes from './components/Notes';
import Repairs from './components/Repairs';
import Parts from './components/Parts';
import Expenses from './components/Expenses';
import Reports from './components/Reports';
import CashSession from './components/CashSession';
import { StartupProvider } from './components/StartupProvider';

// Error Handling
export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export function handleFirestoreError(error: unknown, operationType: OperationType, _path: string | null) {
  console.error('Firestore operation failed:', operationType);
  throw error instanceof Error ? error : new Error('Firestore operation failed.');
}

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: any;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  componentDidCatch(_error: any, _errorInfo: any) {
    console.error('An unexpected application error occurred.');
  }

  render() {
    if (this.state.hasError) {
      let displayError = "Une erreur inattendue est survenue.";
      try {
        const parsed = JSON.parse(this.state.error.message);
        if (parsed.error) displayError = parsed.error;
      } catch (e) {
        displayError = this.state.error?.message || displayError;
      }

      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-100 p-4">
          <div className="bg-white p-8 rounded-3xl shadow-xl border border-red-100 max-w-md w-full text-center">
            <div className="w-16 h-16 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto mb-6">
              <AlertTriangle className="w-8 h-8" />
            </div>
            <h1 className="text-2xl font-black text-gray-900 mb-2">Oups !</h1>
            <p className="text-gray-600 mb-8">{displayError}</p>
            <button
              onClick={() => window.location.reload()}
              className="w-full flex items-center justify-center gap-2 bg-indigo-600 text-white py-3 rounded-xl font-bold hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-600/10"
            >
              <RefreshCcw className="w-5 h-5" />
              Actualiser la page
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

// Livraison / encaissement / remise des réparations : admin ou profil de vente
// (menu 'pos'). Jamais le Technicien (qui n'a que le menu 'reparation').
// Doit rester aligné avec canCash() dans firestore.rules.
export function canCashRepairs(userProfile: UserProfile | null): boolean {
  return !!userProfile && (userProfile.role === 'admin' || hasMenuAccess(userProfile, 'pos'));
}

function Sidebar({ 
  isOpen, 
  setIsOpen, 
  userProfile, 
  todayNotesCount,
  deferredPrompt,
  handleInstallApp,
  isOnline,
  pendingCount,
  syncing,
  handleTriggerSync,
  cashSession,
  cashSessionLoading,
}: { 
  isOpen: boolean; 
  setIsOpen: (v: boolean) => void; 
  userProfile: UserProfile | null; 
  todayNotesCount: number;
  deferredPrompt: any;
  handleInstallApp: () => void;
  isOnline: boolean;
  pendingCount: number;
  syncing: boolean;
  handleTriggerSync: () => void;
  cashSession: CashSessionRecord | null;
  cashSessionLoading: boolean;
}) {
  const location = useLocation();
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone;
  const navSections = getAccessibleNavigation(userProfile);

  return (
    <>
      {/* Mobile Backdrop */}
      {isOpen && (
        <div 
          className="fixed inset-0 z-40 bg-[#20263A]/25 backdrop-blur-sm transition-opacity duration-300 lg:hidden"
          onClick={() => setIsOpen(false)}
        />
      )}
      
      <aside className={cn(
        "fixed inset-y-0 left-0 z-50 w-[min(18rem,calc(100vw-1rem))] border-r border-[#E6E9F2] bg-white text-[#20263A] shadow-xl shadow-[#20263A]/10 transition-transform duration-300 lg:translate-x-0 lg:w-72 lg:shadow-none",
        isOpen ? "translate-x-0" : "-translate-x-full"
      )}>
        <div className="h-full flex flex-col">
          <div className="flex items-center justify-between border-b border-[#E6E9F2] px-5 py-5">
            <div className="min-w-0">
              <BrandLogo variant="full" logoUrl={APP_LOGO_URL} />
            </div>
            <button onClick={() => setIsOpen(false)} aria-label="Fermer le menu" className="ml-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-[#5F667A] transition-colors hover:bg-[#F6F7FB] lg:hidden">
              <X className="h-5 w-5" />
            </button>
          </div>

          <nav aria-label="Navigation principale" className="flex-1 space-y-3 overflow-y-auto px-4 py-5">
            {navSections.map(section => (
              <section key={section.title} aria-label={section.title}>
                <h2 className="px-3 pb-2 pt-3 text-[10px] font-bold uppercase tracking-[0.15em] text-[#5F667A]">{section.title}</h2>
                <div className="space-y-1">
                  {section.items.map((item) => {
                    const Icon = item.icon;
                    const isActive = item.path === '/settings#startup-settings'
                      ? location.pathname === '/settings' && location.hash === '#startup-settings'
                      : location.pathname === item.path;
                    return (
                      <Link
                        key={item.path}
                        to={item.path}
                        onClick={() => setIsOpen(false)}
                        className={cn(
                                  "group relative flex min-h-11 items-center gap-3 rounded-2xl px-3 text-[13px] font-semibold transition-colors duration-160",
                          isActive
                                    ? "bg-indigo-600 font-bold text-white shadow-md shadow-indigo-600/20"
                                    : "text-[#64748B] hover:bg-indigo-50 hover:text-slate-900"
                        )}
                        aria-current={isActive ? 'page' : undefined}
                      >
                        <Icon className={cn("h-[18px] w-[18px] shrink-0", isActive ? "text-white" : "text-slate-400")} />
                        <span className="flex-1">{item.name}</span>
                        {item.id === 'notes' && todayNotesCount > 0 && (
                          <span className={cn(
                            "min-w-[18px] rounded-full px-2 py-0.5 text-center text-[10px] font-black",
                            isActive ? "bg-white/20 text-white" : "bg-rose-50 text-rose-700"
                          )}>
                            {todayNotesCount}
                          </span>
                        )}
                      </Link>
                    );
                  })}
                </div>
              </section>
            ))}
          </nav>

          {/* PWA / Offline Status Cards in Sidebar */}
          <div className="space-y-3 px-4 py-3">
            <div className="flex flex-col gap-3 rounded-2xl border border-[#E6E9F2] bg-[#F6F7FB] p-4">
              <div className="flex items-center gap-2.5">
                <span className={cn("h-2.5 w-2.5 rounded-full", cashSession ? "bg-[#168568]" : "bg-[#A4AABC]")} />
                <span className="text-xs font-bold uppercase tracking-[0.06em] text-[#20263A]">{cashSession ? 'Caisse ouverte' : cashSessionLoading ? 'Chargement de la caisse…' : 'Aucune caisse ouverte'}</span>
              </div>
              {cashSession && <p className="text-[12px] font-medium text-[#5F667A]">Session depuis {cashSession.openedAt?.toDate?.().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) || '—'}, par {userProfile?.name || userProfile?.email || 'Utilisateur'}</p>}
              <Link to="/cash-session" onClick={() => setIsOpen(false)} className="flex min-h-11 items-center justify-center rounded-xl bg-[#5846E8] px-3 text-sm font-bold text-white transition-colors hover:bg-[#4937D3] focus-visible:outline-offset-2">
                {cashSession ? 'Clôturer la caisse' : 'Ouvrir la caisse'}
              </Link>
            </div>
          </div>

          <div className="border-t border-[#E6E9F2] px-4 py-3">
            {/* Connection and Sync Status */}
            {!isOnline ? (
              <div className="rounded-xl border border-[#F2D9B6] bg-[#FFF6E9] p-3 text-xs text-[#67430F]">
                <div className="mb-1 flex items-center gap-2 text-[10px] font-black uppercase tracking-wider text-[#67430F]">
                  <WifiOff className="h-3.5 w-3.5 animate-pulse text-[#A96500]" />
                  Mode Hors-ligne
                </div>
                <p className="text-[11px] font-medium leading-relaxed text-[#67430F]">
                  Modifications sauvegardées localement. {pendingCount > 0 ? `${pendingCount} opération(s) en attente.` : 'Prêt pour reconnexion.'}
                </p>
              </div>
            ) : pendingCount > 0 ? (
              <div className="rounded-xl border border-[#DCD8FF] bg-[#F3F1FF] p-3 text-xs text-[#4937D3]">
                <div className="mb-1 flex items-center justify-between text-[10px] font-black uppercase tracking-wider">
                  <span className="flex items-center gap-1.5">
                    <RefreshCcw className={cn("h-3.5 w-3.5 text-[#5846E8]", syncing && "animate-spin")} />
                    Synchronisation
                  </span>
                  <span className="rounded-full bg-[#5846E8] px-1.5 py-0.5 text-[9px] text-white">
                    {pendingCount}
                  </span>
                </div>
                <p className="mb-2 text-[11px] font-medium leading-relaxed text-[#5F667A]">
                  Des modifications locales sont en attente d'envoi.
                </p>
                <button
                  disabled={syncing}
                  onClick={handleTriggerSync}
                  className="min-h-11 w-full rounded-lg border border-[#5846E8] px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-[#5846E8] transition-colors hover:bg-[#5846E8] hover:text-white disabled:opacity-50"
                >
                  {syncing ? 'En cours...' : 'Synchroniser maintenant'}
                </button>
              </div>
            ) : null}

            {/* Install Prompt for Android / Desktop */}
            {deferredPrompt && (
              <div className="rounded-xl border border-[#E6E9F2] bg-white p-3 text-xs text-[#20263A]">
                <div className="mb-1 text-[10px] font-black uppercase tracking-wider text-[#20263A]">
                  ✨ Installer l'App
                </div>
                <p className="mb-2.5 text-[11px] font-medium leading-relaxed text-[#5F667A]">
                  Lancez {APP_NAME} en plein écran directement depuis votre écran d'accueil.
                </p>
                <button
                  onClick={handleInstallApp}
                  className="flex min-h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-lg bg-[#5846E8] px-3 py-2 text-[10px] font-black uppercase tracking-wider text-white transition-colors hover:bg-[#4937D3]"
                >
                  <Package className="w-3.5 h-3.5" />
                  Installer maintenant
                </button>
              </div>
            )}

            {/* Install Prompt Guide for iOS */}
            {isIOS && !isStandalone && (
              <div className="rounded-xl border border-[#E6E9F2] bg-white p-3 text-xs text-[#20263A]">
                <div className="mb-1 text-[10px] font-black uppercase tracking-wider text-[#20263A]">
                  📲 Installer sur iPhone
                </div>
                <p className="text-[11px] font-medium leading-relaxed text-[#5F667A]">
                  Appuyez sur <span className="font-bold">Partager</span> (<span className="text-[13px]">⎋</span>) puis sur <span className="font-bold">"Sur l'écran d'accueil"</span> (<span className="text-[13px]">⊕</span>).
                </p>
              </div>
            )}
          </div>

          <div className="border-t border-[#E6E9F2] p-4">
            <div className="mb-3 flex items-center gap-3 px-1.5 py-1">
              <div className="flex h-[42px] w-[42px] shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#F0EEFF] font-display text-base font-bold text-[#5846E8]">
                {(userProfile?.name || userProfile?.email || 'U').slice(0, 1).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold text-[#20263A]">{userProfile?.name || userProfile?.email || 'Utilisateur'}</p>
                <p className="mt-0.5 text-xs font-medium text-[#5F667A]">{userProfile?.role === 'admin' ? 'Administrateur' : 'Utilisateur'}</p>
              </div>
            </div>
            <button
              onClick={async () => {
                localStorage.clear();
                sessionStorage.clear();
                await signOut(auth);
                window.location.reload();
              }}
              className="flex min-h-11 w-full items-center gap-3 rounded-xl px-4 py-3 text-xs font-extrabold uppercase tracking-wider text-rose-600 transition-colors hover:bg-rose-50 hover:text-rose-700"
            >
              <LogOut className="h-4 w-4 text-[#7B8294]" />
              Déconnexion
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}

// Overlay bloquant affiché lorsque l'application est hors ligne :
// grise toute la page, bloque clics / focus / clavier et affiche un message.
function OfflineBlocker() {
  useEffect(() => {
    // Retire le focus de tout champ actif (zone de texte, bouton...)
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    // Bloque toute saisie clavier (y compris Tab pour re-focaliser un champ)
    const blockKeys = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('keydown', blockKeys, true);
    return () => {
      window.removeEventListener('keydown', blockKeys, true);
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-[9999] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 cursor-not-allowed select-none"
      onMouseDown={(e) => e.preventDefault()}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-sm w-full text-center">
        <div className="mx-auto w-16 h-16 rounded-full bg-gradient-to-tr from-indigo-600 to-cyan-500 flex items-center justify-center mb-4 shadow-md shadow-indigo-600/20">
          <WifiOff className="w-8 h-8 text-white" />
        </div>
        <h2 className="text-xl font-black font-display text-slate-800 mb-2">Connexion Internet requise</h2>
        <p className="text-slate-500 text-sm leading-relaxed">
          Vérifiez votre connexion Internet.<br />
          Aucune action n'est possible tant que vous êtes hors ligne.
        </p>
      </div>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [authMessage, setAuthMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [todayNotes, setTodayNotes] = useState<Note[]>([]);
  const [showNotesPopover, setShowNotesPopover] = useState(false);
  const [headerNotifications, setHeaderNotifications] = useState({ lowStock: 0, readyRepairs: 0, unpaidSales: 0, unpaidRepairs: 0 });
  const [headerNotificationError, setHeaderNotificationError] = useState('');

  // Offline status & synchronization states
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [pendingCount, setPendingCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [isAppInstalled, setIsAppInstalled] = useState(
    () => window.matchMedia('(display-mode: standalone)').matches || Boolean((navigator as any).standalone),
  );
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const { session: activeCashSession, loading: cashSessionLoading } = useCashSession(userProfile);

  useEffect(() => {
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    const handleInstalled = () => {
      setDeferredPrompt(null);
      setIsAppInstalled(true);
    };
    const handleServiceWorkerMessage = (event: MessageEvent) => {
      if (event.data?.type === 'APP_UPDATED') setUpdateAvailable(true);
    };
    const standaloneQuery = window.matchMedia('(display-mode: standalone)');
    const handleDisplayModeChange = (event: MediaQueryListEvent) => setIsAppInstalled(event.matches);
    window.addEventListener('appinstalled', handleInstalled);
    navigator.serviceWorker?.addEventListener('message', handleServiceWorkerMessage);
    standaloneQuery.addEventListener('change', handleDisplayModeChange);
    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleInstalled);
      navigator.serviceWorker?.removeEventListener('message', handleServiceWorkerMessage);
      standaloneQuery.removeEventListener('change', handleDisplayModeChange);
    };
  }, []);

  const handleInstallApp = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    setDeferredPrompt(null);
  };

  useEffect(() => {
    // Initial pending count
    setPendingCount(getPendingOperations().length);

    const handleConnectionChange = () => {
      const online = navigator.onLine;
      setIsOnline(online);
      if (online) {
        handleTriggerSync();
      }
    };

    const handleQueueChange = () => {
      setPendingCount(getPendingOperations().length);
    };

    window.addEventListener('online', handleConnectionChange);
    window.addEventListener('offline', handleConnectionChange);
    window.addEventListener('offline-operations-changed', handleQueueChange);

    // Initial check and auto-sync if online on mount
    if (navigator.onLine) {
      handleTriggerSync();
    }

    return () => {
      window.removeEventListener('online', handleConnectionChange);
      window.removeEventListener('offline', handleConnectionChange);
      window.removeEventListener('offline-operations-changed', handleQueueChange);
    };
  }, [userProfile]);

  const handleTriggerSync = async () => {
    if (!navigator.onLine || !userProfile) return;
    setSyncing(true);
    setSyncError(null);
    try {
      const result = await syncPendingOperations(userProfile);
      if (!result.success && result.errors.length > 0) {
        setSyncError(result.errors.join(' | '));
      }
    } catch (e) {
      console.error('Error in synchronization cycle:', e);
    } finally {
      setSyncing(false);
      setPendingCount(getPendingOperations().length);
    }
  };

  // Dynamic formatted human date in French
  const getFormattedDate = () => {
    const raw = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
    return raw.charAt(0).toUpperCase() + raw.slice(1);
  };

  // Listen to today's notes
  useEffect(() => {
    if (!auth.currentUser || !user || !userProfile || !hasMenuAccess(userProfile, 'notes')) {
      setTodayNotes([]);
      return;
    }
    const ownerId = userProfile?.ownerId || userProfile?.uid || 'no_user_auth';
    const todayStr = new Date().toISOString().split('T')[0];
    
    // Listen for notes of this owner, sort client-side to avoid compound index requirements
    const q = query(collection(db, 'notes'), where('ownerId', '==', ownerId));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const parsedNotes = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      } as Note));
      
      // Sort desc client-side
      parsedNotes.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
      
      // Only keep notes that match today's date
      const todays = parsedNotes.filter(n => n.date === todayStr);
      setTodayNotes(todays);
    }, (error) => {
      console.warn('Unable to refresh the notes list.');
    });

    return () => {
      unsubscribe();
    };
  }, [user, userProfile]);

  useEffect(() => {
    if (!auth.currentUser || !userProfile) {
      setHeaderNotifications({ lowStock: 0, readyRepairs: 0, unpaidSales: 0, unpaidRepairs: 0 });
      setHeaderNotificationError('');
      return;
    }
    setHeaderNotifications({ lowStock: 0, readyRepairs: 0, unpaidSales: 0, unpaidRepairs: 0 });
    setHeaderNotificationError('');

    const ownerId = userProfile.role === 'admin'
      ? userProfile.uid
      : userProfile.ownerId || userProfile.uid;
    const canViewStock = hasMenuAccess(userProfile, 'products');
    const canViewRepairs = hasMenuAccess(userProfile, 'reparation');
    const canViewSales = hasMenuAccess(userProfile, 'sales') || hasMenuAccess(userProfile, 'invoices');
    let products: Array<Record<string, any>> = [];
    let minStockAlert = 5;
    const updateLowStock = () => {
      const lowStock = products.filter(product => {
        if (product.inventoryType === 'service') return false;
        const threshold = Number.isFinite(Number(product.lowStockAlert)) && product.lowStockAlert !== undefined && product.lowStockAlert !== null
          ? Number(product.lowStockAlert)
          : minStockAlert;
        return (Number(product.stock) || 0) <= threshold;
      }).length;
      setHeaderNotifications(current => ({ ...current, lowStock }));
    };
    const subscriptions: Array<() => void> = [];

    if (canViewStock) {
      subscriptions.push(onSnapshot(
        query(collection(db, 'products'), where('ownerId', '==', ownerId)),
        snapshot => {
          products = snapshot.docs.map(item => item.data());
          updateLowStock();
        },
        () => {
          setHeaderNotificationError('Impossible de charger les alertes de stock.');
          console.error('Unable to load store-scoped stock notifications.');
        },
      ));
      subscriptions.push(onSnapshot(doc(db, 'settings', ownerId), snapshot => {
        if (snapshot.exists()) {
          const configured = Number(snapshot.data().minStockAlert);
          minStockAlert = Number.isFinite(configured) && configured >= 0 ? configured : 5;
          updateLowStock();
        }
      }, () => {
        setHeaderNotificationError('Impossible de charger le seuil d’alerte de stock.');
        console.error('Unable to load the store stock-alert threshold.');
      }));
    } else {
      setHeaderNotifications(current => ({ ...current, lowStock: 0 }));
    }

    if (canViewRepairs) {
      const repairsQuery = userProfile.role === 'admin'
        ? query(collection(db, 'repairs'), where('ownerId', '==', ownerId))
        : query(collection(db, 'repairs'), where('ownerId', '==', ownerId), where('costsSeparated', '==', true));
      subscriptions.push(onSnapshot(repairsQuery, snapshot => {
        const records = snapshot.docs.map(item => item.data());
        setHeaderNotifications(current => ({
          ...current,
          readyRepairs: records.filter(repair => repair.status === 'termine').length,
          unpaidRepairs: records.filter(repair => Number(repair.debt) > 0).length,
        }));
      }, () => {
        setHeaderNotificationError('Impossible de charger les alertes de réparations.');
        console.error('Unable to load store-scoped repair notifications.');
      }));
    } else {
      setHeaderNotifications(current => ({ ...current, readyRepairs: 0 }));
    }

    if (canViewSales) {
      subscriptions.push(onSnapshot(
        query(collection(db, 'sales'), where('ownerId', '==', ownerId)),
        snapshot => {
          setHeaderNotifications(current => ({
            ...current,
            unpaidSales: snapshot.docs.filter(item => Number(item.data().debt) > 0).length,
          }));
        },
        () => {
          setHeaderNotificationError('Impossible de charger les alertes d’impayés.');
          console.error('Unable to load store-scoped unpaid-sale notifications.');
        },
      ));
    } else {
      setHeaderNotifications(current => ({ ...current, unpaidSales: 0 }));
    }

    return () => subscriptions.forEach(unsubscribe => unsubscribe());
  }, [userProfile]);

  useEffect(() => {
    let unsubscribeProfile: (() => void) | null = null;
    let isMounted = true;
    const startProfileListener = (uid: string, isFirebaseUser: boolean) => {
      if (!isFirebaseUser || !auth.currentUser) return;
      if (unsubscribeProfile) {
        unsubscribeProfile();
        unsubscribeProfile = null;
      }
      const userRef = doc(db, 'users', uid);
      unsubscribeProfile = onSnapshot(userRef, (snap) => {
        if (!isMounted) return;
        if (snap.exists()) {
          const profileData = snap.data() as UserProfile;
          if (profileData.status === 'banned') {
            if (unsubscribeProfile) {
              unsubscribeProfile();
              unsubscribeProfile = null;
            }
            setUser(null);
            setUserProfile(null);
            if (isFirebaseUser) {
              signOut(auth);
            }
            setAuthMessage('Votre compte a été banni. Veuillez contacter l\'administrateur.');
            setLoading(false);
          } else {
            const repairedProfile = { ...profileData };
            if (repairedProfile.role === 'admin' && repairedProfile.ownerId !== repairedProfile.uid) {
              repairedProfile.ownerId = repairedProfile.uid;
              setDoc(userRef, { ownerId: repairedProfile.uid }, { merge: true })
                .catch(() => console.error('Unable to repair the admin profile owner reference.'));
            }
            setUserProfile(repairedProfile);
          }
        }
      }, (_error) => {
        console.error('Unable to listen to the active user profile.');
      });
    };

    const unsubscribeAuth = onAuthStateChanged(auth, async (firebaseUser) => {
      if (!isMounted) return;

      if (firebaseUser) {
        try {
        const userRef = doc(db, 'users', firebaseUser.uid);
        const userSnap = await getDoc(userRef);
        let profileData: UserProfile;

        if (!userSnap.exists()) {
          if (!ALLOW_SELF_SIGNUP) {
            await signOut(auth);
            setUser(null);
            setUserProfile(null);
            setAuthMessage('Compte non autorisé, contactez l’administrateur.');
            setLoading(false);
            return;
          }
          profileData = {
            uid: firebaseUser.uid,
            email: firebaseUser.email || '',
            role: 'user',
            status: 'active',
            allowedMenus: ['dashboard', 'pos', 'products', 'clients', 'sales', 'invoices'],
            ownerId: firebaseUser.uid,
            createdAt: new Date().toISOString()
          };
          await setDoc(userRef, profileData);
        } else {
          profileData = userSnap.data() as UserProfile;
          if (profileData.role === 'admin' && profileData.ownerId !== profileData.uid) {
            profileData.ownerId = profileData.uid;
            await setDoc(userRef, { ownerId: profileData.uid }, { merge: true });
          }
        }

        setAuthMessage('');
        setUser(firebaseUser);
        setUserProfile(profileData);
        setLoading(false);
        startProfileListener(firebaseUser.uid, true);
        } catch (error) {
          console.error('Unable to load the authenticated account profile.');
          setAuthMessage('Impossible de vérifier votre compte. Réessayez ou contactez l’administrateur.');
          await signOut(auth);
          setUser(null);
          setUserProfile(null);
          setLoading(false);
        }
      } else {
        if (unsubscribeProfile) {
          unsubscribeProfile();
          unsubscribeProfile = null;
        }
        localStorage.removeItem('custom_session');
        setUser(null);
        setUserProfile(null);
        setLoading(false);
      }
    });

    return () => {
      isMounted = false;
      unsubscribeAuth();
      if (unsubscribeProfile) unsubscribeProfile();
    };
  }, []);

  const canViewHeaderNotifications = hasMenuAccess(userProfile, 'notes') ||
    hasMenuAccess(userProfile, 'products') ||
    hasMenuAccess(userProfile, 'reparation') ||
    hasMenuAccess(userProfile, 'sales') ||
    hasMenuAccess(userProfile, 'invoices');
  const headerNotificationItems = [
    { id: 'lowStock', label: 'Articles sous le seuil de stock', count: headerNotifications.lowStock, path: '/products', color: 'text-rose-700 bg-rose-50' },
    { id: 'readyRepairs', label: 'Réparations prêtes à être récupérées', count: headerNotifications.readyRepairs, path: '/repairs', color: 'text-amber-700 bg-amber-50' },
    { id: 'unpaid', label: 'Ventes ou réparations avec impayé', count: headerNotifications.unpaidSales + headerNotifications.unpaidRepairs, path: hasMenuAccess(userProfile, 'sales') ? '/sales' : '/repairs', color: 'text-indigo-700 bg-indigo-50' },
  ].filter(item => item.count > 0);
  const headerNotificationCount = todayNotes.length + headerNotificationItems.reduce((sum, item) => sum + item.count, 0);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
      </div>
    );
  }

  if (!user) {
    return (
      <>
        <Login initialMessage={authMessage} />
        {!isOnline && <OfflineBlocker />}
      </>
    );
  }

  return (
    <ErrorBoundary>
      <Router>
        <StartupProvider userProfile={userProfile} online={isOnline}>
        <div className="flex min-h-screen bg-[#F6F7FB]" onClick={() => {
          if (showNotesPopover) setShowNotesPopover(false);
        }}>
          <Sidebar 
            isOpen={sidebarOpen} 
            setIsOpen={setSidebarOpen} 
            userProfile={userProfile} 
            todayNotesCount={todayNotes.length}
            deferredPrompt={deferredPrompt}
            handleInstallApp={handleInstallApp}
            isOnline={isOnline}
            pendingCount={pendingCount}
            syncing={syncing}
            handleTriggerSync={handleTriggerSync}
            cashSession={activeCashSession}
            cashSessionLoading={cashSessionLoading}
          />
          
          <main className="flex min-h-screen flex-1 flex-col lg:pl-72">
            <header className="sticky top-0 z-30 flex min-h-16 items-center justify-between gap-2 border-b border-[#E6E9F2] bg-white px-4 py-3 text-[#1E293B] lg:px-8">
              <button 
                onClick={() => setSidebarOpen(true)}
                aria-label="Ouvrir le menu"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-[#E6E9F2] bg-white text-[#64748B] transition-colors hover:bg-[#F8F9FD] lg:hidden"
              >
                <Menu className="h-5 w-5" />
              </button>
              <div className="flex min-w-0 flex-1 items-center gap-2.5 lg:hidden">
                <BrandLogo variant="icon" logoUrl={APP_LOGO_URL} className="h-9 w-9 rounded-xl p-2" />
                <div className="min-w-0">
                  <p className="truncate bg-gradient-to-r from-indigo-600 to-cyan-500 bg-clip-text font-display text-[15px] font-extrabold leading-tight tracking-tight text-transparent">{APP_NAME}</p>
                  <p className="flex items-center gap-1.5 text-[10px] font-semibold text-[#5F667A]">
                  <span className={cn("h-2 w-2 rounded-full", activeCashSession ? "bg-[#168568]" : "bg-[#A4AABC]")} />
                  {activeCashSession ? 'Caisse ouverte' : cashSessionLoading ? 'Chargement de la caisse…' : 'Aucune caisse ouverte'}
                  </p>
                </div>
              </div>

              {/* Online/Offline Status Indicator */}
              <div className="hidden items-center gap-2 lg:flex">
                {isOnline ? (
                  <div className="flex min-h-10 items-center gap-2 rounded-full bg-emerald-50 px-3.5 text-[11px] font-bold uppercase tracking-[0.08em] text-emerald-800">
                    <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-600" />
                    <span className="hidden sm:inline">En ligne</span>
                  </div>
                ) : (
                  <div className="flex min-h-10 items-center gap-2 rounded-full bg-rose-50 px-3.5 text-[11px] font-bold uppercase tracking-[0.08em] text-rose-800">
                    <span className="h-2 w-2 animate-pulse rounded-full bg-rose-600" />
                    <span>Hors ligne</span>
                  </div>
                )}

                {pendingCount > 0 && (
                  <button
                    onClick={handleTriggerSync}
                    disabled={syncing || !isOnline}
                    className={cn(
                      "flex min-h-10 items-center gap-1.5 rounded-full border px-3 py-1.5 text-[10px] font-black uppercase tracking-wider transition-all",
                      isOnline
                        ? "cursor-pointer border-[#E6E9F2] bg-white text-[#5F667A] hover:bg-[#F6F7FB]"
                        : "cursor-not-allowed border-[#E6E9F2] bg-[#F6F7FB] text-[#5F667A]"
                    )}
                    title={isOnline ? "Des opérations sont en attente de synchronisation. Cliquez pour synchroniser." : "Les opérations seront synchronisées dès le retour de la connexion."}
                  >
                    <RefreshCcw className={cn("h-3.5 w-3.5 text-[#5846E8]", syncing && "animate-spin")} />
                    <span>{pendingCount} en attente</span>
                  </button>
                )}
              </div>
              
              {/* Interactive Date & Notes Notification Badge widget */}
              <div className="relative ml-auto flex items-center gap-2 lg:ml-4 lg:gap-3.5" onClick={(e) => e.stopPropagation()}>
                <div className="hidden min-h-10 items-center gap-2 rounded-full border border-[#E6E9F2] bg-white px-3.5 font-mono text-[11px] font-medium text-[#64748B] lg:flex">
                  <Calendar className="h-4 w-4 text-[#5846E8]" />
                  <span>{getFormattedDate()}</span>
                </div>

                {canViewHeaderNotifications ? (
                <div className="relative">
                  <button
                    onClick={() => setShowNotesPopover(!showNotesPopover)}
                    className={cn(
                      "relative flex h-11 w-11 items-center justify-center rounded-full border transition-colors duration-300",
                      headerNotificationCount > 0
                        ? "border-[#E6E9F2] bg-white text-[#20263A] hover:bg-[#F6F7FB]"
                        : "border-[#E6E9F2] bg-white text-[#5F667A] hover:bg-[#F6F7FB]"
                    )}
                    title={headerNotificationCount > 0 ? `${headerNotificationCount} notification(s)` : "Aucune notification"}
                    aria-label={`Notifications${headerNotificationCount ? ` (${headerNotificationCount})` : ''}`}
                  >
                    <Bell className="h-[18px] w-[18px]" />
                    {headerNotificationCount > 0 && (
                      <span className="absolute right-1 top-1 flex h-[17px] min-w-[17px] items-center justify-center rounded-full bg-[#D94B55] px-1 text-[10px] font-bold text-white">
                        {headerNotificationCount}
                      </span>
                    )}
                  </button>

                  {showNotesPopover && (
                    <div className="absolute left-0 z-50 mt-2.5 w-76 rounded-2xl border border-[#E6E9F2] bg-white p-4 shadow-xl animate-in fade-in slide-in-from-top-2 duration-200 sm:w-80">
                      <div className="mb-2.5 flex items-center justify-between border-b border-[#E6E9F2] pb-2.5">
                        <span className="flex items-center gap-1.5 text-xs font-black uppercase tracking-wider text-[#20263A]">
                          <Bell className="h-4 w-4 text-[#5846E8]" />
                          Notifications
                        </span>
                        <span className="rounded-md border border-[#E6E9F2] bg-[#F6F7FB] px-2 py-0.5 text-[10px] font-black uppercase text-[#5F667A]">
                          {headerNotificationCount} active{headerNotificationCount > 1 ? 's' : ''}
                        </span>
                      </div>

                      <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                        {headerNotificationError && <p role="alert" className="rounded-lg bg-[#FCEAEC] p-2 text-[10px] font-semibold text-[#992C36]">{headerNotificationError}</p>}
                        {headerNotificationItems.map(item => (
                          <Link key={item.id} to={item.path} onClick={() => setShowNotesPopover(false)}
                            className={cn("flex items-center justify-between gap-3 rounded-xl p-2.5 text-xs font-semibold hover:opacity-85", item.color)}>
                            <span>{item.label}</span>
                            <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-black">{item.count}</span>
                          </Link>
                        ))}
                        {hasMenuAccess(userProfile, 'notes') && (
                          <div className="border-t border-[#E6E9F2] pt-2">
                            <p className="mb-2 flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wide text-[#5F667A]"><StickyNote className="h-3.5 w-3.5 text-[#5846E8]" /> Mémos d’aujourd’hui</p>
                            {todayNotes.length === 0 ? <p className="px-1 text-[10px] text-[#5F667A]">Aucun mémo pour aujourd’hui.</p> : todayNotes.map(note => (
                              <div key={note.id} className="mb-2 rounded-xl border border-[#E6E9F2] bg-[#F6F7FB] p-2.5">
                                <p className="text-xs font-extrabold text-[#20263A]">{note.title}</p>
                                <p className="mt-1 line-clamp-3 text-[10px] leading-relaxed text-[#5F667A]">{note.content}</p>
                              </div>
                            ))}
                          </div>
                        )}
                        {headerNotificationItems.length === 0 && todayNotes.length === 0 && !headerNotificationError ? (
                          <div className="py-4 text-center text-[#5F667A]">
                            <CheckCircle className="mx-auto mb-1.5 h-7 w-7 text-[#168568]" />
                            <p className="text-[10px] font-[900] uppercase tracking-wide text-[#5F667A]">Tout est en ordre</p>
                            <p className="mt-0.5 text-[9px] font-semibold text-[#5F667A]">Aucune notification à traiter.</p>
                          </div>
                        ) : null}
                      </div>

                      {hasMenuAccess(userProfile, 'notes') && <div className="mt-3 border-t border-[#E6E9F2] pt-2.5 text-center">
                        <Link
                          to="/notes"
                          onClick={() => setShowNotesPopover(false)}
                          className="inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-[#5846E8] py-2 text-[10px] font-extrabold uppercase tracking-wider text-white transition-colors hover:bg-[#4937D3]"
                        >
                          Gérer tous les mémos
                        </Link>
                      </div>}
                    </div>
                  )}
                </div>
                ) : (
                  <button
                    type="button"
                    aria-label="Notifications"
                    title="Notifications"
                    disabled
                    className="flex h-11 w-11 cursor-not-allowed items-center justify-center rounded-full border border-[#E6E9F2] bg-white text-[#5F667A]"
                  >
                    <Bell className="w-4 h-4" />
                  </button>
                )}
              </div>

              {hasMenuAccess(userProfile, 'pos') && (
                <Link
                  to="/pos"
                  aria-label="Ouvrir la caisse"
                  title="Ouvrir la caisse"
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-indigo-600 text-white shadow-lg shadow-indigo-600/20 transition-colors hover:bg-indigo-700"
                >
                  <CircleDollarSign className="h-5 w-5" />
                </Link>
              )}

              <div className="hidden items-center gap-2.5 lg:flex">
                <span className="max-w-56 truncate text-[12px] font-medium text-[#5F667A]">{user.email}</span>
                <div className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full bg-[#F0EEFF] text-sm font-bold text-[#5846E8]">
                  {(user.displayName || user.email || 'U').slice(0, 1).toUpperCase()}
                </div>
              </div>
            </header>
 
            <div className="mx-auto w-full max-w-[1600px] flex-1 p-4 lg:px-10 lg:py-7">
              <Routes>
                <Route path="/" element={getFirstAccessiblePath(userProfile) === '/' ? <Dashboard userProfile={userProfile} cashSession={activeCashSession} /> : <Navigate to={getFirstAccessiblePath(userProfile)} replace />} />
                <Route path="/products" element={hasMenuAccess(userProfile, 'products') ? <Products userProfile={userProfile} /> : <Navigate to="/" replace />} />
                <Route path="/clients" element={hasMenuAccess(userProfile, 'clients') ? <Clients userProfile={userProfile} /> : <Navigate to="/" replace />} />
                <Route path="/pos" element={hasMenuAccess(userProfile, 'pos') ? <POS userProfile={userProfile} /> : <Navigate to="/" replace />} />
                <Route path="/cash-session" element={hasMenuAccess(userProfile, 'pos') || hasMenuAccess(userProfile, 'invoices') ? <CashSession userProfile={userProfile} /> : <Navigate to="/" replace />} />
                <Route path="/sales" element={hasMenuAccess(userProfile, 'sales') ? <Sales userProfile={userProfile} /> : <Navigate to="/" replace />} />
                <Route path="/invoices" element={hasMenuAccess(userProfile, 'invoices') ? <Invoices userProfile={userProfile} /> : <Navigate to="/" replace />} />
                <Route path="/repairs" element={hasMenuAccess(userProfile, 'reparation') ? <Repairs userProfile={userProfile} /> : <Navigate to="/" replace />} />
                <Route path="/parts" element={hasMenuAccess(userProfile, 'pieces') ? <Parts userProfile={userProfile} /> : <Navigate to="/" replace />} />
                <Route path="/notes" element={hasMenuAccess(userProfile, 'notes') ? <Notes userProfile={userProfile} /> : <Navigate to="/" replace />} />
                <Route path="/users" element={userProfile?.role === 'admin' && hasMenuAccess(userProfile, 'users') ? <UsersManager userProfile={userProfile} /> : <Navigate to="/" replace />} />
                <Route path="/expenses" element={userProfile?.role === 'admin' ? <Expenses userProfile={userProfile} /> : <Navigate to="/" replace />} />
                <Route path="/reports" element={isAdminOwner(userProfile) ? <Reports userProfile={userProfile} /> : <Navigate to="/" replace />} />
                <Route path="/startup" element={<Navigate to="/settings#startup-settings" replace />} />
                {/* /settings accessible à tous : le composant Settings n'affiche que la carte "Mon code de sécurité" aux utilisateurs sans permission */}
                <Route path="/settings" element={<Settings
                  userProfile={userProfile}
                  deferredPrompt={deferredPrompt}
                  handleInstallApp={() => void handleInstallApp()}
                  isIOS={/iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream}
                  isStandalone={isAppInstalled}
                />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </div>
          </main>

          {updateAvailable && (
            <div role="status" className="fixed bottom-4 left-1/2 z-[120] flex w-[min(94vw,34rem)] -translate-x-1/2 items-center justify-between gap-3 rounded-2xl border border-indigo-200 bg-white p-3 shadow-xl">
              <p className="text-sm font-semibold text-slate-800">Nouvelle version disponible, actualiser</p>
              <button type="button" onClick={() => window.location.reload()} className="min-h-10 shrink-0 rounded-xl bg-indigo-600 px-4 text-xs font-bold text-white hover:bg-indigo-700">Actualiser</button>
            </div>
          )}
          {!isOnline && <OfflineBlocker />}
        </div>
        </StartupProvider>
      </Router>
    </ErrorBoundary>
  );
}
