import { useEffect, useState } from 'react';
import { View, Text, FlatList, ActivityIndicator, Pressable } from 'react-native';
import { router } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import { WebView } from 'react-native-webview';
import { useConn } from '../../../../lib/connection';
import { useWorkspaces } from '../../../../lib/workspaceStore';

interface ChangeEntry { path: string; status: string }

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function diffHtml(diff: string): string {
  const lines = diff.split('\n').map((l) => {
    const c = l.startsWith('+') ? '#1d3a2e' : l.startsWith('-') ? '#3a1d22' : 'transparent';
    return `<div style="background:${c};padding:0 8px">${escapeHtml(l)}</div>`;
  }).join('');
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,user-scalable=no"/>
    <style>html,body{margin:0;background:#0e1114;color:#bec6d0;font-family:Menlo,monospace;font-size:11px;white-space:pre}</style>
    </head><body>${lines}</body></html>`;
}

export default function Changes() {
  const { machine, client } = useConn();
  const active = useWorkspaces((s) => s.activeByMachine[machine.machineId]) ?? null;
  const [entries, setEntries] = useState<ChangeEntry[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [diff, setDiff] = useState<string | null>(null);

  useEffect(() => {
    if (!active || !client) return;
    (async () => {
      const raw = await client.statusFiles(active.projectPath).catch(() => []);
      setEntries((raw as any[]).map(e => ({ path: e.path, status: e.status })));
    })();
  }, [client, active?.projectPath]);

  useEffect(() => {
    if (!selected || !active || !client) return;
    setDiff(null);
    (async () => {
      const r = await client.diffFile(active.projectPath, selected).catch(() => ({ diff: '' }));
      setDiff(r.diff);
    })();
  }, [client, selected, active?.projectPath]);

  return (
    <View className="flex-1 bg-[#0e1114]">
      <View className="flex-row items-center gap-2 px-3 py-2 border-b border-[#1e2228]">
        <Pressable onPress={() => router.back()} className="p-1.5"><ChevronLeft size={18} color="#bec6d0" /></Pressable>
        <Text className="text-white text-sm flex-1">Changes</Text>
      </View>
      {entries == null ? <ActivityIndicator color="#c7910c" className="mt-6" /> :
       selected ? (
         <View className="flex-1">
           <View className="flex-row items-center gap-2 px-3 py-2 border-b border-[#1e2228]">
             <Pressable onPress={() => { setSelected(null); setDiff(null); }} className="p-1.5"><ChevronLeft size={18} color="#bec6d0" /></Pressable>
             <Text className="text-white text-xs flex-1" numberOfLines={1}>{selected}</Text>
           </View>
           {diff == null ? <ActivityIndicator color="#c7910c" className="mt-6" /> :
             <WebView originWhitelist={['*']} source={{ html: diffHtml(diff) }} style={{ flex: 1, backgroundColor: '#0e1114' }} />}
         </View>
       ) : (
         <FlatList
           data={entries}
           keyExtractor={(e) => e.path}
           renderItem={({ item }) => (
             <Pressable onPress={() => setSelected(item.path)} className="px-4 py-3 border-b border-[#1e2228] flex-row gap-3">
               <Text className="text-[#c7910c] text-xs w-6">{item.status}</Text>
               <Text className="text-white flex-1" numberOfLines={1}>{item.path}</Text>
             </Pressable>
           )}
           ListEmptyComponent={<Text className="text-[#a0acbb] p-4 text-center">Clean.</Text>}
         />
       )}
    </View>
  );
}
