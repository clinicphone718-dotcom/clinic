# Architecture

## Application

Client React + TypeScript construit par Vite. La configuration Firebase Web et la marque sont injectées par variables d’environnement `VITE_*` au build ; l’identifiant de base Firestore est `VITE_FIRESTORE_DATABASE_ID`. `main.tsx` affiche la liste des variables Firebase manquantes au lieu de démarrer une application partiellement configurée.

## Données Firestore

- `users` : profil, rôle, statut, menus et permissions détaillées ; aucun mot de passe ne doit y être stocké.
- `products`, `parts`, `clients`, `sales`, `invoices`, `repairs`, mouvements et collections de coûts : données de vente, atelier et inventaire, isolées par magasin (`ownerId`) et protégées par les règles.
- `part_costs`, `product_costs`, `repair_costs` : données de coûts accessibles aux rôles autorisés seulement.
- `startup_config` et `startup_items` : configuration Coran & Adhkar et slides.
- Les règles déterminent l’accès au magasin, aux menus et à certaines permissions ; `superAdmin: true` est un custom claim Firebase réservé aux comptes de plateforme.

## Rôles

- Admin de magasin : gestion de son magasin, selon règles et permissions.
- Casier : accès aux menus explicitement accordés, principalement caisse et opérations autorisées.
- Technicien : atelier, pièces, articles/services et clients selon les menus et permissions ; pas d’encaissement/livraison sans droit caisse.
- Super-admin de plateforme : privilège transversal fondé sur custom claim, attribué par le script administratif.

## Scripts

- `scripts/create-first-admin.mjs` : création confirmée d’un compte Auth et d’un profil admin initial.
- `scripts/set-super-admin.mjs` : attribution ou retrait confirmé du claim super-admin.
- `scripts/purge-passwords.mjs` : aperçu des profils concernés, sauvegarde JSON locale et confirmation avant retrait des champs hérités.

Les scripts Admin SDK utilisent `GOOGLE_APPLICATION_CREDENTIALS`, `FIREBASE_PROJECT_ID` et éventuellement `FIRESTORE_DATABASE_ID`. Ces secrets ne doivent jamais être incorporés au build client.
