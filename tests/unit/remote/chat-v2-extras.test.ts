// @vitest-environment node
import { describe, it, expect, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// The four <provider>:models handler bodies, as the shared functions main exports.
vi.mock('@electron/services/claude', () => ({ listClaudeModels: vi.fn(() => ({ models: [{ id: 'opus' }], detected: true })) }));
vi.mock('@electron/services/codex', () => ({ listCodexModels: vi.fn(async () => ({ models: [{ id: 'gpt-5' }] })) }));
vi.mock('@electron/services/gemini', () => ({ listGeminiModels: vi.fn(async () => ({ models: [{ id: 'g3' }], defaultModel: 'g3' })) }));
vi.mock('@electron/services/acpProvider', () => ({ acpModels: vi.fn((c: { models: unknown; defaultModel: string }) => ({ models: c.models, defaultModel: c.defaultModel })) }));
vi.mock('@electron/services/kimi', () => ({ KIMI_CONFIG: { key: 'kimi', models: [{ id: 'kimi-k3', name: 'Kimi K3' }], defaultModel: 'kimi-k3' } }));

import { ChatLogStore } from '@electron/services/chatlog/store';
import { ChatLogService } from '@electron/services/chatlog/service';
import { ChatCommands, type ProviderDispatch } from '@electron/services/chatlog/commands';
import { SessionBus } from '@electron/services/remote/session-bus';
import { ChatV2, MAX_CHAT_LIST_SUBS, isV2FrameType, type ChatV2Opts } from '@electron/services/remote/chat-v2';
import { readRemoteFile, FILE_READ_MAX_BYTES } from '@electron/services/remote/fileRead';
import { BackgroundTasksFeed } from '@electron/services/backgroundTasksFeed';
import { listProviderModels } from '@electron/services/providerModels';
import { listClaudeModels } from '@electron/services/claude';
import { listCodexModels } from '@electron/services/codex';
import { listGeminiModels } from '@electron/services/gemini';

const dirs: string[] = [];
const stores: ChatLogStore[] = [];
afterEach(() => {
  for (const s of stores.splice(0)) { try { s.close(); } catch { /* ignore */ } }
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});
function tmp(prefix = 'chat-v2-x-'): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(d);
  return d;
}

const P = '/proj';

function mk(extra: Partial<ChatV2Opts> = {}) {
  const store = new ChatLogStore({ dir: tmp() });
  stores.push(store);
  const bus = new SessionBus();
  const service = new ChatLogService({
    store, bus: () => bus, sendToRenderer: () => {}, liveChats: () => [], providerOf: () => 'claude', devlog: () => {},
  });
  const dispatch = {
    send: vi.fn(), stop: vi.fn(),
    approve: vi.fn(async () => {}), answer: vi.fn(async () => {}), planReview: vi.fn(async () => {}),
    compact: vi.fn(), stopTask: vi.fn(async () => true),
    isBusy: () => false, isLoadPaused: () => false,
  } satisfies ProviderDispatch;
  const commands = new ChatCommands({ log: service, store, dispatch, getRemoteCeiling: () => 'always-ask' });
  const v2 = new ChatV2({ bus, chat: () => ({ store, commands }), ...extra });
  const frames: any[] = [];
  const ws = { send: (d: string) => { frames.push(JSON.parse(d)); } };
  return { store, service, commands, dispatch, v2, ws, frames };
}

