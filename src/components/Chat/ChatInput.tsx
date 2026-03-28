import { useState, useRef, KeyboardEvent, useEffect } from 'react';
import {
  Plus, Slash, AtSign, FileText, GitBranch, Terminal, Settings,
  MessageSquare, Zap, Send, Square, ShieldCheck, ShieldOff,
  Paperclip, Image,
} from 'lucide-react';

interface ChatInputProps {
  onSend: (message: string) => void;
  disabled?: boolean;
  slashCommands?: string[];
  isStreaming?: boolean;
  onStop?: () => void;
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
  { label: '/compact', value: '/compact', description: 'Compact conversation history', icon: <Zap size={14} /> },
  { label: '/cost', value: '/cost', description: 'Show session cost', icon: <Settings size={14} /> },
];

const ADD_MENU_ITEMS: AutocompleteItem[] = [
  { label: 'Add File', value: '@file ', description: 'Reference a file', icon: <FileText size={14} /> },
  { label: 'Add Image', value: '', description: 'Paste or attach an image', icon: <Image size={14} /> },
  { label: 'Add URL', value: '@url ', description: 'Reference a URL', icon: <AtSign size={14} /> },
];

export default function ChatInput({ onSend, disabled, slashCommands = [], isStreaming, onStop }: ChatInputProps) {
  const [value, setValue] = useState('');
  const [suggestions, setSuggestions] = useState<AutocompleteItem[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [contextItems, setContextItems] = useState<ContextItem[]>([]);
  const [permissionMode, setPermissionMode] = useState<'default' | 'bypass'>('default');
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
      setSuggestions(unique.filter(c => c.label.toLowerCase().startsWith(currentWord)).slice(0, 12));
      setSelectedIndex(0);
    } else {
      setSuggestions([]);
    }
  }, [value, slashCommands, showAddMenu]);

  const applySuggestion = (item: AutocompleteItem) => {
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
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (value.trim()) {
        onSend(value.trim());
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
        setContextItems(prev => [...prev, { label: 'Pasted image', type: 'image' }]);
        return;
      }
    }
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
              {ctx.type === 'image' ? <Image size={12} /> : <FileText size={12} />}
              {ctx.label}
              <button className="context-remove" onClick={() => removeContext(i)}>&times;</button>
            </span>
          ))}
        </div>
      )}

      {/* Main input area */}
      <div className="input-box">
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
            <Plus size={16} />
          </button>
          <button className="toolbar-btn" onClick={() => { setValue(value + '/'); textareaRef.current?.focus(); }} title="Slash commands">
            <Slash size={16} />
          </button>
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
            className="toolbar-btn permission-btn"
            onClick={() => setPermissionMode(p => p === 'default' ? 'bypass' : 'default')}
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
              onClick={() => { if (value.trim()) { onSend(value.trim()); setValue(''); setContextItems([]); } }}
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
          padding: 0 16px 12px;
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
          max-height: 260px;
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
          border: 1px solid var(--border);
          border-radius: 10px;
          overflow: hidden;
        }
        .input-box:focus-within {
          border-color: var(--accent);
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
