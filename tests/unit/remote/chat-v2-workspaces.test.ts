// @vitest-environment node
import { describe, it, expect, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ChatLogStore } from '@electron/services/chatlog/store';
import { ChatLogService } from '@electron/services/chatlog/service';
import { ChatCommands, type ProviderDispatch } from '@electron/services/chatlog/commands';
import { SessionBus } from '@electron/services/remote/session-bus';
import { ChatV2, CHATS_THROTTLE_MS, isV2FrameType } from '@electron/services/remote/chat-v2';
import { WorkspaceRegistry } from '@electron/services/remote/workspaceRegistry';
import { AppSettingsFeed, pickRemoteAppSettings, REMOTE_APP_SETTING_KEYS } from '@electron/services/remote/appSettings';
import type { RemoteWorkspace } from '@electron/services/remote/renderer-proxy';
import type { PermMode } from '@electron/services/remote/clamp';
import type { ChatEvent } from '../../../src/lib/chat/types';

const dirs: string[] = [];
const stores: ChatLogStore[] = [];
afterEach(() => {
  vi.useRealTimers();
  for (const s of stores.splice(0)) { try { s.close(); } catch { /* ignore */ } }
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});
function tmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-v2-ws-'));
  dirs.push(d);
  return d;
}

function mk(opts: { fallback?: () => Promise<RemoteWorkspace[]>; settings?: Record<string, unknown>; ceiling?: PermMode | null } = {}) {
  const store = new ChatLogStore({ dir: tmp() });
  stores.push(store);
  const bus = new SessionBus();
  const service = new ChatLogService({
    store, bus: () => bus, sendToRenderer: () => {}, liveChats: () => [], providerOf: () => 'claude', devlog: () => {},
  });
  const dispatch = {
    send: vi.fn(), stop: vi.fn(),
    approve: vi.fn(async () => {}), answer: vi.fn(async () => {}), planReview: vi.fn(async () => {}),
    isBusy: () => false, isLoadPaused: () => false,
  } satisfies ProviderDispatch;
  const commands = new ChatCommands({ log: service, store, dispatch, getRemoteCeiling: () => null });
  const workspaces = new WorkspaceRegistry();
  const settingsFile: Record<string, unknown> = { ...(opts.settings ?? {}) };
  const ceiling = { value: opts.ceiling ?? null };
  const appSettings = new AppSettingsFeed(() => pickRemoteAppSettings(settingsFile, ceiling.value));
  const listWorkspacesFallback = vi.fn(opts.fallback ?? (async () => [] as RemoteWorkspace[]));
  const v2 = new ChatV2({ bus, chat: () => ({ store, commands }), workspaces, listWorkspacesFallback, appSettings });
  const frames: any[] = [];
  const ws = { send: (d: string) => { frames.push(JSON.parse(d)); } };
  return { store, service, commands, v2, ws, frames, workspaces, appSettings, settingsFile, ceiling, listWorkspacesFallback };
}

const um = (t: string): ChatEvent => ({ type: 'user_message', clientId: t, text: t });
const delta = (text: string) => ({ type: 'assistant', message: { content: [{ type: 'text', text, delta: true }] } });
const P = '/proj';
const W1: RemoteWorkspace = { projectPath: '/a', name: 'a', kind: 'project', state: 'active' };
const W2: RemoteWorkspace = { projectPath: '/b', name: 'b', kind: 'project', state: 'open', status: { streaming: true, streamingSessionIds: ['c1'] } };

