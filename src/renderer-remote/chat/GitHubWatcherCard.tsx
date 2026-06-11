import { useEffect, useState } from 'react';
import { GitBranch, ExternalLink, AlertCircle, CheckCircle2, XCircle, CircleDot, Clock, MinusCircle, Circle } from 'lucide-react';
import type { GitHubWatchTarget } from '../../components/Chat/githubRunResolver';
import type { GithubWatcherStore, GithubWatcherSnapshotShape } from './githubWatcherStore';

type Phase = GithubWatcherSnapshotShape['phase'];

const PHASE_THEME: Record<Phase, { color: string; label: string; Icon: React.ComponentType<{ size?: number }> }> = {
  pending:     { color: '#8a9099', label: 'Connecting',  Icon: Clock },
  queued:      { color: '#8a9099', label: 'Queued',      Icon: Clock },
  in_progress: { color: '#c7910c', label: 'Running',     Icon: CircleDot },
  success:     { color: '#3fb950', label: 'Success',     Icon: CheckCircle2 },
  failure:     { color: '#f85149', label: 'Failed',      Icon: XCircle },
  cancelled:   { color: '#8a9099', label: 'Cancelled',   Icon: MinusCircle },
  neutral:     { color: '#8a9099', label: 'Completed',   Icon: CheckCircle2 },
  error:       { color: '#f85149', label: 'Watcher error', Icon: AlertCircle },
};

interface JobShape {
  id: number;
  name: string;
  status: 'queued' | 'in_progress' | 'waiting' | 'completed' | 'unknown';
  conclusion: 'success' | 'failure' | 'cancelled' | 'skipped' | 'timed_out' | 'action_required' | 'neutral' | null;
}

interface RunShape {
  status?: string;
  conclusion?: string | null;
  name?: string;
  displayTitle?: string;
  runNumber?: number;
  headBranch?: string;
  htmlUrl?: string;
  _jobs?: JobShape[];
}

function jobIcon(job: JobShape): { color: string; Icon: React.ComponentType<{ size?: number }> } {
  if (job.status === 'in_progress') return { color: '#c7910c', Icon: CircleDot };
  if (job.status === 'queued' || job.status === 'waiting') return { color: '#8a9099', Icon: Clock };
  if (job.status === 'completed') {
    if (job.conclusion === 'success') return { color: '#3fb950', Icon: CheckCircle2 };
    if (job.conclusion === 'failure' || job.conclusion === 'timed_out') return { color: '#f85149', Icon: XCircle };
    if (job.conclusion === 'cancelled' || job.conclusion === 'skipped') return { color: '#8a9099', Icon: MinusCircle };
    return { color: '#8a9099', Icon: CheckCircle2 };
  }
  return { color: '#8a9099', Icon: Circle };
}

interface Props {
  messageId: string;
  target: GitHubWatchTarget;
  watcherStore?: GithubWatcherStore;
}

export default function GitHubWatcherCard({ messageId, target, watcherStore }: Props) {
  const [snap, setSnap] = useState<GithubWatcherSnapshotShape | undefined>(
    watcherStore?.get(messageId, target.url),
  );

  useEffect(() => {
    if (!watcherStore) return;
    const off = watcherStore.subscribe((key, s) => {
      if (key === `${messageId} ${target.url}` && s) setSnap(s);
    });
    return off;
  }, [watcherStore, messageId, target.url]);

  const phase: Phase = snap?.phase ?? 'pending';
  const theme = PHASE_THEME[phase];
  const run = (snap?.data ?? {}) as RunShape;
  const jobs = (run._jobs ?? []) as JobShape[];
  const title = run.displayTitle || run.name || `${target.owner}/${target.repo} #${target.runId}`;
  const url = run.htmlUrl || target.url;

  return (
    <div className="pwa-watcher" style={{ borderLeftColor: theme.color }}>
      <div className="pwa-watcher-head">
        <span className="pwa-watcher-badge" style={{ color: theme.color, borderColor: `${theme.color}55` }}>
          <theme.Icon size={11} />
          <span>{theme.label}</span>
        </span>
        <span className="pwa-watcher-repo">
          <GitBranch size={10} />
          {target.owner}/{target.repo}
          {run.runNumber ? ` · #${run.runNumber}` : ''}
        </span>
      </div>
      <div className="pwa-watcher-title">{title}</div>
      {run.headBranch && (
        <div className="pwa-watcher-branch">{run.headBranch}</div>
      )}
      {jobs.length > 0 && (
        <div className="pwa-watcher-jobs">
          {jobs.map((j) => {
            const ji = jobIcon(j);
            return (
              <div key={j.id} className="pwa-watcher-job">
                <ji.Icon size={12} />
                <span className="pwa-watcher-job-name" style={{ color: ji.color }}>{j.name}</span>
              </div>
            );
          })}
        </div>
      )}
      {url && (
        <a className="pwa-watcher-link" href={url} target="_blank" rel="noopener noreferrer">
          Open on GitHub
          <ExternalLink size={11} />
        </a>
      )}
      <style>{`
        .pwa-watcher {
          margin: 6px 0;
          padding: 10px 12px 10px 14px;
          background: var(--bg-secondary);
          border: 1px solid var(--border);
          border-left-width: 3px;
          border-radius: 8px;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .pwa-watcher-head {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
        }
        .pwa-watcher-badge {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 2px 7px;
          border: 1px solid;
          border-radius: 999px;
          font-size: 10px;
          font-weight: 600;
          letter-spacing: 0.02em;
          text-transform: uppercase;
        }
        .pwa-watcher-repo {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          font-size: 10px;
          color: var(--text-muted);
          font-family: 'Geist Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
        }
        .pwa-watcher-title {
          font-size: 13px;
          color: var(--text);
          line-height: 1.3;
          word-break: break-word;
        }
        .pwa-watcher-branch {
          font-size: 11px;
          color: var(--text-muted);
          font-family: 'Geist Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
        }
        .pwa-watcher-jobs {
          display: flex;
          flex-direction: column;
          gap: 3px;
          margin-top: 2px;
        }
        .pwa-watcher-job {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 12px;
        }
        .pwa-watcher-job-name {
          font-family: 'Geist Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
          font-size: 11px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .pwa-watcher-link {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          font-size: 11px;
          color: var(--accent);
          text-decoration: none;
          margin-top: 2px;
          align-self: flex-start;
        }
        .pwa-watcher-link:hover { text-decoration: underline; }
      `}</style>
    </div>
  );
}
