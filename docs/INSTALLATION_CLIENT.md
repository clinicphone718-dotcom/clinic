# Installation d’un client

## Ordre obligatoire avant le déploiement des nouvelles règles

Pour une installation existante, suivez cet ordre sans l’inverser :

1. **Attribuer les claims super-admin** aux comptes de plateforme qui doivent conserver les accès transverses. Exécutez le script `set-super-admin` avec l’ancien environnement encore fonctionnel, puis demandez aux comptes de se reconnecter ou de renouveler leur jeton.
2. **Purger les anciens mots de passe Firestore** avec `npm run purge:passwords`. Vérifiez que le fichier JSON de sauvegarde local a été créé, copié et protégé avant de confirmer la suppression.
3. **Déployer les règles** avec `firebase deploy --only firestore:rules`.
4. **Construire et publier Netlify** avec les variables d’environnement du bon client.

Les super-admins actuels doivent recevoir `superAdmin: true` **avant** les nouvelles règles : sinon les accès multi-magasins disparaissent à l’étape 3.

## 1. Créer le projet Firebase

1. Créez un projet Firebase distinct pour le client.
2. Dans **Authentication > Sign-in method**, activez Email/Password.
3. Dans **Authentication > Settings > Authorized domains**, ajoutez d’abord les domaines provisoires prévus, puis le domaine Netlify et le domaine personnalisé.
4. Créez Firestore en mode production, choisissez une région proche du client et notez l’identifiant de base. Utilisez `(default)` si la base par défaut est utilisée.
5. Créez une application Web Firebase et copiez les paramètres de configuration Web dans les variables d’environnement du site. Ce sont des paramètres publics de client, pas des identifiants de compte de service ; restreignez la clé API par HTTP referrers dans Google Cloud aux domaines du client.
6. Vérifiez les quotas, les alertes de budget et la facturation du projet avant la mise en service.

## 2. Créer les comptes initiaux

Dans un environnement administratif local, installez les dépendances, configurez `GOOGLE_APPLICATION_CREDENTIALS` vers un compte de service protégé et définissez `FIREBASE_PROJECT_ID`. N’ajoutez jamais ce compte de service au dépôt.

Créer le premier compte admin de magasin (le mot de passe est fourni à Auth seulement) :

```sh
npm run create:first-admin -- admin@exemple-client.tld 'mot-de-passe-temporaire'
```

Le script présente un aperçu et exige la confirmation exacte `OUI`. Attribuez le claim plateforme si ce compte doit aussi être super-admin :

```sh
npm run set:super-admin -- admin@exemple-client.tld grant
```

Le script d’attribution affiche un aperçu et exige la confirmation `OUI`. Après l’attribution, le compte doit renouveler son jeton ou se reconnecter.

Pour une migration d’un ancien magasin, appliquez d’abord l’étape 1 « Ordre obligatoire » ci-dessus. Le script de purge affiche les profils concernés, crée sous `backups/` une sauvegarde JSON qui contient les anciennes valeurs, puis demande une seconde confirmation avant toute écriture Firestore.

## 3. Variables d’environnement

Pour Render, renseignez les variables dans **Environment**. En local, copiez `.env.example` vers `.env.local`.

| Variable | Obligatoire | Exemple / usage |
|---|---:|---|
| `PORT` | Render fourni | Port d’écoute ; défaut local `3000` |
| `NODE_ENV` | oui en production | `production` sur Render |
| `FIREBASE_PROJECT_ID` | oui | Projet utilisé par Firebase Admin SDK |
| `FIRESTORE_DATABASE_ID` | non | Base Admin Firestore, défaut `(default)` |
| `FIREBASE_SERVICE_ACCOUNT` | recommandé | JSON brut ou base64 du compte de service ; secret |
| `SUPER_ADMIN_EMAILS` | non | Liste séparée par virgules ; laisser vide par défaut |
| `GMAIL_USER` | non | Compte Gmail d’envoi OTP ; vide = envoi désactivé |
| `GMAIL_APP_PASSWORD` | non | Mot de passe d’application Gmail ; secret |
| `APP_NAME` | non | Nom dans les courriels et factures, défaut `Phone Clinic` |
| `ALLOWED_ORIGIN` | non | Origine exacte cross-origin ; vide = même origine uniquement |
| `VITE_FIREBASE_API_KEY` | oui | Clé Web Firebase du client, restreinte par domaine |
| `VITE_FIREBASE_AUTH_DOMAIN` | oui | `projet.firebaseapp.com` |
| `VITE_FIREBASE_PROJECT_ID` | oui | Identifiant du projet Firebase |
| `VITE_FIREBASE_APP_ID` | oui | ID de l’application Web |
| `VITE_FIREBASE_STORAGE_BUCKET` | oui | Bucket indiqué par Firebase |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | oui | Sender ID indiqué par Firebase |
| `VITE_FIRESTORE_DATABASE_ID` | non | `(default)` ou ID de la base nommée |
| `VITE_ALLOW_SELF_SIGNUP` | non | `false` par défaut ; ne l’activer que si souhaité |
| `VITE_API_URL` | non | URL absolue de l’API, avec ou sans suffixe `/api`; vide pour même origine ou proxy Netlify |
| `VITE_APP_NAME` | non | Nom commercial, défaut `Phone Clinic` |
| `VITE_APP_SHORT_NAME` | non | Nom court de marque |
| `VITE_APP_TAGLINE` | non | Défaut `Caisse & Réparation` |
| `VITE_APP_PRIMARY_COLOR` | non | Couleur hexadécimale de marque |
| `VITE_APP_LOGO` | non | URL locale du logo, défaut `/icon.svg` |
| `GOOGLE_APPLICATION_CREDENTIALS` | non | Chemin local au JSON du compte de service ; alternative à `FIREBASE_SERVICE_ACCOUNT` |

