import { useState, useRef, useCallback } from 'react';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import remarkGfm from 'remark-gfm';
import 'highlight.js/styles/monokai.css';
import { Check, Circle, Copy, Terminal, TerminalSquare, X } from 'lucide-react';
import ToolCallCard from './ToolCallCard';
import type { ChatMessage as ChatMessageType } from '../../types';
import { getActiveTerminalId } from '../../terminalBuffer';

const FILE_PATH_RE = /(?<![:/])\b((?:\.{1,2}\/)?(?:[\w.-]+\/)+[\w.-]+\.(?:ts|tsx|js|jsx|mjs|cjs|py|md|json|css|scss|sass|html|yaml|yml|toml|sh|bash|zsh|go|rs|rb|java|c|cpp|h|hpp|vue|svelte)|(?:\/[\w.-]+)+\.(?:ts|tsx|js|jsx|mjs|cjs|py|md|json|css|scss|sass|html|yaml|yml|toml|sh|bash|zsh|go|rs|rb|java|c|cpp|h|hpp|vue|svelte))(?::(\d+))?\b/g;

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
      const lineNum = m[2] ? `:${m[2]}` : '';
      allMatches.push({ index: m.index, length: m[0].length, value: m[1], line: lineNum, type: 'file' });
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
  return (
    <div className="img-modal-overlay" onClick={onClose}>
      <button className="img-modal-close" onClick={onClose}><X size={18} /></button>
      <img
        src={src}
        alt="Full size"
        className="img-modal-img"
        onClick={e => e.stopPropagation()}
      />
    </div>
  );
}

export default function ChatMessage({ message, projectPath, onFileOpen, aiProvider = 'claude' }: { message: ChatMessageType; projectPath?: string; onFileOpen?: (path: string, line?: number) => void; aiProvider?: 'claude' | 'codex' | 'gemini' }) {
  const dotColor = getDotColor(message.role);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);

  return (
    <div className={`chat-msg chat-msg-${message.role}`}>
      {message.content && (
        <div className="chat-msg-content">
          {message.role === 'user'
            ? <Terminal size={14} color="var(--green)" strokeWidth={2.5} className="chat-msg-dot chat-msg-chevron" />
            : message.role === 'assistant'
            ? <span className={`chat-msg-dot ${aiProvider === 'gemini' ? 'chat-msg-gemini' : aiProvider === 'codex' ? 'chat-msg-openai' : 'chat-msg-claude'}`} />
            : <Circle size={8} fill={dotColor} stroke={dotColor} className="chat-msg-dot" />}
          <div className="chat-msg-body">
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
            >{typeof message.content === 'string' ? message.content : String(message.content ?? '')}</ReactMarkdown>
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
      {message.toolCalls?.map((tc, i) => (
        <ToolCallCard key={i} toolCall={tc} />
      ))}
      {lightboxSrc && <ImageModal src={lightboxSrc} onClose={() => setLightboxSrc(null)} />}
      <style>{`
        .chat-msg { margin-bottom: 12px; }
        .chat-msg-user {
          background: rgba(255, 255, 255, 0.02);
          border-radius: 8px;
          padding: 8px 10px;
          margin-left: -10px;
          margin-right: -10px;
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
        .chat-msg-body p { margin: 0 0 8px 0; }
        .chat-msg-body p:last-child { margin-bottom: 0; }
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
        .chat-msg-body pre code { background: none; padding: 0; }
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
          top: 16px;
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
      `}</style>
    </div>
  );
}
