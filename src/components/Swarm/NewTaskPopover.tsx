import { useState, useEffect } from 'react';
import type { AIProvider, ApprovalPolicy } from '../../types';

interface Props {
  open: boolean;
  onClose: () => void;
  onSubmit: (input: { prompt: string; provider: AIProvider; model: string; approvalPolicy: ApprovalPolicy }) => void;
  defaultProvider: AIProvider;
  defaultModel: string;
}

export default function NewTaskPopover({ open, onClose, onSubmit, defaultProvider, defaultModel }: Props) {
  const [prompt, setPrompt] = useState('');
  const [provider, setProvider] = useState<AIProvider>(defaultProvider);
  const [model, setModel] = useState(defaultModel);
  const [approvalPolicy, setApprovalPolicy] = useState<ApprovalPolicy>('auto-read');

  useEffect(() => {
    if (open) {
      setPrompt('');
      setProvider(defaultProvider);
      setModel(defaultModel);
      setApprovalPolicy('auto-read');
    }
  }, [open, defaultProvider, defaultModel]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const handleDispatch = () => {
    onSubmit({ prompt, provider, model, approvalPolicy });
    onClose();
  };

  return (
    <div className="ntp-overlay" onClick={onClose}>
      <div className="ntp-card" onClick={(e) => e.stopPropagation()}>
        <div className="ntp-title">New Task</div>
        <textarea
          className="ntp-textarea"
          placeholder="What should this task do?"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={4}
          autoFocus
        />
        <div className="ntp-row">
          <label>
            <span>Provider</span>
            <select value={provider} onChange={(e) => setProvider(e.target.value as AIProvider)}>
              <option value="claude">claude</option>
              <option value="codex">codex</option>
              <option value="gemini">gemini</option>
            </select>
          </label>
          <label>
            <span>Model</span>
            <input
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="model"
            />
          </label>
          <label>
            <span>Approval</span>
            <select value={approvalPolicy} onChange={(e) => setApprovalPolicy(e.target.value as ApprovalPolicy)}>
              <option value="auto">auto</option>
              <option value="auto-read">auto-read</option>
              <option value="always-ask">always-ask</option>
            </select>
          </label>
        </div>
        <div className="ntp-actions">
          <button className="ntp-btn-secondary" onClick={onClose}>Cancel</button>
          <button className="ntp-btn-primary" onClick={handleDispatch}>Dispatch</button>
        </div>
        <style>{`
          .ntp-overlay {
            position: fixed;
            inset: 0;
            background: rgba(0, 0, 0, 0.4);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 1000;
          }
          .ntp-card {
            background: var(--bg-secondary);
            color: var(--text);
            border: 1px solid var(--border);
            border-radius: 8px;
            padding: 16px;
            width: min(520px, 92vw);
            display: flex;
            flex-direction: column;
            gap: 12px;
            box-shadow: 0 10px 32px rgba(0, 0, 0, 0.35);
          }
          .ntp-title {
            font-size: 13px;
            font-weight: 600;
            letter-spacing: 0.08em;
            color: var(--text);
            opacity: 0.85;
          }
          .ntp-textarea {
            background: var(--bg-primary, var(--bg-secondary));
            color: var(--text);
            border: 1px solid var(--border);
            border-radius: 4px;
            padding: 8px 10px;
            font-size: 13px;
            font-family: inherit;
            resize: vertical;
            min-height: 80px;
          }
          .ntp-row {
            display: flex;
            gap: 10px;
          }
          .ntp-row label {
            display: flex;
            flex-direction: column;
            gap: 4px;
            flex: 1;
            font-size: 11px;
            opacity: 0.75;
            letter-spacing: 0.06em;
          }
          .ntp-row select,
          .ntp-row input {
            background: var(--bg-primary, var(--bg-secondary));
            color: var(--text);
            border: 1px solid var(--border);
            border-radius: 4px;
            padding: 5px 8px;
            font-size: 12px;
          }
          .ntp-actions {
            display: flex;
            justify-content: flex-end;
            gap: 8px;
          }
          .ntp-btn-secondary,
          .ntp-btn-primary {
            border: 1px solid var(--border);
            border-radius: 4px;
            padding: 6px 14px;
            font-size: 12px;
            cursor: pointer;
            background: transparent;
            color: var(--text);
          }
          .ntp-btn-secondary:hover {
            background: var(--bg-hover);
          }
          .ntp-btn-primary {
            background: var(--accent);
            color: var(--bg-secondary);
            border-color: var(--accent);
          }
          .ntp-btn-primary:hover {
            opacity: 0.9;
          }
        `}</style>
      </div>
    </div>
  );
}