describe('ChatV2 workspaces', () => {
  it('workspaces.subscribe returns the reported list and pushes changes', async () => {
    const { v2, ws, frames, workspaces, listWorkspacesFallback } = mk();
    workspaces.set([W1]);
    await v2.handle(ws, { type: 'workspaces.subscribe', reqId: 3 });
    expect(frames).toEqual([{ v: 2, type: 'workspaces.list.result', reqId: 3, workspaces: [W1] }]);
    expect(listWorkspacesFallback).not.toHaveBeenCalled();
    workspaces.set([W1, W2]);
    expect(frames.at(-1)).toEqual({ v: 2, type: 'workspaces.changed', workspaces: [W1, W2] });
    // An identical report is not a change.
    workspaces.set([W1, W2]);
    expect(frames).toHaveLength(2);
    // Unknown fields from the renderer are dropped; rows without a projectPath too.
    workspaces.set([{ ...W1, secret: 'x' }, { name: 'nope', kind: 'project' }]);
    expect(frames.at(-1).workspaces).toEqual([W1]);
  });

  it('falls back once to the proxied list until the renderer has reported', async () => {
    const { v2, ws, frames, workspaces, listWorkspacesFallback } = mk({ fallback: async () => [W2] });
    await v2.handle(ws, { type: 'workspaces.subscribe', reqId: 1 });
    expect(listWorkspacesFallback).toHaveBeenCalledTimes(1);
    expect(frames).toEqual([{ v: 2, type: 'workspaces.list.result', reqId: 1, workspaces: [W2] }]);
    workspaces.set([W1]);
    expect(frames.at(-1)).toEqual({ v: 2, type: 'workspaces.changed', workspaces: [W1] });
  });

  it('a failing fallback replies with an empty list', async () => {
    const { v2, ws, frames } = mk({ fallback: async () => { throw new Error('renderer window unavailable'); } });
    await v2.handle(ws, { type: 'workspaces.subscribe', reqId: 1 });
    expect(frames).toEqual([{ v: 2, type: 'workspaces.list.result', reqId: 1, workspaces: [] }]);
  });

  it('routes only the new v2 frame types (v1 workspaces.list stays v1)', () => {
    for (const t of ['workspaces.subscribe', 'app.settings', 'chats.subscribe', 'chats.unsubscribe', 'chats.list', 'chat.subscribe']) {
      expect(isV2FrameType(t)).toBe(true);
    }
    for (const t of ['workspaces.list', 'workspace.set', 'sessions.list', 'ping', 42]) expect(isV2FrameType(t)).toBe(false);
  });
});

