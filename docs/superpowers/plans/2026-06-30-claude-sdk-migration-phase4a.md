# Claude SDK Migration — Phase 4a Implementation Plan (daily-chat parity gaps in SDK mode)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the chat/task-scope parity gaps in `SdkBackend` so SDK mode is solid for daily single-agent use: image forwarding, `/compact` activity, slash-commands cache, idle scope sweep, user `mcpConfigPath` passthrough, `settingSources` control, and remote-origin permission clamp.

**Architecture:** Each gap is a focused change to `SdkBackend` (`send`/`start`/`compact`/`_createSession`/drain) or `sdkOptions.ts`, reusing existing shared helpers (`sweepIdleScopes`, `clamp`, the slash-cache + `remoteCeiling` getters) — exported from their current homes so both backends share one implementation. No renderer/IPC/`types.ts` changes. `'cli'` mode untouched; the `claudeBackend` flag still defaults `cli` and `CliBackend` is retained.

**Tech Stack:** TypeScript, Electron main, `@anthropic-ai/claude-agent-sdk@0.3.196`, Vitest.

## Global Constraints

- Run vitest with `npx vitest run <path> --maxWorkers=2`. Respect any project `vitest.config` worker cap ≤2.
- Commit messages end with the trailer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- `'cli'` mode behavior MUST remain unchanged. Shared helpers are exported (not moved/rewritten) so existing CLI tests stay green.
- Do NOT flip the `claudeBackend` default (`cli`) and do NOT delete `CliBackend`.
- Image forwarding MUST be byte-identical to the CLI: refs are `[Attached image: <path>]`, one per line, joined with `\n`, then `\n\n` before the message.
- Symlinked home: `/home/mstephens` ↔ `/var/home/mstephens` — never compare paths by string equality.
- SDK `Options` facts (from `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`): `settingSources?: ('user'|'project'|'local')[]`; `mcpServers?: Record<string, McpServerConfig>`; `permissionMode` values include `'default'|'acceptEdits'|'bypassPermissions'|'plan'`; there is NO `strictMcpConfig` field.

---

## File Structure

- `electron/services/claudeBackend/sdkBackend.ts` — **modified.** `send` (images, origin clamp, `lastActivityAt`), `start` (slash cache), `compact` (`streaming_start`), drain (slash-commands capture, `lastActivityAt`, `awaitingInput` tracking), new idle-sweep timer, `mcpConfigPath` merge in `_createSession`, `ScopeSession` gains `lastActivityAt` + `awaitingInput`.
- `electron/services/claudeBackend/sdkOptions.ts` — **modified.** `settingSources` field; remote `PermMode` → `permissionMode` mapping.
- `electron/services/claude.ts` — **modified.** Export `getRemoteCeiling()`, `readCachedSlashCommands()`, `writeCachedSlashCommands()` (currently private) so `SdkBackend` shares them — no logic change.
- `electron/services/claudeBackend/userMcpConfig.ts` — **new.** Pure `parseUserMcpConfigPaths(setting, readFile)` → `Record<string, McpServerConfig>` from `mcpConfigPath`.
- Tests: `tests/unit/electron/sdkBackend.test.ts` (extend), `tests/unit/electron/sdkOptions.test.ts` (extend), `tests/unit/electron/userMcpConfig.test.ts` (new).

---

## Task 1: Image forwarding in SdkBackend.send

**Files:**
- Modify: `electron/services/claudeBackend/sdkBackend.ts` (`send`, ~line 139)
- Test: `tests/unit/electron/sdkBackend.test.ts`

**Interfaces:**
- Consumes: `SendArgs.imagePaths?: string[]` (already on the type).
- Produces: the user message pushed into the input channel carries the CLI-identical image refs prepended to `message`.

- [ ] **Step 1: Write the failing test** (mirror the existing harness — `makeFakeQuery`, `queryFn` capturing, `emits`, `PROJECT`/`SCOPE`)

```typescript
  it('(19) send forwards imagePaths as CLI-identical [Attached image: ...] refs', async () => {
    const pushed: any[] = [];
    const fakeQuery = makeFakeQuery([], { hang: true });
    // Wrap pushInput by capturing via a queryFn that lets the session push; simplest:
    // assert through the input channel by spying on the SDKUserMessage content.
    const queryFn = vi.fn((args: { prompt: any; options: any }) => {
      // Drain the async-iterable prompt to capture pushed user messages.
      (async () => { for await (const m of args.prompt) pushed.push(m); })();
      return fakeQuery;
    });
    const backend = new SdkBackend({ queryFn, emit: (p) => emits.push(p), resolveClaudePath: () => undefined });
    backend.start({ projectPath: PROJECT, scope: SCOPE, scopeCwd: PROJECT, kind: 'chat' });
    backend.send({ projectPath: PROJECT, message: 'look', scope: SCOPE, permMode: 'default', imagePaths: ['/tmp/a.png', '/tmp/b.png'] });
    await new Promise<void>((r) => setTimeout(r, 20));

    const userMsg = pushed.find((m) => m?.type === 'user');
    expect(userMsg?.message?.content).toBe('[Attached image: /tmp/a.png]\n[Attached image: /tmp/b.png]\n\nlook');
    fakeQuery.close();
  });
```

