import { useState, useEffect } from 'react';
import { X, RefreshCw, Check, AlertCircle } from 'lucide-react';

interface Props {
  onClose: () => void;
  onSettingChange?: (key: string, value: any) => void;
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

type SyncStatus = 'idle' | 'syncing' | 'synced' | 'error';

function formatRelative(ts: number): string {
  const secs = Math.floor((Date.now() - ts) / 1000);
  if (secs < 10) return 'just now';
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ago`;
}

export default function SettingsModal({ onClose, onSettingChange }: Props) {
  const [suspendTimeout, setSuspendTimeout] = useState<number>(DEFAULT_TIMEOUT);
  const [editorFontSize, setEditorFontSize] = useState(13);
  const [editorMinimap, setEditorMinimap] = useState(true);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('idle');
  const [lastSynced, setLastSynced] = useState<number | null>(null);
  const [isAuthed, setIsAuthed] = useState(false);

  useEffect(() => {
    window.sai.settingsGet('suspendTimeout', DEFAULT_TIMEOUT).then((v: number) => setSuspendTimeout(v));
    window.sai.settingsGet('editorFontSize', 13).then((v: number) => setEditorFontSize(v));
    window.sai.settingsGet('editorMinimap', true).then((v: boolean) => setEditorMinimap(v));
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
    });

    return () => { unsubSync(); unsubApplied(); };
  }, []);

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
              <div className="sync-status">
                {syncStatus === 'syncing' && <><RefreshCw size={12} className="sync-spin" /><span>Syncing…</span></>}
                {syncStatus === 'synced' && <><Check size={12} className="sync-ok" /><span>Synced {lastSynced ? formatRelative(lastSynced) : ''}</span></>}
                {syncStatus === 'error' && <><AlertCircle size={12} className="sync-err" /><span>Sync failed</span></>}
                {(syncStatus === 'idle' || syncStatus === 'error') && (
                  <button className="sync-btn" onClick={handleSyncNow} title="Sync now">
                    <RefreshCw size={12} />
                  </button>
                )}
              </div>
            )}
            <button className="settings-close" onClick={onClose}><X size={16} /></button>
          </div>
        </div>

        <div className="settings-body">
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
          </section>

          {isAuthed && (
            <>
              <div className="settings-divider" />
              <div className="settings-sync-note">
                Settings are synced to your private <code>sai-config</code> GitHub repo and shared across devices.
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
          .sync-status {
            display: flex;
            align-items: center;
            gap: 5px;
            font-size: 11px;
            color: var(--text-muted);
          }
          .sync-spin { animation: spin 1s linear infinite; }
          @keyframes spin { to { transform: rotate(360deg); } }
          .sync-ok { color: var(--green); }
          .sync-err { color: #f87171; }
          .sync-btn {
            background: none;
            border: none;
            color: var(--text-muted);
            cursor: pointer;
            padding: 3px;
            border-radius: 3px;
            display: flex;
          }
          .sync-btn:hover { color: var(--text); background: var(--bg-hover); }
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
