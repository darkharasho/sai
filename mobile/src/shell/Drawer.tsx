import React from 'react';
import type { ChatMeta } from '../../../src/lib/chat/types';
import type { RemoteWorkspace } from '../../../electron/services/remote/renderer-proxy';
import type { Machine } from '../machines/store';
import { chatStatus, type ChatStatus } from './Header';

export interface DrawerProps {
  open: boolean;
  onClose(): void;
  machines: Machine[];
  activeMachineId: string | null;
  onPickMachine(m: Machine): void;
  onManageMachines(): void;
  workspaces: RemoteWorkspace[];
  activeProjectPath: string | null;
  onPickWorkspace(projectPath: string): void;
  /** The active workspace's chats (any order; shown newest first); null while the list loads. */
  chats: ChatMeta[] | null;
  activeChatId: string | null;
  /** The open chat's live status and title (override its list row). */
  activeStatus: ChatStatus | null;
  activeTitle: string | null;
  onPickChat(chatId: string): void;
  onNewChat(): void;
}

export function chatTitleOf(meta: Pick<ChatMeta, 'title'> | null | undefined): string {
  return meta?.title?.trim() || 'Untitled chat';
}

function relTime(ms: number): string {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

export function Drawer(p: DrawerProps) {
  if (!p.open) return null;
  const chats = p.chats ? [...p.chats].sort((a, b) => b.updatedAt - a.updatedAt) : null;
  const workspaceName = p.workspaces.find((w) => w.projectPath === p.activeProjectPath)?.name ?? null;
  return (
    <div className="sai-phone-drawer-layer">
      <div className="sai-phone-backdrop" onClick={p.onClose} aria-hidden="true" />
      <nav className="sai-phone-drawer" aria-label="Chats and workspaces">
        {p.activeProjectPath && (
          <section>
            <h2 className="sai-phone-drawer-h">{workspaceName ? `Chats · ${workspaceName}` : 'Chats'}</h2>
            <button type="button" className="sai-phone-row sai-phone-row-accent" onClick={p.onNewChat}>+ New chat</button>
            {chats === null && <div className="sai-phone-empty">Loading chats…</div>}
            {chats?.length === 0 && <div className="sai-phone-empty">No chats in this workspace yet</div>}
            {chats?.map((c) => {
              const status = c.chatId === p.activeChatId && p.activeStatus ? p.activeStatus : chatStatus(null, c);
              return (
                <button
                  key={c.chatId}
                  type="button"
                  className="sai-phone-row"
                  data-testid="chat-row"
                  data-chat-id={c.chatId}
                  aria-current={c.chatId === p.activeChatId ? 'true' : undefined}
                  onClick={() => p.onPickChat(c.chatId)}
                >
                  <span className={`sai-phone-dot sai-phone-dot-${status}`} data-status={status} aria-hidden="true" />
                  <span className="sai-phone-row-main">{c.chatId === p.activeChatId && p.activeTitle ? p.activeTitle : chatTitleOf(c)}</span>
                  <span className="sai-phone-row-meta">{relTime(c.updatedAt)}</span>
                </button>
              );
            })}
          </section>
        )}
        <section>
          <h2 className="sai-phone-drawer-h">Workspaces</h2>
          {p.workspaces.length === 0 && <div className="sai-phone-empty">No open workspaces</div>}
          {p.workspaces.map((w) => (
            <button
              key={w.projectPath}
              type="button"
              className="sai-phone-row"
              data-testid="workspace-row"
              aria-current={w.projectPath === p.activeProjectPath ? 'true' : undefined}
              onClick={() => p.onPickWorkspace(w.projectPath)}
            >
              <span className="sai-phone-row-main">{w.name}</span>
            </button>
          ))}
        </section>

        <section>
          <h2 className="sai-phone-drawer-h">Machines</h2>
          {p.machines.map((m) => (
            <button
              key={m.id}
              type="button"
              className="sai-phone-row"
              data-testid="machine-row"
              aria-current={m.id === p.activeMachineId ? 'true' : undefined}
              onClick={() => p.onPickMachine(m)}
            >
              <span className="sai-phone-row-main">{m.label}</span>
            </button>
          ))}
          <button type="button" className="sai-phone-row sai-phone-row-muted" onClick={p.onManageMachines}>Manage machines…</button>
        </section>

      </nav>
    </div>
  );
}
