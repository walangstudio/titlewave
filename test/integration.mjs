import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { cpSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { withRpc } from '../lib/rpc.mjs';

const root = resolve(import.meta.dirname, '..');
const temporary = mkdtempSync(join(tmpdir(), 'titlewave-integration-'));
const home = join(temporary, 'home');
const cwd = join(temporary, 'project');
mkdirSync(home); mkdirSync(cwd);
Object.assign(process.env, { HOME: home, USERPROFILE: home, CODEX_HOME: join(home, '.codex'), CLAUDE_CONFIG_DIR: join(home, '.claude'), PI_CODING_AGENT_DIR: join(home, '.pi'), PI_OFFLINE: '1', GOOSE_PATH_ROOT: home, DISABLE_AUTOUPDATER: '1' });
mkdirSync(process.env.CODEX_HOME);
delete process.env.CLAUDECODE;
delete process.env.OPENCODE_SERVER_PASSWORD;
const run = (exe, args, options = {}) => execFileSync(exe, args, { cwd, encoding: 'utf8', timeout: 90000, killSignal: 'SIGKILL', windowsHide: true, ...options });
const cli = (...args) => run(process.execPath, [join(root, 'bin/titlewave.mjs'), ...args], { timeout: 120000 });
const results = [];
async function resumeInTerminal(title, args, extraEnv = {}) {
  const socket = `titlewave-resume-${randomUUID()}`;
  const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
  const script = join(temporary, `${socket}.sh`);
  writeFileSync(script, `#!/bin/sh\n${Object.entries(extraEnv).map(([key, value]) => `export ${key}=${quote(value)}\n`).join('')}${args.map(quote).join(' ')}\nsleep 60\n`);
  let failure;
  try {
    run('tmux', ['-L', socket, 'new-session', '-d', '-s', 'resume', '-c', cwd, 'sh', script]);
    const deadline = Date.now() + 45000;
    let labels;
    while (Date.now() < deadline) {
      labels = run('tmux', ['-L', socket, 'display-message', '-p', '#{window_name}|||#{pane_title}']);
      const restored = value => value.startsWith(`${title}|||`) && value.slice(title.length + 3).includes(title);
      if (restored(labels)) {
        await new Promise(resolve => setTimeout(resolve, 750));
        assert.ok(restored(run('tmux', ['-L', socket, 'display-message', '-p', '#{window_name}|||#{pane_title}'])), 'agent overwrote the restored title');
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    const probes = readdirSync(temporary).filter(file => file.endsWith('-hook.json')).map(file => `${file}: ${readFileSync(join(temporary, file), 'utf8')}`).join('\n');
    throw new Error(`Resume labels: ${JSON.stringify(labels)}\n${probes}\n${run('tmux', ['-L', socket, 'capture-pane', '-p', '-S', '-100'])}`);
  } catch (error) { failure = error; throw error; }
  finally {
    try { run('tmux', ['-L', socket, 'kill-server']); }
    catch (error) { if (!failure) throw error; failure.message += `\nFixture cleanup: ${error.message}`; }
  }
}
async function check(name, action) {
  if (process.env.TITLEWAVE_TEST_AGENTS && !process.env.TITLEWAVE_TEST_AGENTS.split(',').includes(name.split(' ')[0].toLowerCase())) return;
  try { await action(); results.push({ name, pass: true }); console.log(`PASS ${name}`); }
  catch (error) { results.push({ name, pass: false, error: error.message }); console.error(`FAIL ${name}: ${error.message}`); }
}

await check('Codex persisted name via real app-server, no model turn', async () => {
  writeFileSync(join(process.env.CODEX_HOME, 'config.toml'), `model = "fixture"\nmodel_provider = "fixture"\n[model_providers.fixture]\nname = "Fixture"\nbase_url = "http://127.0.0.1:9/v1"\nrequires_openai_auth = false\n[projects.${JSON.stringify(cwd)}]\ntrust_level = "trusted"\n`);
  let id, path;
  await withRpc('codex', ['app-server', '--stdio'], async request => {
    const result = await request('thread/start', { cwd });
    id = result.thread.id;
    path = result.thread.path;
  });
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify({ timestamp: new Date().toISOString(), type: 'session_meta', payload: { id, timestamp: new Date().toISOString(), cwd, originator: 'titlewave', cli_version: '0.170.0', source: 'cli', model_provider: 'fixture' } })}\n`);
  assert.match(cli('Codex integration', '--agent', 'codex', '--session', id), /Session renamed to:/);
  await withRpc('codex', ['app-server', '--stdio'], async request => {
    const result = await request('thread/read', { threadId: id, includeTurns: false });
    assert.equal(result.thread.name, 'Codex integration');
  });
  const metadata = JSON.parse(readFileSync(join(root, '.codex-plugin/plugin.json')));
  const manifest = JSON.parse(readFileSync(join(root, metadata.hooks)));
  manifest.hooks.SessionStart.push({ hooks: [{ type: 'command', command: `node "${join(root, 'test/record-hook.mjs')}" "${join(temporary, 'codex-hook.json')}"` }] });
  writeFileSync(join(process.env.CODEX_HOME, 'hooks.json'), JSON.stringify({ hooks: manifest.hooks }).replaceAll('${PLUGIN_ROOT}', root));
  await withRpc('codex', ['app-server', '--stdio'], async request => {
    const listed = await request('hooks/list', {});
    const hooks = listed.data.flatMap(entry => entry.hooks).filter(hook => hook.source === 'user');
    assert.equal(hooks.length, 2);
    writeFileSync(join(process.env.CODEX_HOME, 'config.toml'), hooks.map(hook => `\n[hooks.state.${JSON.stringify(hook.key)}]\ntrusted_hash = ${JSON.stringify(hook.currentHash)}\nenabled = true\n`).join(''), { flag: 'a' });
  });
  await resumeInTerminal('Codex integration', [process.execPath, join(root, 'bin/titlewave.mjs'), '--resume', id]);
  await resumeInTerminal('Codex integration', ['codex', '--no-daemon', 'exec', '--skip-git-repo-check', 'resume', id, 'Owned fixture; the model endpoint is intentionally offline.']);
  const hook = JSON.parse(readFileSync(join(temporary, 'codex-hook.json'))).payload;
  assert.equal(hook.source, 'resume');
  assert.equal(hook.session_id, id);
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
  await resumeInTerminal('Pi extension integration', ['pi', '--offline', '--session', piFile, '--no-extensions', '-e', join(root, 'extensions/pi.mjs')]);
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
  const plugins = join(home, '.agents/plugins/titlewave');
  cpSync(root, plugins, { recursive: true, filter: path => !['.git', '.evidence', '.research'].includes(basename(path)) });
  await resumeInTerminal('Goose integration', ['goose', 'session', '--resume', '--session-id', id, '--no-profile'], { GOOSE_PROVIDER: 'openai', GOOSE_MODEL: 'fixture', OPENAI_API_KEY: 'fixture-no-request', GOOSE_TELEMETRY_OFF: '1' });
});

await check('Gemini lists an offline JSONL summary without changing messages', async () => {
  const env = { ...process.env, GEMINI_API_KEY: 'titlewave-offline-listing-only' };
  run('gemini', ['--list-sessions'], { env });
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
  const listing = run('gemini', ['--list-sessions'], { env });
  writeFileSync(join(temporary, 'gemini-list.txt'), listing);
  assert.match(listing, /Gemini integration/);
  writeFileSync(join(home, '.gemini/settings.json'), JSON.stringify({ general: { enableAutoUpdate: false, enableAutoUpdateNotification: false }, hooks: { SessionStart: [{ hooks: [{ type: 'command', command: `node "${join(root, 'test/record-hook.mjs')}" "${join(temporary, 'gemini-hook.json')}"` }] }] } }));
  run('gemini', ['extensions', 'link', root, '--consent'], { env });
  await resumeInTerminal('Gemini integration', ['gemini', '--resume', id], { GEMINI_API_KEY: env.GEMINI_API_KEY });
});

await check('Claude renames a real resumable fixture without a model turn', async () => {
  const id = randomUUID();
  const directory = join(home, '.claude', 'projects', cwd.replace(/[^a-zA-Z0-9]/g, '-'));
  mkdirSync(directory, { recursive: true });
  const file = join(directory, `${id}.jsonl`);
  writeFileSync(file, `${JSON.stringify({ parentUuid: null, isSidechain: false, userType: 'external', cwd, sessionId: id, version: '2.1.328', type: 'user', message: { role: 'user', content: 'Integration fixture, no model request.' }, uuid: randomUUID(), timestamp: now })}\n`);
  assert.match(cli('Claude integration', '--agent', 'claude', '--session', id), /Session renamed to:/);
  assert.ok(readFileSync(file, 'utf8').split('\n').filter(Boolean).map(JSON.parse).some(entry => entry.type === 'custom-title' && entry.customTitle === 'Claude integration'));
  writeFileSync(join(process.env.CLAUDE_CONFIG_DIR, '.claude.json'), JSON.stringify({ hasCompletedOnboarding: true, theme: 'dark', customApiKeyResponses: { approved: ['fixture-no-request'], rejected: [] }, projects: { [cwd]: { hasTrustDialogAccepted: true } } }));
  await resumeInTerminal('Claude integration', ['claude', '--resume', id, '--setting-sources', '', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--plugin-dir', root], { ANTHROPIC_API_KEY: 'fixture-no-request', ANTHROPIC_BASE_URL: 'http://127.0.0.1:9' });
  await resumeInTerminal('Claude integration', ['claude', '--resume', id, '--fork-session', '--setting-sources', '', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--plugin-dir', root], { ANTHROPIC_API_KEY: 'fixture-no-request', ANTHROPIC_BASE_URL: 'http://127.0.0.1:9' });
  if (process.platform !== 'win32') {
    const status = run('bash', [join(root, 'cc-title-statusline.sh')], { input: JSON.stringify({ transcript_path: file, model: { display_name: 'Test' }, workspace: { current_dir: join(home, 'example') } }) });
    assert.match(status, /\[Claude integration\]/);
    assert.match(status, /~\/example/);
    const sibling = join(`${home}2`, 'example');
    assert.ok(run('bash', [join(root, 'cc-title-statusline.sh')], { input: JSON.stringify({ workspace: { current_dir: sibling } }) }).includes(sibling));
  }
});

await check('OpenCode creates and renames a real server-owned session', async () => {
  const config = join(home, 'config', 'opencode');
  if (process.env.TITLEWAVE_OPENCODE_SDK) cpSync(process.env.TITLEWAVE_OPENCODE_SDK, config, { recursive: true, verbatimSymlinks: true });
  else run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--prefix', config, '@opencode-ai/plugin@1.19.6'], { timeout: 300000 });
  const port = 42000 + Math.floor(Math.random() * 10000);
  const url = `http://127.0.0.1:${port}`;
  const env = { ...process.env, XDG_CONFIG_HOME: join(home, 'config'), XDG_DATA_HOME: join(home, 'data'), XDG_CACHE_HOME: join(home, 'cache'), OPENCODE_DISABLE_DEFAULT_PLUGINS: 'true', OPENCODE_DISABLE_AUTOUPDATE: 'true', OPENCODE_DISABLE_MODELS_FETCH: 'true', OPENCODE_DISABLE_EMBEDDED_WEB_UI: 'true', OPENCODE_CONFIG_CONTENT: JSON.stringify({ plugin: [pathToFileURL(join(root, 'extensions/opencode.mjs')).href] }) };
  const server = spawn('opencode', ['serve', '--print-logs', '--log-level', 'DEBUG', '--hostname', '127.0.0.1', '--port', String(port)], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let logs = ''; server.stdout.on('data', data => { logs += data; }); server.stderr.on('data', data => { logs += data; });
  server.on('exit', (code, signal) => { logs += `\nOpenCode exited (${code}, ${signal})`; });
  try {
    let ready = false;
    for (let attempt = 0; attempt < 120; attempt++) {
      if (server.exitCode !== null || server.signalCode !== null) break;
      try { if ((await (await fetch(`${url}/global/health`, { signal: AbortSignal.timeout(1000) })).json()).healthy) { ready = true; break; } } catch {}
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    assert.ok(ready, logs || 'OpenCode server did not become healthy');
    const commands = await (await fetch(`${url}/command`, { signal: AbortSignal.timeout(90000) })).json();
    assert.ok(commands.some(command => command.name === 'titlewave' && command.template.includes('$ARGUMENTS')), logs || 'OpenCode titlewave command was not registered');
    const created = await fetch(`${url}/session`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Before' }), signal: AbortSignal.timeout(15000) });
    assert.ok(created.ok, `${created.status}: ${logs}`);
    const session = await created.json();
    assert.match(cli('OpenCode integration', '--agent', 'opencode', '--session', session.id, '--url', url), /Session renamed to:/);
    const saved = await (await fetch(`${url}/session/${session.id}`, { signal: AbortSignal.timeout(15000) })).json();
    assert.equal(saved.title, 'OpenCode integration');
    writeFileSync(join(config, 'tui.json'), JSON.stringify({ plugin: [pathToFileURL(join(root, 'extensions/opencode-tui.mjs')).href] }));
    await resumeInTerminal('OpenCode integration', ['opencode', 'attach', url, '--session', session.id], { XDG_CONFIG_HOME: env.XDG_CONFIG_HOME, XDG_DATA_HOME: env.XDG_DATA_HOME, XDG_CACHE_HOME: env.XDG_CACHE_HOME, OPENCODE_DISABLE_DEFAULT_PLUGINS: 'true', OPENCODE_DISABLE_AUTOUPDATE: 'true', OPENCODE_DISABLE_MODELS_FETCH: 'true' });
  } catch (error) { throw new Error(`${error.message}\n${logs}`); }
  finally { server.kill('SIGKILL'); }
});

mkdirSync(join(root, '.evidence'), { recursive: true });
writeFileSync(join(root, '.evidence', 'agents.json'), JSON.stringify({ date: now, temporary, results }, null, 2));
console.log(`Evidence: ${temporary}`);
if (results.some(result => !result.pass)) process.exitCode = 1;
