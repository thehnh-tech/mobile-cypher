import React, {
  createContext, useContext, useState, useEffect, useCallback, useRef,
} from 'react';
import { AppState as RNAppState, AppStateStatus } from 'react-native';
import { Vault } from '../db';
import * as DB from '../db';
import { THEMES, Theme, ThemeName } from '../theme';
import { api, ServerRequest, ServerConversation } from '../api';
import { randomId } from '../crypto';
import { ToastHost, ToastItem } from '../components/Toast';
import { registerForPushNotificationsAsync } from '../pushNotifications';

interface AppState {
  isLoading: boolean;
  isAuthenticated: boolean;
  userId: string | null;
  key: Uint8Array | null;
  token: string | null;
  vault: Vault | null;
  theme: Theme;
}

interface ServerState {
  requests: ServerRequest[];
  conversations: ServerConversation[];
  lastSync: string | null;
}

interface AppContextValue extends AppState {
  login: (username: string, password: string) => Promise<void>;
  signup: (username: string, password: string, displayName: string, tag: string) => Promise<void>;
  logout: () => Promise<void>;
  updateVault: (vault: Vault) => Promise<void>;
  setTheme: (name: ThemeName) => void;
  // Server messaging surface
  serverRequests: ServerRequest[];
  serverConversations: ServerConversation[];
  refreshSync: () => Promise<void>;
  pushToast: (text: string, kind?: ToastItem['kind']) => void;
  toasts: ToastItem[];
  // App lock surface
  isLocked: boolean;
  unlock: () => void;
  lockNow: () => void;
}

const AppContext = createContext<AppContextValue | null>(null);

