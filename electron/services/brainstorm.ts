import { randomUUID } from 'node:crypto';

export interface TranscriptTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface BrainstormSession {
  sessionId: string;
  claudeSessionId?: string;
  transcript: TranscriptTurn[];
  createdAt: number;
}

const sessions = new Map<string, BrainstormSession>();

export function createSession(): { sessionId: string } {
  const sessionId = randomUUID();
  sessions.set(sessionId, { sessionId, transcript: [], createdAt: Date.now() });
  return { sessionId };
}

export function getSession(sessionId: string): BrainstormSession | undefined {
  return sessions.get(sessionId);
}

export function deleteSession(sessionId: string): void {
  sessions.delete(sessionId);
}

/** Test-only — clears in-memory state between tests. */
export function __resetSessions(): void {
  sessions.clear();
}

export interface SynthesizeResult {
  projectName: string;
  context: string;
}

export function parseSynthesizeOutput(raw: string): SynthesizeResult {
  let text = raw.trim();

  // Strip ```json or ``` fences
  const fenceMatch = text.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/);
  if (fenceMatch) text = fenceMatch[1].trim();

  // If still not pure JSON, try to extract the first {...} block
  let jsonText = text;
  if (!jsonText.startsWith('{')) {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) {
      throw new Error('No JSON object found in output');
    }
    jsonText = text.slice(start, end + 1);
  }

  let parsed: any;
  try {
    parsed = JSON.parse(jsonText);
  } catch (e: any) {
    throw new Error(`Malformed JSON: ${e.message}`);
  }

  const projectName = typeof parsed.projectName === 'string' ? parsed.projectName.trim() : '';
  const context = typeof parsed.context === 'string' ? parsed.context.trim() : '';

  if (!projectName) throw new Error('Missing or empty projectName');
  if (projectName.length > 40) throw new Error('projectName exceeds 40 characters');
  if (!context) throw new Error('Missing or empty context');

  return { projectName, context };
}

export const BRAINSTORM_SYSTEM_PROMPT = [
  'You are helping the user think through a brand-new software project before they create the folder and scaffolding.',
  'Your job is to explore feasibility, surface trade-offs, ask about constraints, and propose options.',
  'Keep responses concise and conversational. Do NOT produce code or file structures.',
  'When the user asks you to synthesize, output strict JSON with two fields:',
  '  - projectName: kebab-case, ≤ 40 chars',
  '  - context: a 2–4 sentence summary suitable for a CLAUDE.md "Project Context" section',
  'No other text when synthesizing — just the JSON object.',
].join('\n');

export const SYNTHESIZE_PROMPT =
  'Synthesize our conversation. Respond with ONLY a JSON object: {"projectName":"...","context":"..."}. No prose, no code fences.';

export function buildClaudeArgs(opts: {
  userMessage: string;
  claudeSessionId: string | undefined;
}): string[] {
  const args: string[] = [
    '-p', opts.userMessage,
    '--output-format', 'stream-json',
    '--verbose',
    '--max-turns', '1',
  ];
  if (opts.claudeSessionId) {
    args.push('--resume', opts.claudeSessionId);
  } else {
    args.push('--append-system-prompt', BRAINSTORM_SYSTEM_PROMPT);
  }
  return args;
}

export interface StreamAccumulator {
  fullText: string;
  sessionId: string | undefined;
}

export function processStreamLine(
  line: string,
  acc: StreamAccumulator,
  onChunk: (text: string) => void,
): void {
  const trimmed = line.trim();
  if (!trimmed) return;
  let msg: any;
  try {
    msg = JSON.parse(trimmed);
  } catch {
    return;
  }

  if (msg.type === 'system' && msg.subtype === 'init' && msg.session_id) {
    acc.sessionId = msg.session_id;
    return;
  }
  if (msg.session_id && !acc.sessionId) {
    acc.sessionId = msg.session_id;
  }

  if (msg.type === 'assistant' && msg.message?.content) {
    for (const block of msg.message.content) {
      if (block.type === 'text' && typeof block.text === 'string') {
        acc.fullText += block.text;
        onChunk(block.text);
      }
    }
  }
}