Note: confirm the input channel (`pushInput`) feeds the `prompt` async-iterable passed to `queryFn` — the existing `_createSession` builds an input iterable consumed by the query; draining `args.prompt` in the mock observes pushed messages. If the existing harness exposes pushed input differently, mirror whatever tests (1)-(18) use to inspect a sent message; the assertion (the exact prepended string) is the point.

- [ ] **Step 2: Run test — verify it FAILS**

Run: `npx vitest run tests/unit/electron/sdkBackend.test.ts -t "(19)" --maxWorkers=2`
Expected: FAIL — content is `'look'` (imagePaths dropped).

- [ ] **Step 3: Implement**

In `send`, change the destructure and the push. Current:

```typescript
    const { projectPath, message, scope, permMode, effort, model } = args;
```
→
```typescript
    const { projectPath, message, scope, permMode, effort, model, imagePaths } = args;
```

And where it builds the user message content (the `session.pushInput({ type: 'user', message: { role: 'user', content: message }, ... })` call), compute the prompt first:

```typescript
    // Mirror CliBackend.sendImpl: prepend image refs the model can resolve.
    let content = message;
    if (imagePaths && imagePaths.length > 0) {
      const imageRefs = imagePaths.map((p) => `[Attached image: ${p}]`).join('\n');
      content = `${imageRefs}\n\n${message}`;
    }
    session.pushInput({
      type: 'user',
      message: { role: 'user', content },
      parent_tool_use_id: null,
    });
```

- [ ] **Step 4: Run test — verify it PASSES**

Run: `npx vitest run tests/unit/electron/sdkBackend.test.ts -t "(19)" --maxWorkers=2`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/services/claudeBackend/sdkBackend.ts tests/unit/electron/sdkBackend.test.ts
git commit -m "feat(sdk): forward imagePaths as CLI-identical refs in SdkBackend.send

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: /compact emits streaming_start

**Files:**
- Modify: `electron/services/claudeBackend/sdkBackend.ts` (`compact`, ~line 212)
- Test: `tests/unit/electron/sdkBackend.test.ts`

**Interfaces:**
- Produces: `compact()` emits a `streaming_start` (so the UI shows the Stop button + thinking animation during compaction) before pushing `/compact`.

- [ ] **Step 1: Write the failing test**

```typescript
  it('(20) compact emits streaming_start and pushes /compact', async () => {
    const pushed: any[] = [];
    const fakeQuery = makeFakeQuery([], { hang: true });
    const queryFn = vi.fn((args: { prompt: any; options: any }) => {
      (async () => { for await (const m of args.prompt) pushed.push(m); })();
      return fakeQuery;
    });
    const backend = new SdkBackend({ queryFn, emit: (p) => emits.push(p), resolveClaudePath: () => undefined });
    backend.start({ projectPath: PROJECT, scope: SCOPE, scopeCwd: PROJECT, kind: 'chat' });
    backend.send({ projectPath: PROJECT, message: 'hi', scope: SCOPE, permMode: 'default' });
    await new Promise<void>((r) => setTimeout(r, 10));
    emits.length = 0; pushed.length = 0;
    backend.compact({ projectPath: PROJECT, scope: SCOPE });
    await new Promise<void>((r) => setTimeout(r, 10));

    expect(emits.find((e) => e.type === 'streaming_start')).toBeTruthy();
    expect(pushed.find((m) => m?.message?.content === '/compact')).toBeTruthy();
    fakeQuery.close();
  });
```

- [ ] **Step 2: Run test — verify it FAILS**

Run: `npx vitest run tests/unit/electron/sdkBackend.test.ts -t "(20)" --maxWorkers=2`
Expected: FAIL — no `streaming_start` emitted by `compact`.

- [ ] **Step 3: Implement**

Replace the body of `compact` (keep the `/compact` push; add the bump + emit, mirroring `send`):

```typescript
  compact(args: CompactArgs): void {
    const { projectPath, scope } = args;
    const session = this.sessions.get(toScopeKey(projectPath, scope));
    if (!session) return;
    session.turnSeq += 1;
    session.activeTurnSeq = session.turnSeq;
    session.mapperState = { ...session.mapperState, streaming: true };
    session.lastActivityAt = Date.now();
    this._emit({ type: 'streaming_start', projectPath, scope: scope ?? 'chat', turnSeq: session.turnSeq });
    session.pushInput({
      type: 'user',
      message: { role: 'user', content: '/compact' },
      parent_tool_use_id: null,
    });
  }
```

(If `lastActivityAt` doesn't exist on `ScopeSession` yet — it's added in Task 4 — omit that line here and re-add it in Task 4, or do Task 4 first. The sequence assumes Tasks run in order; `lastActivityAt` is safe to reference only after Task 4. To keep Task 2 independent, OMIT the `session.lastActivityAt = ...` line in this task and rely on Task 4 to set it in `compact` too.)

So for THIS task, the implementation omits the `lastActivityAt` line:

```typescript
    session.mapperState = { ...session.mapperState, streaming: true };
    this._emit({ type: 'streaming_start', projectPath, scope: scope ?? 'chat', turnSeq: session.turnSeq });
```

