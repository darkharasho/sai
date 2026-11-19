/**
 * ChatPanel renders from the durable chat log (Task 8). The window.sai.chatlog
 * mock is an in-memory log driven through the REAL reducer; backend events are
 * delivered the way main does it (logged first, then claudeOnMessage).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { installMockSai } from '../../../helpers/ipc-mock';
import { installMockChatlog, emitChat, flushChatlog, type MockChatlog } from '../../../helpers/chatlogMock';

vi.mock('../../../../src/lib/chat/migrateToLog', () => ({ ensureChatInLog: vi.fn(async () => {}) }));

const messageProps = new Map<string, any>();
vi.mock('../../../../src/components/Chat/ChatMessage', () => ({
  default: (props: any) => {
    messageProps.set(props.message?.id, props);
    return (
      <div
        data-testid="chat-message"
        data-msg-id={props.message?.id}
        data-role={props.message?.role}
        data-msg-content={typeof props.message?.content === 'string' ? props.message.content : ''}
        data-reasoning={props.message?.reasoning ?? ''}
        data-tool-output={props.message?.toolCalls?.[0]?.output ?? ''}
        data-streaming={props.isStreaming ? 'true' : 'false'}
      />
    );
  },
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

const bubbles = () => screen.queryAllByTestId('chat-message');
const contents = () => bubbles().map(b => b.getAttribute('data-msg-content'));
const delta = (t: string, scope = 'c1', turnSeq = 1) => ({ type: 'assistant', projectPath: P, scope, turnSeq, message: { content: [{ type: 'text', text: t, delta: true }] } });

let sai: ReturnType<typeof installMockSai> & Record<string, any>;
let log: MockChatlog;

async function mount(over: Partial<Props> = {}) {
  const r = render(<ChatPanel {...baseProps(over)} />);
  await flushChatlog();
  return r;
}

beforeEach(() => {
  messageProps.clear();
  inputProps = undefined;
  sai = installMockSai() as any;
  sai.settingsGet.mockImplementation((_k: string, d: unknown) => Promise.resolve(d));
  sai.claudeAnswerQuestion = vi.fn().mockResolvedValue(undefined);
  sai.claudeAnswerPlanReview = vi.fn().mockResolvedValue(undefined);
  sai.kimiSend = vi.fn();
  sai.kimiStop = vi.fn();
  log = installMockChatlog(sai);
  Object.defineProperty(window, 'IntersectionObserver', {
    writable: true, value: class { observe() {} disconnect() {} unobserve() {} },
  });
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { writable: true, value: vi.fn() });
});

describe('ChatPanel renders from the durable log', () => {
  it('renders messages from the log snapshot and live entries', async () => {
    log.seed('c1', [
      { id: 'u1', role: 'user', content: 'hello', timestamp: 1 },
      { id: 'a1', role: 'assistant', content: 'hi there', timestamp: 2 },
    ], { projectPath: P });
    await mount();
    expect(contents()).toEqual(['hello', 'hi there']);
    await emitChat(sai, { type: 'streaming_start', projectPath: P, scope: 'c1', turnSeq: 1 });
    await emitChat(sai, delta('live '));
    await emitChat(sai, delta('reply'));
    expect(contents()).toEqual(['hello', 'hi there', 'live reply']);
  });

  it('send issues one command with a clientId and shows the bubble from the user_message entry', async () => {
    await mount();
    await act(async () => { await inputProps.onSend('new prompt'); });
    await flushChatlog();
    const sends = log.commands('send');
    expect(sends).toHaveLength(1);
    expect(sends[0]).toMatchObject({
      kind: 'send', chatId: 'c1', text: 'new prompt', origin: 'desktop', projectPath: P, provider: 'claude',
    });
    expect(typeof sends[0].clientId).toBe('string');
    // The bubble IS the logged user_message, keyed by the command's clientId.
    const user = bubbles().find(b => b.getAttribute('data-role') === 'user')!;
    expect(user.getAttribute('data-msg-id')).toBe(sends[0].clientId);
    expect(user.getAttribute('data-msg-content')).toBe('new prompt');
    // The panel never dispatches itself; main's command does (mock → claudeSend once).
    expect(sai.claudeSend).toHaveBeenCalledTimes(1);
    expect(sai.claudeSend).toHaveBeenCalledWith(P, 'new prompt', undefined, 'default', 'high', 'sonnet', 'c1');
  });

  it('a reply that streamed while the panel was unmounted is complete on mount', async () => {
    log.append('c1', { type: 'user_message', clientId: 'u1', text: 'go', origin: 'desktop' }, { projectPath: P });
    log.append('c1', { type: 'streaming_start', turnSeq: 1 });
    const words: string[] = [];
    for (let i = 3; i <= 38; i++) { words.push(`w${i} `); log.append('c1', delta(`w${i} `)); }
    log.append('c1', { type: 'result', turnSeq: 1 });
    log.append('c1', { type: 'done', turnSeq: 1 });
    expect(log.entries('c1')).toHaveLength(40);
    await mount();
    expect(contents()).toEqual(['go', words.join('')]);
    expect(inputProps.isStreaming).toBe(false);
  });

  it('Stop button clears on the done entry; a stale done does not clear it', async () => {
    await mount();
    await emitChat(sai, { type: 'streaming_start', projectPath: P, scope: 'c1', turnSeq: 2 });
    expect(inputProps.isStreaming).toBe(true);
    await emitChat(sai, { type: 'done', projectPath: P, scope: 'c1', turnSeq: 1 });
    expect(inputProps.isStreaming).toBe(true);
    await emitChat(sai, { type: 'done', projectPath: P, scope: 'c1', turnSeq: 2 });
    expect(inputProps.isStreaming).toBe(false);
  });

  it('/clear and /help go through appendClient', async () => {
    await mount();
    await act(async () => { await inputProps.onSend('/help'); });
    await flushChatlog();
    const kinds = sai.chatlog.appendClient.mock.calls.map(([, ev]: any[]) => ev.type);
    expect(kinds).toEqual(['user_message', 'local_note']);
    const [, userEv] = sai.chatlog.appendClient.mock.calls[0];
    const [, note] = sai.chatlog.appendClient.mock.calls[1];
    expect(note.noteId).toBe(`help-${userEv.clientId}`);
    expect(bubbles().map(b => b.getAttribute('data-msg-id'))).toEqual([userEv.clientId, `help-${userEv.clientId}`]);
    expect(log.commands()).toHaveLength(0);

    await act(async () => { await inputProps.onSend('/clear'); });
    await flushChatlog();
    expect(sai.chatlog.appendClient.mock.calls.at(-1)[1]).toEqual({ type: 'cleared' });
    expect(bubbles()).toHaveLength(0);
  });

  it('approval card comes from state.pendingApproval and approve sends one command', async () => {
    await mount();
    await emitChat(sai, { type: 'streaming_start', projectPath: P, scope: 'c1', turnSeq: 1 });
    await emitChat(sai, {
      type: 'approval_needed', projectPath: P, scope: 'c1', toolName: 'Bash', toolUseId: 't1',
      command: 'ls', description: 'list', input: { command: 'ls' },
    });
    expect(inputProps.pendingApproval).toMatchObject({ toolUseId: 't1', command: 'ls' });
    await act(async () => { await inputProps.onApprove(); });
    const approves = log.commands('approve');
    expect(approves).toHaveLength(1);
    expect(approves[0]).toMatchObject({ kind: 'approve', chatId: 'c1', toolUseId: 't1', approved: true });
    expect(sai.claudeApprove).toHaveBeenCalledTimes(1);
    // Dismissed at once; approval_resolved then clears the log's copy too.
    expect(inputProps.pendingApproval).toBeNull();
    await emitChat(sai, { type: 'approval_resolved', projectPath: P, scope: 'c1' });
    expect(log.state('c1')!.pendingApproval).toBeNull();
  });
});

/** Ruling R10: the Step 7 dogfood scenarios as log-driven tests. */
describe('dogfood scenarios (log-driven)', () => {
  it('1. a Claude turn with tools and reasoning', async () => {
    const onTurnComplete = vi.fn();
    const onMessagesChange = vi.fn();
    await mount({ onTurnComplete, onMessagesChange });
    await act(async () => { await inputProps.onSend('fix it'); });
    await emitChat(sai, { type: 'streaming_start', projectPath: P, scope: 'c1', turnSeq: 1 });
    await emitChat(sai, { type: 'reasoning_delta', projectPath: P, scope: 'c1', text: 'thinking about it' });
    await emitChat(sai, { type: 'assistant', projectPath: P, scope: 'c1', turnSeq: 1, message: { content: [{ type: 'tool_use', id: 'tu1', name: 'Bash', input: { command: 'ls' } }] } });
    expect(inputProps.isStreaming).toBe(true);
    await emitChat(sai, { type: 'user', projectPath: P, scope: 'c1', turnSeq: 1, message: { content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'a.txt' }] } });
    await emitChat(sai, delta('Done.'));
    await emitChat(sai, { type: 'result', projectPath: P, scope: 'c1', turnSeq: 1, usage: { input_tokens: 10, output_tokens: 5 } });
    await emitChat(sai, { type: 'done', projectPath: P, scope: 'c1', turnSeq: 1 });

    const all = bubbles();
    expect(all.map(b => b.getAttribute('data-role'))).toEqual(['user', 'assistant', 'assistant', 'assistant']);
    expect(all[1].getAttribute('data-reasoning')).toBe('thinking about it');
    expect(all[2].getAttribute('data-tool-output')).toBe('a.txt');
    expect(all[3].getAttribute('data-msg-content')).toBe('Done.');
    expect(inputProps.isStreaming).toBe(false);
    expect(onTurnComplete).toHaveBeenCalledTimes(1);
    // The parent's mirror gets persistable state (no live reasoning flag) at turn end.
    const handed = onMessagesChange.mock.calls.at(-1)[0];
    expect(handed).toHaveLength(4);
    expect(handed.some((m: any) => m.reasoningLive)).toBe(false);
    expect(typeof handed[3].durationMs).toBe('number');
    expect(inputProps.contextUsage).toMatchObject({ inputTokens: 10, outputTokens: 5 });
  });

  it('2. a Codex turn', async () => {
    await mount({ aiProvider: 'codex', codexModels: [{ id: 'gpt-5', label: 'GPT-5' } as any] });
    await act(async () => { await inputProps.onSend('codex please'); });
    const settings = log.commands('settings');
    expect(settings).toHaveLength(1);
    expect(settings[0].settings).toEqual({ provider: 'codex', model: 'gpt-5', permMode: 'auto', effort: 'medium' });
    expect(log.commands('send')[0]).toMatchObject({ provider: 'codex', chatId: 'c1' });
    expect(sai.codexSend).toHaveBeenCalledWith(P, 'codex please', undefined, 'auto', 'medium', 'gpt-5', 'c1', undefined);
    await emitChat(sai, { type: 'streaming_start', projectPath: P, scope: 'c1', turnSeq: 1 });
    await emitChat(sai, { type: 'assistant', projectPath: P, scope: 'c1', turnSeq: 1, message: { content: [{ type: 'text', text: 'codex reply' }] } });
    await emitChat(sai, { type: 'done', projectPath: P, scope: 'c1', turnSeq: 1 });
    expect(contents()).toEqual(['codex please', 'codex reply']);
    // Unchanged settings: the next send issues no settings command.
    await act(async () => { await inputProps.onSend('again'); });
    expect(log.commands('settings')).toHaveLength(1);
  });

  it('3. switching away mid-reply and back: the reply is complete', async () => {
    const first = await mount();
    await act(async () => { await inputProps.onSend('long one'); });
    await emitChat(sai, { type: 'streaming_start', projectPath: P, scope: 'c1', turnSeq: 1 });
    await emitChat(sai, delta('part one, '));
    first.unmount();
    await emitChat(sai, delta('part two, '));
    await emitChat(sai, delta('part three.'));
    await emitChat(sai, { type: 'result', projectPath: P, scope: 'c1', turnSeq: 1 });
    await emitChat(sai, { type: 'done', projectPath: P, scope: 'c1', turnSeq: 1 });
    await mount();
    expect(contents()).toEqual(['long one', 'part one, part two, part three.']);
    expect(inputProps.isStreaming).toBe(false);
  });

  it('4. two chats streaming at once stay separate', async () => {
    render(<>
      <ChatPanel {...baseProps({ sessionId: 'c1', claudeScope: 'c1' })} />
      <ChatPanel {...baseProps({ sessionId: 'c2', claudeScope: 'c2' })} />
    </>);
    await flushChatlog();
    log.append('c1', { type: 'user_message', clientId: 'q1', text: 'one?' }, { projectPath: P });
    log.append('c2', { type: 'user_message', clientId: 'q2', text: 'two?' }, { projectPath: P });
    await emitChat(sai, { type: 'streaming_start', projectPath: P, scope: 'c1', turnSeq: 1 });
    await emitChat(sai, { type: 'streaming_start', projectPath: P, scope: 'c2', turnSeq: 1 });
    await emitChat(sai, delta('A1 ', 'c1'));
    await emitChat(sai, delta('B1 ', 'c2'));
    await emitChat(sai, delta('A2', 'c1'));
    await emitChat(sai, delta('B2', 'c2'));
    await emitChat(sai, { type: 'done', projectPath: P, scope: 'c1', turnSeq: 1 });
    expect(contents()).toEqual(['one?', 'A1 A2', 'two?', 'B1 B2']);
    expect(log.state('c1')!.turn.streaming).toBe(false);
    expect(log.state('c2')!.turn.streaming).toBe(true);
  });

  it('5. Stop mid-turn goes through an interrupt command', async () => {
    await mount();
    await emitChat(sai, { type: 'streaming_start', projectPath: P, scope: 'c1', turnSeq: 1 });
    await emitChat(sai, delta('half'));
    expect(inputProps.isStreaming).toBe(true);
    await act(async () => { await inputProps.onStop(); });
    expect(log.commands('interrupt')).toEqual([expect.objectContaining({ kind: 'interrupt', chatId: 'c1' })]);
    expect(sai.claudeStop).toHaveBeenCalledWith(P, 'c1');
    await emitChat(sai, { type: 'done', projectPath: P, scope: 'c1', turnSeq: 1, subagentsAborted: true });
    expect(inputProps.isStreaming).toBe(false);
    expect(contents()).toEqual(['half']);
  });

  it('6. an approval: deny goes through one command', async () => {
    await mount();
    await emitChat(sai, { type: 'approval_needed', projectPath: P, scope: 'c1', toolName: 'Bash', toolUseId: 't9', command: 'rm x', description: '', input: {} });
    await act(async () => { await inputProps.onDeny(); });
    expect(log.commands('approve')).toEqual([expect.objectContaining({ toolUseId: 't9', approved: false })]);
    expect(inputProps.pendingApproval).toBeNull();
  });

  it('7. AskUserQuestion: the answer goes through a command and lands on the tool card', async () => {
    await mount();
    await emitChat(sai, { type: 'streaming_start', projectPath: P, scope: 'c1', turnSeq: 1 });
    const input = { questions: [{ question: 'Which?', options: [{ label: 'A' }, { label: 'B' }] }] };
    await emitChat(sai, { type: 'assistant', projectPath: P, scope: 'c1', turnSeq: 1, message: { content: [{ type: 'tool_use', id: 'q1', name: 'AskUserQuestion', input }] } });
    const card = bubbles().find(b => b.getAttribute('data-role') === 'assistant')!;
    const props = messageProps.get(card.getAttribute('data-msg-id'));
    await act(async () => { await props.onAnswerQuestion('q1', { 'Which?': 'A' }); });
    expect(log.commands('answer')).toEqual([expect.objectContaining({ chatId: 'c1', toolUseId: 'q1', answers: { 'Which?': 'A' } })]);
    expect(sai.claudeAnswerQuestion).toHaveBeenCalledWith(P, 'q1', { 'Which?': 'A' }, 'c1');
    await emitChat(sai, { type: 'question_answered', projectPath: P, scope: 'c1', toolUseId: 'q1', answers: { 'Which?': 'A' } });
    const tc = log.state('c1')!.messages.at(-1)!.toolCalls![0];
    expect(JSON.parse(tc.input).answers).toEqual({ 'Which?': 'A' });
  });

  it('8. /clear empties the transcript through the log', async () => {
    log.seed('c1', [{ id: 'u1', role: 'user', content: 'old', timestamp: 1 }], { projectPath: P });
    await mount();
    expect(contents()).toEqual(['old']);
    await act(async () => { await inputProps.onSend('/clear'); });
    await flushChatlog();
    expect(bubbles()).toHaveLength(0);
    expect(log.state('c1')!.messages).toEqual([]);
  });

  it('9. quit mid-turn, relaunch: the partial reply shows and the chat is not working', async () => {
    log.append('c1', { type: 'user_message', clientId: 'u1', text: 'go' }, { projectPath: P });
    log.append('c1', { type: 'streaming_start', turnSeq: 4 });
    log.append('c1', { type: 'subagent_activity', agentId: 'ag', status: 'running', turnSeq: 4 });
    log.append('c1', delta('partial ans', 'c1', 4));
    // What ChatLogService.startupRepair appends on the next launch.
    log.append('c1', { type: 'done', turnSeq: null, reason: 'app_restart', subagentsAborted: true });
    await mount();
    expect(contents()).toEqual(['go', 'partial ans']);
    expect(inputProps.isStreaming).toBe(false);
    expect(screen.queryByTestId('thinking-animation')).toBeNull();
  });
});

