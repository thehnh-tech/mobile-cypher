import { Router, Response } from 'express';
import { Types } from 'mongoose';
import { Conversation } from '../models/Conversation';
import { Message } from '../models/Message';
import { User } from '../models/User';
import { authMiddleware, AuthedRequest } from '../middleware/auth';
import { messageBus, convChannel } from '../events';
import { sendExpoPush } from '../push';

const router = Router();
router.use(authMiddleware);

const LONG_POLL_TIMEOUT_MS = 25_000;

interface SerializedMessage {
  id: string;
  senderId: string;
  content: string;
  createdAt: Date;
  likes: string[];
  replyTo: {
    id: string;
    senderId: string;
    senderDisplayName: string;
    content: string;
  } | null;
}

function serialize(m: any): SerializedMessage {
  return {
    id: String(m._id),
    senderId: String(m.senderId),
    content: m.content,
    createdAt: m.createdAt,
    likes: (m.likes ?? []).map((u: any) => String(u)),
    replyTo: m.replyTo
      ? {
          id: String(m.replyTo.id),
          senderId: String(m.replyTo.senderId),
          senderDisplayName: m.replyTo.senderDisplayName,
          content: m.replyTo.content,
        }
      : null,
  };
}

async function ensureParticipant(convId: string, userId: string) {
  const conv = await Conversation.findById(convId);
  if (!conv) return { ok: false as const, status: 404, error: 'Conversation not found' };
  if (!conv.participantIds.some((p) => String(p) === String(userId))) {
    return { ok: false as const, status: 403, error: 'Not a participant' };
  }
  return { ok: true as const, conv };
}

// GET /conversations
router.get('/', async (req: AuthedRequest, res: Response) => {
  const convs = await Conversation.find({ participantIds: req.userId })
    .sort({ lastMessageAt: -1 })
    .lean();

  const peerIds = convs
    .map((c) => c.participantIds.find((p) => String(p) !== String(req.userId)))
    .filter(Boolean);
  const users = await User.find(
    { _id: { $in: peerIds } },
    { displayName: 1, tag: 1, fingerprint: 1, publicKey: 1 },
  ).lean();
  const userById = new Map(users.map((u) => [String(u._id), u]));

  return res.json({
    conversations: convs.map((c) => {
      const peerId = c.participantIds.find((p) => String(p) !== String(req.userId));
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
    }),
  });
});

// GET /conversations/:id/messages?since=<iso>&wait=true
// Long-polling: when wait=true and no new messages, hold the connection up to
// LONG_POLL_TIMEOUT_MS and resolve as soon as a message arrives in this conv.
router.get('/:id/messages', async (req: AuthedRequest, res: Response) => {
  const id = String(req.params.id);
  if (!Types.ObjectId.isValid(id)) return res.status(400).json({ error: 'Invalid id' });

  const check = await ensureParticipant(id, req.userId!);
  if (!check.ok) return res.status(check.status).json({ error: check.error });

  const sinceParam = req.query.since ? new Date(String(req.query.since)) : null;
  const since = sinceParam && !isNaN(sinceParam.getTime()) ? sinceParam : null;
  const wait = req.query.wait === 'true' || req.query.wait === '1';

  const fetchNew = async () => {
    const filter: Record<string, unknown> = { conversationId: id };
    if (since) filter.createdAt = { $gt: since };
    return Message.find(filter).sort({ createdAt: 1 }).lean();
  };

  const initial = await fetchNew();
  if (initial.length > 0 || !wait) {
    return res.json({ messages: initial.map(serialize) });
  }

  // Long-polling path: hang until a message arrives in this conv or timeout.
  const channel = convChannel(id);
  let settled = false;
  const settle = (data: SerializedMessage[]) => {
    if (settled) return;
    settled = true;
    res.json({ messages: data });
  };

  const onEvent = async () => {
    if (settled) return;
    messageBus.removeListener(channel, onEvent);
    clearTimeout(timer);
    const after = await fetchNew();
    settle(after.map(serialize));
  };

  const timer = setTimeout(async () => {
    if (settled) return;
    messageBus.removeListener(channel, onEvent);
    const after = await fetchNew();
    settle(after.map(serialize));
  }, LONG_POLL_TIMEOUT_MS);

  req.on('close', () => {
    if (settled) return;
    settled = true;
    messageBus.removeListener(channel, onEvent);
    clearTimeout(timer);
  });

  messageBus.once(channel, onEvent);
});

