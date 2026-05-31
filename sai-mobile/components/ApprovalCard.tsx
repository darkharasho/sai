import { View, Text, Pressable } from 'react-native';
import { presentTool } from '../lib/toolPresenters';

export function ApprovalCard({
  toolName, input, onDecide,
}: {
  toolName?: string; input?: unknown; onDecide: (d: 'approve' | 'deny') => void;
}) {
  const { label, summary } = presentTool(toolName, input);
  return (
    <View className="bg-[#1c2027] border border-[#c7910c] rounded-xl p-3 gap-2 self-stretch">
      <Text className="text-[#c7910c] text-sm font-semibold">Approval needed: {label}</Text>
      {summary ? <Text className="text-[#bec6d0] text-xs">{summary}</Text> : null}
      <View className="flex-row gap-2 mt-1">
        <Pressable onPress={() => onDecide('deny')} className="bg-[#21292f] rounded-lg px-4 py-2 flex-1 items-center">
          <Text className="text-white">Deny</Text>
        </Pressable>
        <Pressable onPress={() => onDecide('approve')} className="bg-[#c7910c] rounded-lg px-4 py-2 flex-1 items-center">
          <Text className="text-black font-semibold">Approve</Text>
        </Pressable>
      </View>
    </View>
  );
}
