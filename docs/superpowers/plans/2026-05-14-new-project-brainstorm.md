# New Project: Brainstorm Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an optional Brainstorm tab to `NewProjectModal` that lets users chat with Claude about feasibility before scaffolding. On commit, prefill project name + context and seed the first message in the new project's chat.

**Architecture:** A new IPC-backed brainstorm service spawns one-shot `claude -p` invocations per turn (using `--resume <session_id>` after the first turn) so the conversation threads without keeping a long-lived process. The renderer (`NewProjectModal`) gains a tab bar; the Brainstorm tab streams output via IPC events. On "Use this →", a synthesize call asks Claude to emit strict JSON. The full transcript + summary is written to `.sai/brainstorm-seed.md` during scaffold; the chat panel reads-and-deletes that file on mount and auto-sends it as the first user message.

**Tech Stack:** Electron (main + preload + renderer), React, TypeScript, `claude` CLI (one-shot `-p` mode, `--output-format stream-json`), Vitest + React Testing Library.

---

## File Structure

**Create:**
- `electron/services/brainstorm.ts` — session manager, spawn wrapper, IPC handlers
- `src/components/NewProjectModal/BrainstormTab.tsx` — chat UI inside the modal
- `src/components/NewProjectModal/useBrainstorm.ts` — renderer hook wrapping IPC calls + streaming state
- `tests/brainstorm.synthesize.test.ts` — JSON parser unit tests
- `tests/scaffold.brainstorm.test.ts` — scaffold-side seed-file tests
- `tests/NewProjectModal.brainstorm.test.tsx` — component tests

**Modify:**
- `electron/preload.ts` — expose `brainstorm*` IPC
- `electron/services/scaffold.ts` — accept `brainstormTranscript`, write seed file, add `.sai/` to `.gitignore`
- `electron/main.ts` (or wherever `registerScaffoldHandler` is called) — call new `registerBrainstormHandlers`
- `src/components/NewProjectModal.tsx` — extract existing form into `SetupTab`, add tab bar, mount BrainstormTab
- `src/components/Chat/ChatPanel.tsx` — on mount, check for `.sai/brainstorm-seed.md`, send-and-delete

---

## Task 1: Brainstorm service skeleton + session store

**Files:**
- Create: `electron/services/brainstorm.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/brainstorm.session.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { __resetSessions, createSession, getSession, deleteSession } from '../electron/services/brainstorm';

describe('brainstorm session store', () => {
  beforeEach(() => __resetSessions());

  it('creates a session with a unique id and empty transcript', () => {
    const { sessionId } = createSession();
    const s = getSession(sessionId);
    expect(s).toBeDefined();
    expect(s!.transcript).toEqual([]);
    expect(s!.claudeSessionId).toBeUndefined();
  });

  it('creates distinct ids for separate sessions', () => {
    const a = createSession().sessionId;
    const b = createSession().sessionId;
    expect(a).not.toEqual(b);
  });

  it('deleteSession removes the session', () => {
    const { sessionId } = createSession();
    deleteSession(sessionId);
    expect(getSession(sessionId)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test — should fail (module does not exist)**

Run: `npx vitest run tests/brainstorm.session.test.ts`
Expected: FAIL — cannot find module `electron/services/brainstorm`.

- [ ] **Step 3: Implement the session store**

Create `electron/services/brainstorm.ts`:

```ts
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
```

- [ ] **Step 4: Run test — should pass**

Run: `npx vitest run tests/brainstorm.session.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add electron/services/brainstorm.ts tests/brainstorm.session.test.ts
git commit -m "feat(brainstorm): add in-memory session store"
```

---

## Task 2: Synthesize-JSON parser

This isolates the JSON-extraction logic before wiring it to a child process. The parser handles raw output from Claude that may be wrapped in code fences or have leading/trailing prose.

**Files:**
- Modify: `electron/services/brainstorm.ts`
- Test: `tests/brainstorm.synthesize.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/brainstorm.synthesize.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseSynthesizeOutput } from '../electron/services/brainstorm';

describe('parseSynthesizeOutput', () => {
  it('parses a clean JSON object', () => {
    const r = parseSynthesizeOutput('{"projectName":"my-app","context":"A CLI."}');
    expect(r).toEqual({ projectName: 'my-app', context: 'A CLI.' });
  });

  it('strips ```json code fences', () => {
    const r = parseSynthesizeOutput('```json\n{"projectName":"foo","context":"bar"}\n```');
    expect(r).toEqual({ projectName: 'foo', context: 'bar' });
  });

  it('strips plain ``` code fences', () => {
    const r = parseSynthesizeOutput('```\n{"projectName":"foo","context":"bar"}\n```');
    expect(r).toEqual({ projectName: 'foo', context: 'bar' });
  });

  it('extracts JSON from surrounding prose', () => {
    const r = parseSynthesizeOutput('Here is the summary: {"projectName":"foo","context":"bar"} thanks!');
    expect(r).toEqual({ projectName: 'foo', context: 'bar' });
  });

  it('throws on malformed JSON', () => {
    expect(() => parseSynthesizeOutput('not json at all')).toThrow();
  });

  it('throws when projectName is missing', () => {
    expect(() => parseSynthesizeOutput('{"context":"bar"}')).toThrow(/projectName/);
  });

  it('throws when context is missing', () => {
    expect(() => parseSynthesizeOutput('{"projectName":"foo"}')).toThrow(/context/);
  });

  it('throws when projectName is empty', () => {
    expect(() => parseSynthesizeOutput('{"projectName":"","context":"bar"}')).toThrow(/projectName/);
  });

  it('rejects projectName longer than 40 chars', () => {
    const long = 'a'.repeat(41);
    expect(() => parseSynthesizeOutput(`{"projectName":"${long}","context":"bar"}`)).toThrow(/40/);
  });

  it('ignores extra fields', () => {
    const r = parseSynthesizeOutput('{"projectName":"foo","context":"bar","extra":"ignored"}');
    expect(r).toEqual({ projectName: 'foo', context: 'bar' });
  });
});
```

- [ ] **Step 2: Run test — should fail**

Run: `npx vitest run tests/brainstorm.synthesize.test.ts`
Expected: FAIL — `parseSynthesizeOutput` not exported.

- [ ] **Step 3: Implement parser**

Append to `electron/services/brainstorm.ts`:

```ts
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
```

- [ ] **Step 4: Run test — should pass**

Run: `npx vitest run tests/brainstorm.synthesize.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add electron/services/brainstorm.ts tests/brainstorm.synthesize.test.ts
git commit -m "feat(brainstorm): add synthesize output parser"
```

---

## Task 3: Brainstorm system prompt + spawn wrapper

Wraps `claude -p` invocations with the brainstorm system prompt. Exposes a `runTurn` function that takes a session and a user message, spawns claude, parses stream-json output, returns the assistant text and updates the claudeSessionId.

**Files:**
- Modify: `electron/services/brainstorm.ts`

- [ ] **Step 1: Add the system prompt constant**

Append to `electron/services/brainstorm.ts`:

```ts
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
```

- [ ] **Step 2: Write a test for spawn-arg construction**

Append to `tests/brainstorm.synthesize.test.ts` (or create `tests/brainstorm.args.test.ts`):

```ts
import { describe, it, expect } from 'vitest';
import { buildClaudeArgs, BRAINSTORM_SYSTEM_PROMPT } from '../electron/services/brainstorm';