describe('fix round 1', () => {
  it('a turn only the log holds open is reconciled with the backend every 20s until it closes', async () => {
    vi.useFakeTimers();
    try {
      sai.claudeReconcileScope = vi.fn();
      await mount({ isStreaming: false });
      await emitChat(sai, { type: 'streaming_start', projectPath: P, scope: 'c1', turnSeq: 3 });
      expect(inputProps.isStreaming).toBe(true); // Stop shows from the log turn
      await act(async () => { await vi.advanceTimersByTimeAsync(19_000); });
      expect(sai.claudeReconcileScope).not.toHaveBeenCalled();
      await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
      expect(sai.claudeReconcileScope).toHaveBeenCalledTimes(1);
      expect(sai.claudeReconcileScope).toHaveBeenCalledWith(P, 'c1');
      // The backend's unstick done(turnSeq:null) is logged and closes the turn.
      await emitChat(sai, { type: 'done', projectPath: P, scope: 'c1', turnSeq: null });
      expect(inputProps.isStreaming).toBe(false);
      await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
      expect(sai.claudeReconcileScope).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('no log-turn reconcile while App still counts the turn busy', async () => {
    vi.useFakeTimers();
    try {
      sai.claudeReconcileScope = vi.fn();
      await mount({ isStreaming: true });
      await emitChat(sai, { type: 'streaming_start', projectPath: P, scope: 'c1', turnSeq: 3 });
      await act(async () => { await vi.advanceTimersByTimeAsync(65_000); });
      expect(sai.claudeReconcileScope).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('a failed send puts the text back into the composer and raises the error notice', async () => {
    await mount();
    const restore = vi.fn();
    inputProps.draftRestoreRef.current = restore;
    const notices: string[] = [];
    const onErr = (e: Event) => notices.push((e as CustomEvent).detail.message);
    window.addEventListener('sai-chat-error', onErr);
    sai.chatlog.command.mockImplementation(async (cmd: any) => (
      cmd.kind === 'send' ? { clientId: cmd.clientId, ok: false, duplicate: false, error: 'backend down' } : { clientId: cmd.clientId, ok: true, duplicate: false }
    ));
    try {
      await act(async () => { await inputProps.onSend('do not lose me'); });
      expect(restore).toHaveBeenCalledWith('do not lose me');
      expect(notices).toEqual(['Message not sent: backend down']);
    } finally {
      window.removeEventListener('sai-chat-error', onErr);
    }
  });

  it('dismissed prompts and suggestions reset when the panel moves to another chat', async () => {
    log.append('c1', { type: 'prompt_suggestion', suggestion: 'run the tests' }, { projectPath: P });
    const { rerender } = await mount();
    expect(screen.getByTestId('prompt-suggestion-chip')).toBeTruthy();
    await act(async () => { screen.getByLabelText('Dismiss suggestion').click(); });
    expect(screen.queryByTestId('prompt-suggestion-chip')).toBeNull();
    rerender(<ChatPanel {...baseProps({ sessionId: 'c2', claudeScope: 'c2' })} />);
    await flushChatlog();
    rerender(<ChatPanel {...baseProps()} />);
    await flushChatlog();
    expect(screen.getByTestId('prompt-suggestion-chip')).toBeTruthy();
  });
});
