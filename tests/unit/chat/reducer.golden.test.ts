// @vitest-environment node
/**
 * Golden tests: the shared chat reducer over chat logs that the production
 * path wrote (see chatlogFixtures.generate.test.ts for how the fixtures were
 * produced). Snapshots were reviewed by hand; the explicit assertions below
 * pin what that review checked, so a snapshot update can't silently drop it.
 */
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { emptyChatState, reduceMany } from '../../../src/lib/chat/reducer';
import type { ChatLogEntry, ChatSettings, ChatState } from '../../../src/lib/chat/types';
import { ChatLogStore } from '../../../electron/services/chatlog/store';

const FIXTURES = path.resolve(__dirname, '../../fixtures/chatlog');

const CASES: Array<{ name: string; provider: ChatSettings['provider'] }> = [
  { name: 'claude-tools-reasoning', provider: 'claude' },
  { name: 'codex-two-turns', provider: 'codex' },
  { name: 'claude-interrupt-superseded', provider: 'claude' },
  { name: 'claude-background-wait', provider: 'claude' },
];

function load(name: string): ChatLogEntry[] {
  return fs.readFileSync(path.join(FIXTURES, `${name}.jsonl`), 'utf8')
    .split('\n').filter(Boolean).map((l) => JSON.parse(l) as ChatLogEntry);
}

const reduceAll = (provider: ChatSettings['provider'], entries: ChatLogEntry[]) =>
  reduceMany(emptyChatState({ provider }), entries);

/** Index of the first entry matching `pred`, for "after this event" checks. */
function upTo(entries: ChatLogEntry[], pred: (e: ChatLogEntry) => boolean): ChatLogEntry[] {
  const i = entries.findIndex(pred);
  expect(i).toBeGreaterThanOrEqual(0);
  return entries.slice(0, i + 1);
}

const bubbles = (s: ChatState) => s.messages.map((m) => {
  if (m.role !== 'assistant') return `${m.role}:${m.content}`;
  if (m.reasoning != null && !m.content && !m.toolCalls) return 'reasoning';
  if (m.toolCalls) return `tools:${m.toolCalls.map((t) => t.name).join(',')}`;
  return `assistant:${m.content}`;
});

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe.each(CASES)('golden: $name', ({ name, provider }) => {
  const entries = load(name);

  it('fixture is one chat with contiguous seqs', () => {
    expect(entries.length).toBeGreaterThan(0);
    expect(new Set(entries.map((e) => e.chatId)).size).toBe(1);
    expect(entries.map((e) => e.seq)).toEqual(entries.map((_, i) => i + 1));
  });

  it('reduces to the reviewed snapshot', () => {
    const state = reduceAll(provider, entries);
    expect(state.turn.streaming).toBe(false);
    expect(state.messages.some((m) => m.reasoningLive)).toBe(false);
    expect(state.messages.flatMap((m) => m.toolCalls ?? []).some((t) => t.liveOutput)).toBe(false);
    expect(state.lastSeq).toBe(entries.length);
    expect(state).toMatchSnapshot();
  });

  it('reducing in two halves equals reducing at once, at every split', () => {
    const whole = reduceAll(provider, entries);
    for (let i = 0; i <= entries.length; i++) {
      const halves = reduceMany(reduceAll(provider, entries.slice(0, i)), entries.slice(i));
      expect(halves, `split at ${i}`).toEqual(whole);
    }
  });

  it('replaying already-applied entries changes nothing', () => {
    const whole = reduceAll(provider, entries);
    expect(reduceMany(whole, entries)).toBe(whole);
  });

  it.each([1, 3, 7])('ChatLogStore compaction (compactAfter %i) gives the same state, live and reloaded', (compactAfter) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatlog-golden-'));
    dirs.push(dir);
    const chatId = entries[0].chatId;
    const meta = { projectPath: '/home/user/project', provider };
    let i = 0;
    const store = new ChatLogStore({ dir, now: () => entries[Math.min(i, entries.length - 1)].ts, compactAfter, flushMs: 1 });
    for (; i < entries.length; i++) {
      const appended = store.append(chatId, entries[i].ev, meta);
      expect(appended.seq).toBe(entries[i].seq);
    }
    const whole = reduceAll(provider, entries);
    // Compaction ran (a snapshot exists past seq 0) and the live state still agrees.
    expect(store.meta(chatId)!.snapshotSeq).toBeGreaterThan(0);
    expect(store.state(chatId)).toEqual(whole);
    store.close();

    // A fresh store rebuilds from snapshot + tail.
    const reopened = new ChatLogStore({ dir, compactAfter });
    expect(reopened.state(chatId)).toEqual(whole);
    const { snapshot, entries: tail } = reopened.read(chatId, 0);
    expect(reduceMany(snapshot!.state, tail)).toEqual(whole);
    reopened.close();
  });
});