describe('buildClaudeArgs', () => {
  it('includes -p prompt, output-format stream-json, max-turns 1, append-system-prompt on first turn', () => {
    const args = buildClaudeArgs({ userMessage: 'hello', claudeSessionId: undefined });
    expect(args).toContain('-p');
    expect(args).toContain('hello');
    expect(args[args.indexOf('--output-format') + 1]).toBe('stream-json');
    expect(args[args.indexOf('--max-turns') + 1]).toBe('1');
    expect(args).toContain('--verbose');
    expect(args[args.indexOf('--append-system-prompt') + 1]).toBe(BRAINSTORM_SYSTEM_PROMPT);
    expect(args).not.toContain('--resume');
  });

  it('uses --resume on subsequent turns and omits --append-system-prompt', () => {
    const args = buildClaudeArgs({ userMessage: 'follow-up', claudeSessionId: 'abc-123' });
    expect(args[args.indexOf('--resume') + 1]).toBe('abc-123');
    expect(args).not.toContain('--append-system-prompt');
  });
});
```

- [ ] **Step 3: Run test — should fail**

Run: `npx vitest run tests/brainstorm.args.test.ts`
Expected: FAIL — `buildClaudeArgs` not exported.

- [ ] **Step 4: Implement `buildClaudeArgs`**

Append to `electron/services/brainstorm.ts`:

```ts
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
```

- [ ] **Step 5: Run test — should pass**

Run: `npx vitest run tests/brainstorm.args.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add electron/services/brainstorm.ts tests/brainstorm.args.test.ts
git commit -m "feat(brainstorm): system prompt + claude arg construction"
```

---

## Task 4: Stream-JSON line parser

Claude `--output-format stream-json` emits one JSON object per line. We need to extract the assistant text deltas (for streaming to the renderer), the final assistant message, and the `session_id`.

**Files:**
- Modify: `electron/services/brainstorm.ts`
- Test: `tests/brainstorm.stream.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/brainstorm.stream.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { processStreamLine } from '../electron/services/brainstorm';

describe('processStreamLine', () => {
  it('captures session_id from system init', () => {
    const onChunk = vi.fn();
    const out = { fullText: '', sessionId: undefined as string | undefined };
    processStreamLine(
      JSON.stringify({ type: 'system', subtype: 'init', session_id: 'sess-1' }),
      out, onChunk,
    );
    expect(out.sessionId).toBe('sess-1');
    expect(onChunk).not.toHaveBeenCalled();
  });

  it('appends assistant text deltas and notifies onChunk', () => {
    const onChunk = vi.fn();
    const out = { fullText: '', sessionId: undefined as string | undefined };
    processStreamLine(
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Hello' }] } }),
      out, onChunk,
    );
    processStreamLine(
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: ' world' }] } }),
      out, onChunk,
    );
    expect(out.fullText).toBe('Hello world');
    expect(onChunk).toHaveBeenNthCalledWith(1, 'Hello');
    expect(onChunk).toHaveBeenNthCalledWith(2, ' world');
  });

  it('ignores unknown line types', () => {
    const onChunk = vi.fn();
    const out = { fullText: '', sessionId: undefined as string | undefined };
    processStreamLine(JSON.stringify({ type: 'something-else' }), out, onChunk);
    expect(out.fullText).toBe('');
    expect(onChunk).not.toHaveBeenCalled();
  });

  it('silently skips malformed JSON', () => {
    const onChunk = vi.fn();
    const out = { fullText: '', sessionId: undefined as string | undefined };
    expect(() => processStreamLine('not json', out, onChunk)).not.toThrow();
    expect(out.fullText).toBe('');
  });
});
```

- [ ] **Step 2: Run test — should fail**

Run: `npx vitest run tests/brainstorm.stream.test.ts`
Expected: FAIL — `processStreamLine` not exported.

- [ ] **Step 3: Implement the parser**

Append to `electron/services/brainstorm.ts`:

```ts
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
```

- [ ] **Step 4: Run test — should pass**

Run: `npx vitest run tests/brainstorm.stream.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add electron/services/brainstorm.ts tests/brainstorm.stream.test.ts
git commit -m "feat(brainstorm): stream-json line parser"
```

---

## Task 5: Spawn-and-stream `runTurn` + IPC handlers

Combines the previous pieces into a `runTurn` function and registers IPC handlers. Uses the `enrichedEnv` pattern from `claude.ts`. Streams chunks to the renderer over `brainstorm:chunk:<sessionId>`, emits `brainstorm:done:<sessionId>` at end, `brainstorm:error:<sessionId>` on failure.

**Files:**
- Modify: `electron/services/brainstorm.ts`

- [ ] **Step 1: Implement `runTurn` and `registerBrainstormHandlers`**

Append to `electron/services/brainstorm.ts`:

```ts
import { spawn } from 'node:child_process';
import { ipcMain, BrowserWindow } from 'electron';
import os from 'node:os';

