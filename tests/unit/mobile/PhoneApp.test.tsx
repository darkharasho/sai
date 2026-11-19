// The phone shell's routing around the active machine.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { FakeSocket } from './fakeSocket';
import { addMachine } from '../../../mobile/src/machines/store';
import { getNative } from '../../../mobile/src/native';
import { disconnect } from '../../../mobile/src/shell/connection';
import { PhoneApp } from '../../../mobile/src/shell/App';

// The chat view itself (ChatPanel) is covered elsewhere; here only which chat is open matters.
vi.mock('../../../mobile/src/shell/ChatHost', async (orig) => ({
  ...(await orig<typeof import('../../../mobile/src/shell/ChatHost')>()),
  ChatHost: ({ chatId }: { chatId: string }) => <div data-testid="chat-host" data-chat-id={chatId} />,
}));
vi.mock('@capacitor/app', () => ({ App: { addListener: vi.fn(async () => ({ remove: async () => {} })) } }));

const last = () => FakeSocket.all[FakeSocket.all.length - 1];
const sentOf = (type: string) => last().sent.filter((f) => f.type === type);

beforeEach(() => {
  FakeSocket.all = [];
  vi.stubGlobal('WebSocket', FakeSocket);
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  document.documentElement.dataset.saiPhone = '1';
  localStorage.clear();
});
afterEach(() => {
  disconnect();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete document.documentElement.dataset.saiPhone;
});

