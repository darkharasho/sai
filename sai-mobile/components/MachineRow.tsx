import { View, Text, Pressable } from 'react-native';
import type { Machine } from '../lib/machines';
import { OsIcon, guessOs } from './OsIcon';

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
  const os = guessOs(m.label, m.hostUrl);
  const iconColor = online ? '#00a884' : '#475262';

  return (
    <Pressable onPress={onPress} onLongPress={onLongPress} className="bg-[#1c2027] rounded-xl p-4 mb-3 flex-row items-center gap-3">
      <View style={{
        width: 40, height: 40, borderRadius: 10,
        backgroundColor: online ? 'rgba(0,168,132,0.12)' : 'rgba(71,82,98,0.15)',
        alignItems: 'center', justifyContent: 'center',
      }}>
        <OsIcon os={os} size={22} color={iconColor} />
      </View>
      <View className="flex-1">
        <Text className="text-white text-base font-medium">{m.label}</Text>
        <Text className="text-[#a0acbb] text-xs">{m.hostUrl}</Text>
      </View>
      <Text className="text-[#5a6a7a] text-xs">{online ? 'online' : ageLabel(m.lastSeenAt)}</Text>
    </Pressable>
  );
}