const IS_WIN = process.platform === 'win32';

interface RunTurnArgs {
  sessionId: string;
  userMessage: string;
  onChunk: (text: string) => void;
}

interface RunTurnResult {
  ok: true;
  text: string;
} | {
  ok: false;
  error: string;
}

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
      // Persist Claude session id + transcript turn
      if (acc.sessionId) session.claudeSessionId = acc.sessionId;
      session.transcript.push({ role: 'user', content: args.userMessage });
      session.transcript.push({ role: 'assistant', content: acc.fullText });
      resolve({ ok: true, text: acc.fullText });
    });

    proc.stdin?.end();
  });
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

export function serializeTranscript(session: BrainstormSession): string {
  return session.transcript
    .map(t => `**${t.role === 'user' ? 'User' : 'Assistant'}:** ${t.content}`)
    .join('\n\n');
}
```

- [ ] **Step 2: Register handlers in main**

Find the file where `registerScaffoldHandler` is called (likely `electron/main.ts`). Add an import and registration call next to it.

Run: `grep -rn "registerScaffoldHandler" electron/`
Expected: shows the registration site (e.g., `electron/main.ts`).

Edit that file to add:

```ts
import { registerBrainstormHandlers } from './services/brainstorm';
// ...
// where registerScaffoldHandler(...) is called:
registerBrainstormHandlers(win);
```

- [ ] **Step 3: Type-check**

Run: `npm run typecheck` (or `npx tsc --noEmit` if no script exists)
Expected: no errors. If the script name differs, use `npx tsc -p tsconfig.electron.json --noEmit` or whichever config covers `electron/`.

- [ ] **Step 4: Commit**

```bash
git add electron/services/brainstorm.ts electron/main.ts
git commit -m "feat(brainstorm): runTurn + IPC handlers"
```

---

## Task 6: Preload exposure

**Files:**
- Modify: `electron/preload.ts`

- [ ] **Step 1: Add the brainstorm bridge**

In `electron/preload.ts`, inside the object passed to `contextBridge.exposeInMainWorld('sai', { ... })`, add:

```ts
brainstormStart: () => ipcRenderer.invoke('brainstorm:start'),
brainstormSend: (sessionId: string, message: string) =>
  ipcRenderer.invoke('brainstorm:send', sessionId, message),
brainstormSynthesize: (sessionId: string) =>
  ipcRenderer.invoke('brainstorm:synthesize', sessionId),
brainstormEnd: (sessionId: string) => ipcRenderer.invoke('brainstorm:end', sessionId),
brainstormOnChunk: (sessionId: string, callback: (text: string) => void) => {
  const channel = `brainstorm:chunk:${sessionId}`;
  const listener = (_e: Electron.IpcRendererEvent, text: string) => callback(text);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
},
brainstormOnDone: (sessionId: string, callback: (text: string) => void) => {
  const channel = `brainstorm:done:${sessionId}`;
  const listener = (_e: Electron.IpcRendererEvent, text: string) => callback(text);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
},
brainstormOnError: (sessionId: string, callback: (err: string) => void) => {
  const channel = `brainstorm:error:${sessionId}`;
  const listener = (_e: Electron.IpcRendererEvent, err: string) => callback(err);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
},
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add electron/preload.ts
git commit -m "feat(brainstorm): preload IPC bridge"
```

---

## Task 7: `useBrainstorm` renderer hook

A self-contained hook for the BrainstormTab to call. Manages session lifecycle, transcript, streaming.

**Files:**
- Create: `src/components/NewProjectModal/useBrainstorm.ts`

- [ ] **Step 1: Implement the hook**

Create `src/components/NewProjectModal/useBrainstorm.ts`:

```ts
import { useState, useEffect, useRef, useCallback } from 'react';

export interface BrainstormMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface SynthesizeResponse {
  ok: true;
  projectName: string;
  context: string;
  transcript: string;
} | {
  ok: false;
  error: string;
}

export interface UseBrainstorm {
  messages: BrainstormMessage[];
  streamingText: string;
  isStreaming: boolean;
  error: string | null;
  startError: string | null;
  send: (message: string) => Promise<void>;
  synthesize: () => Promise<SynthesizeResponse>;
  end: () => Promise<void>;
  hasReply: boolean;
}