- [ ] **Step 4: Run test — verify it PASSES**

Run: `npx vitest run tests/unit/electron/sdkBackend.test.ts -t "(20)" --maxWorkers=2`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/services/claudeBackend/sdkBackend.ts tests/unit/electron/sdkBackend.test.ts
git commit -m "feat(sdk): /compact emits streaming_start so the UI shows activity

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

(Real compaction behavior — that pushing `/compact` actually compacts — is confirmed in the Task 8 dogfood; this task only restores the UI activity signal.)

---

## Task 3: Slash-commands cache (start() returns cache; drain captures init)

**Files:**
- Modify: `electron/services/claude.ts` (export `readCachedSlashCommands`, `writeCachedSlashCommands`)
- Modify: `electron/services/claudeBackend/sdkBackend.ts` (`start`, drain)
- Test: `tests/unit/electron/sdkBackend.test.ts`

**Interfaces:**
- Consumes: `readCachedSlashCommands(): string[]`, `writeCachedSlashCommands(commands: string[]): void` (now exported from claude.ts).
- Produces: `start()` returns `{ slashCommands: readCachedSlashCommands() }`; the drain writes `slash_commands` from the SDK `system`/`init` message to the cache.

- [ ] **Step 1: Export the cache helpers in claude.ts**

Change `function readCachedSlashCommands()` → `export function readCachedSlashCommands()` and `function writeCachedSlashCommands(...)` → `export function writeCachedSlashCommands(...)` (claude.ts ~lines 51, 59). No body changes.

- [ ] **Step 2: Add the mock + write the failing test**

The sdkBackend test already mocks `../../../electron/services/claude`. Add the two helpers to that mock's `vi.hoisted` bag and the `vi.mock` factory:

```typescript
  // in vi.hoisted({...}):
  mockReadCachedSlashCommands: vi.fn().mockReturnValue(['/foo', '/bar']),
  mockWriteCachedSlashCommands: vi.fn(),
  // in vi.mock factory object:
  readCachedSlashCommands: mockReadCachedSlashCommands,
  writeCachedSlashCommands: mockWriteCachedSlashCommands,
```

Test:

```typescript
  it('(21) start returns cached slash commands; drain caches slash_commands from system/init', async () => {
    mockReadCachedSlashCommands.mockReturnValue(['/clear', '/compact']);
    const initMsg = { type: 'system', subtype: 'init', slash_commands: ['/clear', '/compact', '/new'], session_id: 's1' };
    const fakeQuery = makeFakeQuery([initMsg], { hang: true });
    const queryFn = vi.fn(() => fakeQuery);
    const backend = new SdkBackend({ queryFn, emit: (p) => emits.push(p), resolveClaudePath: () => undefined });
    const ret = backend.start({ projectPath: PROJECT, scope: SCOPE, scopeCwd: PROJECT, kind: 'chat' });
    expect(ret).toEqual({ slashCommands: ['/clear', '/compact'] });

    backend.send({ projectPath: PROJECT, message: 'hi', scope: SCOPE, permMode: 'default' });
    await new Promise<void>((r) => setTimeout(r, 20));
    expect(mockWriteCachedSlashCommands).toHaveBeenCalledWith(['/clear', '/compact', '/new']);
    fakeQuery.close();
  });
```

- [ ] **Step 3: Run test — verify it FAILS**

Run: `npx vitest run tests/unit/electron/sdkBackend.test.ts -t "(21)" --maxWorkers=2`
Expected: FAIL — `start` returns `{ slashCommands: [] }`; `writeCachedSlashCommands` never called.

- [ ] **Step 4: Implement**

Add the import in sdkBackend.ts (alongside the existing claude.ts imports):

```typescript
import { readCachedSlashCommands, writeCachedSlashCommands } from '../claude';
```

`start` returns the cache:

```typescript
    return { slashCommands: readCachedSlashCommands() };
```

In the drain loop, before/around the existing message handling, capture init:

```typescript
        if (m?.type === 'system' && m?.subtype === 'init' && Array.isArray(m?.slash_commands)) {
          writeCachedSlashCommands(m.slash_commands as string[]);
        }
```

(Place it inside the `for await (const m of session.query)` loop, before the emits forwarding; it does not change forwarding.)

- [ ] **Step 5: Run test — verify it PASSES**

Run: `npx vitest run tests/unit/electron/sdkBackend.test.ts -t "(21)" --maxWorkers=2`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add electron/services/claude.ts electron/services/claudeBackend/sdkBackend.ts tests/unit/electron/sdkBackend.test.ts
git commit -m "feat(sdk): slash-commands cache — start() returns cache, drain captures system/init

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: SDK-side idle scope sweep

**Files:**
- Modify: `electron/services/claudeBackend/sdkBackend.ts` (`ScopeSession` type, `send`, `compact`, drain, the canUseTool/question/plan emit points, `approve`/`answerQuestion`/`answerPlanReview`, constructor, `destroy`, new `_startIdleSweep`)
- Test: `tests/unit/electron/sdkBackend.test.ts`

