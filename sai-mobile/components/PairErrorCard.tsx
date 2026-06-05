import { View, Text, Pressable } from 'react-native';

export type PairErrorKind = 'network' | 'code-expired' | 'code-invalid' | 'host-rejected' | 'unknown';
const COPY: Record<PairErrorKind, string> = {
  'network': "Can't reach that host. Is Tailscale on?",
  'code-expired': "Pair code expired. Generate a new one on desktop.",
  'code-invalid': "Invalid pair code.",
  'host-rejected': "That host is not on your tailnet. SAI only pairs over Tailscale or local network.",
  'unknown': "Pairing failed. Try again.",
};

export function PairErrorCard({ kind, detail, onRetry }: { kind: PairErrorKind; detail?: string; onRetry: () => void }) {
  return (
    <View className="bg-[#1c2027] border border-[#3a2630] rounded-xl p-4 gap-2">
      <Text className="text-[#E35535] font-semibold">{COPY[kind]}</Text>
      {detail ? <Text className="text-[#a0acbb] text-xs">{detail}</Text> : null}
      <Pressable onPress={onRetry} className="bg-[#21292f] rounded-md py-2 items-center mt-1">
        <Text className="text-white">Try again</Text>
      </Pressable>
    </View>
  );
}
