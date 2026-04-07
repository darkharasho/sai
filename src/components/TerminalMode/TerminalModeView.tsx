import { useState, useRef, useEffect, useCallback } from 'react';
import { parse as shellParse } from 'shell-quote';
import TerminalModeInput from './TerminalModeInput';
import type { TerminalModeInputHandle } from './TerminalModeInput';
import TerminalModeEditor from './TerminalModeEditor';
import { getActiveTerminalId } from '../../terminalBuffer';
import HiddenXterm from './HiddenXterm';
import type { HiddenXtermHandle } from './HiddenXterm';
import { BlockSegmenter } from './BlockSegmenter';
import type { SegmentedBlock } from './BlockSegmenter';
import NativeBlockList from './NativeBlockList';
import type { DisplayItem } from './NativeBlockList';
import type { ApprovalBlock as ApprovalBlockType, ToolApprovalBlock as ToolApprovalBlockType, InputMode } from './types';

interface TerminalModeViewProps {
  projectPath: string;
  aiProvider?: 'claude' | 'codex' | 'gemini';
  active?: boolean;
}

function nextBlockId(): string {
  return `tm-${crypto.randomUUID()}`;
}

function nextGroupId(): string {
  return `grp-${crypto.randomUUID()}`;
}

// Common shell commands and builtins for auto-detection
const KNOWN_COMMANDS = new Set([
  // Builtins & core
  'cd', 'ls', 'll', 'la', 'pwd', 'echo', 'cat', 'head', 'tail', 'less', 'more',
  'cp', 'mv', 'rm', 'mkdir', 'rmdir', 'touch', 'chmod', 'chown', 'chgrp', 'ln',
  'find', 'grep', 'rg', 'ag', 'sed', 'awk', 'sort', 'uniq', 'wc', 'tr', 'cut',
  'diff', 'patch', 'file', 'which', 'whereis', 'type', 'alias', 'unalias',
  'export', 'unset', 'source', 'eval', 'exec', 'exit', 'clear', 'reset',
  'history', 'true', 'false', 'test', 'read', 'printf', 'set',
  // Files & disk
  'du', 'df', 'mount', 'umount', 'tar', 'zip', 'unzip', 'gzip', 'gunzip', 'bzip2',
  'xz', 'zcat', 'stat', 'dd', 'rsync', 'scp',
  // Process & system
  'ps', 'top', 'htop', 'btop', 'kill', 'killall', 'pkill', 'fg', 'bg', 'jobs',
  'nohup', 'xargs', 'time', 'watch', 'uptime', 'free', 'uname', 'hostname',
  'whoami', 'id', 'su', 'sudo', 'doas', 'env', 'man', 'info', 'tee',
  // Network
  'curl', 'wget', 'ssh', 'ping', 'nc', 'netstat', 'ss', 'ip', 'ifconfig',
  'dig', 'nslookup', 'traceroute', 'host',
  // Dev tools
  'git', 'gh', 'npm', 'npx', 'yarn', 'pnpm', 'bun', 'deno', 'node', 'tsx', 'ts-node',
  'python', 'python3', 'pip', 'pip3', 'pipenv', 'poetry', 'uv', 'uvx',
  'ruby', 'gem', 'bundle', 'rake', 'rails',
  'go', 'cargo', 'rustc', 'rustup',
  'java', 'javac', 'mvn', 'gradle',
  'make', 'cmake', 'gcc', 'g++', 'clang',
  'docker', 'podman', 'kubectl', 'helm',
  'terraform', 'ansible', 'vagrant',
  // Editors & TUI
  'vim', 'nvim', 'vi', 'nano', 'emacs', 'code', 'micro',
  // Package managers
  'apt', 'apt-get', 'dnf', 'yum', 'pacman', 'brew', 'flatpak', 'snap',
  // Misc
  'jq', 'yq', 'tree', 'bat', 'eza', 'exa', 'fd', 'fzf', 'tmux', 'screen',
  'systemctl', 'journalctl', 'lsof', 'strace',
]);

// Natural language starters that strongly indicate a question / AI request
const NL_STARTERS = /^(what|why|how|when|where|who|which|can|could|would|should|is|are|do|does|did|will|shall|tell|explain|help|show|describe|fix|find|list|create|make|write|give|suggest|compare|check|analyze|summarize|refactor|debug|implement|add|remove|update|change|convert|translate|generate|optimize|review|please|hey|hi|sorry|thanks|thank)\b/i;

