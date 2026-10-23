export interface PinAttemptState {
  attempts: number;
  blockedUntil: number;
}

interface AttemptStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export const MAX_PIN_ATTEMPTS = 5;

export function createPinAttemptStore(storage: AttemptStorage) {
  function storageKey(userId: string): string {
    if (!/^[a-f0-9]{24}$/i.test(userId)) throw new Error('Invalid PIN lock account');
    return `CIPHER_PIN_ATTEMPTS_${userId}`;
  }

  async function read(userId: string): Promise<PinAttemptState> {
    const raw = await storage.getItem(storageKey(userId));
    if (raw === null) return { attempts: 0, blockedUntil: 0 };
    const state = JSON.parse(raw) as PinAttemptState;
    if (!state || !Number.isSafeInteger(state.attempts) || state.attempts < 0 ||
        !Number.isSafeInteger(state.blockedUntil) || state.blockedUntil < 0) {
      throw new Error('Invalid PIN attempt record');
    }
    return state;
  }

  return {
    read,
    async begin(userId: string, now = Date.now()): Promise<PinAttemptState> {
      const previous = await read(userId);
      if (previous.blockedUntil > now) throw new Error('PIN entry is temporarily locked');
      const attempts = Math.min(previous.attempts + 1, 1000);
      const delay = attempts < MAX_PIN_ATTEMPTS ? 0
        : Math.min(15 * 60_000, 60_000 * 2 ** Math.min(4, Math.floor((attempts - MAX_PIN_ATTEMPTS) / 5)));
      const state = { attempts, blockedUntil: delay ? now + delay : 0 };
      // Commit before verifying the PIN, so restarting during a failed
      // attempt cannot reset the budget. A correct PIN clears the record.
      await storage.setItem(storageKey(userId), JSON.stringify(state));
      return state;
    },
    clear(userId: string): Promise<void> {
      return storage.removeItem(storageKey(userId));
    },
  };
}
