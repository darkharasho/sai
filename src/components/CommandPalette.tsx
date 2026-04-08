import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Search, File, ChevronRight, FileCode2, MessageSquare, Loader2 } from 'lucide-react';
import { fuzzyMatch } from '../utils/fuzzyMatch';

type PaletteMode = 'files' | 'commands' | 'grep' | 'sessions';

interface GrepResult {
  file: string;
  line: number;
  text: string;
}

interface WorkspaceInfo {
  projectPath: string;
  status?: string;
  lastActivity?: number;
}

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  fileIndex: string[];
  slashCommands: string[];
  workspaces: WorkspaceInfo[];
  projectPath: string;
  onFileOpen: (path: string, line?: number) => void;
  onCommand: (command: string) => void;
  onWorkspaceSwitch: (path: string) => void;
}

const MODE_ORDER: PaletteMode[] = ['files', 'commands', 'grep', 'sessions'];

const MODE_CONFIG: Record<PaletteMode, { label: string; placeholder: string; prefix: string }> = {
  files:    { label: 'Files',    placeholder: 'Search files...',      prefix: '' },
  commands: { label: 'Commands', placeholder: 'Run command...',       prefix: '>' },
  grep:    { label: 'Grep',     placeholder: 'Search in files...',   prefix: '#' },
  sessions: { label: 'Sessions', placeholder: 'Switch session...',   prefix: '@' },
};

const EXT_COLORS: Record<string, { bg: string; fg: string; label: string }> = {
  ts:   { bg: 'rgba(17,183,212,0.12)', fg: '#11B7D4', label: 'TS' },
  tsx:  { bg: 'rgba(17,183,212,0.12)', fg: '#11B7D4', label: 'TS' },
  js:   { bg: 'rgba(199,145,12,0.12)', fg: '#c7910c', label: 'JS' },
  jsx:  { bg: 'rgba(199,145,12,0.12)', fg: '#c7910c', label: 'JS' },
  py:   { bg: 'rgba(0,168,132,0.12)',  fg: '#00a884', label: 'PY' },
  rs:   { bg: 'rgba(212,119,12,0.12)', fg: '#d4770c', label: 'RS' },
  go:   { bg: 'rgba(56,199,189,0.12)', fg: '#38c7bd', label: 'GO' },
  css:  { bg: 'rgba(212,110,192,0.12)', fg: '#d46ec0', label: 'CSS' },
  html: { bg: 'rgba(227,85,53,0.12)',  fg: '#E35535', label: 'HTM' },
  json: { bg: 'rgba(199,145,12,0.12)', fg: '#c7910c', label: 'JSON' },
  md:   { bg: 'rgba(160,172,187,0.12)', fg: '#a0acbb', label: 'MD' },
  yaml: { bg: 'rgba(168,95,241,0.12)', fg: '#a85ff1', label: 'YML' },
  yml:  { bg: 'rgba(168,95,241,0.12)', fg: '#a85ff1', label: 'YML' },
  toml: { bg: 'rgba(168,95,241,0.12)', fg: '#a85ff1', label: 'TOML' },
};

function getExtInfo(filename: string) {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  return EXT_COLORS[ext] || { bg: 'rgba(160,172,187,0.12)', fg: '#a0acbb', label: ext.toUpperCase().slice(0, 4) || '?' };
}

function highlightGrepMatch(text: string, query: string) {
  if (!query) return <>{text}</>;
  const lower = text.toLowerCase();
  const lq = query.toLowerCase();
  const idx = lower.indexOf(lq);
  if (idx === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <mark>{text.slice(idx, idx + query.length)}</mark>
      {text.slice(idx + query.length)}
    </>
  );
}

function highlightFilename(name: string, indices: number[]) {
  if (!indices.length) return <>{name}</>;
  const chars: React.ReactNode[] = [];
  let inHighlight = false;
  let buf = '';
  for (let i = 0; i < name.length; i++) {
    const isMatch = indices.includes(i);
    if (isMatch !== inHighlight) {
      if (buf) chars.push(inHighlight ? <mark key={i}>{buf}</mark> : buf);
      buf = '';
      inHighlight = isMatch;
    }
    buf += name[i];
  }
  if (buf) chars.push(inHighlight ? <mark key="end">{buf}</mark> : buf);
  return <>{chars}</>;
}

