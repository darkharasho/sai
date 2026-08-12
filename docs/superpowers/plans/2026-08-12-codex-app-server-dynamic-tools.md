# Codex App Server Dynamic Tools and Swarm Bridge Plan

> **Execution:** use the established subagent-driven workflow: implementation, spec review, and quality review per task.

**Goal:** Add an explicitly experimental, scope-bound Dynamic Tool bridge so an App Server Codex orchestrator can invoke only SAI's approved Swarm tool surface and receive correlated results, without exposing a generic renderer-controlled execution channel.

**Architecture:** Negotiate the documented `experimentalApi` capability only when a Codex App Server thread is launched in `orchestrator` mode with an internally generated, fixed Dynamic Tool catalogue.  The App Server backend claims `item/tool/call` only when it belongs to that thread/turn and calls a main-process-owned dispatcher.  The dispatcher validates tool name and input against the existing Swarm tool taxonomy, routes strictly to the workspace/scope that owns the orchestrator, and returns bounded content items or a typed error.  Normal chat/task threads never receive Dynamic Tools, and any unclaimed/malformed/late request fails closed.

**Security boundary:** Dynamic Tool definitions are created by SAI, never supplied by the renderer or remote wire.  The bridge has no shell/filesystem/network primitive and no raw socket secret.  It uses the existing Swarm permission/approval path for consequential task actions.  The App Server request and response remain headerless JSONL and are single-use/correlated.

## Task 1: Negotiate and define the fixed orchestrator tool catalogue

**Files:**
- Modify `electron/services/codexBackend/appServerClient.ts`
- Modify `electron/services/codexBackend/appServerBackend.ts`
- Modify `electron/services/codexBackend/types.ts`
- Add/update focused client/backend tests

1. Add a narrowly named experimental capability option to the App Server client; default chat/task clients retain the current conservative capability set.
2. Define a serializable Dynamic Tool catalogue from the existing SAI Swarm tool taxonomy.  Tool names, descriptions, and JSON schemas are static/validated and reject reserved/unknown names.
3. Include `capabilities.experimentalApi: true` only for the isolated orchestrator App Server instance, and include `dynamicTools` only in that mode's `thread/start` request.  Resumed orchestrator threads retain the same fixed tool definitions.
4. Detect an unavailable/older host response and report a scoped, actionable orchestrator-unavailable reason—never silently start a Codex orchestrator without its Swarm tools.
5. Test initialization, `thread/start` payloads, normal-chat absence, resume behavior, and compatibility failure.

**Commit:** `feat(codex): configure App Server Swarm tools`

## Task 2: Execute and respond to scoped Dynamic Tool requests

**Files:**
- Modify `electron/services/codexBackend/appServerBackend.ts`
- Create `electron/services/codexBackend/dynamicToolBridge.ts`
- Modify/add focused backend/bridge tests

1. Claim `item/tool/call` only for an active orchestrator thread and matching active turn.  Reject all other requests with a protocol-valid error response and no renderer event.
2. Validate tool identifier and JSON input against the fixed catalogue.  Enforce bounded payload depth/size and reject unknown keys where the schema is closed.
3. Adapt the existing Swarm orchestrator dispatcher behind a main-process bridge, preserving workspace ownership and existing approval routing.  Do not import renderer state or expose a raw responder to the renderer.
4. Normalize successful tool output into App Server content items and bounded textual/structured error results.  Retire the pending call on response, `serverRequest/resolved`, turn lifecycle cleanup, and App Server failure; late completion never writes.
5. Map Dynamic Tool item start/complete to the existing Swarm/tool activity cards without duplicate synthetic cards.
6. Test success, dispatcher error, stale thread/turn, malformed input, duplicate response, workspace mismatch, stop during execution, and no secret leakage.

**Commit:** `feat(codex): bridge App Server Swarm tools`

## Task 3: Enable Codex orchestrator only when the bridge is available

**Files:**
- Modify the existing Swarm provider capability/settings owners
- Modify `src/lib/swarmTaskRunner.ts` / orchestrator launch owner as needed
- Add focused capability/launch tests

1. Replace the current unconditional Codex-orchestrator disabled message with runtime bridge capability status.  SDK Codex remains unavailable for orchestration; App Server is offered only when negotiation and tool catalogue setup succeed.
2. Launch orchestrator sessions with `kind: 'orchestrator'`, a dedicated scope, and the originating workspace cwd.  Workers remain ordinary scoped Codex task sessions.
3. Preserve worktree isolation, scoped stop/pause routing, and existing Swarm approval policy inheritance.  A bridge startup failure leaves the picker disabled with its precise reason.
4. Test capability labels, enabled App Server launch, SDK/old-host disabled state, scope/cwd routing, and no effect on Claude orchestration.

**Commit:** `feat(swarm): enable Codex App Server orchestrator`

## Task 4: Verify and document

1. Run focused client/backend/Swarm/capability tests, TypeScript, production build, and diff checks; distinguish inherited diagnostics from changed paths.
2. Audit the dynamic tool catalogue, request input validation, workspace/scope routing, response serialization, and approvals—especially that no generic host execution or secret crosses into Codex/Remote.
3. Record exact verification results and remaining work: Codex config/MCP management, plugins/skills management, Remote/mobile interactive actions, image input, and Swarm approval persistence/recovery.

**Commit:** `docs: verify Codex App Server Swarm bridge`
