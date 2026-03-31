import { useState, useRef, KeyboardEvent, useEffect } from 'react';
import type { PendingApproval } from '../../types';
import ApprovalPanel from './ApprovalPanel';
import {
  SquarePlus, Slash, SquareSlash, AtSign, FileText, GitBranch, Terminal as TerminalIcon, Settings,
  MessageSquare, Zap, Send, Square, ShieldCheck, ShieldOff,
  Paperclip, Image, ChevronDown, Minus, ChevronUp, ChevronsUp, Clock, Check, EyeOff,
} from 'lucide-react';
import { getTerminalContent } from '../../terminalBuffer';

type EffortLevel = 'low' | 'medium' | 'high' | 'max';
type ModelChoice = 'sonnet' | 'opus' | 'haiku';

interface ChatInputProps {
  onSend: (message: string, images?: string[]) => void;
  disabled?: boolean;
  slashCommands?: string[];
  isStreaming?: boolean;
  onStop?: () => void;
  permissionMode: 'default' | 'bypass';
  onPermissionChange: (mode: 'default' | 'bypass') => void;
  effortLevel: EffortLevel;
  onEffortChange: (level: EffortLevel) => void;
  modelChoice: ModelChoice;
  onModelChange: (model: ModelChoice) => void;
  contextUsage?: { used: number; total: number; inputTokens: number; cacheReadTokens: number; cacheCreationTokens: number; outputTokens: number };
  sessionUsage?: { inputTokens: number; outputTokens: number };
  sessionCost?: number;
  rateLimits?: Map<string, { rateLimitType: string; resetsAt: number; status: string; isUsingOverage: boolean; overageResetsAt: number; utilization?: number }>;
  billingMode?: 'subscription' | 'api';
  activeFilePath?: string | null;
  fileContextEnabled?: boolean;
  onFileContextToggle?: () => void;
  aiProvider?: 'claude' | 'codex' | 'gemini';
  pendingApproval?: PendingApproval | null;
  onApprove?: (modifiedCommand?: string) => void;
  onDeny?: () => void;
  onAlwaysAllow?: () => void;
  codexModel?: string;
  codexModels?: { id: string; name: string }[];
  onCodexModelChange?: (model: string) => void;
  codexPermission?: 'auto' | 'read-only' | 'full-access';
  onCodexPermissionChange?: (perm: 'auto' | 'read-only' | 'full-access') => void;
  geminiModel?: string;
  geminiModels?: { id: string; name: string }[];
  onGeminiModelChange?: (model: string) => void;
  geminiApprovalMode?: 'default' | 'auto_edit' | 'yolo' | 'plan';
  onGeminiApprovalModeChange?: (mode: 'default' | 'auto_edit' | 'yolo' | 'plan') => void;
  geminiConversationMode?: 'planning' | 'fast';
  onGeminiConversationModeChange?: (mode: 'planning' | 'fast') => void;
}

interface AutocompleteItem {
  label: string;
  value: string;
  description: string;
  icon: React.ReactNode;
}

interface ContextItem {
  label: string;
  type: 'file' | 'url' | 'image' | 'terminal';
  data?: string; // base64 data for images, path for files, content for terminal
}

function getCommandIcon(name: string): React.ReactNode {
  if (name.includes('commit') || name.includes('git') || name.includes('pr') || name.includes('review') || name.includes('clean_gone')) return <GitBranch size={14} />;
  if (name.includes('terminal') || name.includes('debug') || name.includes('bash')) return <TerminalIcon size={14} />;
  if (name.includes('file') || name.includes('init') || name.includes('claude-md') || name.includes('revise')) return <FileText size={14} />;
  if (name.includes('config') || name.includes('setting') || name.includes('cost')) return <Settings size={14} />;
  return <Slash size={14} />;
}

const BUILTIN_COMMANDS: AutocompleteItem[] = [
  { label: '/help', value: '/help', description: 'Show available commands', icon: <MessageSquare size={14} /> },
  { label: '/clear', value: '/clear', description: 'Clear conversation', icon: <Zap size={14} /> },
];

const ADD_MENU_ITEMS: AutocompleteItem[] = [
  { label: 'Add Terminal', value: '__TERMINAL__', description: 'Attach terminal output', icon: <TerminalIcon size={14} /> },
  { label: 'Add File', value: '__FILE__', description: 'Attach a file', icon: <FileText size={14} /> },
  { label: 'Add Image', value: '__IMAGE__', description: 'Attach an image', icon: <Image size={14} /> },
  { label: 'Add URL', value: '@url ', description: 'Reference a URL', icon: <AtSign size={14} /> },
];

const EFFORT_CONFIG: Record<EffortLevel, { icon: typeof ChevronDown; label: string; color: string; next: EffortLevel }> = {
  low:    { icon: ChevronDown, label: 'Lo', color: 'var(--text-muted)', next: 'medium' },
  medium: { icon: Minus,       label: 'Med', color: 'var(--text-secondary)', next: 'high' },
  high:   { icon: ChevronUp,   label: 'Hi', color: 'var(--accent)', next: 'max' },
  max:    { icon: ChevronsUp,  label: 'Max', color: 'var(--orange)', next: 'low' },
};

