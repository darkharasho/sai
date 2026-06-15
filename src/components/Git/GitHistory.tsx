import { useEffect, useMemo, useState } from 'react';
import {
  GitCommit as GitCommitIcon,
  ChevronDown,
  ChevronRight,
  FileText,
  RefreshCw,
  Search,
  GitBranch,
} from 'lucide-react';
import { GitCommit } from '../../types';
import { computeGraph, laneColor, GraphRow } from './commitGraph';

interface GitHistoryProps {
  projectPath: string;
}

interface CommitDetails {
  hash: string;
  author: string;
  email: string;
  date: string;
  parents: string[];
  message: string;
  files: { path: string; additions: number; deletions: number }[];
}

interface DiffLine {
  type: '+' | '-' | ' ';
  text: string;
}

const PROVIDER_LABELS = {
  claude: 'Claude',
  codex: 'Codex',
  gemini: 'Gemini',
} as const;

const PAGE_SIZE = 50;
const ROW_H = 48;
const LANE_W = 14;
const MAX_DIFF_LINES = 60;

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return dateStr;
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined,
    hour: 'numeric',
    minute: '2-digit',
  });
}

function parseDiffLines(diff: string): DiffLine[] {
  return diff
    .split('\n')
    .filter(
      (line) =>
        line.length > 0 &&
        !line.startsWith('diff ') &&
        !line.startsWith('index ') &&
        !line.startsWith('--- ') &&
        !line.startsWith('+++ ') &&
        !line.startsWith('@@') &&
        !line.startsWith('\\ ')
    )
    .map((line) => {
      if (line.startsWith('+')) return { type: '+' as const, text: line.slice(1) };
      if (line.startsWith('-')) return { type: '-' as const, text: line.slice(1) };
      return { type: ' ' as const, text: line.slice(1) };
    });
}

function edgePath(x1: number, y1: number, x2: number, y2: number): string {
  if (x1 === x2) return `M${x1},${y1} L${x2},${y2}`;
  const midY = (y1 + y2) / 2;
  return `M${x1},${y1} C${x1},${midY} ${x2},${midY} ${x2},${y2}`;
}

function GraphCell({ row, width }: { row: GraphRow; width: number }) {
  const { before, after, col, commit } = row;
  const x = (c: number) => LANE_W / 2 + c * LANE_W;
  const nodeY = ROW_H / 2;
  const segments: { d: string; color: string }[] = [];

  // Lanes passing straight through this row.
  before.forEach((hash, i) => {
    if (!hash || hash === commit.hash) return;
    const j = after.indexOf(hash);
    if (j !== -1) segments.push({ d: edgePath(x(i), 0, x(j), ROW_H), color: laneColor(hash) });
  });

  // Edges merging into this commit's node from above.
  before.forEach((hash, i) => {
    if (hash === commit.hash) {
      segments.push({ d: edgePath(x(i), 0, x(col), nodeY), color: laneColor(commit.hash) });
    }
  });

  // Edges leaving the node down toward each parent's lane.
  (commit.parents ?? []).forEach((ph) => {
    const j = after.indexOf(ph);
    if (j !== -1) segments.push({ d: edgePath(x(col), nodeY, x(j), ROW_H), color: laneColor(ph) });
  });

  return (
    <svg
      width={width}
      height={ROW_H}
      style={{ flexShrink: 0, display: 'block' }}
      aria-hidden
    >
      {segments.map((s, i) => (
        <path key={i} d={s.d} stroke={s.color} strokeWidth={1.5} fill="none" />
      ))}
      <circle
        cx={x(col)}
        cy={nodeY}
        r={commit.aiProvider ? 4 : 3.5}
        fill={laneColor(commit.hash)}
        stroke="var(--surface-0)"
        strokeWidth={1.5}
      />
    </svg>
  );
}

