import { useEffect, useState } from 'react';
import { View, Text, ActivityIndicator, Pressable } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { WebView } from 'react-native-webview';
import { ChevronLeft } from 'lucide-react-native';
import { useConn } from '../../../../lib/connection';
import { useWorkspaces } from '../../../../lib/workspaceStore';

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function htmlFor(content: string, lang: string | undefined): string {
  return `<!doctype html><html><head>
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/highlight.js@11.10.0/styles/github-dark.min.css">
    <style>
      html,body{margin:0;background:#0e1114;color:#bec6d0;font-family:Menlo,monospace;font-size:12px}
      pre{margin:0;padding:12px;white-space:pre;overflow:auto}
    </style>
  </head><body>
    <pre><code class="${lang ? `language-${lang}` : ''}">${escapeHtml(content)}</code></pre>
    <script src="https://cdn.jsdelivr.net/npm/highlight.js@11.10.0/lib/highlight.min.js"></script>
    <script>hljs.highlightAll();</script>
  </body></html>`;
}

export default function FileView() {
  const params = useLocalSearchParams<{ path: string }>();
  const { machine, client } = useConn();
  const active = useWorkspaces((s) => s.activeByMachine[machine.machineId]) ?? null;
  const [data, setData] = useState<{ content: string; lang?: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!active || !params.path || !client) return;
    (async () => {
      try {
        const r = await client.readFile(active.projectPath, params.path);
        if (r.encoding !== 'text' || !r.content) { setErr('Binary file (preview unavailable).'); return; }
        setData({ content: r.content, lang: r.lang });
      } catch (e: any) {
        setErr(String(e?.message ?? e));
      }
    })();
  }, [client, active?.projectPath, params.path]);

  return (
    <View className="flex-1 bg-[#0e1114]">
      <View className="flex-row items-center gap-2 px-3 py-2 border-b border-[#1e2228]">
        <Pressable onPress={() => router.back()} className="p-1.5">
          <ChevronLeft size={18} color="#bec6d0" />
        </Pressable>
        <Text className="text-white text-sm flex-1" numberOfLines={1}>{params.path}</Text>
      </View>
      {err ? <Text className="text-[#E35535] p-4">{err}</Text> :
       !data ? <ActivityIndicator color="#c7910c" className="mt-6" /> :
       <WebView originWhitelist={['*']} source={{ html: htmlFor(data.content, data.lang) }} style={{ flex: 1, backgroundColor: '#0e1114' }} />}
    </View>
  );
}
