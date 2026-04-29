import { Schema, model, InferSchemaType, Types } from 'mongoose';

const replyToSnapshotSchema = new Schema(
  {
    id: { type: Schema.Types.ObjectId, required: true },
    senderId: { type: Schema.Types.ObjectId, required: true },
    senderDisplayName: { type: String, required: true },
    content: { type: String, required: true },
  },
  { _id: false },
);

const messageSchema = new Schema(
  {
    conversationId: {
      type: Schema.Types.ObjectId,
      ref: 'Conversation',
      required: true,
      index: true,
    },
    senderId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    content: { type: String, required: true },
    likes: {
      type: [{ type: Schema.Types.ObjectId, ref: 'User' }],
      default: [],
    },
    replyTo: { type: replyToSnapshotSchema, default: null },
  },
  { timestamps: true },
);

messageSchema.index({ conversationId: 1, createdAt: 1 });

export type IMessage = InferSchemaType<typeof messageSchema> & { _id: Types.ObjectId };
export const Message = model('Message', messageSchema);