export function useBrainstorm(enabled: boolean): UseBrainstorm {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<BrainstormMessage[]>([]);
  const [streamingText, setStreamingText] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const unsubsRef = useRef<Array<() => void>>([]);

  const ensureSession = useCallback(async () => {
    if (sessionIdRef.current) return sessionIdRef.current;
    try {
      const result: any = await (window as any).sai.brainstormStart();
      sessionIdRef.current = result.sessionId;
      setSessionId(result.sessionId);
      return result.sessionId as string;
    } catch (e: any) {
      setStartError(e?.message ?? 'Failed to start brainstorm');
      throw e;
    }
  }, []);

  useEffect(() => {
    return () => {
      unsubsRef.current.forEach(u => u());
      unsubsRef.current = [];
      const sid = sessionIdRef.current;
      if (sid) (window as any).sai.brainstormEnd(sid).catch(() => {});
    };
  }, []);

  const send = useCallback(async (message: string) => {
    if (!enabled) return;
    setError(null);
    setIsStreaming(true);
    setStreamingText('');
    setMessages(prev => [...prev, { role: 'user', content: message }]);

    let sid: string;
    try {
      sid = await ensureSession();
    } catch {
      setIsStreaming(false);
      return;
    }

    let buffered = '';
    const unsubChunk = (window as any).sai.brainstormOnChunk(sid, (text: string) => {
      buffered += text;
      setStreamingText(buffered);
    });

    const unsubDone = (window as any).sai.brainstormOnDone(sid, (text: string) => {
      setMessages(prev => [...prev, { role: 'assistant', content: text }]);
      setStreamingText('');
      setIsStreaming(false);
      unsubChunk();
      unsubDone();
      unsubError();
    });

    const unsubError = (window as any).sai.brainstormOnError(sid, (err: string) => {
      setError(err);
      setStreamingText('');
      setIsStreaming(false);
      unsubChunk();
      unsubDone();
      unsubError();
    });

    unsubsRef.current.push(unsubChunk, unsubDone, unsubError);

    try {
      await (window as any).sai.brainstormSend(sid, message);
    } catch (e: any) {
      setError(e?.message ?? 'Send failed');
      setIsStreaming(false);
    }
  }, [enabled, ensureSession]);

  const synthesize = useCallback(async (): Promise<SynthesizeResponse> => {
    const sid = sessionIdRef.current;
    if (!sid) return { ok: false, error: 'No active brainstorm session' };
    return await (window as any).sai.brainstormSynthesize(sid);
  }, []);

  const end = useCallback(async () => {
    const sid = sessionIdRef.current;
    if (sid) {
      await (window as any).sai.brainstormEnd(sid).catch(() => {});
      sessionIdRef.current = null;
      setSessionId(null);
    }
  }, []);

  return {
    messages,
    streamingText,
    isStreaming,
    error,
    startError,
    send,
    synthesize,
    end,
    hasReply: messages.some(m => m.role === 'assistant'),
  };
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/NewProjectModal/useBrainstorm.ts
git commit -m "feat(brainstorm): renderer useBrainstorm hook"
```

---

## Task 8: BrainstormTab component

Renders chat bubbles + input. Pure presentation — gets its data from the parent.

**Files:**
- Create: `src/components/NewProjectModal/BrainstormTab.tsx`

- [ ] **Step 1: Implement the component**

Create `src/components/NewProjectModal/BrainstormTab.tsx`:

```tsx
import { useState, useRef, useEffect } from 'react';
import { Send, Brain } from 'lucide-react';
import type { BrainstormMessage } from './useBrainstorm';

interface Props {
  messages: BrainstormMessage[];
  streamingText: string;
  isStreaming: boolean;
  error: string | null;
  startError: string | null;
  onSend: (text: string) => void;
}

export default function BrainstormTab({
  messages, streamingText, isStreaming, error, startError, onSend,
}: Props) {
  const [draft, setDraft] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, streamingText]);

  const handleSend = () => {
    const text = draft.trim();
    if (!text || isStreaming) return;
    onSend(text);
    setDraft('');
  };

  if (startError) {
    return (
      <div style={{ padding: 16, fontSize: 12, color: '#f87171' }}>
        AI brainstorm unavailable — {startError}. You can still fill out the Setup tab manually.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, height: 360 }}>
      <div
        ref={scrollRef}
        style={{
          flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8,
          padding: 10, background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 5,
        }}
      >
        {messages.length === 0 && !isStreaming && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-muted)', fontSize: 12 }}>
            <Brain size={14} />
            <span>Talk through what you want to build before we scaffold anything.</span>
          </div>
        )}
        {messages.map((m, i) => (
          <Bubble key={i} role={m.role} text={m.content} />
        ))}
        {isStreaming && streamingText && <Bubble role="assistant" text={streamingText} />}
        {isStreaming && !streamingText && (
          <div style={{ fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic' }}>thinking…</div>
        )}
        {error && (
          <div style={{ fontSize: 11, color: '#f87171' }}>{error}</div>
        )}
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <textarea
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder="What are you thinking about building?"
          rows={2}
          style={{
            flex: 1,
            background: 'var(--bg-secondary)', border: '1px solid var(--border)',
            borderRadius: 5, padding: '7px 10px', fontSize: 13, color: 'var(--text)',
            fontFamily: 'system-ui, sans-serif', resize: 'none',
          }}
        />
        <button
          onClick={handleSend}
          disabled={!draft.trim() || isStreaming}
          aria-label="Send"
          style={{
            background: 'none',
            border: `1px solid ${draft.trim() && !isStreaming ? 'var(--accent)' : 'var(--border)'}`,
            color: draft.trim() && !isStreaming ? 'var(--accent)' : 'var(--text-muted)',
            borderRadius: 5, padding: '0 12px', cursor: draft.trim() && !isStreaming ? 'pointer' : 'not-allowed',
          }}
        >
          <Send size={14} />
        </button>
      </div>
    </div>
  );
}

