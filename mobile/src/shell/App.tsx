// The phone app shell: pairing and machines, then a header + drawer around the
// desktop's real ChatPanel (ChatHost) for the chosen workspace and chat.
//
// Imported only after main.tsx has installed window.sai (the chat graph reads
// settings at import time).
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { ErrorBoundary } from '../../../src/ErrorBoundary';
import {
  HIGHLIGHT_THEMES, THEMES, applyTheme, getActiveHighlightTheme, setAccent, setActiveHighlightTheme, type HighlightThemeId, type ThemeId,
} from '../../../src/themes';
import { isAccentId } from '../../../src/accents';
import type { ChatMeta } from '../../../src/lib/chat/types';
import type { RemoteWorkspace } from '../../../electron/services/remote/renderer-proxy';
import { getNative } from '../native';
import { newClientId } from '../v2/saiShim';
import { useMachines } from '../machines/hooks';
import { MachineList } from '../machines/MachineList';
import { PairScreen } from '../machines/PairScreen';
import { getToken, listMachines, type Machine } from '../machines/store';
import {
  connectTo, disconnect, getActive, getAppSettings, onActive, onAppSettings, type ActiveConnection,
} from './connection';
import { ChatHost, useMirroredState } from './ChatHost';
import { Drawer, chatTitleOf } from './Drawer';
import { Header, chatStatus } from './Header';
import { startLifecycle, syncStatusBar, trackViewport, useConnState } from './lifecycle';
import { Toasts, showToast, useConnectionToasts } from './Toasts';

const ACTIVE_MACHINE_KEY = 'sai.activeMachine.v1';
const SELECTION_KEY = 'sai.selection.v1';

interface Selection { projectPath: string | null; chatId: string | null }

function loadSelection(machineId: string): Selection {
  try {
    const all = JSON.parse(localStorage.getItem(SELECTION_KEY) ?? '{}');
    const s = all?.[machineId];
    return { projectPath: typeof s?.projectPath === 'string' ? s.projectPath : null, chatId: typeof s?.chatId === 'string' ? s.chatId : null };
  } catch {
    return { projectPath: null, chatId: null };
  }
}

function saveSelection(machineId: string, sel: Selection): void {
  try {
    const all = JSON.parse(localStorage.getItem(SELECTION_KEY) ?? '{}') ?? {};
    all[machineId] = sel;
    localStorage.setItem(SELECTION_KEY, JSON.stringify(all));
  } catch { /* storage unavailable: selection is per-session */ }
}

/** The shim's native surface: Capacitor plugins plus the shell's toasts. */
const native = () => ({ ...getNative(), toast: (m: string) => { showToast(m); } });

/** Theme, accent and highlight theme follow the desktop (only what changed is re-applied). */
function useAppearance(settings: Record<string, unknown>): void {
  const prev = useRef<Record<string, unknown>>(settings);
  useEffect(() => {
    const p = prev.current;
    prev.current = settings;
    if (p === settings) { void syncStatusBar(); return; }
    if (settings.accent !== p.accent) setAccent(isAccentId(settings.accent) ? settings.accent : null);
    if (settings.theme !== p.theme) {
      const theme = THEMES.some((t) => t.id === settings.theme) ? settings.theme as ThemeId : 'default';
      applyTheme(theme);
    }
    const hl = settings.highlightTheme;
    if (hl !== p.highlightTheme && HIGHLIGHT_THEMES.some((t) => t.id === hl) && hl !== getActiveHighlightTheme()) {
      setActiveHighlightTheme(hl as HighlightThemeId);
    }
    void syncStatusBar();
  }, [settings]);
}

type View = 'boot' | 'pair' | 'machines' | 'chat';

