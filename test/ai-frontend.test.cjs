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
const { buildAIHistory, getAIReply } = loadSource('src/aiClient.ts', {
  './api': { api: { aiChat: async (_token, messages) => {
    assert.ok(messages.length <= 20);
    assert.ok(messages.every((message) => message.content.length <= 4000));
    assert.ok(messages.reduce((sum, message) => sum + message.content.length, 0) <= 20_000);
    return { content: 'reply' };
  } }, ApiError: class extends Error {} },
});
const { createVaultUpdater, appendChatMessage, mergeVaultChanges } = loadSource('src/vaultUpdates.ts');
const message = (id, text = id, from = 'user') => ({ id, text, from, ts: 1 });

test('AI history meets all backend limits and preserves the exact newest question', async () => {
  const messages = Array.from({ length: 25 }, (_, i) => message(String(i), 'x'.repeat(4000), i % 2 ? 'ai' : 'user'));
  const result = buildAIHistory(messages, 'user', 'ai');
  assert.equal(result.history.length, 5);
  assert.equal(result.omittedCount, 20);
  assert.equal(result.history.at(-1).content, messages.at(-1).text);
  let notice;
  assert.equal(await getAIReply(messages, 'user', 'ai', 'token', (value) => notice = value), 'reply');
  assert.match(notice, /This AI request includes/);
  assert.match(notice, /20 older messages/);
});

test('AI history omits old oversized context but never silently truncates the current question', () => {
  const current = '  exact newest question  ';
  const result = buildAIHistory([message('old', 'a'.repeat(4001), 'ai'), message('new', current)], 'user', 'ai');
  assert.deepEqual(result.history, [{ role: 'user', content: current }]);
  assert.equal(result.omittedCount, 1);
  assert.throws(() => buildAIHistory([message('new', 'a'.repeat(4001))], 'user', 'ai'),
    (error) => error.kind === 'input' && /not been sent/.test(error.message));
});

test('AI history caps message count, omits deleted/foreign/blank messages, and ends with user', () => {
  const messages = [
    message('foreign', 'private other chat', 'other'), { ...message('deleted'), deleted: true }, message('blank', '  '),
    ...Array.from({ length: 21 }, (_, i) => message(String(i))),
  ];
  const result = buildAIHistory(messages, 'user', 'ai');
  assert.equal(result.history.length, 20);
  assert.equal(result.history[0].content, '1');
  assert.equal(result.omittedCount, 1);
  assert.throws(() => buildAIHistory([message('assistant', 'answer', 'ai')], 'user', 'ai'));
});

function fixture() {
  const vault = {
    profile: { id: 'user', displayName: 'Before' }, settings: { theme: 'cyan', bubbleStyle: 'solid' },
    contacts: [], chats: [{ id: 'chat', messages: [message('question')], unread: 0 }],
  };
  return { userId: 'user', token: 'token-1', key: new Uint8Array(32), vault };
}
function deferred() {
  let resolve;
  const promise = new Promise((done) => resolve = done);
  return { promise, resolve };
}

test('serialized AI completion merges into the latest profile, theme and messages', async () => {
  let current = fixture();
  const firstSave = deferred();
  const started = deferred();
  const writes = [];
  const update = createVaultUpdater({
    current: () => current,
    save: async (_session, vault) => {
      writes.push(vault);
      if (writes.length === 1) { started.resolve(); await firstSave.promise; }
    },
    commit: (vault) => { current = { ...current, vault }; },
  });
  const profileChange = update((latest) => ({
    ...latest, profile: { ...latest.profile, displayName: 'After' }, settings: { ...latest.settings, theme: 'amber' },
    chats: latest.chats.map((chat) => ({ ...chat, messages: [...chat.messages, message('newer-message')] })),
  }));
  await started.promise;
  const aiCompletion = update((latest) => appendChatMessage(latest, 'chat', message('reply', 'answer', 'ai')),
    { userId: 'user', token: 'token-1' });
  assert.equal(writes.length, 1);
  firstSave.resolve();
  assert.equal(await profileChange, true);
  assert.equal(await aiCompletion, true);
  assert.equal(current.vault.profile.displayName, 'After');
  assert.equal(current.vault.settings.theme, 'amber');
  assert.deepEqual(current.vault.chats[0].messages.map((item) => item.id), ['question', 'newer-message', 'reply']);
  assert.equal(writes.length, 2);
});

test('logout/account switch discards an in-flight completion and queued old-session updates', async () => {
  let current = fixture();
  const saved = deferred();
  const started = deferred();
  let writes = 0;
  let commits = 0;
  const update = createVaultUpdater({
    current: () => current,
    save: async () => { writes++; started.resolve(); await saved.promise; },
    commit: () => { commits++; },
  });
  const first = update((latest) => appendChatMessage(latest, 'chat', message('reply')));
  await started.promise;
  const queued = update((latest) => appendChatMessage(latest, 'chat', message('error')));
  current = { ...fixture(), token: 'token-2' };
  saved.resolve();
  assert.equal(await first, false);
  assert.equal(await queued, false);
  assert.equal(await update((latest) => latest, { userId: 'user', token: 'token-1' }), false);
  assert.equal(writes, 1);
  assert.equal(commits, 0);
  current = null;
  assert.equal(await update((latest) => latest), false);
});

test('a queued whole-vault profile edit preserves a concurrent AI append', async () => {
  let current = fixture();
  const base = current.vault;
  const desired = { ...base, profile: { ...base.profile, displayName: 'Updated name' } };
  const firstSave = deferred();
  const started = deferred();
  let writes = 0;
  const update = createVaultUpdater({
    current: () => current,
    save: async () => { if (++writes === 1) { started.resolve(); await firstSave.promise; } },
    commit: (vault) => { current = { ...current, vault }; },
  });
  const ai = update((latest) => appendChatMessage(latest, 'chat', message('ai-completed', 'answer', 'ai')));
  await started.promise;
  const profile = update((latest) => mergeVaultChanges(latest, base, desired));
  firstSave.resolve();
  await Promise.all([ai, profile]);
  assert.equal(current.vault.profile.displayName, 'Updated name');
  assert.deepEqual(current.vault.chats[0].messages.map((item) => item.id), ['question', 'ai-completed']);
  assert.equal(current.vault.settings, base.settings);
});

test('failed persistence does not commit or prevent later updates; duplicate replies are ignored', async () => {
  let current = fixture();
  let writes = 0;
  const update = createVaultUpdater({
    current: () => current,
    save: async () => { if (++writes === 1) throw new Error('offline'); },
    commit: (vault) => { current = { ...current, vault }; },
  });
  await assert.rejects(update((latest) => appendChatMessage(latest, 'chat', message('failed'))), /offline/);
  await update((latest) => appendChatMessage(latest, 'chat', message('reply')));
  await update((latest) => appendChatMessage(latest, 'chat', message('reply')));
  assert.deepEqual(current.vault.chats[0].messages.map((item) => item.id), ['question', 'reply']);
  assert.equal(writes, 2);
});