const MODEL_OPTIONS: { id: ModelChoice; label: string; description: string; color: string; recommended?: boolean }[] = [
  { id: 'sonnet',  label: 'Sonnet',  description: 'Claude Sonnet 4.5 · Best for everyday tasks', color: 'var(--accent)', recommended: true },
  { id: 'opus',    label: 'Opus',    description: 'Claude Opus 4 · Most capable for complex work', color: 'var(--orange)' },
  { id: 'haiku',   label: 'Haiku',   description: 'Claude Haiku 3.5 · Fastest for quick answers', color: 'var(--green)' },
];


function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return `${n}`;
}

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

function formatResetTime(resetsAt: number, style: 'relative' | 'absolute' = 'relative'): string {
  const resetDate = new Date(resetsAt * 1000);
  if (style === 'absolute') {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const day = days[resetDate.getDay()];
    const h = resetDate.getHours();
    const m = resetDate.getMinutes();
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 || 12;
    return `${day} ${h12}:${m.toString().padStart(2, '0')} ${ampm}`;
  }
  const diffMs = resetsAt * 1000 - Date.now();
  const diffH = Math.max(0, Math.floor(diffMs / 3600000));
  const diffM = Math.max(0, Math.floor((diffMs % 3600000) / 60000));
  if (diffH > 0) return `${diffH} hr ${diffM} min`;
  return `${diffM} min`;
}

// Use the CLI's utilization field (0.0–1.0) when available for accurate usage %.
// Falls back to 0 if not provided (better than hiding the bar entirely).
function getRateLimitProgress(rl: { rateLimitType: string; resetsAt: number; status: string; utilization?: number }): number {
  if (rl.status === 'rejected') return 1;
  if (rl.utilization !== undefined) return Math.min(Math.max(rl.utilization, 0), 1);
  return 0;
}

function UsageBar({ pct, color, label, sublabel, tag }: { pct: number; color: string; label: string; sublabel: string; tag?: string }) {
  const isUnknown = pct < 0;
  return (
    <div className="usage-bar-row">
      <div className="usage-bar-info">
        <span className="usage-bar-label">{label}{tag && <span className="usage-bar-tag" style={{ color }}>{tag}</span>}</span>
        <span className="usage-bar-sublabel">{sublabel}</span>
      </div>
      <div className="usage-bar-track">
        {!isUnknown && (
          <div
            className="usage-bar-fill"
            style={{ width: `${Math.min(pct, 100)}%`, background: color }}
          />
        )}
      </div>
      {!isUnknown && <span className="usage-bar-pct">{Math.round(pct)}% used</span>}
    </div>
  );
}

function getRateLimitLabel(type: string): string {
  if (type === 'five_hour') return 'Current session';
  if (type === 'seven_day' || type === 'weekly') return 'All models';
  if (type === 'daily') return 'Daily';
  if (type === 'monthly') return 'Monthly';
  // e.g. "weekly_sonnet" → "Sonnet only"
  if (type.startsWith('weekly_') || type.startsWith('seven_day_')) {
    const model = type.replace(/^(weekly_|seven_day_)/, '');
    return `${model.charAt(0).toUpperCase() + model.slice(1)} only`;
  }
  return type.replace(/_/g, ' ');
}

function isWeeklyLimit(type: string): boolean {
  return type === 'weekly' || type === 'seven_day' || type === 'monthly' ||
    type.startsWith('weekly_') || type.startsWith('seven_day_');
}

function getBarColor(pct: number, isOverage: boolean): string {
  if (isOverage) return 'var(--orange)';
  if (pct > 80) return 'var(--red)';
  if (pct > 50) return 'var(--orange)';
  return 'var(--accent)';
}

