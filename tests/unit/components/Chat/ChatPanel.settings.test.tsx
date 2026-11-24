/**
 * Task 9: per-chat composer settings and the message queue live in main's
 * chat log. The pickers read state.settings and write `settings` commands;
 * the queue strip reads state.queue and edits it through queue commands. The
 * window.sai.chatlog mock is an in-memory log over the REAL reducer whose
 * `send` queues like ChatCommands (busy turn, items waiting, or load-paused).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { installMockSai } from '../../../helpers/ipc-mock';
import { installMockChatlog, emitChat, flushChatlog, type MockChatlog } from '../../../helpers/chatlogMock';

const verified = vi.hoisted(() => new Set<string>());
vi.mock('../../../../src/lib/chat/migrateToLog', () => ({
  ensureChatInLog: vi.fn(async () => {}),
  isChatImported: (id: string) => verified.has(id),
  forgetChatImported: (id: string) => { verified.delete(id); },
}));

vi.mock('../../../../src/components/Chat/ChatMessage', () => ({
  default: (props: any) => (
    <div
      data-testid="chat-message"
      data-msg-id={props.message?.id}
      data-role={props.message?.role}
      data-msg-content={typeof props.message?.content === 'string' ? props.message.content : ''}
    />
  ),
}));

let inputProps: any;
vi.mock('../../../../src/components/Chat/ChatInput', () => ({
  default: (props: any) => { inputProps = props; return <div data-testid="chat-input" />; },
}));
vi.mock('../../../../src/components/ThinkingAnimation', () => ({
  default: () => <div data-testid="thinking-animation" />,
}));

import ChatPanel from '../../../../src/components/Chat/ChatPanel';

type Props = ComponentProps<typeof ChatPanel>;
const P = '/project';

const baseProps = (over: Partial<Props> = {}): Props => ({
  projectPath: P,
  permissionMode: 'default', onPermissionChange: vi.fn(),
  effortLevel: 'high', onEffortChange: vi.fn(),
  modelChoice: 'sonnet', onModelChange: vi.fn(),
  aiProvider: 'claude',
  codexModel: 'gpt-5', onCodexModelChange: vi.fn(), codexModels: [],
  codexPermission: 'auto', onCodexPermissionChange: vi.fn(), codexEffort: 'medium',
  geminiModel: 'auto-gemini-3', onGeminiModelChange: vi.fn(), geminiModels: [],
  geminiApprovalMode: 'default', onGeminiApprovalModeChange: vi.fn(),
  geminiConversationMode: 'planning', onGeminiConversationModeChange: vi.fn(),
  kimiModel: 'kimi-k3', onKimiModelChange: vi.fn(), kimiModels: [],
  kimiApprovalMode: 'default', onKimiApprovalModeChange: vi.fn(),
  onMessagesChange: vi.fn(), onTurnComplete: vi.fn(),
  activeFilePath: null, onFileOpen: vi.fn(), isActive: true,
  sessionId: 'c1', claudeScope: 'c1', terminalTabs: [],
  ...over,
});

const contents = () => screen.queryAllByTestId('chat-message').map(b => b.getAttribute('data-msg-content'));

let sai: ReturnType<typeof installMockSai> & Record<string, any>;
let log: MockChatlog;

async function mount(over: Partial<Props> = {}) {
  const props = baseProps(over);
  const r = render(<ChatPanel {...props} />);
  await flushChatlog();
  return { ...r, props };
}

async function startLogTurn(turnSeq = 1) {
  await emitChat(sai, { type: 'streaming_start', projectPath: P, scope: 'c1', turnSeq });
}

beforeEach(() => {
  inputProps = undefined;
  sai = installMockSai() as any;
  sai.settingsGet.mockImplementation((_k: string, d: unknown) => Promise.resolve(d));
  sai.kimiSend = vi.fn();
  sai.kimiStop = vi.fn();
  log = installMockChatlog(sai);
  Object.defineProperty(window, 'IntersectionObserver', {
    writable: true, value: class { observe() {} disconnect() {} unobserve() {} },
  });
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { writable: true, value: vi.fn() });
});

describe('ChatPanel: per-chat settings live in the log', () => {
  it('picker change sends one settings command and reflects state.settings', async () => {
    const { props } = await mount();
    await act(async () => { inputProps.onModelChange('opus'); });
    await flushChatlog();
    const first = log.commands('settings');
    expect(first).toHaveLength(1);
    // A chat with no settings yet is seeded from the workspace defaults around the pick.
    expect(first[0]).toMatchObject({
      kind: 'settings', chatId: 'c1', origin: 'desktop', projectPath: P,
      settings: { provider: 'claude', model: 'opus', permMode: 'default', effort: 'high' },
    });
    expect(log.state('c1')!.settings).toMatchObject({ provider: 'claude', model: 'opus' });
    expect(inputProps.modelChoice).toBe('opus');
    // The workspace preference still follows the last pick (new chats inherit it).
    expect(props.onModelChange).toHaveBeenCalledWith('opus');

    await act(async () => { inputProps.onPermissionChange('bypass'); });
    await flushChatlog();
    const all = log.commands('settings');
    expect(all).toHaveLength(2);
    expect(all[1].settings).toEqual({ permMode: 'bypass' });
    expect(inputProps.permissionMode).toBe('bypass');
    // The panel's parent props never changed: the picker shows the chat's value.
    expect(inputProps.modelChoice).toBe('opus');
  });

  it('a settings_changed entry from the phone updates the picker', async () => {
    log.append('c1', { type: 'settings_changed', settings: { provider: 'claude', model: 'sonnet', permMode: 'default', effort: 'high' } }, { projectPath: P });
    const { props } = await mount();
    expect(inputProps.modelChoice).toBe('sonnet');
    await act(async () => {
      log.append('c1', { type: 'settings_changed', settings: { model: 'haiku', effort: 'low' } });
    });
    await flushChatlog();
    expect(inputProps.modelChoice).toBe('haiku');
    expect(inputProps.effortLevel).toBe('low');
    // A remote change is the chat's, not the workspace preference.
    expect(props.onModelChange).not.toHaveBeenCalled();
    expect(props.onEffortChange).not.toHaveBeenCalled();
    expect(log.commands('settings')).toHaveLength(0);
  });

  it('new chat seeds settings from workspace defaults', async () => {
    await mount({ aiProvider: 'codex', codexModels: [{ id: 'gpt-5', label: 'GPT-5' } as any] });
    await act(async () => { await inputProps.onSend('hello codex'); });
    await flushChatlog();
    const settings = log.commands('settings');
    expect(settings).toHaveLength(1);
    expect(settings[0]).toMatchObject({ chatId: 'c1', projectPath: P, settings: { provider: 'codex', model: 'gpt-5', permMode: 'auto', effort: 'medium' } });
    const order = log.commands().map((c: any) => c.kind);
    expect(order).toEqual(['settings', 'send']);
    expect(log.commands('send')[0]).toMatchObject({ provider: 'codex', projectPath: P });
    expect(sai.codexSend).toHaveBeenCalledWith(P, 'hello codex', undefined, 'auto', 'medium', 'gpt-5', 'c1', undefined);
    // Seeded once: the next send has nothing to seed.
    await emitChat(sai, { type: 'streaming_start', projectPath: P, scope: 'c1', turnSeq: 1 });
    await emitChat(sai, { type: 'done', projectPath: P, scope: 'c1', turnSeq: 1 });
    await act(async () => { await inputProps.onSend('again'); });
    expect(log.commands('settings')).toHaveLength(1);
  });

  it('send and picker commands claim the chat settled only when its IndexedDB history was verified', async () => {
    verified.clear();
    await mount();
    await act(async () => { await inputProps.onSend('first'); });
    await act(async () => { inputProps.onModelChange('opus'); });
    await flushChatlog();
    expect(log.commands().map((c: any) => [c.kind, c.settled])).toEqual([['settings', false], ['send', false], ['settings', false]]);
    verified.add('c1');
    await act(async () => { inputProps.onModelChange('haiku'); });
    await flushChatlog();
    expect(log.commands('settings').at(-1).settled).toBe(true);
  });

  it('a chat with its own settings keeps them when the workspace defaults differ', async () => {
    log.append('c1', { type: 'settings_changed', settings: { provider: 'claude', model: 'opus', permMode: 'bypass', effort: 'max' } }, { projectPath: P });
    await mount({ modelChoice: 'sonnet', permissionMode: 'default', effortLevel: 'low' });
    expect(inputProps).toMatchObject({ modelChoice: 'opus', permissionMode: 'bypass', effortLevel: 'max' });
    await act(async () => { await inputProps.onSend('go'); });
    expect(log.commands('settings')).toHaveLength(0);
    expect(sai.claudeSend).toHaveBeenCalledWith(P, 'go', undefined, 'bypass', 'max', 'opus', 'c1');
  });
});

describe('ChatPanel: the queue lives in the log', () => {
  it('send while streaming shows the item in the queue strip from state.queue', async () => {
    await mount();
    await startLogTurn();
    // Ctrl+Enter mid-turn queues the composer text.
    await act(async () => { await inputProps.onQueue('next one', 'next one'); });
    await flushChatlog();
    const send = log.commands('send')[0];
    expect(send.now).toBeUndefined();
    expect(log.state('c1')!.queue.map(q => q.clientId)).toEqual([send.clientId]);
    expect(inputProps.messageQueue).toEqual([expect.objectContaining({ id: send.clientId, text: 'next one', fullText: 'next one' })]);
    expect(inputProps.queueCount).toBe(1);
    // Held in the strip, not the transcript, and not dispatched.
    expect(contents()).not.toContain('next one');
    expect(sai.claudeSend).not.toHaveBeenCalled();
    // The Stop button stays up while the turn runs.
    expect(inputProps.isStreaming).toBe(true);

    // The turn ends: main drains it and the bubble joins the transcript.
    await emitChat(sai, { type: 'done', projectPath: P, scope: 'c1', turnSeq: 1 });
    expect(inputProps.messageQueue).toEqual([]);
    expect(sai.claudeSend).toHaveBeenCalledTimes(1);
    expect(sai.claudeSend.mock.calls[0][1]).toBe('next one');
    expect(contents()).toContain('next one');
  });

  it('Enter with a non-empty queue while streaming sends now:true', async () => {
    await mount();
    await startLogTurn();
    await act(async () => { await inputProps.onQueue('queued', 'queued'); });
    await flushChatlog();
    expect(inputProps.messageQueue).toHaveLength(1);
    await act(async () => { await inputProps.onSend('right now'); });
    await flushChatlog();
    const sends = log.commands('send');
    expect(sends.at(-1)).toMatchObject({ text: 'right now', now: true });
    expect(sai.claudeStop).toHaveBeenCalledTimes(1);
    expect(sai.claudeSend.mock.calls.at(-1)[1]).toBe('right now');
    // The queue is untouched; it resumes after this turn.
    expect(inputProps.messageQueue.map((q: any) => q.text)).toEqual(['queued']);
  });

  it('plain Enter while streaming with an empty queue queues (no now)', async () => {
    await mount();
    await startLogTurn();
    await act(async () => { await inputProps.onSend('follow-up'); });
    await flushChatlog();
    expect(log.commands('send')[0].now).toBeUndefined();
    expect(inputProps.messageQueue.map((q: any) => q.text)).toEqual(['follow-up']);
    expect(sai.claudeStop).not.toHaveBeenCalled();
  });

  it('removing a queued item sends queueRemove', async () => {
    await mount();
    await startLogTurn();
    await act(async () => { await inputProps.onQueue('a', 'a'); });
    await act(async () => { await inputProps.onQueue('b', 'b'); });
    await flushChatlog();
    const [a, b] = inputProps.messageQueue;
    await act(async () => { inputProps.onQueueRemove(a.id); });
    await flushChatlog();
    expect(log.commands('queueRemove')).toEqual([expect.objectContaining({ chatId: 'c1', target: a.id })]);
    expect(inputProps.messageQueue.map((q: any) => q.id)).toEqual([b.id]);
    // Removed items never reach the transcript.
    expect(contents()).not.toContain('a');
  });

  it('promoting a queued item sends queuePromote', async () => {
    await mount();
    await startLogTurn();
    await act(async () => { await inputProps.onQueue('a', 'a'); });
    await act(async () => { await inputProps.onQueue('b', 'b'); });
    await flushChatlog();
    const [, b] = inputProps.messageQueue;
    await act(async () => { inputProps.onQueuePromote(b.id); });
    await flushChatlog();
    expect(log.commands('queuePromote')).toEqual([expect.objectContaining({ chatId: 'c1', target: b.id })]);
    expect(inputProps.messageQueue.map((q: any) => q.text)).toEqual(['b', 'a']);
  });

  it('send-now on a queued item removes it and sends it with now:true', async () => {
    await mount();
    await startLogTurn();
    await act(async () => { await inputProps.onQueue('urgent', 'urgent'); });
    await flushChatlog();
    const [item] = inputProps.messageQueue;
    await act(async () => { await inputProps.onQueueSendNow(item.id); });
    await flushChatlog();
    expect(log.commands('queueRemove')[0]).toMatchObject({ target: item.id });
    expect(log.commands('send').at(-1)).toMatchObject({ text: 'urgent', now: true });
    expect(sai.claudeStop).toHaveBeenCalledTimes(1);
    expect(inputProps.messageQueue).toEqual([]);
  });

  it('a queue persisted in the log shows on mount', async () => {
    log.append('c1', { type: 'user_message', clientId: 'q-old', text: 'from before', origin: 'desktop' }, { projectPath: P });
    log.append('c1', { type: 'queue_added', item: { clientId: 'q-old', text: 'from before', queuedAt: 1 } });
    await mount();
    expect(inputProps.messageQueue).toEqual([expect.objectContaining({ id: 'q-old', text: 'from before' })]);
    expect(contents()).toEqual([]);
  });

  it('the strip shows the short composer text, not the pasted context', async () => {
    await mount();
    await startLogTurn();
    const full = '[Terminal output]\n```\nls\n```\n\n@/project/a.ts\n\nfix it';
    await act(async () => { await inputProps.onQueue('fix it', full); });
    await flushChatlog();
    expect(log.commands('send')[0]).toMatchObject({ text: full, label: 'fix it' });
    expect(inputProps.messageQueue).toEqual([expect.objectContaining({ text: 'fix it', fullText: full })]);
    // Sent as typed (with context) once it drains.
    await emitChat(sai, { type: 'done', projectPath: P, scope: 'c1', turnSeq: 1 });
    expect(sai.claudeSend.mock.calls[0][1]).toBe(full);
  });

  it('send-now of an item main already drained does not send it again', async () => {
    await mount();
    await startLogTurn();
    await act(async () => { await inputProps.onQueue('once', 'once'); });
    await flushChatlog();
    const [item] = inputProps.messageQueue;
    // The click lands while the strip still shows the item, but main drains it first.
    const staleSendNow = inputProps.onQueueSendNow;
    await emitChat(sai, { type: 'done', projectPath: P, scope: 'c1', turnSeq: 1 });
    expect(sai.claudeSend).toHaveBeenCalledTimes(1);
    await act(async () => { await staleSendNow(item.id); });
    await flushChatlog();
    expect(sai.claudeSend).toHaveBeenCalledTimes(1);
    expect(sai.claudeStop).not.toHaveBeenCalled();
    expect(log.commands('send')).toHaveLength(1);
  });
});

describe('ChatPanel: file-context prefix on programmatic sends', () => {
  it('a send through sendTextRef still gets the [File:] prefix by default', async () => {
    const sendTextRef: { current: ((t: string, o?: { skipFileContext?: boolean }) => void) | null } = { current: null };
    await mount({ sendTextRef, activeFilePath: '/p/a.ts' } as any);
    await act(async () => { sendTextRef.current!('hello'); });
    await flushChatlog();
    expect(log.commands('send')[0]).toMatchObject({ text: 'hello', promptOverride: '[File: /p/a.ts]\n\nhello' });
  });

  it('skipFileContext suppresses the prefix (canvas delivery)', async () => {
    const sendTextRef: { current: ((t: string, o?: { skipFileContext?: boolean }) => void) | null } = { current: null };
    await mount({ sendTextRef, activeFilePath: '/p/a.ts' } as any);
    await act(async () => { sendTextRef.current!('[Canvas update] x', { skipFileContext: true }); });
    await flushChatlog();
    const sent = log.commands('send')[0];
    expect(sent.text).toBe('[Canvas update] x');
    expect(sent.promptOverride).toBeUndefined();
  });
});

describe('ChatPanel: command palette sends', () => {
  it('palette /compact mid-turn queues behind the running turn instead of compacting now', async () => {
    const sendTextRef: { current: ((t: string) => void) | null } = { current: null };
    sai.claudeCompact = vi.fn();
    await mount({ sendTextRef } as any);
    await startLogTurn();
    await act(async () => { sendTextRef.current!('/compact'); });
    await flushChatlog();
    expect(sai.claudeCompact).not.toHaveBeenCalled();
    expect(log.commands('send')[0]).toMatchObject({ text: '/compact' });
    expect(log.commands('send')[0].now).toBeUndefined();
    expect(inputProps.messageQueue.map((q: any) => q.text)).toEqual(['/compact']);
    expect(sai.claudeStop).not.toHaveBeenCalled();
  });

  it('palette /compact while idle compacts right away', async () => {
    const sendTextRef: { current: ((t: string) => void) | null } = { current: null };
    sai.claudeCompact = vi.fn();
    await mount({ sendTextRef } as any);
    await act(async () => { sendTextRef.current!('/compact'); });
    await flushChatlog();
    expect(sai.claudeCompact).toHaveBeenCalledTimes(1);
    expect(log.commands('send')).toHaveLength(0);
  });
});

