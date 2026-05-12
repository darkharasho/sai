import React from 'react';
import { Info } from 'lucide-react';
import OrchestratorComposer from './OrchestratorComposer';
import ReadyToLandTray, { type ReadyTaskRow } from './ReadyToLandTray';
import { type RecentTaskRow } from './RecentActivity';

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
  readyTasks: ReadyTaskRow[];
  onCommand: (cmd: { text: string; splitLines: boolean }) => void;
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
  projectPath, stats, readyTasks, onCommand,
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

      {orchestratorProvider && orchestratorProvider !== 'claude' && (
        <div className="orch-non-claude-banner" data-testid="orch-non-claude-banner">
          <Info size={13} />
          <span>
            Chat-driven dispatch requires Claude. You can still use the trays, slash commands (<code>/spawn</code>, <code>/land</code>, …), or switch provider in <b>Settings → Swarm</b>.
          </span>
          <style>{`
            .orch-non-claude-banner {
              display: flex;
              align-items: center;
              gap: 8px;
              padding: 6px 12px;
              background: color-mix(in srgb, var(--accent) 10%, transparent);
              border-bottom: 1px solid color-mix(in srgb, var(--accent) 35%, transparent);
              color: var(--text-secondary);
              font-size: 11px;
            }
            .orch-non-claude-banner code {
              background: var(--bg-elevated);
              padding: 1px 5px;
              border-radius: 3px;
              font-size: 10px;
              color: var(--text);
            }
            .orch-non-claude-banner svg {
              color: var(--accent);
              flex-shrink: 0;
            }
          `}</style>
        </div>
      )}

      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }} data-testid="orch-chat-slot">
        {chatSlot}
      </div>

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
