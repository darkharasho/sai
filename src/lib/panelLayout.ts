export type PanelId = 'chat' | 'editor' | 'terminal';

/**
 * Expanded accordion panels after opening a tab in the editor. At most two panels are expanded.
 * By default the oldest expanded panel gives way. `keepChat` (focused-chat mode, or an automatic
 * open such as a canvas the agent wrote) keeps an expanded chat and puts the editor beside it.
 * Returns `prev` itself when the editor is already expanded.
 */
export function expandEditorPanel(prev: PanelId[], keepChat: boolean): PanelId[] {
  if (prev.includes('editor')) return prev;
  if (keepChat && prev.includes('chat')) return ['chat', 'editor'];
  const next: PanelId[] = [...prev, 'editor'];
  return next.length > 2 ? next.slice(1) : next;
}
