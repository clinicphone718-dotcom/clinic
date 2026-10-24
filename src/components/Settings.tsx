import React, { useState, useEffect } from 'react';
import { doc, onSnapshot, setDoc, updateDoc, collection, getDocs, query, where, deleteDoc, serverTimestamp } from 'firebase/firestore';
import { EmailAuthProvider, reauthenticateWithCredential } from 'firebase/auth';
import { db, auth } from '../firebase';
import { getDownloadURL, getStorage, ref, uploadBytes } from 'firebase/storage';
import { APP_NAME } from '../config/brand';
import { StoreSettings, UserProfile } from '../types';
import { handleFirestoreError, OperationType, hasMenuAccess } from '../App';
import { Edit2, X, Settings as SettingsIcon, CheckCircle2, Store, Save, Download, Trash2, Database, AlertTriangle, Calendar, Eye, FileText, KeyRound, Lock, ShieldCheck, Music2, Upload } from 'lucide-react';
import { cn } from '../lib/utils';
import * as XLSX from 'xlsx';
import { can } from '../lib/permissions';
import { useStartup } from './StartupProvider';
import { adhkarLibrary } from '../data/adhkar';
import { verses } from '../data/verses';
import { isDirectAudioUrl } from '../lib/startup';

interface SettingsProps {
  userProfile: UserProfile | null;
}

