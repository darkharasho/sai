import { useRef, forwardRef, useImperativeHandle } from 'react';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { Asset } from 'expo-asset';

export interface TerminalHandle {
  write(data: string): void;
}

export interface TerminalViewProps {
  onReady(cols: number, rows: number): void;
  onInput(data: string): void;
  onResize(cols: number, rows: number): void;
}

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
      source={{ uri: Asset.fromModule(require('../assets/terminal/index.html')).uri }}
      onMessage={onMessage}
      javaScriptEnabled
      domStorageEnabled
      style={{ flex: 1, backgroundColor: '#0e1114' }}
      hideKeyboardAccessoryView
      keyboardDisplayRequiresUserAction={false}
    />
  );
});
