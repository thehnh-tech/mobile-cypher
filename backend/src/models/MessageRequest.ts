import { Schema, model, InferSchemaType, Types } from 'mongoose';

const messageRequestSchema = new Schema(
  {
    fromUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    toUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    firstMessage: { type: String, required: true },
    status: {
      type: String,
      enum: ['pending', 'accepted', 'declined'],
      default: 'pending',
      index: true,
    },
  },
  { timestamps: true },
);

export type IMessageRequest = InferSchemaType<typeof messageRequestSchema> & { _id: Types.ObjectId };
export const MessageRequest = model('MessageRequest', messageRequestSchema);