**Interfaces:**
- Consumes: `sweepIdleScopes`, `IDLE_SCOPE_MS`, `SWEEP_INTERVAL_MS` from `../../idleScopeSweep`.
- Produces: per-session `lastActivityAt: number` and `awaitingInput: boolean`; a sweep that calls `interrupt` + emits `scope_suspended` for scopes idle > 30 min that are not streaming and not awaiting input. A testable `_sweepOnce(now: number)` method that does one sweep pass (so tests drive it with a fake clock — no real timers).

- [ ] **Step 1: Write the failing test**

```typescript
  it('(22) _sweepOnce suspends an idle non-streaming scope and skips streaming/awaiting ones', async () => {
    const fakeQuery = makeFakeQuery([], { hang: true });
    const queryFn = vi.fn(() => fakeQuery);
    const backend = new SdkBackend({ queryFn, emit: (p) => emits.push(p), resolveClaudePath: () => undefined });
    backend.start({ projectPath: PROJECT, scope: SCOPE, scopeCwd: PROJECT, kind: 'chat' });
    backend.send({ projectPath: PROJECT, message: 'hi', scope: SCOPE, permMode: 'default' });
    await new Promise<void>((r) => setTimeout(r, 10));

    // Force the session idle and not streaming.
    const key = `${PROJECT}::${SCOPE}`; // matches toScopeKey
    const session: any = (backend as any).sessions.get(key);
    session.lastActivityAt = 1000;
    session.mapperState.streaming = false;
    session.awaitingInput = false;

    emits.length = 0;
    (backend as any)._sweepOnce(1000 + 31 * 60 * 1000); // 31 min later
    expect(emits.find((e) => e.type === 'scope_suspended' && e.scope === SCOPE)).toBeTruthy();
    expect(fakeQuery.interruptSpy).toHaveBeenCalled();
    fakeQuery.close();
  });
```

(Confirm the scope-key separator by reading `toScopeKey` in sdkBackend.ts; use the real format.)

- [ ] **Step 2: Run test — verify it FAILS**

Run: `npx vitest run tests/unit/electron/sdkBackend.test.ts -t "(22)" --maxWorkers=2`
Expected: FAIL — `_sweepOnce` undefined.

- [ ] **Step 3: Implement**

Add to `ScopeSession`:

```typescript
  lastActivityAt: number;
  awaitingInput: boolean;
```

Initialize them where the session object is built in `_createSession`:

```typescript
    lastActivityAt: Date.now(),
    awaitingInput: false,
```

Set `lastActivityAt = Date.now()` in `send` (after getting/creating the session), in `compact`, and in the drain on each message (`session.lastActivityAt = Date.now();` at the top of the `for await` body). Set `awaitingInput = true` at each point the drain emits an `approval_needed` / `question_needed` / `plan_review_needed` (in `_buildCanUseTool` before storing the resolver, and in the AskUserQuestion/ExitPlanMode emit block — look up the session by scopeKey and set the flag). Clear `awaitingInput = false` in `approve`, `answerQuestion`, `answerPlanReview`, and in `send` (a new send means the user moved on). Use the session looked up by the same scopeKey those methods already compute.

Import + add the sweep:

```typescript
import { sweepIdleScopes, IDLE_SCOPE_MS, SWEEP_INTERVAL_MS } from '../../idleScopeSweep';
```

```typescript
  private idleSweepTimer: ReturnType<typeof setInterval> | null = null;

  private _sweepOnce(now: number): void {
    const records = Array.from(this.sessions.entries()).map(([key, s]) => {
      const [workspaceId, scope] = splitScopeKey(key); // mirror toScopeKey's inverse
      return { workspaceId, scope, lastActivityAt: s.lastActivityAt, streaming: s.mapperState.streaming, awaitingInput: s.awaitingInput };
    });
    sweepIdleScopes({
      now,
      idleMs: IDLE_SCOPE_MS,
      scopes: records,
      stop: (workspaceId, scope) => {
        this._emit({ type: 'scope_suspended', projectPath: workspaceId, scope });
        this.interrupt(workspaceId, scope === 'chat' ? undefined : scope);
      },
    });
  }

  private _startIdleSweep(): void {
    if (this.idleSweepTimer) return;
    this.idleSweepTimer = setInterval(() => this._sweepOnce(Date.now()), SWEEP_INTERVAL_MS);
    if (typeof this.idleSweepTimer.unref === 'function') this.idleSweepTimer.unref();
  }
```

Call `this._startIdleSweep()` at the end of the constructor. In `destroy`, clear it: `if (this.idleSweepTimer) { clearInterval(this.idleSweepTimer); this.idleSweepTimer = null; }`.

For `splitScopeKey`: if `toScopeKey(projectPath, scope)` joins with a separator (read it — e.g. `${projectPath}::${scope ?? 'chat'}`), implement the inverse by splitting on that separator (`workspaceId` = everything before the last separator, `scope` = after). If `toScopeKey` already stores both parts retrievably, prefer storing `projectPath`/`scope` on `ScopeSession` instead of parsing the key — add `projectPath: string; scopeName: string` to `ScopeSession` set in `_createSession` and use those in `_sweepOnce` (cleaner than parsing). Use whichever the existing code makes simplest; the test only checks the emitted `scope` and the interrupt.

