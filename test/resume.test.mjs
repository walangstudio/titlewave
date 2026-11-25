import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, delimiter } from 'node:path';
import { spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { createHash } from 'node:crypto';
import { sessionTitle } from '../lib/resume.mjs';
import piTitlewave from '../extensions/pi.mjs';
import opencodeTui from '../extensions/opencode-tui.mjs';
import { gooseOwner, commandArgs } from '../lib/client.mjs';
import { terminalTitleWriter } from '../lib/terminal.mjs';

async function until(predicate) {
  const deadline = Date.now() + 5000;
  while (!predicate()) { assert.ok(Date.now() < deadline, 'Timed out waiting for the TUI route observer'); await delay(10); }
}

test('resume reads the latest Claude title and rejects a different transcript', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'titlewave-resume-'));
  const transcript = join(dir, 'claude.jsonl');
  const save = records => writeFileSync(transcript, records.map(record => JSON.stringify(record)).join('\n') + '\n');
  try {
    save([{ type: 'user', sessionId: 'owned' }, { type: 'custom-title', customTitle: 'Old', sessionId: 'owned' }, { type: 'custom-title', customTitle: 'New "title" 日本語', sessionId: 'owned' }]);
    const original = readFileSync(transcript);
    assert.equal(await sessionTitle({ agent: 'claude', session: 'owned', transcript }), 'New "title" 日本語');
    assert.deepEqual(readFileSync(transcript), original);
    assert.equal(await sessionTitle({ agent: 'claude', session: 'other', transcript }), undefined);
    save([{ type: 'user', sessionId: 'owned' }]);
    assert.equal(await sessionTitle({ agent: 'claude', session: 'owned', transcript }), undefined);
    save([{ type: 'custom-title', customTitle: 'Unknown owner' }]);
    assert.equal(await sessionTitle({ agent: 'claude', session: 'owned', transcript }), undefined);
    save([{ type: 'user', sessionId: 'parent' }, { type: 'custom-title', sessionId: 'parent', customTitle: 'Parent title' }, { type: 'custom-title', sessionId: 'owned', customTitle: 'Fork title' }, null]);
    writeFileSync(transcript, '{"partial":', { flag: 'a' });
    assert.equal(await sessionTitle({ agent: 'claude', session: 'owned', transcript }), 'Fork title');
    assert.equal(await sessionTitle({ agent: 'claude', session: 'owned', transcript, title: null }), 'Fork title');
    await assert.rejects(sessionTitle({ agent: 'claude', session: '../other', transcript }), /exact session ID/);
    await assert.rejects(sessionTitle({ agent: 'claude', session: 'owned', transcript: join(dir, 'missing') }), /ENOENT/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('resume reads Gemini JSON and appended JSONL summaries without editing either', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'titlewave-resume-'));
  try {
    for (const extension of ['json', 'jsonl']) {
      const transcript = join(dir, `gemini.${extension}`);
      const header = { sessionId: 'owned', projectHash: 'fixture', summary: 'Initial', messages: [] };
      writeFileSync(transcript, JSON.stringify(header) + (extension === 'jsonl' ? '\n' + JSON.stringify({ $set: { summary: 'Latest' } }) + '\n' + JSON.stringify({ $set: 'summary' }) + '\n' : ''));
      const original = readFileSync(transcript);
      assert.equal(await sessionTitle({ agent: 'gemini', session: 'owned', transcript }), extension === 'jsonl' ? 'Latest' : 'Initial');
      assert.deepEqual(readFileSync(transcript), original);
      await assert.rejects(sessionTitle({ agent: 'gemini', session: 'other', transcript }), /does not match/);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('Gemini resume handoff finds only the exact saved session among sibling and legacy files', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'titlewave-gemini-'));
  const chats = join(dir, '.gemini/tmp/project/chats');
  mkdirSync(chats, { recursive: true });
  const id = 'abcd1234-owned', transcript = join(chats, 'session-active-abcd1234.jsonl');
  const previous = join(chats, 'session-saved-abcd1234.jsonl');
  try {
    writeFileSync(transcript, JSON.stringify({ sessionId: id }) + '\n');
    writeFileSync(previous, JSON.stringify({ sessionId: id, summary: 'Saved summary' }) + '\n');
    writeFileSync(join(chats, 'session-collision-abcd1234.jsonl'), JSON.stringify({ sessionId: 'abcd1234-other', summary: 'Wrong summary' }) + '\n');
    assert.equal(await sessionTitle({ agent: 'gemini', session: id, transcript }), 'Saved summary');
    for (const summary of ['', null]) {
      writeFileSync(transcript, JSON.stringify({ sessionId: id }) + '\n' + JSON.stringify({ $set: { summary } }) + '\n');
      assert.equal(await sessionTitle({ agent: 'gemini', session: id, transcript }), undefined);
    }
    writeFileSync(transcript, JSON.stringify({ sessionId: id }) + '\n');
    rmSync(previous);
    const cwd = '/fixture/project';
    const legacy = join(dir, '.gemini/tmp', createHash('sha256').update(cwd).digest('hex'), 'chats');
    mkdirSync(legacy, { recursive: true });
    writeFileSync(join(legacy, 'session-legacy-abcd1234.jsonl'), JSON.stringify({ sessionId: id, summary: 'Legacy summary' }) + '\n');
    assert.equal(await sessionTitle({ agent: 'gemini', session: id, transcript, cwd }), 'Legacy summary');
    for (const content of ['', '{"sessionId":']) {
      writeFileSync(transcript, content);
      assert.equal(await sessionTitle({ agent: 'gemini', session: id, transcript, cwd }), 'Legacy summary');
    }
    rmSync(transcript);
    assert.equal(await sessionTitle({ agent: 'gemini', session: id, transcript, cwd }), 'Legacy summary');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('Codex hook command passes the installed path as one literal argument', () => {
  const manifest = JSON.parse(readFileSync('.codex-plugin/plugin.json'));
  assert.equal(manifest.hooks, './hooks/codex.json');
  const hooks = JSON.parse(readFileSync(manifest.hooks)).hooks;
  assert.equal(hooks.SessionStart[0].hooks[0].command, 'node "${PLUGIN_ROOT}/hooks/start.mjs" codex');
});

test('Codex resume launcher validates exact targets and refuses captured tool sessions before mutation', () => {
  const id = '12345678-1234-4123-8123-123456789abc';
  const env = { ...process.env, CODEX_DAEMON_SHUTDOWN_SOCKET: '' };
  for (const key of ['CLAUDE_CODE_SESSION_ID', 'CODEX_THREAD_ID', 'GEMINI_SESSION_ID', 'GOOSE_SESSION_ID', 'AGENT_SESSION_ID']) delete env[key];
  const planned = spawnSync(process.execPath, ['bin/titlewave.mjs', '--resume', id.toUpperCase(), '--dry-run'], { env, encoding: 'utf8' });
  assert.equal(planned.status, 0, planned.stderr);
  assert.deepEqual(JSON.parse(planned.stdout).command, ['codex', '--no-daemon', 'resume', id]);
  const portable = spawnSync(process.execPath, ['skills/titlewave/scripts/titlewave.mjs', '--resume', id, '--dry-run'], { env, encoding: 'utf8' });
  assert.equal(portable.status, 0, portable.stderr);
  assert.deepEqual(JSON.parse(portable.stdout).command, ['codex', '--no-daemon', 'resume', id]);
  for (const args of [['--resume', '../wrong', '--dry-run'], ['--resume', id, '--agent', 'claude', '--dry-run'], ['--resume', id, '--terminal', '--dry-run'], ['--resume', id, '--session', id, '--dry-run'], ['--resume', id, '--herdr-pane', 'w1:p1', '--dry-run'], ['--resume', id, '--agent', '', '--dry-run']]) {
    const result = spawnSync(process.execPath, ['bin/titlewave.mjs', ...args], { env, encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.equal(result.stdout, '');
  }
  const captured = spawnSync(process.execPath, ['bin/titlewave.mjs', '--resume', id], { env, encoding: 'utf8' });
  assert.notEqual(captured.status, 0);
  assert.match(captured.stderr, /directly in an interactive terminal/);
  const missing = spawnSync(process.execPath, ['bin/titlewave.mjs', '--resume'], { env: { ...env, CODEX_THREAD_ID: id }, encoding: 'utf8' });
  assert.notEqual(missing.status, 0);
  assert.equal(missing.stdout, '');
  assert.match(missing.stderr, /argument/);
  const name = spawnSync(process.execPath, ['bin/titlewave.mjs', 'resume', '--agent', 'codex', '--session', id, '--dry-run'], { env, encoding: 'utf8' });
  assert.equal(name.status, 0, name.stderr);
  assert.equal(JSON.parse(name.stdout).name, 'resume');
  const inherited = spawnSync(process.execPath, ['bin/titlewave.mjs', 'resume', '--dry-run'], { env: { ...env, CODEX_THREAD_ID: id }, encoding: 'utf8' });
  assert.equal(inherited.status, 0, inherited.stderr);
  assert.equal(JSON.parse(inherited.stdout).name, 'resume');
  const warning = spawnSync(process.execPath, ['bin/titlewave.mjs', '--resume', id, '--dry-run'], { env: { ...env, CODEX_DAEMON_SHUTDOWN_SOCKET: 'stale' }, encoding: 'utf8' });
  assert.equal(warning.status, 0, warning.stderr);
  assert.match(JSON.parse(warning.stdout).terminalWarning, /shared-daemon/);
});

test('startup, clear, compact, invalid input, and unrelated events never restore a title', () => {
  for (const payload of [{}, { hook_event_name: 'SessionStart', source: 'startup' }, { hook_event_name: 'SessionStart', source: 'clear' }, { hook_event_name: 'SessionStart', source: 'compact' }, { hook_event_name: 'SessionEnd', source: 'resume' }, null]) {
    const result = spawnSync(process.execPath, ['hooks/start.mjs', 'codex'], { input: JSON.stringify(payload), encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, '');
    assert.deepEqual(JSON.parse(result.stdout), {});
  }
  const result = spawnSync(process.execPath, ['hooks/start.mjs'], { input: 'not JSON', encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {});
});

test('resume hooks refuse stale daemon targets without exposing Claude context to other agents', () => {
  for (const [agent, source] of [['claude', 'resume'], ['claude', 'fork'], ['codex', 'resume'], ['gemini', 'resume'], ['goose', 'resume']]) {
    const payload = agent === 'goose' ? { event: 'SessionStart', session_id: 'owned' } : { hook_event_name: 'SessionStart', source, session_id: 'owned' };
    const result = spawnSync(process.execPath, agent === 'claude' ? ['hooks/context.mjs'] : ['hooks/start.mjs', ...(agent === 'codex' ? ['codex'] : [])], { input: JSON.stringify(payload), encoding: 'utf8', env: { ...process.env, CODEX_DAEMON_SHUTDOWN_SOCKET: 'stale', HERDR_PANE_ID: 'unrelated' } });
    assert.equal(result.status, 0, result.stderr);
    if (agent !== 'goose') assert.match(result.stderr, /resume title not restored: Codex shared-daemon/);
    else assert.match(result.stderr, /local Goose CLI owner could not be verified/);
    assert.equal(result.stdout.includes('Claude session ID'), agent === 'claude');
    assert.ok(JSON.parse(result.stdout));
  }
});

test('Goose restoration requires a local CLI owner rather than a remote server', () => {
  const owner = (command, ...args) => ({ command, args: [command, ...args] });
  assert.equal(gooseOwner([owner('/usr/local/bin/goose', 'session', '--resume')]), true);
  assert.equal(gooseOwner([owner('goose', 'run', '--resume')]), true);
  assert.equal(gooseOwner([owner('goose', 's', '--resume')]), true);
  assert.equal(gooseOwner([owner('goose', 'acp'), owner('goose', 'session')]), false);
  assert.equal(gooseOwner([owner('goose', '--unknown-global-option', 'session')]), undefined);
  assert.equal(gooseOwner([owner('goosed'), owner('goose', 'session')]), false);
  assert.equal(gooseOwner([owner('node', 'unrelated.mjs')]), undefined);
  assert.deepEqual(commandArgs('/Users/me/My Tools/goose', '/Users/me/My Tools/goose session --resume'), ['/Users/me/My Tools/goose', 'session', '--resume']);
  assert.deepEqual(commandArgs('goose.exe', '"C:\\My Tools\\goose.exe" session --resume'), ['C:\\My Tools\\goose.exe', 'session', '--resume']);
  assert.deepEqual(commandArgs('C:\\My Tools\\goose.exe', 'C:\\My Tools\\goose.exe session --resume'), ['C:\\My Tools\\goose.exe', 'session', '--resume']);
});

test('Goose streams large metadata and skips only its unnamed CLI placeholder', { skip: process.platform === 'win32' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'titlewave-goose-'));
  const previous = process.env.PATH;
  const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
  try {
    const fixture = join(dir, 'metadata.cjs');
    writeFileSync(fixture, `process.stdout.write(JSON.stringify([{id:'blank',name:'CLI Session',user_set_name:false},{id:'named',name:'CLI Session',user_set_name:true},{id:'generated',name:'Generated title',user_set_name:false},{id:'padding',name:'x'.repeat(1100000)}]));`);
    writeFileSync(join(dir, 'goose'), `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(fixture)}\n`, { mode: 0o700 });
    process.env.PATH = dir + delimiter + (previous || '');
    assert.equal(await sessionTitle({ agent: 'goose', session: 'blank' }), undefined);
    assert.equal(await sessionTitle({ agent: 'goose', session: 'named' }), 'CLI Session');
    assert.equal(await sessionTitle({ agent: 'goose', session: 'generated' }), 'Generated title');
  } finally { if (previous === undefined) delete process.env.PATH; else process.env.PATH = previous; rmSync(dir, { recursive: true, force: true }); }
});

test('Claude prefers the supplied native saved title without needing a transcript', async () => {
  assert.equal(await sessionTitle({ agent: 'claude', session: 'owned', title: 'Saved "title"' }), 'Saved "title"');
  assert.equal(await sessionTitle({ agent: 'claude', session: 'owned', title: '' }), undefined);
  await assert.rejects(sessionTitle({ agent: 'claude', session: '../other', title: 'Wrong' }), /exact session ID/);
});

test('hook input preserves UTF-8 split across pipe chunks', () => {
  const dir = mkdtempSync(join(tmpdir(), 'titlewave-hook-utf8-'));
  const transcript = join(dir, '日本語.json');
  const env = { ...process.env, ZELLIJ: 'fixture' };
  for (const key of ['CODEX_DAEMON_SHUTDOWN_SOCKET', 'TMUX', 'STY', 'HERDR_PANE_ID', 'WEZTERM_PANE', 'KITTY_WINDOW_ID', 'ZELLIJ_PANE_ID']) delete env[key];
  try {
    writeFileSync(transcript, JSON.stringify({ sessionId: 'owned', summary: 'Safe title' }));
    for (const [script, payload, character, error] of [
      ['hooks/start.mjs', { hook_event_name: 'SessionStart', source: 'resume', session_id: 'owned', transcript_path: transcript }, '日', /ZELLIJ_PANE_ID/],
      ['hooks/context.mjs', { hook_event_name: 'SessionStart', source: 'resume', session_id: 'owned', session_title: '日\u202e語' }, '\u202e', /Use 1-200 characters/],
    ]) {
      const input = Buffer.from(JSON.stringify(payload)), split = input.indexOf(Buffer.from(character)) + 1;
      const chunks = [input.subarray(0, split), input.subarray(split)].map(chunk => chunk.toString('base64'));
      const code = `import {Readable} from 'node:stream';Object.defineProperty(process,'stdin',{value:Readable.from(${JSON.stringify(chunks)}.map(value=>Buffer.from(value,'base64')))});await import(${JSON.stringify(new URL('../' + script, import.meta.url).href)});`;
      const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], { env, encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stderr, error);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('terminal title writes serialize, skip superseded selections, and stop after disposal', async () => {
  const keys = ['CODEX_DAEMON_SHUTDOWN_SOCKET', 'TMUX', 'STY', 'ZELLIJ', 'HERDR_PANE_ID', 'WEZTERM_PANE', 'KITTY_WINDOW_ID'];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  for (const key of keys) delete process.env[key];
  let release;
  const started = [], barrier = new Promise(resolve => { release = resolve; });
  const writer = terminalTitleWriter(async title => { started.push(title); if (title === 'First') await barrier; });
  try {
    const first = writer.write('First');
    await until(() => started.length === 1);
    const stale = writer.write('Stale', () => false), latest = writer.write('Latest');
    assert.deepEqual(started, ['First']);
    release();
    await Promise.all([first, stale, latest]);
    assert.deepEqual(started, ['First', 'Latest']);
    await writer.close();
    await writer.write('Closed');
    assert.deepEqual(started, ['First', 'Latest']);
    let finish, drained = false;
    const active = [], wait = new Promise(resolve => { finish = resolve; });
    const closingWriter = terminalTitleWriter(async title => { active.push(title); await wait; });
    const firstActive = closingWriter.write('Active');
    await until(() => active.length === 1);
    const abandoned = closingWriter.write('Abandoned');
    const closing = closingWriter.close().then(() => { drained = true; });
    await delay(10);
    assert.equal(drained, false);
    finish();
    await Promise.all([firstActive, abandoned, closing]);
    assert.deepEqual(active, ['Active']);
    if (process.platform !== 'win32') {
      const directory = mkdtempSync(join(tmpdir(), 'titlewave-node-path-'));
      try {
        writeFileSync(join(directory, 'tmux'), '#!/bin/sh\ncase "$1" in display-message) echo 1;; esac\n', { mode: 0o700 });
        const result = spawnSync(process.execPath, ['--input-type=module', '-e', `import {terminalTitleWriter} from ${JSON.stringify(new URL('../lib/terminal.mjs', import.meta.url).href)}; const writer=terminalTitleWriter(()=>{throw Error('Wrong backend')}); await writer.write('Portable title'); await writer.close();`], { encoding: 'utf8', env: { ...process.env, PATH: directory, TMUX: 'fixture', TMUX_PANE: '%0' } });
        assert.equal(result.status, 0, result.stderr);
      } finally { rmSync(directory, { recursive: true, force: true }); }
    }
  } finally { release(); await writer.close(); for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
});

test('the shared hook skips Claude auto-discovery and uses native timeout defaults', () => {
  const hook = JSON.parse(readFileSync('hooks/hooks.json')).hooks.SessionStart[0].hooks[0];
  assert.equal(hook.timeout, undefined, 'Gemini and Goose use different timeout units');
  const result = spawnSync(hook.command, { shell: true, input: JSON.stringify({ hook_event_name: 'SessionStart', source: 'resume', session_id: 'owned' }), encoding: 'utf8', env: { ...process.env, CLAUDE_PLUGIN_ROOT: process.cwd(), TITLEWAVE_EXTENSION_ROOT: '${extensionPath}', PLUGIN_ROOT: process.cwd() } });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, '');
  const relative = spawnSync(hook.command, { shell: true, input: '{}', encoding: 'utf8', env: { ...process.env, CLAUDE_PLUGIN_ROOT: '', TITLEWAVE_EXTENSION_ROOT: '${extensionPath}', PLUGIN_ROOT: '.' } });
  assert.equal(relative.status, 0, relative.stderr);
  assert.equal(relative.stdout, '');
  assert.equal(relative.stderr, '');
});

test('Pi restores only named interactive sessions and reports terminal failures without blocking', async () => {
  const handlers = {};
  piTitlewave({ on: (event, fn) => { handlers[event] = fn; }, registerCommand() {}, registerTool() {} });
  const handler = handlers.session_start;
  const warnings = [];
  const ctx = { mode: 'rpc', hasUI: true, sessionManager: { getSessionName: () => 'Saved title' }, ui: { notify: (...args) => warnings.push(args) } };
  await handler({ reason: 'startup' }, ctx);
  assert.deepEqual(warnings, []);
  ctx.mode = 'tui';
  ctx.sessionManager.getSessionName = () => '\x1bunsafe';
  await handler({ reason: 'resume' }, ctx);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0][0], /resume title not restored/);
  assert.equal(warnings[0][1], 'warning');
  await handlers.session_shutdown();
});

test('OpenCode observes only its local route and ignores stale asynchronous session reads', async () => {
  const controller = new AbortController();
  const pending = new Map(), reads = [], warnings = [];
  let dispose;
  const api = {
    route: { current: { name: 'home' } },
    lifecycle: { signal: controller.signal, onDispose: fn => { dispose = fn; } },
    client: { session: { get: ({ sessionID }, { signal }) => { assert.ok(signal instanceof AbortSignal); reads.push(sessionID); return new Promise(resolve => pending.set(sessionID, resolve)); } } },
    ui: { toast: value => warnings.push(value) },
  };
  try {
    await opencodeTui.tui(api);
    assert.deepEqual(reads, []);
    api.route.current = { name: 'session', params: { sessionID: 'owned-a' } };
    await until(() => reads.length === 1);
    api.route.current = { name: 'session', params: { sessionID: 'owned-b' } };
    await until(() => reads.length === 2);
    assert.deepEqual(reads, ['owned-a', 'owned-b']);
    pending.get('owned-a')({ data: { id: 'wrong', title: '\x1bunsafe' } });
    await delay(10);
    assert.deepEqual(warnings, []);
    pending.get('owned-b')({ data: { id: 'unrelated', title: 'Other session' } });
    await until(() => reads.length === 3);
    assert.deepEqual(warnings, []);
    pending.get('owned-b')({ error: 'transient failure' });
    await until(() => reads.length === 4);
    pending.get('owned-b')({ error: 'transient failure' });
    await until(() => warnings.length === 1);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0].message, /selected session/);
    await delay(300);
    assert.equal(reads.length, 4, 'failed routes must stop after three attempts');
  } finally { controller.abort(); dispose?.(); }
  await delay(300);
  assert.equal(reads.length, 4);
});

test('OpenCode skips its native default title without retrying or touching a terminal', async () => {
  const previous = process.env.CODEX_DAEMON_SHUTDOWN_SOCKET;
  process.env.CODEX_DAEMON_SHUTDOWN_SOCKET = 'must-not-touch';
  let dispose, reads = 0;
  const controller = new AbortController(), warnings = [];
  try {
    await opencodeTui.tui({
      route: { current: { name: 'session', params: { sessionID: 'untitled' } } },
      lifecycle: { signal: controller.signal, onDispose: fn => { dispose = fn; } },
      client: { session: { get: async () => { reads++; return { data: { id: 'untitled', title: 'New session - 2026-11-25T00:00:00.000Z' } }; } } },
      ui: { toast: value => warnings.push(value) },
    });
    await delay(800);
    assert.equal(reads, 1);
    assert.deepEqual(warnings, []);
  } finally { controller.abort(); dispose?.(); if (previous === undefined) delete process.env.CODEX_DAEMON_SHUTDOWN_SOCKET; else process.env.CODEX_DAEMON_SHUTDOWN_SOCKET = previous; }
});
