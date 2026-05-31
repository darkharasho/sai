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
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => ({
        backgroundColor: pressed ? '#21292f' : '#1c2027',
        borderRadius: 12,
        padding: 14,
        marginBottom: 10,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
      })}
    >
      <View
        style={{
          width: 10,
          height: 10,
          borderRadius: 5,
          backgroundColor: online ? '#00a884' : '#475262',
        }}
      />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text
          numberOfLines={1}
          style={{ color: '#ffffff', fontSize: 16, fontWeight: '500' }}
        >
          {m.label}
        </Text>
        <Text
          numberOfLines={1}
          style={{ color: '#a0acbb', fontSize: 12, marginTop: 2 }}
        >
          {m.hostUrl}
        </Text>
      </View>
      <Text style={{ color: '#5a6a7a', fontSize: 12 }}>
        {online ? 'online' : ageLabel(m.lastSeenAt)}
      </Text>
    </Pressable>
  );
}
