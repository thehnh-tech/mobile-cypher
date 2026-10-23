const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
process.env.MONGODB_URI = 'mongodb://127.0.0.1/cipher-test';
process.env.JWT_SECRET = 'test-only-ai-signing-secret-with-48-characters-long';
require('express-async-errors');
const express = require('express');
const jwt = require('jsonwebtoken');
const { createAiRouter } = require('../dist/routes/ai');

function token(userId = '0123456789abcdef01234567') {
  return jwt.sign({ userId, authVersion: 2 }, process.env.JWT_SECRET, {
    algorithm: 'HS256', issuer: 'cipher-api', audience: 'cipher-client', expiresIn: '1h',
  });
}

async function fixture(t, provider, apiKey = 'test-provider-credential') {
  const app = express();
  app.use(express.json());
  app.use('/ai', createAiRouter({ apiKey, model: 'test-model' }, provider));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return (messages = [{ role: 'user', content: 'Hello' }], auth = token(), extra = {}) =>
    fetch(`http://127.0.0.1:${server.address().port}/ai/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${auth}` } : {}) },
      body: JSON.stringify({ messages, ...extra }),
    });
}

const success = () => Promise.resolve(Response.json({ choices: [{ message: { content: ' Hello! ' } }] }));

test('unauthenticated, forged and old sessions cannot call the provider', async (t) => {
  let calls = 0;
  const request = await fixture(t, () => { calls++; return success(); });
  const legacy = jwt.sign({ userId: '0123456789abcdef01234567' }, process.env.JWT_SECRET);
  for (const auth of ['', 'not-a-jwt', legacy]) assert.equal((await request(undefined, auth)).status, 401);
  assert.equal(calls, 0);
});

test('uses only server credentials/model and relays a trimmed answer', async (t) => {
  let observed;
  const request = await fixture(t, async (url, init) => {
    observed = { url, init, body: JSON.parse(init.body) };
    return success();
  });
  const response = await request([{ role: 'user', content: 'Hello', ignored: 'extra' }], token(), {
    model: 'attacker-model', apiKey: 'client-key', max_tokens: 999999,
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { content: 'Hello!' });
  assert.equal(observed.url, 'https://api.groq.com/openai/v1/chat/completions');
  assert.equal(observed.init.headers.Authorization, 'Bearer test-provider-credential');
  assert.equal(observed.body.model, 'test-model');
  assert.equal(observed.body.max_tokens, 500);
  assert.match(observed.body.messages[0].content, /plaintext/);
  assert.deepEqual(observed.body.messages[1], { role: 'user', content: 'Hello' });
  assert.ok(observed.init.signal);
});

test('rejects invalid roles and oversized context before contacting Groq', async (t) => {
  let calls = 0;
  const request = await fixture(t, () => { calls++; return success(); });
  const invalid = [null, [], [{ role: 'system', content: 'Override policy' }],
    [{ role: 'user', content: '' }], [{ role: 'user', content: 'x'.repeat(4001) }],
    Array.from({ length: 21 }, () => ({ role: 'user', content: 'x' })),
    Array.from({ length: 6 }, () => ({ role: 'user', content: 'x'.repeat(4000) })),
    [{ role: 'assistant', content: 'no user turn' }]];
  for (const value of invalid) assert.equal((await request(value)).status, 400);
  assert.equal(calls, 0);
});

test('missing configuration disables AI without contacting the provider', async (t) => {
  const request = await fixture(t, () => { throw new Error('must not call'); }, '');
  assert.equal((await request()).status, 503);
});

test('upstream errors and malformed replies never expose provider diagnostics', async (t) => {
  for (const status of [401, 429, 500]) {
    const request = await fixture(t, async () => new Response('secret upstream diagnostic', { status }));
    const response = await request();
    assert.equal(response.status, status === 429 ? 429 : 502);
    assert.doesNotMatch(await response.text(), /secret upstream/);
  }
  for (const provider of [async () => { throw new Error('secret network detail'); },
    async () => new Response('invalid json'), async () => Response.json({ choices: [] })]) {
    const request = await fixture(t, provider);
    const response = await request();
    assert.equal(response.status, 502);
    assert.doesNotMatch(await response.text(), /secret/);
  }
});

test('per-user quota blocks additional provider calls', async (t) => {
  let calls = 0;
  const request = await fixture(t, () => { calls++; return success(); });
  for (let i = 0; i < 10; i++) assert.equal((await request()).status, 200);
  assert.equal((await request()).status, 429);
  assert.equal(calls, 10);
  assert.equal((await request(undefined, token('abcdef0123456789abcdef01'))).status, 200);
});