describe('ChatV2 chat-list push', () => {
  it('chats.changed pushes a phone-created chat', async () => {
    vi.useFakeTimers();
    const { v2, ws, frames } = mk();
    await v2.handle(ws, { type: 'chats.subscribe', reqId: 1, projectPath: P });
    expect(frames).toEqual([{ v: 2, type: 'chats.list.result', reqId: 1, chats: [] }]);
    await v2.handle(ws, { type: 'chat.command', command: { kind: 'send', chatId: 'new1', clientId: 'k1', text: 'hi', projectPath: P } });
    expect(frames.at(-1).type).toBe('chat.ack');
    expect(frames.filter((f: any) => f.type === 'chats.changed')).toHaveLength(0);
    vi.advanceTimersByTime(CHATS_THROTTLE_MS);
    const pushes = frames.filter((f: any) => f.type === 'chats.changed');
    expect(pushes).toHaveLength(1);
    expect(pushes[0]).toMatchObject({ v: 2, projectPath: P });
    expect(pushes[0].chats.map((m: any) => m.chatId)).toEqual(['new1']);
    vi.advanceTimersByTime(CHATS_THROTTLE_MS * 4);
    expect(frames.filter((f: any) => f.type === 'chats.changed')).toHaveLength(1);
  });

  it('chats.changed is throttled during streaming deltas', async () => {
    vi.useFakeTimers();
    const { service, store, v2, ws, frames } = mk();
    service.appendClient('c1', um('q'), { projectPath: P });
    service.appendClient('o1', um('other project'), { projectPath: '/elsewhere' });
    await v2.handle(ws, { type: 'chats.subscribe', reqId: 1, projectPath: P });
    service.record({ type: 'streaming_start', projectPath: P, scope: 'c1', turnSeq: 1 });
    // 100 deltas over 2s.
    for (let i = 0; i < 100; i++) {
      service.record({ ...delta('x' + i), projectPath: P, scope: 'c1' });
      vi.advanceTimersByTime(20);
    }
    service.record({ type: 'done', projectPath: P, scope: 'c1', turnSeq: 1 });
    vi.advanceTimersByTime(CHATS_THROTTLE_MS);
    const pushes = frames.filter((f) => f.type === 'chats.changed');
    // At most one push per 500ms window: ~2s of streaming + the trailing window.
    expect(pushes.length).toBeGreaterThanOrEqual(2);
    expect(pushes.length).toBeLessThanOrEqual(5);
    // The trailing push carries the final row.
    const last = pushes.at(-1).chats.find((m: any) => m.chatId === 'c1');
    expect(last.headSeq).toBe(store.meta('c1')!.headSeq);
    expect(last.openTurn).toBe(false);
    // Another project's changes never reach this subscription.
    const before = frames.length;
    service.appendClient('o1', um('more'));
    vi.advanceTimersByTime(CHATS_THROTTLE_MS * 2);
    expect(frames).toHaveLength(before);
  });

  it('chats.subscribe matches the project through a symlink', async () => {
    vi.useFakeTimers();
    const { service, v2, ws, frames } = mk();
    const base = tmp();
    const real = path.join(base, 'real');
    const link = path.join(base, 'link');
    fs.mkdirSync(real);
    fs.symlinkSync(real, link);
    service.appendClient('c1', um('a'), { projectPath: real });
    await v2.handle(ws, { type: 'chats.subscribe', reqId: 1, projectPath: link });
    expect(frames[0].chats.map((m: any) => m.chatId)).toEqual(['c1']);
    service.appendClient('c2', um('b'), { projectPath: real });
    vi.advanceTimersByTime(CHATS_THROTTLE_MS);
    const push = frames.find((f) => f.type === 'chats.changed');
    expect(push).toMatchObject({ projectPath: link });
    expect(push.chats.map((m: any) => m.chatId).sort()).toEqual(['c1', 'c2']);
    // Unsubscribing through the other spelling of the path ends it.
    await v2.handle(ws, { type: 'chats.unsubscribe', projectPath: real });
    service.appendClient('c3', um('c'), { projectPath: real });
    vi.advanceTimersByTime(CHATS_THROTTLE_MS * 2);
    expect(frames.filter((f) => f.type === 'chats.changed')).toHaveLength(1);
  });

  it('a title change and a delete push the list', async () => {
    vi.useFakeTimers();
    const { service, store, v2, ws, frames } = mk();
    service.appendClient('c1', um('a'), { projectPath: P });
    await v2.handle(ws, { type: 'chats.subscribe', reqId: 1, projectPath: P });
    store.patchMeta('c1', { title: 'Named' });
    vi.advanceTimersByTime(CHATS_THROTTLE_MS);
    expect(frames.at(-1)).toMatchObject({ type: 'chats.changed', chats: [{ chatId: 'c1', title: 'Named' }] });
    store.patchMeta('c1', { title: 'Named' }); // unchanged title: no push
    vi.advanceTimersByTime(CHATS_THROTTLE_MS);
    expect(frames.filter((f) => f.type === 'chats.changed')).toHaveLength(1);
    store.delete('c1');
    vi.advanceTimersByTime(CHATS_THROTTLE_MS);
    expect(frames.at(-1)).toMatchObject({ type: 'chats.changed', chats: [] });
  });

  it('chats.subscribe validates projectPath', async () => {
    const { v2, ws, frames } = mk();
    await v2.handle(ws, { type: 'chats.subscribe', reqId: 1, projectPath: '' });
    await v2.handle(ws, { type: 'chats.subscribe', reqId: 2, projectPath: { toString: () => '/x' } });
    expect(frames.map((f) => [f.type, f.code])).toEqual([['chat.error', 'bad_request'], ['chat.error', 'bad_request']]);
  });

  it('detach ends every workspace, chat-list and settings subscription', async () => {
    vi.useFakeTimers();
    const { service, v2, ws, frames, workspaces, settingsFile, appSettings } = mk();
    workspaces.set([W1]);
    await v2.handle(ws, { type: 'workspaces.subscribe', reqId: 1 });
    await v2.handle(ws, { type: 'chats.subscribe', reqId: 2, projectPath: P });
    await v2.handle(ws, { type: 'app.settings', reqId: 3 });
    service.appendClient('c1', um('a'), { projectPath: P }); // arms the throttle timer
    v2.detach(ws);
    const n = frames.length;
    workspaces.set([W2]);
    settingsFile.theme = 'midnight';
    appSettings.notify();
    vi.advanceTimersByTime(CHATS_THROTTLE_MS * 2);
    expect(frames).toHaveLength(n);
  });
});

