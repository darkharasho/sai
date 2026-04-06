// src/components/TerminalMode/HiddenXterm.tsx
import { useEffect, useRef, useImperativeHandle, forwardRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

export interface HiddenXtermHandle {
  /** Write data from PTY into xterm for state tracking */
  write: (data: string) => void;
  /** Send user input to PTY */
  sendInput: (data: string) => void;
  /** Get the xterm Terminal instance */
  getTerminal: () => Terminal | null;
  /** Focus the xterm terminal (for alt-screen mode) */
  focus: () => void;
}

interface HiddenXtermProps {
  ptyId: number;
  visible: boolean; // true when alt-screen active
  onData?: (data: string) => void; // forward raw data to BlockSegmenter
}

export default forwardRef<HiddenXtermHandle, HiddenXtermProps>(
  function HiddenXterm({ ptyId, visible, onData }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const xtermRef = useRef<Terminal | null>(null);
    const fitRef = useRef<FitAddon | null>(null);

    useEffect(() => {
      if (!containerRef.current) return;

      const xterm = new Terminal({
        theme: {
          background: '#0a0d0f',
          foreground: '#bec6d0',
          cursor: '#bec6d0',
          cursorAccent: '#0a0d0f',
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

      // Capture Tab so the shell receives it for completion
      xterm.attachCustomKeyEventHandler((e) => {
        if (e.key === 'Tab') return true;
        return true;
      });

      // Forward keyboard input to PTY
      xterm.onData((data) => {
        window.sai.terminalWrite(ptyId, data);
      });

      xtermRef.current = xterm;
      fitRef.current = fit;

      return () => {
        xterm.dispose();
        xtermRef.current = null;
        fitRef.current = null;
      };
    }, [ptyId]);

    // Fit and focus when visibility changes
    useEffect(() => {
      if (visible && fitRef.current && containerRef.current) {
        requestAnimationFrame(() => {
          try {
            fitRef.current?.fit();
            if (xtermRef.current) {
              window.sai.terminalResize(ptyId, xtermRef.current.cols, xtermRef.current.rows);
              xtermRef.current.focus();
            }
          } catch { /* ignore */ }
        });
      }
    }, [visible, ptyId]);

    // Resize observer
    useEffect(() => {
      if (!containerRef.current) return;
      const observer = new ResizeObserver(() => {
        if (!visible) return;
        requestAnimationFrame(() => {
          try {
            fitRef.current?.fit();
            if (xtermRef.current) {
              window.sai.terminalResize(ptyId, xtermRef.current.cols, xtermRef.current.rows);
            }
          } catch { /* ignore */ }
        });
      });
      observer.observe(containerRef.current);
      return () => observer.disconnect();
    }, [ptyId, visible]);

    useImperativeHandle(ref, () => ({
      write(data: string) {
        xtermRef.current?.write(data);
        onData?.(data);
      },
      sendInput(data: string) {
        window.sai.terminalWrite(ptyId, data);
      },
      getTerminal() {
        return xtermRef.current;
      },
      focus() {
        xtermRef.current?.focus();
      },
    }), [ptyId, onData]);

    return (
      <div
        ref={containerRef}
        className="tm-hidden-xterm"
        style={visible ? {
          position: 'relative',
          flex: 1,
          minHeight: 0,
          overflow: 'hidden',
        } : {
          position: 'absolute',
          inset: 0,
          visibility: 'hidden',
          pointerEvents: 'none',
          overflow: 'hidden',
        }}
      />
    );
  }
);
