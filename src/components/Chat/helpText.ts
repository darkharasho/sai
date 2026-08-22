import type { AIProvider } from '../../types';
import type { SlashCommandInfo } from '../../lib/slashCommands';

const COMMAND_LABELS: Record<AIProvider, string> = {
  claude: 'Claude Skills',
  codex: 'Codex Commands',
  gemini: 'Antigravity Commands',
  kimi: 'Kimi Commands',
};

export function buildHelpMessage(aiProvider: AIProvider, slashCommands: SlashCommandInfo[]): string {
  const cmds = slashCommands.length > 0
    ? slashCommands.map(c => (c.description ? `  /${c.name} — ${c.description}` : `  /${c.name}`)).join('\n')
    : '  No custom commands loaded';

  return `**Available Commands**\n\n**Built-in:**\n  /clear — Clear conversation\n  /help — Show this help\n\n**${COMMAND_LABELS[aiProvider]}:**\n${cmds}`;
}
