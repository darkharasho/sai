import { useState } from 'react';
import { Copy, Check, ChevronDown, ChevronRight, Wrench, Terminal, FileText, AlertCircle } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import ThinkingAnimation from '../ThinkingAnimation';
import type { AIResponseBlock as AIResponseBlockType, AIEntry, AIToolCall } from './types';

const PROVIDER_CONFIG: Record<string, { svg: string; label: string }> = {
  claude: { svg: 'svg/claude.svg', label: 'Claude' },
  codex: { svg: 'svg/openai.svg', label: 'Codex' },
  gemini: { svg: 'svg/Google-gemini-icon.svg', label: 'Gemini' },
};

const MAX_OUTPUT_LINES = 12;

function ToolCallEntry({ call }: { call: AIToolCall }) {
  const [expanded, setExpanded] = useState(false);
  const isBash = /bash/i.test(call.name);
  const outputLines = call.output?.split('\n') || [];
  const isTruncated = outputLines.length > MAX_OUTPUT_LINES;
  const displayOutput = expanded ? call.output : outputLines.slice(0, MAX_OUTPUT_LINES).join('\n');

  return (
    <div className={`tm-tool-entry ${call.isError ? 'tm-tool-entry-error' : ''}`}>
      <div className="tm-tool-entry-header">
        <span className="tm-tool-entry-icon">
          {isBash ? <Terminal size={11} /> : <FileText size={11} />}
        </span>
        <span className="tm-tool-entry-name">{call.name}</span>
        {call.isError && <span className="tm-tool-entry-error-icon"><AlertCircle size={10} /></span>}
      </div>
      <div className="tm-tool-entry-io">
        <div className="tm-tool-io-row">
          <span className="tm-tool-io-label">IN</span>
          <code className="tm-tool-io-content">{call.input}</code>
        </div>
        {call.output !== undefined && (
          <div className="tm-tool-io-row">
            <span className="tm-tool-io-label tm-tool-io-label-out">OUT</span>
            <pre className="tm-tool-io-content tm-tool-io-output">{displayOutput || '(empty)'}</pre>
          </div>
        )}
        {call.output === undefined && (
          <div className="tm-tool-io-row">
            <span className="tm-tool-io-label tm-tool-io-label-out">OUT</span>
            <span className="tm-tool-io-content tm-tool-io-pending">running...</span>
          </div>
        )}
      </div>
      {isTruncated && (
        <button className="tm-tool-expand-btn" onClick={() => setExpanded(!expanded)}>
          {expanded ? 'Show less' : `Show all ${outputLines.length} lines`}
        </button>
      )}
    </div>
  );
}

interface AIResponseBlockProps {
  block: AIResponseBlockType;
  onCopy: (text: string) => void;
  aiProvider?: 'claude' | 'codex' | 'gemini';
}

