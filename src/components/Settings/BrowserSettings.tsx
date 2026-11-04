import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, FolderOpen, RefreshCw, Trash2, TriangleAlert } from 'lucide-react';

interface DetectedBrowser {
  id: string;
  label: string;
  userDataDir: string;
  nativeHostDir: string;
  hostInstalled: boolean;
  extensionId: string | null;
  macAppName?: string;
  flatpakAppId?: string;
}

interface InstallResult {
  browser: string;
  manifestPath: string;
  /** A Flatpak sandbox grant was just added; the browser must be fully restarted. */
  restartRequired?: boolean;
}

interface DeployInfo {
  extensionDir: string;
  relayScript: string;
  relayBuilt: boolean;
  /** Known up front when the manifest pins a `key`; null for an unkeyed build. */
  expectedExtensionId: string | null;
  browsers: DetectedBrowser[];
}

interface BridgeStatus {
  listening: boolean;
  connected: boolean;
  attachedTabIds: number[];
}

/**
 * Chromium offers no API to install an unpacked extension — the "Load
 * unpacked" click is reserved for a human. So "Deploy" automates both sides of
 * it: it opens the right page and reveals the folder, then watches the
 * browser's own profile for the extension ID and writes the native host
 * manifest the moment it appears. The user clicks once, in the browser.
 */
type Phase =
  | { kind: 'idle' }
  | { kind: 'waiting'; browserId: string }
  | { kind: 'installing'; browserId: string }
  | { kind: 'done'; browserId: string; extensionId: string }
  | { kind: 'error'; message: string };

const buttonStyle: React.CSSProperties = {
  padding: '6px 12px',
  fontSize: 12,
  background: 'var(--surface-2)',
  color: 'var(--text)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 6,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

const primaryButtonStyle: React.CSSProperties = {
  ...buttonStyle,
  background: 'var(--accent)',
  color: '#000',
  borderColor: 'var(--accent)',
  fontWeight: 500,
};

const codeStyle: React.CSSProperties = {
  fontSize: 11,
  background: 'var(--surface-2)',
  border: '1px solid var(--border-hairline)',
  padding: '2px 6px',
  borderRadius: 4,
  color: 'var(--text)',
  fontFamily: 'monospace',
  wordBreak: 'break-all',
};

const cardStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  padding: '10px 12px',
  background: 'var(--surface-2)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 6,
};

