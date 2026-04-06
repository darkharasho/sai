import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

interface LiveTerminalProps {
  ptyId: number;
  command: string;
  cwd: string;
  fullWidth?: boolean;
  onXtermReady?: (xterm: Terminal) => void;
}

/** Extracts text content from an xterm buffer, stripping the echoed command and trailing prompt. */
export function extractTerminalOutput(xterm: Terminal, command: string): string {
  const buffer = xterm.buffer.active;
  const lines: string[] = [];
  for (let i = 0; i <= buffer.baseY + buffer.cursorY; i++) {
    const line = buffer.getLine(i);
    if (line) lines.push(line.translateToString(true));
  }
  let text = lines.join('\n').trimEnd();
  // Strip leading echoed command
  const cmdIdx = text.indexOf(command);
  if (cmdIdx !== -1) {
    text = text.slice(cmdIdx + command.length).replace(/^\r?\n/, '');
  }
  // Strip trailing prompt line (last non-empty line that looks like a prompt)
  const outputLines = text.split('\n');
  while (outputLines.length > 0) {
    const last = outputLines[outputLines.length - 1].trim();
    if (!last || /[\$#%>❯]\s*$/.test(last)) {
      outputLines.pop();
    } else {
      break;
    }
  }
  return outputLines.join('\n').trimEnd();
}

export default function LiveTerminal({ ptyId, command, cwd, fullWidth, onXtermReady }: LiveTerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const xterm = new Terminal({
      theme: {
        background: '#0c0f11',
        foreground: '#bec6d0',
        cursor: '#bec6d0',
        cursorAccent: '#0c0f11',
        selectionBackground: 'rgba(199, 145, 12, 0.3)',
        black: '#0c0f11',
        red: '#E35535',
        green: '#00a884',
        yellow: '#c7910c',
        blue: '#11B7D4',
        magenta: '#d46ec0',
        cyan: '#38c7bd',
        white: '#bec6d0',
        brightBlack: '#5a6a7a',
        brightRed: '#E35535',
        brightGreen: '#00a884',
        brightYellow: '#f5b832',
        brightBlue: '#11B7D4',
        brightMagenta: '#a85ff1',
        brightCyan: '#38c7bd',
        brightWhite: '#ffffff',
      },
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      fontSize: 12,
      cursorBlink: true,
      scrollback: 5000,
      convertEol: true,
    });

    const fit = new FitAddon();
    xterm.loadAddon(fit);
    xterm.open(containerRef.current);

    requestAnimationFrame(() => {
      try { fit.fit(); } catch { /* ignore */ }
      window.sai.terminalResize(ptyId, xterm.cols, xterm.rows);
    });

    xtermRef.current = xterm;
    fitRef.current = fit;
    onXtermReady?.(xterm);

    // Forward keyboard input to PTY
    xterm.onData((data) => {
      window.sai.terminalWrite(ptyId, data);
    });

    // Listen for PTY data
    const cleanup = window.sai.terminalOnData((id: number, data: string) => {
      if (id === ptyId) xterm.write(data);
    });

    // Handle resize
    const resizeObserver = new ResizeObserver(() => {
      requestAnimationFrame(() => {
        try {
          fit.fit();
          window.sai.terminalResize(ptyId, xterm.cols, xterm.rows);
        } catch { /* ignore */ }
      });
    });
    resizeObserver.observe(containerRef.current);

    // Focus the terminal
    xterm.focus();

    return () => {
      cleanup();
      resizeObserver.disconnect();
      xterm.dispose();
    };
  }, [ptyId]);

  return (
    <div className={`tm-live-wrapper ${fullWidth ? 'tm-live-full-width' : ''}`}>
      <div className="tm-live-box">
        <div className="tm-live-header">
          <span className="tm-live-cwd">{cwd.replace(/^\/var\/home\/[^/]+/, '~').replace(/^\/home\/[^/]+/, '~')}</span>
        </div>
        <div className="tm-live-cmd-row">
          <span className="tm-live-prompt">$</span>
          <span className="tm-live-command">{command}</span>
          <span className="tm-live-dot" />
        </div>
        <div ref={containerRef} className="tm-live-terminal" />
      </div>

      <style>{`
        .tm-live-wrapper {
          padding: 0 15% 14px;
          flex: 1;
          min-height: 0;
          display: flex;
          flex-direction: column;
          justify-content: flex-end;
          transition: padding 0.3s ease;
        }
        .tm-live-wrapper.tm-live-full-width {
          padding-left: 16px;
          padding-right: 16px;
        }
        .tm-live-box {
          position: relative;
          border-radius: 4px;
          background: #0c0f11;
          overflow: visible;
          display: flex;
          flex-direction: column;
          flex: 1;
          min-height: 0;
        }
        .tm-live-box::before {
          content: '';
          position: absolute;
          inset: -2px;
          border-radius: 6px;
          padding: 2px;
          background: linear-gradient(135deg, var(--accent) 0%, var(--orange) 20%, var(--red) 50%, var(--orange) 80%, var(--accent) 100%);
          background-size: 300% 300%;
          animation: tm-gradient-sweep 20s ease-in-out infinite alternate;
          -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
          -webkit-mask-composite: xor;
          mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
          mask-composite: exclude;
          pointer-events: none;
          z-index: 0;
          opacity: 1;
        }
        .tm-live-header {
          position: relative;
          z-index: 1;
          padding: 6px 14px 0;
          flex-shrink: 0;
        }
        .tm-live-cwd {
          color: var(--text-muted);
          font-family: 'JetBrains Mono', monospace;
          font-size: 11px;
        }
        .tm-live-cmd-row {
          position: relative;
          z-index: 1;
          padding: 4px 14px 6px;
          display: flex;
          align-items: center;
          gap: 8px;
          font-family: 'JetBrains Mono', monospace;
          font-size: 13px;
          border-bottom: 1px solid var(--bg-hover);
          flex-shrink: 0;
        }
        .tm-live-prompt {
          color: var(--accent);
          font-weight: 600;
          flex-shrink: 0;
        }
        .tm-live-command {
          color: var(--text);
          flex: 1;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .tm-live-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: var(--green);
          animation: tm-live-pulse 1.5s ease-in-out infinite;
          flex-shrink: 0;
        }
        @keyframes tm-live-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
        .tm-live-terminal {
          position: relative;
          z-index: 1;
          flex: 1;
          min-height: 0;
          padding: 4px 0;
        }
        .tm-live-terminal .xterm {
          padding: 0 8px;
        }
        @keyframes tm-gradient-sweep {
          0% { background-position: 0% 0%; }
          100% { background-position: 100% 100%; }
        }
      `}</style>
    </div>
  );
}