describe('PhoneApp', () => {
  it('picking the already-active machine keeps its workspaces and chats', async () => {
    const m = await addMachine({ label: 'desk', baseUrl: 'http://desk:17830', deviceId: 'd1', token: 'tok' }, getNative());
    localStorage.setItem('sai.activeMachine.v1', m.id);
    render(<PhoneApp />);

    await waitFor(() => expect(FakeSocket.all.length).toBe(1));
    act(() => { last().open(); last().authOk(); });
    await waitFor(() => expect(sentOf('workspaces.subscribe').length).toBeGreaterThan(0));
    act(() => {
      last().recv({ type: 'workspaces.list.result', workspaces: [{ projectPath: '/p', name: 'proj', kind: 'project', state: 'active' }] });
    });
    await waitFor(() => expect(sentOf('chats.subscribe').some((f) => f.projectPath === '/p')).toBe(true));
    const sub = sentOf('chats.subscribe').find((f) => f.projectPath === '/p')!;
    act(() => {
      last().recv({
        type: 'chats.list.result', reqId: sub.reqId,
        chats: [{ chatId: 'c9', projectPath: '/p', title: 'Kept chat', createdAt: 1, updatedAt: 2, headSeq: 3, snapshotSeq: 0, provider: 'claude', openTurn: false }],
      });
    });

    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    expect(await screen.findByText('Kept chat')).toBeTruthy();

    // Machines → pick the machine that is already connected.
    fireEvent.click(screen.getByRole('button', { name: 'Manage machines…' }));
    fireEvent.click(await screen.findByTestId(`machine-${m.id}`));

    fireEvent.click(await screen.findByRole('button', { name: 'Open menu' }));
    const drawer = await screen.findByRole('navigation', { name: 'Chats and workspaces' });
    expect(within(drawer).getByText('Kept chat')).toBeTruthy();
    expect(within(drawer).getByText('proj')).toBeTruthy();
    expect(FakeSocket.all).toHaveLength(1); // same connection, no reconnect
  });
  it("opens the desktop's focused workspace and chat, and follows it only when it moves", async () => {
    const m = await addMachine({ label: 'desk', baseUrl: 'http://desk:17830', deviceId: 'd1', token: 'tok' }, getNative());
    localStorage.setItem('sai.activeMachine.v1', m.id);
    render(<PhoneApp />);
    await waitFor(() => expect(FakeSocket.all.length).toBe(1));
    act(() => { last().open(); last().authOk(); });
    await waitFor(() => expect(sentOf('workspaces.subscribe').length).toBeGreaterThan(0));
    const list = (active: string, chatId: string) => ({ type: 'workspaces.changed', workspaces: [
      { projectPath: '/a', name: 'alpha', kind: 'project', state: active === '/a' ? 'active' : 'open', ...(active === '/a' ? { activeChatId: chatId } : {}) },
      { projectPath: '/b', name: 'beta', kind: 'project', state: active === '/b' ? 'active' : 'open', ...(active === '/b' ? { activeChatId: chatId } : {}) },
    ] });
    act(() => { last().recv(list('/b', 'desk-chat')); });
    await waitFor(() => expect(screen.getByTestId('chat-host').getAttribute('data-chat-id')).toBe('desk-chat'));

    // The phone moves elsewhere: an unchanged desktop focus doesn't pull it back.
    fireEvent.click(screen.getByRole('button', { name: 'New chat' }));
    const phoneChat = screen.getByTestId('chat-host').getAttribute('data-chat-id');
    expect(phoneChat).not.toBe('desk-chat');
    act(() => { last().recv(list('/b', 'desk-chat')); });
    expect(screen.getByTestId('chat-host').getAttribute('data-chat-id')).toBe(phoneChat);

    // The drawer offers the desktop's chat back.
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    fireEvent.click(await screen.findByTestId('desktop-focus'));
    expect(screen.getByTestId('chat-host').getAttribute('data-chat-id')).toBe('desk-chat');

    // The desktop switches chats: the phone follows.
    act(() => { last().recv(list('/a', 'other-chat')); });
    await waitFor(() => expect(screen.getByTestId('chat-host').getAttribute('data-chat-id')).toBe('other-chat'));
  });

  it('lists the workspace chats first and keeps each workspace on its last chat', async () => {
    const m = await addMachine({ label: 'desk', baseUrl: 'http://desk:17830', deviceId: 'd1', token: 'tok' }, getNative());
    localStorage.setItem('sai.activeMachine.v1', m.id);
    render(<PhoneApp />);
    await waitFor(() => expect(FakeSocket.all.length).toBe(1));
    act(() => { last().open(); last().authOk(); });
    await waitFor(() => expect(sentOf('workspaces.subscribe').length).toBeGreaterThan(0));
    act(() => {
      last().recv({ type: 'workspaces.list.result', workspaces: [
        { projectPath: '/a', name: 'alpha', kind: 'project', state: 'active' },
        { projectPath: '/b', name: 'beta', kind: 'project', state: 'open' },
      ] });
    });
    const chat = (chatId: string, projectPath: string, title: string) =>
      ({ chatId, projectPath, title, createdAt: 1, updatedAt: 2, headSeq: 3, snapshotSeq: 0, provider: 'claude', openTurn: false });
    const answer = async (projectPath: string, chats: unknown[]) => {
      await waitFor(() => expect(sentOf('chats.subscribe').some((f) => f.projectPath === projectPath)).toBe(true));
      const sub = sentOf('chats.subscribe').filter((f) => f.projectPath === projectPath).at(-1)!;
      act(() => { last().recv({ type: 'chats.list.result', reqId: sub.reqId, chats }); });
    };
    await answer('/a', [chat('a1', '/a', 'Alpha chat')]);

    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    const drawer = await screen.findByRole('navigation', { name: 'Chats and workspaces' });
    // The chat list leads the drawer, above the workspace picker.
    const sections = within(drawer).getAllByRole('heading').map((h) => h.textContent);
    expect(sections[0]).toBe('Chats · alpha');
    fireEvent.click(within(drawer).getByText('Alpha chat'));
    await waitFor(() => expect(screen.getByTestId('header-title').textContent).toBe('alpha · Alpha chat'));

    // Switch to beta: the drawer stays open on beta's chats.
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    fireEvent.click(within(await screen.findByRole('navigation', { name: 'Chats and workspaces' })).getByText('beta'));
    await answer('/b', [chat('b1', '/b', 'Beta chat')]);
    expect(await screen.findByText('Beta chat')).toBeTruthy();
    expect(screen.getByTestId('header-title').textContent).toBe('beta');

    // Back to alpha: its chat is open again.
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Chats and workspaces' })).getByText('alpha'));
    await answer('/a', [chat('a1', '/a', 'Alpha chat')]);
    await waitFor(() => expect(screen.getByTestId('header-title').textContent).toBe('alpha · Alpha chat'));
  });
});
