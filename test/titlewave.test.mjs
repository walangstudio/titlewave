import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync, readdirSync, statSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { validateName, detectAgent, renameGemini, renameSession } from '../lib/agents.mjs';
import { terminalHost } from '../lib/terminal.mjs';
import titlewave from '../extensions/pi.mjs';
import opencodeTitlewave from '../extensions/opencode.mjs';
import { nativeCommand, withRpc } from '../lib/rpc.mjs';

test('Claude session hook stays scoped to its manifest and supplies the exact ID', () => {
  assert.equal(existsSync('hooks/hooks.json'), false, 'Gemini auto-loads this shared hook path');
  const manifest = JSON.parse(readFileSync('.claude-plugin/plugin.json', 'utf8'));
  const hooks = manifest.hooks.SessionStart.flatMap(entry => entry.hooks);
  assert.equal(hooks.length, 1);
  assert.equal(hooks[0].command, 'node "${CLAUDE_PLUGIN_ROOT}/hooks/context.mjs"');
  const result = spawnSync(process.execPath, ['hooks/context.mjs'], { input: JSON.stringify({ session_id: 'claude-current-123' }), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const context = JSON.parse(result.stdout).hookSpecificOutput;
  assert.equal(context.hookEventName, 'SessionStart');
  assert.match(context.additionalContext, /current Claude session ID: claude-current-123\./);
});

test('RPC children exit even when they ignore graceful termination', async () => {
  const script = `import { createInterface } from 'node:readline';
    process.on('SIGTERM', () => {});
    setInterval(() => {}, 1000);
    createInterface({ input: process.stdin }).on('line', line => {
      const { id } = JSON.parse(line);
      console.log(JSON.stringify({ id, success: true, data: { pid: process.pid } }));
    });`;
  const pid = await withRpc('node', ['--input-type=module', '-e', script], request => request('pid'), 'pi').then(result => result.pid);
  try {
    assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' }, 'RPC subprocess survived cleanup');
  } finally {
    try { process.kill(pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  }
});

test('names preserve spaces, Unicode, quotes, and shell metacharacters', () => {
  for (const name of ['Fix login', '日本語', 'a "quote"', "O'Brien", '$(touch bad); & echo nope']) assert.equal(validateName(name), name);
});
for (const name of ['', '   ', '-flag', 'a\nb', 'a\rb', 'a\x1bb', 'a\x07b', 'a\x9bb', 'a\u202eb', 'a\u2028b', 'x'.repeat(201)]) {
  test(`reject unsafe name ${JSON.stringify(name)}`, () => assert.throws(() => validateName(name)));
}
test('agent detection refuses missing or nested identities', () => {
  assert.throws(() => detectAgent({}));
  assert.throws(() => detectAgent({ CODEX_THREAD_ID: 'c', CLAUDE_CODE_SESSION_ID: 'a' }));
  assert.equal(detectAgent({ CODEX_THREAD_ID: 'c' }), 'codex');
});

test('skill launcher refuses an inherited parent session without explicit targets', () => {
  for (const args of [['New name'], ['New name', '--agent', 'codex'], ['New name', '--session', 'child'], ['terminal', '--agent', 'codex'], ['terminal', '--terminal'], ['New name', '--agent', 'codex', '--session', ''], ['New name', '--agent', '', '--session', 'child'], ['New name', '--agent', 'codex', '--session=']]) {
    const result = spawnSync(process.execPath, ['skills/titlewave/scripts/titlewave.mjs', ...args], { encoding: 'utf8', env: { ...process.env, CODEX_THREAD_ID: 'parent-session' } });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /explicit --agent and --session/);
  }
  const result = spawnSync(process.execPath, ['skills/titlewave/scripts/titlewave.mjs', 'New name', '--agent', 'codex', '--session', 'child', '--dry-run'], { encoding: 'utf8', env: { ...process.env, CODEX_THREAD_ID: 'parent-session' } });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).session, 'child');
  for (const args of [['New name', '--agent=codex', '--session=child', '--dry-run'], ['terminal', 'Window name', '--dry-run']]) {
    const parsed = spawnSync(process.execPath, ['skills/titlewave/scripts/titlewave.mjs', ...args], { encoding: 'utf8' });
    assert.equal(parsed.status, 0, parsed.stderr);
    assert.equal(JSON.parse(parsed.stdout).name, args[0] === 'terminal' ? 'Window name' : 'New name');
  }
  const empty = spawnSync(process.execPath, ['bin/titlewave.mjs', 'New name', '--agent', 'codex', '--session', '', '--dry-run'], { encoding: 'utf8', env: { ...process.env, CODEX_THREAD_ID: 'parent-session' } });
  assert.notEqual(empty.status, 0);
  assert.match(empty.stderr, /must|not.*empty/);
});

test('OpenCode context supplies its exact session and strips URL credentials', async () => {
  const hooks = await opencodeTitlewave({ serverUrl: new URL('http://user:secret@127.0.0.1:4096/base/?token=secret#fragment') });
  const output = { system: [] };
  await hooks['experimental.chat.system.transform']({ sessionID: 'ses_current' }, output);
  assert.match(output.system[0], /--agent opencode/);
  assert.match(output.system[0], /ses_current/);
  assert.match(output.system[0], /http:\/\/127\.0\.0\.1:4096\/base\//);
  assert.equal(output.system[0].includes('secret'), false);
  await hooks['experimental.chat.system.transform']({ sessionID: 'bad\ninstruction' }, output);
  assert.equal(output.system.length, 1);
});

test('OpenCode registers a slash fallback without overwriting user commands', async () => {
  const hooks = await opencodeTitlewave({ serverUrl: new URL('http://127.0.0.1:4096') });
  const config = {};
  await hooks.config(config);
  assert.match(config.command.titlewave.template, /\$ARGUMENTS/);
  config.command.titlewave = { template: 'User command' };
  await hooks.config(config);
  assert.equal(config.command.titlewave.template, 'User command');
});
test('an inner multiplexer wins over the outer terminal', () => {
  assert.equal(terminalHost({ TMUX: 'socket', TMUX_PANE: '%1', KITTY_WINDOW_ID: '3' }), 'tmux');
  assert.equal(terminalHost({ STY: 'screen', WINDOW: '0', WEZTERM_PANE: '2' }), 'screen');
  assert.equal(terminalHost({ ZELLIJ: '0', WEZTERM_PANE: '2' }), 'zellij');
});
test('nested multiplexers fail instead of labeling the wrong layer', () => {
  assert.throws(() => terminalHost({ TMUX: 'outer', TMUX_PANE: '%1', ZELLIJ: '0' }), /Multiple multiplexers/);
});
test('the word terminal is a valid saved session name', () => {
  const result = spawnSync(process.execPath, ['bin/titlewave.mjs', 'terminal', '--agent', 'codex', '--session', 's', '--dry-run'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).name, 'terminal');
});
test('dry run starts no agent and emits no terminal escape sequence', () => {
  const result = spawnSync(process.execPath, ['bin/titlewave.mjs', 'Dry run', '--agent', 'claude', '--session', 'missing', '--terminal', '--dry-run'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).name, 'Dry run');
  assert.equal(result.stdout.includes('\x1b'), false);
});
test('unknown options and extra names fail instead of silently renaming', () => {
  for (const args of [['one', 'two'], ['one', '--offine']]) assert.notEqual(spawnSync(process.execPath, ['bin/titlewave.mjs', ...args]).status, 0);
});
test('closed Gemini rename preserves conversation data', () => {
  const directory = mkdtempSync(join(tmpdir(), 'titlewave-test-'));
  try {
    const file = join(directory, 'session.json');
    const data = { sessionId: 'g1', projectHash: 'project', messages: [{ type: 'user', content: 'hello' }], summary: 'old', futureField: 42 };
    writeFileSync(file, JSON.stringify(data));
    chmodSync(file, 0o640);
    const mode = statSync(file).mode;
    renameGemini(file, 'g1', 'new');
    assert.equal(statSync(file).mode, mode);
    assert.deepEqual(JSON.parse(readFileSync(file)), { ...data, summary: 'new' });
    assert.deepEqual(readdirSync(directory), ['session.json']);
    const saved = readFileSync(file, 'utf8');
    assert.throws(() => renameGemini(file, 'wrong-session', 'other'));
    assert.equal(readFileSync(file, 'utf8'), saved);
  } finally { rmSync(directory, { recursive: true }); }
});
test('live Gemini and Pi files cannot be edited by the CLI', async () => {
  for (const agent of ['gemini', 'pi']) await assert.rejects(renameSession({ agent, name: 'new', session: 's' }), /closed|running/);
});
test('Gemini JSONL rename appends metadata without rewriting messages', () => {
  const directory = mkdtempSync(join(tmpdir(), 'titlewave-jsonl-'));
  try {
    const file = join(directory, 'session.jsonl');
    const original = `${JSON.stringify({ sessionId: 's', projectHash: 'p' })}\n${JSON.stringify({ id: 'm', type: 'user', content: 'hello' })}\n`;
    writeFileSync(file, original);
    renameGemini(file, 's', 'JSONL title');
    const result = readFileSync(file, 'utf8');
    assert.ok(result.startsWith(original));
    assert.deepEqual(JSON.parse(result.trimEnd().split('\n').at(-1)), { $set: { summary: 'JSONL title' } });
  } finally { rmSync(directory, { recursive: true }); }
});
test('invalid IDs and unknown agents never start a subprocess', async () => {
  for (const session of ['', '-flag', 's\ncommand']) await assert.rejects(renameSession({ agent: 'claude', name: 'ok', session }));
  await assert.rejects(renameSession({ agent: 'other', name: 'ok', session: 's' }), /Unknown agent/);
});
test('OpenCode confirms the exact ID and title through its API', async () => {
  let payload;
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    payload = { method: req.method, path: req.url, data: JSON.parse(body) };
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ id: 'ses_1', title: payload.data.title }));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try {
    await renameSession({ agent: 'opencode', session: 'ses_1', name: 'API title', url: `http://127.0.0.1:${server.address().port}/prefix` });
    assert.deepEqual(payload, { method: 'PATCH', path: '/prefix/session/ses_1', data: { title: 'API title' } });
  } finally { server.closeAllConnections(); server.close(); }
});
test('OpenCode rejects remote URLs and misleading confirmations', async () => {
  for (const session of ['.', '..']) await assert.rejects(renameSession({ agent: 'opencode', session, name: 'ok', url: 'http://localhost' }), /dot segment/);
  for (const url of ['file:///tmp/test', 'https://example.com', 'http://user:pass@localhost']) await assert.rejects(renameSession({ agent: 'opencode', session: 's', name: 'ok', url }));
  const server = createServer((_req, res) => { res.end(JSON.stringify({ id: 'wrong', title: 'ok' })); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try { await assert.rejects(renameSession({ agent: 'opencode', session: 's', name: 'ok', url: `http://127.0.0.1:${server.address().port}` }), /confirm/); }
  finally { server.closeAllConnections(); server.close(); }
});
test('Pi extension registers a command and a model tool using its native API', async () => {
  let command, tool, saved;
  titlewave({ registerCommand: (name, value) => { assert.equal(name, 'titlewave'); command = value; }, registerTool: value => { tool = value; }, setSessionName: name => { saved = name; } });
  await command.handler('A session', { ui: { notify: () => {} } });
  assert.equal(saved, 'A session');
  const result = await tool.execute('call', { name: 'Tool session' });
  assert.equal(saved, 'Tool session');
  assert.match(result.content[0].text, /Tool session/);
  await assert.rejects(tool.execute('call', { name: 'bad\nname' }));
});
test('distribution manifests and portable skill have no installation placeholders', () => {
  const pkg = JSON.parse(readFileSync('package.json'));
  for (const file of ['.claude-plugin/plugin.json', '.codex-plugin/plugin.json', 'gemini-extension.json']) assert.equal(JSON.parse(readFileSync(file)).version, pkg.version);
  assert.doesNotMatch(readFileSync('skills/titlewave/SKILL.md', 'utf8'), /__RUN__|__DIR__/);
  for (const file of ['bin/titlewave.mjs', 'hooks/context.mjs', 'LICENSE']) assert.ok(existsSync(file));
  for (const input of ['', 'not json', 'null']) {
    const result = spawnSync(process.execPath, ['hooks/context.mjs'], { input, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, '');
  }
});
test('Windows executable lookup ignores a binary planted in the working directory', () => {
  if (process.platform !== 'win32') { assert.equal(nativeCommand('node'), 'node'); return; }
  const directory = mkdtempSync(join(tmpdir(), 'titlewave-path-'));
  const previous = process.cwd();
  try {
    writeFileSync(join(directory, 'node.exe'), 'untrusted fixture');
    process.chdir(directory);
    assert.notEqual(nativeCommand('node').toLowerCase(), join(directory, 'node.exe').toLowerCase());
    const systemRoot = process.env.SystemRoot;
    try {
      delete process.env.SystemRoot;
      assert.throws(() => nativeCommand('node'), /SystemRoot is missing/);
    } finally { process.env.SystemRoot = systemRoot; }
  } finally { process.chdir(previous); rmSync(directory, { recursive: true }); }
});
