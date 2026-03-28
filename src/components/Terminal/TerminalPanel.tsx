import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';

export default function TerminalPanel({ projectPath }: { projectPath: string }) {
  const termRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const termIdRef = useRef<number | null>(null);

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
    xterm.loadAddon(new WebLinksAddon());
    xterm.open(termRef.current);
    fit.fit();

    xtermRef.current = xterm;
    fitRef.current = fit;

    // Create terminal in main process
    window.vsai.terminalCreate(cwd).then((id: number) => {
      termIdRef.current = id;

      xterm.onData((data) => {
        window.vsai.terminalWrite(id, data);
      });

      xterm.onResize(({ cols, rows }) => {
        window.vsai.terminalResize(id, cols, rows);
      });
    });

    // Receive pty output
    const cleanup = window.vsai.terminalOnData((id: number, data: string) => {
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
  }, [projectPath]);

  return (
    <div className="terminal-panel">
      <div className="terminal-header">
        <span>TERMINAL</span>
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
        }
        .terminal-content {
          flex: 1;
          margin: 4px 4px 24px 4px;
          overflow: hidden;
        }
      `}</style>
    </div>
  );
}
