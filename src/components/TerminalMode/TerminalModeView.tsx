import { useState, useRef, useEffect, useCallback } from 'react';
import { parse as shellParse } from 'shell-quote';
import TerminalModeBlockList from './TerminalModeBlockList';
import TerminalModeInput from './TerminalModeInput';
import type { TerminalModeInputHandle } from './TerminalModeInput';
import TerminalModeEditor from './TerminalModeEditor';
import { stripAnsi } from './stripAnsi';
import { getActiveTerminalId } from '../../terminalBuffer';
import LiveTerminal, { extractTerminalOutput } from './InteractiveTerminalBlock';
import type { Block, CommandBlock as CommandBlockType, ApprovalBlock as ApprovalBlockType, ToolApprovalBlock as ToolApprovalBlockType, InputMode } from './types';

const PROMPT_RE = /(\S+[@:]\S+[\$#%>❯]|[\$#%❯])\s*$/;

interface TerminalModeViewProps {
  projectPath: string;
  aiProvider?: 'claude' | 'codex' | 'gemini';
}

function nextBlockId(): string {
  return `tm-${crypto.randomUUID()}`;
}

function nextGroupId(): string {
  return `grp-${crypto.randomUUID()}`;
}

interface PendingCommand {
  blockId: string;
  command: string;
  startTime: number;
  echoSkipped: boolean;
  echoCommand: string;
  lineBuffer: string;
  dataReceived: number; // bytes of data received so far
  outputBuffer: string; // raw output collected before live terminal mounts
  liveShown: boolean;   // whether the live terminal has been shown
}

interface LiveTerminalState {
  ptyId: number;
  command: string;
  blockId: string;
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

export default function TerminalModeView({ projectPath, aiProvider = 'claude' }: TerminalModeViewProps) {
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [inputMode, setInputMode] = useState<InputMode>('shell');
  const [editValue, setEditValue] = useState<string | undefined>(undefined);
  const [cwd, setCwd] = useState(projectPath || '~');
  const [permissionMode, setPermissionMode] = useState<'default' | 'bypass'>('default');
  const [fullWidth, setFullWidth] = useState(false);

  useEffect(() => {
    window.sai.settingsGet('terminalFullWidth', false).then((v: boolean) => setFullWidth(v));
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
  // Active pending commands per PTY (for prompt detection)
  const pendingBlocksRef = useRef<Map<number, PendingCommand>>(new Map());
  // Live terminal state — when a command is running, this replaces the input
  const [liveTerminal, setLiveTerminal] = useState<LiveTerminalState | null>(null);
  // Direct ref to the live terminal's xterm instance for output extraction
  const liveTermXtermRef = useRef<import('@xterm/xterm').Terminal | null>(null);
  // Track active AI cleanup so Ctrl+C can abort it
  const aiCleanupRef = useRef<(() => void) | null>(null);
  const aiBlockIdRef = useRef<string | null>(null);
  // Ref to the input component for pasting
  const inputRef = useRef<TerminalModeInputHandle>(null);
  // Track whether the system preamble has been sent this session
  const preambleSentRef = useRef(false);

  // Update cwd when projectPath changes (workspace switch)
  useEffect(() => {
    if (projectPath) setCwd(projectPath);
  }, [projectPath]);

  const refreshCwd = useCallback(async (ptyId: number) => {
    try {
      const dir = await window.sai.terminalGetCwd(ptyId);
      if (dir) setCwd(dir);
    } catch { /* ignore */ }
  }, []);

  // Create fallback PTY + listen to ALL terminal data
  useEffect(() => {
    let cancelled = false;

    // Data listener for prompt detection — xterm handles rendering
    const cleanupData = window.sai.terminalOnData((ptyId: number, data: string) => {
      if (cancelled) return;

      const pending = pendingBlocksRef.current.get(ptyId);
      if (!pending) return;

      pending.dataReceived += data.length;

      // Buffer raw output when live terminal isn't shown yet
      if (!pending.liveShown) {
        pending.outputBuffer += data;
      }

      // After enough data, assume echo has been consumed (TUI apps scramble it)
      if (!pending.echoSkipped && pending.dataReceived > 200) {
        pending.echoSkipped = true;
      }

      const stripped = stripAnsi(data);
      const chunks = (pending.lineBuffer + stripped).split('\n');
      pending.lineBuffer = chunks.pop() || '';

      const finishCommand = () => {
        const dur = Date.now() - pending.startTime;
        let output = '';
        if (pending.liveShown && liveTermXtermRef.current) {
          // Extract from xterm buffer
          output = extractTerminalOutput(liveTermXtermRef.current, pending.command);
        } else {
          // Use buffered output, strip ANSI and clean up
          output = stripAnsi(pending.outputBuffer).trim();
          // Strip echoed command from start
          const cmdIdx = output.indexOf(pending.command);
          if (cmdIdx !== -1) {
            output = output.slice(cmdIdx + pending.command.length).replace(/^\r?\n/, '');
          }
          // Strip trailing prompt
          const lines = output.split('\n');
          while (lines.length > 0) {
            const last = lines[lines.length - 1].trim();
            if (!last || PROMPT_RE.test(last)) lines.pop();
            else break;
          }
          output = lines.join('\n').trimEnd();
        }
        const block: CommandBlockType = {
          type: 'command',
          id: pending.blockId,
          command: pending.command,
          output,
          exitCode: 0,
          startTime: pending.startTime,
          duration: dur,
          groupId: currentGroupRef.current,
        };
        pendingBlocksRef.current.delete(ptyId);
        // Cancel live terminal timer if command finished before it fired
        if (liveTerminalTimerRef.current) {
          clearTimeout(liveTerminalTimerRef.current);
          liveTerminalTimerRef.current = null;
        }
        setBlocks(prev => [...prev, block]);
        if (pending.liveShown) {
          setLiveTerminal(null);
          liveTermXtermRef.current = null;
        }
        refreshCwd(ptyId);
      };

      for (const line of chunks) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        if (!pending.echoSkipped && trimmed.includes(pending.echoCommand)) {
          pending.echoSkipped = true;
          continue;
        }

        if (pending.echoSkipped && PROMPT_RE.test(trimmed)) {
          finishCommand();
          return;
        }
      }

      // Check partial line buffer for prompt
      const partialTrimmed = pending.lineBuffer.trim();
      if (partialTrimmed && pending.echoSkipped && PROMPT_RE.test(partialTrimmed)) {
        finishCommand();
      }
    });

    // Create fallback PTY
    const ptyPromise = window.sai.terminalCreate(projectPath).then((id: number) => {
      if (cancelled) {
        window.sai.terminalKill(id);
        return id;
      }
      fallbackPtyRef.current = id;
      refreshCwd(id);
      return id;
    });
    fallbackPtyReadyRef.current = ptyPromise;

    return () => {
      cancelled = true;
      cleanupData();
      if (fallbackPtyRef.current !== null) {
        window.sai.terminalKill(fallbackPtyRef.current);
        fallbackPtyRef.current = null;
      }
      pendingBlocksRef.current.clear();
      // Stop any active AI request
      if (aiCleanupRef.current) {
        window.sai.claudeStop(projectPath, 'terminal');
        aiCleanupRef.current();
        aiCleanupRef.current = null;
        aiBlockIdRef.current = null;
      }
    };
  }, [projectPath, refreshCwd]);

  const liveTerminalTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const executeCommand = useCallback(async (command: string) => {
    let termId = getActiveTerminalId() ?? fallbackPtyRef.current;
    if (termId === null && fallbackPtyReadyRef.current) {
      termId = await fallbackPtyReadyRef.current;
    }
    if (termId === null) return;

    const blockId = nextBlockId();

    pendingBlocksRef.current.set(termId, {
      blockId,
      command,
      startTime: Date.now(),
      echoSkipped: false,
      echoCommand: command,
      lineBuffer: '',
      dataReceived: 0,
      outputBuffer: '',
      liveShown: false,
    });

    // Delay showing live terminal — fast commands finish before this fires
    const tid = termId;
    liveTerminalTimerRef.current = setTimeout(() => {
      const pending = pendingBlocksRef.current.get(tid);
      if (pending) {
        pending.liveShown = true;
        setLiveTerminal({ ptyId: tid, command, blockId });
      }
    }, 300);

    window.sai.terminalWrite(termId, command + '\n');
  }, []);

  const handleSubmit = useCallback((value: string) => {
    if (inputMode === 'shell') {
      executeCommand(value);
      setEditValue(undefined);
    } else {
      currentGroupRef.current = nextGroupId();
      handleAIRequest(value);
    }
  }, [inputMode, executeCommand]);

  const handleAIRequest = useCallback((prompt: string) => {
    const promptBlockId = nextBlockId();
    let aiBlockId = nextBlockId();
    let turnSeq: number | null = null;
    let gotContent = false;
    let needsNewBlock = false; // true after approval_needed — next assistant msg gets a new block

    setBlocks(prev => [...prev,
      {
        type: 'ai-prompt' as const,
        id: promptBlockId,
        content: prompt,
      },
      {
        type: 'ai-response' as const,
        id: aiBlockId,
        content: '',
        parentBlockId: promptBlockId,
        streaming: true,
      },
    ]);

    const finalize = () => {
      setBlocks(prev => {
        const aiBlock = prev.find(b => b.id === aiBlockId);
        if (!aiBlock || aiBlock.type !== 'ai-response') return prev;

        const bashMatches = [...aiBlock.content.matchAll(/```(?:bash|sh|shell)\n([\s\S]*?)```/g)];
        if (bashMatches.length === 0) return prev;

        const approvalBlocks = bashMatches.map(m => ({
          type: 'approval' as const,
          id: nextBlockId(),
          command: m[1].trim(),
          parentBlockId: aiBlockId,
          status: 'pending' as const,
        }));
        return [...prev, ...approvalBlocks];
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

    const updateBlock = () => {
      // Build a plain content string from text entries for copy/finalize
      const contentParts = entries.filter(e => e.kind === 'text').map(e => e.text);
      const content = contentParts.join('\n\n');
      setBlocks(prev => prev.map(b => {
        if (b.id !== aiBlockId || b.type !== 'ai-response') return b;
        return { ...b, content, entries: [...entries], toolActivity: [...allToolNames] };
      }));
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
              updateBlock();
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
                  // Update the previous block
                  const prevContentParts = prev.entries.filter(e => e.kind === 'text').map(e => e.text);
                  const prevContent = prevContentParts.join('\n\n');
                  setBlocks(b => b.map(blk =>
                    blk.id === prev.blockId && blk.type === 'ai-response'
                      ? { ...blk, content: prevContent, entries: [...prev.entries] }
                      : blk
                  ));
                }
              }
            }
          }
        }
      }

      if (msg.type === 'assistant' && msg.message?.content) {
        // After a tool approval, start a fresh ai-response block below the approval
        if (needsNewBlock) {
          needsNewBlock = false;
          // Save current entries so tool_results can still find them
          const oldBlockId = aiBlockId;
          const oldEntries = entries;
          for (const e of oldEntries) {
            if (e.kind === 'tool') prevBlockEntries.set(e.call.id, { entries: oldEntries, blockId: oldBlockId });
          }
          aiBlockId = nextBlockId();
          entries = [];
          allToolNames = [];
          knownToolIds = new Set<string>();
          lastTextEntry = '';
          setBlocks(prev => [...prev, {
            type: 'ai-response' as const,
            id: aiBlockId,
            content: '',
            parentBlockId: promptBlockId,
            streaming: true,
          }]);
          aiBlockIdRef.current = aiBlockId;
        }

        const contentBlocks = Array.isArray(msg.message.content) ? msg.message.content : [];
        let hasNewData = false;

        // Extract text — each assistant partial has full accumulated text for this turn
        const textParts: string[] = [];
        for (const block of contentBlocks) {
          if (block.type === 'text' && block.text) {
            textParts.push(block.text);
          }
        }
        const text = textParts.join('');

        if (text && text !== lastTextEntry) {
          gotContent = true;
          // Find the last text entry to update, or add a new one
          const lastIdx = entries.length - 1;
          const lastEntry = lastIdx >= 0 ? entries[lastIdx] : null;

          if (lastEntry && lastEntry.kind === 'text') {
            // Update existing text entry (streaming partial for same turn)
            lastEntry.text = text;
          } else {
            // New text after tool calls — add new text entry
            entries.push({ kind: 'text', text });
          }
          lastTextEntry = text;
          hasNewData = true;
        }

        // Extract tool_use blocks — add as entries
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

        if (hasNewData) updateBlock();
      }

      // Tool approval request — Claude wants to run a tool
      if (msg.type === 'approval_needed') {
        // Freeze the current ai-response block (stop streaming indicator)
        setBlocks(prev => {
          const updated = prev.map(b =>
            b.id === aiBlockId && b.type === 'ai-response'
              ? { ...b, streaming: false }
              : b
          );
          return [...updated, {
            type: 'tool-approval' as const,
            id: nextBlockId(),
            toolName: msg.toolName,
            toolUseId: msg.toolUseId,
            command: msg.command || '',
            description: msg.description || '',
            status: 'pending' as const,
          }];
        });
        needsNewBlock = true;
      }

      // Result message carries the final answer text — don't cleanup here,
      // Claude may do multiple tool-use turns before the final 'done'.
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
            updateBlock();
          }
        }
        return;
      }

      // Done signals true end of the entire turn — cleanup here
      if (msg.type === 'done') {
        // If we have a turnSeq, only honor done with matching seq
        if (turnSeq != null && msg.turnSeq != null && msg.turnSeq !== turnSeq) return;
        // If we haven't received any content or result yet, this is likely a stale done
        // from a process restart — ignore it
        if (!gotContent && turnSeq === null) return;
        setBlocks(prev => prev.map(b =>
          b.id === aiBlockId && b.type === 'ai-response'
            ? { ...b, streaming: false }
            : b
        ));
        aiCleanupRef.current = null;
        aiBlockIdRef.current = null;
        cleanup();
        finalize();
      }
    });

    // Track this request so Ctrl+C can abort it
    aiCleanupRef.current = cleanup;
    aiBlockIdRef.current = aiBlockId;

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
  }, [projectPath]);

  const handleAskAI = useCallback((block: CommandBlockType) => {
    currentGroupRef.current = nextGroupId();
    const prompt = `The following command ${block.exitCode === 0 ? 'succeeded' : 'failed'} with exit code ${block.exitCode}:\n\n\`\`\`\n$ ${block.command}\n${block.output}\n\`\`\`\n\nAnalyze this and suggest a fix if needed. If you suggest a command, put it in a \`\`\`bash code block.`;
    handleAIRequest(prompt);
  }, [handleAIRequest]);

  const handleCopy = useCallback((text: string) => {
    navigator.clipboard.writeText(text);
  }, []);

  const handleRerun = useCallback((command: string) => {
    executeCommand(command);
  }, [executeCommand]);

  const handleApprove = useCallback((block: ApprovalBlockType) => {
    setBlocks(prev => prev.map(b =>
      b.id === block.id ? { ...b, status: 'approved' as const } : b
    ));
    currentGroupRef.current = nextGroupId();
    executeCommand(block.command);
  }, [executeCommand]);

  const handleReject = useCallback((block: ApprovalBlockType) => {
    setBlocks(prev => prev.map(b =>
      b.id === block.id ? { ...b, status: 'rejected' as const } : b
    ));
  }, []);

  const handleEdit = useCallback((block: ApprovalBlockType) => {
    setBlocks(prev => prev.map(b =>
      b.id === block.id && b.type === 'approval' ? { ...b, status: 'edited' as const } : b
    ));
    setEditValue(block.command);
    setInputMode('shell');
  }, []);

  const handleToolApprove = useCallback((block: ToolApprovalBlockType) => {
    window.sai.claudeApprove(projectPath, block.toolUseId, true, undefined, 'terminal');
    setBlocks(prev => prev.map(b =>
      b.id === block.id ? { ...b, status: 'approved' as const } : b
    ));
  }, [projectPath]);

  const handleToolReject = useCallback((block: ToolApprovalBlockType) => {
    window.sai.claudeApprove(projectPath, block.toolUseId, false, undefined, 'terminal');
    setBlocks(prev => prev.map(b =>
      b.id === block.id ? { ...b, status: 'rejected' as const } : b
    ));
  }, [projectPath]);

  const handleToolAlwaysAllow = useCallback(async (block: ToolApprovalBlockType) => {
    const pattern = `${block.toolName}(*)`;
    await window.sai.claudeAlwaysAllow(projectPath, pattern);
    window.sai.claudeApprove(projectPath, block.toolUseId, true, undefined, 'terminal');
    setBlocks(prev => prev.map(b =>
      b.id === block.id ? { ...b, status: 'approved' as const } : b
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

  const handleTabComplete = useCallback(async (text: string) => {
    return window.sai.terminalTabComplete(text, cwd);
  }, [cwd]);

  const openFileInEditor = useCallback(async (filePath: string, line?: number) => {
    const absPath = filePath.startsWith('/') ? filePath : `${projectPath}/${filePath}`;
    const content = await window.sai.readFile(absPath);
    if (content === null) return;

    setEditorFiles(prev => {
      const existing = prev.find(f => f.path === absPath);
      if (existing) {
        return prev.map(f => f.path === absPath ? { ...f, highlightLine: line } : f);
      }
      return [...prev, { path: absPath, content, highlightLine: line }];
    });
    setActiveEditorFile(absPath);
    setEditorOpen(true);
  }, [projectPath]);

  // Ctrl+C = kill, Ctrl+Shift+C = copy, Ctrl+Shift+V = paste
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
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
            setBlocks(prev => prev.map(b =>
              b.id === blockId && b.type === 'ai-response'
                ? { ...b, streaming: false }
                : b
            ));
          }
          aiCleanupRef.current();
          aiCleanupRef.current = null;
          aiBlockIdRef.current = null;
        }

        // Cancel live terminal timer
        if (liveTerminalTimerRef.current) {
          clearTimeout(liveTerminalTimerRef.current);
          liveTerminalTimerRef.current = null;
        }

        // Send SIGINT to any running PTY commands
        for (const [ptyId, pending] of pendingBlocksRef.current.entries()) {
          window.sai.terminalWrite(ptyId, '\x03');
          const dur = Date.now() - pending.startTime;
          let output = '';
          if (pending.liveShown && liveTermXtermRef.current) {
            output = extractTerminalOutput(liveTermXtermRef.current, pending.command);
          } else {
            output = stripAnsi(pending.outputBuffer).trim();
          }
          setBlocks(prev => [...prev, {
            type: 'command' as const,
            id: pending.blockId,
            command: pending.command,
            output,
            exitCode: 130,
            startTime: pending.startTime,
            duration: dur,
            groupId: currentGroupRef.current,
          }]);
          pendingBlocksRef.current.delete(ptyId);
        }
        setLiveTerminal(null);
        liveTermXtermRef.current = null;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [projectPath]);

  // Build input history from submitted commands and AI prompts
  const inputHistory = blocks
    .filter(b => b.type === 'command' || b.type === 'ai-prompt')
    .map(b => b.type === 'command' ? b.command : b.content);

  return (
    <div className="tm-view">
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0, overflow: 'hidden' }}>
        <TerminalModeBlockList
          blocks={blocks}
          aiProvider={aiProvider}
          fullWidth={fullWidth}
          onCopy={handleCopy}
          onAskAI={handleAskAI}
          onRerun={handleRerun}
          onApprove={handleApprove}
          onReject={handleReject}
          onEdit={handleEdit}
          onToolApprove={handleToolApprove}
          onToolReject={handleToolReject}
          onToolAlwaysAllow={handleToolAlwaysAllow}
          shrink={!!liveTerminal}
        />
        {liveTerminal && (
          <LiveTerminal
            ptyId={liveTerminal.ptyId}
            command={liveTerminal.command}
            cwd={cwd}
            fullWidth={fullWidth}
            onXtermReady={(xterm) => { liveTermXtermRef.current = xterm; }}
          />
        )}
        <TerminalModeInput
          ref={inputRef}
          onSubmit={handleSubmit}
          mode={inputMode}
          onToggleMode={toggleMode}
          onTabComplete={handleTabComplete}
          permissionMode={permissionMode}
          onPermissionChange={setPermissionMode}
          cwd={cwd}
          initialValue={editValue}
          disabled={false}
          history={inputHistory}
          onClear={() => setBlocks([])}
          fullWidth={fullWidth}
          onToggleFullWidth={toggleFullWidth}
          detectAI={(text) => !looksLikeShellCommand(text)}
          onModeChange={setInputMode}
        />
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
