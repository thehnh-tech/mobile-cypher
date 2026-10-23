# Déployer Cipher

Le dépôt contient déjà l'application Expo et son backend Express/MongoDB. Ce guide explique comment exécuter et déployer ce code ; il n'est pas nécessaire de recréer un serveur à partir d'exemples. Cipher est un projet open source expérimental sous [licence MIT](LICENSE). Lire les limites dans [SECURITY.md](SECURITY.md) avant d'héberger des données sensibles.

## 1. Préparer l'environnement

Prévoir Node.js **22.13 ou plus récent**, npm, une base MongoDB, un hébergement capable de maintenir des connexions HTTP longues et un domaine HTTPS pour l'API publique. Conserver **Expo SDK 54** pour l'application actuelle.

Pour MongoDB, utiliser un compte applicatif limité à la base de Cipher. Restreindre les accès réseau aux environnements qui en ont besoin et protéger les sauvegardes. Une URI contenant un mot de passe est un secret serveur ; elle ne doit jamais être intégrée à l'application mobile.

Les installations sont séparées :

```sh
# Racine du dépôt
npm ci
npm run type-check
npm test
npm run check:secrets
npx expo install --check

# Backend
cd backend
npm ci
npm run type-check
npm test
npm audit --omit=dev
```

## 2. Configurer le backend

En local, copier `backend/.env.example` vers `backend/.env`. En hébergement, fournir les mêmes variables via la configuration privée du service ou un gestionnaire de secrets.

| Variable | Utilisation |
| --- | --- |
| `MONGODB_URI` | URI de la base MongoDB ; obligatoire |
| `JWT_SECRET` | Secret de signature aléatoire propre au déploiement ; obligatoire |
| `JWT_EXPIRES_IN` | Durée de validité des jetons ; voir le fichier exemple |
| `PORT` | Port d'écoute, `3000` par défaut ; utiliser celui imposé par l'hébergeur |
| `NODE_ENV` | `development` en local, `production` sur le serveur |
| `GROQ_API_KEY` | Nouvelle clé Groq, facultative ; son absence désactive l'assistant |
| `GROQ_MODEL` | Modèle facultatif, `llama-3.3-70b-versatile` par défaut |
| `CORS_ORIGINS` | Origines web autorisées en production, séparées par des virgules ; inutile pour les clients natifs |

Générer le secret JWT localement, puis enregistrer le résultat uniquement dans la configuration privée :

```sh
node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"
```

La clé Groq précédemment publiée doit être **révoquée dans le compte Groq**. La supprimer du code ne suffit pas. Ne pas réutiliser cette clé et ne pas placer sa remplaçante dans une variable `EXPO_PUBLIC_*`. Voir la procédure dans [SECURITY.md](SECURITY.md).

## 3. Démarrer et publier l'API

En développement, depuis `backend/` :

```sh
npm run dev
```

Pour un déploiement, sélectionner `backend/` comme répertoire de travail du service. Installer aussi les dépendances de développement pendant la compilation TypeScript :

```sh
npm ci
npm run build
npm start
```

`npm start` exécute `dist/index.js`. La base doit être joignable pour que le serveur démarre. Configurer la terminaison TLS et vérifier `https://votre-api.example/health` ; cette réponse confirme que le service répond, pas que tous les flux applicatifs fonctionnent.

Le proxy frontal doit autoriser des requêtes de long polling d'au moins 25 secondes, avec une marge de temporisation. Les événements de réveil et certaines limites de requêtes vivent en mémoire dans chaque processus. Plusieurs instances nécessitent une coordination supplémentaire pour les événements et quotas ; ne pas supposer qu'ajouter des réplicas suffit.

L'API ne fait pas confiance aux en-têtes d'adresse IP transférés par défaut. Derrière un proxy, les limites par IP peuvent donc être partagées par tous les clients. Configurer les limites au niveau de la passerelle et ne déclarer des proxys de confiance qu'après avoir vérifié la topologie ; ne pas activer une confiance générale dans les en-têtes fournis par les clients.

Appliquer des limites de trafic au niveau de l'hébergement, protéger les journaux et ne pas enregistrer les en-têtes d'autorisation ni les corps des requêtes IA. En production, renseigner `CORS_ORIGINS` pour les clients web autorisés ; par défaut aucune origine de navigateur n'est autorisée. Ce réglage ne bloque pas les clients natifs et ne remplace jamais l'authentification.

## 4. Relier l'application

À la racine, copier `.env.example` vers `.env` puis définir uniquement l'adresse publique du backend :

```dotenv
EXPO_PUBLIC_API_URL=https://votre-api.example
```

Cette valeur est visible dans l'application compilée. Elle n'est pas un secret. Les clés Groq, secrets JWT et URI MongoDB restent sur le backend.

En développement sur téléphone, utiliser l'adresse LAN réelle de l'ordinateur, par exemple `http://192.168.1.10:3000`. Le téléphone et l'ordinateur doivent pouvoir communiquer sur le même réseau. `localhost` sur le téléphone désigne le téléphone. HTTP est réservé aux essais locaux sur un réseau de confiance.

