import mongoose from 'mongoose';
import { config } from './config';

export async function connectDB(): Promise<void> {
  mongoose.set('strictQuery', true);
  await mongoose.connect(config.mongoUri);
  console.log(`[mongo] connected: ${config.mongoUri}`);
}
