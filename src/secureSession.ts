import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { createSessionStorage } from './sessionStorage';

export const secureSession = createSessionStorage({
  web: Platform.OS === 'web',
  legacy: AsyncStorage,
  secure: {
    getItem: (key) => SecureStore.getItemAsync(key),
    setItem: (key, value) => SecureStore.setItemAsync(key, value, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    }),
    removeItem: (key) => SecureStore.deleteItemAsync(key),
  },
});
