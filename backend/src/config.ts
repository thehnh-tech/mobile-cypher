import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  mongoUri: required('MONGODB_URI'),
  jwtSecret: required('JWT_SECRET'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '30d',
  nodeEnv: process.env.NODE_ENV ?? 'development',
  groqApiKey: process.env.GROQ_API_KEY?.trim() ?? '',
  groqModel: process.env.GROQ_MODEL?.trim() || 'llama-3.3-70b-versatile',
  corsOrigins: (process.env.CORS_ORIGINS ?? '').split(',').map((v) => v.trim()).filter(Boolean),
};

if (config.jwtSecret.length < 32 || /replace_me|change_me|example/i.test(config.jwtSecret)) {
  throw new Error('JWT_SECRET must be a random secret of at least 32 characters, not a placeholder');
}