describe('golden: hand-reviewed properties', () => {
  it('claude-tools-reasoning: reasoning rows, Bash and Read cards with outputs, final answer', () => {
    const entries = load('claude-tools-reasoning');
    const s = reduceAll('claude', entries);
    expect(bubbles(s)).toEqual([
      'user:Which version does package.json declare, and does the lockfile agree?',
      'reasoning',
      "assistant:I'll check the declared version first.",
      'tools:Bash',
      'reasoning',
      'tools:Read',
      'assistant:Both agree: `package.json` declares **1.37.1** and `package-lock.json` records the same version.',
    ]);
    const reasoning = s.messages.filter((m) => m.reasoning != null);
    expect(reasoning.map((m) => m.reasoning)).toEqual([
      'The user wants the declared version and whether the lockfile matches. I can read the version with a quick node one-liner, then read the top of package-lock.json to compare.',
      'Now compare with the lockfile header.',
    ]);
    for (const m of reasoning) expect(m.reasoningDurationMs).toBeGreaterThan(0);
    const tools = s.messages.flatMap((m) => m.toolCalls ?? []);
    expect(tools.map((t) => [t.name, t.output?.split('\n')[0]])).toEqual([
      ['Bash', '1.37.1'],
      ['Read', '     1\t{'],
    ]);
    expect(tools.every((t) => t.liveOutput === false && typeof t.durationMs === 'number')).toBe(true);
    // Both text bubbles were stamped by the turn end.
    for (const m of s.messages.filter((x) => x.role === 'assistant' && x.content)) expect(m.durationMs).toBeGreaterThan(0);

    // Mid-reasoning the row is live and the turn is streaming.
    const mid = reduceAll('claude', upTo(entries, (e) => e.ev.type === 'reasoning_delta'));
    expect(mid.turn.streaming).toBe(true);
    expect(mid.messages.at(-1)).toMatchObject({ reasoningLive: true });
  });

  it('codex-two-turns: reused item ids give turn 2 its own cards; turn 1 outputs stay', () => {
    const entries = load('codex-two-turns');
    const s = reduceAll('codex', entries);
    expect(bubbles(s)).toEqual([
      'user:What scripts does package.json define?',
      'reasoning',
      'tools:Bash',
      'assistant:The project defines four scripts: `dev`, `build`, `test` and `lint`.',
      'user:Run the lint one.',
      'reasoning',
      'tools:Bash',
      'assistant:Lint passes with no warnings.',
    ]);
    const tools = s.messages.flatMap((m) => m.toolCalls ?? []);
    expect(tools.map((t) => [t.id, t.turnSeq])).toEqual([['item_1', 1], ['item_1', 2]]);
    expect(tools[0].output).toContain('"lint": "eslint ."');
    expect(tools[0].input).toContain('npm pkg get scripts');
    expect(tools[1].output).toBe('\n> project@1.0.0 lint\n> eslint .\n\n');
    expect(tools[1].input).toContain('npm run lint');
    expect(tools.every((t) => t.liveOutput === false)).toBe(true);

    // The partial (item.updated) output streams live onto turn 2's card only.
    const partial = reduceAll('codex', upTo(entries, (e) => (e.ev as any).message?.content?.[0]?.partial === true));
    const partialTools = partial.messages.flatMap((m) => m.toolCalls ?? []);
    expect(partialTools[0]).toMatchObject({ output: tools[0].output, liveOutput: false });
    expect(partialTools[1]).toMatchObject({ liveOutput: true });
  });

  it('claude-interrupt-superseded: Stop ends turn 1, its late result is stale, turn 2 completes', () => {
    const entries = load('claude-interrupt-superseded');
    const s = reduceAll('claude', entries);
    expect(bubbles(s)).toEqual([
      'user:Write a long changelog entry for the queue strip.',
      'assistant:### Queue strip\n\n- Queued sends now show in a strip above the composer',
      'user:Actually, keep it to one line.',
      'assistant:Queued sends now wait in a strip above the composer.',
    ]);
    // No error row from the interrupted turn's error_during_execution result.
    expect(s.messages.some((m) => m.error)).toBe(false);

    // The late done(1) lands while turn 2 is open and must not end it.
    const lateDone = entries.findLast((e) => e.ev.type === 'done' && e.ev.turnSeq === 1)!;
    const afterLate = reduceAll('claude', entries.slice(0, lateDone.seq));
    expect(afterLate.turn).toMatchObject({ streaming: true, turnSeq: 2 });
  });

  it('claude-background-wait: the wait ends the turn, the resumed turn reopens and closes it', () => {
    const entries = load('claude-background-wait');
    const s = reduceAll('claude', entries);
    expect(bubbles(s)).toEqual([
      'user:Get a reviewer on the parser changes in the background.',
      "assistant:I'll launch a reviewer in the background.",
      'tools:Agent',
      "assistant:The reviewer is running. I'll report its findings when it finishes.",
      'assistant:The reviewer found one issue: `tokenize()` drops a trailing escaped quote. Everything else looks correct.',
    ]);
    const agent = s.messages.flatMap((m) => m.toolCalls ?? [])[0];
    expect(agent.output).toContain('Async agent launched successfully.');

    // At the wait (done with wait.kind background) the turn is idle: the
    // waiting pill rides the done event, not ChatState.
    const waitDone = entries.find((e) => e.ev.type === 'done')!;
    expect((waitDone.ev as any).wait).toMatchObject({ kind: 'background', taskCount: 1 });
    const waiting = reduceAll('claude', entries.slice(0, waitDone.seq));
    expect(waiting.turn.streaming).toBe(false);

    // Task progress during the wait shows as the stream hint; the resume clears it.
    const progress = entries.find((e) => (e.ev as any).subtype === 'task_progress')!;
    expect(reduceAll('claude', entries.slice(0, progress.seq)).streamHint).toBe('agent · Reading src/parser/tokenize.ts');
    const resumed = reduceAll('claude', upTo(entries, (e) => e.ev.type === 'streaming_start' && e.ev.turnSeq === 2));
    expect(resumed.turn).toMatchObject({ streaming: true, turnSeq: 2 });
    expect(resumed.streamHint).toBeNull();
    expect(s.streamHint).toBeNull();
  });
});
