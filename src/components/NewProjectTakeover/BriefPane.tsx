// src/components/NewProjectTakeover/BriefPane.tsx
import { useState, useRef } from 'react';
import { Sparkles, FolderPlus, ChevronRight, ChevronDown } from 'lucide-react';
import type { ProjectBriefView } from './useBrainstormBrief';

export interface SetupState {
  parentDir: string;
  helpers: { claudeMd: boolean; gitInit: boolean; gitignore: boolean; readme: boolean; claudeSettings: boolean; githubRepo: boolean };
  repoName: string;
  visibility: 'private' | 'public';
  githubUser: { login: string } | null;
}

export interface BriefPaneProps {
  brief: ProjectBriefView;
  onEditBrief(patch: Partial<ProjectBriefView>): Promise<{ ok: boolean; error?: string }>;
  setup: SetupState;
  onSetupChange(next: Partial<SetupState>): void;
  onBrowseParent(): void;
  onConnectGitHub(): void;
  onCreate(): void;
  creating: boolean;
  createError: string;
  warnings: string[];
  createdPath: string;
  onOpenProject(): void;
}

// ─── Shared styles ───────────────────────────────────────────────────────────

const sectionLabel: React.CSSProperties = {
  fontSize: 10,
  letterSpacing: 1.2,
  textTransform: 'uppercase',
  color: 'var(--text-muted)',
  marginBottom: 5,
  display: 'block',
};

const cardBase: React.CSSProperties = {
  background: 'var(--surface-3)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 9,
  padding: '10px 12px',
  cursor: 'pointer',
  transition: 'border-color 120ms ease',
};

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

// ─── EditableText ─────────────────────────────────────────────────────────────

interface EditableTextProps {
  testId: string;
  value: string;
  placeholder: string;
  mono?: boolean;
  multiline?: boolean;
  commit(v: string): Promise<{ ok: boolean; error?: string }>;
}

function EditableText({ testId, value, placeholder, mono, multiline, commit }: EditableTextProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [err, setErr] = useState('');
  const settled = useRef(false);

  const start = () => { settled.current = false; setDraft(value); setErr(''); setEditing(true); };
  const doCommit = async () => {
    if (settled.current) return;
    settled.current = true;
    const r = await commit(draft);
    if (r.ok) setEditing(false);
    else { settled.current = false; setErr(r.error ?? 'Invalid value'); }
  };
  const cancel = () => { settled.current = true; setEditing(false); };

  if (!editing) {
    return (
      <div
        data-testid={testId}
        style={{
          ...cardBase,
          fontFamily: mono ? "'JetBrains Mono', monospace" : undefined,
          color: value ? (mono ? 'var(--accent)' : 'var(--text)') : 'var(--text-muted)',
        }}
        onClick={start}
      >
        {value || placeholder}
      </div>
    );
  }

  const sharedInputProps = {
    value: draft,
    autoFocus: true,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft(e.target.value),
    onBlur: doCommit,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !multiline) { e.preventDefault(); void doCommit(); }
      if (e.key === 'Escape') cancel();
    },
    style: {
      ...cardBase,
      cursor: 'text',
      width: '100%',
      boxSizing: 'border-box' as const,
      font: 'inherit',
      color: 'var(--text)',
    },
  };

  return (
    <div>
      {multiline
        ? <textarea rows={3} {...sharedInputProps} />
        : <input {...sharedInputProps} />
      }
      {err && <div style={{ fontSize: 11, color: '#f87171', marginTop: 4 }}>{err}</div>}
    </div>
  );
}

// ─── EditableList ─────────────────────────────────────────────────────────────

interface EditableListProps {
  testId: string;
  items: string[];
  placeholder: string;
  dashed?: boolean;
  commit(lines: string[]): Promise<{ ok: boolean; error?: string }>;
}

