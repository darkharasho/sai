import { useEffect, useState, useCallback } from 'react';
import { GitFile, GitCommit } from '../../types';
import ChangedFiles from './ChangedFiles';
import CommitBox from './CommitBox';
import ClaudeActivity from './ClaudeActivity';

interface GitStatus {
  branch: string;
  staged: string[];
  modified: string[];
  created: string[];
  deleted: string[];
  not_added: string[];
  ahead: number;
  behind: number;
}

interface GitSidebarProps {
  projectPath: string;
}

function parseStatus(status: GitStatus): { staged: GitFile[]; unstaged: GitFile[] } {
  const staged: GitFile[] = [
    ...(status.staged ?? []).map((p) => ({ path: p, status: 'modified' as const, staged: true })),
    ...(status.created ?? []).map((p) => ({ path: p, status: 'added' as const, staged: true })),
  ];

  // De-duplicate: if a path is already in staged, don't add it to unstaged
  const stagedPaths = new Set(staged.map((f) => f.path));

  const unstaged: GitFile[] = [];
  for (const p of status.modified ?? []) {
    if (!stagedPaths.has(p)) unstaged.push({ path: p, status: 'modified', staged: false });
  }
  for (const p of status.deleted ?? []) {
    if (!stagedPaths.has(p)) unstaged.push({ path: p, status: 'deleted', staged: false });
  }
  for (const p of status.not_added ?? []) {
    if (!stagedPaths.has(p)) unstaged.push({ path: p, status: 'added', staged: false });
  }

  return { staged, unstaged };
}

export default function GitSidebar({ projectPath }: GitSidebarProps) {
  const [branch, setBranch] = useState('');
  const [ahead, setAhead] = useState(0);
  const [behind, setBehind] = useState(0);
  const [stagedFiles, setStagedFiles] = useState<GitFile[]>([]);
  const [unstagedFiles, setUnstagedFiles] = useState<GitFile[]>([]);
  const [commits, setCommits] = useState<GitCommit[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!projectPath) return;
    try {
      const [status, log] = await Promise.all([
        window.vsai.gitStatus(projectPath) as Promise<GitStatus>,
        window.vsai.gitLog(projectPath, 20) as Promise<GitCommit[]>,
      ]);
      const { staged, unstaged } = parseStatus(status);
      setBranch(status.branch ?? '');
      setAhead(status.ahead ?? 0);
      setBehind(status.behind ?? 0);
      setStagedFiles(staged);
      setUnstagedFiles(unstaged);
      setCommits(log ?? []);
      setError(null);
    } catch (err: any) {
      setError(err?.message ?? 'Git error');
    }
  }, [projectPath]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 5000);
    return () => clearInterval(id);
  }, [refresh]);

  const handleStage = async (file: GitFile) => {
    await window.vsai.gitStage(projectPath, file.path);
    await refresh();
  };

  const handleUnstage = async (file: GitFile) => {
    await window.vsai.gitUnstage(projectPath, file.path);
    await refresh();
  };

  const handleCommit = async (message: string) => {
    await window.vsai.gitCommit(projectPath, message);
    await refresh();
  };

  const handlePush = async () => {
    await window.vsai.gitPush(projectPath);
    await refresh();
  };

  const handlePull = async () => {
    await window.vsai.gitPull(projectPath);
    await refresh();
  };

  const totalChanges = stagedFiles.length + unstagedFiles.length;

  return (
    <div
      style={{
        width: 'var(--sidebar-width)',
        minWidth: 'var(--sidebar-width)',
        background: 'var(--bg-secondary)',
        borderRight: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div
        style={{
          height: 36,
          display: 'flex',
          alignItems: 'center',
          padding: '0 12px',
          fontSize: 11,
          fontWeight: 600,
          textTransform: 'uppercase' as const,
          letterSpacing: '0.5px',
          color: 'var(--text-muted)',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
        }}
      >
        Source Control
        {totalChanges > 0 && (
          <span
            style={{
              marginLeft: 6,
              background: 'var(--accent)',
              color: '#000',
              borderRadius: 8,
              padding: '1px 6px',
              fontSize: 10,
              fontWeight: 700,
              lineHeight: '14px',
            }}
          >
            {totalChanges}
          </span>
        )}
      </div>

      {/* Scrollable file lists */}
      <div style={{ flex: 1, overflowY: 'auto', paddingTop: 8 }}>
        {error && (
          <div
            style={{
              margin: '8px 12px',
              padding: '6px 8px',
              background: 'var(--bg-input)',
              borderLeft: '2px solid var(--red)',
              color: 'var(--red)',
              fontSize: 11,
              borderRadius: 3,
            }}
          >
            {error}
          </div>
        )}

        {!error && totalChanges === 0 && commits.length === 0 && (
          <div
            style={{
              padding: '24px 12px',
              textAlign: 'center' as const,
              color: 'var(--text-muted)',
              fontSize: 12,
            }}
          >
            No changes
          </div>
        )}

        <ChangedFiles
          title="Staged"
          files={stagedFiles}
          onAction={handleUnstage}
          actionLabel="-"
        />

        <ChangedFiles
          title="Changes"
          files={unstagedFiles}
          onAction={handleStage}
          actionLabel="+"
        />

        <ClaudeActivity commits={commits} />
      </div>

      {/* Commit / push / pull controls */}
      <CommitBox
        branch={branch}
        ahead={ahead}
        behind={behind}
        onCommit={handleCommit}
        onPush={handlePush}
        onPull={handlePull}
      />
    </div>
  );
}