- [ ] **Step 4: Run test — verify it PASSES**

Run: `npx vitest run tests/unit/electron/sdkBackend.test.ts -t "(22)" --maxWorkers=2`
Expected: PASS.

- [ ] **Step 5: Run the full sdkBackend suite** (the activity/awaiting plumbing touches several methods)

Run: `npx vitest run tests/unit/electron/sdkBackend.test.ts --maxWorkers=2`
Expected: all pass (existing tests unaffected).

- [ ] **Step 6: Commit**

```bash
git add electron/services/claudeBackend/sdkBackend.ts tests/unit/electron/sdkBackend.test.ts
git commit -m "feat(sdk): SDK-side idle scope sweep (suspend scopes idle >30m)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: User mcpConfigPath passthrough

**Files:**
- Create: `electron/services/claudeBackend/userMcpConfig.ts`
- Modify: `electron/services/claudeBackend/sdkBackend.ts` (`_createSession` — merge parsed user servers into `mcpServers`)
- Test: `tests/unit/electron/userMcpConfig.test.ts`, `tests/unit/electron/sdkBackend.test.ts`

**Interfaces:**
- Produces: `parseUserMcpConfigPaths(setting: unknown, readFile: (p: string) => string): Record<string, unknown>` — reads each path (string or string[]), parses `{ mcpServers: {...} }`, returns the merged server map; skips malformed/missing files (the `readFile` throwing) without throwing.
- Consumes (sdkBackend): merges its result into the `mcpServers` passed to `buildSdkOptions` for `kind === 'chat' | 'task'` (SAI's built-in `sai` key wins on collision).

- [ ] **Step 1: Write the failing test (parser)**

```typescript
// tests/unit/electron/userMcpConfig.test.ts
import { describe, it, expect, vi } from 'vitest';
import { parseUserMcpConfigPaths } from '../../../electron/services/claudeBackend/userMcpConfig';

describe('parseUserMcpConfigPaths', () => {
  const files: Record<string, string> = {
    '/cfg/a.json': JSON.stringify({ mcpServers: { foo: { type: 'stdio', command: 'foo' } } }),
    '/cfg/b.json': JSON.stringify({ mcpServers: { bar: { type: 'stdio', command: 'bar' } } }),
  };
  const readFile = (p: string) => { if (!(p in files)) throw new Error('ENOENT'); return files[p]; };

  it('returns {} for falsy/empty setting', () => {
    expect(parseUserMcpConfigPaths(undefined, readFile)).toEqual({});
    expect(parseUserMcpConfigPaths('', readFile)).toEqual({});
    expect(parseUserMcpConfigPaths([], readFile)).toEqual({});
  });

  it('parses a single string path', () => {
    expect(parseUserMcpConfigPaths('/cfg/a.json', readFile)).toEqual({ foo: { type: 'stdio', command: 'foo' } });
  });

  it('merges multiple paths', () => {
    expect(parseUserMcpConfigPaths(['/cfg/a.json', '/cfg/b.json'], readFile)).toEqual({
      foo: { type: 'stdio', command: 'foo' }, bar: { type: 'stdio', command: 'bar' },
    });
  });

  it('skips missing/malformed files without throwing', () => {
    const bad = { '/cfg/x.json': '{ not json' };
    const rf = (p: string) => { if (p === '/cfg/a.json') return files['/cfg/a.json']; if (p in bad) return bad[p]; throw new Error('ENOENT'); };
    expect(parseUserMcpConfigPaths(['/cfg/a.json', '/cfg/x.json', '/cfg/missing.json'], rf)).toEqual({ foo: { type: 'stdio', command: 'foo' } });
  });
});
```

- [ ] **Step 2: Run test — verify it FAILS**

Run: `npx vitest run tests/unit/electron/userMcpConfig.test.ts --maxWorkers=2`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement the parser**

```typescript
// electron/services/claudeBackend/userMcpConfig.ts
/**
 * Parse the user's `mcpConfigPath` SAI setting (string | string[]) into a merged
 * map of MCP server configs, for passthrough into the SDK `mcpServers` option in
 * chat/task scopes. Mirrors the CLI, which forwards each path via --mcp-config.
 * Malformed or unreadable files are skipped (logged by the caller), never thrown.
 */
