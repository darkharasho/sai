import { useRef, forwardRef, useImperativeHandle } from 'react';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

export interface TerminalHandle {
  write(data: string): void;
}

export interface TerminalViewProps {
  onReady(cols: number, rows: number): void;
  onResize(cols: number, rows: number): void;
}

// Display-only xterm.js host. All keyboard input comes from a sibling RN
// TextInput (see TerminalInput); the WebView never owns focus, so iOS
// QuickType / autocorrect can't corrupt the keystroke stream.
const HTML = `<!doctype html>
<html><head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/css/xterm.min.css" />
<style>
  html,body{margin:0;background:#0e1114;height:100%;overflow:hidden}
  #t{height:100vh}
  /* Hide the helper textarea entirely — we never want it to receive focus
     and pop the iOS keyboard. RN TextInput is the only input surface. */
  .xterm-helper-textarea{display:none !important}
</style>
</head><body>
<div id="t"></div>
<script src="https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/lib/xterm.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@xterm/addon-fit@0.10.0/lib/addon-fit.min.js"></script>
<script>
(function () {
  const post = (msg) => {
    if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(msg));
  };
  const term = new Terminal({
    fontFamily: 'Menlo, monospace', fontSize: 12,
    theme: { background: '#0e1114', foreground: '#bec6d0', cursor: '#c7910c' },
    convertEol: true, cursorBlink: true,
    disableStdin: true,
  });
  const fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  term.open(document.getElementById('t'));
  fit.fit();
  post({ type: 'ready', cols: term.cols, rows: term.rows });
  window.addEventListener('resize', () => {
    fit.fit();
    post({ type: 'resize', cols: term.cols, rows: term.rows });
  });
  document.addEventListener('message', handleNative);
  window.addEventListener('message', handleNative);
  function handleNative(ev) {
    let m;
    try { m = JSON.parse(ev.data); } catch (e) { return; }
    if (m.type === 'data') term.write(m.data);
    else if (m.type === 'clear') term.clear();
    else if (m.type === 'fit') { fit.fit(); post({ type: 'resize', cols: term.cols, rows: term.rows }); }
  }
})();
</script>
</body></html>`;

export const TerminalView = forwardRef<TerminalHandle, TerminalViewProps>(function TerminalView(
  { onReady, onResize }, ref
) {
  const wv = useRef<WebView>(null);
  const queue = useRef<string[]>([]);
  const readyRef = useRef(false);

  useImperativeHandle(ref, () => ({
    write(data: string) {
      const payload = JSON.stringify({ type: 'data', data });
      if (!readyRef.current) { queue.current.push(payload); return; }
      wv.current?.postMessage(payload);
    },
  }), []);

  const onMessage = (e: WebViewMessageEvent) => {
    let m: any;
    try { m = JSON.parse(e.nativeEvent.data); } catch { return; }
    if (m.type === 'ready') {
      readyRef.current = true;
      onReady(m.cols, m.rows);
      for (const q of queue.current) wv.current?.postMessage(q);
      queue.current = [];
    } else if (m.type === 'resize') onResize(m.cols, m.rows);
  };

  return (
    <WebView
      ref={wv}
      originWhitelist={['*']}
      source={{ html: HTML, baseUrl: 'https://cdn.jsdelivr.net' }}
      onMessage={onMessage}
      javaScriptEnabled
      domStorageEnabled
      allowsInlineMediaPlayback
      style={{ flex: 1, backgroundColor: '#0e1114' }}
      hideKeyboardAccessoryView
    />
  );
});
