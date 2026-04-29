import { Router, Request, Response } from 'express';
import jwt, { SignOptions } from 'jsonwebtoken';
import { User } from '../models/User';
import { config } from '../config';

const router = Router();

function issueToken(userId: string): string {
  return jwt.sign({ userId }, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn as SignOptions['expiresIn'],
  });
}

// POST /auth/signup
// Body: { username, displayName, tag, tagHash, salt, verifier:{iv,ct}, fingerprint }
// Server validates uniqueness, persists the user, returns JWT + userId.
// Client then PUTs the initial vault with that userId baked into profile.id.
router.post('/signup', async (req: Request, res: Response) => {
  const { username, displayName, tag, tagHash, salt, verifier, fingerprint, publicKey } =
    req.body ?? {};

  if (
    !username || !displayName || !tag || !tagHash || !salt || !verifier ||
    !fingerprint || !publicKey
  ) {
    return res.status(400).json({ error: 'Missing fields' });
  }
  if (typeof verifier !== 'object' || !verifier.iv || !verifier.ct) {
    return res.status(400).json({ error: 'Invalid verifier shape (expected {iv, ct})' });
  }

  try {
    const exists = await User.findOne({ $or: [{ username: username.toLowerCase() }, { tagHash }] });
    if (exists) {
      const conflict = exists.username === username.toLowerCase() ? 'username' : 'tag';
      return res.status(409).json({ error: `${conflict} already taken` });
    }

    const user = await User.create({
      username, displayName, tag, tagHash, salt, verifier, fingerprint, publicKey,
    });

    const token = issueToken(String(user._id));
    return res.status(201).json({
      token, userId: String(user._id), fingerprint, publicKey,
    });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message ?? 'Signup failed' });
  }
});

// POST /auth/login
// Body: { username }
// Returns: salt + verifier so the client can derive the key and verify
// the password locally. If verification succeeds the client uses the JWT
// returned here to fetch the vault.
router.post('/login', async (req: Request, res: Response) => {
  const { username } = req.body ?? {};
  if (!username) return res.status(400).json({ error: 'Missing username' });

  const user = await User.findOne({ username: username.toLowerCase() });
  if (!user) return res.status(404).json({ error: 'User not found' });

  const token = issueToken(String(user._id));
  return res.json({
    token,
    userId: String(user._id),
    salt: user.salt,
    verifier: user.verifier,
    fingerprint: user.fingerprint,
    displayName: user.displayName,
    tag: user.tag,
    publicKey: user.publicKey,
  });
});

export default router;
