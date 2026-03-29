import { useState, useRef, KeyboardEvent, useEffect } from 'react';
import {
  SquarePlus, Slash, SquareSlash, AtSign, FileText, GitBranch, Terminal, Settings,
  MessageSquare, Zap, Send, Square, ShieldCheck, ShieldOff,
  Paperclip, Image,
} from 'lucide-react';

interface ChatInputProps {
  onSend: (message: string, images?: string[]) => void;
  disabled?: boolean;
  slashCommands?: string[];
  isStreaming?: boolean;
  onStop?: () => void;
  permissionMode: 'default' | 'bypass';
  onPermissionChange: (mode: 'default' | 'bypass') => void;
  contextUsage?: { used: number; total: number };
}

interface AutocompleteItem {
  label: string;
  value: string;
  description: string;
  icon: React.ReactNode;
}

interface ContextItem {
  label: string;
  type: 'file' | 'url' | 'image';
  data?: string; // base64 data for images, path for files
}

function getCommandIcon(name: string): React.ReactNode {
  if (name.includes('commit') || name.includes('git') || name.includes('pr') || name.includes('review') || name.includes('clean_gone')) return <GitBranch size={14} />;
  if (name.includes('terminal') || name.includes('debug') || name.includes('bash')) return <Terminal size={14} />;
  if (name.includes('file') || name.includes('init') || name.includes('claude-md') || name.includes('revise')) return <FileText size={14} />;
  if (name.includes('config') || name.includes('setting') || name.includes('cost')) return <Settings size={14} />;
  return <Slash size={14} />;
}

const BUILTIN_COMMANDS: AutocompleteItem[] = [
  { label: '/help', value: '/help', description: 'Show available commands', icon: <MessageSquare size={14} /> },
  { label: '/clear', value: '/clear', description: 'Clear conversation', icon: <Zap size={14} /> },
];

const ADD_MENU_ITEMS: AutocompleteItem[] = [
  { label: 'Add File', value: '@file ', description: 'Reference a file', icon: <FileText size={14} /> },
  { label: 'Add Image', value: '__IMAGE__', description: 'Attach an image', icon: <Image size={14} /> },
  { label: 'Add URL', value: '@url ', description: 'Reference a URL', icon: <AtSign size={14} /> },
];

function ContextRing({ used, total, onClick }: { used: number; total: number; onClick?: () => void }) {
  const pct = Math.min((used / total) * 100, 100);
  const radius = 9;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (pct / 100) * circumference;
  const color = pct > 80 ? 'var(--red)' : pct > 50 ? 'var(--orange)' : 'var(--accent)';

  return (
    <button
      className="context-ring"
      title={`Context: ${Math.round(pct)}% — Click to compact`}
      onClick={onClick}
    >
      <svg width="24" height="24" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r={radius} fill="none" stroke="var(--bg-hover)" strokeWidth="2.5" />
        <circle
          cx="12" cy="12" r={radius} fill="none"
          stroke={color} strokeWidth="2.5"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform="rotate(-90 12 12)"
          style={{ transition: 'stroke-dashoffset 0.5s ease' }}
        />
      </svg>
      <span className="context-ring-label">{Math.round(pct)}%</span>
    </button>
  );
}

