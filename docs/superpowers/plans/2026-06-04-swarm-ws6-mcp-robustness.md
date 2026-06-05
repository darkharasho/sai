# Swarm WS6 — MCP Robustness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop malformed orchestrator tool input from crashing the dispatch path, give the MCP transport a per-call timeout so a silent host can't hang a call forever, and remove the dead synthetic-card helpers that inflate test coverage.

**Architecture:** Validate inputs in the already-tested pure `dispatchSwarmTool` (`src/lib/swarmOrchestratorDispatcher.ts`) and return the existing `{ ok: false, error }` shape instead of throwing. Add a bounded per-call timeout to the socket transport `call()` (`electron/swarm-mcp-server.ts`). Delete the three dead exports + their false-coverage tests.

**Tech Stack:** TypeScript, Electron main (`electron/swarm-mcp-server.ts`), Vitest (`--maxWorkers=2`). Spec: `docs/superpowers/specs/2026-06-03-swarm-hardening-design.md` (WS6, finding #9).

---

## Scope decision (read first)

The full finding #9 spans electron socket/IPC behavior I cannot exercise in a headless test run (main's `pendingMcpCalls` 60s timeout, per-socket call correlation, error frames to the originating socket, the synthetic-card session-registration race). Per the same judgment applied to the WS5 GC, this pass ships the **fully-testable, safe** parts and the **low-risk transport timeout**, and explicitly **defers** the main-process socket surgery to a follow-up verified against a running app.

**This pass:**
- Input validation in `dispatchSwarmTool` → structured errors (tested).
- Delete dead `buildSyntheticToolUseMessage`, `applySyntheticToolResult`, `routeOrchestratorToolUse` (+ whole `swarmOrchestratorRouter.ts`, whose `isSwarmTool` is also unused) and their tests.
- Per-call timeout in the transport `call()` (low-risk; no headless unit test — verified by reading + live follow-up).

**Deferred (needs live Electron verification):**
- `electron/main.ts` 60s timeout → `safeSendMcp`/error-frame to the originating socket; correlate `pendingMcpCalls` to their socket and reject on socket `close`.
- Synthetic tool-call card registration race (buffer-and-flush, or eager registration). Spec suggests extracting `main.ts`'s emit logic into a testable helper — do that in the follow-up.

Verified pre-conditions: the transport already rejects all pending calls on socket `close`/`error` (`electron/swarm-mcp-server.ts:232-236,292-305`), so the client side of "dropped socket leaves calls hung" is already handled. The three dead exports have **zero** live callers (only tests reference them).

---

## Task 1: Validate `dispatchSwarmTool` inputs → structured errors

**Files:**
- Modify: `src/lib/swarmOrchestratorDispatcher.ts:13-26`
- Test: `tests/swarm/swarmOrchestratorDispatcher.test.ts`

- [ ] **Step 1: Write the failing tests** (add inside `describe('dispatchSwarmTool')`):

```typescript
  it('spawn_tasks with missing prompts returns a structured error (no throw)', async () => {
    const host = { spawnTasks: vi.fn() } as any;
    const r: any = await dispatchSwarmTool('spawn_tasks', {}, host);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/prompts/);
    expect(host.spawnTasks).not.toHaveBeenCalled();
  });

  it('spawn_tasks with non-array prompts returns a structured error', async () => {
    const host = { spawnTasks: vi.fn() } as any;
    const r: any = await dispatchSwarmTool('spawn_tasks', { prompts: 'nope' }, host);
    expect(r.ok).toBe(false);
    expect(host.spawnTasks).not.toHaveBeenCalled();
  });

  it('pause_task without a taskRef returns a structured error', async () => {
    const host = { pause: vi.fn() } as any;
    const r: any = await dispatchSwarmTool('pause_task', {}, host);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/taskRef/);
    expect(host.pause).not.toHaveBeenCalled();
  });

  it('approve_tool_call without an approvalId returns a structured error', async () => {
    const host = { approve: vi.fn() } as any;
    const r: any = await dispatchSwarmTool('approve_tool_call', {}, host);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/approvalId/);
    expect(host.approve).not.toHaveBeenCalled();
  });

  it('handles null input without throwing', async () => {
    const host = {} as any;
    const r: any = await dispatchSwarmTool('spawn_tasks', null, host);
    expect(r.ok).toBe(false);
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/swarm/swarmOrchestratorDispatcher.test.ts --maxWorkers=2`
Expected: FAIL (current code throws `TypeError` on `input.prompts` iteration / undefined access).

- [ ] **Step 3: Implement validation** — replace `dispatchSwarmTool` (`src/lib/swarmOrchestratorDispatcher.ts:13-26`):

```typescript
export async function dispatchSwarmTool(name: string, input: any, host: SwarmHost) {
  const inp = input ?? {};
  const reqString = (field: string): string | null =>
    typeof inp[field] === 'string' && inp[field].length > 0 ? inp[field] : null;
  switch (name) {
    case 'spawn_task': {
      if (typeof inp.prompt !== 'string' || !inp.prompt) return { ok: false, error: 'spawn_task requires a non-empty "prompt" string' };
      return { ok: true, task: await host.spawnTask(inp) };
    }
    case 'spawn_tasks': {
      if (!Array.isArray(inp.prompts) || inp.prompts.length === 0) return { ok: false, error: 'spawn_tasks requires a non-empty "prompts" array' };
      const projects = inp.projects === undefined || Array.isArray(inp.projects) ? inp.projects : undefined;
      return { ok: true, tasks: await host.spawnTasks(inp.prompts, projects) };
    }
    case 'query_status':
      return { ok: true, snapshot: await host.snapshot(typeof inp.filter === 'string' ? inp.filter : undefined) };
    case 'pause_task': {
      const ref = reqString('taskRef'); if (!ref) return { ok: false, error: 'pause_task requires a "taskRef" string' };
      await host.pause(ref); return { ok: true };
    }
    case 'resume_task': {
      const ref = reqString('taskRef'); if (!ref) return { ok: false, error: 'resume_task requires a "taskRef" string' };
      await host.resume(ref); return { ok: true };
    }
    case 'approve_tool_call': {
      const id = reqString('approvalId'); if (!id) return { ok: false, error: 'approve_tool_call requires an "approvalId" string' };
      await host.approve(id); return { ok: true };
    }
    case 'deny_tool_call': {
      const id = reqString('approvalId'); if (!id) return { ok: false, error: 'deny_tool_call requires an "approvalId" string' };
      await host.deny(id); return { ok: true };
    }
    case 'land': {
      const ref = reqString('taskRef'); if (!ref) return { ok: false, error: 'land requires a "taskRef" string' };
      return await host.land(ref);
    }
    case 'discard': {
      const ref = reqString('taskRef'); if (!ref) return { ok: false, error: 'discard requires a "taskRef" string' };
      await host.discard(ref); return { ok: true };
    }
    default:
      return { ok: false, error: `unknown tool: ${name}` };
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/swarm/swarmOrchestratorDispatcher.test.ts --maxWorkers=2`
Expected: PASS (new + existing, minus the dead-code suites removed in Task 2).

- [ ] **Step 5: Commit**

```bash
git add src/lib/swarmOrchestratorDispatcher.ts tests/swarm/swarmOrchestratorDispatcher.test.ts
git commit -m "fix(swarm): validate orchestrator tool inputs; return structured errors not TypeErrors"
```

---

## Task 2: Delete dead synthetic-card helpers + false-coverage tests

**Files:**
- Modify: `src/lib/swarmOrchestratorDispatcher.ts` (remove `buildSyntheticToolUseMessage`, `applySyntheticToolResult`)
- Delete: `src/lib/swarmOrchestratorRouter.ts`, `tests/swarm/swarmOrchestratorRouter.test.ts`
- Modify: `tests/swarm/swarmOrchestratorDispatcher.test.ts` (drop the two dead `describe` blocks + imports)

- [ ] **Step 1: Remove the two dead functions** from `src/lib/swarmOrchestratorDispatcher.ts` — delete the `buildSyntheticToolUseMessage` block (lines 40-80) and the `applySyntheticToolResult` block (lines 82-112). Keep `SwarmToolRequest`, `SwarmToolResponder`, `handleSwarmToolRequest`.

- [ ] **Step 2: Delete the dead router + its test**

```bash
git rm src/lib/swarmOrchestratorRouter.ts tests/swarm/swarmOrchestratorRouter.test.ts
```

- [ ] **Step 3: Trim the dispatcher test** — in `tests/swarm/swarmOrchestratorDispatcher.test.ts` remove `buildSyntheticToolUseMessage` and `applySyntheticToolResult` from the import, and delete their two `describe(...)` blocks.

- [ ] **Step 4: Typecheck + run**

Run: `npx tsc --noEmit && npx vitest run tests/swarm --maxWorkers=2`
Expected: clean; all pass; no references to the deleted symbols remain (`grep -rn buildSyntheticToolUseMessage src tests` → empty).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore(swarm): delete dead synthetic-card helpers + their false-coverage tests"
```

---

## Task 3: Per-call timeout in the MCP transport `call()`

**Files:**
- Modify: `electron/swarm-mcp-server.ts:312-326`

> Low-risk: a call that never gets a `result`/`error` frame currently hangs forever. A timeout that deletes the pending entry and rejects strictly improves on hang-forever. No headless unit test (real `net` socket); verify in a live follow-up.

- [ ] **Step 1: Add a timeout constant** near the top of the transport factory (beside the other locals around `electron/swarm-mcp-server.ts:220-223`):

```typescript
  const CALL_TIMEOUT_MS = 120_000; // a call with no result/error frame this long is presumed wedged
```

- [ ] **Step 2: Wrap the pending entry with a timer** — replace `call()` (`electron/swarm-mcp-server.ts:312-326`):

```typescript
    call(tool: string, input: unknown): Promise<unknown> {
      if (closed) return Promise.reject(new Error('socket closed'));
      const id = crypto.randomBytes(8).toString('hex');
      return new Promise<unknown>((resolve, reject) => {
        const timer = setTimeout(() => {
          if (pending.delete(id)) reject(new Error(`tool call ${tool} timed out after ${CALL_TIMEOUT_MS}ms`));
        }, CALL_TIMEOUT_MS);
        const settle = {
          resolve: (v: unknown) => { clearTimeout(timer); resolve(v); },
          reject: (e: Error) => { clearTimeout(timer); reject(e); },
        };
        pending.set(id, settle);
        try {
          socket?.write(JSON.stringify({ type: 'call', id, tool, input }) + '\n');
        } catch (err) {
          clearTimeout(timer);
          pending.delete(id);
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      });
    },
```

(`handleFrame` and `rejectAllPending` already call `.resolve`/`.reject` on the pending entry, so they now clear the timer automatically.)

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add electron/swarm-mcp-server.ts
git commit -m "fix(swarm): per-call timeout in MCP transport so a silent host can't hang a call"
```

---

## Final verification

- [ ] **Full suite**: `npx vitest run --maxWorkers=2` → all pass (baseline after WS5: 1564 passed / 3 skipped; WS6 nets +5 validation tests, −~7 deleted dead-code tests).
- [ ] **Typecheck**: `npx tsc --noEmit` → clean.
- [ ] **No dead refs**: `grep -rn "buildSyntheticToolUseMessage\|applySyntheticToolResult\|routeOrchestratorToolUse\|swarmOrchestratorRouter" src electron tests` → empty.

---

## Self-review notes (spec coverage)

| Spec WS6 requirement | Status |
|---|---|
| Validate tool inputs in `dispatchSwarmTool` → structured errors | Task 1 ✅ |
| Delete dead `buildSyntheticToolUseMessage`/`applySyntheticToolResult`/`routeOrchestratorToolUse` + false-coverage tests | Task 2 ✅ |
| Per-call timeout in the MCP server transport `call()` | Task 3 ✅ (no headless test; live-verify) |
| Main 60s timeout emits an error frame to the originating socket | **Deferred — live Electron verification** |
| Correlate `pendingMcpCalls` to socket; reject on socket close | **Deferred** (client transport already rejects-all on close) |
| Synthetic-card registration race (buffer/flush or eager register); extract main.ts emit helper | **Deferred — live Electron verification** |
