import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useSyncExternalStore, type MutableRefObject } from 'react';
import type { OpenFile } from '../types';
import CanvasView from '../components/Canvas/CanvasView';
import { createCanvasStore, type CanvasStore } from './canvasStore';
import { canvasKey, canvasRelPath, closeDeletedCanvas, findOpenCanvasPath, isEditingOutsideCanvas, isProjectCanvas } from './canvasFiles';
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
  projectPath: string | null;
  /** Active chat's session id (or scope). */
  chatKey: string | null;
  /** Active chat has a turn in flight. */
  chatBusy: boolean;
  /** Workspace has a live chat turn or background task: disk changes are agent writes. */
  agentLive: boolean;
  /** chatSendTextRef: the active chat panel's queueing send. */
  sendRef: MutableRefObject<((text: string) => void) | null>;
  getOpenFiles(): OpenFile[];
  openFile(path: string, opts?: { canvasSource?: boolean }): void;
  closeFile(path: string): void;
}

const logReject = (what: string) => (err: unknown) => console.error(`[canvas] ${what} failed`, err);

export function useCanvasController(opts: CanvasControllerOpts): CanvasController {
  const { projectPath, chatKey, chatBusy } = opts;
  const optsRef = useRef(opts);
  optsRef.current = opts;

  // One store per workspace, kept across workspace switches.
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
    const open = findOpenCanvasPath(optsRef.current.getOpenFiles(), path);
    if (open) return open;
    const ws = optsRef.current.projectPath;
    const rel = ws ? canvasRelPath(ws, path) : path;
    return rel.startsWith('.sai/canvas/') ? `${ws!.replace(/\/+$/, '')}/${rel}` : path;
  }, []);

  // Agent-touched canvases waiting for the user to leave an editor/field, per workspace.
  const deferredRef = useRef(new Map<string, Set<string>>());
  const flushAutoOpen = useCallback(() => {
    const ws = optsRef.current.projectPath;
    const s = ws ? storesRef.current.get(ws) : undefined;
    if (!ws || !s) return;
    let set = deferredRef.current.get(ws);
    if (!set) deferredRef.current.set(ws, (set = new Set()));
    for (const p of s.takeAgentTouched()) set.add(p);
    if (set.size === 0 || isEditingOutsideCanvas(document.activeElement)) return;
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

  // Watch only the active workspace; seed from canvasList (the watcher skips existing files).
  useEffect(() => {
    const sai = window.sai;
    if (!projectPath || !sai?.canvasWatch || !sai.onCanvasChanged || !sai.canvasList) return;
    let disposed = false;
    let seeded = false;
    const buffered: { path: string; content: string | null }[] = [];

    const closeTabs = (key: string) => {
      const files = optsRef.current.getOpenFiles();
      const keep = closeDeletedCanvas(files, key);
      for (const f of files) if (!keep.includes(f)) optsRef.current.closeFile(f.path);
      deferredRef.current.get(projectPath)?.delete(key);
    };
    const apply = (path: string, content: string | null, agentLive: boolean) => {
      const key = canvasKey(path);
      store
        .onDiskChange(key, content, agentLive)
        .then(() => {
          if (disposed) return;
          if (content === null) closeTabs(key);
          else flushAutoOpen();
        })
        .catch(logReject('disk change'));
    };
    const handle = (ev: { path: string; content: string | null }) => apply(ev.path, ev.content, optsRef.current.agentLive);

    const off = sai.onCanvasChanged((ev: { projectPath: string; path: string; content: string | null }) => {
      if (disposed || ev.projectPath !== projectPath) return;
      if (seeded) handle(ev);
      else buffered.push(ev);
    });
    const flushBuffered = () => {
      seeded = true;
      for (const ev of buffered.splice(0)) handle(ev);
    };
    Promise.resolve(sai.canvasWatch(projectPath))
      .then(() => sai.canvasList(projectPath))
      .then((list: { path: string; content: string }[]) => {
        if (disposed) return;
        const listed = new Set(list.map((e) => canvasKey(e.path)));
        // Baselines, never edits; unchanged re-seeds are no-ops in the store.
        for (const e of list) apply(e.path, e.content, false);
        // Deleted while we were not watching.
        for (const c of store.list()) if (!listed.has(c.path)) apply(c.path, null, false);
        flushBuffered();
      })
      .catch((err: unknown) => {
        logReject('watch/seed')(err);
        if (!disposed) flushBuffered();
      });

    return () => {
      disposed = true;
      off?.();
      Promise.resolve(sai.canvasUnwatch?.(projectPath)).catch(logReject('unwatch'));
    };
  }, [projectPath, store, flushAutoOpen]);

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
