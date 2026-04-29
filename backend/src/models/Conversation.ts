import { Schema, model, InferSchemaType, Types } from 'mongoose';

const conversationSchema = new Schema(
  {
    participantIds: {
      type: [{ type: Schema.Types.ObjectId, ref: 'User' }],
      required: true,
      validate: {
        validator: (v: any[]) => Array.isArray(v) && v.length === 2,
        message: 'A conversation must have exactly 2 participants',
      },
      index: true,
    },
    lastMessage: { type: String, default: '' },
    lastMessageAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true },
);

export type IConversation = InferSchemaType<typeof conversationSchema> & { _id: Types.ObjectId };
export const Conversation = model('Conversation', conversationSchema);
