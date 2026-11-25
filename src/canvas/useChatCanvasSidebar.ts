import { useCallback, useEffect, useRef, useState } from 'react';
import { reconcileChatCanvases, removeCanvas, showCanvas, visibleCanvases, type ChatCanvasUi, type SavedChatCanvasUi } from './canvasSidebarState';

const STORAGE_KEY = 'sai.canvasSidebar.v1';
const MAX_SAVED_CHATS = 200;
export const CANVAS_PANEL_DEFAULT = 380;
const FRESH_MS = 120_000;

interface Saved { width: number; chats: Record<string, SavedChatCanvasUi> }

function load(): Saved {
  try {
    const v = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '');
    if (v && typeof v === 'object' && v.chats && typeof v.chats === 'object') {
      return { width: typeof v.width === 'number' ? v.width : CANVAS_PANEL_DEFAULT, chats: v.chats };
    }
  } catch { /* first run or corrupt */ }
  return { width: CANVAS_PANEL_DEFAULT, chats: {} };
}

function save(s: Saved) {
  const keys = Object.keys(s.chats);
  // Oldest entries first (insertion order): keep the newest MAX_SAVED_CHATS.
  if (keys.length > MAX_SAVED_CHATS) for (const k of keys.slice(0, keys.length - MAX_SAVED_CHATS)) delete s.chats[k];
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch { /* quota: not worth failing over */ }
}

const EMPTY: ChatCanvasUi = { open: false, selected: null, known: [], added: [], removed: [] };

const sameList = (a: readonly string[] | undefined, b: readonly string[]) =>
  !!a && a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * Canvas sidebar state for every chat seen this run, keyed `${workspace}:${chatId}`: the chat's
 * canvases (from its transcript) and its open/selected state, saved across restarts. `chatKey`
 * is the chat on screen.
 */
export function useChatCanvasSidebar(chatKey: string | null) {
  const savedRef = useRef<Saved | null>(null);
  if (!savedRef.current) savedRef.current = load();
  const [lists, setLists] = useState(() => new Map<string, string[]>());
  const [uis, setUis] = useState(() => new Map<string, ChatCanvasUi>());
  const [width, setWidth] = useState(savedRef.current.width);
  const listsRef = useRef(lists);
  listsRef.current = lists;

  /**
   * Feed a chat's canvases with first-touch times (cheap to call on every transcript change).
   * A canvas first touched within FRESH_MS auto-opens the panel; older ones are history loading.
   */
  const setChatCanvases = useCallback((key: string, touches: { path: string; at: number }[]) => {
    const list = touches.map((t) => t.path);
    if (sameList(listsRef.current.get(key), list)) return;
    const cutoff = Date.now() - FRESH_MS;
    const isFresh = (p: string) => (touches.find((t) => t.path === p)?.at ?? 0) >= cutoff;
    listsRef.current = new Map(listsRef.current).set(key, list);
    setLists(listsRef.current);
    setUis((m) => {
      const prev = m.get(key);
      const next = reconcileChatCanvases(prev, list, prev ? undefined : savedRef.current!.chats[key], isFresh);
      return next === prev ? m : new Map(m).set(key, next);
    });
  }, []);

  const update = useCallback((fn: (prev: ChatCanvasUi | undefined) => ChatCanvasUi) => {
    if (!chatKey) return;
    setUis((m) => new Map(m).set(chatKey, fn(m.get(chatKey))));
  }, [chatKey]);

  const show = useCallback((path: string) => update((p) => showCanvas(p, path)), [update]);
  const select = useCallback((path: string) => update((p) => ({ ...(p ?? EMPTY), open: true, selected: path })), [update]);
  const toggle = useCallback(() => update((p) => ({ ...(p ?? EMPTY), open: !p?.open })), [update]);
  const remove = useCallback((path: string) => update((p) => {
    const list = (chatKey && listsRef.current.get(chatKey)) || [];
    return removeCanvas(p, path, visibleCanvases(list, p));
  }), [update, chatKey]);

  // Persist the on-screen chat's open/selected state and the shared width.
  const ui = chatKey ? uis.get(chatKey) : undefined;
  useEffect(() => {
    const s = savedRef.current!;
    s.width = width;
    if (chatKey && ui) {
      delete s.chats[chatKey];
      s.chats[chatKey] = {
        open: ui.open,
        selected: ui.selected,
        ...(ui.added.length > 0 && { added: ui.added }),
        ...(ui.removed.length > 0 && { removed: ui.removed }),
      };
    }
    save(s);
  }, [chatKey, ui?.open, ui?.selected, ui?.added, ui?.removed, width]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    /** The on-screen chat's canvases (its tabs): transcript order, then ones the user showed. */
    paths: visibleCanvases((chatKey && lists.get(chatKey)) || [], ui),
    open: ui?.open ?? false,
    selected: ui?.selected ?? null,
    width,
    setWidth,
    setChatCanvases,
    show,
    select,
    toggle,
    remove,
  };
}
