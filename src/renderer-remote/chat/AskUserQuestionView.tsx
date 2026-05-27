import { useState } from 'react';

interface AskOption { label: string; description?: string }
interface AskQuestion { question: string; header?: string; options: AskOption[]; multiSelect?: boolean }
interface ParsedAsk { questions: AskQuestion[]; answers?: Record<string, string | string[]> }

const OTHER = '__other__';

function parseInput(input: Record<string, unknown> | undefined): ParsedAsk | null {
  if (!input) return null;
  const questions = (input as any).questions;
  if (!Array.isArray(questions)) return null;
  return { questions: questions as AskQuestion[], answers: (input as any).answers };
}

interface Props {
  toolUseId?: string;
  input?: Record<string, unknown>;
  onAnswer?: (toolUseId: string, answers: Record<string, string | string[]>) => void;
}

export default function AskUserQuestionView({ toolUseId, input, onAnswer }: Props) {
  const parsed = parseInput(input);
  const recorded = parsed?.answers || {};
  const isAnswered = Object.keys(recorded).length > 0;
  const [picks, setPicks] = useState<Record<string, string | string[]>>({});
  const [other, setOther] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  if (!parsed) {
    return <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>Could not parse questions.</div>;
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
      {parsed.questions.map((q, qi) => (
        <div key={qi} style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
          {q.header && (
            <div style={{ fontFamily: '"Geist Mono", ui-monospace, monospace', fontSize: 10, textTransform: 'uppercase', color: 'var(--text-muted)' }}>{q.header}</div>
          )}
          <div style={{ fontSize: 13, color: 'var(--text)', wordBreak: 'break-word', overflowWrap: 'anywhere' }}>{q.question}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
            {[...(Array.isArray(q.options) ? q.options : []), { label: OTHER, description: 'Type your own response' } as AskOption].map((opt, oi) => {
              const sel = isSel(q, opt.label);
              const isOther = opt.label === OTHER;
              return (
                <button
                  key={oi}
                  type="button"
                  onClick={() => toggle(q, opt.label)}
                  disabled={isAnswered || submitting}
                  style={{
                    display: 'flex', alignItems: 'flex-start', gap: 8, padding: '8px 10px', textAlign: 'left',
                    width: '100%', minWidth: 0,
                    background: sel ? 'var(--bg-input)' : 'var(--bg-mid)', color: 'var(--text)',
                    border: '1px solid', borderColor: sel ? 'var(--accent)' : 'var(--border)',
                    borderRadius: 8, cursor: isAnswered || submitting ? 'default' : 'pointer',
                    fontFamily: 'inherit', fontSize: 13, minHeight: 36,
                  }}
                >
                  <span style={{
                    flexShrink: 0, marginTop: 2, width: 12, height: 12,
                    borderRadius: q.multiSelect ? 3 : '50%',
                    border: '1.5px solid', borderColor: sel ? 'var(--accent)' : 'var(--border)',
                    background: sel ? 'var(--accent)' : 'transparent',
                  }} />
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 0 }}>
                    <span style={{ fontWeight: 500, wordBreak: 'break-word', overflowWrap: 'anywhere' }}>{isOther ? 'Other' : opt.label}</span>
                    {opt.description && <span style={{ fontSize: 11, color: 'var(--text-muted)', wordBreak: 'break-word', overflowWrap: 'anywhere' }}>{opt.description}</span>}
                  </span>
                </button>
              );
            })}
            {isSel(q, OTHER) && !isAnswered && (
              <input
                type="text"
                value={other[q.question] || ''}
                onChange={(e) => setOther((o) => ({ ...o, [q.question]: e.target.value }))}
                placeholder="Your answer…"
                style={{
                  padding: '8px 10px', background: 'var(--bg-input)', color: 'var(--text)',
                  border: '1px solid var(--border)', borderRadius: 8, fontFamily: 'inherit', fontSize: 13,
                }}
              />
            )}
          </div>
        </div>
      ))}
      {!isAnswered && (
        <button
          type="button"
          onClick={submit}
          disabled={!canSubmit}
          style={{
            width: '100%', padding: '10px 16px',
            background: canSubmit ? 'var(--accent)' : 'var(--bg-mid)',
            color: canSubmit ? '#000' : 'var(--text-muted)',
            border: '1px solid', borderColor: canSubmit ? 'var(--accent)' : 'var(--border)',
            borderRadius: 8, fontFamily: 'inherit', fontSize: 14, fontWeight: 600,
            cursor: canSubmit ? 'pointer' : 'default', minHeight: 44,
          }}
        >
          {submitting ? 'Submitting…' : 'Submit'}
        </button>
      )}
    </div>
  );
}
