import { useEffect, useState } from 'react';
import { BEARER_KEY, connect, extractPairCode, pair, type WireClient } from './wire';
import Status from './Status';
import Chat, { type ChatActive } from './chat/Chat';
import NavDrawer from './chat/NavDrawer';
import SaiLogo from './branding/SaiLogo';
import { createWorkspaceStatusStore, type WorkspaceStatus, type WorkspaceStatusStore } from './lib/workspaceStatusStore';

const workspaceStatusStore: WorkspaceStatusStore = createWorkspaceStatusStore();

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

  useEffect(() => {
    void (async () => {
      try {
        let bearer = localStorage.getItem(BEARER_KEY);
        const code = extractPairCode(location.href);
        if (code && !bearer) {
          setPhase('pairing');
          const label = navigator.userAgent.slice(0, 64);
          const { token, deviceId } = await pair(code, label);
          localStorage.setItem(BEARER_KEY, JSON.stringify({ token, deviceId, label }));
          history.replaceState(null, '', location.pathname);
          bearer = localStorage.getItem(BEARER_KEY);
        }
        if (!bearer) { setPhase('needs-pair'); return; }
        const { token } = JSON.parse(bearer);
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
              localStorage.removeItem(BEARER_KEY);
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
    localStorage.removeItem(BEARER_KEY);
    location.reload();
  };

  if (phase === 'connected' && client) {
    if (wsState !== 'open') {
      return <Status deviceLabel="" serverUrl={location.origin} wsState={wsState} onDisconnect={disconnect} />;
    }
    return <ConnectedShell client={client} />;
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
      gap: 18,
      textAlign: 'center',
      background: 'var(--bg-primary)',
      color: 'var(--text)',
    }}>
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
