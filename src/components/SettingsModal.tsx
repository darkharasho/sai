import { useState, useEffect, useRef } from 'react';
import { X, Check, ChevronDown, Settings as SettingsIcon, Monitor, Type, PanelLeft, Palette, HardDrive } from 'lucide-react';
import { THEMES, applyTheme, type ThemeId, HIGHLIGHT_THEMES, getActiveHighlightTheme, setActiveHighlightTheme, getShikiHighlighter, type HighlightThemeId } from '../themes';

interface Props {
  onClose: () => void;
  onSettingChange?: (key: string, value: any) => void;
  onOpenWhatsNew?: () => void;
  onHistoryRetentionChange?: (days: number | null) => void;
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

const SIDEBAR_WIDTH_OPTIONS = [
  { label: 'Narrow',  value: 200 },
  { label: 'Medium',  value: 250 },
  { label: 'Wide',    value: 300 },
];

const AUTO_COMPACT_OPTIONS = [
  { label: 'Off',  value: 0 },
  { label: '30%',  value: 30 },
  { label: '40%',  value: 40 },
  { label: '50%',  value: 50 },
  { label: '60%',  value: 60 },
  { label: '70%',  value: 70 },
  { label: '80%',  value: 80 },
];

const RETENTION_OPTIONS: { label: string; value: number | null }[] = [
  { label: '1 week', value: 7 },
  { label: '2 weeks', value: 14 },
  { label: '1 month', value: 30 },
  { label: '3 months', value: 90 },
  { label: 'Unlimited', value: null },
];

type SyncStatus = 'idle' | 'syncing' | 'synced' | 'error';
type SettingsPage = 'general' | 'editor' | 'layout' | 'style' | 'storage' | 'provider' | 'claude' | 'codex' | 'gemini';

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

export default function SettingsModal({ onClose, onSettingChange, onOpenWhatsNew, onHistoryRetentionChange }: Props) {
  const [suspendTimeout, setSuspendTimeout] = useState<number>(DEFAULT_TIMEOUT);
  const [editorFontSize, setEditorFontSize] = useState(13);
  const [editorMinimap, setEditorMinimap] = useState(true);
  const [aiProvider, setAiProvider] = useState<'claude' | 'codex' | 'gemini'>('claude');
  const [providerOpen, setProviderOpen] = useState(false);
  const providerRef = useRef<HTMLDivElement>(null);
  const [commitMessageProvider, setCommitMessageProvider] = useState<'claude' | 'codex' | 'gemini'>('claude');
  const [lockCommitProvider, setLockCommitProvider] = useState(false);
  const [commitProviderOpen, setCommitProviderOpen] = useState(false);
  const commitProviderRef = useRef<HTMLDivElement>(null);
  const [geminiLoadingPhrases, setGeminiLoadingPhrases] = useState<'witty' | 'tips' | 'all' | 'off'>('all');
  const [systemNotifications, setSystemNotifications] = useState(false);
  const [toolCallsExpanded, setToolCallsExpanded] = useState(true);
  const [defaultView, setDefaultView] = useState<'default' | 'terminal-mode'>('default');
  const [focusedChat, setFocusedChat] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(300);
  const [autoCompactThreshold, setAutoCompactThreshold] = useState(0);
  const [aiTitleGeneration, setAiTitleGeneration] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('idle');
  const [lastSynced, setLastSynced] = useState<number | null>(null);
  const [isAuthed, setIsAuthed] = useState(false);
  const [theme, setTheme] = useState<ThemeId>('default');
  const [highlightTheme, setHighlightTheme] = useState<HighlightThemeId>('monokai');
  const [historyRetention, setHistoryRetention] = useState<number | null>(14);
  const [previewHtml, setPreviewHtml] = useState('');

  const [activePage, setActivePage] = useState<SettingsPage>('general');

  useEffect(() => {
    window.sai.settingsGet('suspendTimeout', DEFAULT_TIMEOUT).then((v: number) => setSuspendTimeout(v));
    window.sai.settingsGet('editorFontSize', 13).then((v: number) => setEditorFontSize(v));
    window.sai.settingsGet('editorMinimap', true).then((v: boolean) => setEditorMinimap(v));
    window.sai.settingsGet('gemini', {}).then((g: any) => {
      if (g.loadingPhrases === 'witty' || g.loadingPhrases === 'tips' || g.loadingPhrases === 'all' || g.loadingPhrases === 'off') setGeminiLoadingPhrases(g.loadingPhrases);
    });
    window.sai.settingsGet('systemNotifications', false).then((v: boolean) => setSystemNotifications(v));
    window.sai.settingsGet('toolCallsExpanded', true).then((v: boolean) => setToolCallsExpanded(v));
    window.sai.settingsGet('defaultView', 'default').then((v: string) => {
      if (v === 'default' || v === 'terminal-mode') setDefaultView(v);
    });
    window.sai.settingsGet('focusedChat', false).then((v: boolean) => setFocusedChat(v));
    window.sai.settingsGet('sidebarWidth', 300).then((v: number) => setSidebarWidth(v));
    window.sai.settingsGet('autoCompactThreshold', 0).then((v: number) => setAutoCompactThreshold(v));
    window.sai.settingsGet('aiTitleGeneration', false).then((v: boolean) => setAiTitleGeneration(!!v));
    window.sai.settingsGet('theme', 'default').then((v: string) => {
      const id = v as ThemeId;
      if (THEMES.some(t => t.id === id)) setTheme(id);
    });
    window.sai.settingsGet('highlightTheme', 'monokai').then((v: string) => {
      if (HIGHLIGHT_THEMES.some(t => t.id === v)) setHighlightTheme(v as HighlightThemeId);
    });
    window.sai.settingsGet('aiProvider', 'claude').then((v: string) => {
      if (v === 'claude' || v === 'codex' || v === 'gemini') setAiProvider(v as 'claude' | 'codex' | 'gemini');
    });
    window.sai.settingsGet('commitMessageProvider', 'claude').then((v: string) => {
      if (v === 'claude' || v === 'codex' || v === 'gemini') setCommitMessageProvider(v as 'claude' | 'codex' | 'gemini');
    });
    window.sai.settingsGet('lockCommitProvider', false).then((v: boolean) => setLockCommitProvider(!!v));
    window.sai.settingsGet('historyRetention', 14).then((v: number | null) => setHistoryRetention(v));
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
      if ('lockCommitProvider' in remote) setLockCommitProvider(remote.lockCommitProvider);
      if ('systemNotifications' in remote) setSystemNotifications(remote.systemNotifications);
      if ('toolCallsExpanded' in remote) setToolCallsExpanded(remote.toolCallsExpanded);
      if ('focusedChat' in remote) setFocusedChat(remote.focusedChat);
      if ('sidebarWidth' in remote) setSidebarWidth(remote.sidebarWidth);
      if ('autoCompactThreshold' in remote) setAutoCompactThreshold(remote.autoCompactThreshold);
      if ('theme' in remote && THEMES.some(t => t.id === remote.theme)) {
        setTheme(remote.theme);
        applyTheme(remote.theme);
      }
      if ('highlightTheme' in remote && HIGHLIGHT_THEMES.some(t => t.id === remote.highlightTheme)) {
        setHighlightTheme(remote.highlightTheme);
        setActiveHighlightTheme(remote.highlightTheme);
      }
      if ('historyRetention' in remote) setHistoryRetention(remote.historyRetention);
    });

    return () => { unsubSync(); unsubApplied(); };
  }, []);

  // Render code preview for highlight theme
  useEffect(() => {
    const sample = `function greet(name: string) {\n  const msg = \`Hello, \${name}!\`;\n  console.log(msg);\n  return msg;\n}`;
    getShikiHighlighter().then(hl => {
      try {
        setPreviewHtml(hl.codeToHtml(sample, { lang: 'typescript', theme: highlightTheme }));
      } catch { /* theme not loaded */ }
    });
  }, [highlightTheme]);

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

  const handleThemeChange = (id: ThemeId) => {
    setTheme(id);
    applyTheme(id);
    window.sai.settingsSet('theme', id);
    onSettingChange?.('theme', id);
  };

  const handleHighlightThemeChange = (id: HighlightThemeId) => {
    setHighlightTheme(id);
    setActiveHighlightTheme(id);
    window.sai.settingsSet('highlightTheme', id);
    onSettingChange?.('highlightTheme', id);
  };

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

    if (lockCommitProvider) {
      setCommitMessageProvider(value);
      window.sai.settingsSet('commitMessageProvider', value);
      onSettingChange?.('commitMessageProvider', value);
    }
  };

  const handleCommitProviderChange = (value: 'claude' | 'codex' | 'gemini') => {
    if (lockCommitProvider) return;
    setCommitMessageProvider(value);
    window.sai.settingsSet('commitMessageProvider', value);
    onSettingChange?.('commitMessageProvider', value);
  };

  const handleLockCommitProviderChange = (value: boolean) => {
    setLockCommitProvider(value);
    window.sai.settingsSet('lockCommitProvider', value);
    onSettingChange?.('lockCommitProvider', value);

    if (value) {
      // Sync commit provider to chat provider when turning on
      setCommitMessageProvider(aiProvider);
      window.sai.settingsSet('commitMessageProvider', aiProvider);
      onSettingChange?.('commitMessageProvider', aiProvider);
    }
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

  const handleSidebarWidthChange = (value: number) => {
    setSidebarWidth(value);
    window.sai.settingsSet('sidebarWidth', value);
    onSettingChange?.('sidebarWidth', value);
  };

  const handleAiTitleGenerationChange = (value: boolean) => {
    setAiTitleGeneration(value);
    window.sai.settingsSet('aiTitleGeneration', value);
    onSettingChange?.('aiTitleGeneration', value);
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

  const handleToolCallsExpandedChange = (value: boolean) => {
    setToolCallsExpanded(value);
    window.sai.settingsSet('toolCallsExpanded', value);
    onSettingChange?.('toolCallsExpanded', value);
  };

  const handleDefaultViewChange = (value: 'default' | 'terminal-mode') => {
    setDefaultView(value);
    window.sai.settingsSet('defaultView', value);
    onSettingChange?.('defaultView', value);
  };

  const handleSyncNow = () => {
    setSyncStatus('syncing');
    window.sai.githubSyncNow();
  };

  const renderEditorPage = () => (
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
  );

  const renderLayoutPage = () => (
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

      <div className="settings-row settings-row-spaced">
        <div className="settings-row-info">
          <div className="settings-row-name">Sidebar width</div>
          <div className="settings-row-desc">Width of the file explorer and git sidebars</div>
        </div>
        <select
          className="settings-select"
          value={sidebarWidth}
          onChange={e => handleSidebarWidthChange(Number(e.target.value))}
        >
          {SIDEBAR_WIDTH_OPTIONS.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>
    </section>
  );

  const renderStylePage = () => (
    <>
      <section className="settings-section">
        <div className="settings-section-label">Theme</div>
        <div className="theme-grid">
          {THEMES.map(t => (
            <button
              key={t.id}
              className={`theme-card${theme === t.id ? ' active' : ''}`}
              onClick={() => handleThemeChange(t.id)}
            >
              <div className="theme-preview" style={{
                background: t.vars['--bg-primary'],
                borderColor: theme === t.id ? (t.vars['--accent'] || 'var(--accent)') : t.vars['--border'],
              }}>
                <div className="theme-preview-accent" style={{ background: t.vars['--accent'] || 'var(--accent)' }} />
                <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
                  <div className="theme-preview-sidebar" style={{ background: t.vars['--bg-secondary'] }} />
                  <div className="theme-preview-content">
                    <div className="theme-preview-bar" style={{ background: t.vars['--bg-elevated'] }} />
                    <div className="theme-preview-line" style={{ background: t.vars['--text-muted'], width: '70%' }} />
                    <div className="theme-preview-line" style={{ background: t.vars['--text-muted'], width: '50%' }} />
                    <div className="theme-preview-line" style={{ background: t.vars['--text-muted'], width: '60%' }} />
                  </div>
                </div>
              </div>
              <div className="theme-card-label">{t.label}</div>
              {theme === t.id && <Check size={12} className="theme-check" />}
            </button>
          ))}
        </div>
      </section>

      <div className="settings-divider" />

      <section className="settings-section">
        <div className="settings-section-label">Code Highlighting</div>
        <div className="settings-row">
          <div className="settings-row-info">
            <div className="settings-row-name">Syntax theme</div>
            <div className="settings-row-desc">Colors used for code blocks, diffs, and tool call output</div>
          </div>
          <select
            className="settings-select"
            value={highlightTheme}
            onChange={e => handleHighlightThemeChange(e.target.value as HighlightThemeId)}
          >
            {HIGHLIGHT_THEMES.map(t => (
              <option key={t.id} value={t.id}>{t.label}</option>
            ))}
          </select>
        </div>
        {previewHtml && (
          <div className="highlight-preview" dangerouslySetInnerHTML={{ __html: previewHtml }} />
        )}
      </section>
    </>
  );

  const renderGeneralPage = () => (
    <>
      <section className="settings-section">
        <div className="settings-section-label">Workspaces</div>

        <div className="settings-row">
          <div className="settings-row-info">
            <div className="settings-row-name">Default view</div>
            <div className="settings-row-desc">Choose which view to show when the app launches</div>
          </div>
          <select
            className="settings-select"
            value={defaultView}
            onChange={e => handleDefaultViewChange(e.target.value as 'default' | 'terminal-mode')}
          >
            <option value="default">Workspace</option>
            <option value="terminal-mode">Terminal</option>
          </select>
        </div>

        <div style={{ height: 8 }} />

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

        <div className="settings-row">
          <div className="settings-row-info">
            <div className="settings-row-name">Expand tool calls</div>
            <div className="settings-row-desc">Show tool call details expanded by default in the chat</div>
          </div>
          <button
            className={`settings-toggle${toolCallsExpanded ? ' on' : ''}`}
            onClick={() => handleToolCallsExpandedChange(!toolCallsExpanded)}
            role="switch"
            aria-checked={toolCallsExpanded}
          >
            <span className="settings-toggle-thumb" />
          </button>
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
    </>
  );

  const renderProviderPage = () => (
    <>
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
          <div className={`provider-select${lockCommitProvider ? ' disabled' : ''}`} ref={commitProviderRef}>
            <button
              className="provider-select-btn"
              onClick={() => !lockCommitProvider && setCommitProviderOpen(!commitProviderOpen)}
              disabled={lockCommitProvider}
            >
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
            {commitProviderOpen && !lockCommitProvider && (
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

        <div className="settings-row">
          <div className="settings-row-info">
            <div className="settings-row-name">Same as chat provider</div>
            <div className="settings-row-desc">Keep the commit message provider in sync with the chat provider</div>
          </div>
          <button
            className={`settings-toggle ${lockCommitProvider ? 'on' : 'off'}`}
            onClick={() => handleLockCommitProviderChange(!lockCommitProvider)}
            role="switch"
            aria-checked={lockCommitProvider}
          >
            <span className="settings-toggle-thumb" />
          </button>
        </div>

        <div className="settings-row">
          <div className="settings-row-info">
            <div className="settings-row-name">AI conversation titles</div>
            <div className="settings-row-desc">Use a lightweight AI call to generate better conversation titles (uses the cheapest model)</div>
          </div>
          <button
            className={`settings-toggle ${aiTitleGeneration ? 'on' : 'off'}`}
            onClick={() => handleAiTitleGenerationChange(!aiTitleGeneration)}
          >
            <span className="settings-toggle-thumb" />
          </button>
        </div>
      </section>
    </>
  );

  const renderClaudePage = () => (
    <section className="settings-section">
      <div className="settings-section-label">Claude</div>
      <div className="settings-row">
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
  );

  const renderCodexPage = () => (
    <section className="settings-section">
      <div className="settings-section-label">Codex</div>
      <div className="settings-row">
        <div className="settings-row-info">
          <div className="settings-row-name">Chat toolbar controls</div>
          <div className="settings-row-desc">Model and permission mode for Codex live in the chat toolbar so you can change them per conversation.</div>
        </div>
      </div>
      <div className="settings-row">
        <div className="settings-row-info">
          <div className="settings-row-name">What to configure here</div>
          <div className="settings-row-desc">Use the Provider page to choose Codex as your chat or commit-message provider. Use the chat toolbar when you need to change runtime behavior.</div>
        </div>
      </div>
    </section>
  );

  const renderGeminiPage = () => (
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
  );

  const renderStoragePage = () => (
    <div className="settings-section">
      <h3>Data & Storage</h3>
      <label className="settings-label">Chat History Retention</label>
      <p className="settings-hint">How long to keep chat history before automatically deleting. Pinned chats are never deleted.</p>
      <select
        className="settings-select"
        value={historyRetention === null ? 'null' : String(historyRetention)}
        onChange={e => {
          const val = e.target.value === 'null' ? null : Number(e.target.value);
          setHistoryRetention(val);
          window.sai.settingsSet('historyRetention', val);
          onHistoryRetentionChange?.(val);
        }}
      >
        {RETENTION_OPTIONS.map(opt => (
          <option key={String(opt.value)} value={opt.value === null ? 'null' : String(opt.value)}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );

  const renderActivePage = () => {
    switch (activePage) {
      case 'general': return renderGeneralPage();
      case 'editor': return renderEditorPage();
      case 'layout': return renderLayoutPage();
      case 'style': return renderStylePage();
      case 'storage': return renderStoragePage();
      case 'provider': return renderProviderPage();
      case 'claude': return renderClaudePage();
      case 'codex': return renderCodexPage();
      case 'gemini': return renderGeminiPage();
    }
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

        <div className="settings-layout">
          <nav className="settings-sidebar">
            <button
              className={`settings-nav-item${activePage === 'general' ? ' active' : ''}`}
              onClick={() => setActivePage('general')}
            >
              <SettingsIcon size={14} />
              <span>General</span>
            </button>
            <button
              className={`settings-nav-item${activePage === 'editor' ? ' active' : ''}`}
              onClick={() => setActivePage('editor')}
            >
              <Type size={14} />
              <span>Editor</span>
            </button>
            <button
              className={`settings-nav-item${activePage === 'layout' ? ' active' : ''}`}
              onClick={() => setActivePage('layout')}
            >
              <PanelLeft size={14} />
              <span>Layout</span>
            </button>
            <button
              className={`settings-nav-item${activePage === 'style' ? ' active' : ''}`}
              onClick={() => setActivePage('style')}
            >
              <Palette size={14} />
              <span>Style</span>
            </button>
            <button
              className={`settings-nav-item${activePage === 'storage' ? ' active' : ''}`}
              onClick={() => setActivePage('storage')}
            >
              <HardDrive size={14} />
              <span>Data & Storage</span>
            </button>
            <button
              className={`settings-nav-item${activePage === 'provider' ? ' active' : ''}`}
              onClick={() => setActivePage('provider')}
            >
              <Monitor size={14} />
              <span>Provider</span>
            </button>
            {PROVIDER_OPTIONS.map(p => (
              <button
                key={p.id}
                className={`settings-nav-sub${activePage === p.id ? ' active' : ''}`}
                onClick={() => setActivePage(p.id)}
                style={activePage === p.id ? { borderLeftColor: p.color } as React.CSSProperties : undefined}
              >
                <span
                  className="provider-icon"
                  style={{
                    maskImage: `url('${p.svg}')`,
                    WebkitMaskImage: `url('${p.svg}')`,
                    backgroundColor: activePage === p.id ? p.color : 'var(--text-muted)',
                    width: 14,
                    height: 14,
                  }}
                />
                <span>{p.id.charAt(0).toUpperCase() + p.id.slice(1)}</span>
              </button>
            ))}
          </nav>

          <div className="settings-content">
            {renderActivePage()}
          </div>
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
            width: 720px;
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
          .settings-layout {
            display: flex;
            min-height: 400px;
            max-height: calc(100vh - 120px);
          }
          .settings-sidebar {
            width: 185px;
            min-width: 185px;
            background: var(--bg-primary);
            border-right: 1px solid var(--border);
            padding: 12px 0;
            display: flex;
            flex-direction: column;
          }
          .settings-nav-item {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 9px 16px;
            font-size: 12px;
            color: var(--text-muted);
            background: none;
            border: none;
            border-left: 2px solid transparent;
            cursor: pointer;
            text-align: left;
            width: 100%;
          }
          .settings-nav-item:hover { color: var(--text); background: var(--bg-hover); }
          .settings-nav-item.active {
            color: var(--text);
            background: rgba(255,255,255,0.05);
            border-left-color: var(--accent);
          }
          .settings-nav-sub {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 7px 16px 7px 36px;
            font-size: 11px;
            color: var(--text-muted);
            background: none;
            border: none;
            border-left: 2px solid transparent;
            cursor: pointer;
            text-align: left;
            width: 100%;
          }
          .settings-nav-sub:hover { color: var(--text); background: var(--bg-hover); }
          .settings-nav-sub.active {
            color: var(--text);
            background: rgba(255,255,255,0.05);
          }
          .settings-content {
            flex: 1;
            overflow-y: auto;
            padding: 20px;
          }
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
          .provider-select.disabled { opacity: 0.5; cursor: not-allowed; }
          .provider-select.disabled .provider-select-btn { cursor: not-allowed; pointer-events: none; }
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
            font-family: 'Geist Mono', 'JetBrains Mono', monospace;
            background: var(--bg-secondary);
            padding: 1px 4px;
            border-radius: 3px;
            color: var(--accent);
          }
          .theme-grid {
            display: flex;
            gap: 12px;
          }
          .theme-card {
            background: none;
            border: none;
            cursor: pointer;
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 8px;
            position: relative;
            padding: 0;
          }
          .theme-preview {
            width: 120px;
            height: 80px;
            border-radius: 6px;
            border: 2px solid;
            display: flex;
            flex-direction: column;
            overflow: hidden;
            transition: border-color 0.15s;
          }
          .theme-preview-accent {
            height: 3px;
            flex-shrink: 0;
            width: 100%;
          }
          .theme-card:hover .theme-preview {
            border-color: var(--accent) !important;
          }
          .theme-preview-sidebar {
            width: 24px;
            min-width: 24px;
            height: 100%;
          }
          .theme-preview-content {
            flex: 1;
            padding: 8px 6px;
            display: flex;
            flex-direction: column;
            gap: 5px;
          }
          .theme-preview-bar {
            height: 8px;
            border-radius: 2px;
            width: 100%;
          }
          .theme-preview-line {
            height: 4px;
            border-radius: 1px;
          }
          .theme-card-label {
            font-size: 11px;
            color: var(--text-muted);
            transition: color 0.15s;
          }
          .theme-card.active .theme-card-label {
            color: var(--text);
          }
          .theme-check {
            position: absolute;
            top: 4px;
            right: 4px;
            color: var(--accent);
          }
          .highlight-preview {
            margin-top: 12px;
            border-radius: 6px;
            overflow: hidden;
            font-size: 12px;
            line-height: 1.5;
          }
          .highlight-preview pre {
            margin: 0 !important;
            border-radius: 6px !important;
            padding: 12px 14px !important;
          }
          .highlight-preview code {
            font-family: 'Geist Mono', 'JetBrains Mono', 'Fira Code', monospace !important;
            font-size: 12px !important;
          }
        `}</style>
      </div>
    </div>
  );
}
