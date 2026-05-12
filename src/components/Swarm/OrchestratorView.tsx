import React from 'react';
import OrchestratorComposer from './OrchestratorComposer';
import ApprovalTray, { type ApprovalRow } from './ApprovalTray';
import ReadyToLandTray, { type ReadyTaskRow } from './ReadyToLandTray';
import { type RecentTaskRow } from './RecentActivity';

export type { ApprovalRow };
export type { ReadyTaskRow };
export type { RecentTaskRow };

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
  orchestratorProvider?: string | null;
  orchestratorModel?: string | null;
  chatSlot?: React.ReactNode;       // App.tsx can pass an embedded ChatPanel here
  readySlot?: React.ReactNode;      // legacy slot (unused now)
}

function basename(p: string): string {
  if (!p) return '';
  const cleaned = p.replace(/[\\/]+$/, '');
  const idx = Math.max(cleaned.lastIndexOf('/'), cleaned.lastIndexOf('\\'));
  return idx >= 0 ? cleaned.slice(idx + 1) : cleaned;
}

function formatRuntime(sec?: number): string | null {
  if (typeof sec !== 'number' || !isFinite(sec)) return null;
  const s = Math.max(0, Math.round(sec));
  const mm = Math.floor(s / 60).toString().padStart(2, '0');
  const ss = (s % 60).toString().padStart(2, '0');
  return `${mm}:${ss}`;
}

export default function OrchestratorView({
  projectPath, stats, approvals, readyTasks, onCommand,
  onApproveApproval, onDenyApproval, onApproveAllReads, onDenyAllApprovals,
  onLand, onDiscard, onDiff, onLandAll,
  orchestratorProvider, orchestratorModel,
  chatSlot, readySlot,
}: Props) {
  const project = basename(projectPath) || 'project';
  const runtime = formatRuntime(stats.runtimeSec);
  const providerLabel = orchestratorProvider
    ? `${orchestratorProvider}${orchestratorModel ? ` ${orchestratorModel}` : ''}`
    : null;

  return (
    <div className="orch-view" style={{ display: 'flex', flexDirection: 'column', height: '100%', minWidth: 0 }}>
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 18px',
          borderBottom: '1px solid var(--border)',
          gap: 12,
          flexShrink: 0,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 10, letterSpacing: 1, opacity: 0.55, textTransform: 'uppercase' }}>
            Orchestrator · {project}
          </div>
          <div style={{ fontSize: 16, fontWeight: 600 }}>Swarm Overview</div>
        </div>
        <div style={{ display: 'flex', gap: 14, fontSize: 11, opacity: 0.85, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <span><b style={{ color: 'var(--accent)' }}>{stats.active}</b> active</span>
          <span><b style={{ color: '#b44' }}>{stats.approvals}</b> approval</span>
          <span><b style={{ color: '#3a8' }}>{stats.ready}</b> ready</span>
          {(typeof stats.cost === 'number' || runtime) && (
            <span style={{ opacity: 0.7 }}>
              {typeof stats.cost === 'number' ? `$${stats.cost.toFixed(2)}` : ''}
              {typeof stats.cost === 'number' && runtime ? ' · ' : ''}
              {runtime ?? ''}
            </span>
          )}
          {providerLabel && <span style={{ opacity: 0.6 }}>{providerLabel} ▾</span>}
        </div>
      </header>

      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }} data-testid="orch-chat-slot">
        {chatSlot}
      </div>

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
      {!chatSlot && <OrchestratorComposer onCommand={onCommand} />}
    </div>
  );
}
