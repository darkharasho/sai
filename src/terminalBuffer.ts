import type { Terminal } from '@xterm/xterm';

// Simple registry so ChatInput can read terminal buffer content
// without prop-drilling through the component tree.

const terminals = new Map<number, Terminal>();
const terminalWorkspace = new Map<number, string>();
let activeWorkspacePath: string | null = null;

const activeTerminals = new Map<string, number>(); // workspacePath → active terminal ID
const terminalNames = new Map<number, string>();    // terminal ID → user-assigned name

export function registerTerminal(id: number, term: Terminal, workspacePath?: string) {
  terminals.set(id, term);
  if (workspacePath) terminalWorkspace.set(id, workspacePath);
}

export function unregisterTerminal(id: number) {
  terminals.delete(id);
  const workspace = terminalWorkspace.get(id);
  terminalWorkspace.delete(id);
  terminalNames.delete(id);
  if (workspace && activeTerminals.get(workspace) === id) {
    activeTerminals.delete(workspace);
  }
}

export function setActiveWorkspace(path: string | null) {
  activeWorkspacePath = path;
}

/** Set the explicitly active terminal ID for a workspace. */
export function setActiveTerminalId(workspacePath: string, id: number) {
  activeTerminals.set(workspacePath, id);
}

/** Get the ID of the active workspace's terminal (for IPC calls). */
export function getActiveTerminalId(): number | null {
  if (activeWorkspacePath) {
    // Check explicitly set active terminal first
    const explicitId = activeTerminals.get(activeWorkspacePath);
    if (explicitId !== undefined && terminals.has(explicitId)) {
      return explicitId;
    }
    // Fall back to iterating workspace terminals
    for (const [id] of terminals) {
      if (terminalWorkspace.get(id) === activeWorkspacePath) {
        return id;
      }
    }
  }
  // Fallback: last registered
  let lastId: number | null = null;
  for (const [id] of terminals) {
    lastId = id;
  }
  return lastId;
}

/** Set or clear a user-assigned name for a terminal. */
export function updateTerminalName(id: number, name: string | null) {
  if (name === null) {
    terminalNames.delete(id);
  } else {
    terminalNames.set(id, name);
  }
}

/** Find the terminal for the active workspace, or fall back to the last registered one. */
function getActiveTerminal(): Terminal | null {
  if (activeWorkspacePath) {
    // Check explicitly set active terminal first
    const explicitId = activeTerminals.get(activeWorkspacePath);
    if (explicitId !== undefined) {
      const term = terminals.get(explicitId);
      if (term) return term;
    }
    // Fall back to iterating workspace terminals
    let target: Terminal | null = null;
    for (const [id, term] of terminals) {
      if (terminalWorkspace.get(id) === activeWorkspacePath) {
        target = term;
      }
    }
    if (target) return target;
  }
  // Fallback: last registered
  let target: Terminal | null = null;
  for (const [, term] of terminals) {
    target = term;
  }
  return target;
}

/** Shared helper: read and return lines from a terminal, trimming trailing empty lines. */
function readTerminalContent(term: Terminal, maxLines: number): string | null {
  const buf = term.buffer.active;
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
 * Read the visible content of the active workspace's terminal.
 * Falls back to the most recently registered terminal if no workspace match.
 * Returns the last `maxLines` lines of scrollback + viewport.
 */
export function getTerminalContent(maxLines = 200): string | null {
  const target = getActiveTerminal();
  if (!target) return null;
  return readTerminalContent(target, maxLines);
}

/** Get terminal buffer content by PTY ID. Returns null if the ID is not registered. */
export function getTerminalById(id: number, maxLines = 200): string | null {
  const term = terminals.get(id);
  if (!term) return null;
  return readTerminalContent(term, maxLines);
}

/** Get terminal buffer content by user-assigned name within a workspace. */
export function getTerminalByName(name: string, workspacePath: string, maxLines = 200): string | null {
  for (const [id, termName] of terminalNames) {
    if (termName === name && terminalWorkspace.get(id) === workspacePath) {
      const term = terminals.get(id);
      if (term) return readTerminalContent(term, maxLines);
    }
  }
  return null;
}

/** Get terminal buffer content by 1-based tab index from an ordered ID array. */
export function getTerminalByIndex(index: number, orderedIds: number[], maxLines = 200): string | null {
  if (index < 1 || index > orderedIds.length) return null;
  const id = orderedIds[index - 1];
  const term = terminals.get(id);
  if (!term) return null;
  return readTerminalContent(term, maxLines);
}

/**
 * Regex matching common shell prompt patterns.
 * Matches: user@host:~$, $, %, ❯, #, and variants with path info.
 * Note: bare '>' is excluded from single-char prompts to avoid matching npm output ("> script").
 */
const PROMPT_RE = /^(\S+[@:]\S+[\$#%>❯]|[\$#%❯])\s/;

/**
 * Get the name of the last command entered in the terminal.
 * Parses the prompt line to extract the first word after the prompt character.
 * Returns null if no prompt/command is found or if the terminal is idle.
 */
export function getLastCommandName(): string | null {
  const target = getActiveTerminal();
  if (!target) return null;

  const buf = target.buffer.active;
  const totalLines = buf.length;
  const start = Math.max(0, totalLines - 200);
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

  // Skip idle prompt at bottom
  let searchEnd = lines.length;
  const lastLine = lines[lines.length - 1].trim();
  if (PROMPT_RE.test(lines[lines.length - 1]) && lastLine.match(/^(\S+[@:]\S+)?[\$#%>❯]\s*$/)) {
    searchEnd = lines.length - 1;
  }

  // Find the last prompt line with a command
  for (let i = searchEnd - 1; i >= 0; i--) {
    const match = lines[i].match(PROMPT_RE);
    if (match) {
      // Text after the prompt is the command — get the first word
      const afterPrompt = lines[i].slice(match[0].length).trim();
      if (!afterPrompt) continue;
      const cmd = afterPrompt.split(/\s/)[0];
      // Strip path prefixes and common wrappers like sudo, env, etc.
      const base = cmd.split('/').pop() || cmd;
      return base || null;
    }
  }

  return null;
}

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