const SYNC_INTERVAL_MS = 5000;
const TOAST_DURATION_MS = 3500;
const RELOCK_AFTER_BACKGROUND_MS = 60_000; // re-lock after >60s in background

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AppState>({
    isLoading: true,
    isAuthenticated: false,
    userId: null,
    key: null,
    token: null,
    vault: null,
    theme: THEMES.cyan,
  });

  const [server, setServer] = useState<ServerState>({
    requests: [],
    conversations: [],
    lastSync: null,
  });

  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [isLocked, setIsLocked] = useState(true);
  const backgroundedAtRef = useRef<number | null>(null);

  const unlock = useCallback(() => setIsLocked(false), []);
  const lockNow = useCallback(() => setIsLocked(true), []);

  const tokenRef = useRef<string | null>(null);
  const lastSyncRef = useRef<string | null>(null);
  const isFirstSyncRef = useRef(true);
  const expoPushTokenRef = useRef<string | null>(null);
  tokenRef.current = state.token;
  lastSyncRef.current = server.lastSync;

  const registerPush = useCallback(async (apiToken: string) => {
    try {
      const expoToken = await registerForPushNotificationsAsync();
      if (!expoToken) return;
      expoPushTokenRef.current = expoToken;
      await api.registerPushToken(apiToken, expoToken);
    } catch (e: any) {
      console.warn('[push] register failed:', e?.message ?? e);
    }
  }, []);

  useEffect(() => {
    DB.loadSession()
      .then((session) => {
        if (session) {
          const themeName = (session.vault.settings?.theme as ThemeName) ?? 'cyan';
          setState({
            isLoading: false,
            isAuthenticated: true,
            userId: session.userId,
            key: session.key,
            token: session.token,
            vault: session.vault,
            theme: THEMES[themeName] ?? THEMES.cyan,
          });
          void registerPush(session.token);
        } else {
          setState((s) => ({ ...s, isLoading: false }));
        }
      })
      .catch(() => setState((s) => ({ ...s, isLoading: false })));
  }, [registerPush]);

  const pushToast = useCallback((text: string, kind: ToastItem['kind'] = 'info') => {
    const id = randomId();
    setToasts((prev) => [...prev, { id, text, kind }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, TOAST_DURATION_MS);
  }, []);

  const doSync = useCallback(async () => {
    const token = tokenRef.current;
    if (!token) return;
    try {
      const since = lastSyncRef.current ?? undefined;
      const resp = await api.sync(token, since);

      // In-app toast: only for new requests. New-message popups belong to
      // OS push notifications (when the app is closed) — not in-app.
      if (!isFirstSyncRef.current && resp.newRequestsSince > 0) {
        pushToast('You received a new request', 'request');
      }
      isFirstSyncRef.current = false;

      setServer({
        requests: resp.requests,
        conversations: resp.conversations,
        lastSync: resp.serverTime,
      });
    } catch {
      // Network blip — silent. Next tick will retry.
    }
  }, [pushToast]);

  // Polling: every SYNC_INTERVAL_MS when authenticated and app is foregrounded.
  useEffect(() => {
    if (!state.isAuthenticated || !state.token) {
      isFirstSyncRef.current = true;
      lastSyncRef.current = null;
      setServer({ requests: [], conversations: [], lastSync: null });
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (timer) return;
      void doSync();
      timer = setInterval(() => {
        if (!cancelled) void doSync();
      }, SYNC_INTERVAL_MS);
    };
    const stop = () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    };

    if (RNAppState.currentState === 'active') start();

    const sub = RNAppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'active') {
        // If we were backgrounded long enough, re-engage the lock.
        const bg = backgroundedAtRef.current;
        if (bg !== null && Date.now() - bg > RELOCK_AFTER_BACKGROUND_MS) {
          setIsLocked(true);
        }
        backgroundedAtRef.current = null;
        start();
      } else {
        if (backgroundedAtRef.current === null) {
          backgroundedAtRef.current = Date.now();
        }
        stop();
      }
    });

    return () => {
      cancelled = true;
      stop();
      sub.remove();
    };
  }, [state.isAuthenticated, state.token, doSync]);

  const login = useCallback(async (username: string, password: string) => {
    const { user, key, vault, token } = await DB.login({ username, password });
    await DB.persistSession(user.id, key, token);
    const themeName = (vault.settings?.theme as ThemeName) ?? 'cyan';
    isFirstSyncRef.current = true;
    setState({
      isLoading: false,
      isAuthenticated: true,
      userId: user.id,
      key,
      token,
      vault,
      theme: THEMES[themeName] ?? THEMES.cyan,
    });
    // Just typed the password — that's enough auth for this session.
    setIsLocked(false);
    void registerPush(token);
  }, [registerPush]);

  const signup = useCallback(
    async (username: string, password: string, displayName: string, tag: string) => {
      const { user, key, vault, token } = await DB.signup({ username, password, displayName, tag });
      await DB.persistSession(user.id, key, token);
      isFirstSyncRef.current = true;
      setState({
        isLoading: false,
        isAuthenticated: true,
        userId: user.id,
        key,
        token,
        vault,
        theme: THEMES.cyan,
      });
      // Fresh signup — vault has no appLock yet, RootNavigator will route to
      // PinSetupScreen automatically. We auto-unlock so the post-PIN-setup
      // state lands directly on the main app.
      setIsLocked(false);
      void registerPush(token);
    },
    [registerPush],
  );

  const logout = useCallback(async () => {
    const apiToken = tokenRef.current;
    const expoToken = expoPushTokenRef.current;
    if (apiToken && expoToken) {
      try {
        await api.unregisterPushToken(apiToken, expoToken);
      } catch (e: any) {
        console.warn('[push] unregister failed:', e?.message ?? e);
      }
    }
    expoPushTokenRef.current = null;
    await DB.clearSession();
    setState({
      isLoading: false,
      isAuthenticated: false,
      userId: null,
      key: null,
      token: null,
      vault: null,
      theme: THEMES.cyan,
    });
    setIsLocked(true);
  }, []);

  const updateVault = useCallback(
    async (vault: Vault) => {
      if (!state.userId || !state.key || !state.token) return;
      await DB.saveVault(state.userId, vault, state.key, state.token);
      const themeName = (vault.settings?.theme as ThemeName) ?? 'cyan';
      setState((s) => ({ ...s, vault, theme: THEMES[themeName] ?? s.theme }));
    },
    [state.userId, state.key, state.token],
  );

  const setTheme = useCallback((name: ThemeName) => {
    setState((s) => ({ ...s, theme: THEMES[name] }));
  }, []);

  return (
    <AppContext.Provider
      value={{
        ...state,
        login,
        signup,
        logout,
        updateVault,
        setTheme,
        serverRequests: server.requests,
        serverConversations: server.conversations,
        refreshSync: doSync,
        pushToast,
        toasts,
        isLocked,
        unlock,
        lockNow,
      }}
    >
      {children}
      <ToastHost toasts={toasts} theme={state.theme} />
    </AppContext.Provider>
  );
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
