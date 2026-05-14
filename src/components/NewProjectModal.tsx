import { useState, useEffect, useCallback } from 'react';
import { FolderPlus, Sparkles, Settings2 } from 'lucide-react';
import SetupTab from './NewProjectModal/SetupTab';
import BrainstormTab from './NewProjectModal/BrainstormTab';
import { useBrainstorm } from './NewProjectModal/useBrainstorm';

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

type Tab = 'setup' | 'brainstorm';

function TabButton({ active, onClick, label, icon }: { active: boolean; onClick: () => void; label: string; icon?: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="sai-new-project-tab"
      data-active={active ? 'true' : 'false'}
      style={{
        background: 'none', border: 'none', padding: '9px 14px',
        fontSize: 12, fontWeight: active ? 600 : 500,
        letterSpacing: '0.02em',
        color: active ? 'var(--accent)' : 'var(--text-muted)',
        borderBottom: `2px solid ${active ? 'var(--accent)' : 'transparent'}`,
        marginBottom: -1, cursor: 'pointer',
        display: 'flex', alignItems: 'center', gap: 6,
        transition: 'color 120ms ease',
      }}
    >
      {icon}
      {label}
    </button>
  );
}

const replaceBtnStyle: React.CSSProperties = {
  background: 'var(--bg-secondary)',
  border: '1px solid var(--border)',
  color: 'var(--text)',
  fontSize: 11, padding: '4px 10px', borderRadius: 4, cursor: 'pointer',
  fontFamily: 'system-ui, sans-serif',
  transition: 'border-color 120ms ease, color 120ms ease',
};

const replaceBtnPrimaryStyle: React.CSSProperties = {
  ...replaceBtnStyle,
  border: '1px solid var(--accent)',
  color: 'var(--accent)',
  background: 'rgba(199,145,12,0.12)',
};

