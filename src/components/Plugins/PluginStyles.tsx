import { MCP_BUTTON_CSS } from '../MCP/McpStyles';

/** Plugins panel CSS — rows, groups and detail mirror the MCP panel's look.
 *  Rendered once at the PluginsSidebar root, above every view. */
export default function PluginStyles() {
  return (
    <style>{`
      ${MCP_BUTTON_CSS}
      .mcp-btn { display: inline-flex; align-items: center; gap: 4px; }
      .mcp-btn.sm { padding: 2px 7px; font-size: 10.5px; }
      .plugins-sidebar, .plg-detail { width: var(--sidebar-width); background: var(--surface-1); border-right: 1px solid var(--border-subtle); flex-shrink: 0; }
      .plugins-sidebar { display: flex; flex-direction: column; overflow: hidden; height: 100%; }
      .plg-detail { overflow-y: auto; height: 100%; }
      .plg-tabs { display: flex; border-bottom: 1px solid var(--border-hairline); }
      .plg-tab { flex: 1; padding: 9px 12px; text-align: center; font-size: 11px; background: none; border: none; color: var(--text-muted); cursor: pointer; position: relative; transition: color var(--dur-fast) var(--ease-out-soft); }
      .plg-tab::after { content: ''; position: absolute; left: 8px; right: 8px; bottom: 0; height: 2px; background: var(--accent); transform: scaleX(0); transition: transform var(--dur-base) var(--ease-out-soft); }
      .plg-tab.active { color: var(--accent); font-weight: 600; }
      .plg-tab.active::after { transform: scaleX(1); }
      .plg-tab:hover { color: var(--text); }
      .plg-tab-badge { display: inline-block; margin-left: 5px; padding: 0 5px; border-radius: 8px; background: var(--surface-4); color: var(--text-secondary); font-size: 10px; line-height: 15px; font-weight: 400; }
      .plg-tab-badge.upd { background: var(--accent); color: var(--bg-primary); font-weight: 600; }
      .plg-search-wrap { position: relative; padding: 8px; flex-shrink: 0; }
      .plg-search-icon { position: absolute; left: 18px; top: 50%; transform: translateY(-50%); color: var(--text-muted); }
      .plg-search { width: 100%; padding: 6px 10px 6px 28px; background: var(--surface-2); border: 1px solid var(--border-hairline); border-radius: 6px; color: var(--text); font-size: 11px; outline: none; font-family: inherit; }
      .plg-search:focus { border-color: var(--accent); }
      .plg-chips { display: flex; gap: 4px; padding: 0 8px 6px; overflow-x: auto; flex-shrink: 0; scrollbar-width: none; }
      .plg-chip { font-size: 10.5px; padding: 2px 8px; border-radius: 10px; background: var(--surface-2); border: 1px solid var(--border-subtle); color: var(--text-secondary); white-space: nowrap; cursor: pointer; flex-shrink: 0; }
      .plg-chip:hover { border-color: var(--border-strong); }
      .plg-chip.active { background: var(--accent-dim); border-color: var(--accent); color: var(--accent); }
      .plg-list { flex: 1; overflow-y: auto; padding-bottom: 8px; }
      .plg-grp { display: flex; justify-content: space-between; gap: 8px; padding: 10px 12px 4px; font-size: 10.5px; color: var(--text-muted); text-transform: uppercase; letter-spacing: .08em; }
      .plg-grp span:first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .plg-row { display: flex; align-items: center; gap: 9px; padding: 7px 12px; cursor: pointer; }
      .plg-row:hover { background: var(--surface-4); }
      .plg-row:focus-visible { outline: 1px solid var(--accent); outline-offset: -1px; }
      .plg-ico { width: 26px; height: 26px; border-radius: 6px; background: var(--accent-dim); color: var(--accent); display: grid; place-items: center; flex-shrink: 0; }
      .plg-ico.lg { width: 32px; height: 32px; }
      .plg-row.off .plg-ico { opacity: .45; }
      .plg-row.off .plg-nm { color: var(--text-muted); }
      .plg-info { flex: 1; min-width: 0; }
      .plg-nm { font-size: 12.5px; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .plg-ds { font-size: 11px; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .plg-ds.err { color: color-mix(in srgb, var(--red) 70%, var(--text-muted)); }
      .plg-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
      .plg-dot.ok { background: var(--green); }
      .plg-dot.off { border: 1px solid var(--text-muted); }
      .plg-upd { font-size: 10px; color: var(--accent); border: 1px solid color-mix(in srgb, var(--accent) 45%, transparent); border-radius: 4px; padding: 0 4px; flex-shrink: 0; }
      .plg-muted { font-size: 11px; color: var(--text-muted); flex-shrink: 0; }
      .plg-spin { animation: plg-rot 1s linear infinite; color: var(--text-muted); flex-shrink: 0; }
      @keyframes plg-rot { to { transform: rotate(360deg); } }
      .plg-error { margin: 8px 10px; padding: 6px 8px; font-size: 11px; color: var(--red); background: var(--surface-2); border: 1px solid color-mix(in srgb, var(--red) 40%, transparent); border-radius: 6px; overflow-wrap: anywhere; white-space: pre-wrap; }
      .plg-empty { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 32px 16px; color: var(--text-muted); font-size: 12px; text-align: center; }
      .plg-back { display: flex; align-items: center; gap: 6px; padding: 8px 12px; border: none; border-bottom: 1px solid var(--border-hairline); background: none; color: var(--text-muted); cursor: pointer; font-size: 11px; width: 100%; }
      .plg-back:hover { color: var(--text); }
      .plg-dhd { padding: 12px; border-bottom: 1px solid var(--border-hairline); }
      .plg-dht { display: flex; gap: 10px; align-items: center; margin-bottom: 8px; min-width: 0; }
      .plg-dnm { font-size: 14px; font-weight: 600; color: var(--text); overflow-wrap: anywhere; }
      .plg-sub { font-size: 11px; color: var(--text-muted); overflow-wrap: anywhere; }
      .plg-pill { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; padding: 2px 8px; border-radius: 10px; background: var(--surface-2); border: 1px solid var(--border-subtle); max-width: 100%; }
      .plg-acts { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; margin-top: 10px; }
      .plg-toggle { display: inline-flex; align-items: center; gap: 6px; font-size: 11.5px; color: var(--text); background: none; border: none; padding: 0; cursor: pointer; }
      .plg-toggle:disabled { opacity: .45; cursor: not-allowed; }
      .plg-switch { width: 26px; height: 14px; border-radius: 8px; background: var(--surface-4); position: relative; transition: background var(--dur-fast) var(--ease-out-soft); }
      .plg-switch::after { content: ''; position: absolute; left: 2px; top: 2px; width: 10px; height: 10px; border-radius: 50%; background: var(--text-muted); transition: transform var(--dur-fast) var(--ease-out-soft), background var(--dur-fast); }
      .plg-toggle[aria-checked="true"] .plg-switch { background: var(--green); }
      .plg-toggle[aria-checked="true"] .plg-switch::after { transform: translateX(12px); background: #fff; }
      .plg-note { margin-top: 8px; font-size: 11px; color: var(--accent); background: var(--accent-dim); border: 1px solid color-mix(in srgb, var(--accent) 30%, transparent); border-radius: 6px; padding: 5px 8px; }
      .plg-derr { margin-top: 8px; font-size: 11px; color: var(--red); overflow-wrap: anywhere; white-space: pre-wrap; }
      .plg-sec { padding: 10px 12px; border-bottom: 1px solid var(--border-hairline); }
      .plg-sec h4 { display: flex; justify-content: space-between; margin: 0 0 6px; font-size: 10.5px; color: var(--text-muted); text-transform: uppercase; letter-spacing: .08em; font-weight: 500; }
      .plg-desc { font-size: 11.5px; line-height: 1.5; color: var(--text-secondary); }
      .plg-item { font: 11.5px 'Geist Mono', monospace; padding: 2px 0; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .plg-item span { color: var(--text-muted); font-family: inherit; margin-left: 6px; font-size: 11px; }
      .plg-link { background: none; border: none; color: var(--accent); font-size: 11px; padding: 6px 0 0; cursor: pointer; }
      .plg-link:hover { text-decoration: underline; }
      .plg-meta { display: grid; grid-template-columns: auto 1fr; gap: 3px 10px; font-size: 11px; color: var(--text); }
      .plg-meta dt { color: var(--text-muted); }
      .plg-meta dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }
      .plg-mono { font: 10.5px 'Geist Mono', monospace; color: var(--text-secondary); }
    `}</style>
  );
}
