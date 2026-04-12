type AIProvider = 'claude' | 'codex' | 'gemini';

const COMMAND_LABELS: Record<AIProvider, string> = {
  claude: 'Claude Skills',
  codex: 'Codex Commands',
  gemini: 'Gemini Commands',
};

export function buildHelpMessage(aiProvider: AIProvider, slashCommands: string[]): string {
  const cmds = slashCommands.length > 0
    ? slashCommands.map(c => `  /${c}`).join('\n')
    : '  No custom commands loaded';

  return `**Available Commands**\n\n**Built-in:**\n  /clear — Clear conversation\n  /help — Show this help\n\n**${COMMAND_LABELS[aiProvider]}:**\n${cmds}`;
}
