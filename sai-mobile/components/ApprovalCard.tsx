// PWA-faithful approval card. Mirrors src/renderer-remote/chat/Approval.tsx
// with mobile adaptations:
//   * Bash command is editable in a multiline TextInput; the modified text is
//     passed back via onDecide('approve', modifiedCommand).
//   * Non-Bash tools show the input as a read-only JSON block.
import { useMemo, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { AlertCircle } from 'lucide-react-native';

const C = {
  bg: '#181a16',          // orange-tinted bg (color-mix orange@8% on bg-secondary)
  border: '#c7910c',
  bgInput: '#161a1f',
  borderSubtle: '#1e2228',
  bgElevated: '#21292f',
  text: '#bec6d0',
  textMuted: '#5a6a7a',
  accent: '#c7910c',
  green: '#00a884',
  red: '#E35535',
  black: '#000',
  mono: 'Menlo',
};

function extractCommand(toolName: string | undefined, input: unknown): string | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const i = input as Record<string, unknown>;
  if ((toolName ?? '').toLowerCase() === 'bash' || typeof i.command === 'string') {
    return typeof i.command === 'string' ? i.command : undefined;
  }
  return undefined;
}

function safeStringify(v: unknown): string {
  try { return JSON.stringify(v, null, 2); } catch { return String(v); }
}

interface Props {
  toolName?: string;
  input?: unknown;
  onDecide: (decision: 'approve' | 'deny', modifiedCommand?: string) => void;
}

export function ApprovalCard({ toolName, input, onDecide }: Props) {
  const name = toolName ?? 'tool';
  const originalCommand = useMemo(() => extractCommand(toolName, input), [toolName, input]);
  const [edited, setEdited] = useState<string>(originalCommand ?? '');

  const isBash = originalCommand != null;
  const bodyText = isBash ? undefined : (input ? safeStringify(input) : undefined);

  const onApprove = () => {
    if (isBash) {
      const trimmed = edited;
      const modified = trimmed !== originalCommand ? trimmed : undefined;
      onDecide('approve', modified);
    } else {
      onDecide('approve');
    }
  };

  return (
    <View style={{
      marginVertical: 10,
      padding: 12,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: C.border,
      backgroundColor: C.bg,
      gap: 10,
    }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <AlertCircle size={14} color={C.accent} />
        <Text style={{ color: C.text, fontSize: 13, fontWeight: '600' }}>Approval needed</Text>
        <Text style={{
          fontFamily: C.mono,
          fontSize: 12,
          color: C.accent,
        }}>{name}</Text>
      </View>

      {isBash ? (
        <TextInput
          value={edited}
          onChangeText={setEdited}
          multiline
          numberOfLines={3}
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          style={{
            padding: 10,
            fontSize: 12,
            fontFamily: C.mono,
            backgroundColor: C.bgInput,
            color: C.text,
            borderWidth: 1,
            borderColor: C.borderSubtle,
            borderRadius: 8,
            minHeight: 60,
            textAlignVertical: 'top',
          }}
        />
      ) : bodyText ? (
        <View style={{
          padding: 10,
          backgroundColor: C.bgInput,
          borderWidth: 1,
          borderColor: C.borderSubtle,
          borderRadius: 8,
        }}>
          <Text style={{
            fontSize: 12,
            fontFamily: C.mono,
            color: C.text,
          }}>
            {bodyText}
          </Text>
        </View>
      ) : null}

      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Pressable
          onPress={onApprove}
          style={{
            paddingHorizontal: 14,
            paddingVertical: 8,
            borderRadius: 8,
            borderWidth: 1,
            backgroundColor: C.green,
            borderColor: C.green,
          }}
        >
          <Text style={{ color: C.black, fontSize: 13, fontWeight: '600' }}>Allow</Text>
        </Pressable>
        <Pressable
          onPress={() => onDecide('deny')}
          style={{
            paddingHorizontal: 14,
            paddingVertical: 8,
            borderRadius: 8,
            borderWidth: 1,
            backgroundColor: C.bgElevated,
            borderColor: C.borderSubtle,
          }}
        >
          <Text style={{ color: C.text, fontSize: 13, fontWeight: '600' }}>Deny</Text>
        </Pressable>
      </View>
    </View>
  );
}
