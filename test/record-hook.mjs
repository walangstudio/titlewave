import { writeFileSync, readFileSync } from 'node:fs';
import { text } from 'node:stream/consumers';

const payload = JSON.parse(await text(process.stdin));
let metadata;
try {
  metadata = readFileSync(payload.transcript_path, 'utf8').split('\n').filter(line => /"(?:summary|sessionId)"/.test(line)).map(line => { try { const value = JSON.parse(line); return { sessionId: value.sessionId, summary: value.summary, set: value.$set }; } catch { return { partial: true }; } });
} catch (error) { metadata = { error: error.code }; }
writeFileSync(process.argv[2], JSON.stringify({ payload, metadata, daemon: Boolean(process.env.CODEX_DAEMON_SHUTDOWN_SOCKET) }));
console.log('{}');
