# `/fake-error` Dev-Only Slash Command — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- []`) syntax for tracking.

**Goal:** Add seven dev-only `/fake-error` slash command variants in `ChatPanel.tsx` that inject synthetic API-error envelopes into the chat for verifying the error rendering paths (title, status badge, request_id, expandable details, retry button).

**Architecture:** Add a small `FAKE_ERROR_VARIANTS` table to `ChatPanel.tsx` mapping variant keys to `{ status, type, message }` triples, plus a `handleFakeError(text)` helper that builds the envelope string and pipes it through `parseAiError` into a `role: 'system'` message. Branch in `handleSend` before the existing `/clear` / `/compact` / `/help` handlers, gated on `import.meta.env.DEV`.

**Tech Stack:** React 18, TypeScript, Vite, Vitest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-05-02-fake-error-slash-command-design.md`

---

## File Structure

**Modified files:**
- `src/components/Chat/ChatPanel.tsx` — variant table, `handleFakeError` helper, `handleSend` branch
- `tests/unit/components/Chat/ChatPanel.test.tsx` — three new tests covering default, named variant, unknown-key fallback

No new files. The variant table and helper are small enough to live alongside the other inline command handlers in `ChatPanel.tsx`.

---

## Task 1: Add `/fake-error` dev command with variants

**Files:**
- Modify: `src/components/Chat/ChatPanel.tsx`
- Modify: `tests/unit/components/Chat/ChatPanel.test.tsx`

- [ ] **Step 1: Read context**

In `src/components/Chat/ChatPanel.tsx`, locate:
- The existing `import { parseAiError, looksLikeApiError } from './parseAiError';` (added in the previous spec) — already in place, no edit needed
- `handleSend = async (text: string, images?: string[]) => { ... }` (around line 1149) and the `/clear` / `/compact` / `/help` branches inside it

Orientation only.

- [ ] **Step 2: Write the failing tests**

Add three new tests to `tests/unit/components/Chat/ChatPanel.test.tsx`. Use the existing `baseProps()` helper (or, if absent, copy the inline-props pattern from a nearby test). Vitest sets `import.meta.env.DEV = true` by default in `npm run test`, so no env stubbing is needed.

```tsx
it('/fake-error appends a default API-error system message in dev mode', async () => {
  const onMessagesChange = vi.fn();
  const props: ChatPanelProps = { ...baseProps(), onMessagesChange };
  render(<ChatPanel {...props} />);

  await waitFor(() => expect(latestChatInputProps).toBeTruthy());

  await act(async () => {
    await latestChatInputProps.onSend('/fake-error');
  });

  const lastCall = onMessagesChange.mock.calls[onMessagesChange.mock.calls.length - 1];
  const messages = lastCall[0];
  const last = messages[messages.length - 1];

  expect(last.role).toBe('system');
  expect(last.error).toBeTruthy();
  expect(last.error.status).toBe(400);
  expect(last.error.title).toBe('Invalid request');
  expect(last.error.message).toBe('Output blocked by content filtering policy');
  expect(last.error.requestId).toMatch(/^req_fake_/);
});

it('/fake-error rate-limit produces a 429 envelope', async () => {
  const onMessagesChange = vi.fn();
  const props: ChatPanelProps = { ...baseProps(), onMessagesChange };
  render(<ChatPanel {...props} />);

  await waitFor(() => expect(latestChatInputProps).toBeTruthy());

  await act(async () => {
    await latestChatInputProps.onSend('/fake-error rate-limit');
  });

  const lastCall = onMessagesChange.mock.calls[onMessagesChange.mock.calls.length - 1];
  const last = lastCall[0][lastCall[0].length - 1];

  expect(last.role).toBe('system');
  expect(last.error.status).toBe(429);
  expect(last.error.title).toBe('Rate limit exceeded');
});

