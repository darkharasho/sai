import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Switcher } from '../../../mobile/src/shell/Switcher';
import { workspaceStatus, type OpenChat } from '../../../mobile/src/shell/chatRows';
import type { ChatMeta } from '../../../src/lib/chat/types';

const meta = (chatId: string, openTurn = false): ChatMeta => ({ chatId, title: chatId, updatedAt: 1, openTurn } as unknown as ChatMeta);
const closed: OpenChat = { chatId: null, status: null, title: null };

describe('workspaceStatus', () => {
  it('is null while the chats are loading or there are none', () => {
    expect(workspaceStatus(null, closed)).toBeNull();
    expect(workspaceStatus([], closed)).toBeNull();
  });
  it('is done when every chat is idle', () => {
    expect(workspaceStatus([meta('a'), meta('b')], closed)).toBe('done');
  });
  it('is streaming when any chat has an open turn', () => {
    expect(workspaceStatus([meta('a'), meta('b', true)], closed)).toBe('streaming');
  });
  it("uses the open chat's live status, and needs-you outranks working", () => {
    const open: OpenChat = { chatId: 'a', status: 'approval', title: null };
    expect(workspaceStatus([meta('a'), meta('b', true)], open)).toBe('approval');
    expect(workspaceStatus([meta('a', true)], { chatId: 'a', status: 'waiting', title: null })).toBe('waiting');
  });
});

describe('Switcher workspace chips', () => {
  it('show a status dot per workspace with loaded chats', () => {
    render(
      <Switcher
        workspaces={[
          { projectPath: '/w/one', name: 'one', state: 'active' },
          { projectPath: '/w/two', name: 'two', state: 'recent' },
          { projectPath: '/w/three', name: 'three', state: 'recent' },
        ] as any}
        chatsByWs={{ '/w/one': [meta('a')], '/w/two': [meta('b', true)], '/w/three': null }}
        activeProjectPath="/w/one"
        open={closed}
        onPick={() => {}}
        onNewChat={() => {}}
        onClose={() => {}}
      />,
    );
    const dotOf = (name: string) => screen.getByRole('button', { name }).querySelector('.sai-phone-dot');
    expect(dotOf('one')?.getAttribute('data-status')).toBe('done');
    expect(dotOf('two')?.getAttribute('data-status')).toBe('streaming');
    expect(dotOf('three')).toBeNull();
  });
});
