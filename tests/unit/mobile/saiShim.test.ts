// The phone window.sai shim over a real V2Client and a scripted socket.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { V2Client } from '../../../mobile/src/v2/client';
import { createSaiShim } from '../../../mobile/src/v2/saiShim';
import type { NativeApi } from '../../../mobile/src/v2/types';
import { FakeSocket } from './fakeSocket';

const last = () => FakeSocket.all[FakeSocket.all.length - 1];
const tick = () => new Promise((r) => setTimeout(r, 0));

let native: NativeApi & { toasts: string[]; opened: string[]; copied: string[] };
let settings: Record<string, unknown>;
let client: V2Client;

function setup() {
  client = new V2Client({ url: 'ws://desk/ws', token: 't', WebSocketImpl: FakeSocket as any, random: () => 0.5 });
  native = {
    toasts: [], opened: [], copied: [],
    openUrl(u) { native.opened.push(u); },
    copyText(t) { native.copied.push(t); },
    toast(m) { native.toasts.push(m); },
  };
  settings = { theme: 'dark' };
  const sai = createSaiShim(client, { native, settings: () => settings });
  client.connect();
  last().open();
  last().authOk();
  return sai;
}

const sentOf = (type: string) => last().sent.filter((f) => f.type === type);
const ack = (clientId: string, extra: Record<string, unknown> = {}) =>
  last().recv({ v: 2, type: 'chat.ack', result: { clientId, ok: true, duplicate: false, seq: 9, ...extra } });

beforeEach(() => { FakeSocket.all = []; vi.spyOn(console, 'warn').mockImplementation(() => {}); });
afterEach(() => { client?.close(); vi.restoreAllMocks(); });

