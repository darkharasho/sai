# Route API-Error Assistant Text Through the Error UI

**Status**: Draft
**Date**: 2026-05-02
**Scope**: `src/components/Chat/ChatPanel.tsx`, `src/components/Chat/parseAiError.ts`

## Problem

Some Claude / Codex / Gemini CLI sessions surface API errors as assistant
text content (a `type: 'assistant'` message whose text body is the raw
"API Error: 400 {…}" envelope) rather than as a `type: 'error'` event.
The existing error handling path in `ChatPanel.tsx` only triggers on
`msg.type === 'error'`, so these errors bypass `parseAiError` and render
as plain markdown inside an assistant bubble. Result: an ugly raw JSON
dump where a clean error card should be.

## Goal

Detect API-Error envelopes that arrive as assistant text and route them
through the existing parsed-error rendering path (accent card, status
badge, request_id, expandable details, retry button).

## Detection

Add a sibling export `looksLikeApiError(text: string): boolean` to
`parseAiError.ts`:

```ts
export function looksLikeApiError(text: string): boolean {
  if (!text) return false;
  const t = text.trim();
  if (/^API Error\b/i.test(t)) return true;
  // Some CLI variants surface the JSON envelope without the "API Error:" prefix
  if (/"type"\s*:\s*"error"/.test(t) && /"message"\s*:/.test(t)) return true;
  return false;
}
```

The two cases cover what's been seen in the wild — the prefixed string
and the bare JSON envelope.

## Routing change

In `ChatPanel.tsx`, inside the `msg.type === 'assistant'` handler, after
collecting `text` and `tools` from `msg.message.content`:

- When `tools.length === 0` and `looksLikeApiError(text)` is true:
  1. Run `parseAiError(text)` to get the parsed error object.
  2. If the last message in the list is a streaming-partial assistant
     bubble (`last?.role === 'assistant'` and `!last.toolCalls`), drop it
     — it's the partial that was accumulating as the error envelope
     streamed in.
  3. Append a new message with `role: 'system'`,
     `content: parsedError.message`, `error: parsedError`, fresh `id`
     and `timestamp`.
  4. Skip the normal assistant-message append/update path for this
     iteration.
- When `tools.length > 0` and the text matches: leave as-is. A tool turn
  that also surfaces an API error is unusual and the existing flow
  handles it well enough; YAGNI.

## Result

Errors arriving via the assistant-text path render through the same
component branch as `type: 'error'` events — title from
`STATUS_TITLES`/`ERROR_TYPE_TITLES`, HTTP status badge, message body,
`request_id`, expandable details with a copy button, and the retry
button (which works because the system-role error already has the retry
wiring on `chat-msg-error-actions`).

## Files

- Modify: `src/components/Chat/parseAiError.ts` — add `looksLikeApiError` export
- Modify: `src/components/Chat/ChatPanel.tsx` — branch in assistant handler
- Add: `tests/unit/components/Chat/parseAiError.test.ts` (or extend if
  it already exists) — cover `looksLikeApiError` with the user's exact
  example, the bare-JSON variant, normal assistant text, empty string
- Modify: `tests/unit/components/Chat/ChatPanel.test.tsx` — fire an
  assistant message containing an API-Error envelope, assert the
  resulting visible message has `role: 'system'` and that the parsed
  error fields are reachable

## Testing

Unit tests:

- `looksLikeApiError("API Error: 400 {...}")` → true
- `looksLikeApiError(JSON.stringify({type:'error', error:{message:'x'}}))` → true (bare JSON variant)
- `looksLikeApiError("Here is some normal answer text.")` → false
- `looksLikeApiError("")` → false
- ChatPanel: dispatch a `type: 'assistant'` message whose text is the
  user's example string, assert the rendered DOM contains the error UI
  (the existing system-role error rendering produces an
  `[data-testid="chat-msg"]` with the `chat-msg-error-wrap` class — or
  whichever marker the test infrastructure already uses for errors).

Manual QA:

- Trigger a content-policy block in Claude (or paste a synthetic API
  Error envelope through whatever path surfaces it as assistant text);
  confirm it renders as the standard error card with retry, not as raw
  JSON.

## Out of scope

- Changing the error UI (already nice).
- Mid-stream error detection where non-error text precedes the envelope.
- Fixing the CLI bridge / main-process error reporting upstream.
