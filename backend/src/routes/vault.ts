import { Router, Response } from 'express';
import { Vault } from '../models/Vault';
import { authMiddleware, AuthedRequest } from '../middleware/auth';

const router = Router();
router.use(authMiddleware);

// GET /vault — fetch the encrypted blob for the authenticated user.
router.get('/', async (req: AuthedRequest, res: Response) => {
  const vault = await Vault.findOne({ userId: req.userId });
  if (!vault) return res.status(404).json({ error: 'Vault not found' });
  return res.json({ encryptedBlob: vault.encryptedBlob, updatedAt: vault.updatedAt });
});

// PUT /vault — overwrite the encrypted blob. Body: { encryptedBlob }.
router.put('/', async (req: AuthedRequest, res: Response) => {
  const { encryptedBlob } = req.body ?? {};
  if (!encryptedBlob || typeof encryptedBlob !== 'string') {
    return res.status(400).json({ error: 'Missing encryptedBlob (string expected)' });
  }

  const updated = await Vault.findOneAndUpdate(
    { userId: req.userId },
    { encryptedBlob },
    { upsert: true, new: true },
  );
  return res.json({ ok: true, updatedAt: updated.updatedAt });
});

export default router;