describe('saiShim chatlog', () => {
  it('open resolves on chat.entries with the preceding snapshot and its olderCount', async () => {
    const sai = setup();
    const p = sai.chatlog!.open('c1', 0, { panel: true });
    expect(sentOf('chat.subscribe')).toEqual([{ type: 'chat.subscribe', chatId: 'c1', after: 0 }]);
    // Snapshot state from an older desktop lacks the Task 1 fields: normalized.
    last().recv({ type: 'chat.snapshot', chatId: 'c1', seq: 5, state: { messages: [], lastSeq: 5, turn: {}, queue: [], settings: { provider: 'claude' } }, olderCount: 250 });
    last().recv({ type: 'chat.entries', chatId: 'c1', entries: [{ chatId: 'c1', seq: 6, ts: 1, ev: { type: 'done' } }] });
    const res = await p;
    expect(res.snapshot?.seq).toBe(5);
    expect(res.snapshot?.state).toMatchObject({ waiting: null, followUp: null, awaitingQuestion: false });
    expect(res.entries.map((e) => e.seq)).toEqual([6]);
    expect(res.headSeq).toBe(6);
    expect(res.meta).toBeNull();
    expect(res.olderCount).toBe(250);
  });

  it('onEvent fans out live chat.entry frames', async () => {
    const sai = setup();
    const got: number[] = [];
    sai.chatlog!.onEvent((e) => got.push(e.seq));
    const p = sai.chatlog!.open('c1', 0);
    last().recv({ type: 'chat.entries', chatId: 'c1', entries: [{ chatId: 'c1', seq: 1, ts: 1, ev: { type: 'done' } }] });
    await p;
    last().recv({ type: 'chat.entry', chatId: 'c1', entry: { chatId: 'c1', seq: 2, ts: 2, ev: { type: 'done' } } });
    expect(got).toEqual([2]); // history from the open is not fanned out
  });

  it('claudeOnMessage re-emits live entry events', async () => {
    const sai = setup();
    const evs: any[] = [];
    const off = sai.claudeOnMessage((m: any) => evs.push(m));
    const p = sai.chatlog!.open('c1', 0);
    last().recv({ type: 'chat.entries', chatId: 'c1', entries: [{ chatId: 'c1', seq: 1, ts: 1, ev: { type: 'ready', scope: 'c1' } }] });
    await p;
    const ev = { type: 'result', scope: 'c1', usage: { input_tokens: 3 } };
    last().recv({ type: 'chat.entry', chatId: 'c1', entry: { chatId: 'c1', seq: 2, ts: 2, ev } });
    last().recv({ type: 'chat.entry', chatId: 'c1', entry: { chatId: 'c1', seq: 2, ts: 2, ev } }); // duplicate seq
    expect(evs).toEqual([ev]);
    off();
    last().recv({ type: 'chat.entry', chatId: 'c1', entry: { chatId: 'c1', seq: 3, ts: 3, ev } });
    expect(evs).toHaveLength(1);
  });

  it('a reconnect catch-up without a snapshot fans its entries out; with one it asks the reader to resync', async () => {
    const sai = setup();
    const got: number[] = [];
    const resyncs: string[] = [];
    sai.chatlog!.onEvent((e) => got.push(e.seq));
    sai.chatlog!.onResync!((id) => resyncs.push(id));
    const p = sai.chatlog!.open('c1', 0);
    last().recv({ type: 'chat.entries', chatId: 'c1', entries: [{ chatId: 'c1', seq: 1, ts: 1, ev: { type: 'done' } }] });
    await p;
    last().serverClose(1006);
    client.resume();
    last().open(); last().authOk();
    expect(sentOf('chat.subscribe')).toEqual([{ type: 'chat.subscribe', chatId: 'c1', after: 1 }]);
    last().recv({ type: 'chat.entries', chatId: 'c1', entries: [{ chatId: 'c1', seq: 2, ts: 2, ev: { type: 'done' } }] });
    expect(got).toEqual([2]);
    expect(resyncs).toEqual([]);

    last().serverClose(1006);
    client.resume();
    last().open(); last().authOk();
    expect(sentOf('chat.subscribe')[0].after).toBe(2);
    last().recv({ type: 'chat.snapshot', chatId: 'c1', seq: 40, state: { messages: [], lastSeq: 40, turn: {}, queue: [], settings: { provider: 'claude' } }, olderCount: 0 });
    last().recv({ type: 'chat.entries', chatId: 'c1', entries: [] });
    expect(resyncs).toEqual(['c1']);
    expect(got).toEqual([2]);
  });

  it('a replay\'s answer is not taken for an open sent after it', async () => {
    const sai = setup();
    const got: number[] = [];
    sai.chatlog!.onEvent((e) => got.push(e.seq));
    const p0 = sai.chatlog!.open('c1', 0);
    last().recv({ type: 'chat.entries', chatId: 'c1', entries: [{ chatId: 'c1', seq: 1, ts: 1, ev: { type: 'done' } }, { chatId: 'c1', seq: 2, ts: 2, ev: { type: 'done' } }] });
    await p0;
    last().serverClose(1006);
    client.resume();
    last().open(); last().authOk(); // replays c1 from 2
    const p = sai.chatlog!.open('c1', 1); // the reader's own re-open, sent after the replay
    expect(sentOf('chat.subscribe').map((f) => f.after)).toEqual([2, 1]);
    last().recv({ type: 'chat.entries', chatId: 'c1', entries: [{ chatId: 'c1', seq: 3, ts: 3, ev: { type: 'done' } }] });
    expect(got).toEqual([3]); // the replay's catch-up, fanned out
    let settled = false;
    void p.then(() => { settled = true; });
    await tick();
    expect(settled).toBe(false);
    last().recv({ type: 'chat.entries', chatId: 'c1', entries: [{ chatId: 'c1', seq: 2, ts: 2, ev: { type: 'done' } }, { chatId: 'c1', seq: 3, ts: 3, ev: { type: 'done' } }] });
    await expect(p).resolves.toMatchObject({ entries: [{ seq: 2 }, { seq: 3 }] });
    expect(client.state).toBe('open');
  });

  it('an open pending across a reconnect is re-sent and still resolves', async () => {
    const sai = setup();
    const p = sai.chatlog!.open('c1', 0);
    last().serverClose(1006);
    client.resume();
    last().open(); last().authOk();
    expect(sentOf('chat.subscribe')).toEqual([{ type: 'chat.subscribe', chatId: 'c1', after: 0 }]);
    last().recv({ type: 'chat.entries', chatId: 'c1', entries: [] });
    await expect(p).resolves.toMatchObject({ entries: [], snapshot: null });
  });

  it('a read_failed error rejects the pending open', async () => {
    const sai = setup();
    const p = sai.chatlog!.open('c1', 0);
    last().recv({ type: 'chat.error', chatId: 'c1', code: 'read_failed', message: 'disk' });
    await expect(p).rejects.toThrow('disk');
  });

  it('command resolves on its ack; un-acked commands are resent after reconnect with the same clientId', async () => {
    const sai = setup();
    const p = sai.chatlog!.command({ kind: 'send', chatId: 'c1', clientId: 'k1', text: 'hi', origin: 'remote', projectPath: '/p' } as any);
    expect(sentOf('chat.command').map((f) => f.command.clientId)).toEqual(['k1']);
    last().serverClose(1006);
    client.resume();
    last().open(); last().authOk();
    expect(sentOf('chat.command').map((f) => f.command.clientId)).toEqual(['k1']);
    ack('k1', { duplicate: true });
    await expect(p).resolves.toMatchObject({ clientId: 'k1', ok: true, duplicate: true });
    // Acked: not resent again.
    last().serverClose(1006);
    client.resume();
    last().open(); last().authOk();
    expect(sentOf('chat.command')).toEqual([]);
  });

  it('a command issued offline is sent once on connect', async () => {
    const sai = setup();
    last().serverClose(1006);
    const p = sai.chatlog!.command({ kind: 'interrupt', chatId: 'c1', clientId: 'k2' } as any);
    client.resume();
    last().open(); last().authOk();
    expect(sentOf('chat.command').map((f) => f.command.clientId)).toEqual(['k2']);
    ack('k2');
    await expect(p).resolves.toMatchObject({ ok: true });
  });

  it('appendClient cleared maps to clear command', async () => {
    const sai = setup();
    const p = sai.chatlog!.appendClient('c1', { type: 'cleared' } as any);
    const [f] = sentOf('chat.command');
    expect(f.command).toMatchObject({ kind: 'clear', chatId: 'c1' });
    expect(typeof f.command.clientId).toBe('string');
    ack(f.command.clientId, { seq: 12 });
    await expect(p).resolves.toMatchObject({ chatId: 'c1', seq: 12, ev: { type: 'cleared' } });
  });

  it('appendClient maps notes, watcher snapshots and local user messages to clientEvent with fresh clientIds', async () => {
    const sai = setup();
    const help = { type: 'user_message', local: true, text: '/help' } as any;
    const note = { type: 'local_note', content: 'commands…' } as any;
    const p1 = sai.chatlog!.appendClient('c1', help, { projectPath: '/p', provider: 'claude' });
    const p2 = sai.chatlog!.appendClient('c1', note, { projectPath: '/p', provider: 'claude' });
    void sai.chatlog!.appendClient('c1', { type: 'watcher_snapshot', messageId: 'm', snapshot: {} } as any).catch(() => {});
    const cmds = sentOf('chat.command').map((f) => f.command);
    expect(cmds.map((c) => c.kind)).toEqual(['clientEvent', 'clientEvent', 'clientEvent']);
    expect(cmds[0]).toMatchObject({ chatId: 'c1', ev: help, projectPath: '/p', provider: 'claude' });
    expect(new Set(cmds.map((c) => c.clientId)).size).toBe(3);
    ack(cmds[0].clientId, { seq: 1 });
    ack(cmds[1].clientId, { seq: 2 });
    await expect(p1).resolves.toMatchObject({ seq: 1 });
    await expect(p2).resolves.toMatchObject({ seq: 2 });
  });

  it('appendClient rejects other event types and a refused command', async () => {
    const sai = setup();
    await expect(sai.chatlog!.appendClient('c1', { type: 'assistant' } as any)).rejects.toThrow();
    await expect(sai.chatlog!.appendClient('c1', { type: 'user_message', text: 'x' } as any)).rejects.toThrow();
    expect(sentOf('chat.command')).toEqual([]);
    const p = sai.chatlog!.appendClient('c1', { type: 'cleared' } as any);
    const [f] = sentOf('chat.command');
    last().recv({ type: 'chat.ack', result: { clientId: f.command.clientId, ok: false, duplicate: false, error: 'nope' } });
    await expect(p).rejects.toThrow('nope');
  });

  it('page sends chat.page and resolves its messages', async () => {
    const sai = setup();
    const p = sai.chatlog!.page!('c1', 250, 200);
    const [f] = sentOf('chat.page');
    expect(f).toMatchObject({ chatId: 'c1', beforeIndex: 250, limit: 200 });
    last().recv({ type: 'chat.page.result', reqId: f.reqId, chatId: 'c1', messages: [{ id: 'm50' }], olderCount: 50 });
    await expect(p).resolves.toEqual({ messages: [{ id: 'm50' }], olderCount: 50 });
  });

  it('list subscribes once, then serves the pushed cache', async () => {
    const sai = setup();
    const p = sai.chatlog!.list('/p');
    const p2 = sai.chatlog!.list('/p');
    const subs = sentOf('chats.subscribe');
    expect(subs).toHaveLength(1);
    last().recv({ type: 'chats.list.result', reqId: subs[0].reqId, chats: [{ chatId: 'a' }] });
    expect(await p).toEqual([{ chatId: 'a' }]);
    expect(await p2).toEqual([{ chatId: 'a' }]);
    last().recv({ type: 'chats.changed', projectPath: '/p', chats: [{ chatId: 'a' }, { chatId: 'b' }] });
    expect(await sai.chatlog!.list('/p')).toEqual([{ chatId: 'a' }, { chatId: 'b' }]);
    expect(sentOf('chats.subscribe')).toHaveLength(1);
  });

  it('importMessages resolves marked; bindLegacyScope, delete and patchMeta are no-ops', async () => {
    const sai = setup();
    await expect(sai.chatlog!.importMessages('c1', { projectPath: '', provider: 'claude', createdAt: 0, updatedAt: 0 }, [])).resolves.toBe('marked');
    await sai.chatlog!.bindLegacyScope('/p', 'c1');
    await sai.chatlog!.delete(['c1']);
    await sai.chatlog!.patchMeta('c1', { title: 'x' });
    expect(last().sent.map((f) => f.type)).toEqual(['auth']);
  });
});

