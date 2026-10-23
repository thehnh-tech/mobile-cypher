import { Router, Request, Response, NextFunction } from 'express';
import { createHash, ECDH } from 'node:crypto';
import jwt, { SignOptions } from 'jsonwebtoken';
import { User } from '../models/User';
import { config } from '../config';
import { hashAuthCredential, validAuthCredential, verifyAuthCredential } from '../authCredentials';
import { createRateLimit } from '../middleware/rateLimit';

const router = Router();
router.use(createRateLimit(30, 15 * 60 * 1000));
router.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

function issueToken(userId: string): string {
  return jwt.sign({ userId, authVersion: 2 }, config.jwtSecret, {
    algorithm: 'HS256',
    expiresIn: config.jwtExpiresIn as SignOptions['expiresIn'],
    issuer: 'cipher-api',
    audience: 'cipher-client',
  });
}

function validUsername(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9_.-]{3,64}$/.test(value);
}

function textField(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max;
}

function base64Bytes(value: unknown, size: number): value is string {
  return typeof value === 'string' && value.length <= 128
    && Buffer.from(value, 'base64').length === size
    && Buffer.from(value, 'base64').toString('base64') === value;
}

// Only new accounts can enroll credentials. Never accept a username-only
// credential upgrade for existing users: that would recreate the auth bypass.
router.post('/signup', async (req: Request, res: Response, next: NextFunction) => {
  const { username, displayName, tag, tagHash, salt, verifier, fingerprint, publicKey, authCredential } = req.body ?? {};
  if (!validUsername(username) || !textField(displayName, 100)
      || typeof tag !== 'string' || !/^[a-z0-9_.]{3,64}$/.test(tag)
      || typeof tagHash !== 'string' || !/^[a-f0-9]{64}$/.test(tagHash)
      || !base64Bytes(salt, 16) || !verifier || typeof verifier !== 'object'
      || !base64Bytes(verifier.iv, 12) || !base64Bytes(verifier.ct, 25)
      || !textField(fingerprint, 100) || !base64Bytes(publicKey, 33)
      || !validAuthCredential(authCredential)) {
    return res.status(400).json({ error: 'Invalid signup fields. Update the app and try again.' });
  }

  // Directory identifiers must describe the actual submitted tag/key. A
  // client cannot register another tag's hash or an unrelated fingerprint.
  const expectedTagHash = createHash('sha256').update(tag).digest('hex');
  const expectedFingerprint = createHash('sha256').update(publicKey).digest('hex')
    .slice(0, 32).match(/.{4}/g)!.join(' ').toUpperCase();
  if (tagHash !== expectedTagHash || fingerprint !== expectedFingerprint) {
    return res.status(400).json({ error: 'Tag hash or public-key fingerprint does not match' });
  }
  try {
    const keyBytes = Buffer.from(publicKey, 'base64');
    // OpenSSL validates curve membership as well as compressed encoding.
    const canonical = ECDH.convertKey(keyBytes, 'secp256k1', undefined, undefined, 'compressed');
    if (!Buffer.isBuffer(canonical) || !canonical.equals(keyBytes)) throw new Error('Invalid public key');
  } catch {
    return res.status(400).json({ error: 'Invalid secp256k1 public key' });
  }

  try {
    const exists = await User.findOne({ $or: [{ username: username.toLowerCase() }, { tagHash }] });
    if (exists) return res.status(409).json({ error: 'Username or tag already taken' });
    const authHash = await hashAuthCredential(authCredential);
    const user = await User.create({
      username, displayName, tag, tagHash, salt, verifier, fingerprint, publicKey, authHash,
    });
    return res.status(201).json({
      token: issueToken(String(user._id)), userId: String(user._id), fingerprint, publicKey,
    });
  } catch (error: any) {
    if (error?.code === 11000) return res.status(409).json({ error: 'Username or tag already taken' });
    next(error);
  }
});

// Public KDF parameters; this route NEVER creates a session or exposes a vault.
router.post('/parameters', async (req: Request, res: Response, next: NextFunction) => {
  const { username } = req.body ?? {};
  if (!validUsername(username)) return res.status(400).json({ error: 'Invalid username' });
  try {
    const user = await User.findOne({ username: username.toLowerCase() }).select('+authHash');
    if (!user) return res.status(401).json({ error: 'Unable to sign in' });
    if (!user.authHash) {
      return res.status(403).json({ error: 'Legacy account requires verified administrator migration. Contact the operator.' });
    }
    return res.json({ salt: user.salt, verifier: user.verifier });
  } catch (error) {
    next(error);
  }
});

router.post('/login', async (req: Request, res: Response, next: NextFunction) => {
  const { username, authCredential } = req.body ?? {};
  if (!validUsername(username) || !validAuthCredential(authCredential)) {
    return res.status(400).json({ error: 'Username and authentication credential required' });
  }
  try {
    const user = await User.findOne({ username: username.toLowerCase() }).select('+authHash');
    if (!user?.authHash || !await verifyAuthCredential(authCredential, user.authHash)) {
      return res.status(401).json({ error: 'Unable to sign in' });
    }
    return res.json({
      token: issueToken(String(user._id)),
      userId: String(user._id), salt: user.salt, verifier: user.verifier,
      fingerprint: user.fingerprint, displayName: user.displayName,
      tag: user.tag, publicKey: user.publicKey,
    });
  } catch (error) {
    next(error);
  }
});

export default router;