describe('ChatV2 models.list / slash.list', () => {
  it('models.list returns each provider\'s list from the shared function', async () => {
    const { v2, ws, frames } = mk({ listModels: listProviderModels });
    for (const [i, provider] of ['claude', 'codex', 'gemini', 'kimi'].entries()) {
      await v2.handle(ws, { type: 'models.list', reqId: i, provider });
    }
    expect(frames).toEqual([
      { v: 2, type: 'models.list.result', reqId: 0, provider: 'claude', models: { models: [{ id: 'opus' }], detected: true } },
      { v: 2, type: 'models.list.result', reqId: 1, provider: 'codex', models: { models: [{ id: 'gpt-5' }] } },
      { v: 2, type: 'models.list.result', reqId: 2, provider: 'gemini', models: { models: [{ id: 'g3' }], defaultModel: 'g3' } },
      { v: 2, type: 'models.list.result', reqId: 3, provider: 'kimi', models: { models: [{ id: 'kimi-k3', name: 'Kimi K3' }], defaultModel: 'kimi-k3' } },
    ]);
    expect(listClaudeModels).toHaveBeenCalledTimes(1);
    expect(listCodexModels).toHaveBeenCalledWith(false);
    expect(listGeminiModels).toHaveBeenCalledTimes(1);
    // An unknown provider is a bad request, answered with the reqId.
    await v2.handle(ws, { type: 'models.list', reqId: 9, provider: 'gpt' });
    expect(frames.at(-1)).toMatchObject({ type: 'chat.error', reqId: 9, code: 'bad_request' });
    for (const t of ['models.list', 'slash.list', 'file.read']) expect(isV2FrameType(t)).toBe(true);
    expect(isV2FrameType('files.read')).toBe(false); // v1
  });

  it('slash.list uses the Claude refresh for claude chats and is empty for others', async () => {
    const slashCommands = vi.fn(async () => [{ name: 'review', description: 'Review' }]);
    const { v2, ws, frames, commands } = mk({ slashCommands });
    // Unknown chat: Claude by default, the client's projectPath.
    await v2.handle(ws, { type: 'slash.list', reqId: 1, projectPath: P, chatId: 'c1' });
    expect(frames.at(-1)).toEqual({ v: 2, type: 'slash.list.result', reqId: 1, commands: [{ name: 'review', description: 'Review' }] });
    expect(slashCommands).toHaveBeenLastCalledWith(P, 'c1');
    // A logged chat keeps its logged projectPath.
    await commands.run({ kind: 'settings', chatId: 'c2', clientId: 's1', settings: { provider: 'claude' }, projectPath: P });
    await v2.handle(ws, { type: 'slash.list', reqId: 2, projectPath: '/elsewhere', chatId: 'c2' });
    expect(slashCommands).toHaveBeenLastCalledWith(P, 'c2');
    await commands.run({ kind: 'settings', chatId: 'c3', clientId: 's2', settings: { provider: 'gemini' }, projectPath: P });
    await v2.handle(ws, { type: 'slash.list', reqId: 3, projectPath: P, chatId: 'c3' });
    expect(frames.at(-1)).toEqual({ v: 2, type: 'slash.list.result', reqId: 3, commands: [] });
    expect(slashCommands).toHaveBeenCalledTimes(2);
    await v2.handle(ws, { type: 'slash.list', reqId: 4, projectPath: P, chatId: '__proto__' });
    expect(frames.at(-1)).toMatchObject({ type: 'chat.error', reqId: 4, code: 'bad_request' });
  });
});

