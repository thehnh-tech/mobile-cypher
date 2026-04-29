import { Router, Response } from 'express';
import { User } from '../models/User';
import { authMiddleware, AuthedRequest } from '../middleware/auth';

const router = Router();
router.use(authMiddleware);

function isValidExpoToken(t: unknown): t is string {
  return typeof t === 'string' && /^Expo(nent)?PushToken\[.+\]$/.test(t);
}

// POST /push/register — body { token }
router.post('/register', async (req: AuthedRequest, res: Response) => {
  const { token } = req.body ?? {};
  if (!isValidExpoToken(token)) {
    return res.status(400).json({ error: 'Invalid Expo push token' });
  }
  await User.updateOne(
    { _id: req.userId },
    { $addToSet: { pushTokens: token } },
  );
  return res.json({ ok: true });
});

// POST /push/unregister — body { token }
router.post('/unregister', async (req: AuthedRequest, res: Response) => {
  const { token } = req.body ?? {};
  if (typeof token !== 'string' || !token) {
    return res.status(400).json({ error: 'Missing token' });
  }
  await User.updateOne(
    { _id: req.userId },
    { $pull: { pushTokens: token } },
  );
  return res.json({ ok: true });
});

export default router;
