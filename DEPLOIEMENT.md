# Guide de Déploiement — Cipher Chat

Ce guide couvre le passage de l'application locale vers une architecture réseau complète :
**backend Node.js/Express + MongoDB Atlas** pour le serveur, **EAS Build** pour l'app mobile.

---

## Table des matières

1. [Architecture cible](#1-architecture-cible)
2. [Prérequis](#2-prérequis)
3. [MongoDB Atlas — Configuration](#3-mongodb-atlas--configuration)
4. [Backend Node.js/Express](#4-backend-nodejsexpress)
5. [Déploiement du backend](#5-déploiement-du-backend)
6. [Connexion de l'app mobile au backend](#6-connexion-de-lapp-mobile-au-backend)
7. [Build mobile avec EAS](#7-build-mobile-avec-eas)
8. [Variables d'environnement — récap](#8-variables-denvironnement--récap)
9. [Checklist de mise en production](#9-checklist-de-mise-en-production)

---

## 1. Architecture cible

```
┌─────────────────────────────────────────────┐
│              App mobile (Expo)               │
│  React Native + AsyncStorage (cache local)  │
└────────────────────┬────────────────────────┘
                     │ HTTPS + JWT
                     ▼
┌─────────────────────────────────────────────┐
│          Backend (Node.js / Express)         │
│  Auth, messages, contacts — REST API         │
│  Déployé sur Railway / Render / VPS          │
└────────────────────┬────────────────────────┘
                     │ Mongoose ODM
                     ▼
┌─────────────────────────────────────────────┐
│            MongoDB Atlas (cloud)             │
│  Collections : users, vaults, messages       │
└─────────────────────────────────────────────┘
```

---

## 2. Prérequis

| Outil | Version minimale | Lien |
|-------|-----------------|------|
| Node.js | 20 LTS | https://nodejs.org |
| npm | 10+ | inclus avec Node |
| Expo CLI | dernière | `npm i -g expo-cli` |
| EAS CLI | dernière | `npm i -g eas-cli` |
| Compte MongoDB Atlas | gratuit | https://cloud.mongodb.com |
| Compte Railway **ou** Render | gratuit | https://railway.app / https://render.com |

---

## 3. MongoDB Atlas — Configuration

### 3.1 Créer un cluster

1. Ouvrir [cloud.mongodb.com](https://cloud.mongodb.com) et se connecter.
2. **New Project** → nommer le projet `cipher-chat`.
3. **Build a Cluster** → choisir **M0 Free Tier** (512 MB, suffisant pour un prototype).
4. Région : choisir la plus proche de votre backend (ex. `eu-west-1` pour Paris).
5. Cliquer **Create Cluster** (déploiement ~2 min).

### 3.2 Créer un utilisateur de base de données

Dans **Database Access** → **Add New Database User** :

- Username : `cipher_api`
- Password : générer un mot de passe fort (noter-le)
- Role : **Read and write to any database**

### 3.3 Autoriser les IP

Dans **Network Access** → **Add IP Address** :

- Pour le développement : `0.0.0.0/0` (toutes les IP — à restreindre en prod)
- En production : ajouter uniquement l'IP statique de votre serveur backend

### 3.4 Récupérer l'URI de connexion

Dans **Clusters** → **Connect** → **Connect your application** :

```
mongodb+srv://cipher_api:<PASSWORD>@cluster0.xxxxx.mongodb.net/cipher?retryWrites=true&w=majority
```

Remplacer `<PASSWORD>` par le mot de passe créé à l'étape 3.2. Conserver cette URI — c'est votre `MONGODB_URI`.

---

## 4. Backend Node.js/Express

### 4.1 Initialiser le projet backend

```bash
mkdir cipher-backend && cd cipher-backend
npm init -y
npm install express mongoose bcryptjs jsonwebtoken dotenv cors helmet
npm install -D typescript ts-node @types/express @types/node @types/bcryptjs @types/jsonwebtoken nodemon
```

### 4.2 Structure des fichiers

```
cipher-backend/
├── src/
│   ├── index.ts          # Entrée, démarrage Express
│   ├── config.ts         # Variables d'environnement
│   ├── db.ts             # Connexion Mongoose
│   ├── models/
│   │   ├── User.ts       # Schéma utilisateur
│   │   └── Vault.ts      # Schéma vault chiffré
│   └── routes/
│       ├── auth.ts       # POST /auth/signup, POST /auth/login
│       ├── vault.ts      # GET/PUT /vault
│       └── contacts.ts   # GET /contacts, POST /contacts
├── .env                  # Variables locales (ne pas commiter)
├── .env.example          # Template à commiter
├── tsconfig.json
└── package.json
```

### 4.3 Fichier `.env`

```env
PORT=3000
MONGODB_URI=mongodb+srv://cipher_api:<PASSWORD>@cluster0.xxxxx.mongodb.net/cipher?retryWrites=true&w=majority
JWT_SECRET=remplacer_par_une_chaine_aleatoire_de_64_chars
JWT_EXPIRES_IN=30d
NODE_ENV=development
```

Générer un `JWT_SECRET` sécurisé :
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

### 4.4 `src/config.ts`

```typescript
import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: process.env.PORT ?? 3000,
  mongoUri: process.env.MONGODB_URI!,
  jwtSecret: process.env.JWT_SECRET!,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '30d',
  nodeEnv: process.env.NODE_ENV ?? 'development',
};
```

### 4.5 `src/db.ts` — Connexion MongoDB

```typescript
import mongoose from 'mongoose';
import { config } from './config';

export async function connectDB() {
  await mongoose.connect(config.mongoUri);
  console.log('MongoDB connecté');
}
```

### 4.6 `src/models/User.ts`

```typescript
import { Schema, model, Document } from 'mongoose';

export interface IUser extends Document {
  username: string;
  displayName: string;
  tag: string;
  tagHash: string;
  salt: string;
  verifier: string;      // "CIPHER_OK" chiffré en AES-GCM (vérification côté client)
  fingerprint: string;
  createdAt: Date;
}

const userSchema = new Schema<IUser>({
  username:    { type: String, required: true, unique: true, lowercase: true, trim: true },
  displayName: { type: String, required: true },
  tag:         { type: String, required: true },
  tagHash:     { type: String, required: true, unique: true },
  salt:        { type: String, required: true },
  verifier:    { type: String, required: true },
  fingerprint: { type: String, required: true },
}, { timestamps: true });

export const User = model<IUser>('User', userSchema);
```

### 4.7 `src/models/Vault.ts`

```typescript
import { Schema, model, Document, Types } from 'mongoose';

export interface IVault extends Document {
  userId: Types.ObjectId;
  encryptedBlob: string;   // vault chiffré AES-GCM (base64), déchiffrable uniquement par le client
  updatedAt: Date;
}

const vaultSchema = new Schema<IVault>({
  userId:        { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  encryptedBlob: { type: String, required: true },
}, { timestamps: true });

export const Vault = model<IVault>('Vault', vaultSchema);
```

> **Principe de sécurité :** Le serveur ne stocke jamais le vault en clair. Seul le client peut le déchiffrer avec la clé dérivée du mot de passe.

### 4.8 `src/routes/auth.ts`

```typescript
import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { User } from '../models/User';
import { Vault } from '../models/Vault';
import { config } from '../config';

const router = Router();

// POST /auth/signup
router.post('/signup', async (req: Request, res: Response) => {
  const { username, displayName, tag, tagHash, salt, verifier, fingerprint, encryptedVault } = req.body;

  if (!username || !displayName || !tag || !tagHash || !salt || !verifier || !fingerprint || !encryptedVault) {
    return res.status(400).json({ error: 'Champs manquants' });
  }

  const exists = await User.findOne({ $or: [{ username }, { tagHash }] });
  if (exists) return res.status(409).json({ error: 'Nom d\'utilisateur ou @tag déjà pris' });

  const user = await User.create({ username, displayName, tag, tagHash, salt, verifier, fingerprint });
  await Vault.create({ userId: user._id, encryptedBlob: encryptedVault });

  const token = jwt.sign({ userId: user._id }, config.jwtSecret, { expiresIn: config.jwtExpiresIn as any });
  res.status(201).json({ token, userId: user._id });
});

// POST /auth/login
router.post('/login', async (req: Request, res: Response) => {
  const { username } = req.body;
  if (!username) return res.status(400).json({ error: 'Champs manquants' });

  const user = await User.findOne({ username });
  if (!user) return res.status(404).json({ error: 'Utilisateur non trouvé' });

  // La vérification du mot de passe se fait côté client (AES-GCM verifier)
  const token = jwt.sign({ userId: user._id }, config.jwtSecret, { expiresIn: config.jwtExpiresIn as any });
  res.json({
    token,
    userId: user._id,
    salt: user.salt,
    verifier: user.verifier,
    fingerprint: user.fingerprint,
  });
});

export default router;
```

### 4.9 `src/routes/vault.ts`

```typescript
import { Router, Request, Response } from 'express';
import { Vault } from '../models/Vault';
import { authMiddleware } from '../middleware/auth';

const router = Router();
router.use(authMiddleware);

// GET /vault — télécharger le vault chiffré
router.get('/', async (req: Request, res: Response) => {
  const vault = await Vault.findOne({ userId: (req as any).userId });
  if (!vault) return res.status(404).json({ error: 'Vault non trouvé' });
  res.json({ encryptedBlob: vault.encryptedBlob, updatedAt: vault.updatedAt });
});

// PUT /vault — uploader le vault chiffré après modification
router.put('/', async (req: Request, res: Response) => {
  const { encryptedBlob } = req.body;
  if (!encryptedBlob) return res.status(400).json({ error: 'Champs manquants' });

  await Vault.findOneAndUpdate(
    { userId: (req as any).userId },
    { encryptedBlob },
    { upsert: true, new: true }
  );
  res.json({ ok: true });
});

export default router;
```

### 4.10 `src/middleware/auth.ts`

```typescript
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';

export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return res.status(401).json({ error: 'Non autorisé' });

  try {
    const payload = jwt.verify(header.slice(7), config.jwtSecret) as { userId: string };
    (req as any).userId = payload.userId;
    next();
  } catch {
    res.status(401).json({ error: 'Token invalide ou expiré' });
  }
}
```

### 4.11 `src/index.ts` — Point d'entrée

```typescript
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config } from './config';
import { connectDB } from './db';
import authRoutes from './routes/auth';
import vaultRoutes from './routes/vault';

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.use('/auth', authRoutes);
app.use('/vault', vaultRoutes);

app.get('/health', (_, res) => res.json({ status: 'ok' }));

connectDB().then(() => {
  app.listen(config.port, () => console.log(`Serveur démarré sur le port ${config.port}`));
});
```

### 4.12 `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "rootDir": "src",
    "outDir": "dist",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  }
}
```

### 4.13 Scripts `package.json`

```json
{
  "scripts": {
    "dev": "nodemon --exec ts-node src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js"
  }
}
```

### 4.14 Tester en local

```bash
npm run dev
# → MongoDB connecté
# → Serveur démarré sur le port 3000

# Test health check
curl http://localhost:3000/health
# → {"status":"ok"}
```

---

## 5. Déploiement du backend

### Option A — Railway (recommandé, gratuit)

1. Créer un compte sur [railway.app](https://railway.app).
2. **New Project** → **Deploy from GitHub repo** → sélectionner `cipher-backend`.
3. Railway détecte automatiquement Node.js.
4. Dans **Variables** → ajouter :
   - `MONGODB_URI` = votre URI Atlas
   - `JWT_SECRET` = votre secret généré
   - `NODE_ENV` = `production`
5. Dans **Settings** → **Start Command** : `npm run build && npm start`
6. Railway fournit une URL publique : `https://cipher-backend-xxxx.railway.app`

### Option B — Render (gratuit)

1. Créer un compte sur [render.com](https://render.com).
2. **New Web Service** → connecter le repo GitHub.
3. **Build Command** : `npm install && npm run build`
4. **Start Command** : `npm start`
5. Ajouter les variables d'environnement dans l'onglet **Environment**.
6. URL publique fournie automatiquement.

### Option C — VPS (Ubuntu)

```bash
# Sur le VPS
git clone https://github.com/<vous>/cipher-backend.git
cd cipher-backend
npm install
npm run build

# Créer le fichier .env avec les variables de production
# Puis démarrer avec PM2
npm install -g pm2
pm2 start dist/index.js --name cipher-backend
pm2 save
pm2 startup
```

Pour exposer avec Nginx + HTTPS (Let's Encrypt) :

```nginx
server {
    server_name api.cipher.example.com;
    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

```bash
sudo certbot --nginx -d api.cipher.example.com
```

---

## 6. Connexion de l'app mobile au backend

### 6.1 Créer `src/api.ts`

```typescript
const BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';

async function request(path: string, options: RequestInit = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? 'Erreur serveur');
  return data;
}

export const api = {
  signup: (body: object) => request('/auth/signup', { method: 'POST', body: JSON.stringify(body) }),
  login:  (body: object) => request('/auth/login',  { method: 'POST', body: JSON.stringify(body) }),

  getVault: (token: string) =>
    request('/vault', { headers: { Authorization: `Bearer ${token}` } }),

  putVault: (token: string, encryptedBlob: string) =>
    request('/vault', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ encryptedBlob }),
    }),
};
```

### 6.2 Variable d'environnement Expo

Créer `.env.local` à la racine de l'app mobile :

```env
EXPO_PUBLIC_API_URL=https://cipher-backend-xxxx.railway.app
```

> Expo expose automatiquement les variables préfixées `EXPO_PUBLIC_` au bundle.

### 6.3 Adapter `src/db.ts`

Remplacer les appels AsyncStorage par des appels API pour signup/login, et garder AsyncStorage uniquement comme cache local :

```typescript
// Exemple : login réseau
export async function loginUser(username: string, password: string) {
  // 1. Récupérer salt + verifier depuis le serveur
  const { token, salt, verifier } = await api.login({ username });

  // 2. Dériver la clé localement (jamais envoyée au serveur)
  const key = await deriveKey(password, fromBase64(salt));

  // 3. Vérifier le mot de passe côté client
  const ok = await verifyKey(key, verifier);
  if (!ok) throw new Error('Mot de passe incorrect');

  // 4. Télécharger et déchiffrer le vault
  const { encryptedBlob } = await api.getVault(token);
  const vault = await decryptVault(key, encryptedBlob);

  // 5. Mettre en cache localement
  await AsyncStorage.setItem(SESSION_KEY, JSON.stringify({ token, userId: vault.profile.id }));
  return { key, vault, token };
}
```

---

## 7. Installer l'app sur iPhone depuis un Mac

Il existe 4 méthodes selon ce que vous voulez faire. Voici le comparatif rapide :

| Méthode | Coût | Délai | Limite | Idéal pour |
|---------|------|-------|--------|------------|
| **A — Expo Go** | Gratuit | 2 min | App sandbox, pas de modules natifs custom | Dev quotidien |
| **B — Xcode + provisioning gratuit** | Gratuit | 15 min | Expire tous les 7 jours, 3 apps max | Test perso sans payer |
| **C — EAS Build + distribution interne** | 99$/an (Apple) | 20 min build | 100 appareils max | Partager avec testeurs |
| **D — TestFlight / App Store** | 99$/an (Apple) | Revue Apple | Revue obligatoire | Production publique |

---

### Méthode A — Expo Go (gratuit, 2 minutes)

C'est la méthode la plus rapide. L'app tourne dans le client Expo Go — pas de build nécessaire.

**Prérequis :** iPhone et Mac sur le même réseau Wi-Fi.

```bash
# 1. Installer Expo Go sur l'iPhone depuis l'App Store
#    (rechercher "Expo Go" par Expo Project)

# 2. Démarrer le serveur de développement sur le Mac
cd Chat-System
npx expo start

# → Un QR code s'affiche dans le terminal
```

3. Ouvrir l'appareil photo iPhone → pointer sur le QR code → appuyer sur la notification → l'app s'ouvre dans Expo Go.

**Limites :** Expo Go embarque ses propres modules natifs. Si vous ajoutez une lib native custom (ex. `react-native-camera`), il faudra passer à la méthode B ou C.

---

### Méthode B — Xcode + compte Apple gratuit (expire tous les 7 jours)

Aucun paiement. Xcode signe l'app avec un certificat de développement personnel. Le certificat expire tous les **7 jours** (compte gratuit) — il faut rebuilder et réinstaller chaque semaine.

#### Prérequis

- Mac avec **Xcode 15+** installé (depuis l'App Store, ~8 Go)
- iPhone connecté en **USB** au Mac
- Un **Apple ID** (gratuit suffit)
- `npx expo install expo-dev-client` dans le projet

#### Étape 1 — Générer le projet Xcode natif

```bash
cd Chat-System

# Générer le dossier ios/ (prebuild Expo)
npx expo prebuild --platform ios
# → Crée le dossier ios/ avec les fichiers Xcode
```

#### Étape 2 — Ouvrir dans Xcode

```bash
open ios/ChatSystem.xcworkspace
# Toujours ouvrir le .xcworkspace, jamais le .xcodeproj
```

#### Étape 3 — Configurer la signature dans Xcode

1. Dans le panneau gauche → sélectionner le projet **ChatSystem** (icône bleue tout en haut).
2. Onglet **Signing & Capabilities**.
3. **Team** → cliquer sur le menu déroulant → **Add Account** → se connecter avec l'Apple ID.
4. Une fois connecté, sélectionner son compte personnel dans **Team**.
5. Xcode génère automatiquement le provisioning profile.
6. Si une erreur `Bundle Identifier` apparaît : modifier `Bundle Identifier` pour quelque chose d'unique, ex. `com.votrenom.cipherchat`.

#### Étape 4 — Brancher l'iPhone et faire confiance au Mac

1. Brancher l'iPhone en USB.
2. Sur l'iPhone → popup **Faire confiance à cet ordinateur ?** → **Faire confiance**.
3. Dans Xcode, en haut à gauche → sélectionner votre iPhone dans le menu des appareils (remplace le simulateur).

#### Étape 5 — Build et installation

```
Xcode → bouton ▶ (Run) en haut à gauche
```

Xcode compile (~3-5 min la première fois), installe l'app sur l'iPhone et la lance automatiquement.

**Si une alerte "Untrusted Developer" apparaît sur l'iPhone :**
> Réglages → VPN et gestion de l'appareil → votre Apple ID → **Faire confiance**

#### Étape 6 — Relancer le serveur Metro (dev mode)

L'app installée via Xcode cherche le bundler JS. Dans le terminal :

```bash
cd Chat-System
npx expo start --dev-client
```

Secouer l'iPhone → **Connect to Metro** → entrer l'IP locale du Mac (affichée dans le terminal).

#### Renouvellement tous les 7 jours

```bash
# Simplement refaire l'étape 5 depuis Xcode
# Le certificat est renouvelé automatiquement
```

---

### Méthode C — EAS Build + distribution interne (99$/an, recommandé pour partager)

EAS (Expo Application Services) build l'app dans le cloud et génère un lien d'installation QR. Nécessite un **compte Apple Developer** à 99$/an.

#### Prérequis

- Compte Apple Developer actif : [developer.apple.com](https://developer.apple.com)
- EAS CLI installé : `npm install -g eas-cli`
- Compte Expo : `eas login`

#### Étape 1 — Initialiser EAS dans le projet

```bash
cd Chat-System
eas build:configure
# → Génère eas.json et ajoute l'EAS projectId dans app.json
```

#### Étape 2 — Enregistrer les appareils de test

```bash
eas device:create
# → Génère un lien QR à ouvrir sur l'iPhone pour enregistrer son UDID
# → EAS ajoute automatiquement l'appareil au provisioning profile
```

Sur l'iPhone : ouvrir le lien → installer le profil de configuration (Réglages → Profil téléchargé → Installer).

#### Étape 3 — Configurer `eas.json`

```json
{
  "cli": { "version": ">= 10.0.0" },
  "build": {
    "preview": {
      "distribution": "internal",
      "ios": {
        "simulator": false
      },
      "env": {
        "EXPO_PUBLIC_API_URL": "https://cipher-backend-xxxx.railway.app"
      }
    },
    "production": {
      "ios": {
        "buildConfiguration": "Release"
      },
      "env": {
        "EXPO_PUBLIC_API_URL": "https://cipher-backend-xxxx.railway.app"
      }
    }
  }
}
```

#### Étape 4 — Lancer le build iOS

```bash
eas build --platform ios --profile preview
```

EAS demande :
- **Apple ID** → entrer l'email du compte Apple Developer
- **Mot de passe** (ou app-specific password si 2FA activé)
- Il gère automatiquement les certificats et provisioning profiles

Le build prend ~15-20 minutes sur les serveurs Expo.

#### Étape 5 — Installer sur l'iPhone

À la fin du build, EAS affiche :
```
✓ Build finished
Install URL: https://expo.dev/accounts/.../builds/...
```

- Ouvrir ce lien **sur l'iPhone** (Safari, pas Chrome) → **Install** → l'app s'installe directement.
- Ou scanner le QR code affiché dans le terminal depuis l'iPhone.

**Même alerte "Untrusted Developer" possible** (si pas Apple Developer) → Réglages → VPN et gestion de l'appareil → Faire confiance.

#### Mettre à jour l'app

```bash
# Rebuild après changements
eas build --platform ios --profile preview

# Pour les mises à jour JS uniquement (sans rebuild natif) :
eas update --branch preview --message "Fix login bug"
# → L'app récupère la mise à jour JS au prochain lancement
```

---

### Méthode D — TestFlight et App Store (production publique)

Pour distribuer à des utilisateurs externes ou publier sur l'App Store.

#### TestFlight (beta, jusqu'à 10 000 testeurs)

```bash
# 1. Build de production
eas build --platform ios --profile production

# 2. Soumettre sur App Store Connect
eas submit --platform ios
# → EAS upload automatiquement le .ipa sur App Store Connect
```

Ensuite dans [App Store Connect](https://appstoreconnect.apple.com) :
1. **TestFlight** → sélectionner le build → **Soumettre pour révision bêta**.
2. Révision Apple : ~24-48h la première fois, immédiate ensuite.
3. Inviter les testeurs par email → ils reçoivent un lien TestFlight.

#### App Store (production)

1. Préparer les métadonnées dans App Store Connect : nom, description, captures d'écran (iPhone 6.7", 5.5" minimum), icône 1024×1024px.
2. `eas submit --platform ios` → soumettre le build.
3. Cliquer **Soumettre pour révision** → révision Apple : 1-3 jours ouvrés.

---

### Simulateur iOS (test sans iPhone physique)

Pour tester rapidement sans appareil :

```bash
# Lancer sur le simulateur iPhone intégré à Xcode
npx expo start --ios

# Ou choisir un simulateur spécifique
npx expo run:ios --device "iPhone 16 Pro"

# Lister les simulateurs disponibles
xcrun simctl list devices available
```

Le simulateur ne supporte pas : caméra réelle, notifications push, Bluetooth, Face ID réel, et quelques APIs hardware.

---

### Récapitulatif des commandes iOS

```bash
# Méthode A — Dev avec Expo Go
npx expo start

# Méthode B — Xcode natif (prebuild)
npx expo prebuild --platform ios
open ios/ChatSystem.xcworkspace
# → Build depuis Xcode (bouton ▶)

# Méthode C — EAS Build interne
eas device:create                              # Enregistrer l'iPhone
eas build --platform ios --profile preview     # Build cloud (~20 min)
eas update --branch preview --message "..."    # Mise à jour JS rapide

# Méthode D — Production
eas build --platform ios --profile production
eas submit --platform ios                      # Upload App Store Connect
```

---

## 8. Variables d'environnement — récap

### Backend (`cipher-backend/.env`)

| Variable | Description | Exemple |
|----------|-------------|---------|
| `PORT` | Port d'écoute Express | `3000` |
| `MONGODB_URI` | URI de connexion Atlas | `mongodb+srv://...` |
| `JWT_SECRET` | Secret de signature JWT (64+ chars) | `a8f3...` |
| `JWT_EXPIRES_IN` | Durée de validité des tokens | `30d` |
| `NODE_ENV` | Environnement | `production` |

### App mobile (`.env.local` ou `eas.json`)

| Variable | Description | Exemple |
|----------|-------------|---------|
| `EXPO_PUBLIC_API_URL` | URL de base du backend | `https://cipher-backend-xxxx.railway.app` |

---

## 9. Checklist de mise en production

### Sécurité

- [ ] `JWT_SECRET` est une chaîne aléatoire d'au moins 64 caractères
- [ ] `MONGODB_URI` n'est pas commitée dans Git (vérifier `.gitignore`)
- [ ] IP whitelist MongoDB Atlas restreinte à l'IP du serveur backend
- [ ] HTTPS activé sur le backend (Railway/Render le gèrent automatiquement)
- [ ] `NODE_ENV=production` défini (désactive les stack traces dans les erreurs)
- [ ] `helmet()` activé sur Express (déjà dans le code ci-dessus)
- [ ] `CIPHER_SESSION` local ne stocke plus la clé en clair (migrer vers SecureStore)

### Performance

- [ ] Index MongoDB sur `username` et `tagHash` dans le modèle `User`
- [ ] Timeout réseau configuré dans `api.ts` (ajouter `AbortController`)
- [ ] Vault compressé avant envoi si > 100 KB

### Fiabilité

- [ ] Route `/health` accessible et retourne `200`
- [ ] PM2 ou Railway configuré pour redémarrer automatiquement
- [ ] Logs centralisés (Railway les capture automatiquement)

### Avant le premier déploiement

- [ ] Tester le flow complet en local : signup → login → vault sync
- [ ] Vérifier que le vault déchiffré côté client correspond au vault envoyé
- [ ] Tester la reconnexion avec un token expiré (vérifier le message d'erreur)
- [ ] S'assurer que `.env` est dans `.gitignore`

---

## Commandes de référence rapide

```bash
# Backend — développement local
cd cipher-backend && npm run dev

# Backend — build production
npm run build && npm start

# App — démarrer le dev server
cd Chat-System && npx expo start

# App — build preview Android
eas build --platform android --profile preview

# Vérifier la connexion MongoDB depuis Node
node -e "const m=require('mongoose'); m.connect(process.env.MONGODB_URI).then(()=>console.log('OK')).catch(console.error)"
```
