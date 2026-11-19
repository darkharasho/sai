// Caps a chat's provider settings by the phone's remote permission ceiling
// ('auto' | 'auto-read' | 'always-ask', remote/clamp.ts), mapped into each
// provider's own vocabulary. A cap only ever lowers a permission, never raises it.
import type { ChatSettings } from '../../../src/lib/chat/types';
import type { PermMode } from '../remote/clamp';

/** Claude ('default' | 'bypass'): bypass is only allowed under the 'auto' ceiling. */
export function capClaudePermMode(mode: string | undefined, ceiling: PermMode | null): string | undefined {
  if (ceiling == null || ceiling === 'auto') return mode;
  return mode === 'bypass' ? 'default' : mode;
}

const CODEX_RANK: Record<string, number> = { 'read-only': 0, auto: 1, 'full-access': 2 };

/** Codex ('read-only' | 'auto' | 'full-access'; undefined runs as 'auto'). */
export function capCodexPermission(mode: string | undefined, ceiling: PermMode | null): string | undefined {
  if (ceiling == null) return mode;
  const max = ceiling === 'auto' ? 'auto' : 'read-only';
  const rank = mode === undefined ? CODEX_RANK.auto : CODEX_RANK[mode];
  // Unknown values: the backend treats them as read-only, already the floor.
  if (rank === undefined) return mode;
  return rank > CODEX_RANK[max] ? max : mode;
}

const ACP_RANK: Record<string, number> = { plan: 0, default: 1, auto_edit: 2, yolo: 3 };

/**
 * Gemini/Kimi approvalMode ('plan' < 'default' < 'auto_edit' < 'yolo').
 * 'auto' allows auto-accepted edits but not yolo; 'auto-read' and 'always-ask'
 * cap at 'default' (every tool asks). `unsetAs` is what the provider runs when
 * approvalMode is undefined (Gemini 'default', Kimi 'auto_edit').
 */
export function capAcpApprovalMode(mode: string | undefined, ceiling: PermMode | null, unsetAs: string): string | undefined {
  if (ceiling == null) return mode;
  const max = ceiling === 'auto' ? 'auto_edit' : 'default';
  const rank = ACP_RANK[mode ?? unsetAs];
  if (rank === undefined) return mode;
  return rank > ACP_RANK[max] ? max : mode;
}

/** Cap the permission field of `settings` for `provider`; other fields pass through. */
export function capSettings<T extends Partial<ChatSettings>>(settings: T, provider: ChatSettings['provider'], ceiling: PermMode | null): T {
  if (ceiling == null) return settings;
  const out: T = { ...settings };
  switch (provider) {
    case 'claude':
      if ('permMode' in out) out.permMode = capClaudePermMode(out.permMode, ceiling);
      break;
    case 'codex':
      out.permMode = capCodexPermission(out.permMode, ceiling);
      if (out.permMode === undefined) delete out.permMode;
      break;
    case 'gemini':
    case 'kimi':
      out.approvalMode = capAcpApprovalMode(out.approvalMode, ceiling, provider === 'kimi' ? 'auto_edit' : 'default');
      if (out.approvalMode === undefined) delete out.approvalMode;
      break;
  }
  return out;
}
