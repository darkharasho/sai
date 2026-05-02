# `/fake-error` Dev-Only Slash Command

**Status**: Draft
**Date**: 2026-05-02
**Scope**: `src/components/Chat/ChatPanel.tsx` (+ optionally `ChatInput.tsx` autocomplete)

## Goal

Add a dev-only family of slash commands that injects synthetic API-error
envelopes into the chat so we can verify the error rendering paths
(title, status badge, message body, request_id, expandable details,
retry button) without having to coerce a real provider into returning
each error type.

## Variants

| Command | Envelope produced |
|---|---|
| `/fake-error` (no arg) | 400 `invalid_request_error` — "Output blocked by content filtering policy" |
| `/fake-error rate-limit` | 429 `rate_limit_error` — "Number of request tokens has exceeded your per-minute rate limit" |
| `/fake-error auth` | 401 `authentication_error` — "Invalid bearer token" |
| `/fake-error permission` | 403 `permission_error` — "OAuth token has been revoked" |
| `/fake-error overloaded` | 529 `overloaded_error` — "The Anthropic API is temporarily overloaded" |
| `/fake-error server` | 500 `api_error` — "Internal server error" |
| `/fake-error timeout` | 504 `api_error` — "Request timed out upstream" |

Each variant produces a string of the shape:

```
API Error: <STATUS> {"type":"error","error":{"type":"<ERR_TYPE>","message":"<MSG>"},"request_id":"req_fake_<rand>"}
```

That string is fed into the same routing branch the production
assistant-text path uses (Task 2 from the previous spec) so the dev
command exercises the real code path, not a parallel one.

## Gate

Only available when `import.meta.env.DEV` is true (Vite's standard
dev-build flag). In production builds, `/fake-error …` falls through to
the normal send path — there is no dev/prod split for that fall-through
behaviour because regular slash commands also fall through when
unmatched.

## Implementation

In `ChatPanel.tsx`'s `handleSend`, before the existing `/clear` /
`/compact` / `/help` branches:

```ts
if (import.meta.env.DEV && text.startsWith('/fake-error')) {
  handleFakeError(text);
  return;
}
```

A new local helper `handleFakeError(text: string): void`:

1. Strip the leading `/fake-error` and trim. The remainder is the
   variant key (e.g. `"rate-limit"`, `"auth"`, etc., or `""` for the
   default).
2. Map the key to a `{ status, type, message }` triple from the table
   above. Unknown keys fall back to the default (no-op for unknowns
   keeps the surface small).
3. Build the envelope string:
   `\`API Error: ${status} ${JSON.stringify({ type: 'error', error: { type, message }, request_id: \`req_fake_${randomHex(12)}\` })}\``
4. Run that string through `parseAiError` and append a `role: 'system'`
   message carrying the parsed `error` object. (Same final mutation as
   the assistant-text routing branch — just without the
   "drop last partial" step, since the dev command isn't streamed.)

Place the helper near the existing message-handling helpers in
`ChatPanel.tsx` so it lives next to its only caller.

## Autocomplete (optional, nice-to-have)

`ChatInput.tsx` consumes a `slashCommands` prop for autocomplete
suggestions. When `import.meta.env.DEV` is true, append the variants to
that list at render time so they show up in the picker and are
discoverable. Skip this if the autocomplete plumbing is awkward — the
commands work via raw typing regardless.

## Files

- Modify: `src/components/Chat/ChatPanel.tsx`
- Optionally modify: `src/components/Chat/ChatInput.tsx`
- Modify: `tests/unit/components/Chat/ChatPanel.test.tsx`

## Testing

Unit tests:

- Default `/fake-error` in DEV produces a system message with
  `error.status === 400`, `error.title === 'Invalid request'`,
  `error.message === 'Output blocked by content filtering policy'`.
- `/fake-error rate-limit` produces `error.status === 429`,
  `error.title === 'Rate limit exceeded'`.
- An unknown variant (`/fake-error nonsense`) falls back to the default
  envelope (status 400, invalid_request).

Tests can stub `import.meta.env.DEV` via vitest's `vi.stubEnv` if
needed; in practice vitest sets `DEV` true under `npm run test`, so the
default test environment already exercises the dev branch.

Manual QA:

- In `npm run dev`, type `/fake-error` and Enter — error card appears
  with HTTP 400 badge.
- Repeat for each variant; confirm the title, badge, and message change
  appropriately.
- Run a production build (`npm run build && npm run preview` if that's
  the workflow) and confirm `/fake-error` falls through to the normal
  send path (the CLI receives it as a prompt and either errors or echos
  it).

## Out of scope

- Programmatically generating variants from `parseAiError`'s internal
  tables (variant list is hand-curated for clarity).
- A production-build escape hatch for fake errors.
- Triggering streaming/thinking-indicator states alongside the fake
  error.
