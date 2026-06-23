# Type-to-answer a pending AskUserQuestion

## Problem

When SAI renders an `AskUserQuestion` card in chat and the user, instead of
clicking an option, types a message into the chat box and presses Enter, that
message is sent as a brand-new turn. The pending question is left dangling and
the typed text is not treated as the answer. Users expect that a message sent
while a question is open is simply their answer — the free-text "Other" choice.

## Goal

When a Claude `AskUserQuestion` card is awaiting an answer and the user sends a
normal chat message, route that text as the **"Other"** free-text answer to the
pending question(s) instead of starting a new turn.

## Scope and rules

- **Claude only.** The answer channel (`window.sai.claudeAnswerQuestion` →
  `claude:answer-question`) is Claude-specific. For Codex/Gemini, or when no
  question is pending, `handleSend` behaves exactly as today.
- **Apply to all questions.** An `AskUserQuestion` can hold up to 4 questions.
  The typed text becomes the "Other" answer for **every** question in the
  pending card.
  - Single-select question → value is the raw text string.
  - MultiSelect question → value is a one-element array `[text]` (mirrors how
    `AskUserQuestionView` resolves an "Other" pick).
- **Empty/whitespace-only text** is ignored at the existing input layer (the
  composer already declines to send blanks); the helper also returns `null` so
  there is no accidental empty answer.
- **No extra user bubble.** The card itself flips to "Answered" and shows the
  text, and the backend (`answerQuestionImpl`) already forwards the answer to
  the model as the corrective user message. We do not also append a separate
  user message bubble.

## Mechanism

1. **Pure helper** `buildPendingQuestionAnswer(messages, text)` in
   `src/lib/pendingQuestionAnswer.ts`:
   - Scans `messages` from newest to oldest for an assistant message tool call
     with `name === 'AskUserQuestion'` whose parsed `input` has no non-empty
     `answers` object (i.e. still unanswered).
   - Returns `{ toolUseId, answers }` where `answers` is
     `Record<questionText, string | string[]>` built per the rules above, or
     `null` if there is no unanswered question or `text` is blank.
   - Tolerates malformed `input` JSON (skips that tool call).

2. **Wire into `ChatPanel.handleSend`:** near the top, after the existing
   slash-command / dev short-circuits but before the user-message append and
   provider dispatch, add:
   - If `aiProvider === 'claude'` and `awaitingQuestion` is true, call
     `buildPendingQuestionAnswer(messagesRef.current, text)`. If it returns a
     result, call `handleAnswerQuestion(result.toolUseId, result.answers)` and
     `return` — skipping the normal send entirely.
   - Otherwise fall through to today's behavior.

   `awaitingQuestion` is the authoritative "pending" gate (already a prop driven
   by the `question_needed` / `question_answered` events); the messages scan
   only supplies the `toolUseId` + question shapes. If the gate is set but no
   unanswered card is found, fall through to a normal send.

3. **Affordance:** when `awaitingQuestion` is true (Claude), the composer
   placeholder changes to hint that typing will answer the question, e.g.
   *"Type to answer, or use the buttons above…"*.

4. **Remote/mobile chat** (`src/renderer-remote`): the same behavior, against the
   transcript message model where each tool is its own message and `toolInput`
   is already an object. A sibling helper
   `buildPendingQuestionAnswerFromTranscript(messages, text)` shares the
   answer-building core; `Chat.onSend` intercepts when `awaitingQuestion`, and
   the `Composer` placeholder gets the same hint ("Type to answer, or tap an
   option").

## Testing

Unit tests for `buildPendingQuestionAnswer`:
- Single-select single question → `{ [q]: text }`.
- MultiSelect question → `{ [q]: [text] }`.
- Multiple questions → text applied to all (mixed select/multiSelect shapes).
- Already-answered card (input has `answers`) → `null`.
- No AskUserQuestion present → `null`.
- Blank/whitespace text → `null`.
- Malformed `input` JSON → skipped, `null` if none usable.
- Picks the most-recent unanswered card when several exist.

## Out of scope

- Codex/Gemini question flows (no equivalent answer channel today).
- Changing the card UI itself or the backend answer injection.

## Implementation note

Both the desktop and remote/mobile paths are implemented. Codex/Gemini remain
out of scope (no answer channel).
