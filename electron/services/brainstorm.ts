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
  'Keep responses concise and conversational. Use plain prose — do NOT produce code, file structures, or JSON.',
  'Even if the user asks you to summarize or wrap up, respond in natural language. Do not emit JSON in this conversation.',
].join('\n');

// Synthesize prompt is self-contained: it instructs the model on the exact
// JSON format inline, so the system prompt can stay free of JSON guidance
// (which would otherwise leak into regular replies whenever the user said
// anything like "summarize" or "plan it").
//
// The prompt allows ONE pushback path: if the conversation lacks enough
// substance to confidently summarize, the model can respond with a single
// `NEED_MORE: <question>` line instead of JSON. The handler treats that as
// a clarification request, surfaces the question in the chat, and lets the
// user respond before they try synthesizing again.
export const SYNTHESIZE_PROMPT = [
  '[INTERNAL TOOL CALL — not a user message]',
  'The user is trying to create a project from this conversation.',
  '',
  'If the conversation contains enough substance to describe a real project,',
  'respond with ONLY a JSON object (no prose, no code fences, no other text):',
  '  {"projectName":"kebab-case-name","context":"2–4 sentence summary suitable for a CLAUDE.md \'Project Context\' section."}',
  '  - projectName must be ≤ 40 chars',
  '',
  'If the conversation is too thin, vague, off-topic, or otherwise lacks',
  'enough information to confidently name and describe the project,',
  'respond with EXACTLY this single-line format instead (and nothing else):',
  '  NEED_MORE: <one short clarifying question to ask the user>',
  '',
  'Pick exactly one of those two formats. Do not mix them.',
].join('\n');

// Force variant: the user explicitly asked to proceed despite a prior
// pushback. Don't offer NEED_MORE — make a best-guess JSON regardless.
export const SYNTHESIZE_PROMPT_FORCE = [
  '[INTERNAL TOOL CALL — not a user message]',
  'The user is creating a project from this conversation and has explicitly',
  'asked to proceed even though the conversation may be sparse.',
  '',
  'Respond with ONLY a JSON object (no prose, no code fences, no other text):',
  '  {"projectName":"kebab-case-name","context":"2–4 sentence summary suitable for a CLAUDE.md \'Project Context\' section."}',
  '  - projectName must be ≤ 40 chars',
  '',
  'Do your best with what is here. Do NOT ask clarifying questions.',
  'Do NOT use the NEED_MORE format — output the JSON.',
].join('\n');

// Build args for a stateless one-shot claude invocation. Each turn carries
// the full conversation in the prompt rather than relying on claude's
// session resume (which is unreliable after `-p` runs in some claude CLI
// versions).
//
// Notes on flag choices:
// - --setting-sources '': load NO user/project settings, so no plugins and
//   no SessionStart hooks. The superpowers plugin's hook tells the model it
//   MUST invoke the brainstorming skill before responding; for a "new
//   project" prompt the model would burn its whole --max-turns budget on
//   Skill/ToolSearch attempts and intermittently exit 1 with no text.
//   (--bare is not usable here: it restricts auth to ANTHROPIC_API_KEY,
//   breaking OAuth users.)
// - --tools '': brainstorm is a plain conversation — with no tools available
//   the reply is always text in a single turn. Subsumes the old
//   --disallowed-tools Skill,Task blacklist, which didn't stop the model
//   from *attempting* those calls and wasting turns on the denials.
// - --max-turns 4: text-only replies take one turn; the rest is headroom.
export function buildClaudeArgs(opts: { prompt: string }): string[] {
  return [
    '-p', opts.prompt,
    '--output-format', 'stream-json',
    '--verbose',
    '--max-turns', '4',
    '--setting-sources', '',
    '--tools', '',
    '--append-system-prompt', BRAINSTORM_SYSTEM_PROMPT,
  ];
}

