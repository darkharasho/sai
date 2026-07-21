# Codex First-Class Parity Design

**Date:** 2026-07-21  
**Status:** Approved for implementation planning  
**Provider default:** Unchanged (`claude`)

## Goal

Make Codex a first-class SAI provider whenever a user explicitly selects it. Every user-facing feature that is currently Claude-specific must have one of three deliberate outcomes:

1. a Codex implementation with equivalent behavior;
2. a provider-native Codex experience that fulfills the same user need; or
3. an explicit, tested capability limitation with clear UI and recovery guidance.

The project must not change SAI's default provider, migrate existing workspaces to Codex, or weaken Claude and Gemini behavior.

## Current-State Audit

SAI's provider abstraction is currently shallow. The renderer shares a message channel and several controls, but Claude has a complete backend lifecycle while Codex is implemented as a single `electron/services/codex.ts` process adapter.

### Transport and lifecycle

| Area | Claude today | Codex today | Gap |
|---|---|---|---|
| Backend abstraction | `ClaudeBackend` with CLI and Agent SDK implementations | One `codex exec --json` service | No replaceable backend boundary |
| Session scopes | Independent chat, task, terminal, and orchestrator scopes | One fixed `chat` scope per workspace | No concurrency or task/orchestrator isolation |
| Resume | Backend-managed sessions and scope reconciliation | `exec resume` with one workspace thread ID | Cross-chat process churn and no multi-scope restore |
| Interrupt/cleanup | Scope-aware interruption, destroy, suspend, and busy hooks | Kills the one workspace process | Cannot isolate failures or interruptions |
| Compact | Manual and automatic compaction | Not exposed | Missing context lifecycle control |
| Meta workspace prompt | Injected into Claude startup/session options | Stored but never injected | Codex lacks correct meta-workspace context |

### Streaming and transcript

| Area | Claude today | Codex today | Gap |
|---|---|---|---|
| Text | SDK deltas with final-message reconciliation | Completed agent messages only | No true live typing |
| Reasoning | Dedicated live/collapsed reasoning rows with duration and token estimates | Completed reasoning is emitted as ordinary assistant text | Wrong semantics and presentation |
| Tool updates | Start, progress, result, error, duration | Command/file start and command completion only | Missing updates, file results, MCP, web, todos, and typed errors |
| Usage | Context accounting, cache detail, rate limits, and cost hooks | Turn totals partially translated | No reasoning tokens, context size, or session-level accounting |
| Silent work | Thinking, retry, compaction, and wait hints | Generic thinking animation | No explanation for pauses |
| Plans/todos | Structured todo progress and plan-review flows | Ignored | No plan progress or interaction |

### Controls and integrations

| Area | Claude today | Codex today | Gap |
|---|---|---|---|
| Models | Dynamic models and workspace overrides | Dynamic model list | No workspace override parity or metadata polish |
| Reasoning effort | Toolbar and settings controls | Capability declared false | Codex supports reasoning effort but SAI hides it |
| Approvals | Inline command/tool approvals | Static launch-time sandbox presets | No interactive approval flow |
| Questions | Structured in-chat questions | Ignored | No user-input request flow |
| MCP | Runtime status and tool cards | Navigation hidden | Codex supports MCP but SAI conceals it |
| Plugins/skills | Claude plugin management | Navigation hidden | No provider-native extension surface |
| Swarm | Claude orchestrator and Claude workers | Provider values exist in settings but execution rejects them | Misleading configuration without functionality |
| Terminal/task scopes | Supported | Capability declared false | Codex cannot be used consistently across SAI |
| Auto-compact/context ring | Claude-only gates | Hidden | Missing Codex context control |

### Existing renderer debt

The shared renderer still encodes provider policy directly through checks such as `aiProvider === 'claude'`. The capabilities module contains broad booleans, but several flags are unused and Codex is declared incapable of features its current protocol supports. Codex events are also translated into Claude-shaped names (`Bash`, `Edit`) too early, losing provider-native information before cards render.

