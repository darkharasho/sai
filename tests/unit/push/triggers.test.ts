// @vitest-environment node
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ChatLogStore } from '@electron/services/chatlog/store';
import { ChatLogService } from '@electron/services/chatlog/service';
import { createPushTriggers } from '@electron/services/push/triggers';
import { DeskActivity, DESK_ACTIVE_WINDOW_S } from '@electron/services/push/deskActivity';
import { pushGate } from '@electron/services/push/gate';
import type { PushRegistration } from '@electron/services/push/registry';
import type { PushPlain } from '../../../src/lib/push/types';

const dirs: string[] = [];
const stores: ChatLogStore[] = [];
const disposers: Array<() => void> = [];
afterEach(() => {
  for (const d of disposers.splice(0)) d();
  for (const s of stores.splice(0)) { try { s.close(); } catch { /* ignore */ } }
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});
function tmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'push-trig-'));
  dirs.push(d);
  return d;
}

const REG: PushRegistration = {
  pushId: 'p'.repeat(22), sendSecret: 's'.repeat(43), secretId: 'i'.repeat(22),
  sealKey: Buffer.alloc(32, 1).toString('base64'), keyId: 'machine-1234', env: 'sandbox',
};

function mk(opts: { enabled?: boolean; devices?: string[] } = {}) {
  const project = tmp();
  const store = new ChatLogStore({ dir: tmp() });
  stores.push(store);
  const service = new ChatLogService({
    store, bus: () => null, sendToRenderer: () => {}, liveChats: () => [], providerOf: () => 'claude', devlog: () => {},
  });
  const regs = (opts.devices ?? ['dev-1']).map((deviceId) => ({ deviceId, reg: REG }));
  const viewing = new Set<string>();
  const desk = { focused: false, activeWorkspace: '', userActive: true };
  const sent: Array<{ deviceId: string; plain: PushPlain }> = [];
  const t = createPushTriggers({
    chatlog: { onEntry: (cb) => service.onAppend(cb), state: (id) => store.state(id), meta: (id) => store.meta(id) },
    registry: { all: () => regs },
    presence: { isViewing: (d, c) => viewing.has(`${d}:${c}`) },
    desktopPresence: () => desk,
    send: (target, plain) => { sent.push({ deviceId: target.deviceId, plain }); },
    enabled: () => opts.enabled ?? true,
    doneDelayMs: 0,
    now: () => 1234,
  });
  disposers.push(() => t.dispose());
  const ev = (chatId: string, e: Record<string, unknown>) => service.record({ ...e, scope: chatId, projectPath: project });
  const assistant = (chatId: string, text: string) =>
    ev(chatId, { type: 'assistant', message: { content: [{ type: 'text', text }] } });
  /** A complete, natural turn: streaming_start → text → result → done. */
  const turn = (chatId: string, seq: number, text: string) => {
    ev(chatId, { type: 'streaming_start', turnSeq: seq });
    assistant(chatId, text);
    ev(chatId, { type: 'result', turnSeq: seq, result: text, wait: { kind: 'none' } });
    ev(chatId, { type: 'done', turnSeq: seq });
  };
  return { store, service, ev, assistant, turn, sent, viewing, desk, project, triggers: t };
}

