import { restoreSessionTitle } from '../lib/resume.mjs';
import { text } from 'node:stream/consumers';

let payload;
try { payload = JSON.parse(await text(process.stdin)); } catch { process.exit(0); }
const id = payload?.session_id;
if (typeof id === 'string' && /^[\w-]+$/.test(id)) {
  console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: `Titlewave current Claude session ID: ${id}. Use this ID for an explicitly requested session rename.` } }));
}
await restoreSessionTitle('claude', payload);