export default function GitHistory({ projectPath }: GitHistoryProps) {
  const [commits, setCommits] = useState<GitCommit[]>([]);
  const [count, setCount] = useState(PAGE_SIZE);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, CommitDetails>>({});
  const [reachedEnd, setReachedEnd] = useState(false);
  const [query, setQuery] = useState('');

  const [branches, setBranches] = useState<string[]>([]);
  const [currentBranch, setCurrentBranch] = useState<string | null>(null);
  const [ref, setRef] = useState<string | null>(null);

  const [fileDiffs, setFileDiffs] = useState<Record<string, DiffLine[] | 'loading'>>({});
  const [openFile, setOpenFile] = useState<string | null>(null);

  // Load branch list (and default the selected ref to the current branch).
  useEffect(() => {
    let cancelled = false;
    window.sai
      .gitBranches(projectPath)
      .then((res: { current: string; branches: string[]; remoteBranches: string[] }) => {
        if (cancelled) return;
        setBranches([...res.branches, ...res.remoteBranches]);
        setCurrentBranch(res.current);
        setRef((prev) => prev ?? res.current);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [projectPath]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    window.sai
      .gitLog(projectPath, count, ref ? { ref } : undefined)
      .then((log: GitCommit[]) => {
        if (cancelled) return;
        setCommits(log ?? []);
        setReachedEnd((log ?? []).length < count);
      })
      .catch((err: any) => {
        if (cancelled) return;
        setError(err?.message ?? 'Failed to load history');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectPath, count, ref]);

  const toggle = async (hash: string) => {
    if (expanded === hash) {
      setExpanded(null);
      return;
    }
    setExpanded(hash);
    if (!details[hash]) {
      try {
        const d = await (window.sai as any).gitCommitDetails(projectPath, hash);
        setDetails((prev) => ({ ...prev, [hash]: d }));
      } catch (err: any) {
        setError(err?.message ?? 'Failed to load commit');
      }
    }
  };

  const toggleFile = async (hash: string, path: string) => {
    const key = `${hash}:${path}`;
    if (openFile === key) {
      setOpenFile(null);
      return;
    }
    setOpenFile(key);
    if (!fileDiffs[key]) {
      setFileDiffs((prev) => ({ ...prev, [key]: 'loading' }));
      try {
        const raw = await (window.sai as any).gitCommitFileDiff(projectPath, hash, path);
        setFileDiffs((prev) => ({ ...prev, [key]: parseDiffLines(raw || '') }));
      } catch {
        setFileDiffs((prev) => ({ ...prev, [key]: [] }));
      }
    }
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commits;
    return commits.filter(
      (c) =>
        c.message.toLowerCase().includes(q) ||
        c.author.toLowerCase().includes(q) ||
        c.hash.toLowerCase().startsWith(q)
    );
  }, [commits, query]);

  // Graph is only meaningful on the full, unfiltered commit set.
  const showGraph = query.trim() === '';
  const { rows, maxLanes } = useMemo(
    () => (showGraph ? computeGraph(filtered) : { rows: [], maxLanes: 0 }),
    [filtered, showGraph]
  );
  const graphWidth = showGraph ? Math.max(1, maxLanes) * LANE_W + 6 : 0;

  const toolbar = (
    <div
      style={{
        display: 'flex',
        gap: 6,
        padding: '6px 10px',
        borderBottom: '1px solid var(--border-hairline)',
        flexShrink: 0,
      }}
    >
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center', flex: 1 }}>
        <Search
          size={12}
          color="var(--text-muted)"
          style={{ position: 'absolute', left: 7, pointerEvents: 'none' }}
        />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter commits…"
          style={{
            width: '100%',
            background: 'var(--surface-2)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 4,
            padding: '4px 6px 4px 22px',
            fontSize: 11,
            color: 'var(--text)',
            outline: 'none',
          }}
        />
      </div>
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
        <GitBranch
          size={12}
          color="var(--text-muted)"
          style={{ position: 'absolute', left: 7, pointerEvents: 'none' }}
        />
        <select
          value={ref ?? ''}
          onChange={(e) => {
            setRef(e.target.value);
            setCount(PAGE_SIZE);
            setExpanded(null);
          }}
          title="Branch"
          style={{
            maxWidth: 130,
            background: 'var(--surface-2)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 4,
            padding: '4px 6px 4px 22px',
            fontSize: 11,
            color: 'var(--text)',
            outline: 'none',
            cursor: 'pointer',
          }}
        >
          {currentBranch && !branches.includes(currentBranch) && (
            <option value={currentBranch}>{currentBranch}</option>
          )}
          {branches.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>
      </div>
    </div>
  );

  if (error) {
    return (
      <div>
        {toolbar}
        <div style={{ padding: '24px 12px', textAlign: 'center', fontSize: 11, color: 'var(--red)' }}>
          {error}
        </div>
      </div>
    );
  }

  return (
    <div>
      {toolbar}

      {!loading && filtered.length === 0 && (
        <div style={{ padding: '24px 12px', textAlign: 'center' }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4 }}>
            {query.trim() ? 'No matches' : 'No commits'}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            {query.trim() ? 'Try a different filter' : 'History is empty'}
          </div>
        </div>
      )}

      {filtered.map((commit, i) => {
        const shortHash = commit.hash.slice(0, 7);
        const isOpen = expanded === commit.hash;
        const det = details[commit.hash];
        const row = showGraph ? rows[i] : null;
        return (
          <div key={commit.hash} style={{ borderBottom: '1px solid var(--border-hairline)' }}>
            <div style={{ display: 'flex', alignItems: 'stretch' }}>
              {row && <GraphCell row={row} width={graphWidth} />}
              <div
                onClick={() => toggle(commit.hash)}
                style={{
                  height: ROW_H,
                  flex: 1,
                  minWidth: 0,
                  padding: '0 12px 0 4px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  cursor: 'pointer',
                  userSelect: 'none',
                }}
                title={commit.message}
              >
                <span style={{ flexShrink: 0 }}>
                  {isOpen ? (
                    <ChevronDown size={12} color="var(--text-muted)" />
                  ) : (
                    <ChevronRight size={12} color="var(--text-muted)" />
                  )}
                </span>
                {!showGraph && (
                  <GitCommitIcon
                    size={14}
                    color={commit.aiProvider ? 'var(--accent)' : 'var(--text-secondary)'}
                    style={{ flexShrink: 0 }}
                  />
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 12,
                      color: 'var(--text)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {commit.message.split('\n')[0]}
                  </div>
                  <div
                    style={{
                      fontSize: 10,
                      color: 'var(--text-muted)',
                      marginTop: 2,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      flexWrap: 'wrap',
                    }}
                  >
                    <span>{shortHash}</span>
                    <span>·</span>
                    <span>{commit.author}</span>
                    <span>·</span>
                    <span>{formatDate(commit.date)}</span>
                    {commit.aiProvider && (
                      <span
                        style={{
                          padding: '1px 6px',
                          borderRadius: 999,
                          background: 'var(--surface-3)',
                          color: 'var(--text-secondary)',
                        }}
                      >
                        {PROVIDER_LABELS[commit.aiProvider]}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {isOpen && (
              <div
                style={{
                  padding: '4px 12px 10px 32px',
                  background: 'var(--surface-1)',
                  fontSize: 11,
                  color: 'var(--text-secondary)',
                }}
              >
                {!det && <div style={{ color: 'var(--text-muted)', padding: '6px 0' }}>Loading…</div>}
                {det && (
                  <>
                    {det.message && det.message.split('\n').length > 1 && (
                      <pre
                        style={{
                          margin: '4px 0 8px',
                          padding: '6px 8px',
                          background: 'var(--surface-2)',
                          border: '1px solid var(--border-hairline)',
                          borderRadius: 3,
                          fontSize: 11,
                          color: 'var(--text-secondary)',
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-word',
                          fontFamily: 'inherit',
                        }}
                      >
                        {det.message}
                      </pre>
                    )}
                    <div style={{ color: 'var(--text-muted)', marginBottom: 4 }}>
                      {det.files.length} file{det.files.length === 1 ? '' : 's'} changed
                    </div>
                    {det.files.map((f) => {
                      const key = `${commit.hash}:${f.path}`;
                      const fileOpen = openFile === key;
                      const diff = fileDiffs[key];
                      return (
                        <div key={f.path}>
                          <div
                            onClick={() => toggleFile(commit.hash, f.path)}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 6,
                              padding: '2px 0',
                              fontSize: 11,
                              cursor: 'pointer',
                            }}
                            title={f.path}
                          >
                            {fileOpen ? (
                              <ChevronDown size={11} color="var(--text-muted)" style={{ flexShrink: 0 }} />
                            ) : (
                              <ChevronRight size={11} color="var(--text-muted)" style={{ flexShrink: 0 }} />
                            )}
                            <FileText size={11} color="var(--text-muted)" style={{ flexShrink: 0 }} />
                            <span
                              style={{
                                flex: 1,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                                color: 'var(--text)',
                              }}
                            >
                              {f.path}
                            </span>
                            {f.additions > 0 && <span style={{ color: 'var(--green)' }}>+{f.additions}</span>}
                            {f.deletions > 0 && <span style={{ color: 'var(--red)' }}>-{f.deletions}</span>}
                          </div>
                          {fileOpen && (
                            <div
                              style={{
                                margin: '2px 0 6px',
                                background: 'var(--surface-2)',
                                border: '1px solid var(--border-hairline)',
                                borderRadius: 3,
                                fontFamily: "'JetBrains Mono', monospace",
                                fontSize: 10.5,
                                lineHeight: 1.6,
                                overflowX: 'auto',
                              }}
                            >
                              {diff === 'loading' && (
                                <div style={{ padding: '6px 8px', color: 'var(--text-muted)' }}>Loading diff…</div>
                              )}
                              {diff && diff !== 'loading' && diff.length === 0 && (
                                <div style={{ padding: '6px 8px', color: 'var(--text-muted)' }}>
                                  No textual diff
                                </div>
                              )}
                              {diff &&
                                diff !== 'loading' &&
                                diff.slice(0, MAX_DIFF_LINES).map((line, li) => (
                                  <div
                                    key={li}
                                    style={{
                                      padding: '0 8px',
                                      whiteSpace: 'pre',
                                      background:
                                        line.type === '+'
                                          ? 'rgba(63,185,80,0.15)'
                                          : line.type === '-'
                                          ? 'rgba(248,81,73,0.15)'
                                          : 'transparent',
                                      color:
                                        line.type === '+'
                                          ? 'var(--green)'
                                          : line.type === '-'
                                          ? 'var(--red)'
                                          : 'var(--text-muted)',
                                    }}
                                  >
                                    {line.type}
                                    {line.text}
                                  </div>
                                ))}
                              {diff && diff !== 'loading' && diff.length > MAX_DIFF_LINES && (
                                <div style={{ padding: '2px 8px', color: 'var(--text-muted)', fontSize: 10 }}>
                                  … {diff.length - MAX_DIFF_LINES} more lines
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}

      {!reachedEnd && !query.trim() && (
        <div style={{ padding: '8px 12px', display: 'flex', justifyContent: 'center' }}>
          <button
            disabled={loading}
            onClick={() => setCount((c) => c + PAGE_SIZE)}
            style={{
              background: 'var(--surface-4)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 3,
              padding: '4px 12px',
              fontSize: 11,
              color: 'var(--text-secondary)',
              cursor: loading ? 'default' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            {loading && <RefreshCw size={11} className="spin" />}
            {loading ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}
    </div>
  );
}
