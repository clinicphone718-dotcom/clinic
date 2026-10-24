import React, { useState, useEffect } from 'react';
import { collection, onSnapshot, query, doc, setDoc, updateDoc, deleteDoc, where, getDocs, getDoc, writeBatch } from 'firebase/firestore';
import { db, auth, firebaseConfig } from '../firebase';
import { initializeApp } from 'firebase/app';
import { getAuth, createUserWithEmailAndPassword, sendPasswordResetEmail } from 'firebase/auth';
import { UserProfile } from '../types';
import { 
  Users as UsersIcon, 
  UserPlus, 
  User,
  X, 
  Shield, 
  Ban, 
  CheckCircle2, 
  AlertCircle, 
  Mail, 
  Trash2,
  Lock,
  Sliders,
  Check,
  Eye,
  EyeOff,
  Copy,
  Edit2
} from 'lucide-react';
import { cn } from '../lib/utils';
import { mergePermissions, PERMISSION_FLAGS, PermissionMap, PermissionPreset, permissionPreset, permissionsForPreset } from '../lib/permissions';
import { useIsSuperAdmin } from '../lib/useIsSuperAdmin';
import { apiRequest } from '../lib/api';

const MENU_OPTIONS = [
  { id: 'dashboard', name: 'Tableau de bord', description: 'Statistiques et graphiques généraux' },
  { id: 'reparation', name: 'Partie Réparation', description: 'Suivi et gestion des réparations' },
  { id: 'pieces', name: 'Pièces Détachées', description: 'Stock visible par le Casier ; gestion complète pour le Technicien' },
  { id: 'pos', name: 'Vente (POS / Caisse)', description: 'Caisse, vente directe et paniers' },
  { id: 'products', name: 'Articles / Services', description: 'Lecture pour le Casier ; création et gestion pour le Technicien' },
  { id: 'clients', name: 'Gestion des Clients', description: 'Liste des clients et suivi des dettes' },
  { id: 'sales', name: 'Historique des Ventes', description: 'Suivi et recherche des ventes' },
  { id: 'invoices', name: 'Facturation', description: 'Édition et gestion des factures' },
  { id: 'notes', name: 'Mémos & Notes', description: 'Ajouter et planifier des mémos' },
  { id: 'settings', name: 'Paramètres du Magasin', description: 'Configurations de base' },
  { id: 'users', name: 'Gestion des Utilisateurs', description: 'Accès restreint pour gérer l\'équipe' },
];

type UserFormRole = UserProfile['role'] | 'technician' | 'cashier-repair';

const isTechnicianProfile = (profile: UserProfile, menus = profile.allowedMenus || []) =>
  profile.role === 'user' && menus.includes('reparation') &&
  menus.includes('pieces') &&
  menus.every(menu => ['reparation', 'pieces', 'products', 'clients'].includes(menu));

const DEFAULT_USER_MENUS = ['dashboard', 'pos', 'products', 'clients', 'sales', 'invoices'];
const CASHIER_REPAIR_MENUS = [
  'pos', 'reparation', 'pieces', 'products', 'clients',
];
const TECHNICIAN_MENUS = ['reparation', 'pieces', 'products', 'clients'];

interface UsersProps {
  userProfile: UserProfile | null;
}

