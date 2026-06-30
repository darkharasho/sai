# Claude SDK Migration — Phase 0 (Adapter Seam) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce a `ClaudeBackend` adapter seam and a `claudeBackend: 'cli' | 'sdk'` flag, routing all Claude operations through a `CliBackend` that delegates to today's code — with zero behavior change.

**Architecture:** A new `electron/services/claudeBackend/` directory holds the interface (`types.ts`), the `CliBackend` implementation (`cliBackend.ts`, delegating to existing `claude.ts` exports), and a dispatcher (`index.ts`) that selects the active backend from a setting. `claude.ts` keeps `registerClaudeHandlers` (so existing test imports stay valid) but each IPC handler delegates to `getClaudeBackend().<op>()`. The import cycle `cliBackend.ts → claude.ts` and `claude.ts → claudeBackend/index.ts` is safe because every cross-module binding is used only at call time, never at module load.

**Tech Stack:** TypeScript (strict), Electron main process, Vitest (`--maxWorkers=2`).

## Global Constraints

- Vitest must run with limited parallelism: `npx vitest run <files> --maxWorkers=2`.
- Zero behavior change: every pre-existing claude test passes unchanged (`claudeBuildArgs`, `claude.test`, `ipc-streaming`, `ipc-approval`, `ipc-slash-commands`, `concurrent-chat-streams`, `claudeOrchestratorStart`, `gemini`).
- No changes to `electron/preload.ts`, the renderer, IPC channel names, argument order, or return shapes.
- The `claudeBackend` setting defaults to `'cli'`; the `'sdk'` value is reserved and falls back to `'cli'` with a logged warning (no SDK backend exists in Phase 0).
- `registerClaudeHandlers` and `destroyClaude` remain exported from `@electron/services/claude` (do not move them — tests import them there).
- Follow existing patterns in `claude.ts` (module-global `mainWin`, `getClaude`, `get`, `getOrCreate`, `emitChatMessage`).

---

### Task 1: Backend interface + flag reader

**Files:**
- Create: `electron/services/claudeBackend/types.ts`
- Create: `electron/services/claudeBackend/index.ts` (flag reader only this task)
- Test: `tests/unit/electron/claudeBackendDispatch.test.ts`

**Interfaces:**
- Produces: `ClaudeBackend` interface; arg types `StartArgs`, `SendArgs`, `CompactArgs`, `ApproveArgs`, `AnswerQuestionArgs`, `AnswerPlanArgs`; `getClaudeBackendSetting(): 'cli' | 'sdk'`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/electron/claudeBackendDispatch.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest';

const readSaiSetting = vi.fn();
vi.mock('@electron/services/claude', () => ({ readSaiSetting }));

import { getClaudeBackendSetting } from '@electron/services/claudeBackend';

afterEach(() => { readSaiSetting.mockReset(); });

