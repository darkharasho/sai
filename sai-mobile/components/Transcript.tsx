import { FlatList, View, Text } from 'react-native';
import Markdown from 'react-native-markdown-display';
import type { TranscriptEvent } from '../lib/transcriptStore';
import { ToolCard } from './ToolCard';
import { ApprovalCard } from './ApprovalCard';

const mdStyles = {
  body: { color: '#bec6d0', fontSize: 14, lineHeight: 20 },
  code_inline: { backgroundColor: '#161a1f', color: '#c7910c', paddingHorizontal: 4, borderRadius: 4 },
  code_block: { backgroundColor: '#161a1f', color: '#bec6d0', padding: 8, borderRadius: 6 },
  fence: { backgroundColor: '#161a1f', color: '#bec6d0', padding: 8, borderRadius: 6 },
  link: { color: '#38c7bd' },
};

export function Transcript({
  events,
  onApprove,
}: {
  events: TranscriptEvent[];
  onApprove: (toolUseId: string, decision: 'approve' | 'deny') => void;
}) {
  return (
    <FlatList
      data={events}
      keyExtractor={(e) => e.id}
      contentContainerStyle={{ padding: 12, gap: 10 }}
      renderItem={({ item }) => {
        if (item.type === 'user') {
          return (
            <View className="bg-[#21292f] rounded-2xl px-3 py-2 self-end max-w-[85%]">
              <Text className="text-white">{item.text}</Text>
            </View>
          );
        }
        if (item.type === 'assistant') {
          return (
            <View className="self-start max-w-[92%]">
              <Markdown style={mdStyles as any}>{item.text ?? ''}</Markdown>
            </View>
          );
        }
        if (item.type === 'tool_use' || item.type === 'tool_result') {
          return <ToolCard toolName={item.toolName} input={item.toolInput} result={item.toolResult} />;
        }
        if (item.type === 'approval') {
          return (
            <ApprovalCard
              toolName={item.toolName}
              input={item.toolInput}
              onDecide={(d) => onApprove(item.toolUseId ?? '', d)}
            />
          );
        }
        return null;
      }}
    />
  );
}
