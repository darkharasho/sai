import { describe, it, expect } from 'vitest';
import { emptyChatState, reduceChat, reduceMany, LOAD_GUARD_ERROR_QUIET_MS } from '../../../src/lib/chat/reducer';
import type { ChatState } from '../../../src/lib/chat/types';
import { e, assistant, delta } from './helpers';

const claude = () => emptyChatState({ provider: 'claude' });
const started = (turnSeq: number, base: ChatState = claude()) =>
  reduceChat(base, e(base.lastSeq + 1, { type: 'streaming_start', turnSeq }));

describe('turn boundaries', () => {
  it('starts idle with turnSeq -1 and a forced new bubble', () => {
    const s = claude();
    expect(s.turn).toEqual({
      streaming: false, turnSeq: -1, startedAt: null, startIndex: null, forceNewBubble: true,
      nextSegmentStart: null, reasoningActive: false, loadGuardQuietUntil: null, loadGuardEnded: false,
    });
  });

  it('stale done (turnSeq 1 while current is 2) does not end the turn', () => {
    const s = reduceMany(claude(), [
      e(1, { type: 'streaming_start', turnSeq: 1 }),
      e(2, { type: 'streaming_start', turnSeq: 2 }),
      e(3, { type: 'done', turnSeq: 1 }),
    ]);
    expect(s.turn.streaming).toBe(true);
    expect(s.turn.turnSeq).toBe(2);
    // A stale result is ignored too: no replacement text lands.
    const r = reduceMany(s, [
      e(4, assistant(2, delta('new turn'))),
      e(5, { type: 'result', turnSeq: 1, result: 'old turn result' }),
    ]);
    expect(r.messages[0].content).toBe('new turn');
  });

  it('done with turnSeq null always ends the turn', () => {
    const s = reduceMany(started(5), [e(2, { type: 'done', turnSeq: null })]);
    expect(s.turn.streaming).toBe(false);
    expect(s.turn.turnSeq).toBe(-1);
  });

  it('done clears pendingApproval and Codex pending cards, sets turnSeq -1', () => {
    const s = reduceMany(started(1, emptyChatState({ provider: 'codex' })), [
      e(2, { type: 'approval_needed', provider: 'codex', toolName: 'Bash', toolUseId: 't1', command: 'rm', description: 'd', input: {}, requestHandle: 'h0' }),
      e(3, { type: 'user_input_needed', provider: 'codex', requestHandle: 'h1', questions: [] }),
      e(4, { type: 'mcp_elicitation_needed', provider: 'codex', requestHandle: 'h2', serverName: 's', message: 'm', mode: 'url', url: 'https://x' }),
      e(5, { type: 'system', subtype: 'task_progress', summary: 'Working' }),
    ]);
    expect(s.pendingApproval).not.toBeNull();
    expect(s.pendingCodexUserInput).not.toBeNull();
    expect(s.pendingCodexMcpElicitation).not.toBeNull();
    const d = reduceChat(s, e(6, { type: 'done', turnSeq: 1 }));
    expect(d.pendingApproval).toBeNull();
    expect(d.pendingCodexUserInput).toBeNull();
    expect(d.pendingCodexMcpElicitation).toBeNull();
    expect(d.streamHint).toBeNull();
    expect(d.turn.turnSeq).toBe(-1);
  });

  it('done finalizes a live reasoning row', () => {
    const s = reduceMany(started(1), [
      e(2, { type: 'reasoning_delta', text: 'r' }),
      e(3, { type: 'done', turnSeq: 1 }, 1502),
    ]);
    expect(s.messages[0].reasoningLive).toBeUndefined();
    expect(s.messages[0].reasoningDurationMs).toBe(500);
    expect(s.turn.reasoningActive).toBe(false);
  });

  it('process_exit clears subagents and pending cards and ends the turn', () => {
    const s = reduceMany(started(1), [
      e(2, { type: 'subagent_activity', agentId: 'a1', status: 'running', turnSeq: 1 }),
      e(3, { type: 'approval_needed', toolName: 'Bash', toolUseId: 't1', command: 'x', description: '', input: {} }),
      e(4, { type: 'process_exit' }),
    ]);
    expect(s.activeSubagents).toEqual({});
    expect(s.pendingApproval).toBeNull();
    expect(s.turn.streaming).toBe(false);
  });
});

