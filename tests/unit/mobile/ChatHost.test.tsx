// The phone's ChatHost mounts the desktop's real ChatPanel over the window.sai
// shim, whose V2Client talks to a scripted socket.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { V2Client } from '../../../mobile/src/v2/client';
import { createConnection, type Connection } from '../../../mobile/src/shell/connection';
import { ChatHost } from '../../../mobile/src/shell/ChatHost';
import { startLifecycle } from '../../../mobile/src/shell/lifecycle';
import { emptyChatState } from '../../../src/lib/chat/reducer';
import type { ChatState } from '../../../src/lib/chat/types';
import { FakeSocket } from './fakeSocket';

vi.mock('../../../src/lib/chat/migrateToLog', () => ({
  ensureChatInLog: vi.fn(async () => {}), isChatImported: () => true, forgetChatImported: vi.fn(),
}));

const appListeners: Array<(s: { isActive: boolean }) => void> = [];
vi.mock('@capacitor/app', () => ({
  App: {
    addListener: vi.fn(async (event: string, cb: (s: { isActive: boolean }) => void) => {
      if (event === 'appStateChange') appListeners.push(cb);
      return { remove: async () => { appListeners.splice(appListeners.indexOf(cb), 1); } };
    }),
  },
}));

const last = () => FakeSocket.all[FakeSocket.all.length - 1];
const sentOf = (type: string, sock = last()) => sock.sent.filter((f) => f.type === type);

const SETTINGS = { provider: 'claude' as const, model: 'sonnet', permMode: 'default', effort: 'high' };

function stateWith(patch: Partial<ChatState>): ChatState {
  return { ...emptyChatState(SETTINGS), ...patch };
}

let client: V2Client;
let conn: Connection;

/** `settings` is the desktop's app.settings, as both the shim and ChatHost see it. */
function setup(settings: Record<string, unknown> = {}) {
  client = new V2Client({ url: 'ws://desk/ws', token: 't', WebSocketImpl: FakeSocket as any, random: () => 0.5 });
  conn = createConnection(client, { native: { openUrl() {}, copyText() {}, toast() {} }, settings: () => settings });
  (window as any).sai = conn.sai;
  client.connect();
  last().open();
  last().authOk();
}

/** Answers the panel's chat.subscribe with a snapshot (and optional entries). */
async function serve(chatId: string, state: ChatState, entries: any[] = []) {
  await waitFor(() => expect(sentOf('chat.subscribe').some((f) => f.chatId === chatId)).toBe(true));
  act(() => {
    last().recv({ type: 'chat.snapshot', chatId, seq: state.lastSeq, state });
    last().recv({ type: 'chat.entries', chatId, entries });
  });
}

beforeEach(() => {
  FakeSocket.all = [];
  appListeners.length = 0;
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  Object.defineProperty(window, 'IntersectionObserver', { writable: true, value: class { observe() {} disconnect() {} unobserve() {} } });
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { writable: true, value: vi.fn() });
  document.documentElement.dataset.saiPhone = '1';
});
afterEach(() => {
  client?.close();
  delete (window as any).sai;
  delete document.documentElement.dataset.saiPhone;
  vi.restoreAllMocks();
});

describe('ChatHost', () => {
  it('ChatHost renders log messages through the real ChatPanel', async () => {
    setup();
    render(<ChatHost chatId="c1" projectPath="/proj" conn={conn} appSettings={{}} />);
    await serve('c1', stateWith({
      lastSeq: 2,
      messages: [
        { id: 'm1', role: 'user', content: 'hi there', timestamp: 1 },
        { id: 'm2', role: 'assistant', content: 'hello back from the desk', timestamp: 2 },
      ] as any,
    }));
    expect(await screen.findByText('hello back from the desk')).toBeTruthy();
    expect(screen.getByText('hi there')).toBeTruthy();
  });

  it('waiting state shows the waiting row', async () => {
    setup();
    const { container } = render(<ChatHost chatId="c2" projectPath="/proj" conn={conn} appSettings={{}} />);
    await serve('c2', stateWith({
      lastSeq: 3,
      messages: [{ id: 'm1', role: 'assistant', content: 'started the build', timestamp: 1 }] as any,
      waiting: { kind: 'background', taskCount: 1, since: Date.now() },
    }));
    await waitFor(() => expect(container.querySelector('.chat-waiting-row')).toBeTruthy());
  });

  it('send from the composer issues one chat.command', async () => {
    setup();
    render(<ChatHost chatId="c3" projectPath="/proj" conn={conn} appSettings={{}} />);
    await serve('c3', stateWith({ lastSeq: 1, messages: [{ id: 'm1', role: 'assistant', content: 'ready', timestamp: 1 }] as any }));
    await screen.findByText('ready');
    const box = screen.getByRole('textbox') as HTMLTextAreaElement;
    await waitFor(() => expect(box.disabled).toBe(false));
    fireEvent.change(box, { target: { value: 'ship it' } });
    // Phone: Enter is a newline; the Send button sends.
    fireEvent.click(screen.getByTitle('Send'));
    await waitFor(() => expect(sentOf('chat.command')).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 50));
    const cmds = sentOf('chat.command');
    expect(cmds).toHaveLength(1);
    expect(cmds[0].command).toMatchObject({ kind: 'send', chatId: 'c3', text: 'ship it', projectPath: '/proj' });
  });

  it('foreground resubscribes from lastSeq', async () => {
    setup();
    const stop = startLifecycle(() => client);
    render(<ChatHost chatId="c4" projectPath="/proj" conn={conn} appSettings={{}} />);
    await serve('c4', stateWith({ lastSeq: 5, messages: [{ id: 'm1', role: 'assistant', content: 'before sleep', timestamp: 1 }] as any }), [
      { chatId: 'c4', seq: 6, ts: 2, ev: { type: 'local_note', content: 'note six' } },
    ]);
    await screen.findByText('before sleep');
    await waitFor(() => expect(appListeners).toHaveLength(1));

    // Backgrounded: the socket died while suspended.
    const old = last();
    act(() => { old.serverClose(1006); });
    expect(client.state).toBe('offline');

    // Foreground: reconnect now and catch up from the last seq the phone has.
    act(() => { for (const cb of appListeners) cb({ isActive: true }); });
    expect(last()).not.toBe(old);
    act(() => { last().open(); last().authOk(); });
    expect(sentOf('chat.subscribe')).toEqual([{ type: 'chat.subscribe', chatId: 'c4', after: 6 }]);
    // The last state stays on screen while catching up.
    expect(screen.getByText('before sleep')).toBeTruthy();
    stop();
  });
});

