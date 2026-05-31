import { useEffect, useState } from 'react';
import { View, Text, FlatList, Pressable, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import { Folder, File, ChevronLeft, GitBranch } from 'lucide-react-native';
import { useConn } from '../../../../lib/connection';
import { useWorkspaces } from '../../../../lib/workspaceStore';

interface Entry { name: string; type: 'dir' | 'file' }

export default function Browse() {
  const { machine, client } = useConn();
  const active = useWorkspaces((s) => s.activeByMachine[machine.machineId]) ?? null;
  const [path, setPath] = useState('');
  const [entries, setEntries] = useState<Entry[] | null>(null);

  useEffect(() => {
    if (!active || !client) return;
    setEntries(null);
    (async () => {
      const raw = await client.listFiles(active.projectPath, path).catch(() => []);
      setEntries((raw as any[]).map(e => ({ name: e.name, type: e.type })));
    })();
  }, [client, active?.projectPath, path]);

  if (!active) {
    return <View className="flex-1 items-center justify-center"><Text className="text-[#a0acbb]">Pick a workspace in Chat first.</Text></View>;
  }

  return (
    <View className="flex-1 bg-[#0e1114]">
      <View className="flex-row items-center gap-2 px-3 py-2 border-b border-[#1e2228]">
        {path ? (
          <Pressable onPress={() => setPath(path.split('/').slice(0, -1).join('/'))} className="p-1.5">
            <ChevronLeft size={18} color="#bec6d0" />
          </Pressable>
        ) : null}
        <Text className="text-white text-sm flex-1" numberOfLines={1}>/{path}</Text>
        <Pressable onPress={() => router.push(`/m/${machine.machineId}/files/changes`)} className="p-1.5">
          <GitBranch size={18} color="#c7910c" />
        </Pressable>
      </View>
      {entries == null ? <ActivityIndicator color="#c7910c" className="mt-6" /> : (
        <FlatList
          data={entries}
          keyExtractor={(e) => e.name}
          renderItem={({ item }) => (
            <Pressable
              className="flex-row items-center gap-3 px-4 py-3 border-b border-[#1e2228]"
              onPress={() => {
                if (item.type === 'dir') setPath(path ? `${path}/${item.name}` : item.name);
                else router.push({ pathname: `/m/${machine.machineId}/files/view`, params: { path: path ? `${path}/${item.name}` : item.name } });
              }}
            >
              {item.type === 'dir' ? <Folder size={16} color="#c7910c" /> : <File size={16} color="#a0acbb" />}
              <Text className="text-white">{item.name}</Text>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}
