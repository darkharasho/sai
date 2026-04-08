import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import rehypeRaw from 'rehype-raw';
import { Eye } from 'lucide-react';

interface MarkdownPreviewProps {
  content: string;
  onTogglePreview: () => void;
}

export default function MarkdownPreview({ content, onTogglePreview }: MarkdownPreviewProps) {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div className="md-preview-body">
        <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw, rehypeHighlight]}>
          {content}
        </ReactMarkdown>
      </div>

      {/* Status Bar */}
      <div className="monaco-statusbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span>markdown</span>
          <span style={{ color: 'var(--text-muted)', opacity: 0.6 }}>preview</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span>UTF-8</span>
          <button
            className="md-preview-toggle"
            onClick={onTogglePreview}
            title="Switch to editor (Ctrl+Shift+M)"
            aria-label="Editor"
          >
            <Eye size={12} />
            Editor
          </button>
        </div>
      </div>

      <style>{`
        .md-preview-body {
          flex: 1;
          overflow-y: auto;
          padding: 24px 32px;
          color: var(--text);
          line-height: 1.6;
          font-size: 14px;
          background: var(--bg-primary);
        }
        .md-preview-body p { margin: 0 0 8px 0; }
        .md-preview-body p:last-child { margin-bottom: 0; }
        .md-preview-body h1, .md-preview-body h2, .md-preview-body h3,
        .md-preview-body h4, .md-preview-body h5, .md-preview-body h6 {
          color: var(--text);
          margin: 16px 0 8px 0;
        }
        .md-preview-body h1 { font-size: 1.8em; border-bottom: 1px solid var(--border); padding-bottom: 6px; }
        .md-preview-body h2 { font-size: 1.4em; border-bottom: 1px solid var(--border); padding-bottom: 4px; }
        .md-preview-body h3 { font-size: 1.2em; }
        .md-preview-body code {
          background: var(--bg-hover);
          padding: 2px 6px;
          border-radius: 3px;
          font-size: 12px;
          border: 1px solid var(--border);
        }
        .md-preview-body pre code { background: none; padding: 0; border: none; }
        .md-preview-body pre {
          background: var(--bg-secondary);
          border-radius: 6px;
          padding: 12px;
          overflow-x: auto;
          margin: 8px 0;
        }
        .md-preview-body a { color: var(--accent); text-decoration: underline; }
        .md-preview-body a:hover { opacity: 0.8; }
        .md-preview-body table {
          border-collapse: collapse;
          width: 100%;
          margin: 8px 0;
          font-size: 13px;
        }
        .md-preview-body th,
        .md-preview-body td {
          border: 1px solid var(--border);
          padding: 6px 12px;
          text-align: left;
        }
        .md-preview-body th {
          background: var(--bg-secondary);
          font-weight: 600;
          color: var(--text);
        }
        .md-preview-body td { color: var(--text-secondary); }
        .md-preview-body tr:hover td { background: var(--bg-secondary); }
        .md-preview-body ul, .md-preview-body ol { padding-left: 24px; margin: 4px 0 8px 0; }
        .md-preview-body li { margin: 2px 0; }
        .md-preview-body blockquote {
          border-left: 3px solid var(--accent);
          margin: 8px 0;
          padding: 4px 12px;
          color: var(--text-muted);
        }
        .md-preview-body img { max-width: 100%; border-radius: 6px; }
        .md-preview-body hr { border: none; border-top: 1px solid var(--border); margin: 16px 0; }
        .md-preview-body pre code.hljs.language-diff .hljs-addition {
          color: var(--text);
          background: rgba(72, 100, 40, 0.35);
          display: inline-block;
          width: 100%;
        }
        .md-preview-body pre code.hljs.language-diff .hljs-deletion {
          color: var(--text);
          background: rgba(180, 60, 40, 0.25);
          display: inline-block;
          width: 100%;
        }
        .md-preview-toggle {
          background: rgba(199,145,12,0.15);
          border: 1px solid rgba(199,145,12,0.4);
          border-radius: 3px;
          color: var(--accent);
          font-size: 11px;
          padding: 1px 8px;
          cursor: pointer;
          font-family: 'Geist Mono', 'JetBrains Mono', monospace;
          display: flex;
          align-items: center;
          gap: 4px;
        }
        .md-preview-toggle:hover {
          background: rgba(199,145,12,0.25);
        }
      `}</style>
    </div>
  );
}
