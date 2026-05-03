import { memo, useState, useRef, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import remarkGfm from 'remark-gfm';
import 'highlight.js/styles/monokai.css';
import { Check, ChevronRight, Circle, Copy, RotateCw, Terminal, TerminalSquare, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import ToolCallCard from './ToolCallCard';
import Stagger from './Stagger';
import { readFlipRect, hasFlipRect } from './flipRegistry';
import { SPRING, DISTANCE, useReducedMotionTransition } from './motion';
import type { ChatMessage as ChatMessageType } from '../../types';
import { getActiveTerminalId } from '../../terminalBuffer';

// Message IDs that have already played their entry animation. Prevents the
// animation from replaying if a message remounts (e.g. workspace swap, list
// re-keying), so existing history doesn't shimmer in on every render.
const SEEN_MESSAGES = new Set<string>();
// Per-message typewriter progress, kept outside component state so a streaming
// message survives unmount/remount (workspace swap, list re-keying) without
// replaying the typewriter from zero.
const TYPEWRITER_PROGRESS = new Map<string, number>();

// Live preference cached at module scope so every mounted ChatMessage shares
// one value without each one doing an IPC roundtrip. Hydrated once on first
// import; SettingsModal broadcasts updates via the `sai-pref-typewriter`
// window event so toggling the setting takes effect without remounting.
let typewriterPref = true;
if (typeof window !== 'undefined' && (window as any).sai?.settingsGet) {
  (window as any).sai.settingsGet('typewriterEnabled', true).then((v: boolean) => { typewriterPref = v !== false; });
}

// Walk back to the nearest whitespace at-or-before `len` so the visible text
// only advances on word boundaries. Prevents mid-word twitching and stops
// react-markdown / highlight.js from re-tokenizing half-finished tokens.
function snapToWordBoundary(text: string, len: number): number {
  if (len >= text.length) return text.length;
  if (len <= 0) return 0;
  for (let i = len; i > 0; i--) {
    const c = text.charCodeAt(i);
    if (c === 32 /* space */ || c === 10 /* \n */ || c === 9 /* \t */) return i;
  }
  return 0;
}

const FILE_PATH_RE = /(?<![:/])\b((?:\.{1,2}\/)?(?:[\w.-]+\/)+[\w.-]+\.(?:ts|tsx|js|jsx|mjs|cjs|py|md|json|css|scss|sass|html|yaml|yml|toml|sh|bash|zsh|go|rs|rb|java|c|cpp|h|hpp|vue|svelte))(?::(\d+))?\b|(?<![:/.\w])((?:\/[\w.-]+)+\.(?:ts|tsx|js|jsx|mjs|cjs|py|md|json|css|scss|sass|html|yaml|yml|toml|sh|bash|zsh|go|rs|rb|java|c|cpp|h|hpp|vue|svelte))(?::(\d+))?\b/g;

const URL_RE = /https?:\/\/[^\s<>)\]]+/g;

function linkifyText(text: string): any[] {
  // First pass: find all URLs
  URL_RE.lastIndex = 0;
  const urlMatches: { index: number; length: number; value: string; type: 'url' }[] = [];
  let m: RegExpExecArray | null;
  while ((m = URL_RE.exec(text)) !== null) {
    // Strip trailing punctuation that's likely not part of the URL
    let url = m[0].replace(/[.,;:!?)]+$/, '');
    urlMatches.push({ index: m.index, length: url.length, value: url, type: 'url' });
  }

  // Second pass: find file paths in non-URL segments
  const allMatches: { index: number; length: number; value: string; line?: string; type: 'url' | 'file' }[] = [...urlMatches];

  // Build ranges covered by URLs to skip
  const urlRanges = urlMatches.map(u => [u.index, u.index + u.length]);
  FILE_PATH_RE.lastIndex = 0;
  while ((m = FILE_PATH_RE.exec(text)) !== null) {
    const start = m.index;
    const end = start + m[0].length;
    const inUrl = urlRanges.some(([us, ue]) => start >= us && end <= ue);
    if (!inUrl) {
      const filePath = m[1] || m[3];
      const lineMatch = m[2] || m[4];
      const lineNum = lineMatch ? `:${lineMatch}` : '';
      allMatches.push({ index: m.index, length: m[0].length, value: filePath, line: lineNum, type: 'file' });
    }
  }

  if (allMatches.length === 0) return [];

  // Sort by position
  allMatches.sort((a, b) => a.index - b.index);

  const parts: any[] = [];
  let lastIndex = 0;
  for (const match of allMatches) {
    if (match.index > lastIndex) {
      parts.push({ type: 'text', value: text.slice(lastIndex, match.index) });
    }
    if (match.type === 'url') {
      parts.push({
        type: 'element', tagName: 'a',
        properties: { href: match.value },
        children: [{ type: 'text', value: match.value }],
      });
    } else {
      const href = `sai-file://${match.value}${match.line || ''}`;
      parts.push({
        type: 'element', tagName: 'a',
        properties: { href, className: ['file-link'] },
        children: [{ type: 'text', value: match.value + (match.line || '') }],
      });
    }
    lastIndex = match.index + match.length;
  }
  if (lastIndex < text.length) {
    parts.push({ type: 'text', value: text.slice(lastIndex) });
  }
  return parts;
}

