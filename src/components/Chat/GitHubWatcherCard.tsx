import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { GitBranch, Tag, ExternalLink, AlertCircle, CheckCircle2, XCircle, CircleDot, Clock, MinusCircle } from 'lucide-react';
import { SPRING, useReducedMotionTransition } from './motion';
import type { GitHubWatchTarget } from './githubWatcher';
import type { GitHubWatcherSnapshot } from '../../types';

// Cards re-poll a non-terminal snapshot only if it's fresher than this; older
// "in progress" snapshots freeze on resume, so scrolling deep history doesn't spam the API.
const RESUME_REPOLL_WINDOW_MS = 24 * 60 * 60 * 1000;

export const GITHUB_WATCHER_SNAPSHOT_EVENT = 'sai-github-watcher-snapshot';
export interface GitHubWatcherSnapshotEventDetail {
  messageId: string;
  snapshot: GitHubWatcherSnapshot;
}

type RunStatus = 'queued' | 'in_progress' | 'completed' | 'unknown';
type RunConclusion = 'success' | 'failure' | 'cancelled' | 'skipped' | 'timed_out' | 'action_required' | 'neutral' | null;

interface RunState {
  status: RunStatus;
  conclusion: RunConclusion;
  name?: string;
  displayTitle?: string;
  runNumber?: number;
  runAttempt?: number;
  headBranch?: string;
  headSha?: string;
  event?: string;
  actor?: string;
  actorAvatar?: string;
  htmlUrl?: string;
  startedAt?: string;
  updatedAt?: string;
}

interface ReleaseState {
  name?: string;
  tagName?: string;
  draft?: boolean;
  prerelease?: boolean;
  publishedAt?: string;
  author?: string;
  authorAvatar?: string;
  body?: string;
  assetCount?: number;
  htmlUrl?: string;
}

// Active run polls fast; once terminal we stop. Releases poll once (mostly immutable).
const POLL_ACTIVE_MS = 5000;

// Module-level cache so cards remounted after a workspace swap reattach with last-known
// status instead of flashing "Fetching…" again. Keyed by canonical github URL.
const STATUS_CACHE = new Map<string, { run?: RunState; release?: ReleaseState }>();

type Phase = 'pending' | 'queued' | 'in_progress' | 'success' | 'failure' | 'cancelled' | 'neutral' | 'error';

function phaseOf(args: { target: GitHubWatchTarget; run: RunState | null; release: ReleaseState | null; error: string | null }): Phase {
  if (args.error) return 'error';
  if (args.target.kind === 'release') return args.release ? 'success' : 'pending';
  const run = args.run;
  if (!run) return 'pending';
  if (run.status === 'queued') return 'queued';
  if (run.status === 'in_progress') return 'in_progress';
  if (run.status === 'completed') {
    if (run.conclusion === 'success') return 'success';
    if (run.conclusion === 'failure' || run.conclusion === 'timed_out') return 'failure';
    if (run.conclusion === 'cancelled') return 'cancelled';
    return 'neutral';
  }
  return 'in_progress';
}

const PHASE_THEME: Record<Phase, { color: string; label: string; Icon: React.ComponentType<{ size?: number }> }> = {
  pending:     { color: 'var(--text-muted, #8a9099)',  label: 'Connecting',  Icon: Clock },
  queued:      { color: 'var(--text-muted, #8a9099)',  label: 'Queued',      Icon: Clock },
  in_progress: { color: 'var(--accent, #c7910c)',       label: 'Running',     Icon: CircleDot },
  success:     { color: '#3fb950',                      label: 'Success',     Icon: CheckCircle2 },
  failure:     { color: '#f85149',                      label: 'Failed',      Icon: XCircle },
  cancelled:   { color: 'var(--text-muted, #8a9099)',  label: 'Cancelled',   Icon: MinusCircle },
  neutral:     { color: 'var(--text-muted, #8a9099)',  label: 'Completed',   Icon: CheckCircle2 },
  error:       { color: '#f85149',                      label: 'Watcher error', Icon: AlertCircle },
};

