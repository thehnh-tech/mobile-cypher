# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Run dev server (then scan QR with Expo Go)
npx expo start

# Type-check (no emit) — run after any TS changes
npx tsc --noEmit

# Install Expo-aware package versions (handles peer-dep alignment)
npx expo install <package>

# Reset Metro cache if bundler misbehaves
npx expo start --clear
```

There is no test suite, no lint script, and no build step beyond Metro bundling.

When `npx expo install` fails on peer-dep conflicts (common with `react-native@0.81.5` requiring `react@19.1.0`), fall back to `npm install --legacy-peer-deps <pkg>` and pin the exact version Metro reports as expected for the SDK.

## SDK pinning

The project is pinned to **Expo SDK 54** to match the user's Expo Go app version (54.0.2). Do **not** bump to SDK 55 or later — Expo Go on the user's phone won't load it. If `npx expo start` shows package version warnings, install the exact versions Metro reports rather than upgrading SDK.

## Architecture

**Single-vault encrypted chat app**, no backend — everything is local AsyncStorage encrypted with a password-derived key. The architecture is shaped by this constraint: there is no server, no socket, no message sync. "Other users" exist only as records in the same device's storage (so two accounts on the same device can chat with each other; that's it).

### Data flow

```
password ──PBKDF2──► AES-GCM key ──► encrypts/decrypts ──► AsyncStorage
                          │
                          └─► held in memory by AppContext for the session
```

- `src/crypto.ts` — pure functions over `@noble/hashes` (PBKDF2, SHA-256) and `@noble/ciphers` (AES-GCM). All bytes ↔ base64 conversions live here. No I/O.
- `src/db.ts` — the only module that touches AsyncStorage. Two key namespaces:
  - `CIPHER_DB_USERS` — public user registry (id, salt, encrypted verifier, tagHash). Unencrypted JSON; safe because the verifier requires the password to decrypt.
  - `CIPHER_VAULT_<userId>` — per-user encrypted blob containing profile + chats + contacts + settings. Decryptable only with that user's PBKDF2-derived key.
  - `CIPHER_SESSION` — `{ userId, key: number[] }`. Lets the app skip re-deriving the key on app reload. **Note:** this stores the raw key in plaintext AsyncStorage; acceptable for a local-only demo, would need keychain/secure-store for production.
- `src/context/AppContext.tsx` — the single source of truth at runtime. Holds `key`, `vault`, `theme`. All mutations go through `updateVault(newVault)` which re-encrypts and persists. **Never write to AsyncStorage directly from screens** — always go through context.
- `src/navigation/index.tsx` — picks Auth stack vs Main stack based on `isAuthenticated`. No deep linking, no auth guards beyond this.

### Theme system

`src/theme.ts` exports four named themes (cyan/magenta/amber/lime). Theme is a vault setting (persisted) and is rebuilt from `vault.settings.theme` on `updateVault`. Components receive `theme` as a prop or pull it from `useApp()`. There is no React context for theme alone — it's part of `AppContext`.

### Crypto round-trip

Verifier check on login: encrypt the literal string `"CIPHER_OK"` at signup, store it; on login, derive key from password+salt, decrypt verifier, check it equals `"CIPHER_OK"`. AES-GCM auth tag means a wrong password fails decryption (caught and rethrown as "Incorrect password").

PBKDF2 iterations are **100k** (vs 150k in the original web prototype) — chosen for mobile JS performance. Don't lower further.

## React Native input gotchas

Several patterns silently break `TextInput` tap-to-focus on Android. The `Input` component in `src/components/Input.tsx` already accounts for these — replicate its pattern when adding new inputs:

1. **Never** use `height: '100%'` on TextInput inside a fixed-height parent — collapses the tap region. Use `paddingVertical` on the wrapper + `padding: 0, margin: 0` on the TextInput.
2. Wrap input rows in `TouchableWithoutFeedback` with a `useRef` calling `inputRef.current?.focus()` — the cursor-only tap target inside a styled View is too small.
3. `KeyboardAvoidingView` should be `enabled={Platform.OS === 'ios'}` only. Android handles keyboard via `softwareKeyboardLayoutMode: "pan"` in `app.json`.
4. Set `underlineColorAndroid="transparent"` and `textAlignVertical="center"` on every TextInput.
5. Use `keyboardShouldPersistTaps="always"` (not `"handled"`) on ScrollView containing inputs.

## Crypto polyfills

`@noble/ciphers` and `@noble/hashes` rely on `crypto.getRandomValues`. **Hermes does NOT provide it** — `react-native-get-random-values` is required and must be the **first import in `App.tsx`** (before anything that pulls in `@noble/*` transitively). Without this, signup/login throw "Property 'crypto' doesn't exist" at runtime.

`TextEncoder`, `TextDecoder`, `btoa`, `atob` ARE available in Hermes — no polyfill needed for those.

Do not replace this with `react-native-quick-crypto` (would require Expo dev build, not Expo Go).

## What's missing (deliberate)

- No real backend / WebSocket / federation — "users" are local records.
- No message sync — adding a friend by `@tag` only finds users on the same device.
- The Claude AI bot uses a hardcoded reply pool in `ChatScreen.tsx` (`AI_REPLIES`); no Anthropic API call.
- No tests, no CI.

If extending toward a real network app, the storage layer (`src/db.ts`) is the seam to replace — keep the `Vault`/`UserRecord` types and add a network adapter behind the same function signatures.
