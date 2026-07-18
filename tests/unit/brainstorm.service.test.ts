import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  __resetSessions, __setQueryFnForTest, createSession, getSession, deleteSession,
  composeTurnPrompt, runTurn, serializeTranscript,
} from '../../electron/services/brainstorm';
import { type ProjectBrief } from '../../electron/services/brainstorm/brief';

afterEach(() => { __setQueryFnForTest(null); __resetSessions(); });
beforeEach(() => __resetSessions());

describe('session store', () => {
  it('creates sessions with empty transcript and empty brief', () => {
    const { sessionId } = createSession();
    const s = getSession(sessionId)!;
    expect(s.transcript).toEqual([]);
    expect(s.brief.projectName).toBeNull();
    expect(s.pendingEdits).toEqual([]);
  });
  it('deleteSession removes the session', () => {
    const { sessionId } = createSession();
    deleteSession(sessionId);
    expect(getSession(sessionId)).toBeUndefined();
  });
});

describe('composeTurnPrompt', () => {
  it('is just the message for a fresh session', () => {
    const { sessionId } = createSession();
    expect(composeTurnPrompt(getSession(sessionId)!, 'hello')).toBe('hello');
  });
  it('replays transcript and drains pending user edits', () => {
    const { sessionId } = createSession();
    const s = getSession(sessionId)!;
    s.transcript.push({ role: 'user', content: 'hi' }, { role: 'assistant', content: 'yo' });
    s.pendingEdits.push('projectName → "my-tool"');
    const p = composeTurnPrompt(s, 'next');
    expect(p).toContain('User: hi');
    expect(p).toContain('You: yo');
    expect(p).toContain('[User edited the brief: projectName → "my-tool"]');
    expect(p).toContain("User's next message: next");
    expect(s.pendingEdits).toEqual([]);
  });
});

// Fake SDK query(): yields an assistant text message, then invokes the
// update_brief MCP handler the service wired into options.mcpServers, then a result.
function fakeQuery(opts: { text?: string; briefPatch?: Record<string, unknown>; fail?: boolean }) {
  return function query({ options }: { prompt: string; options: any }) {
    return (async function* () {
      if (opts.fail) throw new Error('boom');
      if (opts.briefPatch) {
        const server = options.mcpServers.brief;
        const handler = server.__handlersForTest.get('update_brief');
        await handler(opts.briefPatch);
      }
      if (opts.text) {
        yield { type: 'assistant', message: { content: [{ type: 'text', text: opts.text }] } };
      }
      yield { type: 'result', subtype: 'success' };
    })();
  };
}

describe('runTurn', () => {
  it('streams text, applies brief updates, and appends the transcript', async () => {
    __setQueryFnForTest(fakeQuery({ text: 'Sounds fun!', briefPatch: { projectName: 'toy', summary: 'A toy.' } }) as any);
    const { sessionId } = createSession();
    const chunks: string[] = [];
    const briefs: ProjectBrief[] = [];
    const r = await runTurn({ sessionId, userMessage: 'make a toy', onChunk: c => chunks.push(c), onBrief: b => briefs.push(b) });
    expect(r).toEqual({ ok: true, text: 'Sounds fun!' });
    expect(chunks).toEqual(['Sounds fun!']);
    expect(briefs.length).toBe(1);
    expect(briefs[0].projectName).toBe('toy');
    const s = getSession(sessionId)!;
    expect(s.brief.projectName).toBe('toy');
    expect(s.transcript).toEqual([
      { role: 'user', content: 'make a toy' },
      { role: 'assistant', content: 'Sounds fun!' },
    ]);
  });

  it('reports errors without touching transcript or brief', async () => {
    __setQueryFnForTest(fakeQuery({ fail: true }) as any);
    const { sessionId } = createSession();
    const r = await runTurn({ sessionId, userMessage: 'x', onChunk: () => {}, onBrief: () => {} });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/boom/);
    expect(getSession(sessionId)!.transcript).toEqual([]);
  });

  it('restores brief and pending edits when the stream fails mid-turn', async () => {
    const failingAfterPatch = ({ options }: { prompt: string; options: any }) =>
      (async function* () {
        const handler = options.mcpServers.brief.__handlersForTest.get('update_brief');
        await handler({ projectName: 'partial' });
        throw new Error('mid-stream');
      })();
    __setQueryFnForTest(failingAfterPatch as any);
    const { sessionId } = createSession();
    const s = getSession(sessionId)!;
    s.pendingEdits.push('summary → "user text"');
    const briefs: ProjectBrief[] = [];
    const r = await runTurn({ sessionId, userMessage: 'x', onChunk: () => {}, onBrief: b => briefs.push(b) });
    expect(r.ok).toBe(false);
    expect(s.brief.projectName).toBeNull();
    expect(s.pendingEdits).toEqual(['summary → "user text"']);
    expect(briefs[briefs.length - 1].projectName).toBeNull();
  });

  it('returns an error for unknown sessions', async () => {
    const r = await runTurn({ sessionId: 'nope', userMessage: 'x', onChunk: () => {}, onBrief: () => {} });
    expect(r.ok).toBe(false);
  });
});

describe('serializeTranscript', () => {
  it('formats turns as bold-role markdown', () => {
    const { sessionId } = createSession();
    const s = getSession(sessionId)!;
    s.transcript.push({ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' });
    expect(serializeTranscript(s)).toBe('**User:** a\n\n**Assistant:** b');
  });
});