function EditableList({ testId, items, placeholder, dashed, commit }: EditableListProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [err, setErr] = useState('');
  const settled = useRef(false);

  const start = () => { settled.current = false; setDraft(items.join('\n')); setErr(''); setEditing(true); };
  const doCommit = async () => {
    if (settled.current) return;
    settled.current = true;
    const lines = draft.split('\n').filter(Boolean);
    const r = await commit(lines);
    if (r.ok) setEditing(false);
    else { settled.current = false; setErr(r.error ?? 'Invalid value'); }
  };
  const cancel = () => { settled.current = true; setEditing(false); };

  if (!editing) {
    return (
      <div
        data-testid={testId}
        style={{
          ...cardBase,
          borderStyle: dashed ? 'dashed' : 'solid',
          color: items.length ? 'var(--text)' : 'var(--text-muted)',
        }}
        onClick={start}
      >
        {items.length > 0
          ? items.map((item, i) => <div key={i}>{item}</div>)
          : placeholder
        }
      </div>
    );
  }

  return (
    <div>
      <textarea
        data-testid={testId}
        rows={4}
        value={draft}
        autoFocus
        onChange={e => setDraft(e.target.value)}
        onBlur={doCommit}
        onKeyDown={e => {
          if (e.key === 'Escape') cancel();
        }}
        style={{
          ...cardBase,
          cursor: 'text',
          width: '100%',
          boxSizing: 'border-box',
          font: 'inherit',
          color: 'var(--text)',
        }}
      />
      {err && <div style={{ fontSize: 11, color: '#f87171', marginTop: 4 }}>{err}</div>}
    </div>
  );
}

// ─── SetupDisclosure ──────────────────────────────────────────────────────────

interface SetupDisclosureProps {
  setup: SetupState;
  onSetupChange(next: Partial<SetupState>): void;
  onBrowseParent(): void;
  onConnectGitHub(): void;
}