describe('ChatV2 file.read', () => {
  function dirsFor() {
    const root = tmp('chat-v2-files-');
    const toolImages = path.join(root, 'tool-result-images');
    const modelCache = path.join(root, 'model-cache');
    fs.mkdirSync(toolImages);
    fs.mkdirSync(modelCache);
    return { root, toolImages, modelCache };
  }

  it('file.read refuses a path outside the tool image dir, including via a symlink', async () => {
    const d = dirsFor();
    const secret = path.join(d.root, 'secret.png');
    fs.writeFileSync(secret, 'nope');
    fs.symlinkSync(secret, path.join(d.toolImages, 'link.png'));
    fs.symlinkSync(d.root, path.join(d.toolImages, 'up'));
    const { v2, ws, frames } = mk({ readFile: (k, r) => readRemoteFile(k, r, d) });
    const refs = [
      secret,
      path.join(d.toolImages, '..', 'secret.png'),
      path.join(d.toolImages, 'link.png'),
      path.join(d.toolImages, 'up', 'secret.png'),
      d.toolImages, // the dir itself
      'tool-result-images/x.png', // relative
    ];
    for (const [i, ref] of refs.entries()) await v2.handle(ws, { type: 'file.read', reqId: i, kind: 'toolImage', ref });
    expect(frames.map((f) => f.error)).toEqual(['forbidden', 'forbidden', 'forbidden', 'forbidden', 'forbidden', 'forbidden']);
    expect(frames.every((f, i) => f.type === 'file.read.result' && f.reqId === i && !('dataUrl' in f))).toBe(true);
    // Missing file, bad kind, bad ref.
    await v2.handle(ws, { type: 'file.read', reqId: 'm', kind: 'toolImage', ref: path.join(d.toolImages, 'missing.png') });
    await v2.handle(ws, { type: 'file.read', reqId: 'k', kind: 'workspace', ref: secret });
    await v2.handle(ws, { type: 'file.read', reqId: 'r', kind: 'toolImage', ref: 42 });
    expect(frames.slice(-3).map((f) => f.error)).toEqual(['not_found', 'bad_request', 'bad_request']);
  });

  it('file.read returns a data URL for a stored tool image', async () => {
    const d = dirsFor();
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
    const file = path.join(d.toolImages, 'abc.png');
    fs.writeFileSync(file, png);
    const { v2, ws, frames } = mk({ readFile: (k, r) => readRemoteFile(k, r, d) });
    await v2.handle(ws, { type: 'file.read', reqId: 1, kind: 'toolImage', ref: file });
    expect(frames.at(-1)).toEqual({ v: 2, type: 'file.read.result', reqId: 1, dataUrl: `data:image/png;base64,${png.toString('base64')}` });
    // Through a symlinked parent of the dir (/home → /var/home): realpaths still contain it.
    const alias = path.join(tmp('chat-v2-alias-'), 'ud');
    fs.symlinkSync(d.root, alias);
    await v2.handle(ws, { type: 'file.read', reqId: 2, kind: 'toolImage', ref: path.join(alias, 'tool-result-images', 'abc.png') });
    expect(frames.at(-1).dataUrl).toMatch(/^data:image\/png;base64,/);
    // A model by versionKey.
    const key = 'a'.repeat(32);
    fs.writeFileSync(path.join(d.modelCache, `${key}.stl`), Buffer.from('solid x'));
    await v2.handle(ws, { type: 'file.read', reqId: 3, kind: 'model', ref: key });
    expect(frames.at(-1)).toEqual({ v: 2, type: 'file.read.result', reqId: 3, dataUrl: `data:application/octet-stream;base64,${Buffer.from('solid x').toString('base64')}` });
    await v2.handle(ws, { type: 'file.read', reqId: 4, kind: 'model', ref: 'b'.repeat(32) });
    expect(frames.at(-1)).toEqual({ v: 2, type: 'file.read.result', reqId: 4, error: 'not_found' });
    await v2.handle(ws, { type: 'file.read', reqId: 5, kind: 'model', ref: '../x' });
    expect(frames.at(-1).error).toBe('bad_request');
  });

  it('file.read answers too_large past the cap', () => {
    const d = dirsFor();
    const file = path.join(d.toolImages, 'big.png');
    fs.writeFileSync(file, Buffer.alloc(11));
    expect(readRemoteFile('toolImage', file, d, 10)).toEqual({ error: 'too_large' });
    expect(FILE_READ_MAX_BYTES).toBe(25 * 1024 * 1024);
  });
});

describe('ChatV2 chat.background', () => {
  it('chat.background sends the latest tasks on subscribe and pushes changes', async () => {
    const feed = new BackgroundTasksFeed();
    const t1 = { id: 'b1', status: 'running' } as any;
    const t2 = { id: 'b2', status: 'completed' } as any;
    feed.publish({ projectPath: P, scope: 'c1', tasks: [t1] });
    const { v2, ws, frames } = mk({ backgroundTasks: feed });
    await v2.handle(ws, { type: 'chat.subscribe', chatId: 'c1' });
    expect(frames.map((f) => f.type)).toEqual(['chat.entries', 'chat.background']);
    expect(frames.at(-1)).toEqual({ v: 2, type: 'chat.background', chatId: 'c1', tasks: [t1] });
    feed.publish({ projectPath: P, scope: 'c1', tasks: [t1, t2] });
    expect(frames.at(-1)).toEqual({ v: 2, type: 'chat.background', chatId: 'c1', tasks: [t1, t2] });
    // Other chats' tasks are not pushed.
    const n = frames.length;
    feed.publish({ projectPath: P, scope: 'other', tasks: [t2] });
    expect(frames).toHaveLength(n);
    // An empty snapshot is pushed (the list cleared) and a new subscriber gets [].
    feed.publish({ projectPath: P, scope: 'c1', tasks: [] });
    expect(frames.at(-1)).toEqual({ v: 2, type: 'chat.background', chatId: 'c1', tasks: [] });
    // Unsubscribe and socket close stop the pushes.
    await v2.handle(ws, { type: 'chat.unsubscribe', chatId: 'c1' });
    feed.publish({ projectPath: P, scope: 'c1', tasks: [t1] });
    expect(frames.at(-1).tasks).toEqual([]);
    await v2.handle(ws, { type: 'chat.subscribe', chatId: 'c1' });
    expect(frames.at(-1)).toEqual({ v: 2, type: 'chat.background', chatId: 'c1', tasks: [t1] });
    v2.detach(ws);
    const m = frames.length;
    feed.publish({ projectPath: P, scope: 'c1', tasks: [t2] });
    expect(frames).toHaveLength(m);
  });
});

