import { validateName } from '../lib/agents.mjs';

export default function titlewave(pi) {
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
