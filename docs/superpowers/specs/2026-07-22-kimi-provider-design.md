# Kimi K3 Provider Support — Design

**Date:** 2026-07-22
**Status:** Approved (approach A: kimi-cli over ACP)

## Goal

Add Kimi K3 (Moonshot AI) as a full fourth AI provider in SAI — its own tile next to
Claude / Codex / Gemini, with agentic coding in workspaces (tool use, file edits,
approvals, model picker).

## Background

- Kimi K3 shipped 2026-07-16: 2.8T-param open-weight MoE, 1M-token context, native
  vision, model id `kimi-k3`.
- Moonshot's [kimi-cli](https://github.com/MoonshotAI/kimi-cli) supports the Agent
  Client Protocol (ACP) via `kimi acp` — the same protocol SAI already speaks for
  Gemini (`electron/services/gemini-acp.ts` + `gemini.ts`).
- Rejected alternatives: (B) pointing the Claude Agent SDK at Moonshot's
  Anthropic-compatible endpoint — max feature reuse but introduces stored API keys
  (new to SAI) and entangles Kimi with Claude backend state; (C) raw
  OpenAI-compatible API — requires building an agent loop from scratch.

## Architecture

Kimi becomes the fourth member of the `AIProvider` union
(`'claude' | 'codex' | 'gemini' | 'kimi'`). SAI spawns `kimi acp` as a
JSON-RPC-over-stdio subprocess per workspace, translates ACP events into the
Claude-shaped messages the renderer already consumes on the `claude:message`
channel, and exposes a `kimi:*` IPC namespace
(`models` / `start` / `send` / `stop` / `approve` / `setSessionId`).

### Shared ACP layer (targeted refactor)

The Gemini integration is ~95% provider-agnostic ACP plumbing. Rather than copy it
into a second drifting 800-line file:

1. **`electron/services/acp.ts`** — extract the generic JSON-RPC/stdio client from
   `gemini-acp.ts`, parameterized by `{ command, args, label }` (label feeds error
   strings). `gemini-acp.ts`'s only provider-specific content is
   `spawn('gemini', ['--acp'])` and error-message prefixes.
2. **`electron/services/acpProvider.ts`** — extract the session layer from
   `gemini.ts` into a factory parameterized by:
   - provider key (`'gemini' | 'kimi'`) → IPC channel prefix, workspace state slot,
     notify label, error strings
   - spawn command/args
   - model catalog `{ models, defaultModel }`
   - tool-kind → Claude-tool-name/input mapping (base table from ACP-standard kinds
     — `read`, `edit`, `execute`, `search`, `fetch`, … — merged with the existing
     Gemini table; per-provider overrides allowed)
   - provider-specific prompt params (e.g. Gemini's `conversationMode`)

   The factory owns: scope→session maps (chat / terminal / commit), first-turn
   project bootstrap preamble, `session/prompt` flow, 2-minute idle timeout,
   transport-vs-request error split, approval flow, `turnSeq` guards.
3. **`gemini.ts`** and new **`kimi.ts`** become thin configs invoking the factory.

### Workspace state

`ws.gemini`'s state type in `workspace.ts` is renamed to a shared
`AcpProviderState`; a parallel `ws.kimi` slot is added (transport, chatSessionId,
terminalSessions, commitSessionId, loadedSessionIds, bootstrappedSessionIds,
turnSeq, busy, availability, pendingApproval, …). Register
`registerWorkspaceBackendHooks('kimi', { suspend, isBusy })`.

### Auth

No credentials stored in SAI (consistent with Claude/Codex/Gemini). The user
authenticates once via `kimi /login` in a terminal (Moonshot account or API key —
the CLI owns it). If the CLI is missing or unauthenticated, the transport error is
surfaced with a hint: "install kimi-cli and run `kimi /login`", via the existing
disable-provider path.

### Models

`kimi:models` returns a hardcoded catalog with `kimi-k3` as default (mirrors
`GEMINI_MODELS`). **To verify during implementation:** whether kimi-cli's ACP
accepts a per-prompt `model` param the way Gemini's does. If it does not, the model
picker is hidden for Kimi and the CLI's configured default model is used.

## Renderer changes

- `src/types.ts` — extend `AIProvider` union and its duplicate literal unions.
- `src/providers/capabilities.ts` — add `kimi`:
  same as Gemini except `hasConversationMode: false` (fast/smart toggle is
  Gemini-specific). `supportsImages: true` (K3 has native vision),
  `hasApprovalMode: true`, `supportsTerminalScope: true`,
  `supportsMultiScope: true`, everything else `false`.
- `src/components/Chat/ChatPanel.tsx`, `ChatInput.tsx` — add
  `aiProvider === 'kimi'` branches (start/send/stop dispatch, model picker).
- `src/components/SettingsModal.tsx` — `PROVIDER_OPTIONS` entry, `SettingsPage`
  union, minimal `kimi` settings page (default model; install/login guidance).
- `src/App.tsx` — provider state/session branches, provider icon/color.
- `electron/preload.ts` — `kimiStart/kimiSend/kimiStop/kimiApprove/…` plus the
  generic `provider.*` bridge switch.
- `public/svg/kimi.svg` — provider icon.

## Data flow

`kimi:send` → ensure transport + session for scope → first-turn bootstrap preamble
→ `session/prompt` → ACP `session/update` events translated to streaming text /
`tool_use` / `tool_result` / `approval_needed` → `result` (usage) + `done` carrying
`turnSeq`. Identical to Gemini's flow; all messages ride the `claude:message`
channel.

## Error handling

Mirrors Gemini exactly:

- **Transport failures** (process died / never started / initialize failed):
  disable the provider for the workspace, show reason + install/login hint, emit
  `error` + `done`.
- **Request failures** (bad image, per-turn API error): clear the scope's session
  so the next turn starts fresh; keep the transport alive; emit `error` + `done`.
- **Silent hangs:** 2-minute idle timeout, reset on every ACP event.
- `done` events always carry the turn's captured `turnSeq` (stale-done guard).

## Testing

- Unit tests for `acp.ts` (spawn args per provider, message framing, pending-request
  rejection on exit) and `acpProvider.ts` (event translation, error paths, session
  scoping) — run with `--maxWorkers=2`.
- Existing `tests/unit/electron/geminiAcpImages.test.ts` must stay green through the
  refactor (guards Gemini behavior).
- Renderer tests: capabilities entry, provider switch/dispatch branches.
- Final gate: live smoke test with kimi-cli installed and logged in.

## Out of scope (v1)

- Stored API keys / Moonshot-endpoint fallback.
- Orchestrator, swarm, MCP, plugins, slash commands for Kimi.
- Codex-style composer telemetry / rate-limit views.
- Commit-message generation via Kimi beyond what the shared factory provides
  for free (Gemini parity).

## Risks

- **Refactor risk:** extracting `acpProvider.ts` touches the working Gemini path.
  Mitigated by keeping `geminiAcpImages.test.ts` green, new unit coverage, and a
  Gemini live smoke alongside the Kimi one.
- **ACP dialect drift:** kimi-cli's ACP event shapes (tool-call kinds, model
  param, usage fields) may differ from Gemini's dialect. The kind-mapping table is
  per-provider overridable; unknown kinds fall back to `title || kind`.
- **kimi-cli availability:** Python-based CLI must be on PATH; the enriched-env
  PATH logic (`~/.local/bin`, nvm, `/usr/local/bin`) already covers common install
  locations.