describe('getClaudeBackendSetting', () => {
  it("defaults to 'cli' when unset", () => {
    readSaiSetting.mockReturnValue(undefined);
    expect(getClaudeBackendSetting()).toBe('cli');
  });
  it("returns 'sdk' when set to sdk", () => {
    readSaiSetting.mockReturnValue('sdk');
    expect(getClaudeBackendSetting()).toBe('sdk');
  });
  it("falls back to 'cli' for unknown values", () => {
    readSaiSetting.mockReturnValue('weird');
    expect(getClaudeBackendSetting()).toBe('cli');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/electron/claudeBackendDispatch.test.ts --maxWorkers=2`
Expected: FAIL — cannot resolve `@electron/services/claudeBackend` / `getClaudeBackendSetting` not exported. (Also requires `readSaiSetting` to be exported from `claude.ts` — done in Step 4.)

- [ ] **Step 3: Create the interface + arg types**

```ts
// electron/services/claudeBackend/types.ts
export interface StartArgs {
  projectPath: string;
  scope?: string;
  kind?: 'chat' | 'task' | 'orchestrator';
  orchestratorContext?: Record<string, unknown> | null;
  scopeCwd?: string;
  metaPreamble?: string;
}
export interface SendArgs {
  projectPath: string;
  message: string;
  imagePaths?: string[];
  permMode?: string;
  effort?: string;
  model?: string;
  scope?: string;
}
export interface CompactArgs {
  projectPath: string;
  permMode?: string;
  effort?: string;
  model?: string;
  scope?: string;
}
export interface ApproveArgs {
  projectPath: string;
  toolUseId: string;
  approved: boolean;
  modifiedCommand?: string;
  scope?: string;
}
export interface AnswerQuestionArgs {
  projectPath: string;
  toolUseId: string;
  answers: Record<string, string | string[]>;
  scope?: string;
}
export interface AnswerPlanArgs {
  projectPath: string;
  toolUseId: string;
  approved: boolean;
  scope?: string;
}

export interface ClaudeBackend {
  start(args: StartArgs): { slashCommands: string[] } | undefined;
  send(args: SendArgs): void;
  interrupt(projectPath: string, scope?: string): void;
  setSessionId(projectPath: string, sessionId: string | undefined, scope?: string): void;
  compact(args: CompactArgs): void;
  approve(args: ApproveArgs): Promise<boolean>;
  answerQuestion(args: AnswerQuestionArgs): Promise<boolean>;
  answerPlanReview(args: AnswerPlanArgs): Promise<boolean>;
  alwaysAllow(projectPath: string, toolPattern: string): Promise<boolean>;
  generateCommitMessage(cwd: string, provider?: string): Promise<string>;
  generateTitle(cwd: string, userMessage: string, provider?: string): Promise<string>;
  getModels(): { models: string[]; detected: boolean };
}
```

- [ ] **Step 4: Export `readSaiSetting` from claude.ts and add the flag reader**

In `electron/services/claude.ts`, change the declaration at line 132 from `function readSaiSetting(` to `export function readSaiSetting(`.

```ts
// electron/services/claudeBackend/index.ts
import { readSaiSetting } from '../claude';
export * from './types';

export function getClaudeBackendSetting(): 'cli' | 'sdk' {
  return readSaiSetting('claudeBackend') === 'sdk' ? 'sdk' : 'cli';
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/unit/electron/claudeBackendDispatch.test.ts --maxWorkers=2`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add electron/services/claudeBackend/types.ts electron/services/claudeBackend/index.ts electron/services/claude.ts tests/unit/electron/claudeBackendDispatch.test.ts
git commit -m "feat(claude): add ClaudeBackend interface + backend flag reader"
```

---

### Task 2: Extract inline IPC handler bodies into exported impls

The `start`, `compact`, `alwaysAllow`, `generateCommitMessage`, and `generateTitle` handler bodies currently live inline inside `registerClaudeHandlers` (claude.ts:1302-1524). `CliBackend` needs them as callable functions. Extract each verbatim into an exported impl; the handler then calls the impl. The existing IPC tests (`ipc-slash-commands`, `claude.test` commit/title cases) are the regression proof.

**Files:**
- Modify: `electron/services/claude.ts` (extract 5 functions; handlers call them)

**Interfaces:**
- Produces: `startImpl(args: StartArgs): { slashCommands: string[] } | undefined`, `compactImpl(args: CompactArgs): void`, `alwaysAllowImpl(projectPath: string, toolPattern: string): Promise<boolean>`, `generateCommitMessageImpl(cwd: string, aiProvider?: string): Promise<string>`, `generateTitleImpl(cwd: string, userMessage: string, aiProvider?: string): Promise<string>`.

- [ ] **Step 1: Extract `startImpl`**

Move the body of the `claude:start` handler (claude.ts:1311-1325) into a new exported function above `registerClaudeHandlers`. Use the module-global `mainWin` (already set by `registerClaudeHandlers`) wherever the handler used closure state; `startImpl` uses none of `win`. Replace the handler with a delegate:

```ts
export function startImpl(args: StartArgs): { slashCommands: string[] } | undefined {
  const { projectPath, scope, kind, orchestratorContext, scopeCwd, metaPreamble } = args;
  if (!projectPath) return;
  const ws = getOrCreate(projectPath);
  const claude = getClaude(ws, scope || 'chat', kind);
  claude.cwd = scopeCwd || projectPath;
  if (kind === 'orchestrator' && orchestratorContext) {
    claude.orchestratorContext = orchestratorContext as Record<string, unknown>;
  }
  claude.metaPreamble = metaPreamble || '';
  emitChatMessage({ type: 'ready', projectPath: ws.projectPath, scope: scope || 'chat' });
  return { slashCommands: readCachedSlashCommands() };
}
```

Handler becomes:
```ts
ipcMain.handle('claude:start', (_event, projectPath: string, scope?: string, kind?: 'chat' | 'task' | 'orchestrator', orchestratorContext?: Partial<OrchestratorPromptContext> | null, scopeCwd?: string, metaPreamble?: string) =>
  startImpl({ projectPath, scope, kind, orchestratorContext: orchestratorContext as Record<string, unknown> | null, scopeCwd, metaPreamble })
);
```

- [ ] **Step 2: Extract `compactImpl`**

Move the `claude:compact` handler body (claude.ts:1345-1357) into `compactImpl`, replacing the `win` argument to `ensureProcess` with the module-global `mainWin`:

```ts
export function compactImpl(args: CompactArgs): void {
  const { projectPath, permMode, effort, model, scope } = args;
  const ws = get(projectPath);
  if (!ws) return;
  const effectiveScope = scope || 'chat';
  const claude = getClaude(ws, effectiveScope);
  touchActivity(projectPath);
  const proc = ensureProcess(mainWin!, projectPath, effectiveScope, permMode, effort, model);
  claude.suppressForward = true;
  const msg = JSON.stringify({ type: 'user', message: { role: 'user', content: '/compact' } });
  if (proc.stdin && !proc.stdin.destroyed) {
    proc.stdin.write(msg + '\n');
  } else {
    claude.suppressForward = false;
  }
}
```

Handler becomes:
```ts
ipcMain.on('claude:compact', (_event, projectPath: string, permMode?: string, effort?: string, model?: string, scope?: string) =>
  compactImpl({ projectPath, permMode, effort, model, scope })
);
```

- [ ] **Step 3: Extract `alwaysAllowImpl`, `generateCommitMessageImpl`, `generateTitleImpl`**

For each remaining inline handler (`claude:alwaysAllow` at 1382-1397; `claude:generateCommitMessage` at 1401-1479; `claude:generateTitle` at 1483-1524): cut the handler's `async (_event, …) => { … }` body verbatim into an exported `async function <name>Impl(<sameParams>) { … }` above `registerClaudeHandlers`, then replace the handler with a one-line delegate. Do not alter the body logic. Example for the simplest:

```ts
export async function alwaysAllowImpl(projectPath: string, toolPattern: string): Promise<boolean> {
  const claudeDir = path.join(projectPath, '.claude');
  const settingsPath = path.join(claudeDir, 'settings.local.json');
  let settings: Record<string, any> = {};
  try { settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')); } catch { /* none yet */ }
  if (!settings.permissions) settings.permissions = {};
  if (!Array.isArray(settings.permissions.allow)) settings.permissions.allow = [];
  if (!settings.permissions.allow.includes(toolPattern)) settings.permissions.allow.push(toolPattern);
  try { fs.mkdirSync(claudeDir, { recursive: true }); } catch { /* exists */ }
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  return true;
}
ipcMain.handle('claude:alwaysAllow', (_event, projectPath: string, toolPattern: string) => alwaysAllowImpl(projectPath, toolPattern));
```

Apply the identical cut-and-delegate to `generateCommitMessageImpl(cwd: string, aiProvider?: string)` and `generateTitleImpl(cwd: string, userMessage: string, aiProvider?: string)`, moving their full existing bodies unchanged. Import `StartArgs`/`CompactArgs` types from `./claudeBackend/types` at the top of `claude.ts`.

- [ ] **Step 4: Run the regression suites**

Run: `npx vitest run tests/unit/services/claude.test.ts tests/integration/ipc-slash-commands.test.ts --maxWorkers=2`
Expected: PASS — unchanged counts (slash commands, commit-message, and title behaviors verified via the extracted impls).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add electron/services/claude.ts
git commit -m "refactor(claude): extract inline IPC handler bodies into exported impls"
```

---

### Task 3: CliBackend

**Files:**
- Create: `electron/services/claudeBackend/cliBackend.ts`
- Test: `tests/unit/electron/claudeBackendDispatch.test.ts` (extend)

**Interfaces:**
- Consumes: all `*Impl` exports from `claude.ts` (`sendImpl`, `interruptImpl`, `setSessionIdImpl`, `approveImpl`, `answerQuestionImpl`, `answerPlanReviewImpl`, `getAvailableClaudeModels`, plus Task 2's `startImpl`, `compactImpl`, `alwaysAllowImpl`, `generateCommitMessageImpl`, `generateTitleImpl`); `ClaudeBackend` + arg types from `./types`.
- Produces: `class CliBackend implements ClaudeBackend`.

- [ ] **Step 1: Write the failing test (extend the dispatch test file)**

```ts
// add to tests/unit/electron/claudeBackendDispatch.test.ts
import { CliBackend } from '@electron/services/claudeBackend/cliBackend';

const claudeImpls = vi.hoisted(() => ({ sendImpl: vi.fn() }));
// extend the existing vi.mock('@electron/services/claude') factory to also return sendImpl: claudeImpls.sendImpl

describe('CliBackend', () => {
  it('delegates send() to sendImpl with positional args', () => {
    const be = new CliBackend();
    be.send({ projectPath: '/p', message: 'hi', scope: 's' });
    expect(claudeImpls.sendImpl).toHaveBeenCalledWith('/p', 'hi', undefined, undefined, undefined, undefined, 's');
  });
});
```

(Update the single `vi.mock('@electron/services/claude', …)` factory at the top of the file to return BOTH `readSaiSetting` and `sendImpl: claudeImpls.sendImpl`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/electron/claudeBackendDispatch.test.ts --maxWorkers=2`
Expected: FAIL — `CliBackend` not found.

- [ ] **Step 3: Implement CliBackend**

```ts
// electron/services/claudeBackend/cliBackend.ts
import {
  startImpl, sendImpl, interruptImpl, setSessionIdImpl, compactImpl, approveImpl,
  answerQuestionImpl, answerPlanReviewImpl, alwaysAllowImpl,
  generateCommitMessageImpl, generateTitleImpl, getAvailableClaudeModels,
} from '../claude';
import type {
  ClaudeBackend, StartArgs, SendArgs, CompactArgs, ApproveArgs, AnswerQuestionArgs, AnswerPlanArgs,
} from './types';

export class CliBackend implements ClaudeBackend {
  start(a: StartArgs) { return startImpl(a); }
  send(a: SendArgs) { sendImpl(a.projectPath, a.message, a.imagePaths, a.permMode, a.effort, a.model, a.scope); }
  interrupt(projectPath: string, scope?: string) { interruptImpl(projectPath, scope); }
  setSessionId(projectPath: string, sessionId: string | undefined, scope?: string) { setSessionIdImpl(projectPath, sessionId, scope); }
  compact(a: CompactArgs) { compactImpl(a); }
  approve(a: ApproveArgs) { return approveImpl(a.projectPath, a.toolUseId, a.approved, a.modifiedCommand, a.scope); }
  answerQuestion(a: AnswerQuestionArgs) { return answerQuestionImpl(a.projectPath, a.toolUseId, a.answers, a.scope); }
  answerPlanReview(a: AnswerPlanArgs) { return answerPlanReviewImpl(a.projectPath, a.toolUseId, a.approved, a.scope); }
  alwaysAllow(projectPath: string, toolPattern: string) { return alwaysAllowImpl(projectPath, toolPattern); }
  generateCommitMessage(cwd: string, provider?: string) { return generateCommitMessageImpl(cwd, provider); }
  generateTitle(cwd: string, userMessage: string, provider?: string) { return generateTitleImpl(cwd, userMessage, provider); }
  getModels() { return getAvailableClaudeModels(); }
}
```

If `approveImpl`/`answerQuestionImpl`/`answerPlanReviewImpl` return non-Promise in some paths, wrap with `Promise.resolve(...)` to satisfy the interface — verify their actual return types with `npx tsc --noEmit` and adjust.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/electron/claudeBackendDispatch.test.ts --maxWorkers=2`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add electron/services/claudeBackend/cliBackend.ts tests/unit/electron/claudeBackendDispatch.test.ts
git commit -m "feat(claude): add CliBackend delegating to existing impls"
```

---

### Task 4: Dispatcher — getClaudeBackend() with a test seam

**Files:**
- Modify: `electron/services/claudeBackend/index.ts`
- Test: `tests/unit/electron/claudeBackendDispatch.test.ts` (extend)

**Interfaces:**
- Consumes: `getClaudeBackendSetting`, `CliBackend`.
- Produces: `getClaudeBackend(): ClaudeBackend`, `__setClaudeBackendForTests(b: ClaudeBackend | null): void`.

- [ ] **Step 1: Write the failing test**

```ts
import { getClaudeBackend, __setClaudeBackendForTests } from '@electron/services/claudeBackend';
import { CliBackend } from '@electron/services/claudeBackend/cliBackend';

describe('getClaudeBackend', () => {
  afterEach(() => __setClaudeBackendForTests(null));
  it('returns a CliBackend when flag is cli/absent', () => {
    readSaiSetting.mockReturnValue(undefined);
    expect(getClaudeBackend()).toBeInstanceOf(CliBackend);
  });
  it('falls back to CliBackend when flag is sdk (no SDK backend yet)', () => {
    readSaiSetting.mockReturnValue('sdk');
    expect(getClaudeBackend()).toBeInstanceOf(CliBackend);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/electron/claudeBackendDispatch.test.ts --maxWorkers=2`
Expected: FAIL — `getClaudeBackend` / `__setClaudeBackendForTests` not exported.

- [ ] **Step 3: Implement the dispatcher**

```ts
// append to electron/services/claudeBackend/index.ts
import { CliBackend } from './cliBackend';
import type { ClaudeBackend } from './types';

let active: ClaudeBackend | null = null;

export function getClaudeBackend(): ClaudeBackend {
  if (active) return active;
  const which = getClaudeBackendSetting();
  if (which === 'sdk') {
    // eslint-disable-next-line no-console
    console.warn('[claude] claudeBackend=sdk requested but SDK backend not implemented; using CLI');
  }
  active = new CliBackend();
  return active;
}

/** Test-only seam to inject a stub or reset the cached backend. */
export function __setClaudeBackendForTests(b: ClaudeBackend | null): void { active = b; }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/electron/claudeBackendDispatch.test.ts --maxWorkers=2`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/services/claudeBackend/index.ts tests/unit/electron/claudeBackendDispatch.test.ts
git commit -m "feat(claude): add getClaudeBackend dispatcher with cli default"
```

---

### Task 5: Route registerClaudeHandlers through the backend

**Files:**
- Modify: `electron/services/claude.ts` (handlers delegate to `getClaudeBackend()`)
- Test: `tests/unit/electron/claudeBackendDispatch.test.ts` (extend — assert IPC routes to backend)

**Interfaces:**
- Consumes: `getClaudeBackend` from `./claudeBackend`.

- [ ] **Step 1: Write the failing test (IPC routing)**

Model on `tests/integration/ipc-streaming.test.ts`'s ipcMain mock. Inject a stub backend via `__setClaudeBackendForTests`, register handlers, emit `claude:send`, and assert the stub's `send` ran:

```ts
it('claude:send IPC delegates to the active backend.send', async () => {
  const sent: any[] = [];
  const stub = { send: (a: any) => sent.push(a) } as any;
  __setClaudeBackendForTests(stub);
  // mockIpcMain pattern: register handlers with a fake win, then emit the channel
  // (reuse the harness from ipc-streaming.test.ts) and assert:
  expect(sent[0]).toEqual({ projectPath: '/p', message: 'hi', imagePaths: undefined, permMode: undefined, effort: undefined, model: undefined, scope: 's' });
});
```

(Use the existing `vi.hoisted` ipcMain mock + `registerClaudeHandlers(win)` setup from `ipc-streaming.test.ts`; emit with `mockIpcMain._emit('claude:send', '/p', 'hi', undefined, undefined, undefined, undefined, 's')`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/electron/claudeBackendDispatch.test.ts --maxWorkers=2`
Expected: FAIL — handler still calls `sendImpl` directly, stub.send not invoked.

- [ ] **Step 3: Rewire the handlers**

In `claude.ts`, add `import { getClaudeBackend } from './claudeBackend';` at the top. Replace each `claude:*` handler body to delegate. The send handler becomes:

```ts
ipcMain.on('claude:send', (_event, projectPath: string, message: string, imagePaths?: string[], permMode?: string, effort?: string, model?: string, scope?: string) =>
  getClaudeBackend().send({ projectPath, message, imagePaths, permMode, effort, model, scope })
);
```

Apply the same delegation to `claude:start`, `claude:stop` (→ `interrupt`), `claude:setSessionId`, `claude:compact`, `claude:approve`, `claude:answer-question`, `claude:answer-plan-review`, `claude:alwaysAllow`, `claude:generateCommitMessage`, `claude:generateTitle`, and `claude:models` (→ `getModels()`), each mapping the positional IPC args into the backend method's arg shape. Leave `mainWin = win` and the idle-sweep timer setup in `registerClaudeHandlers` unchanged (CLI runtime state).

- [ ] **Step 4: Run the focused + regression suites**

Run: `npx vitest run tests/unit/electron/claudeBackendDispatch.test.ts tests/integration/ipc-streaming.test.ts tests/integration/ipc-approval.test.ts tests/integration/ipc-slash-commands.test.ts tests/integration/concurrent-chat-streams.test.ts tests/unit/services/claude.test.ts --maxWorkers=2`
Expected: PASS — routing test green AND all existing IPC tests unchanged (they exercise the same behavior through the backend now).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add electron/services/claude.ts tests/unit/electron/claudeBackendDispatch.test.ts
git commit -m "refactor(claude): route IPC handlers through getClaudeBackend()"
```

---

### Task 6: Route main.ts direct callers through the backend + full verification

**Files:**
- Modify: `electron/main.ts:61` (import) and `electron/main.ts:231-246` (remote-bridge calls)

**Interfaces:**
- Consumes: `getClaudeBackend` from `./services/claudeBackend`.

- [ ] **Step 1: Update the import and remote-bridge calls**

At `electron/main.ts:61`, add `getClaudeBackend` to the import from `./services/claudeBackend` (keep `registerClaudeHandlers`, `destroyClaude`, and the others importing from `./services/claude` as today). Then replace the remote-bridge direct impl calls (lines 231-246) so the flag governs them too:

```ts
// was: setSessionIdImpl(args.projectPath, args.sessionId, args.scope);
getClaudeBackend().setSessionId(args.projectPath, args.sessionId, args.scope);
// was: sendImpl(args.projectPath, args.message, …);
getClaudeBackend().send({ projectPath: args.projectPath, message: args.message, imagePaths: args.imagePaths, permMode: args.permMode, effort: args.effort, model: args.model, scope: args.scope });
// was: approveImpl(...);
await getClaudeBackend().approve({ projectPath: args.projectPath, toolUseId: args.toolUseId, approved: args.decision === 'approve', modifiedCommand: args.modifiedCommand, scope: args.scope });
// was: answerQuestionImpl(...);
await getClaudeBackend().answerQuestion({ projectPath: args.projectPath, toolUseId: args.toolUseId, answers: args.answers, scope: args.scope });
// interruptTurn:
interruptTurn: (path, scope) => getClaudeBackend().interrupt(path, scope),
```

Match the exact `sendImpl(...)` argument list at main.ts:233 when mapping to `send({...})`. Remove now-unused direct impl imports (`sendImpl`, `setSessionIdImpl`, `approveImpl`, `interruptImpl`, `answerQuestionImpl`) from the line-61 import if nothing else uses them; keep `setRemoteCeiling`, `setRemoteBus`, `setSubprocessMemoryCapMB`.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: exit 0 (catches any leftover unused import or arg-shape mismatch).

- [ ] **Step 3: Run the full test suite**

Run: `npm test`
Expected: PASS — same totals as before the migration plus the new dispatch tests; 0 failures.

- [ ] **Step 4: Commit**

```bash
git add electron/main.ts
git commit -m "refactor(main): route remote-bridge Claude calls through getClaudeBackend()"
```

---

## Self-Review

**Spec coverage:**
- Directory split (`backend.ts`/`cliBackend.ts`/`index.ts`) → Tasks 1, 3, 4. (Interface file is named `types.ts`; functionally identical to the spec's `backend.ts`.)
- `ClaudeBackend` interface covering every `claude:*` op → Task 1 (interface) + Task 5 (all handlers delegate) + Task 1's `getModels`/start/etc.
- Thin `CliBackend` delegating to existing code → Tasks 2 (extract impls) + 3 (delegate).
- `claudeBackend` flag default `'cli'`, `'sdk'` reserved/fallback → Tasks 1 + 4.
- `getClaudeBackend()` accessor so the flag governs every entry point → Tasks 4 + 5 (IPC) + 6 (remote bridge).
- Outbound events unchanged → no task touches `emitChatMessage`; CliBackend delegates to functions that emit as before.
- Zero behavior change proof → existing suites rerun in Tasks 2, 5, 6.
- New dispatcher test → Tasks 1/3/4/5.

**Deviation from spec (intentional):** the seam dir is `electron/services/claudeBackend/` (not `claude/`) to avoid the `claude.ts` file-vs-directory module-resolution shadow and the circular re-export it would force; `registerClaudeHandlers`/`destroyClaude` stay exported from `claude.ts` (delegating to the backend) so the 6 test files importing them need no changes. Relocating `claude.ts` into the seam dir is deferred to a later phase.

**Placeholder scan:** none — every code step shows concrete code; the three large one-shot bodies (commit/title) are explicit "move verbatim, do not alter" refactors covered by existing tests.

**Type consistency:** arg-bag types (`SendArgs` etc.) defined in Task 1 are consumed unchanged in Tasks 3, 5, 6; `getClaudeBackend`/`__setClaudeBackendForTests`/`getClaudeBackendSetting` names are consistent across Tasks 1, 4, 5.
