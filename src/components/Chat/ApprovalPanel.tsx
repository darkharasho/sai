import { useState, useEffect, useRef, KeyboardEvent } from 'react';
import { ShieldAlert, Check, X, ShieldCheck } from 'lucide-react';
import type { PendingApproval } from '../../types';

interface ApprovalPanelProps {
  approval: PendingApproval;
  onApprove: (modifiedCommand?: string) => void;
  onDeny: () => void;
  onAlwaysAllow: () => void;
}

export default function ApprovalPanel({ approval, onApprove, onDeny, onAlwaysAllow }: ApprovalPanelProps) {
  const [command, setCommand] = useState(approval.command);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isBash = approval.toolName === 'Bash';

  useEffect(() => {
    setCommand(approval.command);
  }, [approval.command]);

  useEffect(() => {
    if (isBash && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.selectionStart = textareaRef.current.value.length;
    }
  }, [approval.toolUseId, isBash]);

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const modified = command !== approval.command ? command : undefined;
      onApprove(modified);
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      onDeny();
    }
  };

  const toolLabel = isBash ? 'wants to run a command'
    : approval.toolName === 'Edit' ? 'wants to edit a file'
    : approval.toolName === 'Write' ? 'wants to write a file'
    : `wants to use ${approval.toolName}`;

  return (
    <div style={{
      background: 'var(--bg-elevated)',
      border: '1px solid var(--border)',
      borderRadius: 10,
      marginBottom: 8,
      overflow: 'hidden',
      boxShadow: '0 -4px 24px rgba(0,0,0,0.4)',
      animation: 'approvalSlideUp 0.2s ease-out',
    }} onKeyDown={!isBash ? handleKeyDown : undefined} tabIndex={!isBash ? 0 : undefined}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px 0' }}>
        <ShieldAlert size={16} style={{ color: 'var(--accent)' }} />
        <span style={{
          fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
          fontSize: 12, fontWeight: 600, color: 'var(--accent)',
        }}>{approval.toolName}</span>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{toolLabel}</span>
      </div>

      {isBash ? (
        <textarea
          ref={textareaRef}
          value={command}
          onChange={e => setCommand(e.target.value)}
          onKeyDown={handleKeyDown}
          spellCheck={false}
          rows={Math.min(command.split('\n').length, 6)}
          style={{
            margin: '8px 14px',
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            padding: '8px 12px',
            fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
            fontSize: 12,
            color: 'var(--text)',
            lineHeight: 1.5,
            outline: 'none',
            width: 'calc(100% - 28px)',
            resize: 'none',
            minHeight: 36,
          }}
        />
      ) : (
        <div style={{
          margin: '8px 14px',
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border)',
          borderRadius: 6,
          padding: '8px 12px',
          fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
          fontSize: 12,
          color: 'var(--text)',
          lineHeight: 1.5,
          maxHeight: 120,
          overflowY: 'auto',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
        }}>{approval.command}</div>
      )}

      {approval.description && (
        <div style={{ padding: '0 14px', fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>
          {approval.description}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px 10px' }}>
        <button
          onClick={() => {
            const modified = command !== approval.command ? command : undefined;
            onApprove(modified);
          }}
          style={{
            background: 'var(--accent)', color: '#000', border: 'none', borderRadius: 6,
            padding: '6px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 5,
          }}
        >
          <Check size={14} /> Approve
        </button>
        <button
          onClick={onDeny}
          style={{
            background: 'none', color: 'var(--text-secondary)',
            border: '1px solid var(--border)', borderRadius: 6,
            padding: '6px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 5,
          }}
        >
          <X size={14} /> Deny
        </button>
        <button
          onClick={onAlwaysAllow}
          style={{
            background: 'none', color: 'var(--text-secondary)',
            border: '1px solid var(--border)', borderRadius: 6,
            padding: '6px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 5,
          }}
        >
          <ShieldCheck size={14} /> Always Allow
        </button>
        <span style={{
          fontSize: 11, color: 'var(--text-muted)', marginLeft: 'auto',
          display: 'flex', alignItems: 'center', gap: 6,
        }}>
          <kbd style={{
            background: 'var(--bg-hover)', border: '1px solid var(--border)', borderRadius: 3,
            padding: '1px 5px', fontFamily: "'JetBrains Mono', monospace", fontSize: 10,
            color: 'var(--text-secondary)',
          }}>Enter</kbd> approve
          <span>·</span>
          <kbd style={{
            background: 'var(--bg-hover)', border: '1px solid var(--border)', borderRadius: 3,
            padding: '1px 5px', fontFamily: "'JetBrains Mono', monospace", fontSize: 10,
            color: 'var(--text-secondary)',
          }}>Esc</kbd> deny
        </span>
      </div>

      <style>{`
        @keyframes approvalSlideUp {
          from { transform: translateY(20px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