// ── Carte "Mon code de sécurité" : chaque utilisateur peut changer son propre code à 4 chiffres.
// Vérification obligatoire avant le changement : mot de passe du compte OU code reçu par email.
function SecurityCodeCard({ userProfile }: { userProfile: UserProfile | null }) {
  const [newCode, setNewCode] = useState('');
  const [confirmCode, setConfirmCode] = useState('');
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const onlyDigits = (v: string, max: number) => v.replace(/\D/g, '').slice(0, max);

  const validateCodes = (): boolean => {
    setError('');
    if (!/^\d{4}$/.test(newCode)) {
      setError('Le nouveau code doit contenir exactement 4 chiffres.');
      return false;
    }
    if (newCode !== confirmCode) {
      setError('La confirmation ne correspond pas au nouveau code.');
      return false;
    }
    return true;
  };

  const handleChangeCode = async () => {
    if (!validateCodes()) return;
    if (!userProfile?.uid) return;
    if (!password) {
      setError('Veuillez saisir votre mot de passe.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const currentUser = auth.currentUser;
      if (!currentUser || !currentUser.email) {
        throw new Error('Session invalide. Veuillez vous reconnecter.');
      }
      try {
        const credential = EmailAuthProvider.credential(currentUser.email, password);
        await reauthenticateWithCredential(currentUser, credential);
      } catch (authErr: any) {
        if (authErr?.code === 'auth/wrong-password' || authErr?.code === 'auth/invalid-credential' || authErr?.code === 'auth/invalid-login-credentials') {
          throw new Error('Mot de passe incorrect.');
        }
        if (authErr?.code === 'auth/too-many-requests') {
          throw new Error('Trop de tentatives. Veuillez réessayer plus tard.');
        }
        throw new Error('Vérification du mot de passe impossible. Veuillez vous reconnecter et réessayer.');
      }

      // Vérification réussie : mise à jour du code de sécurité (autorisé par les règles Firestore : auto-modification)
      await updateDoc(doc(db, 'users', userProfile.uid), { securityCode: newCode });

      setSuccessMsg('Votre code de sécurité a été modifié avec succès !');
      setNewCode('');
      setConfirmCode('');
      setPassword('');
      setTimeout(() => setSuccessMsg(''), 5000);
    } catch (err: any) {
      setError(err.message || 'Une erreur est survenue lors du changement de code.');
    } finally {
      setSaving(false);
    }
  };

  const codeInputClass = "w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-semibold transition-all outline-none focus:ring-2 focus:ring-indigo-500/10 focus:border-indigo-500 tracking-[0.5em] text-center";

  return (
    <div className="bg-white rounded-3xl border border-slate-100 shadow-xs overflow-hidden premium-shadow">
      <div className="p-6 border-b border-slate-100 bg-slate-50/50 flex items-center gap-3">
        <div className="p-2 bg-rose-50 text-rose-600 rounded-xl">
          <KeyRound className="w-5 h-5" />
        </div>
        <div>
          <h2 className="font-bold text-slate-800 text-sm">Mon Code de Sécurité</h2>
          <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Code à 4 chiffres pour les actions protégées</p>
        </div>
      </div>

      <div className="p-6 space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block font-bold">Nouveau code (4 chiffres)</label>
            <input
              type="password"
              inputMode="numeric"
              autoComplete="off"
              maxLength={4}
              value={newCode}
              onChange={(e) => setNewCode(onlyDigits(e.target.value, 4))}
              className={codeInputClass}
              placeholder="••••"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block font-bold">Confirmer le nouveau code</label>
            <input
              type="password"
              inputMode="numeric"
              autoComplete="off"
              maxLength={4}
              value={confirmCode}
              onChange={(e) => setConfirmCode(onlyDigits(e.target.value, 4))}
              className={codeInputClass}
              placeholder="••••"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block font-bold">Votre mot de passe</label>
          <div className="relative">
            <Lock className="w-3.5 h-3.5 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full pl-9 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-semibold transition-all outline-none focus:ring-2 focus:ring-indigo-500/10 focus:border-indigo-500"
              placeholder="Mot de passe de votre compte"
            />
          </div>
          <p className="text-[10px] text-slate-400 font-medium">Votre mot de passe est requis pour confirmer le changement de code.</p>
        </div>

        {error && (
          <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-100 rounded-xl">
            <AlertTriangle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
            <p className="text-[11px] text-red-600 font-semibold">{error}</p>
          </div>
        )}

        {successMsg && (
          <div className="flex items-start gap-2 p-3 bg-emerald-50 border border-emerald-100 rounded-xl">
            <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
            <p className="text-[11px] text-emerald-600 font-semibold">{successMsg}</p>
          </div>
        )}

        <button
          type="button"
          onClick={handleChangeCode}
          disabled={saving || newCode.length !== 4 || confirmCode.length !== 4 || !password}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-indigo-600 text-white text-xs font-bold rounded-xl hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed uppercase tracking-wider"
        >
          <ShieldCheck className="w-4 h-4" />
          {saving ? 'Vérification...' : 'Changer mon code'}
        </button>
      </div>
    </div>
  );
}

export default function Settings({ userProfile }: SettingsProps) {
  const [storeSettings, setStoreSettings] = useState<StoreSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [success, setSuccess] = useState<string | null>(null);

  const ownerId = (userProfile?.role === 'admin' ? userProfile?.uid : userProfile?.ownerId) || userProfile?.uid || auth.currentUser?.uid;
  const { config: startupConfig, canManage: canManageStartup } = useStartup();
  const [startupEnabled, setStartupEnabled] = useState(startupConfig.enabled);
  const [welcomeTitle, setWelcomeTitle] = useState(startupConfig.welcomeTitle || verses[0].title);
  const [welcomeText, setWelcomeText] = useState(startupConfig.welcomeText || verses[0].text);
  const [welcomeSource, setWelcomeSource] = useState(startupConfig.welcomeSource || verses[0].source);
  const [startupAudioUrl, setStartupAudioUrl] = useState(startupConfig.audioUrl || '');
  const [startupSaving, setStartupSaving] = useState(false);
  const [startupMessage, setStartupMessage] = useState('');
  const [audioUploading, setAudioUploading] = useState(false);
  const audioFileInput = React.useRef<HTMLInputElement>(null);
  const welcomeChoices = [
    ...verses.map((verse) => ({ id: `verse:${verse.title}`, ...verse })),
    ...adhkarLibrary.map((adhkar) => ({ id: `dhikr:${adhkar.section}:${adhkar.title}`, ...adhkar })),
  ];
  const selectedWelcomeChoice = welcomeChoices.find(
    (choice) => choice.title === welcomeTitle && choice.text === welcomeText,
  )?.id || 'custom';

  useEffect(() => {
    setStartupEnabled(startupConfig.enabled);
    setWelcomeTitle(startupConfig.welcomeTitle || verses[0].title);
    setWelcomeText(startupConfig.welcomeText || verses[0].text);
    setWelcomeSource(startupConfig.welcomeSource || verses[0].source);
    setStartupAudioUrl(startupConfig.audioUrl || '');
  }, [
    startupConfig.enabled,
    startupConfig.welcomeTitle,
    startupConfig.welcomeText,
    startupConfig.welcomeSource,
    startupConfig.audioUrl,
  ]);

  const saveStartupSettings = async () => {
    if (!ownerId) {
      setStartupMessage('Propriétaire du magasin introuvable.');
      return;
    }
    if (!welcomeTitle.trim() || !welcomeText.trim()) {
      setStartupMessage('Le titre et le texte sont obligatoires.');
      return;
    }
    if (startupAudioUrl && !isDirectAudioUrl(startupAudioUrl)) {
      setStartupMessage('Utilisez un lien HTTPS direct vers un fichier .mp3 ou .m4a.');
      return;
    }

    setStartupSaving(true);
    setStartupMessage('');
    try {
      await setDoc(doc(db, 'startup_config', ownerId), {
        ownerId,
        ...startupConfig,
        enabled: startupEnabled,
        welcomeTitle: welcomeTitle.trim(),
        welcomeText: welcomeText.trim(),
        welcomeSource: welcomeSource.trim(),
        audioUrl: startupAudioUrl.trim(),
        updatedAt: serverTimestamp(),
      }, { merge: true });
      setStartupMessage('Réglages Coran & Adhkar enregistrés.');
    } catch (saveError) {
      console.error('Unable to save startup settings:', saveError);
      setStartupMessage('Impossible d’enregistrer les réglages. Vérifiez les permissions Firestore.');
    } finally {
      setStartupSaving(false);
    }
  };

  const uploadStartupAudio = async (file?: File) => {
    if (!file) return;
    if (!ownerId) {
      setStartupMessage('Propriétaire du magasin introuvable.');
      return;
    }
    if (!/\.(mp3|m4a)$/i.test(file.name) || (file.type && !['audio/mpeg', 'audio/mp4', 'audio/x-m4a'].includes(file.type))) {
      setStartupMessage('Choisissez un fichier audio .mp3 ou .m4a.');
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      setStartupMessage('Le fichier audio ne doit pas dépasser 20 Mo.');
      return;
    }

    setAudioUploading(true);
    setStartupMessage('');
    try {
      const objectName = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      const audioRef = ref(getStorage(), `startup-audio/${ownerId}/${objectName}`);
      const uploaded = await uploadBytes(audioRef, file, { contentType: file.type || 'audio/mpeg' });
      const downloadUrl = await getDownloadURL(uploaded.ref);
      setStartupAudioUrl(downloadUrl);
      setStartupMessage('Fichier envoyé. Enregistrez les réglages pour l’activer.');
    } catch (uploadError) {
      console.error('Unable to upload startup audio:', uploadError);
      setStartupMessage('Impossible de téléverser le fichier. Vérifiez que Firebase Storage est activé et autorisé.');
    } finally {
      setAudioUploading(false);
      if (audioFileInput.current) audioFileInput.current.value = '';
    }
  };

  if (userProfile && !hasMenuAccess(userProfile, 'settings')) {
    // L'utilisateur n'a pas accès aux paramètres du magasin,
    // mais il peut toujours changer son propre code de sécurité.
    return (
      <div className="space-y-6 max-w-4xl mx-auto">
        <div>
          <h1 className="text-2xl font-black text-slate-800 tracking-tight flex items-center gap-2">
            <SettingsIcon className="w-7 h-7 text-indigo-600 fill-indigo-100/40" />
            Paramètres
          </h1>
          <p className="text-xs text-slate-500 font-medium">
            Gérez votre code de sécurité personnel. Les paramètres du magasin sont réservés aux utilisateurs autorisés.
          </p>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
          <SecurityCodeCard userProfile={userProfile} />
        </div>
      </div>
    );
  }

  // Form state for store settings - always editable now
  const [storeFormData, setStoreFormData] = useState({
    storeName: '',
    currency: '',
    address: '',
    phone: '',
    tva: 19,
    tvaEnabled: true,
    deleteCode: '',
    minStockAlert: 5
  });

  // Database maintenance states
  const [isExporting, setIsExporting] = useState(false);
  const [isPurging, setIsPurging] = useState(false);
  const [purgeDate, setPurgeDate] = useState('');
  const [purgeSales, setPurgeSales] = useState(true);
  const [purgeInvoices, setPurgeInvoices] = useState(true);

  // Activity log (journal d'activité) states
  const [activityStartDate, setActivityStartDate] = useState('');
  const [activityEndDate, setActivityEndDate] = useState('');
  const [isGeneratingActivity, setIsGeneratingActivity] = useState(false);
  const [activityError, setActivityError] = useState('');

  const todayStr = new Date().toISOString().split('T')[0];

  const validateActivityRange = (): { start: Date; end: Date } | null => {
    setActivityError('');

    if (!activityStartDate || !activityEndDate) {
      setActivityError('Veuillez sélectionner une date de début et une date de fin.');
      return null;
    }

    const start = new Date(activityStartDate);
    start.setHours(0, 0, 0, 0);
    const end = new Date(activityEndDate);
    end.setHours(23, 59, 59, 999);

    if (end < start) {
      setActivityError('La date de fin doit être postérieure ou égale à la date de début.');
      return null;
    }

    const diffDays = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
    if (diffDays > 31) {
      setActivityError('La période sélectionnée ne peut pas dépasser 1 mois (31 jours maximum).');
      return null;
    }

    return { start, end };
  };

  const toJsDate = (d: any): Date | null => {
    if (!d) return null;
    if (typeof d.toDate === 'function') return d.toDate();
    const parsed = new Date(d);
    return isNaN(parsed.getTime()) ? null : parsed;
  };

  const fetchActivityRecords = async (start: Date, end: Date) => {
    const salesSnap = await getDocs(query(collection(db, 'sales'), where('ownerId', '==', ownerId)));
    const invoicesSnap = await getDocs(query(collection(db, 'invoices'), where('ownerId', '==', ownerId)));
    const auditLogsSnap = await getDocs(query(collection(db, 'audit_logs'), where('ownerId', '==', ownerId)));

    const salesInRange = salesSnap.docs
      .map(d => ({ id: d.id, ...d.data() } as any))
      .filter(s => { const dt = toJsDate(s.date); return !!dt && dt >= start && dt <= end; })
      .sort((a, b) => toJsDate(a.date)!.getTime() - toJsDate(b.date)!.getTime());

    const invoicesInRange = invoicesSnap.docs
      .map(d => ({ id: d.id, ...d.data() } as any))
      .filter(inv => { const dt = toJsDate(inv.date); return !!dt && dt >= start && dt <= end; })
      .sort((a, b) => toJsDate(a.date)!.getTime() - toJsDate(b.date)!.getTime());

    const auditLogsInRange = auditLogsSnap.docs
      .map(d => ({ id: d.id, ...d.data() } as any))
      .filter(l => { const dt = toJsDate(l.timestamp); return !!dt && dt >= start && dt <= end; })
      .sort((a, b) => toJsDate(a.timestamp)!.getTime() - toJsDate(b.timestamp)!.getTime());

    return { salesInRange, invoicesInRange, auditLogsInRange };
  };

  const actionLabels: Record<string, string> = {
    CREATE_PRODUCT: 'Création de produit',
    UPDATE_PRODUCT: 'Modification de produit',
    DELETE_PRODUCT: 'Suppression de produit',
    DELETE_SALE: 'Suppression de vente'
  };

  const handleDownloadActivityLog = async () => {
    const range = validateActivityRange();
    if (!range) return;
    const { start, end } = range;

    setIsGeneratingActivity(true);
    try {
      const { salesInRange, invoicesInRange, auditLogsInRange } = await fetchActivityRecords(start, end);

      if (salesInRange.length === 0 && invoicesInRange.length === 0 && auditLogsInRange.length === 0) {
        setActivityError('Aucune activité trouvée pour la période sélectionnée.');
        setIsGeneratingActivity(false);
        return;
      }

      const fmtDateTime = (dt: Date) => `${dt.toLocaleDateString('fr-FR')} ${dt.toLocaleTimeString('fr-FR')}`;

      const journalOperations = auditLogsInRange.map(l => {
        const dt = toJsDate(l.timestamp);
        let details = '';
        if (l.action === 'DELETE_SALE') {
          details = `Ticket ${l.ticketId || ''} — Facture ${l.invoiceNumber || 'N/A'} — Total ${l.total || 0} DT`;
        } else if (l.productName) {
          details = `Produit : ${l.productName}`;
        }
        return {
          'Date & Heure': dt ? fmtDateTime(dt) : '',
          'Opération': actionLabels[l.action] || l.action || 'N/A',
          'Utilisateur': l.userName && l.userName !== 'unknown' ? l.userName : (l.userEmail || 'N/A'),
          'Détails': details
        };
      });

      const journalVentes = salesInRange.map(s => {
        const dt = toJsDate(s.date);
        const itemsString = s.items ? s.items.map((it: any) => `${it.name} (${it.quantity} x ${it.price} DT)`).join(', ') : '';
        return {
          'Date & Heure': dt ? fmtDateTime(dt) : '',
          'Référence': s.id,
          'Client': s.clientName || 'Client de passage',
          'Total TTC (DT)': s.total || 0,
          'Payé (DT)': s.paid || 0,
          'Dette (DT)': s.debt || 0,
          'TVA (DT)': s.tva || 0,
          'Facture associée': s.invoiceId || 'N/A',
          'Détail des articles': itemsString
        };
      });

      const journalFactures = invoicesInRange.map(inv => {
        const dt = toJsDate(inv.date);
        const itemsString = inv.items ? inv.items.map((it: any) => `${it.name} (${it.quantity} x ${it.price} DT)`).join(', ') : '';
        return {
          'Date & Heure': dt ? fmtDateTime(dt) : '',
          'Numéro de facture': inv.number || inv.id,
          'Client': inv.clientName || '',
          'Téléphone': inv.clientPhone || '',
          'Total TTC (DT)': inv.total || 0,
          'Payé (DT)': inv.paid || 0,
          'Dette (DT)': inv.debt || 0,
          'TVA (DT)': inv.tva || 0,
          'Détail des articles': itemsString
        };
      });

      const totalCA = salesInRange.reduce((sum, s) => sum + (s.total || 0), 0);
      const totalPaye = salesInRange.reduce((sum, s) => sum + (s.paid || 0), 0);
      const totalDette = salesInRange.reduce((sum, s) => sum + (s.debt || 0), 0);
      const totalTva = salesInRange.reduce((sum, s) => sum + (s.tva || 0), 0);

      const resume = [
        { 'Indicateur': 'Magasin', 'Valeur': storeFormData.storeName || 'Magasin' },
        { 'Indicateur': 'Période', 'Valeur': `Du ${start.toLocaleDateString('fr-FR')} au ${end.toLocaleDateString('fr-FR')}` },
        { 'Indicateur': 'Nombre de ventes', 'Valeur': salesInRange.length },
        { 'Indicateur': 'Nombre de factures', 'Valeur': invoicesInRange.length },
        { 'Indicateur': 'Nombre d\'opérations (produits, suppressions...)', 'Valeur': auditLogsInRange.length },
        { 'Indicateur': "Chiffre d'affaires total (DT)", 'Valeur': totalCA.toFixed(2) },
        { 'Indicateur': 'Total encaissé (DT)', 'Valeur': totalPaye.toFixed(2) },
        { 'Indicateur': 'Total dettes générées (DT)', 'Valeur': totalDette.toFixed(2) },
        { 'Indicateur': 'Total TVA collectée (DT)', 'Valeur': totalTva.toFixed(2) },
        { 'Indicateur': 'Date de génération', 'Valeur': fmtDateTime(new Date()) }
      ];

      const wb = XLSX.utils.book_new();
      const resumeSheet = XLSX.utils.json_to_sheet(resume);
      const ventesSheet = XLSX.utils.json_to_sheet(journalVentes);
      const facturesSheet = XLSX.utils.json_to_sheet(journalFactures);
      const operationsSheet = XLSX.utils.json_to_sheet(journalOperations);

      XLSX.utils.book_append_sheet(wb, resumeSheet, 'Résumé');
      XLSX.utils.book_append_sheet(wb, ventesSheet, 'Ventes');
      XLSX.utils.book_append_sheet(wb, facturesSheet, 'Factures');
      XLSX.utils.book_append_sheet(wb, operationsSheet, 'Opérations');

      const fileName = `Journal_Activite_${activityStartDate}_au_${activityEndDate}.xlsx`;
      XLSX.writeFile(wb, fileName);

      setSuccess('Journal d\'activité téléchargé avec succès !');
      setTimeout(() => setSuccess(null), 3000);
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, `sales|invoices|audit_logs/${ownerId}`);
    } finally {
      setIsGeneratingActivity(false);
    }
  };

  // Affichage du journal directement dans l'application (style fichier log), sans téléchargement
  const [showActivityLogModal, setShowActivityLogModal] = useState(false);
  const [activityLogLines, setActivityLogLines] = useState<string[]>([]);
  const [isLoadingActivityView, setIsLoadingActivityView] = useState(false);

  const handleViewActivityLog = async () => {
    const range = validateActivityRange();
    if (!range) return;
    const { start, end } = range;

    setIsLoadingActivityView(true);
    try {
      const { salesInRange, invoicesInRange, auditLogsInRange } = await fetchActivityRecords(start, end);

      if (salesInRange.length === 0 && invoicesInRange.length === 0 && auditLogsInRange.length === 0) {
        setActivityError('Aucune activité trouvée pour la période sélectionnée.');
        setIsLoadingActivityView(false);
        return;
      }

      const fmtDateTime = (dt: Date) => `${dt.toLocaleDateString('fr-FR')} ${dt.toLocaleTimeString('fr-FR')}`;

      type LogLine = { dt: Date; text: string };
      const lines: LogLine[] = [];

      salesInRange.forEach(s => {
        const dt = toJsDate(s.date);
        if (!dt) return;
        const client = s.clientName || 'Client de passage';
        lines.push({ dt, text: `[${fmtDateTime(dt)}] VENTE      | Réf ${s.id} | Client: ${client} | Total: ${(s.total || 0).toFixed(2)} DT | Payé: ${(s.paid || 0).toFixed(2)} DT | Dette: ${(s.debt || 0).toFixed(2)} DT` });
      });

      invoicesInRange.forEach(inv => {
        const dt = toJsDate(inv.date);
        if (!dt) return;
        lines.push({ dt, text: `[${fmtDateTime(dt)}] FACTURE    | N° ${inv.number || inv.id} | Client: ${inv.clientName || 'N/A'} | Total: ${(inv.total || 0).toFixed(2)} DT` });
      });

      auditLogsInRange.forEach(l => {
        const dt = toJsDate(l.timestamp);
        if (!dt) return;
        const label = (actionLabels[l.action] || l.action || 'OPÉRATION').toUpperCase();
        const user = l.userName && l.userName !== 'unknown' ? l.userName : (l.userEmail || 'N/A');
        let details = '';
        if (l.action === 'DELETE_SALE') {
          details = `Ticket ${l.ticketId || ''} | Facture ${l.invoiceNumber || 'N/A'} | Total: ${(l.total || 0).toFixed(2)} DT`;
        } else if (l.productName) {
          details = `Produit: ${l.productName}`;
        }
        lines.push({ dt, text: `[${fmtDateTime(dt)}] ${label.padEnd(10, ' ')} | Par: ${user} | ${details}` });
      });

      lines.sort((a, b) => a.dt.getTime() - b.dt.getTime());

      setActivityLogLines(lines.map(l => l.text));
      setShowActivityLogModal(true);
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, `sales|invoices|audit_logs/${ownerId}`);
    } finally {
      setIsLoadingActivityView(false);
    }
  };

  const handleExportExcel = async () => {
    setIsExporting(true);
    try {
      const isAdmin = userProfile?.role === 'admin';
      const canViewProductBuyPrice = can(userProfile, 'products', 'viewBuyPrice');
      const [productsSnap, clientsSnap, salesSnap, invoicesSnap, productCostsSnap] = await Promise.all([
        getDocs(query(collection(db, 'products'), where('ownerId', '==', ownerId))),
        getDocs(query(collection(db, 'clients'), where('ownerId', '==', ownerId))),
        getDocs(query(collection(db, 'sales'), where('ownerId', '==', ownerId))),
        getDocs(query(collection(db, 'invoices'), where('ownerId', '==', ownerId))),
        canViewProductBuyPrice
          ? getDocs(query(collection(db, 'product_costs'), where('ownerId', '==', ownerId)))
          : Promise.resolve(null),
      ]);
      const productCosts = Object.fromEntries(
        productCostsSnap?.docs.map(item => [item.id, Number(item.data().buyPrice) || 0]) || []
      );

      const productsData = productsSnap.docs.map(doc => {
        const d = doc.data();
        return {
          'ID Produit': doc.id,
          'Nom de l\'article': d.name || '',
          'Catégorie': d.category || '',
          ...(canViewProductBuyPrice ? { 'Prix d\'achat (DT)': productCosts[doc.id] ?? (isAdmin ? Number(d.buyPrice) || 0 : 0) } : {}),
          'Prix de vente (DT)': d.sellPrice || 0,
          'Code à barre': d.barcode || '',
          'Stock restant': d.stock || 0,
          'Alerte Stock Bas': d.lowStockAlert || 0,
          'Date d\'expiration': d.expirationDate || ''
        };
      });

      const clientsData = clientsSnap.docs.map(doc => {
        const d = doc.data();
        return {
          'ID Client': doc.id,
          'Code Client': d.code || '',
          'Nom complet': d.name || '',
          'Téléphone': d.phone || '',
          'Adresse': d.address || '',
          'Dette Actuelle (DT)': d.debt || 0
        };
      });

      const salesData = salesSnap.docs.map(doc => {
        const d = doc.data();
        let formattedDate = '';
        if (d.date) {
          if (d.date.toDate) formattedDate = d.date.toDate().toLocaleDateString('fr-FR') + ' ' + d.date.toDate().toLocaleTimeString('fr-FR');
          else formattedDate = String(d.date);
        }
        const itemsString = d.items ? d.items.map((it: any) => `${it.name} (${it.quantity} x ${it.price} DT)`).join(', ') : '';
        return {
          'ID de la Vente': doc.id,
          'Date': formattedDate,
          'Client': d.clientName || 'Client de passage',
          'Total TTC (DT)': d.total || 0,
          'Montant payé (DT)': d.paid || 0,
          'Dette restante (DT)': d.debt || 0,
          'Montant TVA (DT)': d.tva || 0,
          'ID Facture associée': d.invoiceId || 'N/A',
          'Détail des Articles': itemsString
        };
      });

      const invoicesData = invoicesSnap.docs.map(doc => {
        const d = doc.data();
        let formattedDate = '';
        if (d.date) {
          if (d.date.toDate) formattedDate = d.date.toDate().toLocaleDateString('fr-FR') + ' ' + d.date.toDate().toLocaleTimeString('fr-FR');
          else formattedDate = String(d.date);
        }
        const itemsString = d.items ? d.items.map((it: any) => `${it.name} (${it.quantity} x ${it.price} DT)`).join(', ') : '';
        return {
          'ID de la Facture': doc.id,
          'Numéro de Facture': d.number || '',
          'ID de la Vente': d.saleId || '',
          'Nom Client': d.clientName || '',
          'Téléphone Client': d.clientPhone || '',
          'Adresse Client': d.clientAddress || '',
          'Total Facture (DT)': d.total || 0,
          'Payé (DT)': d.paid || 0,
          'Dette (DT)': d.debt || 0,
          'TVA (DT)': d.tva || 0,
          'Date de Facturation': formattedDate,
          'Articles': itemsString
        };
      });

      const wb = XLSX.utils.book_new();

      const productsSheet = XLSX.utils.json_to_sheet(productsData);
      const clientsSheet = XLSX.utils.json_to_sheet(clientsData);
      const salesSheet = XLSX.utils.json_to_sheet(salesData);
      const invoicesSheet = XLSX.utils.json_to_sheet(invoicesData);

      XLSX.utils.book_append_sheet(wb, productsSheet, 'Produits');
      XLSX.utils.book_append_sheet(wb, clientsSheet, 'Clients');
      XLSX.utils.book_append_sheet(wb, salesSheet, 'Ventes');
      XLSX.utils.book_append_sheet(wb, invoicesSheet, 'Factures');

      const fileName = `Export_Base_${(storeFormData.storeName || 'Magasin').replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.xlsx`;
      XLSX.writeFile(wb, fileName);

      setSuccess('Base de données exportée en fichier Excel avec succès !');
      setTimeout(() => setSuccess(null), 4000);
    } catch (error) {
      console.error('Erreur export :', error);
      alert('Une erreur est survenue lors de l\'exportation de la base de données.');
    } finally {
      setIsExporting(false);
    }
  };

  const handlePurgeDatabase = async () => {
    if (!purgeDate) {
      alert("Veuillez sélectionner une date limite.");
      return;
    }

    const limitDate = new Date(purgeDate);
    limitDate.setHours(23, 59, 59, 999);

    const checkConfirm = window.confirm(
      `ATTENTION : Vous allez supprimer TOUTES les transactions antérieures au ${limitDate.toLocaleDateString('fr-FR')} incluse.\n\nCette action est irréversible et supprimera définitivement les données sélectionnées.\n\nÊtes-vous absolument sûr ?`
    );

    if (!checkConfirm) {
      return;
    }

    const confirmationInput = prompt(
      `Pour confirmer la suppression et l'allègement de la base, veuillez écrire le mot PURGER en majuscules :`
    );

    if (confirmationInput !== 'PURGER') {
      alert("Purge annulée. La confirmation tapée est incorrecte.");
      return;
    }

    setIsPurging(true);
    try {
      let salesDeleted = 0;
      let invoicesDeleted = 0;

      if (purgeSales) {
        const salesQuery = query(collection(db, 'sales'), where('ownerId', '==', ownerId), where('date', '<=', limitDate));
        const salesSnap = await getDocs(salesQuery);
        for (const docSnap of salesSnap.docs) {
          await deleteDoc(docSnap.ref);
          salesDeleted++;
        }
      }

      if (purgeInvoices) {
        const invoicesQuery = query(collection(db, 'invoices'), where('ownerId', '==', ownerId), where('date', '<=', limitDate));
        const invoicesSnap = await getDocs(invoicesQuery);
        for (const docSnap of invoicesSnap.docs) {
          await deleteDoc(docSnap.ref);
          invoicesDeleted++;
        }
      }

      setSuccess(`Purge complétée ! ${salesDeleted} ventes et ${invoicesDeleted} factures antérieures au ${limitDate.toLocaleDateString('fr-FR')} ont été définitivement nettoyées.`);
      setTimeout(() => setSuccess(null), 5000);
    } catch (error) {
      console.error('Erreur purge:', error);
      alert('Une erreur est survenue lors de la purge de la base de données.');
    } finally {
      setIsPurging(false);
    }
  };

  useEffect(() => {
    if (!auth.currentUser || !ownerId) return;
    const unsubscribeStore = onSnapshot(doc(db, 'settings', ownerId), (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data() as StoreSettings;
        setStoreSettings({ ...data, id: snapshot.id });
        setStoreFormData({
          storeName: data.storeName || '',
          currency: data.currency || '',
          address: data.address || '',
          phone: data.phone || '',
          tva: data.tva !== undefined ? data.tva : 19,
          tvaEnabled: data.tvaEnabled !== false,
          deleteCode: data.deleteCode || '',
          minStockAlert: data.minStockAlert !== undefined ? data.minStockAlert : 5
        });
      } else {
        setStoreSettings({
          id: ownerId,
          storeName: APP_NAME,
          currency: 'DT',
          tva: 19,
          tvaEnabled: true,
          minStockAlert: 5
        } as StoreSettings);
        setStoreFormData({
          storeName: APP_NAME,
          currency: 'DT',
          address: '',
          phone: '',
          tva: 19,
          tvaEnabled: true,
          deleteCode: '',
          minStockAlert: 5
        });
      }
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, `settings/${ownerId}`);
      setLoading(false);
    });

    return () => {
      unsubscribeStore();
    };
  }, [ownerId]);

  const handleStoreSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ownerId) return;
    try {
      await setDoc(doc(db, 'settings', ownerId), storeFormData);
      setSuccess('Paramètres du magasin enregistrés avec succès !');
      setTimeout(() => setSuccess(null), 3000);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `settings/${ownerId}`);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-800 tracking-tight flex items-center gap-2">
            <SettingsIcon className="w-7 h-7 text-indigo-600 fill-indigo-100/40" />
            Paramètres du Magasin
          </h1>
          <p className="text-xs text-slate-500 font-medium">
            Configurez les informations d'en-tête, la devise, les coordonnées de contact et la gestion de la TVA.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="bg-white rounded-3xl border border-slate-100 p-16 flex items-center justify-center premium-shadow">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
          {/* Card 0: Mon code de sécurité (visible par tous les utilisateurs) */}
          <SecurityCodeCard userProfile={userProfile} />

          {/* Card 1: Informations Générales de la Boutique */}
          <div className="bg-white rounded-3xl border border-slate-100 shadow-xs overflow-hidden premium-shadow">
            <div className="p-6 border-b border-slate-100 bg-slate-50/50 flex items-center gap-3">
              <div className="p-2 bg-indigo-50 text-indigo-600 rounded-xl">
                <Store className="w-5 h-5" />
              </div>
              <div>
                <h2 className="font-bold text-slate-800 text-sm">Informations Générales</h2>
                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Coordonnées de l'activité imprimées sur les reçus</p>
              </div>
            </div>

            <div className="p-6">
              <form onSubmit={handleStoreSubmit} className="space-y-5">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block font-bold">Nom du Boutique / Magasin</label>
                    <input 
                      type="text" 
                      required
                      value={storeFormData.storeName}
                      onChange={(e) => setStoreFormData({ ...storeFormData, storeName: e.target.value })}
                      className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-semibold transition-all outline-none focus:ring-2 focus:ring-indigo-500/10 focus:border-indigo-500"
                      placeholder="Ex: Mon Supermarché"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block font-bold">Devise du Magasin</label>
                    <input 
                      type="text" 
                      required
                      value={storeFormData.currency}
                      onChange={(e) => setStoreFormData({ ...storeFormData, currency: e.target.value })}
                      className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-semibold transition-all outline-none focus:ring-2 focus:ring-indigo-500/10 focus:border-indigo-500"
                      placeholder="Ex: DT"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block font-bold">Adresse</label>
                    <input 
                      type="text" 
                      value={storeFormData.address}
                      onChange={(e) => setStoreFormData({ ...storeFormData, address: e.target.value })}
                      className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-semibold transition-all outline-none focus:ring-2 focus:ring-indigo-500/10 focus:border-indigo-500"
                      placeholder="Ex: Avenue Habib Bourguiba, Tunis"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block font-bold">Téléphone du Magasin</label>
                    <input 
                      type="text" 
                      value={storeFormData.phone}
                      onChange={(e) => setStoreFormData({ ...storeFormData, phone: e.target.value })}
                      className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-semibold transition-all outline-none focus:ring-2 focus:ring-indigo-500/10 focus:border-indigo-500"
                      placeholder="Ex: 71 000 000 ou 22 123 456"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between p-4 bg-slate-50/50 rounded-2xl border border-slate-100 my-2">
                  <div>
                    <label className="text-xs font-bold text-slate-800 block">Facturation de la TVA</label>
                    <span className="text-[10px] text-slate-400 font-medium block leading-tight mt-0.5">Calculer et appliquer la taxe sur la valeur ajoutée sur les ventes</span>
                  </div>
                  <input 
                    type="checkbox"
                    checked={storeFormData.tvaEnabled}
                    onChange={(e) => setStoreFormData({ ...storeFormData, tvaEnabled: e.target.checked })}
                    className="w-5 h-5 text-indigo-600 border-slate-300 rounded focus:ring-indigo-500 cursor-pointer"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block font-bold">Taux de TVA (%)</label>
                  <input 
                    type="number" 
                    disabled={!storeFormData.tvaEnabled}
                    value={storeFormData.tva}
                    onChange={(e) => setStoreFormData({ ...storeFormData, tva: Number(e.target.value) })}
                    className={cn(
                      "w-full px-4 py-2.5 border rounded-xl text-xs font-semibold transition-all outline-none",
                      storeFormData.tvaEnabled
                        ? "bg-white border-indigo-200 focus:ring-2 focus:ring-indigo-500/10 focus:border-indigo-500" 
                        : "bg-slate-50 border-slate-100 text-slate-400 cursor-not-allowed opacity-60"
                    )}
                  />
                </div>

                {/* Seuil d'alerte de stock minimum par défaut */}
                <div className="space-y-2 p-4 bg-amber-50/50 rounded-2xl border border-amber-200/60 my-2">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                    <div>
                      <label className="text-xs font-bold text-slate-800 block">
                        Seuil d'Alerte de Stock Minimum Global
                      </label>
                      <span className="text-[10px] text-slate-500 font-medium block leading-tight mt-0.5">
                        Déclenche une notification et une bannière visuelle dans le tableau de bord lorsqu'un produit atteint ou passe sous ce seuil.
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 pt-1">
                    <input 
                      type="number" 
                      min="0"
                      max="1000"
                      value={storeFormData.minStockAlert}
                      onChange={(e) => setStoreFormData({ ...storeFormData, minStockAlert: Math.max(0, parseInt(e.target.value) || 0) })}
                      className="w-28 px-3.5 py-2 bg-white border border-amber-300 rounded-xl text-xs font-black text-slate-800 transition-all outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 font-mono"
                      placeholder="Ex: 5"
                    />
                    <span className="text-xs font-bold text-slate-600">unités en stock</span>
                  </div>
                </div>

                <div className="pt-2">
                  <button
                    type="submit"
                    className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-black uppercase tracking-wider rounded-xl transition-all shadow-md shadow-indigo-600/10 active:scale-[0.99]"
                  >
                    <Save className="w-4 h-4" />
                    Enregistrer les modifications
                  </button>
                </div>
              </form>
            </div>
          </div>

          {/* Card 2: Configuration & Maintenance de la Base de Données */}
          <div className="bg-white rounded-3xl border border-slate-100 shadow-xs overflow-hidden premium-shadow space-y-6 p-6">
            <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
              <div className="p-2 bg-emerald-50 text-emerald-600 rounded-xl">
                <Database className="w-5 h-5" />
              </div>
              <div>
                <h2 className="font-bold text-slate-800 text-sm">Base de données & Maintenance</h2>
                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Outils d'archivage et d'allègement du magasin</p>
              </div>
            </div>

            {/* Rubrique 1: Sauvegarde Excel */}
            <div className="space-y-3">
              <div className="space-y-1">
                <h3 className="text-xs font-black uppercase tracking-wider text-slate-700">1. Sauvegarde Complète (Excel)</h3>
                <p className="text-[11px] text-slate-400 font-medium leading-relaxed">
                  Générez un fichier Excel multi-feuille contenant l'intégralité de la base de données (produits en stock, liste complète des clients, historique des ventes et factures).
                </p>
              </div>
              <button
                type="button"
                onClick={handleExportExcel}
                disabled={isExporting}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-black uppercase tracking-wider rounded-xl transition-all shadow-md shadow-emerald-500/10 active:scale-[0.99]"
              >
                <Download className="w-4 h-4 animate-bounce" />
                {isExporting ? 'Exportation en cours...' : 'Exporter toute la base de données (.xlsx)'}
              </button>
            </div>

            <hr className="border-slate-100" />

            {/* Rubrique 2: Nettoyage et Allègement de l'historique */}
            <div className="space-y-4">
              <div className="space-y-1">
                <h3 className="text-xs font-black uppercase tracking-wider text-slate-700">2. Nettoyage de l'historique</h3>
                <p className="text-[11px] text-slate-400 font-medium leading-relaxed">
                  Allégez la base de données en supprimant définitivement les rapports de transactions (ventes et factures) antérieurs à une date limite de votre choix.
                </p>
              </div>

              {/* Date limite */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block font-bold">Transactions antérieures ou égales au :</label>
                <div className="relative">
                  <Calendar className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                  <input
                    type="date"
                    value={purgeDate}
                    onChange={(e) => setPurgeDate(e.target.value)}
                    className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-semibold outline-none focus:ring-2 focus:ring-rose-500/10 focus:border-rose-450 transition-shadow"
                  />
                </div>
              </div>

              {/* Toggles */}
              <div className="grid grid-cols-2 gap-3 pt-1">
                <label className="flex items-center gap-2 p-3 bg-slate-50/50 rounded-xl border border-slate-100 cursor-pointer hover:bg-slate-50">
                  <input 
                    type="checkbox" 
                    checked={purgeSales}
                    onChange={(e) => setPurgeSales(e.target.checked)}
                    className="w-4 h-4 text-rose-600 rounded border-slate-300 focus:ring-rose-500"
                  />
                  <span className="text-[10px] font-bold text-slate-700 uppercase tracking-wider">Purger les Ventes</span>
                </label>
                <label className="flex items-center gap-2 p-3 bg-slate-50/50 rounded-xl border border-slate-100 cursor-pointer hover:bg-slate-50">
                  <input 
                    type="checkbox" 
                    checked={purgeInvoices}
                    onChange={(e) => setPurgeInvoices(e.target.checked)}
                    className="w-4 h-4 text-rose-600 rounded border-slate-300 focus:ring-rose-500"
                  />
                  <span className="text-[10px] font-bold text-slate-700 uppercase tracking-wider">Purger les Factures</span>
                </label>
              </div>

              {/* Warning Area */}
              {purgeDate && (
                <div className="p-3.5 bg-rose-50 border border-rose-100 rounded-2xl flex items-start gap-2.5 text-rose-800 text-[11px] leading-relaxed animate-in fade-in duration-300">
                  <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5 animate-pulse" />
                  <div>
                    <span className="font-extrabold block uppercase tracking-wide text-[10px] text-rose-700">Alerte : Suppression définitive !</span>
                    Toutes les transactions correspondantes datées d'avant le <span className="font-bold underline">{new Date(purgeDate).toLocaleDateString('fr-FR')}</span> incluse seront définitivement supprimées afin d'alléger la base de données de caisse.
                  </div>
                </div>
              )}

              {/* Action Button */}
              <button
                type="button"
                onClick={handlePurgeDatabase}
                disabled={isPurging || !purgeDate || (!purgeSales && !purgeInvoices)}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 bg-rose-600 hover:bg-rose-700 disabled:opacity-40 text-white text-xs font-black uppercase tracking-wider rounded-xl transition-all shadow-md shadow-rose-600/10 active:scale-[0.99]"
              >
                <Trash2 className="w-4 h-4 font-bold" />
                {isPurging ? 'Purge et allègement en cours...' : 'Purger et alléger de la base'}
              </button>
            </div>

            <hr className="border-slate-100" />

            {/* Rubrique 3: Journal d'activité */}
            <div className="space-y-4">
              <div className="space-y-1">
                <h3 className="text-xs font-black uppercase tracking-wider text-slate-700">3. Journal d'activité</h3>
                <p className="text-[11px] text-slate-400 font-medium leading-relaxed">
                  Téléchargez un fichier détaillé de l'historique d'activité (ventes, factures, créations/modifications/suppressions de produits) sur une période donnée. La période sélectionnée ne peut pas dépasser 1 mois.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block font-bold">Date de début</label>
                  <div className="relative">
                    <Calendar className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                    <input
                      type="date"
                      value={activityStartDate}
                      max={todayStr}
                      onChange={(e) => { setActivityStartDate(e.target.value); setActivityError(''); }}
                      className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-semibold outline-none focus:ring-2 focus:ring-indigo-500/10 focus:border-indigo-450 transition-shadow"
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block font-bold">Date de fin</label>
                  <div className="relative">
                    <Calendar className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                    <input
                      type="date"
                      value={activityEndDate}
                      max={todayStr}
                      onChange={(e) => { setActivityEndDate(e.target.value); setActivityError(''); }}
                      className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-semibold outline-none focus:ring-2 focus:ring-indigo-500/10 focus:border-indigo-450 transition-shadow"
                    />
                  </div>
                </div>
              </div>

              {activityError && (
                <div className="p-3.5 bg-rose-50 border border-rose-100 rounded-2xl flex items-start gap-2.5 text-rose-800 text-[11px] leading-relaxed animate-in fade-in duration-300">
                  <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
                  <span className="font-semibold">{activityError}</span>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={handleViewActivityLog}
                  disabled={isLoadingActivityView || !activityStartDate || !activityEndDate}
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 bg-slate-800 hover:bg-slate-900 disabled:opacity-40 text-white text-xs font-black uppercase tracking-wider rounded-xl transition-all shadow-md shadow-slate-800/10 active:scale-[0.99]"
                >
                  <Eye className="w-4 h-4" />
                  {isLoadingActivityView ? 'Chargement...' : 'Afficher dans l\'app'}
                </button>
                <button
                  type="button"
                  onClick={handleDownloadActivityLog}
                  disabled={isGeneratingActivity || !activityStartDate || !activityEndDate}
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white text-xs font-black uppercase tracking-wider rounded-xl transition-all shadow-md shadow-indigo-600/10 active:scale-[0.99]"
                >
                  <FileText className="w-4 h-4" />
                  {isGeneratingActivity ? 'Génération...' : 'Télécharger (.xlsx)'}
                </button>
              </div>
            </div>
          </div>
        </div>

      )}

      {canManageStartup && (
        <section className="space-y-4 rounded-3xl border border-indigo-100 bg-white p-6 shadow-xs">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-indigo-50 p-2 text-indigo-600"><Music2 className="h-5 w-5" /></div>
            <div>
              <h2 className="text-sm font-bold text-slate-800">Coran &amp; Adhkar</h2>
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Écran d’accueil et récitation audio</p>
            </div>
            <label className="ml-auto flex items-center gap-2 text-xs font-bold text-slate-700">
              <input
                type="checkbox"
                checked={startupEnabled}
                onChange={(event) => setStartupEnabled(event.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-indigo-600"
              />
              Activer
            </label>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-1 text-xs font-bold text-slate-600">
              Choisir une āya ou un adhkar
              <select
                value={selectedWelcomeChoice}
                onChange={(event) => {
                  const choice = welcomeChoices.find((item) => item.id === event.target.value);
                  if (!choice) return;
                  setWelcomeTitle(choice.title);
                  setWelcomeText(choice.text);
                  setWelcomeSource(choice.source);
                }}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 font-medium"
              >
                <option value="custom">Texte personnalisé</option>
                {welcomeChoices.map((choice) => (
                  <option key={choice.id} value={choice.id}>{choice.title}</option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-xs font-bold text-slate-600">
              Titre
              <input
                value={welcomeTitle}
                onChange={(event) => setWelcomeTitle(event.target.value)}
                maxLength={200}
                className="w-full rounded-xl border border-slate-200 px-3 py-2.5 font-medium"
              />
            </label>
          </div>

          <label className="block space-y-1 text-xs font-bold text-slate-600">
            Texte affiché
            <textarea
              value={welcomeText}
              onChange={(event) => setWelcomeText(event.target.value)}
              maxLength={5000}
              dir="rtl"
              lang="ar"
              rows={3}
              className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-right font-arabic text-lg font-medium"
            />
          </label>
          <label className="block space-y-1 text-xs font-bold text-slate-600">
            Source (facultative)
            <input
              value={welcomeSource}
              onChange={(event) => setWelcomeSource(event.target.value)}
              maxLength={500}
              className="w-full rounded-xl border border-slate-200 px-3 py-2.5 font-medium"
            />
          </label>

          <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
            <label className="space-y-1 text-xs font-bold text-slate-600">
              رابط URL للمقطع الصوتي
              <input
                type="url"
                value={startupAudioUrl}
                onChange={(event) => setStartupAudioUrl(event.target.value)}
                placeholder="https://…/recitation.mp3"
                className="w-full rounded-xl border border-slate-200 px-3 py-2.5 font-medium"
              />
            </label>
            <div className="flex items-end">
              <input
                ref={audioFileInput}
                type="file"
                accept=".mp3,.m4a,audio/mpeg,audio/mp4,audio/x-m4a"
                onChange={(event) => void uploadStartupAudio(event.target.files?.[0])}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => audioFileInput.current?.click()}
                disabled={audioUploading}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-indigo-200 px-4 py-2.5 text-xs font-bold text-indigo-700 disabled:opacity-50 sm:w-auto"
              >
                <Upload className="h-4 w-4" />
                {audioUploading ? 'Envoi…' : 'رفع ملف صوتي'}
              </button>
            </div>
          </div>
          <p className="text-[11px] text-slate-500">Lien direct HTTPS en .mp3 ou .m4a. L’audio ne démarre qu’après le bouton « دخول » de l’écran d’accueil.</p>
          {startupMessage && <p role="status" className="text-xs font-semibold text-indigo-700">{startupMessage}</p>}
          <button
            type="button"
            onClick={() => void saveStartupSettings()}
            disabled={startupSaving || audioUploading}
            className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-xs font-bold text-white disabled:opacity-50"
          >
            <Save className="h-4 w-4" />
            {startupSaving ? 'Enregistrement…' : 'Enregistrer Coran & Adhkar'}
          </button>
        </section>
      )}

      {/* Modal Journal d'activité (affichage en ligne, style fichier log) */}
      {showActivityLogModal && (
        <div className="fixed inset-0 z-[100] bg-black/50 flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-slate-800 text-white rounded-xl">
                  <FileText className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-800 text-sm">Journal d'activité</h3>
                  <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                    Du {activityStartDate} au {activityEndDate} — {activityLogLines.length} entrée{activityLogLines.length > 1 ? 's' : ''}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowActivityLogModal(false)}
                className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-xl transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto bg-slate-950 p-4">
              <pre className="text-[11px] leading-relaxed text-emerald-400 font-mono whitespace-pre-wrap break-words">
                {activityLogLines.join('\n')}
              </pre>
            </div>

            <div className="px-5 py-3.5 border-t border-slate-100 flex justify-end">
              <button
                type="button"
                onClick={() => setShowActivityLogModal(false)}
                className="px-4 py-2 bg-slate-100 text-slate-700 text-xs font-bold rounded-xl hover:bg-slate-200 transition-colors uppercase tracking-wider"
              >
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Success Toast */}
      {success && (
        <div className="fixed bottom-8 right-8 z-[100] animate-in fade-in slide-in-from-bottom-4 duration-300">
          <div className="bg-slate-900 text-white px-5 py-3 rounded-2xl shadow-xl flex items-center gap-2.5 border border-slate-850">
            <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
            <span className="text-xs font-extrabold">{success}</span>
          </div>
        </div>
      )}
    </div>
  );
}
