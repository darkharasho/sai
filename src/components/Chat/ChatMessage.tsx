import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import remarkGfm from 'remark-gfm';
import 'highlight.js/styles/monokai.css';
import { Circle, ChevronRight, X } from 'lucide-react';
import ToolCallCard from './ToolCallCard';
import type { ChatMessage as ChatMessageType } from '../../types';

const FILE_PATH_RE = /(?<![:/])\b((?:\.{1,2}\/)?(?:[\w.-]+\/)+[\w.-]+\.(?:ts|tsx|js|jsx|mjs|cjs|py|md|json|css|scss|sass|html|yaml|yml|toml|sh|bash|zsh|go|rs|rb|java|c|cpp|h|hpp|vue|svelte)|(?:\/[\w.-]+)+\.(?:ts|tsx|js|jsx|mjs|cjs|py|md|json|css|scss|sass|html|yaml|yml|toml|sh|bash|zsh|go|rs|rb|java|c|cpp|h|hpp|vue|svelte))\b/g;

function rehypeFilePaths() {
  return (tree: any) => {
    function walk(node: any): void {
      if (node.tagName === 'code' || node.tagName === 'pre' || node.tagName === 'a') return;
      if (node.type === 'text' && node.value) {
        return; // handled at parent level
      }
      if (!node.children) return;
      const newChildren: any[] = [];
      for (const child of node.children) {
        if (child.type === 'text' && child.value) {
          FILE_PATH_RE.lastIndex = 0;
          const text: string = child.value;
          const parts: any[] = [];
          let lastIndex = 0;
          let match: RegExpExecArray | null;
          while ((match = FILE_PATH_RE.exec(text)) !== null) {
            if (match.index > lastIndex) {
              parts.push({ type: 'text', value: text.slice(lastIndex, match.index) });
            }
            parts.push({
              type: 'element', tagName: 'a',
              properties: { href: `sai-file://${match[1]}`, className: ['file-link'] },
              children: [{ type: 'text', value: match[1] }],
            });
            lastIndex = match.index + match[0].length;
          }
          if (parts.length > 0) {
            if (lastIndex < text.length) parts.push({ type: 'text', value: text.slice(lastIndex) });
            newChildren.push(...parts);
          } else {
            newChildren.push(child);
          }
        } else {
          walk(child);
          newChildren.push(child);
        }
      }
      node.children = newChildren;
    }
    walk(tree);
  };
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

export default function ChatMessage({ message, projectPath, onFileOpen }: { message: ChatMessageType; projectPath?: string; onFileOpen?: (path: string) => void }) {
  const dotColor = getDotColor(message.role);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);

  return (
    <div className={`chat-msg chat-msg-${message.role}`}>
      {message.content && (
        <div className="chat-msg-content">
          {message.role === 'user'
            ? <ChevronRight size={14} color="var(--green)" strokeWidth={3} className="chat-msg-dot chat-msg-chevron" />
            : message.role === 'assistant'
            ? <span className="chat-msg-dot chat-msg-claude" />
            : <Circle size={8} fill={dotColor} stroke={dotColor} className="chat-msg-dot" />}
          <div className="chat-msg-body">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeHighlight, rehypeFilePaths]}
              components={{
                a: ({ href, children }) => (
                  <a
                    href={href}
                    onClick={(e) => {
                      e.preventDefault();
                      if (href?.startsWith('sai-file://') && onFileOpen) {
                        const rel = href.slice('sai-file://'.length);
                        const abs = rel.startsWith('/') ? rel : `${projectPath}/${rel}`;
                        onFileOpen(abs);
                      } else if (href) {
                        window.sai.openExternal(href);
                      }
                    }}
                  >
                    {children}
                  </a>
                ),
              }}
            >{message.content}</ReactMarkdown>
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
          margin-top: 4px;
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
        .chat-msg-body { color: var(--text); line-height: 1.6; flex: 1; min-width: 0; }
        .chat-msg-body p { margin-bottom: 8px; }
        .chat-msg-body code {
          background: var(--bg-secondary);
          padding: 2px 6px;
          border-radius: 3px;
          font-size: 12px;
        }
        .chat-msg-body a { color: var(--accent); text-decoration: underline; cursor: pointer; }
        .chat-msg-body a:hover { opacity: 0.8; }
        .chat-msg-body a.file-link { color: var(--green); text-decoration: none; font-family: monospace; font-size: 12px; background: var(--bg-secondary); padding: 1px 5px; border-radius: 3px; }
        .chat-msg-body a.file-link:hover { opacity: 0.8; }
        .chat-msg-body pre code { background: none; padding: 0; }
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
          color: #a6e22e;
          background: rgba(166, 226, 46, 0.1);
          display: inline-block;
          width: 100%;
        }
        .chat-msg-body pre code.hljs.language-diff .hljs-deletion {
          color: #f92672;
          background: rgba(249, 38, 114, 0.1);
          display: inline-block;
          width: 100%;
        }
        .chat-msg-body pre code.hljs.language-diff .hljs-meta {
          color: #66d9ef;
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
