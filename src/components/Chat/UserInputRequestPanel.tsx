import { useEffect, useMemo, useState } from 'react';
import type { PendingCodexUserInput } from '../../types';

interface Props {
  request: PendingCodexUserInput;
  onSubmit: (answers: Record<string, string[]>) => void;
  onCancel: () => void;
}

export default function UserInputRequestPanel({ request, onSubmit, onCancel }: Props) {
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [other, setOther] = useState<Record<string, string>>({});
  const [secondsLeft, setSecondsLeft] = useState<number | null>(request.autoResolutionMs ? Math.ceil(request.autoResolutionMs / 1000) : null);
  const key = useMemo(() => request.requestHandle, [request.requestHandle]);

  useEffect(() => {
    setAnswers({});
    setOther({});
    setSecondsLeft(request.autoResolutionMs ? Math.ceil(request.autoResolutionMs / 1000) : null);
  }, [key, request.autoResolutionMs]);
  useEffect(() => {
    if (secondsLeft === null) return;
    const timer = window.setInterval(() => setSecondsLeft(value => value === null ? null : Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [secondsLeft !== null]);

  const toggle = (questionId: string, optionId: string) => setAnswers(previous => {
    const selected = previous[questionId] ?? [];
    return { ...previous, [questionId]: selected.includes(optionId) ? selected.filter(value => value !== optionId) : [...selected, optionId] };
  });
  const submittedAnswers = (): Record<string, string[]> => Object.fromEntries(request.questions.map(question => {
    const selected = answers[question.id] ?? [];
    const custom = other[question.id]?.trim();
    return [question.id, custom && (question.allowOther || !question.options) ? [...selected, custom] : selected];
  }));
  const canSubmit = request.questions.every(question => (submittedAnswers()[question.id] ?? []).length > 0);

  return <section className="app-server-input-panel" data-testid="codex-user-input-request">
    <strong>Input needed</strong>
    {secondsLeft !== null && <span className="app-server-input-countdown">Resolves automatically in {secondsLeft}s</span>}
    {request.questions.map(question => <fieldset key={question.id}>
      <legend>{question.prompt}</legend>
      {question.options?.map(option => <label key={option.id}>
        <input aria-label={option.label} type="checkbox" checked={(answers[question.id] ?? []).includes(option.id)} onChange={() => toggle(question.id, option.id)} />
        {option.label}{option.description ? <small> — {option.description}</small> : null}
      </label>)}
      {question.allowOther && <label>Other<input aria-label={`${question.prompt} other`} value={other[question.id] ?? ''} onChange={event => setOther(prev => ({ ...prev, [question.id]: event.target.value.slice(0, 2000) }))} /></label>}
      {!question.options && <label>Answer<input aria-label={question.prompt} value={other[question.id] ?? ''} onChange={event => setOther(prev => ({ ...prev, [question.id]: event.target.value.slice(0, 2000) }))} /></label>}
    </fieldset>)}
    <div className="app-server-input-actions">
      <button type="button" onClick={() => onSubmit(submittedAnswers())} disabled={!canSubmit}>Submit</button>
      <button type="button" onClick={onCancel}>Cancel</button>
    </div>
  </section>;
}
