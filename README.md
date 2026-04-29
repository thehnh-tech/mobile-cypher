# Cipher — Encrypted Chat App

Cyberpunk-neon encrypted chat app built with Expo / React Native.

## Run

```bash
npm install
npx expo start
```

Scan the QR code with **Expo Go** (iOS/Android), or press `i` for iOS simulator / `a` for Android.

## Features

- **AES-256-GCM encryption** — all messages encrypted at rest (PBKDF2 key derivation, 100k iterations)
- **Encrypted local storage** — vault stored in AsyncStorage, encrypted with your password-derived key
- **Auth** — signup with username + unique @tag, login, session persistence
- **Chat** — 1-on-1 DMs, edit & delete messages (long-press), typing to Claude AI bot
- **Profile** — editable display name, bio, avatar color, 4 neon themes (cyan/magenta/amber/lime)
- **Friends** — find users by @tag, view key fingerprint before adding

## Tech

| Layer | Library |
|-------|---------|
| Framework | Expo 52 / React Native 0.76 |
| Crypto | `@noble/ciphers` (AES-GCM) + `@noble/hashes` (PBKDF2/SHA-256) |
| Storage | `@react-native-async-storage/async-storage` |
| Navigation | `@react-navigation/stack` |
| Fonts | Space Grotesk + JetBrains Mono (via `@expo-google-fonts`) |

## Themes

Switch themes from the Profile screen: **Cyan** · **Magenta** · **Amber** · **Lime**
