# Codex / ChatGPT Desktop Capability Parity

## Goal

Give Codex in SAI the same user-facing capability class as Claude while using
Codex-native configuration, security, plugins, and agent protocols. The target
is parity with capabilities available to a locally signed-in Codex or ChatGPT
Desktop host, across SAI Desktop, Remote PWA, and native mobile where the
surface already supports the underlying interaction.

This is not an attempt to present Claude-only protocols as Codex features.
Where providers differ, SAI presents one coherent user experience and delegates
policy and execution to the active provider's native mechanism.

## Scope boundary

Included:

- Locally executable Codex and ChatGPT Desktop capabilities: model/effort,
  reasoning summaries, sessions, images, tool progress, web search, approvals,
  sandbox controls, MCP, plugins, skills, subagents, worktrees, and SAI Swarm.
- The corresponding Desktop, Remote PWA, and mobile controls when their host
  protocol can safely expose them.

Excluded:

- ChatGPT-web-only hosted workloads such as cloud tasks, cloud environments,
  voice, scheduled work, workspace administration, and web connectors that do
  not run through the local Codex host. They require a separately authorized
  hosted-product integration.
- Exposing hidden chain-of-thought. SAI may display only reasoning summaries
  supplied by Codex, plus raw reasoning when Codex provides it and the user
  explicitly opts in.

## Findings

SAI's Codex SDK backend already supports dynamic models and effort, resumable
per-scope sessions, local images, additional worktree directories, tool/file/
todo/web-search/MCP rendering, completion notifications, and summarized
reasoning mapping. The renderer already has a live reasoning block.

The current provider capability matrix incorrectly hides several of these
working paths (`hasOrchestrator`, `hasSlashCommands`, `supportsTerminalScope`,
`supportsMultiScope`, `hasMcp`, and `hasPlugins`). The task runner also rejects
every non-Claude Swarm task despite Codex IPC already carrying `scope`, `kind`,
and `scopeCwd`.

The remaining blockers are real integration gaps, not flags to flip:

1. The current TypeScript SDK invokes non-interactive `codex exec`. Its event
   stream has no request/response channel for interactive approvals, subagent
   control, command-menu discovery, or live reasoning deltas.
2. SAI's MCP and plugin screens read and mutate Claude-specific JSON files and
   the Claude plugin registry. Codex owns these settings in `config.toml` and
   its universal plugin system.
3. The SAI Swarm MCP bridge is emitted in Claude's MCP configuration format;
   Codex needs the same bridge registered through the Codex host protocol.

## Architecture

### Provider-neutral capability contract

Replace the boolean-only `ProviderCapabilities` gate with typed provider
adapters. Each adapter declares availability and supplies the operations needed
for its feature:

- session lifecycle and scoped working directories;
- model catalogue, effort, context, and reasoning presentation;
- permission profiles, approval requests and decisions;
- MCP server/configuration lifecycle and runtime status;
- plugins and skills marketplace/installed-state lifecycle;
- agent/subagent activity and control;
- Swarm worker and orchestrator launch.

The UI asks the adapter whether a feature is available for the current host,
then uses the shared UI. It must not assume Claude command names, JSON config
shape, or permission terms.

### Codex host transport

Use Codex App Server as the interactive transport for Desktop. Keep the SDK
backend as a compatibility fallback for basic chat only, with an explicit
capability report that disables unavailable interactive controls instead of
pretending they work.

The App Server adapter owns thread creation/resume, turn streaming,
configuration snapshots, cancellation, approvals, commands, compaction,
reasoning summaries, tool activity, and agent-thread events. Every event is
normalized into SAI's existing provider envelope with a workspace and scope.
Every approval decision is correlated to one active Codex thread and is not
auto-approved by SAI.

### Reasoning presentation

Codex supports `model_reasoning_summary` values `auto`, `concise`, `detailed`,
and `none`; App Server streams readable summary deltas. SAI's default is
`concise`, displayed through the existing reasoning transcript block while a
turn runs. Users may select Detailed or Off per session/workspace. Raw
reasoning is a separate advanced opt-in, remains unavailable when the active
model does not emit it, and is never required for parity.

The SDK fallback retains its existing completed reasoning-item mapping, but it
cannot promise token-by-token summary streaming.

### Security and approvals

