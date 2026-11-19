import type { ReactNode } from 'react';
import type { ToolCall } from '../../types';
import { RenderToolCallCard } from './RenderToolCallCard';

/**
 * ChatPanel's `renderToolCall` for a workspace: SAI render-tool and
 * confirm/choose calls mount a RenderToolCallCard; anything else returns null
 * (the default ToolCallCard). Shared by the desktop App and the phone ChatHost.
 */
export function renderToolCallFor(
  cwd: string,
  onOpenFile: (path: string) => void,
): (tc: ToolCall, defaultExpanded: boolean, seedGrow?: boolean, ctx?: { isNewestModel: boolean }) => ReactNode | null {
  return (tc, _defaultExpanded, seedGrow, ctx) => {
    const n = tc.name || '';
    if (
      n.endsWith('sai_render_html') ||
      n.endsWith('sai_render_component') ||
      n.endsWith('sai_render_chart') ||
      n.endsWith('sai_render_diff') ||
      n.endsWith('sai_render_mermaid') ||
      n.endsWith('sai_render_model') ||
      n.endsWith('sai_render_theme') ||
      n.endsWith('sai_render_form') ||
      n.endsWith('sai_confirm') ||
      n.endsWith('sai_choose')
    ) {
      return <RenderToolCallCard tc={tc} cwd={cwd} seedGrow={seedGrow} isNewestModel={ctx?.isNewestModel ?? true} onOpenFile={onOpenFile} />;
    }
    return null;
  };
}
