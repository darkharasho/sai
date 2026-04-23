import { useState, useEffect, useCallback } from 'react';
import { FolderPlus } from 'lucide-react';

interface GitHubUser {
  login: string;
}

interface NewProjectModalProps {
  onClose: () => void;
  onCreated: (path: string) => void;
}

const DEFAULT_HELPERS = {
  claudeMd: true,
  gitInit: true,
  gitignore: true,
  readme: true,
  claudeSettings: false,
  githubRepo: false,
};

export default function NewProjectModal({ onClose, onCreated }: NewProjectModalProps) {
  const [dir, setDir] = useState('');
  const [context, setContext] = useState('');
  const [helpers, setHelpers] = useState(DEFAULT_HELPERS);
  const [githubUser, setGithubUser] = useState<GitHubUser | null>(null);
  const [repoName, setRepoName] = useState('');
  const [visibility, setVisibility] = useState<'private' | 'public'>('private');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [warnings, setWarnings] = useState<string[]>([]);
  const [createdPath, setCreatedPath] = useState('');
  const [repoNameEdited, setRepoNameEdited] = useState(false);

  useEffect(() => {
    window.sai.githubGetUser().then((u: GitHubUser | null) => setGithubUser(u));
  }, []);

  useEffect(() => {
    const onAuthComplete = (user: GitHubUser) => setGithubUser(user);
    const unsub = window.sai.githubOnAuthComplete(onAuthComplete);
    return unsub;
  }, []);

  useEffect(() => {
    if (!repoNameEdited && dir) setRepoName(dir.split('/').pop() || '');
  }, [dir, repoNameEdited]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const handleBrowse = useCallback(async () => {
    const folder = await window.sai.selectFolder();
    if (folder) setDir(folder);
  }, []);

  const handleConnectGitHub = useCallback(async () => {
    await window.sai.githubStartAuth();
  }, []);

  const toggleHelper = useCallback((key: keyof typeof DEFAULT_HELPERS) => {
    setHelpers(prev => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const handleCreate = useCallback(async () => {
    if (!dir) return;
    setCreating(true);
    setError('');
    setWarnings([]);

    let result: any;
    try {
      result = await window.sai.scaffoldProject({
        path: dir,
        context,
        helpers,
        github: helpers.githubRepo ? { repoName, visibility } : undefined,
      });
    } catch (e: any) {
      setCreating(false);
      setError(e?.message ?? 'Unexpected error — please try again');
      return;
    }

    setCreating(false);

    if (!result.ok) {
      setError(result.error || 'Failed to create project');
      return;
    }

    if (result.warnings?.length) {
      // Keep modal open so user can read warnings; "Continue" button calls onCreated
      setWarnings(result.warnings);
      setCreatedPath(dir);
      return;
    }
    onCreated(dir);
  }, [dir, context, helpers, repoName, visibility, onCreated]);

  const inputStyle: React.CSSProperties = {
    background: 'var(--bg-secondary)',
    border: '1px solid var(--border)',
    borderRadius: 5,
    padding: '7px 10px',
    fontSize: 13,
    color: 'var(--text)',
    fontFamily: "'JetBrains Mono', monospace",
    width: '100%',
    boxSizing: 'border-box',
  };

  const checkRow = (
    key: keyof typeof DEFAULT_HELPERS,
    label: string,
    description: string,
    extra?: React.ReactNode,
  ) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--bg-elevated)' }}>
        <div
          onClick={() => {
            if (key === 'githubRepo' && !githubUser) return;
            toggleHelper(key);
          }}
          style={{
            width: 15, height: 15, borderRadius: 3, flexShrink: 0, marginTop: 1,
            border: `1.5px solid ${helpers[key] ? 'var(--accent)' : 'var(--border)'}`,
            background: helpers[key] ? 'var(--accent)' : 'var(--bg-secondary)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: key === 'githubRepo' && !githubUser ? 'not-allowed' : 'pointer',
            opacity: key === 'githubRepo' && !githubUser ? 0.4 : 1,
          }}
        >
          {helpers[key] && (
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          )}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, color: key === 'githubRepo' && !githubUser ? 'var(--text-muted)' : 'var(--text)', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 8 }}>
            {label}
            {key === 'githubRepo' && githubUser && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, padding: '1px 7px', borderRadius: 3, background: '#0e2018', color: '#4caf80', border: '1px solid #1a3a28' }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#4caf80', display: 'inline-block' }} />
                @{githubUser.login}
              </span>
            )}
            {key === 'githubRepo' && !githubUser && (
              <span
                onClick={handleConnectGitHub}
                style={{ fontSize: 11, color: 'var(--accent)', cursor: 'pointer', textDecoration: 'underline' }}
              >
                Connect GitHub
              </span>
            )}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{description}</div>
        </div>
      </div>
      {extra}
    </div>
  );

  const githubSubPanel = helpers.githubRepo && githubUser ? (
    <div style={{ marginLeft: 25, marginBottom: 4, padding: 10, background: 'var(--bg-secondary)', borderRadius: 5, border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 11, color: 'var(--text-muted)', width: 60, flexShrink: 0 }}>Name</span>
        <input
          value={repoName}
          onChange={e => { setRepoName(e.target.value); setRepoNameEdited(true); }}
          style={{ ...inputStyle, fontFamily: "'JetBrains Mono', monospace", padding: '5px 8px', fontSize: 12 }}
        />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 11, color: 'var(--text-muted)', width: 60, flexShrink: 0 }}>Visibility</span>
        <div style={{ display: 'flex', gap: 6 }}>
          {(['private', 'public'] as const).map(v => (
            <button
              key={v}
              onClick={() => setVisibility(v)}
              style={{
                fontSize: 12, padding: '3px 10px', borderRadius: 3, cursor: 'pointer',
                border: `1px solid ${visibility === v ? 'var(--accent)' : 'var(--border)'}`,
                color: visibility === v ? 'var(--accent)' : 'var(--text-muted)',
                background: visibility === v ? 'rgba(199,145,12,0.1)' : 'transparent',
              }}
            >
              {v.charAt(0).toUpperCase() + v.slice(1)}
            </button>
          ))}
        </div>
      </div>
    </div>
  ) : null;

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(2px)' }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 10, padding: '24px 28px', width: 460, boxShadow: '0 8px 32px rgba(0,0,0,0.6)', display: 'flex', flexDirection: 'column', gap: 16 }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <FolderPlus size={15} color="var(--accent)" />
          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>New Project</span>
        </div>

        {/* Directory */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Directory</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              value={dir}
              onChange={e => setDir(e.target.value)}
              placeholder="/home/user/projects/my-app"
              style={{ ...inputStyle, flex: 1 }}
            />
            <button
              onClick={handleBrowse}
              style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 5, padding: '7px 12px', fontSize: 12, color: 'var(--text-secondary)', cursor: 'pointer', whiteSpace: 'nowrap' }}
            >
              Browse
            </button>
          </div>
        </div>

        {/* Context */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
            Context <span style={{ textTransform: 'none', letterSpacing: 0, color: 'var(--text-muted)' }}>— optional</span>
          </span>
          <textarea
            value={context}
            onChange={e => setContext(e.target.value)}
            placeholder="What is this project for? e.g. 'A CLI tool for processing CSV files.'"
            rows={3}
            style={{ ...inputStyle, fontFamily: 'system-ui, sans-serif', resize: 'vertical', lineHeight: 1.5 }}
          />
        </div>

        {/* Divider */}
        <div style={{ height: 1, background: 'var(--border)' }} />

        {/* Helpers */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          <span style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6 }}>Setup helpers</span>
          {checkRow('claudeMd', 'CLAUDE.md', 'Seeds AI memory with your project context')}
          {checkRow('gitInit', 'Git init', 'Initializes a local repo — enables the git panel immediately')}
          {checkRow('gitignore', '.gitignore', 'Common ignores: node_modules, .env, .DS_Store, dist, build')}
          {checkRow('readme', 'README.md', 'One-liner stub using your project context as the description')}
          {checkRow('claudeSettings', '.claude/settings.json', 'Empty project-level Claude settings, ready to configure')}
          {checkRow('githubRepo', 'Create GitHub repo', 'Creates a remote repo and sets it as origin', githubSubPanel)}
        </div>

        {/* Error / warnings */}
        {error && (
          <div style={{ fontSize: 12, color: '#f87171', background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.2)', borderRadius: 5, padding: '8px 10px' }}>
            {error}
          </div>
        )}
        {warnings.length > 0 && (
          <div style={{ fontSize: 12, color: 'var(--accent)', background: 'rgba(199,145,12,0.06)', border: '1px solid rgba(199,145,12,0.2)', borderRadius: 5, padding: '8px 10px' }}>
            {warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
          </div>
        )}

        {/* Footer */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 13, cursor: 'pointer', padding: '7px 12px', borderRadius: 5 }}
          >
            Cancel
          </button>
          {createdPath ? (
            <button
              onClick={() => onCreated(createdPath)}
              style={{ background: 'none', border: '1px solid var(--accent)', color: 'var(--accent)', borderRadius: 5, padding: '7px 16px', fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
            >
              <FolderPlus size={13} />
              Open Project
            </button>
          ) : (
            <button
              onClick={handleCreate}
              disabled={!dir || creating}
              style={{
                background: 'none', border: `1px solid ${dir && !creating ? 'var(--accent)' : 'var(--border)'}`,
                color: dir && !creating ? 'var(--accent)' : 'var(--text-muted)',
                borderRadius: 5, padding: '7px 16px', fontSize: 13, cursor: dir && !creating ? 'pointer' : 'not-allowed',
                display: 'flex', alignItems: 'center', gap: 6,
              }}
            >
              <FolderPlus size={13} />
              {creating ? 'Creating\u2026' : 'Create Project'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
