// Fire-and-forget Expo Push helper.
// Posts to the public Expo Push Service (https://exp.host/--/api/v2/push/send)
// from Node 18+ using the global fetch. Failures are logged but never block
// the HTTP response of the caller.

export type PushKind = 'message' | 'request';

export interface PushPayload {
  to: string;
  title: string;
  body: string;
  data: { kind: PushKind; conversationId?: string; requestId?: string };
}

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

function isExpoToken(t: string): boolean {
  return /^Expo(nent)?PushToken\[.+\]$/.test(t);
}

export function sendExpoPush(messages: PushPayload[]): void {
  const valid = messages.filter((m) => isExpoToken(m.to));
  if (valid.length === 0) return;

  // Fire-and-forget: do not await.
  fetch(EXPO_PUSH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'Accept-Encoding': 'gzip, deflate',
    },
    body: JSON.stringify(valid),
  })
    .then(async (res) => {
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        console.warn('[push] Expo Push API non-2xx:', res.status, text);
        return;
      }
      const json = (await res.json().catch(() => null)) as
        | { data?: Array<{ status: string; message?: string; details?: unknown }> }
        | null;
      const errors = json?.data?.filter((r) => r.status !== 'ok') ?? [];
      if (errors.length > 0) {
        console.warn('[push] Expo Push ticket errors:', errors);
      } else {
        console.log(`[push] sent ${valid.length} notification(s)`);
      }
    })
    .catch((err) => {
      console.warn('[push] Expo Push fetch failed:', err?.message ?? err);
    });
}
