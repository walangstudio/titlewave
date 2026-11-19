import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { withRpc } from '../lib/rpc.mjs';

const root = resolve(import.meta.dirname, '..');
const temporary = mkdtempSync(join(tmpdir(), 'titlewave-integration-'));
const home = join(temporary, 'home');
const cwd = join(temporary, 'project');
mkdirSync(home); mkdirSync(cwd);
Object.assign(process.env, { HOME: home, USERPROFILE: home, CODEX_HOME: join(home, '.codex'), CLAUDE_CONFIG_DIR: join(home, '.claude'), PI_CODING_AGENT_DIR: join(home, '.pi'), PI_OFFLINE: '1', GOOSE_PATH_ROOT: home });
mkdirSync(process.env.CODEX_HOME);
delete process.env.CLAUDECODE;
delete process.env.OPENCODE_SERVER_PASSWORD;
const run = (exe, args, options = {}) => execFileSync(exe, args, { cwd, encoding: 'utf8', timeout: 90000, windowsHide: true, ...options });
const cli = (...args) => run(process.execPath, [join(root, 'bin/titlewave.mjs'), ...args]);
const results = [];
async function check(name, action) {
  if (process.env.TITLEWAVE_TEST_AGENTS && !process.env.TITLEWAVE_TEST_AGENTS.split(',').includes(name.split(' ')[0].toLowerCase())) return;
  try { await action(); results.push({ name, pass: true }); console.log(`PASS ${name}`); }
  catch (error) { results.push({ name, pass: false, error: error.message }); console.error(`FAIL ${name}: ${error.message}`); }
}

