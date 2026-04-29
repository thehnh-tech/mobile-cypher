import { Schema, model, InferSchemaType, Types } from 'mongoose';

// Encrypted blob. The server stores it as opaque base64 — only the client
// can decrypt it with the AES-GCM key derived from the user's password.
const vaultSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
      index: true,
    },
    encryptedBlob: { type: String, required: true },
  },
  { timestamps: true },
);

export type IVault = InferSchemaType<typeof vaultSchema> & { _id: Types.ObjectId };
export const Vault = model('Vault', vaultSchema);
