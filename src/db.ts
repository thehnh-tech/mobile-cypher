// Backend-aware data layer.
// Vault contents are encrypted client-side (AES-GCM). The backend separately
// receives public profile/directory fields and messaging metadata. AI requests
// send the selected conversation in plaintext to the backend and provider.

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  deriveKey, deriveAuthCredential, encryptData, decryptData,
  randomSalt, randomId, sha256, fingerprint,
  generateECKeyPair,
  EncryptedBlob,
} from './crypto';
import { api, ApiError } from './api';
import { secureSession } from './secureSession';
import { stripLegacyAIKeys } from './vaultSanitizer';

const VAULT_CACHE_KEY = 'CIPHER_VAULT_CACHE';

// ── Public types (unchanged from local-only version) ──────
export interface UserRecord {
  id: string;
  username: string;
  displayName: string;
  tag: string;
  fingerprint: string;
  publicKey: string;
}

export interface Profile {
  id: string;
  username: string;
  displayName: string;
  tag: string;
  bio: string;
  avatar: { hue: number };
  fingerprint: string;
  theme: string;
  // EC-ElGamal keypair on secp256k1. publicKey is also stored on the backend
  // (so peers can encrypt to me); privateKey lives ONLY inside this encrypted
  // vault — the server never sees it.
  publicKey: string;
  privateKey: string;
}

export interface Contact {
  id: string;
  name: string;
  tag: string;
  online: boolean;
  ai: boolean;
  fingerprint?: string;
  avatar: { hue: number };
}

export interface ReplyTo {
  id: string;
  senderId: string;
  senderName: string;
  content: string;
}

export interface Message {
  id: string;
  from: string;
  text: string;
  ts: number;
  edited?: boolean;
  deleted?: boolean;
  likes?: string[];
  replyTo?: ReplyTo;
}

export interface Chat {
  id: string;
  kind: 'dm' | 'group' | 'channel';
  name?: string;
  participants: string[];
  messages: Message[];
  unread: number;
}

export interface AppLockConfig {
  // Exactly one of the two paths is active per setup. When `biometricEnabled`
  // is true, `pinHash` / `salt` are absent and the lock relies on the OS
  // biometric prompt. When false, the PIN path is used.
  biometricEnabled: boolean;
  pinHash?: string;
  salt?: string;
}

export interface Vault {
  profile: Profile;
  chats: Chat[];
  contacts: Contact[];
  settings: {
    theme: string;
    bubbleStyle: string;
    appLock?: AppLockConfig;
  };
}

// ── Vault encryption helpers ──────────────────────────────
// Vault is JSON-stringified, encrypted to {iv, ct}, then re-stringified
// so the server stores a single opaque string.

function packBlob(vault: Vault, key: Uint8Array): string {
  const blob = encryptData(JSON.stringify(stripLegacyAIKeys(vault)), key);
  return JSON.stringify(blob);
}

function unpackBlob(blobStr: string, key: Uint8Array): Vault {
  const blob: EncryptedBlob = JSON.parse(blobStr);
  return stripLegacyAIKeys(JSON.parse(decryptData(blob, key)));
}

// ── Auth operations ───────────────────────────────────────
export async function signup(params: {
  username: string;
  password: string;
  displayName: string;
  tag: string;
}): Promise<{ user: UserRecord; key: Uint8Array; vault: Vault; token: string }> {
  const { username, password, displayName, tag } = params;

  const finalTag = tag.toLowerCase().replace(/[^a-z0-9_.]/g, '');
  if (finalTag.length < 3) throw new Error('Tag must be at least 3 characters');

  if (!/^[a-zA-Z0-9_.-]{3,64}$/.test(username)) {
    throw new Error('Username must be 3–64 letters, numbers, dots, underscores or hyphens');
  }
  if (password.length < 12 || password.length > 1024) {
    throw new Error('Use a password of at least 12 characters');
  }

  // The vault key remains local; the independently derived authentication
  // credential goes to the server over HTTPS and is stored only as a hash.
  const saltB64 = randomSalt();
  const key = deriveKey(password, saltB64);
  const verifier = encryptData('CIPHER_OK', key);
  const tagHash = sha256(finalTag);

  // EC-ElGamal keypair (secp256k1). The public key is sent to the backend in
  // cleartext (it's public). The private key is kept ONLY inside the
  // password-encrypted vault.
  const ecKeys = generateECKeyPair();

  // 1. Create the user on the server. Server returns its userId, we use it
  //    as profile.id inside the encrypted vault so external lookups match.
  const fpSeed = sha256(ecKeys.publicKey);
  const fp = fingerprint(fpSeed);

  const signupResp = await api.signup({
    username,
    displayName: displayName || username,
    tag: finalTag,
    tagHash,
    salt: saltB64,
    verifier,
    fingerprint: fp,
    publicKey: ecKeys.publicKey,
    authCredential: deriveAuthCredential(password, saltB64),
  });

  const userId = signupResp.userId;
  const avatarHue = Math.abs(userId.charCodeAt(0) * 17 + userId.charCodeAt(1) * 31) % 360;

  // 2. Build initial vault using the server-issued userId.
  const vault: Vault = {
    profile: {
      id: userId,
      username,
      displayName: displayName || username,
      tag: finalTag,
      bio: '',
      avatar: { hue: avatarHue },
      fingerprint: fp,
      theme: 'cyan',
      publicKey: ecKeys.publicKey,
      privateKey: ecKeys.privateKey,
    },
    contacts: [
      { id: 'cipher-ai', name: 'Cipher', tag: 'cipher', online: true, ai: true, avatar: { hue: 195 } },
    ],
    chats: [
      {
        id: 'chat-cipher',
        kind: 'dm',
        participants: ['cipher-ai'],
        unread: 1,
        messages: [
          {
            id: 'init-1',
            from: 'cipher-ai',
            text:
              "Bienvenue sur Cipher 🔒\n\n" +
              "Ton coffre est chiffré sur ton appareil avant stockage. Les messages directs utilisent un chiffrement entre les appareils ; le serveur conserve les profils publics et les métadonnées. " +
              "Les messages que tu m’envoies, ainsi que l’historique sélectionné, sont transmis en clair au backend et à Groq pour générer une réponse. L’assistant IA n’est pas chiffré de bout en bout.\n\n" +
              "Je suis Cipher, ton assistant. Comment puis-je t'aider aujourd'hui ?",
            ts: Date.now() - 60000,
          },
        ],
      },
    ],
    settings: { theme: 'cyan', bubbleStyle: 'solid' },
  };

  // 3. Upload encrypted vault to backend.
  const blobStr = packBlob(vault, key);
  await api.putVault(signupResp.token, blobStr);
  await AsyncStorage.setItem(VAULT_CACHE_KEY, blobStr);

  const user: UserRecord = {
    id: userId,
    username,
    displayName: displayName || username,
    tag: finalTag,
    fingerprint: fp,
    publicKey: ecKeys.publicKey,
  };

  return { user, key, vault, token: signupResp.token };
}

