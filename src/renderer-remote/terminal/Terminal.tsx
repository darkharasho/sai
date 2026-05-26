import { useEffect, useRef, useState } from 'react';
import type { WireClient, WireMsg } from '../wire';
import TerminalToolbar from './TerminalToolbar';

type XTermInstance = any; // narrowed at runtime via dynamic import
type FitAddonInstance = any;

interface Props {
  client: WireClient;
  termId: number;
  cwd: string;
  onBack: () => void;
  /** Called when the PTY has exited and the user dismisses the message. */
  onExit?: (code: number) => void;
}

export default function Terminal({ client, termId, cwd: _cwd, onBack, onExit }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<XTermInstance | null>(null);
  const fitRef = useRef<FitAddonInstance | null>(null);
  const [exited, setExited] = useState<number | null>(null);
  const [ctrlSticky, setCtrlSticky] = useState(false);

  // Mount xterm.js lazily on first render
  useEffect(() => {
    let cancelled = false;
    let dispOnData: { dispose: () => void } | null = null;
    let cleanupOnMsg: (() => void) | null = null;

    void Promise.all([
      import('@xterm/xterm'),
      import('@xterm/addon-fit'),
      import('@xterm/addon-canvas'),
    ]).then(([xterm, fitMod, canvasMod]) => {
      if (cancelled || !containerRef.current) return;
      const term = new xterm.Terminal({
        cursorBlink: true,
        fontFamily: '"Geist Mono", ui-monospace, monospace',
        fontSize: 13,
        theme: { background: '#000000' },
        // iOS Safari's DOM renderer mis-aligns the cursor; canvas renders cleanly.
        allowProposedApi: true,
      });
      const fit = new fitMod.FitAddon();
      term.loadAddon(fit);
      term.open(containerRef.current);
      try { term.loadAddon(new canvasMod.CanvasAddon()); } catch { /* fall back to DOM renderer */ }
      const ta = (term as any).textarea as HTMLTextAreaElement | undefined;
      if (ta) {
        ta.setAttribute('autocorrect', 'off');
        ta.setAttribute('autocapitalize', 'none');
        ta.setAttribute('spellcheck', 'false');
        ta.setAttribute('inputmode', 'text');
        // iOS will only show the virtual keyboard for an input that is in
        // viewport with non-zero size. xterm's helper textarea is parked off-
        // screen by default. Overlay it on the visible terminal so taps land
        // directly on it (iOS treats that as a real user gesture).
        ta.style.position = 'absolute';
        ta.style.top = '0';
        ta.style.left = '0';
        ta.style.width = '100%';
        ta.style.height = '100%';
        ta.style.opacity = '0';
        ta.style.zIndex = '10';
        ta.style.background = 'transparent';
        ta.style.border = 'none';
        ta.style.outline = 'none';
        ta.style.resize = 'none';
        ta.style.caretColor = 'transparent';
      }
      termRef.current = term;
      fitRef.current = fit;

      // The container's height is 0 on initial mount until the flex layout
      // settles. Defer fit() until after layout so cols/rows are real.
      const doFit = () => {
        if (!termRef.current) return;
        try {
          fit.fit();
          // Tell the server about the real dims so the PTY isn't 80x24.
          client.resizeTerminal(termId, term.cols, term.rows);
        } catch { /* ignore */ }
      };
      requestAnimationFrame(() => { doFit(); requestAnimationFrame(doFit); });
      term.focus();

      // Wire input
      dispOnData = term.onData((data: string) => {
        client.inputTerminal(termId, data);
        // iOS: keep the cursor in view as the user types.
        try { term.scrollToBottom(); } catch { /* ignore */ }
        // Auto-hide the soft keyboard after a line is submitted so output is
        // readable without manually dismissing.
        if (data.includes('\r') || data.includes('\n')) {
          const ta = (term as any).textarea as HTMLTextAreaElement | undefined;
          ta?.blur();
        }
      });

      // Subscribe to terminal.output / terminal.exit for this termId
      cleanupOnMsg = client.on((msg: WireMsg) => {
        if ((msg as any).termId !== termId) return;
        if (msg.type === 'terminal.output') {
          term.write(String((msg as any).data ?? ''));
        } else if (msg.type === 'terminal.exit') {
          const code = (msg as any).code as number;
          term.write(`\r\n\x1b[33m[process exited (${code})]\x1b[0m\r\n`);
          setExited(code);
        }
      });

      // Attach (replay + live)
      const { cols, rows } = term;
      client.attachTerminal(termId, cols, rows).catch(() => { /* surfaced via error msg */ });
    });

    return () => {
      cancelled = true;
      dispOnData?.dispose();
      cleanupOnMsg?.();
      try { client.detachTerminal(termId); } catch { /* ignore */ }
      try { termRef.current?.dispose(); } catch { /* ignore */ }
      termRef.current = null;
      fitRef.current = null;
    };
  }, [client, termId]);

  // Recompute size on viewport changes (iOS keyboard show/hide, drawer changes)
  useEffect(() => {
    const recompute = () => {
      const fit = fitRef.current;
      const term = termRef.current;
      if (!fit || !term) return;
      try {
        fit.fit();
        client.resizeTerminal(termId, term.cols, term.rows);
      } catch { /* ignore */ }
    };
    const vv = (window as any).visualViewport as VisualViewport | undefined;
    vv?.addEventListener('resize', recompute);
    window.addEventListener('resize', recompute);
    const ro = new ResizeObserver(recompute);
    if (containerRef.current) ro.observe(containerRef.current);
    return () => {
      vv?.removeEventListener('resize', recompute);
      window.removeEventListener('resize', recompute);
      ro.disconnect();
    };
  }, [client, termId]);

  const sendBytes = (data: string) => {
    client.inputTerminal(termId, data);
    try { termRef.current?.scrollToBottom(); } catch { /* ignore */ }
  };

  const onToolbarKey = (key: 'Esc' | 'Tab' | 'Up' | 'Down' | 'Left' | 'Right' | 'Ctrl') => {
    if (key === 'Ctrl') { setCtrlSticky((v) => !v); return; }
    if (ctrlSticky) {
      // Ctrl+<key> only well-defined for letters; for arrows/Esc/Tab we still emit the base sequence.
      setCtrlSticky(false);
    }
    switch (key) {
      case 'Esc':   return sendBytes('\x1b');
      case 'Tab':   return sendBytes('\t');
      case 'Up':    return sendBytes('\x1b[A');
      case 'Down':  return sendBytes('\x1b[B');
      case 'Right': return sendBytes('\x1b[C');
      case 'Left':  return sendBytes('\x1b[D');
    }
  };

  /** Consume the next printable char when Ctrl is sticky, then emit \x01..\x1a. */
  const onCtrlChar = (ch: string) => {
    if (!ctrlSticky) return false;
    const c = ch.toLowerCase();
    if (c >= 'a' && c <= 'z') {
      sendBytes(String.fromCharCode(c.charCodeAt(0) - 96));
      setCtrlSticky(false);
      return true;
    }
    setCtrlSticky(false);
    return false;
  };

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      minHeight: 0,
      background: '#000',
    }}>
      <div
        ref={containerRef}
        onTouchEnd={() => {
          // iOS only opens the virtual keyboard when focus moves inside a real
          // user gesture handler; call .focus() on the actual textarea node.
          const term = termRef.current;
          const ta = term && ((term as any).textarea as HTMLTextAreaElement | undefined);
          try { ta?.focus(); } catch { /* ignore */ }
        }}
        onClick={() => {
          const term = termRef.current;
          const ta = term && ((term as any).textarea as HTMLTextAreaElement | undefined);
          try { ta?.focus(); } catch { /* ignore */ }
        }}
        style={{ flex: 1, minHeight: 0, padding: 4, overflow: 'hidden' }}
      />
      {exited !== null ? (
        <div style={{ padding: 12, display: 'flex', gap: 8, background: 'var(--bg-secondary)', borderTop: '1px solid var(--border)' }}>
          <button
            onClick={() => { onExit?.(exited); onBack(); }}
            style={{ padding: '8px 12px', background: 'var(--accent)', color: '#000', border: 'none', borderRadius: 6 }}
          >Close</button>
          <span style={{ alignSelf: 'center', fontSize: 12, color: 'var(--text-muted)' }}>
            exited ({exited})
          </span>
        </div>
      ) : (
        <TerminalToolbar
          ctrlSticky={ctrlSticky}
          onKey={onToolbarKey}
          onBack={onBack}
          onCtrlChar={onCtrlChar}
        />
      )}
    </div>
  );
}