export default function AIResponseBlock({ block, onCopy, aiProvider = 'claude' }: AIResponseBlockProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [copied, setCopied] = useState(false);
  const isStreaming = block.streaming !== false;
  const hasEntries = block.entries && block.entries.length > 0;
  const hasContent = !!block.content || hasEntries;
  const provider = PROVIDER_CONFIG[aiProvider] || PROVIDER_CONFIG.claude;

  return (
    <div className="tm-ai-block">
      <div className="tm-ai-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div
            className="tm-ai-provider-icon"
            style={{
              maskImage: `url('${provider.svg}')`,
              WebkitMaskImage: `url('${provider.svg}')`,
            }}
          />
          <span className="tm-ai-label">{provider.label}</span>
          {isStreaming && hasContent && (
            <span className="tm-ai-streaming-dot" />
          )}
        </div>
        {hasContent && (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span className="tm-icon" title="Copy" onClick={() => {
              onCopy(block.content);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}>
              {copied ? <Check size={11} color="var(--green)" /> : <Copy size={11} />}
            </span>
            <span
              className="tm-icon"
              title={collapsed ? 'Expand' : 'Collapse'}
              onClick={() => setCollapsed(!collapsed)}
            >
              {collapsed ? <ChevronRight size={11} /> : <ChevronDown size={11} />}
            </span>
          </div>
        )}
      </div>

      <div className="tm-ai-body" style={{ display: collapsed ? 'none' : undefined }}>
        {!hasContent ? (
          <ThinkingAnimation color="#a371f7" />
        ) : hasEntries ? (
          <>
            {block.entries!.map((entry, i) => (
              entry.kind === 'text' ? (
                <div key={i} className="tm-ai-text-entry">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {entry.text}
                  </ReactMarkdown>
                </div>
              ) : (
                <ToolCallEntry key={entry.call.id} call={entry.call} />
              )
            ))}
            {isStreaming && (
              <div className="tm-ai-working">
                <ThinkingAnimation color="#a371f7" />
              </div>
            )}
          </>
        ) : (
          <>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {block.content}
            </ReactMarkdown>
            {isStreaming && (
              <div className="tm-ai-working">
                <ThinkingAnimation color="#a371f7" />
              </div>
            )}
          </>
        )}
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
        .tm-ai-provider-icon {
          width: 14px;
          height: 14px;
          background-color: #a371f7;
          mask-size: contain;
          mask-repeat: no-repeat;
          mask-position: center;
          -webkit-mask-size: contain;
          -webkit-mask-repeat: no-repeat;
          -webkit-mask-position: center;
          flex-shrink: 0;
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
          font-family: 'JetBrains Mono', monospace;
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
        .tm-ai-text-entry {
          margin-bottom: 8px;
        }
        .tm-ai-text-entry:last-child {
          margin-bottom: 0;
        }

        /* Tool call entries */
        .tm-tool-entry {
          margin: 8px 0;
          border: 1px solid var(--border);
          border-radius: 4px;
          overflow: hidden;
          font-family: 'JetBrains Mono', monospace;
          font-size: 11px;
        }
        .tm-tool-entry-error {
          border-color: rgba(248, 81, 73, 0.4);
        }
        .tm-tool-entry-header {
          display: flex;
          align-items: center;
          gap: 5px;
          padding: 4px 8px;
          background: var(--bg-secondary);
          border-bottom: 1px solid var(--border);
          color: var(--text-muted);
        }
        .tm-tool-entry-icon {
          display: inline-flex;
          color: #a371f7;
        }
        .tm-tool-entry-name {
          color: #a371f7;
          font-weight: 500;
          font-size: 10px;
        }
        .tm-tool-entry-error-icon {
          display: inline-flex;
          color: var(--red);
          margin-left: auto;
        }
        .tm-tool-entry-io {
          padding: 0;
        }
        .tm-tool-io-row {
          display: flex;
          min-height: 22px;
        }
        .tm-tool-io-row + .tm-tool-io-row {
          border-top: 1px solid var(--border);
        }
        .tm-tool-io-label {
          flex-shrink: 0;
          width: 30px;
          display: flex;
          align-items: flex-start;
          justify-content: center;
          padding: 4px 0;
          font-size: 9px;
          font-weight: 600;
          letter-spacing: 0.5px;
          color: var(--accent);
          background: rgba(210, 153, 34, 0.06);
          border-right: 1px solid var(--border);
        }
        .tm-tool-io-label-out {
          color: var(--text-muted);
          background: none;
        }
        .tm-tool-io-content {
          flex: 1;
          padding: 4px 8px;
          margin: 0;
          white-space: pre-wrap;
          word-break: break-all;
          color: var(--text);
          background: none;
          font-family: 'JetBrains Mono', monospace;
          font-size: 11px;
          line-height: 1.5;
        }
        .tm-tool-io-output {
          color: var(--text-secondary);
          max-height: none;
        }
        .tm-tool-io-pending {
          color: #a371f7;
          font-style: italic;
        }
        .tm-tool-expand-btn {
          display: block;
          width: 100%;
          padding: 3px;
          border: none;
          border-top: 1px solid var(--border);
          background: var(--bg-secondary);
          color: var(--text-muted);
          font-family: 'JetBrains Mono', monospace;
          font-size: 10px;
          cursor: pointer;
        }
        .tm-tool-expand-btn:hover {
          color: var(--accent);
          background: var(--bg-hover);
        }

        .tm-ai-working {
          margin-top: 8px;
          padding-top: 8px;
          border-top: 1px solid rgba(163, 113, 247, 0.1);
        }
        .tm-ai-streaming-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: #a371f7;
          animation: tm-pulse 1.5s ease-in-out infinite;
        }
        @keyframes tm-pulse {
          0%, 100% { opacity: 0.4; }
          50% { opacity: 1; }
        }
        .tm-ai-body .thinking-animation {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 4px 0;
          min-height: 28px;
        }
        .tm-ai-body .thinking-text {
          font-size: 12px;
          font-weight: 500;
          letter-spacing: 0.3px;
        }
        .tm-ai-body .thinking-cursor {
          animation: blink-cursor 0.6s step-end infinite;
          font-weight: 300;
        }
        @keyframes blink-cursor {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }
      `}</style>
    </div>
  );
}