export default function Users({ userProfile }: UsersProps) {
  // Initialize with the current admin's own profile so they always appear at the top
  const [users, setUsers] = useState<UserProfile[]>(userProfile ? [userProfile] : []);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [loading, setLoading] = useState(!userProfile);
  const [success, setSuccess] = useState<string | null>(null);
  const [errorOnCreate, setErrorOnCreate] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [passwordUser, setPasswordUser] = useState<UserProfile | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [deletingUser, setDeletingUser] = useState<UserProfile | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [migrationConfirmOpen, setMigrationConfirmOpen] = useState(false);

  const ownerId = userProfile?.ownerId || userProfile?.uid || 'no_user_auth';

  const [copiedField, setCopiedField] = useState<string | null>(null);
  const isSuperAdmin = useIsSuperAdmin();

  // Form states - Create
  const [nameInput, setNameInput] = useState('');
  const [emailInput, setEmailInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [roleInput, setRoleInput] = useState<UserFormRole>('cashier-repair');
  const [selectedMenus, setSelectedMenus] = useState<string[]>(CASHIER_REPAIR_MENUS);
  const [permissionsInput, setPermissionsInput] = useState<PermissionMap>(permissionsForPreset('cashier'));
  const [permissionMigrationPreview, setPermissionMigrationPreview] = useState<UserProfile[]>([]);
  const [permissionMigrationBackupDownloaded, setPermissionMigrationBackupDownloaded] = useState(false);
  const [permissionMigrationBusy, setPermissionMigrationBusy] = useState(false);
  const [permissionMigrationError, setPermissionMigrationError] = useState<string | null>(null);

  // Unified editing state
  const [editingUser, setEditingUser] = useState<UserProfile | null>(null);
  const [editName, setEditName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editRole, setEditRole] = useState<UserFormRole>('user');
  const [editStatus, setEditStatus] = useState<'active' | 'banned'>('active');
  const [editSelectedMenus, setEditSelectedMenus] = useState<string[]>([]);
  const [editPermissions, setEditPermissions] = useState<PermissionMap>(permissionsForPreset('cashier'));
  const [editSecurityCode, setEditSecurityCode] = useState('');
  const [errorOnEdit, setErrorOnEdit] = useState<string | null>(null);

  // Visibilité du code individuel de chaque utilisateur dans le tableau
  const [visibleCodes, setVisibleCodes] = useState<Record<string, boolean>>({});
  const toggleCodeVisibility = (uid: string) => setVisibleCodes((prev) => ({ ...prev, [uid]: !prev[uid] }));

  const renderPermissionOptions = (
    menus: string[],
    permissions: PermissionMap,
    setPermissions: (next: PermissionMap) => void,
  ) => (
    <div className="ml-3 space-y-3 border-l-2 border-indigo-100 pl-3">
      {(['pieces', 'products', 'reparation', 'clients'] as const)
        .filter(menuId => menus.includes(menuId))
        .map(menuId => (
          <div key={menuId} className="space-y-1">
            <p className="text-[9px] font-black uppercase tracking-wider text-slate-500">
              {menuId === 'pieces' ? 'Pièces détachées' : menuId === 'products' ? 'Articles / Services' : menuId === 'reparation' ? 'Partie Réparation' : 'Clients'}
            </p>
            {PERMISSION_FLAGS[menuId].map(({ id, label }) => (
              <label key={id} className="flex items-center gap-2 text-[10px] font-medium text-slate-600">
                <input
                  type="checkbox"
                  checked={permissions[menuId]?.[id] === true}
                  onChange={event => setPermissions({
                    ...permissions,
                    [menuId]: { ...permissions[menuId], [id]: event.target.checked },
                  })}
                  className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                />
                {label}
              </label>
            ))}
          </div>
        ))}
      <div className="space-y-1 border-t border-slate-100 pt-2">
        <p className="text-[9px] font-black uppercase tracking-wider text-slate-500">Coran & Adhkar</p>
        {PERMISSION_FLAGS.startup.map(({ id, label }) => (
          <label key={id} className="flex items-center gap-2 text-[10px] font-medium text-slate-600">
            <input
              type="checkbox"
              checked={permissions.startup?.[id] === true}
              onChange={event => setPermissions({
                ...permissions,
                startup: { ...permissions.startup, [id]: event.target.checked },
              })}
              className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
            />
            {label}
          </label>
        ))}
      </div>
    </div>
  );

  const presetFromRole = (role: UserFormRole): PermissionPreset =>
    role === 'admin' ? 'admin' : role === 'technician' ? 'technician' : 'cashier';

  const previewPermissionMigration = () => {
    const missing = users.filter(profile => !profile.permissions);
    setPermissionMigrationPreview(missing);
    setPermissionMigrationBackupDownloaded(false);
    setPermissionMigrationError(null);
    setSuccess(`${missing.length} compte(s) à migrer. Aucun document n’a été modifié.`);
  };

  const downloadPermissionMigrationBackup = () => {
    if (permissionMigrationPreview.length === 0) return;
    const backup = permissionMigrationPreview.map(profile => ({
      uid: profile.uid,
      email: profile.email,
      role: profile.role,
      allowedMenus: profile.allowedMenus || null,
      permissions: profile.permissions || null,
    }));
    const blob = new Blob([JSON.stringify({ createdAt: new Date().toISOString(), users: backup }, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `phone-clinic-permissions-backup-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setPermissionMigrationBackupDownloaded(true);
  };

  const confirmPermissionMigration = async () => {
    if (!permissionMigrationBackupDownloaded || permissionMigrationPreview.length === 0 ||
      permissionMigrationBusy) return;
    setMigrationConfirmOpen(false);
    setPermissionMigrationBusy(true);
    setPermissionMigrationError(null);
    try {
      for (let offset = 0; offset < permissionMigrationPreview.length; offset += 400) {
        const batch = writeBatch(db);
        permissionMigrationPreview.slice(offset, offset + 400).forEach(profile => {
          if (!profile.permissions) {
            batch.update(doc(db, 'users', profile.uid), {
              permissions: permissionsForPreset(permissionPreset(profile)),
            });
          }
        });
        await batch.commit();
      }
      setPermissionMigrationPreview([]);
      setPermissionMigrationBackupDownloaded(false);
      setSuccess('Migration des permissions terminée.');
    } catch (issue) {
      setPermissionMigrationError(issue instanceof Error ? issue.message : String(issue));
    } finally {
      setPermissionMigrationBusy(false);
    }
  };

  useEffect(() => {
    if (!auth.currentUser || !userProfile) return;

    setLoading(true);

    // Un magasin ne doit voir que ses propres comptes (lui-même + ses collaborateurs).
    // Seul le super-admin de la plateforme voit tous les magasins,
    // ce qui est nécessaire pour l'administration multi-magasins et les migrations.
    const myOwnerId = userProfile.ownerId || userProfile.uid;

    const filterToOwnStore = (allDocs: UserProfile[]) => {
      if (isSuperAdmin) {
        return allDocs.filter(u => u.uid !== userProfile.uid);
      }
      return allDocs.filter(u => u.uid !== userProfile.uid && (u.ownerId || u.uid) === myOwnerId);
    };

    // Utiliser getDocs pour une lecture immédiate de TOUS les users (super-admin)
    // ou uniquement des comptes de son propre magasin (admin standard)
    // puis onSnapshot pour les mises à jour en temps réel
    const qAll = isSuperAdmin
      ? query(collection(db, 'users'))
      : query(collection(db, 'users'), where('ownerId', '==', myOwnerId));

    // Lecture initiale immédiate
    getDocs(qAll).then((snapshot) => {
      const allDocs = snapshot.docs.map(d => ({ ...d.data(), uid: d.id } as UserProfile));
      const subUsers = filterToOwnStore(allDocs);
      setUsers([userProfile, ...subUsers]);
      setLoading(false);
    }).catch(err => {
      console.error('Unable to load user profiles.');
      setLoading(false);
    });

    // Écoute en temps réel pour les ajouts/modifs après chargement
    const unsub = onSnapshot(qAll, (snapshot) => {
      const allDocs = snapshot.docs.map(d => ({ ...d.data(), uid: d.id } as UserProfile));
      const subUsers = filterToOwnStore(allDocs);
      setUsers([userProfile, ...subUsers]);
    }, (err) => {
      console.error('Unable to refresh user profiles.');
    });

    return () => unsub();
  }, [userProfile?.uid, isSuperAdmin]);

  const handleRoleChangeOnCreate = (role: UserFormRole) => {
    setRoleInput(role);
    setPermissionsInput(permissionsForPreset(presetFromRole(role)));
    if (role === 'admin') {
      setSelectedMenus(MENU_OPTIONS.map(m => m.id));
    } else if (role === 'technician') {
      setSelectedMenus(TECHNICIAN_MENUS);
    } else if (role === 'cashier-repair') {
      setSelectedMenus(CASHIER_REPAIR_MENUS);
    } else {
      setSelectedMenus(DEFAULT_USER_MENUS);
    }
  };

  const handleToggleMenuSelection = (menuId: string) => {
    setSelectedMenus(prev => 
      prev.includes(menuId) ? prev.filter(id => id !== menuId) : [...prev, menuId]
    );
  };

  const handleToggleEditMenuSelection = (menuId: string) => {
    setEditSelectedMenus(prev => 
      prev.includes(menuId) ? prev.filter(id => id !== menuId) : [...prev, menuId]
    );
  };

  const copyToClipboard = async (text: string, fieldKey: string) => {
    try {
    await navigator.clipboard.writeText(text);
    setCopiedField(fieldKey);
    setTimeout(() => setCopiedField(null), 2000);
    } catch (error) {
    console.error('Unable to copy user information.');
    setErrorOnEdit(error instanceof Error ? error.message : 'Copie impossible.');
    }
  };

  const sendPasswordResetLink = async (email: string) => {
    try {
      await sendPasswordResetEmail(auth, email);
      setSuccess(`Lien de réinitialisation envoyé à ${email}.`);
      setErrorOnCreate(null);
      setTimeout(() => setSuccess(null), 5000);
    } catch (issue) {
      setErrorOnCreate(issue instanceof Error ? `Impossible d’envoyer le lien : ${issue.message}` : 'Impossible d’envoyer le lien.');
    }
  };

  const handleChangeUserPassword = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!passwordUser) return;
    if (newPassword.length < 8) {
      setErrorOnCreate('Le mot de passe doit contenir au moins 8 caractères.');
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setErrorOnCreate('La confirmation ne correspond pas au nouveau mot de passe.');
      return;
    }
    setErrorOnCreate(null);
    setActionLoading(passwordUser.uid);
    try {
      await apiRequest('/admin/users/update', {
        method: 'POST',
        body: JSON.stringify({ uid: passwordUser.uid, password: newPassword }),
      });
      setPasswordUser(null);
      setNewPassword('');
      setConfirmNewPassword('');
      setSuccess(`Mot de passe modifié pour ${passwordUser.email}.`);
      setTimeout(() => setSuccess(null), 4000);
    } catch (issue) {
      setErrorOnCreate(issue instanceof Error ? issue.message : 'Impossible de modifier le mot de passe.');
    } finally {
      setActionLoading(null);
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorOnCreate(null);
    setActionLoading('creating');

    // 1. Validation rigoureuse des données d'entrée
    if (!nameInput || nameInput.trim().length < 2) {
      setErrorOnCreate("Le nom de l'utilisateur est obligatoire (min 2 caractères).");
      setActionLoading(null);
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const cleanEmail = emailInput.trim().toLowerCase();
    if (!cleanEmail || !emailRegex.test(cleanEmail)) {
      setErrorOnCreate("Veuillez saisir une adresse email valide.");
      setActionLoading(null);
      return;
    }

    if (!passwordInput || passwordInput.length < 6) {
      setErrorOnCreate("Le mot de passe obligatoire doit contenir au moins 6 caractères.");
      setActionLoading(null);
      return;
    }

    if (selectedMenus.length === 0) {
      setErrorOnCreate("Veuillez sélectionner au moins un privilège d'accès.");
      setActionLoading(null);
      return;
    }

    // 2. Vérification d'existence de l'utilisateur dans Firestore pour éviter les doublons
    try {
      const usersRef = collection(db, 'users');
      const q = query(usersRef, where('ownerId', '==', ownerId));
      const querySnapshot = await getDocs(q);
      const emailExists = querySnapshot.docs.some((userDoc) =>
        userDoc.data().email === cleanEmail
      );

      if (emailExists) {
        setErrorOnCreate("Cette adresse email est déjà en cours d'utilisation.");
        setActionLoading(null);
        return;
      }
    } catch (fsErr: any) {
      console.error('Unable to verify whether the user profile already exists.');
      setErrorOnCreate('Erreur de connexion lors de la vérification de l’utilisateur.');
      setActionLoading(null);
      return;
    }

    const tempAppName = 'TempUserCreation_' + Date.now();
    let tempApp: any = null;
    let targetUid = '';

    // 3. Tenter l'ajout de l'utilisateur dans Firebase Auth via l'application temporaire
    try {
      tempApp = initializeApp(firebaseConfig, tempAppName);
      const tempAuth = getAuth(tempApp);

      const userCred = await createUserWithEmailAndPassword(tempAuth, cleanEmail, passwordInput);
      targetUid = userCred.user.uid;
      await tempAuth.signOut();
    } catch (authErr: any) {
      console.error('Unable to create the authentication account.');
      let errorMsg = "La création du compte d'authentification a échoué.";
      if (authErr.code === 'auth/email-already-in-use') {
        errorMsg = "Cette adresse email est déjà utilisée dans Firebase Authentication.";
      } else if (authErr.code === 'auth/weak-password') {
        errorMsg = "Le mot de passe choisi doit contenir au moins 6 caractères.";
      } else if (authErr.code === 'auth/invalid-email') {
        errorMsg = "L'adresse email saisie est invalide pour Firebase Authentication.";
      } else if (authErr.message) {
        errorMsg += ` Détails : ${authErr.message}`;
      }
      setErrorOnCreate(errorMsg);
      setActionLoading(null);
      if (tempApp) {
        try {
          await tempApp.delete();
        } catch (delErr) {
          console.error('Unable to dispose of the temporary authentication app.');
        }
      }
      return;
    }

    // 4. Création de la fiche d'utilisateur dans Firestore
    try {
      await setDoc(doc(db, "users", targetUid), {
        uid: targetUid,
        name: nameInput.trim(),
        email: cleanEmail,
        role: roleInput === 'admin' ? 'admin' : 'user',
        status: 'active',
        allowedMenus: selectedMenus,
        permissions: roleInput === 'admin' ? permissionsForPreset('admin') : permissionsInput,
        ownerId: roleInput === 'admin' ? targetUid : ownerId,
        creatorId: ownerId,
        createdAt: new Date().toISOString()
      });
      try {
        await sendPasswordResetEmail(auth, cleanEmail);
        setSuccess('Utilisateur créé. Son lien de définition du mot de passe a été envoyé.');
      } catch (resetError) {
        console.error('The user was created but the password reset email could not be sent.');
        setSuccess('Utilisateur créé, mais le lien de réinitialisation n’a pas pu être envoyé. Renvoyez-le depuis sa ligne.');
      }

      setIsModalOpen(false);
      setNameInput('');
      setEmailInput('');
      setPasswordInput('');
      setRoleInput('cashier-repair');
      setSelectedMenus(CASHIER_REPAIR_MENUS);
      setPermissionsInput(permissionsForPreset('cashier'));

      setTimeout(() => setSuccess(null), 4000);
    } catch (err: any) {
      console.error("Unable to save the user's Firestore profile.");
      setErrorOnCreate(`Impossible d'enregistrer l'utilisateur en base: ${err.message || 'Permission refusée'}`);
    } finally {
      if (tempApp) {
        try {
          await tempApp.delete();
        } catch (delErr) {
          console.error('Unable to dispose of the temporary authentication app.');
        }
      }
      setActionLoading(null);
    }
  };

  // Collections contenant un champ ownerId à réaligner lors d'une migration de compte admin
  const OWNER_ID_COLLECTIONS = ['products', 'sales', 'invoices', 'clients', 'categories', 'supplies', 'notes'];

  const cascadeOwnerIdMigration = async (oldOwnerId: string, newOwnerId: string) => {
    for (const collectionName of OWNER_ID_COLLECTIONS) {
      try {
        const q = query(collection(db, collectionName), where('ownerId', '==', oldOwnerId));
        const snap = await getDocs(q);
        if (snap.empty) continue;

        // Firestore limite un batch à 500 opérations, on découpe par sécurité
        for (let i = 0; i < snap.docs.length; i += 450) {
          const chunk = snap.docs.slice(i, i + 450);
          const batch = writeBatch(db);
          chunk.forEach((d) => batch.update(d.ref, { ownerId: newOwnerId }));
          await batch.commit();
        }
      } catch (err) {
        console.error('Unable to migrate a collection owner reference.');
      }
    }

    // Le document settings/{ownerId} et counters/invoices_{ownerId} utilisent l'ownerId comme identifiant de document
    try {
      const oldSettingsSnap = await getDoc(doc(db, 'settings', oldOwnerId));
      if (oldSettingsSnap.exists()) {
        await setDoc(doc(db, 'settings', newOwnerId), oldSettingsSnap.data());
        await deleteDoc(doc(db, 'settings', oldOwnerId));
      }
    } catch (err) {
      console.error('Unable to migrate store settings.');
    }

    try {
      const oldCounterId = `invoices_${oldOwnerId}`;
      const oldCounterSnap = await getDoc(doc(db, 'counters', oldCounterId));
      if (oldCounterSnap.exists()) {
        await setDoc(doc(db, 'counters', `invoices_${newOwnerId}`), oldCounterSnap.data());
        await deleteDoc(doc(db, 'counters', oldCounterId));
      }
    } catch (err) {
      console.error('Unable to migrate invoice counters.');
    }
  };

  const handleOpenEdit = (user: UserProfile) => {
    setEditingUser(user);
    setEditName(user.name || '');
    setEditEmail(user.email || '');
    const existingMenus = user.allowedMenus || (
      user.role === 'admin'
        ? MENU_OPTIONS.map(m => m.id)
        : ['dashboard', 'pos', 'products', 'clients', 'sales', 'invoices', 'notes']
    );
    setEditRole(isTechnicianProfile(user, existingMenus)
      ? 'technician'
      : user.role === 'user' && CASHIER_REPAIR_MENUS.every(menu => existingMenus.includes(menu))
        ? 'cashier-repair'
        : user.role || 'user');
    setEditStatus(user.status || 'active');
    setEditSelectedMenus(existingMenus);
    setEditPermissions(mergePermissions(permissionPreset(user), user.permissions));
    setEditSecurityCode(user.securityCode || '');
    setErrorOnEdit(null);
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;
    setErrorOnEdit(null);
    setActionLoading('editing');

    if (!editName || editName.trim().length < 2) {
      setErrorOnEdit("Le nom est obligatoire (min 2 caractères).");
      setActionLoading(null);
      return;
    }

    const cleanEmail = editEmail.trim().toLowerCase();
    if (cleanEmail !== editingUser.email) {
      setErrorOnEdit('L’adresse de connexion ne peut pas être modifiée depuis ce formulaire. Envoyez un lien de réinitialisation à l’utilisateur.');
      setActionLoading(null);
      return;
    }

    if (editSelectedMenus.length === 0) {
      setErrorOnEdit('Veuillez sélectionner au moins un droit d\'accès.');
      setActionLoading(null);
      return;
    }

    if (editSecurityCode && !/^[0-9]{4}$/.test(editSecurityCode)) {
      setErrorOnEdit('Le code de sécurité doit contenir exactement 4 chiffres (ou être laissé vide).');
      setActionLoading(null);
      return;
    }

    try {
      await updateDoc(doc(db, 'users', editingUser.uid), {
        name: editName.trim(),
        role: editRole === 'admin' ? 'admin' : 'user',
        status: editStatus,
        allowedMenus: editSelectedMenus,
        permissions: editRole === 'admin' ? permissionsForPreset('admin') : editPermissions,
        securityCode: editSecurityCode || '',
        ownerId: editRole === 'admin' ? editingUser.uid : ownerId,
      });
      setSuccess(`Utilisateur ${cleanEmail} mis à jour avec succès.`);
      setEditingUser(null);
      setTimeout(() => setSuccess(null), 6000);
    } catch (err: any) {
      console.error('Unable to update the user profile.');
      setErrorOnEdit(err.message || 'Une erreur est survenue lors de la modification.');
    } finally {
      setActionLoading(null);
    }
  };

  const handleToggleStatus = async (user: UserProfile) => {
    const newStatus = user.status === 'banned' ? 'active' : 'banned';
    setActionLoading(user.uid);
    setErrorOnCreate(null);
    try {
      // Directly check and update in Firestore using active session
      const userRef = doc(db, "users", user.uid);
      await updateDoc(userRef, {
        status: newStatus
      });

      setSuccess(`L'utilisateur ${user.email} est désormais ${newStatus === 'banned' ? 'banni' : 'actif'}.`);
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setErrorOnCreate(err instanceof Error ? err.message : 'Erreur de mise à jour.');
    } finally {
      setActionLoading(null);
    }
  };

  const handleDeleteProfileAndAuth = async (user: UserProfile) => {
    if (user.uid === userProfile?.uid) {
      setErrorOnCreate('Vous ne pouvez pas supprimer votre propre compte administrateur.');
      return;
    }
    const storeOwnerId = userProfile?.ownerId || userProfile?.uid;
    const storeAdmins = users.filter(profile =>
      profile.role === 'admin' && (profile.ownerId || profile.uid) === storeOwnerId
    );
    if (user.role === 'admin' && storeAdmins.length <= 1) {
      setErrorOnCreate('Impossible de supprimer le dernier administrateur du magasin.');
      return;
    }
    if (deleteConfirmation.trim().toLowerCase() !== user.email.toLowerCase() &&
      deleteConfirmation.trim() !== 'SUPPRIMER') {
      return;
    }

    setActionLoading(user.uid);
    setErrorOnCreate(null);
    try {
      await apiRequest('/admin/users/delete', {
        method: 'POST',
        body: JSON.stringify({ uid: user.uid }),
      });
      setUsers((current) => current.filter((profile) => profile.uid !== user.uid));
      setDeletingUser(null);
      setDeleteConfirmation('');
      setSuccess(`Utilisateur ${user.email} supprimé.`);
      setTimeout(() => setSuccess(null), 4000);
    } catch (error) {
      console.error('Unable to delete user profile.');
      setErrorOnCreate(error instanceof Error ? error.message : 'Impossible de supprimer cet utilisateur.');
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-800 tracking-tight flex items-center gap-2">
            <UsersIcon className="w-7 h-7 text-indigo-600 fill-indigo-100/40" />
            Gestion des Utilisateurs
          </h1>
          <p className="text-xs text-slate-500 font-medium">
            Gérez les accès détaillés et modifiez les profils de l’équipe en temps réel.
          </p>
        </div>

        <button
          onClick={() => {
            setErrorOnCreate(null);
            setRoleInput('cashier-repair');
            setSelectedMenus(CASHIER_REPAIR_MENUS);
            setPermissionsInput(permissionsForPreset('cashier'));
            setIsModalOpen(true);
          }}
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-indigo-600 text-white text-xs font-extrabold uppercase tracking-wider rounded-xl hover:bg-indigo-700 transition-all shadow-md shadow-indigo-600/10 active:scale-95 shrink-0 self-start sm:self-auto"
        >
          <UserPlus className="w-4 h-4" />
          Créer un utilisateur
        </button>
      </div>

      <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
        <button
          type="button"
          onClick={previewPermissionMigration}
          disabled={permissionMigrationBusy}
          className="rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2.5 text-xs font-black text-indigo-800 disabled:opacity-50"
        >
          Prévisualiser la migration des permissions
        </button>
        {permissionMigrationError && <p className="text-sm font-semibold text-rose-700">{permissionMigrationError}</p>}
        {permissionMigrationPreview.length > 0 && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs font-bold text-slate-700">{permissionMigrationPreview.length} compte(s) sans permissions explicites.</p>
              <div className="flex gap-2">
                <button type="button" onClick={downloadPermissionMigrationBackup} className="rounded-xl border border-amber-300 bg-white px-3 py-2 text-xs font-bold text-amber-800">Télécharger la sauvegarde JSON</button>
                <button type="button" onClick={() => setMigrationConfirmOpen(true)} disabled={!permissionMigrationBackupDownloaded || permissionMigrationBusy} className="rounded-xl bg-amber-700 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">{permissionMigrationBusy ? 'Migration…' : 'Confirmer la migration'}</button>
              </div>
            </div>
            <ul className="max-h-36 space-y-1 overflow-y-auto text-xs text-slate-600">
              {permissionMigrationPreview.map(profile => <li key={profile.uid} className="rounded-lg bg-slate-50 px-3 py-2">{profile.name || profile.email} · {permissionPreset(profile)}</li>)}
            </ul>
          </>
        )}
      </section>

      {success && (
        <div className="p-4 bg-emerald-50 border border-emerald-100 rounded-xl text-emerald-800 text-xs font-bold leading-relaxed flex items-center gap-2.5 animate-in fade-in duration-300">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 animate-bounce" />
          {success}
        </div>
      )}
      {errorOnCreate && !isModalOpen && (
        <div role="alert" className="rounded-xl border border-rose-100 bg-rose-50 p-4 text-xs font-bold text-rose-700">
          {errorOnCreate}
        </div>
      )}

      {/* Main Table with User Details/Credentials */}
      <div className="bg-white rounded-3xl border border-slate-100 shadow-xs overflow-hidden premium-shadow">
        {loading ? (
          <div className="p-16 flex items-center justify-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
          </div>
        ) : users.length === 0 ? (
          <div className="p-8 text-center text-slate-400 space-y-3">
            <UsersIcon className="w-12 h-12 mx-auto opacity-30 text-indigo-500" />
            <p className="text-sm font-bold">Aucun utilisateur trouvé</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/50">
                  <th className="py-4 px-6 text-[10px] font-extrabold text-slate-400 uppercase tracking-widest">Utilisateur & ID</th>
                  <th className="py-4 px-6 text-[10px] font-extrabold text-slate-400 uppercase tracking-widest">Coordonnées de connexion</th>
                  <th className="py-4 px-6 text-[10px] font-extrabold text-slate-400 uppercase tracking-widest">Code sécurité</th>
                  <th className="py-4 px-6 text-[10px] font-extrabold text-slate-400 uppercase tracking-widest">Rôle</th>
                  <th className="py-4 px-6 text-[10px] font-extrabold text-slate-400 uppercase tracking-widest">Menus visibles</th>
                  <th className="py-4 px-6 text-[10px] font-extrabold text-slate-400 uppercase tracking-widest">Statut</th>
                  <th className="py-4 px-6 text-[10px] font-extrabold text-slate-400 uppercase tracking-widest text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {users.map((profile) => {
                  const isSelf = profile.uid === userProfile?.uid;
                  const allowed = profile.allowedMenus || (
                    profile.role === 'admin'
                      ? MENU_OPTIONS.map(m => m.id)
                      : ['dashboard', 'pos', 'products', 'clients', 'sales', 'invoices', 'notes']
                  );

                  return (
                    <tr key={profile.uid} className={cn(
                      "group transition-colors",
                      isSelf 
                        ? "bg-indigo-50/30 hover:bg-indigo-50/50 border-l-2 border-indigo-300" 
                        : "hover:bg-slate-50/20"
                    )}>
                      {/* Left Block: Avatar and Email/UID info */}
                      <td className="py-4 px-6">
                        <div className="flex items-center gap-3">
                          <div className={cn(
                            "w-10 h-10 rounded-2xl bg-indigo-50 flex items-center justify-center font-black text-xs border border-indigo-100/50",
                            profile.role === 'admin' ? "text-purple-600 bg-purple-50/70 border-purple-100" : "text-indigo-600"
                          )}>
                            {profile.name ? profile.name[0].toUpperCase() : (profile.email ? profile.email[0].toUpperCase() : '?')}
                          </div>
                          <div>
                            <div className="font-bold text-xs text-slate-800 flex items-center gap-1.5 leading-none">
                              {profile.name || 'Sans Nom'}
                              {isSelf && (
                                <span className="px-1.5 py-0.5 bg-indigo-100 text-indigo-700 text-[8px] font-black uppercase tracking-wider rounded-md border border-indigo-200">
                                  Vous
                                </span>
                              )}
                            </div>
                            <span className="text-[10px] font-medium text-slate-500 mt-1 block">{profile.email}</span>
                            <div className="text-[9px] text-slate-400 font-mono mt-1 space-y-0.5">
                              <div>UID: {profile.uid}</div>
                              <div>Owner ID: {profile.ownerId || 'Non défini'}</div>
                              {profile.creatorId && <div>Créateur: {profile.creatorId}</div>}
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Credentials Display Column with copy functions */}
                      <td className="py-4 px-6">
                        <div className="space-y-1 text-xs">
                          {/* Email Copy Line */}
                          <div className="flex items-center gap-2 group/btn">
                            <span className="text-[10px] uppercase font-black text-slate-400 w-10">Email:</span>
                            <span className="font-semibold text-slate-700 text-xs">{profile.email}</span>
                            <button
                              onClick={() => copyToClipboard(profile.email, `${profile.uid}-email`)}
                              className="p-1 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-md transition-all opacity-0 group-hover/btn:opacity-100"
                              title="Copier l'adresse email"
                            >
                              {copiedField === `${profile.uid}-email` ? (
                                <Check className="w-3.5 h-3.5 text-emerald-600" />
                              ) : (
                                <Copy className="w-3.5 h-3.5" />
                              )}
                            </button>
                          </div>

                          <div className="flex items-center gap-2 group/btn">
                            <button
                              onClick={() => void sendPasswordResetLink(profile.email)}
                              className="inline-flex items-center gap-1 rounded-lg bg-indigo-50 px-2 py-1 text-[9px] font-bold text-indigo-700 hover:bg-indigo-100"
                              title="Envoyer un lien de réinitialisation"
                            >
                              <Mail className="h-3 w-3" /> Envoyer un lien de réinitialisation
                            </button>
                          </div>
                        </div>
                      </td>

                      {/* Code de sécurité individuel */}
                      <td className="py-4 px-6">
                        {profile.securityCode ? (
                          <div className="flex items-center gap-2 group/btn">
                            <Shield className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                            <span className="font-mono bg-rose-50 text-rose-700 px-1.5 py-0.5 rounded-md border border-rose-100 text-xs font-black tracking-widest">
                              {visibleCodes[profile.uid] ? profile.securityCode : '••••'}
                            </span>
                            <button
                              onClick={() => toggleCodeVisibility(profile.uid)}
                              className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-md opacity-0 group-hover/btn:opacity-100 transition-all"
                              title={visibleCodes[profile.uid] ? 'Masquer' : 'Afficher le code'}
                            >
                              {visibleCodes[profile.uid] ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                            </button>
                          </div>
                        ) : (
                          <span className="text-[10px] text-slate-300 font-bold uppercase tracking-wider">Non défini</span>
                        )}
                      </td>

                      {/* Rôle Badge */}
                      <td className="py-4 px-6">
                        <span className={cn(
                          "px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-wider inline-flex items-center gap-1.5",
                          profile.role === 'admin'
                            ? "bg-purple-50 text-purple-700 border border-purple-100" 
                            : "bg-blue-50 text-blue-700 border border-blue-100"
                        )}>
                          <Shield className="w-3 h-3" />
                          {profile.role === 'admin' ? 'Administrateur' : isTechnicianProfile(profile, allowed) ? 'Technicien' : 'Casier'}
                        </span>
                      </td>

                      {/* Allowed Menus List */}
                      <td className="py-4 px-6 max-w-xs">
                        <div className="flex flex-wrap gap-1">
                          {MENU_OPTIONS.map((menu) => {
                            const isAllowed = allowed.includes(menu.id);
                            return (
                              <span 
                                key={menu.id} 
                                className={cn(
                                  "text-[9px] px-1.5 py-0.5 rounded-md font-bold transition-all border",
                                  isAllowed 
                                    ? "bg-emerald-50 text-emerald-700 border-emerald-100" 
                                    : "bg-slate-100 text-slate-400 border-transparent opacity-40 line-through"
                                )}
                                title={menu.description}
                              >
                                {menu.name.split(' ')[0]}
                              </span>
                            );
                          })}
                        </div>
                      </td>

                      {/* Statut Badge */}
                      <td className="py-4 px-6">
                        <span className={cn(
                          "px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-wider inline-flex items-center gap-1.5",
                          profile.status === 'banned' 
                            ? "bg-rose-50 text-rose-700 border border-rose-100" 
                            : "bg-emerald-50 text-emerald-700 border border-emerald-100"
                        )}>
                          <span className={cn("w-1.5 h-1.5 rounded-full", profile.status === 'banned' ? "bg-rose-500" : "bg-emerald-500")} />
                          {profile.status === 'banned' ? 'Banni' : 'Actif'}
                        </span>
                      </td>

                      {/* Combined Actions: Edit, Toggle Status, Delete */}
                      <td className="py-4 px-6 text-right">
                        {isSelf ? (
                          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 text-indigo-600 text-[9px] font-black uppercase tracking-wider rounded-xl border border-indigo-100">
                            <Shield className="w-3 h-3" />
                            Compte principal
                          </span>
                        ) : (
                        <div className="flex items-center justify-end gap-2">
                          <div className="flex max-w-[360px] flex-wrap justify-end gap-1.5">
                            <button
                              onClick={() => handleOpenEdit(profile)}
                              className="inline-flex min-h-10 items-center gap-1 px-2.5 py-1.5 bg-slate-105 hover:bg-indigo-50 hover:text-indigo-650 rounded-xl text-[10px] font-extrabold uppercase tracking-wider border border-slate-100 hover:border-indigo-150 transition-colors"
                              title="Modifier ce profil"
                            >
                              <Edit2 className="w-3 h-3" />
                              Modifier
                            </button>
                            <button
                              onClick={() => { setPasswordUser(profile); setNewPassword(''); setConfirmNewPassword(''); setErrorOnCreate(null); }}
                              className="inline-flex min-h-10 items-center gap-1 px-2.5 py-1.5 rounded-xl text-[10px] font-extrabold uppercase tracking-wider border border-indigo-100 bg-indigo-50 text-indigo-700 hover:bg-indigo-100"
                            >
                              <Lock className="w-3 h-3" />
                              Changer le mot de passe
                            </button>
                            <button
                              onClick={() => void sendPasswordResetLink(profile.email)}
                              disabled={actionLoading === profile.uid}
                              className="inline-flex min-h-10 items-center gap-1 px-2.5 py-1.5 rounded-xl text-[10px] font-extrabold uppercase tracking-wider border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                            >
                              <Mail className="w-3 h-3" />
                              Envoyer un lien de réinitialisation
                            </button>
                            <button
                              onClick={() => void handleToggleStatus(profile)}
                              disabled={actionLoading === profile.uid}
                              className={cn(
                                "inline-flex min-h-10 items-center gap-1 px-2.5 py-1.5 rounded-xl text-[10px] font-extrabold uppercase tracking-wider border transition-colors disabled:opacity-50",
                                profile.status === 'banned'
                                  ? "bg-emerald-50/50 text-emerald-600 border-emerald-100 hover:bg-emerald-50"
                                  : "bg-slate-100 text-slate-600 border-transparent hover:bg-rose-50 hover:text-rose-600 hover:border-rose-105"
                              )}
                              title={profile.status === 'banned' ? 'Débloquer cet utilisateur' : 'Bloquer cet utilisateur'}
                            >
                              <Ban className="w-3.5 h-3.5" />
                              {profile.status === 'banned' ? 'Débloquer' : 'Bloquer'}
                            </button>
                            <button
                              onClick={() => { setDeletingUser(profile); setDeleteConfirmation(''); setErrorOnCreate(null); }}
                              disabled={actionLoading === profile.uid}
                              className="inline-flex min-h-10 items-center gap-1 px-2.5 py-1.5 rounded-xl text-[10px] font-extrabold uppercase tracking-wider border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 disabled:opacity-50"
                              title="Supprimer définitivement l'utilisateur"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              Supprimer définitivement
                            </button>
                          </div>
                        </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {passwordUser && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm" role="presentation">
          <form onSubmit={handleChangeUserPassword} className="w-full max-w-md space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="change-user-password-title">
            <div>
              <h2 id="change-user-password-title" className="text-lg font-black text-slate-900">Changer le mot de passe</h2>
              <p className="mt-1 text-sm text-slate-600">{passwordUser.email}</p>
            </div>
            <label className="block space-y-1 text-xs font-bold text-slate-600">Nouveau mot de passe
              <input type="password" autoComplete="new-password" minLength={8} required value={newPassword} onChange={event => setNewPassword(event.target.value)} className="w-full rounded-xl border border-slate-300 px-3 py-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600" />
            </label>
            <label className="block space-y-1 text-xs font-bold text-slate-600">Confirmer le nouveau mot de passe
              <input type="password" autoComplete="new-password" minLength={8} required value={confirmNewPassword} onChange={event => setConfirmNewPassword(event.target.value)} className="w-full rounded-xl border border-slate-300 px-3 py-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600" />
            </label>
            {errorOnCreate && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-xs font-semibold text-rose-700">{errorOnCreate}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => { setPasswordUser(null); setErrorOnCreate(null); }} className="min-h-10 rounded-xl border border-slate-300 px-4 text-sm font-bold text-slate-700">Annuler</button>
              <button type="submit" disabled={actionLoading === passwordUser.uid || newPassword.length < 8 || newPassword !== confirmNewPassword} className="min-h-10 rounded-xl bg-indigo-600 px-4 text-sm font-bold text-white disabled:opacity-50">{actionLoading === passwordUser.uid ? 'Modification…' : 'Confirmer'}</button>
            </div>
          </form>
        </div>
      )}

      {deletingUser && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm" role="presentation">
          <section className="w-full max-w-md space-y-4 rounded-2xl border border-rose-200 bg-white p-6 shadow-2xl" role="alertdialog" aria-modal="true" aria-labelledby="delete-user-title">
            <div className="flex items-start gap-3">
              <div className="rounded-xl bg-rose-100 p-2 text-rose-700"><AlertCircle className="h-5 w-5" /></div>
              <div>
                <h2 id="delete-user-title" className="text-lg font-black text-slate-900">Supprimer définitivement</h2>
                <p className="mt-2 text-sm leading-relaxed text-slate-700">Êtes-vous sûr ? Cette action est définitive : le compte et l'accès de l'utilisateur seront supprimés.</p>
              </div>
            </div>
            <p className="text-sm text-slate-600">Saisissez l’email <strong className="text-slate-900">{deletingUser.email}</strong> ou <strong>SUPPRIMER</strong> pour confirmer.</p>
            <input autoFocus value={deleteConfirmation} onChange={event => setDeleteConfirmation(event.target.value)} aria-label="Confirmation de suppression" className="w-full rounded-xl border border-slate-300 px-3 py-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-600" />
            {deletingUser.role === 'admin' && users.filter(profile => profile.role === 'admin' && (profile.ownerId || profile.uid) === (userProfile?.ownerId || userProfile?.uid)).length <= 1 && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-xs font-semibold text-rose-700">Impossible de supprimer le dernier administrateur du magasin.</p>}
            {errorOnCreate && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-xs font-semibold text-rose-700">{errorOnCreate}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => { setDeletingUser(null); setDeleteConfirmation(''); setErrorOnCreate(null); }} className="min-h-10 rounded-xl border border-slate-300 px-4 text-sm font-bold text-slate-700">Annuler</button>
              <button type="button" onClick={() => void handleDeleteProfileAndAuth(deletingUser)} disabled={actionLoading === deletingUser.uid || (deleteConfirmation.trim().toLowerCase() !== deletingUser.email.toLowerCase() && deleteConfirmation.trim() !== 'SUPPRIMER') || (deletingUser.role === 'admin' && users.filter(profile => profile.role === 'admin' && (profile.ownerId || profile.uid) === (userProfile?.ownerId || userProfile?.uid)).length <= 1)} className="min-h-10 rounded-xl bg-rose-700 px-4 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50">{actionLoading === deletingUser.uid ? 'Suppression…' : 'Supprimer définitivement'}</button>
            </div>
          </section>
        </div>
      )}

      {migrationConfirmOpen && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/60 p-4" role="presentation">
          <section className="w-full max-w-md space-y-4 rounded-2xl bg-white p-6 shadow-2xl" role="alertdialog" aria-modal="true">
            <h2 className="text-lg font-black text-slate-900">Confirmer la migration</h2>
            <p className="text-sm text-slate-600">Les permissions des comptes prévisualisés seront mises à jour. Une sauvegarde JSON a été téléchargée.</p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setMigrationConfirmOpen(false)} className="min-h-10 rounded-xl border border-slate-300 px-4 text-sm font-bold">Annuler</button>
              <button type="button" onClick={() => void confirmPermissionMigration()} className="min-h-10 rounded-xl bg-amber-700 px-4 text-sm font-bold text-white">Confirmer la migration</button>
            </div>
          </section>
        </div>
      )}

      {/* Creation Modal (Add User) */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm overflow-y-auto animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg my-8 overflow-hidden border border-slate-100 animate-in zoom-in-95 duration-200">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-55/30">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-indigo-50 text-indigo-600 rounded-xl">
                  <UserPlus className="w-4 h-4" />
                </div>
                <h2 className="text-sm font-black text-slate-800 uppercase tracking-wider">Ajouter un Utilisateur</h2>
              </div>
              <button 
                onClick={() => setIsModalOpen(false)} 
                className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-55 rounded-xl transition-all"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateUser} className="p-6 space-y-4 max-h-[80vh] overflow-y-auto">
              {errorOnCreate && (
                <div className="p-3.5 bg-rose-50 border border-rose-100 rounded-xl text-rose-700 text-xs font-bold leading-normal flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-500 shrink-0" />
                  {errorOnCreate}
                </div>
              )}

              {/* Nom complet */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Nom complet</label>
                <div className="relative">
                  <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    type="text"
                    required
                    value={nameInput}
                    onChange={(e) => setNameInput(e.target.value)}
                    placeholder="Ex: Jean Dupont"
                    className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-semibold outline-none focus:ring-2 focus:ring-indigo-500/10 focus:border-indigo-500 transition-shadow"
                  />
                </div>
              </div>

              {/* Email */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Adresse Email de connexion</label>
                <div className="relative">
                  <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    type="email"
                    required
                    value={emailInput}
                    onChange={(e) => setEmailInput(e.target.value)}
                    placeholder="caissier1@phoneclinic.tn"
                    className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-semibold outline-none focus:ring-2 focus:ring-indigo-500/10 focus:border-indigo-500 transition-shadow"
                  />
                </div>
              </div>

              {/* Password */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Mot de passe (Min 6 caractères)</label>
                <div className="relative">
                  <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    type="password"
                    required
                    value={passwordInput}
                    onChange={(e) => setPasswordInput(e.target.value)}
                    placeholder="Mot de passe à définir dans Firebase Auth"
                    className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-semibold outline-none focus:ring-2 focus:ring-indigo-500/10 focus:border-indigo-500 transition-shadow"
                  />
                </div>
              </div>

              {/* Base Role */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Rôle de Base</label>
                <select
                  value={roleInput}
                  onChange={(e) => handleRoleChangeOnCreate(e.target.value as UserFormRole)}
                  className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500/10 focus:border-indigo-500 transition-shadow"
                >
                  <option value="user">Compte à menus personnalisés</option>
                  <option value="cashier-repair">Casier + Réparation</option>
                  <option value="technician">Technicien (Réparation et pièces)</option>
                  <option value="admin">Administrateur (Accès Intégral)</option>
                </select>
              </div>

              {/* Menus Accesses Checkboxes */}
              <div className="border-t border-slate-100 pt-4 space-y-2">
                <div>
                  <label className="text-[10px] font-black text-indigo-600 uppercase tracking-widest block">Menus latéraux autorisés</label>
                  <span className="text-[9px] text-slate-400 font-medium">
                    {roleInput === 'technician'
                      ? 'Le technicien gère réparations, pièces, articles/services et clients, sans prix d’achat ni encaissement.'
                      : 'Configurez les sections auxquelles cet utilisateur aura accès :'}
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {MENU_OPTIONS.filter((menu) => {
                    if (roleInput === 'technician') return TECHNICIAN_MENUS.includes(menu.id);
                    if (roleInput !== 'admin' && menu.id === 'users') return false;
                    return true;
                  }).map((menu) => {
                    const isChecked = selectedMenus.includes(menu.id);
                    return (
                      <button
                        type="button"
                        key={menu.id}
                        onClick={() => { if (roleInput !== 'technician' || TECHNICIAN_MENUS.includes(menu.id)) handleToggleMenuSelection(menu.id); }}
                        className={cn(
                          "p-3 rounded-2xl text-left border transition-all flex items-start gap-2.5 hover:bg-slate-50",
                          isChecked 
                            ? "bg-indigo-50/40 border-indigo-200 text-indigo-900" 
                            : "bg-white border-slate-100 text-slate-600"
                        )}
                      >
                        <div className={cn(
                          "w-4 h-4 rounded-md border flex items-center justify-center shrink-0 mt-0.5 transition-all",
                          isChecked 
                            ? "bg-indigo-600 border-indigo-600 text-white" 
                            : "bg-white border-slate-350"
                        )}>
                          {isChecked && <Check className="w-3 h-3 stroke-[3.5]" />}
                        </div>
                        <div>
                          <div className="text-xs font-extrabold leading-tight">
                            {menu.id === 'reparation' ? 'Partie Réparation' : menu.name}
                          </div>
                          <p className="text-[9px] text-slate-400 leading-normal mt-0.5">{menu.description}</p>
                        </div>
                      </button>
                    );
                  })}
                </div>
                {roleInput !== 'admin' && renderPermissionOptions(selectedMenus, permissionsInput, setPermissionsInput)}
              </div>

              {/* Submit / Action Buttons */}
              <div className="pt-4 flex gap-3 border-t border-slate-100 font-sans">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="flex-1 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-black uppercase tracking-wider rounded-xl transition-colors"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={actionLoading !== null}
                  className="flex-1 py-3 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-black uppercase tracking-wider rounded-xl transition-all shadow-lg shadow-indigo-600/15"
                >
                  {actionLoading === 'creating' ? 'Création en cours...' : 'Créer le compte'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Unified Edit Modal */}
      {editingUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm overflow-y-auto animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg my-8 overflow-hidden border border-slate-100 animate-in zoom-in-95 duration-200">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-indigo-50 text-indigo-600 rounded-xl">
                  <Edit2 className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="text-sm font-black text-slate-800 uppercase tracking-wider">Modifier l'Utilisateur</h2>
                  <p className="text-[10px] text-slate-400 font-bold mt-0.5">{editingUser.email}</p>
                </div>
              </div>
              <button 
                onClick={() => setEditingUser(null)} 
                className="p-2 text-slate-400 hover:text-slate-650 hover:bg-slate-50 rounded-xl transition-all"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveEdit} className="p-6 space-y-4 max-h-[80vh] overflow-y-auto">
              {errorOnEdit && (
                <div className="p-3.5 bg-rose-50 border border-rose-100 rounded-xl text-rose-700 text-xs font-bold leading-normal flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-500 shrink-0" />
                  {errorOnEdit}
                </div>
              )}

              {/* Nom complet */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block font-bold">Nom complet</label>
                <div className="relative">
                  <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    type="text"
                    required
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    placeholder="Ex: Jean Dupont"
                    className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-semibold outline-none focus:ring-2 focus:ring-indigo-500/10 focus:border-indigo-500 transition-shadow"
                  />
                </div>
              </div>

              {/* Email */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block font-bold">Email de connexion</label>
                <div className="relative">
                  <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    type="email"
                    value={editEmail}
                    readOnly
                    className="w-full cursor-not-allowed pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                <span>Le changement de mot de passe se fait via le lien sécurisé envoyé à cette adresse.</span>
                <button type="button" onClick={() => void sendPasswordResetLink(editingUser.email)} className="shrink-0 rounded-lg bg-amber-700 px-3 py-2 font-bold text-white hover:bg-amber-800">
                  Envoyer un lien de réinitialisation
                </button>
              </div>

              {/* Code de sécurité individuel (modification/suppression) */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-rose-500 uppercase tracking-widest block font-bold flex items-center gap-1.5">
                  <Shield className="w-3.5 h-3.5" />
                  Code de sécurité (4 chiffres)
                </label>
                <div className="relative">
                  <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-rose-400" />
                  <input
                    type="text"
                    maxLength={4}
                    inputMode="numeric"
                    value={editSecurityCode}
                    onChange={(e) => setEditSecurityCode(e.target.value.replace(/[^0-9]/g, '').slice(0, 4))}
                    placeholder="Ex: 1234 (laisser vide = aucun)"
                    className="w-full pl-10 pr-4 py-2.5 bg-rose-50/30 border border-rose-100 rounded-xl text-xs font-mono font-black tracking-[0.3em] outline-none focus:ring-2 focus:ring-rose-500/10 focus:border-rose-500 transition-shadow"
                  />
                </div>
                <p className="text-[9px] text-slate-400 font-medium leading-relaxed">
                  Ce code sera demandé à cet utilisateur avant toute modification ou suppression. Laisser vide pour ne définir aucun code.
                </p>
              </div>

              {/* Role */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block font-bold">Rôle</label>
                <select
                  value={editRole}
                  onChange={(e) => {
                    const newRole = e.target.value as UserFormRole;
                    setEditRole(newRole);
                    if (newRole === 'technician') {
                      setEditSelectedMenus(TECHNICIAN_MENUS);
                    } else if (newRole === 'cashier-repair') {
                      setEditSelectedMenus(CASHIER_REPAIR_MENUS);
                    } else if (newRole === 'user') {
                      setEditSelectedMenus((prev) => ['technician', 'cashier-repair'].includes(editRole)
                        ? DEFAULT_USER_MENUS
                        : prev.filter((mid) => mid !== 'users'));
                    } else if (newRole === 'admin') {
                      setEditSelectedMenus(MENU_OPTIONS.map((m) => m.id));
                    }
                    setEditPermissions(permissionsForPreset(presetFromRole(newRole)));
                  }}
                  className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500/10 focus:border-indigo-500 transition-shadow"
                >
                  <option value="user">Compte à menus personnalisés</option>
                  <option value="cashier-repair">Casier + Réparation</option>
                  <option value="technician">Technicien (Réparation et pièces)</option>
                  <option value="admin">Administrateur (Accès Intégral)</option>
                </select>
              </div>

              {/* Status */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block font-bold">Statut du compte</label>
                <select
                  value={editStatus}
                  onChange={(e) => setEditStatus(e.target.value as 'active' | 'banned')}
                  className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500/10 focus:border-indigo-500 transition-shadow"
                >
                  <option value="active">Actif (Accès autorisé)</option>
                  <option value="banned">Bloqué / Banni (Accès refusé)</option>
                </select>
              </div>

              {/* Menu privileges checkboxes */}
              <div className="border-t border-slate-100 pt-4 space-y-2">
                <div>
                  <label className="text-[10px] font-black text-indigo-600 uppercase tracking-widest block font-bold">Modifier les Menus Autorisés</label>
                  <span className="text-[9px] text-slate-400 font-medium">Cochez les sections visibles dans la barre latérale pour cet utilisateur :</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {MENU_OPTIONS.filter((menu) => {
                    if (editRole === 'technician') return TECHNICIAN_MENUS.includes(menu.id);
                    if (editRole === 'user' && menu.id === 'users') return false;
                    return true;
                  }).map((menu) => {
                    const isChecked = editSelectedMenus.includes(menu.id);
                    return (
                      <button
                        type="button"
                        key={menu.id}
                        onClick={() => { if (editRole !== 'technician' || TECHNICIAN_MENUS.includes(menu.id)) handleToggleEditMenuSelection(menu.id); }}
                        className={cn(
                          "p-3 rounded-2xl text-left border transition-all flex items-start gap-2.5 hover:bg-slate-50",
                          isChecked 
                            ? "bg-indigo-50/40 border-indigo-200 text-indigo-900" 
                            : "bg-white border-slate-100 text-slate-600"
                        )}
                      >
                        <div className={cn(
                          "w-4 h-4 rounded-md border flex items-center justify-center shrink-0 mt-0.5 transition-all",
                          isChecked 
                            ? "bg-indigo-600 border-indigo-600 text-white" 
                            : "bg-white border-slate-350"
                        )}>
                          {isChecked && <Check className="w-3 h-3 stroke-[3.5]" />}
                        </div>
                        <div>
                          <div className="text-xs font-extrabold leading-tight">
                            {menu.id === 'reparation' ? 'Partie Réparation' : menu.name}
                          </div>
                          <p className="text-[9px] text-slate-400 leading-normal mt-0.5">{menu.description}</p>
                        </div>
                      </button>
                    );
                  })}
                </div>
                {editRole !== 'admin' && renderPermissionOptions(editSelectedMenus, editPermissions, setEditPermissions)}
              </div>

              {/* Save Buttons */}
              <div className="pt-4 flex gap-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setEditingUser(null)}
                  className="flex-1 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-black uppercase tracking-wider rounded-xl transition-colors"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={actionLoading !== null}
                  className="flex-1 py-3 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-black uppercase tracking-wider rounded-xl transition-all shadow-lg shadow-indigo-600/15"
                >
                  {actionLoading === 'editing' ? 'Enregistrement...' : 'Enregistrer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
