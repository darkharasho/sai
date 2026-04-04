import { useEffect, useRef, useState, useCallback } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { RotateCw } from 'lucide-react';
import { registerTerminal, unregisterTerminal, setActiveTerminalId } from '../../terminalBuffer';
import { getTerminalTheme, type ThemeId } from '../../themes';
import type { TerminalTab } from '../../types';
import '@xterm/xterm/css/xterm.css';

// ─── TerminalInstance ────────────────────────────────────────────────────────

interface TerminalInstanceProps {
  tabUid: number;
  projectPath: string;
  visible: boolean;
  onTerminalReady?: (tabUid: number, ptyId: number) => void;
}

function TerminalInstance({ tabUid, projectPath, visible, onTerminalReady }: TerminalInstanceProps) {
  const termRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const termIdRef = useRef<number | null>(null);
  const openedRef = useRef(false);

  useEffect(() => {
    if (!termRef.current) return;
    const cwd = projectPath || '';

    const xterm = new Terminal({
      theme: getTerminalTheme('default'),
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
      fontSize: 13,
      cursorBlink: true,
    });

    // Apply saved theme
    window.sai.settingsGet('theme', 'default').then((v: string) => {
      if (v !== 'default') xterm.options.theme = getTerminalTheme(v as ThemeId);
    });

    const fit = new FitAddon();
    xterm.loadAddon(fit);
    xterm.loadAddon(new WebLinksAddon((_event, url) => {
      window.sai.openExternal(url);
    }));

    // Only open xterm when container is visible (non-zero dimensions).
    // Opening into a display:none container causes xterm renderer crashes.
    if (visible && termRef.current.offsetWidth > 0) {
      xterm.open(termRef.current);
      openedRef.current = true;
      requestAnimationFrame(() => {
        try { fit.fit(); } catch { /* terminal not ready yet */ }
      });
    }

    // Listen for live theme changes
    const onThemeChange = (e: Event) => {
      const { terminal } = (e as CustomEvent).detail;
      xterm.options.theme = terminal;
    };
    window.addEventListener('sai-theme-change', onThemeChange);

    xtermRef.current = xterm;
    fitRef.current = fit;

    // Handle Ctrl+Shift+C (copy) and Ctrl+Shift+V (paste)
    xterm.attachCustomKeyEventHandler((e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.type === 'keydown') {
        if (e.key === 'C' || e.code === 'KeyC') {
          e.preventDefault();
          const sel = xterm.getSelection();
          if (sel) navigator.clipboard.writeText(sel);
          return false;
        }
        if (e.key === 'V' || e.code === 'KeyV') {
          e.preventDefault();
          navigator.clipboard.readText().then(text => {
            if (text) xterm.paste(text);
          });
          return false;
        }
      }
      return true;
    });

    // Create terminal in main process
    window.sai.terminalCreate(cwd).then((id: number) => {
      termIdRef.current = id;
      registerTerminal(id, xterm, projectPath);
      onTerminalReady?.(tabUid, id);

      xterm.onData((data) => {
        window.sai.terminalWrite(id, data);
      });

      xterm.onResize(({ cols, rows }) => {
        window.sai.terminalResize(id, cols, rows);
      });

      // Sync initial dimensions — fit.fit() may have already fired before
      // the PTY was created, so the PTY could still be at default 80x24.
      window.sai.terminalResize(id, xterm.cols, xterm.rows);
    });

    // Receive pty output
    const cleanup = window.sai.terminalOnData((id: number, data: string) => {
      if (id === termIdRef.current) {
        xterm.write(data);
      }
    });

    // Handle container resize — skip fitting when hidden (zero dimensions)
    const container = termRef.current;
    const resizeObserver = new ResizeObserver(() => {
      if (container.offsetWidth === 0 || container.offsetHeight === 0) return;
      try { fit.fit(); } catch { /* terminal may not be fully initialized */ }
    });
    resizeObserver.observe(container);

    // Re-fit when the terminal becomes visible again (e.g. workspace swap)
    const intersectionObserver = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) {
        try { fit.fit(); } catch { /* ignore */ }
        xterm.refresh(0, xterm.rows - 1);
      }
    });
    intersectionObserver.observe(container);

    return () => {
      if (termIdRef.current !== null) {
        unregisterTerminal(termIdRef.current);
        window.sai.terminalKill(termIdRef.current);
      }
      cleanup();
      window.removeEventListener('sai-theme-change', onThemeChange);
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      xterm.dispose();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectPath, tabUid]);

  // Open xterm when first becoming visible, or re-fit if already open
  useEffect(() => {
    if (!visible || !termRef.current) return;
    if (!openedRef.current && xtermRef.current) {
      xtermRef.current.open(termRef.current);
      openedRef.current = true;
      requestAnimationFrame(() => {
        try { fitRef.current?.fit(); } catch { /* ignore */ }
      });
    } else if (fitRef.current) {
      requestAnimationFrame(() => {
        try { fitRef.current?.fit(); } catch { /* ignore */ }
      });
    }
  }, [visible]);

  return (
    <div
      className="terminal-content"
      ref={termRef}
      style={{ display: visible ? undefined : 'none' }}
    />
  );
}