## Verified Codex Integration Surfaces

The design is based on Codex CLI and SDK version `0.144.6`, which was the installed and current stable package during this audit.

### Official TypeScript SDK

`@openai/codex-sdk` wraps `codex exec --json` and exposes typed threads, resume, cancellation through `AbortSignal`, structured images, model and sandbox options, reasoning effort, network/web-search options, configuration overrides, and streamed structured events.

Its item model includes:

- agent messages;
- reasoning summaries;
- command execution with updates and aggregated output;
- file-change sets;
- MCP tool calls;
- web searches;
- todo lists;
- typed errors;
- input, cached input, output, and reasoning-output usage.

The SDK is the stable default Codex backend. It does not expose the complete interactive server-request surface required for first-class inline approvals and questions.

### App-server protocol

`codex app-server` is experimental but exposes the richer client protocol needed for full UI parity. Generated v2 bindings include:

- text, reasoning-summary, reasoning-text, command-output, file-output, and plan deltas;
- thread, turn, item, settings, status, compaction, and process lifecycle notifications;
- command, file-change, permissions, MCP elicitation, dynamic-tool, and user-input requests;
- token usage with context-window and reasoning-token details;
- model, collaboration-mode, MCP status, skills, rate-limit, and account events;
- thread start/resume/fork/archive and per-thread settings;
- plans, todos, diffs, web search, images, MCP calls, and sub-agent items.

App-server is an opt-in preview backend until compatibility and dogfood gates are satisfied.

## Architecture

### 1. Codex backend contract

Introduce a `CodexBackend` boundary with lifecycle methods equivalent to the behaviors SAI expects from Claude:

- start or resume a scoped session;
- send a turn with text and images;
- interrupt a scoped turn;
- set or reconcile a thread ID;
- compact context;
- answer command, file, permission, MCP, plan, and question requests;
- query models and provider runtime status;
- suspend or destroy workspace sessions;
- report per-workspace and per-scope busy state.

The contract describes SAI behavior rather than leaking SDK classes or JSON-RPC messages. Unsupported operations return a typed capability error.

### 2. Dual backend implementations

`SdkCodexBackend` uses `@openai/codex-sdk` and is selected by default after a user chooses Codex. It owns one SDK `Thread` per workspace/scope and maps typed `ThreadEvent` values into SAI events.

`AppServerCodexBackend` owns a long-lived app-server client, negotiates protocol compatibility, and routes notifications and requests by thread and turn ID. It is selected only through a Codex preview setting. A startup incompatibility can fall back to the SDK when doing so is safe; SAI must display the reason and effective backend.

The old direct `codex exec --json` implementation is retained only until SDK migration and rollback verification are complete, then removed.

### 3. Provider-neutral event model

Create a normalized internal event model containing:

- `provider`, `backend`, `workspace`, `scope`, `threadId`, `turnId`, and `itemId` identity;
- lifecycle events for ready, start, complete, interrupt, process exit, retry, and compaction;
- assistant text start/delta/complete;
- reasoning start/delta/complete and token estimates;
- tool start/update/complete with typed tool kind and provider-native metadata;
- plan/todo updates;
- usage/context/rate-limit updates;
- approval, question, elicitation, and plan-review requests;
- typed warnings and fatal/non-fatal errors.

Provider adapters normalize at the Electron boundary. Renderer components consume normalized semantics and retain raw provider metadata only for specialized presentation or diagnostics.

### 4. Scoped runtime registry

Replace `WorkspaceCodex`'s single process fields with a registry keyed by workspace and scope. Scopes support `chat`, `terminal:<id>`, `task:<id>`, and `orchestrator:<sessionId>` identities. Each entry owns thread identity, backend state, turn sequence, pending interactions, and streaming state.

