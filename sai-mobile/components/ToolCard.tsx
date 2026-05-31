import { View, Text } from 'react-native';
import { Wrench } from 'lucide-react-native';
import { presentTool } from '../lib/toolPresenters';

export function ToolCard({ toolName, input, result }: { toolName?: string; input?: unknown; result?: unknown }) {
  const { label, summary } = presentTool(toolName, input);
  return (
    <View className="bg-[#1c2027] border border-[#1e2228] rounded-xl p-3 gap-1.5 self-stretch">
      <View className="flex-row items-center gap-2">
        <Wrench size={14} color="#c7910c" />
        <Text className="text-white text-sm font-medium">{label}</Text>
      </View>
      {summary ? <Text className="text-[#a0acbb] text-xs" numberOfLines={3}>{summary}</Text> : null}
      {result !== undefined ? (
        <Text className="text-[#5a6a7a] text-xs" numberOfLines={3}>
          {typeof result === 'string' ? result : JSON.stringify(result).slice(0, 240)}
        </Text>
      ) : null}
    </View>
  );
}