export function parseUserMcpConfigPaths(
  setting: unknown,
  readFile: (p: string) => string,
): Record<string, unknown> {
  if (!setting) return {};
  const paths = Array.isArray(setting) ? setting : [setting];
  const merged: Record<string, unknown> = {};
  for (const p of paths) {
    if (typeof p !== 'string' || !p.trim()) continue;
    try {
      const parsed = JSON.parse(readFile(p.trim())) as { mcpServers?: Record<string, unknown> };
      if (parsed && parsed.mcpServers && typeof parsed.mcpServers === 'object') {
        Object.assign(merged, parsed.mcpServers);
      }
    } catch {
      // skip unreadable/malformed config
    }
  }
  return merged;
}
```

- [ ] **Step 4: Run test — verify it PASSES**

Run: `npx vitest run tests/unit/electron/userMcpConfig.test.ts --maxWorkers=2`
Expected: PASS.

- [ ] **Step 5: Wire into _createSession + test the merge**

In sdkBackend.ts, import the parser, `readSaiSetting` (from `../claude`), and `fs`:

```typescript
import { parseUserMcpConfigPaths } from './userMcpConfig';
import { readSaiSetting } from '../claude';
import * as fs from 'fs';
```

In `_createSession`, for chat/task scopes, merge the user servers into `mcpServers` (after the existing chat `mcpServers = { sai: server }` block):

```typescript
    if (kind === 'chat' || kind === 'task') {
      const userServers = parseUserMcpConfigPaths(
        readSaiSetting('mcpConfigPath'),
        (p) => fs.readFileSync(p, 'utf-8'),
      );
      if (Object.keys(userServers).length > 0) {
        mcpServers = { ...userServers, ...(mcpServers ?? {}) }; // SAI's `sai` key wins on collision
      }
    }
```

Add a test mirroring (17): set `mockReadSaiSetting` (add `readSaiSetting` to the claude.ts mock bag returning `'/cfg/a.json'`) and a `fs.readFileSync` spy returning the config; assert `capturedOptions.mcpServers` contains `foo`. (Mock `fs` via `vi.mock('fs', ...)` returning the config string, or inject — simplest: add `readSaiSetting: mockReadSaiSetting` to the existing claude mock and `vi.spyOn(fs, 'readFileSync')`.)

```typescript
  it('(23) chat scope merges user mcpConfigPath servers alongside sai', async () => {
    mockReadSaiSetting.mockReturnValue('/cfg/a.json');
    vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify({ mcpServers: { foo: { type: 'stdio', command: 'foo' } } }) as any);
    const fakeQuery = makeFakeQuery([], { hang: true });
    let capturedOptions: any = null;
    const queryFn = vi.fn((args: any) => { capturedOptions = args.options; return fakeQuery; });
    const buildChatMcpServer = vi.fn(() => ({ type: 'sdk', name: 'sai', instance: {} } as any));
    const backend = new SdkBackend({ queryFn, emit: (p) => emits.push(p), resolveClaudePath: () => undefined, buildChatMcpServer });
    backend.start({ projectPath: PROJECT, scope: SCOPE, scopeCwd: PROJECT, kind: 'chat' });
    backend.send({ projectPath: PROJECT, message: 'hi', scope: SCOPE, permMode: 'default' });
    await new Promise<void>((r) => { const c = () => capturedOptions ? r() : setTimeout(c, 5); setTimeout(c, 5); });
    expect(capturedOptions.mcpServers.foo).toEqual({ type: 'stdio', command: 'foo' });
    expect(capturedOptions.mcpServers.sai).toBeTruthy();
    fakeQuery.close();
  });
```

Add `readSaiSetting: mockReadSaiSetting` + `mockReadSaiSetting: vi.fn().mockReturnValue(undefined)` to the claude mock so other tests default to no user config.

- [ ] **Step 6: Run tests — verify they PASS**

Run: `npx vitest run tests/unit/electron/userMcpConfig.test.ts tests/unit/electron/sdkBackend.test.ts --maxWorkers=2`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add electron/services/claudeBackend/userMcpConfig.ts electron/services/claudeBackend/sdkBackend.ts tests/unit/electron/userMcpConfig.test.ts tests/unit/electron/sdkBackend.test.ts
git commit -m "feat(sdk): pass user mcpConfigPath servers through to SDK mcpServers (chat/task)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: settingSources control (SAI's permission mode governs)

**Files:**
- Modify: `electron/services/claudeBackend/sdkOptions.ts` (add `settingSources`)
- Test: `tests/unit/electron/sdkOptions.test.ts`

**Interfaces:**
- Produces: `buildSdkOptions` sets `opts.settingSources = ['project', 'local']` — excluding the user-global `~/.claude/settings.json` layer (where a `defaultMode: bypassPermissions` + global allow-lists would otherwise auto-allow tools and disable SAI's `canUseTool` flow). Project/local settings and CLAUDE.md context still load.

**Design note (dogfood-gated):** `settingSources` is `('user'|'project'|'local')[]`. Excluding `'user'` drops the global settings.json (the bypass) but, per the SDK, NOT the global CLAUDE.md memory (that loads via the `claude_code` system-prompt preset, independent of `settingSources`). This is the spec's "SAI's permission mode governs" goal. Task 8's dogfood confirms (a) a non-pre-approved tool prompts under a global bypass, and (b) global CLAUDE.md still applies. If (b) regresses, the one-line fallback is `['user', 'project', 'local']` (accept that a global bypass disables approvals) — decided at dogfood.

- [ ] **Step 1: Write the failing test** (add to `sdkOptions.test.ts`)

```typescript
  it('sets settingSources to [project, local] (excludes user-global bypass)', () => {
    const opts = buildSdkOptions({ kind: 'chat', cwd: '/ws' });
    expect(opts.settingSources).toEqual(['project', 'local']);
  });