function rehypeFilePaths() {
  return (tree: any) => {
    function walk(node: any, insidePre = false): void {
      if (node.tagName === 'a') return;
      // Skip code blocks (pre > code) but allow inline code
      if (node.tagName === 'pre') { insidePre = true; }
      if (node.tagName === 'code' && insidePre) return;
      if (node.type === 'text' && node.value) {
        return; // handled at parent level
      }
      if (!node.children) return;
      const newChildren: any[] = [];
      for (const child of node.children) {
        if (child.type === 'text' && child.value) {
          const parts = linkifyText(child.value);
          if (parts.length > 0) {
            newChildren.push(...parts);
          } else {
            newChildren.push(child);
          }
        } else {
          walk(child, insidePre);
          newChildren.push(child);
        }
      }
      node.children = newChildren;
    }
    walk(tree);
  };
}

const SHELL_LANGUAGES = new Set(['language-bash', 'language-sh', 'language-shell', 'language-zsh']);

function CodeBlock({ children, ...props }: any) {
  const codeRef = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);

  const codeChild = Array.isArray(children) ? children[0] : children;
  const codeClassName: string = codeChild?.props?.className || '';
  const classes = codeClassName.split(/\s+/);
  const isShell = classes.some((c: string) => SHELL_LANGUAGES.has(c));

  const getCode = useCallback(() => {
    return codeRef.current?.textContent || '';
  }, []);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(getCode());
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [getCode]);

  const handlePasteToTerminal = useCallback(() => {
    const id = getActiveTerminalId();
    if (id !== null) {
      window.sai.terminalWrite(id, getCode());
    }
  }, [getCode]);

  return (
    <div className="code-block-wrapper">
      <div className="code-block-actions">
        {isShell && (
          <span className="code-block-icon" title="Paste to terminal" onClick={handlePasteToTerminal}>
            <TerminalSquare size={14} />
          </span>
        )}
        {copied
          ? <span className="code-block-icon code-block-icon-check" title="Copied">
              <Check size={14} />
            </span>
          : <span className="code-block-icon" title="Copy" onClick={handleCopy}>
              <Copy size={14} />
            </span>}
      </div>
      <pre ref={codeRef} {...props}>{children}</pre>
    </div>
  );
}

function getDotColor(role: string): string {
  if (role === 'assistant') return 'var(--accent)';
  if (role === 'user') return 'var(--green)';
  if (role === 'system') return 'var(--red)';
  return 'var(--text-muted)';
}

function ImageModal({ src, onClose }: { src: string; onClose: () => void }) {
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    const stop = (e: WheelEvent) => e.preventDefault();
    window.addEventListener('wheel', stop, { passive: false });
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const dismissCtx = () => setCtxMenu(null);
    window.addEventListener('click', dismissCtx);
    return () => {
      window.removeEventListener('wheel', stop);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('click', dismissCtx);
    };
  }, [onClose]);

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({ x: e.clientX, y: e.clientY });
  };

  const handleCopy = async () => {
    setCtxMenu(null);
    try {
      const img = imgRef.current;
      if (!img) return;
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(img, 0, 0);
      const blob = await new Promise<Blob | null>(r => canvas.toBlob(r, 'image/png'));
      if (blob) await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    } catch { /* clipboard may not be available */ }
  };

  return createPortal(
    <div className="img-modal-overlay" onClick={onClose} onContextMenu={handleContextMenu}>
      <button className="img-modal-close" onClick={onClose}><X size={18} /></button>
      <img
        ref={imgRef}
        src={src}
        alt="Full size"
        className="img-modal-img"
        onClick={e => e.stopPropagation()}
        onContextMenu={handleContextMenu}
      />
      {ctxMenu && (
        <div className="img-modal-ctx" style={{ top: ctxMenu.y, left: ctxMenu.x }} onClick={e => e.stopPropagation()}>
          <button onClick={handleCopy}><Copy size={14} /> Copy Image</button>
          <button onClick={() => { setCtxMenu(null); onClose(); }}><X size={14} /> Close</button>
        </div>
      )}
    </div>,
    document.body
  );
}

