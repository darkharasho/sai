import { useEffect, useState } from 'react';
import { BEARER_KEY, connect, extractPairCode, pair, type WireClient } from './wire';
import { describeDevice } from './deviceLabel';
import { readPersisted, writePersisted, removePersisted, isNonEmptyString } from './lib/persisted';

const CLIENT_ID_KEY = 'sai.remote.clientId';
const BEARER_VERSION = 1;

interface Bearer { token: string; deviceId: string; label: string }

function validateBearer(raw: unknown): Bearer | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (!isNonEmptyString(o.token)) return null;
  if (!isNonEmptyString(o.deviceId)) return null;
  if (!isNonEmptyString(o.label)) return null;
  return { token: o.token, deviceId: o.deviceId, label: o.label };
}

function loadBearer(): Bearer | null {
  // Migrate legacy unversioned `{token, deviceId, label}` (pre-1.4.5)
  // by re-wrapping it in the versioned envelope on first load.
  const versioned = readPersisted<Bearer | null>(BEARER_KEY, BEARER_VERSION, validateBearer, null);
  if (versioned) return versioned;
  try {
    const raw = localStorage.getItem(BEARER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    // If it parses to a legacy shape (no `v`/`d` envelope), migrate.
    if (parsed && typeof parsed === 'object' && !('v' in parsed) && !('d' in parsed)) {
      const legacy = validateBearer(parsed);
      if (legacy) {
        writePersisted(BEARER_KEY, BEARER_VERSION, legacy);
        return legacy;
      }
    }
  } catch { /* fall through */ }
  removePersisted(BEARER_KEY);
  return null;
}

function randomUUID(): string {
  // crypto.randomUUID requires a secure context; SAI Remote often runs over
  // plain HTTP on LAN, where it's undefined. Fall back to a v4 from getRandomValues,
  // then to Math.random() if even that's missing.
  const c: Crypto | undefined = typeof crypto !== 'undefined' ? crypto : undefined;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  const bytes = new Uint8Array(16);
  if (c && typeof c.getRandomValues === 'function') {
    c.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0'));
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10, 16).join('')}`;
}

function getOrCreateClientId(): string {
  try {
    const existing = localStorage.getItem(CLIENT_ID_KEY);
    if (existing) return existing;
    const created = randomUUID();
    localStorage.setItem(CLIENT_ID_KEY, created);
    return created;
  } catch {
    // localStorage unavailable (private mode / disabled). Per-session fallback.
    return randomUUID();
  }
}
import Status from './Status';
import Chat, { type ChatActive } from './chat/Chat';
import NavDrawer from './chat/NavDrawer';
import SaiLogo from './branding/SaiLogo';
import { createWorkspaceStatusStore, type WorkspaceStatus, type WorkspaceStatusStore } from './lib/workspaceStatusStore';

const workspaceStatusStore: WorkspaceStatusStore = createWorkspaceStatusStore();

function OfflineBanner({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <div style={{
      position: 'fixed',
      top: 0, left: 0, right: 0,
      paddingTop: 'calc(6px + env(safe-area-inset-top))',
      paddingBottom: 6,
      paddingLeft: 'max(12px, env(safe-area-inset-left))',
      paddingRight: 'max(12px, env(safe-area-inset-right))',
      background: 'var(--red)',
      color: '#000',
      fontSize: 12,
      fontFamily: '"Geist Mono", ui-monospace, monospace',
      textAlign: 'center',
      zIndex: 1000,
      pointerEvents: 'none',
    }}>
      offline — reconnecting when network returns
    </div>
  );
}

function ConnectedShell({ client }: { client: WireClient }) {
  const [workspacePath, setWorkspacePath] = useState<string>('');
  const [metaMembers, setMetaMembers] = useState<{ projectPath: string; name: string }[] | undefined>(undefined);
  const [navOpen, setNavOpen] = useState(false);
  const [follow, setFollow] = useState(true);
  const [active, setActive] = useState<ChatActive | null>(null);

  useEffect(() => {
    return client.on((msg) => {
      const t = (msg as any).type;
      if (t === 'session.active') {
        const p = (msg as any).projectPath ?? '';
        setWorkspacePath(p);
      }
    });
  }, [client]);

  useEffect(() => {
    client.subscribeWorkspaceStatus();
    const off = client.on((msg) => {
      if ((msg as any).type === 'workspace.status') {
        const m = msg as any;
        workspaceStatusStore.set(m.projectPath, m.status as WorkspaceStatus);
      }
    });
    return () => { client.unsubscribeWorkspaceStatus(); off(); };
  }, [client]);

  useEffect(() => {
    if (!workspacePath) { setMetaMembers(undefined); return; }
    client.listWorkspaces()
      .then((ws) => {
        const me = (ws as any[]).find((w) => w.projectPath === workspacePath);
        if (me && me.kind === 'meta' && Array.isArray(me.members)) setMetaMembers(me.members);
        else setMetaMembers(undefined);
      })
      .catch(() => setMetaMembers(undefined));
  }, [client, workspacePath]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%' }}>
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
        <Chat
          client={client}
          statusStore={workspaceStatusStore}
          active={active}
          onActiveChange={setActive}
          follow={follow}
          onFollowChange={setFollow}
          onOpenNav={() => setNavOpen(true)}
        />
      </div>
      <NavDrawer
        open={navOpen}
        onClose={() => setNavOpen(false)}
        client={client}
        workspacePath={workspacePath}
        metaMembers={metaMembers}
        currentSessionProjectPath={workspacePath || null}
        currentSessionId={active?.sessionId ?? null}
        statusStore={workspaceStatusStore}
        followEnabled={follow}
        onFollowChange={setFollow}
        onAttach={(projectPath, sessionId) => {
          // Drive Chat's active state from the picker so its own useEffect
          // dispatches attach + resets messages. Without this, client.attach
          // would fire but Chat's active stayed stale.
          setActive({ projectPath, scope: 'chat', sessionId });
        }}
      />
    </div>
  );
}

export default function App() {
  const [phase, setPhase] = useState<'init' | 'pairing' | 'connected' | 'needs-pair' | 'error'>('init');
  const [error, setError] = useState<string | null>(null);
  const [wsState, setWsState] = useState<'opening' | 'open' | 'closed'>('opening');
  const [client, setClient] = useState<WireClient | null>(null);
  const [online, setOnline] = useState<boolean>(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        let bearer = loadBearer();
        const code = extractPairCode(location.href);
        // If we already have a bearer, prefer it over any `?code=` in the URL.
        // Bookmarked QR-landing URLs keep the (now-expired) code forever, so
        // re-pairing on every visit would 401 after the 2-minute TTL. Strip the
        // stale code from the URL so a refresh doesn't keep retrying. To
        // explicitly re-pair, the user disconnects (which clears the bearer)
        // and scans a new QR.
        if (code && bearer) {
          history.replaceState(null, '', location.pathname);
        }
        if (code && !bearer) {
          setPhase('pairing');
          const clientId = getOrCreateClientId();
          const label = describeDevice(navigator.userAgent, clientId);
          const { token, deviceId } = await pair(code, label, clientId);
          const wrote = writePersisted<Bearer>(BEARER_KEY, BEARER_VERSION, { token, deviceId, label });
          if (!wrote) {
            setError('Could not save pairing — storage is full or disabled. Try clearing browser data and re-pairing.');
            setPhase('error');
            return;
          }
          history.replaceState(null, '', location.pathname);
          bearer = { token, deviceId, label };
        }
        if (!bearer) { setPhase('needs-pair'); return; }
        const { token } = bearer;
        const c = connect(token);
        let everAuthed = false;
        let closeStreak = 0;
        c.onState((s) => {
          setWsState(s);
          // If we hit 'closed' before any auth_ok arrived, the bearer is stale.
          // After two close events with no auth, drop it and surface re-pair.
          if (s === 'closed' && !everAuthed) {
            closeStreak++;
            if (closeStreak >= 2) {
              try { c.close(); } catch { /* ignore */ }
              removePersisted(BEARER_KEY);
              setPhase('needs-pair');
            }
          }
        });
        c.on((msg) => {
          if (msg.type === 'auth_ok') { everAuthed = true; closeStreak = 0; setPhase('connected'); }
        });
        setClient(c);
      } catch (err) {
        setError((err as Error).message);
        setPhase('error');
      }
    })();
  }, []);

  const disconnect = () => {
    client?.close();
    removePersisted(BEARER_KEY);
    location.reload();
  };

  if (phase === 'connected' && client) {
    if (wsState !== 'open') {
      return (
        <>
          <OfflineBanner show={!online} />
          <Status deviceLabel="" serverUrl={location.origin} wsState={wsState} onDisconnect={disconnect} />
        </>
      );
    }
    return (
      <>
        <OfflineBanner show={!online} />
        <ConnectedShell client={client} />
      </>
    );
  }

  const mode = phase === 'init' || phase === 'pairing' ? 'scanner' : phase === 'error' ? 'static' : 'idle';

  return (
    <div style={{
      minHeight: '100svh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 32,
      paddingTop: 'max(32px, env(safe-area-inset-top))',
      paddingBottom: 'max(32px, env(safe-area-inset-bottom))',
      paddingLeft: 'max(32px, env(safe-area-inset-left))',
      paddingRight: 'max(32px, env(safe-area-inset-right))',
      gap: 18,
      textAlign: 'center',
      background: 'var(--bg-primary)',
      color: 'var(--text)',
    }}>
      <OfflineBanner show={!online} />
      <SaiLogo mode={mode} size={64} color="var(--accent)" />
      <h1 style={{ margin: 0, fontSize: 22, fontWeight: 600, letterSpacing: '-0.01em' }}>SAI Remote</h1>
      {phase === 'init' && <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)', fontFamily: '"Geist Mono", ui-monospace, monospace' }}>connecting…</p>}
      {phase === 'pairing' && <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)', fontFamily: '"Geist Mono", ui-monospace, monospace' }}>pairing…</p>}
      {phase === 'needs-pair' && (
        <div style={{ maxWidth: 320 }}>
          <p style={{ margin: 0, fontSize: 14, color: 'var(--text)', marginBottom: 8 }}>Re-pair required</p>
          <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
            Open SAI on your computer, go to Settings → Mobile Remote → Pair a new device, and scan the QR code with your phone camera.
          </p>
        </div>
      )}
      {phase === 'error' && (
        <p style={{ margin: 0, fontSize: 13, color: 'var(--red)', fontFamily: '"Geist Mono", ui-monospace, monospace' }}>
          {error}
        </p>
      )}
    </div>
  );
}
