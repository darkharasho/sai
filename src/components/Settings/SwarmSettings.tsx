import { useEffect, useState } from 'react';
import type { AIProvider, ApprovalPolicy } from '../../types';

interface Props {
  onSettingChange?: (key: string, value: any) => void;
}

const PROVIDERS: { value: AIProvider; label: string }[] = [
  { value: 'claude', label: 'Claude' },
  { value: 'codex', label: 'Codex CLI' },
  { value: 'gemini', label: 'Gemini CLI' },
];

const APPROVAL_POLICIES: { value: ApprovalPolicy; label: string }[] = [
  { value: 'auto', label: 'Auto (allow all)' },
  { value: 'auto-read', label: 'Auto for reads, ask for writes' },
  { value: 'always-ask', label: 'Always ask' },
];

const DEFAULTS = {
  concurrencyCap: 5,
  defaultApprovalPolicy: 'auto-read' as ApprovalPolicy,
  orchestratorProvider: 'claude' as AIProvider,
  orchestratorModel: '',
  defaultTaskProvider: 'claude' as AIProvider,
  defaultTaskModel: '',
  worktreeRoot: '',
  notifyOnComplete: false,
  notifyOnApproval: false,
};

export default function SwarmSettings({ onSettingChange }: Props) {
  const [concurrencyCap, setConcurrencyCap] = useState<number>(DEFAULTS.concurrencyCap);
  const [defaultApprovalPolicy, setDefaultApprovalPolicy] = useState<ApprovalPolicy>(DEFAULTS.defaultApprovalPolicy);
  const [orchestratorProvider, setOrchestratorProvider] = useState<AIProvider>(DEFAULTS.orchestratorProvider);
  const [orchestratorModel, setOrchestratorModel] = useState<string>(DEFAULTS.orchestratorModel);
  const [defaultTaskProvider, setDefaultTaskProvider] = useState<AIProvider>(DEFAULTS.defaultTaskProvider);
  const [defaultTaskModel, setDefaultTaskModel] = useState<string>(DEFAULTS.defaultTaskModel);
  const [worktreeRoot, setWorktreeRoot] = useState<string>(DEFAULTS.worktreeRoot);
  const [notifyOnComplete, setNotifyOnComplete] = useState<boolean>(DEFAULTS.notifyOnComplete);
  const [notifyOnApproval, setNotifyOnApproval] = useState<boolean>(DEFAULTS.notifyOnApproval);

  useEffect(() => {
    const sai = (window as any).sai;
    if (!sai?.settingsGet) return;
    sai.settingsGet('swarm.concurrencyCap', DEFAULTS.concurrencyCap).then((v: number) => {
      if (typeof v === 'number' && !Number.isNaN(v)) setConcurrencyCap(v);
    });
    sai.settingsGet('swarm.defaultApprovalPolicy', DEFAULTS.defaultApprovalPolicy).then((v: ApprovalPolicy) => {
      if (v === 'auto' || v === 'auto-read' || v === 'always-ask') setDefaultApprovalPolicy(v);
    });
    sai.settingsGet('swarm.orchestratorProvider', DEFAULTS.orchestratorProvider).then((v: AIProvider) => {
      if (v === 'claude' || v === 'codex' || v === 'gemini') setOrchestratorProvider(v);
    });
    sai.settingsGet('swarm.orchestratorModel', DEFAULTS.orchestratorModel).then((v: string) => setOrchestratorModel(v ?? ''));
    sai.settingsGet('swarm.defaultTaskProvider', DEFAULTS.defaultTaskProvider).then((v: AIProvider) => {
      if (v === 'claude' || v === 'codex' || v === 'gemini') setDefaultTaskProvider(v);
    });
    sai.settingsGet('swarm.defaultTaskModel', DEFAULTS.defaultTaskModel).then((v: string) => setDefaultTaskModel(v ?? ''));
    sai.settingsGet('swarm.worktreeRoot', DEFAULTS.worktreeRoot).then((v: string) => setWorktreeRoot(v ?? ''));
    sai.settingsGet('swarm.notifyOnComplete', DEFAULTS.notifyOnComplete).then((v: boolean) => setNotifyOnComplete(!!v));
    sai.settingsGet('swarm.notifyOnApproval', DEFAULTS.notifyOnApproval).then((v: boolean) => setNotifyOnApproval(!!v));
  }, []);

  function persist<T>(key: string, value: T) {
    (window as any).sai?.settingsSet?.(key, value);
    onSettingChange?.(key, value);
  }

  const handleConcurrencyCap = (v: number) => {
    const n = Number.isFinite(v) && v > 0 ? Math.floor(v) : DEFAULTS.concurrencyCap;
    setConcurrencyCap(n);
    persist('swarm.concurrencyCap', n);
  };

  const handleApprovalPolicy = (v: ApprovalPolicy) => {
    setDefaultApprovalPolicy(v);
    persist('swarm.defaultApprovalPolicy', v);
  };

  const handleOrchestratorProvider = (v: AIProvider) => {
    setOrchestratorProvider(v);
    persist('swarm.orchestratorProvider', v);
  };

  const handleOrchestratorModel = (v: string) => {
    setOrchestratorModel(v);
    persist('swarm.orchestratorModel', v);
  };

  const handleDefaultTaskProvider = (v: AIProvider) => {
    setDefaultTaskProvider(v);
    persist('swarm.defaultTaskProvider', v);
  };

  const handleDefaultTaskModel = (v: string) => {
    setDefaultTaskModel(v);
    persist('swarm.defaultTaskModel', v);
  };

  const handleWorktreeRoot = (v: string) => {
    setWorktreeRoot(v);
    persist('swarm.worktreeRoot', v);
  };

  const handleNotifyOnComplete = (v: boolean) => {
    setNotifyOnComplete(v);
    persist('swarm.notifyOnComplete', v);
  };

  const handleNotifyOnApproval = (v: boolean) => {
    setNotifyOnApproval(v);
    persist('swarm.notifyOnApproval', v);
  };

  const inputStyle: React.CSSProperties = {
    width: 220,
    fontSize: 12,
    padding: '4px 8px',
    background: 'var(--surface-2)',
    border: '1px solid var(--border-subtle)',
    borderRadius: 6,
    color: 'var(--text-primary)',
  };

  return (
    <>
      <section className="settings-section">
        <div className="settings-section-label">Scheduler</div>

        <div className="settings-row">
          <div className="settings-row-info">
            <div className="settings-row-name">
              <label htmlFor="swarm-concurrency-cap">Concurrency cap</label>
            </div>
            <div className="settings-row-desc">Maximum number of swarm tasks that may stream at once per workspace</div>
          </div>
          <input
            id="swarm-concurrency-cap"
            type="number"
            min={1}
            max={32}
            className="settings-input"
            value={concurrencyCap}
            onChange={e => handleConcurrencyCap(Number(e.target.value))}
            style={{ ...inputStyle, width: 80 }}
          />
        </div>

        <div className="settings-row settings-row-spaced">
          <div className="settings-row-info">
            <div className="settings-row-name">
              <label htmlFor="swarm-approval-policy">Default approval policy</label>
            </div>
            <div className="settings-row-desc">Approval policy used for newly dispatched tasks</div>
          </div>
          <select
            id="swarm-approval-policy"
            className="settings-select"
            value={defaultApprovalPolicy}
            onChange={e => handleApprovalPolicy(e.target.value as ApprovalPolicy)}
          >
            {APPROVAL_POLICIES.map(p => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
        </div>
      </section>

      <div className="settings-divider" />

      <section className="settings-section">
        <div className="settings-section-label">Orchestrator</div>

        <div className="settings-row">
          <div className="settings-row-info">
            <div className="settings-row-name">
              <label htmlFor="swarm-orch-provider">Orchestrator provider</label>
            </div>
            <div className="settings-row-desc">AI backend that powers the swarm orchestrator chat</div>
          </div>
          <select
            id="swarm-orch-provider"
            className="settings-select"
            value={orchestratorProvider}
            onChange={e => handleOrchestratorProvider(e.target.value as AIProvider)}
          >
            {PROVIDERS.map(p => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
        </div>

        <div className="settings-row settings-row-spaced">
          <div className="settings-row-info">
            <div className="settings-row-name">
              <label htmlFor="swarm-orch-model">Orchestrator model</label>
            </div>
            <div className="settings-row-desc">Model used by the orchestrator (provider-specific identifier; leave blank for default)</div>
          </div>
          <input
            id="swarm-orch-model"
            type="text"
            className="settings-input"
            placeholder="(default)"
            value={orchestratorModel}
            onChange={e => handleOrchestratorModel(e.target.value)}
            style={inputStyle}
          />
        </div>
      </section>

      <div className="settings-divider" />

      <section className="settings-section">
        <div className="settings-section-label">Task defaults</div>

        <div className="settings-row">
          <div className="settings-row-info">
            <div className="settings-row-name">
              <label htmlFor="swarm-task-provider">Default task provider</label>
            </div>
            <div className="settings-row-desc">Provider used for new tasks unless overridden</div>
          </div>
          <select
            id="swarm-task-provider"
            className="settings-select"
            value={defaultTaskProvider}
            onChange={e => handleDefaultTaskProvider(e.target.value as AIProvider)}
          >
            {PROVIDERS.map(p => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
        </div>

        <div className="settings-row settings-row-spaced">
          <div className="settings-row-info">
            <div className="settings-row-name">
              <label htmlFor="swarm-task-model">Default task model</label>
            </div>
            <div className="settings-row-desc">Model used for new tasks (provider-specific identifier; leave blank for default)</div>
          </div>
          <input
            id="swarm-task-model"
            type="text"
            className="settings-input"
            placeholder="(default)"
            value={defaultTaskModel}
            onChange={e => handleDefaultTaskModel(e.target.value)}
            style={inputStyle}
          />
        </div>
      </section>

      <div className="settings-divider" />

      <section className="settings-section">
        <div className="settings-section-label">Worktrees</div>

        <div className="settings-row">
          <div className="settings-row-info">
            <div className="settings-row-name">
              <label htmlFor="swarm-worktree-root">Worktree root</label>
            </div>
            <div className="settings-row-desc">Root directory for swarm task worktrees. Leave blank for the default sibling location.</div>
          </div>
          <input
            id="swarm-worktree-root"
            type="text"
            className="settings-input"
            placeholder="<project>/../.sai-swarm/"
            value={worktreeRoot}
            onChange={e => handleWorktreeRoot(e.target.value)}
            style={inputStyle}
          />
        </div>
      </section>

      <div className="settings-divider" />

      <section className="settings-section">
        <div className="settings-section-label">Notifications</div>

        <div className="settings-row">
          <div className="settings-row-info">
            <div className="settings-row-name">Notify on complete</div>
            <div className="settings-row-desc">Send a desktop notification when a swarm task finishes</div>
          </div>
          <button
            id="swarm-notify-complete"
            aria-label="Notify on complete"
            className={`settings-toggle${notifyOnComplete ? ' on' : ''}`}
            onClick={() => handleNotifyOnComplete(!notifyOnComplete)}
            role="switch"
            aria-checked={notifyOnComplete}
          >
            <span className="settings-toggle-thumb" />
          </button>
        </div>

        <div className="settings-row settings-row-spaced">
          <div className="settings-row-info">
            <div className="settings-row-name">Notify on approval</div>
            <div className="settings-row-desc">Send a desktop notification when a swarm task needs approval</div>
          </div>
          <button
            id="swarm-notify-approval"
            aria-label="Notify on approval"
            className={`settings-toggle${notifyOnApproval ? ' on' : ''}`}
            onClick={() => handleNotifyOnApproval(!notifyOnApproval)}
            role="switch"
            aria-checked={notifyOnApproval}
          >
            <span className="settings-toggle-thumb" />
          </button>
        </div>
      </section>
    </>
  );
}
