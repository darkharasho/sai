import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { useMcpLive } from '../MCP/useMcpLive';
import { HIDDEN_LIVE_NAMES, MCP_TERMINAL_HINT, mcpDisplayName } from '../MCP/mcpView';
import { isHttpUrl } from '../MCP/McpAuthCard';
import { MCP_BUTTON_CSS } from '../MCP/McpStyles';

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
  /** Errors and in-flight starts belong to the server they came from. */
  const [error, setError] = useState<{ name: string; message: string } | null>(null);
  const [starting, setStarting] = useState<string | null>(null);

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
  // A dismissal covers one set of servers: any change to the set (even back
  // to the dismissed one later) brings the nudge back.
  useEffect(() => { setDismissedKey((d) => (d === key ? d : null)); }, [key]);
  if (!enabled || needs.length === 0 || dismissedKey === key) return null;

  const caps = live.snapshot?.capabilities;
  const only = needs.length === 1 ? needs[0] : null;
  const auth = only ? live.snapshot?.auth?.[only] : undefined;
  const waitingCount = needs.filter((n) => live.snapshot?.auth?.[n]?.phase === 'waiting').length;

  const signIn = async (name: string) => {
    setError(null);
    setStarting(name);
    try {
      const res = await live.authenticate(name);
      if (!res.ok) setError({ name, message: res.error || 'Sign-in failed.' });
      else if (res.state === 'awaiting-browser' && !isHttpUrl(res.authUrl)) {
        live.cancelAuth(name).catch(() => {});
        setError({ name, message: NOT_WEB });
      }
    } catch (e: any) {
      setError({ name, message: e?.message || 'Sign-in failed.' });
    } finally {
      setStarting(null);
    }
  };

  const badLink = auth?.phase === 'waiting' && !!auth.authUrl && !isHttpUrl(auth.authUrl);
  // A live waiting state is newer than a local error from an earlier attempt.
  const waiting = auth?.phase === 'waiting' && !badLink;
  const ownError = only && error?.name === only && !waiting ? error.message : null;
  let message: React.ReactNode;
  let action: React.ReactNode = null;
  if (!only) {
    message = <span>{needs.length} servers need sign-in{waitingCount > 0 ? ` · ${waitingCount} waiting for browser sign-in` : ''}</span>;
    action = onOpenMcpPanel && <button type="button" className="mcp-btn pri" onClick={onOpenMcpPanel}>Review</button>;
  } else if (waiting) {
    message = <span><b>{mcpDisplayName(only)}</b> — Waiting for browser sign-in…</span>;
    action = <button type="button" className="mcp-btn" onClick={() => void live.cancelAuth(only)}>Cancel</button>;
  } else if (starting === only) {
    message = <span><b>{mcpDisplayName(only)}</b> — Opening your browser to sign in…</span>;
  } else {
    const failed = !!ownError || badLink || auth?.phase === 'timeout' || auth?.phase === 'error';
    const detail = ownError ?? (badLink ? NOT_WEB : auth?.phase === 'timeout' ? "Sign-in didn't complete." : auth?.phase === 'error' ? auth.error || 'Sign-in failed.' : null);
    message = failed
      ? <span><b>{mcpDisplayName(only)}</b> — {detail}</span>
      : <span><b>{mcpDisplayName(only)}</b> needs sign-in — its tools aren't available in this chat.</span>;
    action = caps?.authenticate
      ? <button type="button" className="mcp-btn pri" onClick={() => void signIn(only)}>{failed ? 'Retry' : 'Sign in'}</button>
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
        ${MCP_BUTTON_CSS}
      `}</style>
    </div>
  );
}
