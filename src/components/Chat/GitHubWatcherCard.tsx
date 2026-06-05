import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { GitBranch, ExternalLink, AlertCircle, CheckCircle2, XCircle, CircleDot, Clock, MinusCircle, Circle } from 'lucide-react';
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

type JobStatus = 'queued' | 'in_progress' | 'waiting' | 'completed' | 'unknown';
interface JobStep {
  name: string;
  status: JobStatus;
  conclusion: RunConclusion;
  number: number;
}
interface JobState {
  id: number;
  name: string;
  status: JobStatus;
  conclusion: RunConclusion;
  startedAt?: string;
  completedAt?: string;
  steps: JobStep[];
  needs?: string[];
  synthetic?: boolean;
  level?: number;
  defKey?: string;
  defIndex?: number;
}

interface WorkflowJobDef {
  key: string;
  name?: string;
  needs: string[];
}

const POLL_ACTIVE_MS = 5000;

// Module-level cache so cards remounted after a workspace swap reattach with last-known
// status instead of flashing "Fetching…" again. Keyed by canonical github URL.
const STATUS_CACHE = new Map<string, { run: RunState; jobs?: JobState[] }>();

type Phase = 'pending' | 'queued' | 'in_progress' | 'success' | 'failure' | 'cancelled' | 'neutral' | 'error';

function phaseOf(args: { run: RunState | null; error: string | null }): Phase {
  if (args.error) return 'error';
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

function fmtClock(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });
}

// Cached workflow YAML parses, keyed by `${owner}/${repo}@${sha}:${path}`. A given
// commit's workflow file is immutable, so we never need to refetch it during polling.
const WORKFLOW_CACHE = new Map<string, WorkflowJobDef[]>();
const WORKFLOW_INFLIGHT = new Map<string, Promise<WorkflowJobDef[] | null>>();