describe('subagents', () => {
  it('subagent_activity tracks running agents; terminal status removes; stale turn ignored unless tracked terminal', () => {
    let s = reduceMany(started(1), [
      e(2, { type: 'subagent_activity', agentId: 'a1', status: 'running', turnSeq: 1, summary: '  Reading files ' }),
      e(3, { type: 'subagent_activity', agentId: 'a2', status: 'running', turnSeq: 1 }),
    ]);
    expect(s.activeSubagents).toEqual({ a1: { summary: 'Reading files', turnSeq: 1 }, a2: { summary: 'Working', turnSeq: 1 } });
    s = reduceChat(s, e(4, { type: 'subagent_activity', agentId: 'a2', status: 'completed', turnSeq: 1 }));
    expect(Object.keys(s.activeSubagents)).toEqual(['a1']);

    // The parent turn completes without settling children; a new turn's
    // stale running event is ignored, but the tracked child's terminal lands.
    s = reduceMany(s, [
      e(5, { type: 'done', turnSeq: 1 }),
      e(6, { type: 'subagent_activity', agentId: 'a3', status: 'running', turnSeq: 1 }),
    ]);
    expect(Object.keys(s.activeSubagents)).toEqual(['a1']);
    s = reduceChat(s, e(7, { type: 'subagent_activity', agentId: 'a1', status: 'failed', turnSeq: 1 }));
    expect(s.activeSubagents).toEqual({});
  });

  it('done with subagentsAborted clears activeSubagents; plain done keeps them', () => {
    const running = reduceMany(started(1), [
      e(2, { type: 'subagent_activity', agentId: 'a1', status: 'running', turnSeq: 1 }),
    ]);
    expect(Object.keys(reduceChat(running, e(3, { type: 'done', turnSeq: 1 })).activeSubagents)).toEqual(['a1']);
    expect(reduceChat(running, e(3, { type: 'done', turnSeq: 1, subagentsAborted: true })).activeSubagents).toEqual({});
    expect(reduceChat(running, e(3, { type: 'done', turnSeq: 1, subagentsSettled: true })).activeSubagents).toEqual({});
  });

  it('streaming_start clears subagents', () => {
    const s = reduceMany(started(1), [
      e(2, { type: 'subagent_activity', agentId: 'a1', status: 'running', turnSeq: 1 }),
      e(3, { type: 'streaming_start', turnSeq: 2 }),
    ]);
    expect(s.activeSubagents).toEqual({});
  });
});

describe('load guard', () => {
  const killed = {
    kind: 'killed', unitKind: 'agent', label: 'claude', sizeKb: 1, memUsedPct: 95, top: [], toldAi: '',
  };

  it('load_guard killed agent opens a 15s quiet window; error inside it ends turn once as done(null)', () => {
    expect(LOAD_GUARD_ERROR_QUIET_MS).toBe(15_000);
    let s = reduceMany(started(3), [
      e(2, { type: 'subagent_activity', agentId: 'a1', status: 'running', turnSeq: 3 }),
      e(3, { type: 'load_guard', provider: 'claude', id: 'lg-1', loadGuard: killed }, 2000),
    ]);
    expect(s.messages).toEqual([{ id: 'lg-1', role: 'system', content: '', timestamp: 2000, loadGuard: killed }]);
    expect(s.turn.loadGuardQuietUntil).toBe(2000 + 15_000);
    s = reduceChat(s, e(4, { type: 'error', text: 'process crashed' }, 3000));
    expect(s.turn.streaming).toBe(false);
    expect(s.turn.loadGuardEnded).toBe(true);
    expect(s.activeSubagents).toEqual({});
    expect(s.messages).toHaveLength(1);
    // A second error inside the window is swallowed without another done.
    const again = reduceChat(s, e(5, { type: 'error', text: 'more noise' }, 4000));
    expect(again.messages).toHaveLength(1);
    expect(again.turn).toEqual(s.turn);
  });

  it('load_guard for another provider is ignored; cards dedupe by id', () => {
    const note = { kind: 'note', text: 'System load: high' };
    const s = reduceMany(claude(), [
      e(1, { type: 'load_guard', provider: 'codex', id: 'x', loadGuard: note }),
      e(2, { type: 'load_guard', provider: 'claude', id: 'n1', loadGuard: note }),
      e(3, { type: 'load_guard', provider: 'claude', id: 'n1', loadGuard: note }),
      e(4, { type: 'load_guard', provider: 'claude', loadGuard: note }),
    ]);
    expect(s.messages.map(m => m.id)).toEqual(['n1', 'm4']);
    expect(s.turn.loadGuardQuietUntil).toBeNull();
  });

  it('error outside the quiet window appends an e<seq> error row and keeps streaming', () => {
    const s = reduceMany(started(1), [
      e(2, { type: 'load_guard', provider: 'claude', id: 'lg', loadGuard: killed }, 2000),
      e(3, { type: 'error', text: 'API Error: 500 {"error":{"type":"api_error","message":"boom"}}' }, 2000 + 15_000),
    ]);
    expect(s.messages[1]).toMatchObject({ id: 'e3', role: 'system', content: 'boom', timestamp: 17_000 });
    expect(s.messages[1].error).toMatchObject({ status: 500 });
    expect(s.turn.streaming).toBe(true);
  });

  it('streaming_start closes the quiet window', () => {
    const s = reduceMany(started(1), [
      e(2, { type: 'load_guard', provider: 'claude', id: 'lg', loadGuard: killed }, 2000),
      e(3, { type: 'streaming_start', turnSeq: 2 }, 2100),
      e(4, { type: 'error', text: 'real error' }, 2200),
    ]);
    expect(s.turn.loadGuardQuietUntil).toBeNull();
    expect(s.messages[1]).toMatchObject({ id: 'e4', content: 'real error' });
  });
});