function Bubble({ role, text }: { role: 'user' | 'assistant'; text: string }) {
  const isUser = role === 'user';
  return (
    <div
      style={{
        alignSelf: isUser ? 'flex-end' : 'flex-start',
        maxWidth: '85%',
        background: isUser ? 'rgba(199,145,12,0.1)' : 'var(--bg-elevated)',
        border: `1px solid ${isUser ? 'rgba(199,145,12,0.3)' : 'var(--border)'}`,
        borderRadius: 6, padding: '6px 10px',
        fontSize: 12.5, color: 'var(--text)', whiteSpace: 'pre-wrap', lineHeight: 1.45,
      }}
    >
      {text}
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/NewProjectModal/BrainstormTab.tsx
git commit -m "feat(brainstorm): BrainstormTab component"
```

---

## Task 9: Refactor `NewProjectModal` into tabs

Extract the existing form into a `SetupTab` and add a tab bar. Keep all current behavior unchanged on the Setup tab.

**Files:**
- Modify: `src/components/NewProjectModal.tsx`
- Create: `src/components/NewProjectModal/SetupTab.tsx`

- [ ] **Step 1: Move existing form body into SetupTab**

Create `src/components/NewProjectModal/SetupTab.tsx`. Copy the entire existing form JSX from `NewProjectModal.tsx` (parent dir input → helpers checkboxes → error/warnings) into this component. Define a Props interface that exposes every piece of state and every handler the form uses (`parentDir`, `setParentDir`, `projectName`, `setProjectName`, `context`, `setContext`, `helpers`, `toggleHelper`, `githubUser`, `repoName`, `setRepoName`, `repoNameEdited`, `setRepoNameEdited`, `visibility`, `setVisibility`, `error`, `warnings`, `handleBrowseParent`, `handleConnectGitHub`, `nameFromBrainstorm`, `contextFromBrainstorm`, `onClearNameBadge`, `onClearContextBadge`).

The two new props `nameFromBrainstorm` and `contextFromBrainstorm` render a small "✨ from brainstorm" badge next to the respective field labels when true. Wire the badge to clear by calling `onClearNameBadge` / `onClearContextBadge` from the existing `onChange` handlers.

Add the badge JSX after the field label like:

```tsx
{nameFromBrainstorm && (
  <span style={{ fontSize: 10, color: 'var(--accent)', marginLeft: 6 }}>✨ from brainstorm</span>
)}
```

- [ ] **Step 2: Rewrite `NewProjectModal.tsx` shell**

`NewProjectModal.tsx` becomes the orchestrator:

```tsx
import { useState, useEffect, useCallback } from 'react';
import { FolderPlus, Brain } from 'lucide-react';
import SetupTab from './NewProjectModal/SetupTab';
import BrainstormTab from './NewProjectModal/BrainstormTab';
import { useBrainstorm } from './NewProjectModal/useBrainstorm';

interface GitHubUser { login: string; }

interface NewProjectModalProps {
  onClose: () => void;
  onCreated: (path: string) => void;
}

const DEFAULT_HELPERS = {
  claudeMd: true, gitInit: true, gitignore: true, readme: true,
  claudeSettings: false, githubRepo: false,
};

type Tab = 'setup' | 'brainstorm';

export default function NewProjectModal({ onClose, onCreated }: NewProjectModalProps) {
  const [tab, setTab] = useState<Tab>('setup');

  // ... preserve every state field that was in the original file (parentDir, projectName, context, helpers, githubUser, repoName, visibility, creating, error, warnings, createdPath, repoNameEdited) ...

  const [brainstormTranscript, setBrainstormTranscript] = useState('');
  const [nameFromBrainstorm, setNameFromBrainstorm] = useState(false);
  const [contextFromBrainstorm, setContextFromBrainstorm] = useState(false);
  const [synthesizing, setSynthesizing] = useState(false);
  const [synthesizeError, setSynthesizeError] = useState<string | null>(null);
  const [replacePrompt, setReplacePrompt] = useState<null | { projectName: string; context: string; transcript: string }>(null);

  const brainstorm = useBrainstorm(tab === 'brainstorm' || brainstormTranscript !== '');

  // ... keep all existing useEffects and handlers from the original file unchanged (default project dir, GitHub user fetch, escape-key handler, handleBrowseParent, handleConnectGitHub, toggleHelper, handleCreate) ...

  // Extend handleCreate to pass brainstormTranscript:
  // result = await window.sai.scaffoldProject({ ..., brainstormTranscript: brainstormTranscript || undefined });

  const handleUseThis = useCallback(async () => {
    setSynthesizing(true);
    setSynthesizeError(null);
    const r = await brainstorm.synthesize();
    setSynthesizing(false);
    if (!r.ok) {
      setSynthesizeError("Couldn't summarize — try sending one more message clarifying the goal");
      return;
    }
    const nameAlreadyFilled = projectName.trim().length > 0;
    const contextAlreadyFilled = context.trim().length > 0;
    if (nameAlreadyFilled || contextAlreadyFilled) {
      setReplacePrompt({ projectName: r.projectName, context: r.context, transcript: r.transcript });
      setTab('setup');
      return;
    }
    setProjectName(r.projectName);
    setContext(r.context);
    setBrainstormTranscript(r.transcript);
    setNameFromBrainstorm(true);
    setContextFromBrainstorm(true);
    setTab('setup');
  }, [brainstorm, projectName, context]);

  const acceptReplace = (which: 'name' | 'context' | 'both') => {
    if (!replacePrompt) return;
    if (which === 'name' || which === 'both') { setProjectName(replacePrompt.projectName); setNameFromBrainstorm(true); }
    if (which === 'context' || which === 'both') { setContext(replacePrompt.context); setContextFromBrainstorm(true); }
    setBrainstormTranscript(replacePrompt.transcript);
    setReplacePrompt(null);
  };

  // Render tab bar + active tab + footer.
}
```

Render structure:

```tsx
<div className="sai-overlay-in" onClick={onClose} style={{ /* same overlay styles */ }}>
  <div className="sai-modal-in" onClick={e => e.stopPropagation()} style={{ /* same modal styles, width: 520 */ }}>
    {/* Header */}
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <FolderPlus size={15} color="var(--accent)" />
      <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>New Project</span>
    </div>

    {/* Tab bar */}
    <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--border)' }}>
      <TabButton active={tab === 'setup'} onClick={() => setTab('setup')} label="Setup" />
      <TabButton active={tab === 'brainstorm'} onClick={() => setTab('brainstorm')} icon={<Brain size={12} />} label="Brainstorm" />
    </div>

    {tab === 'setup' ? (
      <>
        {replacePrompt && (
          <div style={{ fontSize: 12, background: 'rgba(199,145,12,0.08)', border: '1px solid rgba(199,145,12,0.3)', borderRadius: 5, padding: 10 }}>
            <div style={{ marginBottom: 6 }}>Replace your typed values with brainstorm results?</div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={() => acceptReplace('both')}>Replace both</button>
              <button onClick={() => acceptReplace('name')}>Name only</button>
              <button onClick={() => acceptReplace('context')}>Context only</button>
              <button onClick={() => setReplacePrompt(null)}>Keep mine</button>
            </div>
          </div>
        )}
        <SetupTab {...setupTabProps} />
      </>
    ) : (
      <BrainstormTab
        messages={brainstorm.messages}
        streamingText={brainstorm.streamingText}
        isStreaming={brainstorm.isStreaming}
        error={brainstorm.error}
        startError={brainstorm.startError}
        onSend={brainstorm.send}
      />
    )}

    {/* Footer */}
    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
      <button onClick={onClose}>Cancel</button>
      {tab === 'brainstorm' ? (
        <button
          onClick={handleUseThis}
          disabled={!brainstorm.hasReply || synthesizing}
        >
          {synthesizing ? 'Synthesizing…' : 'Use this →'}
        </button>
      ) : (
        /* existing Create Project / Open Project button */
      )}
    </div>
    {synthesizeError && tab === 'brainstorm' && (
      <div style={{ fontSize: 11, color: '#f87171' }}>{synthesizeError}</div>
    )}
  </div>
</div>
```

`TabButton` inline component:

```tsx
function TabButton({ active, onClick, label, icon }: { active: boolean; onClick: () => void; label: string; icon?: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: 'none', border: 'none', padding: '8px 12px',
        fontSize: 12, color: active ? 'var(--accent)' : 'var(--text-muted)',
        borderBottom: `2px solid ${active ? 'var(--accent)' : 'transparent'}`,
        marginBottom: -1, cursor: 'pointer',
        display: 'flex', alignItems: 'center', gap: 6,
      }}
    >
      {icon}
      {label}
    </button>
  );
}
```

- [ ] **Step 3: Verify in dev**

Run: `npm run dev`
Manually verify: New Project modal opens, both tabs render, switching preserves form state, original Setup behavior unchanged.

- [ ] **Step 4: Commit**

```bash
git add src/components/NewProjectModal.tsx src/components/NewProjectModal/SetupTab.tsx
git commit -m "feat(brainstorm): tab bar in NewProjectModal, extract SetupTab"
```

---

## Task 10: Scaffold writes brainstorm seed file

**Files:**
- Modify: `electron/services/scaffold.ts`
- Test: `tests/scaffold.brainstorm.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/scaffold.brainstorm.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scaffoldProject } from '../electron/services/scaffold';

