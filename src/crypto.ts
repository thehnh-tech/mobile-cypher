import { pbkdf2 } from '@noble/hashes/pbkdf2';
import { sha256 as sha256Noble } from '@noble/hashes/sha2';
import { gcm } from '@noble/ciphers/aes';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { decode as decodePng, encode as encodePng } from 'fast-png';

// ── Base64 utilities ───────────────────────────────────────
function toBase64(bytes: Uint8Array): string {
  const CHUNK = 8192;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function fromBase64(str: string): Uint8Array {
  const binary = atob(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function randomBytes(n: number): Uint8Array {
  const buf = new Uint8Array(n);
  crypto.getRandomValues(buf);
  return buf;
}

// ── Key derivation ─────────────────────────────────────────
export function deriveKey(password: string, saltB64: string): Uint8Array {
  const salt = fromBase64(saltB64);
  const pw = new TextEncoder().encode(password);
  return pbkdf2(sha256Noble, pw, salt, { c: 100_000, dkLen: 32 });
}

// A distinct PBKDF2 domain creates a password-equivalent server credential;
// knowing it does not reveal the AES vault key. Transmit only over HTTPS.
export function deriveAuthCredential(password: string, saltB64: string): string {
  const label = new TextEncoder().encode('cipher:server-auth:v2:');
  const accountSalt = fromBase64(saltB64);
  const authSalt = new Uint8Array(label.length + accountSalt.length);
  authSalt.set(label);
  authSalt.set(accountSalt, label.length);
  return toHex(pbkdf2(sha256Noble, new TextEncoder().encode(password), authSalt, {
    c: 100_000, dkLen: 32,
  }));
}

// ── Encryption / Decryption ────────────────────────────────
export interface EncryptedBlob {
  iv: string;
  ct: string;
}

export function encryptData(plaintext: string, key: Uint8Array): EncryptedBlob {
  const iv = randomBytes(12);
  const pt = new TextEncoder().encode(plaintext);
  const aes = gcm(key, iv);
  const ct = aes.encrypt(pt);
  return { iv: toBase64(iv), ct: toBase64(ct) };
}

export function decryptData(blob: EncryptedBlob, key: Uint8Array): string {
  const iv = fromBase64(blob.iv);
  const ct = fromBase64(blob.ct);
  const aes = gcm(key, iv);
  const pt = aes.decrypt(ct);
  return new TextDecoder().decode(pt);
}

// ── Helpers ────────────────────────────────────────────────
export function randomSalt(): string {
  return toBase64(randomBytes(16));
}

export function randomId(): string {
  return toHex(randomBytes(8));
}

export function sha256(input: string): string {
  return toHex(sha256Noble(new TextEncoder().encode(input)));
}

export function fingerprint(hex: string): string {
  const groups = hex.slice(0, 32).match(/.{4}/g) ?? [];
  return groups.join(' ').toUpperCase();
}

// ── Hybrid EC-ElGamal on secp256k1 ─────────────────────────
//
// Each user has an EC keypair (priv: 32-byte scalar, pub: 33-byte compressed
// point). To encrypt a message readable by N participants we generate a fresh
// AES-GCM session key, encrypt the content once with it, then per-recipient
// produce a "wrapper": an ephemeral keypair (r, R = r·G), a shared point
// S = r·Q (where Q is the recipient's pubkey), KDF(S) keys an AES-GCM
// encryption of the session key. Recipient recovers S = priv·R, derives the
// same KDF key, decrypts the session key, then the content. This is the
// hybrid-EC-ElGamal / ECIES construction.
//
// Storage shape (sent as JSON inside the existing `content: string` server
// field — backend stays plaintext-blob-agnostic):
//   { iv, ct, wrappers: [{ userId, ephemeralPub, iv, ct }, ...] }

export interface KeyWrapper {
  userId: string;
  ephemeralPub: string; // base64 of 33-byte compressed point
  iv: string;           // base64 of 12-byte AES-GCM IV (for the session key)
  ct: string;           // base64 of AES-GCM ciphertext of the session key
}

export interface EncryptedPayload {
  iv: string;          // base64 of 12-byte AES-GCM IV (for the content)
  ct: string;          // base64 of AES-GCM ciphertext of the plaintext
  wrappers: KeyWrapper[];
}

export interface ECKeyPair {
  privateKey: string; // base64 of 32-byte scalar
  publicKey: string;  // base64 of 33-byte compressed point
}

export interface RecipientKey {
  userId: string;
  publicKey: string;
}

export function generateECKeyPair(): ECKeyPair {
  const priv = secp256k1.utils.randomSecretKey();
  const pub = secp256k1.getPublicKey(priv, true);
  return { privateKey: toBase64(priv), publicKey: toBase64(pub) };
}

export function encryptForRecipients(
  plaintext: string,
  recipients: RecipientKey[],
): EncryptedPayload {
  if (recipients.length === 0) throw new Error('No recipients to encrypt for');

  const sessionKey = randomBytes(32);
  const iv = randomBytes(12);
  const aes = gcm(sessionKey, iv);
  const ct = aes.encrypt(new TextEncoder().encode(plaintext));

  const wrappers: KeyWrapper[] = recipients.map((r) => {
    const ephPriv = secp256k1.utils.randomSecretKey();
    const ephPub = secp256k1.getPublicKey(ephPriv, true);
    const recipientPub = fromBase64(r.publicKey);
    // S = ephPriv · recipientPub (33-byte compressed point)
    const sharedPoint = secp256k1.getSharedSecret(ephPriv, recipientPub, true);
    const kdfKey = sha256Noble(sharedPoint); // 32 bytes
    const wIv = randomBytes(12);
    const wCt = gcm(kdfKey, wIv).encrypt(sessionKey);
    return {
      userId: r.userId,
      ephemeralPub: toBase64(ephPub),
      iv: toBase64(wIv),
      ct: toBase64(wCt),
    };
  });

  return { iv: toBase64(iv), ct: toBase64(ct), wrappers };
}

export function decryptForMe(
  myUserId: string,
  myPrivateKeyB64: string,
  payload: EncryptedPayload,
): string {
  const wrapper = payload.wrappers.find((w) => w.userId === myUserId);
  if (!wrapper) throw new Error('No wrapper for current user in payload');
  const myPriv = fromBase64(myPrivateKeyB64);
  const ephPub = fromBase64(wrapper.ephemeralPub);
  // S = myPriv · ephPub  ==  ephPriv · myPub  (ECDH symmetry)
  const sharedPoint = secp256k1.getSharedSecret(myPriv, ephPub, true);
  const kdfKey = sha256Noble(sharedPoint);
  const sessionKey = gcm(kdfKey, fromBase64(wrapper.iv)).decrypt(fromBase64(wrapper.ct));
  const pt = gcm(sessionKey, fromBase64(payload.iv)).decrypt(fromBase64(payload.ct));
  return new TextDecoder().decode(pt);
}

export function packPayload(p: EncryptedPayload): string {
  return JSON.stringify(p);
}

export function unpackPayload(s: string): EncryptedPayload {
  return JSON.parse(s);
}

// True when a string looks like a packed EncryptedPayload (used to gracefully
// render legacy/plaintext data left over from before the E2E rollout).
export function isEncryptedPayloadString(s: string): boolean {
  if (!s || typeof s !== 'string' || s[0] !== '{') return false;
  try {
    const o = JSON.parse(s);
    return !!(o && typeof o === 'object' && o.iv && o.ct && Array.isArray(o.wrappers));
  } catch {
    return false;
  }
}

// ── Standalone "Encryption" tool helpers ───────────────────
// Used by the in-app /encryption section. The user-facing key is a printable
// 16-char string; we hash it with SHA-256 into a 32-byte AES-256 key. Output
// format: base64(iv || ct) so the user has a single string to copy/paste.

const KEY16_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789abcdefghjkmnpqrstuvwxyz';
//                     ^ alphanumeric without ambiguous 0/O, 1/I/l — easier to copy

export function generateKey16(): string {
  return generateKey(16);
}

// Generate a printable random key of the requested length. Internally hashed
// with SHA-256 by the encrypt/decrypt helpers so any length ≥ 1 is accepted
// — but UX-wise we recommend ≥ 8 for any real use.
export function generateKey(length: number): string {
  if (length < 1) throw new Error('Key length must be ≥ 1');
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) {
    out += KEY16_ALPHABET[bytes[i] % KEY16_ALPHABET.length];
  }
  return out;
}

function deriveAesKeyFromString(key16: string): Uint8Array {
  // Hash the user-facing key into 32 bytes for AES-256-GCM.
  return sha256Noble(new TextEncoder().encode(key16));
}

export function encryptBytesWithKey16(plaintext: Uint8Array, key16: string): string {
  const key = deriveAesKeyFromString(key16);
  const iv = randomBytes(12);
  const ct = gcm(key, iv).encrypt(plaintext);
  const merged = new Uint8Array(iv.length + ct.length);
  merged.set(iv, 0);
  merged.set(ct, iv.length);
  return toBase64(merged);
}

export function decryptBytesWithKey16(combinedB64: string, key16: string): Uint8Array {
  const merged = fromBase64(combinedB64);
  if (merged.length < 13) throw new Error('Ciphertext too short');
  const iv = merged.slice(0, 12);
  const ct = merged.slice(12);
  const key = deriveAesKeyFromString(key16);
  return gcm(key, iv).decrypt(ct);
}

export function encryptStringWithKey16(plaintext: string, key16: string): string {
  return encryptBytesWithKey16(new TextEncoder().encode(plaintext), key16);
}

export function decryptStringWithKey16(combinedB64: string, key16: string): string {
  return new TextDecoder().decode(decryptBytesWithKey16(combinedB64, key16));
}

// Re-export for screens that need raw base64 conversion.
export { toBase64 as bytesToBase64, fromBase64 as base64ToBytes };

// ── Authenticated image encryption ─────────────────────────
// The PNG is a lossless carrier for a versioned header and AES-GCM
// ciphertext. Opaque RGB pixels prevent alpha premultiplication from
// changing encrypted bytes when the image is saved. Every encryption uses
// a fresh random nonce; decryption authenticates before decoding the image.
const IMAGE_MAGIC = new TextEncoder().encode('CIPHPNG2');
const IMAGE_HEADER_LENGTH = 32;
const MAX_IMAGE_BYTES = 16 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 8_000_000;

export interface ImageEncryptionResult {
  bytes: Uint8Array;  // PNG file bytes
  width: number;
  height: number;
}

function decodeBoundedPng(bytes: Uint8Array): ReturnType<typeof decodePng> {
  if (!bytes || bytes.length < 33 || bytes.length > MAX_IMAGE_BYTES) {
    throw new Error('Empty, truncated, or oversized PNG input');
  }
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (!signature.every((value, index) => bytes[index] === value)) {
    throw new Error('A lossless PNG file is required');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  if (!width || !height || width * height > MAX_IMAGE_PIXELS) {
    throw new Error('PNG dimensions exceed the supported limit');
  }
  const decoded = decodePng(bytes);
  if (decoded.depth !== 8 || (decoded.channels !== 3 && decoded.channels !== 4)) {
    throw new Error('An 8-bit RGB or RGBA PNG is required');
  }
  return decoded;
}

export function transformImagePng(
  pngBytes: Uint8Array,
  key16: string,
  mode: 'encrypt' | 'decrypt',
): ImageEncryptionResult {
  if (key16.length < 16) throw new Error('Image encryption keys must contain at least 16 characters');
  const decoded = decodeBoundedPng(pngBytes);
  const key = deriveAesKeyFromString(key16);
  if (mode === 'encrypt') {
    if (pngBytes.length > 12 * 1024 * 1024) throw new Error('Image is too large to encrypt');
    const width = Math.min(600, Math.max(16, decoded.width));
    const ciphertextLength = pngBytes.length + 16;
    const height = Math.ceil((IMAGE_HEADER_LENGTH + ciphertextLength) / (width * 3));
    const header = new Uint8Array(IMAGE_HEADER_LENGTH);
    header.set(IMAGE_MAGIC);
    const iv = randomBytes(12);
    header.set(iv, 8);
    const view = new DataView(header.buffer);
    view.setUint32(20, ciphertextLength);
    view.setUint32(24, width);
    view.setUint32(28, height);
    const ciphertext = gcm(key, iv, header).encrypt(pngBytes);
    const data = new Uint8Array(width * height * 3);
    data.set(header);
    data.set(ciphertext, IMAGE_HEADER_LENGTH);
    return { bytes: encodePng({ width, height, data, depth: 8, channels: 3 }), width, height };
  }

  const pixels = decoded.data as Uint8Array;
  const data = new Uint8Array(decoded.width * decoded.height * 3);
  for (let source = 0, target = 0; target < data.length; source += decoded.channels, target += 3) {
    if (decoded.channels === 4 && pixels[source + 3] !== 255) {
      throw new Error('Encrypted PNG was modified; transparency is not supported');
    }
    data.set(pixels.subarray(source, source + 3), target);
  }
  if (data.length < IMAGE_HEADER_LENGTH + 16 || !IMAGE_MAGIC.every((value, index) => data[index] === value)) {
    throw new Error('Unsupported encrypted image. Legacy image scrambling cannot be decrypted securely.');
  }
  const header = data.slice(0, IMAGE_HEADER_LENGTH);
  const view = new DataView(header.buffer);
  const ciphertextLength = view.getUint32(20);
  if (view.getUint32(24) !== decoded.width || view.getUint32(28) !== decoded.height ||
      ciphertextLength < 16 || ciphertextLength > data.length - IMAGE_HEADER_LENGTH ||
      data.subarray(IMAGE_HEADER_LENGTH + ciphertextLength).some((byte) => byte !== 0)) {
    throw new Error('Encrypted PNG is truncated or modified');
  }
  let plaintext: Uint8Array;
  try {
    plaintext = gcm(key, header.slice(8, 20), header).decrypt(
      data.slice(IMAGE_HEADER_LENGTH, IMAGE_HEADER_LENGTH + ciphertextLength),
    );
  } catch {
    throw new Error('Image authentication failed: incorrect key or modified image');
  }
  const original = decodeBoundedPng(plaintext);
  return { bytes: plaintext, width: original.width, height: original.height };
}

// ── PIN hashing (app lock) ─────────────────────────────────
// We don't reuse the vault's password-derived key because the app lock
// gates the app AFTER session restore (when the vault key is already in
// memory). So the PIN is a separate secret.

export function hashPin(pin: string, saltB64: string): string {
  const salt = fromBase64(saltB64);
  const pw = new TextEncoder().encode(pin);
  // Lighter than the vault PBKDF2 (50k vs 100k) — PIN is short anyway and
  // only protects against opportunistic device access, not crypto attacks.
  const out = pbkdf2(sha256Noble, pw, salt, { c: 50_000, dkLen: 32 });
  return toBase64(out);
}
