import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { restoreSessionTitle } from '../lib/resume.mjs';

assert.equal(process.argv[2], 'terminal');
assert.equal(process.argv.length, 4);
const dir = mkdtempSync(join(tmpdir(), 'titlewave-resume-terminal-'));
try {
  const id = randomUUID(), file = join(dir, `${id}.jsonl`);
  const original = JSON.stringify({ type: 'custom-title', customTitle: process.argv[3], sessionId: id }) + '\n';
  writeFileSync(file, original);
  const host = await restoreSessionTitle('claude', { hook_event_name: 'SessionStart', source: 'resume', session_id: id, transcript_path: file });
  assert.ok(host, 'Resume did not restore a title');
  assert.equal(readFileSync(file, 'utf8'), original);
  console.log(host === 'osc' ? 'Title escape sent; visible terminal label not verified.' : `Resume title restored (${host}).`);
} finally { rmSync(dir, { recursive: true, force: true }); }
