import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

// The mobile client derives this password-equivalent credential in a separate
// PBKDF2 domain. Neither the user's password nor the vault key reaches us.
export function validAuthCredential(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function stretch(credential: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(credential, salt, 32, { N: 16384, r: 8, p: 1 }, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

export async function hashAuthCredential(credential: string): Promise<string> {
  if (!validAuthCredential(credential)) throw new Error('Invalid authentication credential');
  const salt = randomBytes(16);
  const hash = await stretch(credential, salt);
  return `scrypt-v1:${salt.toString('hex')}:${hash.toString('hex')}`;
}

export async function verifyAuthCredential(credential: string, stored: string): Promise<boolean> {
  if (!validAuthCredential(credential)) return false;
  const parts = /^scrypt-v1:([a-f0-9]{32}):([a-f0-9]{64})$/.exec(stored);
  if (!parts) return false;
  const actual = await stretch(credential, Buffer.from(parts[1], 'hex'));
  return timingSafeEqual(actual, Buffer.from(parts[2], 'hex'));
}
