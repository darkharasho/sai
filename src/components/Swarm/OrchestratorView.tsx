import React from 'react';
import OrchestratorComposer from './OrchestratorComposer';
import ApprovalTray, { type ApprovalRow } from './ApprovalTray';
import ReadyToLandTray, { type ReadyTaskRow } from './ReadyToLandTray';

export type { ApprovalRow };
export type { ReadyTaskRow };

export interface OrchestratorStats {
  active: number;
  approvals: number;
  ready: number;
  cost?: number;
  runtimeSec?: number;
}

interface Props {
  orchestratorSessionId: string;
  projectPath: string;
  stats: OrchestratorStats;
  approvals: ApprovalRow[];
  readyTasks: ReadyTaskRow[];
  onCommand: (cmd: { text: string; splitLines: boolean }) => void;
  onApproveApproval?: (id: string) => void;
  onDenyApproval?: (id: string) => void;
  onApproveAllReads?: () => void;
  onDenyAllApprovals?: () => void;
  onLand?: (id: string) => void;
  onDiscard?: (id: string) => void;
  onDiff?: (id: string) => void;
  onLandAll?: () => void;
  chatSlot?: React.ReactNode;       // App.tsx can pass an embedded ChatPanel here
  readySlot?: React.ReactNode;      // legacy slot (unused now)
}

export default function OrchestratorView({
  orchestratorSessionId, projectPath, stats, approvals, readyTasks, onCommand,
  onApproveApproval, onDenyApproval, onApproveAllReads, onDenyAllApprovals,
  onLand, onDiscard, onDiff, onLandAll,
  chatSlot, readySlot,
}: Props) {
  return (
    <div className="orch-view" style={{ display: 'flex', flexDirection: 'column', height: '100%', minWidth: 0 }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px', borderBottom: '1px solid var(--border)' }}>
        <h2 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Orchestrator</h2>
        <span style={{ fontSize: 12, opacity: 0.7 }}>
          {stats.active} active · {stats.approvals} approvals · {stats.ready} ready
          {typeof stats.cost === 'number' && ` · $${stats.cost.toFixed(2)}`}
          {typeof stats.runtimeSec === 'number' && ` · ${Math.round(stats.runtimeSec)}s`}
        </span>
      </header>
      <ApprovalTray
        approvals={approvals}
        onApprove={onApproveApproval ?? (() => {})}
        onDeny={onDenyApproval ?? (() => {})}
        onApproveAllReads={onApproveAllReads ?? (() => {})}
        onDenyAll={onDenyAllApprovals ?? (() => {})}
      />
      <ReadyToLandTray
        tasks={readyTasks}
        onLand={onLand ?? (() => {})}
        onDiscard={onDiscard ?? (() => {})}
        onDiff={onDiff ?? (() => {})}
        onLandAll={onLandAll ?? (() => {})}
      />
      {readySlot}
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }} data-testid="orch-chat-slot">
        {chatSlot}
      </div>
      <OrchestratorComposer onCommand={onCommand} />
    </div>
  );
}
