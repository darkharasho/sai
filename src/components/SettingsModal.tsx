import { useState, useEffect, useRef } from 'react';
import { X, Check, ChevronDown } from 'lucide-react';

interface Props {
  onClose: () => void;
  onSettingChange?: (key: string, value: any) => void;
  onOpenWhatsNew?: () => void;
}

const TIMEOUT_OPTIONS = [
  { label: '5 minutes',  value: 5 * 60 * 1000 },
  { label: '15 minutes', value: 15 * 60 * 1000 },
  { label: '30 minutes', value: 30 * 60 * 1000 },
  { label: '1 hour',     value: 60 * 60 * 1000 },
  { label: '2 hours',    value: 2 * 60 * 60 * 1000 },
  { label: '4 hours',    value: 4 * 60 * 60 * 1000 },
  { label: 'Never',      value: 0 },
];

const DEFAULT_TIMEOUT = 60 * 60 * 1000;
const FONT_SIZES = [11, 12, 13, 14, 15, 16, 18, 20];

const AUTO_COMPACT_OPTIONS = [
  { label: 'Off',  value: 0 },
  { label: '30%',  value: 30 },
  { label: '40%',  value: 40 },
  { label: '50%',  value: 50 },
  { label: '60%',  value: 60 },
  { label: '70%',  value: 70 },
  { label: '80%',  value: 80 },
];

type SyncStatus = 'idle' | 'syncing' | 'synced' | 'error';