// Compose a single prompt that carries the full prior transcript followed
// by the new user message. Claude treats the whole thing as the user's
// turn, but the embedded transcript gives it the context it needs.
export function composeTurnPrompt(transcript: TranscriptTurn[], userMessage: string): string {
  if (transcript.length === 0) return userMessage;
  const lines: string[] = ['Conversation so far:', ''];
  for (const turn of transcript) {
    lines.push(turn.role === 'user' ? `User: ${turn.content}` : `You: ${turn.content}`);
    lines.push('');
  }
  lines.push(`User's next message: ${userMessage}`);
  return lines.join('\n');
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
import fs from 'node:fs';
import path from 'node:path';
import { enrichedEnv } from './shellEnv';

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

  const prompt = composeTurnPrompt(session.transcript, args.userMessage);
  const cliArgs = buildClaudeArgs({ prompt });

  return await new Promise<RunTurnResult>((resolve) => {
    let proc;
    try {
      proc = spawn('claude', cliArgs, {
        cwd: os.tmpdir(),
        env: enrichedEnv(),
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: IS_WIN,
      });
    } catch (e: any) {
      resolve({ ok: false, error: e.message || 'spawn failed' });
      return;
    }

    const acc: StreamAccumulator = { fullText: '', sessionId: undefined };
    let buffer = '';
    let stdoutRaw = '';
    let stderrBuf = '';

    proc.stdout?.on('data', (data: Buffer) => {
      const chunk = data.toString();
      stdoutRaw += chunk;
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) processStreamLine(line, acc, args.onChunk);
    });

    proc.stderr?.on('data', (data: Buffer) => { stderrBuf += data.toString(); });

    proc.on('error', (e) => {
      console.error('[brainstorm] claude spawn error:', e);
      resolve({ ok: false, error: e.message });
    });

    proc.on('exit', (code) => {
      if (buffer.trim()) processStreamLine(buffer, acc, args.onChunk);
      if (code !== 0 && !acc.fullText) {
        // Dump everything we have so we can actually debug. Claude in -p
        // mode sometimes prints errors to stdout (not stderr) and the
        // stream-json line parser silently drops them.
        console.error('[brainstorm] claude exited', code);
        console.error('[brainstorm] args:', cliArgs);
        console.error('[brainstorm] stdout:', stdoutRaw || '(empty)');
        console.error('[brainstorm] stderr:', stderrBuf || '(empty)');
        const detail = stderrBuf.trim() || stdoutRaw.trim() || `claude exited with code ${code}`;
        resolve({ ok: false, error: detail });
        return;
      }
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

  ipcMain.handle('brainstorm:synthesize', async (_e, sessionId: string, opts?: { force?: boolean }) => {
    const session = getSession(sessionId);
    if (!session) return { ok: false, error: 'Session not found' };
    // Snapshot the transcript so we can roll back the synthesize prompt
    // turn — it's not real conversation content.
    const beforeLen = session.transcript.length;
    const noopChunk = () => {};
    const prompt = opts?.force ? SYNTHESIZE_PROMPT_FORCE : SYNTHESIZE_PROMPT;
    const result = await runTurn({ sessionId, userMessage: prompt, onChunk: noopChunk });
    session.transcript.length = beforeLen;
    if (!result.ok) return result;

    const text = result.text.trim();

    // Clarification path: model decided the conversation is too thin to
    // summarize and is asking the user one question. Keep the question in
    // the transcript so it shows up as an organic assistant turn in the
    // brainstorm, but skip the synthesize prompt itself.
    // (Skip this check when force is set — the model was told not to use
    // NEED_MORE, but if it does anyway, treat the output as a parse error.)
    if (!opts?.force) {
      const needMoreMatch = text.match(/^NEED_MORE:\s*(.+)$/s);
      if (needMoreMatch) {
        const question = needMoreMatch[1].trim();
        session.transcript.push({ role: 'assistant', content: question });
        return { ok: false, needsClarification: true, question };
      }
    }

    try {
      const parsed = parseSynthesizeOutput(text);
      return { ok: true, ...parsed, transcript: serializeTranscript(session) };
    } catch (e: any) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('brainstorm:end', (_e, sessionId: string) => {
    deleteSession(sessionId);
    return { ok: true };
  });

  // Read-and-delete a project's brainstorm-seed.md if present.
  // Returns { ok: true, content } when a seed was consumed, or { ok: false }.
  // Quietly returns { ok: false } when no seed exists — no log spam for the
  // common case of opening a project that was never brainstormed.
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
