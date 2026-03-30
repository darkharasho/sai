import { useEffect, useRef, useState, useCallback } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { RotateCw } from 'lucide-react';
import '@xterm/xterm/css/xterm.css';

export default function TerminalPanel({ projectPath }: { projectPath: string }) {
  const termRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const termIdRef = useRef<number | null>(null);
  const [restartKey, setRestartKey] = useState(0);

  const handleRestart = useCallback(() => {
    setRestartKey(k => k + 1);
  }, []);

  useEffect(() => {
    if (!termRef.current) return;
    const cwd = projectPath || '';

    const xterm = new Terminal({
      theme: {
        background: '#0e1114',
        foreground: '#bec6d0',
        cursor: '#c7910c',
        selectionBackground: '#c7910c44',
        black: '#000000',
        brightBlack: '#475262',
        red: '#E35535',
        green: '#00a884',
        yellow: '#c7910c',
        blue: '#11B7D4',
        magenta: '#d46ec0',
        cyan: '#38c7bd',
        white: '#FFFFFF',
        brightWhite: '#dce0e5',
      },
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
      fontSize: 13,
      cursorBlink: true,
    });

    const fit = new FitAddon();
    xterm.loadAddon(fit);
    xterm.loadAddon(new WebLinksAddon((_event, url) => {
      window.sai.openExternal(url);
    }));
    xterm.open(termRef.current);
    fit.fit();

    xtermRef.current = xterm;
    fitRef.current = fit;

    // Handle Ctrl+Shift+C (copy) and Ctrl+Shift+V (paste)
    xterm.attachCustomKeyEventHandler((e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.type === 'keydown') {
        if (e.key === 'C' || e.code === 'KeyC') {
          const sel = xterm.getSelection();
          if (sel) navigator.clipboard.writeText(sel);
          return false;
        }
        if (e.key === 'V' || e.code === 'KeyV') {
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

      xterm.onData((data) => {
        window.sai.terminalWrite(id, data);
      });

      xterm.onResize(({ cols, rows }) => {
        window.sai.terminalResize(id, cols, rows);
      });
    });

    // Receive pty output
    const cleanup = window.sai.terminalOnData((id: number, data: string) => {
      if (id === termIdRef.current) {
        xterm.write(data);
      }
    });

    // Handle container resize
    const resizeObserver = new ResizeObserver(() => {
      fit.fit();
    });
    resizeObserver.observe(termRef.current);

    return () => {
      cleanup();
      resizeObserver.disconnect();
      xterm.dispose();
    };
  }, [projectPath, restartKey]);

  return (
    <div className="terminal-panel">
      <div className="terminal-header">
        <span>TERMINAL</span>
        <button className="terminal-restart-btn" onClick={handleRestart} title="Restart terminal">
          <RotateCw size={12} />
        </button>
      </div>
      <div className="terminal-content" ref={termRef} />
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
          flex: 1;
          margin: 4px 4px 8px 4px;
          overflow: hidden;
        }
      `}</style>
    </div>
  );
}