All emitted events must be checked against workspace, scope, thread, turn, and item identity. Stale events from interrupted or replaced turns are discarded. Workspace suspend and app shutdown destroy every owned Codex runtime.

### 5. Capability contract

Replace broad booleans with explicit capability descriptors where behavior differs by backend. Capabilities include availability and, where useful, a reason or required backend. Examples:

- reasoning effort: supported by SDK and app-server;
- reasoning deltas: app-server live, SDK completed summaries;
- interactive approvals: app-server only;
- MCP calls: both backends, richer status and elicitation in app-server;
- multi-scope: both once the runtime registry exists;
- orchestrator: both after Codex swarm wiring;
- compact: app-server native; SDK capability depends on supported CLI behavior;
- plugins/skills: provider-native management only where Codex exposes a supported interface.

The capability matrix is tested. A new provider-specific feature must declare its Codex outcome instead of being gated with an ad hoc Claude comparison.

## User Experience

### Provider selection and defaults

SAI continues to default to Claude. Existing global and workspace provider choices remain unchanged. The Codex backend starts only after Codex is explicitly selected, and changing the Codex backend does not affect Claude or Gemini settings.

### Codex settings

The Codex settings page gains:

- backend selector: `SDK (default)` and `App server (preview)`;
- detected Codex and SDK versions plus compatibility status;
- default model and per-workspace model override behavior;
- reasoning effort from `minimal` through `xhigh`, limited to model-supported values;
- reasoning summary/display controls;
- approval policy and sandbox policy represented separately;
- network access and web-search mode;
- context auto-compact controls where supported;
- clear explanations for backend-specific features and fallback state.

Settings are stored under a versioned Codex object. Legacy `codexModel` and `codexPermission` values are read and migrated without changing the selected provider.

### Reasoning and activity

Codex reasoning renders in the same dedicated transcript row used for Claude, with Codex-native labels. App-server streams reasoning deltas. SDK mode adds the structured summary when its event arrives and must not animate it as if it had streamed live. Completed rows retain elapsed time and reasoning-token counts when available.

Retry, compaction, and long-running tool states provide concise activity hints. The standard SAI thinking animation remains provider-neutral.

### Tool cards

Tool cards use a provider-neutral tool-kind taxonomy while preserving Codex details:

- command execution shows command, working directory, live or accumulated output, exit status, and duration;
- file changes show every changed path and change kind, with available patch/diff content;
- MCP calls show server, tool, arguments, progress, structured results, and errors;
- web search shows query and completion state;
- todo/plan items update SAI's progress UI;
- error items use the standard terminal-style error presentation.

The adapter must not relabel Codex operations as Claude tools merely to obtain an icon. Existing Claude cards continue to use the same normalized card components.

### Usage and context

Codex exposes current-turn and session usage for input, cached input, output, and reasoning output. App-server additionally supplies model context-window information and rate/account updates. The context ring, usage popover, and auto-compact behavior render from provider-neutral usage data and show only fields the active backend actually reports.

### Approvals and user interaction

App-server renders inline cards for:

- command execution approval;
- file-change approval;
- additional permission requests;
- MCP elicitation;
- dynamic tool calls;
- structured user questions;
- plan review when the active Codex mode requests it.

Responses are correlated to the original JSON-RPC request and scoped thread. SDK mode never shows nonfunctional approval buttons; settings and runtime messages explain that interactive approval requires app-server.

### Multi-scope and swarm

Codex becomes valid for terminal sessions, background task workers, and orchestrators. Codex task workers use independent threads and the same worktree, status, diff, approval, pause, resume, and landing lifecycle as Claude tasks.

The Codex orchestrator receives SAI's orchestrator instructions and only the approved swarm tool surface. SDK mode supplies the instructions and MCP configuration through supported Codex config overrides. App-server mode uses per-thread settings and dynamic or MCP tools. Orchestrator cards come from real normalized tool events, avoiding synthetic duplicates.

