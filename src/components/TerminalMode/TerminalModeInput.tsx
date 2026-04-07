import { useState, useRef, useEffect, useImperativeHandle, forwardRef, useMemo } from 'react';
import type { InputMode } from './types';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent);

/** Score history entries by frequency + recency, return best prefix match. */
function predictCommand(prefix: string, history: string[]): string | null {
  if (!prefix || !prefix.trim()) return null;
  const lower = prefix.toLowerCase();
  const total = history.length;
  if (total === 0) return null;

  const scores = new Map<string, number>();
  for (let i = 0; i < total; i++) {
    const cmd = history[i];
    if (!cmd.toLowerCase().startsWith(lower) || cmd.toLowerCase() === lower) continue;
    const recency = (i + 1) / total; // 0→1, higher = more recent
    scores.set(cmd, (scores.get(cmd) || 0) + 1 + recency);
  }

  let best: string | null = null;
  let bestScore = 0;
  for (const [cmd, score] of scores) {
    if (score > bestScore) {
      bestScore = score;
      best = cmd;
    }
  }
  return best;
}

export interface TerminalModeInputHandle {
  paste: (text: string) => void;
  focus: () => void;
}

function stripPromptGlyphs(text: string): string {
  return text
    .replace(/[\uE0A0-\uE0D4\uE200-\uE2A9\uE5FA-\uE6B5\uE700-\uE7C5\uF000-\uFD46\uDB80-\uDBFF][\uDC00-\uDFFF]?/g, '')
    .replace(/[^\x20-\x7E\u00A0-\u00FF\u0100-\u024F\u2000-\u206F❯]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function extractPromptParts(promptText: string): { user: string; path: string } {
  const cleaned = stripPromptGlyphs(promptText);
  const match = cleaned.match(/^(\S+?)[@:]?\s*(~[^\s$#%]*|\/[^\s$#%]*)/);
  if (match) return { user: match[1], path: match[2] };
  const clean = cleaned.replace(/[\$#%>\s]+$/, '').trim();
  return { user: clean, path: '' };
}

interface TerminalModeInputProps {
  onSubmit: (value: string) => void;
  mode: InputMode;
  onToggleMode: () => void;
  permissionMode: 'default' | 'bypass';
  onPermissionChange: (mode: 'default' | 'bypass') => void;
  initialValue?: string;
  disabled?: boolean;
  cwd: string;
  promptInfo?: { text: string; isRemote: boolean; sshTarget?: string } | null;
  history?: string[];
  onClear?: () => void;
  fullWidth?: boolean;
  onToggleFullWidth?: () => void;
  detectAI?: (text: string) => boolean;
  onModeChange?: (mode: InputMode) => void;
}

const TerminalModeInput = forwardRef<TerminalModeInputHandle, TerminalModeInputProps>(function TerminalModeInput({ onSubmit, mode, onToggleMode, permissionMode, onPermissionChange, initialValue, disabled, cwd, promptInfo, history = [], onClear, fullWidth, onToggleFullWidth, detectAI, onModeChange }, ref) {
  const [value, setValue] = useState(initialValue || '');
  const inputRef = useRef<HTMLInputElement>(null);
  // History navigation: -1 = current input, 0 = most recent, 1 = second most recent, etc.
  const historyIndexRef = useRef(-1);
  const savedInputRef = useRef('');
  // When user manually toggles mode, suppress auto-detect until submit/clear
  const manualOverrideRef = useRef(false);
  // Tab completion cycling state
  const tabCompletionsRef = useRef<string[]>([]);
  const tabIndexRef = useRef(-1);
  const tabPrefixRef = useRef('');

  const prediction = useMemo(
    () => mode === 'shell' ? predictCommand(value, history) : null,
    [value, history, mode],
  );

  useImperativeHandle(ref, () => ({
    paste: (text: string) => {
      setValue(prev => prev + text);
      inputRef.current?.focus();
    },
    focus: () => {
      inputRef.current?.focus();
    },
  }));

  useEffect(() => {
    if (initialValue !== undefined) setValue(initialValue);
  }, [initialValue]);

  useEffect(() => {
    inputRef.current?.focus();
  }, [mode]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      onToggleMode();
      return;
    }
    if (e.key === 'Tab' && e.shiftKey) {
      e.preventDefault();
      manualOverrideRef.current = true;
      onToggleMode();
      return;
    }
    // Tab — accept prediction first, then shell tab completion
    if (e.key === 'Tab' && !e.shiftKey && mode === 'shell') {
      e.preventDefault();
      // Accept inline prediction if one exists
      if (prediction) {
        setValue(prediction);
        tabCompletionsRef.current = [];
        tabIndexRef.current = -1;
        tabPrefixRef.current = '';
        return;
      }
      const text = value;
      if (!text) return;

      // If we already have completions cached, cycle through them
      if (tabCompletionsRef.current.length > 1 && tabPrefixRef.current) {
        const next = (tabIndexRef.current + 1) % tabCompletionsRef.current.length;
        tabIndexRef.current = next;
        const c = tabCompletionsRef.current[next];
        setValue(tabPrefixRef.current + c);
        return;
      }

      window.sai.terminalTabComplete(text, cwd).then((completions: string[]) => {
        if (completions.length === 0) return;
        const lastWord = text.split(/\s+/).pop() || '';
        const prefix = text.slice(0, text.length - lastWord.length);
        if (completions.length === 1) {
          const c = completions[0];
          setValue(prefix + c + (c.endsWith('/') ? '' : ' '));
          tabCompletionsRef.current = [];
          tabIndexRef.current = -1;
          tabPrefixRef.current = '';
        } else {
          // Try longest common prefix first
          let common = completions[0];
          for (let i = 1; i < completions.length; i++) {
            let j = 0;
            while (j < common.length && j < completions[i].length && common[j] === completions[i][j]) j++;
            common = common.slice(0, j);
          }
          if (common.length > lastWord.length) {
            setValue(prefix + common);
            tabCompletionsRef.current = [];
            tabIndexRef.current = -1;
            tabPrefixRef.current = '';
          } else {
            // No common prefix to extend — start cycling
            tabCompletionsRef.current = completions;
            tabIndexRef.current = 0;
            tabPrefixRef.current = prefix;
            setValue(prefix + completions[0]);
          }
        }
      });
      return;
    }
    // Ctrl+L — clear screen
    if (e.key === 'l' && e.ctrlKey && !e.shiftKey) {
      e.preventDefault();
      onClear?.();
      return;
    }
    // Ctrl+U — delete from cursor to start of line
    if (e.key === 'u' && e.ctrlKey && !e.shiftKey) {
      e.preventDefault();
      const pos = inputRef.current?.selectionStart ?? value.length;
      setValue(value.slice(pos));
      requestAnimationFrame(() => inputRef.current?.setSelectionRange(0, 0));
      return;
    }
    // Ctrl+W — delete previous word
    if (e.key === 'w' && e.ctrlKey && !e.shiftKey) {
      e.preventDefault();
      const pos = inputRef.current?.selectionStart ?? value.length;
      const before = value.slice(0, pos);
      // Trim trailing spaces, then remove back to the next space
      const trimmed = before.replace(/\s+$/, '');
      const lastSpace = trimmed.lastIndexOf(' ');
      const newBefore = lastSpace === -1 ? '' : value.slice(0, lastSpace + 1);
      const after = value.slice(pos);
      setValue(newBefore + after);
      const newPos = newBefore.length;
      requestAnimationFrame(() => inputRef.current?.setSelectionRange(newPos, newPos));
      return;
    }
    // Escape — clear input
    if (e.key === 'Escape') {
      e.preventDefault();
      setValue('');
      manualOverrideRef.current = false;
      return;
    }
    // Right arrow at end of input — accept prediction
    if (e.key === 'ArrowRight' && prediction && inputRef.current?.selectionStart === value.length) {
      e.preventDefault();
      setValue(prediction);
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (history.length === 0) return;
      if (historyIndexRef.current === -1) savedInputRef.current = value;
      const nextIdx = Math.min(historyIndexRef.current + 1, history.length - 1);
      historyIndexRef.current = nextIdx;
      setValue(history[history.length - 1 - nextIdx]);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIndexRef.current <= -1) return;
      const nextIdx = historyIndexRef.current - 1;
      historyIndexRef.current = nextIdx;
      if (nextIdx === -1) {
        setValue(savedInputRef.current);
      } else {
        setValue(history[history.length - 1 - nextIdx]);
      }
      return;
    }
    if (e.key === 'Enter' && value.trim()) {
      e.preventDefault();
      onSubmit(value.trim());
      setValue('');
      manualOverrideRef.current = false;
      historyIndexRef.current = -1;
      savedInputRef.current = '';
      tabCompletionsRef.current = [];
      tabIndexRef.current = -1;
      tabPrefixRef.current = '';
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newVal = e.target.value;
    setValue(newVal);
    // Clear tab completion cycling on any typed input
    tabCompletionsRef.current = [];
    tabIndexRef.current = -1;
    tabPrefixRef.current = '';
    if (detectAI && onModeChange && !manualOverrideRef.current) {
      const trimmed = newVal.trim();
      if (trimmed.length === 0) {
        if (mode !== 'shell') onModeChange('shell');
      } else if (mode === 'shell' && detectAI(trimmed)) {
        onModeChange('ai');
      } else if (mode === 'ai' && !detectAI(trimmed)) {
        onModeChange('shell');
      }
    }
  };

  const isAI = mode === 'ai';
  const shortCwd = cwd.replace(/^\/var\/home\/[^/]+/, '~').replace(/^\/home\/[^/]+/, '~');
  const modKey = isMac ? '\u2318' : 'Ctrl+';

  // Determine prompt display: use SSH target when remote
  let promptLabel = shortCwd;
  let promptIsRemote = false;
  if (promptInfo?.isRemote && promptInfo.sshTarget) {
    promptIsRemote = true;
    promptLabel = promptInfo.sshTarget;
  }

  return (
    <div className={`tn-input-wrapper ${fullWidth ? 'tn-input-full-width' : ''}`}>
      <div className={`tn-input-box ${isAI ? 'tn-input-box-ai' : ''}`}>
        <div className="tn-input-row">
          {isAI ? (
            <span className="tn-input-prompt-ai">{'\u2726'}</span>
          ) : (
            <>
              <span className="tn-input-user" style={promptIsRemote ? { color: '#f59e0b' } : undefined}>{promptLabel}</span>
              <span className="tn-input-dollar">$</span>
            </>
          )}
          <div className="tn-input-field-wrap">
            {prediction && (
              <span className="tn-input-ghost" aria-hidden="true">
                <span style={{ visibility: 'hidden' }}>{value}</span>{prediction.slice(value.length)}
              </span>
            )}
            <input
              ref={inputRef}
              className="tn-input-field"
              value={value}
              onChange={handleChange}
              onKeyDown={handleKeyDown}
              placeholder={isAI ? 'Ask AI...' : ''}
              disabled={disabled}
              spellCheck={false}
              autoComplete="off"
            />
          </div>
          <div className="tn-input-hint">
            <span className="tn-input-kbd">{modKey}K</span>
            <span className="tn-input-hint-label">{isAI ? 'Shell' : 'AI'}</span>
          </div>
        </div>
      </div>

      <style>{`
        .tn-input-wrapper {
          padding: 8px 15% 10px;
          flex-shrink: 0;
          transition: padding 0.3s ease;
        }
        .tn-input-wrapper.tn-input-full-width {
          padding-left: 16px;
          padding-right: 16px;
        }
        .tn-input-box {
          position: relative;
          border-radius: 5px;
          background: #111417;
          overflow: visible;
        }
        .tn-input-box::before {
          content: '';
          position: absolute;
          inset: -1.5px;
          border-radius: 6.5px;
          padding: 1.5px;
          background: linear-gradient(135deg, var(--accent) 0%, var(--orange) 20%, var(--red) 50%, var(--orange) 80%, var(--accent) 100%);
          background-size: 300% 300%;
          animation: tn-gradient-sweep 20s ease-in-out infinite alternate;
          -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
          -webkit-mask-composite: xor;
          mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
          mask-composite: exclude;
          pointer-events: none;
          z-index: 0;
          opacity: 0.5;
          transition: opacity 0.2s ease;
        }
        .tn-input-box:focus-within::before {
          opacity: 1;
        }
        .tn-input-box-ai::before {
          background: linear-gradient(135deg, #a371f7 0%, #c084fc 25%, #7c3aed 50%, #c084fc 75%, #a371f7 100%);
          background-size: 300% 300%;
          animation: tn-gradient-sweep 20s ease-in-out infinite alternate;
        }
        .tn-input-row {
          position: relative;
          z-index: 1;
          padding: 8px 12px;
          display: flex;
          align-items: center;
          gap: 8px;
          font-family: 'JetBrains Mono NF', 'JetBrains Mono', monospace;
          font-size: 13px;
        }
        .tn-input-user {
          color: #22c55e;
          flex-shrink: 0;
          font-size: 12px;
        }
        .tn-input-dollar {
          color: #4b5563;
          flex-shrink: 0;
        }
        .tn-input-prompt-ai {
          color: #a371f7;
          font-size: 14px;
          flex-shrink: 0;
        }
        .tn-input-field-wrap {
          flex: 1;
          position: relative;
          min-width: 0;
        }
        .tn-input-ghost {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          pointer-events: none;
          color: #3a3f47;
          font-family: 'JetBrains Mono NF', 'JetBrains Mono', monospace;
          font-size: 13px;
          white-space: pre;
          overflow: hidden;
        }
        .tn-input-field {
          position: relative;
          width: 100%;
          background: none;
          border: none;
          outline: none;
          color: var(--text);
          font-family: 'JetBrains Mono NF', 'JetBrains Mono', monospace;
          font-size: 13px;
          min-width: 0;
        }
        .tn-input-field::placeholder {
          color: #4b5563;
        }
        .tn-input-hint {
          display: flex;
          align-items: center;
          gap: 4px;
          flex-shrink: 0;
          margin-left: auto;
        }
        .tn-input-kbd {
          color: #4b5563;
          font-size: 10px;
          border: 1px solid #1e2328;
          padding: 1px 5px;
          border-radius: 3px;
          background: #0a0d0f;
        }
        .tn-input-hint-label {
          color: #4b5563;
          font-size: 10px;
        }
        @keyframes tn-gradient-sweep {
          0% { background-position: 0% 0%; }
          100% { background-position: 100% 100%; }
        }
      `}</style>
    </div>
  );
});

export default TerminalModeInput;
