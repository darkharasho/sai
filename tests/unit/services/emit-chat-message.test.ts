// @vitest-environment node
// emitChatMessage → ChatLogService → ChatLogStore, end to end on a real temp
// dir, with the v1 claude:message send and chat:<path>:<scope> bus publish
// asserted alongside (Task 3, rulings R4/R5).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const { mockIpcMain, devlogMock } = vi.hoisted(() => ({
  mockIpcMain: { handle: vi.fn(), on: vi.fn(), removeHandler: vi.fn(), removeAllListeners: vi.fn() },
  devlogMock: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: mockIpcMain,
  app: { getPath: vi.fn().mockReturnValue(os.tmpdir()) },
  BrowserWindow: vi.fn(),
}));

vi.mock('@electron/services/devlog', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@electron/services/devlog')>()),
  devlog: devlogMock,
}));

import { registerClaudeHandlers, emitChatMessage, setChatLog, setRemoteBus, destroyClaude } from '@electron/services/claude';
import { __setClaudeBackendForTests } from '@electron/services/claudeBackend';
import { ChatLogStore } from '@electron/services/chatlog/store';
import { ChatLogService } from '@electron/services/chatlog/service';
import { SessionBus } from '@electron/services/remote/session-bus';
import { createMockBrowserWindow } from '../../helpers/electron-mock';

const PROJECT = '/test/project';
const SCOPE = 'chat-abc';

let dir: string;
let store: ChatLogStore;
let bus: SessionBus;
let win: ReturnType<typeof createMockBrowserWindow>;
let rendererLog: unknown[];

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatlog-'));
  store = new ChatLogStore({ dir });
  bus = new SessionBus();
  rendererLog = [];
  win = createMockBrowserWindow();
  __setClaudeBackendForTests({ destroy: () => {} } as never);
  registerClaudeHandlers(win as never);
  setRemoteBus(bus);
  setChatLog(new ChatLogService({
    store,
    sendToRenderer: (_ch, entry) => { rendererLog.push(entry); },
    bus: () => bus,
    liveChats: () => [],
    providerOf: () => 'claude',
    devlog: () => {},
  }));
});

afterEach(() => {
  setChatLog(null);
  setRemoteBus(null);
  destroyClaude();
  __setClaudeBackendForTests(null);
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
  vi.clearAllMocks();
});

function v1Sent(): any[] {
  return win.webContents.send.mock.calls.filter(([ch]) => ch === 'claude:message').map(([, m]) => m);
}

const turn = [
  { type: 'streaming_start', projectPath: PROJECT, scope: SCOPE, sessionId: null, turnSeq: 1 },
  { type: 'assistant', projectPath: PROJECT, scope: SCOPE, turnSeq: 1, message: { content: [{ type: 'text', text: 'Looking.' }] } },
  { type: 'assistant', projectPath: PROJECT, scope: SCOPE, turnSeq: 1, message: { content: [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/a' } }] } },
  { type: 'user', projectPath: PROJECT, scope: SCOPE, turnSeq: 1, message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'file body' }] } },
  { type: 'result', projectPath: PROJECT, scope: SCOPE, turnSeq: 1, result: 'Looking.' },
  { type: 'done', projectPath: PROJECT, scope: SCOPE, turnSeq: 1 },
];

describe('emitChatMessage', () => {
  it('records a scripted turn in <chatId>.jsonl with seqs 1..n', () => {
    for (const m of turn) emitChatMessage(m);
    store.flush();
    const lines = fs.readFileSync(path.join(dir, `${SCOPE}.jsonl`), 'utf8').trim().split('\n').map(l => JSON.parse(l));
    expect(lines.map(l => l.seq)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(lines.map(l => l.ev.type)).toEqual(['streaming_start', 'assistant', 'assistant', 'user', 'result', 'done']);
    expect(lines.every(l => l.chatId === SCOPE)).toBe(true);
    expect(rendererLog).toHaveLength(6);
    expect(store.state(SCOPE)!.turn.streaming).toBe(false);
  });

  it('emitChatMessage still sends claude:message and publishes chat:<path>:<scope>', () => {
    const published: unknown[] = [];
    bus.subscribe(`chat:${PROJECT}:${SCOPE}`, (e) => published.push(e));
    for (const m of turn) emitChatMessage(m);
    expect(v1Sent()).toEqual(turn);
    expect(published).toEqual(turn);
  });

  it('a throwing chat log never blocks v1 delivery', () => {
    setChatLog({ record: () => { throw new Error('disk full'); } });
    const published: unknown[] = [];
    bus.subscribe(`chat:${PROJECT}:${SCOPE}`, (e) => published.push(e));
    emitChatMessage(turn[0]);
    expect(v1Sent()).toEqual([turn[0]]);
    expect(published).toEqual([turn[0]]);
    expect(devlogMock).toHaveBeenCalledWith('chatlog', 'chatlog.recordError', expect.objectContaining({ error: 'disk full' }));
  });
});