describe('scaffoldProject — brainstorm seed', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sai-scaffold-'));
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('writes .sai/brainstorm-seed.md when transcript is provided', async () => {
    const target = path.join(tmp, 'p');
    const result = await scaffoldProject({
      path: target,
      context: 'A summary.',
      helpers: { claudeMd: false, gitInit: false, gitignore: true, readme: false, claudeSettings: false, githubRepo: false },
      brainstormTranscript: '**User:** hello\n\n**Assistant:** hi',
    }, () => null);
    expect(result.ok).toBe(true);
    const seedPath = path.join(target, '.sai', 'brainstorm-seed.md');
    expect(fs.existsSync(seedPath)).toBe(true);
    const seed = fs.readFileSync(seedPath, 'utf8');
    expect(seed).toContain('A summary.');
    expect(seed).toContain('<brainstorm-transcript>');
    expect(seed).toContain('**User:** hello');
  });

  it('does NOT write seed file when transcript is absent', async () => {
    const target = path.join(tmp, 'p');
    await scaffoldProject({
      path: target,
      context: 'x',
      helpers: { claudeMd: false, gitInit: false, gitignore: false, readme: false, claudeSettings: false, githubRepo: false },
    }, () => null);
    expect(fs.existsSync(path.join(target, '.sai'))).toBe(false);
  });

  it('adds .sai/ to generated .gitignore when seed is written', async () => {
    const target = path.join(tmp, 'p');
    await scaffoldProject({
      path: target,
      context: 'x',
      helpers: { claudeMd: false, gitInit: false, gitignore: true, readme: false, claudeSettings: false, githubRepo: false },
      brainstormTranscript: 't',
    }, () => null);
    const gi = fs.readFileSync(path.join(target, '.gitignore'), 'utf8');
    expect(gi.split('\n')).toContain('.sai/');
  });

  it('does not duplicate .sai/ in .gitignore', async () => {
    const target = path.join(tmp, 'p');
    await scaffoldProject({
      path: target,
      context: 'x',
      helpers: { claudeMd: false, gitInit: false, gitignore: true, readme: false, claudeSettings: false, githubRepo: false },
      brainstormTranscript: 't',
    }, () => null);
    const gi = fs.readFileSync(path.join(target, '.gitignore'), 'utf8');
    const count = gi.split('\n').filter(l => l === '.sai/').length;
    expect(count).toBe(1);
  });
});
```

- [ ] **Step 2: Run test — should fail**

Run: `npx vitest run tests/scaffold.brainstorm.test.ts`
Expected: FAIL — `brainstormTranscript` not in `ScaffoldOptions`, seed file not written.

- [ ] **Step 3: Update ScaffoldOptions and add seed writer**

In `electron/services/scaffold.ts`:

1. Extend the interface:

```ts
export interface ScaffoldOptions {
  path: string;
  context: string;
  helpers: { /* unchanged */ };
  github?: { /* unchanged */ };
  brainstormTranscript?: string;
}
```

2. In the gitignore step (currently lines ~109–125), include `.sai/` only when `brainstormTranscript` is present. Replace the `content` array with:

```ts
const ignores = [
  'node_modules', '.env', '.env.*', '.DS_Store', 'dist', 'build', '*.log', '.superpowers',
];
if (options.brainstormTranscript) ignores.push('.sai/');
const content = ignores.join('\n') + '\n';
```

3. After all existing steps (after the GitHub-repo block, before `return { ok: true, ... }`), add a new step:

```ts
// Step 8 — brainstorm seed file
if (options.brainstormTranscript) {
  try {
    const saiDir = path.join(resolved, '.sai');
    fs.mkdirSync(saiDir, { recursive: true });
    const seed =
      `# Seed message (synthesized)\n\n${options.context || ''}\n\n` +
      `<brainstorm-transcript>\n${options.brainstormTranscript}\n</brainstorm-transcript>\n`;
    fs.writeFileSync(path.join(saiDir, 'brainstorm-seed.md'), seed, 'utf8');

    // If .gitignore exists but does not include .sai/, append it
    const giPath = path.join(resolved, '.gitignore');
    if (fs.existsSync(giPath)) {
      const existing = fs.readFileSync(giPath, 'utf8');
      const lines = existing.split('\n');
      if (!lines.includes('.sai/')) {
        const sep = existing.endsWith('\n') ? '' : '\n';
        fs.writeFileSync(giPath, existing + sep + '.sai/\n', 'utf8');
      }
    }
  } catch (e: any) {
    warnings.push(`brainstorm seed: ${e.message}`);
  }
}
```

- [ ] **Step 4: Run test — should pass**

Run: `npx vitest run tests/scaffold.brainstorm.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add electron/services/scaffold.ts tests/scaffold.brainstorm.test.ts
git commit -m "feat(brainstorm): scaffold writes .sai/brainstorm-seed.md and gitignores .sai/"
```

---

## Task 11: Wire brainstormTranscript through the modal's `handleCreate`

**Files:**
- Modify: `src/components/NewProjectModal.tsx`
- Modify: `electron/preload.ts` (TS types only — no runtime change needed since `scaffoldProject` is already `(options: any)`)

- [ ] **Step 1: Pass transcript in scaffoldProject call**

In `NewProjectModal.tsx`, find the `handleCreate` callback (originally line 87 in the pre-refactor file). Update the scaffoldProject argument to include `brainstormTranscript`:

```ts
result = await window.sai.scaffoldProject({
  path: computedPath,
  context,
  helpers,
  github: helpers.githubRepo ? { repoName, visibility } : undefined,
  brainstormTranscript: brainstormTranscript || undefined,
});
```

- [ ] **Step 2: Manually verify end-to-end**

Run: `npm run dev`
Steps:
1. Open New Project modal.
2. Switch to Brainstorm tab, send a message, get a reply.
3. Click "Use this →" — should land back on Setup tab with name and context prefilled and badges visible.
4. Create the project.
5. Verify the new project contains `.sai/brainstorm-seed.md` and that `.sai/` is in `.gitignore`.

Expected: All steps pass. If "Use this →" produces a JSON parse error, send one more clarifying message and retry — that is intended behavior.

- [ ] **Step 3: Commit**

```bash
git add src/components/NewProjectModal.tsx
git commit -m "feat(brainstorm): pass transcript through to scaffold"
```

---

## Task 12: ChatPanel consumes seed file on mount

**Files:**
- Modify: `src/components/Chat/ChatPanel.tsx`

- [ ] **Step 1: Add seed-consumption effect**

In `ChatPanel.tsx`, find the existing `useEffect` that starts the AI process (around line 683 — `startFn(...startArgs).then(...)`).

After the existing `setReady(true)` call inside the `.then(...)` callback, add:

```ts
// One-shot brainstorm seed consumption
if (aiProvider === 'claude' && projectPath) {
  const seedPath = `${projectPath.replace(/\/+$/, '')}/.sai/brainstorm-seed.md`;
  window.sai.fsReadFile(seedPath).then((content: string | null) => {
    if (!content) return;
    // Delete the seed file so it doesn't replay on next open
    window.sai.fsDelete(seedPath).catch(() => {});
    // Send the seed as the first user message
    window.sai.claudeSend(
      projectPath,
      content,
      undefined /* imagePaths */,
      permissionMode,
      effortLevel,
      modelChoice,
      claudeScope,
    );
  }).catch(() => { /* no seed file — normal case */ });
}
```

Note on `fsReadFile`: confirm it returns `null` (or rejects) for a missing file by reading `electron/services/fs.ts`. If it throws on missing-file, wrap the call in a try/catch and treat any error as "no seed file present."

- [ ] **Step 2: Verify `fs:readFile` behavior**

Run: `grep -n "fs:readFile" /var/home/mstephens/Documents/GitHub/sai/electron/services/fs.ts`
Read the handler to confirm whether missing-file throws or returns null. Adjust the Step 1 code accordingly. If it throws, the `.catch(() => {})` already handles it correctly — that's fine; remove the `if (!content)` line.

- [ ] **Step 3: Manually verify**

Run: `npm run dev`
Steps:
1. Create a project through the full brainstorm flow.
2. After project opens, the chat should auto-send the seed message and Claude should respond.
3. Close and reopen the project — the seed should NOT replay (file was deleted).

Expected: Seed sends once, then is gone.

- [ ] **Step 4: Commit**

```bash
git add src/components/Chat/ChatPanel.tsx
git commit -m "feat(brainstorm): chat panel consumes one-shot seed file"
```

---

## Task 13: Component tests for the modal

**Files:**
- Create: `tests/NewProjectModal.brainstorm.test.tsx`

- [ ] **Step 1: Write component tests**

Create `tests/NewProjectModal.brainstorm.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import NewProjectModal from '../src/components/NewProjectModal';

