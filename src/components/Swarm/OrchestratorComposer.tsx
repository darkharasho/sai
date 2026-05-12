import { useEffect, useRef, useState } from 'react';
import { Send, Zap } from 'lucide-react';

interface Props {
  onCommand: (cmd: { text: string; splitLines: boolean }) => void;
  disabled?: boolean;
}

export default function OrchestratorComposer({ onCommand, disabled }: Props) {
  const [text, setText] = useState('');
  const [splitLines, setSplitLines] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [text]);

  function send() {
    const t = text.trim();
    if (!t || disabled) return;
    onCommand({ text, splitLines });
    setText('');
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      send();
    }
  }

  const canSend = !disabled && !!text.trim();

  return (
    <div className="orch-composer">
      <div className="orch-input-box">
        <textarea
          ref={textareaRef}
          className="orch-textarea"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={2}
          disabled={disabled}
          placeholder="Ask the orchestrator…"
        />
      </div>
      <div className="orch-toolbar">
        <div className="orch-toolbar-left">
          <button
            type="button"
            className={`orch-tb-btn${splitLines ? ' active' : ''}`}
            onClick={() => setSplitLines(v => !v)}
            aria-label="burst"
            aria-pressed={splitLines}
          >
            <Zap size={13} />
            <span>burst</span>
            <span className="orch-tb-tip" role="tooltip">
              {splitLines
                ? 'Burst on — each line spawns its own task in parallel.'
                : 'Burst off — send the whole prompt as one message.'}
            </span>
          </button>
        </div>
        <div className="orch-toolbar-right">
          <span className="orch-hint">↵ send · ⇧↵ newline</span>
          <button
            type="button"
            className="orch-send-btn"
            onClick={send}
            disabled={!canSend}
            title="Send"
            aria-label="Send"
          >
            <Send size={14} />
          </button>
        </div>
      </div>
      <style>{`
        .orch-composer {
          display: flex;
          flex-direction: column;
          gap: 6px;
          padding: 10px 12px 12px;
          border-top: 1px solid var(--border);
          background: var(--bg-secondary);
        }
        .orch-input-box {
          position: relative;
          background: var(--bg-input, var(--bg-elevated));
          border-radius: 12px;
          overflow: visible;
        }
        .orch-input-box::before {
          content: '';
          position: absolute;
          inset: -1px;
          border-radius: 13px;
          padding: 1px;
          background: linear-gradient(135deg, var(--accent) 0%, var(--orange, var(--accent)) 25%, var(--red, var(--accent)) 50%, var(--orange, var(--accent)) 75%, var(--accent) 100%);
          background-size: 300% 300%;
          -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
          -webkit-mask-composite: xor;
          mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
          mask-composite: exclude;
          pointer-events: none;
          z-index: 0;
          opacity: 0.55;
          transition: opacity 0.2s ease;
        }
        .orch-input-box:focus-within::before { opacity: 1; }
        .orch-textarea {
          width: 100%;
          box-sizing: border-box;
          background: transparent;
          border: none;
          outline: none;
          color: var(--text);
          padding: 10px 14px;
          font-family: inherit;
          font-size: 13px;
          line-height: 17px;
          resize: none;
          min-height: 44px;
          max-height: 200px;
          position: relative;
          z-index: 1;
          display: block;
        }
        .orch-textarea::placeholder { color: var(--text-muted); }
        .orch-textarea:disabled { opacity: 0.5; }

        .orch-toolbar {
          display: flex;
          align-items: center;
          padding: 0 2px;
          gap: 8px;
        }
        .orch-toolbar-left, .orch-toolbar-right {
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .orch-toolbar-right { margin-left: auto; }

        .orch-tb-btn {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          background: none;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
          padding: 4px 8px;
          border-radius: 5px;
          font-family: inherit;
          font-size: 11px;
          line-height: 1;
          transition: color 0.15s, background 0.15s;
        }
        .orch-tb-btn { position: relative; }
        .orch-tb-btn:hover { color: var(--text); background: var(--bg-hover); }
        .orch-tb-btn.active { color: var(--accent); background: var(--bg-hover); }
        .orch-tb-tip {
          position: absolute;
          bottom: calc(100% + 6px);
          left: 0;
          white-space: nowrap;
          background: var(--bg-elevated);
          color: var(--text);
          border: 1px solid var(--border);
          border-radius: 6px;
          padding: 5px 8px;
          font-size: 11px;
          line-height: 1.3;
          box-shadow: 0 4px 12px rgba(0,0,0,0.3);
          opacity: 0;
          pointer-events: none;
          transform: translateY(2px);
          transition: opacity 0.12s ease, transform 0.12s ease;
          z-index: 10;
        }
        .orch-tb-btn:hover .orch-tb-tip,
        .orch-tb-btn:focus-visible .orch-tb-tip {
          opacity: 1;
          transform: translateY(0);
        }

        .orch-hint {
          font-size: 11px;
          color: var(--text-muted);
          font-family: 'Geist Mono', 'JetBrains Mono', monospace;
          user-select: none;
        }

        .orch-send-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          background: var(--accent);
          color: #000;
          border: none;
          padding: 6px;
          border-radius: 6px;
          cursor: pointer;
          transition: background 0.15s, opacity 0.15s;
        }
        .orch-send-btn:hover:not(:disabled) { background: var(--accent-hover); }
        .orch-send-btn:disabled { opacity: 0.3; cursor: not-allowed; }
      `}</style>
    </div>
  );
}
