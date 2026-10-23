import { Request, Response, NextFunction } from 'express';

// Bounded, process-local protection. Multi-instance deployments additionally
// need a shared limit at their gateway/load balancer. Each factory is a bucket.
export function createRateLimit(
  limit: number,
  windowMs: number,
  identify: (req: Request) => string = (req) => req.ip || req.socket.remoteAddress || 'unknown',
) {
  const attempts = new Map<string, { count: number; resetAt: number }>();
  const maxEntries = 10_000;
  return (req: Request, res: Response, next: NextFunction): void => {
    const now = Date.now();
    for (const [key, value] of attempts) {
      if (value.resetAt <= now) attempts.delete(key);
    }
    const key = identify(req);
    let entry = attempts.get(key);
    if (!entry) {
      if (attempts.size >= maxEntries) {
        res.status(429).json({ error: 'Too many requests. Try later.' });
        return;
      }
      entry = { count: 0, resetAt: now + windowMs };
      attempts.set(key, entry);
    }
    entry.count += 1;
    if (entry.count > limit) {
      res.setHeader('Retry-After', String(Math.ceil((entry.resetAt - now) / 1000)));
      res.status(429).json({ error: 'Too many requests. Try later.' });
      return;
    }
    next();
  };
}
