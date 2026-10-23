import type { Vault, Message } from './db';

export interface VaultSessionIdentity { userId: string; token: string }
export interface WritableVaultSession extends VaultSessionIdentity { key: Uint8Array; vault: Vault }
export type VaultUpdate = Vault | ((latest: Vault) => Vault);

// Existing screens pass a copied vault with one changed section. Retain the
// latest versions of sections they did not change in their rendered snapshot.
export function mergeVaultChanges(latest: Vault, base: Vault, desired: Vault): Vault {
  const next = { ...latest };
  for (const section of ['profile', 'settings', 'chats', 'contacts'] as const) {
    if (desired[section] !== base[section]) {
      Object.assign(next, { [section]: desired[section] });
    }
  }
  return next;
}

export function appendChatMessage(latest: Vault, chatId: string, message: Message): Vault {
  const chat = latest.chats.find((candidate) => candidate.id === chatId);
  if (!chat || chat.messages.some((existing) => existing.id === message.id)) return latest;
  return {
    ...latest,
    chats: latest.chats.map((candidate) => candidate.id === chatId
      ? { ...candidate, messages: [...candidate.messages, message], unread: 0 }
      : candidate),
  };
}

// Each queued update reads the last successfully saved vault. Late asynchronous
// results may only affect the exact account/session that started the action.
export function createVaultUpdater(ports: {
  current: () => WritableVaultSession | null;
  save: (session: WritableVaultSession, vault: Vault) => Promise<void>;
  commit: (vault: Vault) => void;
}) {
  let pending: Promise<unknown> = Promise.resolve();
  return (update: VaultUpdate, expected?: VaultSessionIdentity): Promise<boolean> => {
    const origin = expected ?? ports.current();
    if (!origin) return Promise.resolve(false);
    const identity = { userId: origin.userId, token: origin.token };
    const matches = (session: WritableVaultSession | null) => session
      && session.userId === identity.userId && session.token === identity.token;
    const operation = pending.then(async () => {
      const session = ports.current();
      if (!session || !matches(session)) return false;
      const next = typeof update === 'function' ? update(session.vault) : update;
      if (next.profile.id !== session.userId) return false;
      if (next === session.vault) return true;
      await ports.save(session, next);
      if (!matches(ports.current())) return false;
      ports.commit(next);
      return true;
    });
    // Failed persistence must be reported to its caller without poisoning all
    // subsequent updates in the queue.
    pending = operation.catch(() => undefined);
    return operation;
  };
}
