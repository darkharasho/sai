/** `.mcp-btn` — shared by the panel and the chat nudge (which renders outside
 *  the panel, so it injects this rule set itself). */
export const MCP_BUTTON_CSS = `
      .mcp-btn { background: var(--surface-2); border: 1px solid var(--border-subtle); color: var(--text); border-radius: 6px; padding: 3px 9px; font-size: 11.5px; cursor: pointer; white-space: nowrap; }
      .mcp-btn:hover { border-color: var(--border-strong); }
      .mcp-btn.pri { background: var(--accent); border-color: var(--accent); color: var(--bg-primary); font-weight: 600; }
      .mcp-btn.pri:hover { background: var(--accent-hover); }
      .mcp-btn.danger { color: var(--red); }
      .mcp-btn:disabled { opacity: .45; cursor: not-allowed; }
`;

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
      ${MCP_BUTTON_CSS}
      .mcp-hint { font-size: 10px; color: var(--text-muted); border: 1px dashed var(--border-strong); border-radius: 4px; padding: 1px 5px; }
      .mcp-spin { animation: mcp-rot 1s linear infinite; color: var(--text-muted); }
      @keyframes mcp-rot { to { transform: rotate(360deg); } }
      .mcp-btn { display: inline-flex; align-items: center; gap: 4px; }
      .mcp-btn.ghost { background: none; }
      .mcp-acts { display: flex; gap: 6px; flex-wrap: wrap; }
      .mcp-link { background: none; border: none; color: var(--accent); font-size: 11px; padding: 8px 0 0; cursor: pointer; }
      .mcp-detail { width: var(--sidebar-width); background: var(--surface-1); border-right: 1px solid var(--border-subtle); overflow-y: auto; flex-shrink: 0; }
      .mcp-back { display: flex; align-items: center; gap: 6px; padding: 8px 12px; border: none; border-bottom: 1px solid var(--border-hairline); background: none; color: var(--text-muted); cursor: pointer; font-size: 11px; width: 100%; }
      .mcp-back:hover { color: var(--text); }
      .mcp-dhd { padding: 12px; border-bottom: 1px solid var(--border-hairline); }
      .mcp-dht { display: flex; gap: 10px; align-items: center; margin-bottom: 8px; }
      .mcp-ico.lg { width: 32px; height: 32px; }
      .mcp-dnm { font-size: 14px; font-weight: 600; color: var(--text); overflow-wrap: anywhere; }
      .mcp-pill { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; padding: 2px 8px; border-radius: 10px; background: var(--surface-2); border: 1px solid var(--border-subtle); max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .mcp-dhd .mcp-acts { margin-top: 10px; }
      .mcp-dhint { margin-top: 8px; white-space: normal; }
      .mcp-derr { margin-top: 8px; font-size: 11px; color: var(--red); overflow-wrap: anywhere; }
      .mcp-dnote { margin-top: 8px; font-size: 11px; color: var(--green); overflow-wrap: anywhere; }
      .mcp-sec { padding: 10px 12px; border-bottom: 1px solid var(--border-hairline); }
      .mcp-sec h4 { margin: 0 0 6px; font-size: 10.5px; color: var(--text-muted); text-transform: uppercase; letter-spacing: .08em; font-weight: 500; }
      .mcp-tool { font: 11.5px 'Geist Mono', monospace; padding: 3px 0; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .mcp-tool span { color: var(--text-muted); font-family: inherit; margin-left: 6px; font-size: 11px; }
      .mcp-config { padding: 8px 10px; background: var(--surface-2); border-radius: 6px; font-family: 'Geist Mono', monospace; font-size: 10.5px; color: var(--text-secondary); line-height: 1.6; border: 1px solid var(--border-hairline); word-break: break-all; }
      .mcp-ck { color: var(--text-muted); }
      .mcp-auth { margin: 12px; padding: 12px; border-radius: 8px; background: var(--accent-dim); border: 1px solid var(--border-accent); }
      .mcp-auth.bad { background: color-mix(in srgb, var(--red) 8%, transparent); border-color: color-mix(in srgb, var(--red) 35%, transparent); }
      .mcp-auth b { display: block; margin-bottom: 4px; font-size: 12.5px; }
      .mcp-auth p { margin: 0 0 8px; font-size: 12px; color: var(--text-secondary); }
      .mcp-auth-url { font: 11px 'Geist Mono', monospace; color: var(--text-secondary); background: var(--surface-2); border-radius: 5px; padding: 5px 7px; margin-bottom: 8px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .mcp-auth-paste-row { display: flex; gap: 6px; margin-top: 6px; }
      .mcp-server-form { width: var(--sidebar-width); background: var(--surface-1); border-right: 1px solid var(--border-subtle); overflow-y: auto; flex-shrink: 0; }
      .mcp-server-form .add-form { padding: 12px; }
      .mcp-server-form .add-title { font-weight: 700; font-size: 14px; margin-bottom: 12px; }
      .mcp-server-form .form-field { margin-bottom: 10px; }
      .mcp-server-form .form-label { display: block; font-size: 10px; color: var(--text-muted); margin-bottom: 4px; font-weight: 600; }
      .mcp-server-form .form-optional { color: var(--text-muted); }
      .mcp-server-form .form-static { font-size: 11px; color: var(--text-secondary); }
      .mcp-server-form .form-input { width: 100%; padding: 6px 10px; background: var(--surface-2); border: 1px solid var(--border-hairline); border-radius: 6px; color: var(--text); font-size: 11px; outline: none; font-family: inherit; }
      .mcp-server-form .form-input.mono { font-family: 'Geist Mono', monospace; }
      .mcp-server-form .form-input:focus { border-color: var(--accent); }
      .mcp-server-form .form-input[readonly] { opacity: .65; cursor: default; }
      .mcp-server-form .form-input[aria-invalid="true"] { border-color: var(--red); }
      .mcp-server-form .form-error { margin-top: 4px; font-size: 10.5px; color: var(--red); overflow-wrap: anywhere; }
      .mcp-server-form .transport-toggle { display: flex; gap: 4px; }
      .mcp-server-form .transport-btn { padding: 4px 10px; background: var(--surface-4); border: none; border-radius: 4px; font-size: 10px; color: var(--text-muted); cursor: pointer; }
      .mcp-server-form .transport-btn.active { background: var(--accent); color: var(--bg-primary); font-weight: 600; }
      .mcp-server-form .env-row { display: flex; align-items: center; gap: 4px; margin-bottom: 4px; }
      /* Keys like "Authorization" must fit (~16 mono chars at 300px); long values may truncate. */
      .mcp-server-form .env-key { flex: 1.15 1 0; min-width: 0; padding-left: 8px; padding-right: 8px; }
      .mcp-server-form .env-eq { color: var(--text-muted); font-size: 11px; flex-shrink: 0; }
      .mcp-server-form .env-val { flex: 1 1 0; min-width: 0; padding-left: 8px; padding-right: 8px; }
      .mcp-server-form .env-remove { background: none; border: none; color: var(--text-muted); cursor: pointer; font-size: 14px; padding: 0 4px; }
      .mcp-server-form .env-remove:hover { color: var(--red); }
      .mcp-server-form .add-env-btn { display: flex; align-items: center; gap: 3px; background: none; border: none; color: var(--accent); cursor: pointer; font-size: 10px; padding: 4px 0; }
      .mcp-server-form .submit-btn { width: 100%; padding: 8px; background: var(--accent); color: var(--bg-primary); border: none; border-radius: 6px; font-weight: 600; cursor: pointer; font-size: 12px; margin-top: 4px; }
      .mcp-server-form .submit-btn:hover { background: var(--accent-hover); }
      .mcp-error { margin: 8px 10px; padding: 6px 8px; font-size: 11px; color: var(--red); background: var(--surface-2); border: 1px solid color-mix(in srgb, var(--red) 40%, transparent); border-radius: 6px; overflow-wrap: anywhere; }
    `}</style>
  );
}
