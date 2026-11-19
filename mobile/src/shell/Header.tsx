import React, { useEffect, useRef, useState } from 'react';
import { Menu, MonitorSmartphone, MoreHorizontal, SquarePen } from 'lucide-react';
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
  /** Absent until a workspace is picked. */
  onNewChat?: () => void;
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

  return (
    <header className="sai-phone-header">
      <button type="button" className="sai-phone-icon-btn" aria-label="Open menu" onClick={onMenu}><Menu size={22} /></button>
      <div className="sai-phone-title" data-testid="header-title">
        {workspaceName && chatTitle ? (
          <>
            <span className="sai-phone-title-ws">{workspaceName}</span>
            <span className="sai-phone-title-sep"> · </span>
            <span>{chatTitle}</span>
          </>
        ) : (workspaceName || chatTitle || 'SAI')}
      </div>
      {status && (
        <span
          className={`sai-phone-dot sai-phone-dot-${status}`}
          data-testid="status-dot"
          data-status={status}
          role="img"
          aria-label={STATUS_LABEL[status]}
        />
      )}
      {onNewChat && (
        <button type="button" className="sai-phone-icon-btn" aria-label="New chat" onClick={onNewChat}><SquarePen size={20} /></button>
      )}
      <div className="sai-phone-menu-wrap" ref={menuRef}>
        <button type="button" className="sai-phone-icon-btn" aria-label="More" aria-expanded={menuOpen} onClick={() => setMenuOpen((o) => !o)}><MoreHorizontal size={22} /></button>
        {menuOpen && (
          <div role="menu" className="sai-phone-menu">
            <button role="menuitem" type="button" onClick={() => { setMenuOpen(false); onMachines(); }}><MonitorSmartphone size={17} aria-hidden="true" />Machines</button>
          </div>
        )}
      </div>
    </header>
  );
}
