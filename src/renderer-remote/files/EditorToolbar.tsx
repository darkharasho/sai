import type { CSSProperties } from 'react';
import { ArrowUp, ArrowDown, ArrowLeft, ArrowRight } from 'lucide-react';

const arrowBtn: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
};

interface Props {
  onTab: () => void;
  onUp: () => void;
  onDown: () => void;
  onLeft: () => void;
  onRight: () => void;
  onHome: () => void;
  onEnd: () => void;
}

const btnBase: CSSProperties = {
  minWidth: 40,
  height: 36,
  padding: '0 10px',
  background: 'var(--bg-elevated)',
  color: 'var(--text)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  fontFamily: '"Geist Mono", ui-monospace, monospace',
  fontSize: 13,
  cursor: 'pointer',
  flexShrink: 0,
};

export default function EditorToolbar({
  onTab, onUp, onDown, onLeft, onRight, onHome, onEnd,
}: Props) {
  // Prevent the tap from blurring the textarea — onMouseDown preventDefault
  // keeps focus + the iOS keyboard open while we mutate the cursor.
  const noBlur = (e: React.MouseEvent) => e.preventDefault();
  return (
    <div style={{
      flexShrink: 0,
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      padding: '6px 10px',
      background: 'var(--bg-secondary)',
      borderTop: '1px solid var(--border)',
      overflowX: 'auto',
    }}>
      <button onMouseDown={noBlur} onClick={onTab}   style={btnBase}>Tab</button>
      <button onMouseDown={noBlur} onClick={onHome}  style={btnBase}>Home</button>
      <button onMouseDown={noBlur} onClick={onEnd}   style={btnBase}>End</button>
      <div style={{ flex: 1 }} />
      <button onMouseDown={noBlur} onClick={onLeft}  aria-label="Left"  style={{ ...btnBase, ...arrowBtn }}><ArrowLeft size={16} strokeWidth={2} /></button>
      <button onMouseDown={noBlur} onClick={onDown}  aria-label="Down"  style={{ ...btnBase, ...arrowBtn }}><ArrowDown size={16} strokeWidth={2} /></button>
      <button onMouseDown={noBlur} onClick={onUp}    aria-label="Up"    style={{ ...btnBase, ...arrowBtn }}><ArrowUp size={16} strokeWidth={2} /></button>
      <button onMouseDown={noBlur} onClick={onRight} aria-label="Right" style={{ ...btnBase, ...arrowBtn }}><ArrowRight size={16} strokeWidth={2} /></button>
    </div>
  );
}
