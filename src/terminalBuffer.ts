import type { Terminal } from '@xterm/xterm';

// Simple registry so ChatInput can read terminal buffer content
// without prop-drilling through the component tree.

const terminals = new Map<number, Terminal>();

export function registerTerminal(id: number, term: Terminal) {
  terminals.set(id, term);
}

export function unregisterTerminal(id: number) {
  terminals.delete(id);
}

/**
 * Read the visible content of the most recently registered terminal.
 * Returns the last `maxLines` lines of scrollback + viewport.
 */
export function getTerminalContent(maxLines = 200): string | null {
  // Get the last registered terminal (most recent)
  let lastId = -1;
  let lastTerm: Terminal | null = null;
  for (const [id, term] of terminals) {
    lastId = id;
    lastTerm = term;
  }
  if (!lastTerm) return null;

  const buf = lastTerm.buffer.active;
  const totalLines = buf.length;
  const start = Math.max(0, totalLines - maxLines);
  const lines: string[] = [];

  for (let i = start; i < totalLines; i++) {
    const line = buf.getLine(i);
    if (line) {
      lines.push(line.translateToString(true));
    }
  }

  // Trim trailing empty lines
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
    lines.pop();
  }

  return lines.length > 0 ? lines.join('\n') : null;
}
