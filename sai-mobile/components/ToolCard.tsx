// Rich ToolCard — RN port of src/renderer-remote/chat/ToolCard.tsx.
// Mirrors the PWA's collapsible header + per-tool body switch (bash command,
// edit/write diff, generic result block). Visual tokens come from the
// default theme in src/themes.ts.
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import {
  AlertCircle,
  ChevronRight,
  FileEdit,
  FileText,
  Globe,
  ListTodo,
  MessageCircleQuestion,
  Terminal,
  Wrench,
} from 'lucide-react-native';
import { summarizeTool } from '../lib/toolPresenters';
import { FONT } from '../lib/fonts';

const C = {
  bgMid: '#0e1114',
  bgInput: '#161a1f',
  border: '#1e2228',
  text: '#bec6d0',
  textMuted: '#5a6a7a',
  accent: '#c7910c',
  green: '#00a884',
  red: '#E35535',
  mono: FONT.mono,
};

type Status = 'running' | 'done' | 'error';

interface Props {
  toolName?: string;
  input?: unknown;
  result?: unknown;
  /** Optional override; if absent we infer from presence of `result`. */
  status?: Status;
}

function iconFor(name: string) {
  const lower = name.toLowerCase();
  if (lower === 'bash' || lower.includes('terminal')) return Terminal;
  if (lower.startsWith('edit') || lower.startsWith('multiedit') || lower === 'write') return FileEdit;
  if (lower === 'read' || lower.includes('view')) return FileText;
  if (lower === 'todowrite') return ListTodo;
  if (lower === 'askuserquestion') return MessageCircleQuestion;
  if (lower.includes('web') || lower.includes('fetch')) return Globe;
  return Wrench;
}

function inferStatus(result: unknown, explicit?: Status): Status {
  if (explicit) return explicit;
  if (result === undefined || result === null) return 'running';
  if (typeof result === 'string' && /^\s*error[: ]/i.test(result)) return 'error';
  return 'done';
}

function safeStringify(v: unknown): string {
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

export function ToolCard({ toolName, input, result, status: explicitStatus }: Props) {
  const [expanded, setExpanded] = useState(true);
  const name = toolName ?? 'tool';
  const summary = summarizeTool(name, input);
  const status = inferStatus(result, explicitStatus);
  const accent = status === 'error' ? C.red : status === 'done' ? C.green : C.accent;
  const Icon = status === 'error' ? AlertCircle : iconFor(name);

  // Animated chevron rotation: 0° (collapsed) → 90° (expanded).
  const rotation = useSharedValue(expanded ? 90 : 0);
  useEffect(() => {
    rotation.value = withTiming(expanded ? 90 : 0, {
      duration: 180,
      easing: Easing.inOut(Easing.ease),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded]);
  const chevronStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }));

  return (
    <View style={{
      alignSelf: 'stretch',
      width: '100%',
      borderWidth: 1,
      borderColor: C.border,
      backgroundColor: C.bgMid,
      borderRadius: 10,
      overflow: 'hidden',
    }}>
      <Pressable
        onPress={() => setExpanded((v) => !v)}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          paddingHorizontal: 10,
          paddingVertical: 8,
          minHeight: 32,
        }}
      >
        <Icon size={14} color={accent} strokeWidth={2} />
        <Text style={{
          fontFamily: C.mono,
          fontSize: 12,
          fontWeight: '600',
          color: C.accent,
          flexShrink: 0,
        }}>
          {name}
        </Text>
        {summary.label ? (
          <Text
            numberOfLines={1}
            ellipsizeMode="tail"
            style={{
              fontFamily: C.mono,
              fontSize: 11,
              color: C.textMuted,
              flex: 1,
              minWidth: 0,
            }}
          >
            {summary.label}
          </Text>
        ) : (
          <View style={{ flex: 1 }} />
        )}
        {status === 'running' ? (
          <Text style={{
            fontFamily: C.mono,
            fontSize: 10,
            color: C.accent,
            letterSpacing: 1,
          }}>
            RUNNING
          </Text>
        ) : null}
        <Animated.View style={chevronStyle}>
          <ChevronRight size={14} color={C.textMuted} />
        </Animated.View>
      </Pressable>

      {expanded ? (
        <View style={{
          borderTopWidth: 1,
          borderTopColor: C.border,
          padding: 10,
          gap: 10,
        }}>
          {summary.body ? (
            <CodeBlock content={summary.body} language={summary.language} />
          ) : null}
          {!summary.body && input && typeof input === 'object' && Object.keys(input as object).length > 0 ? (
            <Section title="input">
              <CodeBlock content={safeStringify(input)} language="json" />
            </Section>
          ) : null}
          {result !== undefined && result !== null ? (
            <Section title={status === 'error' ? 'error' : 'result'}>
              <CodeBlock content={safeStringify(result)} />
            </Section>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View>
      <Text style={{
        fontSize: 10,
        fontFamily: C.mono,
        color: C.textMuted,
        letterSpacing: 1,
        textTransform: 'uppercase',
        marginBottom: 4,
      }}>
        {title}
      </Text>
      {children}
    </View>
  );
}

function CodeBlock({ content, language }: { content: string; language?: string }) {
  const isDiff = language === 'diff';
  const lines = content.split('\n');
  return (
    <ScrollView
      style={{
        maxHeight: 280,
        backgroundColor: C.bgInput,
        borderWidth: 1,
        borderColor: C.border,
        borderRadius: 8,
      }}
      contentContainerStyle={{ padding: 10 }}
      // horizontal scrolling not enabled — we wrap long lines like the PWA's pre-wrap.
    >
      {isDiff
        ? lines.map((line, i) => {
            const color = line.startsWith('+ ') ? C.green : line.startsWith('- ') ? C.red : C.text;
            return (
              <Text
                key={i}
                style={{
                  color,
                  fontFamily: C.mono,
                  fontSize: 12,
                  lineHeight: 17,
                }}
              >
                {line.length > 0 ? line : ' '}
              </Text>
            );
          })
        : (
          <Text style={{
            color: C.text,
            fontFamily: C.mono,
            fontSize: 12,
            lineHeight: 17,
          }}>
            {content}
          </Text>
        )}
    </ScrollView>
  );
}
