import { View, Text, Pressable } from 'react-native';
import type { Machine } from '../lib/machines';

function ageLabel(ts: number | null): string {
  if (!ts) return 'never';
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86_400)}d ago`;
}

export function MachineRow({ m, online, onPress, onLongPress }: {
  m: Machine; online: boolean; onPress: () => void; onLongPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} onLongPress={onLongPress} className="bg-[#1c2027] rounded-xl p-4 mb-3 flex-row items-center gap-3">
      <View className={`w-2.5 h-2.5 rounded-full ${online ? 'bg-[#00a884]' : 'bg-[#475262]'}`} />
      <View className="flex-1">
        <Text className="text-white text-base font-medium">{m.label}</Text>
        <Text className="text-[#a0acbb] text-xs">{m.hostUrl}</Text>
      </View>
      <Text className="text-[#5a6a7a] text-xs">{online ? 'online' : ageLabel(m.lastSeenAt)}</Text>
    </Pressable>
  );
}
