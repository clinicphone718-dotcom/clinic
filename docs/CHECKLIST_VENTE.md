# Checklist de vente et transfert

- [ ] Dépôt GitHub privé ; aucun fichier `.env` ou identifiant de service committé.
- [ ] Vérifier les secrets dans le code courant et l’historique Git ; si un secret historique est découvert, le révoquer/faire tourner avant tout transfert.
- [ ] Restreindre la clé API Firebase aux domaines du client ; faire tourner les accès après transfert de propriété lorsque nécessaire.
- [ ] Transférer la propriété du projet Firebase et du site Netlify au client ; retirer les accès internes non nécessaires.
- [ ] Nommer le responsable des sauvegardes Firestore et tester une restauration. Prévoir un export planifié ou une procédure manuelle documentée.
- [ ] Documenter les accès de support, les personnes autorisées et la procédure de révocation.
- [ ] Faire valider le contrat et les mentions légales par un juriste ; aucun modèle de clause n’est fourni ici.
- [ ] Informer le client que les données des consommateurs de son magasin sont des données personnelles ; définir les accès, durées de conservation et responsabilités appropriées.
- [ ] Confirmer les quotas, la facturation, les alertes de budget, le domaine Auth et les règles en production.
- [ ] Supprimer de façon sûre les fichiers de sauvegarde temporaires contenant d’anciens mots de passe après validation de la migration.
