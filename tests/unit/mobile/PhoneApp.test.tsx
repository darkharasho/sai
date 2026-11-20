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

    // Home lists the workspace and its chats.
    const home = () => screen.getByRole('navigation', { name: 'Workspaces and chats' });
    await waitFor(() => expect(within(home()).getByText('Kept chat')).toBeTruthy());

    // Machines → pick the machine that is already connected.
    fireEvent.click(screen.getByRole('button', { name: 'Machines' }));
    fireEvent.click(await screen.findByTestId(`machine-${m.id}`));

    await waitFor(() => expect(within(home()).getByText('Kept chat')).toBeTruthy());
    expect(within(home()).getByText('proj')).toBeTruthy();
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

    // Home offers the desktop's chat back, pinned on top.
    fireEvent.click(screen.getByRole('button', { name: 'Back to chats' }));
    expect(screen.queryByTestId('chat-host')).toBeNull();
    fireEvent.click(await screen.findByTestId('desktop-focus'));
    expect(screen.getByTestId('chat-host').getAttribute('data-chat-id')).toBe('desk-chat');

    // The desktop switches chats: the phone follows.
    act(() => { last().recv(list('/a', 'other-chat')); });
    await waitFor(() => expect(screen.getByTestId('chat-host').getAttribute('data-chat-id')).toBe('other-chat'));
  });

  it('home lists every workspace with its chats; the title switcher jumps between them', async () => {
    const m = await addMachine({ label: 'desk', baseUrl: 'http://desk:17830', deviceId: 'd1', token: 'tok' }, getNative());
    localStorage.setItem('sai.activeMachine.v1', m.id);
    render(<PhoneApp />);
    await waitFor(() => expect(FakeSocket.all.length).toBe(1));
    act(() => { last().open(); last().authOk(); });
    await waitFor(() => expect(sentOf('workspaces.subscribe').length).toBeGreaterThan(0));
    const wsList = (paths: string[]) => ({ type: 'workspaces.changed', workspaces: [
      { projectPath: '/a', name: 'alpha', kind: 'project', state: 'open' },
      { projectPath: '/b', name: 'beta', kind: 'project', state: 'active' },
    ].filter((w) => paths.includes(w.projectPath)) });
    act(() => { last().recv(wsList(['/a', '/b'])); });
    const chat = (chatId: string, projectPath: string, title: string, updatedAt = 2) =>
      ({ chatId, projectPath, title, createdAt: 1, updatedAt, headSeq: 3, snapshotSeq: 0, provider: 'claude', openTurn: false });
    const answer = async (projectPath: string, chats: unknown[]) => {
      await waitFor(() => expect(sentOf('chats.subscribe').some((f) => f.projectPath === projectPath)).toBe(true));
      const sub = sentOf('chats.subscribe').filter((f) => f.projectPath === projectPath).at(-1)!;
      act(() => { last().recv({ type: 'chats.list.result', reqId: sub.reqId, chats }); });
    };
    // Both workspaces subscribe at once.
    await answer('/a', [chat('a1', '/a', 'Alpha chat'), ...[1, 2, 3, 4, 5].map((i) => chat(`a-old${i}`, '/a', `Old ${i}`, 1))]);
    await answer('/b', [chat('b1', '/b', 'Beta chat')]);

    // The desktop's workspace leads home; long lists fold after four rows.
    const home = screen.getByRole('navigation', { name: 'Workspaces and chats' });
    const sections = within(home).getAllByTestId('home-workspace');
    expect(sections.map((x) => x.getAttribute('data-project'))).toEqual(['/b', '/a']);
    expect(within(sections[1]).getAllByTestId('chat-row')).toHaveLength(4);
    fireEvent.click(within(sections[1]).getByRole('button', { name: 'Show 2 more' }));
    expect(within(sections[1]).getAllByTestId('chat-row')).toHaveLength(6);

    fireEvent.click(within(home).getByText('Alpha chat'));
    await waitFor(() => expect(screen.getByTestId('header-title').textContent).toBe('alpha · Alpha chat'));

    // Tap the title: the switcher starts on alpha; pick beta's chat.
    fireEvent.click(screen.getByTestId('header-title'));
    const sheet = screen.getByRole('dialog', { name: 'Switch chat' });
    expect(within(sheet).getByRole('button', { name: 'alpha' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(within(sheet).getByRole('button', { name: 'beta' }));
    fireEvent.click(within(sheet).getByText('Beta chat'));
    expect(screen.queryByRole('dialog', { name: 'Switch chat' })).toBeNull();
    expect(screen.getByTestId('chat-host').getAttribute('data-chat-id')).toBe('b1');

    // New chat from the switcher opens a fresh chat in the picked workspace.
    fireEvent.click(screen.getByTestId('header-title'));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Switch chat' })).getByRole('button', { name: 'New chat' }));
    expect(screen.getByTestId('header-title').textContent).toBe('beta · New chat');

    // Beta closes on the desktop while it's open: back to home.
    act(() => { last().recv(wsList(['/a'])); });
    await waitFor(() => expect(screen.queryByTestId('chat-host')).toBeNull());
    expect(screen.getByRole('navigation', { name: 'Workspaces and chats' })).toBeTruthy();
  });
});
