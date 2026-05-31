import { useRef, forwardRef, useImperativeHandle } from 'react';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

export interface TerminalHandle {
  write(data: string): void;
  blur(): void;
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
  const host = document.getElementById('t');
  term.open(host);
  fit.fit();
  // iOS WebKit suppresses 'input' events on textareas positioned off-screen
  // (xterm.js default is left:-9999px). Pull the helper textarea INTO the
  // viewport but keep it invisible, so iOS soft-keyboard keystrokes actually
  // dispatch 'input' events that xterm forwards via term.onData.
  // Enter still works in the default setup because it goes through a separate
  // keydown path, which is why "Return" reached the desktop but characters did not.
  var ta = host.querySelector('.xterm-helper-textarea');
  if (ta) {
    ta.style.position = 'absolute';
    ta.style.left = '0';
    ta.style.top = '0';
    ta.style.width = '100%';
    ta.style.height = '100%';
    ta.style.opacity = '0';
    ta.style.pointerEvents = 'auto';
    ta.style.zIndex = '2';
    ta.setAttribute('autocorrect', 'off');
    ta.setAttribute('autocapitalize', 'none');
    ta.setAttribute('spellcheck', 'false');
    ta.setAttribute('autocomplete', 'off');
  }
  // Focus the hidden textarea so iOS routes the soft keyboard's keystrokes
  // into xterm immediately.
  try { term.focus(); } catch (e) {}
  // Re-focus on any tap on the terminal area. iOS sometimes drops focus
  // when the WebView is re-laid-out (keyboard show/hide cycles).
  host.addEventListener('touchend', function () {
    try {
      if (ta && typeof ta.focus === 'function') ta.focus();
      else term.focus();
    } catch (e) {}
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
    else if (m.type === 'blur') {
      try {
        var blurTa = document.querySelector('.xterm-helper-textarea');
        if (blurTa && typeof blurTa.blur === 'function') blurTa.blur();
        if (document.activeElement && typeof document.activeElement.blur === 'function') {
          document.activeElement.blur();
        }
      } catch (e) {}
    }
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
    blur() {
      // RN's Keyboard.dismiss() doesn't work when focus is inside a WebView;
      // the WebView owns its own focus state. Send a message that blurs the
      // xterm helper textarea inside the WebView, which collapses the iOS
      // soft keyboard.
      wv.current?.postMessage(JSON.stringify({ type: 'blur' }));
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