Expose Codex-native permission profiles rather than mapping Claude's
`bypass/default/plan` modes literally. The baseline choices are read-only,
workspace write with on-request approval, untrusted-command approval, and
full access. Show network access separately from filesystem permission.

SAI renders App Server approval requests in the existing approval tray/panel,
retains their origin scope/task, and sends the selected decision back through
the App Server. Provider policy remains authoritative. Swarm tasks inherit the
parent's permission profile and cannot silently escalate it. Auto-review, MCP
tool policies, and organizational restrictions are reported as host policy,
not overridden by SAI.

### MCP

Build a Codex configuration service that reads merged, trusted Codex config
layers and manages the user-selected layer without overwriting unrelated TOML.
The shared MCP sidebar supports stdio and streamable HTTP, OAuth sign-in,
enabled/required state, timeouts, per-server tool allow/deny lists, and
per-tool approval mode when supplied by Codex. Runtime status comes from the
Codex host.

The existing SAI chat and Swarm MCP servers are exposed to Codex as ephemeral,
scope-bound host configuration. Their socket secret is never persisted in
`~/.codex/config.toml`, surfaced to Remote, or copied into worktrees.

### Plugins and skills

Replace the Claude-only plugin service with a provider-aware plugin catalogue.
For Codex it uses the universal plugin directory and installed marketplace
state, supports install/uninstall/enable state, and shows bundled skills and
MCP servers. Claude continues using its own plugin mechanism.

Skills are displayed and invoked with Codex's `$skill` convention. SAI does
not translate a Claude plugin bundle into a Codex plugin: unsupported bundles
are clearly labelled, and portable skills can be imported through Codex's
native import path.

### Agents and Swarm

Expose Codex's native subagent activity as a first-class thread/activity view,
including active/done state and source-thread association. Let Codex choose
its own native agents and custom agent definitions.

SAI Swarm remains a separate, worktree-oriented scheduler. Its generic task
runner gains a Codex implementation that starts `kind: task` sessions with the
task scope and worktree cwd. The orchestrator picker enables Codex only after
the Codex Swarm MCP bridge is verified. Worker approvals route through the
same provider-neutral approval contract. Pause/resume/stop always target the
task's session scope, not the active workspace root.

## Delivery order

1. **Capability foundation:** typed adapters, accurate availability reporting,
   scoped task dispatch, model discovery, and version-safe labels. This absorbs
   the existing Claude-model-discovery design without losing its requirements.
2. **Interactive Codex host:** App Server transport, session parity, reasoning
   summaries, compaction, command/menu support, and approval round trips.
3. **Security and MCP:** Codex permission profiles, host-policy status, TOML
   configuration service, OAuth, tool policies, and ephemeral SAI MCP bridge.
4. **Plugins, skills, and native agents:** universal marketplace, `$skill`
   invocation, plugin/skill/MCP status, and subagent activity.
5. **Swarm parity:** Codex workers, orchestrator, bridge tools, worktree
   lifecycle, task controls, and approvals.
6. **Surface parity and release:** Remote/mobile protocol capabilities,
   degraded-mode messaging, generated asset rebuilds, and end-to-end coverage.

Each phase is independently shippable. Later controls remain unavailable when
the installed Codex host cannot advertise the protocol they require.

## Verification

- Contract tests for capability detection and provider-neutral UI routing.
- Protocol fixtures for App Server events, reasoning deltas, tool/MCP events,
  approval requests/decisions, command updates, compaction, and subagents.
- Config tests that preserve unrelated TOML, retain secrets locally, and never
  persist SAI's ephemeral MCP credentials.
- Swarm tests covering Codex scope/cwd dispatch, pause/resume/stop routing,
  worktree isolation, and approval persistence/recovery.
- Desktop and Remote/mobile integration tests for feature availability,
  fallback behavior, model labels, and reasoning settings.
- Manual security checks for read-only/workspace/full-access boundaries,
  blocked network access, MCP tool policy, and approval denial.

## Acceptance criteria

On a current local Codex host, a user can choose a model and effort, see live
reasoning summaries, attach images, run and resume scoped chats, configure and
use MCP servers/plugins/skills, inspect delegated Codex agents, manage
approvals safely, and run Codex-backed Swarm tasks in isolated worktrees from
every supported SAI surface. A missing or older host produces an explicit,
safe degraded state rather than a hidden or nonfunctional control.
