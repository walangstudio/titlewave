import { validateName } from '../lib/agents.mjs';
import { terminalTitleWriter } from '../lib/terminal.mjs';

export default function titlewave(pi) {
  let writer;
  pi.on('session_start', async (_event, ctx) => {
    const name = ctx.sessionManager.getSessionName();
    if (ctx.mode !== 'tui' || !name) return;
    try {
      writer ||= terminalTitleWriter(title => ctx.ui.setTitle(title));
      await writer.write(name);
    }
    catch (error) { ctx.ui.notify(`Titlewave: resume title not restored: ${error.message}`, 'warning'); }
  });
  pi.on('session_shutdown', async () => { await writer?.close(); writer = undefined; });
  const rename = name => {
    validateName(name);
    pi.setSessionName(name);
    return `Session renamed to: ${name}`;
  };
  pi.registerCommand('titlewave', {
    description: 'Rename this session',
    handler: async (args, ctx) => { ctx.ui.notify(rename(args), 'info'); },
  });
  pi.registerTool({
    name: 'titlewave', label: 'Titlewave', description: 'Rename the current session when the user asks for a session name.',
    parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'], additionalProperties: false },
    execute: async (_id, { name }) => ({ content: [{ type: 'text', text: rename(name) }], details: {} }),
  });
}