const flushPromises = () => new Promise(r => setTimeout(r, 0));

function mockSai(overrides: Partial<any> = {}) {
  const sai: any = {
    githubGetUser: vi.fn().mockResolvedValue(null),
    githubOnAuthComplete: vi.fn().mockReturnValue(() => {}),
    settingsGet: vi.fn().mockResolvedValue(''),
    selectFolder: vi.fn().mockResolvedValue(''),
    brainstormStart: vi.fn().mockResolvedValue({ sessionId: 'sess-1' }),
    brainstormSend: vi.fn().mockResolvedValue({ ok: true, text: 'AI reply' }),
    brainstormSynthesize: vi.fn().mockResolvedValue({
      ok: true, projectName: 'my-app', context: 'A summary.', transcript: 'transcript',
    }),
    brainstormEnd: vi.fn().mockResolvedValue({ ok: true }),
    brainstormOnChunk: vi.fn().mockReturnValue(() => {}),
    brainstormOnDone: vi.fn().mockImplementation((_sid: string, cb: any) => {
      setTimeout(() => cb('AI reply'), 0);
      return () => {};
    }),
    brainstormOnError: vi.fn().mockReturnValue(() => {}),
    scaffoldProject: vi.fn().mockResolvedValue({ ok: true, warnings: [] }),
    ...overrides,
  };
  (window as any).sai = sai;
  return sai;
}

