// Chat list rows shared by the home screen and the quick switcher.
import React from 'react';
import type { ChatMeta } from '../../../src/lib/chat/types';
import { chatStatus, type ChatStatus } from './Header';

export function chatTitleOf(meta: Pick<ChatMeta, 'title'> | null | undefined): string {
  return meta?.title?.trim() || 'Untitled chat';
}

export function relTime(ms: number): string {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

export function newestFirst(chats: ChatMeta[]): ChatMeta[] {
  return [...chats].sort((a, b) => b.updatedAt - a.updatedAt);
}

/** The phone's open chat: its live status and title override its list row. */
export interface OpenChat { chatId: string | null; status: ChatStatus | null; title: string | null }

export function ChatRow({ chat, open, onPick }: { chat: ChatMeta; open: OpenChat; onPick(chatId: string): void }) {
  const isOpen = chat.chatId === open.chatId;
  const status = isOpen && open.status ? open.status : chatStatus(null, chat);
  return (
    <button
      type="button"
      className="sai-phone-row"
      data-testid="chat-row"
      data-chat-id={chat.chatId}
      aria-current={isOpen ? 'true' : undefined}
      onClick={() => onPick(chat.chatId)}
    >
      <span className={`sai-phone-dot sai-phone-dot-${status}`} data-status={status} aria-hidden="true" />
      <span className="sai-phone-row-main">{isOpen && open.title ? open.title : chatTitleOf(chat)}</span>
      <span className="sai-phone-row-meta">{relTime(chat.updatedAt)}</span>
    </button>
  );
}