export default function ChatInput({ onSend, disabled, slashCommands = [], isStreaming, onStop, permissionMode, onPermissionChange, contextUsage }: ChatInputProps) {
  const [value, setValue] = useState('');
  const [suggestions, setSuggestions] = useState<AutocompleteItem[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [contextItems, setContextItems] = useState<ContextItem[]>([]);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [tickerDir, setTickerDir] = useState<'up' | 'down' | null>(null);
  const draftRef = useRef('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Close menus on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setSuggestions([]);
        setShowAddMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Autocomplete
  useEffect(() => {
    if (showAddMenu) { setSuggestions([]); return; }
    const cursorPos = textareaRef.current?.selectionStart ?? value.length;
    const textBeforeCursor = value.slice(0, cursorPos);
    const lastSpace = textBeforeCursor.lastIndexOf(' ');
    const lastNewline = textBeforeCursor.lastIndexOf('\n');
    const wordStart = Math.max(lastSpace, lastNewline) + 1;
    const currentWord = textBeforeCursor.slice(wordStart).toLowerCase();

    if (currentWord.startsWith('/')) {
      const dynamicCommands: AutocompleteItem[] = slashCommands.map(name => ({
        label: `/${name}`,
        value: `/${name}`,
        description: name.includes(':') ? name.split(':')[0] : '',
        icon: getCommandIcon(name),
      }));
      const all = [...BUILTIN_COMMANDS, ...dynamicCommands];
      const seen = new Set<string>();
      const unique = all.filter(c => { if (seen.has(c.label)) return false; seen.add(c.label); return true; });
      setSuggestions(unique.filter(c => c.label.toLowerCase().startsWith(currentWord)));
      setSelectedIndex(0);
    } else {
      setSuggestions([]);
    }
  }, [value, slashCommands, showAddMenu]);

  const applySuggestion = (item: AutocompleteItem) => {
    if (item.value === '__IMAGE__') { handleAddImage(); setSuggestions([]); setShowAddMenu(false); return; }
    if (!item.value) { setSuggestions([]); setShowAddMenu(false); return; }
    const cursorPos = textareaRef.current?.selectionStart ?? value.length;
    const textBeforeCursor = value.slice(0, cursorPos);
    const lastSpace = textBeforeCursor.lastIndexOf(' ');
    const lastNewline = textBeforeCursor.lastIndexOf('\n');
    const wordStart = Math.max(lastSpace, lastNewline) + 1;
    const before = value.slice(0, wordStart);
    const after = value.slice(cursorPos);
    setValue(before + item.value + ' ' + after);
    setSuggestions([]);
    setShowAddMenu(false);
    textareaRef.current?.focus();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    const items = showAddMenu ? ADD_MENU_ITEMS : suggestions;
    if (items.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIndex(p => Math.min(p + 1, items.length - 1)); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIndex(p => Math.max(p - 1, 0)); return; }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
        e.preventDefault();
        applySuggestion(items[selectedIndex]);
        return;
      }
      if (e.key === 'Escape') { setSuggestions([]); setShowAddMenu(false); return; }
    }
    // History navigation (only when no dropdown is open)
    if (e.key === 'ArrowUp' && items.length === 0) {
      const ta = textareaRef.current;
      const atFirstLine = !ta || ta.selectionStart === 0 || !value.slice(0, ta.selectionStart).includes('\n');
      if (atFirstLine && history.length > 0) {
        e.preventDefault();
        if (historyIndex === -1) draftRef.current = value;
        const next = historyIndex === -1 ? history.length - 1 : Math.max(historyIndex - 1, 0);
        setHistoryIndex(next);
        setValue(history[next]);
        setTickerDir('up');
        setTimeout(() => setTickerDir(null), 200);
        return;
      }
    }
    if (e.key === 'ArrowDown' && items.length === 0) {
      const ta = textareaRef.current;
      const atLastLine = !ta || ta.selectionEnd === value.length || !value.slice(ta.selectionEnd).includes('\n');
      if (atLastLine && historyIndex !== -1) {
        e.preventDefault();
        const next = historyIndex + 1;
        if (next >= history.length) {
          setHistoryIndex(-1);
          setValue(draftRef.current);
        } else {
          setHistoryIndex(next);
          setValue(history[next]);
        }
        setTickerDir('down');
        setTimeout(() => setTickerDir(null), 200);
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (value.trim()) {
        setHistory(prev => {
          const trimmed = value.trim();
          if (prev[prev.length - 1] === trimmed) return prev;
          return [...prev, trimmed];
        });
        setHistoryIndex(-1);
        draftRef.current = '';
        const images = contextItems.filter(c => c.type === 'image' && c.data).map(c => c.data!);
        onSend(value.trim(), images.length > 0 ? images : undefined);
        setValue('');
        setContextItems([]);
        setSuggestions([]);
      }
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    for (const item of e.clipboardData.items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const blob = item.getAsFile();
        if (blob) {
          const reader = new FileReader();
          reader.onload = () => {
            const base64 = reader.result as string;
            setContextItems(prev => [...prev, {
              label: `Image (${Math.round(blob.size / 1024)}KB)`,
              type: 'image',
              data: base64,
            }]);
          };
          reader.readAsDataURL(blob);
        }
        return;
      }
    }
  };

  const handleAddImage = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => {
      const file = input.files?.[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = () => {
          const base64 = reader.result as string;
          setContextItems(prev => [...prev, {
            label: file.name,
            type: 'image',
            data: base64,
          }]);
        };
        reader.readAsDataURL(file);
      }
    };
    input.click();
  };

  const removeContext = (index: number) => {
    setContextItems(prev => prev.filter((_, i) => i !== index));
  };

  const dropdownItems = showAddMenu ? ADD_MENU_ITEMS : suggestions;

  return (
    <div className="input-wrapper" ref={wrapperRef}>
      {/* Autocomplete / Add Menu dropdown */}
      {dropdownItems.length > 0 && (
        <div className="autocomplete-dropdown">
          {dropdownItems.map((item, i) => (
            <div
              key={item.label}
              className={`autocomplete-item ${i === selectedIndex ? 'selected' : ''}`}
              onClick={() => applySuggestion(item)}
              onMouseEnter={() => setSelectedIndex(i)}
            >
              <span className="ac-icon">{item.icon}</span>
              <span className="ac-label">{item.label}</span>
              <span className="ac-desc">{item.description}</span>
            </div>
          ))}
        </div>
      )}

      {/* Context items row */}
      {contextItems.length > 0 && (
        <div className="context-row">
          {contextItems.map((ctx, i) => (
            <span key={i} className="context-chip">
              {ctx.type === 'image' && ctx.data ? (
                <img src={ctx.data} alt={ctx.label} className="context-thumb" />
              ) : (
                <FileText size={12} />
              )}
              {ctx.label}
              <button className="context-remove" onClick={() => removeContext(i)}>&times;</button>
            </span>
          ))}
        </div>
      )}

      {/* Main input area */}
      <div className={`input-box ${tickerDir ? `ticker-${tickerDir}` : ''}`}>
        <textarea
          ref={textareaRef}
          className="chat-textarea"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder={isStreaming ? 'Queue another message...' : 'Message Claude...'}
          rows={2}
          disabled={disabled}
        />
      </div>

      {/* Toolbar row */}
      <div className="input-toolbar">
        <div className="toolbar-left">
          <button className="toolbar-btn" onClick={() => { setShowAddMenu(!showAddMenu); setSelectedIndex(0); }} title="Add context">
            <SquarePlus size={18} />
          </button>
          <button className="toolbar-btn" onClick={() => { setValue(value + '/'); textareaRef.current?.focus(); }} title="Slash commands">
            <SquareSlash size={18} />
          </button>
          {contextUsage && <ContextRing used={contextUsage.used} total={contextUsage.total} onClick={() => onSend('/compact')} />}
        </div>

        <div className="toolbar-center">
          {contextItems.map((ctx, i) => (
            <span key={i} className="toolbar-context-chip">
              <Paperclip size={12} />
              {ctx.label}
            </span>
          ))}
        </div>

        <div className="toolbar-right">
          <button
            className={`toolbar-btn permission-btn ${permissionMode === 'bypass' ? 'bypass-active' : ''}`}
            onClick={() => onPermissionChange(permissionMode === 'default' ? 'bypass' : 'default')}
            title={permissionMode === 'default' ? 'Default permissions' : 'Bypass permissions'}
          >
            {permissionMode === 'default'
              ? <><ShieldCheck size={14} /> <span className="permission-label">Default Approvals</span></>
              : <><ShieldOff size={14} /> <span className="permission-label">Bypass</span></>
            }
          </button>

          {isStreaming ? (
            <button className="send-btn stop-btn" onClick={onStop} title="Stop">
              <Square size={16} fill="currentColor" />
            </button>
          ) : (
            <button
              className="send-btn"
              onClick={() => {
                if (value.trim()) {
                  setHistory(prev => {
                    const trimmed = value.trim();
                    if (prev[prev.length - 1] === trimmed) return prev;
                    return [...prev, trimmed];
                  });
                  setHistoryIndex(-1);
                  draftRef.current = '';
                  const images = contextItems.filter(c => c.type === 'image' && c.data).map(c => c.data!);
                  onSend(value.trim(), images.length > 0 ? images : undefined);
                  setValue('');
                  setContextItems([]);
                }
              }}
              disabled={disabled || !value.trim()}
              title="Send"
            >
              <Send size={16} />
            </button>
          )}
        </div>
      </div>

      <style>{`
        .input-wrapper {
          padding: 0 15% 12px;
          position: relative;
        }
        .autocomplete-dropdown {
          position: absolute;
          bottom: 100%;
          left: 16px;
          right: 16px;
          background: var(--bg-elevated);
          border: 1px solid var(--border);
          border-radius: 8px;
          margin-bottom: 4px;
          max-height: 400px;
          overflow-y: auto;
          box-shadow: 0 -4px 16px rgba(0,0,0,0.3);
          z-index: 50;
        }
        .autocomplete-item {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 7px 12px;
          cursor: pointer;
          font-size: 13px;
        }
        .autocomplete-item:hover, .autocomplete-item.selected {
          background: var(--bg-hover);
        }
        .ac-icon { color: var(--accent); flex-shrink: 0; display: flex; }
        .ac-label { font-family: 'JetBrains Mono', monospace; font-size: 12px; color: var(--text); }
        .ac-desc { font-size: 11px; color: var(--text-muted); flex: 1; text-align: right; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

        .context-row {
          display: flex;
          flex-wrap: wrap;
          gap: 4px;
          padding: 6px 8px 0;
        }
        .context-chip {
          display: flex;
          align-items: center;
          gap: 4px;
          background: var(--bg-hover);
          border-radius: 4px;
          padding: 2px 8px;
          font-size: 11px;
          color: var(--text-secondary);
        }
        .context-thumb {
          width: 20px;
          height: 20px;
          object-fit: cover;
          border-radius: 3px;
          flex-shrink: 0;
        }
        .context-remove {
          background: none;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
          padding: 0 2px;
          font-size: 14px;
        }

        .input-box {
          background: var(--bg-input);
          border: 1px solid var(--accent);
          border-radius: 10px;
          overflow: hidden;
        }
        .input-box.ticker-up .chat-textarea {
          animation: ticker-slide-up 0.2s ease-out;
        }
        .input-box.ticker-down .chat-textarea {
          animation: ticker-slide-down 0.2s ease-out;
        }
        @keyframes ticker-slide-up {
          0% { transform: translateY(8px); opacity: 0.3; }
          100% { transform: translateY(0); opacity: 1; }
        }
        @keyframes ticker-slide-down {
          0% { transform: translateY(-8px); opacity: 0.3; }
          100% { transform: translateY(0); opacity: 1; }
        }
        .chat-textarea {
          width: 100%;
          background: transparent;
          border: none;
          color: var(--text);
          padding: 10px 14px;
          font-family: inherit;
          font-size: 13px;
          resize: none;
          outline: none;
          min-height: 44px;
          max-height: 200px;
        }
        .chat-textarea:disabled { opacity: 0.5; }

        .input-toolbar {
          display: flex;
          align-items: center;
          padding: 6px 4px 0;
          gap: 4px;
        }
        .toolbar-left, .toolbar-right {
          display: flex;
          align-items: center;
          gap: 2px;
        }
        .toolbar-center {
          flex: 1;
          display: flex;
          gap: 4px;
          overflow-x: auto;
        }
        .toolbar-context-chip {
          display: flex;
          align-items: center;
          gap: 3px;
          font-size: 11px;
          color: var(--text-muted);
          background: var(--bg-hover);
          padding: 2px 6px;
          border-radius: 3px;
          white-space: nowrap;
        }
        .context-ring {
          display: flex;
          align-items: center;
          gap: 4px;
          margin-left: 4px;
          background: none;
          border: none;
          padding: 2px;
          border-radius: 4px;
          cursor: pointer;
        }
        .context-ring:hover {
          background: var(--bg-hover);
        }
        .context-ring-label {
          font-size: 11px;
          color: var(--text-muted);
          font-family: 'JetBrains Mono', monospace;
          font-weight: 500;
        }
        .toolbar-btn {
          background: none;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
          padding: 4px;
          border-radius: 4px;
          display: flex;
          align-items: center;
          gap: 4px;
        }
        .toolbar-btn:hover {
          color: var(--text);
          background: var(--bg-hover);
        }
        .permission-btn {
          font-size: 11px;
          padding: 3px 8px;
          border: 1px solid transparent;
          transition: all 0.15s;
        }
        .permission-btn.bypass-active {
          color: var(--red);
          border-color: var(--red);
          background: rgba(227, 85, 53, 0.1);
        }
        .permission-btn.bypass-active:hover {
          background: rgba(227, 85, 53, 0.2);
        }
        .permission-label {
          font-size: 11px;
        }

        .send-btn {
          background: var(--accent);
          border: none;
          color: #000;
          cursor: pointer;
          padding: 6px;
          border-radius: 6px;
          display: flex;
          align-items: center;
          justify-content: center;
          margin-left: 4px;
        }
        .send-btn:hover { background: var(--accent-hover); }
        .send-btn:disabled { opacity: 0.3; cursor: not-allowed; }
        .stop-btn {
          background: var(--red);
          color: #fff;
        }
        .stop-btn:hover { background: #ff6b4f; }
      `}</style>
    </div>
  );
}