export default function BrowserSettings() {
  const [info, setInfo] = useState<DeployInfo | null>(null);
  const [status, setStatus] = useState<BridgeStatus | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [manualId, setManualId] = useState('');
  const [unavailable, setUnavailable] = useState(false);
  /** Browsers that must be fully quit and reopened before the bridge works. */
  const [restartNeeded, setRestartNeeded] = useState<Set<string>>(() => new Set());
  const phaseRef = useRef<Phase>(phase);
  phaseRef.current = phase;

  const deploy = (window.sai as any)?.browserDeploy;

  const refresh = useCallback(async (): Promise<DeployInfo | null> => {
    if (!deploy?.info) {
      setUnavailable(true);
      return null;
    }
    try {
      const next: DeployInfo = await deploy.info();
      setInfo(next);
      return next;
    } catch {
      setUnavailable(true);
      return null;
    }
  }, [deploy]);

  useEffect(() => { void refresh(); }, [refresh]);

  // Bridge status is cheap and changes whenever the user attaches a tab.
  useEffect(() => {
    const poll = async () => {
      const statusFn = (window.sai as any)?.browserStatus;
      if (typeof statusFn !== 'function') return;
      try { setStatus(await statusFn()); } catch { /* bridge down */ }
    };
    void poll();
    const t = setInterval(() => void poll(), 3_000);
    return () => clearInterval(t);
  }, []);

  const noteRestarts = useCallback((results: InstallResult[] | undefined) => {
    const ids = (results ?? []).filter((r) => r.restartRequired).map((r) => r.browser);
    if (ids.length) setRestartNeeded((prev) => new Set([...prev, ...ids]));
  }, []);

  const installMany = useCallback(async (browserIds: string[], extensionId: string) => {
    if (!browserIds.length) return;
    setPhase({ kind: 'installing', browserId: browserIds[0] });
    try {
      noteRestarts(await deploy.install(browserIds, extensionId));
      await refresh();
      setPhase({ kind: 'done', browserId: browserIds[0], extensionId });
    } catch (err) {
      setPhase({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }, [deploy, refresh, noteRestarts]);

  const install = useCallback(
    (browserId: string, extensionId: string) => installMany([browserId], extensionId),
    [installMany],
  );

  // Watch for the extension to appear after the user's "Load unpacked" click.
  // With a pinned id the host is already registered by now, so this only
  // confirms the load; without one, the id discovered here completes the install.
  useEffect(() => {
    if (phase.kind !== 'waiting') return;
    const browserId = phase.browserId;

    const tick = async () => {
      const next = await refresh();
      if (!next) return;
      if (phaseRef.current.kind !== 'waiting') return;
      const found = next.browsers.find((b) => b.id === browserId)?.extensionId;
      if (!found) return;
      if (next.expectedExtensionId) setPhase({ kind: 'done', browserId, extensionId: found });
      else void install(browserId, found);
    };

    const t = setInterval(() => void tick(), 1_500);
    return () => clearInterval(t);
  }, [phase, refresh, install]);

  const startDeploy = async (browser: DetectedBrowser) => {
    const knownId = info?.expectedExtensionId ?? browser.extensionId;

    // The id is known before the extension exists (pinned manifest key), so
    // register the native host first. By the time the user finishes clicking
    // through Load unpacked, the bridge is already wired up.
    if (knownId) {
      setPhase({ kind: 'installing', browserId: browser.id });
      try {
        noteRestarts(await deploy.install([browser.id], knownId));
        const next = await refresh();
        if (next?.browsers.find((b) => b.id === browser.id)?.extensionId) {
          setPhase({ kind: 'done', browserId: browser.id, extensionId: knownId });
          return;
        }
      } catch (err) {
        setPhase({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
        return;
      }
    }

    setPhase({ kind: 'waiting', browserId: browser.id });
    try { await deploy.revealExtensionFolder(); } catch { /* non-fatal */ }
    try {
      await deploy.openExtensionsPage(browser.id);
    } catch {
      // Some forks won't take a chrome:// URL on the command line. The folder
      // is revealed and its path is on screen, so the user can still finish.
    }
  };

  const uninstall = async (browserId: string) => {
    try {
      await deploy.uninstall([browserId]);
      await refresh();
      setPhase({ kind: 'idle' });
    } catch (err) {
      setPhase({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  };

  if (unavailable) {
    return (
      <section className="settings-section">
        <div className="settings-section-label">Browser</div>
        <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          The browser bridge is unavailable in this build.
        </p>
      </section>
    );
  }

  const browsers = info?.browsers ?? [];
  const dotColor = status?.connected ? 'var(--green)' : status?.listening ? 'var(--orange)' : 'var(--red)';
  const statusText = status?.connected
    ? `Connected — ${status.attachedTabIds.length} tab${status.attachedTabIds.length === 1 ? '' : 's'} shared`
    : status?.listening
      ? 'Listening — no browser connected'
      : 'Not running';

  return (
    <section className="settings-section">
      <div className="settings-section-label">Browser</div>

      <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: -6, marginBottom: 14, lineHeight: 1.5 }}>
        Lets SAI see a browser tab you explicitly share, so it can look at what you're looking at
        instead of talking you through it. Nothing is shared until you click the extension's toolbar
        button on a tab — and this slice is read-only: it can snapshot and read text, but never click
        or type.
      </p>

      <div style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
          <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: dotColor }} />
          <span style={{ color: 'var(--text)' }}>{statusText}</span>
        </div>
        {info && (
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            Extension folder: <span style={codeStyle}>{info.extensionDir}</span>
          </div>
        )}
      </div>

      {info && !info.relayBuilt && (
        <div style={{ ...cardStyle, marginTop: 10, borderColor: 'var(--orange)' }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12, color: 'var(--orange)' }}>
            <TriangleAlert size={14} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>
              The relay isn't built yet. Run <span style={codeStyle}>npm run build</span> so{' '}
              <span style={codeStyle}>dist-electron/browser-bridge-host.js</span> exists, then reopen this page.
            </span>
          </div>
        </div>
      )}

      <div className="settings-divider" />

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div className="settings-row-name">Installed browsers</div>
        <button style={buttonStyle} onClick={() => void refresh()} title="Re-scan for browsers">
          <RefreshCw size={12} style={{ verticalAlign: '-2px', marginRight: 5 }} />
          Rescan
        </button>
      </div>

      {!browsers.length && (
        <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          No Chromium-based browser found. Chrome, Chromium, Edge, Brave, Vivaldi, Arc, Dia, and Comet
          are supported; Firefox is not (it has no equivalent of the debugger API this relies on).
        </p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {browsers.map((browser) => {
          const busy = (phase.kind === 'waiting' || phase.kind === 'installing') && phase.browserId === browser.id;
          const ready = browser.hostInstalled && Boolean(browser.extensionId);

          return (
            <div key={browser.id} style={cardStyle}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 6 }}>
                    {browser.label}
                    {ready && <Check size={13} style={{ color: 'var(--green)' }} />}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                    {browser.extensionId
                      ? <>Extension <span style={codeStyle}>{browser.extensionId}</span></>
                      : 'Extension not loaded'}
                    {' · '}
                    {browser.hostInstalled ? 'native host installed' : 'native host missing'}
                  </div>
                </div>

                {ready ? (
                  <button
                    style={buttonStyle}
                    onClick={() => void uninstall(browser.id)}
                    title="Remove the native host manifest for this browser"
                  >
                    <Trash2 size={12} style={{ verticalAlign: '-2px', marginRight: 5 }} />
                    Remove
                  </button>
                ) : (
                  <button
                    style={{
                      ...primaryButtonStyle,
                      opacity: busy || !info?.relayBuilt ? 0.5 : 1,
                      cursor: busy || !info?.relayBuilt ? 'not-allowed' : 'pointer',
                    }}
                    disabled={busy || !info?.relayBuilt}
                    onClick={() => void startDeploy(browser)}
                  >
                    {busy ? 'Deploying…' : `Deploy to ${browser.label}`}
                  </button>
                )}
              </div>

              {phase.kind === 'waiting' && phase.browserId === browser.id && (
                <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.6, borderTop: '1px solid var(--border-hairline)', paddingTop: 8 }}>
                  <div style={{ color: 'var(--text)', marginBottom: 4 }}>
                    {info?.expectedExtensionId
                      ? `Native host registered. One click left — ${browser.label} can't be made to do this part itself.`
                      : `One click left — ${browser.label} can't be made to do this part itself.`}
                  </div>
                  1. Turn on <strong>Developer mode</strong> (top right of the extensions page).<br />
                  2. Click <strong>Load unpacked</strong> and pick the folder revealed in your file manager.<br />
                  {browser.flatpakAppId && (
                    <>
                      &nbsp;&nbsp;&nbsp;It's <span style={codeStyle}>{info?.extensionDir}</span> — press <strong>Ctrl+H</strong> in the picker to show hidden folders.<br />
                    </>
                  )}
                  3. That's it — SAI will spot it and finish up automatically.
                  <div style={{ marginTop: 8, display: 'flex', gap: 6 }}>
                    <button style={buttonStyle} onClick={() => void deploy.revealExtensionFolder()}>
                      <FolderOpen size={12} style={{ verticalAlign: '-2px', marginRight: 5 }} />
                      Reveal folder again
                    </button>
                    <button style={buttonStyle} onClick={() => setPhase({ kind: 'idle' })}>Cancel</button>
                  </div>
                </div>
              )}

              {restartNeeded.has(browser.id) && !status?.connected && (
                <div style={{ fontSize: 11, color: 'var(--text)', lineHeight: 1.6, borderTop: '1px solid var(--border-hairline)', paddingTop: 8, display: 'flex', gap: 6 }}>
                  <TriangleAlert size={13} style={{ color: 'var(--orange, var(--red))', flexShrink: 0, marginTop: 2 }} />
                  <span>
                    {browser.label} was just given access to SAI's bridge folder. Fully quit it (close every
                    window) and reopen it — the sandbox only picks up the new permission on a fresh start.
                  </span>
                </div>
              )}

              {phase.kind === 'done' && phase.browserId === browser.id && (
                <div style={{ fontSize: 11, color: 'var(--green)', borderTop: '1px solid var(--border-hairline)', paddingTop: 8 }}>
                  Deployed. Click the SAI toolbar button on any tab to share it.
                </div>
              )}
            </div>
          );
        })}
      </div>

      {phase.kind === 'error' && (
        <div style={{ ...cardStyle, marginTop: 10, borderColor: 'var(--red)' }}>
          <div style={{ fontSize: 12, color: 'var(--red)' }}>{phase.message}</div>
        </div>
      )}

      {Boolean(browsers.length) && (
        <>
          <div className="settings-divider" />
          <div className="settings-row">
            <div className="settings-row-info">
              <div className="settings-row-name">Enter an extension ID manually</div>
              <div className="settings-row-desc">
                Only needed if auto-detection fails — copy the ID from the extensions page.
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                value={manualId}
                onChange={(e) => setManualId(e.target.value.trim())}
                placeholder="32 characters, a–p"
                spellCheck={false}
                style={{
                  fontSize: 11, padding: '5px 8px', width: 200,
                  background: 'var(--surface-2)', color: 'var(--text)',
                  border: '1px solid var(--border-subtle)', borderRadius: 6,
                  fontFamily: 'monospace',
                }}
              />
              <button
                style={{
                  ...buttonStyle,
                  opacity: /^[a-p]{32}$/.test(manualId) ? 1 : 0.5,
                  cursor: /^[a-p]{32}$/.test(manualId) ? 'pointer' : 'not-allowed',
                }}
                disabled={!/^[a-p]{32}$/.test(manualId)}
                // Chromium derives an unpacked extension's id from its absolute
                // path, so the same folder gets the same id in every browser —
                // one manual id can safely cover all of them.
                onClick={() => void installMany(browsers.map((b) => b.id), manualId)}
              >
                Install host
              </button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
