import { Router, Request, Response } from 'express';
import { User } from '../models/User';
import { authMiddleware } from '../middleware/auth';

const router = Router();
router.use(authMiddleware);

// GET /users/by-tag/:tag — find a user by hashed tag for friend search.
// Client sends the SHA-256 of the desired tag (privacy: server never sees raw tags).
router.get('/by-tag/:tagHash', async (req: Request, res: Response) => {
  const { tagHash } = req.params;
  if (!tagHash) return res.status(400).json({ error: 'Missing tagHash' });

  const user = await User.findOne({ tagHash });
  if (!user) return res.status(404).json({ error: 'No user with that tag' });

  return res.json({
    userId: String(user._id),
    displayName: user.displayName,
    tag: user.tag,
    fingerprint: user.fingerprint,
    publicKey: user.publicKey,
  });
});

export default router;
