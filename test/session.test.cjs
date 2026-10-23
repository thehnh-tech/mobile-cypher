const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loadSource(relativePath, imports = {}) {
  const filename = path.resolve(__dirname, '..', relativePath);
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const module = { exports: {} };
  vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename })(
    (name) => name in imports ? imports[name] : require(name), module, module.exports,
  );
  return module.exports;
}

const { createSessionStorage } = loadSource('src/sessionStorage.ts');
const { stripLegacyAIKeys } = loadSource('src/vaultSanitizer.ts');
const userId = 'a'.repeat(24);
function session(payload = {}) {
  const claims = { userId, authVersion: 2, exp: Math.floor(Date.now() / 1000) + 3600, ...payload };
  return { userId, key: Array(32).fill(1), token: `header.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.signature` };
}

function ports(web = false) {
  const protectedData = new Map();
  const plaintext = new Map([['CIPHER_SESSION', 'old-unprotected-secret']]);
  const calls = [];
  return {
    web, protectedData, plaintext, calls,
    secure: {
      getItem: async (key) => { calls.push('secure-read'); return protectedData.get(key) ?? null; },
      setItem: async (key, value) => { calls.push('secure-write'); protectedData.set(key, value); },
      removeItem: async (key) => { calls.push('secure-delete'); protectedData.delete(key); },
    },
    legacy: { removeItem: async (key) => { calls.push('legacy-delete'); plaintext.delete(key); } },
  };
}

test('native sessions are stored in protected storage; legacy plaintext session is discarded', async () => {
  const storage = ports();
  const store = createSessionStorage(storage);
  assert.equal(await store.get(), null);
  assert.equal(storage.plaintext.size, 0);
  const value = session();
  await store.set(value);
  assert.equal(storage.protectedData.size, 1);
  assert.deepEqual(await store.get(), value);
  await store.clear();
  assert.equal(storage.protectedData.size, 0);
});

test('web sessions remain only in memory and a page reload loses them', async () => {
  const storage = ports(true);
  const store = createSessionStorage(storage);
  await store.set(session());
  assert.ok(await store.get());
  assert.equal(storage.protectedData.size, 0);
  assert.equal(storage.calls.some((call) => call.startsWith('secure-')), false);
  assert.equal(await createSessionStorage(storage).get(), null);
  await store.clear();
  assert.equal(await store.get(), null);
});

test('expired, legacy and malformed sessions cannot restore protected secrets', async () => {
  const storage = ports();
  const store = createSessionStorage(storage);
  for (const value of [session({ exp: 1 }), session({ authVersion: 1 }), { ...session(), key: [1] }, null]) {
    storage.protectedData.set('CIPHER_SECURE_SESSION_V2', JSON.stringify(value));
    assert.equal(await store.get(), null);
    assert.equal(storage.protectedData.size, 0);
  }
});

test('secure storage failures never fall back to writing plaintext session data', async () => {
  const storage = ports();
  storage.secure.setItem = async () => { throw new Error('Secure storage unavailable'); };
  await assert.rejects(createSessionStorage(storage).set(session()), /Secure storage unavailable/);
  assert.equal(storage.plaintext.size, 0);
  assert.equal(storage.protectedData.size, 0);
});

test('retired AI keys are removed while all other vault settings survive', () => {
  const vault = { profile: { id: userId }, settings: {
    theme: 'cyan', bubbleStyle: 'solid', appLock: { biometricEnabled: true },
    customSetting: 'keep', aiApiKey: 'old-value', groqApiKey: 'old-value',
  } };
  const cleaned = stripLegacyAIKeys(vault);
  assert.deepEqual(cleaned.settings, {
    theme: 'cyan', bubbleStyle: 'solid', appLock: { biometricEnabled: true }, customSetting: 'keep',
  });
  assert.equal(vault.settings.aiApiKey, 'old-value');
  assert.deepEqual(stripLegacyAIKeys(cleaned), cleaned);
});

test('a server-rejected session cannot fall back to an encrypted local vault', async () => {
  class ApiError extends Error { constructor(status) { super('Rejected'); this.status = status; } }
  const values = new Map([['CIPHER_VAULT_CACHE', 'cached-vault']]);
  let cleared = false;
  let cacheRead = false;
  const db = loadSource('src/db.ts', {
    '@react-native-async-storage/async-storage': {
      getItem: async (key) => { cacheRead = true; return values.get(key); },
      removeItem: async (key) => values.delete(key),
    },
    './crypto': {},
    './api': { ApiError, api: { getVault: async () => { throw new ApiError(401); } } },
    './secureSession': { secureSession: { get: async () => session(), clear: async () => { cleared = true; } } },
    './vaultSanitizer': { stripLegacyAIKeys },
  });
  assert.equal(await db.loadSession(), null);
  assert.equal(cleared, true);
  assert.equal(cacheRead, false);
  assert.equal(values.size, 0);
});

test('network outages can restore only the same user encrypted cache and strip retired keys', async () => {
  class ApiError extends Error {}
  const vault = { profile: { id: userId }, settings: { theme: 'cyan', groqApiKey: 'retired' } };
  const values = new Map([['CIPHER_VAULT_CACHE', JSON.stringify(vault)]]);
  let cleared = false;
  const db = loadSource('src/db.ts', {
    '@react-native-async-storage/async-storage': {
      getItem: async (key) => values.get(key),
      setItem: async (key, value) => values.set(key, value),
      removeItem: async (key) => values.delete(key),
    },
    // Encryption is mocked only to isolate the storage/auth failure policy.
    './crypto': { decryptData: (blob) => JSON.stringify(blob), encryptData: (raw) => JSON.parse(raw) },
    './api': { ApiError, api: { getVault: async () => { throw new Error('Network disconnected'); } } },
    './secureSession': { secureSession: { get: async () => session(), clear: async () => { cleared = true; } } },
    './vaultSanitizer': { stripLegacyAIKeys },
  });
  const restored = await db.loadSession();
  assert.equal(restored.userId, userId);
  assert.deepEqual(restored.vault.settings, { theme: 'cyan' });
  assert.equal(values.get('CIPHER_VAULT_CACHE').includes('retired'), false);
  values.set('CIPHER_VAULT_CACHE', JSON.stringify({ ...vault, profile: { id: 'b'.repeat(24) } }));
  assert.equal(await db.loadSession(), null);
  assert.equal(cleared, true);
});