function SetupDisclosure({ setup, onSetupChange, onBrowseParent, onConnectGitHub }: SetupDisclosureProps) {
  const [expanded, setExpanded] = useState(false);
  const { helpers, parentDir, githubUser, repoName, visibility } = setup;

  // Collapsed summary line
  const summary = [
    parentDir || '—',
    `git ${helpers.gitInit ? '✓' : '✗'}`,
    `CLAUDE.md ${helpers.claudeMd ? '✓' : '✗'}`,
    `README ${helpers.readme ? '✓' : '✗'}`,
    `GitHub ${helpers.githubRepo ? '✓' : '✗'}`,
  ].join(' · ');

  const toggleHelper = (key: keyof SetupState['helpers']) => {
    if (key === 'githubRepo' && !githubUser) return;
    onSetupChange({ helpers: { ...helpers, [key]: !helpers[key] } });
  };

  const checkRow = (key: keyof SetupState['helpers'], labelText: string, description: string, extra?: React.ReactNode) => {
    const checkboxId = `setup-helper-${key}`;
    return (
      <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--border-hairline)' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, flex: 1 }}>
            <input
              type="checkbox"
              id={checkboxId}
              checked={helpers[key]}
              disabled={key === 'githubRepo' && !githubUser}
              onChange={() => toggleHelper(key)}
              style={{ marginTop: 2, cursor: key === 'githubRepo' && !githubUser ? 'not-allowed' : 'pointer' }}
            />
            <div style={{ flex: 1 }}>
              <label
                htmlFor={checkboxId}
                style={{
                  fontSize: 13,
                  color: key === 'githubRepo' && !githubUser ? 'var(--text-muted)' : 'var(--text)',
                  fontWeight: 500,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  cursor: key === 'githubRepo' && !githubUser ? 'not-allowed' : 'pointer',
                }}
              >
                {labelText}
                {key === 'githubRepo' && githubUser && (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, padding: '1px 7px', borderRadius: 3, background: '#0e2018', color: '#4caf80', border: '1px solid #1a3a28' }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#4caf80', display: 'inline-block' }} />
                    @{githubUser.login}
                  </span>
                )}
                {key === 'githubRepo' && !githubUser && (
                  <span
                    onClick={onConnectGitHub}
                    style={{ fontSize: 11, color: 'var(--accent)', cursor: 'pointer', textDecoration: 'underline' }}
                  >
                    Connect GitHub
                  </span>
                )}
              </label>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{description}</div>
            </div>
          </div>
        </div>
        {extra}
      </div>
    );
  };

  const githubSubPanel = helpers.githubRepo && githubUser ? (
    <div style={{ marginLeft: 25, marginBottom: 4, padding: 10, background: 'var(--surface-2)', borderRadius: 5, border: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 11, color: 'var(--text-muted)', width: 60, flexShrink: 0 }}>Name</span>
        <input
          value={repoName}
          onChange={e => onSetupChange({ repoName: e.target.value })}
          style={{ ...inputStyle, padding: '5px 8px', fontSize: 12 }}
        />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 11, color: 'var(--text-muted)', width: 60, flexShrink: 0 }}>Visibility</span>
        <div style={{ display: 'flex', gap: 6 }}>
          {(['private', 'public'] as const).map(v => (
            <button
              key={v}
              onClick={() => onSetupChange({ visibility: v })}
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      {/* Header row — this is the clickable toggle */}
      <div
        data-testid="setup-disclosure"
        onClick={() => setExpanded(e => !e)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          cursor: 'pointer',
          padding: '8px 0',
          userSelect: 'none',
        }}
      >
        {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        <span style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 500 }}>Setup options</span>
        {!expanded && (
          <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: "'JetBrains Mono', monospace", marginLeft: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {summary}
          </span>
        )}
      </div>

      {expanded && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingBottom: 8 }}>
          {/* Parent directory */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Parent directory</span>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                value={parentDir}
                onChange={e => onSetupChange({ parentDir: e.target.value })}
                placeholder="/home/user/projects"
                style={{ ...inputStyle, flex: 1 }}
              />
              <button
                onClick={onBrowseParent}
                style={{ background: 'var(--surface-2)', border: '1px solid var(--border-subtle)', borderRadius: 5, padding: '7px 12px', fontSize: 12, color: 'var(--text-secondary)', cursor: 'pointer', whiteSpace: 'nowrap' }}
              >
                Browse
              </button>
            </div>
          </div>

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
        </div>
      )}
    </div>
  );
}

// ─── BriefPane (default export) ───────────────────────────────────────────────

