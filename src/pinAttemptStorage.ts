import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { createPinAttemptStore } from './pinAttempts';

// Web sessions require the account password after a page reload. Keep their
// counters in memory; native sessions persist counters in protected storage.
const webCounters = new Map<string, string>();
export const pinAttempts = createPinAttemptStore(Platform.OS === 'web' ? {
  getItem: async (key) => webCounters.get(key) ?? null,
  setItem: async (key, value) => { webCounters.set(key, value); },
  removeItem: async (key) => { webCounters.delete(key); },
} : {
  getItem: (key) => SecureStore.getItemAsync(key),
  setItem: (key, value) => SecureStore.setItemAsync(key, value, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  }),
  removeItem: (key) => SecureStore.deleteItemAsync(key),
});
