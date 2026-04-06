import { useState, useRef, useEffect, useImperativeHandle, forwardRef } from 'react';
import { CornerDownLeft, ShieldCheck, ShieldOff, ChevronsLeftRight } from 'lucide-react';
import type { InputMode } from './types';

export interface TerminalModeInputHandle {
  paste: (text: string) => void;
}

interface TerminalModeInputProps {
  onSubmit: (value: string) => void;
  mode: InputMode;
  onToggleMode: () => void;
  onTabComplete?: (text: string) => Promise<string[]>;
  permissionMode: 'default' | 'bypass';
  onPermissionChange: (mode: 'default' | 'bypass') => void;
  initialValue?: string;
  disabled?: boolean;
  cwd: string;
  history?: string[];
  onClear?: () => void;
  fullWidth?: boolean;
  onToggleFullWidth?: () => void;
  detectAI?: (text: string) => boolean;
  onModeChange?: (mode: InputMode) => void;
}

const TerminalModeInput = forwardRef<TerminalModeInputHandle, TerminalModeInputProps>(function TerminalModeInput({ onSubmit, mode, onToggleMode, onTabComplete, permissionMode, onPermissionChange, initialValue, disabled, cwd, history = [], onClear, fullWidth, onToggleFullWidth, detectAI, onModeChange }, ref) {
  const [value, setValue] = useState(initialValue || '');
  const [completions, setCompletions] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  // Tracks state between consecutive Tab presses
  const tabStateRef = useRef<{ candidates: string[]; hitCount: number; selectedIndex: number } | null>(null);
  const [selectedCompletion, setSelectedCompletion] = useState(-1);
  // History navigation: -1 = current input, 0 = most recent, 1 = second most recent, etc.
  const historyIndexRef = useRef(-1);
  const savedInputRef = useRef('');
  // When user manually toggles mode, suppress auto-detect until submit/clear
  const manualOverrideRef = useRef(false);

  useImperativeHandle(ref, () => ({
    paste: (text: string) => {
      setValue(prev => prev + text);
      inputRef.current?.focus();
    },
  }));

  useEffect(() => {
    if (initialValue !== undefined) setValue(initialValue);
  }, [initialValue]);

  useEffect(() => {
    inputRef.current?.focus();
  }, [mode]);

  const clearCompletions = () => {
    setCompletions([]);
    setSelectedCompletion(-1);
    tabStateRef.current = null;
  };

  const applyCompletion = (completion: string) => {
    const words = value.split(/(\s+)/); // preserve whitespace
    // Find last non-whitespace token index
    let lastTokenIdx = words.length - 1;
    while (lastTokenIdx >= 0 && /^\s*$/.test(words[lastTokenIdx])) lastTokenIdx--;
    if (lastTokenIdx < 0) {
      // All whitespace — append completion
      words.push(completion);
    } else {
      words[lastTokenIdx] = completion;
    }
    const joined = words.join('');
    // Directory: no trailing space (user will Tab into it)
    // File: add trailing space
    const newValue = completion.endsWith('/') ? joined : joined + ' ';
    setValue(newValue);
  };

  const handleTabComplete = async () => {
    if (!onTabComplete || !value.trim()) return;

    const state = tabStateRef.current;

    // Completions already visible — cycle through them
    if (state && state.hitCount >= 2) {
      const nextIdx = (state.selectedIndex + 1) % state.candidates.length;
      state.selectedIndex = nextIdx;
      setSelectedCompletion(nextIdx);
      applyCompletion(state.candidates[nextIdx]);
      return;
    }

    // Second Tab — show candidates and select the first one
    if (state && state.hitCount === 1 && state.candidates.length > 1) {
      state.hitCount = 2;
      state.selectedIndex = 0;
      setCompletions(state.candidates);
      setSelectedCompletion(0);
      applyCompletion(state.candidates[0]);
      return;
    }

    // First Tab — fetch completions
    const candidates = await onTabComplete(value);
    if (candidates.length === 0) return;

    if (candidates.length === 1) {
      applyCompletion(candidates[0]);
      clearCompletions();
      return;
    }

    // Multiple matches — apply common prefix on first Tab
    const commonPrefix = candidates.reduce((prefix, candidate) => {
      let i = 0;
      while (i < prefix.length && i < candidate.length && prefix[i] === candidate[i]) i++;
      return prefix.slice(0, i);
    });

    const lastWord = value.split(/\s+/).pop() || '';
    if (commonPrefix.length > lastWord.length) {
      if (commonPrefix.endsWith('/')) {
        applyCompletion(commonPrefix);
      } else {
        const words = value.split(/(\s+)/);
        let lastTokenIdx = words.length - 1;
        while (lastTokenIdx >= 0 && /^\s*$/.test(words[lastTokenIdx])) lastTokenIdx--;
        if (lastTokenIdx >= 0) words[lastTokenIdx] = commonPrefix;
        setValue(words.join(''));
      }
    }

    // Store candidates — second Tab will reveal them
    tabStateRef.current = { candidates, hitCount: 1, selectedIndex: -1 };
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Tab' && e.shiftKey) {
      e.preventDefault();
      manualOverrideRef.current = true;
      onToggleMode();
      clearCompletions();
      return;
    }
    if (e.key === 'Tab' && !e.shiftKey && mode === 'shell') {
      e.preventDefault();
      handleTabComplete();
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
      clearCompletions();
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
      clearCompletions();
      return;
    }
    // Escape — dismiss completions or clear input
    if (e.key === 'Escape') {
      e.preventDefault();
      if (completions.length > 0) {
        clearCompletions();
      } else {
        setValue('');
        manualOverrideRef.current = false;
      }
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
      clearCompletions();
      historyIndexRef.current = -1;
      savedInputRef.current = '';
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newVal = e.target.value;
    setValue(newVal);
    clearCompletions();
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

  return (
    <div className={`tm-input-wrapper ${fullWidth ? 'tm-input-full-width' : ''}`}>
      <div className={`tm-input-box ${isAI ? 'tm-input-box-ai' : ''}`}>
        <div className="tm-input-cwd">{cwd.replace(/^\/var\/home\/[^/]+/, '~').replace(/^\/home\/[^/]+/, '~')}</div>
        <div className="tm-input-row">
          <span className={`tm-input-prompt ${isAI ? 'tm-input-prompt-ai' : ''}`}>
            {isAI ? '\u2726' : '$'}
          </span>
          <input
            ref={inputRef}
            className="tm-input-field"
            value={value}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            placeholder={isAI ? 'Ask AI...' : 'Enter command...'}
            disabled={disabled}
            spellCheck={false}
            autoComplete="off"
          />
        </div>
        {completions.length > 1 && (
          <div className="tm-completions">
            {completions.map((c, i) => (
              <span key={c} className={`tm-completion-item ${i === selectedCompletion ? 'tm-completion-active' : ''}`} onClick={() => {
                applyCompletion(c);
                clearCompletions();
                inputRef.current?.focus();
              }}>{c}</span>
            ))}
          </div>
        )}
        <div className="tm-input-toolbar">
          <div className="tm-input-toolbar-left">
            <button
              className={`tm-perm-btn ${permissionMode === 'bypass' ? 'tm-perm-bypass' : ''}`}
              onClick={() => onPermissionChange(permissionMode === 'default' ? 'bypass' : 'default')}
              title={permissionMode === 'default' ? 'Default permissions — tools need approval' : 'Bypass — tools auto-approved'}
            >
              {permissionMode === 'default'
                ? <><ShieldCheck size={12} /> <span>Default</span></>
                : <><ShieldOff size={12} /> <span>Bypass</span></>
              }
            </button>
            <button
              className={`tm-perm-btn ${fullWidth ? 'tm-width-active' : ''}`}
              onClick={onToggleFullWidth}
              title={fullWidth ? 'Centered layout' : 'Full width'}
            >
              <ChevronsLeftRight size={12} />
            </button>
          </div>
          <div className="tm-input-toolbar-right">
            <span className="tm-input-hint">
              {'\u21E7'}tab {'\u2192'} {isAI
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
          padding: 12px 15% 14px;
          flex-shrink: 0;
          transition: padding 0.3s ease;
        }
        .tm-input-wrapper.tm-input-full-width {
          padding-left: 16px;
          padding-right: 16px;
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
        .tm-input-box-ai::before {
          background: linear-gradient(135deg, #a371f7 0%, #c084fc 25%, #7c3aed 50%, #c084fc 75%, #a371f7 100%);
          background-size: 300% 300%;
          animation: tm-gradient-sweep 20s ease-in-out infinite alternate;
        }
        .tm-input-cwd {
          position: relative;
          z-index: 1;
          padding: 6px 14px 0;
          color: var(--text-muted);
          font-family: 'JetBrains Mono', monospace;
          font-size: 11px;
        }
        .tm-input-row {
          position: relative;
          z-index: 1;
          padding: 6px 14px 10px;
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
        .tm-completions {
          position: relative;
          z-index: 1;
          padding: 4px 14px 6px;
          display: flex;
          flex-wrap: wrap;
          gap: 4px 12px;
          font-family: 'JetBrains Mono', monospace;
          font-size: 11px;
          color: var(--text-muted);
          border-top: 1px solid var(--bg-hover);
        }
        .tm-completion-item {
          white-space: nowrap;
          cursor: pointer;
          padding: 1px 4px;
          border-radius: 2px;
        }
        .tm-completion-item:hover,
        .tm-completion-active {
          background: var(--bg-hover);
          color: var(--accent);
        }
        .tm-input-toolbar {
          position: relative;
          z-index: 1;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 4px 8px 6px;
          gap: 4px;
          border-top: 1px solid var(--bg-hover);
        }
        .tm-input-toolbar-left {
          display: flex;
          align-items: center;
          gap: 6px;
          padding-left: 6px;
        }
        .tm-perm-btn {
          display: flex;
          align-items: center;
          gap: 4px;
          font-family: 'JetBrains Mono', monospace;
          font-size: 10px;
          padding: 2px 7px;
          border-radius: 3px;
          border: 1px solid transparent;
          background: none;
          color: var(--text-muted);
          cursor: pointer;
          transition: all 0.15s;
        }
        .tm-perm-btn:hover {
          background: var(--bg-hover);
        }
        .tm-perm-bypass {
          color: var(--red);
          border-color: var(--red);
          background: rgba(227, 85, 53, 0.1);
        }
        .tm-perm-bypass:hover {
          background: rgba(227, 85, 53, 0.2);
        }
        .tm-width-active {
          color: var(--accent);
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
});

export default TerminalModeInput;
