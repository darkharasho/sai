import { useState, useRef, KeyboardEvent, useEffect } from 'react';
import { Terminal, FileText, GitBranch, Zap, Settings, MessageSquare, Slash, AtSign } from 'lucide-react';

interface ChatInputProps {
  onSend: (message: string) => void;
  disabled?: boolean;
}

interface AutocompleteItem {
  label: string;
  value: string;
  description: string;
  icon: React.ReactNode;
  type: 'slash' | 'at';
}

const SLASH_COMMANDS: AutocompleteItem[] = [
  { label: '/help', value: '/help', description: 'Show available commands', icon: <MessageSquare size={14} />, type: 'slash' },
  { label: '/clear', value: '/clear', description: 'Clear conversation', icon: <Zap size={14} />, type: 'slash' },
  { label: '/compact', value: '/compact', description: 'Compact conversation history', icon: <Zap size={14} />, type: 'slash' },
  { label: '/init', value: '/init', description: 'Initialize CLAUDE.md', icon: <FileText size={14} />, type: 'slash' },
  { label: '/review', value: '/review', description: 'Review code changes', icon: <GitBranch size={14} />, type: 'slash' },
  { label: '/commit', value: '/commit', description: 'Create a git commit', icon: <GitBranch size={14} />, type: 'slash' },
  { label: '/pr', value: '/pr', description: 'Create a pull request', icon: <GitBranch size={14} />, type: 'slash' },
  { label: '/cost', value: '/cost', description: 'Show session cost', icon: <Settings size={14} />, type: 'slash' },
  { label: '/terminal', value: '/terminal', description: 'Run terminal command', icon: <Terminal size={14} />, type: 'slash' },
];

const AT_MENTIONS: AutocompleteItem[] = [
  { label: '@file', value: '@', description: 'Reference a file', icon: <FileText size={14} />, type: 'at' },
  { label: '@folder', value: '@', description: 'Reference a folder', icon: <FileText size={14} />, type: 'at' },
  { label: '@url', value: '@', description: 'Reference a URL', icon: <AtSign size={14} />, type: 'at' },
  { label: '@git', value: '@git', description: 'Reference git context', icon: <GitBranch size={14} />, type: 'at' },
];

export default function ChatInput({ onSend, disabled }: ChatInputProps) {
  const [value, setValue] = useState('');
  const [suggestions, setSuggestions] = useState<AutocompleteItem[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Update autocomplete suggestions based on input
  useEffect(() => {
    const cursorPos = textareaRef.current?.selectionStart ?? value.length;
    const textBeforeCursor = value.slice(0, cursorPos);

    // Find the current "word" being typed (after last space or start)
    const lastSpace = textBeforeCursor.lastIndexOf(' ');
    const lastNewline = textBeforeCursor.lastIndexOf('\n');
    const wordStart = Math.max(lastSpace, lastNewline) + 1;
    const currentWord = textBeforeCursor.slice(wordStart).toLowerCase();

    if (currentWord.startsWith('/')) {
      const query = currentWord;
      const matches = SLASH_COMMANDS.filter(c => c.label.toLowerCase().startsWith(query));
      setSuggestions(matches);
      setSelectedIndex(0);
    } else if (currentWord.startsWith('@')) {
      const query = currentWord;
      const matches = AT_MENTIONS.filter(c => c.label.toLowerCase().startsWith(query));
      setSuggestions(matches);
      setSelectedIndex(0);
    } else {
      setSuggestions([]);
    }
  }, [value]);

  const applySuggestion = (item: AutocompleteItem) => {
    const cursorPos = textareaRef.current?.selectionStart ?? value.length;
    const textBeforeCursor = value.slice(0, cursorPos);
    const lastSpace = textBeforeCursor.lastIndexOf(' ');
    const lastNewline = textBeforeCursor.lastIndexOf('\n');
    const wordStart = Math.max(lastSpace, lastNewline) + 1;
    const before = value.slice(0, wordStart);
    const after = value.slice(cursorPos);
    setValue(before + item.value + ' ' + after);
    setSuggestions([]);
    textareaRef.current?.focus();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Autocomplete navigation
    if (suggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex(prev => Math.min(prev + 1, suggestions.length - 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex(prev => Math.max(prev - 1, 0));
        return;
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
        e.preventDefault();
        applySuggestion(suggestions[selectedIndex]);
        return;
      }
      if (e.key === 'Escape') {
        setSuggestions([]);
        return;
      }
    }

    // Send message
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (value.trim()) {
        onSend(value.trim());
        setValue('');
        setSuggestions([]);
      }
    }
  };

  return (
    <div className="chat-input-area">
      {suggestions.length > 0 && (
        <div className="autocomplete-dropdown" ref={dropdownRef}>
          {suggestions.map((item, i) => (
            <div
              key={item.label}
              className={`autocomplete-item ${i === selectedIndex ? 'selected' : ''}`}
              onClick={() => applySuggestion(item)}
              onMouseEnter={() => setSelectedIndex(i)}
            >
              <span className="autocomplete-icon">{item.icon}</span>
              <span className="autocomplete-label">{item.label}</span>
              <span className="autocomplete-desc">{item.description}</span>
            </div>
          ))}
        </div>
      )}
      <textarea
        ref={textareaRef}
        className="chat-input"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Message Claude... (/ for commands, @ for mentions)"
        rows={3}
        disabled={disabled}
      />
      <style>{`
        .chat-input-area {
          padding: 8px 16px 16px;
          position: relative;
        }
        .chat-input {
          width: 100%;
          background: var(--bg-input);
          border: 1px solid var(--border);
          border-radius: 8px;
          color: var(--text);
          padding: 10px 14px;
          font-family: inherit;
          font-size: 13px;
          resize: none;
          outline: none;
        }
        .chat-input:focus { border-color: var(--accent); }
        .chat-input:disabled { opacity: 0.5; }

        .autocomplete-dropdown {
          position: absolute;
          bottom: 100%;
          left: 16px;
          right: 16px;
          background: var(--bg-elevated);
          border: 1px solid var(--border);
          border-radius: 8px;
          margin-bottom: 4px;
          max-height: 240px;
          overflow-y: auto;
          box-shadow: 0 -4px 16px rgba(0,0,0,0.3);
          z-index: 50;
        }
        .autocomplete-item {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px 12px;
          cursor: pointer;
          font-size: 13px;
        }
        .autocomplete-item:hover,
        .autocomplete-item.selected {
          background: var(--bg-hover);
        }
        .autocomplete-icon {
          color: var(--accent);
          flex-shrink: 0;
          display: flex;
        }
        .autocomplete-label {
          font-family: 'JetBrains Mono', monospace;
          font-size: 12px;
          color: var(--text);
          font-weight: 500;
        }
        .autocomplete-desc {
          font-size: 12px;
          color: var(--text-muted);
          flex: 1;
          text-align: right;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
      `}</style>
    </div>
  );
}
