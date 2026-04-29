import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { config } from './config';
import { connectDB } from './db';
import authRoutes from './routes/auth';
import vaultRoutes from './routes/vault';
import userRoutes from './routes/users';
import requestsRoutes from './routes/requests';
import conversationsRoutes from './routes/conversations';
import syncRoutes from './routes/sync';
import pushRoutes from './routes/push';

async function main() {
  await connectDB();

  const app = express();
  app.use(helmet());
  app.use(cors()); // Open CORS — fine for local dev. Tighten in prod.
  app.use(express.json({ limit: '4mb' })); // vault blobs can be larger than default 100kb
  app.use(morgan(config.nodeEnv === 'production' ? 'combined' : 'dev'));

  app.get('/health', (_req, res) => res.json({ status: 'ok', ts: Date.now() }));

  app.use('/auth', authRoutes);
  app.use('/vault', vaultRoutes);
  app.use('/users', userRoutes);
  app.use('/requests', requestsRoutes);
  app.use('/conversations', conversationsRoutes);
  app.use('/sync', syncRoutes);
  app.use('/push', pushRoutes);

  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('[error]', err);
    res.status(500).json({ error: err?.message ?? 'Internal server error' });
  });

  // Listen on 0.0.0.0 so the phone on the same Wi-Fi can reach us via the PC's LAN IP.
  app.listen(config.port, '0.0.0.0', () => {
    console.log(`[server] listening on http://0.0.0.0:${config.port}`);
  });
}

main().catch((e) => {
  console.error('[fatal]', e);
  process.exit(1);
});
