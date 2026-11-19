/**
 * First launch after the chat-log update: a chat's history lives only in
 * IndexedDB. The panel's start-up (claudeStart → `ready`, the SDK warm-up's
 * `commands_changed`) reaches main BEFORE the panel's ensureChatInLog import
 * runs. Uses the REAL ensureChatInLog, ChatLogService and ChatLogStore (temp
 * dir) and the real chatDb (fake IndexedDB): the panel must end up showing the
 * IndexedDB history, and IndexedDB must never shrink.
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { installMockSai } from '../../../helpers/ipc-mock';
import { ChatLogStore } from '../../../../electron/services/chatlog/store';
import { ChatLogService } from '../../../../electron/services/chatlog/service';
import { clearDb, dbGetMessages, dbSaveSession } from '../../../../src/chatDb';
import { queueSaveSession } from '../../../../src/lib/sessionSaveQueue';
import { _resetMigrateStateForTests } from '../../../../src/lib/chat/migrateToLog';
import type { ChatLogEntry } from '../../../../src/lib/chat/types';
import type { ChatMessage, ChatSession } from '../../../../src/types';

vi.mock('../../../../src/components/Chat/ChatMessage', () => ({
  default: (props: any) => <div data-testid="chat-message" data-msg-content={props.message?.content ?? ''} />,
}));
vi.mock('../../../../src/components/Chat/ChatInput', () => ({ default: () => <div data-testid="chat-input" /> }));
vi.mock('../../../../src/components/ThinkingAnimation', () => ({ default: () => <div /> }));

import ChatPanel from '../../../../src/components/Chat/ChatPanel';

const P = '/project';
const history: ChatMessage[] = [
  { id: 'h1', role: 'user', content: 'old question', timestamp: 1 },
  { id: 'h2', role: 'assistant', content: 'old answer', timestamp: 2 },
  { id: 'h3', role: 'user', content: 'follow-up', timestamp: 3 },
];
const row: ChatSession = { id: 'c1', title: 'Old', messages: history, messageCount: 3, createdAt: 1, updatedAt: 3, projectPath: P, aiProvider: 'claude' };

let dir: string;
let store: ChatLogStore;
let svc: ChatLogService;
let sai: any;
let minStored: number;

beforeEach(async () => {
  await clearDb();
  localStorage.clear();
  _resetMigrateStateForTests();
  await dbSaveSession(P, row);
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatlog-first-'));
  store = new ChatLogStore({ dir });
  const listeners = new Set<(e: ChatLogEntry) => void>();
  svc = new ChatLogService({
    store, bus: () => null, liveChats: () => [], providerOf: () => 'claude', devlog: () => {},
    sendToRenderer: (_ch, e) => { for (const l of [...listeners]) l(e); },
  });
  sai = installMockSai();
  sai.settingsGet.mockImplementation((_k: string, d: unknown) => Promise.resolve(d));
  sai.chatlog = {
    open: async (id: string, after: number) => store.read(id, after),
    onEvent: (cb: (e: ChatLogEntry) => void) => { listeners.add(cb); return () => { listeners.delete(cb); }; },
    appendClient: async (id: string, ev: any, init?: any) => svc.appendClient(id, ev, init),
    importMessages: async (id: string, init: any, msgs: ChatMessage[]) => svc.importMessages(id, init, msgs),
    list: async (pp: string) => store.list(pp),
    delete: async () => {}, bindLegacyScope: async () => {}, patchMeta: async () => {},
    command: vi.fn(),
  };
  Object.defineProperty(window, 'IntersectionObserver', { writable: true, value: class { observe() {} disconnect() {} unobserve() {} } });
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { writable: true, value: vi.fn() });
  minStored = Infinity;
});
afterEach(() => { store.close(); fs.rmSync(dir, { recursive: true, force: true }); });

async function mountAndCheck(startEvent: Record<string, unknown>) {
  // CLI startImpl / Codex SDK start emit synchronously inside start; the SDK
  // warm-up emits commands_changed — all before the panel's import check.
  sai.claudeStart.mockImplementation(async () => { svc.record({ projectPath: P, scope: 'c1', ...startEvent }); return {}; });
  // App's mirror: every non-empty list the panel hands up is saved.
  const onMessagesChange = vi.fn((msgs: ChatMessage[]) => {
    if (msgs.length === 0) return;
    void queueSaveSession(P, { ...row, messages: msgs, messageCount: msgs.length }, 0)
      .then(async () => { minStored = Math.min(minStored, (await dbGetMessages('c1')).length); });
  });
  render(<ChatPanel
    projectPath={P} claudeScope="c1" sessionId="c1" aiProvider="claude"
    permissionMode="default" onPermissionChange={vi.fn()} effortLevel="high" onEffortChange={vi.fn()}
    modelChoice="sonnet" onModelChange={vi.fn()} codexModel="" onCodexModelChange={vi.fn()} codexModels={[]}
    codexPermission="auto" onCodexPermissionChange={vi.fn()} geminiModel="g" onGeminiModelChange={vi.fn()} geminiModels={[]}
    geminiApprovalMode="default" onGeminiApprovalModeChange={vi.fn()} geminiConversationMode="planning"
    onGeminiConversationModeChange={vi.fn()} kimiModel="k" onKimiModelChange={vi.fn()} kimiModels={[]}
    kimiApprovalMode="default" onKimiApprovalModeChange={vi.fn()} onMessagesChange={onMessagesChange} isActive
  />);
  await waitFor(() => expect(sai.claudeStart).toHaveBeenCalled());
  await waitFor(() => expect(screen.getAllByTestId('chat-message').map(e => e.getAttribute('data-msg-content')))
    .toEqual(expect.arrayContaining(['old question', 'old answer', 'follow-up'])));
  await new Promise(r => setTimeout(r, 50));
  expect(store.state('c1')!.messages.slice(0, 3).map(m => m.id)).toEqual(['h1', 'h2', 'h3']);
  expect(store.meta('c1')!.imported).toBe(true);
  expect((await dbGetMessages('c1')).map(m => m.id)).toEqual(expect.arrayContaining(['h1', 'h2', 'h3']));
  expect(minStored === Infinity || minStored >= 3).toBe(true);
}

describe('first launch: start-up events before the import never erase history', () => {
  it('a `ready` before the import', async () => {
    await mountAndCheck({ type: 'ready' });
  });

  it('a `commands_changed` before the import', async () => {
    await mountAndCheck({ type: 'system', subtype: 'commands_changed', commands: [] });
  });

  it('a transcript event that created the log first: the history is folded in front of it', async () => {
    await mountAndCheck({ type: 'assistant', message: { content: [{ type: 'text', text: 'resumed reply' }] } });
    expect(screen.getAllByTestId('chat-message').map(e => e.getAttribute('data-msg-content')))
      .toEqual(['old question', 'old answer', 'follow-up', 'resumed reply']);
  });
});