function formatRelative(ts: number): string {
  const secs = Math.floor((Date.now() - ts) / 1000);
  if (secs < 10) return 'just now';
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ago`;
}

const PROVIDER_OPTIONS: { id: 'claude' | 'codex' | 'gemini'; label: string; svg: string; color: string }[] = [
  { id: 'claude', label: 'Claude', svg: 'svg/claude.svg', color: '#e27b4a' },
  { id: 'codex', label: 'Codex CLI', svg: 'svg/openai.svg', color: '#fff' },
  { id: 'gemini', label: 'Gemini CLI', svg: 'svg/Google-gemini-icon.svg', color: '#4285f4' },
];

export default function SettingsModal({ onClose, onSettingChange, onOpenWhatsNew }: Props) {
  const [suspendTimeout, setSuspendTimeout] = useState<number>(DEFAULT_TIMEOUT);
  const [editorFontSize, setEditorFontSize] = useState(13);
  const [editorMinimap, setEditorMinimap] = useState(true);
  const [aiProvider, setAiProvider] = useState<'claude' | 'codex' | 'gemini'>('claude');
  const [providerOpen, setProviderOpen] = useState(false);
  const providerRef = useRef<HTMLDivElement>(null);
  const [commitMessageProvider, setCommitMessageProvider] = useState<'claude' | 'codex' | 'gemini'>('claude');
  const [commitProviderOpen, setCommitProviderOpen] = useState(false);
  const commitProviderRef = useRef<HTMLDivElement>(null);
  const [geminiLoadingPhrases, setGeminiLoadingPhrases] = useState<'witty' | 'tips' | 'all' | 'off'>('all');
  const [systemNotifications, setSystemNotifications] = useState(false);
  const [focusedChat, setFocusedChat] = useState(false);
  const [autoCompactThreshold, setAutoCompactThreshold] = useState(0);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('idle');
  const [lastSynced, setLastSynced] = useState<number | null>(null);
  const [isAuthed, setIsAuthed] = useState(false);

  useEffect(() => {
    window.sai.settingsGet('suspendTimeout', DEFAULT_TIMEOUT).then((v: number) => setSuspendTimeout(v));
    window.sai.settingsGet('editorFontSize', 13).then((v: number) => setEditorFontSize(v));
    window.sai.settingsGet('editorMinimap', true).then((v: boolean) => setEditorMinimap(v));
    window.sai.settingsGet('gemini', {}).then((g: any) => {
      if (g.loadingPhrases === 'witty' || g.loadingPhrases === 'tips' || g.loadingPhrases === 'all' || g.loadingPhrases === 'off') setGeminiLoadingPhrases(g.loadingPhrases);
    });
    window.sai.settingsGet('systemNotifications', false).then((v: boolean) => setSystemNotifications(v));
    window.sai.settingsGet('focusedChat', false).then((v: boolean) => setFocusedChat(v));
    window.sai.settingsGet('autoCompactThreshold', 0).then((v: number) => setAutoCompactThreshold(v));
    window.sai.settingsGet('aiProvider', 'claude').then((v: string) => {
      if (v === 'claude' || v === 'codex' || v === 'gemini') setAiProvider(v as 'claude' | 'codex' | 'gemini');
    });
    window.sai.settingsGet('commitMessageProvider', 'claude').then((v: string) => {
      if (v === 'claude' || v === 'codex' || v === 'gemini') setCommitMessageProvider(v as 'claude' | 'codex' | 'gemini');
    });
    window.sai.githubGetUser().then((u: any) => setIsAuthed(!!u));

    const unsubSync = window.sai.githubOnSyncStatus((data: { status: string; lastSynced?: number }) => {
      setSyncStatus(data.status as SyncStatus);
      if (data.lastSynced) setLastSynced(data.lastSynced);
    });

    // Re-read settings if remote sync updated them while modal was open
    const unsubApplied = window.sai.githubOnSettingsApplied((remote: Record<string, any>) => {
      if ('suspendTimeout' in remote) setSuspendTimeout(remote.suspendTimeout);
      if ('editorFontSize' in remote) setEditorFontSize(remote.editorFontSize);
      if ('editorMinimap' in remote) setEditorMinimap(remote.editorMinimap);
      if ('aiProvider' in remote && (remote.aiProvider === 'claude' || remote.aiProvider === 'codex' || remote.aiProvider === 'gemini')) setAiProvider(remote.aiProvider);
      if ('commitMessageProvider' in remote && (remote.commitMessageProvider === 'claude' || remote.commitMessageProvider === 'codex' || remote.commitMessageProvider === 'gemini')) setCommitMessageProvider(remote.commitMessageProvider);
      if ('systemNotifications' in remote) setSystemNotifications(remote.systemNotifications);
      if ('focusedChat' in remote) setFocusedChat(remote.focusedChat);
      if ('autoCompactThreshold' in remote) setAutoCompactThreshold(remote.autoCompactThreshold);
    });

    return () => { unsubSync(); unsubApplied(); };
  }, []);

  // Close provider dropdown on outside click
  useEffect(() => {
    if (!providerOpen) return;
    const handler = (e: MouseEvent) => {
      if (providerRef.current && !providerRef.current.contains(e.target as Node)) setProviderOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [providerOpen]);

  useEffect(() => {
    if (!commitProviderOpen) return;
    const handler = (e: MouseEvent) => {
      if (commitProviderRef.current && !commitProviderRef.current.contains(e.target as Node)) setCommitProviderOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [commitProviderOpen]);

  const handleTimeoutChange = (value: number) => {
    setSuspendTimeout(value);
    window.sai.settingsSet('suspendTimeout', value);
  };

  const handleFontSizeChange = (value: number) => {
    setEditorFontSize(value);
    window.sai.settingsSet('editorFontSize', value);
    onSettingChange?.('editorFontSize', value);
  };

  const handleMinimapChange = (value: boolean) => {
    setEditorMinimap(value);
    window.sai.settingsSet('editorMinimap', value);
    onSettingChange?.('editorMinimap', value);
  };

  const handleProviderChange = (value: 'claude' | 'codex' | 'gemini') => {
    setAiProvider(value);
    window.sai.settingsSet('aiProvider', value);
    onSettingChange?.('aiProvider', value);
  };

  const handleCommitProviderChange = (value: 'claude' | 'codex' | 'gemini') => {
    setCommitMessageProvider(value);
    window.sai.settingsSet('commitMessageProvider', value);
    onSettingChange?.('commitMessageProvider', value);
  };

  const handleGeminiLoadingPhrasesChange = (value: 'witty' | 'tips' | 'all' | 'off') => {
    setGeminiLoadingPhrases(value);
    window.sai.settingsGet('gemini', {}).then((existing: any) => {
      window.sai.settingsSet('gemini', { ...existing, loadingPhrases: value });
    });
    onSettingChange?.('geminiLoadingPhrases', value);
  };

  const handleFocusedChatChange = (value: boolean) => {
    setFocusedChat(value);
    window.sai.settingsSet('focusedChat', value);
    onSettingChange?.('focusedChat', value);
  };

  const handleAutoCompactChange = (value: number) => {
    setAutoCompactThreshold(value);
    window.sai.settingsSet('autoCompactThreshold', value);
    onSettingChange?.('autoCompactThreshold', value);
  };

  const handleSystemNotificationsChange = (value: boolean) => {
    setSystemNotifications(value);
    window.sai.settingsSet('systemNotifications', value);
  };

  const handleSyncNow = () => {
    setSyncStatus('syncing');
    window.sai.githubSyncNow();
  };

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-modal" onClick={e => e.stopPropagation()}>
        <div className="settings-header">
          <span className="settings-title">Settings</span>
          <div className="settings-header-right">
            {isAuthed && (
              <button
                className={`sync-dot sync-dot-${syncStatus}`}
                onClick={handleSyncNow}
                title={
                  syncStatus === 'syncing' ? 'Syncing to GitHub…' :
                  syncStatus === 'synced' ? `Synced ${lastSynced ? formatRelative(lastSynced) : ''}` :
                  syncStatus === 'error' ? 'Sync failed — click to retry' :
                  'Click to sync settings'
                }
              />
            )}
            <button className="settings-close" onClick={onClose}><X size={16} /></button>
          </div>
        </div>

        <div className="settings-body">
          <section className="settings-section">
            <div className="settings-section-label">AI Provider</div>

            <div className="settings-row">
              <div className="settings-row-info">
                <div className="settings-row-name">Chat provider</div>
                <div className="settings-row-desc">Which AI backend to use for the chat panel</div>
              </div>
              <div className="provider-select" ref={providerRef}>
                <button className="provider-select-btn" onClick={() => setProviderOpen(!providerOpen)}>
                  <span
                    className="provider-icon"
                    style={{
                      maskImage: `url('${PROVIDER_OPTIONS.find(p => p.id === aiProvider)!.svg}')`,
                      WebkitMaskImage: `url('${PROVIDER_OPTIONS.find(p => p.id === aiProvider)!.svg}')`,
                      backgroundColor: PROVIDER_OPTIONS.find(p => p.id === aiProvider)!.color,
                    }}
                  />
                  <span>{PROVIDER_OPTIONS.find(p => p.id === aiProvider)!.label}</span>
                  <ChevronDown size={11} style={{ opacity: 0.5 }} />
                </button>
                {providerOpen && (
                  <div className="provider-dropdown">
                    {PROVIDER_OPTIONS.map(opt => (
                      <button
                        key={opt.id}
                        className={`provider-dropdown-item ${opt.id === aiProvider ? 'active' : ''}`}
                        onClick={() => { handleProviderChange(opt.id); setProviderOpen(false); }}
                      >
                        <span
                          className="provider-icon"
                          style={{
                            maskImage: `url('${opt.svg}')`,
                            WebkitMaskImage: `url('${opt.svg}')`,
                            backgroundColor: opt.color,
                          }}
                        />
                        <span>{opt.label}</span>
                        {opt.id === aiProvider && <Check size={13} style={{ marginLeft: 'auto', color: 'var(--accent)' }} />}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="settings-row">
              <div className="settings-row-info">
                <div className="settings-row-name">Commit message provider</div>
                <div className="settings-row-desc">Which AI backend generates commit messages</div>
              </div>
              <div className="provider-select" ref={commitProviderRef}>
                <button className="provider-select-btn" onClick={() => setCommitProviderOpen(!commitProviderOpen)}>
                  <span
                    className="provider-icon"
                    style={{
                      maskImage: `url('${PROVIDER_OPTIONS.find(p => p.id === commitMessageProvider)!.svg}')`,
                      WebkitMaskImage: `url('${PROVIDER_OPTIONS.find(p => p.id === commitMessageProvider)!.svg}')`,
                      backgroundColor: PROVIDER_OPTIONS.find(p => p.id === commitMessageProvider)!.color,
                    }}
                  />
                  <span>{PROVIDER_OPTIONS.find(p => p.id === commitMessageProvider)!.label}</span>
                  <ChevronDown size={11} style={{ opacity: 0.5 }} />
                </button>
                {commitProviderOpen && (
                  <div className="provider-dropdown">
                    {PROVIDER_OPTIONS.map(opt => (
                      <button
                        key={opt.id}
                        className={`provider-dropdown-item ${opt.id === commitMessageProvider ? 'active' : ''}`}
                        onClick={() => { handleCommitProviderChange(opt.id); setCommitProviderOpen(false); }}
                      >
                        <span
                          className="provider-icon"
                          style={{
                            maskImage: `url('${opt.svg}')`,
                            WebkitMaskImage: `url('${opt.svg}')`,
                            backgroundColor: opt.color,
                          }}
                        />
                        <span>{opt.label}</span>
                        {opt.id === commitMessageProvider && <Check size={13} style={{ marginLeft: 'auto', color: 'var(--accent)' }} />}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </section>

          <div className="settings-divider" />

          <section className="settings-section">
            <div className="settings-section-label">Editor</div>

            <div className="settings-row">
              <div className="settings-row-info">
                <div className="settings-row-name">Font size</div>
              </div>
              <select
                className="settings-select"
                value={editorFontSize}
                onChange={e => handleFontSizeChange(Number(e.target.value))}
              >
                {FONT_SIZES.map(s => (
                  <option key={s} value={s}>{s}px</option>
                ))}
              </select>
            </div>

            <div className="settings-row settings-row-spaced">
              <div className="settings-row-info">
                <div className="settings-row-name">Minimap</div>
                <div className="settings-row-desc">Code overview on the right edge of the editor</div>
              </div>
              <button
                className={`settings-toggle${editorMinimap ? ' on' : ''}`}
                onClick={() => handleMinimapChange(!editorMinimap)}
                role="switch"
                aria-checked={editorMinimap}
              >
                <span className="settings-toggle-thumb" />
              </button>
            </div>
          </section>

          <div className="settings-divider" />

          <section className="settings-section">
            <div className="settings-section-label">Layout</div>

            <div className="settings-row">
              <div className="settings-row-info">
                <div className="settings-row-name">Focused chat</div>
                <div className="settings-row-desc">Chat stays at 66%, editor and terminal toggle in the remaining space</div>
              </div>
              <button
                className={`settings-toggle${focusedChat ? ' on' : ''}`}
                onClick={() => handleFocusedChatChange(!focusedChat)}
                role="switch"
                aria-checked={focusedChat}
              >
                <span className="settings-toggle-thumb" />
              </button>
            </div>
          </section>

          <div className="settings-divider" />

          <section className="settings-section">
            <div className="settings-section-label">Workspaces</div>

            <div className="settings-row">
              <div className="settings-row-info">
                <div className="settings-row-name">Auto-suspend after</div>
                <div className="settings-row-desc">Idle workspaces are suspended to free up resources</div>
              </div>
              <select
                className="settings-select"
                value={suspendTimeout}
                onChange={e => handleTimeoutChange(Number(e.target.value))}
              >
                {TIMEOUT_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>

            <div className="settings-row settings-row-spaced">
              <div className="settings-row-info">
                <div className="settings-row-name">Auto-compact context</div>
                <div className="settings-row-desc">Automatically compact when context reaches this threshold to reduce token costs</div>
              </div>
              <select
                className="settings-select"
                value={autoCompactThreshold}
                onChange={e => handleAutoCompactChange(Number(e.target.value))}
              >
                {AUTO_COMPACT_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
          </section>

          <div className="settings-divider" />

          <section className="settings-section">
            <div className="settings-section-label">Notifications</div>

            <div className="settings-row">
              <div className="settings-row-info">
                <div className="settings-row-name">System notifications</div>
                <div className="settings-row-desc">Send a desktop notification when a response completes and the app is not focused</div>
              </div>
              <button
                className={`settings-toggle${systemNotifications ? ' on' : ''}`}
                onClick={() => handleSystemNotificationsChange(!systemNotifications)}
                role="switch"
                aria-checked={systemNotifications}
              >
                <span className="settings-toggle-thumb" />
              </button>
            </div>
          </section>

          <div className="settings-divider" />

          <section className="settings-section">
            <div className="settings-section-label">Gemini</div>

            <div className="settings-row">
              <div className="settings-row-info">
                <div className="settings-row-name">Loading phrases</div>
                <div className="settings-row-desc">What to show while Gemini is thinking</div>
              </div>
              <select
                className="settings-select"
                value={geminiLoadingPhrases}
                onChange={e => handleGeminiLoadingPhrasesChange(e.target.value as any)}
              >
                <option value="all">All (witty + tips)</option>
                <option value="witty">Witty phrases</option>
                <option value="tips">Informative tips</option>
                <option value="off">Off</option>
              </select>
            </div>
          </section>

          {isAuthed && (
            <>
              <div className="settings-divider" />
              <div className="settings-sync-note">
                Settings are synced to your private <code>sai-config</code> GitHub repo and shared across devices.
              </div>
            </>
          )}

          {onOpenWhatsNew && (
            <>
              <div className="settings-divider" />
              <div className="settings-row">
                <div className="settings-row-info">
                  <div className="settings-row-name">What's New</div>
                  <div className="settings-row-desc">See what changed in this version</div>
                </div>
                <button
                  className="settings-close"
                  style={{ padding: '5px 10px', fontSize: 12, color: 'var(--accent)' }}
                  onClick={() => { onOpenWhatsNew(); onClose(); }}
                >
                  What's New
                </button>
              </div>
            </>
          )}
        </div>

        <style>{`
          .settings-overlay {
            position: fixed;
            inset: 0;
            background: rgba(0,0,0,0.55);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 3000;
            backdrop-filter: blur(4px);
          }
          .settings-modal {
            background: var(--bg-elevated);
            border: 1px solid var(--border);
            border-radius: 10px;
            width: 480px;
            box-shadow: 0 24px 64px rgba(0,0,0,0.5);
            overflow: hidden;
          }
          .settings-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 16px 20px;
            border-bottom: 1px solid var(--border);
          }
          .settings-header-right {
            display: flex;
            align-items: center;
            gap: 8px;
          }
          .settings-title { font-size: 14px; font-weight: 600; color: var(--text); }
          .settings-close {
            background: none;
            border: none;
            color: var(--text-muted);
            cursor: pointer;
            padding: 4px;
            border-radius: 4px;
            display: flex;
          }
          .settings-close:hover { color: var(--text); background: var(--bg-hover); }
          .sync-dot {
            width: 7px;
            height: 7px;
            border-radius: 50%;
            border: none;
            padding: 0;
            cursor: pointer;
            background: var(--text-muted);
            opacity: 0.3;
            transition: opacity 0.3s, background 0.3s, box-shadow 0.3s;
            flex-shrink: 0;
          }
          .sync-dot:hover { opacity: 0.8; }
          .sync-dot-syncing {
            background: var(--accent);
            opacity: 1;
            animation: sync-pulse 1s ease-in-out infinite;
          }
          .sync-dot-synced {
            background: var(--green);
            opacity: 1;
            animation: sync-fade 2s ease-out forwards;
          }
          .sync-dot-error {
            background: #f87171;
            opacity: 1;
          }
          @keyframes sync-pulse {
            0%, 100% { opacity: 0.4; }
            50% { opacity: 1; }
          }
          @keyframes sync-fade {
            0% { opacity: 1; }
            60% { opacity: 1; }
            100% { opacity: 0.3; }
          }
          .settings-body { padding: 20px; }
          .settings-section-label {
            font-size: 10px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.6px;
            color: var(--text-muted);
            margin-bottom: 14px;
          }
          .settings-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 10px;
          }
          .settings-row-spaced { margin-top: 12px; }
          .settings-row-name { font-size: 13px; font-weight: 500; color: var(--text); }
          .settings-row-desc { font-size: 11px; color: var(--text-muted); margin-top: 2px; }
          .settings-divider { height: 1px; background: var(--border); margin: 16px 0; }
          .settings-toggle {
            width: 36px;
            height: 20px;
            border-radius: 10px;
            border: 1px solid var(--border);
            background: var(--bg-secondary);
            cursor: pointer;
            position: relative;
            flex-shrink: 0;
            transition: background 0.15s, border-color 0.15s;
          }
          .settings-toggle.on { background: var(--accent); border-color: var(--accent); }
          .settings-toggle-thumb {
            position: absolute;
            top: 2px;
            left: 2px;
            width: 14px;
            height: 14px;
            border-radius: 50%;
            background: var(--text-muted);
            transition: transform 0.15s, background 0.15s;
          }
          .settings-toggle.on .settings-toggle-thumb { transform: translateX(16px); background: #000; }
          .settings-select {
            background: var(--bg-secondary);
            border: 1px solid var(--border);
            border-radius: 5px;
            color: var(--text);
            font-size: 12px;
            padding: 5px 8px;
            cursor: pointer;
            outline: none;
            width: 140px;
          }
          .settings-select:focus { border-color: var(--accent); }
          .provider-select {
            position: relative;
          }
          .provider-select-btn {
            display: flex;
            align-items: center;
            gap: 8px;
            background: var(--bg-secondary);
            border: 1px solid var(--border);
            border-radius: 5px;
            color: var(--text);
            font-size: 12px;
            padding: 5px 10px;
            cursor: pointer;
            min-width: 140px;
          }
          .provider-select-btn:hover { border-color: var(--accent); }
          .provider-icon {
            display: inline-block;
            width: 14px;
            height: 14px;
            mask-size: contain;
            -webkit-mask-size: contain;
            mask-repeat: no-repeat;
            -webkit-mask-repeat: no-repeat;
            flex-shrink: 0;
          }
          .provider-dropdown {
            position: absolute;
            top: calc(100% + 4px);
            right: 0;
            background: var(--bg-elevated);
            border: 1px solid var(--border);
            border-radius: 6px;
            box-shadow: 0 8px 24px rgba(0,0,0,0.4);
            overflow: hidden;
            z-index: 10;
            min-width: 160px;
          }
          .provider-dropdown-item {
            display: flex;
            align-items: center;
            gap: 8px;
            width: 100%;
            padding: 8px 12px;
            background: none;
            border: none;
            color: var(--text);
            font-size: 12px;
            cursor: pointer;
            text-align: left;
          }
          .provider-dropdown-item:hover { background: var(--bg-hover); }
          .provider-dropdown-item.active { background: var(--bg-secondary); }
          .settings-sync-note {
            font-size: 11px;
            color: var(--text-muted);
            line-height: 1.5;
          }
          .settings-sync-note code {
            font-family: 'JetBrains Mono', monospace;
            background: var(--bg-secondary);
            padding: 1px 4px;
            border-radius: 3px;
            color: var(--accent);
          }
        `}</style>
      </div>
    </div>
  );
}