// Minimal YAML parser for GitHub Actions `jobs:` blocks. Extracts job key, optional
// `name:`, and `needs:` (string, inline array, or multi-line array). Not a general
// YAML parser — covers the shapes actually used by GH workflows.
function parseWorkflowJobs(yaml: string): WorkflowJobDef[] {
  const lines = yaml.split(/\r?\n/);
  // Find `jobs:` at column 0.
  let i = 0;
  while (i < lines.length && !/^jobs:\s*$/.test(lines[i])) i++;
  if (i >= lines.length) return [];
  i++;
  const defs: WorkflowJobDef[] = [];
  // Determine job-key indent from the first non-blank, non-comment child line.
  let jobIndent = -1;
  while (i < lines.length) {
    const line = lines[i];
    if (/^\s*(#|$)/.test(line)) { i++; continue; }
    const indent = line.match(/^(\s*)/)![1].length;
    if (indent === 0) break;
    if (jobIndent < 0) jobIndent = indent;
    if (indent !== jobIndent) { i++; continue; }
    const keyMatch = line.match(/^\s*([A-Za-z0-9_-]+)\s*:\s*$/);
    if (!keyMatch) { i++; break; }
    const key = keyMatch[1];
    i++;
    const def: WorkflowJobDef = { key, needs: [] };
    while (i < lines.length) {
      const sub = lines[i];
      if (/^\s*(#|$)/.test(sub)) { i++; continue; }
      const subIndent = sub.match(/^(\s*)/)![1].length;
      if (subIndent <= jobIndent) break;
      const nameMatch = sub.match(/^\s*name\s*:\s*(.+?)\s*$/);
      if (nameMatch && def.name === undefined) {
        def.name = nameMatch[1].replace(/^["']|["']$/g, '');
      }
      const needsInline = sub.match(/^\s*needs\s*:\s*(.+)$/);
      if (needsInline) {
        const v = needsInline[1].trim();
        if (v.startsWith('[')) {
          def.needs = v.replace(/^\[|\]$/g, '').split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
        } else {
          def.needs = [v.replace(/^["']|["']$/g, '')];
        }
      } else if (/^\s*needs\s*:\s*$/.test(sub)) {
        i++;
        while (i < lines.length) {
          const item = lines[i];
          if (/^\s*(#|$)/.test(item)) { i++; continue; }
          const itemMatch = item.match(/^(\s*)-\s*(.+?)\s*$/);
          if (!itemMatch) break;
          if (itemMatch[1].length <= subIndent) break;
          def.needs.push(itemMatch[2].replace(/^["']|["']$/g, ''));
          i++;
        }
        continue;
      }
      i++;
    }
    defs.push(def);
  }
  return defs;
}

function decodeBase64Utf8(b64: string): string {
  const clean = b64.replace(/\s+/g, '');
  const bin = atob(clean);
  const bytes = new Uint8Array(bin.length);
  for (let j = 0; j < bin.length; j++) bytes[j] = bin.charCodeAt(j);
  return new TextDecoder('utf-8').decode(bytes);
}

async function loadWorkflowDefs(
  owner: string,
  repo: string,
  path: string,
  sha: string,
  fetchJson: (p: string) => Promise<any>,
): Promise<WorkflowJobDef[] | null> {
  const key = `${owner}/${repo}@${sha}:${path}`;
  const cached = WORKFLOW_CACHE.get(key);
  if (cached) return cached;
  const inflight = WORKFLOW_INFLIGHT.get(key);
  if (inflight) return inflight;
  const p = (async () => {
    try {
      const body = await fetchJson(`/repos/${owner}/${repo}/contents/${path}?ref=${sha}`);
      const content = typeof body?.content === 'string' ? body.content : '';
      if (!content) return null;
      const yaml = body.encoding === 'base64' ? decodeBase64Utf8(content) : content;
      const defs = parseWorkflowJobs(yaml);
      WORKFLOW_CACHE.set(key, defs);
      return defs;
    } catch {
      return null;
    } finally {
      WORKFLOW_INFLIGHT.delete(key);
    }
  })();
  WORKFLOW_INFLIGHT.set(key, p);
  return p;
}

// Merge YAML-declared jobs into the live job list and tag each with a DAG `level`
// derived from `needs:` so we can render columns left-to-right by dependency depth.
// Matrix-expanded live jobs ("Tests (linux)") are mapped to their YAML parent by
// prefix so they inherit the right level + needs.
function mergeWithWorkflow(live: JobState[], defs: WorkflowJobDef[]): JobState[] {
  if (defs.length === 0) return live.map(j => ({ ...j, level: 0 }));

  const defByKey = new Map<string, WorkflowJobDef>();
  const defIndexByKey = new Map<string, number>();
  for (let i = 0; i < defs.length; i++) {
    defByKey.set(defs[i].key, defs[i]);
    defIndexByKey.set(defs[i].key, i);
  }
  const defByDisplay = new Map<string, WorkflowJobDef>();
  for (const d of defs) {
    defByDisplay.set(d.key, d);
    if (d.name) defByDisplay.set(d.name, d);
  }

  // Memoized topological depth: a job's level is max(deps) + 1, or 0 if no deps.
  const levelByKey = new Map<string, number>();
  const visiting = new Set<string>();
  function levelOf(key: string): number {
    const cached = levelByKey.get(key);
    if (cached !== undefined) return cached;
    if (visiting.has(key)) return 0; // cycle guard
    visiting.add(key);
    const def = defByKey.get(key);
    let lvl = 0;
    if (def && def.needs.length > 0) {
      let max = -1;
      for (const dep of def.needs) max = Math.max(max, levelOf(dep));
      lvl = max + 1;
    }
    levelByKey.set(key, lvl);
    visiting.delete(key);
    return lvl;
  }
  for (const d of defs) levelOf(d.key);

  function defForLive(name: string): WorkflowJobDef | undefined {
    const exact = defByDisplay.get(name);
    if (exact) return exact;
    // GH renders matrix jobs as "<job name> (<combo>)". Pick the longest prefix match.
    let best: WorkflowJobDef | undefined;
    for (const d of defs) {
      const display = d.name ?? d.key;
      if (name.startsWith(display + ' (')) {
        if (!best || (display.length > (best.name ?? best.key).length)) best = d;
      }
    }
    return best;
  }

  const matchedDefs = new Set<string>();
  const out: JobState[] = [];
  for (const j of live) {
    const d = defForLive(j.name);
    if (d) {
      matchedDefs.add(d.key);
      out.push({
        ...j,
        needs: d.needs,
        level: levelByKey.get(d.key) ?? 0,
        defKey: d.key,
        defIndex: defIndexByKey.get(d.key),
      });
    } else {
      // Jobs that don't map to any YAML def (reusable-workflow callers etc.) — park at
      // level 0 and at the end of their column via a high defIndex.
      out.push({ ...j, level: 0, defIndex: Number.POSITIVE_INFINITY });
    }
  }
  let syntheticId = -1;
  for (let i = 0; i < defs.length; i++) {
    const d = defs[i];
    if (matchedDefs.has(d.key)) continue;
    out.push({
      id: syntheticId--,
      name: d.name ?? d.key,
      status: 'waiting',
      conclusion: null,
      steps: [],
      needs: d.needs,
      synthetic: true,
      level: levelByKey.get(d.key) ?? 0,
      defKey: d.key,
      defIndex: i,
    });
  }
  return out;
}

function jobIcon(j: JobState): { Icon: React.ComponentType<{ size?: number }>; color: string; live: boolean } {
  if (j.status === 'in_progress') return { Icon: CircleDot, color: 'var(--accent, #c7910c)', live: true };
  if (j.status === 'waiting') return { Icon: Circle, color: 'var(--text-muted, #8a9099)', live: false };
  if (j.status === 'queued') return { Icon: Clock, color: 'var(--text-muted, #8a9099)', live: false };
  if (j.status === 'completed') {
    if (j.conclusion === 'success') return { Icon: CheckCircle2, color: '#3fb950', live: false };
    if (j.conclusion === 'failure' || j.conclusion === 'timed_out') return { Icon: XCircle, color: '#f85149', live: false };
    if (j.conclusion === 'cancelled') return { Icon: MinusCircle, color: 'var(--text-muted, #8a9099)', live: false };
    if (j.conclusion === 'skipped') return { Icon: Circle, color: 'var(--text-muted, #8a9099)', live: false };
    return { Icon: CheckCircle2, color: 'var(--text-muted, #8a9099)', live: false };
  }
  return { Icon: Circle, color: 'var(--text-muted, #8a9099)', live: false };
}

function activeStepName(j: JobState): string | undefined {
  const running = j.steps.find(s => s.status === 'in_progress');
  if (running) return running.name;
  // Fall back to "next queued" so a job sitting between steps still shows a hint.
  return j.steps.find(s => s.status === 'queued')?.name;
}

function jobDuration(j: JobState): string | undefined {
  if (!j.startedAt) return undefined;
  const end = j.completedAt ? new Date(j.completedAt).getTime() : Date.now();
  const ms = Math.max(0, end - new Date(j.startedAt).getTime());
  if (ms < 1000) return undefined;
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
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
  const seededRun = !cached && seedSnapshot ? (seedSnapshot.data as unknown as RunState) : null;
  const seededJobs = !cached && seedSnapshot && Array.isArray((seedSnapshot.data as any).__jobs)
    ? ((seedSnapshot.data as any).__jobs as JobState[])
    : null;
  const [run, setRun] = useState<RunState | null>(cached?.run ?? seededRun);
  const [jobs, setJobs] = useState<JobState[] | null>(cached?.jobs ?? seededJobs);
  const [error, setError] = useState<string | null>(null);
  const visibleRef = useRef<boolean>(typeof document === 'undefined' ? true : document.visibilityState === 'visible');
  const pop = useReducedMotionTransition(SPRING.pop);
  // Capture the seed once on mount. seedSnapshot is re-derived from message state
  // on every render (find() returns a new object), and our own phase-transition
  // dispatch updates that message — depending on it would restart the effect mid-run.
  const initialSeedRef = useRef(seedSnapshot);
  if (seededRun && !cached) STATUS_CACHE.set(target.url, { run: seededRun, jobs: seededJobs ?? undefined });

  useEffect(() => {
    const seed = initialSeedRef.current;
    if (seed) {
      if (TERMINAL_PHASES.has(seed.phase)) return;
      if (Date.now() - seed.capturedAt > RESUME_REPOLL_WINDOW_MS) return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    // Dev-only scripted timeline: sai://fake-run/<id>?outcome=success|failure|cancelled&speed=fast|slow
    if (target.url.startsWith('sai://fake')) {
      const qIndex = target.url.indexOf('?');
      const params = new URLSearchParams(qIndex >= 0 ? target.url.slice(qIndex) : '');
      const speedMs = params.get('speed') === 'slow' ? 4000 : 1500;
      const outcome = (params.get('outcome') as RunConclusion) || 'success';
      const base = {
        name: 'Build and Test',
        displayTitle: 'feat(chat): preview live action watchers',
        runNumber: 142,
        runAttempt: 1,
        headBranch: 'feat/github-watcher',
        headSha: 'a1b2c3d4e5f6789012345678901234567890abcd',
        event: 'push',
        actor: 'darkharasho',
        startedAt: new Date(Date.now() - 30_000).toISOString(),
      };
      const mkSteps = (running: number, total: number, failedAt?: number): JobStep[] => Array.from({ length: total }, (_, i) => {
        const n = i + 1;
        const stepNames = ['Set up job', 'Checkout', 'Install deps', 'Build', 'Test', 'Upload artifacts'];
        const name = stepNames[i] ?? `Step ${n}`;
        if (failedAt != null && n === failedAt) return { name, status: 'completed', conclusion: 'failure', number: n };
        if (failedAt != null && n > failedAt) return { name, status: 'queued', conclusion: null, number: n };
        if (n < running) return { name, status: 'completed', conclusion: 'success', number: n };
        if (n === running) return { name, status: 'in_progress', conclusion: null, number: n };
        return { name, status: 'queued', conclusion: null, number: n };
      });
      const mkJob = (id: number, name: string, status: JobStatus, conclusion: RunConclusion, running: number, total = 6, failedAt?: number): JobState => ({
        id, name, status, conclusion,
        startedAt: status === 'queued' ? undefined : new Date(Date.now() - 20_000).toISOString(),
        completedAt: status === 'completed' ? new Date().toISOString() : undefined,
        steps: mkSteps(running, total, failedAt),
        // Tests runs first (no deps), then build matrix gates on tests — mirrors the
        // shape of the real release.yml so column ordering reads correctly in dev.
        level: name.startsWith('Tests') ? 0 : 1,
        needs: name.startsWith('Build') ? ['test'] : undefined,
        defIndex: name.startsWith('Tests') ? 0 : 1,
      });
      const jobsSeq: JobState[][] = [
        [
          mkJob(4, 'Tests', 'in_progress', null, 3),
          mkJob(1, 'Build (linux)', 'waiting', null, 0),
          mkJob(2, 'Build (windows)', 'waiting', null, 0),
          mkJob(3, 'Build (macos)', 'waiting', null, 0),
        ],
        [
          mkJob(4, 'Tests', 'completed', 'success', 6),
          mkJob(1, 'Build (linux)', 'in_progress', null, 4),
          mkJob(2, 'Build (windows)', 'in_progress', null, 3),
          mkJob(3, 'Build (macos)', 'in_progress', null, 2),
        ],
        [
          mkJob(4, 'Tests', 'completed', 'success', 6),
          mkJob(1, 'Build (linux)', 'completed', 'success', 6),
          mkJob(2, 'Build (windows)', 'completed', 'success', 6),
          mkJob(3, 'Build (macos)', 'completed', outcome === 'failure' ? 'failure' : 'success', 6, 6, outcome === 'failure' ? 4 : undefined),
        ],
      ];
      const seq: { run: RunState; jobs: JobState[] }[] = [
        { run: { status: 'queued', conclusion: null, ...base, updatedAt: new Date().toISOString() }, jobs: jobsSeq[0] },
        { run: { status: 'in_progress', conclusion: null, ...base, updatedAt: new Date().toISOString() }, jobs: jobsSeq[1] },
        { run: { status: 'completed', conclusion: outcome, ...base, updatedAt: new Date().toISOString() }, jobs: jobsSeq[2] },
      ];
      let i = 0;
      const step = () => {
        if (cancelled || i >= seq.length) return;
        const next = { run: { ...seq[i].run, updatedAt: new Date().toISOString() }, jobs: seq[i].jobs };
        setRun(next.run);
        setJobs(next.jobs);
        STATUS_CACHE.set(target.url, next);
        i++;
        if (i < seq.length) timer = setTimeout(step, speedMs);
      };
      step();
      return () => { cancelled = true; if (timer) clearTimeout(timer); };
    }

    const runPath = `/repos/${target.owner}/${target.repo}/actions/runs/${target.runId}`;
    const jobsPath = `/repos/${target.owner}/${target.repo}/actions/runs/${target.runId}/jobs`;

    const sai = (window as any).sai;
    const fetchJson = async (path: string): Promise<any> => {
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
        const [runJson, jobsJson] = await Promise.all([fetchJson(runPath), fetchJson(jobsPath)]);
        if (cancelled) return;
        const nextRun: RunState = {
          status: (runJson.status ?? 'unknown') as RunStatus,
          conclusion: (runJson.conclusion ?? null) as RunConclusion,
          name: runJson.name,
          displayTitle: runJson.display_title,
          runNumber: runJson.run_number,
          runAttempt: runJson.run_attempt,
          headBranch: runJson.head_branch,
          headSha: runJson.head_sha,
          event: runJson.event,
          actor: runJson.actor?.login ?? runJson.triggering_actor?.login,
          actorAvatar: runJson.actor?.avatar_url ?? runJson.triggering_actor?.avatar_url,
          htmlUrl: runJson.html_url,
          startedAt: runJson.run_started_at,
          updatedAt: runJson.updated_at,
        };
        const liveJobs: JobState[] = Array.isArray(jobsJson?.jobs)
          ? jobsJson.jobs.map((j: any) => ({
              id: j.id,
              name: j.name,
              status: (j.status ?? 'unknown') as JobStatus,
              conclusion: (j.conclusion ?? null) as RunConclusion,
              startedAt: j.started_at,
              completedAt: j.completed_at,
              steps: Array.isArray(j.steps) ? j.steps.map((s: any) => ({
                name: s.name,
                status: (s.status ?? 'unknown') as JobStatus,
                conclusion: (s.conclusion ?? null) as RunConclusion,
                number: s.number,
              })) : [],
            }))
          : [];
        let nextJobs = liveJobs;
        // While the run is still active, fetch+parse the workflow YAML so jobs gated
        // by `needs:` (which GH's /jobs endpoint omits until they're scheduled) show
        // up as 'waiting' placeholders. Skip for completed runs — the API list is final.
        if (nextRun.status !== 'completed' && runJson.path && runJson.head_sha) {
          const defs = await loadWorkflowDefs(target.owner, target.repo, runJson.path, runJson.head_sha, fetchJson);
          if (cancelled) return;
          if (defs) nextJobs = mergeWithWorkflow(liveJobs, defs);
        }
        setRun(nextRun);
        setJobs(nextJobs);
        STATUS_CACHE.set(target.url, { run: nextRun, jobs: nextJobs });
        if (nextRun.status !== 'completed') {
          timer = setTimeout(tick, POLL_ACTIVE_MS);
        }
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
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
  }, [target.owner, target.repo, target.runId, target.url]);

  const phase = phaseOf({ run, error });
  const prevPhaseRef = useRef<typeof phase | null>(seedSnapshot?.phase ?? null);
  useEffect(() => {
    if (phase === 'pending') return;
    if (prevPhaseRef.current === phase) return;
    prevPhaseRef.current = phase;
    if (!messageId) return;
    if (!run) return;
    // Stash jobs alongside the run under a leading-underscore key so the snapshot
    // type stays opaque but reload can rehydrate the right column.
    const data: Record<string, unknown> = { ...(run as unknown as Record<string, unknown>) };
    if (jobs) data.__jobs = jobs;
    const snapshot: GitHubWatcherSnapshot = {
      url: target.url, kind: 'run', phase, capturedAt: Date.now(), data,
    };
    const detail: GitHubWatcherSnapshotEventDetail = { messageId, snapshot };
    window.dispatchEvent(new CustomEvent(GITHUB_WATCHER_SNAPSHOT_EVENT, { detail }));
  }, [phase, messageId, target.url, run, jobs]);
  const theme = PHASE_THEME[phase];
  const title = run?.displayTitle || run?.name || `Run #${target.runId}`;
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
      <div className="gh-watcher-inner">
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
            <GitBranch size={11} />
            {run?.name && <span className="gh-watcher-workflow-name" title={run.name}>{run.name}</span>}
            {run?.name && <span className="gh-watcher-sep">·</span>}
            <span className="gh-watcher-repo">{subtitle}</span>
            {run?.runNumber && (
              <>
                <span className="gh-watcher-sep">·</span>
                <span className="gh-watcher-run-no">#{run.runNumber}{run.runAttempt && run.runAttempt > 1 ? ` · attempt ${run.runAttempt}` : ''}</span>
              </>
            )}
          </div>
          <div className="gh-watcher-times">
            {run?.startedAt && (
              <span className="gh-watcher-time">
                {fmtClock(run.startedAt)}
                {run.status === 'completed' && run.updatedAt
                  ? <> → {fmtClock(run.updatedAt)}</>
                  : null}
              </span>
            )}
            {durationLabel && <span className="gh-watcher-time gh-watcher-duration">{durationLabel}</span>}
          </div>
        </header>
        <h3 className="gh-watcher-title" title={title}>{title}</h3>
        {(run?.headBranch || shortSha || run?.event || run?.actor) && (
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
        {jobs && jobs.length > 0 && (() => {
          const byLevel = new Map<number, JobState[]>();
          for (const j of jobs) {
            const l = j.level ?? 0;
            const bucket = byLevel.get(l);
            if (bucket) bucket.push(j);
            else byLevel.set(l, [j]);
          }
          // Stable column ordering: by YAML def index, then by name (keeps matrix
          // children "Tests (linux)" / "Tests (windows)" in alpha order regardless of
          // which finished first).
          for (const bucket of byLevel.values()) {
            bucket.sort((a, b) => {
              const ai = a.defIndex ?? Number.POSITIVE_INFINITY;
              const bi = b.defIndex ?? Number.POSITIVE_INFINITY;
              if (ai !== bi) return ai - bi;
              return a.name.localeCompare(b.name);
            });
          }
          const levels = Array.from(byLevel.keys()).sort((a, b) => a - b);
          return (
            <div className="gh-watcher-pipeline" onClick={(e) => e.stopPropagation()}>
              {levels.map((level, levelIdx) => (
                <div key={level} className="gh-watcher-pipe-col" data-level={level}>
                  {levelIdx > 0 && <span className="gh-watcher-pipe-arrow" aria-hidden />}
                  {byLevel.get(level)!.map((j) => {
                    const { Icon, color, live } = jobIcon(j);
                    const step = j.status === 'in_progress' ? activeStepName(j) : undefined;
                    const dur = jobDuration(j);
                    const doneSteps = j.steps.filter(s => s.status === 'completed').length;
                    const total = j.steps.length;
                    const progressPct = total > 0 ? Math.round((doneSteps / total) * 100) : 0;
                    const stateLabel =
                      j.status === 'in_progress' ? (step ?? 'Running…')
                      : j.status === 'waiting' ? (j.needs && j.needs.length > 0 ? `Needs ${j.needs.join(', ')}` : 'Waiting')
                      : j.status === 'queued' ? 'Queued'
                      : j.status === 'completed'
                        ? (j.conclusion === 'success' ? 'Passed'
                          : j.conclusion === 'failure' || j.conclusion === 'timed_out' ? 'Failed'
                          : j.conclusion === 'cancelled' ? 'Cancelled'
                          : j.conclusion === 'skipped' ? 'Skipped'
                          : 'Completed')
                      : '';
                    return (
                      <div
                        key={j.id}
                        className={`gh-watcher-pipe-job${live ? ' gh-watcher-pipe-job-live' : ''}`}
                        data-status={j.status}
                        data-conclusion={j.conclusion ?? ''}
                        style={{ '--job-color': color } as React.CSSProperties}
                      >
                        <div className="gh-watcher-pipe-head">
                          <span className="gh-watcher-pipe-icon" aria-hidden>
                            <Icon size={14} />
                            {live && <span className="gh-watcher-pipe-pulse" aria-hidden />}
                          </span>
                          <span className="gh-watcher-pipe-name" title={j.name}>{j.name}</span>
                          {dur && <span className="gh-watcher-pipe-dur">{dur}</span>}
                        </div>
                        {total > 0 && (
                          <div className="gh-watcher-pipe-bar" aria-hidden>
                            <div className="gh-watcher-pipe-bar-fill" style={{ width: `${progressPct}%` }} />
                          </div>
                        )}
                        <div className="gh-watcher-pipe-state" title={stateLabel}>
                          {stateLabel}
                          {total > 0 && j.status !== 'queued' && j.status !== 'waiting' && (
                            <span className="gh-watcher-pipe-steps"> · {doneSteps}/{total}</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          );
        })()}
        {error && <div className="gh-watcher-error">{error}</div>}
        {!error && !run && <div className="gh-watcher-pending">Watching…</div>}
        <div className="gh-watcher-foot">
          <a
            href={target.url}
            onClick={(e) => {
              e.preventDefault();
              window.sai.openExternal(target.url);
            }}
            className="gh-watcher-cta"
          >
            Open on GitHub <ExternalLink size={12} />
          </a>
        </div>
      </div>
      <style>{`
        .chat-msg-watcher-row {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          align-items: flex-start;
        }
        .chat-msg-watcher-row .gh-watcher {
          margin: 0;
          flex: 1 1 320px;
        }
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
          /* Two bright peaks stacked in one gradient (positions 25% and 75%).
             With background-size 100% 200%, one full animation period shifts
             the gradient by exactly the spacing between peaks — so the visible
             slice at the start of the loop matches the end frame perfectly
             and the flow appears seamless. */
          background: linear-gradient(180deg,
            color-mix(in srgb, var(--gh-accent) 30%, transparent) 0%,
            var(--gh-accent) 25%,
            color-mix(in srgb, var(--gh-accent) 30%, transparent) 50%,
            var(--gh-accent) 75%,
            color-mix(in srgb, var(--gh-accent) 30%, transparent) 100%);
          background-size: 100% 200%;
          animation: gh-bar-flow 1.8s linear infinite;
        }
        @keyframes gh-bar-flow {
          0%   { background-position: 0% 0%; }
          100% { background-position: 0% 100%; }
        }
        .gh-watcher-inner { padding: 10px 12px 10px 14px; }
        .gh-watcher-head {
          display: grid;
          grid-template-columns: max-content 1fr max-content;
          align-items: center;
          gap: 8px;
        }
        .gh-watcher-badge {
          position: relative;
          display: inline-flex; align-items: center; gap: 5px;
          padding: 4px 8px;
          background: color-mix(in srgb, var(--gh-accent) 14%, var(--bg-input, #161a1f));
          border: 1px solid color-mix(in srgb, var(--gh-accent) 35%, transparent);
          color: var(--gh-accent);
          border-radius: 999px;
          font-size: 11px;
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
        .gh-watcher-workflow-name {
          font-family: var(--font-mono, ui-monospace, monospace);
          text-transform: none;
          letter-spacing: 0;
          color: var(--text-primary, #e8ecef);
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
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
          margin: 8px 0 0;
          font-size: 13.5px;
          line-height: 1.3;
          font-weight: 600;
          color: var(--text-primary, #e8ecef);
          letter-spacing: -0.005em;
          word-break: break-word;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
        .gh-watcher-times {
          display: flex; flex-direction: column; align-items: flex-end; gap: 2px;
          font-size: 11px;
          color: var(--text-muted, #8a9099);
          font-variant-numeric: tabular-nums;
        }
        .gh-watcher-duration { color: var(--gh-accent); font-weight: 500; }
        .gh-watcher-chips {
          display: flex; flex-wrap: wrap; gap: 4px;
          margin-top: 8px;
        }
        .gh-watcher-chip {
          display: inline-flex; align-items: center; gap: 4px;
          padding: 2px 6px;
          font-size: 10.5px;
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
        .gh-watcher-pending { color: var(--text-muted, #8a9099); margin-top: 8px; font-size: 11.5px; }
        .gh-watcher-foot { margin-top: 8px; }
        .gh-watcher-error {
          color: #f85149;
          background: rgba(248, 81, 73, 0.08);
          border: 1px solid rgba(248, 81, 73, 0.25);
          padding: 8px 10px; border-radius: 6px;
          margin-top: 12px;
          font-size: 12.5px;
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

        .gh-watcher-pipeline {
          display: flex;
          flex-direction: row;
          justify-content: center;
          align-items: stretch;
          gap: 28px;
          margin-top: 10px;
          cursor: default;
          overflow-x: auto;
          padding-bottom: 2px;
        }
        .gh-watcher-pipe-col {
          position: relative;
          display: flex;
          flex-direction: column;
          justify-content: center;
          gap: 6px;
          min-width: 140px;
          max-width: 200px;
          flex: 1 1 160px;
        }
        .gh-watcher-pipe-arrow {
          position: absolute;
          left: -28px;
          top: 50%;
          width: 28px;
          height: 1px;
          background: color-mix(in srgb, var(--text-muted, #8a9099) 50%, transparent);
          transform: translateY(-50%);
          pointer-events: none;
        }
        .gh-watcher-pipe-arrow::after {
          content: '';
          position: absolute;
          right: -1px;
          top: 50%;
          width: 5px;
          height: 5px;
          border-top: 1.5px solid var(--text-muted, #8a9099);
          border-right: 1.5px solid var(--text-muted, #8a9099);
          transform: translateY(-50%) rotate(45deg);
          opacity: 0.7;
        }
        .gh-watcher-pipe-job {
          position: relative;
          display: flex;
          flex-direction: column;
          gap: 5px;
          padding: 7px 9px 8px;
          background: color-mix(in srgb, var(--bg-input, #161a1f) 70%, transparent);
          border: 1px solid var(--border-color, rgba(255,255,255,0.08));
          border-radius: 8px;
          min-width: 0;
          overflow: hidden;
        }
        .gh-watcher-pipe-job[data-status="waiting"] {
          opacity: 0.55;
          border-style: dashed;
        }
        .gh-watcher-pipe-job[data-status="in_progress"] {
          border-color: color-mix(in srgb, var(--job-color) 50%, transparent);
          box-shadow: 0 0 0 1px color-mix(in srgb, var(--job-color) 22%, transparent),
                      0 2px 14px color-mix(in srgb, var(--job-color) 16%, transparent);
        }
        .gh-watcher-pipe-job[data-conclusion="success"] { border-color: rgba(63, 185, 80, 0.32); }
        .gh-watcher-pipe-job[data-conclusion="failure"],
        .gh-watcher-pipe-job[data-conclusion="timed_out"] { border-color: rgba(248, 81, 73, 0.4); }
        .gh-watcher-pipe-head {
          display: flex; align-items: center; gap: 8px;
          min-width: 0;
        }
        .gh-watcher-pipe-icon {
          position: relative;
          display: inline-flex; align-items: center; justify-content: center;
          width: 18px; height: 18px;
          color: var(--job-color);
          flex-shrink: 0;
        }
        .gh-watcher-pipe-pulse {
          position: absolute; inset: -4px;
          border-radius: 50%;
          border: 2px solid var(--job-color);
          opacity: 0;
          animation: gh-job-pulse 1.6s ease-out infinite;
          pointer-events: none;
        }
        @keyframes gh-job-pulse {
          0% { opacity: 0.5; transform: scale(1); }
          70% { opacity: 0; transform: scale(1.6); }
          100% { opacity: 0; transform: scale(1.6); }
        }
        .gh-watcher-pipe-name {
          flex: 1; min-width: 0;
          font-size: 12.5px;
          font-weight: 600;
          color: var(--text-primary, #e8ecef);
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
          letter-spacing: -0.005em;
        }
        .gh-watcher-pipe-job-live .gh-watcher-pipe-name { color: var(--job-color); }
        .gh-watcher-pipe-dur {
          flex-shrink: 0;
          font-size: 10.5px;
          color: var(--text-muted, #8a9099);
          font-variant-numeric: tabular-nums;
        }
        .gh-watcher-pipe-bar {
          position: relative;
          height: 3px;
          background: color-mix(in srgb, var(--text-muted, #8a9099) 18%, transparent);
          border-radius: 999px;
          overflow: hidden;
        }
        .gh-watcher-pipe-bar-fill {
          height: 100%;
          background: var(--job-color);
          border-radius: 999px;
          transition: width 0.4s ease;
        }
        .gh-watcher-pipe-job-live .gh-watcher-pipe-bar {
          background: color-mix(in srgb, var(--job-color) 20%, transparent);
        }
        .gh-watcher-pipe-job-live .gh-watcher-pipe-bar-fill {
          background: linear-gradient(90deg,
            color-mix(in srgb, var(--job-color) 40%, transparent) 0%,
            var(--job-color) 50%,
            color-mix(in srgb, var(--job-color) 40%, transparent) 100%);
          background-size: 240% 100%;
          animation: gh-pipe-shimmer 1.6s linear infinite;
        }
        @keyframes gh-pipe-shimmer {
          0% { background-position: 240% 0%; }
          100% { background-position: 0% 0%; }
        }
        .gh-watcher-pipe-state {
          font-size: 11px;
          color: var(--text-muted, #8a9099);
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .gh-watcher-pipe-job-live .gh-watcher-pipe-state { color: var(--job-color); }
        .gh-watcher-pipe-steps { color: var(--text-muted, #8a9099); font-variant-numeric: tabular-nums; }

        @media (prefers-reduced-motion: reduce) {
          .gh-watcher-bar-live { animation: none; }
          .gh-watcher-badge-pulse { animation: none; opacity: 0; }
          .gh-watcher-pipe-pulse { animation: none; opacity: 0; }
          .gh-watcher-pipe-bar-fill { animation: none; }
        }
      `}</style>
    </motion.div>
  );
}
