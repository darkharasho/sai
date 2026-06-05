import { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { FileText, Check, X, ChevronRight, AlertCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { SPRING, useReducedMotionTransition } from './motion';

interface PlanReviewCardProps {
  plan: string;
  planFilePath?: string;
  toolUseId?: string;
  resolved?: 'approved' | 'rejected';
  onApprove?: (toolUseId: string) => void;
  onReject?: (toolUseId: string) => void;
}

export default function PlanReviewCard({
  plan,
  planFilePath,
  toolUseId,
  resolved,
  onApprove,
  onReject,
}: PlanReviewCardProps) {
  const [expanded, setExpanded] = useState(!resolved);
  const contentRef = useRef<HTMLDivElement>(null);
  const [overflows, setOverflows] = useState(false);
  const entryTransition = useReducedMotionTransition(SPRING.pop);
  const chevronTransition = useReducedMotionTransition(SPRING.flick);
  const badgeTransition = useReducedMotionTransition(SPRING.flick);
  const expandTransition = useReducedMotionTransition({ height: { duration: 0.26, ease: [0.22, 1, 0.36, 1] as const }, opacity: { duration: 0.18 } });

  useEffect(() => {
    const el = contentRef.current;
    if (el) setOverflows(el.scrollHeight > el.clientHeight);
  }, [plan, expanded]);

  const status: 'running' | 'done' | 'error' = resolved
    ? (resolved === 'rejected' ? 'error' : 'done')
    : 'running';

  const label = resolved === 'approved'
    ? 'Approved'
    : resolved === 'rejected'
    ? 'Rejected'
    : 'Waiting for review…';

  const fileName = planFilePath ? planFilePath.split('/').pop() : undefined;

  return (
    <>
      <motion.div
        data-testid="plan-review-card"
        layout
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={entryTransition}
        className="tool-call-card"
      >
        <div className="tool-call-header tool-call-header-expandable" onClick={() => setExpanded(!expanded)}>
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={status}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              transition={badgeTransition}
              className={`tool-status tool-status-${status}`}
            >
              {status === 'running' && <span className="tool-status-pulse" aria-hidden />}
              {status === 'done' && <span className="tool-status-dot tool-status-dot-done" aria-hidden />}
              {status === 'error' && <AlertCircle size={12} />}
            </motion.span>
          </AnimatePresence>
          <FileText size={14} className="tool-call-icon" />
          <span className="tool-call-name tool-sig-shimmer">Plan Review</span>
          {fileName && (
            <span className="tool-call-label" title={planFilePath}>{fileName}</span>
          )}
          {resolved && (
            <span className={`plan-review-chip plan-review-chip-${resolved}`}>
              {resolved === 'approved' ? <Check size={10} /> : <X size={10} />}
              {label}
            </span>
          )}
          {!resolved && (
            <span className="tool-call-label">{label}</span>
          )}
          <motion.span
            className="tool-call-chevron-wrap"
            animate={{ rotate: expanded ? 90 : 0 }}
            transition={chevronTransition}
          >
            <ChevronRight size={14} className="tool-call-chevron" />
          </motion.span>
        </div>
        <AnimatePresence initial={false}>
          {expanded && (
            <motion.div
              key="plan-expand"
              className="tool-call-expand"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={expandTransition}
              style={{ overflow: 'hidden' }}
            >
              <div className="plan-review-body dashed-divider-top">
                <div
                  ref={contentRef}
                  className={`plan-review-content${!overflows || expanded ? ' plan-review-content-expanded' : ''}`}
                >
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {plan}
                  </ReactMarkdown>
                </div>
              </div>
              {!resolved && (
                <div className="plan-review-actions">
                  <button
                    type="button"
                    className="plan-review-btn plan-review-btn-reject"
                    onClick={(e) => { e.stopPropagation(); toolUseId && onReject?.(toolUseId); }}
                  >
                    <X size={12} />
                    Reject
                  </button>
                  <button
                    type="button"
                    className="plan-review-btn plan-review-btn-approve"
                    onClick={(e) => { e.stopPropagation(); toolUseId && onApprove?.(toolUseId); }}
                  >
                    <Check size={12} />
                    Approve
                  </button>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
      <style>{STYLES}</style>
    </>
  );
}

const STYLES = `
  .plan-review-chip {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    font-size: 10px;
    padding: 2px 7px;
    border-radius: 4px;
    font-weight: 600;
    letter-spacing: 0.3px;
    flex-shrink: 0;
    margin-left: auto;
    padding-left: 8px;
  }
  .plan-review-chip-approved {
    background: color-mix(in srgb, #3fb950 18%, transparent);
    color: #3fb950;
    border: 1px solid color-mix(in srgb, #3fb950 40%, transparent);
  }
  .plan-review-chip-rejected {
    background: color-mix(in srgb, #f85149 14%, transparent);
    color: #f85149;
    border: 1px solid color-mix(in srgb, #f85149 35%, transparent);
  }
  .plan-review-body {
    /* dashed header↔body separator supplied by .dashed-divider-top */
  }
  .plan-review-content {
    padding: 12px 14px;
    max-height: 400px;
    overflow-y: auto;
    font-size: 12.5px;
    line-height: 1.55;
    color: var(--text);
  }
  .plan-review-content-expanded {
    max-height: none;
  }
  .plan-review-content h1,
  .plan-review-content h2,
  .plan-review-content h3 {
    margin: 14px 0 6px;
    font-weight: 700;
    color: var(--text);
  }
  .plan-review-content h1 { font-size: 15px; }
  .plan-review-content h2 { font-size: 13.5px; }
  .plan-review-content h3 { font-size: 12.5px; }
  .plan-review-content h1:first-child,
  .plan-review-content h2:first-child,
  .plan-review-content h3:first-child { margin-top: 0; }
  .plan-review-content p { margin: 6px 0; }
  .plan-review-content ul,
  .plan-review-content ol {
    margin: 4px 0;
    padding-left: 20px;
  }
  .plan-review-content li { margin: 2px 0; }
  .plan-review-content code {
    font-family: 'Geist Mono', 'JetBrains Mono', ui-monospace, monospace;
    font-size: 11.5px;
    background: var(--bg-secondary);
    padding: 1px 4px;
    border-radius: 3px;
  }
  .plan-review-content pre {
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 8px 10px;
    overflow-x: auto;
    margin: 8px 0;
  }
  .plan-review-content pre code {
    background: transparent;
    padding: 0;
  }
  .plan-review-content table {
    width: 100%;
    border-collapse: collapse;
    margin: 8px 0;
    font-size: 11.5px;
  }
  .plan-review-content th,
  .plan-review-content td {
    border: 1px solid var(--border);
    padding: 4px 8px;
    text-align: left;
  }
  .plan-review-content th {
    background: var(--bg-secondary);
    font-weight: 600;
  }
  .plan-review-content hr {
    border: none;
    border-top: 1px solid var(--border);
    margin: 12px 0;
  }
  .plan-review-content strong { color: var(--text); }
  .plan-review-content blockquote {
    margin: 6px 0;
    padding: 4px 12px;
    border-left: 3px solid var(--border);
    color: var(--text-muted);
  }
  .plan-review-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 8px 12px;
    border-top: 1px solid var(--border);
  }
  .plan-review-btn {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 5px 12px;
    border-radius: 5px;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s ease, border-color 0.15s ease;
    border: 1px solid;
    font-family: inherit;
  }
  .plan-review-btn-reject {
    background: transparent;
    border-color: rgba(248, 81, 73, 0.35);
    color: #f85149;
  }
  .plan-review-btn-reject:hover {
    background: rgba(248, 81, 73, 0.12);
    border-color: rgba(248, 81, 73, 0.5);
  }
  .plan-review-btn-approve {
    background: color-mix(in srgb, #3fb950 16%, transparent);
    border-color: rgba(63, 185, 80, 0.4);
    color: #3fb950;
  }
  .plan-review-btn-approve:hover {
    background: color-mix(in srgb, #3fb950 28%, transparent);
    border-color: rgba(63, 185, 80, 0.6);
  }
`;
