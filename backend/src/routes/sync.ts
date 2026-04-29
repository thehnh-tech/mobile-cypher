import { Router, Response } from 'express';
import { MessageRequest } from '../models/MessageRequest';
import { Conversation } from '../models/Conversation';
import { Message } from '../models/Message';
import { User } from '../models/User';
import { authMiddleware, AuthedRequest } from '../middleware/auth';

const router = Router();
router.use(authMiddleware);

// GET /sync?since=<iso>
// Aggregated polling endpoint: returns the data the frontend needs to render
// the chat list + requests page, plus deltas since the client's last sync so
// the client can decide whether to fire a notification toast.
router.get('/', async (req: AuthedRequest, res: Response) => {
  const me = req.userId!;
  const sinceParam = req.query.since ? new Date(String(req.query.since)) : null;
  const since = sinceParam && !isNaN(sinceParam.getTime()) ? sinceParam : null;

  const [requestsRaw, convsRaw] = await Promise.all([
    MessageRequest.find({ toUserId: me, status: 'pending' }).sort({ createdAt: -1 }).lean(),
    Conversation.find({ participantIds: me }).sort({ lastMessageAt: -1 }).lean(),
  ]);

  const peerIds = new Set<string>();
  requestsRaw.forEach((r) => peerIds.add(String(r.fromUserId)));
  convsRaw.forEach((c) => {
    const peer = c.participantIds.find((p) => String(p) !== String(me));
    if (peer) peerIds.add(String(peer));
  });

  const users = await User.find(
    { _id: { $in: Array.from(peerIds) } },
    { displayName: 1, tag: 1, fingerprint: 1, publicKey: 1 },
  ).lean();
  const userById = new Map(users.map((u) => [String(u._id), u]));

  const requests = requestsRaw.map((r) => {
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
  });

  const conversations = convsRaw.map((c) => {
    const peerId = c.participantIds.find((p) => String(p) !== String(me));
    const peer = userById.get(String(peerId));
    return {
      id: String(c._id),
      peerUserId: String(peerId),
      peerDisplayName: peer?.displayName ?? 'Unknown',
      peerTag: peer?.tag ?? '',
      peerFingerprint: peer?.fingerprint ?? '',
      peerPublicKey: peer?.publicKey ?? '',
      lastMessage: c.lastMessage ?? '',
      lastMessageAt: c.lastMessageAt,
    };
  });

  let newRequestsSince = 0;
  let newMessagesSince = 0;
  if (since) {
    newRequestsSince = await MessageRequest.countDocuments({
      toUserId: me,
      status: 'pending',
      createdAt: { $gt: since },
    });
    const myConvIds = convsRaw.map((c) => c._id);
    if (myConvIds.length > 0) {
      newMessagesSince = await Message.countDocuments({
        conversationId: { $in: myConvIds },
        senderId: { $ne: me },
        createdAt: { $gt: since },
      });
    }
  }

  return res.json({
    serverTime: new Date().toISOString(),
    requests,
    conversations,
    newRequestsSince,
    newMessagesSince,
  });
});

export default router;