it('/fake-error with unknown variant falls back to the default envelope', async () => {
  const onMessagesChange = vi.fn();
  const props: ChatPanelProps = { ...baseProps(), onMessagesChange };
  render(<ChatPanel {...props} />);

  await waitFor(() => expect(latestChatInputProps).toBeTruthy());

  await act(async () => {
    await latestChatInputProps.onSend('/fake-error nonsense');
  });

  const lastCall = onMessagesChange.mock.calls[onMessagesChange.mock.calls.length - 1];
  const last = lastCall[0][lastCall[0].length - 1];

  expect(last.role).toBe('system');
  expect(last.error.status).toBe(400);
  expect(last.error.title).toBe('Invalid request');
});
```

`latestChatInputProps` is the existing test scaffolding (the file mocks `ChatInput` and captures the last props it received — see top of the test file).

- [ ] **Step 3: Run failing tests**

Run: `npm run test:unit -- ChatPanel.test.tsx -t "fake-error"`
Expected: FAIL — no `/fake-error` handler exists, the prompt is sent through the normal CLI path so `onMessagesChange` doesn't reach the asserted state.

- [ ] **Step 4: Add the variant table**

In `src/components/Chat/ChatPanel.tsx`, add this constant near the top of the file (alongside other module-level constants like `RENDER_CHUNK`):

```tsx
const FAKE_ERROR_VARIANTS = {
  '': { status: 400, type: 'invalid_request_error', message: 'Output blocked by content filtering policy' },
  'rate-limit': { status: 429, type: 'rate_limit_error', message: 'Number of request tokens has exceeded your per-minute rate limit' },
  'auth':       { status: 401, type: 'authentication_error', message: 'Invalid bearer token' },
  'permission': { status: 403, type: 'permission_error', message: 'OAuth token has been revoked' },
  'overloaded': { status: 529, type: 'overloaded_error', message: 'The Anthropic API is temporarily overloaded' },
  'server':     { status: 500, type: 'api_error', message: 'Internal server error' },
  'timeout':    { status: 504, type: 'api_error', message: 'Request timed out upstream' },
} as const;
```

- [ ] **Step 5: Add the `handleFakeError` helper**

Inside the `ChatPanel` component, near the other message-handling helpers (e.g. just above `handleSend`), add:

```tsx
const handleFakeError = useCallback((text: string) => {
  const arg = text.replace(/^\/fake-error\s*/, '').trim() as keyof typeof FAKE_ERROR_VARIANTS;
  const variant = FAKE_ERROR_VARIANTS[arg] ?? FAKE_ERROR_VARIANTS[''];
  const requestId = `req_fake_${Math.random().toString(16).slice(2, 14)}`;
  const envelope = `API Error: ${variant.status} ${JSON.stringify({
    type: 'error',
    error: { type: variant.type, message: variant.message },
    request_id: requestId,
  })}`;
  const error = parseAiError(envelope);
  setMessages(prev => [...prev, {
    id: `${Date.now()}-${Math.random()}`,
    role: 'system',
    content: error.message,
    timestamp: Date.now(),
    error,
  }]);
}, [setMessages]);
```

`useCallback` is used to match the surrounding helpers' style. `setMessages` is already declared earlier in the component.

- [ ] **Step 6: Branch in `handleSend`**

In `handleSend`, add a new branch before the existing `/clear` branch:

```tsx
if (import.meta.env.DEV && text.startsWith('/fake-error')) {
  handleFakeError(text);
  return;
}
```

This is the first thing inside `handleSend`. The existing `/clear`, `/compact`, `/help` branches stay in their current positions below it.

- [ ] **Step 7: Run the tests**

Run: `npm run test:unit -- ChatPanel.test.tsx -t "fake-error"`
Expected: PASS — three new tests.

- [ ] **Step 8: Run the full ChatPanel suite to confirm no regressions**

Run: `npm run test:unit -- ChatPanel.test.tsx`
Expected: PASS — every test including the three new ones.

- [ ] **Step 9: Manual smoke check**

Run `npm run dev`. In a chat workspace:

- Type `/fake-error` and Enter — error card appears with HTTP 400 badge, "Invalid request" title, "Output blocked by content filtering policy" body, a `req_fake_…` request_id, expandable details, retry button.
- Try `/fake-error rate-limit` — HTTP 429 badge, "Rate limit exceeded" title.
- Try `/fake-error overloaded` — HTTP 529 badge, "Provider overloaded" title.
- Try `/fake-error nonsense` — falls back to default 400 envelope.

- [ ] **Step 10: Commit**

```bash
git add src/components/Chat/ChatPanel.tsx tests/unit/components/Chat/ChatPanel.test.tsx
git commit -m "feat(chat): /fake-error dev-only slash command"
```

---

## Self-Review Notes

- **Spec coverage:**
  - All 7 variants from the spec table → Step 4 (`FAKE_ERROR_VARIANTS`)
  - Envelope shape with `request_id: req_fake_<rand>` → Step 5 (`requestId = \`req_fake_${...}\``)
  - Routes through `parseAiError` to a `role: 'system'` message → Step 5 (helper body)
  - Gate on `import.meta.env.DEV` → Step 6 (branch condition)
  - Unknown key falls back to default → Step 5 (`FAKE_ERROR_VARIANTS[arg] ?? FAKE_ERROR_VARIANTS['']`) + Step 2 third test
  - Out of scope: autocomplete suggestion list → not implemented (spec says optional and to skip if awkward)
- **Placeholder scan:** none.
- **Type consistency:** `FAKE_ERROR_VARIANTS` keyed by string variant name; `handleFakeError(text: string): void` consumes the raw command text and parses the variant inline. `error` object shape matches `ParsedError` from `parseAiError.ts`.
