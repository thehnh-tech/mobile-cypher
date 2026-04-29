import { Router, Response } from 'express';
import { Types } from 'mongoose';
import { MessageRequest } from '../models/MessageRequest';
import { Conversation } from '../models/Conversation';
import { Message } from '../models/Message';
import { User } from '../models/User';
import { authMiddleware, AuthedRequest } from '../middleware/auth';
import { sendExpoPush } from '../push';

const router = Router();
router.use(authMiddleware);

// POST /requests
// Body: { toUserId, firstMessage }
// If a conversation already exists with this peer → posts the message into it directly.
// Otherwise, creates a pending MessageRequest.
router.post('/', async (req: AuthedRequest, res: Response) => {
  const { toUserId, firstMessage } = req.body ?? {};
  if (!toUserId || !firstMessage) {
    return res.status(400).json({ error: 'Missing toUserId or firstMessage' });
  }
  if (!Types.ObjectId.isValid(toUserId)) {
    return res.status(400).json({ error: 'Invalid toUserId' });
  }
  if (String(toUserId) === String(req.userId)) {
    return res.status(400).json({ error: 'Cannot send a request to yourself' });
  }

  const peer = await User.findById(toUserId);
  if (!peer) return res.status(404).json({ error: 'Recipient not found' });

  const existing = await Conversation.findOne({
    participantIds: { $all: [req.userId, toUserId], $size: 2 },
  });
  if (existing) {
    const msg = await Message.create({
      conversationId: existing._id,
      senderId: req.userId,
      content: firstMessage,
    });
    existing.lastMessage = firstMessage;
    existing.lastMessageAt = new Date();
    await existing.save();

    // Treat as a normal new message: notify the peer.
    if (peer.pushTokens && peer.pushTokens.length > 0) {
      sendExpoPush(
        peer.pushTokens.map((t: string) => ({
          to: t,
          title: 'Cipher',
          body: 'You received a new message',
          data: { kind: 'message', conversationId: String(existing._id) },
        })),
      );
    }

    return res.json({
      kind: 'message',
      conversationId: String(existing._id),
      messageId: String(msg._id),
    });
  }

  const dup = await MessageRequest.findOne({
    fromUserId: req.userId,
    toUserId,
    status: 'pending',
  });
  if (dup) return res.status(409).json({ error: 'Request already pending' });

  const reqDoc = await MessageRequest.create({
    fromUserId: req.userId,
    toUserId,
    firstMessage,
  });

  if (peer.pushTokens && peer.pushTokens.length > 0) {
    sendExpoPush(
      peer.pushTokens.map((t: string) => ({
        to: t,
        title: 'Cipher',
        body: 'You received a new request',
        data: { kind: 'request', requestId: String(reqDoc._id) },
      })),
    );
  }

  return res.status(201).json({ kind: 'request', requestId: String(reqDoc._id) });
});

// GET /requests/inbox — pending requests addressed to me, with sender display info.
router.get('/inbox', async (req: AuthedRequest, res: Response) => {
  const requests = await MessageRequest.find({ toUserId: req.userId, status: 'pending' })
    .sort({ createdAt: -1 })
    .lean();

  const fromIds = requests.map((r) => r.fromUserId);
  const users = await User.find(
    { _id: { $in: fromIds } },
    { displayName: 1, tag: 1, fingerprint: 1, publicKey: 1 },
  ).lean();
  const userById = new Map(users.map((u) => [String(u._id), u]));

  return res.json({
    requests: requests.map((r) => {
      const from = userById.get(String(r.fromUserId));
      return {
        id: String(r._id),
        fromUserId: String(r.fromUserId),
        fromDisplayName: from?.displayName ?? 'Unknown',
        fromTag: from?.tag ?? '',
        fromFingerprint: from?.fingerprint ?? '',
        fromPublicKey: from?.publicKey ?? '',
        firstMessage: r.firstMessage,
        createdAt: r.createdAt,
      };
    }),
  });
});

// POST /requests/:id/accept — promotes a pending request into a Conversation + first Message.
router.post('/:id/accept', async (req: AuthedRequest, res: Response) => {
  const id = String(req.params.id);
  if (!Types.ObjectId.isValid(id)) return res.status(400).json({ error: 'Invalid id' });

  const reqDoc = await MessageRequest.findById(id);
  if (!reqDoc) return res.status(404).json({ error: 'Request not found' });
  if (String(reqDoc.toUserId) !== String(req.userId)) {
    return res.status(403).json({ error: 'Not yours to accept' });
  }
  if (reqDoc.status !== 'pending') {
    return res.status(400).json({ error: 'Request already handled' });
  }

  const conv = await Conversation.create({
    participantIds: [reqDoc.fromUserId, reqDoc.toUserId],
    lastMessage: reqDoc.firstMessage,
    lastMessageAt: new Date(),
  });
  await Message.create({
    conversationId: conv._id,
    senderId: reqDoc.fromUserId,
    content: reqDoc.firstMessage,
  });
  reqDoc.status = 'accepted';
  await reqDoc.save();

  return res.json({ ok: true, conversationId: String(conv._id) });
});

// POST /requests/:id/decline
router.post('/:id/decline', async (req: AuthedRequest, res: Response) => {
  const id = String(req.params.id);
  if (!Types.ObjectId.isValid(id)) return res.status(400).json({ error: 'Invalid id' });

  const reqDoc = await MessageRequest.findById(id);
  if (!reqDoc) return res.status(404).json({ error: 'Request not found' });
  if (String(reqDoc.toUserId) !== String(req.userId)) {
    return res.status(403).json({ error: 'Not yours to decline' });
  }
  if (reqDoc.status !== 'pending') {
    return res.status(400).json({ error: 'Request already handled' });
  }

  reqDoc.status = 'declined';
  await reqDoc.save();
  return res.json({ ok: true });
});

export default router;
