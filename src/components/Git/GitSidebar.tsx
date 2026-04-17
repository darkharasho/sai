import { useEffect, useState, useCallback } from 'react';
import { GitFile, GitCommit } from '../../types';
import ChangedFiles from './ChangedFiles';
import CommitBox from './CommitBox';
import GitActivity from './GitActivity';
import DiscardChangesModal from './DiscardChangesModal';

interface GitStatusItem {
  path: string;
  status: string;
}

interface GitStatus {
  branch: string;
  staged: GitStatusItem[];
  modified: GitStatusItem[];
  created: GitStatusItem[];
  deleted: GitStatusItem[];
  not_added: GitStatusItem[];
  ahead: number;
  behind: number;
}

interface GitSidebarProps {
  projectPath: string;
  onFileClick: (file: GitFile) => void;
  commitMessageProvider?: 'claude' | 'codex' | 'gemini';
}

function getPath(item: GitStatusItem | string): string {
  return typeof item === 'string' ? item : item.path;
}

function parseStatus(status: GitStatus): { staged: GitFile[]; unstaged: GitFile[] } {
  const staged: GitFile[] = [
    ...(status.staged ?? []).map((p) => ({ path: getPath(p), status: 'modified' as const, staged: true })),
  ];

  const stagedPaths = new Set(staged.map((f) => f.path));

  const unstaged: GitFile[] = [];
  for (const p of status.modified ?? []) {
    const path = getPath(p);
    if (!stagedPaths.has(path)) unstaged.push({ path, status: 'modified', staged: false });
  }
  for (const p of status.created ?? []) {
    const path = getPath(p);
    if (!stagedPaths.has(path)) unstaged.push({ path, status: 'added', staged: false });
  }
  for (const p of status.deleted ?? []) {
    const path = getPath(p);
    if (!stagedPaths.has(path)) unstaged.push({ path, status: 'deleted', staged: false });
  }
  for (const p of status.not_added ?? []) {
    const path = getPath(p);
    if (!stagedPaths.has(path)) unstaged.push({ path, status: 'added', staged: false });
  }

  return { staged, unstaged };
}

export default function GitSidebar({ projectPath, onFileClick, commitMessageProvider }: GitSidebarProps) {
  const [branch, setBranch] = useState('');
  const [ahead, setAhead] = useState(0);
  const [behind, setBehind] = useState(0);
  const [stagedFiles, setStagedFiles] = useState<GitFile[]>([]);
  const [unstagedFiles, setUnstagedFiles] = useState<GitFile[]>([]);
  const [commits, setCommits] = useState<GitCommit[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [discardTarget, setDiscardTarget] = useState<GitFile | null>(null);

  const refresh = useCallback(async () => {
    if (!projectPath) return;
    try {
      const [status, log] = await Promise.all([
        window.sai.gitStatus(projectPath) as Promise<GitStatus>,
        window.sai.gitLog(projectPath, 20) as Promise<GitCommit[]>,
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
    await window.sai.gitStage(projectPath, file.path);
    await refresh();
  };

  const handleStageAll = async () => {
    for (const file of unstagedFiles) {
      await window.sai.gitStage(projectPath, file.path);
    }
    await refresh();
  };

  const handleUnstage = async (file: GitFile) => {
    await window.sai.gitUnstage(projectPath, file.path);
    await refresh();
  };

  const handleDiscard = async () => {
    if (!discardTarget) return;
    if (discardTarget.staged) {
      await window.sai.gitUnstage(projectPath, discardTarget.path);
    }
    await (window.sai as any).gitDiscard(projectPath, discardTarget.path);
    setDiscardTarget(null);
    await refresh();
  };

  const handleCommit = async (message: string) => {
    // Auto-stage all changes before committing (like VS Code)
    if (unstagedFiles.length > 0) {
      for (const file of unstagedFiles) {
        await window.sai.gitStage(projectPath, file.path);
      }
    }
    await window.sai.gitCommit(projectPath, message);
    await refresh();
  };

  const handlePush = async () => {
    await window.sai.gitPush(projectPath);
    await refresh();
  };

  const handlePull = async () => {
    await window.sai.gitPull(projectPath);
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
          onFileClick={onFileClick}
          onDiscard={setDiscardTarget}
          staged
          projectPath={projectPath}
        />

        <ChangedFiles
          title="Changes"
          files={unstagedFiles}
          onAction={handleStage}
          actionLabel="+"
          onFileClick={onFileClick}
          onStageAll={handleStageAll}
          onDiscard={setDiscardTarget}
          projectPath={projectPath}
        />

        <GitActivity commits={commits} />
      </div>

      {/* Commit / push / pull controls */}
      <CommitBox
        key={projectPath}
        branch={branch}
        ahead={ahead}
        behind={behind}
        onCommit={handleCommit}
        onPush={handlePush}
        onPull={handlePull}
        onGenerateMessage={() => window.sai.claudeGenerateCommitMessage(projectPath, commitMessageProvider)}
        onListBranches={() => window.sai.gitBranches(projectPath)}
        onCheckout={async (b: string) => { await window.sai.gitCheckout(projectPath, b); await refresh(); }}
        onCreateBranch={async (name: string) => { await window.sai.gitCreateBranch(projectPath, name); await refresh(); }}
      />

      {discardTarget && (
        <DiscardChangesModal
          filePath={discardTarget.path}
          onConfirm={handleDiscard}
          onCancel={() => setDiscardTarget(null)}
        />
      )}
    </div>
  );
}
