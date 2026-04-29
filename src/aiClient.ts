// Groq API client — Llama 3.3 70B, free tier
// https://console.groq.com

import { Message } from './db';

// Default key — user can override in Profile settings (stored encrypted in vault)
const DEFAULT_GROQ_KEY = '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';

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = 'llama-3.3-70b-versatile';

const SYSTEM_PROMPT =
  "You are Cipher, the AI assistant inside the Cipher app — a private end-to-end encrypted messaging app. " +
  'All conversations are encrypted client-side with AES-256-GCM using a key derived from the user\'s password. ' +
  'User data is stored only on their device — no external servers see plaintext, no developer access, fully confidential. ' +
  'If asked about privacy or security, reassure the user with these facts. ' +
  'Be concise, friendly, and helpful. Match the language the user writes in (French or English). ' +
  'Keep responses under 200 words unless asked for more detail.';

export interface AIError {
  kind: 'auth' | 'rate' | 'network' | 'unknown';
  message: string;
}

/**
 * Send conversation history + new user message, get AI reply.
 * `messages` should be the chat thread; `currentUserId` is used to
 * label which messages were sent by the user vs the AI.
 */
export async function getAIReply(
  messages: Message[],
  currentUserId: string,
  aiContactId: string,
  apiKeyOverride?: string,
): Promise<string> {
  const apiKey = (apiKeyOverride && apiKeyOverride.trim()) || DEFAULT_GROQ_KEY;

  // Take last 20 messages to bound context
  const history = messages
    .filter((m) => !m.deleted)
    .slice(-20)
    .map((m) => ({
      role: m.from === currentUserId ? ('user' as const) : ('assistant' as const),
      content: m.text,
    }));

  let res: Response;
  try {
    res = await fetch(GROQ_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...history],
        max_tokens: 500,
        temperature: 0.7,
      }),
    });
  } catch (e: any) {
    throw <AIError>{ kind: 'network', message: e?.message ?? 'Network error' };
  }

  if (res.status === 401 || res.status === 403) {
    throw <AIError>{ kind: 'auth', message: 'API key rejected. Update it in Profile.' };
  }
  if (res.status === 429) {
    throw <AIError>{ kind: 'rate', message: 'Rate limited. Try again in a moment.' };
  }
  if (!res.ok) {
    throw <AIError>{ kind: 'unknown', message: `Groq returned ${res.status}` };
  }

  const data = await res.json();
  const content: string | undefined = data?.choices?.[0]?.message?.content;
  if (!content) throw <AIError>{ kind: 'unknown', message: 'Empty response from AI' };
  return content.trim();
}

export function isAIError(e: unknown): e is AIError {
  return typeof e === 'object' && e !== null && 'kind' in e && 'message' in e;
}
