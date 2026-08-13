# Codex Parity Completion Design

**Date:** 2026-08-13  
**Status:** Approved for autonomous implementation

## Goal

Close the remaining user-facing Codex gaps without regressing Claude, Gemini, or Kimi behavior. Work is delivered in independently tested phases so a safe, working baseline remains after every phase.

## Scope and delivery order

1. **Command lifecycle reliability.** Codex command cards must receive progress where the SDK provides it and always settle on terminal command events, including empty output and failures.
2. **Scoped execution.** Codex becomes eligible for terminal and concurrent scoped sessions using the existing scoped SDK registry; capability flags reflect the verified support.
3. **Swarm execution.** Codex becomes eligible for orchestrator and task workers only after the scoped lifecycle tests prove isolation and teardown safety.
4. **MCP surface.** Codex MCP is visible when its runtime/config integration is available; the UI distinguishes unavailable runtime state from disabled configuration and never exposes secrets.
5. **Interaction and final audit.** App-server-specific approvals, questions, plan review, compaction and richer telemetry are capability-gated. Plugins/skills use explicit guidance until a supported Codex management API exists. Desktop and remote semantics are audited together.

## Architecture

The Electron Codex adapter remains the sole provider boundary. It emits the existing renderer-compatible envelopes, but carries explicit lifecycle state (`partial` and terminal result) rather than relying on output truthiness. The renderer preserves an item’s accumulated output while it is live and settles only on a terminal event.

Existing scoped runtime identity (`projectPath`, `scope`, `turnSeq`, item id) remains authoritative. Every new capability is enabled only after the corresponding backend entry point and regression tests exist. Renderer capability flags are a reflection of actual support, not a promise of future support.

## Error handling and safety

- A terminal command event always emits a result, including an empty output string.
- Progress events are ignored after a card has settled; late events cannot reopen it.
- Unsupported backend operations remain hidden or show an explanatory recovery path; no inert controls are shown.
- MCP configuration and status continue through the existing secret-safe host API.
- Every scope-specific operation is tested to ensure it cannot interrupt or clear another scope.

## Testing

- Mapper tests cover command start, progress, completed, failed, and empty-output terminal states.
- Renderer tests cover live-to-settled cards and stale progress rejection.
- Backend tests cover terminal and multi-scope isolation before their capability flags are enabled.
- Swarm and MCP tests cover capability gating and the live integration paths.
- Every phase runs its targeted suites, then the relevant broader suite; the program ends with the unit suite, production build, and a clean diff check.
