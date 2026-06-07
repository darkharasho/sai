import React, { memo, useState, useRef, useCallback, useEffect, useLayoutEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import remarkGfm from 'remark-gfm';
import 'highlight.js/styles/monokai.css';
import { Check, ChevronRight, Circle, Copy, Eraser, RotateCw, Terminal, TerminalSquare, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import ToolCallCard from './ToolCallCard';
import GitHubWatcherCard from './GitHubWatcherCard';
import { detectWatchTargets } from './githubWatcher';
import Stagger from './Stagger';
import { readFlipRect, hasFlipRect } from './flipRegistry';
import { SPRING, DISTANCE, FADE_IN, useReducedMotionTransition, prefersReducedMotion } from './motion';
import { revealWords } from './wordReveal';
import type { ChatMessage as ChatMessageType, MetaWorkspaceRuntime } from '../../types';
import { getActiveTerminalId } from '../../terminalBuffer';
import SaiLogo from '../SaiLogo';
import { matchLinkPreview } from './linkPreview';
import LinkPreviewChip from './LinkPreviewChip';
import StreamingAssistantHead from './StreamingAssistantHead';
import { useSaiAnimationPref } from './useSaiAnimationPref';
import { rehypeEmojiIcons } from './rehypeEmojiIcons';
import { renderEmojiSpan } from './emojiIcons';

// Message IDs that have already played their entry animation. Prevents the
// animation from replaying if a message remounts (e.g. workspace swap, list
// re-keying), so existing history doesn't shimmer in on every render.
const SEEN_MESSAGES = new Set<string>();
// Records ids that streamed token-by-token this session, so their post-stream
// re-render is NOT word-revealed (the live append already showed them).
const STREAMED_MESSAGES = new Set<string>();
// A message counts as "fresh" (vs. history) if it arrived within this window.
const REVEAL_FRESH_MS = 8000;
const MD_PLUGINS = {
  remarkPlugins: [remarkGfm],
  rehypePlugins: [rehypeHighlight, rehypeFilePaths],
  urlTransform: (url: string) =>
    url.startsWith('sai-file://') ? url : defaultUrlTransform(url),
};

// Assistant messages also convert emoji to accent-colored SVG icons. User messages
// keep MD_PLUGINS (no conversion) so typed emoji are left as-is.
const ASSISTANT_MD_PLUGINS = {
  ...MD_PLUGINS,
  rehypePlugins: [rehypeHighlight, rehypeFilePaths, rehypeEmojiIcons],
};

const FILE_PATH_RE = /(?<![:/])\b((?:\.{1,2}\/)?(?:[\w.-]+\/)+[\w.-]+\.(?:ts|tsx|js|jsx|mjs|cjs|py|md|json|css|scss|sass|html|yaml|yml|toml|sh|bash|zsh|go|rs|rb|java|c|cpp|h|hpp|vue|svelte))(?::(\d+))?\b|(?<![:/.\w])((?:\/[\w.-]+)+\.(?:ts|tsx|js|jsx|mjs|cjs|py|md|json|css|scss|sass|html|yaml|yml|toml|sh|bash|zsh|go|rs|rb|java|c|cpp|h|hpp|vue|svelte))(?::(\d+))?\b/g;

function formatMs(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  const d = Math.floor((ms % 1000) / 100);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${d}`;
}

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
    <div className="img-modal-overlay sai-overlay-in" onClick={onClose} onContextMenu={handleContextMenu}>
      <button className="img-modal-close" onClick={onClose}><X size={18} /></button>
      <img
        ref={imgRef}
        src={src}
        alt="Full size"
        className="img-modal-img sai-modal-in"
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

function ChatMessage({
  message,
  projectPath,
  onFileOpen,
  aiProvider = 'claude',
  toolCallsExpanded = true,
  onRetry,
  onClearContext,
  isStreaming = false,
  isFirstAssistantOfTurn = false,
  pinnedLayoutId,
  renderToolCall,
  renderMessage,
  metaRuntime,
  onAnswerQuestion,
  onAnswerPlanReview,
  watcherUrlAllowlist,
}: {
  message: ChatMessageType;
  projectPath?: string;
  onFileOpen?: (path: string, line?: number) => void;
  aiProvider?: 'claude' | 'codex' | 'gemini';
  toolCallsExpanded?: boolean;
  onRetry?: () => void;
  onClearContext?: () => void;
  isStreaming?: boolean;
  isFirstAssistantOfTurn?: boolean;
  pinnedLayoutId?: string;
  /** Optional override for tool-call rendering. Return `null` to fall back to the default `ToolCallCard`. */
  renderToolCall?: (tc: import('../../types').ToolCall, defaultExpanded: boolean) => React.ReactNode | null;
  /** Optional whole-message override (e.g. for inline approval cards). Return `null` to use the default renderer. */
  renderMessage?: (message: ChatMessageType) => React.ReactNode | null;
  /** Active meta-workspace runtime; when set, tool-call cards show a project chip. */
  metaRuntime?: MetaWorkspaceRuntime | null;
  /** Submit answers for an AskUserQuestion tool call. */
  onAnswerQuestion?: (toolUseId: string, answers: Record<string, string | string[]>) => Promise<void> | void;
  /** Submit plan review decision for an ExitPlanMode tool call. */
  onAnswerPlanReview?: (toolUseId: string, approved: boolean) => Promise<void> | void;
  /** URLs this message is allowed to render watcher cards for. Undefined = render none;
   *  parent computes per-URL "first message" ownership to prevent duplicate cards. */
  watcherUrlAllowlist?: Set<string>;
}) {
  // Allow callers to substitute the entire message render for special meta
  // types (e.g. inline approval cards). Done before any of the normal layout
  // setup so we don't waste effort.
  if (renderMessage) {
    const custom = renderMessage(message);
    if (custom != null) return <>{custom}</>;
  }
  const dotColor = getDotColor(message.role);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [errorDetailsOpen, setErrorDetailsOpen] = useState(false);
  const [errorDetailsCopied, setErrorDetailsCopied] = useState(false);
  const [shouldAnimateEntry] = useState(() => !SEEN_MESSAGES.has(message.id));
  useEffect(() => { SEEN_MESSAGES.add(message.id); }, [message.id]);
  const flipNodeRef = useRef<HTMLDivElement | null>(null);
  const mdRef = useRef<HTMLDivElement | null>(null);
  const revealedRef = useRef(false);
  const isAssistantMsg = message.role === 'assistant';
  const entryTransition = useReducedMotionTransition(isAssistantMsg ? FADE_IN : SPRING.pop);
  const entryDistance = isAssistantMsg ? 0 : DISTANCE.slide;
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

  const [confirmingClear, setConfirmingClear] = useState(false);
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearBtnRef = useRef<HTMLButtonElement | null>(null);
  const clearLabelTransition = useReducedMotionTransition(SPRING.flick);

  const cancelConfirm = useCallback(() => {
    setConfirmingClear(false);
    if (confirmTimerRef.current) {
      clearTimeout(confirmTimerRef.current);
      confirmTimerRef.current = null;
    }
  }, []);

  const handleClearClick = useCallback(() => {
    if (confirmingClear) {
      cancelConfirm();
      onClearContext?.();
      return;
    }
    setConfirmingClear(true);
    if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
    confirmTimerRef.current = setTimeout(() => {
      setConfirmingClear(false);
      confirmTimerRef.current = null;
    }, 3000);
  }, [confirmingClear, cancelConfirm, onClearContext]);

  useEffect(() => {
    if (!confirmingClear) return;
    const onDocMouseDown = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (target && clearBtnRef.current?.contains(target)) return;
      cancelConfirm();
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [confirmingClear, cancelConfirm]);

  useEffect(() => () => {
    if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
  }, []);
  const effectiveEntryProps = flipActive
    ? {
        initial: flipInitial,
        animate: { y: 0, opacity: 1 },
        transition: flipPhase === 'flipping' ? flipTransition : { duration: 0 },
      }
    : entryProps;

  const saiAnimationEnabled = useSaiAnimationPref();

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
            {onClearContext && (
              <motion.button
                ref={clearBtnRef}
                type="button"
                data-testid="chat-msg-error-clear"
                className={`chat-msg-error-clear${confirmingClear ? ' chat-msg-error-clear--confirming' : ''}`}
                layout
                onClick={handleClearClick}
              >
                <Eraser size={12} />
                <AnimatePresence mode="popLayout" initial={false}>
                  <motion.span
                    key={confirmingClear ? 'confirm' : 'idle'}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={clearLabelTransition}
                  >
                    {confirmingClear ? 'Confirm?' : 'Clear context'}
                  </motion.span>
                </AnimatePresence>
              </motion.button>
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
            border: 1px solid var(--border-subtle);
            border-radius: var(--radius-md);
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
            border-bottom: 1px solid var(--border-hairline);
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
            border-top: 1px solid var(--border-hairline);
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
            border-top: 1px solid var(--border-hairline);
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
          .chat-msg-error-clear {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            background: none;
            border: 1px solid transparent;
            color: var(--text-muted);
            font-size: 11px;
            padding: 4px 10px;
            border-radius: 4px;
            cursor: pointer;
            transition: color 0.15s, background 0.15s, border-color 0.15s;
          }
          .chat-msg-error-clear:hover {
            color: var(--text);
            background: rgba(255, 255, 255, 0.04);
          }
          .chat-msg-error-clear--confirming {
            color: var(--red);
            background: color-mix(in srgb, var(--red) 8%, transparent);
            border-color: color-mix(in srgb, var(--red) 30%, transparent);
          }
          .chat-msg-error-clear--confirming:hover {
            background: color-mix(in srgb, var(--red) 14%, transparent);
          }
        `}</style>
      </motion.div>
    );
  }

  const isAssistantStreaming = isStreaming && message.role === 'assistant';
  const streamedThisSession = STREAMED_MESSAGES.has(message.id);
  const fresh = Date.now() - (message.timestamp ?? 0) <= REVEAL_FRESH_MS;
  const useMorphHead =
    message.role === 'assistant' &&
    saiAnimationEnabled &&
    aiProvider !== 'gemini' &&
    aiProvider !== 'codex' &&
    (isAssistantStreaming || streamedThisSession || fresh);
  useLayoutEffect(() => {
    if (message.role !== 'assistant') return;
    if (isAssistantStreaming) { STREAMED_MESSAGES.add(message.id); }
    if (useMorphHead) return;            // StreamingAssistantHead owns the reveal
    if (isAssistantStreaming) return;
    if (revealedRef.current) return;
    if (!message.content) return;
    // Reveal a reply generated this session (streamed → completed, any duration) or a
    // fresh complete arrival; never history (not streamed this session + old timestamp).
    // The outer `streamedThisSession`/`fresh` are safe to reuse: the add() at the top
    // of this effect only runs when isAssistantStreaming=true, which causes an early
    // return before we reach this point, so the set hasn't changed here.
    if (!streamedThisSession && !fresh) return;
    if (prefersReducedMotion()) return;
    const el = mdRef.current;
    if (!el) return;
    revealedRef.current = true;
    revealWords(el);
  }, [isAssistantStreaming, message.id, message.role, message.content, message.timestamp, useMorphHead]);
  // When the parent passes an allowlist (main chat), only render watchers it explicitly
  // owns — prevents duplicates when the same run URL shows up in multiple messages. Other
  // callers (orchestrator, tests) don't pass an allowlist and get the full set.
  const watcherTargets = watcherUrlAllowlist
    ? detectWatchTargets(message).filter(t => watcherUrlAllowlist.has(t.url))
    : detectWatchTargets(message);

  const markdownComponents = useMemo(() => ({
    pre: ({ children, ...props }: any) => (
      <CodeBlock {...props}>{children}</CodeBlock>
    ),
    span: (props: any) => renderEmojiSpan(props),
    a: ({ href, children }: any) => {
      const preview = href ? matchLinkPreview(href) : null;
      if (preview) {
        return <LinkPreviewChip preview={preview}>{children}</LinkPreviewChip>;
      }
      return (
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
      );
    },
  }), [onFileOpen, projectPath]);

  return (
    <>
    <motion.div
      key={flipActive ? flipPhase : undefined}
      ref={flipActive ? measureFlip : flipNodeRef}
      data-testid="chat-msg"
      data-flip-transition={flipActive ? JSON.stringify(flipTransition) : undefined}
      data-entry-transition={JSON.stringify(entryTransition)}
      data-entry-y={String(entryDistance)}
      className={`chat-msg chat-msg-${message.role}`}
      style={flipPhase === 'measuring' ? { visibility: 'hidden' } : undefined}
      layoutId={flipActive ? undefined : pinnedLayoutId}
      {...effectiveEntryProps}
    >
      {useMorphHead && (isAssistantStreaming || message.content) && (
        <StreamingAssistantHead
          streaming={!!isAssistantStreaming}
          content={typeof message.content === 'string' ? message.content : String(message.content ?? '')}
          durationMs={message.durationMs}
        >
          <ReactMarkdown {...ASSISTANT_MD_PLUGINS} components={markdownComponents}>
            {typeof message.content === 'string' ? message.content : String(message.content ?? '')}
          </ReactMarkdown>
        </StreamingAssistantHead>
      )}
      {!useMorphHead && message.content && (
        <div className="chat-msg-content">
          {message.role === 'user'
            ? <Terminal size={14} color="var(--green)" strokeWidth={2.5} className="chat-msg-dot chat-msg-chevron" />
            : message.role === 'assistant'
            ? (saiAnimationEnabled
                ? <SaiLogo mode="static" size={16} className="chat-msg-dot chat-msg-sai" />
                : <span className={`chat-msg-dot ${aiProvider === 'gemini' ? 'chat-msg-gemini' : aiProvider === 'codex' ? 'chat-msg-openai' : 'chat-msg-claude'}`} />)
            : <Circle size={8} fill={dotColor} stroke={dotColor} className="chat-msg-dot" />}
          <div className="chat-msg-body">
            {message.role === 'assistant' && typeof message.durationMs === 'number' && (
              <div className="chat-msg-duration" data-testid="msg-duration">
                [{formatMs(message.durationMs)}]
              </div>
            )}
            {
              <div ref={mdRef} className="chat-msg-md">
              <ReactMarkdown {...(message.role === 'assistant' ? ASSISTANT_MD_PLUGINS : MD_PLUGINS)} components={markdownComponents}>{(() => {
                const raw = typeof message.content === 'string' ? message.content : String(message.content ?? '');
                // Preserve user newlines as hard line breaks (trailing double-space)
                // so Shift+Enter in the chat input renders visually.
                if (message.role === 'user') return raw.replace(/\n/g, '  \n');
                return raw;
              })()}</ReactMarkdown>
              </div>
            }
          </div>
        </div>
      )}
      {message.images && message.images.length > 0 && (
        <div className="chat-msg-attachments">
          {message.images.map((src, i) => (
            <img
              key={i}
              src={src}
              alt={`Attached image ${i + 1}`}
              className="chat-msg-attachment"
              onClick={() => setLightboxSrc(src)}
            />
          ))}
        </div>
      )}
      {message.toolCalls && message.toolCalls.length > 0 && (
        <Stagger cadence="default">
          {message.toolCalls.map((tc, i) => {
            if (renderToolCall) {
              const custom = renderToolCall(tc, toolCallsExpanded);
              if (custom != null) return <React.Fragment key={i}>{custom}</React.Fragment>;
            }
            return <ToolCallCard key={i} toolCall={tc} defaultExpanded={toolCallsExpanded} metaRuntime={metaRuntime} onAnswerQuestion={onAnswerQuestion} onAnswerPlanReview={onAnswerPlanReview} />;
          })}
        </Stagger>
      )}
      {lightboxSrc && <ImageModal src={lightboxSrc} onClose={() => setLightboxSrc(null)} />}
      <style>{`
        .chat-msg {
          margin-bottom: 16px;
          padding: 0 16px;
        }
        .chat-msg-user {
          background: var(--bg-input);
          border: 1px solid var(--border-subtle);
          border-radius: 14px 14px 4px 14px; /* chat tail (sharp bottom-right) */
          padding: 10px 14px;
          margin-left: auto;   /* push the bubble to the right */
          margin-right: 14px;
          margin-top: 18px;    /* inter-turn gap (replaces the removed divider) */
          width: fit-content;  /* shrink-wrap to the message text */
          max-width: 76%;      /* but never the full width */
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
        .chat-msg-sai {
          margin-top: 1px;
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
        .chat-msg-body { color: var(--text); font-size: var(--text-md); line-height: 1.55; flex: 1; min-width: 0; }
        .chat-msg-duration {
          font-family: 'Geist Mono', 'JetBrains Mono', monospace;
          font-variant-numeric: tabular-nums;
          font-size: 11px;
          color: var(--text-tertiary, #6b6253);
          letter-spacing: 0.04em;
          margin-bottom: 4px;
          user-select: none;
        }
        .chat-msg-body p { margin: 0 0 8px 0; }
        .chat-msg-body p:last-child { margin-bottom: 0; }
        .chat-msg-body ol, .chat-msg-body ul { padding-left: 24px; margin: 0 0 8px 0; }
        .chat-msg-body ol:last-child, .chat-msg-body ul:last-child { margin-bottom: 0; }
        .chat-msg-body li { margin: 2px 0; }
        .chat-msg-body li > p { margin: 0; }
        .chat-msg-body code {
          background: var(--surface-3);
          border: 1px solid var(--border-hairline);
          border-radius: var(--radius-xs);
          font-size: var(--text-sm);
          padding: 1px 4px;
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
          background: var(--surface-2);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-md);
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
          border: 1px solid var(--border-hairline);
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
        .chat-msg-attachments {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin: 8px 0 4px 0;
        }
        .chat-msg-attachment {
          max-width: min(480px, 100%);
          max-height: 320px;
          width: auto;
          height: auto;
          object-fit: contain;
          border-radius: 10px;
          background: var(--bg-secondary, #1a1a1a);
          cursor: zoom-in;
          transition: opacity 0.15s, transform 0.15s;
          display: block;
        }
        .chat-msg-attachment:hover {
          opacity: 0.92;
          transform: translateY(-1px);
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
          border: 1px solid var(--border-subtle, #333);
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
    {watcherTargets.length > 0 && (
      <div className="chat-msg chat-msg-watcher-row" data-testid="chat-msg-watcher-row">
        {watcherTargets.map(t => (
          <GitHubWatcherCard
            key={t.url}
            target={t}
            messageId={message.id}
            seedSnapshot={message.githubWatchers?.find(s => s.url === t.url)}
          />
        ))}
      </div>
    )}
    </>
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
  Boolean(prev.onRetry) === Boolean(next.onRetry) &&
  prev.onClearContext === next.onClearContext &&
  prev.renderToolCall === next.renderToolCall &&
  prev.renderMessage === next.renderMessage &&
  prev.metaRuntime === next.metaRuntime &&
  prev.watcherUrlAllowlist === next.watcherUrlAllowlist
);
