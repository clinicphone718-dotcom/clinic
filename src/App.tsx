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
} from 'lucide-react';
import { cn } from './lib/utils';
import { UserProfile, Note } from './types';
import { getPendingOperations, syncPendingOperations } from './lib/offlineManager';
import { hasMenuAccess } from './lib/permissions';
import { APP_LOGO_URL, APP_NAME, APP_TAGLINE } from './config/brand';
import { ALLOW_SELF_SIGNUP } from './config/firebase';
export { hasMenuAccess } from './lib/permissions';

const NAV_SECTIONS = [
  {
    title: 'VENTE',
    items: [
      { id: 'dashboard', name: 'Tableau de bord', path: '/', icon: LayoutDashboard },
      { id: 'pos', name: 'Vente (POS)', path: '/pos', icon: ShoppingCart },
      { id: 'invoices', name: 'Clôture de caisse', path: '/cash-session', icon: CircleDollarSign },
      { id: 'sales', name: 'Historique', path: '/sales', icon: History },
      { id: 'invoices', name: 'Factures', path: '/invoices', icon: FileText },
    ],
  },
  {
    title: 'ATELIER',
    items: [
      { id: 'reparation', name: 'Partie Réparation', path: '/repairs', icon: Wrench },
      { id: 'pieces', name: 'Pièces Détachées', path: '/parts', icon: Package },
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
  handleTriggerSync
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
          className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-40 lg:hidden transition-opacity duration-300"
          onClick={() => setIsOpen(false)}
        />
      )}
      
      <aside className={cn(
        "fixed inset-y-0 left-0 z-50 w-[min(19rem,calc(100vw-2rem))] border-r border-slate-200/70 bg-white/95 shadow-xl shadow-slate-900/5 backdrop-blur-xl transition-transform duration-300 lg:translate-x-0 lg:w-64 lg:shadow-sm",
        isOpen ? "translate-x-0" : "-translate-x-full"
      )}>
        <div className="h-full flex flex-col">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-5">
            <h1 className="text-2xl font-black flex flex-col leading-none font-display">
              <span className="flex items-center gap-2 tracking-tight">
                {APP_LOGO_URL ? <img src={APP_LOGO_URL} alt="" className="h-7 w-7 rounded-lg object-cover" /> : (
                <ShoppingCart className="w-7 h-7 text-indigo-600 fill-indigo-100/40 animate-pulse" />
                )}
                <span className="bg-gradient-to-r from-indigo-600 via-indigo-500 to-cyan-500 bg-clip-text text-transparent">
                  {APP_NAME}
                </span>
              </span>
              <span className="text-[9px] font-black uppercase tracking-widest bg-gradient-to-r from-indigo-500 to-cyan-500 bg-clip-text text-transparent mt-1.5 font-sans">
                {APP_TAGLINE}
              </span>
            </h1>
            <button onClick={() => setIsOpen(false)} className="lg:hidden p-1.5 hover:bg-slate-50 rounded-lg transition-colors">
              <X className="w-5 h-5 text-slate-400" />
            </button>
          </div>

          <nav className="flex-1 space-y-5 overflow-y-auto px-4 py-6">
            {navSections.map(section => (
              <section key={section.title} aria-label={section.title}>
                <h2 className="mb-2 px-3 text-[9px] font-black tracking-[0.16em] text-slate-400">{section.title}</h2>
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
                          "flex min-h-10 items-center gap-3 rounded-xl px-4 py-2.5 text-xs font-extrabold transition-all duration-200 relative group",
                          isActive
                            ? "bg-indigo-600 text-white shadow-lg shadow-indigo-600/15"
                            : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                        )}
                      >
                        <Icon className={cn("h-4 w-4 transition-transform group-hover:scale-110", isActive ? "text-white" : "text-slate-400")} />
                        <span className="flex-1">{item.name}</span>
                        {item.id === 'notes' && todayNotesCount > 0 && (
                          <span className={cn(
                            "min-w-[18px] rounded-full px-2 py-0.5 text-center text-[10px] font-black",
                            isActive ? "bg-white text-indigo-600" : "bg-rose-500 text-white"
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
          <div className="px-4 py-3 border-t border-slate-100/60 bg-slate-50/30 space-y-3">
            {/* Connection and Sync Status */}
            {!isOnline ? (
              <div className="p-3 bg-amber-50/70 border border-amber-100 rounded-xl text-amber-800 text-xs">
                <div className="flex items-center gap-2 font-black uppercase tracking-wider text-[10px] mb-1">
                  <WifiOff className="w-3.5 h-3.5 text-amber-500 animate-pulse" />
                  Mode Hors-ligne
                </div>
                <p className="text-[11px] leading-relaxed font-medium text-slate-500">
                  Modifications sauvegardées localement. {pendingCount > 0 ? `${pendingCount} opération(s) en attente.` : 'Prêt pour reconnexion.'}
                </p>
              </div>
            ) : pendingCount > 0 ? (
              <div className="p-3 bg-indigo-50/70 border border-indigo-100 rounded-xl text-indigo-800 text-xs">
                <div className="flex items-center justify-between font-black uppercase tracking-wider text-[10px] mb-1">
                  <span className="flex items-center gap-1.5">
                    <RefreshCcw className={cn("w-3.5 h-3.5 text-indigo-500", syncing && "animate-spin")} />
                    Synchronisation
                  </span>
                  <span className="bg-indigo-600 text-white px-1.5 py-0.5 rounded-full text-[9px]">
                    {pendingCount}
                  </span>
                </div>
                <p className="text-[11px] leading-relaxed font-medium text-slate-500 mb-2">
                  Des modifications locales sont en attente d'envoi.
                </p>
                <button
                  disabled={syncing}
                  onClick={handleTriggerSync}
                  className="w-full py-1.5 px-3 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-lg text-[10px] font-black uppercase tracking-wider transition-colors"
                >
                  {syncing ? 'En cours...' : 'Synchroniser maintenant'}
                </button>
              </div>
            ) : null}

            {/* Install Prompt for Android / Desktop */}
            {deferredPrompt && (
              <div className="p-3 bg-gradient-to-br from-indigo-50/60 to-cyan-50/60 border border-indigo-100/60 rounded-xl text-indigo-950 text-xs shadow-xs">
                <div className="font-black uppercase tracking-wider text-[10px] text-indigo-700 mb-1">
                  ✨ Installer l'App
                </div>
                <p className="text-[11px] leading-relaxed font-medium text-slate-500 mb-2.5">
                  Lancez {APP_NAME} en plein écran directement depuis votre écran d'accueil.
                </p>
                <button
                  onClick={handleInstallApp}
                  className="w-full py-2 px-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-[10px] font-black uppercase tracking-wider transition-all shadow-sm flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Package className="w-3.5 h-3.5" />
                  Installer maintenant
                </button>
              </div>
            )}

            {/* Install Prompt Guide for iOS */}
            {isIOS && !isStandalone && (
              <div className="p-3 bg-gradient-to-br from-indigo-50/60 to-violet-50/60 border border-indigo-100/60 rounded-xl text-indigo-950 text-xs">
                <div className="font-black uppercase tracking-wider text-[10px] text-indigo-700 mb-1">
                  📲 Installer sur iPhone
                </div>
                <p className="text-[11px] leading-relaxed font-medium text-slate-500">
                  Appuyez sur <span className="font-bold">Partager</span> (<span className="text-[13px]">⎋</span>) puis sur <span className="font-bold">"Sur l'écran d'accueil"</span> (<span className="text-[13px]">⊕</span>).
                </p>
              </div>
            )}
          </div>

          <div className="border-t border-slate-100 bg-white/80 p-4">
            <div className="mb-3 flex items-center gap-3 rounded-2xl border border-slate-100 bg-slate-50/80 p-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-indigo-100 text-sm font-black text-indigo-700">
                {APP_LOGO_URL ? <img src={APP_LOGO_URL} alt="" className="h-full w-full object-cover" /> : (userProfile?.name || userProfile?.email || 'U').slice(0, 1).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-bold text-slate-800">{userProfile?.name || userProfile?.email || 'Utilisateur'}</p>
                <p className="mt-0.5 text-[10px] font-semibold text-slate-500">{userProfile?.role === 'admin' ? 'Administrateur' : 'Utilisateur'}</p>
              </div>
            </div>
            <button
              onClick={async () => {
                localStorage.clear();
                sessionStorage.clear();
                await signOut(auth);
                window.location.reload();
              }}
              className="flex items-center gap-3 w-full px-4 py-3 rounded-xl text-xs uppercase tracking-wider font-extrabold text-red-600 hover:bg-red-50 hover:text-red-700 transition-colors"
            >
              <LogOut className="w-4 h-4 text-red-500" />
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
        <div className="min-h-screen bg-slate-50/50 flex" onClick={() => {
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
          />
          
          <main className="flex-1 lg:pl-64 min-h-screen flex flex-col">
            <header className="h-16 bg-white/80 backdrop-blur-md border-b border-slate-100 flex items-center justify-between px-4 lg:px-8 sticky top-0 z-30 shadow-xs">
              <button 
                onClick={() => setSidebarOpen(true)}
                className="lg:hidden p-2 text-slate-500 hover:bg-slate-50 rounded-xl transition-colors"
              >
                <Menu className="w-5 h-5" />
              </button>

              {/* Online/Offline Status Indicator */}
              <div className="flex items-center gap-2">
                {isOnline ? (
                  <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-emerald-50 border border-emerald-200 rounded-xl text-[10px] font-black uppercase tracking-wider text-emerald-700 font-mono animate-in fade-in duration-300">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                    <span className="hidden sm:inline">En ligne</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-rose-50 border border-rose-200 rounded-xl text-[10px] font-black uppercase tracking-wider text-rose-700 font-mono animate-pulse">
                    <span className="w-1.5 h-1.5 rounded-full bg-rose-500 mr-0.5 animate-ping" />
                    <span>Hors ligne</span>
                  </div>
                )}

                {pendingCount > 0 && (
                  <button
                    onClick={handleTriggerSync}
                    disabled={syncing || !isOnline}
                    className={cn(
                      "flex items-center gap-1.5 px-3 py-1.5 border rounded-xl text-[10px] font-black uppercase tracking-wider transition-all",
                      isOnline
                        ? "bg-amber-50 hover:bg-amber-100 border-amber-200 text-amber-800 shadow-3xs cursor-pointer"
                        : "bg-slate-100 border-slate-200 text-slate-500 cursor-not-allowed"
                    )}
                    title={isOnline ? "Des opérations sont en attente de synchronisation. Cliquez pour synchroniser." : "Les opérations seront synchronisées dès le retour de la connexion."}
                  >
                    <RefreshCcw className={cn("w-3.5 h-3.5 text-amber-600", syncing && "animate-spin")} />
                    <span>{pendingCount} en attente</span>
                  </button>
                )}
              </div>
              
              {/* Interactive Date & Notes Notification Badge widget */}
              <div className="flex items-center gap-2 lg:gap-3.5 ml-2 sm:ml-4 relative" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-50 border border-slate-100 rounded-xl text-xs font-black text-slate-700 shadow-3xs font-mono">
                  <Calendar className="w-3.5 h-3.5 text-indigo-500" />
                  <span>{getFormattedDate()}</span>
                </div>

                {hasMenuAccess(userProfile, 'notes') ? (
                <div className="relative">
                  <button
                    onClick={() => setShowNotesPopover(!showNotesPopover)}
                    className={cn(
                      "p-2 rounded-xl border transition-all duration-300 relative cursor-pointer",
                      todayNotes.length > 0
                        ? "bg-amber-50 hover:bg-amber-100 border-amber-200/60 text-amber-600 shadow-sm"
                        : "bg-slate-50 hover:bg-slate-100 border-slate-100 text-slate-400"
                    )}
                    title={todayNotes.length > 0 ? `${todayNotes.length} mémo(s) pour aujourd'hui !` : "Aucun mémo aujourd'hui"}
                  >
                    <Bell className={cn("w-4 h-4", todayNotes.length > 0 && "animate-bounce duration-1000")} />
                    {todayNotes.length > 0 && (
                      <span className="absolute -top-1 -right-1 w-4 h-4 bg-rose-500 text-[9px] text-white font-black rounded-full flex items-center justify-center border-2 border-white shadow-xs">
                        {todayNotes.length}
                      </span>
                    )}
                  </button>

                  {/* Dropdown Popover with real-time notes */}
                  {showNotesPopover && (
                    <div className="absolute left-0 mt-2.5 w-76 sm:w-80 bg-white border border-slate-100 rounded-2xl shadow-xl z-50 p-4 animate-in fade-in slide-in-from-top-2 duration-200">
                      <div className="flex items-center justify-between border-b border-slate-50 pb-2.5 mb-2.5">
                        <span className="text-xs font-black text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                          <StickyNote className="w-4 h-4 text-indigo-500 animate-pulse" />
                          Mémos d'aujourd'hui
                        </span>
                        <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-md text-slate-500 bg-slate-50 border border-slate-100">
                          {todayNotes.length} actif{todayNotes.length > 1 ? 's' : ''}
                        </span>
                      </div>

                      <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                        {todayNotes.length === 0 ? (
                          <div className="text-center py-4 text-slate-400">
                            <CheckCircle className="w-7 h-7 text-emerald-400 mx-auto mb-1.5" />
                            <p className="text-[10px] font-[900] uppercase tracking-wide text-slate-500">Tout est en ordre</p>
                            <p className="text-[9px] font-semibold text-slate-400 mt-0.5">Aucun mémo pour aujourd’hui.</p>
                          </div>
                        ) : (
                          todayNotes.map((note) => (
                            <div key={note.id} className="p-2.5 rounded-xl bg-slate-50/50 border border-slate-100/80 hover:border-indigo-100 hover:bg-indigo-50/10 transition-colors">
                              <p className="text-xs font-extrabold text-slate-800 tracking-tight">{note.title}</p>
                              <p className="text-[10px] text-slate-500 font-medium mt-1 line-clamp-3 leading-relaxed">{note.content}</p>
                            </div>
                          ))
                        )}
                      </div>

                      <div className="border-t border-slate-50 mt-3 pt-2.5 text-center">
                        <Link
                          to="/notes"
                          onClick={() => setShowNotesPopover(false)}
                          className="inline-flex items-center justify-center w-full py-2 bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-700 hover:to-indigo-600 text-white text-[10px] uppercase tracking-wider font-extrabold rounded-xl transition-all shadow-md shadow-indigo-600/10"
                        >
                          Gérer tous les mémos
                        </Link>
                      </div>
                    </div>
                  )}
                </div>
                ) : (
                  <button
                    type="button"
                    aria-label="Notifications"
                    title="Notifications"
                    disabled
                    className="p-2 rounded-xl border border-slate-100 bg-slate-50 text-slate-400 cursor-not-allowed"
                  >
                    <Bell className="w-4 h-4" />
                  </button>
                )}
              </div>

              <div className="flex-1"></div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-slate-500 font-semibold hidden sm:block bg-slate-100 px-3 py-1 rounded-full">{user.email}</span>
                <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-600 to-cyan-500 flex items-center justify-center text-white font-black font-display text-sm shadow-md shadow-indigo-600/15">
                  {APP_LOGO_URL ? <img src={APP_LOGO_URL} alt={APP_NAME} className="h-full w-full rounded-xl object-cover" /> : user.email?.[0].toUpperCase()}
                </div>
              </div>
            </header>
 
            <div className="mx-auto w-full max-w-[1800px] flex-1 p-4 lg:p-8">
              <Routes>
                <Route path="/" element={hasMenuAccess(userProfile, 'dashboard') ? <Dashboard userProfile={userProfile} /> : <Navigate to={getFirstAccessiblePath(userProfile)} replace />} />
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