describe('saiShim fix round 1', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('a chatlog-unavailable error never rejects a pending command: its later ack resolves it, sent once', async () => {
    const sai = setup();
    const p = sai.chatlog!.command({ kind: 'send', chatId: 'c1', clientId: 'k1', text: 'hi', origin: 'remote', projectPath: '/p' } as any);
    let rejected = false;
    p.catch(() => { rejected = true; });
    // An older desktop's error names no frame (the replayed subscribe failed; the send ran).
    last().recv({ type: 'chat.error', code: 'unavailable', message: 'chat log is not available' });
    await tick();
    expect(rejected).toBe(false);
    ack('k1');
    await expect(p).resolves.toMatchObject({ clientId: 'k1', ok: true });
    expect(sentOf('chat.command')).toHaveLength(1);
  });

  it('a command refused as unavailable is resent with the same clientId', async () => {
    vi.useFakeTimers();
    const sai = setup();
    const p = sai.chatlog!.command({ kind: 'interrupt', chatId: 'c1', clientId: 'k9' } as any);
    last().recv({ type: 'chat.error', chatId: 'c1', clientId: 'k9', code: 'unavailable', message: 'chat log is not available' });
    expect(sentOf('chat.command')).toHaveLength(1);
    vi.advanceTimersByTime(1000);
    expect(sentOf('chat.command').map((f) => f.command.clientId)).toEqual(['k9', 'k9']);
    ack('k9');
    await expect(p).resolves.toMatchObject({ ok: true });
    vi.advanceTimersByTime(5000);
    expect(sentOf('chat.command')).toHaveLength(2);
  });

  it('an unavailable subscribe (chatId echoed) rejects only that chat\'s open', async () => {
    const sai = setup();
    const a = sai.chatlog!.open('A', 0);
    const b = sai.chatlog!.open('B', 0);
    last().recv({ type: 'chat.error', chatId: 'A', code: 'unavailable', message: 'chat log is not available' });
    await expect(a).rejects.toThrow();
    last().recv({ type: 'chat.entries', chatId: 'B', entries: [] });
    await expect(b).resolves.toMatchObject({ entries: [] });
  });

  it('close(A) offline settles its pending open; a new open(A) resolves after reconnect', async () => {
    const sai = setup();
    const p1 = sai.chatlog!.open('A', 0);
    last().serverClose(1006);
    sai.chatlog!.close!('A');
    await expect(p1).rejects.toThrow();
    const p2 = sai.chatlog!.open('A', 0);
    client.resume();
    last().open(); last().authOk();
    expect(sentOf('chat.subscribe')).toEqual([{ type: 'chat.subscribe', chatId: 'A', after: 0 }]);
    last().recv({ type: 'chat.entries', chatId: 'A', entries: [{ chatId: 'A', seq: 1, ts: 1, ev: { type: 'done' } }] });
    await expect(p2).resolves.toMatchObject({ entries: [{ seq: 1 }] });
    expect(client.state).toBe('open');
  });

  it('close(A) online drops the answers still owed to the closed subscription', async () => {
    const sai = setup();
    const evs: any[] = [];
    sai.claudeOnMessage((m: any) => evs.push(m));
    const p1 = sai.chatlog!.open('A', 5);
    sai.chatlog!.close!('A');
    await expect(p1).rejects.toThrow();
    expect(sentOf('chat.unsubscribe')).toEqual([{ type: 'chat.unsubscribe', chatId: 'A' }]);
    const p2 = sai.chatlog!.open('A', 0);
    // The server answers the closed subscribe first, then the new one.
    last().recv({ type: 'chat.entries', chatId: 'A', entries: [{ chatId: 'A', seq: 6, ts: 6, ev: { type: 'stale' } }] });
    last().recv({ type: 'chat.snapshot', chatId: 'A', seq: 6, state: { messages: [], lastSeq: 6, turn: {}, queue: [], settings: { provider: 'claude' } }, olderCount: 0 });
    last().recv({ type: 'chat.entries', chatId: 'A', entries: [] });
    const r = await p2;
    expect(r.snapshot?.seq).toBe(6);
    expect(evs).toEqual([]);
    expect(client.state).toBe('open');
  });

  it('unpaired rejects pending opens and commands, and later ones at once', async () => {
    const sai = setup();
    const o = sai.chatlog!.open('A', 0);
    const c = sai.chatlog!.command({ kind: 'interrupt', chatId: 'A', clientId: 'k3' } as any);
    last().serverClose(4001);
    await expect(o).rejects.toThrow();
    await expect(c).rejects.toThrow();
    await expect(sai.chatlog!.command({ kind: 'interrupt', chatId: 'A', clientId: 'k4' } as any)).rejects.toThrow();
    await expect(sai.chatlog!.open('A', 0)).rejects.toThrow();
  });

  it('close() rejects pending opens and commands, even when already offline', async () => {
    const sai = setup();
    last().serverClose(1006);
    const o = sai.chatlog!.open('A', 0);
    const c = sai.chatlog!.command({ kind: 'interrupt', chatId: 'A', clientId: 'k5' } as any);
    client.close();
    await expect(o).rejects.toThrow();
    await expect(c).rejects.toThrow();
  });
});

