import { fileURLToPath } from 'node:url';

const skill = fileURLToPath(new URL('../skills/titlewave/SKILL.md', import.meta.url));

export default async function titlewave({ serverUrl }) {
  const url = new URL(serverUrl);
  url.username = ''; url.password = ''; url.search = ''; url.hash = '';
  return {
    config: async config => {
      config.command ||= {};
      config.command.titlewave ||= { description: 'Rename the current session with titlewave', template: 'Use the titlewave skill to rename this session to: $ARGUMENTS' };
    },
    'experimental.chat.system.transform': async ({ sessionID }, { system }) => {
      if (typeof sessionID !== 'string' || !/^[\w-]+$/.test(sessionID)) return;
      system.push(`For an explicit session or terminal rename request, read the titlewave skill at ${JSON.stringify(skill)}. This agent is OpenCode. Its current session ID is ${JSON.stringify(sessionID)} and its owning server URL is ${JSON.stringify(url.href)}. Use --agent opencode and these exact --session and --url values for a saved rename; never use another agent's inherited identity.`);
    },
  };
}
