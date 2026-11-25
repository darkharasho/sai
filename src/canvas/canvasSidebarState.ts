/** Per-chat UI state of the right canvas sidebar. Paths are canvasKey()s. */
export interface ChatCanvasUi {
  open: boolean;
  selected: string | null;
  /** The chat's canvases as of the last reconcile: anything not in here is new to the chat. */
  known: string[];
  /** Canvases the user (or the agent's "open") showed that the transcript doesn't name, e.g. from the explorer. */
  added: string[];
  /** Canvases the user closed from this chat's tabs. */
  removed: string[];
}

export type SavedChatCanvasUi = Pick<ChatCanvasUi, 'open' | 'selected'> & Partial<Pick<ChatCanvasUi, 'added' | 'removed'>>;

/** The chat's tabs: transcript canvases, then added ones, minus removed. */
export function visibleCanvases(list: readonly string[], ui: Pick<ChatCanvasUi, 'added' | 'removed'> | undefined): string[] {
  const all = [...list, ...(ui?.added ?? []).filter((p) => !list.includes(p))];
  return ui?.removed.length ? all.filter((p) => !ui.removed.includes(p)) : all;
}

/**
 * Fold the chat's current canvas list into its sidebar state. The first sight of a chat is a
 * baseline (saved open/selected, no auto-open); after that a canvas new to the chat opens the
 * panel and selects it, while writes to known canvases leave the panel alone.
 */
export function reconcileChatCanvases(
  prev: ChatCanvasUi | undefined,
  list: readonly string[],
  saved?: SavedChatCanvasUi,
  /** Only fresh additions auto-open (history arriving late must not pop the panel). Default: all. */
  isFresh: (path: string) => boolean = () => true,
): ChatCanvasUi {
  if (!prev) {
    const selected = saved?.selected && list.includes(saved.selected) ? saved.selected : list[list.length - 1] ?? null;
    return { open: saved?.open ?? false, selected, known: [...list], added: saved?.added ?? [], removed: saved?.removed ?? [] };
  }
  const added = list.filter((p) => !prev.known.includes(p));
  if (added.length === 0 && list.length === prev.known.length) return prev;
  const fresh = added.filter(isFresh);
  // The agent just made it, so it comes back even if the user had closed it before.
  if (fresh.length > 0) {
    return { ...prev, open: true, selected: fresh[fresh.length - 1], known: [...list], removed: prev.removed.filter((p) => !fresh.includes(p)) };
  }
  if (added.length > 0) return { ...prev, known: [...list] };
  const visible = visibleCanvases(list, prev);
  return { ...prev, selected: visibleSelection(prev.selected, visible), known: [...list] };
}

/** Open the panel on `path` (the tool's "open", a canvas link, the explorer); it joins the chat's tabs. */
export function showCanvas(prev: ChatCanvasUi | undefined, path: string): ChatCanvasUi {
  const known = prev?.known ?? [];
  const added = prev?.added ?? [];
  return {
    open: true,
    selected: path,
    known: known.includes(path) ? known : [...known, path],
    added: added.includes(path) ? added : [...added, path],
    removed: (prev?.removed ?? []).filter((p) => p !== path),
  };
}

/**
 * Close `path` from the chat's tabs (`visible` = the tabs before closing). The neighbour takes
 * the selection; closing the last tab collapses the panel.
 */
export function removeCanvas(prev: ChatCanvasUi | undefined, path: string, visible: readonly string[]): ChatCanvasUi {
  const base = prev ?? { open: false, selected: null, known: [], added: [], removed: [] };
  const rest = visible.filter((p) => p !== path);
  const i = visible.indexOf(path);
  const selected = base.selected && base.selected !== path ? base.selected : rest[Math.min(Math.max(i, 0), rest.length - 1)] ?? null;
  return {
    ...base,
    open: base.open && rest.length > 0,
    selected,
    added: base.added.filter((p) => p !== path),
    removed: base.removed.includes(path) ? base.removed : [...base.removed, path],
  };
}

/** The tab to show: the selection when visible, else the first visible canvas. */
export function visibleSelection(selected: string | null, visible: readonly string[]): string | null {
  return selected && visible.includes(selected) ? selected : visible[0] ?? null;
}