describe('saiShim mappings', () => {
  it('provider starts resolve at once with no slash commands', async () => {
    const sai = setup();
    for (const k of ['claudeStart', 'codexStart', 'geminiStart', 'kimiStart']) {
      await expect(sai[k]('/p', 'c1')).resolves.toEqual({ slashCommands: [] });
    }
  });

  it('settingsGet reads the app.settings feed with a default', async () => {
    const sai = setup();
    await expect(sai.settingsGet('theme', 'light')).resolves.toBe('dark');
    await expect(sai.settingsGet('accent', 'blue')).resolves.toBe('blue');
    settings = { theme: 'light' };
    await expect(sai.settingsGet('theme')).resolves.toBe('light');
  });

  it('model lists, slash refresh and file reads go over v2 requests', async () => {
    const sai = setup();
    const m = sai.codexModels(true);
    const fm = sentOf('models.list')[0];
    expect(fm.provider).toBe('codex');
    last().recv({ type: 'models.list.result', reqId: fm.reqId, provider: 'codex', models: [{ id: 'o3' }] });
    await expect(m).resolves.toEqual([{ id: 'o3' }]);

    const s = sai.claudeRefreshSlashCommands('/p', 'c1');
    const fs = sentOf('slash.list')[0];
    expect(fs).toMatchObject({ projectPath: '/p', chatId: 'c1' });
    last().recv({ type: 'slash.list.result', reqId: fs.reqId, commands: [{ name: 'x' }] });
    await expect(s).resolves.toEqual([{ name: 'x' }]);

    const img = sai.fsReadFileBase64('/u/tool-result-images/a.png');
    const fi = sentOf('file.read')[0];
    expect(fi).toMatchObject({ kind: 'toolImage', ref: '/u/tool-result-images/a.png' });
    last().recv({ type: 'file.read.result', reqId: fi.reqId, dataUrl: 'data:image/png;base64,AAA=' });
    await expect(img).resolves.toBe('data:image/png;base64,AAA=');

    const model = sai.modelReadCached('k1');
    const fmod = sentOf('file.read')[1];
    expect(fmod).toMatchObject({ kind: 'model', ref: 'k1' });
    last().recv({ type: 'file.read.result', reqId: fmod.reqId, dataUrl: 'data:application/octet-stream;base64,AQID' });
    const buf = await model;
    expect(Array.from(new Uint8Array(buf))).toEqual([1, 2, 3]);

    const missing = sai.modelReadCached('k2');
    last().recv({ type: 'file.read.result', reqId: sentOf('file.read')[2].reqId, error: 'not_found' });
    await expect(missing).resolves.toBeNull();
  });

  it('file reads go one at a time (the desktop allows one in flight per socket)', async () => {
    const sai = setup();
    const a = sai.fsReadFileBase64('/u/tool-result-images/a.png');
    const b = sai.fsReadFileBase64('/u/tool-result-images/b.png');
    const c = sai.modelReadCached('k1');
    await Promise.resolve();
    expect(sentOf('file.read')).toHaveLength(1);
    last().recv({ type: 'file.read.result', reqId: sentOf('file.read')[0].reqId, dataUrl: 'data:image/png;base64,AAA=' });
    await expect(a).resolves.toBe('data:image/png;base64,AAA=');
    await vi.waitFor(() => expect(sentOf('file.read')).toHaveLength(2));
    expect(sentOf('file.read')[1]).toMatchObject({ ref: '/u/tool-result-images/b.png' });
    // A failed read still frees the slot.
    last().recv({ type: 'chat.error', reqId: sentOf('file.read')[1].reqId, code: 'read_failed', message: 'x' });
    await b.catch(() => {});
    await vi.waitFor(() => expect(sentOf('file.read')).toHaveLength(3));
    expect(sentOf('file.read')[2]).toMatchObject({ kind: 'model', ref: 'k1' });
    last().recv({ type: 'file.read.result', reqId: sentOf('file.read')[2].reqId, error: 'not_found' });
    await expect(c).resolves.toBeNull();
  });

  it('claudeStopTask sends stopTask; ok:false (already ended) resolves false', async () => {
    const sai = setup();
    const p = sai.claudeStopTask('/p', 'c1', 'task9');
    const [f] = sentOf('chat.command');
    expect(f.command).toMatchObject({ kind: 'stopTask', chatId: 'c1', taskId: 'task9' });
    last().recv({ type: 'chat.ack', result: { clientId: f.command.clientId, ok: false, duplicate: false, error: 'no task' } });
    await expect(p).resolves.toBe(false);
  });

  it('claudeCompact sends a queued compact command', () => {
    const sai = setup();
    sai.claudeCompact('/p', 'default', 'high', 'opus', 'c1');
    expect(sentOf('chat.command')[0].command).toMatchObject({ kind: 'compact', chatId: 'c1', queue: true });
  });

  it('claudeOnBackgroundTasks maps chat.background to the desktop payload', () => {
    const sai = setup();
    const got: any[] = [];
    sai.claudeOnBackgroundTasks((p: any) => got.push(p));
    last().recv({ type: 'chat.background', chatId: 'c1', tasks: [{ id: 't' }] });
    expect(got).toEqual([{ projectPath: '', scope: 'c1', tasks: [{ id: 't' }] }]);
  });

  it('links and clipboard go to the native plugins; images ride as data URLs', async () => {
    const sai = setup();
    await sai.openExternal('https://x.test');
    await expect(sai.clipboardWrite('hello')).resolves.toBe(true);
    await expect(sai.clipboardReadImage()).resolves.toBeNull();
    await expect(sai.saveImage('data:image/png;base64,AA')).resolves.toBe('');
    expect(native.opened).toEqual(['https://x.test']);
    expect(native.copied).toEqual(['hello']);
  });

  it('desktop-only calls are stubs with empty values; sudo answers toast', async () => {
    const sai = setup();
    sai.devlog('x', {});
    await expect(sai.loadGuardGetState()).resolves.toMatchObject({ enabled: false, paused: false });
    expect(typeof sai.loadGuardOnState(() => {})).toBe('function');
    await expect(sai.loadGuardTopUsers()).resolves.toEqual([]);
    await expect(sai.mcpRuntimeStatus('/p', 'c1')).resolves.toBeNull();
    await expect(sai.codexUsageFetch(true)).resolves.toBeNull();
    await expect(sai.usageFetch()).resolves.toBeNull();
    await expect(sai.jiraConfigured()).resolves.toBe(false);
    await expect(sai.linearConfigured()).resolves.toBe(false);
    await expect(sai.githubApiGet('/repos/x')).resolves.toMatchObject({ ok: false, status: 0 });
    await expect(sai.codexAppServerApprove('/p', 'c1', 'h', 'accept')).resolves.toMatchObject({ ok: false });
    await expect(sai.renderMintFileUrl({ cwd: '/p' })).resolves.toMatchObject({ ok: false });
    expect(sai.renderOpenInBrowser).toBeUndefined();
    expect(sai.storeToolResultImage).toBeUndefined();
    expect(sai.setTitleBarOverlay('#000', '#fff')).toBeUndefined();
    await sai.claudeSudoReply('p1', 'pw');
    expect(native.toasts).toEqual(['Answer sudo prompts on the desktop']);
    expect(last().sent.map((f) => f.type)).toEqual(['auth']);
  });

  it('unknown sai method returns undefined without throwing', () => {
    const sai = setup();
    expect(() => sai.someFutureDesktopCall('a', 1)).not.toThrow();
    expect(sai.someFutureDesktopCall('a', 1)).toBeUndefined();
    expect(console.warn).toHaveBeenCalled();
    // Not thenable: awaiting window.sai itself must not hang.
    expect((sai as any).then).toBeUndefined();
  });
});
