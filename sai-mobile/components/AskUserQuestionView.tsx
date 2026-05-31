// PWA-faithful port of src/renderer-remote/chat/AskUserQuestionView.tsx.
// Renders one or more questions (each with options + optional "Other" free
// text), supports single-select and multi-select, and submits via the wire
// client's answerQuestion. Custom Pressable rows stand in for radios/checks.
import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

const C = {
  text: '#bec6d0',
  textMuted: '#5a6a7a',
  bgMid: '#0e1114',
  bgInput: '#161a1f',
  border: '#1e2228',
  accent: '#c7910c',
  black: '#000',
  mono: 'Menlo',
};

interface AskOption { label: string; description?: string }
interface AskQuestion { question: string; header?: string; options: AskOption[]; multiSelect?: boolean }
interface ParsedAsk { questions: AskQuestion[]; answers?: Record<string, string | string[]> }

const OTHER = '__other__';

function parseInput(input: unknown): ParsedAsk | null {
  if (!input || typeof input !== 'object') return null;
  const i = input as any;
  const questions = i.questions;
  if (!Array.isArray(questions)) return null;
  return { questions: questions as AskQuestion[], answers: i.answers };
}

interface Props {
  toolUseId?: string;
  input?: unknown;
  onAnswer?: (toolUseId: string, answers: Record<string, string | string[]>) => void;
}

export function AskUserQuestionView({ toolUseId, input, onAnswer }: Props) {
  const parsed = parseInput(input);
  const recorded = parsed?.answers || {};
  const isAnswered = Object.keys(recorded).length > 0;
  const [picks, setPicks] = useState<Record<string, string | string[]>>({});
  const [other, setOther] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  if (!parsed) {
    return <Text style={{ color: C.textMuted, fontSize: 12 }}>Could not parse questions.</Text>;
  }

  const toggle = (q: AskQuestion, label: string) => {
    if (isAnswered || submitting) return;
    setPicks((p) => {
      const next = { ...p };
      if (q.multiSelect) {
        const arr = Array.isArray(next[q.question]) ? [...(next[q.question] as string[])] : [];
        const i = arr.indexOf(label);
        if (i >= 0) arr.splice(i, 1); else arr.push(label);
        next[q.question] = arr;
      } else {
        next[q.question] = label;
      }
      return next;
    });
  };

  const isSel = (q: AskQuestion, label: string): boolean => {
    if (isAnswered) {
      const v = recorded[q.question];
      if (label === OTHER) {
        const known = new Set(q.options.map((o) => o.label));
        if (q.multiSelect) return Array.isArray(v) && v.some((x) => !known.has(x));
        return typeof v === 'string' && !known.has(v);
      }
      if (q.multiSelect) return Array.isArray(v) && v.includes(label);
      return v === label;
    }
    const v = picks[q.question];
    if (q.multiSelect) return Array.isArray(v) && v.includes(label);
    return v === label;
  };

  const canSubmit = !isAnswered && !submitting && parsed.questions.every((q) => {
    const v = picks[q.question];
    const t = other[q.question]?.trim() || '';
    if (q.multiSelect) {
      const arr = Array.isArray(v) ? v : [];
      if (arr.includes(OTHER) && !t) return false;
      return arr.length > 0;
    }
    if (v === OTHER) return t.length > 0;
    return typeof v === 'string' && v.length > 0;
  });

  const submit = () => {
    if (!canSubmit || !toolUseId || !onAnswer) return;
    const resolved: Record<string, string | string[]> = {};
    for (const q of parsed.questions) {
      const v = picks[q.question];
      const t = other[q.question]?.trim() || '';
      if (q.multiSelect) {
        const arr = Array.isArray(v) ? v.slice() : [];
        const i = arr.indexOf(OTHER);
        if (i >= 0) arr.splice(i, 1, t);
        resolved[q.question] = arr;
      } else {
        resolved[q.question] = v === OTHER ? t : (v as string);
      }
    }
    setSubmitting(true);
    onAnswer(toolUseId, resolved);
  };

  return (
    <View style={{ gap: 12 }}>
      {parsed.questions.map((q, qi) => {
        const options: AskOption[] = [
          ...(Array.isArray(q.options) ? q.options : []),
          { label: OTHER, description: 'Type your own response' },
        ];
        return (
          <View key={qi} style={{ gap: 6 }}>
            {q.header ? (
              <Text style={{
                fontFamily: C.mono,
                fontSize: 10,
                textTransform: 'uppercase',
                color: C.textMuted,
              }}>{q.header}</Text>
            ) : null}
            <Text style={{ fontSize: 13, color: C.text }}>{q.question}</Text>
            <View style={{ gap: 4 }}>
              {options.map((opt, oi) => {
                const sel = isSel(q, opt.label);
                const isOther = opt.label === OTHER;
                const disabled = isAnswered || submitting;
                return (
                  <Pressable
                    key={oi}
                    disabled={disabled}
                    onPress={() => toggle(q, opt.label)}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'flex-start',
                      gap: 8,
                      paddingHorizontal: 10,
                      paddingVertical: 8,
                      backgroundColor: sel ? C.bgInput : C.bgMid,
                      borderWidth: 1,
                      borderColor: sel ? C.accent : C.border,
                      borderRadius: 8,
                      minHeight: 36,
                      opacity: disabled && !sel ? 0.8 : 1,
                    }}
                  >
                    <View style={{
                      marginTop: 2,
                      width: 12,
                      height: 12,
                      borderRadius: q.multiSelect ? 3 : 6,
                      borderWidth: 1.5,
                      borderColor: sel ? C.accent : C.border,
                      backgroundColor: sel ? C.accent : 'transparent',
                      flexShrink: 0,
                    }} />
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={{ fontSize: 13, color: C.text, fontWeight: '500' }}>
                        {isOther ? 'Other' : opt.label}
                      </Text>
                      {opt.description ? (
                        <Text style={{ fontSize: 11, color: C.textMuted }}>{opt.description}</Text>
                      ) : null}
                    </View>
                  </Pressable>
                );
              })}
              {isSel(q, OTHER) && !isAnswered ? (
                <TextInput
                  value={other[q.question] || ''}
                  onChangeText={(v) => setOther((o) => ({ ...o, [q.question]: v }))}
                  placeholder="Your answer…"
                  placeholderTextColor={C.textMuted}
                  style={{
                    paddingHorizontal: 10,
                    paddingVertical: 8,
                    backgroundColor: C.bgInput,
                    color: C.text,
                    borderWidth: 1,
                    borderColor: C.border,
                    borderRadius: 8,
                    fontSize: 13,
                  }}
                />
              ) : null}
            </View>
          </View>
        );
      })}
      {!isAnswered ? (
        <Pressable
          onPress={submit}
          disabled={!canSubmit}
          style={{
            paddingHorizontal: 16,
            paddingVertical: 10,
            marginTop: 10,
            backgroundColor: canSubmit ? C.accent : C.bgMid,
            borderWidth: 1,
            borderColor: canSubmit ? C.accent : C.border,
            borderRadius: 8,
            minHeight: 44,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{
            color: canSubmit ? C.black : C.textMuted,
            fontSize: 14,
            fontWeight: '600',
          }}>
            {submitting ? 'Submitting…' : 'Submit'}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