Les variables `VITE_*` sont incorporées dans les fichiers du navigateur au build. Ne mettez jamais de mot de passe de service, clé privée ou secret Admin SDK dans ces variables.

## 4. Déployer le service sur Render

1. Créez un **Web Service** Render relié au dépôt privé du client.
2. Build Command : `npm install && npm run build`.
3. Start Command : `npm start`.
4. Health Check Path : `/healthz`.
5. Définissez `NODE_ENV=production`, `FIREBASE_PROJECT_ID`, les variables `VITE_*` et, si nécessaire, `FIRESTORE_DATABASE_ID`. Render fournit `PORT`.
6. Créez un compte de service Firebase limité au projet du client. Renseignez son JSON brut ou encodé en base64 dans le secret Render `FIREBASE_SERVICE_ACCOUNT`. Ne commitez jamais la clé. En local, `GOOGLE_APPLICATION_CREDENTIALS` peut pointer vers le fichier protégé.
7. Créez le premier administrateur depuis le shell Render ou un environnement local disposant de la clé de service et de `FIREBASE_PROJECT_ID` : `npm run create:first-admin -- admin@exemple-client.tld 'mot-de-passe-temporaire'`. Vérifiez l’aperçu et confirmez avec `OUI`. Évitez de laisser le mot de passe dans un historique de commandes partagé.
8. Laissez `ALLOWED_ORIGIN` vide lorsque l’API et le front partagent la même origine. Sinon, renseignez l’origine exacte autorisée.

Le serveur répond sans authentification sur `/healthz`. En production, il sert l’API et les fichiers de `dist` depuis le même processus.

## 5. Règles Firestore

Après avoir attribué les claims existants et purgé les champs en clair, vérifiez les règles puis déployez-les :

```sh
firebase deploy --only firestore:rules
```

Cette commande n’est pas lancée par l’application ni par ce guide. Vérifiez au préalable que la CLI Firebase cible le projet client attendu.

## 6. Netlify (déploiement statique alternatif)

1. Créez un site Netlify lié au dépôt GitHub privé du client.
2. Build command : `npm run build`.
3. Publish directory : `dist`.
4. Ajoutez les variables `VITE_*` applicables à ce magasin, puis déclenchez un nouveau build.
5. La redirection SPA et les en-têtes de base sont fournis dans `netlify.toml`.
6. Ajoutez le domaine Netlify généré et le domaine personnalisé dans **Authentication > Authorized domains** Firebase.
7. Restreignez la clé API Web à ces domaines, notamment les sous-domaines nécessaires au site.

### Relier le front Netlify à l’API Render

Le front statique ne peut pas exécuter les routes Express `/api/*`. Pour les fonctionnalités serveur (gestion avancée des comptes, génération PDF et envoi OTP), déployez d’abord le service complet sur Render en suivant l’étape 4.

1. Copiez l’URL HTTPS publique du service Render.
2. Dans `public/_redirects`, remplacez `https://REMPLACER-PAR-LE-SERVICE.onrender.com` par cette URL, puis décommentez la règle `/api/*` (retirez le `#` initial). Gardez cette règle avant `/* /index.html 200`.
3. Laissez `VITE_API_URL` vide dans les variables du site Netlify : le client appellera `/api` sur sa propre origine et Netlify transmettra la requête à Render avec son jeton Firebase.
4. Redéployez le site Netlify afin que le fichier `_redirects` actualisé soit publié.
5. Vérifiez que `/healthz` répond directement sur l’URL Render, puis testez une fonctionnalité API authentifiée depuis le domaine Netlify. `/healthz` n’est pas une route `/api/*`.

En variante, déployez le serveur Express et le front sur le même service Render : la commande `npm start` sert alors `dist` et `/api` sur une origine commune, sans proxy Netlify.

## 7. Contrôles après publication

- Vérifiez la page de connexion et l’accès d’un compte de test Casier, Technicien et admin.
- Vérifiez que la création publique reste refusée si `VITE_ALLOW_SELF_SIGNUP=false`. Cette variable n’est pas un contrôle de sécurité côté serveur ; désactivez aussi l’inscription Email/Password publique dans Firebase si le plan et le mode d’administration le permettent.
- Si l’inscription publique ne peut pas être désactivée, des créations Auth sans profil autorisé restent possibles et peuvent consommer le quota/facturation. Elles ne doivent pas obtenir de profil applicatif.
- Vérifiez l’ouverture des écrans de réparation, caisse, stock et Coran & Adhkar, puis la lecture audio sur un appareil réel.
- Planifiez une sauvegarde Firestore et documentez la personne responsable.
