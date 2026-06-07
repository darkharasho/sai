import React from 'react';

interface GitHubUser {
  login: string;
}

type Helpers = {
  claudeMd: boolean;
  gitInit: boolean;
  gitignore: boolean;
  readme: boolean;
  claudeSettings: boolean;
  githubRepo: boolean;
};

interface SetupTabProps {
  parentDir: string;
  setParentDir: (v: string) => void;
  projectName: string;
  setProjectName: (v: string) => void;
  context: string;
  setContext: (v: string) => void;
  helpers: Helpers;
  toggleHelper: (k: keyof Helpers) => void;
  githubUser: GitHubUser | null;
  repoName: string;
  setRepoName: (v: string) => void;
  setRepoNameEdited: (v: boolean) => void;
  visibility: 'private' | 'public';
  setVisibility: (v: 'private' | 'public') => void;
  error: string;
  warnings: string[];
  handleBrowseParent: () => void;
  handleConnectGitHub: () => void;
  // Brainstorm prefill badges:
  nameFromBrainstorm: boolean;
  contextFromBrainstorm: boolean;
  onClearNameBadge: () => void;
  onClearContextBadge: () => void;
}

export default function SetupTab({
  parentDir, setParentDir,
  projectName, setProjectName,
  context, setContext,
  helpers, toggleHelper,
  githubUser,
  repoName, setRepoName, setRepoNameEdited,
  visibility, setVisibility,
  error, warnings,
  handleBrowseParent, handleConnectGitHub,
  nameFromBrainstorm, contextFromBrainstorm,
  onClearNameBadge, onClearContextBadge,
}: SetupTabProps) {
  const inputStyle: React.CSSProperties = {
    background: 'var(--surface-2)',
    border: '1px solid var(--border-subtle)',
    borderRadius: 5,
    padding: '7px 10px',
    fontSize: 13,
    color: 'var(--text)',
    fontFamily: "'JetBrains Mono', monospace",
    width: '100%',
    boxSizing: 'border-box',
  };

  const checkRow = (
    key: keyof Helpers,
    label: string,
    description: string,
    extra?: React.ReactNode,
  ) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--border-hairline)' }}>
        <div
          onClick={() => {
            if (key === 'githubRepo' && !githubUser) return;
            toggleHelper(key);
          }}
          style={{
            width: 15, height: 15, borderRadius: 3, flexShrink: 0, marginTop: 1,
            border: `1.5px solid ${helpers[key] ? 'var(--accent)' : 'var(--border-subtle)'}`,
            background: helpers[key] ? 'var(--accent)' : 'var(--surface-2)',
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
    <div style={{ marginLeft: 25, marginBottom: 4, padding: 10, background: 'var(--surface-2)', borderRadius: 5, border: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column', gap: 8 }}>
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
                border: `1px solid ${visibility === v ? 'var(--accent)' : 'var(--border-subtle)'}`,
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
    <>
      {/* Parent directory */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Parent directory</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            value={parentDir}
            onChange={e => setParentDir(e.target.value)}
            placeholder="/home/user/projects"
            style={{ ...inputStyle, flex: 1 }}
          />
          <button
            onClick={handleBrowseParent}
            style={{ background: 'var(--surface-2)', border: '1px solid var(--border-subtle)', borderRadius: 5, padding: '7px 12px', fontSize: 12, color: 'var(--text-secondary)', cursor: 'pointer', whiteSpace: 'nowrap' }}
          >
            Browse
          </button>
        </div>
      </div>

      {/* Project name */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
          Project name
          {nameFromBrainstorm && (
            <span style={{ fontSize: 10, color: 'var(--accent)', marginLeft: 6, textTransform: 'none', letterSpacing: 0 }}>✨ from brainstorm</span>
          )}
        </span>
        <input
          value={projectName}
          onChange={e => { setProjectName(e.target.value); onClearNameBadge(); }}
          placeholder="my-app"
          style={inputStyle}
          autoFocus
        />
        {parentDir && projectName && (
          <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: "'JetBrains Mono', monospace" }}>
            → {parentDir.replace(/\/+$/, '')}/{projectName.trim()}
          </span>
        )}
      </div>

      {/* Context */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
          Context <span style={{ textTransform: 'none', letterSpacing: 0, color: 'var(--text-muted)' }}>— optional</span>
          {contextFromBrainstorm && (
            <span style={{ fontSize: 10, color: 'var(--accent)', marginLeft: 6, textTransform: 'none', letterSpacing: 0 }}>✨ from brainstorm</span>
          )}
        </span>
        <textarea
          value={context}
          onChange={e => { setContext(e.target.value); onClearContextBadge(); }}
          placeholder="What is this project for? e.g. 'A CLI tool for processing CSV files.'"
          rows={3}
          style={{ ...inputStyle, fontFamily: 'inherit', resize: 'vertical', lineHeight: 1.5 }}
        />
      </div>

      {/* Divider */}
      <div style={{ height: 1, background: 'var(--border-hairline)' }} />

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
    </>
  );
}
