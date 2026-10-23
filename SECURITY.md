# Security

Cipher is experimental and has not received an independent security audit. The maintainers do not claim that all vulnerabilities have been identified or fixed. Only the current source is the focus of fixes; there is no guaranteed support or response schedule for older revisions.

## Reporting a vulnerability

Use the repository's GitHub **Security → Report a vulnerability** option if private vulnerability reporting is enabled. If it is unavailable, open a minimal issue asking the maintainer for a private reporting channel, without publishing exploit instructions, credentials, or user data. No dedicated security email is currently documented here.

A useful private report includes the affected revision, prerequisites, a minimal reproduction using test accounts, expected and observed behavior, and impact. Redact tokens, passwords, database URIs, and private content. Do not test against accounts or infrastructure you do not control.

## Previously exposed credentials

A Groq API credential was previously embedded in the mobile source. Treat it as compromised even if it is no longer present in the latest files. Removing a string from a new commit does not revoke the credential or remove copies in old commits, forks, caches, or installed builds.

The credential owner must:

1. Revoke the exposed key in their Groq account and review usage/billing for unexpected activity.
2. Create a replacement only if needed and store it as `GROQ_API_KEY` in the backend environment or secret manager.
3. Redeploy the backend and distribute an updated mobile build. Never embed the replacement in an `EXPO_PUBLIC_*` variable or mobile settings.
4. Review other deployment credentials separately. Rotate any exposed database credentials and JWT signing secrets; the latter invalidates tokens signed with the old secret.
5. Coordinate any Git history cleanup with maintainers and contributors after revocation. History rewriting changes commit IDs and requires handling other clones and forks; it is not performed automatically by this code change.

No claim is made here that the old credential has been revoked, that provider-side usage has been reviewed, or that historical copies have been removed.

## Security boundaries

| Component | Boundary and limitations |
| --- | --- |
| Vault | AES-GCM ciphertext is stored in MongoDB and a local cache. PBKDF2 derives the vault key from the password. Weak passwords remain vulnerable to offline guessing. |
| Direct messages | Client-encrypted payloads use a custom ECDH/AES-GCM construction. There is no reviewed key-verification or ratcheting protocol; server key substitution and long-term key compromise are outside its guarantees. |
| Account metadata | Usernames, tags, display names, public keys, membership, timestamps, reactions, and push tokens are visible to the backend. |
| Session and lock | Native sessions use SecureStore; web sessions remain in memory. The app lock still gates UI access after the vault is decrypted in memory; it does not secure a compromised runtime. |
| Assistant | The Cipher backend and Groq process submitted AI conversation text in plaintext. Encrypted local history does not make the external inference request end-to-end encrypted. |
| Notifications | Generic notification content avoids sending message bodies, but delivery services receive tokens and routing metadata. |
| Standalone tools | Supplied keys are directly hashed and need adequate entropy; new encryption requires 16 or more characters. The versioned image format uses AES-GCM with random nonces and authenticated metadata in a lossless PNG carrier. Preserve the original encrypted PNG; old unauthenticated scrambling outputs are rejected. The custom format remains unaudited. |

For new accounts, the client derives the displayed fingerprint from the messaging public key; older records may use the previous account-value derivation. Peer fingerprints are not automatically verified against a trusted channel, and key changes are not enforced. Displaying a server-supplied fingerprint alone does not protect against server key replacement. The application also accepts some legacy data that predates current message encryption.

Native PIN retry state is persisted in SecureStore and introduces delays after repeated failures. This does not turn a short PIN into a strong encryption key or defend against a compromised operating system. Exported/decrypted images, temporary image files, and copied clipboard text can exist outside the encrypted vault.

## Dependency audit snapshot

On **2026-10-23**, after compatible dependency fixes, `npm audit` reported **0 vulnerabilities in the backend** and **11 in the mobile dependency tree: 6 moderate and 5 high, with no critical findings**. Remaining findings include indirect Expo SDK 54/navigation dependencies such as `decode-uri-component`, `image-size`, and `node-forge`. These are unresolved findings, not a claim that every affected dependency is reachable in every deployed app.

Audit results depend on the lockfile and advisory database and can change. Re-run `npm audit` in both package directories when updating dependencies; inspect each dependency path and its runtime/build impact. Keep the SDK 54 compatibility requirement and plan any necessary framework upgrade explicitly instead of applying a forced upgrade solely to clear the report.

CI runs the backend production-dependency audit with `npm audit --omit=dev`; it does not currently enforce a clean mobile audit. `npm run check:secrets` is a limited signature check of current tracked/unignored files, not a comprehensive secret scan or a scan of Git history. Neither a passing CI run nor a zero-vulnerability audit establishes complete application security.

## Deployment responsibilities

- Use HTTPS for client/backend traffic and protect the database connection and backups.
- Keep provider credentials and signing keys on the server. Restrict deployment and database access to the people and processes that need it.
- Use a fresh JWT signing secret when upgrading from the old username-only login implementation. The new API rejects old token versions and legacy accounts lacking an authentication credential. Preserve backups and coordinate client/server migration using [DEPLOIEMENT.md](DEPLOIEMENT.md).
- Restrict request volume at the hosting boundary. In-memory limits do not provide a global quota across multiple server instances and reset on restart.
- Avoid logging authorization headers, AI request/response bodies, passwords, private vault contents, or provider keys. Review hosting, proxy, and AI-provider retention settings.
- Establish retention, account deletion, backups, restoration, and abuse-handling procedures before hosting other people's data. These are not fully implemented product workflows.
- Test on real devices. Passing TypeScript or regression checks does not verify biometric behavior, native storage, push delivery, all network errors, or cryptographic security.

See the [README](README.md#security-and-privacy) for the user-facing explanation and [CONTRIBUTING.md](CONTRIBUTING.md) for safe contribution practices.