export async function login(params: {
  username: string;
  password: string;
}): Promise<{ user: UserRecord; key: Uint8Array; vault: Vault; token: string }> {
  const { username, password } = params;

  if (password.length > 1024) throw new Error('Password is too long');
  // 1. Fetch public KDF parameters without obtaining an authenticated token.
  const parameters = await api.authParameters(username);
  const key = deriveKey(password, parameters.salt);

  let verified: string;
  try {
    verified = decryptData(parameters.verifier, key);
  } catch {
    throw new Error('Incorrect password');
  }
  if (verified !== 'CIPHER_OK') throw new Error('Incorrect password');

  // Server verification, not the local UI check, now gates JWT issuance.
  const loginResp = await api.login(username, deriveAuthCredential(password, parameters.salt));

  // 2. Fetch encrypted vault.
  const { encryptedBlob } = await api.getVault(loginResp.token);
  let vault: Vault;
  try {
    vault = unpackBlob(encryptedBlob, key);
  } catch {
    throw new Error('Failed to decrypt vault');
  }

  await AsyncStorage.setItem(VAULT_CACHE_KEY, packBlob(vault, key));

  const user: UserRecord = {
    id: loginResp.userId,
    username,
    displayName: loginResp.displayName,
    tag: loginResp.tag,
    fingerprint: loginResp.fingerprint,
    publicKey: loginResp.publicKey,
  };

  return { user, key, vault, token: loginResp.token };
}

export async function saveVault(
  _userId: string,
  vault: Vault,
  key: Uint8Array,
  token: string,
): Promise<void> {
  const blobStr = packBlob(vault, key);
  await api.putVault(token, blobStr);
  await AsyncStorage.setItem(VAULT_CACHE_KEY, blobStr);
}

export async function findUserByTag(token: string, tag: string): Promise<UserRecord | null> {
  const cleaned = tag.toLowerCase().replace(/[^a-z0-9_.]/g, '');
  if (cleaned.length < 3) return null;
  const tagHash = sha256(cleaned);
  const found = await api.findByTag(token, tagHash);
  if (!found) return null;
  return {
    id: found.userId,
    username: '', // not exposed by the API; the tag is what users search by
    displayName: found.displayName,
    tag: found.tag,
    fingerprint: found.fingerprint,
    publicKey: found.publicKey,
  };
}

// ── Session ────────────────────────────────────────────────
export async function persistSession(
  userId: string,
  key: Uint8Array,
  token: string,
): Promise<void> {
  await secureSession.set({ userId, key: Array.from(key), token });
}

export async function loadSession(): Promise<{
  userId: string;
  key: Uint8Array;
  vault: Vault;
  token: string;
} | null> {
  const session = await secureSession.get();
  if (!session) return null;
  const key = new Uint8Array(session.key);

  // Try to fetch the freshest vault from the backend; fall back to local cache
  // if the server is unreachable so the app still works offline (read-only).
  let blobStr: string | null = null;
  try {
    const { encryptedBlob } = await api.getVault(session.token);
    blobStr = encryptedBlob;
  } catch (error) {
    // Revoked/expired sessions must not be restored from an offline cache.
    if (error instanceof ApiError && error.status < 500) {
      await clearSession();
      return null;
    }
    blobStr = await AsyncStorage.getItem(VAULT_CACHE_KEY);
  }

  if (!blobStr) return null;

  try {
    const vault = unpackBlob(blobStr, key);
    if (vault.profile.id !== session.userId) {
      await clearSession();
      return null;
    }
    await AsyncStorage.setItem(VAULT_CACHE_KEY, packBlob(vault, key));
    return { userId: session.userId, key, vault, token: session.token };
  } catch {
    return null;
  }
}

export async function clearSession(): Promise<void> {
  await secureSession.clear();
  await AsyncStorage.removeItem(VAULT_CACHE_KEY);
}
