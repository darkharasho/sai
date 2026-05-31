// Transcript port — PWA-fidelity message rendering. Mirrors
// src/renderer-remote/chat/Transcript.tsx's user/assistant/system row
// layouts (icon-gutter + body), keeps the existing minimal ToolCard
// (rich port is M12), and the existing ApprovalCard.
import { Terminal } from 'lucide-react-native';
import { FlatList, Text, View } from 'react-native';
import Markdown from 'react-native-markdown-display';
import type { TranscriptEvent } from '../lib/transcriptStore';
import { ToolCard } from './ToolCard';
import { ApprovalCard } from './ApprovalCard';
import { AskUserQuestionView } from './AskUserQuestionView';
import { GitHubWatcherCard } from './GitHubWatcherCard';
import { detectWatchTargets } from '../lib/githubWatcherStore';
import { TypingDots } from './TypingDots';
import { FONT } from '../lib/fonts';

const C = {
  bgPrimary: '#111418',
  bgInput: '#161a1f',
  border: '#1e2228',
  text: '#bec6d0',
  textSecondary: '#a0acbb',
  textMuted: '#5a6a7a',
  accent: '#c7910c',
  green: '#00a884',
  blue: '#11B7D4',
  red: '#E35535',
  mono: FONT.mono,
};

const mdStyles = {
  body: { color: C.text, fontSize: 14, lineHeight: 21 },
  paragraph: { marginTop: 0, marginBottom: 8 },
  heading1: { fontSize: 18, fontWeight: '700', marginTop: 12, marginBottom: 8, color: C.text },
  heading2: { fontSize: 16, fontWeight: '700', marginTop: 12, marginBottom: 6, color: C.text },
  heading3: { fontSize: 15, fontWeight: '600', marginTop: 10, marginBottom: 4, color: C.text },
  bullet_list: { marginBottom: 8 },
  ordered_list: { marginBottom: 8 },
  list_item: { marginBottom: 2, color: C.text },
  link: { color: C.blue, textDecorationLine: 'underline' as const },
  code_inline: {
    backgroundColor: C.bgInput,
    color: C.text,
    fontFamily: C.mono,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
    fontSize: 13,
  },
  code_block: {
    backgroundColor: C.bgInput,
    color: C.text,
    fontFamily: C.mono,
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: C.border,
    fontSize: 12,
    lineHeight: 17,
    marginVertical: 8,
  },
  fence: {
    backgroundColor: C.bgInput,
    color: C.text,
    fontFamily: C.mono,
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: C.border,
    fontSize: 12,
    lineHeight: 17,
    marginVertical: 8,
  },
  blockquote: {
    borderLeftWidth: 3,
    borderLeftColor: C.border,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginVertical: 6,
    backgroundColor: 'transparent',
  },
  hr: { backgroundColor: C.border, height: 1, marginVertical: 10 },
  strong: { fontWeight: '600', color: C.text },
};