### MCP, plugins, and skills

Selecting Codex no longer automatically hides MCP. The MCP surface reads Codex runtime/config state, displays server startup status, and presents provider-native remediation and OAuth flows where available.

The extensions surface must distinguish Claude plugins from Codex plugins and skills. It must not write Claude plugin configuration for Codex or claim cross-provider compatibility. Codex extension installation is enabled only through a supported Codex interface; otherwise SAI provides discovery and configuration guidance rather than an unsafe file-format guess.

### Mobile and remote

Normalized events flow through the existing remote bridge. Mobile clients receive Codex text, reasoning, tools, usage, approvals, completion, and errors with the same identity fields. Desktop-only interactions remain visibly actionable from desktop instead of silently blocking a remote turn.

## Data Flow

1. The user selects Codex; SAI resolves the configured Codex backend without changing the global default.
2. A chat, terminal, task, or orchestrator mounts and requests a scoped runtime.
3. The backend starts or resumes a Codex thread with model, reasoning, sandbox, approval, network, directories, and provider-native instructions.
4. A turn produces SDK events or app-server notifications/requests.
5. The backend adapter maps these into normalized SAI events with complete identity metadata.
6. Electron publishes the event through the shared provider message channel.
7. The renderer rejects mismatched/stale events and updates transcript, cards, usage, approvals, and workspace activity.
8. Interaction responses return through provider-neutral IPC to the owning backend and exact pending request.
9. Completion persists settled transcript state and usage, clears transient state, and advances queued prompts.

## Failure Handling

- Backend startup errors include executable, SDK, protocol, authentication, and compatibility categories.
- App-server fallback to SDK occurs only before an incompatible thread begins or when a resumable thread is known to be SDK-compatible.
- A fallback emits a visible warning and records both requested and effective backend.
- Unsupported operations return a typed capability error and recovery action.
- Non-fatal warnings do not end a turn; fatal errors settle all partial transcript items before completion.
- Interrupt flushes partial text, reasoning, command output, and file updates before marking items interrupted.
- Duplicate terminal events are idempotent by thread, turn, item, and event phase.
- Malformed provider payloads are logged with redacted metadata and surfaced as a bounded provider error rather than crashing Electron.
- One scope's failure never clears another scope's process, thread, pending interaction, or busy state.
- Histories persist completed reasoning, plans, tool results, durations, and usage but remove transient live flags and pending request handles.

## Delivery Phases

This program spans independent subsystems and must be implemented as separately reviewable plans.

### Phase 1: Backend foundation

- Add the Codex backend contract and backend selection.
- Integrate `@openai/codex-sdk` as the Codex default backend.
- Add scoped runtime storage, resume, interruption, cleanup, images, model, effort, sandbox, network, and meta-workspace instructions.
- Preserve the current direct CLI path as a rollback backend until verification completes.

### Phase 2: Normalized transcript and tool UX

- Add the provider-neutral event model.
- Map SDK text, reasoning, commands, file changes, MCP calls, web searches, todos, errors, and usage.
- Refactor transcript reasoning, tool cards, duration, errors, and queue completion to consume normalized events.

### Phase 3: App-server preview, approvals, and context

- Add the app-server client, version negotiation, thread lifecycle, and safe SDK fallback.
- Map deltas, context usage, rate limits, compaction, settings updates, approvals, questions, elicitation, and plan events.
- Add Codex settings and capability-aware UI.

### Phase 4: Multi-scope and swarm

- Enable terminal and concurrent chat scopes.
- Enable Codex task workers and orchestrators.
- Verify worktree isolation, approvals, task status, pause/resume, diff persistence, landing, and teardown.

### Phase 5: MCP, extensions, remote parity, and final audit

- Enable Codex MCP runtime/status surfaces and supported OAuth/remediation.
- Add provider-native Codex plugin/skill presentation and supported management paths.
- Complete mobile/remote event parity.
- Remove obsolete Claude-only gates and the legacy direct CLI backend after rollback criteria pass.
- Publish the tested parity matrix and close every audit item with implementation, native equivalent, or explicit limitation.

