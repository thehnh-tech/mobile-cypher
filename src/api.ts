// HTTP client for the Cipher backend.
// Configure the URL via EXPO_PUBLIC_API_URL (set in .env at the project root).

import { EncryptedBlob } from './crypto';

const BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';

export class ApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

interface RequestOpts {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  token?: string;
}

async function request<T>(path: string, opts: RequestOpts = {}): Promise<T> {
  if (!__DEV__ && !BASE_URL.startsWith('https://')) {
    throw new Error('Production builds require an HTTPS backend URL.');
  }
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;

  let res: Response;
  // Long polling waits up to 25 seconds; allow it to finish while bounding outages.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 40_000);
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: controller.signal,
    });
  } catch (e: any) {
    throw new Error(`Network error reaching backend at ${BASE_URL}: ${e?.message ?? e}`);
  } finally {
    clearTimeout(timeout);
  }

  let data: any = {};
  try {
    data = await res.json();
  } catch {
    // server returned non-JSON body (rare)
  }

  if (!res.ok) {
    const msg = data?.error ?? `HTTP ${res.status}`;
    throw new ApiError(res.status, msg);
  }
  return data as T;
}

// ── Public API surface ────────────────────────────────────

export interface SignupBody {
  username: string;
  displayName: string;
  tag: string;
  tagHash: string;
  salt: string;
  verifier: EncryptedBlob;
  fingerprint: string;
  publicKey: string;
  authCredential: string;
}

export interface SignupResp {
  token: string;
  userId: string;
  fingerprint: string;
  publicKey: string;
}

export interface LoginResp {
  token: string;
  userId: string;
  salt: string;
  verifier: EncryptedBlob;
  fingerprint: string;
  displayName: string;
  tag: string;
  publicKey: string;
}

export interface UserByTagResp {
  userId: string;
  displayName: string;
  tag: string;
  fingerprint: string;
  publicKey: string;
}

// ── Server messaging types ────────────────────────────────

export interface ServerRequest {
  id: string;
  fromUserId: string;
  fromDisplayName: string;
  fromTag: string;
  fromFingerprint: string;
  fromPublicKey: string;
  firstMessage: string;     // packed EncryptedPayload (JSON string)
  createdAt: string;
}

export interface ServerConversation {
  id: string;
  peerUserId: string;
  peerDisplayName: string;
  peerTag: string;
  peerFingerprint: string;
  peerPublicKey: string;
  lastMessage: string;      // packed EncryptedPayload (JSON string), or '' for empty conv
  lastMessageAt: string;
}

export interface ReplyToSnapshot {
  id: string;
  senderId: string;
  senderDisplayName: string;
  content: string;
}

export interface ServerMessage {
  id: string;
  senderId: string;
  content: string;
  createdAt: string;
  likes: string[];
  replyTo: ReplyToSnapshot | null;
}

export interface SyncResp {
  serverTime: string;
  requests: ServerRequest[];
  conversations: ServerConversation[];
  newRequestsSince: number;
  newMessagesSince: number;
}

export const api = {
  aiChat: (token: string, messages: { role: 'user' | 'assistant'; content: string }[]) =>
    request<{ content: string }>('/ai/chat', { method: 'POST', token, body: { messages } }),

  health: () => request<{ status: string; ts: number }>('/health'),

  signup: (body: SignupBody) =>
    request<SignupResp>('/auth/signup', { method: 'POST', body }),

  authParameters: (username: string) =>
    request<{ salt: string; verifier: EncryptedBlob }>('/auth/parameters', {
      method: 'POST', body: { username },
    }),

  login: (username: string, authCredential: string) =>
    request<LoginResp>('/auth/login', { method: 'POST', body: { username, authCredential } }),

  getVault: (token: string) =>
    request<{ encryptedBlob: string; updatedAt: string }>('/vault', { token }),

  putVault: (token: string, encryptedBlob: string) =>
    request<{ ok: boolean; updatedAt: string }>('/vault', {
      method: 'PUT',
      token,
      body: { encryptedBlob },
    }),

  findByTag: async (token: string, tagHash: string): Promise<UserByTagResp | null> => {
    try {
      return await request<UserByTagResp>(`/users/by-tag/${encodeURIComponent(tagHash)}`, { token });
    } catch (e: any) {
      if (/not found|404/i.test(String(e?.message))) return null;
      throw e;
    }
  },

  sendRequest: (token: string, toUserId: string, firstMessage: string) =>
    request<{ kind: 'request' | 'message'; requestId?: string; conversationId?: string; messageId?: string }>(
      '/requests',
      { method: 'POST', token, body: { toUserId, firstMessage } },
    ),

  inboxRequests: (token: string) =>
    request<{ requests: ServerRequest[] }>('/requests/inbox', { token }),

  acceptRequest: (token: string, requestId: string) =>
    request<{ ok: boolean; conversationId: string }>(`/requests/${encodeURIComponent(requestId)}/accept`, {
      method: 'POST',
      token,
    }),

  declineRequest: (token: string, requestId: string) =>
    request<{ ok: boolean }>(`/requests/${encodeURIComponent(requestId)}/decline`, {
      method: 'POST',
      token,
    }),

  listConversations: (token: string) =>
    request<{ conversations: ServerConversation[] }>('/conversations', { token }),

  getMessages: (
    token: string,
    conversationId: string,
    opts: { since?: string; wait?: boolean } = {},
  ) => {
    const params: string[] = [];
    if (opts.since) params.push(`since=${encodeURIComponent(opts.since)}`);
    if (opts.wait) params.push('wait=true');
    const q = params.length > 0 ? `?${params.join('&')}` : '';
    return request<{ messages: ServerMessage[] }>(
      `/conversations/${encodeURIComponent(conversationId)}/messages${q}`,
      { token },
    );
  },

  sendMessage: (
    token: string,
    conversationId: string,
    content: string,
    replyToId?: string,
  ) =>
    request<ServerMessage>(`/conversations/${encodeURIComponent(conversationId)}/messages`, {
      method: 'POST',
      token,
      body: replyToId ? { content, replyToId } : { content },
    }),

  likeMessage: (token: string, conversationId: string, messageId: string) =>
    request<ServerMessage>(
      `/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}/like`,
      { method: 'POST', token },
    ),

  sync: (token: string, since?: string) => {
    const q = since ? `?since=${encodeURIComponent(since)}` : '';
    return request<SyncResp>(`/sync${q}`, { token });
  },

  registerPushToken: (token: string, expoPushToken: string) =>
    request<{ ok: boolean }>('/push/register', {
      method: 'POST',
      token,
      body: { token: expoPushToken },
    }),

  unregisterPushToken: (token: string, expoPushToken: string) =>
    request<{ ok: boolean }>('/push/unregister', {
      method: 'POST',
      token,
      body: { token: expoPushToken },
    }),
};

export const API_BASE_URL = BASE_URL;
