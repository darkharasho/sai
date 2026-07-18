// src/components/NewProjectTakeover/NewProjectTakeover.tsx
import { useState, useEffect, useCallback, useRef } from 'react';
import { Sparkles, X } from 'lucide-react';
import { useBrainstormBrief } from './useBrainstormBrief';
import ConversationPane from './ConversationPane';
import BriefPane, { type SetupState } from './BriefPane';

export interface NewProjectTakeoverProps {
  onClose(): void;
  onCreated(path: string): void;
}

const DEFAULT_HELPERS: SetupState['helpers'] = {
  claudeMd: true,
  gitInit: true,
  gitignore: true,
  readme: true,
  claudeSettings: false,
  githubRepo: false,
};

export default function NewProjectTakeover({ onClose, onCreated }: NewProjectTakeoverProps): JSX.Element {
  const bs = useBrainstormBrief();

  // Setup state
  const [setup, setSetup] = useState<SetupState>({
    parentDir: '',
    helpers: DEFAULT_HELPERS,
    repoName: '',
    visibility: 'private',
    githubUser: null,
  });

  // Create flow state
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const [warnings, setWarnings] = useState<string[]>([]);
  const [createdPath, setCreatedPath] = useState('');

  // Track whether user has manually edited repoName
  const repoNameEditedRef = useRef(false);

  // Load default parentDir from settings
  useEffect(() => {
    (window.sai as any).settingsGet('defaultProjectDir', '').then((v: string) => {
      if (v) setSetup(prev => ({ ...prev, parentDir: v }));
    });
  }, []);

  // Load GitHub user
  useEffect(() => {
    (window.sai as any).githubGetUser().then((u: { login: string } | null) => {
      setSetup(prev => ({ ...prev, githubUser: u }));
    });
    const unsub = (window.sai as any).githubOnAuthComplete((user: { login: string }) => {
      setSetup(prev => ({ ...prev, githubUser: user }));
    });
    return unsub;
  }, []);

  // Mirror brief.projectName → repoName until user edits it
  useEffect(() => {
    if (!repoNameEditedRef.current) {
      setSetup(prev => ({ ...prev, repoName: bs.brief.projectName ?? '' }));
    }
  }, [bs.brief.projectName]);

  // Escape key handler
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [bs.transcriptDirty, createdPath]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleClose = useCallback(() => {
    if (bs.transcriptDirty && !createdPath) {
      const confirmed = window.confirm('Discard this brainstorm? The brief and conversation will be lost.');
      if (!confirmed) return;
    }
    onClose();
  }, [bs.transcriptDirty, createdPath, onClose]);

  const handleSetupChange = useCallback((next: Partial<SetupState>) => {
    if ('repoName' in next) {
      repoNameEditedRef.current = true;
    }
    setSetup(prev => ({ ...prev, ...next }));
  }, []);

  const handleBrowseParent = useCallback(async () => {
    const folder = await (window.sai as any).selectFolder(setup.parentDir || undefined);
    if (folder) setSetup(prev => ({ ...prev, parentDir: folder }));
  }, [setup.parentDir]);

  const handleConnectGitHub = useCallback(async () => {
    await (window.sai as any).githubStartAuth();
  }, []);

  const handleCreate = useCallback(async () => {
    const name = bs.brief.projectName;
    if (!name || !setup.parentDir) return;
    const computedPath = setup.parentDir.replace(/\/+$/, '') + '/' + name;
    setCreating(true);
    setCreateError('');
    setWarnings([]);

    let result: any;
    try {
      result = await (window.sai as any).scaffoldProject({
        path: computedPath,
        context: bs.brief.summary ?? '',
        helpers: setup.helpers,
        github: setup.helpers.githubRepo ? { repoName: setup.repoName, visibility: setup.visibility } : undefined,
        brief: bs.brief,
        brainstormTranscript: bs.messages.map(m => `**${m.role === 'user' ? 'User' : 'Assistant'}:** ${m.content}`).join('\n\n') || undefined,
      });
    } catch (e: any) {
      setCreating(false);
      setCreateError(e?.message ?? 'Unexpected error — please try again');
      return;
    }

    setCreating(false);
    if (!result.ok) {
      setCreateError(result.error || 'Failed to create project');
      return;
    }
    if (result.warnings?.length) {
      setWarnings(result.warnings);
      setCreatedPath(computedPath);
      return;
    }
    onCreated(computedPath);   // App's handleProjectSwitch opens the project; ChatPanel auto-sends the seed
  }, [bs.brief, bs.messages, setup, onCreated]);

  return (
    <div
      className="sai-overlay-in"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        background: 'var(--surface-1, #0d1117)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '13px 18px',
        borderBottom: '1px solid var(--border-subtle)',
        flexShrink: 0,
      }}>
        <Sparkles size={15} color="var(--accent)" style={{ opacity: 0.85 }} />
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>New Project</span>
        <span style={{ fontSize: 11.5, color: 'var(--text-muted)', marginLeft: 2 }}>
          brainstorm → brief → create
        </span>
        <div style={{ flex: 1 }} />
        <button
          onClick={handleClose}
          aria-label="Close"
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--text-muted)',
            padding: 4,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 4,
          }}
        >
          <X size={15} />
        </button>
      </div>

      {/* Main two-pane row */}
      <main style={{
        flex: 1,
        display: 'flex',
        overflow: 'hidden',
      }}>
        {/* Conversation pane */}
        <div style={{
          flex: 1.4,
          borderRight: '1px solid var(--border-subtle)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}>
          <ConversationPane
            messages={bs.messages}
            streamingText={bs.streamingText}
            isStreaming={bs.isStreaming}
            error={bs.error}
            questionCount={bs.questionCount}
            briefReady={bs.brief.ready}
            onSend={bs.send}
          />
        </div>

        {/* Brief pane */}
        <div style={{
          flex: 1,
          minWidth: 380,
          maxWidth: 480,
          background: 'var(--surface-2)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}>
          <BriefPane
            brief={bs.brief}
            onEditBrief={bs.editBrief}
            setup={setup}
            onSetupChange={handleSetupChange}
            onBrowseParent={handleBrowseParent}
            onConnectGitHub={handleConnectGitHub}
            onCreate={handleCreate}
            creating={creating}
            createError={createError}
            warnings={warnings}
            createdPath={createdPath}
            onOpenProject={() => {
              if (createdPath) onCreated(createdPath);
            }}
          />
        </div>
      </main>
    </div>
  );
}
