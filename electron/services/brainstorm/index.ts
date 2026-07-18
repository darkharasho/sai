import { randomUUID } from 'node:crypto';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { ipcMain, BrowserWindow } from 'electron';
import { enrichedEnv } from '../shellEnv';
import { createEmptyBrief, applyBriefUpdate, type ProjectBrief } from './brief';
import { buildBriefMcpServer, BRIEF_MCP_SERVER_NAME } from './briefMcpServer';
import { BRAINSTORM_SYSTEM_PROMPT } from './prompts';

export { type ProjectBrief } from './brief';

export interface TranscriptTurn { role: 'user' | 'assistant'; content: string }

export interface BrainstormSession {
  sessionId: string;
  transcript: TranscriptTurn[];
  brief: ProjectBrief;
  /** Human-readable notes of direct UI edits, injected into the next turn's prompt. */
  pendingEdits: string[];
  createdAt: number;
}

const sessions = new Map<string, BrainstormSession>();

export function createSession(): { sessionId: string } {
  const sessionId = randomUUID();
  sessions.set(sessionId, {
    sessionId, transcript: [], brief: createEmptyBrief(), pendingEdits: [], createdAt: Date.now(),
  });
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

// Stateless transcript replay (same rationale as the old CLI flow: no reliance
// on cross-process session resume). Pending UI edits are drained into the
// prompt so the model builds on them instead of reverting them.
export function composeTurnPrompt(session: BrainstormSession, userMessage: string): string {
  const edits = session.pendingEdits.splice(0);
  if (session.transcript.length === 0 && edits.length === 0) return userMessage;
  const lines: string[] = ['Conversation so far:', ''];
  for (const turn of session.transcript) {
    lines.push(turn.role === 'user' ? `User: ${turn.content}` : `You: ${turn.content}`);
    lines.push('');
  }
  for (const edit of edits) {
    lines.push(`[User edited the brief: ${edit}]`);
    lines.push('');
  }
  lines.push(`User's next message: ${userMessage}`);
  return lines.join('\n');
}

export function serializeTranscript(session: BrainstormSession): string {
  return session.transcript
    .map(t => `**${t.role === 'user' ? 'User' : 'Assistant'}:** ${t.content}`)
    .join('\n\n');
}

type QueryFn = (args: { prompt: string; options: Record<string, unknown> }) => AsyncIterable<any>;

let queryFnOverride: QueryFn | null = null;
export function __setQueryFnForTest(fn: QueryFn | null): void { queryFnOverride = fn; }

function resolveQueryFn(): QueryFn {
  if (queryFnOverride) return queryFnOverride;
  // Lazy require: keeps unit tests (and app startup) from paying SDK load cost
  // until the first brainstorm turn. Same pattern as sdkBackend.ts.
  return require('@anthropic-ai/claude-agent-sdk').query;
}

interface RunTurnArgs {
  sessionId: string;
  userMessage: string;
  onChunk: (text: string) => void;
  onBrief: (brief: ProjectBrief) => void;
}

type RunTurnResult = { ok: true; text: string } | { ok: false; error: string };

export async function runTurn(args: RunTurnArgs): Promise<RunTurnResult> {
  const session = getSession(args.sessionId);
  if (!session) return { ok: false, error: 'Session not found' };

  const briefServer = buildBriefMcpServer({
    getBrief: () => session.brief,
    setBrief: (b) => { session.brief = b; args.onBrief(b); },
  });

  const prompt = composeTurnPrompt(session, args.userMessage);
  const options = {
    // Full-replacement system prompt: brainstorming is a conversation, not a
    // coding session — no claude_code preset, no project settings, no plugins
    // (mirrors the old --setting-sources '' rationale: SessionStart hooks like
    // superpowers would hijack the turn).
    systemPrompt: BRAINSTORM_SYSTEM_PROMPT,
    settingSources: [] as string[],
    permissionMode: 'bypassPermissions',   // safe: no built-in tools are exposed
    tools: [] as string[],                 // update_brief (MCP) is the only tool
    mcpServers: { [BRIEF_MCP_SERVER_NAME]: briefServer },
    maxTurns: 8,                            // text + a few update_brief calls
    cwd: os.tmpdir(),
    env: enrichedEnv(),
  };

  let fullText = '';
  try {
    const q = resolveQueryFn()({ prompt, options });
    for await (const msg of q) {
      if (msg?.type === 'assistant' && msg.message?.content) {
        for (const block of msg.message.content) {
          if (block.type === 'text' && typeof block.text === 'string') {
            fullText += block.text;
            args.onChunk(block.text);
          }
        }
      }
    }
  } catch (e: any) {
    console.error('[brainstorm] SDK turn failed:', e);
    return { ok: false, error: e?.message || 'brainstorm turn failed' };
  }

  session.transcript.push({ role: 'user', content: args.userMessage });
  session.transcript.push({ role: 'assistant', content: fullText });
  return { ok: true, text: fullText };
}

export function registerBrainstormHandlers(win: BrowserWindow): void {
  ipcMain.handle('brainstorm:start', () => createSession());

  ipcMain.handle('brainstorm:send', async (_e, sessionId: string, message: string) => {
    const send = (channel: string, payload: unknown) => {
      if (!win.isDestroyed()) win.webContents.send(channel, payload);
    };
    const result = await runTurn({
      sessionId,
      userMessage: message,
      onChunk: (text) => send(`brainstorm:chunk:${sessionId}`, text),
      onBrief: (brief) => send(`brainstorm:brief:${sessionId}`, brief),
    });
    if (result.ok) send(`brainstorm:done:${sessionId}`, result.text);
    else send(`brainstorm:error:${sessionId}`, result.error);
    return result;
  });

  ipcMain.handle('brainstorm:getBrief', (_e, sessionId: string) => {
    const session = getSession(sessionId);
    if (!session) return { ok: false, error: 'Session not found' };
    return { ok: true, brief: session.brief, transcript: serializeTranscript(session) };
  });

  // Direct UI edit: validated through the same merge as the model's tool calls.
  // Last-writer-wins; a human-readable note is queued for the next turn's prompt.
  ipcMain.handle('brainstorm:editBrief', (_e, sessionId: string, patch: Record<string, unknown>) => {
    const session = getSession(sessionId);
    if (!session) return { ok: false, error: 'Session not found' };
    const result = applyBriefUpdate(session.brief, patch);
    if (!result.ok) return { ok: false, error: result.errors.join('; ') };
    session.brief = result.brief;
    for (const [key, value] of Object.entries(patch)) {
      session.pendingEdits.push(`${key} → ${JSON.stringify(value)}`);
    }
    if (!win.isDestroyed()) win.webContents.send(`brainstorm:brief:${sessionId}`, session.brief);
    return { ok: true, brief: session.brief };
  });

  ipcMain.handle('brainstorm:end', (_e, sessionId: string) => {
    deleteSession(sessionId);
    return { ok: true };
  });

  // Read-and-delete a project's brainstorm-seed.md if present. Unchanged from
  // the old service: ChatPanel's one-shot seed consumption depends on it.
  ipcMain.handle('brainstorm:consumeSeed', async (_e, projectPath: string) => {
    if (!projectPath) return { ok: false };
    const seedPath = path.join(projectPath.replace(/[/\\]+$/, ''), '.sai', 'brainstorm-seed.md');
    let content: string;
    try {
      content = await fs.promises.readFile(seedPath, 'utf8');
    } catch {
      return { ok: false };
    }
    try {
      await fs.promises.unlink(seedPath);
    } catch {
      // ignore — content was read, that's what matters
    }
    return { ok: true, content };
  });
}
