import { Router } from 'express';
import { config } from '../config';
import { authMiddleware, AuthedRequest } from '../middleware/auth';
import { createRateLimit } from '../middleware/rateLimit';

const SYSTEM_PROMPT =
  'You are Cipher, the AI assistant in the Cipher app. Be concise, friendly, and helpful. ' +
  'Match the language of the user. Keep replies under 200 words unless asked for detail. ' +
  'AI messages are sent as plaintext to the Cipher backend and to Groq for processing. ' +
  'They are not end-to-end encrypted from those services. Do not claim that AI chats stay ' +
  'only on the device, that the operator cannot access them, or that the provider has a ' +
  'particular retention policy. The local chat vault is encrypted at rest.';

interface ChatMessage { role: 'user' | 'assistant'; content: string }

function validHistory(value: unknown): value is ChatMessage[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 20) return false;
  let total = 0;
  for (const message of value) {
    if (!message || !['user', 'assistant'].includes(message.role) ||
        typeof message.content !== 'string' || !message.content.trim() ||
        message.content.length > 4_000) return false;
    total += message.content.length;
  }
  return total <= 20_000 && value[value.length - 1].role === 'user';
}

// Dependencies are injectable for tests; tests never contact or charge the provider.
export function createAiRouter(
  options = { apiKey: config.groqApiKey, model: config.groqModel },
  providerFetch: typeof fetch = fetch,
) {
  const router = Router();
  let inFlight = 0;
  router.use(authMiddleware);
  router.use(createRateLimit(60, 60_000, () => 'all-ai-requests'));
  router.use(createRateLimit(10, 60_000, (req: AuthedRequest) => req.userId!));

  router.post('/chat', async (req, res) => {
    if (!options.apiKey) {
      res.status(503).json({ error: 'AI is not configured on this server.' });
      return;
    }
    if (!validHistory(req.body?.messages)) {
      res.status(400).json({ error: 'Send 1–20 user/assistant messages, at most 4000 characters each and 20000 total, ending with a user message.' });
      return;
    }
    if (inFlight >= 4) {
      res.status(429).json({ error: 'AI is busy. Try again shortly.' });
      return;
    }
    inFlight += 1;
    try {
      const response = await providerFetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${options.apiKey}`, 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(30_000),
        body: JSON.stringify({
          model: options.model,
          messages: [{ role: 'system', content: SYSTEM_PROMPT },
            ...req.body.messages.map((m: ChatMessage) => ({ role: m.role, content: m.content }))],
          max_tokens: 500,
          temperature: 0.7,
        }),
      });
      if (!response.ok) {
        // Never relay upstream response bodies: they may contain sensitive diagnostics.
        res.status(response.status === 429 ? 429 : 502).json({
          error: response.status === 429 ? 'AI rate limit reached. Try again later.' : 'AI provider unavailable. Contact the server operator.',
        });
        return;
      }
      const data = await response.json() as { choices?: { message?: { content?: unknown } }[] };
      const content = data?.choices?.[0]?.message?.content;
      if (typeof content !== 'string' || !content.trim()) {
        res.status(502).json({ error: 'AI provider returned an empty response.' });
        return;
      }
      res.json({ content: content.trim() });
    } catch {
      res.status(502).json({ error: 'AI provider could not be reached. Try again later.' });
    } finally {
      inFlight -= 1;
    }
  });
  return router;
}

export default createAiRouter();