describe('push triggers', () => {
  it('a natural turn end pushes done with the chat title and final text', () => {
    const { store, turn, sent, project } = mk();
    turn('c1', 1, 'first');
    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual({
      deviceId: 'dev-1',
      plain: { v: 1, kind: 'done', chatId: 'c1', projectPath: project, title: path.basename(project), body: 'first', ts: 1234 },
    });
    store.patchMeta('c1', { title: 'Fix the build' });
    turn('c1', 2, 'x'.repeat(400));
    expect(sent).toHaveLength(2);
    expect(sent[1].plain.title).toBe('Fix the build');
    expect(Array.from(sent[1].plain.body)).toHaveLength(180);
  });

  it('approval_needed pushes once per approval id', () => {
    const { ev, sent } = mk({ devices: ['dev-1', 'dev-2'] });
    ev('c1', { type: 'streaming_start', turnSeq: 1 });
    const approval = (id: string) => ev('c1', {
      type: 'approval_needed', toolName: 'Bash', toolUseId: id, command: 'rm -rf build', description: '', input: {},
    });
    approval('tu-1');
    approval('tu-1'); // re-emitted (reload / reconnect)
    approval('tu-2'); // a burst: several tools in one turn
    approval('tu-2');
    approval('tu-3');
    const pushes = sent.filter((s) => s.plain.kind === 'approval');
    // Three distinct approvals × two devices, each exactly once.
    expect(pushes).toHaveLength(6);
    expect(pushes.filter((p) => p.deviceId === 'dev-1').map((p) => p.plain.body)).toEqual(['Approve Bash?', 'Approve Bash?', 'Approve Bash?']);
    // The turn then ends by the user's answers + result: one done.
    ev('c1', { type: 'approval_resolved', toolUseId: 'tu-1' });
    ev('c1', { type: 'result', turnSeq: 1, result: 'ok' });
    ev('c1', { type: 'done', turnSeq: 1 });
    expect(sent.filter((s) => s.plain.kind === 'done')).toHaveLength(2);
  });

  it('questions push the question text, once per question id', () => {
    const { ev, sent } = mk();
    ev('c1', { type: 'streaming_start', turnSeq: 1 });
    ev('c1', { type: 'question_needed', toolUseId: 'q1', question: 'Which database?' });
    ev('c1', { type: 'question_needed', toolUseId: 'q1', question: 'Which database?' });
    ev('c1', { type: 'plan_review_needed', toolUseId: 'q2', plan: '1. do it' });
    expect(sent.map((s) => [s.plain.kind, s.plain.body])).toEqual([
      ['question', 'Which database?'],
      ['question', 'A plan is ready for your review.'],
    ]);
  });

  it('done after superseded turn does not push', () => {
    const { ev, assistant, sent } = mk();
    // Turn 1 streams; the user sends again mid-stream: the backend emits the
    // pre-emptive done for turn 1 and starts turn 2.
    ev('c1', { type: 'streaming_start', turnSeq: 1 });
    assistant('c1', 'working on it');
    ev('c1', { type: 'done', turnSeq: 1 });
    ev('c1', { type: 'streaming_start', turnSeq: 2 });
    // Turn 1's own result and done drain late, stamped with the lagging seq.
    ev('c1', { type: 'result', turnSeq: 1, result: 'old answer' });
    ev('c1', { type: 'done', turnSeq: 1 });
    expect(sent).toEqual([]);
    // Turn 2 finishes for real: exactly one push, with turn 2's text.
    assistant('c1', 'new answer');
    ev('c1', { type: 'result', turnSeq: 2, result: 'new answer' });
    ev('c1', { type: 'done', turnSeq: 2 });
    expect(sent.map((s) => s.plain.body)).toEqual(['new answer']);
  });

  it('a user stop, a wait and an empty continuation result do not push', () => {
    const { ev, assistant, sent } = mk();
    // Stop: the backend ends the turn with a bare done, no result.
    ev('c1', { type: 'streaming_start', turnSeq: 1 });
    assistant('c1', 'half');
    ev('c1', { type: 'done', turnSeq: 1 });
    // Background wait.
    ev('c1', { type: 'streaming_start', turnSeq: 2 });
    ev('c1', { type: 'result', turnSeq: 2, result: '', wait: { kind: 'background', taskCount: 1 } });
    ev('c1', { type: 'done', turnSeq: 2, wait: { kind: 'background', taskCount: 1 } });
    // Continuation boundary (num_turns 0, empty text): resumes a second later.
    ev('c1', { type: 'streaming_start', turnSeq: 3 });
    ev('c1', { type: 'result', turnSeq: 3, result: '', continuation: true });
    ev('c1', { type: 'done', turnSeq: 3 });
    expect(sent).toEqual([]);
  });

  it('an ACP Stop answered with stopReason cancelled does not push', () => {
    const { ev, assistant, sent } = mk();
    // onStop awaits session/cancel; the agent answers session/prompt with
    // stopReason "cancelled" first, so the send path emits result then done.
    ev('c1', { type: 'streaming_start', turnSeq: 1 });
    assistant('c1', 'partial');
    ev('c1', { type: 'result', turnSeq: 1, stopReason: 'cancelled', usage: {} });
    ev('c1', { type: 'done', turnSeq: 1 });
    expect(sent).toEqual([]);
    // A normal ACP end (stopReason end_turn) still pushes.
    ev('c1', { type: 'streaming_start', turnSeq: 2 });
    assistant('c1', 'complete');
    ev('c1', { type: 'result', turnSeq: 2, stopReason: 'end_turn', usage: {} });
    ev('c1', { type: 'done', turnSeq: 2 });
    expect(sent.map((s) => s.plain.body)).toEqual(['complete']);
  });

  it('a turn that ends in an error pushes error with its message', () => {
    const { ev, sent } = mk();
    ev('c1', { type: 'streaming_start', turnSeq: 1 });
    ev('c1', { type: 'error', text: 'Codex turn failed: rate limited' });
    ev('c1', { type: 'done', turnSeq: 1 });
    expect(sent.map((s) => s.plain.kind)).toEqual(['error']);
    expect(sent[0].plain.body).toContain('rate limited');
    // A non-fatal warning followed by a real result is a normal done.
    ev('c1', { type: 'streaming_start', turnSeq: 2 });
    ev('c1', { type: 'error', text: 'warning: something' });
    ev('c1', { type: 'result', turnSeq: 2, result: 'fine' });
    ev('c1', { type: 'done', turnSeq: 2 });
    expect(sent.map((s) => s.plain.kind)).toEqual(['error', 'done']);
  });

  it('foreground presence for the chat suppresses push', () => {
    const { turn, sent, viewing } = mk({ devices: ['dev-1', 'dev-2'] });
    viewing.add('dev-1:c1');
    turn('c1', 1, 'hi');
    expect(sent.map((s) => s.deviceId)).toEqual(['dev-2']);
    // Another chat on the same phone still pushes.
    turn('c2', 1, 'other');
    expect(sent.map((s) => s.deviceId)).toEqual(['dev-2', 'dev-1', 'dev-2']);
  });

  it('desktop focused on the workspace suppresses push', () => {
    const { turn, sent, desk, project } = mk();
    desk.focused = true;
    desk.activeWorkspace = project + path.sep; // a differently-spelled path to the same folder
    turn('c1', 1, 'at desk');
    expect(sent).toEqual([]);
    // Focused on another workspace: push.
    desk.activeWorkspace = tmp();
    turn('c1', 2, 'elsewhere');
    // Right workspace but window not focused: push.
    desk.activeWorkspace = project;
    desk.focused = false;
    turn('c1', 3, 'away');
    expect(sent.map((s) => s.plain.body)).toEqual(['elsewhere', 'away']);
  });

  it('nothing is sent when the setting is off or no phone is registered', () => {
    const off = mk({ enabled: false });
    off.turn('c1', 1, 'hi');
    expect(off.sent).toEqual([]);
    const none = mk({ devices: [] });
    none.turn('c1', 1, 'hi');
    expect(none.sent).toEqual([]);
  });

  it('focused on the workspace but idle or locked: push (the user walked away)', () => {
    let idleS = 0;
    let clock = 1_000_000;
    const activity = new DeskActivity({ systemIdleSeconds: () => idleS, now: () => clock });
    const h = mk();
    h.desk.focused = true;
    h.desk.activeWorkspace = h.project;
    // The real presence: focus + workspace from notify.ts, activity from the tracker.
    Object.defineProperty(h.desk, 'userActive', { get: () => activity.isActive() });

    // Focused + recent input + low system idle: at the desk, suppressed.
    activity.markInput();
    h.turn('c1', 1, 'at desk');
    expect(h.sent).toEqual([]);

    // Focused, but the system has been idle for a minute: sent.
    idleS = DESK_ACTIVE_WINDOW_S;
    h.turn('c1', 2, 'idle');
    expect(h.sent.map((s) => s.plain.body)).toEqual(['idle']);

    // Back at the desk, then the screen locks: sent.
    idleS = 0;
    activity.markInput();
    h.turn('c1', 3, 'back');
    activity.setLocked(true);
    h.turn('c1', 4, 'locked');
    expect(h.sent.map((s) => s.plain.body)).toEqual(['idle', 'locked']);

    // Idle time stuck at 0 (Wayland): the last-input clock decides.
    activity.setLocked(false);
    activity.markInput();
    clock += DESK_ACTIVE_WINDOW_S * 1000;
    h.turn('c1', 5, 'stale input');
    expect(h.sent.map((s) => s.plain.body)).toEqual(['idle', 'locked', 'stale input']);
  });

  it('an error row after a successful result does not turn the done into an error', () => {
    const { ev, assistant, sent } = mk();
    ev('c1', { type: 'streaming_start', turnSeq: 1 });
    assistant('c1', 'all good');
    ev('c1', { type: 'result', turnSeq: 1, result: 'all good' });
    ev('c1', { type: 'error', text: 'warning: late stderr noise' });
    ev('c1', { type: 'done', turnSeq: 1 });
    expect(sent.map((s) => [s.plain.kind, s.plain.body])).toEqual([['done', 'all good']]);
  });

  it('a process exit that closes a turn with nothing pushes error once; stops and restarts stay silent', () => {
    const { ev, assistant, service, sent } = mk();
    ev('c1', { type: 'streaming_start', turnSeq: 1 });
    assistant('c1', 'working');
    ev('c1', { type: 'process_exit' });
    ev('c1', { type: 'process_exit' }); // a second exit: the turn is already closed
    expect(sent.map((s) => [s.plain.kind, s.plain.body])).toEqual([['error', 'The agent process exited.']]);
    // A process exit after a successful result is a normal done.
    ev('c1', { type: 'streaming_start', turnSeq: 2 });
    ev('c1', { type: 'result', turnSeq: 2, result: 'finished' });
    ev('c1', { type: 'process_exit' });
    expect(sent.map((s) => s.plain.kind)).toEqual(['error', 'done']);
    // A user Stop (bare done) stays silent.
    ev('c1', { type: 'streaming_start', turnSeq: 3 });
    ev('c1', { type: 'done', turnSeq: 3 });
    // Startup repair closes an open turn with app_restart: silent.
    ev('c1', { type: 'streaming_start', turnSeq: 4 });
    service.startupRepair();
    expect(sent.map((s) => s.plain.kind)).toEqual(['error', 'done']);
  });
});

describe('push gate', () => {
  it('needs Mobile Remote on and the pushNotifications setting not off', () => {
    let settings: unknown = {};
    let remote = true;
    const gate = pushGate(() => settings, () => remote);
    expect(gate()).toBe(true); // missing setting means on
    settings = { pushNotifications: false };
    expect(gate()).toBe(false);
    settings = { pushNotifications: true };
    remote = false;
    expect(gate()).toBe(false);
    remote = true;
    expect(gate()).toBe(true);
    // An unreadable settings file keeps the default (on), still gated by remote.
    const broken = pushGate(() => { throw new Error('ENOENT'); }, () => remote);
    expect(broken()).toBe(true);
    remote = false;
    expect(broken()).toBe(false);
  });
});
