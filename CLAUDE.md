# CLAUDE.md

Guidance for coding assistants and maintainers working on Cipher. Read [README.md](README.md) and [SECURITY.md](SECURITY.md) before changing authentication, encryption, or data flows.

## Commands

From the repository root:

```sh
npm ci
npm start
npm run type-check
npm test
npm run check:secrets
npx expo install --check
npx expo start --clear
```

From `backend/`:

```sh
npm ci
npm run dev
npm run type-check
npm test
npm audit --omit=dev
npm run build
npm start
```

Root tests exercise extracted client security logic; backend tests compile TypeScript and run security regressions with Node's test runner. Provider requests are mocked. Native behavior still needs device testing. Keep dependency manifests and lockfiles synchronized; do not use peer-dependency bypass flags as a routine substitute for compatible versions.

CI is defined in `.github/workflows/checks.yml`. The current-file secret-signature check does not cover all credential formats or Git history. Review the outstanding mobile dependency audit findings in `SECURITY.md`; do not claim they are all fixed or force a framework upgrade to clear them.

## SDK pinning

The project is pinned to **Expo SDK 54** for its existing mobile environment. Do not bump to SDK 55 or later as incidental maintenance. For native dependencies use `npx expo install <package>` and check compatibility with the current SDK. A native dependency change can require rebuilding the development client.

## Architecture

This is a networked mobile app with an **Express + MongoDB backend**, not a local-only demo.

- `src/crypto.ts`: pure vault/message crypto helpers, PIN hashing, and standalone text/image tools. Vaults use PBKDF2-HMAC-SHA-256 at 100,000 iterations and AES-GCM. Direct-message payloads use a custom secp256k1 ECDH/AES-GCM construction.
- `src/api.ts`: HTTP API boundary and shared response types. Production URLs must use HTTPS. The public mobile URL is configured by `EXPO_PUBLIC_API_URL`.
- `src/db.ts`: signup/login, encrypted vault serialization, local ciphertext cache, and session persistence. Native session secrets use SecureStore; web sessions are memory-only. Legacy plaintext session material is removed.
- `src/context/AppContext.tsx`: runtime vault, key, token, theme, sync, and app-lock state. Screens persist vault mutations through `updateVault` instead of writing storage directly.
- `src/navigation/index.tsx`: authentication stack, first-run lock setup, lock screen, and main stack. The app-lock screen is a UI gate after vault decryption.
- `src/screens/ChatScreen.tsx`: network messages and local assistant conversation. Network messages use long polling; the assistant calls the backend after consent.
- `src/aiClient.ts`: no provider key or direct provider request. Uses authenticated `POST /ai/chat` via the application backend.
- `backend/src/routes/`: authentication, encrypted vault storage, user lookup, requests, conversations, sync, push registration, and AI proxy.
- `backend/src/events.ts`: in-process events used to wake long polls. This is not a distributed message broker.
- `src/pushNotifications.ts` and `backend/src/push.ts`: Expo push registration/delivery with generic notification text and routing metadata.

Conversation summaries and requests refresh in the foreground; open conversations use HTTP long polling, not WebSockets. Native push requires its own working build/project configuration.

## Authentication and persistent data

A domain-separated password-derived authentication credential is distinct from the vault key. The backend stores a scrypt hash of that credential and must verify it before issuing a JWT. `/auth/parameters` exposes derivation parameters, not a token. Authentication-version checks reject old tokens that were issued by the insecure username-only flow.

Legacy accounts without an authentication credential fail closed. Do not invent a migration that enrolls a new credential based only on a username or old JWT. Preserve encrypted vaults and backups; recovery needs a separately reviewed proof of account ownership.

The encrypted vault holds the private messaging key and assistant history. Public account metadata, public keys, membership, reactions, and timestamps exist separately on the backend. Do not describe all server data as opaque ciphertext.

Changes to vault formats, keys, account credentials, or token claims require a migration plan and regression tests. Never regenerate a private key or discard an undecryptable vault to make an error disappear.

## Privacy and secret handling

- Groq is the optional provider; it is not Grok/xAI or an Anthropic/Claude integration.
- `GROQ_API_KEY` belongs only in backend secrets. The app must never accept, persist, or embed provider credentials.
- AI conversation content is processed in plaintext by the backend and Groq. Keep the consent and privacy notice accurate. Never claim universal end-to-end encryption or provider zero retention.
- No real secrets in example files, fixtures, logs, issue text, or commits. Do not reproduce previously leaked values while documenting an incident.
- Removal from current source does not revoke a leaked credential or remove Git history. Refer operators to `SECURITY.md`.

## Crypto limitations to preserve in documentation

Do not equate strong primitives with a reviewed protocol. There is no authenticated key directory, key-change verification, cryptographic sender-signature protocol, or ratchet. New account fingerprints derive from public keys, but older records may use the previous account-value derivation; displayed peer fingerprints are not automatically trusted or verified. The image tool uses a versioned AES-GCM PNG carrier with random nonces and authenticated metadata; old unauthenticated CTR images are rejected. Never resize, convert to JPEG, or normalize encrypted carrier pixels before decryption. New standalone encryption requires at least 16-character keys; preserve old text decryption compatibility. Protocol changes require migration and tests, not stronger marketing claims.

## Theme system

`src/theme.ts` exports Cyan, Magenta, Amber, and Lime themes. The setting lives in the encrypted vault and is applied through `AppContext`. Components receive the theme or read it through `useApp()`.

## React Native input behavior

The shared `Input` component handles Android focus and keyboard quirks. Preserve its tested patterns:

1. Avoid `height: '100%'` on `TextInput` within a fixed-height parent; use wrapper padding and explicit input padding.
2. Keep the input ref and wrapper focus behavior when composing touchable input rows.
3. Use `KeyboardAvoidingView` on iOS; Android uses `softwareKeyboardLayoutMode: "pan"` in `app.json`.
4. Keep `underlineColorAndroid="transparent"`, `textAlignVertical="center"`, and suitable keyboard tap handling on scroll views.

## Crypto polyfills

`react-native-get-random-values` must load before code that imports `@noble/*`. Preserve the first import in `App.tsx` and the existing text-decoder compatibility code. Do not replace this with a native crypto package without assessing Expo Go/development-client compatibility.

## Scope and verification

Do not claim support for network groups/channels, network message editing/deletion, password recovery, or account deletion until implemented and tested. Check both mobile and backend TypeScript, run security tests, and manually test affected device flows. No passing test suite establishes complete cryptographic or production security.
