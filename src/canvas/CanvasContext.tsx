import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useSyncExternalStore, type MutableRefObject } from 'react';
import type { OpenFile } from '../types';
import CanvasView from '../components/Canvas/CanvasView';
import { createCanvasStore, type CanvasStore } from './canvasStore';
import { canvasKey, canvasRelPath, canvasWatchSet, closeDeletedCanvas, closeDeletedCanvasTabs, findOpenCanvasPath, isProjectCanvas, isTextEntry } from './canvasFiles';
import { useCanvasDelivery } from './useCanvasDelivery';

/** The active workspace's canvases, for Code-panel canvas tabs. Paths are canvasKey()s. */
export interface CanvasController {
  store: CanvasStore;
  chatKey: string | null;
  agentStatus: 'idle' | 'busy';
  sendInFor(path: string): number | null;
  sendNow(path: string): void;
  holdToggle(path: string): void;
  /** Open (or focus) the canvas tab in canvas view. */
  openCanvas(path: string): void;
  /** Show the canvas tab as raw Markdown in Monaco. */
  openSource(path: string): void;
  /** Save Monaco source of an active-project canvas as a user write. False = not one; caller writes normally. */
  writeSource(path: string, content: string): Promise<boolean>;
}

export const CanvasContext = createContext<CanvasController | null>(null);

export interface CanvasControllerOpts {
  /** Active workspace. */
  projectPath: string | null;
  /** Active chat's session id (or scope). */
  chatKey: string | null;
  /** Active chat has a turn in flight. */
  chatBusy: boolean;
  /** Workspaces currently open in the app. Canvas watches of workspaces no longer here are dropped. */
  openWorkspaces: string[];
  /** `ws` has a live chat turn or background task: its disk changes are agent writes. */
  isAgentLive(ws: string): boolean;
  /** chatSendTextRef: the active chat panel's queueing send. */
  sendRef: MutableRefObject<((text: string) => void) | null>;
  getOpenFiles(ws: string): OpenFile[];
  /** Open a tab in the active workspace. */
  openFile(path: string, opts?: { canvasSource?: boolean }): void;
  /** Close a tab of the active workspace. */
  closeFile(path: string): void;
  /** Rewrite a background workspace's tabs. */
  patchTabs(ws: string, fn: (w: { openFiles: OpenFile[]; activeFilePath: string | null }) => { openFiles: OpenFile[]; activeFilePath: string | null }): void;
}

const logReject = (what: string) => (err: unknown) => console.error(`[canvas] ${what} failed`, err);

type CanvasEvent = { projectPath: string; path: string; content: string | null };

