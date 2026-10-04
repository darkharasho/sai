import { ChevronRight, Loader2 } from 'lucide-react';
import { MCP_SOURCE_ICON, MCP_TERMINAL_HINT, type McpRow, type groupMcpRows } from './mcpView';

interface McpServerListProps {
  groups: ReturnType<typeof groupMcpRows>;
  canSignIn: boolean;            // snapshot.capabilities.authenticate
  liveAvailable: boolean;        // snapshot.available — Sign in / Retry need a live session
  busy: Record<string, boolean>; // keyed by row.key
  onOpen(row: McpRow): void;
  onSignIn(row: McpRow): void;
  onRetry(row: McpRow): void;
}

type RowProps = { row: McpRow; busy: boolean } & Pick<McpServerListProps, 'canSignIn' | 'liveAvailable' | 'onOpen' | 'onSignIn' | 'onRetry'>;

const DOT_LABEL: Record<McpRow['dot'], string> = {
  ok: 'Connected', pending: 'Connecting', bad: 'Needs attention', off: 'Disabled', unknown: 'Status unknown',
};

function Row({ row, busy, canSignIn, liveAvailable, onOpen, onSignIn, onRetry }: RowProps) {
  const Icon = MCP_SOURCE_ICON[row.source];
  const stop = (fn: () => void) => (e: React.MouseEvent) => { e.stopPropagation(); fn(); };
  let right: React.ReactNode = <span className={`mcp-dot ${row.dot}`} role="img" aria-label={DOT_LABEL[row.dot]} />;
  if (busy) right = <Loader2 size={12} className="mcp-spin" />;
  else if (row.fix === 'sign-in' && canSignIn) right = <button className="mcp-btn pri" aria-label={`Sign in to ${row.displayName}`} disabled={!liveAvailable} onClick={stop(() => onSignIn(row))}>Sign in</button>;
  else if (row.fix === 'sign-in') right = <span className="mcp-hint" title={MCP_TERMINAL_HINT}>CLI<span className="sr-only"> — {MCP_TERMINAL_HINT}</span></span>;
  else if (row.fix === 'retry') right = <button className="mcp-btn" aria-label={`Retry ${row.displayName}`} disabled={!liveAvailable} onClick={stop(() => onRetry(row))}>Retry</button>;

  return (
    <div className="mcp-row" onClick={() => onOpen(row)} role="button" tabIndex={0}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(row); }
      }}>
      <div className="mcp-ico"><Icon size={13} /></div>
      <div className="mcp-info">
        <div className="mcp-nm">{row.displayName}</div>
        <div className={`mcp-ds ${row.live?.status === 'failed' ? 'err' : ''}`} title={row.subtitle}>{row.subtitle}</div>
      </div>
      {right}
      <ChevronRight size={12} className="mcp-chev" />
    </div>
  );
}

export default function McpServerList({ groups, canSignIn, liveAvailable, busy, onOpen, onSignIn, onRetry }: McpServerListProps) {
  return (
    <>
      {groups.map((g) => (
        <div key={g.id} className={g.id === 'attention' ? 'mcp-attn' : 'mcp-grp-wrap'}>
          <div className="mcp-grp"><span>{g.label}</span>{g.hint && <span>{g.hint}</span>}</div>
          {g.rows.map((r) => (
            <Row key={r.key} row={r} busy={!!busy[r.key]} canSignIn={canSignIn} liveAvailable={liveAvailable}
              onOpen={onOpen} onSignIn={onSignIn} onRetry={onRetry} />
          ))}
        </div>
      ))}
      <style>{`
        .mcp-attn { margin: 6px 10px 4px; border: 1px solid color-mix(in srgb, var(--red) 35%, transparent); background: color-mix(in srgb, var(--red) 6%, transparent); border-radius: 8px; }
        .mcp-attn .mcp-grp { color: var(--red); padding-top: 8px; }
        .mcp-chev { color: var(--text-muted); flex-shrink: 0; }
      `}</style>
    </>
  );
}
