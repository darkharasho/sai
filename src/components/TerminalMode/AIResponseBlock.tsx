import { useState } from 'react';
import { Copy, ChevronDown, ChevronRight, Sparkles } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { AIResponseBlock as AIResponseBlockType } from './types';

interface AIResponseBlockProps {
  block: AIResponseBlockType;
  onCopy: (text: string) => void;
}

export default function AIResponseBlock({ block, onCopy }: AIResponseBlockProps) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="tm-ai-block">
      <div className="tm-ai-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Sparkles size={12} color="#a371f7" />
          <span className="tm-ai-label">Claude</span>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span className="tm-icon" title="Copy" onClick={() => onCopy(block.content)}>
            <Copy size={11} />
          </span>
          <span
            className="tm-icon"
            title={collapsed ? 'Expand' : 'Collapse'}
            onClick={() => setCollapsed(!collapsed)}
          >
            {collapsed ? <ChevronRight size={11} /> : <ChevronDown size={11} />}
          </span>
        </div>
      </div>

      <div className="tm-ai-body" style={{ display: collapsed ? 'none' : undefined }}>
        <ReactMarkdown remarkPlugins={[remarkGfm]}>
          {block.content}
        </ReactMarkdown>
      </div>

      <style>{`
        .tm-ai-block {
          border: 1px solid rgba(163, 113, 247, 0.2);
          border-radius: 4px;
          overflow: hidden;
        }
        .tm-ai-header {
          background: var(--bg);
          padding: 6px 10px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          border-bottom: 1px solid rgba(163, 113, 247, 0.13);
        }
        .tm-ai-label {
          color: #a371f7;
          font-size: 11px;
          font-weight: 500;
        }
        .tm-ai-body {
          background: var(--bg);
          padding: 10px 12px;
          color: var(--text);
          font-size: 12px;
          line-height: 1.6;
        }
        .tm-ai-body p { margin: 0 0 8px 0; }
        .tm-ai-body p:last-child { margin-bottom: 0; }
        .tm-ai-body code {
          background: var(--bg-hover);
          padding: 1px 5px;
          border-radius: 3px;
          font-size: 11px;
        }
      `}</style>
    </div>
  );
}
