import type { ChatMessage } from '../types';

interface AskQuestion {
  question: string;
  multiSelect?: boolean;
}

export interface PendingQuestionAnswer {
  toolUseId: string;
  answers: Record<string, string | string[]>;
}

/**
 * Build the "Other" free-text answer record from a parsed AskUserQuestion
 * input. The text becomes the answer for every question in the card (a
 * single-select question gets the raw string; a multiSelect question gets a
 * one-element array, mirroring how AskUserQuestionView resolves an "Other"
 * pick). Returns null when the card is already answered or has no questions.
 */
function answersFromInput(
  input: { questions?: AskQuestion[]; answers?: Record<string, unknown> } | null,
  text: string,
): Record<string, string | string[]> | null {
  if (!input) return null;
  if (input.answers && Object.keys(input.answers).length > 0) return null;
  const questions = Array.isArray(input.questions) ? input.questions : [];
  if (questions.length === 0) return null;
  const answers: Record<string, string | string[]> = {};
  for (const q of questions) {
    if (!q || typeof q.question !== 'string') continue;
    answers[q.question] = q.multiSelect ? [text] : text;
  }
  return Object.keys(answers).length > 0 ? answers : null;
}

/**
 * Desktop chat: given the transcript and a typed message, build the "Other"
 * answer for the most recent unanswered AskUserQuestion tool call. Tool-call
 * inputs are JSON strings. Returns null when there is no unanswered card, the
 * text is blank, or the matching input cannot be parsed.
 */
export function buildPendingQuestionAnswer(
  messages: ChatMessage[],
  text: string,
): PendingQuestionAnswer | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== 'assistant' || !m.toolCalls) continue;
    for (let j = m.toolCalls.length - 1; j >= 0; j--) {
      const tc = m.toolCalls[j];
      if (tc.name !== 'AskUserQuestion' || !tc.id) continue;
      let parsed: { questions?: AskQuestion[]; answers?: Record<string, unknown> };
      try {
        parsed = JSON.parse(tc.input || '{}');
      } catch {
        continue;
      }
      const answers = answersFromInput(parsed, text);
      if (answers) return { toolUseId: tc.id, answers };
    }
  }
  return null;
}

/** Minimal shape of a remote/mobile transcript tool message. */
interface TranscriptToolMessage {
  toolName?: string;
  toolUseId?: string;
  toolInput?: Record<string, unknown>;
}

/**
 * Remote/mobile chat: same as buildPendingQuestionAnswer but for the transcript
 * message model, where each tool is its own message and `toolInput` is already
 * an object (not a JSON string).
 */
export function buildPendingQuestionAnswerFromTranscript(
  messages: TranscriptToolMessage[],
  text: string,
): PendingQuestionAnswer | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.toolName !== 'AskUserQuestion' || !m.toolUseId) continue;
    const answers = answersFromInput(
      (m.toolInput ?? null) as { questions?: AskQuestion[]; answers?: Record<string, unknown> } | null,
      text,
    );
    if (answers) return { toolUseId: m.toolUseId, answers };
  }
  return null;
}