describe('ChatV2 app settings', () => {
  it('app.settings returns the listed keys and the remote ceiling only', async () => {
    const settings: Record<string, unknown> = {
      theme: 'midnight', accent: '#ff0', highlightTheme: 'monokai', messageStampMode: 'time', toolCallsExpanded: true,
      tagMessagesWithTask: false, saiAnimationEnabled: true, autoCompactThreshold: 80,
      aiProvider: 'claude', modelChoice: 'legacy-flat', effortLevel: 'low', permissionMode: 'bypass',
      github_auth: { token: 'secret' }, linearApiKey: 'k', recentProjects: ['/x'],
    };
    const { v2, ws, frames, settingsFile, ceiling, appSettings } = mk({ settings, ceiling: 'auto-read' });
    await v2.handle(ws, { type: 'app.settings', reqId: 9 });
    expect(frames).toEqual([{
      v: 2, type: 'app.settings.result', reqId: 9,
      settings: {
        theme: 'midnight', accent: '#ff0', highlightTheme: 'monokai', messageStampMode: 'time', toolCallsExpanded: true,
        tagMessagesWithTask: false, saiAnimationEnabled: true, autoCompactThreshold: 80,
        aiProvider: 'claude',
        remoteCeiling: 'auto-read',
      },
    }]);
    expect(Object.keys(frames[0].settings).sort()).toEqual([...REMOTE_APP_SETTING_KEYS, 'remoteCeiling'].sort());
    // A non-listed key changing pushes nothing.
    settingsFile.linearApiKey = 'k2';
    appSettings.notify();
    expect(frames).toHaveLength(1);
    // A listed key pushes app.settings.changed; so does the ceiling.
    settingsFile.theme = 'steel';
    appSettings.notify();
    expect(frames.at(-1)).toMatchObject({ v: 2, type: 'app.settings.changed', settings: { theme: 'steel', remoteCeiling: 'auto-read' } });
    ceiling.value = 'always-ask';
    appSettings.notify();
    expect(frames.at(-1)).toMatchObject({ type: 'app.settings.changed', settings: { remoteCeiling: 'always-ask' } });
    expect(frames).toHaveLength(3);
    expect(JSON.stringify(frames)).not.toContain('secret');
  });

  it('unset keys are omitted and the ceiling defaults to null', async () => {
    const { v2, ws, frames } = mk({ settings: { theme: 'default' } });
    await v2.handle(ws, { type: 'app.settings', reqId: 1 });
    expect(frames[0].settings).toEqual({ theme: 'default', remoteCeiling: null });
  });

  it('nested provider defaults cross with their listed string fields only', () => {
    const picked = pickRemoteAppSettings({
      codex: { model: 'gpt-5', permission: 'auto', effort: 'high', apiKey: 'secret' },
      gemini: { model: 'g', approvalMode: 'yolo', conversationMode: 'fast', token: 'x' },
      kimi: { model: 7, approvalMode: 'default' },
      claude: { model: 'opus', effort: 'high', permission: 'bypass', workspaceOverrides: { '/p': { model: 'haiku' } }, token: 'secret' },
    }, null);
    expect(picked).toEqual({
      claude: { model: 'opus', effort: 'high', permission: 'bypass' },
      codex: { model: 'gpt-5', permission: 'auto', effort: 'high' },
      gemini: { model: 'g', approvalMode: 'yolo', conversationMode: 'fast' },
      kimi: { approvalMode: 'default' },
      remoteCeiling: null,
    });
  });

  it('a repeated app.settings does not double the pushes', async () => {
    const { v2, ws, frames, settingsFile, appSettings } = mk({ settings: { theme: 'default' } });
    await v2.handle(ws, { type: 'app.settings', reqId: 1 });
    await v2.handle(ws, { type: 'app.settings', reqId: 2 });
    settingsFile.theme = 'midnight';
    appSettings.notify();
    expect(frames.filter((f) => f.type === 'app.settings.changed')).toHaveLength(1);
  });
});
