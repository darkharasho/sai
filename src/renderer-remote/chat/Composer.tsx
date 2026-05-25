import { useState, useRef } from 'react';

interface Props {
  streaming: boolean;
  onSend: (text: string) => void;
  onInterrupt: () => void;
}

export default function Composer({ streaming, onSend, onInterrupt }: Props) {
  const [text, setText] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);

  const submit = () => {
    const t = text.trim();
    if (!t) return;
    onSend(t);
    setText('');
    ref.current?.focus();
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
  };

  const buttonBase: React.CSSProperties = {
    flexShrink: 0,
    padding: '10px 16px',
    fontSize: 14,
    fontWeight: 500,
    borderRadius: 8,
    border: '1px solid transparent',
    cursor: 'pointer',
    transition: 'background-color var(--dur-fast) var(--ease-out-soft), border-color var(--dur-fast)',
  };

  return (
    <div
      style={{
        display: 'flex',
        gap: 8,
        alignItems: 'flex-end',
        padding: 10,
        borderTop: '1px solid var(--border)',
        background: 'var(--bg-secondary)',
        minWidth: 0,
      }}
    >
      <textarea
        ref={ref}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKey}
        placeholder={streaming ? 'Responding…' : 'Message'}
        rows={1}
        style={{
          flex: 1,
          minWidth: 0,
          resize: 'none',
          fontFamily: 'inherit',
          fontSize: 16, // prevents iOS auto-zoom
          lineHeight: 1.4,
          padding: '10px 12px',
          background: 'var(--bg-input)',
          color: 'var(--text)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          outline: 'none',
        }}
        onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--accent)'; }}
        onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; }}
      />
      {streaming ? (
        <button
          onClick={onInterrupt}
          style={{
            ...buttonBase,
            background: 'var(--bg-elevated)',
            color: 'var(--red)',
            borderColor: 'var(--border)',
          }}
        >
          Stop
        </button>
      ) : (
        <button
          onClick={submit}
          disabled={!text.trim()}
          style={{
            ...buttonBase,
            background: text.trim() ? 'var(--accent)' : 'var(--bg-elevated)',
            color: text.trim() ? '#000' : 'var(--text-muted)',
            opacity: text.trim() ? 1 : 0.7,
          }}
        >
          Send
        </button>
      )}
    </div>
  );
}
