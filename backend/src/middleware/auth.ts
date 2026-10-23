import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';

export interface AuthedRequest extends Request {
  userId?: string;
}

export function authMiddleware(req: AuthedRequest, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid Authorization header' });
    return;
  }
  try {
    const payload = jwt.verify(header.slice(7), config.jwtSecret, {
      algorithms: ['HS256'], issuer: 'cipher-api', audience: 'cipher-client',
    });
    // All tokens from the username-only login implementation are revoked.
    if (typeof payload !== 'object' || payload.authVersion !== 2
        || typeof payload.userId !== 'string' || !/^[a-f0-9]{24}$/i.test(payload.userId)) {
      throw new Error('Invalid session');
    }
    req.userId = payload.userId;
    next();
  } catch {
    res.status(401).json({ error: 'Token invalid or expired' });
  }
}