function looksLikeShellCommand(input: string): boolean {
  const trimmed = input.trim();
  if (!trimmed) return false;

  // Starts with path-like patterns: ./ ../ / ~/
  if (/^[.~\/]/.test(trimmed)) return true;

  // Starts with env variable assignment: VAR=value command
  if (/^[A-Z_][A-Z0-9_]*=/.test(trimmed)) return true;

  // Contains shell operators — very likely a command
  if (/[|><;&]/.test(trimmed)) return true;

  // Contains flags (e.g. -v, --verbose) — strong command signal
  if (/\s-{1,2}[a-zA-Z]/.test(trimmed)) return true;

  // Contains a question mark — very likely natural language
  if (trimmed.includes('?')) return false;

  const firstWord = trimmed.split(/\s+/)[0].toLowerCase();

  // Known command
  if (KNOWN_COMMANDS.has(firstWord)) return true;

  // Starts with a natural language word
  if (NL_STARTERS.test(trimmed)) return false;

  // Common natural language words/phrases that are never commands
  const NL_WORDS = new Set([
    'there', 'here', 'ok', 'okay', 'hold', 'wait', 'but', 'so',
    'actually', 'maybe', 'also', 'just', 'well', 'yeah', 'yes', 'no',
    'nah', 'nope', 'hmm', 'hm', 'ah', 'oh', 'ooh', 'um', 'uh',
    'never', 'always', 'only', 'not', 'dont', 'like', 'let', 'lets',
    'i', 'im', 'its', 'thats', 'whats', 'heres', 'theres',
    'in', 'on', 'at', 'to', 'the', 'a', 'an', 'it', 'we',
  ]);
  if (NL_WORDS.has(firstWord)) return false;

  // Single word — treat as a command (could be any binary)
  if (!trimmed.includes(' ')) return true;

  // Short input (≤3 words) starting with a plausible command token — treat as command
  const words = trimmed.split(/\s+/);
  if (words.length <= 3 && /^[a-z0-9_][\w.-]*$/i.test(firstWord)) return true;

  // Personal pronouns — almost never appear in shell commands
  const pronouns = new Set(['i', 'me', 'my', 'you', 'your', 'we', 'our', 'they', 'their', 'he', 'she', 'him', 'her', 'us', 'them']);
  if (words.some(w => pronouns.has(w.toLowerCase()))) return false;

  // Sentence structure words — articles, prepositions, conjunctions, common verbs
  const sentenceWords = new Set([
    // articles & determiners
    'the', 'a', 'an', 'this', 'that', 'these', 'those', 'some', 'any', 'every',
    // prepositions
    'of', 'for', 'with', 'about', 'into', 'from', 'between', 'through', 'during', 'before', 'after', 'above', 'below', 'under', 'over',
    // conjunctions
    'and', 'or', 'but', 'because', 'since', 'although', 'whether', 'wether', 'while', 'if', 'then', 'than', 'either', 'neither',
    // common verbs that aren't commands
    'have', 'has', 'had', 'was', 'were', 'been', 'being', 'am', 'are', 'is',
    'do', 'does', 'did', 'done', 'doing',
    'get', 'got', 'getting', 'gets',
    'know', 'known', 'knew', 'think', 'thought', 'want', 'need', 'see', 'saw', 'seen',
    'going', 'gonna', 'wanna', 'gotta',
    // adverbs
    'not', 'very', 'really', 'already', 'still', 'even', 'probably', 'definitely',
  ]);
  const nlCount = words.filter(w => sentenceWords.has(w.toLowerCase())).length;
  if (nlCount >= 2) return false;

  // shell-quote: if parsing produces operators ({op}) or glob patterns, likely a command
  try {
    const parsed = shellParse(trimmed);
    const hasShellTokens = parsed.some(t => typeof t === 'object');
    if (hasShellTokens) return true;
  } catch {
    // parse failure — not a valid shell command
  }

  // Default: if it starts with something that looks like a command name, run it
  if (/^[a-z0-9_][\w.-]*$/i.test(firstWord)) return true;

  return false;
}

