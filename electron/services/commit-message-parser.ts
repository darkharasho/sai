export function extractCodexCommitMessage(output: string): string {
  const candidates: string[] = [];

  for (const rawLine of output.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;

    try {
      const parsed = JSON.parse(line);

      if (parsed?.type === 'item.completed') {
        const item = parsed.item;
        if (item?.type === 'agent_message' && typeof item.text === 'string' && item.text.trim()) {
          candidates.push(item.text.trim());
          continue;
        }
      }

      if (parsed?.type === 'message' && typeof parsed.content === 'string' && parsed.content.trim()) {
        candidates.push(parsed.content.trim());
      }
    } catch {
      // Ignore malformed JSONL lines from CLI output.
    }
  }

  return candidates.at(-1) ?? output.trim();
}
