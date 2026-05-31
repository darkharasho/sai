import { useState } from 'react';
import { View, Text, Pressable, Modal, FlatList } from 'react-native';
import { ChevronDown } from 'lucide-react-native';
import { useWorkspaces, type Workspace } from '../lib/workspaceStore';

export function WorkspacePicker({ machineId }: { machineId: string }) {
  const [open, setOpen] = useState(false);
  const list = useWorkspaces((s) => s.workspacesByMachine[machineId] ?? []);
  const active = useWorkspaces((s) => s.activeByMachine[machineId]) ?? null;
  const setActive = useWorkspaces((s) => s.setActive);

  return (
    <>
      <Pressable onPress={() => setOpen(true)} className="flex-row items-center gap-1 px-3 py-2 bg-[#1c2027] rounded-lg">
        <Text className="text-white text-sm">{active?.label ?? 'No workspace'}</Text>
        <ChevronDown size={14} color="#a0acbb" />
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable className="flex-1 bg-black/60" onPress={() => setOpen(false)}>
          <View className="absolute bottom-0 left-0 right-0 bg-[#1c2027] rounded-t-2xl p-4 max-h-[70%]">
            <Text className="text-white text-lg mb-3 font-semibold">Workspaces</Text>
            <FlatList
              data={list}
              keyExtractor={(w) => w.projectPath}
              renderItem={({ item }: { item: Workspace }) => (
                <Pressable
                  className="py-3 border-b border-[#1e2228]"
                  onPress={() => { setActive(machineId, item); setOpen(false); }}
                >
                  <Text className="text-white">{item.label}</Text>
                  <Text className="text-[#5a6a7a] text-xs">{item.projectPath}</Text>
                </Pressable>
              )}
              ListEmptyComponent={<Text className="text-[#a0acbb] py-6 text-center">No workspaces.</Text>}
            />
          </View>
        </Pressable>
      </Modal>
    </>
  );
}
