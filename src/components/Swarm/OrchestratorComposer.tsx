import React, { useState } from 'react';

interface Props {
  onCommand: (cmd: { text: string; splitLines: boolean }) => void;
  disabled?: boolean;
}

export default function OrchestratorComposer({ onCommand, disabled }: Props) {
  const [text, setText] = useState('');
  const [splitLines, setSplitLines] = useState(false);

  function send() {
    const t = text.trim();
    if (!t) return;
    onCommand({ text, splitLines });
    setText('');
  }

  return (
    <div className="orch-composer" style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 8, borderTop: '1px solid var(--border)' }}>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); send(); }
        }}
        placeholder="Ask the orchestrator…"
        rows={3}
        disabled={disabled}
        style={{ resize: 'vertical', fontFamily: 'inherit' }}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
          <input type="checkbox" checked={splitLines} onChange={(e) => setSplitLines(e.target.checked)} aria-label="split lines" />
          split lines
        </label>
        <div style={{ flex: 1 }} />
        <button type="button" onClick={send} disabled={disabled || !text.trim()}>Send</button>
      </div>
    </div>
  );
}
