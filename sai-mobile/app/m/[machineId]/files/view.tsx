// Read-only file viewer. Mirrors src/renderer-remote/files/FileViewer.tsx —
// language-highlighted via highlight.js inside the WebView; outer chrome is
// the shared EditorToolbar so visuals match the PWA.
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { WebView } from 'react-native-webview';
import { useConn } from '../../../../lib/connection';
import { useWorkspaces } from '../../../../lib/workspaceStore';
import EditorToolbar from '../../../../components/EditorToolbar';

const C = {
  bgPrimary: '#0e1114',
  text: '#bec6d0',
  textMuted: '#5a6a7a',
  red: '#E35535',
};

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function htmlFor(content: string, lang: string | undefined): string {
  const display = content.length > 50_000 ? content.slice(0, 50_000) + '\n... (truncated)' : content;
  return `<!doctype html><html><head>
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/highlight.js@11.10.0/styles/github-dark.min.css">
    <style>
      html,body{margin:0;background:#0e1114;color:#bec6d0;font-family:Menlo,ui-monospace,monospace;font-size:12px;line-height:1.5}
      pre{margin:0;padding:12px;white-space:pre;overflow:auto}
      code{white-space:pre}
    </style>
  </head><body>
    <pre><code class="${lang ? `language-${lang}` : ''}">${escapeHtml(display)}</code></pre>
    <script src="https://cdn.jsdelivr.net/npm/highlight.js@11.10.0/lib/highlight.min.js"></script>
    <script>
      hljs.highlightAll();
      window.__sai_content = ${JSON.stringify(display)};
      document.addEventListener('message', function(ev){
        try {
          var msg = JSON.parse(ev.data);
          if (msg && msg.type === 'copy') {
            var ta = document.createElement('textarea');
            ta.value = window.__sai_content;
            document.body.appendChild(ta); ta.select();
            try { document.execCommand('copy'); } catch (e) {}
            document.body.removeChild(ta);
            window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({type:'copied'}));
          }
        } catch (e) {}
      });
    </script>
  </body></html>`;
}

export default function FileView() {
  const params = useLocalSearchParams<{ path: string; cwd?: string }>();
  const { machine, client } = useConn();
  const active = useWorkspaces((s) => s.activeByMachine[machine.machineId]) ?? null;
  const cwd = (params.cwd as string | undefined) ?? active?.projectPath ?? null;
  const path = (params.path as string | undefined) ?? '';
  const [data, setData] = useState<{ content: string; lang?: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<'idle' | 'copied'>('idle');
  const wvRef = useRef<WebView>(null);

  useEffect(() => {
    if (!cwd || !path || !client) return;
    (async () => {
      try {
        const r = await client.readFile(cwd, path);
        if (r.encoding !== 'text' || !r.content) {
          setErr('Binary file (preview unavailable).');
          return;
        }
        setData({ content: r.content, lang: r.lang });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        setErr(msg);
      }
    })();
  }, [client, cwd, path]);

  const html = useMemo(
    () => (data ? htmlFor(data.content, data.lang) : null),
    [data],
  );

  const onCopy = () => {
    wvRef.current?.postMessage(JSON.stringify({ type: 'copy' }));
    setCopyState('copied');
    setTimeout(() => setCopyState('idle'), 1500);
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.bgPrimary }}>
      <EditorToolbar
        path={path}
        lang={data?.lang ?? null}
        onBack={() => router.back()}
        onCopy={data ? onCopy : undefined}
        copyState={copyState}
      />
      {err ? (
        <Text style={{ color: C.red, padding: 16 }}>{err}</Text>
      ) : !html ? (
        <ActivityIndicator color="#c7910c" style={{ marginTop: 24 }} />
      ) : (
        <WebView
          ref={wvRef}
          originWhitelist={['*']}
          source={{ html }}
          style={{ flex: 1, backgroundColor: C.bgPrimary }}
          onMessage={() => { /* copy ack ignored */ }}
        />
      )}
    </View>
  );
}
