// Quick switcher: tap the chat title to jump to another chat without going
// home. Workspace chips on top, the picked workspace's chats below.
import React, { useState } from 'react';
import { Plus } from 'lucide-react';
import type { ChatMeta } from '../../../src/lib/chat/types';
import type { RemoteWorkspace } from '../../../electron/services/remote/renderer-proxy';
import { ChatRow, newestFirst, type OpenChat } from './chatRows';
import { homeOrder } from './Home';

export interface SwitcherProps {
  workspaces: RemoteWorkspace[];
  chatsByWs: Record<string, ChatMeta[] | null>;
  /** The workspace the open chat belongs to (the sheet starts on it). */
  activeProjectPath: string | null;
  open: OpenChat;
  onPick(projectPath: string, chatId: string): void;
  onNewChat(projectPath: string): void;
  onClose(): void;
}

export function Switcher(p: SwitcherProps) {
  const ordered = homeOrder(p.workspaces);
  const [picked, setPicked] = useState<string | null>(p.activeProjectPath ?? ordered[0]?.projectPath ?? null);
  const ws = ordered.find((w) => w.projectPath === picked) ?? ordered[0] ?? null;
  const raw = ws ? p.chatsByWs[ws.projectPath] ?? null : null;
  const chats = raw ? newestFirst(raw) : null;
  return (
    <div className="sai-phone-sheet-layer">
      <div className="sai-phone-backdrop" onClick={p.onClose} aria-hidden="true" />
      <div className="sai-phone-sheet" role="dialog" aria-label="Switch chat">
        <div className="sai-phone-sheet-grip" aria-hidden="true" />
        <div className="sai-phone-chips" role="group" aria-label="Workspaces">
          {ordered.map((w) => (
            <button
              key={w.projectPath}
              type="button"
              className="sai-phone-ws-chip"
              aria-pressed={w.projectPath === ws?.projectPath}
              onClick={() => setPicked(w.projectPath)}
            >
              {w.name}
            </button>
          ))}
        </div>
        <div className="sai-phone-sheet-list">
          {ws && (
            <button type="button" className="sai-phone-newchat" onClick={() => p.onNewChat(ws.projectPath)}>
              <Plus size={17} aria-hidden="true" />New chat
            </button>
          )}
          {!ws && <div className="sai-phone-empty">No open workspaces</div>}
          {ws && chats === null && <div className="sai-phone-empty">Loading chats…</div>}
          {chats?.length === 0 && <div className="sai-phone-empty">No chats in this workspace yet</div>}
          {ws && chats?.map((c) => <ChatRow key={c.chatId} chat={c} open={p.open} onPick={(id) => p.onPick(ws.projectPath, id)} />)}
        </div>
      </div>
    </div>
  );
}