export default function CommandPalette({
  open, onClose, fileIndex, slashCommands, workspaces,
  projectPath, onFileOpen, onCommand, onWorkspaceSwitch,
}: CommandPaletteProps) {
  const [mode, setMode] = useState<PaletteMode>('files');
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [grepResults, setGrepResults] = useState<GrepResult[]>([]);
  const [grepLoading, setGrepLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const grepTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Reset state when opened
  useEffect(() => {
    if (open) {
      setQuery('');
      setMode('files');
      setSelectedIndex(0);
      setGrepResults([]);
      setGrepLoading(false);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  // Detect prefix-based mode switch
  const handleInputChange = useCallback((value: string) => {
    if (value === '>' && mode !== 'commands') {
      setMode('commands');
      setQuery('');
      setSelectedIndex(0);
      return;
    }
    if (value === '#' && mode !== 'grep') {
      setMode('grep');
      setQuery('');
      setSelectedIndex(0);
      return;
    }
    if (value === '@' && mode !== 'sessions') {
      setMode('sessions');
      setQuery('');
      setSelectedIndex(0);
      return;
    }
    setQuery(value);
    setSelectedIndex(0);
  }, [mode]);

  // Grep debounce
  useEffect(() => {
    if (mode !== 'grep') return;
    if (grepTimerRef.current) clearTimeout(grepTimerRef.current);
    if (!query || query.length < 2) {
      setGrepResults([]);
      setGrepLoading(false);
      return;
    }
    setGrepLoading(true);
    grepTimerRef.current = setTimeout(async () => {
      try {
        const results = await (window as any).sai.fsGrep(projectPath, query, 50);
        setGrepResults(results);
      } catch {
        setGrepResults([]);
      }
      setGrepLoading(false);
    }, 300);
    return () => { if (grepTimerRef.current) clearTimeout(grepTimerRef.current); };
  }, [query, mode, projectPath]);

  // Compute results for current mode
  const results = useMemo(() => {
    if (mode === 'files') {
      return fuzzyMatch(query, fileIndex, 50);
    }
    return [];
  }, [mode, query, fileIndex]);

  const commandResults = useMemo(() => {
    if (mode !== 'commands') return [];
    const lq = query.toLowerCase();
    const builtins = [
      { name: 'help', description: 'Show available commands' },
      { name: 'clear', description: 'Clear conversation' },
    ];
    const fromProvider = slashCommands.map(c => ({ name: c, description: '' }));
    const all = [...builtins, ...fromProvider.filter(c => !builtins.some(b => b.name === c.name))];
    if (!lq) return all;
    return all.filter(c => c.name.toLowerCase().includes(lq));
  }, [mode, query, slashCommands]);

  const sessionResults = useMemo(() => {
    if (mode !== 'sessions') return [];
    const lq = query.toLowerCase();
    if (!lq) return workspaces;
    return workspaces.filter(w => {
      const name = w.projectPath.split('/').pop() || w.projectPath;
      return name.toLowerCase().includes(lq) || w.projectPath.toLowerCase().includes(lq);
    });
  }, [mode, query, workspaces]);

  const totalResults = mode === 'files' ? results.length
    : mode === 'commands' ? commandResults.length
    : mode === 'grep' ? grepResults.length
    : sessionResults.length;

  // Scroll active result into view
  useEffect(() => {
    const container = resultsRef.current;
    if (!container) return;
    const active = container.querySelector('.cp-result-active') as HTMLElement;
    if (active) active.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  const executeResult = useCallback(() => {
    if (mode === 'files' && results[selectedIndex]) {
      const filePath = projectPath + '/' + results[selectedIndex].path;
      onFileOpen(filePath);
      onClose();
    } else if (mode === 'commands' && commandResults[selectedIndex]) {
      onCommand(commandResults[selectedIndex].name);
      onClose();
    } else if (mode === 'grep' && grepResults[selectedIndex]) {
      const r = grepResults[selectedIndex];
      onFileOpen(projectPath + '/' + r.file, r.line);
      onClose();
    } else if (mode === 'sessions' && sessionResults[selectedIndex]) {
      onWorkspaceSwitch(sessionResults[selectedIndex].projectPath);
      onClose();
    }
  }, [mode, selectedIndex, results, commandResults, grepResults, sessionResults, projectPath, onFileOpen, onCommand, onWorkspaceSwitch, onClose]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(i => Math.min(i + 1, totalResults - 1));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(i => Math.max(i - 1, 0));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      executeResult();
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      const currentIdx = MODE_ORDER.indexOf(mode);
      const nextMode = MODE_ORDER[(currentIdx + (e.shiftKey ? MODE_ORDER.length - 1 : 1)) % MODE_ORDER.length];
      setMode(nextMode);
      setSelectedIndex(0);
      return;
    }
  }, [onClose, totalResults, executeResult, mode]);

  if (!open) return null;

  return (
    <>
      <div className="cp-backdrop" onClick={onClose} />
      <div className="cp-palette" onKeyDown={handleKeyDown}>
        <div className="cp-input-row">
          <Search size={16} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
          <input
            ref={inputRef}
            className="cp-input"
            type="text"
            value={query}
            onChange={e => handleInputChange(e.target.value)}
            placeholder={MODE_CONFIG[mode].placeholder}
            spellCheck={false}
            autoComplete="off"
          />
          {mode === 'grep' && grepLoading && (
            <Loader2 size={14} style={{ color: 'var(--text-muted)', animation: 'cp-spin 1s linear infinite' }} />
          )}
        </div>

        <div className="cp-modes">
          {MODE_ORDER.map(m => (
            <button
              key={m}
              className={`cp-mode-pill${mode === m ? ' active' : ''}`}
              onClick={() => { setMode(m); setSelectedIndex(0); inputRef.current?.focus(); }}
            >
              {m === 'files' && <File size={12} />}
              {m === 'commands' && <ChevronRight size={12} />}
              {m === 'grep' && <FileCode2 size={12} />}
              {m === 'sessions' && <MessageSquare size={12} />}
              {MODE_CONFIG[m].label}
            </button>
          ))}
        </div>

        <div className="cp-results" ref={resultsRef}>
          {mode === 'files' && results.map((r, i) => {
            const filename = r.path.split('/').pop() || r.path;
            const dir = r.path.includes('/') ? r.path.slice(0, r.path.lastIndexOf('/') + 1) : './';
            const ext = getExtInfo(filename);
            return (
              <div
                key={r.path}
                className={`cp-result${i === selectedIndex ? ' cp-result-active' : ''}`}
                onClick={() => { setSelectedIndex(i); onFileOpen(projectPath + '/' + r.path); onClose(); }}
                onMouseEnter={() => setSelectedIndex(i)}
              >
                <div className="cp-result-icon" style={{ background: ext.bg, color: ext.fg }}>{ext.label}</div>
                <div className="cp-result-info">
                  <div className="cp-result-name">{highlightFilename(filename, r.matchIndices)}</div>
                  <div className="cp-result-path">{dir}</div>
                </div>
              </div>
            );
          })}

          {mode === 'commands' && commandResults.map((c, i) => (
            <div
              key={c.name}
              className={`cp-result${i === selectedIndex ? ' cp-result-active' : ''}`}
              onClick={() => { onCommand(c.name); onClose(); }}
              onMouseEnter={() => setSelectedIndex(i)}
            >
              <div className="cp-result-icon" style={{ background: 'rgba(199,145,12,0.12)', color: 'var(--accent)' }}>/</div>
              <div className="cp-result-info">
                <div className="cp-result-name">/{c.name}</div>
                {c.description && <div className="cp-result-path">{c.description}</div>}
              </div>
            </div>
          ))}

          {mode === 'grep' && !grepLoading && grepResults.map((r, i) => {
            const filename = r.file.split('/').pop() || r.file;
            const ext = getExtInfo(filename);
            return (
              <div
                key={`${r.file}:${r.line}:${i}`}
                className={`cp-result${i === selectedIndex ? ' cp-result-active' : ''}`}
                onClick={() => { onFileOpen(projectPath + '/' + r.file, r.line); onClose(); }}
                onMouseEnter={() => setSelectedIndex(i)}
              >
                <div className="cp-result-icon" style={{ background: ext.bg, color: ext.fg }}>{ext.label}</div>
                <div className="cp-result-info">
                  <div className="cp-result-name">{filename}<span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>:{r.line}</span></div>
                  <div className="cp-result-path cp-grep-snippet">{highlightGrepMatch(r.text, query)}</div>
                </div>
              </div>
            );
          })}

          {mode === 'grep' && grepLoading && (
            <div className="cp-empty">Searching...</div>
          )}

          {mode === 'grep' && !grepLoading && query.length >= 2 && grepResults.length === 0 && (
            <div className="cp-empty">No results</div>
          )}

          {mode === 'sessions' && sessionResults.map((w, i) => {
            const name = w.projectPath.split('/').pop() || w.projectPath;
            const isActive = w.status === 'active' || w.status === undefined;
            return (
              <div
                key={w.projectPath}
                className={`cp-result${i === selectedIndex ? ' cp-result-active' : ''}`}
                onClick={() => { onWorkspaceSwitch(w.projectPath); onClose(); }}
                onMouseEnter={() => setSelectedIndex(i)}
              >
                <div className="cp-status-dot" style={{ background: isActive ? 'var(--green)' : 'var(--text-muted)' }} />
                <div className="cp-result-info">
                  <div className="cp-result-name">{name}</div>
                  <div className="cp-result-path">{w.projectPath}</div>
                </div>
              </div>
            );
          })}

          {totalResults === 0 && mode !== 'grep' && (
            <div className="cp-empty">No results</div>
          )}
        </div>

        <div className="cp-footer">
          <span><kbd>Tab</kbd> switch mode</span>
          <span><kbd>↑↓</kbd> navigate</span>
          <span><kbd>Enter</kbd> open</span>
          <span><kbd>Esc</kbd> close</span>
        </div>
      </div>

      <style>{`
        .cp-backdrop {
          position: fixed;
          inset: 0;
          background: rgba(0,0,0,0.5);
          backdrop-filter: blur(2px);
          z-index: 9998;
          animation: cp-fade-in 0.15s ease;
        }
        .cp-palette {
          position: fixed;
          top: calc(var(--titlebar-height) + 48px);
          left: 50%;
          transform: translateX(-50%);
          width: 520px;
          background: var(--bg-elevated);
          border: 1px solid var(--border);
          border-radius: 10px;
          box-shadow: 0 16px 48px rgba(0,0,0,0.5);
          z-index: 9999;
          display: flex;
          flex-direction: column;
          animation: cp-drop-in 0.15s ease;
        }
        .cp-input-row {
          padding: 12px 16px;
          border-bottom: 1px solid var(--border);
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .cp-input {
          flex: 1;
          background: none;
          border: none;
          outline: none;
          color: var(--text);
          font-size: 14px;
          font-family: 'Geist', sans-serif;
          caret-color: var(--accent);
        }
        .cp-input::placeholder {
          color: var(--text-muted);
        }
        .cp-modes {
          padding: 6px 16px;
          border-bottom: 1px solid var(--border);
          display: flex;
          gap: 4px;
        }
        .cp-mode-pill {
          font-size: 11px;
          padding: 3px 10px;
          border-radius: 6px;
          color: var(--text-muted);
          background: transparent;
          border: none;
          cursor: pointer;
          font-family: 'Geist Mono', monospace;
          display: flex;
          align-items: center;
          gap: 4px;
        }
        .cp-mode-pill:hover {
          color: var(--text-secondary);
        }
        .cp-mode-pill.active {
          background: rgba(var(--accent-rgb, 199,145,12), 0.12);
          color: var(--accent);
        }
        .cp-results {
          max-height: 320px;
          overflow-y: auto;
          padding: 4px 0;
        }
        .cp-result {
          padding: 8px 16px;
          display: flex;
          align-items: center;
          gap: 10px;
          cursor: pointer;
        }
        .cp-result:hover, .cp-result-active {
          background: rgba(var(--accent-rgb, 199,145,12), 0.08);
        }
        .cp-result-icon {
          width: 28px;
          height: 28px;
          border-radius: 6px;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          font-size: 11px;
          font-weight: 600;
          font-family: 'Geist Mono', monospace;
        }
        .cp-status-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          flex-shrink: 0;
        }
        .cp-result-info {
          flex: 1;
          min-width: 0;
        }
        .cp-result-name {
          font-size: 13px;
          color: var(--text);
          font-family: 'Geist', sans-serif;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .cp-result-name mark {
          background: none;
          color: var(--accent);
          font-weight: 600;
        }
        .cp-result-path {
          font-size: 11px;
          color: var(--text-muted);
          font-family: 'Geist Mono', monospace;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .cp-grep-snippet {
          font-family: 'Geist Mono', monospace;
          font-size: 11px;
        }
        .cp-empty {
          padding: 24px 16px;
          text-align: center;
          color: var(--text-muted);
          font-size: 13px;
        }
        .cp-footer {
          padding: 8px 16px;
          border-top: 1px solid var(--border);
          display: flex;
          gap: 16px;
          font-size: 11px;
          color: var(--text-muted);
          font-family: 'Geist Mono', monospace;
        }
        .cp-footer kbd {
          background: var(--bg-input);
          padding: 1px 5px;
          border-radius: 3px;
          border: 1px solid var(--border);
          color: var(--text-secondary);
          font-size: 10px;
        }
        @keyframes cp-fade-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes cp-drop-in {
          from { opacity: 0; transform: translateX(-50%) translateY(-8px); }
          to { opacity: 1; transform: translateX(-50%) translateY(0); }
        }
        @keyframes cp-spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </>
  );
}
