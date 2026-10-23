const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { test } = require('node:test');
const ts = require('typescript');
const { encode, decode } = require('fast-png');

function loadTypeScript(relativePath) {
  const filename = path.resolve(__dirname, relativePath);
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  loaded._compile(compiled, filename);
  return loaded.exports;
}

const { transformImagePng, deriveKey, deriveAuthCredential, bytesToBase64 } = loadTypeScript('../src/crypto.ts');
const { createPinAttemptStore } = loadTypeScript('../src/pinAttempts.ts');
const key = 'a-long-random-image-key-32-chars!';
const original = encode({
  width: 7, height: 5, depth: 8, channels: 4,
  data: Uint8Array.from({ length: 7 * 5 * 4 }, (_, i) => (i * 37) % 256),
});

test('authentication credentials are deterministic and separated from vault encryption keys', () => {
  const salt = bytesToBase64(Uint8Array.from({ length: 16 }, (_, index) => index));
  const anotherSalt = bytesToBase64(Uint8Array.from({ length: 16 }, (_, index) => index + 1));
  const credential = deriveAuthCredential('a-long-account-password', salt);
  assert.match(credential, /^[a-f0-9]{64}$/);
  assert.equal(credential, deriveAuthCredential('a-long-account-password', salt));
  assert.notEqual(credential, Buffer.from(deriveKey('a-long-account-password', salt)).toString('hex'));
  assert.notEqual(credential, deriveAuthCredential('another-account-password', salt));
  assert.notEqual(credential, deriveAuthCredential('a-long-account-password', anotherSalt));
});

function mutateCarrier(bytes, mutate) {
  const carrier = decode(bytes);
  const data = new Uint8Array(carrier.data);
  mutate(data, carrier);
  return encode({ width: carrier.width, height: carrier.height, depth: 8, channels: 3, data });
}

test('image encryption uses fresh nonces and restores the exact PNG including alpha', () => {
  const first = transformImagePng(original, key, 'encrypt');
  const second = transformImagePng(original, key, 'encrypt');
  assert.notDeepEqual(first.bytes, second.bytes);
  assert.equal(decode(first.bytes).channels, 3);
  const restored = transformImagePng(first.bytes, key, 'decrypt');
  assert.deepEqual(restored.bytes, original);
  assert.equal(restored.width, 7);
  assert.equal(restored.height, 5);
});

test('wrong keys and altered authenticated header/ciphertext are rejected', () => {
  const encrypted = transformImagePng(original, key, 'encrypt');
  assert.throws(() => transformImagePng(encrypted.bytes, 'another-long-key-value', 'decrypt'), /authentication failed/);
  for (const offset of [8, 32, 48]) {
    const changed = mutateCarrier(encrypted.bytes, (data) => { data[offset] ^= 1; });
    assert.throws(() => transformImagePng(changed, key, 'decrypt'), /authentication failed/);
  }
  const dimensions = mutateCarrier(encrypted.bytes, (data) => { data[27] ^= 1; });
  assert.throws(() => transformImagePng(dimensions, key, 'decrypt'), /modified/);
  const length = mutateCarrier(encrypted.bytes, (data) => { data[20] = 255; });
  assert.throws(() => transformImagePng(length, key, 'decrypt'), /truncated or modified/);
});

test('carrier accepts lossless RGB to opaque RGBA conversion but rejects edited padding or alpha', () => {
  const encrypted = transformImagePng(original, key, 'encrypt');
  const carrier = decode(encrypted.bytes);
  const rgba = new Uint8Array(carrier.width * carrier.height * 4);
  for (let i = 0, j = 0; i < carrier.data.length; i += 3, j += 4) {
    rgba.set(carrier.data.subarray(i, i + 3), j);
    rgba[j + 3] = 255;
  }
  const asRgba = () => encode({ width: carrier.width, height: carrier.height, depth: 8, channels: 4, data: rgba });
  assert.deepEqual(transformImagePng(asRgba(), key, 'decrypt').bytes, original);
  rgba[3] = 254;
  assert.throws(() => transformImagePng(asRgba(), key, 'decrypt'), /modified/);
  const padded = mutateCarrier(encrypted.bytes, (data) => { data[data.length - 1] = 1; });
  assert.throws(() => transformImagePng(padded, key, 'decrypt'));
});

test('legacy, malformed, oversized PNGs and short image keys fail closed', () => {
  assert.throws(() => transformImagePng(original, key, 'decrypt'), /Unsupported|modified/);
  assert.throws(() => transformImagePng(new Uint8Array(40), key, 'decrypt'), /PNG/);
  assert.throws(() => transformImagePng(original, 'short', 'encrypt'), /16 characters/);
  const oversized = new Uint8Array(original);
  new DataView(oversized.buffer).setUint32(16, 8_000_001);
  assert.throws(() => transformImagePng(oversized, key, 'encrypt'), /dimensions/);
});

const userId = '0123456789abcdef01234567';
function memoryStorage() {
  const data = new Map();
  return {
    data,
    getItem: async (key) => data.get(key) ?? null,
    setItem: async (key, value) => { data.set(key, value); },
    removeItem: async (key) => { data.delete(key); },
  };
}

test('five PIN attempts impose a persistent delay, with a fresh budget only after successful clear', async () => {
  const storage = memoryStorage();
  const store = createPinAttemptStore(storage);
  for (let i = 1; i <= 4; i++) {
    assert.deepEqual(await store.begin(userId, 1000), { attempts: i, blockedUntil: 0 });
  }
  assert.deepEqual(await store.begin(userId, 1000), { attempts: 5, blockedUntil: 61_000 });
  const restoredStore = createPinAttemptStore(storage);
  await assert.rejects(restoredStore.begin(userId, 60_999), /temporarily locked/);
  assert.equal((await restoredStore.begin(userId, 61_000)).attempts, 6);
  await restoredStore.clear(userId);
  assert.deepEqual(await restoredStore.read(userId), { attempts: 0, blockedUntil: 0 });
});

test('PIN failures cannot continue when protected storage fails or is corrupted', async () => {
  const storage = memoryStorage();
  const store = createPinAttemptStore(storage);
  storage.data.set(`CIPHER_PIN_ATTEMPTS_${userId}`, '{"attempts":-1,"blockedUntil":0}');
  await assert.rejects(store.begin(userId), /Invalid PIN attempt record/);
  storage.data.clear();
  storage.setItem = async () => { throw new Error('storage unavailable'); };
  await assert.rejects(store.begin(userId), /storage unavailable/);
  assert.deepEqual(await store.read(userId), { attempts: 0, blockedUntil: 0 });
});
