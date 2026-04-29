// Expo Push integration.
//
// IMPORTANT: Remote push notifications no longer work in Expo Go since SDK 53.
// To actually receive pushes, the app must be installed via an EAS dev build
// (`eas build --profile development --platform <android|ios>`) which replaces
// Expo Go for this app on the device. See the project README / handoff notes
// for the full procedure.
//
// Local-notification APIs (scheduleNotificationAsync) still work in Expo Go,
// but local notifications cannot fire when the app is closed — only a real
// remote push via Expo Push Service (FCM/APNs) covers that.

import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';

export type PushTapData =
  | { kind: 'message'; conversationId: string }
  | { kind: 'request'; requestId?: string };

// SDK 54 (expo-notifications 0.32): shouldShowBanner / shouldShowList replaced
// the old shouldShowAlert flag. While the app is foregrounded we suppress the
// banner — long-polling already pulls in new messages live, and requests
// surface as in-app toasts. When the app is background or closed, the OS
// shows the notification on its own (handleNotification is not called).
const FOREGROUND_HANDLER: Notifications.NotificationBehavior = {
  shouldShowBanner: false,
  shouldShowList: false,
  shouldPlaySound: false,
  shouldSetBadge: true,
};

Notifications.setNotificationHandler({
  handleNotification: async () => FOREGROUND_HANDLER,
});

function resolveProjectId(): string | undefined {
  const fromExpoConfig =
    (Constants.expoConfig as any)?.extra?.eas?.projectId ??
    (Constants as any).easConfig?.projectId;
  return typeof fromExpoConfig === 'string' && fromExpoConfig.length > 0
    ? fromExpoConfig
    : undefined;
}

/**
 * Requests permission and returns an Expo push token, or null if:
 *  - we're on a simulator (no remote push possible),
 *  - the user denied permission,
 *  - the runtime is Expo Go on SDK 53+ (silently returns null after warning).
 */
export async function registerForPushNotificationsAsync(): Promise<string | null> {
  if (!Device.isDevice) {
    console.log('[push] skipping registration: not a physical device');
    return null;
  }

  // Android 13+ needs an explicit notification channel before scheduling.
  if (Platform.OS === 'android') {
    try {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'default',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#22d3ee',
      });
    } catch (e: any) {
      console.warn('[push] setNotificationChannelAsync failed:', e?.message ?? e);
    }
  }

  const existing = await Notifications.getPermissionsAsync();
  let status = existing.status;
  if (status !== 'granted') {
    const ask = await Notifications.requestPermissionsAsync();
    status = ask.status;
  }
  if (status !== 'granted') {
    console.log('[push] permission not granted');
    return null;
  }

  try {
    const projectId = resolveProjectId();
    const tokenResp = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    );
    return tokenResp.data;
  } catch (e: any) {
    // Expo Go on SDK 53+ throws here. Log and move on so signup/login still works.
    console.warn(
      '[push] getExpoPushTokenAsync failed (expected in Expo Go on SDK 53+):',
      e?.message ?? e,
    );
    return null;
  }
}

/**
 * Wires both the tap-while-running listener and the cold-start path.
 * Returns an unsubscribe function for the live listener.
 */
export function setupNotificationHandlers(
  onTap: (data: PushTapData) => void,
): () => void {
  // Cold start: if the app was opened by tapping a notification while closed,
  // the response is available via getLastNotificationResponseAsync().
  Notifications.getLastNotificationResponseAsync()
    .then((response) => {
      if (!response) return;
      const data = response.notification.request.content.data as unknown;
      const parsed = parseTapData(data);
      if (parsed) onTap(parsed);
    })
    .catch((e) => console.warn('[push] getLastNotificationResponseAsync failed:', e?.message ?? e));

  const sub = Notifications.addNotificationResponseReceivedListener((response) => {
    const data = response.notification.request.content.data as unknown;
    const parsed = parseTapData(data);
    if (parsed) onTap(parsed);
  });

  return () => sub.remove();
}

function parseTapData(raw: unknown): PushTapData | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  if (obj.kind === 'message' && typeof obj.conversationId === 'string') {
    return { kind: 'message', conversationId: obj.conversationId };
  }
  if (obj.kind === 'request') {
    return {
      kind: 'request',
      requestId: typeof obj.requestId === 'string' ? obj.requestId : undefined,
    };
  }
  return null;
}