export function useCanvasController(opts: CanvasControllerOpts): CanvasController {
  const { projectPath, chatKey, chatBusy } = opts;
  const optsRef = useRef(opts);
  optsRef.current = opts;

  // One store per workspace opened this run, kept across workspace switches.
  const storesRef = useRef(new Map<string, CanvasStore>());
  const store = useMemo(() => {
    const ws = projectPath ?? '';
    let s = storesRef.current.get(ws);
    if (!s) {
      s = createCanvasStore({
        writeFile: async (path, content) => { await window.sai.fsWriteFile(path, content); },
        now: () => Date.now(),
      });
      storesRef.current.set(ws, s);
    }
    return s;
  }, [projectPath]);

  /** Tab path for a canvas: an existing tab's spelling, else the project's spelling. */
  const tabPathFor = useCallback((path: string) => {
    const ws = optsRef.current.projectPath;
    const open = ws ? findOpenCanvasPath(optsRef.current.getOpenFiles(ws), path) : null;
    if (open) return open;
    const rel = ws ? canvasRelPath(ws, path) : path;
    return rel.startsWith('.sai/canvas/') ? `${ws!.replace(/\/+$/, '')}/${rel}` : path;
  }, []);

  // Agent-touched canvases of the active workspace waiting for focus to leave a text entry.
  // Background workspaces keep theirs in the store (takeAgentTouched) until they become active.
  const deferredRef = useRef(new Map<string, Set<string>>());
  const flushAutoOpen = useCallback(() => {
    const ws = optsRef.current.projectPath;
    const s = ws ? storesRef.current.get(ws) : undefined;
    if (!ws || !s) return;
    let set = deferredRef.current.get(ws);
    if (!set) deferredRef.current.set(ws, (set = new Set()));
    for (const p of s.takeAgentTouched()) set.add(p);
    if (set.size === 0 || isTextEntry(document.activeElement)) return;
    const paths = [...set];
    set.clear();
    for (const p of paths) if (s.get(p)) optsRef.current.openFile(tabPathFor(p));
  }, [tabPathFor]);

  useEffect(() => {
    const onFocusIn = () => flushAutoOpen();
    // On focusout the old element is still active; check after focus settles.
    const onFocusOut = () => setTimeout(flushAutoOpen, 0);
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    return () => {
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
    };
  }, [flushAutoOpen]);

  // A workspace becoming active opens what its agent touched while it was in the background.
  useEffect(() => { flushAutoOpen(); }, [projectPath, flushAutoOpen]);

  /** Close every tab of `ws` showing the deleted canvas `key`. */
  const closeTabsIn = useCallback((ws: string, key: string) => {
    deferredRef.current.get(ws)?.delete(key);
    const o = optsRef.current;
    if (ws === o.projectPath) {
      const files = o.getOpenFiles(ws);
      const keep = closeDeletedCanvas(files, key);
      for (const f of files) if (!keep.includes(f)) o.closeFile(f.path);
    } else if (closeDeletedCanvas(o.getOpenFiles(ws), key) !== o.getOpenFiles(ws)) {
      o.patchTabs(ws, (w) => closeDeletedCanvasTabs(w, key));
    }
  }, []);

  /**
   * Watch one workspace for as long as it stays open: seed once from canvasList (the watcher
   * skips existing files), then apply each event with that workspace's own agent liveness, so
   * a background agent's writes are absorbed as agent writes. Returns the disposer.
   */
  const startWatch = useCallback((ws: string, s: CanvasStore): (() => void) => {
    const sai = window.sai;
    if (!sai?.canvasWatch || !sai.onCanvasChanged || !sai.canvasList) return () => {};
    let disposed = false;
    let seeded = false;
    const buffered: CanvasEvent[] = [];
    const apply = (path: string, content: string | null, agentLive: boolean) => {
      const key = canvasKey(path);
      s.onDiskChange(key, content, agentLive)
        .then(() => {
          if (disposed) return;
          if (content === null) closeTabsIn(ws, key);
          else if (ws === optsRef.current.projectPath) flushAutoOpen();
        })
        .catch(logReject('disk change'));
    };
    const handle = (ev: CanvasEvent) => apply(ev.path, ev.content, optsRef.current.isAgentLive(ws));
    const off = sai.onCanvasChanged((ev: CanvasEvent) => {
      if (disposed || ev.projectPath !== ws) return;
      if (seeded) handle(ev);
      else buffered.push(ev);
    });
    const flushBuffered = () => {
      seeded = true;
      for (const ev of buffered.splice(0)) handle(ev);
    };
    Promise.resolve(sai.canvasWatch(ws))
      .then(() => sai.canvasList(ws))
      .then((list: { path: string; content: string }[]) => {
        if (disposed) return;
        const listed = new Set(list.map((e) => canvasKey(e.path)));
        // First sight is a baseline, never an edit.
        for (const e of list) apply(e.path, e.content, false);
        for (const c of s.list()) if (!listed.has(c.path)) apply(c.path, null, false);
        flushBuffered();
      })
      .catch((err: unknown) => {
        logReject('watch/seed')(err);
        if (!disposed) flushBuffered();
      });
    return () => {
      disposed = true;
      off?.();
      Promise.resolve(sai.canvasUnwatch?.(ws)).catch(logReject('unwatch'));
    };
  }, [closeTabsIn, flushAutoOpen]);

  // Watch every workspace opened this run that is still open; drop (and forget) closed ones.
  const watchesRef = useRef(new Map<string, () => void>());
  const watchKey = canvasWatchSet(storesRef.current.keys(), opts.openWorkspaces, projectPath).join('\n');
  useEffect(() => {
    const want = new Set(watchKey ? watchKey.split('\n') : []);
    for (const [ws, dispose] of watchesRef.current) {
      if (want.has(ws)) continue;
      dispose();
      watchesRef.current.delete(ws);
      storesRef.current.delete(ws);
      deferredRef.current.delete(ws);
    }
    for (const ws of want) {
      const s = storesRef.current.get(ws);
      if (s && !watchesRef.current.has(ws)) watchesRef.current.set(ws, startWatch(ws, s));
    }
  }, [watchKey, startWatch]);
  useEffect(() => () => {
    for (const dispose of watchesRef.current.values()) dispose();
    watchesRef.current.clear();
  }, []);

  const send = useCallback((text: string) => {
    const fn = optsRef.current.sendRef.current;
    if (!fn) throw new Error('no active chat to send to');
    fn(text);
  }, []);
  const delivery = useCanvasDelivery({ store, chatKey, chatBusy, send: projectPath ? send : null });

  const holdToggle = useCallback((path: string) => {
    const c = store.get(path);
    if (c) store.setAutoSend(path, !c.autoSend);
  }, [store]);
  const openCanvas = useCallback((path: string) => optsRef.current.openFile(tabPathFor(path), { canvasSource: false }), [tabPathFor]);
  const openSource = useCallback((path: string) => optsRef.current.openFile(tabPathFor(path), { canvasSource: true }), [tabPathFor]);
  const writeSource = useCallback(async (path: string, content: string) => {
    const ws = optsRef.current.projectPath;
    if (!ws || !isProjectCanvas(ws, path)) return false;
    await store.userWrite(canvasKey(path), content);
    return true;
  }, [store]);

  return {
    store,
    chatKey,
    agentStatus: chatBusy ? 'busy' : 'idle',
    sendInFor: delivery.sendInFor,
    sendNow: delivery.sendNow,
    holdToggle,
    openCanvas,
    openSource,
    writeSource,
  };
}

/** Code-panel body for a canvas tab in canvas view. */
export function CanvasTab({ path }: { path: string }) {
  const ctl = useContext(CanvasContext);
  if (!ctl) return null;
  return <CanvasTabInner ctl={ctl} path={path} />;
}

function CanvasTabInner({ ctl, path }: { ctl: CanvasController; path: string }) {
  const key = canvasKey(path);
  const { store, chatKey } = ctl;
  const pending = useSyncExternalStore(store.subscribe, () => (chatKey ? store.hasPending(key, chatKey) : false));
  return (
    <CanvasView
      path={key}
      store={store}
      agentStatus={ctl.agentStatus}
      sendIn={ctl.sendInFor(key)}
      pending={pending}
      onSendNow={() => ctl.sendNow(key)}
      onHoldToggle={() => ctl.holdToggle(key)}
      onOpenSource={() => ctl.openSource(path)}
      onOpenCanvas={ctl.openCanvas}
    />
  );
}
