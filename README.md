# Phone Clinic

Application React + TypeScript pour la caisse, les réparations et la gestion des stocks, avec Firebase.

## Installation locale

1. Installez une version récente de Node.js.
2. Installez les dépendances : `npm ci`.
3. Copiez `.env.example` vers `.env.local` et renseignez la configuration Web Firebase du projet.
4. Lancez `npm run dev`.

Les six variables `VITE_FIREBASE_*` sont obligatoires. Au démarrage, l’application affiche la liste des paramètres manquants. `VITE_FIRESTORE_DATABASE_ID` est facultative et vaut `(default)` par défaut. L’inscription publique reste désactivée sauf si `VITE_ALLOW_SELF_SIGNUP=true` est explicitement défini.

Pour lancer le serveur complet en local, configurez aussi `FIREBASE_PROJECT_ID` et les identifiants Admin (`FIREBASE_SERVICE_ACCOUNT` en JSON/base64 ou `GOOGLE_APPLICATION_CREDENTIALS`), puis exécutez `npm start`. En l’absence de `NODE_ENV=development`, le serveur sert le build `dist` ; produisez-le d’abord avec `npm run build`.

## Commandes

- `npm run lint` : vérification TypeScript (`tsc --noEmit`).
- `npm run build` : build de production dans `dist`.
- `npm run preview` : aperçu du build.

`npm run build` crée le front dans `dist`. Pour le service Render qui sert le front et l’API, utilisez Build `npm install && npm run build`, Start `npm start` et Health Check `/healthz`. Consultez [la procédure Render et la configuration Firebase](./docs/INSTALLATION_CLIENT.md). Les règles Firestore ne sont jamais déployées par ces commandes.

## Scripts d’administration Firebase

Ces scripts utilisent `firebase-admin` et Application Default Credentials. Configurez `GOOGLE_APPLICATION_CREDENTIALS` vers un compte de service protégé, et `FIREBASE_PROJECT_ID` (ou `VITE_FIREBASE_PROJECT_ID`). Pour une base nommée, définissez également `FIRESTORE_DATABASE_ID`.

- `npm run create:first-admin -- <email> <motdepasse>` : aperçu, confirmation explicite, création du compte Auth et du profil admin.
- `npm run set:super-admin -- <email> [grant|revoke]` : aperçu, confirmation, attribution/retrait du claim `superAdmin`.
- `npm run purge:passwords` : aperçu, sauvegarde JSON locale ignorée par Git, confirmation, puis suppression des anciens champs `password` des profils `users`.

Ne commitez jamais les fichiers `.env*` (sauf `.env.example`), comptes de service ou sauvegardes. Le fichier de sauvegarde du script de purge contient les anciennes valeurs et doit être gardé sous contrôle d’accès strict, puis supprimé de façon sûre après validation.

## Mise en vente

Suivez [docs/INSTALLATION_CLIENT.md](./docs/INSTALLATION_CLIENT.md), puis la [checklist de vente](./docs/CHECKLIST_VENTE.md). Consultez aussi [l’architecture](./docs/ARCHITECTURE.md). L’ordre de déploiement des claims, de la purge, des règles et du build est critique et décrit en tête du guide d’installation.
