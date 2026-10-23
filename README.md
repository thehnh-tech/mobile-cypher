# Cipher

Cipher is an **open-source mobile messaging app** with a neon interface, encrypted local vaults, encrypted direct-message payloads, and an optional AI assistant. It is built with React Native and Expo, backed by an Express API and MongoDB.

The project is available under the [MIT License](LICENSE). You can use, modify, self-host, and redistribute the code, including commercially, subject to the license notice. Contributions are welcome.

**Status: experimental.** Cipher uses a custom cryptographic protocol and has not undergone an independent security audit. It is a learning and development project, not a reviewed replacement for a mature secure messenger. Read the [security model and limitations](#security-and-privacy) before using it with sensitive information.

## What the app does

- **Accounts and profiles:** create an account with a username and unique `@tag`; customize a display name, bio, and avatar color.
- **Direct conversations:** find someone by tag, send a message request, accept or decline requests, and exchange messages across devices through the backend.
- **Message interactions:** reply to messages and toggle likes in network conversations. Editing and deleting are currently available for your own local assistant messages, not network direct messages.
- **Updates:** conversation messages use HTTP long polling; the app refreshes requests and conversation summaries while in the foreground.
- **Encrypted vault:** profile settings, contacts, assistant history, and private messaging keys are encrypted on the device before the vault is cached locally or uploaded.
- **App lock:** a PIN or device biometric prompt gates the app; it locks again after an extended period in the background. Failed PIN attempts trigger increasing delays, with attempt state persisted securely on native devices.
- **Optional Cipher AI:** chat with a model hosted by **Groq**, through your own backend. This is Groq Cloud, not xAI's Grok. The backend operator configures the API credential.
- **Notifications:** Expo push integration sends generic new-message or request alerts on appropriately configured native builds.
- **Appearance and tools:** Cyan, Magenta, Amber, and Lime themes; standalone text encryption and authenticated image encryption using a lossless PNG carrier.

Group/channel types exist in the source, but network group chat and channels are not implemented. There is no account recovery or password-reset flow.

## Architecture

```text
React Native / Expo app
  ├─ encrypted vault cache + platform-protected native session storage
  ├─ local vault and message encryption/decryption
  └─ HTTP API, authenticated with a bearer token
         │
         ▼
Node.js / Express backend
  ├─ MongoDB: accounts, encrypted vaults, conversations, requests, messages
  ├─ Expo Push Service: generic alerts and routing metadata
  └─ Groq API: optional AI messages in plaintext over HTTPS
```

| Area | Implementation |
| --- | --- |
| Mobile | Expo SDK **54**, React Native 0.81, React 19, TypeScript |
| Navigation and UI | React Navigation, Space Grotesk, JetBrains Mono |
| Cryptography | `@noble/ciphers`, `@noble/hashes`, `@noble/curves` |
| Local persistence | AsyncStorage for encrypted vault cache; Expo SecureStore for native sessions |
| Backend | Express, Mongoose, MongoDB, JWT |
| Message delivery | REST endpoints, long polling, foreground summary polling |
| AI | Backend proxy to Groq; default model `llama-3.3-70b-versatile` |

Expo SDK 54 is intentional. Keep the installed Expo Go or development build compatible with this SDK; do not resolve dependency warnings by upgrading the SDK without reviewing native compatibility.

### Repository map

```text
App.tsx                     App entry point and required polyfills
src/
  api.ts                    Backend HTTP client
  aiClient.ts               Assistant client using the backend proxy
  crypto.ts                 Vault/message crypto and standalone tools
  db.ts                     Account, encrypted vault, and session persistence
  context/AppContext.tsx    App state, sync, app lock, and notifications
  screens/                  Authentication, chats, requests, profile, tools
  pushNotifications.ts      Device registration and notification navigation
backend/
  src/index.ts              API startup and middleware
  src/config.ts             Server-only environment configuration
  src/routes/               Authentication, messaging, vault, push, AI
  src/models/               MongoDB schemas
  src/events.ts             In-process long-poll notifications
  .env.example              Backend configuration template
```

## Run locally

You need Git, Node.js **22.13 or later**, npm, and a reachable MongoDB instance. Use a physical Android/iOS device with an SDK-compatible Expo client, or a configured emulator/simulator. The iOS simulator requires macOS. Use a dedicated test database and test accounts.

### 1. Get the code and install the mobile dependencies

```sh
git clone https://github.com/thehnh-tech/mobile-cypher.git
cd mobile-cypher
npm ci
```

### 2. Configure and start the backend

Copy `backend/.env.example` to `backend/.env`. For a local MongoDB instance, use `mongodb://127.0.0.1:27017/cipher`. Set a unique random `JWT_SECRET`; never use the example placeholder. Generate a secret locally with:

```sh
node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"
```

Keep the result in your private environment configuration. If you want the optional assistant, set a **new** `GROQ_API_KEY` in `backend/.env`. Leave it unset to keep the assistant unavailable while using the rest of the app.

```sh
cd backend
npm ci
npm run dev
```

The backend must connect to MongoDB before it starts listening. Check `http://localhost:3000/health` from the development computer.

### 3. Connect the mobile app

In another terminal at the repository root, copy `.env.example` to `.env`. Set `EXPO_PUBLIC_API_URL` to the backend address reachable by the device:

```dotenv
EXPO_PUBLIC_API_URL=http://192.168.1.10:3000
```

Replace the example with your computer's actual LAN address. A phone's `localhost` refers to the phone, not your development computer. Keep the phone and computer on the same network and allow the development port through the local firewall. An Android emulator normally reaches its host via `10.0.2.2`; other environments may differ.

```sh
npm start
```

Restart Expo after changing the environment file. Create two test accounts on separate devices to try the request/accept/message flow. Use HTTP only for local development on a trusted network; deployments must use HTTPS.

### Configuration reference

| Variable | Where | Purpose |
| --- | --- | --- |
| `EXPO_PUBLIC_API_URL` | Root `.env` / mobile build | Public backend URL; bundled into the app |
| `MONGODB_URI` | Backend only | MongoDB connection string |
| `JWT_SECRET` | Backend only | Random signing secret; rotate after a compromise |
| `JWT_EXPIRES_IN` | Backend only | Token lifetime; see the backend template |
| `PORT` | Backend only | Listening port, default `3000` |
| `NODE_ENV` | Backend only | Set to `production` for a deployment |
| `GROQ_API_KEY` | Backend only, optional | Credential for the Groq assistant |
| `GROQ_MODEL` | Backend only, optional | Groq model; default `llama-3.3-70b-versatile` |
| `CORS_ORIGINS` | Backend only, optional | Comma-separated allowed browser origins in production; native apps do not require CORS |

Everything named `EXPO_PUBLIC_*` is public application configuration. Never place an API key, database URI, or JWT signing secret there or in app source. Local environment files must stay out of Git.

Remote notifications require a physical device, notification permission, an Expo project configuration, and a compatible native development or release build. Do not rely on Expo Go to validate remote push. See [DEPLOIEMENT.md](DEPLOIEMENT.md) for deployment and migration notes.

## Security and privacy

### Authentication and storage

The client derives a separate authentication credential from the password; the server verifies a scrypt hash before issuing a versioned JWT. The vault-encryption key is not the authentication credential. Native sessions use Expo SecureStore; browser sessions remain in memory and require login after a reload. The app removes legacy plaintext session data rather than trusting it.

**Upgrade note:** old username-only login tokens are rejected. Legacy accounts without a stored authentication credential cannot log in through the new API. There is no automatic enrollment or recovery path: preserve database backups and plan a trusted migration before upgrading an existing deployment. See [DEPLOIEMENT.md](DEPLOIEMENT.md).

### What is encrypted

The mobile app derives a 256-bit vault key from the password and a random salt using PBKDF2-HMAC-SHA-256 with 100,000 iterations. It encrypts the vault with AES-GCM before upload and caching. A strong, unique password matters: possession of the encrypted vault and account verifier permits offline password guessing.

For direct messages, the client creates an AES-GCM content key and wraps it separately for each recipient using ephemeral secp256k1 ECDH and a SHA-256-derived wrapping key. The messaging backend stores those encrypted payloads. The private recipient key is inside the encrypted vault.

These primitives do not by themselves establish a complete secure messaging protocol. There is no independently reviewed key-authentication scheme, sender-signature protocol, key transparency, or Double Ratchet. New accounts display a fingerprint derived from their public key; older records may use a different derivation. The app does not automatically verify peer fingerprints or enforce key-change warnings. Server-provided recipient keys must be trusted, and compromise of a long-term recipient key can expose recorded messages. Legacy payloads may predate encryption.

### What remains visible

The backend stores account and routing metadata including usernames, display names, tags, public keys, conversation membership, timestamps, likes, and push tokens. Hashing a tag does not make the account anonymous. Hosting infrastructure also handles network and access logs.

**AI conversations have a different privacy boundary.** After consent in the assistant chat, relevant conversation text is sent to the Cipher backend and then to Groq for inference. Both process plaintext; AI chats are not end-to-end encrypted against either service. Local assistant history is stored in the encrypted vault, but that does not prevent processing or retention by infrastructure and the AI provider. Do not make blanket “no third party can read messages” or “zero retention” claims.

Push notifications use generic text rather than message bodies. Expo and platform push services still handle device tokens and notification routing data.

### Remaining limitations

- The PIN/biometric screen is an app-access gate. The decrypted vault is already in memory; it is not a separate encryption boundary against a compromised device.
- Standalone tools hash their supplied key directly. New encryption requires at least 16 characters, but length alone does not ensure entropy; prefer generated keys and keep them separate from ciphertext. Old text ciphertext can still be decrypted with its original shorter key.
- The image tool now uses a versioned AES-GCM PNG carrier with a fresh random nonce and authenticated metadata. Share the original PNG without resizing or JPEG conversion. Old unauthenticated image-scrambling outputs are rejected; there is no automatic migration. The app can resize the source image before encrypting, and decrypted/exported images and clipboard contents can remain outside the vault. This custom format has not been independently audited.
- There is no password recovery, multi-device conflict resolution, or comprehensive account/data-deletion workflow. Keep independent backups before experimenting with vault or key changes.
- Long-poll notifications and request limits held in server memory need additional coordination when running multiple backend instances.
- Automated checks do not replace a mobile-device test, deployment review, or cryptographic audit.

Read [SECURITY.md](SECURITY.md) for vulnerability reporting, exposed-credential response, and known boundaries.

## Development and contributing

From the repository root:

```sh
npm run type-check
npm test
npm run check:secrets
npx expo install --check
```

From `backend/`:

```sh
npm ci
npm run type-check
npm test
npm audit --omit=dev
```

The root tests cover extracted client security logic; the backend test command builds the TypeScript server and runs security regression tests. Provider requests are mocked in tests. The secret check detects a limited set of credential signatures in current files. Remaining mobile dependency advisories are documented in [SECURITY.md](SECURITY.md#dependency-audit-snapshot). Manually test changed device features too. [CONTRIBUTING.md](CONTRIBUTING.md) describes the CI checks, compatibility requirements, and smoke tests. [CLAUDE.md](CLAUDE.md) gives source-level guidance for coding assistants and maintainers.

## Open source

Cipher is licensed under [MIT](LICENSE), with no warranty. The license covers this repository's code; dependencies, fonts, hosted services, and third-party APIs retain their own licenses and terms. Open an issue for bugs or ideas, or submit a pull request. Report sensitive security issues using [SECURITY.md](SECURITY.md), without posting credentials or private user data.
