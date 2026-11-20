// The phone app shell: pairing and machines, then home (every workspace and its
// chats) and the desktop's real ChatPanel (ChatHost) for the chosen chat.
//
// Imported only after main.tsx has installed window.sai (the chat graph reads
// settings at import time).
import { ChevronLeft } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { ErrorBoundary } from '../../../src/ErrorBoundary';
import {
  HIGHLIGHT_THEMES, THEMES, applyTheme, getActiveHighlightTheme, setAccent, setActiveHighlightTheme, type HighlightThemeId, type ThemeId,
} from '../../../src/themes';
import { isAccentId } from '../../../src/accents';
import type { ChatMeta } from '../../../src/lib/chat/types';
import type { RemoteWorkspace } from '../../../electron/services/remote/renderer-proxy';
import { getNative, type PushPermission } from '../native';
import { newClientId } from '../v2/saiShim';
import { useMachines } from '../machines/hooks';
import { MachineList } from '../machines/MachineList';
import { PairScreen } from '../machines/PairScreen';
import { getToken, listMachines, type Machine } from '../machines/store';
import { currentPushIdentity, ensurePushRegistration, linkMachine, onPushIdentity, retryPendingRevokes } from '../push/registration';
import { getPresence } from '../push/presence';
import { parseTap, routeTap } from '../push/routing';
import {
  connectTo, disconnect, getActive, getAppSettings, onActive, onAppSettings, type ActiveConnection,
} from './connection';
import { ChatHost, useMirroredState } from './ChatHost';
import { chatTitleOf, type OpenChat } from './chatRows';
import { useDrawerSwipe } from './drawerSwipe';
import { Header, chatStatus } from './Header';
import { Home, type DesktopNow } from './Home';
import { Switcher } from './Switcher';
import { startLifecycle, syncStatusBar, trackViewport, useConnState } from './lifecycle';
import { Toasts, showRepairToast, showToast, useConnectionToasts } from './Toasts';

const ACTIVE_MACHINE_KEY = 'sai.activeMachine.v1';
const SELECTION_KEY = 'sai.selection.v1';
/** machineId → projectPath → the chat last open in that workspace. */
const LAST_CHATS_KEY = 'sai.lastChats.v1';

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

function readLastChats(): Record<string, Record<string, string>> {
  try {
    const all = JSON.parse(localStorage.getItem(LAST_CHATS_KEY) ?? '{}');
    return all && typeof all === 'object' ? all : {};
  } catch { return {}; }
}

/** The chat last open in this workspace (switching workspaces back returns to it). */
/** machineId → the desktop focus (projectPath + chat) the phone last followed. */
const FOLLOWED_KEY = 'sai.followedFocus.v1';
function followedFocus(machineId: string): string | null {
  try { const v = JSON.parse(localStorage.getItem(FOLLOWED_KEY) ?? '{}')?.[machineId]; return typeof v === 'string' ? v : null; } catch { return null; }
}
function rememberFollowed(machineId: string, key: string): void {
  try {
    const all = JSON.parse(localStorage.getItem(FOLLOWED_KEY) ?? '{}');
    localStorage.setItem(FOLLOWED_KEY, JSON.stringify({ ...(all && typeof all === 'object' ? all : {}), [machineId]: key }));
  } catch { /* storage full: follow again next time */ }
}
/** The workspace and chat focused on the desktop, if it reported one. */
export function desktopFocus(workspaces: RemoteWorkspace[]): { projectPath: string; chatId: string | null } | null {
  const w = workspaces.find((x) => x.state === 'active');
  return w ? { projectPath: w.projectPath, chatId: w.activeChatId ?? null } : null;
}

function lastChatFor(machineId: string, projectPath: string): string | null {
  const id = readLastChats()[machineId]?.[projectPath];
  return typeof id === 'string' ? id : null;
}

