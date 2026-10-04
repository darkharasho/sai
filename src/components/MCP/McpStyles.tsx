/** Shared MCP panel CSS (rows, dots, group headers, buttons, error banner).
 *  Rendered once at the McpSidebar root, above every view. */
export default function McpStyles() {
  return (
    <style>{`
      .mcp-grp { display: flex; justify-content: space-between; padding: 10px 12px 4px; font-size: 10.5px; color: var(--text-muted); text-transform: uppercase; letter-spacing: .08em; }
      .mcp-row { display: flex; align-items: center; gap: 9px; padding: 7px 12px; cursor: pointer; }
      .mcp-row:hover { background: var(--surface-4); }
      .mcp-ico { width: 26px; height: 26px; border-radius: 6px; background: var(--accent-dim); color: var(--accent); display: grid; place-items: center; flex-shrink: 0; }
      .mcp-info { flex: 1; min-width: 0; }
      .mcp-nm { font-size: 12.5px; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .mcp-ds { font-size: 11px; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .mcp-ds.err { color: color-mix(in srgb, var(--red) 70%, var(--text-muted)); }
      .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
      .mcp-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
      .mcp-dot.ok { background: var(--green); }
      .mcp-dot.bad { background: var(--red); }
      .mcp-dot.pending { background: var(--accent); animation: mcp-pulse 1s infinite alternate; }
      .mcp-dot.off { border: 1px solid var(--text-muted); }
      .mcp-dot.unknown { background: var(--text-muted); opacity: .5; }
      @keyframes mcp-pulse { to { opacity: .3; } }
      .mcp-btn { background: var(--surface-2); border: 1px solid var(--border-subtle); color: var(--text); border-radius: 6px; padding: 3px 9px; font-size: 11.5px; cursor: pointer; white-space: nowrap; }
      .mcp-btn:hover { border-color: var(--border-strong); }
      .mcp-btn.pri { background: var(--accent); border-color: var(--accent); color: var(--bg-primary); font-weight: 600; }
      .mcp-btn.pri:hover { background: var(--accent-hover); }
      .mcp-btn.danger { color: var(--red); }
      .mcp-btn:disabled { opacity: .45; cursor: not-allowed; }
      .mcp-hint { font-size: 10px; color: var(--text-muted); border: 1px dashed var(--border-strong); border-radius: 4px; padding: 1px 5px; }
      .mcp-spin { animation: mcp-rot 1s linear infinite; color: var(--text-muted); }
      @keyframes mcp-rot { to { transform: rotate(360deg); } }
      .mcp-error { margin: 8px 10px; padding: 6px 8px; font-size: 11px; color: var(--red); background: var(--surface-2); border: 1px solid color-mix(in srgb, var(--red) 40%, transparent); border-radius: 6px; overflow-wrap: anywhere; }
    `}</style>
  );
}
