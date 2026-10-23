const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');
const { createHash, createECDH } = require('node:crypto');

process.env.MONGODB_URI = 'mongodb://127.0.0.1/cipher-test';
process.env.JWT_SECRET = 'unit-test-signing-secret-which-is-over-32-characters';
const { User } = require('../dist/models/User');
const { hashAuthCredential, verifyAuthCredential } = require('../dist/authCredentials');
const { authMiddleware } = require('../dist/middleware/auth');
const { createRateLimit } = require('../dist/middleware/rateLimit');
const authRouter = require('../dist/routes/auth').default;

const id = 'a'.repeat(24);
const credential = 'b'.repeat(64);
const messagingKey = createECDH('secp256k1');
messagingKey.generateKeys();
const publicKey = messagingKey.getPublicKey(undefined, 'compressed').toString('base64');
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const keyFingerprint = (value) => sha256(value).slice(0, 32).match(/.{4}/g).join(' ').toUpperCase();
const signupFields = () => ({
  username: 'alice', displayName: 'Alice', tag: 'alice', tagHash: sha256('alice'),
  salt: Buffer.alloc(16).toString('base64'),
  verifier: { iv: Buffer.alloc(12).toString('base64'), ct: Buffer.alloc(25).toString('base64') },
  fingerprint: keyFingerprint(publicKey), publicKey, authCredential: credential,
});
let record;
let created;
let server;
let url;
const originalFindOne = User.findOne;
const originalCreate = User.create;

before(async () => {
  User.findOne = () => ({
    select: () => Promise.resolve(record),
    then: (resolve, reject) => Promise.resolve(record).then(resolve, reject),
  });
  User.create = async (fields) => { created = fields; return { ...fields, _id: id }; };
  const app = express();
  app.use(express.json());
  app.use('/auth', authRouter);
  app.get('/protected', authMiddleware, (req, res) => res.json({ userId: req.userId }));
  app.use((error, req, res, next) => res.status(500).json({ error: 'Internal server error' }));
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  url = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  User.findOne = originalFindOne;
  User.create = originalCreate;
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

async function post(path, body) {
  const response = await fetch(`${url}/auth/${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json(), headers: response.headers };
}

test('salted credential hashes verify the right secret and reject wrong or malformed ones', async () => {
  const first = await hashAuthCredential(credential);
  const second = await hashAuthCredential(credential);
  assert.notEqual(first, second);
  assert.equal(await verifyAuthCredential(credential, first), true);
  assert.equal(await verifyAuthCredential('c'.repeat(64), first), false);
  assert.equal(await verifyAuthCredential(credential, 'broken'), false);
  assert.equal(await verifyAuthCredential({}, first), false);
});

test('username-only login and query-injection inputs never issue a JWT', async () => {
  for (const body of [{ username: 'alice' }, { username: { $ne: null }, authCredential: credential }]) {
    const result = await post('login', body);
    assert.equal(result.status, 400);
    assert.equal(result.body.token, undefined);
  }
});

test('legacy accounts cannot authenticate or enroll a replacement credential by username', async () => {
  record = { _id: id, username: 'alice', salt: 'legacy' };
  const params = await post('parameters', { username: 'alice' });
  assert.equal(params.status, 403);
  assert.equal(params.body.token, undefined);
  const login = await post('login', { username: 'alice', authCredential: credential });
  assert.equal(login.status, 401);
  assert.equal(login.body.token, undefined);
});

test('public KDF parameters give no token, wrong credential fails, verified credential grants access', async () => {
  record = {
    _id: id, username: 'alice', salt: 'account-salt', verifier: { iv: 'iv', ct: 'ct' },
    fingerprint: 'fingerprint', displayName: 'Alice', tag: 'alice', publicKey: 'public-key',
    authHash: await hashAuthCredential(credential),
  };
  const params = await post('parameters', { username: 'alice' });
  assert.equal(params.status, 200);
  assert.deepEqual(Object.keys(params.body).sort(), ['salt', 'verifier']);
  assert.equal(params.headers.get('cache-control'), 'no-store');
  const wrong = await post('login', { username: 'alice', authCredential: 'c'.repeat(64) });
  assert.equal(wrong.status, 401);
  assert.equal(wrong.body.token, undefined);
  const correct = await post('login', { username: 'alice', authCredential: credential });
  assert.equal(correct.status, 200);
  assert.equal(correct.body.authHash, undefined);
  assert.equal(correct.body.authCredential, undefined);
  const protectedResult = await fetch(`${url}/protected`, {
    headers: { Authorization: `Bearer ${correct.body.token}` },
  });
  assert.equal(protectedResult.status, 200);
  assert.deepEqual(await protectedResult.json(), { userId: id });
});

test('JWTs from the insecure implementation and other algorithms are rejected', async () => {
  const tokens = [
    jwt.sign({ userId: id }, process.env.JWT_SECRET),
    jwt.sign({ userId: id, authVersion: 2 }, process.env.JWT_SECRET, {
      algorithm: 'HS384', issuer: 'cipher-api', audience: 'cipher-client',
    }),
  ];
  for (const token of tokens) {
    const result = await fetch(`${url}/protected`, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(result.status, 401);
  }
});

test('signup stores a salted auth hash and never a reusable credential', async () => {
  record = null;
  const fields = signupFields();
  const result = await post('signup', fields);
  assert.equal(result.status, 201);
  assert.equal(created.authCredential, undefined);
  assert.equal(await verifyAuthCredential(credential, created.authHash), true);
  assert.equal(result.body.authHash, undefined);
  const invalid = await post('signup', { ...fields, username: [] });
  assert.equal(invalid.status, 400);
});

test('signup rejects mismatched directory fields and invalid curve points before storing an account', async () => {
  record = null;
  const invalidPoint = Buffer.concat([Buffer.from([2]), Buffer.alloc(32, 255)]).toString('base64');
  for (const overrides of [
    { tagHash: sha256('someone-else') },
    { fingerprint: keyFingerprint('someone-else') },
    { publicKey: invalidPoint, fingerprint: keyFingerprint(invalidPoint) },
  ]) {
    created = undefined;
    const result = await post('signup', { ...signupFields(), ...overrides });
    assert.equal(result.status, 400);
    assert.equal(result.body.token, undefined);
    assert.equal(created, undefined);
  }
});

test('rate limiter denies requests beyond the limit and supplies retry time', () => {
  const limiter = createRateLimit(2, 1000);
  let allowed = 0;
  let status;
  let retry;
  const req = { ip: '127.0.0.1', socket: {} };
  const res = {
    setHeader: (key, value) => { if (key === 'Retry-After') retry = value; },
    status: (value) => { status = value; return res; }, json: () => {},
  };
  for (let i = 0; i < 3; i++) limiter(req, res, () => allowed++);
  assert.equal(allowed, 2);
  assert.equal(status, 429);
  assert.equal(retry, '1');
});
