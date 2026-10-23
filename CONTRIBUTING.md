# Contributing to Cipher

Cipher is an experimental open-source project under the [MIT License](LICENSE). Contributions to accessibility, reliability, documentation, testing, and security are welcome.

## Workflow

1. Read the [README](README.md), [security model](SECURITY.md), and [source guidance](CLAUDE.md).
2. Fork the repository, create a focused branch, and set up a local backend and disposable test accounts.
3. Keep changes scoped to one problem. Explain any change to stored data, API contracts, permissions, or privacy behavior.
4. Run the applicable checks and exercise the affected app flow.
5. Submit a pull request describing the problem, resulting behavior, validation, and remaining limitations. Include screenshots for UI changes without exposing private conversations or credentials.

For a substantial protocol or architecture change, open an issue first so the migration and compatibility implications can be discussed. For vulnerabilities, follow [SECURITY.md](SECURITY.md) instead of posting exploit details publicly.

## Compatibility and source conventions

- Keep Expo **SDK 54** unless a deliberate SDK migration is agreed and tested. Use `npx expo install <package>` for Expo/native dependencies and retain lockfile consistency.
- Keep `react-native-get-random-values` loaded before crypto code in `App.tsx`.
- Put backend calls in `src/api.ts` and vault/session storage in `src/db.ts`. Screens should mutate persisted vault state through `AppContext.updateVault`.
- Preserve the authenticated backend boundary for AI. Provider credentials belong only in backend environment configuration.
- Do not invent confidentiality guarantees. Distinguish encrypted direct-message payloads, server metadata, local app locking, and AI processing.
- Treat cryptographic formats as persistent protocols: changes require round-trip tests, corrupted-input tests, and an explicit migration story. Do not silently discard vaults or private keys.

## Checks

From the repository root:

```sh
npm run type-check
npm test
npm run check:secrets
npx expo install --check
```

From `backend/`:

```sh
npm run type-check
npm test
npm audit --omit=dev
```

The root tests cover extracted client security logic; backend tests build the server and run with Node's test runner. Provider calls are mocked. Add focused regression coverage when changing authentication, authorization, input validation, or AI routing. Type checks do not prove runtime correctness.

[GitHub Actions](.github/workflows/checks.yml) runs the mobile type check, tests, secret-signature check, and Expo dependency compatibility check, plus backend tests/build and the production dependency audit. The secret check does not inspect Git history or recognize every credential format. For dependency changes, also run full `npm audit` in both directories and document unresolved findings; the mobile tree has known outstanding advisories recorded in [SECURITY.md](SECURITY.md#dependency-audit-snapshot). Do not force an Expo SDK upgrade to make an audit report pass.

For changes affecting mobile behavior, use two test accounts and check the relevant paths:

- Sign up, log out, and sign in; reject the wrong password.
- Restart the app and verify session restore and PIN/biometric locking.
- Find another tag; send, accept, and decline requests.
- Exchange messages, reply, and toggle likes on both devices.
- Disconnect/reconnect the backend and confirm errors do not silently lose persisted data.
- Confirm the assistant requires consent, handles a disabled backend integration, and never sends a provider key from the device.
- Test notifications on a configured native build and physical device when changing push behavior.

Use only synthetic messages and test credentials. Never commit `.env` files, provider keys, JWTs, database exports, real user vaults, or logs containing private content. Include new configuration names with non-secret examples in the relevant `.env.example`.

By contributing, you agree that your contribution may be distributed under the project's MIT License. Only contribute material you have the right to license.
