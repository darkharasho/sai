import type { Terminal } from '@xterm/xterm';

// Simple registry so ChatInput can read terminal buffer content
// without prop-drilling through the component tree.

const terminals = new Map<number, Terminal>();
const terminalWorkspace = new Map<number, string>();
let activeWorkspacePath: string | null = null;

export function registerTerminal(id: number, term: Terminal, workspacePath?: string) {
  terminals.set(id, term);
  if (workspacePath) terminalWorkspace.set(id, workspacePath);
}

export function unregisterTerminal(id: number) {
  terminals.delete(id);
  terminalWorkspace.delete(id);
}

export function setActiveWorkspace(path: string | null) {
  activeWorkspacePath = path;
}

/**
 * Read the visible content of the active workspace's terminal.
 * Falls back to the most recently registered terminal if no workspace match.
 * Returns the last `maxLines` lines of scrollback + viewport.
 */
export function getTerminalContent(maxLines = 200): string | null {
  let target: Terminal | null = null;

  // Prefer the terminal belonging to the active workspace
  if (activeWorkspacePath) {
    for (const [id, term] of terminals) {
      if (terminalWorkspace.get(id) === activeWorkspacePath) {
        target = term;
      }
    }
  }

  // Fallback: last registered terminal
  if (!target) {
    for (const [, term] of terminals) {
      target = term;
    }
  }

  if (!target) return null;

  const buf = target.buffer.active;
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
