import React from 'react';
import type { ApprovalChatMeta } from '../../../types';
import { cardBase, ghostBtn, dangerBtn, primaryBtn, monoBox, relativeTime, SWARM_RED, SWARM_GREEN } from './cardStyles';

interface Props {
  meta: ApprovalChatMeta;
  onApprove?: (id: string) => void;
  onDeny?: (id: string) => void;
  onView?: (id: string) => void;
}

function truncate(s: string, max = 100): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}

export default function InlineApprovalCard({ meta, onApprove, onDeny, onView }: Props) {
  if (meta.resolved) {
    const ok = meta.resolved === 'approved';
    return (
      <div
        data-testid="swarm-inline-approval-card"
        data-task-id={meta.taskId}
        data-resolved={meta.resolved}
        style={{
          ...cardBase,
          padding: '6px 10px',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          fontSize: 12,
          opacity: 0.85,
          borderColor: ok ? SWARM_GREEN : SWARM_RED,
        }}
      >
        <span style={{ color: ok ? SWARM_GREEN : SWARM_RED, fontWeight: 600 }}>
          {ok ? '✓ Approved' : '✗ Denied'}
        </span>
        <span style={{ opacity: 0.75 }}>
          · {meta.toolName} on "{meta.taskTitle}"
        </span>
      </div>
    );
  }

  const command = meta.command ? `${meta.toolName}: ${truncate(meta.command)}` : meta.toolName;

  return (
    <div
      data-testid="swarm-inline-approval-card"
      data-task-id={meta.taskId}
      data-resolved="pending"
      style={{
        ...cardBase,
        borderColor: SWARM_RED,
        background: 'color-mix(in srgb, #b44 8%, var(--bg-elevated))',
      }}
    >
      <div style={{ color: '#e88', fontWeight: 600, marginBottom: 6, fontSize: 11, letterSpacing: 0.4, textTransform: 'uppercase' }}>
        ⚠ Approval needed
      </div>
      <div style={{ marginBottom: 6 }}>
        Task "<b>{meta.taskTitle}</b>" wants to run
      </div>
      <div style={{ ...monoBox, marginBottom: 6 }}>
        {command}
      </div>
      <div style={{ fontSize: 11, opacity: 0.7, marginBottom: 8 }}>
        {relativeTime(meta.createdAt)}
        {meta.branch ? <> · <code style={{ fontFamily: "'Geist Mono', monospace" }}>{meta.branch}</code></> : null}
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
        <button type="button" style={ghostBtn} onClick={() => onView?.(meta.approvalId)}>View</button>
        <button type="button" style={dangerBtn} onClick={() => onDeny?.(meta.approvalId)}>Deny</button>
        <button type="button" style={primaryBtn} onClick={() => onApprove?.(meta.approvalId)}>Approve</button>
      </div>
    </div>
  );
}