// ─── TerminalPanel ───────────────────────────────────────────────────────────

interface TerminalPanelProps {
  projectPath: string;
  isActive: boolean;
  wasSuspended: boolean;
  terminalTabs: TerminalTab[];
  activeTerminalId: number | null;
  onTabCreate: () => void;
  onTabClose: (id: number) => void;
  onTabSwitch: (id: number) => void;
  onTabRename: (id: number, name: string) => void;
  onTerminalReady?: (tabId: number, ptyId: number) => void;
}

export default function TerminalPanel({
  projectPath,
  isActive,
  wasSuspended,
  terminalTabs,
  activeTerminalId,
  onTabCreate,
  onTabClose,
  onTabSwitch,
  onTabRename,
  onTerminalReady,
}: TerminalPanelProps) {
  // restartKeys keyed by tab uid
  const [restartKeys, setRestartKeys] = useState<Map<number, number>>(new Map());
  const prevSuspendedRef = useRef(wasSuspended);

  // process name polling state: tabId → processName
  const [processNames, setProcessNames] = useState<Record<number, string>>({});

  // inline rename state
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState('');

  // close confirmation dialog state
  const [confirmCloseId, setConfirmCloseId] = useState<number | null>(null);

  // Auto-restart only when workspace resumes after suspension (PTY was killed)
  useEffect(() => {
    if (!wasSuspended && prevSuspendedRef.current) {
      // Bump all tab restart keys on resume (all PTYs were killed)
      setRestartKeys(prev => {
        const next = new Map(prev);
        for (const tab of terminalTabs) {
          next.set(tab.uid, (next.get(tab.uid) ?? 0) + 1);
        }
        return next;
      });
    }
    prevSuspendedRef.current = wasSuspended;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wasSuspended]);

  const handleRestart = useCallback(() => {
    // Only restart the active terminal (activeTerminalId is a uid)
    if (activeTerminalId !== null) {
      setRestartKeys(prev => {
        const next = new Map(prev);
        next.set(activeTerminalId, (next.get(activeTerminalId) ?? 0) + 1);
        return next;
      });
    }
  }, [activeTerminalId]);

  // Update active terminal in buffer when active tab changes (use PTY id for buffer)
  useEffect(() => {
    if (activeTerminalId !== null) {
      const activeTab = terminalTabs.find(t => t.uid === activeTerminalId);
      if (activeTab && activeTab.id > 0) {
        setActiveTerminalId(projectPath, activeTab.id);
      }
    }
  }, [projectPath, activeTerminalId, terminalTabs]);

  // Poll process names every 3 seconds when active
  useEffect(() => {
    if (!isActive) return;

    const poll = async () => {
      const updates: Record<number, string> = {};
      for (const tab of terminalTabs) {
        if (tab.id <= 0) continue; // no PTY assigned yet
        try {
          const name: string = await window.sai.terminalGetProcess(tab.id);
          if (name) updates[tab.uid] = name;
        } catch {
          // ignore
        }
      }
      setProcessNames(prev => ({ ...prev, ...updates }));
    };

    poll();
    const interval = setInterval(poll, 3000);
    return () => clearInterval(interval);
  }, [isActive, terminalTabs]);

  // ── Tab rename helpers ─────────────────────────────────────────────────────

  const startRename = (tab: TerminalTab) => {
    setRenamingId(tab.uid);
    setRenameValue(tab.name ?? '');
  };

  const commitRename = (uid: number) => {
    const trimmed = renameValue.trim();
    if (trimmed.toLowerCase() === 'last') {
      setRenamingId(null);
      return; // reserved word — reject silently
    }
    onTabRename(uid, trimmed);
    setRenamingId(null);
  };

  const cancelRename = () => {
    setRenamingId(null);
    setRenameValue('');
  };

  // ── Tab close helpers ──────────────────────────────────────────────────────

  const handleCloseRequest = (tab: TerminalTab) => {
    const processName = processNames[tab.uid];
    const isShell = !processName || /^(bash|sh|zsh|fish|dash|ksh|tcsh|csh)$/.test(processName);
    if (!isShell) {
      setConfirmCloseId(tab.uid);
    } else {
      onTabClose(tab.uid);
    }
  };

  const confirmClose = () => {
    if (confirmCloseId !== null) {
      onTabClose(confirmCloseId);
      setConfirmCloseId(null);
    }
  };

  const cancelClose = () => {
    setConfirmCloseId(null);
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  const multiTab = terminalTabs.length > 1;

  // Build a stable key for each TerminalInstance — uses uid (never changes) + restart counter
  const instanceKey = (tab: TerminalTab) => `${tab.uid}-${restartKeys.get(tab.uid) ?? 0}`;

  return (
    <div className="terminal-panel">
      <div className="terminal-header">
        <span>TERMINAL</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <button
            className="terminal-restart-btn"
            onClick={handleRestart}
            title="Restart terminal"
          >
            <RotateCw size={12} />
          </button>
          {!multiTab && (
            <button
              className="terminal-restart-btn"
              onClick={onTabCreate}
              title="New terminal"
            >
              +
            </button>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Terminal instances */}
        <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
          {terminalTabs.map(tab => (
            <TerminalInstance
              key={instanceKey(tab)}
              tabUid={tab.uid}
              projectPath={projectPath}
              visible={tab.uid === activeTerminalId}
              onTerminalReady={onTerminalReady}
            />
          ))}
        </div>

        {/* Tab pane — only shown with 2+ tabs */}
        {multiTab && (
          <div className="terminal-tab-pane" data-testid="terminal-tab-pane">
            {terminalTabs.map(tab => {
              const isTabActive = tab.uid === activeTerminalId;
              const label = tab.name ?? processNames[tab.uid] ?? `Terminal ${tab.order}`;
              return (
                <div
                  key={tab.uid}
                  className={`terminal-tab-item${isTabActive ? ' terminal-tab-active' : ''}`}
                  onClick={() => onTabSwitch(tab.uid)}
                >
                  {renamingId === tab.uid ? (
                    <input
                      className="terminal-tab-rename-input"
                      value={renameValue}
                      onChange={e => setRenameValue(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') commitRename(tab.uid);
                        if (e.key === 'Escape') cancelRename();
                      }}
                      onBlur={() => commitRename(tab.uid)}
                      autoFocus
                      onClick={e => e.stopPropagation()}
                    />
                  ) : (
                    <span
                      className="terminal-tab-label"
                      onDoubleClick={e => { e.stopPropagation(); startRename(tab); }}
                    >
                      {tab.order}: {label}
                    </span>
                  )}
                  <button
                    className="terminal-tab-close"
                    onClick={e => { e.stopPropagation(); handleCloseRequest(tab); }}
                    title="Close terminal"
                  >
                    ×
                  </button>
                </div>
              );
            })}
            <button className="terminal-tab-add" onClick={onTabCreate} title="New terminal">
              +
            </button>
          </div>
        )}
      </div>

      {/* Close confirmation dialog */}
      {confirmCloseId !== null && (
        <div className="terminal-confirm-overlay">
          <div className="terminal-confirm-dialog">
            <p>A process is running. Close this terminal?</p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={cancelClose}>Cancel</button>
              <button onClick={confirmClose}>Close</button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .terminal-panel {
          height: 280px;
          flex-shrink: 0;
          border-top: 1px solid var(--border);
          display: flex;
          flex-direction: column;
          background: var(--bg-mid);
          overflow: hidden;
        }
        .terminal-header {
          padding: 6px 12px;
          font-size: 11px;
          text-transform: uppercase;
          color: var(--text-secondary);
          border-bottom: 1px solid var(--border);
          letter-spacing: 0.5px;
          flex-shrink: 0;
          display: flex;
          align-items: center;
          justify-content: space-between;
        }
        .terminal-restart-btn {
          background: none;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
          padding: 2px;
          display: flex;
          align-items: center;
          border-radius: 3px;
        }
        .terminal-restart-btn:hover {
          color: var(--text);
          background: var(--bg-hover);
        }
        .terminal-content {
          overflow: hidden;
          position: absolute;
          top: 4px;
          left: 4px;
          right: 4px;
          bottom: 6px;
        }
        .terminal-tab-pane {
          width: 140px;
          border-left: 1px solid var(--border);
          background: var(--bg-secondary);
          display: flex;
          flex-direction: column;
          overflow-y: auto;
          flex-shrink: 0;
        }
        .terminal-tab-item {
          display: flex;
          align-items: center;
          padding: 6px 8px;
          font-size: 11px;
          color: var(--text-secondary);
          cursor: pointer;
          gap: 4px;
          position: relative;
        }
        .terminal-tab-item:hover {
          background: var(--bg-hover);
        }
        .terminal-tab-item:hover .terminal-tab-close {
          opacity: 1;
        }
        .terminal-tab-active {
          border-left: 2px solid var(--accent, #c7910c);
          background: var(--bg-active, rgba(199,145,12,0.1));
          color: var(--text);
        }
        .terminal-tab-label {
          flex: 1;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .terminal-tab-close {
          background: none;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
          padding: 0 2px;
          opacity: 0;
          font-size: 14px;
          line-height: 1;
          flex-shrink: 0;
        }
        .terminal-tab-close:hover {
          color: var(--text);
        }
        .terminal-tab-rename-input {
          flex: 1;
          background: var(--bg-input, #1a1f24);
          border: 1px solid var(--accent, #c7910c);
          color: var(--text);
          font-size: 11px;
          padding: 1px 4px;
          border-radius: 2px;
          outline: none;
          min-width: 0;
        }
        .terminal-tab-add {
          background: none;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
          padding: 6px 8px;
          font-size: 14px;
          text-align: left;
          border-top: 1px solid var(--border);
          margin-top: auto;
        }
        .terminal-tab-add:hover {
          color: var(--text);
          background: var(--bg-hover);
        }
        .terminal-confirm-overlay {
          position: absolute;
          inset: 0;
          background: rgba(0,0,0,0.5);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 10;
        }
        .terminal-confirm-dialog {
          background: var(--bg-mid);
          border: 1px solid var(--border);
          border-radius: 6px;
          padding: 16px;
          max-width: 300px;
          font-size: 13px;
        }
      `}</style>
    </div>
  );
}
