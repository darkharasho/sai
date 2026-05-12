import React from 'react';
import OrchestratorComposer from './OrchestratorComposer';

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
  approvals: any[];      // will be typed in Task 19
  readyTasks: any[];     // will be typed in Task 20
  onCommand: (cmd: { text: string; splitLines: boolean }) => void;
  chatSlot?: React.ReactNode;       // App.tsx can pass an embedded ChatPanel here
  approvalSlot?: React.ReactNode;   // Task 19 ApprovalTray
  readySlot?: React.ReactNode;      // Task 20 ReadyToLandTray
}

export default function OrchestratorView({
  orchestratorSessionId, projectPath, stats, approvals, readyTasks, onCommand,
  chatSlot, approvalSlot, readySlot,
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
      {approvalSlot}
      {readySlot}
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }} data-testid="orch-chat-slot">
        {chatSlot}
      </div>
      <OrchestratorComposer onCommand={onCommand} />
    </div>
  );
}