export default function BriefPane(props: BriefPaneProps): JSX.Element {
  const { brief, onEditBrief, setup, onSetupChange, onBrowseParent, onConnectGitHub, onCreate, creating, createError, warnings, createdPath, onOpenProject } = props;

  const canCreate = !!(brief.projectName && brief.summary && setup.parentDir && !creating);

  const createBtnStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    width: '100%',
    padding: '10px 16px',
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 600,
    cursor: canCreate ? 'pointer' : 'not-allowed',
    transition: 'all 120ms ease',
    border: brief.ready ? 'none' : '1px solid var(--border-subtle)',
    background: brief.ready ? 'var(--accent)' : 'var(--surface-3)',
    color: brief.ready ? '#000' : canCreate ? 'var(--text)' : 'var(--text-muted)',
    boxShadow: brief.ready ? '0 0 18px rgba(212,160,23,.25)' : 'none',
    opacity: canCreate ? 1 : 0.5,
  };

  return (
    <div
      data-testid="brief-pane"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
        padding: '20px 18px',
        height: '100%',
        overflowY: 'auto',
        boxSizing: 'border-box',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 11, letterSpacing: 1.2, textTransform: 'uppercase', color: 'var(--text-secondary)', fontWeight: 500 }}>
          Project Brief
        </span>
        {brief.ready && (
          <span
            data-testid="brief-ready-pill"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              fontSize: 11,
              padding: '2px 8px',
              borderRadius: 20,
              background: 'var(--accent-dim)',
              color: 'var(--accent)',
              fontWeight: 500,
            }}
          >
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--accent)', display: 'inline-block' }} />
            Ready
          </span>
        )}
      </div>

      {/* Name */}
      <div>
        <span style={sectionLabel}>Name</span>
        <EditableText
          testId="brief-name"
          value={brief.projectName ?? ''}
          placeholder="project-name"
          mono
          commit={async v => onEditBrief({ projectName: v })}
        />
      </div>

      {/* Summary */}
      <div>
        <span style={sectionLabel}>Summary</span>
        <EditableText
          testId="brief-summary"
          value={brief.summary ?? ''}
          placeholder="What is this project?"
          multiline
          commit={async v => onEditBrief({ summary: v })}
        />
      </div>

      {/* Goals */}
      <div>
        <span style={sectionLabel}>Goals</span>
        <EditableList
          testId="brief-goals"
          items={brief.goals}
          placeholder="—"
          commit={async lines => onEditBrief({ goals: lines })}
        />
      </div>

      {/* Out of scope / Non-goals */}
      <div>
        <span style={sectionLabel}>Out of scope</span>
        <EditableList
          testId="brief-non-goals"
          items={brief.nonGoals}
          placeholder="—"
          commit={async lines => onEditBrief({ nonGoals: lines })}
        />
      </div>

      {/* Suggested stack */}
      {brief.stack.length > 0 && (
        <div>
          <span style={sectionLabel}>Suggested stack</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {brief.stack.map((item, i) => (
              <span
                key={i}
                title={item.rationale}
                style={{
                  fontSize: 12,
                  padding: '3px 9px',
                  borderRadius: 5,
                  background: 'var(--surface-3)',
                  border: '1px solid var(--border-subtle)',
                  color: 'var(--text-secondary)',
                  fontFamily: "'JetBrains Mono', monospace",
                }}
              >
                {item.name}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Open questions — hidden when empty */}
      {brief.openQuestions.length > 0 && (
        <div>
          <span style={sectionLabel}>Open questions</span>
          <EditableList
            testId="brief-open-questions"
            items={brief.openQuestions}
            placeholder="—"
            dashed
            commit={async lines => onEditBrief({ openQuestions: lines })}
          />
        </div>
      )}

      {/* Divider */}
      <div style={{ height: 1, background: 'var(--border-hairline)' }} />

      {/* Setup disclosure */}
      <SetupDisclosure
        setup={setup}
        onSetupChange={onSetupChange}
        onBrowseParent={onBrowseParent}
        onConnectGitHub={onConnectGitHub}
      />

      {/* Warnings */}
      {warnings.length > 0 && (
        <div style={{ fontSize: 12, color: 'var(--accent)', background: 'rgba(199,145,12,0.06)', border: '1px solid rgba(199,145,12,0.2)', borderRadius: 5, padding: '8px 10px' }}>
          {warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
        </div>
      )}

      {/* Create error */}
      {createError && (
        <div style={{ fontSize: 12, color: '#f87171', background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.2)', borderRadius: 5, padding: '8px 10px' }}>
          {createError}
        </div>
      )}

      {/* Create / Open button */}
      {createdPath ? (
        <button
          data-testid="open-project-btn"
          onClick={onOpenProject}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            width: '100%',
            padding: '10px 16px',
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer',
            border: '1px solid var(--accent)',
            background: 'var(--surface-3)',
            color: 'var(--accent)',
            transition: 'all 120ms ease',
          }}
        >
          <FolderPlus size={13} />
          Open project
        </button>
      ) : (
        <button
          data-testid="create-project-btn"
          onClick={canCreate ? onCreate : undefined}
          disabled={!canCreate}
          style={createBtnStyle}
        >
          <Sparkles size={13} />
          {creating ? 'Creating…' : 'Create project'}
        </button>
      )}

      {/* Hint line */}
      <div style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', lineHeight: 1.5 }}>
        Creates the folder, seeds the first chat with this brief, and starts building
      </div>
    </div>
  );
}