/** Acks every chat.command the phone has sent so far. */
function ackAll() {
  act(() => {
    for (const f of sentOf('chat.command')) {
      last().recv({ type: 'chat.ack', result: { clientId: f.command.clientId, ok: true, duplicate: false, seq: 1 } });
    }
  });
}

/** A new chat: the server has no log, so it answers with no snapshot and no entries. */
async function serveNew(chatId: string) {
  await waitFor(() => expect(sentOf('chat.subscribe').some((f) => f.chatId === chatId)).toBe(true));
  act(() => { last().recv({ type: 'chat.entries', chatId, entries: [] }); });
}

async function sendFromComposer(text: string) {
  const box = screen.getByRole('textbox') as HTMLTextAreaElement;
  await waitFor(() => expect(box.disabled).toBe(false));
  fireEvent.change(box, { target: { value: text } });
  fireEvent.click(screen.getByTitle('Send'));
}

describe('ChatHost new chats use the desktop defaults', () => {
  it('a new chat uses the desktop aiProvider (codex) and its nested codex model', async () => {
    const desk = { aiProvider: 'codex', codex: { model: 'gpt-5', permission: 'read-only', effort: 'medium' } };
    setup(desk);
    render(<ChatHost chatId="n1" projectPath="/proj" conn={conn} appSettings={desk} />);
    await serveNew('n1');
    await waitFor(() => expect(conn.mirror.get('n1')?.settings.provider).toBe('codex'));
    await sendFromComposer('hi codex');
    await waitFor(() => expect(sentOf('chat.command').length).toBeGreaterThan(0));
    ackAll();
    await waitFor(() => expect(sentOf('chat.command').some((f) => f.command.kind === 'send')).toBe(true));
    const cmds = sentOf('chat.command').map((f) => f.command);
    expect(cmds.find((c) => c.kind === 'settings')?.settings).toMatchObject({ provider: 'codex', model: 'gpt-5', permMode: 'read-only' });
    expect(cmds.find((c) => c.kind === 'send')).toMatchObject({ provider: 'codex', text: 'hi codex' });
  });

  it('a new Claude chat takes model, effort and permission from the nested claude settings', async () => {
    const desk = { aiProvider: 'claude', modelChoice: 'haiku', claude: { model: 'opus', effort: 'low', permission: 'bypass' } };
    setup(desk);
    render(<ChatHost chatId="n2" projectPath="/proj" conn={conn} appSettings={desk} />);
    await serveNew('n2');
    await sendFromComposer('hi claude');
    await waitFor(() => expect(sentOf('chat.command').length).toBeGreaterThan(0));
    ackAll();
    await waitFor(() => expect(sentOf('chat.command').some((f) => f.command.kind === 'send')).toBe(true));
    const settings = sentOf('chat.command').map((f) => f.command).find((c) => c.kind === 'settings')?.settings;
    expect(settings).toMatchObject({ provider: 'claude', model: 'opus', effort: 'low', permMode: 'bypass' });
  });
});

describe('ChatHost closes through its own connection', () => {
  it('unmount after a machine switch closes the chat on the old connection, not window.sai', async () => {
    setup();
    const oldConn = conn;
    const oldSock = last();
    const { unmount } = render(<ChatHost chatId="m1" projectPath="/proj" conn={oldConn} appSettings={{}} />);
    await serve('m1', stateWith({ lastSeq: 1, messages: [{ id: 'm1', role: 'assistant', content: 'old desk', timestamp: 1 }] as any }));
    await screen.findByText('old desk');
    expect(oldConn.mirror.get('m1')).not.toBeNull();

    // Another machine became active: window.sai now reaches it.
    const other = new V2Client({ url: 'ws://other/ws', token: 't2', WebSocketImpl: FakeSocket as any, random: () => 0.5 });
    const otherConn = createConnection(other, { native: { openUrl() {}, copyText() {}, toast() {} }, settings: () => ({}) });
    other.connect(); last().open(); last().authOk();
    const otherSock = last();
    (window as any).sai = otherConn.sai;

    unmount();
    expect(sentOf('chat.unsubscribe', oldSock)).toEqual([{ type: 'chat.unsubscribe', chatId: 'm1' }]);
    expect(sentOf('chat.unsubscribe', otherSock)).toEqual([]);
    expect(oldConn.mirror.get('m1')).toBeNull();
    other.close();
  });
});