export default function NewProjectModal({ onClose, onCreated }: NewProjectModalProps) {
  const [tab, setTab] = useState<Tab>('setup');

  // Existing state — preserved exactly
  const [parentDir, setParentDir] = useState('');
  const [projectName, setProjectName] = useState('');
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

  // Brainstorm state
  const [brainstormTranscript, setBrainstormTranscript] = useState('');
  const [nameFromBrainstorm, setNameFromBrainstorm] = useState(false);
  const [contextFromBrainstorm, setContextFromBrainstorm] = useState(false);
  const [synthesizing, setSynthesizing] = useState(false);
  const [synthesizeError, setSynthesizeError] = useState<string | null>(null);
  const [pushedBack, setPushedBack] = useState(false);
  const [replacePrompt, setReplacePrompt] = useState<null | { projectName: string; context: string; transcript: string }>(null);

  const brainstorm = useBrainstorm(tab === 'brainstorm' || brainstormTranscript !== '');

  // Existing effects — preserved exactly
  useEffect(() => {
    window.sai.githubGetUser().then((u: GitHubUser | null) => setGithubUser(u));
  }, []);

  useEffect(() => {
    const onAuthComplete = (user: GitHubUser) => setGithubUser(user);
    const unsub = window.sai.githubOnAuthComplete(onAuthComplete);
    return unsub;
  }, []);

  // Load default project directory on mount
  useEffect(() => {
    window.sai.settingsGet('defaultProjectDir', '').then((v: string) => {
      if (v) setParentDir(v);
    });
  }, []);

  useEffect(() => {
    if (!repoNameEdited) setRepoName(projectName);
  }, [projectName, repoNameEdited]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  // Existing handlers — preserved exactly
  const handleBrowseParent = useCallback(async () => {
    const folder = await window.sai.selectFolder(parentDir || undefined);
    if (folder) setParentDir(folder);
  }, [parentDir]);

  const handleConnectGitHub = useCallback(async () => {
    await window.sai.githubStartAuth();
  }, []);

  const toggleHelper = useCallback((key: keyof typeof DEFAULT_HELPERS) => {
    setHelpers(prev => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const handleCreate = useCallback(async () => {
    const computedPath = parentDir && projectName
      ? parentDir.replace(/\/+$/, '') + '/' + projectName.trim()
      : '';
    if (!computedPath) return;
    setCreating(true);
    setError('');
    setWarnings([]);

    let result: any;
    try {
      result = await window.sai.scaffoldProject({
        path: computedPath,
        context,
        helpers,
        github: helpers.githubRepo ? { repoName, visibility } : undefined,
        brainstormTranscript: brainstormTranscript || undefined,
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
      setCreatedPath(computedPath);
      return;
    }
    onCreated(computedPath);
  }, [parentDir, projectName, context, helpers, repoName, visibility, onCreated, brainstormTranscript]);

  // Brainstorm handlers
  const handleUseThis = useCallback(async (opts?: { force?: boolean }) => {
    setSynthesizing(true);
    setSynthesizeError(null);
    const r = await brainstorm.synthesize(opts);
    setSynthesizing(false);
    if (!r.ok) {
      if (r.needsClarification) {
        // The clarifying question was already pushed into the brainstorm
        // transcript by the hook. Stay on the Brainstorm tab so the user
        // can answer it — and surface a "Use anyway" escape hatch.
        setPushedBack(true);
        return;
      }
      setSynthesizeError("Couldn't summarize — try sending one more message clarifying the goal");
      return;
    }
    setPushedBack(false);
    const nameAlreadyFilled = projectName.trim().length > 0;
    const contextAlreadyFilled = context.trim().length > 0;
    if (nameAlreadyFilled || contextAlreadyFilled) {
      setReplacePrompt({ projectName: r.projectName, context: r.context, transcript: r.transcript });
      setTab('setup');
      return;
    }
    setProjectName(r.projectName);
    setContext(r.context);
    setBrainstormTranscript(r.transcript);
    setNameFromBrainstorm(true);
    setContextFromBrainstorm(true);
    setTab('setup');
  }, [brainstorm, projectName, context]);

  const acceptReplace = useCallback((which: 'name' | 'context' | 'both') => {
    if (!replacePrompt) return;
    if (which === 'name' || which === 'both') { setProjectName(replacePrompt.projectName); setNameFromBrainstorm(true); }
    if (which === 'context' || which === 'both') { setContext(replacePrompt.context); setContextFromBrainstorm(true); }
    setBrainstormTranscript(replacePrompt.transcript);
    setReplacePrompt(null);
  }, [replacePrompt]);

  return (
    <div
      className="sai-overlay-in"
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(2px)' }}
    >
      <div
        className="sai-modal-in"
        onClick={e => e.stopPropagation()}
        style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 10, padding: '24px 28px', width: 520, boxShadow: '0 8px 32px rgba(0,0,0,0.6)', display: 'flex', flexDirection: 'column', gap: 16 }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <FolderPlus size={15} color="var(--accent)" />
          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>New Project</span>
        </div>

        {/* Tab bar */}
        <div style={{ display: 'flex', gap: 2, borderBottom: '1px solid var(--border)', margin: '0 -4px' }}>
          <TabButton active={tab === 'setup'} onClick={() => setTab('setup')} icon={<Settings2 size={12} />} label="Setup" />
          <TabButton active={tab === 'brainstorm'} onClick={() => setTab('brainstorm')} icon={<Sparkles size={12} />} label="Brainstorm" />
        </div>

        {tab === 'setup' ? (
          <>
            {replacePrompt && (
              <div style={{
                fontSize: 12,
                background: 'rgba(199,145,12,0.06)',
                border: '1px solid rgba(199,145,12,0.25)',
                borderRadius: 6,
                padding: 12,
                display: 'flex', flexDirection: 'column', gap: 10,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text)' }}>
                  <Sparkles size={13} color="var(--accent)" />
                  <span>Replace your typed values with brainstorm results?</span>
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <button onClick={() => acceptReplace('both')} style={replaceBtnPrimaryStyle}>Replace both</button>
                  <button onClick={() => acceptReplace('name')} style={replaceBtnStyle}>Name only</button>
                  <button onClick={() => acceptReplace('context')} style={replaceBtnStyle}>Context only</button>
                  <button onClick={() => setReplacePrompt(null)} style={replaceBtnStyle}>Keep mine</button>
                </div>
              </div>
            )}
            <SetupTab
              parentDir={parentDir} setParentDir={setParentDir}
              projectName={projectName} setProjectName={setProjectName}
              context={context} setContext={setContext}
              helpers={helpers} toggleHelper={toggleHelper}
              githubUser={githubUser}
              repoName={repoName} setRepoName={setRepoName}
              setRepoNameEdited={setRepoNameEdited}
              visibility={visibility} setVisibility={setVisibility}
              error={error} warnings={warnings}
              handleBrowseParent={handleBrowseParent}
              handleConnectGitHub={handleConnectGitHub}
              nameFromBrainstorm={nameFromBrainstorm}
              contextFromBrainstorm={contextFromBrainstorm}
              onClearNameBadge={() => setNameFromBrainstorm(false)}
              onClearContextBadge={() => setContextFromBrainstorm(false)}
            />
          </>
        ) : (
          <BrainstormTab
            messages={brainstorm.messages}
            streamingText={brainstorm.streamingText}
            isStreaming={brainstorm.isStreaming}
            error={brainstorm.error}
            startError={brainstorm.startError}
            onSend={(text) => { setPushedBack(false); brainstorm.send(text); }}
          />
        )}

        {synthesizeError && tab === 'brainstorm' && (
          <div style={{ fontSize: 11, color: '#f87171' }}>{synthesizeError}</div>
        )}

        {/* Footer */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 13, cursor: 'pointer', padding: '7px 12px', borderRadius: 5 }}
          >
            Cancel
          </button>
          {tab === 'brainstorm' ? (
            <>
              {pushedBack && (
                <button
                  onClick={() => handleUseThis({ force: true })}
                  disabled={synthesizing}
                  title="Skip the clarifying question and create the project with what's been said"
                  style={{
                    background: 'none',
                    border: '1px solid var(--border)',
                    color: 'var(--text-muted)',
                    borderRadius: 5, padding: '7px 12px', fontSize: 12,
                    cursor: synthesizing ? 'not-allowed' : 'pointer',
                    display: 'flex', alignItems: 'center', gap: 6,
                  }}
                >
                  Use anyway →
                </button>
              )}
            <button
              onClick={() => handleUseThis()}
              disabled={!brainstorm.hasReply || synthesizing}
              style={{
                background: 'none',
                border: `1px solid ${brainstorm.hasReply && !synthesizing ? 'var(--accent)' : 'var(--border)'}`,
                color: brainstorm.hasReply && !synthesizing ? 'var(--accent)' : 'var(--text-muted)',
                borderRadius: 5, padding: '7px 16px', fontSize: 13,
                cursor: brainstorm.hasReply && !synthesizing ? 'pointer' : 'not-allowed',
                display: 'flex', alignItems: 'center', gap: 6,
              }}
            >
              <Sparkles size={13} />
              {synthesizing ? 'Synthesizing…' : 'Use this →'}
            </button>
            </>
          ) : (
            createdPath ? (
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
                disabled={!parentDir || !projectName.trim() || creating}
                style={{
                  background: 'none', border: `1px solid ${parentDir && projectName.trim() && !creating ? 'var(--accent)' : 'var(--border)'}`,
                  color: parentDir && projectName.trim() && !creating ? 'var(--accent)' : 'var(--text-muted)',
                  borderRadius: 5, padding: '7px 16px', fontSize: 13, cursor: parentDir && projectName.trim() && !creating ? 'pointer' : 'not-allowed',
                  display: 'flex', alignItems: 'center', gap: 6,
                }}
              >
                <FolderPlus size={13} />
                {creating ? 'Creating…' : 'Create Project'}
              </button>
            )
          )}
        </div>
      </div>
    </div>
  );
}