function rememberChat(machineId: string, sel: Selection): void {
  if (!sel.projectPath || !sel.chatId) return;
  try {
    const all = readLastChats();
    const forMachine = all[machineId] && typeof all[machineId] === 'object' ? all[machineId] : {};
    if (forMachine[sel.projectPath] === sel.chatId) return;
    all[machineId] = { ...forMachine, [sel.projectPath]: sel.chatId };
    localStorage.setItem(LAST_CHATS_KEY, JSON.stringify(all));
  } catch { /* storage unavailable */ }
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
  // Home (every workspace and its chats) vs. the open chat.
  const [home, setHome] = useState(true);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [shellEl, setShellEl] = useState<HTMLDivElement | null>(null);
  // Back to home: drag the chat right from the left edge (home sits underneath).
  const backSwipe = useDrawerSwipe(shellEl, home, setHome, { enabled: !home, width: () => window.innerWidth, layer: '.sai-phone-home' });
  const [workspaces, setWorkspaces] = useState<RemoteWorkspace[]>([]);
  /** projectPath → its chats (chats.subscribe for every open workspace). */
  const [chatsByWs, setChatsByWs] = useState<Record<string, ChatMeta[] | null>>({});
  const [sel, setSel] = useState<Selection>({ projectPath: null, chatId: null });

  useEffect(() => onActive(setConn), []);
  useEffect(() => onAppSettings(setSettings), []);
  const [notifPerm, setNotifPerm] = useState<PushPermission | null>(null);
  const lastPerm = useRef<PushPermission | null>(null);
  const refreshNotifPerm = useCallback(() => {
    const push = getNative().push;
    if (!push) return;
    void push.checkPermission().then((p) => {
      const prev = lastPerm.current;
      lastPerm.current = p;
      setNotifPerm(p);
      // Turned on in iOS Settings since we last looked: register now, not at the next launch.
      if (p === 'granted' && prev !== null && prev !== 'granted' && listMachines().length && !currentPushIdentity(getNative())) {
        void ensurePushRegistration(getNative());
      }
    }, () => {});
  }, []);
  useEffect(() => { refreshNotifPerm(); }, [refreshNotifPerm]);
  useEffect(() => startLifecycle(() => getActive()?.client ?? null, (isActive) => {
    getPresence().setForeground(isActive);
    if (isActive) refreshNotifPerm(); // back from iOS Settings
  }), [refreshNotifPerm]);
  useEffect(() => trackViewport(), []);
  useAppearance(settings);

  const machine = useMemo(() => machinesApi.machines.find((m) => m.id === conn?.machineId) ?? null, [machinesApi.machines, conn]);
  const connState = useConnState(conn?.client ?? null);

  // Only the latest openMachine applies (a notification tap can race the boot reconnect).
  const openSeq = useRef(0);
  const openMachine = useCallback(async (m: Machine) => {
    const seq = ++openSeq.current;
    // Already connected: keep its connection, subscriptions and selection.
    if (getActive()?.machineId === m.id) {
      setSwitcherOpen(false);
      setView('chat');
      return;
    }
    const token = await getToken(m.id).catch(() => null);
    if (seq !== openSeq.current) return;
    if (!token) {
      showRepairToast(m.label, () => setView('pair'));
      setView('machines');
      return;
    }
    connectTo(m, token, { native: native() });
    localStorage.setItem(ACTIVE_MACHINE_KEY, m.id);
    setSel(loadSelection(m.id));
    setWorkspaces([]);
    setChatsByWs({});
    setSwitcherOpen(false);
    setHome(true);
    setView('chat');
  }, []);

  // Boot: reconnect to the last machine, else the machine list or pairing.
  useEffect(() => {
    const list = listMachines();
    const last = list.find((m) => m.id === localStorage.getItem(ACTIVE_MACHINE_KEY));
    if (last) void openMachine(last);
    else setView(list.length ? 'machines' : 'pair');
    // Push: only once something is paired (the permission prompt follows a pairing, never precedes it).
    if (list.length) void ensurePushRegistration(getNative(), { prompt: true });
    // Revokes a removed machine left unconfirmed (ensure retries them too).
    else void retryPendingRevokes(getNative());
  }, [openMachine]);

  // Push link: (re)send push.register on every auth_ok and whenever the relay identity changes.
  useEffect(() => {
    if (!conn) return;
    const n = getNative();
    const link = () => {
      const m = listMachines().find((x) => x.id === conn.machineId);
      if (m) void linkMachine(m, conn.client, n);
    };
    const offAuth = conn.client.onAuth(link);
    const offId = onPushIdentity(n, link);
    if (conn.client.connected) link();
    return () => { offAuth(); offId(); };
  }, [conn]);

  // Presence: the chat on screen, re-sent on every auth_ok.
  useEffect(() => getPresence().attach(conn?.client ?? null), [conn]);
  const showHome = home || !sel.chatId || !sel.projectPath;
  useEffect(() => { getPresence().setChat(view === 'chat' && !showHome ? sel.chatId : null); }, [view, showHome, sel.chatId]);

  // Notification taps: machine → workspace → chat; an unknown machine opens the list.
  const onTap = useRef<(data: Record<string, unknown>) => void>(() => {});
  onTap.current = (data) => {
    const route = routeTap(parseTap(data), listMachines());
    if (route.kind === 'machines') {
      setSwitcherOpen(false);
      machinesApi.refresh();
      setView(listMachines().length ? 'machines' : 'pair');
      return;
    }
    const next: Selection = { projectPath: route.projectPath, chatId: route.chatId };
    if (!route.projectPath) {
      void openMachine(route.machine);
      return;
    }
    saveSelection(route.machine.id, next);
    if (getActive()?.machineId === route.machine.id) {
      openSeq.current++; // a slower open of another machine must not win
      setSel(next);
      setSwitcherOpen(false);
      setHome(!next.chatId);
      setView('chat');
    } else {
      void openMachine(route.machine);
    }
  };
  useEffect(() => getNative().push?.onAction((d) => onTap.current(d)), []);

  useEffect(() => { if (view === 'machines') refreshNotifPerm(); }, [view, refreshNotifPerm]);

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

  // Taking the desktop's conversation on the go: when the desktop's focus (its
  // active workspace and the chat open there) differs from the one last
  // followed, the phone opens it. Navigating on the phone sticks until the
  // desktop's focus moves again.
  const focus = desktopFocus(workspaces);
  const focusKey = focus ? `${focus.projectPath}\n${focus.chatId ?? ''}` : null;
  useEffect(() => {
    if (!conn || !focus || !focusKey || followedFocus(conn.machineId) === focusKey) return;
    rememberFollowed(conn.machineId, focusKey);
    const chatId = focus.chatId ?? lastChatFor(conn.machineId, focus.projectPath);
    setSel({ projectPath: focus.projectPath, chatId });
    if (chatId) setHome(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conn, focusKey]);

  // The open chat's workspace closed on the desktop: back to home.
  useEffect(() => {
    if (!workspaces.length || !sel.projectPath || workspaces.some((w) => w.projectPath === sel.projectPath)) return;
    setSel({ projectPath: null, chatId: null });
    setHome(true);
  }, [workspaces, sel.projectPath]);

  // Every open workspace's chat list (chats.subscribe; pushed on any row change).
  const wsKey = workspaces.map((w) => w.projectPath).join('\n');
  useEffect(() => {
    if (!conn || !wsKey) return;
    const paths = wsKey.split('\n');
    const set = (f: { projectPath?: unknown; chats?: unknown }) => {
      const pp = f.projectPath;
      if (typeof pp === 'string' && paths.includes(pp) && Array.isArray(f.chats)) {
        const chats = f.chats as ChatMeta[];
        setChatsByWs((m) => ({ ...m, [pp]: chats }));
      }
    };
    const offA = conn.client.on('chats.list.result', set);
    const offB = conn.client.on('chats.changed', set);
    for (const projectPath of paths) conn.client.send({ type: 'chats.subscribe', projectPath, reqId: `chats-${newClientId()}` });
    return () => {
      offA(); offB();
      for (const projectPath of paths) conn.client.send({ type: 'chats.unsubscribe', projectPath });
    };
  }, [conn, wsKey]);

  useEffect(() => {
    if (!conn) return;
    saveSelection(conn.machineId, sel);
    rememberChat(conn.machineId, sel);
  }, [conn, sel]);

  const chatState = useMirroredState(conn?.mirror ?? NO_MIRROR, sel.chatId);
  const meta = (sel.projectPath ? chatsByWs[sel.projectPath] : null)?.find((c) => c.chatId === sel.chatId) ?? null;
  const workspace = workspaces.find((w) => w.projectPath === sel.projectPath) ?? null;
  const status = sel.chatId ? chatStatus(chatState, meta) : null;
  const firstUser = chatState?.messages.find((m) => m.role === 'user')?.content;
  const chatTitle = !sel.chatId ? null
    : meta?.title?.trim() || (typeof firstUser === 'string' && firstUser.trim() ? firstUser.trim().slice(0, 40) : (meta ? chatTitleOf(meta) : 'New chat'));

  const openChat = useCallback((projectPath: string, chatId: string) => {
    setSel({ projectPath, chatId });
    setSwitcherOpen(false);
    setHome(false);
  }, []);
  // The desktop's chat ids are crypto.randomUUID(); the first send creates the log.
  const newChat = useCallback((projectPath: string) => openChat(projectPath, newClientId()), [openChat]);

  const openChatInfo: OpenChat = { chatId: showHome ? null : sel.chatId, status, title: chatTitle };
  let desktopNow: DesktopNow | null = null;
  if (focus?.chatId) {
    const m = chatsByWs[focus.projectPath]?.find((c) => c.chatId === focus.chatId) ?? null;
    const isOpen = !showHome && focus.chatId === sel.chatId;
    desktopNow = {
      projectPath: focus.projectPath,
      chatId: focus.chatId,
      workspaceName: workspaces.find((w) => w.projectPath === focus.projectPath)?.name ?? null,
      title: isOpen && chatTitle ? chatTitle : m ? chatTitleOf(m) : 'New chat',
      status: isOpen && status ? status : chatStatus(null, m),
    };
  }

  const onPaired = useCallback((m: Machine) => {
    // A re-paired machine must drop its connection with the refused token.
    if (getActive()?.machineId === m.id) disconnect();
    machinesApi.refresh();
    void openMachine(m);
    // After a successful pairing: ask for notification permission (iOS shows it once).
    void ensurePushRegistration(getNative(), { prompt: true }).then(refreshNotifPerm);
  }, [machinesApi, openMachine, refreshNotifPerm]);

  const onRemove = useCallback(async (id: string) => {
    const live = getActive()?.machineId === id ? getActive() : null;
    // push.unregister goes out synchronously over the live socket, before it closes.
    const removing = machinesApi.remove(id, live?.client ?? null);
    if (live) {
      disconnect();
      localStorage.removeItem(ACTIVE_MACHINE_KEY);
    }
    await removing.catch(() => showToast("Couldn't remove that machine"));
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
        {conn && <button type="button" className="sai-phone-back" onClick={() => setView('chat')}><ChevronLeft size={20} aria-hidden="true" />Back</button>}
        <MachineList
          machines={machinesApi.machines}
          reach={machinesApi.reach}
          onSelect={(m) => { void openMachine(m); }}
          onRename={machinesApi.rename}
          onRemove={(id) => { void onRemove(id); }}
          onAdd={() => setView('pair')}
          notifications={notifPerm ? { permission: notifPerm, onOpenSettings: () => { void getNative().openSettings?.(); } } : undefined}
        />
        <Toasts />
      </div>
    );
  }

  const sw = backSwipe.swipe;
  const toMachines = () => { machinesApi.refresh(); setView('machines'); };
  return (
    <div className="sai-phone-app" ref={setShellEl}>
      {(showHome || sw) && (
        <Home
          machineLabel={machine?.label ?? 'Desktop'}
          workspaces={workspaces}
          chatsByWs={chatsByWs}
          desktop={desktopNow}
          open={openChatInfo}
          onOpenChat={openChat}
          onNewChat={newChat}
          onMachines={toMachines}
          underneath={!showHome}
        />
      )}
      {!showHome && sel.chatId && sel.projectPath && (
        <div
          className={`sai-phone-chatview${sw ? (sw.settling ? ' is-settling' : ' is-dragging') : ''}`}
          style={sw ? { transform: `translateX(${sw.x + sw.width}px)` } : undefined}
          onTransitionEnd={(e) => { if (e.target === e.currentTarget && sw?.settling) backSwipe.settled(); }}
        >
          <Header
            workspaceName={workspace?.name ?? null}
            chatTitle={chatTitle}
            status={status}
            onBack={() => { setSwitcherOpen(false); setHome(true); }}
            onSwitch={() => setSwitcherOpen(true)}
            onNewChat={() => newChat(sel.projectPath!)}
            onMachines={toMachines}
          />
          {connState === 'catching_up' && <div className="sai-phone-pill" role="status">Catching up…</div>}
          <main className="sai-phone-main">
            <ChatHost
              key={`${conn.machineId}:${sel.chatId}`}
              chatId={sel.chatId}
              projectPath={meta?.projectPath ?? sel.projectPath}
              conn={conn}
              appSettings={settings}
            />
          </main>
        </div>
      )}
      {switcherOpen && !showHome && (
        <Switcher
          workspaces={workspaces}
          chatsByWs={chatsByWs}
          activeProjectPath={sel.projectPath}
          open={openChatInfo}
          onPick={openChat}
          onNewChat={newChat}
          onClose={() => setSwitcherOpen(false)}
        />
      )}
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