// POST /conversations/:id/messages — body { content, replyToId? }
router.post('/:id/messages', async (req: AuthedRequest, res: Response) => {
  const id = String(req.params.id);
  const { content, replyToId } = req.body ?? {};
  if (!Types.ObjectId.isValid(id)) return res.status(400).json({ error: 'Invalid id' });
  if (!content || typeof content !== 'string') {
    return res.status(400).json({ error: 'Missing content' });
  }

  const check = await ensureParticipant(id, req.userId!);
  if (!check.ok) return res.status(check.status).json({ error: check.error });

  let replyToSnapshot: SerializedMessage['replyTo'] | null = null;
  if (replyToId) {
    if (!Types.ObjectId.isValid(replyToId)) {
      return res.status(400).json({ error: 'Invalid replyToId' });
    }
    const parent = await Message.findById(replyToId).lean();
    if (!parent || String(parent.conversationId) !== id) {
      return res.status(400).json({ error: 'Reply target not in this conversation' });
    }
    const senderUser = await User.findById(parent.senderId, { displayName: 1 }).lean();
    replyToSnapshot = {
      id: String(parent._id),
      senderId: String(parent.senderId),
      senderDisplayName: senderUser?.displayName ?? 'Unknown',
      // Encrypted blob — keep as-is (slicing would corrupt the JSON
      // wrapper structure). Both participants already have their wrappers
      // baked into the parent ciphertext, so we just copy it forward.
      content: parent.content,
    };
  }

  const msg = await Message.create({
    conversationId: id,
    senderId: req.userId,
    content,
    replyTo: replyToSnapshot ?? undefined,
  });

  check.conv.lastMessage = content;
  check.conv.lastMessageAt = new Date();
  await check.conv.save();

  const serialized = serialize(msg.toObject());
  messageBus.emit(convChannel(id), serialized);

  // Fire-and-forget: notify the other participant(s) on their registered devices.
  const peerIds = check.conv.participantIds
    .map((p) => String(p))
    .filter((p) => p !== String(req.userId));
  if (peerIds.length > 0) {
    User.find({ _id: { $in: peerIds } }, { pushTokens: 1 })
      .lean()
      .then((peers) => {
        const tokens = peers.flatMap((p: any) => p.pushTokens ?? []);
        if (tokens.length === 0) return;
        sendExpoPush(
          tokens.map((t: string) => ({
            to: t,
            title: 'Cipher',
            body: 'You received a new message',
            data: { kind: 'message', conversationId: id },
          })),
        );
      })
      .catch((e) => console.warn('[push] lookup failed (message):', e?.message ?? e));
  }

  return res.status(201).json(serialized);
});

// POST /conversations/:id/messages/:msgId/like — toggles the caller's like.
router.post('/:id/messages/:msgId/like', async (req: AuthedRequest, res: Response) => {
  const id = String(req.params.id);
  const msgId = String(req.params.msgId);
  if (!Types.ObjectId.isValid(id) || !Types.ObjectId.isValid(msgId)) {
    return res.status(400).json({ error: 'Invalid id' });
  }

  const check = await ensureParticipant(id, req.userId!);
  if (!check.ok) return res.status(check.status).json({ error: check.error });

  const msg = await Message.findById(msgId);
  if (!msg || String(msg.conversationId) !== id) {
    return res.status(404).json({ error: 'Message not found' });
  }

  const myId = String(req.userId);
  const idx = msg.likes.findIndex((u: any) => String(u) === myId);
  if (idx >= 0) {
    msg.likes.splice(idx, 1);
  } else {
    msg.likes.push(new Types.ObjectId(myId));
  }
  await msg.save();
  const serialized = serialize(msg.toObject());
  messageBus.emit(convChannel(id), serialized);
  return res.json(serialized);
});

export default router;
