/** Per-chat UI state of the right canvas sidebar. Paths are canvasKey()s. */
export interface ChatCanvasUi {
  open: boolean;
  selected: string | null;
  /** The chat's canvases as of the last reconcile: anything not in here is new to the chat. */
  known: string[];
}

export type SavedChatCanvasUi = Pick<ChatCanvasUi, 'open' | 'selected'>;

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
    return { open: saved?.open ?? false, selected, known: [...list] };
  }
  const added = list.filter((p) => !prev.known.includes(p));
  if (added.length === 0 && list.length === prev.known.length) return prev;
  const fresh = added.filter(isFresh);
  if (fresh.length > 0) return { open: true, selected: fresh[fresh.length - 1], known: [...list] };
  if (added.length > 0) return { ...prev, known: [...list] };
  return { ...prev, selected: prev.selected && list.includes(prev.selected) ? prev.selected : list[0] ?? null, known: [...list] };
}

/** Open the panel on `path` (the tool's "open", a canvas link). */
export function showCanvas(prev: ChatCanvasUi | undefined, path: string): ChatCanvasUi {
  const known = prev?.known ?? [];
  return { open: true, selected: path, known: known.includes(path) ? known : [...known, path] };
}

/** The tab to show: the selection when visible, else the first visible canvas. */
export function visibleSelection(selected: string | null, visible: readonly string[]): string | null {
  return selected && visible.includes(selected) ? selected : visible[0] ?? null;
}
