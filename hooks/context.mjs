let input = '';
for await (const chunk of process.stdin) input += chunk;
let payload;
try { payload = JSON.parse(input); } catch { process.exit(0); }
const id = payload?.session_id;
if (typeof id === 'string' && /^[\w-]+$/.test(id)) {
  console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: `Titlewave current Claude session ID: ${id}. Use this ID for an explicitly requested session rename.` } }));
}