function timeAgo(iso?: string): string {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return 'just now';
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

interface GitHubWatcherCardProps {
  target: GitHubWatchTarget;
  messageId?: string;
  seedSnapshot?: GitHubWatcherSnapshot;
}

const TERMINAL_PHASES: ReadonlySet<GitHubWatcherSnapshot['phase']> =
  new Set(['success', 'failure', 'cancelled', 'neutral']);

export default function GitHubWatcherCard({ target, messageId, seedSnapshot }: GitHubWatcherCardProps) {
  const cached = STATUS_CACHE.get(target.url);
  const seededRun = !cached && seedSnapshot?.kind === 'run' ? (seedSnapshot.data as unknown as RunState) : null;
  const seededRelease = !cached && seedSnapshot?.kind === 'release' ? (seedSnapshot.data as unknown as ReleaseState) : null;
  const [expanded, setExpanded] = useState(true);
  const [run, setRun] = useState<RunState | null>(cached?.run ?? seededRun);
  const [release, setRelease] = useState<ReleaseState | null>(cached?.release ?? seededRelease);
  const [error, setError] = useState<string | null>(null);
  const visibleRef = useRef<boolean>(typeof document === 'undefined' ? true : document.visibilityState === 'visible');
  const pop = useReducedMotionTransition(SPRING.pop);
  // Cache the seed in module STATUS_CACHE so dedupe + remounts reuse it without props plumbing.
  if (seededRun) STATUS_CACHE.set(target.url, { run: seededRun });
  if (seededRelease) STATUS_CACHE.set(target.url, { release: seededRelease });

  useEffect(() => {
    // Hybrid resume policy: terminal phases never re-poll (immutable on GitHub).
    // Non-terminal phases re-poll only if the snapshot is recent — older ones freeze
    // so scrolling through stale history doesn't burn API budget.
    if (seedSnapshot) {
      if (TERMINAL_PHASES.has(seedSnapshot.phase)) return;
      if (Date.now() - seedSnapshot.capturedAt > RESUME_REPOLL_WINDOW_MS) return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    // Dev-only scripted timeline: sai://fake-run/<id>?outcome=success|failure|cancelled&speed=fast|slow
    if (target.url.startsWith('sai://fake')) {
      const qIndex = target.url.indexOf('?');
      const params = new URLSearchParams(qIndex >= 0 ? target.url.slice(qIndex) : '');
      const speedMs = params.get('speed') === 'slow' ? 4000 : 1500;
      const outcome = (params.get('outcome') as RunConclusion) || 'success';
      if (target.kind === 'run') {
        const base = {
          name: 'Build and Test',
          displayTitle: 'feat(chat): preview live release/action watchers',
          runNumber: 142,
          runAttempt: 1,
          headBranch: 'feat/github-watcher',
          headSha: 'a1b2c3d4e5f6789012345678901234567890abcd',
          event: 'push',
          actor: 'darkharasho',
          startedAt: new Date(Date.now() - 30_000).toISOString(),
        };
        const seq: RunState[] = [
          { status: 'queued', conclusion: null, ...base, updatedAt: new Date().toISOString() },
          { status: 'in_progress', conclusion: null, ...base, updatedAt: new Date().toISOString() },
          { status: 'completed', conclusion: outcome, ...base, updatedAt: new Date().toISOString() },
        ];
        let i = 0;
        const step = () => {
          if (cancelled || i >= seq.length) return;
          const next = { ...seq[i], updatedAt: new Date().toISOString() };
          setRun(next);
          STATUS_CACHE.set(target.url, { run: next });
          i++;
          if (i < seq.length) timer = setTimeout(step, speedMs);
        };
        step();
      } else {
        timer = setTimeout(() => {
          if (cancelled) return;
          const next: ReleaseState = {
            name: `SAI ${target.tag}`,
            tagName: target.tag,
            draft: params.get('outcome') === 'draft',
            prerelease: params.get('outcome') === 'prerelease',
            publishedAt: new Date().toISOString(),
            author: 'darkharasho',
            assetCount: 4,
            body: 'Adds live GitHub action + release watchers to chat. Status updates in-place via polling, supports scripted previews in dev (sai://fake-run/...).',
          };
          setRelease(next);
          STATUS_CACHE.set(target.url, { release: next });
        }, speedMs);
      }
      return () => { cancelled = true; if (timer) clearTimeout(timer); };
    }

    const path = target.kind === 'run'
      ? `/repos/${target.owner}/${target.repo}/actions/runs/${target.runId}`
      : `/repos/${target.owner}/${target.repo}/releases/tags/${encodeURIComponent(target.tag)}`;

    // Prefer the main-process IPC (uses stored oauth token if logged in); fall back to
    // an unauthenticated browser fetch when running outside Electron (web/test).
    const sai = (window as any).sai;
    const fetchJson = async (): Promise<any> => {
      if (sai?.githubApiGet) {
        const r = await sai.githubApiGet(path);
        if (!r.ok) throw new Error(`${r.status}${r.body?.message ? ` ${r.body.message}` : ''}`);
        return r.body;
      }
      const res = await fetch(`https://api.github.com${path}`, { headers: { Accept: 'application/vnd.github+json' } });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return await res.json();
    };

    async function tick() {
      if (cancelled) return;
      if (!visibleRef.current) {
        timer = setTimeout(tick, POLL_ACTIVE_MS);
        return;
      }
      try {
        const json = await fetchJson();
        if (cancelled) return;
        if (target.kind === 'run') {
          const next: RunState = {
            status: (json.status ?? 'unknown') as RunStatus,
            conclusion: (json.conclusion ?? null) as RunConclusion,
            name: json.name,
            displayTitle: json.display_title,
            runNumber: json.run_number,
            runAttempt: json.run_attempt,
            headBranch: json.head_branch,
            headSha: json.head_sha,
            event: json.event,
            actor: json.actor?.login ?? json.triggering_actor?.login,
            actorAvatar: json.actor?.avatar_url ?? json.triggering_actor?.avatar_url,
            htmlUrl: json.html_url,
            startedAt: json.run_started_at,
            updatedAt: json.updated_at,
          };
          setRun(next);
          STATUS_CACHE.set(target.url, { run: next });
          if (next.status !== 'completed') {
            timer = setTimeout(tick, POLL_ACTIVE_MS);
          }
        } else {
          const next: ReleaseState = {
            name: json.name,
            tagName: json.tag_name,
            draft: json.draft,
            prerelease: json.prerelease,
            publishedAt: json.published_at,
            author: json.author?.login,
            authorAvatar: json.author?.avatar_url,
            body: json.body,
            assetCount: Array.isArray(json.assets) ? json.assets.length : undefined,
            htmlUrl: json.html_url,
          };
          setRelease(next);
          STATUS_CACHE.set(target.url, { release: next });
        }
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        // Don't reschedule on error — usually rate limit or 404. User can reopen the card later.
      }
    }

    const onVisibility = () => {
      visibleRef.current = document.visibilityState === 'visible';
    };
    document.addEventListener('visibilitychange', onVisibility);
    tick();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [target.kind, target.owner, target.repo, target.kind === 'run' ? target.runId : target.tag, seedSnapshot]);

  const phase = phaseOf({ target, run, release, error });
  // Dispatch a snapshot only when the phase actually transitions (not on every poll).
  // ChatPanel listens for these and writes them onto the owning message so they persist.
  const prevPhaseRef = useRef<typeof phase | null>(seedSnapshot?.phase ?? null);
  useEffect(() => {
    if (phase === 'pending') return;
    if (prevPhaseRef.current === phase) return;
    prevPhaseRef.current = phase;
    if (!messageId) return;
    const data = target.kind === 'run' ? (run as unknown as Record<string, unknown>) : (release as unknown as Record<string, unknown>);
    if (!data) return;
    const snapshot: GitHubWatcherSnapshot = { url: target.url, kind: target.kind, phase, capturedAt: Date.now(), data };
    const detail: GitHubWatcherSnapshotEventDetail = { messageId, snapshot };
    window.dispatchEvent(new CustomEvent(GITHUB_WATCHER_SNAPSHOT_EVENT, { detail }));
  }, [phase, messageId, target.url, target.kind, run, release]);
  const theme = PHASE_THEME[phase];
  const KindIcon = target.kind === 'run' ? GitBranch : Tag;
  // Title: prefer commit-style display_title (what GitHub shows in the runs list),
  // fall back to the workflow name. Release falls back to its tag.
  const title = target.kind === 'run'
    ? (run?.displayTitle || run?.name || `Run #${target.runId}`)
    : (release?.name || release?.tagName || target.tag);
  const subtitle = `${target.owner}/${target.repo}`;
  const isLive = phase === 'queued' || phase === 'in_progress' || phase === 'pending';
  const StatusIcon = theme.Icon;
  const shortSha = run?.headSha?.slice(0, 7);
  const durationMs = run?.startedAt && run?.updatedAt
    ? Math.max(0, new Date(run.updatedAt).getTime() - new Date(run.startedAt).getTime())
    : undefined;
  const durationLabel = durationMs != null
    ? durationMs < 60_000 ? `${Math.round(durationMs / 1000)}s` : `${Math.floor(durationMs / 60_000)}m ${Math.round((durationMs % 60_000) / 1000)}s`
    : undefined;

  return (
    <motion.div
      data-testid="github-watcher-card"
      data-phase={phase}
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={pop}
      className="gh-watcher"
      style={{ '--gh-accent': theme.color } as React.CSSProperties}
    >
      <div className={`gh-watcher-bar${isLive ? ' gh-watcher-bar-live' : ''}`} aria-hidden />
      <div className="gh-watcher-inner" onClick={() => setExpanded(v => !v)}>
        <header className="gh-watcher-head">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.div
              key={phase}
              className="gh-watcher-badge"
              initial={{ scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.6, opacity: 0 }}
              transition={pop}
            >
              <StatusIcon size={18} />
              <span className="gh-watcher-badge-label">{theme.label}</span>
              {isLive && <span className="gh-watcher-badge-pulse" aria-hidden />}
            </motion.div>
          </AnimatePresence>
          <div className="gh-watcher-eyebrow">
            <KindIcon size={11} />
            <span className="gh-watcher-eyebrow-kind">{target.kind === 'run' ? 'GitHub Action' : 'GitHub Release'}</span>
            <span className="gh-watcher-sep">·</span>
            <span className="gh-watcher-repo">{subtitle}</span>
            {target.kind === 'run' && run?.runNumber && (
              <>
                <span className="gh-watcher-sep">·</span>
                <span className="gh-watcher-run-no">#{run.runNumber}{run.runAttempt && run.runAttempt > 1 ? ` · attempt ${run.runAttempt}` : ''}</span>
              </>
            )}
          </div>
          <div className="gh-watcher-times">
            {durationLabel && <span className="gh-watcher-time gh-watcher-duration">{durationLabel}</span>}
            {(run?.updatedAt || release?.publishedAt) && (
              <span className="gh-watcher-time">{timeAgo(run?.updatedAt ?? release?.publishedAt)}</span>
            )}
          </div>
        </header>
        <h3 className="gh-watcher-title" title={title}>{title}</h3>
        {target.kind === 'run' && (run?.headBranch || shortSha || run?.event || run?.actor) && (
          <div className="gh-watcher-chips">
            {run?.headBranch && (
              <span className="gh-watcher-chip"><GitBranch size={11} /><code>{run.headBranch}</code></span>
            )}
            {shortSha && <span className="gh-watcher-chip gh-watcher-chip-mono"><code>{shortSha}</code></span>}
            {run?.event && <span className="gh-watcher-chip gh-watcher-chip-event">{run.event}</span>}
            {run?.actor && (
              <span className="gh-watcher-chip gh-watcher-chip-actor">
                {run.actorAvatar && <img src={run.actorAvatar} alt="" />} @{run.actor}
              </span>
            )}
          </div>
        )}
        {target.kind === 'release' && release && (
          <div className="gh-watcher-chips">
            <span className="gh-watcher-chip"><Tag size={11} /><code>{release.tagName}</code></span>
            <span className={`gh-watcher-chip gh-watcher-chip-state gh-watcher-chip-state-${release.draft ? 'draft' : release.prerelease ? 'prerelease' : 'published'}`}>
              {release.draft ? 'draft' : release.prerelease ? 'prerelease' : 'published'}
            </span>
            {typeof release.assetCount === 'number' && release.assetCount > 0 && (
              <span className="gh-watcher-chip">{release.assetCount} asset{release.assetCount === 1 ? '' : 's'}</span>
            )}
            {release.author && (
              <span className="gh-watcher-chip gh-watcher-chip-actor">
                {release.authorAvatar && <img src={release.authorAvatar} alt="" />} @{release.author}
              </span>
            )}
          </div>
        )}
        <AnimatePresence initial={false}>
          {expanded && (
            <motion.div
              key="body"
              className="gh-watcher-body"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] as const }}
              style={{ overflow: 'hidden' }}
            >
              <div className="gh-watcher-body-inner">
                {error && <div className="gh-watcher-error">{error}</div>}
                {!error && target.kind === 'run' && run && (
                  <dl className="gh-watcher-dl">
                    {run.name && (<><dt>workflow</dt><dd>{run.name}</dd></>)}
                    {run.conclusion && (<><dt>conclusion</dt><dd>{run.conclusion.replace(/_/g, ' ')}</dd></>)}
                    {run.startedAt && (<><dt>started</dt><dd>{new Date(run.startedAt).toLocaleString()}</dd></>)}
                    {run.updatedAt && (<><dt>updated</dt><dd>{new Date(run.updatedAt).toLocaleString()}</dd></>)}
                  </dl>
                )}
                {!error && target.kind === 'release' && release && (
                  <>
                    <dl className="gh-watcher-dl">
                      {release.publishedAt && (<><dt>published</dt><dd>{new Date(release.publishedAt).toLocaleString()}</dd></>)}
                    </dl>
                    {release.body && <pre className="gh-watcher-release-body">{release.body}</pre>}
                  </>
                )}
                {!error && !run && !release && <div className="gh-watcher-pending">Watching…</div>}
                <a
                  href={target.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="gh-watcher-cta"
                  onClick={(e) => e.stopPropagation()}
                >
                  Open on GitHub <ExternalLink size={12} />
                </a>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <style>{`
        .gh-watcher {
          position: relative;
          width: 100%;
          margin: 6px 0;
          background: linear-gradient(180deg, var(--bg-elevated, #1c2027) 0%, var(--bg-secondary, #0c0f11) 100%);
          border: 1px solid var(--border-color, rgba(255,255,255,0.08));
          border-radius: 10px;
          overflow: hidden;
          box-shadow: 0 1px 0 rgba(255,255,255,0.03) inset, 0 4px 18px rgba(0,0,0,0.25);
        }
        .gh-watcher[data-phase="success"] { border-color: rgba(63, 185, 80, 0.35); }
        .gh-watcher[data-phase="failure"], .gh-watcher[data-phase="error"] { border-color: rgba(248, 81, 73, 0.4); }
        .gh-watcher[data-phase="in_progress"] {
          border-color: color-mix(in srgb, var(--gh-accent) 45%, transparent);
          box-shadow: 0 0 0 1px color-mix(in srgb, var(--gh-accent) 22%, transparent),
                      0 4px 22px color-mix(in srgb, var(--gh-accent) 18%, transparent);
        }
        .gh-watcher-bar {
          position: absolute; left: 0; top: 0; bottom: 0; width: 4px;
          background: var(--gh-accent);
          opacity: 0.85;
        }
        .gh-watcher-bar-live {
          background: linear-gradient(180deg,
            color-mix(in srgb, var(--gh-accent) 30%, transparent) 0%,
            var(--gh-accent) 50%,
            color-mix(in srgb, var(--gh-accent) 30%, transparent) 100%);
          background-size: 100% 240%;
          animation: gh-bar-flow 1.8s linear infinite;
        }
        @keyframes gh-bar-flow {
          0% { background-position: 0% 0%; }
          100% { background-position: 0% 240%; }
        }
        .gh-watcher-inner { padding: 14px 18px 14px 22px; cursor: pointer; }
        .gh-watcher-head {
          display: grid;
          grid-template-columns: max-content 1fr max-content;
          align-items: center;
          gap: 14px;
        }
        .gh-watcher-badge {
          position: relative;
          display: inline-flex; align-items: center; gap: 7px;
          padding: 6px 11px;
          background: color-mix(in srgb, var(--gh-accent) 14%, var(--bg-input, #161a1f));
          border: 1px solid color-mix(in srgb, var(--gh-accent) 35%, transparent);
          color: var(--gh-accent);
          border-radius: 999px;
          font-size: 12px;
          font-weight: 600;
          letter-spacing: 0.02em;
          flex-shrink: 0;
        }
        .gh-watcher-badge-label { line-height: 1; }
        .gh-watcher-badge-pulse {
          position: absolute; inset: -2px;
          border-radius: 999px;
          border: 2px solid var(--gh-accent);
          opacity: 0;
          animation: gh-badge-pulse 1.6s ease-out infinite;
          pointer-events: none;
        }
        @keyframes gh-badge-pulse {
          0% { opacity: 0.55; transform: scale(1); }
          70% { opacity: 0; transform: scale(1.18); }
          100% { opacity: 0; transform: scale(1.18); }
        }
        .gh-watcher-eyebrow {
          display: flex; align-items: center; gap: 6px;
          min-width: 0;
          font-size: 11px;
          color: var(--text-muted, #8a9099);
          text-transform: uppercase;
          letter-spacing: 0.07em;
          overflow: hidden;
        }
        .gh-watcher-eyebrow svg { opacity: 0.8; flex-shrink: 0; }
        .gh-watcher-eyebrow-kind { white-space: nowrap; }
        .gh-watcher-sep { opacity: 0.45; }
        .gh-watcher-repo {
          font-family: var(--font-mono, ui-monospace, monospace);
          text-transform: none;
          letter-spacing: 0;
          color: var(--text-secondary, #b8bec5);
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .gh-watcher-run-no {
          font-family: var(--font-mono, ui-monospace, monospace);
          text-transform: none;
          letter-spacing: 0;
        }
        .gh-watcher-title {
          margin: 10px 0 0;
          font-size: 16px;
          line-height: 1.35;
          font-weight: 600;
          color: var(--text-primary, #e8ecef);
          letter-spacing: -0.005em;
          word-break: break-word;
        }
        .gh-watcher-times {
          display: flex; flex-direction: column; align-items: flex-end; gap: 2px;
          font-size: 11px;
          color: var(--text-muted, #8a9099);
          font-variant-numeric: tabular-nums;
        }
        .gh-watcher-duration { color: var(--gh-accent); font-weight: 500; }
        .gh-watcher-chips {
          display: flex; flex-wrap: wrap; gap: 6px;
          margin-top: 10px;
        }
        .gh-watcher-chip {
          display: inline-flex; align-items: center; gap: 5px;
          padding: 3px 8px;
          font-size: 11.5px;
          background: var(--bg-input, #161a1f);
          border: 1px solid var(--border-color, rgba(255,255,255,0.06));
          border-radius: 5px;
          color: var(--text-secondary, #b8bec5);
        }
        .gh-watcher-chip code {
          font-family: var(--font-mono, ui-monospace, monospace);
          background: transparent;
          padding: 0;
          font-size: 11.5px;
        }
        .gh-watcher-chip svg { opacity: 0.7; }
        .gh-watcher-chip-event { text-transform: uppercase; font-size: 10px; letter-spacing: 0.08em; }
        .gh-watcher-chip-actor img {
          width: 14px; height: 14px; border-radius: 50%; object-fit: cover;
        }
        .gh-watcher-chip-state-draft { color: var(--text-muted, #8a9099); }
        .gh-watcher-chip-state-prerelease { color: #d29922; border-color: rgba(210, 153, 34, 0.3); }
        .gh-watcher-chip-state-published { color: #3fb950; border-color: rgba(63, 185, 80, 0.3); }
        .gh-watcher-release-body {
          margin: 10px 0 12px;
          padding: 10px 12px;
          background: var(--bg-input, #161a1f);
          border: 1px solid var(--border-color, rgba(255,255,255,0.06));
          border-radius: 6px;
          font-family: inherit;
          font-size: 12.5px;
          line-height: 1.55;
          color: var(--text-secondary, #b8bec5);
          white-space: pre-wrap;
          word-break: break-word;
          max-height: 240px;
          overflow-y: auto;
        }
        .gh-watcher-body { border-top: 1px solid color-mix(in srgb, var(--gh-accent) 18%, transparent); margin-top: 14px; }
        .gh-watcher-body-inner { padding: 12px 0 2px; font-size: 12.5px; }
        .gh-watcher-dl {
          display: grid;
          grid-template-columns: max-content 1fr;
          gap: 6px 18px;
          margin: 0 0 12px;
        }
        .gh-watcher-dl dt {
          color: var(--text-muted, #8a9099);
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          align-self: center;
        }
        .gh-watcher-dl dd { margin: 0; color: var(--text-primary, #e8ecef); }
        .gh-watcher-dl code {
          font-family: var(--font-mono, ui-monospace, monospace);
          background: var(--bg-input, #161a1f);
          padding: 1px 6px;
          border-radius: 4px;
          font-size: 11.5px;
        }
        .gh-watcher-pending { color: var(--text-muted, #8a9099); margin-bottom: 10px; }
        .gh-watcher-error {
          color: #f85149;
          background: rgba(248, 81, 73, 0.08);
          border: 1px solid rgba(248, 81, 73, 0.25);
          padding: 8px 10px; border-radius: 6px;
          margin-bottom: 10px;
        }
        .gh-watcher-cta {
          display: inline-flex; align-items: center; gap: 5px;
          padding: 6px 11px;
          background: color-mix(in srgb, var(--gh-accent) 18%, transparent);
          border: 1px solid color-mix(in srgb, var(--gh-accent) 40%, transparent);
          color: var(--gh-accent);
          border-radius: 6px;
          font-size: 12px;
          font-weight: 500;
          text-decoration: none;
          transition: background 0.15s ease;
        }
        .gh-watcher-cta:hover { background: color-mix(in srgb, var(--gh-accent) 28%, transparent); }
        @media (prefers-reduced-motion: reduce) {
          .gh-watcher-bar-live { animation: none; }
          .gh-watcher-badge-pulse { animation: none; opacity: 0; }
        }
      `}</style>
    </motion.div>
  );
}
