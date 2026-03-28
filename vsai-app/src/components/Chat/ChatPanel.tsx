import { useState } from 'react';

interface ChatPanelProps {
  projectPath: string;
}

export default function ChatPanel({ projectPath }: ChatPanelProps) {
  const [input, setInput] = useState('');

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
        }}
      >
        <h1
          style={{
            fontSize: 28,
            fontWeight: 600,
            color: 'var(--text)',
          }}
        >
          VSAI
        </h1>
        <p
          style={{
            color: 'var(--accent)',
            fontSize: 14,
          }}
        >
          Describe what to build
        </p>
      </div>
      <div
        style={{
          padding: '12px 16px',
          borderTop: '1px solid var(--border)',
        }}
      >
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="Ask VSAI..."
          rows={3}
          style={{
            width: '100%',
            background: 'var(--bg-input)',
            color: 'var(--text)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            padding: '10px 12px',
            fontSize: 13,
            fontFamily: 'inherit',
            resize: 'none',
            outline: 'none',
          }}
          onFocus={e => {
            e.currentTarget.style.borderColor = 'var(--accent)';
          }}
          onBlur={e => {
            e.currentTarget.style.borderColor = 'var(--border)';
          }}
        />
      </div>
    </div>
  );
}