import { spawn } from 'node:child_process';
import { ipcMain, BrowserWindow } from 'electron';
import os from 'node:os';

const IS_WIN = process.platform === 'win32';

interface RunTurnArgs {
  sessionId: string;
  userMessage: string;
  onChunk: (text: string) => void;
}

type RunTurnResult = { ok: true; text: string } | { ok: false; error: string };

export async function runTurn(args: RunTurnArgs): Promise<RunTurnResult> {
  const session = getSession(args.sessionId);
  if (!session) return { ok: false, error: 'Session not found' };

  const cliArgs = buildClaudeArgs({
    userMessage: args.userMessage,
    claudeSessionId: session.claudeSessionId,
  });

  return await new Promise<RunTurnResult>((resolve) => {
    let proc;
    try {
      proc = spawn('claude', cliArgs, {
        cwd: os.tmpdir(),
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: IS_WIN,
      });
    } catch (e: any) {
      resolve({ ok: false, error: e.message || 'spawn failed' });
      return;
    }

    const acc: StreamAccumulator = { fullText: '', sessionId: undefined };
    let buffer = '';
    let stderrBuf = '';

    proc.stdout?.on('data', (data: Buffer) => {
      buffer += data.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) processStreamLine(line, acc, args.onChunk);
    });

    proc.stderr?.on('data', (data: Buffer) => { stderrBuf += data.toString(); });

    proc.on('error', (e) => {
      resolve({ ok: false, error: e.message });
    });

    proc.on('exit', (code) => {
      if (buffer.trim()) processStreamLine(buffer, acc, args.onChunk);
      if (code !== 0 && !acc.fullText) {
        resolve({ ok: false, error: stderrBuf.trim() || `claude exited with code ${code}` });
        return;
      }
      if (acc.sessionId) session.claudeSessionId = acc.sessionId;
      session.transcript.push({ role: 'user', content: args.userMessage });
      session.transcript.push({ role: 'assistant', content: acc.fullText });
      resolve({ ok: true, text: acc.fullText });
    });

    proc.stdin?.end();
  });
}

export function serializeTranscript(session: BrainstormSession): string {
  return session.transcript
    .map(t => `**${t.role === 'user' ? 'User' : 'Assistant'}:** ${t.content}`)
    .join('\n\n');
}

export function registerBrainstormHandlers(win: BrowserWindow): void {
  ipcMain.handle('brainstorm:start', () => {
    return createSession();
  });

  ipcMain.handle('brainstorm:send', async (_e, sessionId: string, message: string) => {
    const onChunk = (text: string) => {
      if (!win.isDestroyed()) win.webContents.send(`brainstorm:chunk:${sessionId}`, text);
    };
    const result = await runTurn({ sessionId, userMessage: message, onChunk });
    if (!win.isDestroyed()) {
      if (result.ok) {
        win.webContents.send(`brainstorm:done:${sessionId}`, result.text);
      } else {
        win.webContents.send(`brainstorm:error:${sessionId}`, result.error);
      }
    }
    return result;
  });

  ipcMain.handle('brainstorm:synthesize', async (_e, sessionId: string) => {
    const session = getSession(sessionId);
    if (!session) return { ok: false, error: 'Session not found' };
    const noopChunk = () => {};
    const result = await runTurn({ sessionId, userMessage: SYNTHESIZE_PROMPT, onChunk: noopChunk });
    if (!result.ok) return result;
    try {
      const parsed = parseSynthesizeOutput(result.text);
      return { ok: true, ...parsed, transcript: serializeTranscript(session) };
    } catch (e: any) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('brainstorm:end', (_e, sessionId: string) => {
    deleteSession(sessionId);
    return { ok: true };
  });
}
