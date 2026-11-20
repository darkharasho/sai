// The phone's home: every open workspace with its chats, the desktop's current
// chat pinned on top. Opening a chat leaves home; back (or an edge swipe)
// returns.
import React, { useState } from 'react';
import { ChevronDown, MonitorSmartphone, MonitorUp, Plus } from 'lucide-react';
import SaiLogo from '../../../src/components/SaiLogo';
import type { ChatMeta } from '../../../src/lib/chat/types';
import type { RemoteWorkspace } from '../../../electron/services/remote/renderer-proxy';
import type { ChatStatus } from './Header';
import { ChatRow, newestFirst, type OpenChat } from './chatRows';

/** Rows a workspace shows before "Show N more". */
export const HOME_ROWS = 4;

export interface DesktopNow {
  projectPath: string;
  chatId: string;
  workspaceName: string | null;
  title: string;
  status: ChatStatus;
}

export interface HomeProps {
  machineLabel: string;
  workspaces: RemoteWorkspace[];
  /** projectPath → its chats; null (or absent) while loading. */
  chatsByWs: Record<string, ChatMeta[] | null>;
  desktop: DesktopNow | null;
  open: OpenChat;
  onOpenChat(projectPath: string, chatId: string): void;
  onNewChat(projectPath: string): void;
  onMachines(): void;
  /** Set while an edge swipe drags a chat over home (it sits underneath). */
  underneath?: boolean;
}

/** The desktop's workspace first, then the rest in the desktop's order. */
export function homeOrder(workspaces: RemoteWorkspace[]): RemoteWorkspace[] {
  return [...workspaces].sort((a, b) => Number(b.state === 'active') - Number(a.state === 'active'));
}

export function Home(p: HomeProps) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  return (
    <div className={`sai-phone-home${p.underneath ? ' is-underneath' : ''}`} aria-hidden={p.underneath ? 'true' : undefined}>
      <header className="sai-phone-header">
        <span className="sai-phone-home-logo" aria-hidden="true"><SaiLogo mode="static" size={22} /></span>
        <button type="button" className="sai-phone-title sai-phone-title-btn" data-testid="home-title" onClick={p.onMachines}>
          {p.machineLabel}
          <ChevronDown size={16} className="sai-phone-title-caret" aria-hidden="true" />
        </button>
        <button type="button" className="sai-phone-icon-btn" aria-label="Machines" onClick={p.onMachines}><MonitorSmartphone size={21} /></button>
      </header>
      <nav className="sai-phone-home-list" aria-label="Workspaces and chats">
        {p.desktop && (
          <button
            type="button"
            className="sai-phone-desk-card"
            data-testid="desktop-focus"
            onClick={() => p.onOpenChat(p.desktop!.projectPath, p.desktop!.chatId)}
          >
            <span className="sai-phone-desk-label"><MonitorUp size={14} aria-hidden="true" />On your desktop now</span>
            <span className="sai-phone-desk-main">
              <span className={`sai-phone-dot sai-phone-dot-${p.desktop.status}`} data-status={p.desktop.status} aria-hidden="true" />
              <span className="sai-phone-row-main">{p.desktop.title}</span>
            </span>
            {p.desktop.workspaceName && <span className="sai-phone-desk-ws">{p.desktop.workspaceName}</span>}
          </button>
        )}
        {p.workspaces.length === 0 && <div className="sai-phone-empty">No open workspaces on {p.machineLabel}</div>}
        {homeOrder(p.workspaces).map((w) => {
          const raw = p.chatsByWs[w.projectPath] ?? null;
          const chats = raw ? newestFirst(raw) : null;
          const all = !!expanded[w.projectPath];
          const shown = chats && !all ? chats.slice(0, HOME_ROWS) : chats;
          return (
            <section key={w.projectPath} className="sai-phone-home-ws" data-testid="home-workspace" data-project={w.projectPath}>
              <div className="sai-phone-home-ws-head">
                <h2 className="sai-phone-drawer-h">{w.name}</h2>
                {w.state === 'active' && <span className="sai-phone-home-badge">desktop</span>}
                <button type="button" className="sai-phone-icon-btn sai-phone-home-new" aria-label={`New chat in ${w.name}`} onClick={() => p.onNewChat(w.projectPath)}>
                  <Plus size={19} />
                </button>
              </div>
              {chats === null && <div className="sai-phone-empty">Loading chats…</div>}
              {chats?.length === 0 && <div className="sai-phone-empty">No chats yet</div>}
              {shown?.map((c) => <ChatRow key={c.chatId} chat={c} open={p.open} onPick={(id) => p.onOpenChat(w.projectPath, id)} />)}
              {chats && chats.length > HOME_ROWS && (
                <button
                  type="button"
                  className="sai-phone-row sai-phone-row-muted"
                  onClick={() => setExpanded((e) => ({ ...e, [w.projectPath]: !all }))}
                >
                  {all ? 'Show fewer' : `Show ${chats.length - HOME_ROWS} more`}
                </button>
              )}
            </section>
          );
        })}
      </nav>
    </div>
  );
}