function formatMs(ms: number) {
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

interface Props {
  events: TranscriptEvent[];
  streaming?: boolean;
  onApprove: (toolUseId: string, decision: 'approve' | 'deny', modifiedCommand?: string) => void;
  onAnswerQuestion?: (toolUseId: string, answers: Record<string, string | string[]>) => void;
}

function Row({
  event,
  result,
  onApprove,
  onAnswerQuestion,
}: {
  event: TranscriptEvent;
  /** The paired tool_result event (resolved by parent) for tool_use rows. */
  result?: TranscriptEvent;
  onApprove: (toolUseId: string, decision: 'approve' | 'deny', modifiedCommand?: string) => void;
  onAnswerQuestion?: (toolUseId: string, answers: Record<string, string | string[]>) => void;
}) {
  if (event.type === 'tool_use') {
    // AskUserQuestion tool calls render as the question form, matching the
    // PWA's ToolCard branch. The form is shown standalone (no tool card chrome)
    // because the answers feed back through onAnswerQuestion.
    if (event.toolName === 'AskUserQuestion') {
      return (
        <View style={{ width: '100%' }}>
          <AskUserQuestionView
            toolUseId={event.toolUseId}
            input={event.toolInput}
            onAnswer={onAnswerQuestion}
          />
        </View>
      );
    }
    return (
      <View style={{ width: '100%' }}>
        <ToolCard
          toolName={event.toolName}
          input={event.toolInput}
          result={result?.toolResult}
        />
      </View>
    );
  }
  if (event.type === 'tool_result') {
    // Orphan result (no matching tool_use seen) — render minimally so the
    // user still gets visibility. Normally paired into the tool_use row above.
    return (
      <View style={{ width: '100%' }}>
        <ToolCard toolName={event.toolName} input={event.toolInput} result={event.toolResult} />
      </View>
    );
  }

  if (event.type === 'question') {
    return (
      <View style={{ width: '100%' }}>
        <AskUserQuestionView
          toolUseId={event.toolUseId}
          input={event.toolInput}
          onAnswer={onAnswerQuestion}
        />
      </View>
    );
  }

  if (event.type === 'approval') {
    return (
      <ApprovalCard
        toolName={event.toolName}
        input={event.toolInput}
        onDecide={(d, modifiedCommand) => onApprove(event.toolUseId ?? '', d, modifiedCommand)}
      />
    );
  }

  if (event.type === 'system') {
    return (
      <View style={{ alignSelf: 'center', maxWidth: '90%', paddingVertical: 2 }}>
        <Text style={{
          color: C.textMuted,
          fontSize: 11,
          fontStyle: 'italic',
          fontFamily: C.mono,
          textAlign: 'center',
        }}>
          {event.text}
        </Text>
      </View>
    );
  }

  const isUser = event.type === 'user';
  const watcherTargets = !isUser && event.text ? detectWatchTargets(event.text) : [];
  // Two-column row: 18px gutter for the role icon + flexible body.
  return (
    <View style={{ flexDirection: 'row', width: '100%', gap: 8 }}>
      <View style={{ width: 18, alignItems: 'center', paddingTop: 2 }}>
        {isUser
          ? <Terminal size={14} color={C.green} strokeWidth={2.5} />
          // No SaiLogo on mobile yet — render an accent dot as a stand-in.
          : <View style={{
              width: 8, height: 8, borderRadius: 4, backgroundColor: C.accent, marginTop: 4,
            }} />}
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        {isUser ? (
          <Text style={{
            color: C.text,
            fontSize: 14,
            lineHeight: 21,
          }}>
            {event.text}
          </Text>
        ) : (
          <Markdown style={mdStyles as any}>{event.text ?? ''}</Markdown>
        )}
        {watcherTargets.map((t) => (
          <GitHubWatcherCard key={t.url} messageId={event.id} target={t} />
        ))}
      </View>
    </View>
  );
}

export function Transcript({ events, streaming = false, onApprove, onAnswerQuestion }: Props) {
  // Pair each tool_use with its tool_result so the result renders inside the
  // same card (PWA renders one card per tool call, not two).
  const resultByUseId: Record<string, TranscriptEvent> = {};
  const usedResultIds = new Set<string>();
  for (const e of events) {
    if (e.type === 'tool_result' && e.toolUseId) resultByUseId[e.toolUseId] = e;
  }
  const visible = events.filter((e) => {
    if (e.type === 'tool_result' && e.toolUseId && resultByUseId[e.toolUseId]) {
      // Only drop the result if the matching tool_use is present in the list.
      const hasUse = events.some((u) => u.type === 'tool_use' && u.toolUseId === e.toolUseId);
      if (hasUse) {
        usedResultIds.add(e.id);
        return false;
      }
    }
    return true;
  });
  void usedResultIds;
  return (
    <FlatList
      style={{ flex: 1, backgroundColor: C.bgPrimary }}
      data={visible}
      keyExtractor={(e) => e.id}
      contentContainerStyle={{ padding: 14, gap: 12 }}
      renderItem={({ item }) => (
        <Row
          event={item}
          result={item.type === 'tool_use' && item.toolUseId ? resultByUseId[item.toolUseId] : undefined}
          onApprove={onApprove}
          onAnswerQuestion={onAnswerQuestion}
        />
      )}
      ListFooterComponent={streaming ? (
        <View style={{ alignSelf: 'flex-start', paddingLeft: 4, paddingTop: 4 }}>
          <TypingDots />
        </View>
      ) : null}
    />
  );
}

// Re-export the duration formatter so callers can reuse it (kept for parity
// with the PWA which renders `[Nms]` above the last assistant bubble — once
// the mobile transcript store carries durationMs we can wire this in).
export { formatMs };
