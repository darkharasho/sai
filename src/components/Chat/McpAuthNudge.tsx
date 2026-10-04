import { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { useMcpLive } from '../MCP/useMcpLive';
import { HIDDEN_LIVE_NAMES, MCP_TERMINAL_HINT, mcpDisplayName } from '../MCP/mcpView';
import { isHttpUrl } from '../MCP/McpAuthCard';

interface McpAuthNudgeProps {
  projectPath: string;
  scope: string;
  /** false for non-Claude chats: the hook then makes no IPC calls. */
  enabled?: boolean;
  onOpenMcpPanel?: () => void;
}

const NOT_WEB = "The server's sign-in link isn't a web address, so it was not opened.";

/** Strip above the composer when this chat's session has MCP servers waiting
 *  for OAuth. Reads cached status only — never spawns a session. */
export default function McpAuthNudge({ projectPath, scope, enabled = true, onOpenMcpPanel }: McpAuthNudgeProps) {
  const live = useMcpLive(projectPath, scope, { spawn: false, enabled });
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // A live `connected` status always wins over leftover auth state, so only
  // servers whose current status is needs-auth count.
  const needs = useMemo(
    () => Object.values(live.snapshot?.servers ?? {})
      .filter((s) => s.status === 'needs-auth' && !HIDDEN_LIVE_NAMES.has(s.name))
      .map((s) => s.name)
      .sort(),
    [live.snapshot],
  );
  const key = needs.join('|');
  if (!enabled || needs.length === 0 || dismissedKey === key) return null;

  const caps = live.snapshot?.capabilities;
  const only = needs.length === 1 ? needs[0] : null;
  const auth = only ? live.snapshot?.auth?.[only] : undefined;

  const signIn = async (name: string) => {
    setError(null);
    try {
      const res = await live.authenticate(name);
      if (!res.ok) setError(res.error || 'Sign-in failed.');
      else if (res.state === 'awaiting-browser' && !isHttpUrl(res.authUrl)) {
        live.cancelAuth(name).catch(() => {});
        setError(NOT_WEB);
      }
    } catch (e: any) {
      setError(e?.message || 'Sign-in failed.');
    }
  };

  const badLink = auth?.phase === 'waiting' && !!auth.authUrl && !isHttpUrl(auth.authUrl);
  let message: React.ReactNode;
  let action: React.ReactNode = null;
  if (!only) {
    message = <span>{needs.length} servers need sign-in</span>;
    action = onOpenMcpPanel && <button type="button" className="mcp-nudge-btn pri" onClick={onOpenMcpPanel}>Review</button>;
  } else if (auth?.phase === 'waiting' && !badLink && !error) {
    message = <span><b>{mcpDisplayName(only)}</b> — Waiting for browser sign-in…</span>;
    action = <button type="button" className="mcp-nudge-btn" onClick={() => void live.cancelAuth(only)}>Cancel</button>;
  } else {
    const failed = !!error || badLink || auth?.phase === 'timeout' || auth?.phase === 'error';
    const detail = error ?? (badLink ? NOT_WEB : auth?.phase === 'timeout' ? "Sign-in didn't complete." : auth?.phase === 'error' ? auth.error || 'Sign-in failed.' : null);
    message = failed
      ? <span><b>{mcpDisplayName(only)}</b> — {detail}</span>
      : <span><b>{mcpDisplayName(only)}</b> needs sign-in — its tools aren't available in this chat.</span>;
    action = caps?.authenticate
      ? <button type="button" className="mcp-nudge-btn pri" onClick={() => void signIn(only)}>{failed ? 'Retry' : 'Sign in'}</button>
      : <span className="mcp-nudge-hint">{MCP_TERMINAL_HINT}</span>;
  }

  return (
    <div className="mcp-nudge" aria-live="polite">
      <span className="mcp-nudge-dot" aria-hidden="true" />
      {message}
      {action}
      <button type="button" className="mcp-nudge-x" aria-label="Dismiss" onClick={() => setDismissedKey(key)}><X size={12} /></button>
      <style>{`
        .mcp-nudge { display:flex; align-items:center; gap:10px; margin:0 0 8px; padding:7px 10px; border-radius:8px; background:color-mix(in srgb, var(--accent) 7%, transparent); border:1px solid color-mix(in srgb, var(--accent) 30%, transparent); font-size:12.5px; color:var(--text); }
        .mcp-nudge b { font-weight:600; }
        .mcp-nudge-dot { width:7px; height:7px; border-radius:50%; background:var(--red); flex-shrink:0; }
        .mcp-nudge-hint { font-size:11px; color:var(--text-secondary); }
        .mcp-nudge-x { margin-left:auto; background:none; border:none; color:var(--text-muted); cursor:pointer; padding:2px; display:flex; }
        .mcp-nudge-x:hover { color:var(--text); }
        .mcp-nudge-btn { background:var(--surface-2); border:1px solid var(--border-subtle); color:var(--text); border-radius:6px; padding:3px 9px; font-size:11.5px; cursor:pointer; white-space:nowrap; }
        .mcp-nudge-btn:hover { border-color:var(--border-strong); }
        .mcp-nudge-btn.pri { background:var(--accent); border-color:var(--accent); color:var(--bg-primary); font-weight:600; }
        .mcp-nudge-btn.pri:hover { background:var(--accent-hover); }
      `}</style>
    </div>
  );
}