## Testing Strategy

### Unit tests

- Contract tests exercise start, resume, send, interrupt, cleanup, busy state, and failure behavior for every backend.
- Event-mapper tests cover every SDK item/event and every app-server notification/request used by SAI.
- Identity tests reject stale workspace, scope, thread, turn, and item events.
- Capability tests cover provider and backend combinations with reasons and recovery actions.
- Settings tests cover legacy migration without provider-default changes.

### Renderer integration tests

- Text and reasoning settle correctly for live and completed-only modes.
- Tool cards update in place and settle on empty, successful, failed, and interrupted results.
- Usage and context controls show only available fields.
- Approval, question, MCP elicitation, and plan responses correlate to the right request.
- Queue draining, persistence, history restore, errors, retry hints, and notifications match Claude-quality behavior.

### Swarm and lifecycle tests

- Multiple Codex scopes run concurrently without event bleed.
- Codex workers operate in isolated worktrees and survive UI remounts.
- Codex orchestrators see only orchestrator tools and render one card per call.
- Pause, resume, interrupt, land, discard, suspend, and shutdown clean up the correct runtime.

### End-to-end and dogfood

- Select Codex without changing a fresh install's default provider.
- Run SDK chats across restart/resume, images, reasoning, MCP, web search, file edits, commands, todos, errors, and interruption.
- Run app-server chats across approvals, questions, context, compaction, fallback, and version mismatch.
- Switch repeatedly among Claude, Codex, and Gemini without transcript or settings contamination.
- Exercise Codex terminal sessions, workers, orchestrator flows, meta workspaces, mobile/remote, and notification behavior.
- Run TypeScript, unit, integration, targeted Electron E2E, and existing Claude/Gemini regression suites after each phase.

## Success Criteria

1. Claude remains the default provider for new and existing users unless they explicitly select another provider.
2. Selecting Codex uses the official Codex SDK by default and exposes an explicit app-server preview option.
3. Codex reasoning, tool activity, plans, usage, errors, and lifecycle have polished structured UI rather than lossy text translation.
4. Every advertised Codex control works with the active backend; unsupported controls are hidden or explain the required backend.
5. Codex supports isolated chat, terminal, worker, and orchestrator scopes.
6. Codex MCP and extension capabilities are represented provider-natively instead of being blanket-hidden.
7. App-server compatibility failures fall back safely and visibly where possible.
8. The tested parity matrix accounts for every Claude-specific feature with a Codex implementation, native equivalent, or explicit limitation.
9. Claude and Gemini behavior and regression suites remain unchanged and green.

## Non-Goals

- Changing the global default provider from Claude.
- Making Codex imitate Claude terminology or configuration formats.
- Claiming exact transport parity when the SDK reports only completed reasoning summaries.
- Depending on undocumented Codex configuration file mutations for plugins or skills.
- Enabling app-server by default before compatibility tests and dogfood gates pass.
- Refactoring unrelated editor, Git, terminal, or layout code.

## Primary Risks and Mitigations

| Risk | Mitigation |
|---|---|
| App-server protocol changes | Generated-type fixtures, version negotiation, compatibility tests, preview flag, visible SDK fallback |
| Duplicate or reordered events | Normalized identity keys and idempotent item phase transitions |
| Renderer remains Claude-shaped | Provider-neutral event and tool-kind contracts before adding new Codex UI |
| Misleading parity claims | Capability descriptors with backend requirements and a tested parity matrix |
| Swarm cross-scope contamination | Per-scope runtime ownership and end-to-end concurrent tests |
| Legacy setting regressions | Versioned migration tests and unchanged `aiProvider` default |
| Extension config corruption | Use supported Codex interfaces only; otherwise provide read-only discovery/guidance |

