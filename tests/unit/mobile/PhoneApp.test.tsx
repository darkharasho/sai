// The phone shell's routing around the active machine.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { FakeSocket } from './fakeSocket';
import { addMachine } from '../../../mobile/src/machines/store';
import { getNative } from '../../../mobile/src/native';
import { disconnect } from '../../../mobile/src/shell/connection';
import { PhoneApp } from '../../../mobile/src/shell/App';

vi.mock('@capacitor/app', () => ({ App: { addListener: vi.fn(async () => ({ remove: async () => {} })) } }));

const last = () => FakeSocket.all[FakeSocket.all.length - 1];
const sentOf = (type: string) => last().sent.filter((f) => f.type === type);

beforeEach(() => {
  FakeSocket.all = [];
  vi.stubGlobal('WebSocket', FakeSocket);
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  document.documentElement.dataset.saiPhone = '1';
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
});
