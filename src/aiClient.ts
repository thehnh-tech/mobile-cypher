// AI requests go through the authenticated backend. Provider secrets never belong here.
import type { Message } from './db';
import { api, ApiError } from './api';

export interface AIError {
  kind: 'auth' | 'rate' | 'network' | 'input' | 'unknown';
  message: string;
}

export function buildAIHistory(messages: Message[], currentUserId: string, aiContactId: string) {
  const eligible = messages.filter((m) => !m.deleted && m.text.trim()
    && (m.from === currentUserId || m.from === aiContactId));
  const newest = eligible[eligible.length - 1];
  if (!newest || newest.from !== currentUserId) {
    throw <AIError>{ kind: 'input', message: 'Add a user message before asking the AI.' };
  }
  if (newest.text.length > 4000) {
    throw <AIError>{ kind: 'input', message: 'Your message exceeds 4000 characters. Shorten it before sending; it has not been sent to the AI.' };
  }
  const history: { role: 'user' | 'assistant'; content: string }[] = [];
  let total = 0;
  // Keep a contiguous recent suffix of complete messages. Never silently
  // shorten the current question or send an excerpt as if it were complete.
  for (let i = eligible.length - 1; i >= 0 && history.length < 20; i--) {
    const message = eligible[i];
    if (message.text.length > 4000 || total + message.text.length > 20_000) break;
    history.unshift({ role: message.from === currentUserId ? 'user' : 'assistant', content: message.text });
    total += message.text.length;
  }
  const omittedCount = eligible.length - history.length;
  return {
    history,
    omittedCount,
    notice: omittedCount > 0
      ? `This AI request includes only the ${history.length} most recent messages. ${omittedCount} older messages were omitted to fit its context limits.`
      : null,
  };
}

export async function getAIReply(
  messages: Message[],
  currentUserId: string,
  aiContactId: string,
  token: string,
  onHistoryNotice?: (notice: string) => void,
): Promise<string> {
  const { history, notice } = buildAIHistory(messages, currentUserId, aiContactId);
  if (notice) onHistoryNotice?.(notice);

  try {
    const { content } = await api.aiChat(token, history);
    return content;
  } catch (e) {
    if (e instanceof ApiError) {
      throw <AIError>{
        kind: e.status === 401 ? 'auth' : e.status === 429 ? 'rate' : 'unknown',
        message: e.message,
      };
    }
    throw <AIError>{ kind: 'network', message: 'Could not reach the AI service. Try again.' };
  }
}

export function isAIError(e: unknown): e is AIError {
  return typeof e === 'object' && e !== null && 'kind' in e && 'message' in e;
}