export function PhoneApp() {
  const machinesApi = useMachines();
  const [view, setView] = useState<View>('boot');
  const [conn, setConn] = useState<ActiveConnection | null>(getActive());
  const [settings, setSettings] = useState(getAppSettings());
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [workspaces, setWorkspaces] = useState<RemoteWorkspace[]>([]);
  const [chats, setChats] = useState<ChatMeta[]>([]);
  const [sel, setSel] = useState<Selection>({ projectPath: null, chatId: null });

  useEffect(() => onActive(setConn), []);
  useEffect(() => onAppSettings(setSettings), []);
  useEffect(() => startLifecycle(() => getActive()?.client ?? null), []);
  useEffect(() => trackViewport(), []);
  useAppearance(settings);

  const machine = useMemo(() => machinesApi.machines.find((m) => m.id === conn?.machineId) ?? null, [machinesApi.machines, conn]);
  const connState = useConnState(conn?.client ?? null);

  const openMachine = useCallback(async (m: Machine) => {
    const token = await getToken(m.id).catch(() => null);
    if (!token) {
      showToast(`Re-pair ${m.label}`);
      setView('pair');
      return;
    }
    connectTo(m, token, { native: native() });
    localStorage.setItem(ACTIVE_MACHINE_KEY, m.id);
    setSel(loadSelection(m.id));
    setWorkspaces([]);
    setChats([]);
    setDrawerOpen(false);
    setView('chat');
  }, []);

  // Boot: reconnect to the last machine, else the machine list or pairing.
  useEffect(() => {
    const list = listMachines();
    const last = list.find((m) => m.id === localStorage.getItem(ACTIVE_MACHINE_KEY));
    if (last) void openMachine(last);
    else setView(list.length ? 'machines' : 'pair');
  }, [openMachine]);

  useConnectionToasts(conn?.client ?? null, machine?.label ?? 'desktop', () => setView('pair'));

  // Workspaces (workspaces.subscribe; re-sent by the client after reconnects).
  useEffect(() => {
    if (!conn) { setWorkspaces([]); return; }
    const set = (f: { workspaces?: unknown }) => setWorkspaces(Array.isArray(f.workspaces) ? f.workspaces as RemoteWorkspace[] : []);
    const offA = conn.client.on('workspaces.list.result', set);
    const offB = conn.client.on('workspaces.changed', set);
    conn.client.send({ type: 'workspaces.subscribe' });
    return () => { offA(); offB(); };
  }, [conn]);

  // Default workspace: the selected one if still open, else the desktop's active one.
  useEffect(() => {
    if (!workspaces.length || (sel.projectPath && workspaces.some((w) => w.projectPath === sel.projectPath))) return;
    const pick = workspaces.find((w) => w.state === 'active') ?? workspaces[0];
    setSel({ projectPath: pick.projectPath, chatId: null });
  }, [workspaces, sel.projectPath]);

  // The workspace's chat list (chats.subscribe, newest first in the drawer).
  const projectPath = sel.projectPath;
  useEffect(() => {
    setChats([]);
    if (!conn || !projectPath) return;
    const set = (f: { projectPath?: unknown; chats?: unknown }) => {
      if (f.projectPath === projectPath && Array.isArray(f.chats)) setChats(f.chats as ChatMeta[]);
    };
    const offA = conn.client.on('chats.list.result', set);
    const offB = conn.client.on('chats.changed', set);
    conn.client.send({ type: 'chats.subscribe', projectPath, reqId: `chats-${newClientId()}` });
    return () => {
      offA(); offB();
      conn.client.send({ type: 'chats.unsubscribe', projectPath });
    };
  }, [conn, projectPath]);

  useEffect(() => { if (conn) saveSelection(conn.machineId, sel); }, [conn, sel]);

  const chatState = useMirroredState(conn?.mirror ?? NO_MIRROR, sel.chatId);
  const meta = chats.find((c) => c.chatId === sel.chatId) ?? null;
  const workspace = workspaces.find((w) => w.projectPath === sel.projectPath) ?? null;
  const status = sel.chatId ? chatStatus(chatState, meta) : null;
  const firstUser = chatState?.messages.find((m) => m.role === 'user')?.content;
  const chatTitle = !sel.chatId ? null
    : meta?.title?.trim() || (typeof firstUser === 'string' && firstUser.trim() ? firstUser.trim().slice(0, 40) : (meta ? chatTitleOf(meta) : 'New chat'));

  const newChat = useCallback(() => {
    if (!sel.projectPath) { setDrawerOpen(true); return; }
    // The desktop's chat ids are crypto.randomUUID(); the first send creates the log.
    setSel((s) => ({ ...s, chatId: newClientId() }));
    setDrawerOpen(false);
  }, [sel.projectPath]);

  const onPaired = useCallback((m: Machine) => {
    // A re-paired machine must drop its connection with the refused token.
    if (getActive()?.machineId === m.id) disconnect();
    machinesApi.refresh();
    void openMachine(m);
  }, [machinesApi, openMachine]);

  const onRemove = useCallback(async (id: string) => {
    if (getActive()?.machineId === id) {
      disconnect();
      localStorage.removeItem(ACTIVE_MACHINE_KEY);
    }
    await machinesApi.remove(id).catch(() => showToast("Couldn't remove that machine"));
    setView(listMachines().length ? 'machines' : 'pair');
  }, [machinesApi]);

  if (view === 'boot') return <div className="sai-phone-app" />;

  if (view === 'pair') {
    return (
      <div className="sai-phone-app sai-phone-scroll">
        <PairScreen onPaired={onPaired} onCancel={machinesApi.machines.length ? () => setView(conn ? 'chat' : 'machines') : undefined} />
        <Toasts />
      </div>
    );
  }

  if (view === 'machines' || !conn) {
    return (
      <div className="sai-phone-app sai-phone-scroll">
        {conn && <button type="button" className="sai-phone-back" onClick={() => setView('chat')}>‹ Back</button>}
        <MachineList
          machines={machinesApi.machines}
          reach={machinesApi.reach}
          onSelect={(m) => { void openMachine(m); }}
          onRename={machinesApi.rename}
          onRemove={(id) => { void onRemove(id); }}
          onAdd={() => setView('pair')}
        />
        <Toasts />
      </div>
    );
  }

  return (
    <div className="sai-phone-app">
      <Header
        workspaceName={workspace?.name ?? null}
        chatTitle={chatTitle}
        status={status}
        onMenu={() => setDrawerOpen(true)}
        onNewChat={newChat}
        onMachines={() => { machinesApi.refresh(); setView('machines'); }}
      />
      {connState === 'catching_up' && <div className="sai-phone-pill" role="status">Catching up…</div>}
      <main className="sai-phone-main">
        {sel.chatId && sel.projectPath ? (
          <ChatHost
            key={`${conn.machineId}:${sel.chatId}`}
            chatId={sel.chatId}
            projectPath={meta?.projectPath ?? sel.projectPath}
            mirror={conn.mirror}
            appSettings={settings}
          />
        ) : (
          <div className="sai-phone-placeholder">
            <p>{sel.projectPath ? 'Pick a chat or start a new one.' : 'Pick a workspace.'}</p>
            <button type="button" className="sai-phone-primary" onClick={() => setDrawerOpen(true)}>Open chats</button>
            {sel.projectPath && <button type="button" className="sai-phone-secondary" onClick={newChat}>New chat</button>}
          </div>
        )}
      </main>
      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        machines={machinesApi.machines}
        activeMachineId={conn.machineId}
        onPickMachine={(m) => { if (m.id !== conn.machineId) void openMachine(m); else setDrawerOpen(false); }}
        onManageMachines={() => { setDrawerOpen(false); machinesApi.refresh(); setView('machines'); }}
        workspaces={workspaces}
        activeProjectPath={sel.projectPath}
        onPickWorkspace={(p) => setSel((s) => (s.projectPath === p ? s : { projectPath: p, chatId: null }))}
        chats={chats}
        activeChatId={sel.chatId}
        activeStatus={status}
        activeTitle={chatTitle}
        onPickChat={(chatId) => { setSel((s) => ({ ...s, chatId })); setDrawerOpen(false); }}
        onNewChat={newChat}
      />
      <Toasts />
    </div>
  );
}

const NO_MIRROR = { get: () => null, subscribe: () => () => {}, tapOpen: <T,>(_c: string, _a: number, p: Promise<T>) => p, ingest: () => {}, forget: () => {} };

export function mountApp(root: HTMLElement): void {
  ReactDOM.createRoot(root).render(
    <ErrorBoundary>
      <PhoneApp />
    </ErrorBoundary>,
  );
}
