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

function Row({ row, busy, canSignIn, liveAvailable, onOpen, onSignIn, onRetry }: RowProps) {
  const Icon = MCP_SOURCE_ICON[row.source];
  const stop = (fn: () => void) => (e: React.MouseEvent) => { e.stopPropagation(); fn(); };
  let right: React.ReactNode = <span className={`mcp-dot ${row.dot}`} />;
  if (busy) right = <Loader2 size={12} className="mcp-spin" />;
  else if (row.fix === 'sign-in' && canSignIn) right = <button className="mcp-btn pri" disabled={!liveAvailable} onClick={stop(() => onSignIn(row))}>Sign in</button>;
  else if (row.fix === 'sign-in') right = <span className="mcp-hint" title={MCP_TERMINAL_HINT}>CLI</span>;
  else if (row.fix === 'retry') right = <button className="mcp-btn" disabled={!liveAvailable} onClick={stop(() => onRetry(row))}>Retry</button>;

  return (
    <div className="mcp-row" onClick={() => onOpen(row)} role="button" tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter') onOpen(row); }}>
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
        .mcp-attn { margin: 6px 10px 4px; border: 1px solid rgba(212,92,60,.35); background: rgba(212,92,60,.06); border-radius: 8px; }
        .mcp-attn .mcp-grp { color: var(--red); padding-top: 8px; }
        .mcp-chev { color: var(--text-muted); flex-shrink: 0; }
      `}</style>
    </>
  );
}
