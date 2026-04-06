import { useState, useRef, useEffect } from 'react';
import { CornerDownLeft } from 'lucide-react';
import type { InputMode } from './types';

interface TerminalModeInputProps {
  onSubmit: (value: string) => void;
  mode: InputMode;
  onToggleMode: () => void;
  initialValue?: string;
  disabled?: boolean;
}

export default function TerminalModeInput({ onSubmit, mode, onToggleMode, initialValue, disabled }: TerminalModeInputProps) {
  const [value, setValue] = useState(initialValue || '');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (initialValue !== undefined) setValue(initialValue);
  }, [initialValue]);

  useEffect(() => {
    inputRef.current?.focus();
  }, [mode]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      onToggleMode();
      return;
    }
    if (e.key === 'Enter' && value.trim()) {
      e.preventDefault();
      onSubmit(value.trim());
      setValue('');
    }
  };

  const isAI = mode === 'ai';

  return (
    <div className="tm-input-wrapper">
      <div className="tm-input-box">
        <div className="tm-input-row">
          <span className={`tm-input-prompt ${isAI ? 'tm-input-prompt-ai' : ''}`}>
            {isAI ? '\u2726' : '$'}
          </span>
          <input
            ref={inputRef}
            className="tm-input-field"
            value={value}
            onChange={e => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isAI ? 'Ask AI...' : 'Enter command...'}
            disabled={disabled}
            spellCheck={false}
            autoComplete="off"
          />
        </div>
        <div className="tm-input-toolbar">
          <div style={{ flex: 1 }} />
          <div className="tm-input-toolbar-right">
            <span className="tm-input-hint">
              tab {'\u2192'} {isAI
                ? <span>$ shell</span>
                : <span className="tm-input-hint-ai">{'\u2726'} ai</span>}
            </span>
            <span className="tm-input-divider">{'\u2502'}</span>
            <span className="tm-icon" onClick={() => value.trim() && onSubmit(value.trim())}>
              <CornerDownLeft size={14} color={isAI ? '#a371f7' : 'var(--accent)'} />
            </span>
          </div>
        </div>
      </div>

      <style>{`
        .tm-input-wrapper {
          padding: 0 15% 14px;
          margin-top: 8px;
        }
        .tm-input-box {
          position: relative;
          border-radius: 4px;
          background: var(--bg);
          overflow: visible;
        }
        .tm-input-box::before {
          content: '';
          position: absolute;
          inset: -2px;
          border-radius: 6px;
          padding: 2px;
          background: linear-gradient(135deg, var(--accent) 0%, var(--orange) 20%, var(--red) 50%, var(--orange) 80%, var(--accent) 100%);
          background-size: 300% 300%;
          animation: tm-gradient-sweep 20s ease-in-out infinite alternate;
          -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
          -webkit-mask-composite: xor;
          mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
          mask-composite: exclude;
          pointer-events: none;
          z-index: 0;
          opacity: 0.7;
          transition: opacity 0.2s ease;
        }
        .tm-input-box:focus-within::before {
          opacity: 1;
        }
        .tm-input-row {
          position: relative;
          z-index: 1;
          padding: 10px 14px;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .tm-input-prompt {
          color: var(--accent);
          font-family: 'JetBrains Mono', monospace;
          font-size: 13px;
          font-weight: 600;
          flex-shrink: 0;
        }
        .tm-input-prompt-ai {
          color: #a371f7;
        }
        .tm-input-field {
          flex: 1;
          background: none;
          border: none;
          outline: none;
          color: var(--text);
          font-family: 'JetBrains Mono', monospace;
          font-size: 13px;
        }
        .tm-input-field::placeholder {
          color: var(--text-muted);
        }
        .tm-input-toolbar {
          position: relative;
          z-index: 1;
          display: flex;
          align-items: center;
          padding: 4px 8px 6px;
          gap: 4px;
          border-top: 1px solid var(--bg-hover);
        }
        .tm-input-toolbar-right {
          display: flex;
          align-items: center;
          gap: 8px;
          padding-right: 6px;
        }
        .tm-input-hint {
          color: var(--text-muted);
          font-size: 10px;
          font-family: 'JetBrains Mono', monospace;
        }
        .tm-input-hint-ai {
          color: #a371f7;
        }
        .tm-input-divider {
          color: var(--border);
        }
        @keyframes tm-gradient-sweep {
          0% { background-position: 0% 0%; }
          100% { background-position: 100% 100%; }
        }
      `}</style>
    </div>
  );
}