await check('Codex persisted name via real app-server, no model turn', async () => {
  let id, path;
  await withRpc('codex', ['app-server', '--stdio'], async request => {
    const result = await request('thread/start', { cwd });
    id = result.thread.id;
    path = result.thread.path;
  });
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify({ timestamp: new Date().toISOString(), type: 'session_meta', payload: { id, timestamp: new Date().toISOString(), cwd, originator: 'titlewave', cli_version: '0.170.0', source: 'cli', model_provider: 'openai' } })}\n`);
  assert.match(cli('Codex integration', '--agent', 'codex', '--session', id), /Session renamed to:/);
  await withRpc('codex', ['app-server', '--stdio'], async request => {
    const result = await request('thread/read', { threadId: id, includeTurns: false });
    assert.equal(result.thread.name, 'Codex integration');
  });
});

const piId = randomUUID();
const piFile = join(temporary, 'pi.jsonl');
const now = new Date().toISOString();
writeFileSync(piFile, [
  { type: 'session', version: 3, id: piId, timestamp: now, cwd },
  { type: 'message', id: '1234abcd', parentId: null, timestamp: now, message: { role: 'user', content: [{ type: 'text', text: 'Integration fixture, no model request.' }], timestamp: Date.now() } },
].map(value => JSON.stringify(value)).join('\n') + '\n');
await check('Pi closed session rename through real RPC', async () => {
  assert.match(cli('Pi integration', '--agent', 'pi', '--session', piFile, '--offline'), /Session renamed to:/);
  await withRpc('pi', ['--mode', 'rpc', '--session', piFile, '--no-extensions'], async request => {
    assert.equal((await request('get_state')).sessionName, 'Pi integration');
  }, 'pi');
});
await check('Pi loads the real extension and exposes its command', async () => {
  await withRpc('pi', ['--mode', 'rpc', '--session', piFile, '--no-extensions', '-e', join(root, 'extensions/pi.mjs')], async request => {
    const commands = await request('get_commands');
    assert.ok(commands.commands.some(command => command.name === 'titlewave'));
    await request('prompt', { message: '/titlewave Pi extension integration' });
    assert.equal((await request('get_state')).sessionName, 'Pi extension integration');
  }, 'pi');
});

await check('Goose imports a session, renames it, and lists the saved name', async () => {
  const imported = run('goose', ['session', 'import', piFile]);
  const listing = run('goose', ['session', 'list', '--format', 'json']);
  writeFileSync(join(temporary, 'goose-list.json'), listing);
  const sessions = JSON.parse(listing);
  const id = (Array.isArray(sessions) ? sessions[0] : sessions.sessions[0]).id;
  assert.ok(id, imported);
  assert.match(cli('Goose integration', '--agent', 'goose', '--session', id), /Session renamed to:/);
  assert.match(run('goose', ['session', 'list']), /Goose integration/);
});

await check('Gemini lists an offline JSONL summary without changing messages', async () => {
  process.env.GEMINI_API_KEY = 'titlewave-offline-listing-only';
  run('gemini', ['--list-sessions']);
  const hash = createHash('sha256').update(cwd).digest('hex');
  const chats = join(home, '.gemini', 'tmp', hash, 'chats'); mkdirSync(chats, { recursive: true });
  const id = randomUUID();
  const file = join(chats, `session-${now.slice(0, 16).replaceAll(':', '-')}-${id.slice(0, 8)}.jsonl`);
  const original = [
    { sessionId: id, projectHash: hash, startTime: now, lastUpdated: now },
    { id: randomUUID(), timestamp: now, type: 'user', content: 'Gemini integration fixture' },
  ].map(value => JSON.stringify(value)).join('\n') + '\n';
  writeFileSync(file, original);
  cli('Gemini integration', '--agent', 'gemini', '--session', id, '--offline', '--transcript', file);
  assert.ok(readFileSync(file, 'utf8').startsWith(original));
  const listing = run('gemini', ['--list-sessions']);
  writeFileSync(join(temporary, 'gemini-list.txt'), listing);
  assert.match(listing, /Gemini integration/);
});

await check('Claude renames a real resumable fixture without a model turn', async () => {
  const id = randomUUID();
  const directory = join(home, '.claude', 'projects', cwd.replace(/[^a-zA-Z0-9]/g, '-'));
  mkdirSync(directory, { recursive: true });
  const file = join(directory, `${id}.jsonl`);
  writeFileSync(file, `${JSON.stringify({ parentUuid: null, isSidechain: false, userType: 'external', cwd, sessionId: id, version: '2.1.328', type: 'user', message: { role: 'user', content: 'Integration fixture, no model request.' }, uuid: randomUUID(), timestamp: now })}\n`);
  assert.match(cli('Claude integration', '--agent', 'claude', '--session', id), /Session renamed to:/);
  assert.ok(readFileSync(file, 'utf8').split('\n').filter(Boolean).map(JSON.parse).some(entry => entry.type === 'custom-title' && entry.customTitle === 'Claude integration'));
  if (process.platform !== 'win32') {
    const status = run('bash', [join(root, 'cc-title-statusline.sh')], { input: JSON.stringify({ transcript_path: file, model: { display_name: 'Test' }, workspace: { current_dir: join(home, 'example') } }) });
    assert.match(status, /\[Claude integration\]/);
    assert.match(status, /~\/example/);
    const sibling = join(`${home}2`, 'example');
    assert.ok(run('bash', [join(root, 'cc-title-statusline.sh')], { input: JSON.stringify({ workspace: { current_dir: sibling } }) }).includes(sibling));
  }
});

await check('OpenCode creates and renames a real server-owned session', async () => {
  const port = 42000 + Math.floor(Math.random() * 10000);
  const url = `http://127.0.0.1:${port}`;
  const server = spawn('opencode', ['serve', '--pure', '--hostname', '127.0.0.1', '--port', String(port)], { cwd, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let logs = ''; server.stdout.on('data', data => { logs += data; }); server.stderr.on('data', data => { logs += data; });
  try {
    let ready = false;
    for (let attempt = 0; attempt < 120; attempt++) {
      try { if ((await (await fetch(`${url}/global/health`, { signal: AbortSignal.timeout(1000) })).json()).healthy) { ready = true; break; } } catch {}
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    assert.ok(ready, logs);
    const created = await fetch(`${url}/session`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Before' }), signal: AbortSignal.timeout(15000) });
    assert.ok(created.ok, `${created.status}: ${logs}`);
    const session = await created.json();
    assert.match(cli('OpenCode integration', '--agent', 'opencode', '--session', session.id, '--url', url), /Session renamed to:/);
    const saved = await (await fetch(`${url}/session/${session.id}`, { signal: AbortSignal.timeout(15000) })).json();
    assert.equal(saved.title, 'OpenCode integration');
  } finally { server.kill(); }
});

mkdirSync(join(root, '.evidence'), { recursive: true });
writeFileSync(join(root, '.evidence', 'agents.json'), JSON.stringify({ date: now, temporary, results }, null, 2));
console.log(`Evidence: ${temporary}`);
if (results.some(result => !result.pass)) process.exitCode = 1;
