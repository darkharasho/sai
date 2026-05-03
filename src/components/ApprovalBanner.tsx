import { PendingApproval } from '../types';
import { basename } from '../utils/pathUtils';

interface ApprovalBannerProps {
  approvalWorkspaces: Map<string, PendingApproval>;
  currentProjectPath: string;
  onSwitchToWorkspace: (path: string) => void;
}

export default function ApprovalBanner({ approvalWorkspaces, currentProjectPath, onSwitchToWorkspace }: ApprovalBannerProps) {
  if (approvalWorkspaces.size === 0) return null;

  const entries = [...approvalWorkspaces.entries()];
  const [projectPath, approval] = entries[0];
  const wsName = basename(projectPath);
  const isCurrent = projectPath === currentProjectPath;
  const extraCount = entries.length - 1;

  const commandSnippet = approval.command.length > 60
    ? approval.command.slice(0, 60) + '…'
    : approval.command;

  return (
    <div className="approval-banner">
      <span className="approval-banner-icon">!</span>
      <span className="approval-banner-text">
        <strong>{wsName}</strong>
        {extraCount > 0 && <span className="approval-banner-extra"> +{extraCount} more</span>}
        <span className="approval-banner-tool"> — {approval.toolName}: {commandSnippet}</span>
      </span>
      <button
        className="approval-banner-action"
        onClick={() => onSwitchToWorkspace(projectPath)}
      >
        {isCurrent ? 'Review' : 'Switch & Review'}
      </button>
      <style>{`
        .approval-banner {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 8px 14px;
          font-size: 12px;
          background: linear-gradient(90deg, rgba(245, 158, 11, 0.18) 0%, rgba(245, 158, 11, 0.06) 100%);
          border-bottom: 1px solid rgba(245, 158, 11, 0.25);
          border-left: 3px solid #f59e0b;
          color: var(--text);
          flex-shrink: 0;
          animation: approval-banner-in var(--dur-base) var(--ease-out-soft);
        }
        @keyframes approval-banner-in {
          from { transform: translateY(-100%); opacity: 0; }
          to   { transform: translateY(0); opacity: 1; }
        }
        @media (prefers-reduced-motion: reduce) {
          .approval-banner { animation: none; }
        }
        .approval-banner-icon {
          font-size: 14px;
          font-weight: 800;
          color: #f59e0b;
          animation: approval-banner-blink 1s ease-in-out infinite;
        }
        @keyframes approval-banner-blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.2; }
        }
        .approval-banner-text {
          flex: 1;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .approval-banner-extra {
          color: var(--text-muted);
          font-size: 11px;
        }
        .approval-banner-tool {
          opacity: 0.8;
        }
        .approval-banner-action {
          font-size: 11px;
          font-weight: 600;
          padding: 3px 10px;
          border-radius: 4px;
          border: 1px solid #f59e0b;
          background: transparent;
          color: #f59e0b;
          cursor: pointer;
          flex-shrink: 0;
        }
        .approval-banner-action:hover {
          background: rgba(245, 158, 11, 0.15);
        }
      `}</style>
    </div>
  );
}
