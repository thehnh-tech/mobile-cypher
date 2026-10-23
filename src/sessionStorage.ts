export interface SessionData {
  userId: string;
  key: number[];
  token: string;
}

interface StoragePort {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

const SESSION_KEY = 'CIPHER_SECURE_SESSION_V2';
const LEGACY_SESSION_KEY = 'CIPHER_SESSION';

function parseSession(raw: string): SessionData | null {
  try {
    const session = JSON.parse(raw);
    if (!session || typeof session.userId !== 'string'
        || !/^[a-f0-9]{24}$/i.test(session.userId)
        || typeof session.token !== 'string' || session.token.length > 4096
        || !Array.isArray(session.key) || session.key.length !== 32
        || !session.key.every((byte: unknown) => typeof byte === 'number'
          && Number.isInteger(byte) && byte >= 0 && byte <= 255)) return null;
    // This is an expiry/version check, not signature verification. The server
    // verifies the signature before granting any authenticated operation.
    const payloadPart = session.token.split('.')[1];
    const payload = JSON.parse(atob(payloadPart.replace(/-/g, '+').replace(/_/g, '/')));
    if (payload.authVersion !== 2 || typeof payload.exp !== 'number'
        || payload.exp * 1000 <= Date.now() || payload.userId !== session.userId) return null;
    return session;
  } catch {
    return null;
  }
}

// Ports keep native secure storage separate from unencrypted AsyncStorage,
// and make the web policy (memory only, including refresh) explicit/testable.
export function createSessionStorage(ports: {
  web: boolean;
  secure: StoragePort;
  legacy: Pick<StoragePort, 'removeItem'>;
}) {
  let memory: string | null = null;
  async function clear() {
    memory = null;
    await ports.legacy.removeItem(LEGACY_SESSION_KEY);
    if (!ports.web) await ports.secure.removeItem(SESSION_KEY);
  }
  return {
    async set(session: SessionData): Promise<void> {
      await ports.legacy.removeItem(LEGACY_SESSION_KEY);
      const raw = JSON.stringify(session);
      if (!parseSession(raw)) throw new Error('Invalid session');
      if (ports.web) memory = raw;
      else await ports.secure.setItem(SESSION_KEY, raw);
    },
    async get(): Promise<SessionData | null> {
      // Discard legacy plaintext sessions. Never promote an unverified old
      // token/key from AsyncStorage into the new protected session store.
      await ports.legacy.removeItem(LEGACY_SESSION_KEY);
      const raw = ports.web ? memory : await ports.secure.getItem(SESSION_KEY);
      if (!raw) return null;
      const session = parseSession(raw);
      if (!session) await clear();
      return session;
    },
    clear,
  };
}