function ChatMessage({ message, projectPath, onFileOpen, aiProvider = 'claude', toolCallsExpanded = true, onRetry, isStreaming = false, isFirstAssistantOfTurn = false, pinnedLayoutId }: { message: ChatMessageType; projectPath?: string; onFileOpen?: (path: string, line?: number) => void; aiProvider?: 'claude' | 'codex' | 'gemini'; toolCallsExpanded?: boolean; onRetry?: () => void; isStreaming?: boolean; isFirstAssistantOfTurn?: boolean; pinnedLayoutId?: string }) {
  const dotColor = getDotColor(message.role);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [errorDetailsOpen, setErrorDetailsOpen] = useState(false);
  const [errorDetailsCopied, setErrorDetailsCopied] = useState(false);
  const [shouldAnimateEntry] = useState(() => !SEEN_MESSAGES.has(message.id));
  useEffect(() => { SEEN_MESSAGES.add(message.id); }, [message.id]);
  const flipNodeRef = useRef<HTMLDivElement | null>(null);
  const entryTransition = useReducedMotionTransition(SPRING.pop);
  const entryDistance = DISTANCE.slide;
  const entryProps = shouldAnimateEntry
    ? { initial: { opacity: 0, y: entryDistance }, animate: { opacity: 1, y: 0 }, transition: entryTransition }
    : { initial: false as const, animate: { opacity: 1, y: 0 } };

  // Stable for the lifetime of the component — the registry is only
  // checked once at mount time. `hasFlipRect` is non-destructive so it's
  // safe inside the `useState` initializer (StrictMode invokes it twice).
  const [flipActive] = useState(() => {
    if (typeof window === 'undefined') return false;
    if (message.role !== 'user') return false;
    if (typeof window.matchMedia === 'function'
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return false;
    }
    return hasFlipRect(message.id);
  });

  // Two-phase FLIP using framer's own initial/animate props:
  // Phase 1 ("measuring"): mount the bubble at its natural slot, but invisible,
  // and use a callback ref to measure the destination as soon as the DOM
  // attaches. Then transition to phase 2.
  // Phase 2 ("flipping"): remount the bubble (key change) with framer's
  // `initial` set to the composer-relative offset, so framer drives the
  // slide-up + fade-in via its normal animation pipeline.
  const [flipPhase, setFlipPhase] = useState<'measuring' | 'flipping' | 'done'>(
    flipActive ? 'measuring' : 'done'
  );
  const flipOffsetRef = useRef(0);
  const measureFlip = useCallback((node: HTMLDivElement | null) => {
    flipNodeRef.current = node;
    if (!node || !flipActive || flipPhase !== 'measuring') return;
    const fromRect = readFlipRect(message.id);
    if (!fromRect) { setFlipPhase('done'); return; }
    const toRect = node.getBoundingClientRect();
    flipOffsetRef.current = fromRect.top - toRect.top;
    setFlipPhase('flipping');
  }, [flipActive, flipPhase, message.id]);

  const flipInitial = flipPhase === 'flipping'
    ? { y: flipOffsetRef.current, opacity: 0.6 }
    : false as const;
  const flipTransition = useReducedMotionTransition(SPRING.dock);
  const detailsTransition = useReducedMotionTransition(SPRING.gentle);
  const effectiveEntryProps = flipActive
    ? {
        initial: flipInitial,
        animate: { y: 0, opacity: 1 },
        transition: flipPhase === 'flipping' ? flipTransition : { duration: 0 },
      }
    : entryProps;

  const rawAssistantContent = (message.role === 'assistant' && typeof message.content === 'string')
    ? message.content
    : '';
  const isAssistantStreamingFlag = isStreaming && message.role === 'assistant';
  const [typewriterEnabled, setTypewriterEnabled] = useState(typewriterPref);
  useEffect(() => {
    const onPref = (e: Event) => setTypewriterEnabled(!!(e as CustomEvent).detail);
    window.addEventListener('sai-pref-typewriter', onPref);
    return () => window.removeEventListener('sai-pref-typewriter', onPref);
  }, []);
  const tickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSeenContentLenRef = useRef(0);
  // Null the ref alongside clearing — otherwise the typewriter effect's
  // `if (tickTimerRef.current) return` early-out treats the canceled timer ID
  // as a still-pending timer and never schedules a replacement, freezing the
  // typewriter at displayLen=0. (Surfaces in StrictMode dev: cleanup-between-
  // effect-runs cancels the just-scheduled timer; without nulling, the second
  // run bails and no tick ever fires.)
  useEffect(() => () => {
    if (tickTimerRef.current) {
      clearTimeout(tickTimerRef.current);
      tickTimerRef.current = null;
    }
  }, []);
  // Typewriter stays active even after `isStreaming` flips false — short
  // replies often finalize before the typewriter has time to drip, so we
  // keep dripping until the visible text catches up to the buffer. A live
  // entry in TYPEWRITER_PROGRESS marks "this message has been typing."
  const typewriterActive = typewriterEnabled && message.role === 'assistant' && (isAssistantStreamingFlag || TYPEWRITER_PROGRESS.has(message.id));
  const [displayLen, setDisplayLen] = useState(() => {
    if (!typewriterActive) return rawAssistantContent.length;
    return TYPEWRITER_PROGRESS.get(message.id) ?? 0;
  });
  useEffect(() => {
    if (!typewriterActive) {
      if (tickTimerRef.current) { clearTimeout(tickTimerRef.current); tickTimerRef.current = null; }
      if (displayLen !== rawAssistantContent.length) setDisplayLen(rawAssistantContent.length);
      lastSeenContentLenRef.current = rawAssistantContent.length;
      return;
    }
    if (displayLen >= rawAssistantContent.length) {
      // Caught up — clear the marker so a future re-mount of this message
      // (workspace swap, list re-keying) renders the full content instantly
      // instead of replaying the typewriter.
      TYPEWRITER_PROGRESS.delete(message.id);
      lastSeenContentLenRef.current = rawAssistantContent.length;
      return;
    }
    // First tick after a streaming start — make sure the marker is set so
    // the post-stream finalization path keeps the typewriter alive.
    if (!TYPEWRITER_PROGRESS.has(message.id)) TYPEWRITER_PROGRESS.set(message.id, displayLen);
    // Detect a single large IPC chunk (code block / big paragraph dump) by
    // measuring the *delta since last evaluation*, not total backlog. Backlog
    // naturally grows whenever the model streams faster than ~560 chars/sec,
    // so a backlog threshold trips on every fast stream and stops dripping
    // entirely. A per-flush delta only trips when the model hands us a true
    // burst in one go.
    const burstDelta = rawAssistantContent.length - lastSeenContentLenRef.current;
    lastSeenContentLenRef.current = rawAssistantContent.length;
    if (burstDelta > 1200) {
      if (tickTimerRef.current) { clearTimeout(tickTimerRef.current); tickTimerRef.current = null; }
      setDisplayLen(rawAssistantContent.length);
      TYPEWRITER_PROGRESS.set(message.id, rawAssistantContent.length);
      return;
    }
    const remaining = rawAssistantContent.length - displayLen;
    // Don't reschedule if a tick is already pending — letting it fire is
    // what guarantees forward progress when content updates arrive on the
    // same cadence as the tick (the stream-buffer flush is also ~33ms, so
    // restarting the timer on every flush would starve the typewriter).
    if (tickTimerRef.current) return;
    // Drain to zero in at most ~15 ticks (~480ms at 32ms cadence). A larger
    // ratio on big bursts cuts the number of markdown/highlight.js re-renders
    // in half versus a slow drain, which is what makes auto-scroll feel
    // jittery during long replies. Floor keeps short replies readable.
    const step = Math.max(18, Math.ceil(remaining / 15));
    tickTimerRef.current = setTimeout(() => {
      tickTimerRef.current = null;
      setDisplayLen(d => {
        const next = Math.min(d + step, rawAssistantContent.length);
        TYPEWRITER_PROGRESS.set(message.id, next);
        return next;
      });
    }, 32);
  }, [typewriterActive, rawAssistantContent.length, displayLen, message.id]);

  if (message.error) {
    const { title, status, message: errMsg, requestId, details, errorType } = message.error;
    const handleCopyDetails = () => {
      if (!details) return;
      navigator.clipboard.writeText(details);
      setErrorDetailsCopied(true);
      setTimeout(() => setErrorDetailsCopied(false), 1500);
    };

    return (
      <motion.div
        className={`chat-msg chat-msg-error-wrap${message.error ? ' chat-msg-error-pulse' : ''}`}
        {...entryProps}
      >
        <div className="chat-msg-error">
          <div className="chat-msg-error-status-bar" data-testid="chat-msg-error-status-bar">
            <span className="chat-msg-error-dot" aria-hidden="true" />
            <span className="chat-msg-error-status-label">
              ERROR{errorType ? ` · ${errorType}` : ''}
            </span>
            {status != null && (
              <span className="chat-msg-error-status-http">HTTP {status}</span>
            )}
          </div>

          <div className="chat-msg-error-body" data-testid="chat-msg-error-body">
            <span className="chat-msg-error-prompt" aria-hidden="true">{'›'}</span>{' '}
            <span className="chat-msg-error-msg">{errMsg}</span>
          </div>

          {requestId && (
            <div className="chat-msg-error-meta" data-testid="chat-msg-error-meta">
              <span className="chat-msg-error-meta-key">req_id</span>{' '}
              <span className="chat-msg-error-meta-val">{requestId}</span>
            </div>
          )}

          <AnimatePresence initial={false}>
            {errorDetailsOpen && details && (
              <motion.div
                key="details-panel"
                data-testid="chat-msg-error-details-panel"
                className="chat-msg-error-details-panel"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={detailsTransition}
                style={{ overflow: 'hidden' }}
              >
                <div className="chat-msg-error-details-header">
                  <span className="chat-msg-error-details-label">RAW RESPONSE</span>
                  <button
                    type="button"
                    className="chat-msg-error-copy"
                    onClick={handleCopyDetails}
                    title="Copy raw error"
                  >
                    {errorDetailsCopied ? <Check size={12} /> : <Copy size={12} />}
                  </button>
                </div>
                <pre className="chat-msg-error-details-pre">{details}</pre>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="chat-msg-error-actions">
            {onRetry && (
              <button
                type="button"
                className="chat-msg-error-retry"
                data-testid="chat-msg-error-retry"
                onClick={onRetry}
              >
                <RotateCw size={12} /> Retry
              </button>
            )}
            {details && (
              <button
                type="button"
                className="chat-msg-error-toggle"
                onClick={() => setErrorDetailsOpen(o => !o)}
              >
                <ChevronRight
                  size={12}
                  className={`chat-msg-error-chev ${errorDetailsOpen ? 'open' : ''}`}
                />
                Details
              </button>
            )}
          </div>
        </div>

        <style>{`
          @media (prefers-reduced-motion: no-preference) {
            @keyframes chat-msg-error-pulse {
              0%   { box-shadow: 0 0 0 1px var(--accent); }
              100% { box-shadow: 0 0 0 1px transparent; }
            }
            .chat-msg-error-pulse { animation: chat-msg-error-pulse 200ms ease-out 1; }

            @keyframes chat-msg-error-dot-pulse {
              0%, 100% { transform: scale(1); box-shadow: 0 0 6px var(--red); }
              50%      { transform: scale(1.15); box-shadow: 0 0 10px var(--red); }
            }
            .chat-msg-error-dot {
              animation: chat-msg-error-dot-pulse 1.4s ease-in-out infinite;
            }
          }
          .chat-msg-error-wrap { margin-bottom: 16px; }
          .chat-msg-error {
            background: var(--bg-secondary);
            border: 1px solid var(--border);
            border-radius: 6px;
            overflow: hidden;
            color: var(--text);
            font-size: 13px;
            line-height: 1.55;
          }
          .chat-msg-error-status-bar {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 6px 12px;
            background: var(--bg-input);
            border-bottom: 1px solid var(--border);
            font-size: 11px;
            letter-spacing: 0.06em;
          }
          .chat-msg-error-dot {
            width: 6px;
            height: 6px;
            border-radius: 50%;
            background: var(--red);
            box-shadow: 0 0 6px var(--red);
            flex-shrink: 0;
          }
          .chat-msg-error-status-label {
            color: var(--red);
            font-weight: 600;
          }
          .chat-msg-error-status-http {
            margin-left: auto;
            color: var(--text-muted);
            font-family: 'Geist Mono', 'JetBrains Mono', monospace;
          }
          .chat-msg-error-body {
            padding: 10px 12px 0;
            white-space: pre-wrap;
            word-break: break-word;
          }
          .chat-msg-error-prompt {
            color: var(--red);
            user-select: none;
          }
          .chat-msg-error-msg { color: var(--text); }
          .chat-msg-error-meta {
            padding: 4px 12px 10px;
            font-size: 11px;
            font-family: 'Geist Mono', 'JetBrains Mono', monospace;
          }
          .chat-msg-error-meta-key { color: var(--text-muted); }
          .chat-msg-error-meta-val { color: var(--text-secondary); }
          .chat-msg-error-details-panel {
            border-top: 1px solid var(--border);
          }
          .chat-msg-error-details-header {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 4px 12px;
            font-size: 10px;
            letter-spacing: 0.08em;
          }
          .chat-msg-error-details-label {
            color: var(--text-muted);
            font-weight: 600;
          }
          .chat-msg-error-copy {
            margin-left: auto;
            background: none;
            border: none;
            color: var(--text-muted);
            cursor: pointer;
            display: flex;
            padding: 2px;
            border-radius: 3px;
            transition: color 0.15s;
          }
          .chat-msg-error-copy:hover { color: var(--text); }
          .chat-msg-error-details-pre {
            padding: 8px 12px 10px;
            margin: 0;
            background: var(--bg-secondary);
            font-family: 'Geist Mono', 'JetBrains Mono', monospace;
            font-size: 11px;
            color: var(--text-secondary);
            overflow-x: auto;
            max-height: 200px;
            overflow-y: auto;
          }
          .chat-msg-error-actions {
            display: flex;
            align-items: center;
            gap: 4px;
            padding: 6px 8px;
            background: var(--bg-input);
            border-top: 1px solid var(--border);
          }
          .chat-msg-error-retry {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            background: var(--red);
            color: var(--bg-primary);
            border: none;
            font-weight: 600;
            font-size: 12px;
            padding: 5px 12px;
            border-radius: 5px;
            cursor: pointer;
            transition: background 0.15s;
          }
          .chat-msg-error-retry:hover {
            background: color-mix(in srgb, var(--red) 80%, white 20%);
          }
          .chat-msg-error-toggle {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            background: none;
            border: none;
            color: var(--text-muted);
            font-size: 11px;
            padding: 4px 10px;
            border-radius: 4px;
            cursor: pointer;
            transition: color 0.15s, background 0.15s;
          }
          .chat-msg-error-toggle:hover {
            color: var(--text);
            background: rgba(255, 255, 255, 0.04);
          }
          .chat-msg-error-chev { transition: transform 0.15s; }
          .chat-msg-error-chev.open { transform: rotate(90deg); }
        `}</style>
      </motion.div>
    );
  }

  const isAssistantStreaming = isStreaming && message.role === 'assistant';
  const isTyping = typewriterActive && displayLen < rawAssistantContent.length;

  return (
    <motion.div
      key={flipActive ? flipPhase : undefined}
      ref={flipActive ? measureFlip : flipNodeRef}
      data-testid="chat-msg"
      data-flip-transition={flipActive ? JSON.stringify(flipTransition) : undefined}
      data-entry-transition={JSON.stringify(entryTransition)}
      data-entry-y={String(entryDistance)}
      className={`chat-msg chat-msg-${message.role}${isAssistantStreaming ? ' chat-msg-streaming' : ''}${isTyping ? ' chat-msg-typing' : ''}`}
      style={flipPhase === 'measuring' ? { visibility: 'hidden' } : undefined}
      layoutId={flipActive ? undefined : pinnedLayoutId}
      {...effectiveEntryProps}
    >
      {message.content && (
        <div className="chat-msg-content">
          {message.role === 'user'
            ? <Terminal size={14} color="var(--green)" strokeWidth={2.5} className="chat-msg-dot chat-msg-chevron" />
            : message.role === 'assistant'
            ? <span className={`chat-msg-dot ${aiProvider === 'gemini' ? 'chat-msg-gemini' : aiProvider === 'codex' ? 'chat-msg-openai' : 'chat-msg-claude'}`} />
            : <Circle size={8} fill={dotColor} stroke={dotColor} className="chat-msg-dot" />}
          <div className={`chat-msg-body${isAssistantStreaming ? ' chat-streaming-tail' : ''}`}>
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeHighlight, rehypeFilePaths]}
              urlTransform={(url) => url.startsWith('sai-file://') ? url : defaultUrlTransform(url)}
              components={{
                pre: ({ children, ...props }) => (
                  <CodeBlock {...props}>{children}</CodeBlock>
                ),
                a: ({ href, children }) => (
                  <a
                    href={href}
                    onClick={(e) => {
                      e.preventDefault();
                      if (href?.startsWith('sai-file://') && onFileOpen) {
                        const raw = href.slice('sai-file://'.length);
                        const lineMatch = raw.match(/:(\d+)$/);
                        const line = lineMatch ? parseInt(lineMatch[1], 10) : undefined;
                        const rel = lineMatch ? raw.slice(0, -lineMatch[0].length) : raw;
                        const abs = rel.startsWith('/') ? rel : `${projectPath}/${rel}`;
                        onFileOpen(abs, line);
                      } else if (href) {
                        window.sai.openExternal(href);
                      }
                    }}
                  >
                    {children}
                  </a>
                ),
              }}
            >{(() => {
              const raw = typeof message.content === 'string' ? message.content : String(message.content ?? '');
              // Preserve user newlines as hard line breaks (trailing double-space)
              // so Shift+Enter in the chat input renders visually.
              if (message.role === 'user') return raw.replace(/\n/g, '  \n');
              if (typewriterActive && displayLen < rawAssistantContent.length) return raw.slice(0, snapToWordBoundary(raw, displayLen));
              return raw;
            })()}</ReactMarkdown>
            {message.images && message.images.length > 0 && (
              <div className="chat-msg-images">
                {message.images.map((src, i) => (
                  <img key={i} src={src} alt={`Attached image ${i + 1}`} className="chat-msg-thumb" onClick={() => setLightboxSrc(src)} />
                ))}
              </div>
            )}
          </div>
        </div>
      )}
      {message.toolCalls && message.toolCalls.length > 0 && (
        <Stagger cadence="default">
          {message.toolCalls.map((tc, i) => (
            <ToolCallCard key={i} toolCall={tc} defaultExpanded={toolCallsExpanded} />
          ))}
        </Stagger>
      )}
      {lightboxSrc && <ImageModal src={lightboxSrc} onClose={() => setLightboxSrc(null)} />}
      <style>{`
        .chat-msg {
          margin-bottom: 16px;
          padding: 0 16px;
        }
        /* Typing cursor — pseudo-element on the last block of the rendered
           markdown so it sits inline at the end of the streaming text instead
           of dropping to a new line below the last paragraph. */
        .chat-msg-typing .chat-msg-body > *:last-child::after {
          content: '';
          display: inline-block;
          width: 7px;
          height: 1em;
          margin-left: 3px;
          vertical-align: -2px;
          background: var(--accent);
          border-radius: 1px;
          box-shadow: 0 0 8px color-mix(in srgb, var(--accent) 60%, transparent);
          animation: chat-cursor-blink 1.1s ease-in-out infinite;
        }
        @keyframes chat-cursor-blink {
          0%, 100% { opacity: 0.25; }
          50%      { opacity: 1; }
        }
        .chat-msg-streaming .chat-msg-claude,
        .chat-msg-streaming .chat-msg-openai,
        .chat-msg-streaming .chat-msg-gemini {
          animation: chat-dot-breathe 1.6s ease-in-out infinite;
        }
        @keyframes chat-dot-breathe {
          0%, 100% { transform: scale(1); filter: drop-shadow(0 0 0 transparent); opacity: 0.85; }
          50%      { transform: scale(1.18); filter: drop-shadow(0 0 6px var(--accent)); opacity: 1; }
        }
        .chat-msg-user {
          background: var(--bg-input);
          border: 1px solid var(--border);
          border-radius: 10px;
          padding: 10px 14px;
          margin-left: 14px;
          margin-right: 14px;
        }
        .chat-msg-assistant {
          padding: 4px 14px;
        }
        .chat-msg-content {
          display: flex;
          gap: 10px;
          align-items: flex-start;
        }
        .chat-msg-dot {
          margin-top: 7px;
          flex-shrink: 0;
        }
        .chat-msg-chevron {
          margin-top: 3px;
        }
        .chat-msg-claude {
          width: 14px;
          height: 14px;
          margin-top: 2px;
          background-color: var(--accent);
          -webkit-mask-image: url('svg/claude.svg');
          mask-image: url('svg/claude.svg');
          -webkit-mask-size: contain;
          mask-size: contain;
          -webkit-mask-repeat: no-repeat;
          mask-repeat: no-repeat;
        }
        .chat-msg-openai {
          width: 14px;
          height: 14px;
          margin-top: 2px;
          background-color: var(--accent);
          -webkit-mask-image: url('svg/openai.svg');
          mask-image: url('svg/openai.svg');
          -webkit-mask-size: contain;
          mask-size: contain;
          -webkit-mask-repeat: no-repeat;
          mask-repeat: no-repeat;
        }
        .chat-msg-gemini {
          width: 14px;
          height: 14px;
          margin-top: 2px;
          background-color: var(--accent, #c7910c);
          -webkit-mask-image: url('svg/Google-gemini-icon.svg');
          mask-image: url('svg/Google-gemini-icon.svg');
          -webkit-mask-size: contain;
          mask-size: contain;
          -webkit-mask-repeat: no-repeat;
          mask-repeat: no-repeat;
        }
        .chat-msg-body { color: var(--text); line-height: 1.6; flex: 1; min-width: 0; }
        @media (prefers-reduced-motion: no-preference) {
          @keyframes chat-streaming-tail-sweep {
            from { background-position: -120% 0; }
            to   { background-position:  120% 0; }
          }
          .chat-streaming-tail {
            background-image: linear-gradient(
              90deg,
              transparent 0%,
              transparent 70%,
              color-mix(in srgb, var(--accent) 35%, transparent) 85%,
              transparent 100%
            );
            background-size: 200% 100%;
            background-repeat: no-repeat;
            background-position: 100% 0;
            animation: chat-streaming-tail-sweep 1.6s ease-in-out infinite;
            -webkit-background-clip: text;
                    background-clip: text;
          }
        }
        .chat-msg-body p { margin: 0 0 8px 0; }
        .chat-msg-body p:last-child { margin-bottom: 0; }
        .chat-msg-body ol, .chat-msg-body ul { padding-left: 24px; margin: 0 0 8px 0; }
        .chat-msg-body ol:last-child, .chat-msg-body ul:last-child { margin-bottom: 0; }
        .chat-msg-body li { margin: 2px 0; }
        .chat-msg-body li > p { margin: 0; }
        .chat-msg-body code {
          background: var(--bg-hover);
          padding: 2px 6px;
          border-radius: 3px;
          font-size: 12px;
          border: 1px solid var(--border);
        }
        .chat-msg-body a { color: var(--accent); text-decoration: underline; cursor: pointer; }
        .chat-msg-body a:hover { opacity: 0.8; }
        .chat-msg-body a.file-link { color: var(--green); text-decoration: none; font-family: monospace; font-size: 12px; background: var(--bg-secondary); padding: 1px 5px; border-radius: 3px; }
        .chat-msg-body a.file-link:hover { opacity: 0.8; }
        .chat-msg-body pre code { background: none; padding: 0; border: none; }
        .code-block-wrapper {
          position: relative;
        }
        .code-block-actions {
          position: absolute;
          top: 8px;
          right: 8px;
          display: flex;
          gap: 6px;
          z-index: 1;
        }
        .code-block-icon {
          display: flex;
          color: var(--text-muted);
          opacity: 0.4;
          cursor: pointer;
          transition: opacity 0.15s, color 0.15s;
        }
        .code-block-icon:hover {
          opacity: 1;
          color: var(--text);
        }
        .code-block-icon-check {
          color: var(--green);
          opacity: 0.8;
          cursor: default;
        }
        .chat-msg-body pre {
          background: var(--bg-secondary);
          border-radius: 6px;
          padding: 12px;
          overflow-x: auto;
          margin: 8px 0;
          border-left: 3px solid var(--accent);
        }
        .chat-msg-body pre code.hljs.language-diff {
          padding: 0;
        }
        .chat-msg-body pre code.hljs.language-diff .hljs-addition {
          color: var(--text);
          background: rgba(72, 100, 40, 0.35);
          display: inline-block;
          width: 100%;
        }
        .chat-msg-body pre code.hljs.language-diff .hljs-deletion {
          color: var(--text);
          background: rgba(180, 60, 40, 0.25);
          display: inline-block;
          width: 100%;
        }
        .chat-msg-body pre code.hljs.language-diff .hljs-meta {
          color: var(--text-muted);
        }
        .chat-msg-body blockquote {
          border-left: 3px solid var(--accent);
          margin: 8px 0;
          padding: 4px 12px;
          color: var(--text-muted);
        }
        .chat-msg-body blockquote p:last-child { margin-bottom: 0; }
        .chat-msg-body table {
          border-collapse: collapse;
          width: 100%;
          margin: 8px 0;
          font-size: 13px;
          overflow-x: auto;
          display: block;
        }
        .chat-msg-body th,
        .chat-msg-body td {
          border: 1px solid var(--border);
          padding: 6px 12px;
          text-align: left;
          white-space: nowrap;
        }
        .chat-msg-body th {
          background: var(--bg-secondary);
          font-weight: 600;
          color: var(--text);
        }
        .chat-msg-body td {
          color: var(--text-secondary);
        }
        .chat-msg-body tr:hover td {
          background: var(--bg-secondary);
        }
        .chat-msg-images {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          margin-top: 6px;
        }
        .chat-msg-thumb {
          max-width: 120px;
          max-height: 80px;
          object-fit: cover;
          border-radius: 6px;
          border: 1px solid var(--border);
          cursor: pointer;
          transition: opacity 0.15s;
        }
        .chat-msg-thumb:hover {
          opacity: 0.8;
        }
        .img-modal-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.8);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 2000;
          backdrop-filter: blur(4px);
          cursor: zoom-out;
        }
        .img-modal-img {
          max-width: 90vw;
          max-height: 90vh;
          object-fit: contain;
          border-radius: 6px;
          box-shadow: 0 24px 64px rgba(0, 0, 0, 0.6);
          cursor: default;
        }
        .img-modal-close {
          position: fixed;
          top: calc(var(--titlebar-height, 38px) + 8px);
          right: 16px;
          background: rgba(0, 0, 0, 0.5);
          border: 1px solid rgba(255, 255, 255, 0.15);
          border-radius: 6px;
          color: #fff;
          cursor: pointer;
          padding: 6px;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .img-modal-close:hover {
          background: rgba(255, 255, 255, 0.15);
        }
        .img-modal-ctx {
          position: fixed;
          background: var(--bg-primary, #1e1e1e);
          border: 1px solid var(--border, #333);
          border-radius: 6px;
          padding: 4px;
          z-index: 2001;
          min-width: 140px;
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
        }
        .img-modal-ctx button {
          display: flex;
          align-items: center;
          gap: 8px;
          width: 100%;
          padding: 6px 10px;
          background: none;
          border: none;
          color: var(--text, #ccc);
          font-size: 13px;
          cursor: pointer;
          border-radius: 4px;
        }
        .img-modal-ctx button:hover {
          background: var(--bg-secondary, #2a2a2a);
        }
      `}</style>
    </motion.div>
  );
}

export default memo(ChatMessage, (prev, next) =>
  prev.message === next.message &&
  prev.projectPath === next.projectPath &&
  prev.aiProvider === next.aiProvider &&
  prev.toolCallsExpanded === next.toolCallsExpanded &&
  prev.isStreaming === next.isStreaming &&
  prev.isFirstAssistantOfTurn === next.isFirstAssistantOfTurn &&
  prev.pinnedLayoutId === next.pinnedLayoutId &&
  Boolean(prev.onRetry) === Boolean(next.onRetry)
);