describe('ChatV2 new commands', () => {
  it('accepts clear, compact, clientEvent and stopTask; compact and clientEvent are remote', async () => {
    const { v2, ws, frames, store, dispatch, commands } = mk();
    await commands.run({ kind: 'settings', chatId: 'c1', clientId: 's1', settings: { provider: 'claude', permMode: 'bypass' }, projectPath: P });
    const cmd = async (command: Record<string, unknown>) => {
      await v2.handle(ws, { type: 'chat.command', command: { chatId: 'c1', ...command } });
      return frames.at(-1).result;
    };
    expect(await cmd({ kind: 'clientEvent', clientId: 'e1', ev: { type: 'user_message', clientId: 'm1', text: '/help', local: true } })).toMatchObject({ ok: true });
    expect(await cmd({ kind: 'clientEvent', clientId: 'e2', ev: { type: 'local_note', noteId: 'help-m1', content: 'help' } })).toMatchObject({ ok: true });
    expect(await cmd({ kind: 'clientEvent', clientId: 'e3', ev: { type: 'assistant', message: {} } })).toMatchObject({ ok: false });
    expect(await cmd({ kind: 'clientEvent', clientId: 'e4' })).toMatchObject({ ok: false, error: 'ev required' });
    expect(store.read('c1', 0).entries.find((e) => e.ev.type === 'user_message')!.ev.origin).toBe('remote');

    expect(await cmd({ kind: 'compact', clientId: 'k1' })).toMatchObject({ ok: true });
    // Remote: compacted with the ceiling-capped settings.
    expect((dispatch.compact as any).mock.calls[0][1].settings.permMode).toBe('default');
    // queue passes through: idle, so it still dispatches.
    expect(await cmd({ kind: 'compact', clientId: 'k2', queue: true })).toMatchObject({ ok: true });
    expect(dispatch.compact).toHaveBeenCalledTimes(2);

    expect(await cmd({ kind: 'stopTask', clientId: 't1', taskId: 'bg1' })).toMatchObject({ ok: true });
    expect(dispatch.stopTask).toHaveBeenCalledWith('claude', { projectPath: P, scope: 'c1', taskId: 'bg1' });
    expect(await cmd({ kind: 'stopTask', clientId: 't2' })).toMatchObject({ ok: false, error: 'taskId required' });

    expect(await cmd({ kind: 'clear', clientId: 'c1' })).toMatchObject({ ok: true });
    expect(store.state('c1')!.messages).toEqual([]);
    // Desktop-only answers are not commands.
    expect(await cmd({ kind: 'alwaysAllow', clientId: 'x1' })).toMatchObject({ ok: false, error: 'unknown command alwaysAllow' });
  });
});

describe('ChatV2 chats.subscribe cap', () => {
  it('a socket may hold at most 32 chat-list subscriptions', async () => {
    const { v2, ws, frames } = mk();
    for (let i = 0; i < MAX_CHAT_LIST_SUBS; i++) {
      await v2.handle(ws, { type: 'chats.subscribe', reqId: i, projectPath: `/p${i}` });
    }
    expect(MAX_CHAT_LIST_SUBS).toBe(32);
    expect(frames.every((f) => f.type === 'chats.list.result')).toBe(true);
    // Re-subscribing a held project still works.
    await v2.handle(ws, { type: 'chats.subscribe', reqId: 'again', projectPath: '/p0' });
    expect(frames.at(-1)).toMatchObject({ type: 'chats.list.result', reqId: 'again' });
    await v2.handle(ws, { type: 'chats.subscribe', reqId: 'x', projectPath: '/p32' });
    expect(frames.at(-1)).toEqual({ v: 2, type: 'chat.error', reqId: 'x', code: 'bad_request', message: 'too many chat-list subscriptions' });
    // Freeing one makes room; another socket has its own budget.
    await v2.handle(ws, { type: 'chats.unsubscribe', projectPath: '/p1' });
    await v2.handle(ws, { type: 'chats.subscribe', reqId: 'y', projectPath: '/p32' });
    expect(frames.at(-1)).toMatchObject({ type: 'chats.list.result', reqId: 'y' });
    const other: any[] = [];
    await v2.handle({ send: (d: string) => { other.push(JSON.parse(d)); } }, { type: 'chats.subscribe', reqId: 1, projectPath: '/p40' });
    expect(other[0]).toMatchObject({ type: 'chats.list.result' });
  });
});
