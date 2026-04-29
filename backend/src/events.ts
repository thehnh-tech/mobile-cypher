import { EventEmitter } from 'events';

// In-process pub/sub used by long-polling endpoints to avoid hammering Mongo.
// Single-process only — fine for this app's scale; would need Redis pub/sub
// to fan out across multiple backend instances.
export const messageBus = new EventEmitter();
messageBus.setMaxListeners(200);

export function convChannel(conversationId: string): string {
  return `conv:${conversationId}`;
}
