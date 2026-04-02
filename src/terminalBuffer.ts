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

/** Find the terminal for the active workspace, or fall back to the last registered one. */
function getActiveTerminal(): Terminal | null {
  let target: Terminal | null = null;
  if (activeWorkspacePath) {
    for (const [id, term] of terminals) {
      if (terminalWorkspace.get(id) === activeWorkspacePath) {
        target = term;
      }
    }
  }
  if (!target) {
    for (const [, term] of terminals) {
      target = term;
    }
  }
  return target;
}

/**
 * Read the visible content of the active workspace's terminal.
 * Falls back to the most recently registered terminal if no workspace match.
 * Returns the last `maxLines` lines of scrollback + viewport.
 */
export function getTerminalContent(maxLines = 200): string | null {
  const target = getActiveTerminal();
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

/**
 * Regex matching common shell prompt patterns.
 * Matches: user@host:~$, $, %, ❯, #, and variants with path info.
 * Note: bare '>' is excluded from single-char prompts to avoid matching npm output ("> script").
 */
const PROMPT_RE = /^(\S+[@:]\S+[\$#%>❯]|[\$#%❯])\s/;

/**
 * Extract the output from the last terminal command.
 * Scans backwards to find the last prompt line.
 * If the last non-empty line is an idle prompt, skips it.
 * Falls back to full buffer content if no prompt is detected.
 */
export function getTerminalLastCommand(maxLines = 500): string | null {
  const target = getActiveTerminal();
  if (!target) return null;

  const buf = target.buffer.active;
  const totalLines = buf.length;
  const start = Math.max(0, totalLines - maxLines);
  const lines: string[] = [];

  for (let i = start; i < totalLines; i++) {
    const line = buf.getLine(i);
    if (line) lines.push(line.translateToString(true));
  }

  // Trim trailing empty lines
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
    lines.pop();
  }

  if (lines.length === 0) return null;

  // If the last non-empty line is an idle prompt (just a prompt char, no command), skip it
  let searchEnd = lines.length;
  const lastLine = lines[lines.length - 1].trim();
  if (PROMPT_RE.test(lines[lines.length - 1]) && lastLine.match(/^(\S+[@:]\S+)?[\$#%>❯]\s*$/)) {
    searchEnd = lines.length - 1;
  }

  // Scan backwards to find the last prompt line (the command)
  for (let i = searchEnd - 1; i >= 0; i--) {
    if (PROMPT_RE.test(lines[i])) {
      const result = lines.slice(i, searchEnd);
      while (result.length > 0 && result[result.length - 1].trim() === '') {
        result.pop();
      }
      return result.length > 0 ? result.join('\n') : null;
    }
  }

  // No prompt found — fall back to full content
  const result = lines.slice(0, searchEnd);
  while (result.length > 0 && result[result.length - 1].trim() === '') {
    result.pop();
  }
  return result.length > 0 ? result.join('\n') : null;
}