export default function ChatInput({ onSend, disabled, slashCommands = [], isStreaming, onStop, permissionMode, onPermissionChange, effortLevel, onEffortChange, modelChoice, onModelChange, contextUsage, sessionUsage, sessionCost, rateLimits, billingMode = 'subscription', activeFilePath, fileContextEnabled = true, onFileContextToggle, aiProvider = 'claude', pendingApproval, onApprove, onDeny, onAlwaysAllow, codexModel = 'o3', codexModels = [], onCodexModelChange, codexPermission = 'auto', onCodexPermissionChange, geminiModel = 'auto-gemini-3', geminiModels = [], onGeminiModelChange, geminiApprovalMode = 'default', onGeminiApprovalModeChange, geminiConversationMode = 'planning', onGeminiConversationModeChange }: ChatInputProps) {
  const [value, setValue] = useState('');
  const [suggestions, setSuggestions] = useState<AutocompleteItem[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [contextItems, setContextItems] = useState<ContextItem[]>([]);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [tickerDir, setTickerDir] = useState<'up' | 'down' | null>(null);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [slashMenuOpen, setSlashMenuOpen] = useState(false);
  const draftRef = useRef('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const modelMenuRef = useRef<HTMLDivElement>(null);

  // Close menus on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setSuggestions([]);
        setShowAddMenu(false);
        setSlashMenuOpen(false);
      }
      if (modelMenuRef.current && !modelMenuRef.current.contains(e.target as Node)) {
        setModelMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Always focus textarea on mount (workspace switch remounts via key change)
  useEffect(() => {
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, []);

  // Re-focus when input becomes enabled (e.g. after streaming ends)
  useEffect(() => {
    if (!disabled) {
      const id = setTimeout(() => textareaRef.current?.focus(), 50);
      return () => clearTimeout(id);
    }
  }, [disabled]);

  // Autocomplete
  useEffect(() => {
    if (showAddMenu) { setSuggestions([]); return; }

    const dynamicCommands: AutocompleteItem[] = slashCommands.map(name => ({
      label: `/${name}`,
      value: `/${name}`,
      description: name.includes(':') ? name.split(':')[0] : '',
      icon: getCommandIcon(name),
    }));
    const all = [...BUILTIN_COMMANDS, ...dynamicCommands];
    const seen = new Set<string>();
    const unique = all.filter(c => { if (seen.has(c.label)) return false; seen.add(c.label); return true; });

    // Slash menu button was clicked — show all commands
    if (slashMenuOpen) {
      setSuggestions(unique);
      setSelectedIndex(0);
      return;
    }

    const cursorPos = textareaRef.current?.selectionStart ?? value.length;
    const textBeforeCursor = value.slice(0, cursorPos);
    const lastSpace = textBeforeCursor.lastIndexOf(' ');
    const lastNewline = textBeforeCursor.lastIndexOf('\n');
    const wordStart = Math.max(lastSpace, lastNewline) + 1;
    const currentWord = textBeforeCursor.slice(wordStart).toLowerCase();

    if (currentWord.startsWith('@') && currentWord.length > 1) {
      // Show @terminal suggestion when user types @t, @te, @terminal, etc.
      const query = currentWord.slice(1);
      const atItems: AutocompleteItem[] = [];
      if ('terminal'.startsWith(query)) {
        atItems.push({ label: '@terminal', value: '__TERMINAL__', description: 'Attach terminal output', icon: <TerminalIcon size={14} /> });
      }
      setSuggestions(atItems);
      setSelectedIndex(0);
    } else if (currentWord.startsWith('/')) {
      const query = currentWord.slice(1); // without the leading /
      setSuggestions(unique.filter(c => {
        const full = c.label.toLowerCase();
        if (full.startsWith(currentWord)) return true;
        // Match against short name after `:` (e.g., /brainstorm matches /superpowers:brainstorming)
        const colonIdx = full.indexOf(':');
        if (colonIdx !== -1 && full.slice(colonIdx + 1).startsWith(query)) return true;
        // Also fuzzy: match anywhere in the label
        if (query.length >= 2 && full.includes(query)) return true;
        return false;
      }));
      setSelectedIndex(0);
    } else {
      setSuggestions([]);
    }
  }, [value, slashCommands, showAddMenu, slashMenuOpen]);

  const handleAddTerminal = () => {
    const content = getTerminalContent();
    if (content) {
      setContextItems(prev => {
        // Replace existing terminal context if any
        const filtered = prev.filter(c => c.type !== 'terminal');
        const lines = content.split('\n').length;
        return [...filtered, {
          label: `Terminal (${lines} lines)`,
          type: 'terminal',
          data: content,
        }];
      });
    }
  };

  const applySuggestion = (item: AutocompleteItem) => {
    if (item.value === '__TERMINAL__') {
      // Remove the @terminal text the user typed
      if (!showAddMenu) {
        const cursorPos = textareaRef.current?.selectionStart ?? value.length;
        const textBeforeCursor = value.slice(0, cursorPos);
        const lastSpace = textBeforeCursor.lastIndexOf(' ');
        const lastNewline = textBeforeCursor.lastIndexOf('\n');
        const wordStart = Math.max(lastSpace, lastNewline) + 1;
        const before = value.slice(0, wordStart);
        const after = value.slice(cursorPos);
        setValue((before + after).trim() ? before + after : '');
      }
      handleAddTerminal();
      setSuggestions([]);
      setShowAddMenu(false);
      setSlashMenuOpen(false);
      return;
    }
    if (item.value === '__FILE__') { handleAddFile(); setSuggestions([]); setShowAddMenu(false); setSlashMenuOpen(false); return; }
    if (item.value === '__IMAGE__') { handleAddImage(); setSuggestions([]); setShowAddMenu(false); setSlashMenuOpen(false); return; }
    if (!item.value) { setSuggestions([]); setShowAddMenu(false); setSlashMenuOpen(false); return; }

    // If opened via slash menu button (no `/` typed), insert the full command
    if (slashMenuOpen) {
      setValue(item.value + ' ');
      setSuggestions([]);
      setSlashMenuOpen(false);
      textareaRef.current?.focus();
      return;
    }

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
      if (e.key === 'Escape') { setSuggestions([]); setShowAddMenu(false); setSlashMenuOpen(false); return; }
    }
    // Tab completion for slash commands even when suggestions haven't rendered yet
    if (e.key === 'Tab' && items.length === 0) {
      const cursorPos = textareaRef.current?.selectionStart ?? value.length;
      const textBeforeCursor = value.slice(0, cursorPos);
      const lastSep = Math.max(textBeforeCursor.lastIndexOf(' '), textBeforeCursor.lastIndexOf('\n'));
      const currentWord = textBeforeCursor.slice(lastSep + 1).toLowerCase();
      if (currentWord.startsWith('/') && currentWord.length > 1) {
        const query = currentWord.slice(1);
        const dynamicCommands: AutocompleteItem[] = slashCommands.map(name => ({
          label: `/${name}`, value: `/${name}`,
          description: name.includes(':') ? name.split(':')[0] : '',
          icon: getCommandIcon(name),
        }));
        const all = [...BUILTIN_COMMANDS, ...dynamicCommands];
        const matches = all.filter(c => {
          const full = c.label.toLowerCase();
          if (full.startsWith(currentWord)) return true;
          const colonIdx = full.indexOf(':');
          if (colonIdx !== -1 && full.slice(colonIdx + 1).startsWith(query)) return true;
          if (query.length >= 2 && full.includes(query)) return true;
          return false;
        });
        if (matches.length > 0) {
          e.preventDefault();
          if (matches.length === 1) {
            applySuggestion(matches[0]);
          } else {
            setSuggestions(matches);
            setSelectedIndex(0);
          }
          return;
        }
      }
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
        onSend(buildMessage(value.trim()), images.length > 0 ? images : undefined);
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

  const buildMessage = (text: string): string => {
    const parts: string[] = [];
    const termCtx = contextItems.find(c => c.type === 'terminal' && c.data);
    if (termCtx) {
      parts.push(`[Terminal output]\n\`\`\`\n${termCtx.data}\n\`\`\``);
    }
    const filePaths = contextItems.filter(c => c.type === 'file' && c.data).map(c => c.data!);
    if (filePaths.length > 0) {
      parts.push(filePaths.map(p => `@${p}`).join(' '));
    }
    parts.push(text);
    return parts.join('\n\n');
  };

  const handleAddFile = async () => {
    const filePath = await (window.sai as any).selectFile();
    if (filePath) {
      setContextItems(prev => [...prev, {
        label: filePath.split('/').pop() || filePath,
        type: 'file',
        data: filePath,
      }]);
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
              ) : ctx.type === 'terminal' ? (
                <TerminalIcon size={12} />
              ) : (
                <FileText size={12} />
              )}
              {ctx.label}
              <button className="context-remove" onClick={() => removeContext(i)}>&times;</button>
            </span>
          ))}
        </div>
      )}

      {pendingApproval && onApprove && onDeny && onAlwaysAllow && (
        <ApprovalPanel
          approval={pendingApproval}
          onApprove={onApprove}
          onDeny={onDeny}
          onAlwaysAllow={onAlwaysAllow}
        />
      )}

      {/* Main input area */}
      <div className={`input-box ${tickerDir ? `ticker-${tickerDir}` : ''}`} style={{ opacity: pendingApproval ? 0.4 : 1, pointerEvents: pendingApproval ? 'none' as const : 'auto' as const }}>
        {!value && (
          <div className="chat-placeholder" onClick={() => textareaRef.current?.focus()}>
            {!isStreaming && (
              <span className="chat-placeholder-icon" style={{
                maskImage: `url('${aiProvider === 'codex' ? 'svg/openai.svg' : aiProvider === 'gemini' ? 'svg/Google-gemini-icon.svg' : 'svg/claude.svg'}')`,
                WebkitMaskImage: `url('${aiProvider === 'codex' ? 'svg/openai.svg' : aiProvider === 'gemini' ? 'svg/Google-gemini-icon.svg' : 'svg/claude.svg'}')`,
                backgroundColor: 'var(--text-muted)',
              }} />
            )}
            <span>{isStreaming ? 'Queue another message...' : `Message ${aiProvider === 'codex' ? 'Codex' : aiProvider === 'gemini' ? 'Gemini' : 'Claude'}...`}</span>
          </div>
        )}
        <textarea
          ref={textareaRef}
          className="chat-textarea"
          value={value}
          onChange={(e) => { setValue(e.target.value); setSlashMenuOpen(false); }}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
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
          <button className="toolbar-btn" onClick={() => { setSlashMenuOpen(prev => !prev); setShowAddMenu(false); }} title="Slash commands">
            <SquareSlash size={18} />
          </button>
          {aiProvider === 'claude' && contextUsage && <ContextRing used={contextUsage.used} total={contextUsage.total} onClick={() => onSend('/compact')} />}
          {activeFilePath && (
            <span
              className={`active-file-chip${!fileContextEnabled ? ' disabled' : ''}`}
              title={fileContextEnabled ? activeFilePath : `${activeFilePath} (excluded from context)`}
              onClick={onFileContextToggle}
              style={{ cursor: 'pointer' }}
            >
              {fileContextEnabled ? <FileText size={11} /> : <EyeOff size={11} />}
              {activeFilePath.split('/').pop()}
            </span>
          )}
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
          {/* Usage & rate limit */}
          {aiProvider === 'claude' && (sessionUsage || (rateLimits && rateLimits.size > 0)) && (() => {
            const limits = rateLimits ? Array.from(rateLimits.values()) : [];
            const anyOverage = limits.some(rl => rl.isUsingOverage);

            // Split limits into session-level (5-hour, daily) and weekly-level
            const sessionLimits = limits.filter(rl => !isWeeklyLimit(rl.rateLimitType));
            const weeklyLimits = limits.filter(rl => isWeeklyLimit(rl.rateLimitType));
            const overageSource = limits.find(rl => rl.overageResetsAt > 0);

            // Inline text — pick the limit with the highest utilization
            const primary = [...sessionLimits].sort((a, b) => (b.utilization ?? 0) - (a.utilization ?? 0))[0] || limits[0];
            let inlineText = '';
            if (anyOverage) {
              inlineText = 'Overage';
            } else if (billingMode === 'subscription') {
              // Show session utilization % for subscription users
              const sessionUtil = primary?.utilization;
              if (sessionUtil !== undefined) {
                inlineText = `${Math.round(sessionUtil * 100)}% used`;
              } else {
                inlineText = 'Usage';
              }
            } else {
              // API mode: show cost or token count
              const costStr = (sessionCost ?? 0) > 0 ? `$${sessionCost!.toFixed(2)}` : '';
              if (costStr) {
                inlineText = costStr;
              } else if (sessionUsage) {
                inlineText = formatTokens(sessionUsage.inputTokens + sessionUsage.outputTokens);
              }
            }

            return (
              <div className="usage-wrapper">
                <span className={`toolbar-usage${anyOverage ? ' usage-overage' : ''}`}>
                  <Clock size={13} />
                  <span>{inlineText}</span>
                  {anyOverage && <span className="overage-dot" />}
                </span>
                <div className="usage-tooltip">
                  {/* Plan usage limits — session-level (Current session, Overage) */}
                  {billingMode === 'subscription' && (sessionLimits.length > 0 || overageSource) && (
                    <div className="usage-tooltip-section">
                      <div className="usage-tooltip-heading">Plan usage limits</div>
                      {sessionLimits.map(rl => {
                        const pct = getRateLimitProgress(rl) * 100;
                        return (
                          <UsageBar
                            key={rl.rateLimitType}
                            pct={pct}
                            color={pct >= 0 ? getBarColor(pct, false) : 'var(--text-muted)'}
                            label={getRateLimitLabel(rl.rateLimitType)}
                            sublabel={`Resets in ${formatResetTime(rl.resetsAt)}`}
                          />
                        );
                      })}
                      {overageSource && (() => {
                        const active = overageSource.isUsingOverage;
                        const pct = active ? getRateLimitProgress({ rateLimitType: overageSource.rateLimitType, resetsAt: overageSource.overageResetsAt, status: overageSource.status }) * 100 : 0;
                        return (
                          <UsageBar
                            pct={active ? pct : 0}
                            color={active ? 'var(--orange)' : 'var(--text-muted)'}
                            label="Overage"
                            sublabel={active ? `Resets in ${formatResetTime(overageSource.overageResetsAt)}` : 'Not active'}
                            tag={active ? 'ACTIVE' : undefined}
                          />
                        );
                      })()}
                    </div>
                  )}
                  {/* Weekly limits */}
                  {billingMode === 'subscription' && weeklyLimits.length > 0 && (
                    <div className="usage-tooltip-section">
                      <div className="usage-tooltip-heading">Weekly limits</div>
                      {weeklyLimits.map(rl => {
                        const pct = getRateLimitProgress(rl) * 100;
                        return (
                          <UsageBar
                            key={rl.rateLimitType}
                            pct={pct}
                            color={pct >= 0 ? getBarColor(pct, false) : 'var(--text-muted)'}
                            label={getRateLimitLabel(rl.rateLimitType)}
                            sublabel={`Resets ${formatResetTime(rl.resetsAt, 'absolute')}`}
                          />
                        );
                      })}
                    </div>
                  )}
                  {/* Context */}
                  {contextUsage && (
                    <div className="usage-tooltip-section">
                      <UsageBar
                        pct={Math.min((contextUsage.used / contextUsage.total) * 100, 100)}
                        color={getBarColor(Math.min((contextUsage.used / contextUsage.total) * 100, 100), false)}
                        label="Context"
                        sublabel={`${formatTokens(contextUsage.used)} / ${formatTokens(contextUsage.total)}`}
                      />
                      {contextUsage.used > 0 && (() => {
                        const totalInput = contextUsage.inputTokens + contextUsage.cacheReadTokens + contextUsage.cacheCreationTokens;
                        const cacheHitPct = totalInput > 0 ? Math.round((contextUsage.cacheReadTokens / totalInput) * 100) : 0;
                        return (
                          <div className="context-breakdown">
                            <div className="context-breakdown-row">
                              <span className="context-breakdown-label">Cache hit</span>
                              <span className="context-breakdown-value">{formatTokens(contextUsage.cacheReadTokens)}</span>
                              <span className="context-breakdown-pct">({cacheHitPct}%)</span>
                            </div>
                            <div className="context-breakdown-row">
                              <span className="context-breakdown-label">New input</span>
                              <span className="context-breakdown-value">{formatTokens(contextUsage.inputTokens + contextUsage.cacheCreationTokens)}</span>
                            </div>
                            <div className="context-breakdown-row">
                              <span className="context-breakdown-label">Output</span>
                              <span className="context-breakdown-value">{formatTokens(contextUsage.outputTokens)}</span>
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  )}
                  {/* Session cost */}
                  {billingMode === 'api' && (sessionCost ?? 0) > 0 && (
                    <div className="usage-tooltip-section">
                      <div className="usage-tooltip-heading">Session cost</div>
                      <div className="session-cost-value">${sessionCost!.toFixed(4)}</div>
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

          {/* Effort level — Claude only */}
          {aiProvider === 'claude' && (() => {
            const cfg = EFFORT_CONFIG[effortLevel];
            const Icon = cfg.icon;
            return (
              <button
                className="toolbar-btn effort-btn"
                onClick={() => onEffortChange(cfg.next)}
                title={`Effort: ${effortLevel} — Click to cycle`}
                style={{ color: cfg.color }}
              >
                <Icon size={15} />
                <span className="effort-label">{cfg.label}</span>
              </button>
            );
          })()}

          {/* Model selector — Claude only */}
          {aiProvider === 'claude' && (
          <div className="model-selector" ref={modelMenuRef}>
            <button
              className="toolbar-btn model-btn"
              onClick={() => setModelMenuOpen(!modelMenuOpen)}
              style={{ color: MODEL_OPTIONS.find(m => m.id === modelChoice)?.color }}
            >
              <span className="model-label">{MODEL_OPTIONS.find(m => m.id === modelChoice)?.label}</span>
              <ChevronDown size={11} style={{ opacity: 0.5 }} />
            </button>
            {modelMenuOpen && (
              <div className="model-dropdown">
                <div className="model-dropdown-header">Select a model</div>
                {MODEL_OPTIONS.map(opt => (
                  <button
                    key={opt.id}
                    className={`model-dropdown-item ${opt.id === modelChoice ? 'active' : ''}`}
                    onClick={() => { onModelChange(opt.id); setModelMenuOpen(false); }}
                  >
                    <div className="model-dropdown-item-info">
                      <span className="model-dropdown-item-name" style={{ color: opt.id === modelChoice ? opt.color : undefined }}>
                        {opt.label}
                        {opt.recommended && <span className="model-recommended">(recommended)</span>}
                      </span>
                      <span className="model-dropdown-item-desc">{opt.description}</span>
                    </div>
                    {opt.id === modelChoice && <Check size={14} style={{ color: opt.color, flexShrink: 0 }} />}
                  </button>
                ))}
              </div>
            )}
          </div>
          )}

          {/* Model selector — Codex */}
          {aiProvider === 'codex' && (
          <div className="model-selector" ref={modelMenuRef}>
            <button
              className="toolbar-btn model-btn"
              onClick={() => setModelMenuOpen(!modelMenuOpen)}
              style={{ color: 'var(--accent)' }}
            >
              <span className="model-label">{codexModel || 'Model'}</span>
              <ChevronDown size={11} style={{ opacity: 0.5 }} />
            </button>
            {modelMenuOpen && (
              <div className="model-dropdown">
                <div className="model-dropdown-header">Select a model</div>
                {codexModels.map(m => (
                  <button
                    key={m.id}
                    className={`model-dropdown-item ${m.id === codexModel ? 'active' : ''}`}
                    onClick={() => { onCodexModelChange?.(m.id); setModelMenuOpen(false); }}
                  >
                    <div className="model-dropdown-item-info">
                      <span className="model-dropdown-item-name" style={{ color: m.id === codexModel ? 'var(--accent)' : undefined }}>
                        {m.name}
                      </span>
                    </div>
                    {m.id === codexModel && <Check size={14} style={{ color: 'var(--accent)', flexShrink: 0 }} />}
                  </button>
                ))}
                {codexModels.length === 0 && (
                  <div className="model-dropdown-item" style={{ opacity: 0.5, cursor: 'default' }}>
                    <div className="model-dropdown-item-info">
                      <span className="model-dropdown-item-name">Loading models...</span>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
          )}

          {/* Model selector — Gemini */}
          {aiProvider === 'gemini' && (
          <div className="model-selector" ref={modelMenuRef}>
            <button
              className="toolbar-btn model-btn"
              onClick={() => setModelMenuOpen(!modelMenuOpen)}
              style={{ color: '#4285f4' }}
            >
              <span className="model-label">{geminiModels.find(m => m.id === geminiModel)?.name || geminiModel}</span>
              <ChevronDown size={11} style={{ opacity: 0.5 }} />
            </button>
            {modelMenuOpen && (
              <div className="model-dropdown">
                <div className="model-dropdown-header">Select a model</div>
                {geminiModels.map(m => (
                  <button
                    key={m.id}
                    className={`model-dropdown-item ${m.id === geminiModel ? 'active' : ''}`}
                    onClick={() => { onGeminiModelChange?.(m.id); setModelMenuOpen(false); }}
                  >
                    <div className="model-dropdown-item-info">
                      <span className="model-dropdown-item-name" style={{ color: m.id === geminiModel ? '#4285f4' : undefined }}>
                        {m.name}
                      </span>
                    </div>
                    {m.id === geminiModel && <Check size={14} style={{ color: '#4285f4', flexShrink: 0 }} />}
                  </button>
                ))}
              </div>
            )}
          </div>
          )}

          {/* Conversation mode — Gemini */}
          {aiProvider === 'gemini' && (
          <button
            className="toolbar-btn"
            onClick={() => {
              const next = geminiConversationMode === 'planning' ? 'fast' : 'planning';
              onGeminiConversationModeChange?.(next);
            }}
            title={`Conversation mode: ${geminiConversationMode}`}
            style={{ color: '#4285f4' }}
          >
            {geminiConversationMode === 'planning'
              ? <><Settings size={14} /> <span className="permission-label">Planning</span></>
              : <><Zap size={14} /> <span className="permission-label">Fast</span></>
            }
          </button>
          )}

          {aiProvider === 'claude' ? (
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
          ) : aiProvider === 'gemini' ? (
          <button
            className={`toolbar-btn permission-btn ${geminiApprovalMode === 'yolo' ? 'bypass-active' : ''}`}
            onClick={() => {
              const modes: Array<'default' | 'auto_edit' | 'yolo' | 'plan'> = ['default', 'auto_edit', 'yolo', 'plan'];
              const idx = modes.indexOf(geminiApprovalMode);
              onGeminiApprovalModeChange?.(modes[(idx + 1) % modes.length]);
            }}
            title={`Approval: ${geminiApprovalMode}`}
          >
            {geminiApprovalMode === 'default'
              ? <><ShieldCheck size={14} /> <span className="permission-label">Default</span></>
              : geminiApprovalMode === 'auto_edit'
              ? <><ShieldCheck size={14} /> <span className="permission-label">Auto Edit</span></>
              : geminiApprovalMode === 'yolo'
              ? <><ShieldOff size={14} /> <span className="permission-label">Yolo</span></>
              : <><ShieldCheck size={14} /> <span className="permission-label">Plan</span></>
            }
          </button>
          ) : (
          <button
            className={`toolbar-btn permission-btn ${codexPermission === 'full-access' ? 'bypass-active' : ''}`}
            onClick={() => {
              const next = codexPermission === 'auto' ? 'read-only' : codexPermission === 'read-only' ? 'full-access' : 'auto';
              onCodexPermissionChange?.(next);
            }}
            title={`Permissions: ${codexPermission}`}
          >
            {codexPermission === 'auto'
              ? <><ShieldCheck size={14} /> <span className="permission-label">Auto</span></>
              : codexPermission === 'read-only'
              ? <><ShieldCheck size={14} /> <span className="permission-label">Read-only</span></>
              : <><ShieldOff size={14} /> <span className="permission-label">Full Access</span></>
            }
          </button>
          )}

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
                  onSend(buildMessage(value.trim()), images.length > 0 ? images : undefined);
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
          position: relative;
        }
        .chat-placeholder {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          display: flex;
          align-items: flex-start;
          padding: 10px 14px;
          gap: 6px;
          pointer-events: none;
          color: var(--text-muted);
          font-family: inherit;
          font-size: 13px;
          line-height: 17px;
          z-index: 1;
          cursor: text;
          pointer-events: auto;
        }
        .chat-placeholder-icon {
          display: inline-block;
          width: 16px;
          height: 16px;
          flex-shrink: 0;
          margin-top: 1px;
          mask-size: contain;
          -webkit-mask-size: contain;
          mask-repeat: no-repeat;
          -webkit-mask-repeat: no-repeat;
          mask-position: center;
          -webkit-mask-position: center;
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
          line-height: 17px;
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
        .active-file-chip {
          display: flex;
          align-items: center;
          gap: 4px;
          margin-left: 4px;
          padding: 2px 7px;
          background: var(--bg-hover);
          border: 1px solid var(--border);
          border-radius: 4px;
          font-family: 'JetBrains Mono', monospace;
          font-size: 11px;
          color: var(--text-muted);
          white-space: nowrap;
          max-width: 180px;
          overflow: hidden;
          text-overflow: ellipsis;
          transition: opacity 0.15s;
        }
        .active-file-chip:hover { border-color: var(--text-muted); }
        .active-file-chip.disabled {
          opacity: 0.4;
          text-decoration: line-through;
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
        .usage-wrapper {
          position: relative;
        }
        .usage-wrapper:hover .usage-tooltip {
          display: flex;
        }
        .toolbar-usage {
          display: flex;
          align-items: center;
          gap: 4px;
          font-size: 11px;
          font-family: 'JetBrains Mono', monospace;
          color: var(--text-muted);
          padding: 3px 8px;
          border-radius: 4px;
          user-select: none;
          cursor: default;
        }
        .toolbar-usage:hover {
          background: var(--bg-hover);
        }
        .toolbar-usage.usage-overage {
          color: var(--orange);
        }
        .overage-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: var(--orange);
          flex-shrink: 0;
        }
        .usage-tooltip {
          display: none;
          flex-direction: column;
          gap: 0;
          position: absolute;
          bottom: calc(100% + 8px);
          right: 0;
          min-width: 380px;
          background: var(--bg-elevated);
          border: 1px solid var(--border);
          border-radius: 8px;
          box-shadow: 0 -4px 16px rgba(0,0,0,0.3);
          z-index: 60;
          overflow: hidden;
        }
        .usage-tooltip-section {
          padding: 8px 12px;
        }
        .usage-tooltip-section + .usage-tooltip-section {
          border-top: 1px solid var(--border);
        }
        .usage-tooltip-title {
          display: flex;
          align-items: center;
          gap: 5px;
          font-size: 10px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          color: var(--text-muted);
          margin-bottom: 6px;
        }
        .usage-tooltip-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 2px 0;
          font-size: 12px;
        }
        .usage-tooltip-label {
          color: var(--text-muted);
        }
        .usage-tooltip-value {
          font-family: 'JetBrains Mono', monospace;
          font-size: 11px;
          color: var(--text);
        }
        .usage-tooltip-warn .usage-tooltip-value {
          color: var(--orange);
        }
        .usage-tooltip-heading {
          font-size: 13px;
          font-weight: 600;
          color: var(--text);
          margin-bottom: 10px;
        }
        .usage-bar-row {
          display: grid;
          grid-template-columns: 120px 1fr auto;
          align-items: center;
          gap: 12px;
        }
        .usage-bar-info {
          display: flex;
          flex-direction: column;
          gap: 2px;
          min-width: 0;
        }
        .usage-bar-label {
          font-size: 12px;
          color: var(--text);
          font-weight: 500;
          white-space: nowrap;
        }
        .usage-bar-tag {
          font-size: 9px;
          font-weight: 700;
          letter-spacing: 0.5px;
          margin-left: 6px;
          padding: 1px 5px;
          border-radius: 3px;
          background: rgba(255,255,255,0.06);
        }
        .usage-bar-sublabel {
          font-size: 10px;
          color: var(--text-muted);
          white-space: nowrap;
        }
        .usage-bar-track {
          height: 6px;
          border-radius: 3px;
          background: var(--bg-hover);
          overflow: hidden;
          min-width: 100px;
        }
        .usage-bar-fill {
          height: 100%;
          border-radius: 3px;
          transition: width 0.4s ease;
        }
        .usage-bar-pct {
          font-size: 11px;
          font-family: 'JetBrains Mono', monospace;
          color: var(--text-muted);
          white-space: nowrap;
        }
        .context-breakdown {
          margin-top: 8px;
          padding-top: 6px;
          border-top: 1px solid var(--border);
          display: flex;
          flex-direction: column;
          gap: 3px;
        }
        .context-breakdown-row {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 11px;
          color: var(--text-muted);
        }
        .context-breakdown-label {
          width: 70px;
          flex-shrink: 0;
        }
        .context-breakdown-value {
          font-family: 'JetBrains Mono', monospace;
          font-size: 10px;
        }
        .context-breakdown-pct {
          font-family: 'JetBrains Mono', monospace;
          font-size: 10px;
          color: var(--text-muted);
        }
        .session-cost-value {
          font-family: 'JetBrains Mono', monospace;
          font-size: 12px;
          font-weight: 600;
          color: var(--text);
        }
        .effort-btn {
          font-size: 11px;
          padding: 3px 8px;
          border: 1px solid transparent;
          transition: all 0.15s;
        }
        .effort-btn:hover {
          border-color: var(--border);
        }
        .effort-label {
          font-size: 11px;
          font-family: 'JetBrains Mono', monospace;
        }
        .model-selector {
          position: relative;
        }
        .model-btn {
          font-size: 11px;
          padding: 3px 8px;
          border: 1px solid transparent;
          transition: all 0.15s;
        }
        .model-btn:hover {
          border-color: var(--border);
        }
        .model-label {
          font-size: 11px;
          font-family: 'JetBrains Mono', monospace;
          font-weight: 600;
        }
        .model-dropdown {
          position: absolute;
          bottom: calc(100% + 8px);
          right: 0;
          min-width: 320px;
          background: var(--bg-elevated);
          border: 1px solid var(--border);
          border-radius: 8px;
          box-shadow: 0 -4px 16px rgba(0,0,0,0.3);
          z-index: 60;
          overflow: hidden;
        }
        .model-dropdown-header {
          padding: 10px 14px 6px;
          font-size: 11px;
          color: var(--text-muted);
        }
        .model-dropdown-item {
          display: flex;
          align-items: center;
          gap: 10px;
          width: 100%;
          padding: 10px 14px;
          background: none;
          border: none;
          cursor: pointer;
          text-align: left;
        }
        .model-dropdown-item:hover {
          background: var(--bg-hover);
        }
        .model-dropdown-item.active {
          background: rgba(255,255,255,0.03);
        }
        .model-dropdown-item-info {
          display: flex;
          flex-direction: column;
          gap: 2px;
          flex: 1;
          min-width: 0;
        }
        .model-dropdown-item-name {
          font-size: 13px;
          font-weight: 600;
          color: var(--text);
        }
        .model-recommended {
          font-weight: 400;
          color: var(--text-muted);
          margin-left: 6px;
          font-size: 12px;
        }
        .model-dropdown-item-desc {
          font-size: 11px;
          color: var(--text-muted);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
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
