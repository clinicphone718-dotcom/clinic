import React, { useEffect, useState } from 'react';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, signInWithPopup, signInWithRedirect, GoogleAuthProvider, signOut } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { ShoppingCart, Mail, Lock, AlertCircle, Chrome } from 'lucide-react';
import { ALLOW_SELF_SIGNUP } from '../config/firebase';
import { APP_LOGO_URL, APP_NAME, APP_TAGLINE } from '../config/brand';

export default function Login({ initialMessage = '' }: { initialMessage?: string }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isRegistering, setIsRegistering] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (initialMessage) setError(initialMessage);
  }, [initialMessage]);

  const handleGoogleLogin = async () => {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });

    setError('');
    setLoading(true);

    try {
      await signInWithPopup(auth, provider);
    } catch (err: any) {
      console.error('Google sign-in failed.');

      if (err?.code === 'auth/popup-closed-by-user') {
        setError('La fenêtre de connexion Google a été fermée. Réessayez.');
      } else if (err?.code === 'auth/popup-blocked' || err?.code === 'auth/cancelled-popup-request' || err?.code === 'auth/operation-not-supported-in-this-environment') {
        setError('La popup a été bloquée par le navigateur. Redirection en cours…');
        try {
          await signInWithRedirect(auth, provider);
        } catch (redirectErr: any) {
          console.error('Google sign-in redirect failed.');
          setError('La redirection Google a échoué. Vérifiez les paramètres Firebase et réessayez.');
        }
      } else if (err?.code === 'auth/unauthorized-domain') {
        setError(`Ce domaine n'est pas autorisé dans Firebase Console: ${window.location.hostname}. Ajoutez localhost ou ce domaine dans Authentication > Settings > Authorized domains.`);
      } else if (err?.code === 'auth/operation-not-allowed') {
        setError('Le fournisseur Google n\'est pas activé dans Firebase Console. Activez Google dans Authentication > Sign-in method.');
      } else if (err?.code === 'auth/network-request-failed') {
        setError('La connexion réseau a échoué. Vérifiez votre connexion Internet puis réessayez.');
      } else {
        setError(err?.message || 'Erreur Google inconnue.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (isRegistering) {
        if (!ALLOW_SELF_SIGNUP) {
          throw new Error('L’inscription publique est désactivée. Contactez l’administrateur.');
        }
        await createUserWithEmailAndPassword(auth, email, password);
      } else {
        // Connexion Firebase Auth d'abord (les règles Firestore exigent un utilisateur authentifié pour lire)
        const userCred = await signInWithEmailAndPassword(auth, email, password);

        // Ensuite, vérifier dans Firestore si le compte est banni.
        // Lecture directe par UID (plus fiable qu'une requête "list" par email),
        // avec quelques tentatives en cas de léger retard de propagation du jeton d'authentification.
        let profileData: any = null;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const userSnap = await getDoc(doc(db, 'users', userCred.user.uid));
            if (userSnap.exists()) {
              profileData = userSnap.data();
            }
            break;
          } catch (checkErr: any) {
            const isPermissionIssue = checkErr.code === 'permission-denied';
            if (isPermissionIssue && attempt < 2) {
              await new Promise((resolve) => setTimeout(resolve, 400));
              continue;
            }
            // Après plusieurs tentatives, on ne bloque pas la connexion pour ça :
            // le contrôle du statut banni sera de toute façon réappliqué en temps réel
            // par l'écoute du profil dans App.tsx.
            console.warn('Account status check is temporarily unavailable.');
            break;
          }
        }

        if (profileData) {
          if (profileData.status === 'banned') {
            await signOut(auth);
            throw new Error("Votre compte a été banni. Veuillez contacter l'administrateur.");
          }
        }
      }
    } catch (err: any) {
      if (err.code === 'auth/operation-not-allowed') {
        setError("L'inscription par Email n'est pas activée dans la console Firebase. Utilisez Google ou activez 'Email/Password' dans l'onglet Authentication.");
      } else {
        setError(err.message || "Une erreur s'est produite lors de la connexion.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100 p-4">
      <div className="max-w-md w-full bg-white rounded-3xl shadow-xl shadow-slate-200/60 p-6 sm:p-8 border border-slate-200/80">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-tr from-indigo-50 to-cyan-50 text-indigo-600 mb-4 shadow-sm border border-indigo-100">
            {APP_LOGO_URL ? <img src={APP_LOGO_URL} alt="" className="h-full w-full rounded-2xl object-cover" /> : <ShoppingCart className="w-8 h-8 text-indigo-600" />}
          </div>
          <h1 className="text-3xl sm:text-4xl font-black tracking-tight font-display">
            <span className="bg-gradient-to-r from-indigo-600 via-indigo-500 to-cyan-500 bg-clip-text text-transparent">
              {APP_NAME}
            </span>
            <span className="block text-base sm:text-lg font-bold text-slate-500 mt-1 font-sans tracking-wide">{APP_TAGLINE}</span>
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-2 font-medium">
            Connectez-vous à votre espace magasin
          </p>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-2xl flex items-center gap-3 text-red-700 text-xs sm:text-sm">
            <AlertCircle className="w-5 h-5 flex-shrink-0" />
            <p>{error}</p>
          </div>
        )}

        {/* Primary Google Login Button */}
        <div className="space-y-3">
          <button
            onClick={handleGoogleLogin}
            disabled={loading}
            className="w-full py-3.5 sm:py-4 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white font-extrabold rounded-2xl transition-all flex items-center justify-center gap-3 shadow-lg shadow-indigo-600/25 text-sm sm:text-base cursor-pointer disabled:opacity-50"
          >
            <div className="w-6 h-6 flex items-center justify-center bg-white rounded-full">
              <Chrome className="w-4 h-4 text-indigo-600" />
            </div>
            <span>Se connecter avec Google</span>
          </button>
          <p className="text-[11px] text-center text-slate-400 font-medium">
            Connexion sécurisée en 1 clic (Compte Super Admin pris en charge)
          </p>
        </div>

        <div className="my-6 flex items-center gap-4">
          <div className="flex-1 h-px bg-slate-200"></div>
          <span className="text-[10px] text-slate-400 font-black uppercase tracking-wider">Ou avec identifiants</span>
          <div className="flex-1 h-px bg-slate-200"></div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-600 mb-1.5 uppercase tracking-wider">Email</label>
            <div className="relative">
              <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all text-sm font-medium"
                placeholder="contact@phoneclinic.tn"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-600 mb-1.5 uppercase tracking-wider">Mot de passe</label>
            <div className="relative">
              <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all text-sm font-medium"
                placeholder="••••••••"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-slate-800 text-white font-bold rounded-xl hover:bg-slate-900 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm text-xs sm:text-sm cursor-pointer"
          >
            {loading ? 'Chargement...' : isRegistering ? "Créer un compte par Email" : 'Se connecter par Email'}
          </button>
        </form>

        {ALLOW_SELF_SIGNUP && <div className="mt-6 text-center">
          <button
            onClick={() => setIsRegistering(!isRegistering)}
            className="text-xs font-semibold text-indigo-600 hover:text-indigo-700 transition-colors cursor-pointer"
          >
            {isRegistering ? 'Déjà un compte ? Se connecter par Email' : "Besoin de créer un compte par Email ? S'inscrire"}
          </button>
        </div>}
      </div>
    </div>
  );
}