describe('NewProjectModal brainstorm tab', () => {
  beforeEach(() => mockSai());

  it('renders both tabs and defaults to Setup', () => {
    render(<NewProjectModal onClose={() => {}} onCreated={() => {}} />);
    expect(screen.getByText('Setup')).toBeInTheDocument();
    expect(screen.getByText('Brainstorm')).toBeInTheDocument();
    expect(screen.getByText(/Parent directory/i)).toBeVisible();
  });

  it('"Use this →" is disabled until an AI reply lands', async () => {
    render(<NewProjectModal onClose={() => {}} onCreated={() => {}} />);
    fireEvent.click(screen.getByText('Brainstorm'));
    const btn = screen.getByRole('button', { name: /use this/i });
    expect(btn).toBeDisabled();

    const textarea = screen.getByPlaceholderText(/What are you thinking about building/i);
    fireEvent.change(textarea, { target: { value: 'a CLI' } });
    fireEvent.click(screen.getByLabelText('Send'));
    await waitFor(() => expect(screen.getByRole('button', { name: /use this/i })).not.toBeDisabled());
  });

  it('on synthesize, prefills name + context and switches to Setup', async () => {
    render(<NewProjectModal onClose={() => {}} onCreated={() => {}} />);
    fireEvent.click(screen.getByText('Brainstorm'));
    fireEvent.change(screen.getByPlaceholderText(/What are you thinking about building/i), { target: { value: 'a CLI' } });
    fireEvent.click(screen.getByLabelText('Send'));
    await waitFor(() => expect(screen.getByRole('button', { name: /use this/i })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: /use this/i }));
    await waitFor(() => expect((screen.getByPlaceholderText('my-app') as HTMLInputElement).value).toBe('my-app'));
    expect((screen.getByPlaceholderText(/What is this project for/i) as HTMLTextAreaElement).value).toBe('A summary.');
    expect(screen.getAllByText(/from brainstorm/i).length).toBeGreaterThan(0);
  });

  it('shows Replace? prompt when fields are already filled', async () => {
    render(<NewProjectModal onClose={() => {}} onCreated={() => {}} />);
    // Pre-fill name
    fireEvent.change(screen.getByPlaceholderText('my-app'), { target: { value: 'manual-name' } });
    fireEvent.click(screen.getByText('Brainstorm'));
    fireEvent.change(screen.getByPlaceholderText(/What are you thinking about building/i), { target: { value: 'a CLI' } });
    fireEvent.click(screen.getByLabelText('Send'));
    await waitFor(() => expect(screen.getByRole('button', { name: /use this/i })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: /use this/i }));
    await waitFor(() => expect(screen.getByText(/Replace your typed values/i)).toBeVisible());
    expect((screen.getByPlaceholderText('my-app') as HTMLInputElement).value).toBe('manual-name');
  });

  it('"from brainstorm" badge clears when user edits the field', async () => {
    render(<NewProjectModal onClose={() => {}} onCreated={() => {}} />);
    fireEvent.click(screen.getByText('Brainstorm'));
    fireEvent.change(screen.getByPlaceholderText(/What are you thinking about building/i), { target: { value: 'a CLI' } });
    fireEvent.click(screen.getByLabelText('Send'));
    await waitFor(() => expect(screen.getByRole('button', { name: /use this/i })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: /use this/i }));
    await waitFor(() => expect(screen.getAllByText(/from brainstorm/i).length).toBeGreaterThan(0));
    fireEvent.change(screen.getByPlaceholderText('my-app'), { target: { value: 'edited' } });
    await waitFor(() => expect(screen.queryAllByText(/from brainstorm/i).length).toBe(1));
    // (One badge remains on Context; the name badge cleared.)
  });
});
```

- [ ] **Step 2: Run test — should pass**

Run: `npx vitest run tests/NewProjectModal.brainstorm.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 3: Commit**

```bash
git add tests/NewProjectModal.brainstorm.test.tsx
git commit -m "test(brainstorm): NewProjectModal component tests"
```

---

## Task 14: Final manual E2E and full test sweep

- [ ] **Step 1: Run full test suite**

Run: `npx vitest run`
Expected: all tests pass, no regressions.

- [ ] **Step 2: Run type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Manual E2E walkthrough**

Run: `npm run dev`
Walkthrough:
1. New Project → Brainstorm tab → multi-turn conversation.
2. Click "Use this →" → fields prefill, switches to Setup, badges visible.
3. Create Project → new project opens.
4. Verify the chat sends the seed message and Claude responds.
5. Inspect new project: `.sai/brainstorm-seed.md` is gone after first open; `.sai/` is in `.gitignore`.
6. Open the New Project modal again with a typed name, brainstorm, "Use this →" → verify "Replace?" prompt appears.

Expected: All steps work as designed.

- [ ] **Step 4: Final commit (no-op or polish)**

Only commit if any polish-tweaks were needed during manual E2E.

---

## Notes for the implementer

- `claude -p` per-turn (rather than a long-lived process) is a deliberate simplification: the existing `electron/services/claude.ts` is heavily project-bound (cwd, session ids tied to projectPath, slash-command caching, scope/swarm logic). Wedging brainstorm into that would couple two different lifecycle stories. Per-turn spawn + `--resume` keeps the new code self-contained.
- The brainstorm session lives entirely in main-process memory. There's no persistence — closing the modal ends the brainstorm. This is intentional (see spec).
- `cwd: os.tmpdir()` for the spawn avoids creating a `.claude/` history in any user-visible directory.
- The chat panel's seed-consumption is gated on `aiProvider === 'claude'`. If users open the new project under a different provider, the seed file will sit there and be picked up on a later `claude`-provider mount. That's acceptable; if you'd rather always consume regardless of provider, generalize the send-call dispatch the same way as the existing `startFn` switch on line 685.