```

- [ ] **Step 2: Run test — verify it FAILS**

Run: `npx vitest run tests/unit/electron/sdkOptions.test.ts -t "settingSources" --maxWorkers=2`
Expected: FAIL — `settingSources` undefined.

- [ ] **Step 3: Implement**

In `buildSdkOptions`, add to the `opts` object literal (alongside `permissionMode`, `cwd`, etc.):

```typescript
    settingSources: ['project', 'local'],
```

Update the function's JSDoc to note this excludes the user-global settings layer so SAI's permission mode governs.

- [ ] **Step 4: Run test — verify it PASSES**

Run: `npx vitest run tests/unit/electron/sdkOptions.test.ts --maxWorkers=2`
Expected: PASS (existing sdkOptions tests + the new one).

- [ ] **Step 5: Commit**

```bash
git add electron/services/claudeBackend/sdkOptions.ts tests/unit/electron/sdkOptions.test.ts
git commit -m "feat(sdk): settingSources=[project,local] so SAI permission mode governs (dogfood-gated)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Remote origin permission clamp

**Files:**
- Modify: `electron/services/claude.ts` (export `getRemoteCeiling()`)
- Modify: `electron/services/claudeBackend/sdkBackend.ts` (`send` — apply clamp for `origin === 'remote'`)
- Modify: `electron/services/claudeBackend/sdkOptions.ts` (map the remote `PermMode` values so the clamp has effect)
- Test: `tests/unit/electron/sdkBackend.test.ts`, `tests/unit/electron/sdkOptions.test.ts`

**Interfaces:**
- Consumes: `clamp(desktop: PermMode | undefined, ceiling: PermMode | null)` from `../remote/clamp`; `getRemoteCeiling(): PermMode | null` (new export from claude.ts).
- Produces: `send` clamps the effective permMode for `origin === 'remote'` before session creation (mirroring `sendImpl:740-743`); `buildSdkOptions` maps `PermMode` values to `permissionMode` so the clamp is observable.

**Grounding (read before implementing):** Read `electron/services/claude.ts` `sendImpl` (~724-755) and how the spawned process's `--permission-mode` is derived from `effectivePermMode` (in `ensureProcess` / `buildArgs`) — mirror THAT `PermMode` → permission-mode translation into `buildSdkOptions` so SDK mode matches CLI. The remote bridge sends `permMode` already in `PermMode` space (`'auto'|'auto-read'|'always-ask'`); desktop sends `'bypass'|'default'|undefined`.

- [ ] **Step 1: Export getRemoteCeiling in claude.ts**

Next to `setRemoteCeiling` (claude.ts ~74-77):

```typescript
export function getRemoteCeiling(): PermMode | null { return remoteCeiling; }
```

- [ ] **Step 2: Write the failing tests**

`sdkOptions.test.ts` — map the remote values (use the mapping you confirmed from the CLI; the test encodes the agreed mapping: `'always-ask'` → prompts, `'auto'` → bypass, `'auto-read'` → acceptEdits):

```typescript
  it('maps remote PermMode values to SDK permissionMode', () => {
    expect(buildSdkOptions({ kind: 'chat', cwd: '/ws', permMode: 'always-ask' }).permissionMode).toBe('default');
    expect(buildSdkOptions({ kind: 'chat', cwd: '/ws', permMode: 'auto' }).permissionMode).toBe('bypassPermissions');
    expect(buildSdkOptions({ kind: 'chat', cwd: '/ws', permMode: 'auto-read' }).permissionMode).toBe('acceptEdits');
    // desktop values unchanged:
    expect(buildSdkOptions({ kind: 'chat', cwd: '/ws', permMode: 'bypass' }).permissionMode).toBe('bypassPermissions');
    expect(buildSdkOptions({ kind: 'chat', cwd: '/ws', permMode: 'default' }).permissionMode).toBe('acceptEdits');
  });
```

`sdkBackend.test.ts` — clamp applied for remote:

```typescript
  it('(24) remote origin clamps permMode by the remote ceiling', async () => {
    mockGetRemoteCeiling.mockReturnValue('always-ask');
    const fakeQuery = makeFakeQuery([], { hang: true });
    let capturedOptions: any = null;
    const queryFn = vi.fn((args: any) => { capturedOptions = args.options; return fakeQuery; });
    const backend = new SdkBackend({ queryFn, emit: (p) => emits.push(p), resolveClaudePath: () => undefined });
    backend.start({ projectPath: PROJECT, scope: SCOPE, scopeCwd: PROJECT, kind: 'chat' });
    // remote sends the permissive 'auto'; ceiling 'always-ask' must win.
    backend.send({ projectPath: PROJECT, message: 'hi', scope: SCOPE, permMode: 'auto', origin: 'remote' } as any);
    await new Promise<void>((r) => { const c = () => capturedOptions ? r() : setTimeout(c, 5); setTimeout(c, 5); });
    expect(capturedOptions.permissionMode).toBe('default'); // clamped to always-ask → default
    fakeQuery.close();
  });
```

Add `getRemoteCeiling: mockGetRemoteCeiling` + `mockGetRemoteCeiling: vi.fn().mockReturnValue(null)` to the claude.ts mock bag.

- [ ] **Step 3: Run tests — verify they FAIL**