export default function TerminalModeView({ projectPath, aiProvider = 'claude', active = true }: TerminalModeViewProps) {
  const [displayItems, setDisplayItems] = useState<DisplayItem[]>([]);
  const [altScreenVisible, setAltScreenVisible] = useState(false);
  const [ptyId, setPtyId] = useState<number | null>(null);
  const [inputMode, setInputMode] = useState<InputMode>('shell');
  const [editValue, setEditValue] = useState<string | undefined>(undefined);
  const [cwd, setCwd] = useState(projectPath || '~');
  const [permissionMode, setPermissionMode] = useState<'default' | 'bypass'>('default');
  const [fullWidth, setFullWidth] = useState(false);
  const [promptInfo, setPromptInfo] = useState<{ text: string; isRemote: boolean; sshTarget?: string } | null>(null);
  const [shellHistory, setShellHistory] = useState<string[]>([]);

  useEffect(() => {
    window.sai.settingsGet('terminalFullWidth', false).then((v: boolean) => setFullWidth(v));
    window.sai.terminalGetShellHistory(500).then((lines: string[]) => setShellHistory(lines));
  }, []);
  const permissionModeRef = useRef(permissionMode);
  permissionModeRef.current = permissionMode;
  const sessionIdRef = useRef<string | undefined>(undefined);

  // Editor panel state
  const [editorFiles, setEditorFiles] = useState<{ path: string; content: string; highlightLine?: number }[]>([]);
  const [activeEditorFile, setActiveEditorFile] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);

  const currentGroupRef = useRef<string>(nextGroupId());
  // Fallback PTY for when no regular terminal is available
  const fallbackPtyRef = useRef<number | null>(null);
  const fallbackPtyReadyRef = useRef<Promise<number> | null>(null);
  // Track active AI cleanup so Ctrl+C can abort it
  const aiCleanupRef = useRef<(() => void) | null>(null);
  const aiBlockIdRef = useRef<string | null>(null);
  // Ref to the input component for pasting
  const inputRef = useRef<TerminalModeInputHandle>(null);
  // Track whether the system preamble has been sent this session
  const preambleSentRef = useRef(false);

  // Terminal-native architecture refs
  const segmenterRef = useRef<BlockSegmenter>(new BlockSegmenter());
  const hiddenXtermRef = useRef<HiddenXtermHandle>(null);
  const aiSuggestedCommands = useRef<Set<string>>(new Set());
  const pendingCommandRef = useRef<{ command: string; startTime: number } | null>(null);
  const lastSshTargetRef = useRef<string | null>(null);
  const altScreenRef = useRef(false);
  altScreenRef.current = altScreenVisible;

  // Update cwd when projectPath changes (workspace switch)
  useEffect(() => {
    if (projectPath) setCwd(projectPath);
  }, [projectPath]);

  // Focus the input when this tab becomes active
  useEffect(() => {
    if (active) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [active]);

  const refreshCwd = useCallback(async (ptyId: number) => {
    try {
      const dir = await window.sai.terminalGetCwd(ptyId);
      if (dir) setCwd(dir);
    } catch { /* ignore */ }
  }, []);

  // PTY data listener + fallback PTY creation
  useEffect(() => {
    let cancelled = false;
    const segmenter = segmenterRef.current;

    // Register block callback
    segmenter.onBlock((block) => {
      if (cancelled) return;

      // Intercept internal history-fetch command — parse output as history, suppress block
      // Match by sentinel marker in the command (added when we send it through PTY)
      const cleanBlockCmd = block.command.replace(/[^\x20-\x7E]/g, '').trim();
      if (cleanBlockCmd.includes('#__sai_hist__')) {
        pendingCommandRef.current = null;
        if (block.output) {
          const lines = block.output.split('\n')
            .map(l => {
              // Strip zsh extended history format ": timestamp:0;command"
              const zshMatch = l.match(/^:\s*\d+:\d+;(.*)$/);
              if (zshMatch) return zshMatch[1].trim();
              return l.trim();
            })
            .filter(Boolean);
          // Deduplicate, keeping most recent
          const seen = new Set<string>();
          const unique: string[] = [];
          for (let i = lines.length - 1; i >= 0; i--) {
            if (!seen.has(lines[i])) {
              seen.add(lines[i]);
              unique.push(lines[i]);
            }
          }
          setShellHistory(unique.reverse());
        }
        return;
      }

      const isSuggested = aiSuggestedCommands.current.has(block.command);
      if (isSuggested) aiSuggestedCommands.current.delete(block.command);
      const pending = pendingCommandRef.current;
      pendingCommandRef.current = null;
      // Use the submit timestamp for duration instead of the segmenter's
      // prompt-to-prompt timing (which includes user typing time)
      // Use the command the user actually typed (from our input) rather than
      // what the segmenter extracted from PTY output (which can include leaked
      // prompt glyphs from remote shells).
      const fixedBlock = pending
        ? { ...block, command: pending.command, duration: Date.now() - pending.startTime }
        : block;
      setDisplayItems(prev => {
        // Replace the pending block if it exists
        if (pending) {
          const idx = prev.findIndex(item => item.type === 'command' && item.block.id === 'pending');
          if (idx !== -1) {
            const next = [...prev];
            next[idx] = { type: 'command', block: fixedBlock, aiSuggested: isSuggested };
            return next;
          }
        }
        return [...prev, { type: 'command', block: fixedBlock, aiSuggested: isSuggested }];
      });
      const termId = getActiveTerminalId() ?? fallbackPtyRef.current;
      if (termId !== null) refreshCwd(termId);
    });

    // Register alt-screen callback
    segmenter.onAltScreen((entered) => {
      if (cancelled) return;
      setAltScreenVisible(entered);
    });

    // Register prompt-change callback (updates input bar for SSH etc.)
    segmenter.onPromptChange((prompt, isRemote, sshTarget) => {
      if (cancelled) return;
      setPromptInfo({ text: prompt, isRemote, sshTarget: sshTarget ?? undefined });

      const target = isRemote ? (sshTarget || '__remote__') : null;
      if (target !== lastSshTargetRef.current) {
        lastSshTargetRef.current = target;
        if (isRemote) {
          // Fetch remote shell history by reading history files through the PTY
          // The #__sai_hist__ comment is a sentinel so we can identify and suppress this block
          const termId = getActiveTerminalId() ?? fallbackPtyRef.current;
          if (termId !== null) {
            window.sai.terminalWrite(termId, 'tail -500 ~/.bash_history 2>/dev/null || tail -500 ~/.zsh_history 2>/dev/null #__sai_hist__\n');
          }
        } else {
          // Back to local — reload local shell history
          window.sai.terminalGetShellHistory(500).then((lines: string[]) => {
            if (!cancelled) setShellHistory(lines);
          });
        }
      }
    });

    // Listen for PTY data and forward to hidden xterm
    const cleanupData = window.sai.terminalOnData((ptyId: number, data: string) => {
      if (cancelled) return;
      if (ptyId === (getActiveTerminalId() ?? fallbackPtyRef.current)) {
        hiddenXtermRef.current?.write(data); // This feeds both xterm and BlockSegmenter via onData
      }
    });

    // Create fallback PTY
    const ptyPromise = window.sai.terminalCreate(projectPath).then((id: number) => {
      if (cancelled) { window.sai.terminalKill(id); return id; }
      fallbackPtyRef.current = id;
      setPtyId(id);
      refreshCwd(id);
      return id;
    });
    fallbackPtyReadyRef.current = ptyPromise;

    return () => {
      cancelled = true;
      cleanupData();
      segmenter.reset();
      if (fallbackPtyRef.current !== null) {
        window.sai.terminalKill(fallbackPtyRef.current);
        fallbackPtyRef.current = null;
        setPtyId(null);
      }
      if (aiCleanupRef.current) {
        window.sai.claudeStop(projectPath, 'terminal');
        aiCleanupRef.current();
        aiCleanupRef.current = null;
      }
    };
  }, [projectPath, refreshCwd]);

  const executeCommand = useCallback(async (command: string) => {
    let termId = getActiveTerminalId() ?? fallbackPtyRef.current;
    if (termId === null && fallbackPtyReadyRef.current) {
      termId = await fallbackPtyReadyRef.current;
    }
    if (termId === null) return;
    window.sai.terminalWrite(termId, command + '\n');
  }, []);

  const handleSubmit = useCallback((value: string) => {
    if (inputMode === 'shell') {
      // Add a pending block immediately so the user sees feedback
      const pendingBlock = {
        id: 'pending',
        command: value,
        output: '',
        promptText: '',
        startTime: Date.now(),
        duration: 0,
        isRemote: false,
      };
      pendingCommandRef.current = { command: value, startTime: Date.now() };
      setDisplayItems(prev => [...prev, { type: 'command' as const, block: pendingBlock, active: true }]);
      executeCommand(value);
      setEditValue(undefined);
    } else {
      currentGroupRef.current = nextGroupId();
      handleAIRequest(value);
    }
  }, [inputMode, executeCommand]);

  const handleAIRequest = useCallback((prompt: string) => {
    const aiId = nextBlockId();
    const aiStartTime = Date.now();
    let turnSeq: number | null = null;
    let gotContent = false;

    // Add AI display items: the question and streaming response
    setDisplayItems(prev => [...prev,
      { type: 'ai', id: aiId, question: prompt, content: '', suggestedCommands: [], streaming: true, aiProvider },
    ]);

    const finalize = () => {
      setDisplayItems(prev => {
        const aiItem = prev.find((item): item is DisplayItem & { type: 'ai' } => item.type === 'ai' && item.id === aiId);
        if (!aiItem || aiItem.type !== 'ai') return prev;

        const bashMatches = [...aiItem.content.matchAll(/```(?:bash|sh|shell)\n([\s\S]*?)```/g)];
        if (bashMatches.length === 0) return prev;

        const commands = bashMatches.map(m => m[1].trim());
        // Update the AI item with suggested commands
        return prev.map(item =>
          item.type === 'ai' && item.id === aiId
            ? { ...item, suggestedCommands: commands }
            : item
        );
      });
    };

    // Ordered entries: text segments and tool calls with I/O
    let entries: import('./types').AIEntry[] = [];
    let allToolNames: string[] = [];
    // Track which tool_use IDs we've already added as entries
    let knownToolIds = new Set<string>();
    // Track the last text we set so we can detect new vs updated text
    let lastTextEntry = '';
    // Keep refs to previous block entries so tool_results arriving after block split can still match
    let prevBlockEntries: Map<string, { entries: import('./types').AIEntry[]; blockId: string }> = new Map();
    // The current ai block ID (may change after tool approvals)
    let currentAiId = aiId;
    let needsNewBlock = false;

    const updateItem = () => {
      const contentParts = entries.filter(e => e.kind === 'text').map(e => e.text);
      const content = contentParts.join('\n\n');
      setDisplayItems(prev => prev.map(item =>
        item.type === 'ai' && item.id === currentAiId
          ? { ...item, content }
          : item
      ));
    };

    const cleanup = window.sai.claudeOnMessage((msg: any) => {
      if (msg.projectPath && msg.projectPath !== projectPath) return;
      if (msg.scope && msg.scope !== 'terminal') return;

      if (msg.type === 'session_id' && msg.sessionId) {
        sessionIdRef.current = msg.sessionId;
      }

      if (msg.type === 'streaming_start') {
        if (msg.turnSeq != null) turnSeq = msg.turnSeq;
        return;
      }

      // Tool results — match output to existing tool entries (current or previous blocks)
      if (msg.type === 'user' && msg.message?.content) {
        const content = Array.isArray(msg.message.content) ? msg.message.content : [];
        for (const block of content) {
          if (block.type === 'tool_result' && block.tool_use_id) {
            const output = typeof block.content === 'string'
              ? block.content
              : Array.isArray(block.content)
                ? block.content.map((c: any) => c.text || '').join('')
                : '';

            // Check current entries first
            const toolEntry = entries.find(
              e => e.kind === 'tool' && e.call.id === block.tool_use_id
            );
            if (toolEntry && toolEntry.kind === 'tool') {
              toolEntry.call.output = output;
              toolEntry.call.isError = !!block.is_error;
              updateItem();
            } else {
              // Check previous block entries (tool result arrived after block split)
              const prev = prevBlockEntries.get(block.tool_use_id);
              if (prev) {
                const prevTool = prev.entries.find(
                  e => e.kind === 'tool' && e.call.id === block.tool_use_id
                );
                if (prevTool && prevTool.kind === 'tool') {
                  prevTool.call.output = output;
                  prevTool.call.isError = !!block.is_error;
                  // Update the previous AI display item
                  const prevContentParts = prev.entries.filter(e => e.kind === 'text').map(e => e.text);
                  const prevContent = prevContentParts.join('\n\n');
                  setDisplayItems(items => items.map(item =>
                    item.type === 'ai' && item.id === prev.blockId
                      ? { ...item, content: prevContent }
                      : item
                  ));
                }
              }
            }
          }
        }
      }

      if (msg.type === 'assistant' && msg.message?.content) {
        // After a tool approval, start a fresh ai display item below the approval
        if (needsNewBlock) {
          needsNewBlock = false;
          // Save current entries so tool_results can still find them
          const oldBlockId = currentAiId;
          const oldEntries = entries;
          for (const e of oldEntries) {
            if (e.kind === 'tool') prevBlockEntries.set(e.call.id, { entries: oldEntries, blockId: oldBlockId });
          }
          currentAiId = nextBlockId();
          entries = [];
          allToolNames = [];
          knownToolIds = new Set<string>();
          lastTextEntry = '';
          setDisplayItems(prev => [...prev, {
            type: 'ai' as const,
            id: currentAiId,
            question: '',
            content: '',
            suggestedCommands: [],
            streaming: true,
            aiProvider,
          }]);
          aiBlockIdRef.current = currentAiId;
        }

        const contentBlocks = Array.isArray(msg.message.content) ? msg.message.content : [];
        let hasNewData = false;

        // Extract text
        const textParts: string[] = [];
        for (const block of contentBlocks) {
          if (block.type === 'text' && block.text) {
            textParts.push(block.text);
          }
        }
        const text = textParts.join('');

        if (text && text !== lastTextEntry) {
          gotContent = true;
          const lastIdx = entries.length - 1;
          const lastEntry = lastIdx >= 0 ? entries[lastIdx] : null;

          if (lastEntry && lastEntry.kind === 'text') {
            lastEntry.text = text;
          } else {
            entries.push({ kind: 'text', text });
          }
          lastTextEntry = text;
          hasNewData = true;
        }

        // Extract tool_use blocks
        for (const block of contentBlocks) {
          if (block.type === 'tool_use' && block.id && !knownToolIds.has(block.id)) {
            knownToolIds.add(block.id);
            const name = block.name || 'unknown';
            if (!allToolNames.includes(name)) {
              allToolNames.push(name);
            }
            const input = block.input?.command
              || block.input?.file_path
              || (block.input ? JSON.stringify(block.input) : '');
            entries.push({
              kind: 'tool',
              call: { id: block.id, name, input },
            });
            hasNewData = true;
          }
        }

        if (hasNewData) updateItem();
      }

      // Tool approval request — Claude wants to run a tool
      if (msg.type === 'approval_needed') {
        // Freeze the current AI item (stop streaming indicator)
        setDisplayItems(prev => {
          const updated = prev.map(item =>
            item.type === 'ai' && item.id === currentAiId
              ? { ...item, streaming: false, duration: Date.now() - aiStartTime }
              : item
          );
          return [...updated, {
            type: 'tool-approval' as const,
            block: {
              type: 'tool-approval' as const,
              id: nextBlockId(),
              toolName: msg.toolName,
              toolUseId: msg.toolUseId,
              command: msg.command || '',
              description: msg.description || '',
              status: 'pending' as const,
            },
          }];
        });
        needsNewBlock = true;
      }

      // Result message carries the final answer text
      if (msg.type === 'result') {
        if (msg.result) {
          const text = typeof msg.result === 'string' ? msg.result : '';
          if (text && text !== lastTextEntry) {
            gotContent = true;
            const lastIdx = entries.length - 1;
            const lastEntry = lastIdx >= 0 ? entries[lastIdx] : null;
            if (lastEntry && lastEntry.kind === 'text') {
              lastEntry.text = text;
            } else {
              entries.push({ kind: 'text', text });
            }
            lastTextEntry = text;
            updateItem();
          }
        }
        return;
      }

      // Done signals true end of the entire turn
      if (msg.type === 'done') {
        if (turnSeq != null && msg.turnSeq != null && msg.turnSeq !== turnSeq) return;
        if (!gotContent && turnSeq === null) return;
        setDisplayItems(prev => prev.map(item =>
          item.type === 'ai' && item.id === currentAiId
            ? { ...item, streaming: false, duration: Date.now() - aiStartTime }
            : item
        ));
        aiCleanupRef.current = null;
        aiBlockIdRef.current = null;
        cleanup();
        finalize();
      }
    });

    // Track this request so Ctrl+C can abort it
    aiCleanupRef.current = cleanup;
    aiBlockIdRef.current = aiId;

    // Inject system preamble on the first message of the session
    let fullPrompt = prompt;
    if (!preambleSentRef.current) {
      preambleSentRef.current = true;
      const preamble = [
        'You are an AI assistant embedded in a terminal. The user is working in a shell and expects concise, actionable help.',
        '',
        'Guidelines:',
        '- Be terse. Respond like a senior engineer pair-programming over a terminal.',
        '- When the user asks you to do something, prefer using tools (Bash, Read, Write, Edit) to actually do it rather than just explaining how.',
        '- For shell tasks: run the commands yourself. Don\'t just suggest them.',
        '- For investigation tasks: read files, run diagnostic commands, and report findings.',
        '- When showing commands, use ```bash code blocks.',
        '- Skip pleasantries, preambles, and unnecessary explanation. Lead with the action or answer.',
        `- Working directory: ${projectPath}`,
        `- Platform: ${window.sai.platform}`,
      ].join('\n');
      fullPrompt = `<system>\n${preamble}\n</system>\n\n${prompt}`;
    }

    // Send after listener is registered to avoid race condition
    window.sai.claudeSend(projectPath, fullPrompt, undefined, permissionModeRef.current, 'high', 'sonnet', 'terminal');
  }, [projectPath, aiProvider]);

  const handleAskAI = useCallback((block: SegmentedBlock) => {
    currentGroupRef.current = nextGroupId();
    const prompt = `The following command ran:\n\n\`\`\`\n$ ${block.command}\n${block.output}\n\`\`\`\n\nAnalyze this and suggest a fix if needed. If you suggest a command, put it in a \`\`\`bash code block.`;
    handleAIRequest(prompt);
  }, [handleAIRequest]);

  const handleCopy = useCallback((text: string) => {
    navigator.clipboard.writeText(text);
  }, []);

  const handleRerun = useCallback((command: string) => {
    executeCommand(command);
  }, [executeCommand]);

  const handleApprove = useCallback((block: ApprovalBlockType) => {
    setDisplayItems(prev => prev.map(item =>
      item.type === 'approval' && item.block.id === block.id
        ? { ...item, block: { ...item.block, status: 'approved' as const } }
        : item
    ));
    currentGroupRef.current = nextGroupId();
    aiSuggestedCommands.current.add(block.command);
    executeCommand(block.command);
  }, [executeCommand]);

  const handleReject = useCallback((block: ApprovalBlockType) => {
    setDisplayItems(prev => prev.map(item =>
      item.type === 'approval' && item.block.id === block.id
        ? { ...item, block: { ...item.block, status: 'rejected' as const } }
        : item
    ));
  }, []);

  const handleEdit = useCallback((block: ApprovalBlockType) => {
    setDisplayItems(prev => prev.map(item =>
      item.type === 'approval' && item.block.id === block.id
        ? { ...item, block: { ...item.block, status: 'edited' as const } }
        : item
    ));
    setEditValue(block.command);
    setInputMode('shell');
  }, []);

  const handleToolApprove = useCallback((block: ToolApprovalBlockType) => {
    window.sai.claudeApprove(projectPath, block.toolUseId, true, undefined, 'terminal');
    setDisplayItems(prev => prev.map(item =>
      item.type === 'tool-approval' && item.block.id === block.id
        ? { ...item, block: { ...item.block, status: 'approved' as const } }
        : item
    ));
  }, [projectPath]);

  const handleToolReject = useCallback((block: ToolApprovalBlockType) => {
    window.sai.claudeApprove(projectPath, block.toolUseId, false, undefined, 'terminal');
    setDisplayItems(prev => prev.map(item =>
      item.type === 'tool-approval' && item.block.id === block.id
        ? { ...item, block: { ...item.block, status: 'rejected' as const } }
        : item
    ));
  }, [projectPath]);

  const handleToolAlwaysAllow = useCallback(async (block: ToolApprovalBlockType) => {
    const pattern = `${block.toolName}(*)`;
    await window.sai.claudeAlwaysAllow(projectPath, pattern);
    window.sai.claudeApprove(projectPath, block.toolUseId, true, undefined, 'terminal');
    setDisplayItems(prev => prev.map(item =>
      item.type === 'tool-approval' && item.block.id === block.id
        ? { ...item, block: { ...item.block, status: 'approved' as const } }
        : item
    ));
  }, [projectPath]);

  const toggleMode = useCallback(() => {
    setInputMode(prev => prev === 'shell' ? 'ai' : 'shell');
  }, []);

  const toggleFullWidth = useCallback(() => {
    setFullWidth(prev => {
      const next = !prev;
      window.sai.settingsSet('terminalFullWidth', next);
      return next;
    });
  }, []);

  // When alt-screen is active, forward all keyboard input directly to the PTY
  useEffect(() => {
    const handleAltScreenKey = (e: KeyboardEvent) => {
      if (!altScreenRef.current) return;
      const termId = getActiveTerminalId() ?? fallbackPtyRef.current;
      if (termId === null) return;

      e.preventDefault();
      e.stopPropagation();

      // Map key events to terminal sequences
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
        window.sai.terminalWrite(termId, e.key);
      } else if (e.ctrlKey && e.key.length === 1) {
        // Ctrl+letter → control character (e.g. Ctrl+C → \x03)
        const code = e.key.toLowerCase().charCodeAt(0) - 96;
        if (code > 0 && code < 27) {
          window.sai.terminalWrite(termId, String.fromCharCode(code));
        }
      } else {
        // Special keys
        const keyMap: Record<string, string> = {
          Enter: '\r',
          Backspace: '\x7f',
          Tab: '\t',
          Escape: '\x1b',
          ArrowUp: '\x1b[A',
          ArrowDown: '\x1b[B',
          ArrowRight: '\x1b[C',
          ArrowLeft: '\x1b[D',
          Home: '\x1b[H',
          End: '\x1b[F',
          Delete: '\x1b[3~',
          PageUp: '\x1b[5~',
          PageDown: '\x1b[6~',
          F1: '\x1bOP', F2: '\x1bOQ', F3: '\x1bOR', F4: '\x1bOS',
          F5: '\x1b[15~', F6: '\x1b[17~', F7: '\x1b[18~', F8: '\x1b[19~',
          F9: '\x1b[20~', F10: '\x1b[21~', F11: '\x1b[23~', F12: '\x1b[24~',
        };
        const seq = keyMap[e.key];
        if (seq) window.sai.terminalWrite(termId, seq);
      }
    };

    window.addEventListener('keydown', handleAltScreenKey, true);
    return () => window.removeEventListener('keydown', handleAltScreenKey, true);
  }, []);

  // Ctrl+C = kill, Ctrl+Shift+C = copy, Ctrl+Shift+V = paste
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // When alt-screen is active (htop, vim, etc.), handled by alt-screen handler
      if (altScreenRef.current) return;

      const ctrlOrMeta = e.ctrlKey || e.metaKey;
      if (!ctrlOrMeta) return;

      // Ctrl+Shift+C → copy selection
      if (e.key === 'C' && e.shiftKey) {
        e.preventDefault();
        const selection = window.getSelection()?.toString();
        if (selection) navigator.clipboard.writeText(selection);
        return;
      }

      // Ctrl+Shift+V → paste into input
      if (e.key === 'V' && e.shiftKey) {
        e.preventDefault();
        navigator.clipboard.readText().then(text => {
          if (text && inputRef.current) inputRef.current.paste(text);
        });
        return;
      }

      // Ctrl+C (no shift) → interrupt/kill
      if (e.key === 'c' && !e.shiftKey) {
        e.preventDefault();

        // Kill any running AI request
        if (aiCleanupRef.current) {
          const blockId = aiBlockIdRef.current;
          window.sai.claudeStop(projectPath, 'terminal');
          if (blockId) {
            setDisplayItems(prev => prev.map(item =>
              item.type === 'ai' && item.id === blockId
                ? { ...item, streaming: false }
                : item
            ));
          }
          aiCleanupRef.current();
          aiCleanupRef.current = null;
          aiBlockIdRef.current = null;
        }

        // Send SIGINT to PTY
        const termId = getActiveTerminalId() ?? fallbackPtyRef.current;
        if (termId !== null) window.sai.terminalWrite(termId, '\x03');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [projectPath]);

  // Build input history: shell history file entries + session commands/AI prompts
  const sessionHistory = displayItems
    .filter(item => item.type === 'command' || item.type === 'ai')
    .map(item => item.type === 'command' ? item.block.command : item.question);
  const inputHistory = [...shellHistory, ...sessionHistory];

  return (
    <div className="tm-view">
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0, overflow: 'hidden', position: 'relative' }}>
        {ptyId !== null && (
          <HiddenXterm
            ref={hiddenXtermRef}
            ptyId={ptyId}
            visible={altScreenVisible}
            onData={(data) => segmenterRef.current.feed(data)}
          />
        )}
        {!altScreenVisible && (
          <NativeBlockList
            items={displayItems}
            activeBlockId={null}
            fullWidth={fullWidth}
            cwd={cwd}
            onCopy={handleCopy}
            onAskAI={handleAskAI}
            onRerun={handleRerun}
            onRunSuggested={(cmd) => {
              aiSuggestedCommands.current.add(cmd);
              executeCommand(cmd);
            }}
            onApprove={handleApprove}
            onReject={handleReject}
            onEdit={handleEdit}
            onToolApprove={handleToolApprove}
            onToolReject={handleToolReject}
            onToolAlwaysAllow={handleToolAlwaysAllow}
          />
        )}
        {!altScreenVisible && (
          <TerminalModeInput
            ref={inputRef}
            onSubmit={handleSubmit}
            mode={inputMode}
            onToggleMode={toggleMode}
            permissionMode={permissionMode}
            onPermissionChange={setPermissionMode}
            cwd={cwd}
            promptInfo={promptInfo}
            initialValue={editValue}
            disabled={false}
            history={inputHistory}
            onClear={() => setDisplayItems([])}
            fullWidth={fullWidth}
            onToggleFullWidth={toggleFullWidth}
            detectAI={(text) => !looksLikeShellCommand(text)}
            onModeChange={setInputMode}
          />
        )}
      </div>
      {editorOpen && (
        <TerminalModeEditor
          files={editorFiles}
          activeFile={activeEditorFile}
          onSelectFile={setActiveEditorFile}
          onClose={() => setEditorOpen(false)}
        />
      )}

      <style>{`
        .tm-view {
          flex: 1;
          display: flex;
          flex-direction: row;
          background: var(--bg);
          min-width: 0;
          min-height: 0;
          overflow: hidden;
        }
      `}</style>
    </div>
  );
}
