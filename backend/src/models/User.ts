import { Schema, model, InferSchemaType } from 'mongoose';

// Public user record. Contains everything needed for the client to verify a
// password locally (salt + verifier) and look up users by tag (tagHash).
// The actual vault contents (messages, contacts, profile) live in Vault.
const userSchema = new Schema(
  {
    username: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    displayName: { type: String, required: true },
    tag: { type: String, required: true },
    tagHash: { type: String, required: true, unique: true, index: true },
    salt: { type: String, required: true },
    verifier: {
      iv: { type: String, required: true },
      ct: { type: String, required: true },
    },
    fingerprint: { type: String, required: true },
    pushTokens: { type: [String], default: [] },
    // base64 of 33-byte compressed secp256k1 public key (used for hybrid
    // EC-ElGamal). Required at signup for any user created post-rollout.
    publicKey: { type: String, required: true, default: '' },
  },
  { timestamps: true },
);

export type IUser = InferSchemaType<typeof userSchema> & { _id: any };
export const User = model('User', userSchema);
