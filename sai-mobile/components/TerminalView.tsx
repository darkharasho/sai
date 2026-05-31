import { useRef, forwardRef, useImperativeHandle } from 'react';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

export interface TerminalHandle {
  write(data: string): void;
}

export interface TerminalViewProps {
  onReady(cols: number, rows: number): void;
  onInput(data: string): void;
  onResize(cols: number, rows: number): void;
}

const HTML = `<!doctype html>
<html><head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/css/xterm.min.css" />
<style>
  html,body{margin:0;background:#0e1114;height:100%;overflow:hidden}
  #t{height:100vh}
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
  });
  const fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  term.open(document.getElementById('t'));
  fit.fit();
  // Focus the hidden textarea so iOS routes the soft keyboard's keystrokes
  // into xterm immediately. Without this, the system keyboard appears but
  // input never reaches term.onData (because the textarea isn't focused),
  // and nothing is sent to the desktop PTY.
  try { term.focus(); } catch (e) {}
  // Re-focus on any tap on the terminal area. iOS sometimes drops focus
  // when the WebView is re-laid-out (keyboard show/hide cycles).
  document.getElementById('t').addEventListener('touchend', function () {
    try { term.focus(); } catch (e) {}
  });
  post({ type: 'ready', cols: term.cols, rows: term.rows });
  term.onData((d) => post({ type: 'input', data: d }));
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
  { onReady, onInput, onResize }, ref
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
    } else if (m.type === 'input') onInput(m.data);
    else if (m.type === 'resize') onResize(m.cols, m.rows);
  };

  return (
    <WebView
      ref={wv}
      originWhitelist={['*']}
      source={{ html: HTML }}
      onMessage={onMessage}
      javaScriptEnabled
      domStorageEnabled
      style={{ flex: 1, backgroundColor: '#0e1114' }}
      hideKeyboardAccessoryView
      keyboardDisplayRequiresUserAction={false}
    />
  );
});
