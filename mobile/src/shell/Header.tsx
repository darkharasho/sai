import React, { useEffect, useRef, useState } from 'react';
import type { ChatMeta, ChatState } from '../../../src/lib/chat/types';

export type ChatStatus = 'streaming' | 'waiting' | 'approval' | 'done';

/** The status dot for a chat: its live state when open, else its list row. */
export function chatStatus(state: ChatState | null, meta?: Pick<ChatMeta, 'openTurn'> | null): ChatStatus {
  if (state) {
    if (state.pendingApproval || state.pendingSudo || state.pendingCodexUserInput || state.pendingCodexMcpElicitation || state.awaitingQuestion) return 'approval';
    if (state.turn.streaming) return 'streaming';
    if (state.waiting || state.followUp?.state === 'following') return 'waiting';
    return 'done';
  }
  return meta?.openTurn ? 'streaming' : 'done';
}

const STATUS_LABEL: Record<ChatStatus, string> = {
  streaming: 'Working', waiting: 'Waiting', approval: 'Needs you', done: 'Idle',
};

export interface HeaderProps {
  workspaceName: string | null;
  chatTitle: string | null;
  status: ChatStatus | null;
  onMenu(): void;
  onNewChat(): void;
  onMachines(): void;
}

export function Header({ workspaceName, chatTitle, status, onMenu, onNewChat, onMachines }: HeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: PointerEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false); };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [menuOpen]);

  const title = [workspaceName, chatTitle].filter(Boolean).join(' · ') || 'SAI';
  return (
    <header className="sai-phone-header">
      <button type="button" className="sai-phone-icon-btn" aria-label="Open menu" onClick={onMenu}>☰</button>
      <div className="sai-phone-title" data-testid="header-title">{title}</div>
      {status && (
        <span
          className={`sai-phone-dot sai-phone-dot-${status}`}
          data-testid="status-dot"
          data-status={status}
          role="img"
          aria-label={STATUS_LABEL[status]}
        />
      )}
      <div className="sai-phone-menu-wrap" ref={menuRef}>
        <button type="button" className="sai-phone-icon-btn" aria-label="More" aria-expanded={menuOpen} onClick={() => setMenuOpen((o) => !o)}>⋯</button>
        {menuOpen && (
          <div role="menu" className="sai-phone-menu">
            <button role="menuitem" type="button" onClick={() => { setMenuOpen(false); onNewChat(); }}>New chat</button>
            <button role="menuitem" type="button" onClick={() => { setMenuOpen(false); onMachines(); }}>Machines</button>
          </div>
        )}
      </div>
    </header>
  );
}