Redémarrer Expo après modification de l'environnement :

```sh
npm start
```

La session native utilise SecureStore. Sur le web, la session reste en mémoire et un rechargement nécessite une connexion. Les anciens enregistrements de session en clair sont supprimés plutôt que réutilisés.

## 5. Build natif et notifications

Expo Go peut servir aux essais compatibles avec SDK 54, mais ne valide pas les notifications distantes de ce projet. Pour les tester, préparer un development build ou une version native distribuable avec un appareil physique et les autorisations de notification.

Pour un projet EAS :

1. Associer l'application au projet Expo voulu et renseigner son identifiant de projet. Vérifier les identifiants d'application Android/iOS avant publication.
2. Configurer les profils de build et les identifiants de signature/push dans votre environnement Expo. Le dépôt ne fournit pas une configuration universelle prête à publier dans les stores.
3. Fournir `EXPO_PUBLIC_API_URL` à l'environnement de build puis produire un build compatible SDK 54.
4. Vérifier l'enregistrement du token Expo et la réception d'une notification avec l'application en arrière-plan ou fermée.
5. Vérifier qu'un appui sur la notification ouvre la conversation ou la liste des demandes attendue.

L'API transmet des notifications génériques, sans corps de message. Expo et les services de notification des plateformes traitent néanmoins les tokens et métadonnées de routage. Le consentement aux notifications est distinct du consentement à l'assistant IA.

## 6. Migration depuis l'ancienne version

L'ancienne API délivrait un jeton à partir du seul nom d'utilisateur. La nouvelle API exige un identifiant d'authentification dérivé du mot de passe et vérifié côté serveur avant d'émettre un JWT de nouvelle version.

**Cette mise à jour n'est pas une migration transparente des comptes existants.**

- Les anciens JWT sont refusés grâce au contrôle de version d'authentification. Changer également `JWT_SECRET` lors de la mise à niveau est recommandé.
- Les comptes historiques sans empreinte de l'identifiant d'authentification sont bloqués. Le code n'enregistre pas automatiquement un nouvel identifiant à partir d'un nom d'utilisateur ou d'un ancien jeton.
- Il n'existe pas encore de procédure de récupération ou de migration de propriété de compte revue et intégrée. Sauvegarder la base et les données chiffrées avant toute mise à niveau ; préparer cette migration séparément avant de basculer des utilisateurs existants.
- Ne pas supprimer des comptes, remplacer des clés privées ou écraser des coffres pour contourner ce blocage. Créer de nouveaux comptes de test dans une base de test distincte pour valider la nouvelle version.
- Déployer ensemble le client et le backend compatibles. Une ancienne application ne sait pas suivre le nouveau protocole de connexion ni utiliser le proxy IA.
- Les anciens paramètres de clé IA présents dans un coffre doivent être retirés par l'application mise à jour. Cela ne remplace pas la révocation du secret chez Groq.
- Le format d'image passe du brouillage CTR sans authentification à un conteneur PNG versionné avec AES-GCM et nonce aléatoire. Les anciennes images brouillées sont refusées ; aucune migration automatique n'est fournie. Conserver les originaux avant de tester le nouveau format. Transmettre les nouveaux PNG chiffrés sans redimensionnement ni conversion JPEG.

L'historique Git peut encore contenir la clé exposée. Une éventuelle réécriture doit être coordonnée après révocation ; cette mise à jour ne réécrit pas l'historique distant.

## 7. Vérification avant ouverture à d'autres utilisateurs

Avec deux comptes de test et deux appareils :

- Créer les comptes ; vérifier le refus d'un mauvais mot de passe et des anciens jetons.
- Se connecter, fermer et rouvrir l'application, puis tester le verrouillage local.
- Chercher un tag, envoyer une demande, l'accepter/refuser, échanger des messages et répondre à un message.
- Vérifier les limites d'accès : un compte extérieur à une conversation ne doit pas pouvoir la lire ou y écrire.
- Vérifier que l'assistant affiche sa notice, demande le consentement, et échoue proprement si aucune clé serveur n'est configurée.
- Contrôler les permissions et notifications sur le build natif, puis les erreurs réseau et la reconnexion.
- Vérifier sauvegarde/restauration, accès à la base et journaux sans secrets.

Les tests automatiques ne couvrent pas tous les comportements natifs ni tous les scénarios de sécurité. Des alertes de dépendances mobiles restent ouvertes ; leur état daté figure dans [SECURITY.md](SECURITY.md#dependency-audit-snapshot). Le contrôle de secrets porte sur des signatures connues dans les fichiers actuels, pas sur tout l'historique. Le chiffrement personnalisé, la gestion des clés de contacts, le nouveau format d'image, la récupération de compte et l'effacement des données conservent des limites documentées dans le [README](README.md#security-and-privacy) et [SECURITY.md](SECURITY.md).