Run: `npx vitest run tests/unit/electron/sdkOptions.test.ts tests/unit/electron/sdkBackend.test.ts -t "remote" --maxWorkers=2`
Expected: FAIL — mapping not present; clamp not applied.

- [ ] **Step 4: Implement**

In `sdkOptions.ts`, replace the `permissionMode` derivation with a mapping that covers desktop + remote `PermMode` values (mirror the CLI translation you read):

```typescript
  let permissionMode: Options['permissionMode'];
  if (kind === 'orchestrator' || permMode === 'bypass' || permMode === 'auto') {
    permissionMode = 'bypassPermissions';
  } else if (permMode === 'always-ask') {
    permissionMode = 'default';
  } else {
    // 'default' | 'auto-read' | undefined
    permissionMode = 'acceptEdits';
  }
```

In `sdkBackend.ts` `send`, after destructuring (add `origin` and `scope`), clamp before creating the session:

```typescript
import { clamp } from '../remote/clamp';
import { getRemoteCeiling } from '../claude';
import type { PermMode } from '../remote/clamp';
// ...
    const { projectPath, message, scope, permMode, effort, model, imagePaths, origin } = args;
    let effectivePermMode = permMode;
    if (origin === 'remote') {
      effectivePermMode = clamp(permMode as PermMode | undefined, getRemoteCeiling()) ?? permMode;
    }
```

Pass `effectivePermMode` (not `permMode`) into `_createSession`'s `queryArgs.permMode`.

- [ ] **Step 5: Run tests — verify they PASS**

Run: `npx vitest run tests/unit/electron/sdkOptions.test.ts tests/unit/electron/sdkBackend.test.ts --maxWorkers=2`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add electron/services/claude.ts electron/services/claudeBackend/sdkBackend.ts electron/services/claudeBackend/sdkOptions.ts tests/unit/electron/sdkBackend.test.ts tests/unit/electron/sdkOptions.test.ts
git commit -m "feat(sdk): clamp remote-origin permission mode by the remote ceiling

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: Whole-branch verify + dogfood gate

**Files:** none (verification); update spec/memory status.

- [ ] **Step 1: Typecheck** — `npx tsc --noEmit -p tsconfig.json` → exit 0.
- [ ] **Step 2: Full suite** — `npm test` → all green (prior baseline 237 files / 2234 + the new tests).
- [ ] **Step 3: Real-app dogfood (the gate, requires the user).** Build off this branch (`npm run dev`), Settings → Claude → Backend → SDK, restart. Confirm in SDK mode:
  1. With a global `~/.claude/settings.json` `defaultMode: bypassPermissions`, ask the agent to run a non-pre-approved tool → the approval card appears (settingSources works). Also confirm a global `~/.claude/CLAUDE.md` instruction still applies (e.g. a phrasing rule).
  2. `/compact` → conversation compacts, thinking animation shows.
  3. Attach an image → the `[Attached image: …]` ref reaches the agent.
  4. Point `mcpConfigPath` at a test MCP server → its tools load.
  5. Leave a scope idle (or temporarily shorten `IDLE_SCOPE_MS`) → it suspends.
  - If settingSources regresses global CLAUDE.md, fall back to `['user','project','local']` (Task 6) and re-confirm.
- [ ] **Step 4: Update spec status + memory** — mark the Phase 4a spec implemented; note Phase 4b (orchestrator) remains.

---

## Self-Review (against the Phase 4a spec)

**Spec coverage:** Images → Task 1. `/compact` → Task 2 (+ dogfood). Slash cache → Task 3. Idle sweep → Task 4. User MCP passthrough → Task 5. settingSources → Task 6 (+ dogfood). Remote clamp → Task 7. Dogfood gate + verify → Task 8.

**Deviations / flags:**
- Task 2's `lastActivityAt` line is deferred to Task 4 (where the field is added) to keep tasks independently testable — called out inline.
- Task 7 expands `buildSdkOptions`'s `permissionMode` mapping (needed for the clamp to be observable in SDK mode); the implementer grounds the exact mapping in the CLI's `PermMode`→`--permission-mode` translation rather than the plan guessing. The test encodes the agreed mapping (`always-ask`→`default`, `auto`→`bypassPermissions`, `auto-read`→`acceptEdits`); if the CLI translation differs, update the test + mapping together and note it.
- Task 6's `settingSources` value is the best-judgment design decision (`['project','local']`) with a documented dogfood gate and one-line fallback — the spec's stated "spike-validated mechanism".

**Placeholder scan:** none — every code step has complete code. The two genuinely-runtime-validated behaviors (`/compact` compaction, `settingSources` under a real global bypass) are explicit Task 8 dogfood items, not placeholders.

**Type consistency:** `parseUserMcpConfigPaths` (Task 5) signature is consumed unchanged in `_createSession`; `getRemoteCeiling`/`clamp`/`PermMode` (Task 7) align with `remote/clamp.ts`; `lastActivityAt`/`awaitingInput`/`_sweepOnce` (Task 4) are referenced only after their introduction; `readCachedSlashCommands`/`writeCachedSlashCommands` (Task 3) match claude.ts.
