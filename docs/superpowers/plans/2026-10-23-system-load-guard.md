# System Load Guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** SAI watches memory/swap/pressure (plus CPU/GPU for context). On **warning** it tells the AI what the machine is doing. On **critical** it freezes every SAI-launched AI process, and kills the biggest SAI offender when SAI is what's sinking the machine. It never touches anything SAI didn't launch.

**Architecture:**
- **Ownership:** a main-process `LoadGuard` samples `/proc` and identifies "SAI's AI processes" by an env tag (`SAI_LOAD_SCOPE`). The tag is stamped into every provider child's spawn env, so all descendants (Bash commands, test runners, dev servers) inherit it, and `/proc/<pid>/environ` tells us which chat owns them. That gives provider-agnostic ownership with no PID plumbing through four backends.
- **Freezing and killing:** freezing is `SIGSTOP`/`SIGCONT` on tagged pids, which halts new tool calls and turns in every provider. Killing is `SIGKILL` on a unit subtree.
- **The pure parts** (sampling parse, classification, state machine, kill choice, note text) are unit-tested with fixtures. The orchestrator wires them to timers, IPC, the devlog and the chat stream.

**Tech Stack:** Electron main (Node `fs/promises`, `process.kill`), React renderer, vitest (`--maxWorkers=2`, already set in `vitest.config.ts`).

**Spec:** `docs/superpowers/specs/2026-10-23-system-load-guard-design.md`

## Global Constraints

- **Linux only.** On `process.platform !== 'linux'` the guard never starts and every IPC returns the `normal` state.
- **Never act on an untagged process.** Freeze/kill only pids whose environ carries `SAI_LOAD_SCOPE` with **this** instance's id, plus their descendants. Untagged processes include the user's game, browser, Discord, SAI terminal tabs and SAI's Electron processes.
- **Thresholds:**
  - **Warning** if any of:
    - MemAvailable < 20% of MemTotal
    - swap used grew > 256 MiB over the last 30s
    - memory PSI `some avg10` > 5
  - **Critical** if any of:
    - memory PSI `full avg10` > 10
    - MemAvailable < 6%
  - **Leaving a level** requires its enter-conditions to be false continuously for **30s**.
- **SAI's fault** if any of:
  - SAI AI total ≥ 25% of (RAM used + swap used)
  - any single SAI unit ≥ 4 GiB
  - any SAI unit grew ≥ 2 GiB in the last 60s
- **Kill order:**
  - Largest unit first.
  - Sizes within 10% count as ties. Ties break `command` < `service` < `agent`.
  - One kill per 5s, re-evaluating between kills.
- **Settings:** `loadGuardEnabled` (default `true`) and `loadGuardAutoKill` (default `true`).
- **"Resume anyway"** overrides the freeze until the critical episode ends. Kills still follow `loadGuardAutoKill`.
- **AI notes** are sent only on level changes and kills, never every turn.
- **Rolling record:** about 10 minutes, top 10 processes per process scan, in memory. A devlog snapshot is written on entering critical.
- **Sampling:**
  - The system sample runs every 2s.
  - The process scan runs every 10s at `normal` and every 2s at `warning`/`critical`.
  - GPU (`nvidia-smi`) runs every 10s, is informational only, and is skipped silently if missing.
- **Logging:** all state changes, freezes, thaws and kills go to `devlog('loadguard', …)`.
- **Tests:** vitest runs use `--maxWorkers=2`, per the user's global instructions. Never stress the real machine to test. Use fixtures, plus the `SAI_LOAD_GUARD_FAKE` override for live UI checks.

## Review Focus

1. **Second SAI instance.** A dev SAI started by the prod AI inherits the prod tag in `process.env`. Each instance must act only on its own instance id, and must strip an inherited `SAI_LOAD_SCOPE` from its own `process.env` at boot so its terminals aren't tagged. The test is in Task 1.
2. **SAI exits or crashes while processes are frozen.** Stopped orphans (for example a daemonised dev server) would stay stopped forever. Frozen pids are persisted, and anything still frozen is resumed at the next boot (`SIGCONT` only if the pid's start time matches) and on `before-quit`. The tests are in Tasks 7 and 9.
3. **A frozen Claude/Codex CLI mid-API-stream.** After a long freeze the HTTP stream may be dropped. On thaw the chat must end up either continuing or showing a normal error, never stuck "working" forever. Check this in the live smoke (Task 13). If it hangs, the existing `claude:reconcileScope` poll is the place to fix it.
4. **A pid reused between scan and signal.** Signal only pids whose `/proc/<pid>/stat` start time matches the scanned one. The test is in Task 7.
5. **The guard's own failures.** `/proc` read errors, `nvidia-smi` hanging, or an exception in a tick must never throw out of the loop or freeze the app. On error, the tick logs, keeps the previous level, and never freezes or kills on partial data. The test is in Task 9.

---

## File Structure

```
electron/services/loadGuard/
  types.ts        shared types (no logic)
  scopeTag.ts     env tag format/parse/stamp
  procReader.ts   /proc + nvidia-smi readers (procRoot injectable)
  classify.ts     ProcInfo[] → owners, AI units, top users, game
  levels.ts       pure level state machine with 30s dwell
  killPlan.ts     isSaiFault + pickKillTarget
  signals.ts      freeze/thaw/kill with start-time guard + frozen-pid persistence
  notes.ts        AI note text + NoteBox (per-scope delivery)
  history.ts      rolling record ring buffer
  index.ts        LoadGuard orchestrator (timers, settings, IPC broadcast, chat events, devlog)
src/hooks/useLoadGuard.ts
src/components/Chat/LoadGuardPill.tsx
src/components/Chat/LoadGuardBanner.tsx
src/components/Chat/LoadGuardEventCard.tsx
```

Modified:
- `electron/main.ts`
- `electron/preload.ts`
- `src/types.ts`
- `electron/services/claude.ts`
- `electron/services/claudeBackend/{sdkOptions,sdkBackend}.ts`
- `electron/services/codexBackend/{sdkBackend,appServerClient}.ts`
- `electron/services/codex.ts`
- `electron/services/acp.ts`
- `electron/services/acpProvider.ts`
- `electron/services/gemini.ts`
- `src/components/Chat/ChatPanel.tsx`
- `src/components/Chat/ChatMessage.tsx`
- `src/components/SettingsModal.tsx`

---

### Task 1: Types and scope tag, stamped into every provider spawn

**Files:**
- Create: `electron/services/loadGuard/types.ts`, `electron/services/loadGuard/scopeTag.ts`
- Modify:
  - `electron/services/claudeBackend/sdkBackend.ts:1174` (the `env:` passed to `buildSdkOptions`)
  - `electron/services/claude.ts:380` (CLI spawn env)
  - `electron/services/codexBackend/sdkBackend.ts:210` (`createClient({ env })`, per scope)
  - `electron/services/codexBackend/appServerClient.ts:443` (shared → scope `'*'`)
  - `electron/services/acp.ts:115` / `acpProvider.ts:460` (per workspace → scope `'*'`)
  - `electron/services/gemini.ts:138` (per prompt, real scope)
  - `electron/main.ts`: at the top of boot, `delete process.env.SAI_LOAD_SCOPE`
- Test: `tests/unit/electron/loadGuard/scopeTag.test.ts`, plus one assertion added to `tests/unit/electron/sdkBackend.test.ts`

**Interfaces:**
- Produces, in `types.ts`:
  ```ts
  export type Provider = 'claude' | 'codex' | 'gemini' | 'kimi';
  export interface ScopeTag { instance: number; provider: Provider; projectPath: string; scope: string /* '*' = all scopes of provider in project */ }
  export type Level = 'normal' | 'warning' | 'critical';
  export type Owner = 'sai-ai' | 'sai-app' | 'sai-terminal' | 'game' | 'other';
  export interface ProcInfo { pid: number; ppid: number; comm: string; cmd: string /* argv joined, ≤200 chars */; startTicks: number; rssKb: number; swapKb: number; cgroup: string; tag: ScopeTag | null }
  export interface SystemSample { ts: number; memTotalKb: number; memAvailableKb: number; swapTotalKb: number; swapFreeKb: number; psiMemSome10: number; psiMemFull10: number; psiCpuSome10: number; gpu: { utilPct: number; vramUsedMb: number; vramTotalMb: number } | null }
  export interface TopUser { label: string; sizeKb: number; owner: Owner; tag?: ScopeTag }
  export type UnitKind = 'command' | 'service' | 'agent';
  export interface AiUnit { rootPid: number; kind: UnitKind; tag: ScopeTag; sizeKb: number; pids: number[] /* descendants-first */; label: string; startTicks: number }
  ```
- Produces, in `scopeTag.ts`:
  - `SCOPE_ENV = 'SAI_LOAD_SCOPE'`
  - `formatScopeTag(t: ScopeTag): string`. Format: `v1|<instance>|<provider>|<encodeURIComponent(scope)>|<projectPath>`, with projectPath last and unencoded.
  - `parseScopeTag(s: string): ScopeTag | null`
  - `withScopeTag<E extends Record<string, string | undefined>>(env: E, t: Omit<ScopeTag, 'instance'>): E`, which stamps `instance = process.pid`.

- [ ] **Step 1: Write the failing tests**

```ts
it('round-trips a tag whose projectPath contains |', () => {
  const t = { instance: 42, provider: 'codex' as const, projectPath: '/a|b/c', scope: 'sess|1' };
  expect(parseScopeTag(formatScopeTag(t))).toEqual(t);
});
it('rejects garbage and unknown versions', () => {
  expect(parseScopeTag('nope')).toBeNull();
  expect(parseScopeTag('v9|1|claude|x|/p')).toBeNull();
});
it('withScopeTag stamps this instance pid and does not mutate input', () => {
  const env = { PATH: '/bin' };
  const out = withScopeTag(env, { provider: 'claude', projectPath: '/p', scope: 'chat' });
  expect(parseScopeTag(out.SAI_LOAD_SCOPE!)!.instance).toBe(process.pid);
  expect(env).toEqual({ PATH: '/bin' });
});
```
In `sdkBackend.test.ts`: starting a scope `('/p', 's1')` passes `options.env.SAI_LOAD_SCOPE` that parses to `{ provider: 'claude', projectPath: '/p', scope: 's1' }`.

- [ ] **Step 2: Run them and confirm they fail**

Run: `npx vitest run tests/unit/electron/loadGuard/scopeTag.test.ts tests/unit/electron/sdkBackend.test.ts --maxWorkers=2`
Expected: FAIL (module not found / env assertion).

- [ ] **Step 3: Implement `scopeTag.ts` and stamp the tag at each spawn site listed above**

Use the real scope at per-scope sites, `'*'` for shared clients (Codex app-server, ACP transport), and the chat default scope `'chat'` where scope is undefined. Add the `delete process.env.SAI_LOAD_SCOPE` line in `main.ts` before any service registers.

- [ ] **Step 4: Run the tests and confirm they pass**

Same command. Expected: PASS. Also run `npx vitest run tests/unit/electron --maxWorkers=2` and confirm no regressions in the backend tests.

- [ ] **Step 5: Commit** `feat(loadguard): tag provider child processes with their owning scope`

---

### Task 2: /proc and GPU readers

**Files:**
- Create: `electron/services/loadGuard/procReader.ts`
- Test: `tests/unit/electron/loadGuard/procReader.test.ts`, with fixture dirs under `tests/fixtures/loadguard/proc/`

**Interfaces:**
- Produces:
  - `readSystemSample(procRoot = '/proc', now = Date.now()): Promise<Omit<SystemSample, 'gpu'>>`
    - Parses `meminfo` (MemTotal, MemAvailable, SwapTotal, SwapFree) and `pressure/memory` (`some avg10`, `full avg10`).
    - Also parses `pressure/cpu` `some avg10`. A missing PSI file gives 0.
  - `readProcesses(procRoot = '/proc'): Promise<ProcInfo[]>`
    - Covers every numeric dir.
    - `stat` gives ppid, comm and starttime (field 22). Parse after the last `)`, because comm can contain spaces and parens.
    - `status` gives VmRSS and VmSwap. Kernel threads have no VmRSS, giving 0.
    - `cmdline` is NUL→space, truncated to 200 chars.
    - `cgroup` comes from the `0::` line.
    - `environ` is read only to find `SAI_LOAD_SCOPE=`, then parsed with `parseScopeTag`.
    - Any per-pid read error (the process exited, EACCES) skips that pid silently.
  - `readGpu(exec?: (cmd: string, args: string[], timeoutMs: number) => Promise<string>): Promise<SystemSample['gpu']>`
    - Runs `nvidia-smi --query-gpu=utilization.gpu,memory.used,memory.total --format=csv,noheader,nounits` with a 2000ms timeout.
    - Returns `null` on any error or empty output.
    - Uses the first GPU line.

- [ ] **Step 1: Write the failing tests** against a fixture `proc/` with `meminfo`, `pressure/memory` and `pressure/cpu`, plus pids:
  - `100`: comm `(Web Content)`, tagged
  - `101`: environ unreadable (fixture file missing)
  - `102`: a kernel thread with no VmRSS
  - `103`: dir with no `stat`

```ts
expect(sys).toMatchObject({ memTotalKb: 31457280, memAvailableKb: 1572864, swapTotalKb: 23068672, swapFreeKb: 20971520, psiMemSome10: 12.5, psiMemFull10: 11.2, psiCpuSome10: 3.1 });
const p100 = procs.find(p => p.pid === 100)!;
expect(p100.comm).toBe('Web Content');
expect(p100.tag).toMatchObject({ provider: 'claude', scope: 'chat' });
expect(procs.find(p => p.pid === 101)!.tag).toBeNull();
expect(procs.find(p => p.pid === 102)!.rssKb).toBe(0);
expect(procs.some(p => p.pid === 103)).toBe(false);
expect(await readGpu(async () => '98, 10240, 12288\n')).toEqual({ utilPct: 98, vramUsedMb: 10240, vramTotalMb: 12288 });
expect(await readGpu(async () => { throw new Error('ENOENT'); })).toBeNull();
```

- [ ] **Step 2: Run the tests and confirm they fail.** Run: `npx vitest run tests/unit/electron/loadGuard/procReader.test.ts --maxWorkers=2`
- [ ] **Step 3: Implement `procReader.ts`** with `fs/promises` and concurrency-limited reads (≤32 in flight).
- [ ] **Step 4: Run the tests and confirm they pass.**
- [ ] **Step 5: Commit** `feat(loadguard): /proc and nvidia-smi readers`

---

### Task 3: Classification (owners, AI units, top users, game)

**Files:**
- Create: `electron/services/loadGuard/classify.ts`
- Test: `tests/unit/electron/loadGuard/classify.test.ts`

**Interfaces:**
- Consumes `ProcInfo`, `ScopeTag`, `AiUnit`, `TopUser` (Task 1).
- Produces:
  ```ts
  export interface ClassifyCtx { instance: number; appPids: Set<number>; terminalPids: Set<number>; clockTicksPerSec: number; bootTimeSec: number; nowSec: number }
  export interface Classified { units: AiUnit[]; saiAiKb: number; saiAppKb: number; top: TopUser[] /* 10, desc */; game: { name: string; sizeKb: number } | null }
  export function classify(procs: ProcInfo[], ctx: ClassifyCtx): Classified
  export function appLabelFromCgroup(cgroup: string): string | null
  ```
- **Rules:**
  - *Ownership*: a pid is **sai-ai** if it has a tag with `instance === ctx.instance`, or descends from such a pid. **sai-terminal** means a descendant of `terminalPids`. **sai-app** means in `appPids`. **game** means `cmd` contains `/steamapps/common/`, or comm is `gamescope`, or there's an ancestor with comm `reaper`. Anything else is **other**.
  - *Units*: an **agent root** is an own-instance tagged pid whose parent is not own-instance tagged. Each child subtree of an agent root is a unit: `service` if its age is ≥ 300s, otherwise `command`. The agent root itself is a unit of kind `agent` whose `sizeKb` is the root's own RSS+swap only. Its `pids` is the whole tree, descendants first. `sizeKb` = sum of RSS+swap over the subtree. `label` = `cmd` of the unit root.
  - *Top users*: group by:
    - an SAI unit, with label = unit label
    - a game, with label = the path segment after `steamapps/common/`
    - otherwise `appLabelFromCgroup`, falling back to `comm`

    The top 10 are by size.
  - *`appLabelFromCgroup`*: take the last path segment matching `app-…\.scope`, strip `app-`, `flatpak-`, a trailing `-<digits|hex>.scope` or `@…`, and unescape `\x2d`→`-`. Examples:
    - `…/app-flatpak-app.zen_browser.zen-41.scope` → `app.zen_browser.zen`
    - `…/app-steam@abc.service` → `steam`
    - no match → `null`

- [ ] **Step 1: Write the failing tests:**
  - an own-instance agent with a 7 GiB vitest child (age 20s) and a 1 GiB dev server (age 900s) → three units with kinds `command`, `service` and `agent`, and the agent's size = the root's own size only
  - a tag from another instance → classified as not sai-ai, with no units
  - a terminal descendant → owner `sai-terminal`, never a unit
  - `/home/u/.steam/steamapps/common/Deep Rock Galactic/FSD.exe` → `game.name === 'Deep Rock Galactic'`
  - the three `appLabelFromCgroup` examples above
- [ ] **Step 2: Run them and confirm they fail.** Run: `npx vitest run tests/unit/electron/loadGuard/classify.test.ts --maxWorkers=2`
- [ ] **Step 3: Implement `classify.ts`.** Build a pid→children map once and walk with an explicit stack (no recursion). Age = `nowSec - (bootTimeSec + startTicks / clockTicksPerSec)`.
- [ ] **Step 4: Run them and confirm they pass.**
- [ ] **Step 5: Commit** `feat(loadguard): classify processes into SAI units, games and apps`

---

### Task 4: Level state machine

**Files:**
- Create: `electron/services/loadGuard/levels.ts`
- Test: `tests/unit/electron/loadGuard/levels.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const THRESHOLDS = { warnMemAvailPct: 20, warnSwapGrowthKb30s: 262144, warnPsiSome10: 5, critPsiFull10: 10, critMemAvailPct: 6, dwellMs: 30_000 } as const;
  export interface LevelState { level: Level; since: number; calmSince: number | null /* when the current level's conditions last went false */ }
  export function rawLevel(s: SystemSample, swapUsedKb30sAgo: number | null): Level
  export function stepLevel(prev: LevelState, raw: Level, now: number): LevelState
  ```
- **Semantics:**
  - Raising the level is immediate.
  - Lowering requires the raw level to stay below the current level for `dwellMs` continuously, and then drops to the raw level.
  - Any tick at or above the current level resets `calmSince` to `null`.

- [ ] **Step 1: Write the failing tests:**
  - 5% MemAvailable → `critical`
  - PSI full 10.1 → `critical`
  - 19% MemAvailable → `warning`
  - swap growth of exactly 262144 → not warning, 262145 → `warning`
  - `null` swap history → swap growth is ignored
  - critical → raw normal for 29_999ms stays `critical`; at 30_000ms it becomes `normal`
  - critical → normal for 20s, then one warning tick, then normal for 20s → still `critical` (dwell resets)
  - normal → critical is immediate
- [ ] **Step 2: Run them and confirm they fail.** Run: `npx vitest run tests/unit/electron/loadGuard/levels.test.ts --maxWorkers=2`
- [ ] **Step 3: Implement `levels.ts`.**
- [ ] **Step 4: Run them and confirm they pass.**
- [ ] **Step 5: Commit** `feat(loadguard): level state machine with 30s calm dwell`

---

### Task 5: Fault rule and kill choice

**Files:**
- Create: `electron/services/loadGuard/killPlan.ts`
- Test: `tests/unit/electron/loadGuard/killPlan.test.ts`

**Interfaces:**
- Consumes `AiUnit`, `SystemSample`, `Classified` (Tasks 1 and 3).
- Produces:
  ```ts
  export const FAULT = { sharePct: 25, singleUnitKb: 4 * 1024 * 1024, growthKb60s: 2 * 1024 * 1024, tiePct: 10, killCooldownMs: 5_000 } as const;
  export function isSaiFault(s: SystemSample, c: Classified, unitSizeKb60sAgo: (rootPid: number, startTicks: number) => number | null): boolean
  export function pickKillTarget(units: AiUnit[]): AiUnit | null
  ```
- **Rules:**
  - "Used" = `(memTotalKb - memAvailableKb) + (swapTotalKb - swapFreeKb)`.
  - `pickKillTarget` sorts by size descending. Among units within `tiePct`% of the largest, it picks the lowest of `command` < `service` < `agent`. Empty input → `null`.

- [ ] **Step 1: Write the failing tests:**
  - SAI at 24% of used and no big unit → `false`; at 25% → `true`
  - a single 4 GiB unit in a 20% share → `true`
  - growth of 2 GiB+1 KiB in 60s → `true`
  - `pickKillTarget` with a 7 GiB command and a 2 GiB agent → the command
  - a 5.0 GiB agent and a 4.6 GiB command (within 10%) → the command
  - a 5.0 GiB agent and a 4.4 GiB service → the agent
  - `[]` → `null`
- [ ] **Step 2: Run them and confirm they fail.** Run: `npx vitest run tests/unit/electron/loadGuard/killPlan.test.ts --maxWorkers=2`
- [ ] **Step 3: Implement `killPlan.ts`.**
- [ ] **Step 4: Run them and confirm they pass.**
- [ ] **Step 5: Commit** `feat(loadguard): SAI-fault rule and least-disruptive kill choice`

---

### Task 6: Rolling record

**Files:**
- Create: `electron/services/loadGuard/history.ts`
- Test: `tests/unit/electron/loadGuard/history.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface HistoryEntry { ts: number; memUsedPct: number; swapUsedKb: number; psiMemFull10: number; level: Level; top: TopUser[] | null /* null on ticks without a process scan */; unitSizes: Array<{ rootPid: number; startTicks: number; sizeKb: number }> }
  export class History { constructor(windowMs = 600_000); push(e: HistoryEntry): void; swapUsedKbAt(ts: number): number | null; unitSizeAt(ts: number, rootPid: number, startTicks: number): number | null; latestTop(): TopUser[]; summary(sinceMs: number): Array<Pick<HistoryEntry, 'ts' | 'memUsedPct' | 'swapUsedKb' | 'psiMemFull10' | 'level'> & { top3: TopUser[] }> }
  ```
- `…At(ts)` returns the value from the newest entry with `entry.ts <= ts`, or `null` if there is none. Entries older than `windowMs` are dropped on push.

- [ ] **Step 1: Write the failing tests:**
  - push at t=0, 10s, …, 700s → the entry at t=0 has been dropped, and `swapUsedKbAt(95_000)` returns the value from 90s
  - `latestTop` skips `null` tops
  - `unitSizeAt` matches on both pid and startTicks (a reused pid with different ticks → `null`)
- [ ] **Step 2: Run them and confirm they fail.** Run: `npx vitest run tests/unit/electron/loadGuard/history.test.ts --maxWorkers=2`
- [ ] **Step 3: Implement `history.ts`.**
- [ ] **Step 4: Run them and confirm they pass.**
- [ ] **Step 5: Commit** `feat(loadguard): 10-minute rolling record`

---

### Task 7: Signals (freeze, thaw, kill) and frozen-pid persistence

**Files:**
- Create: `electron/services/loadGuard/signals.ts`
- Test: `tests/unit/electron/loadGuard/signals.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface SignalDeps { kill: (pid: number, sig: NodeJS.Signals) => void; startTicksOf: (pid: number) => number | null /* reads /proc/<pid>/stat */; persistPath: string; fs?: Pick<typeof import('fs'), 'readFileSync' | 'writeFileSync'> }
  export class Signaller {
    constructor(deps: SignalDeps);
    freeze(procs: Array<{ pid: number; startTicks: number }>): number;   // SIGSTOP; returns count actually stopped; records in frozen set + persists
    thawAll(): number;                                                     // SIGCONT every recorded pid still matching; clears set + persists
    killTree(unit: Pick<AiUnit, 'pids'>, ticks: Map<number, number>): number; // SIGKILL descendants-first; drops them from frozen set
    recoverFromCrash(): number;                                            // on boot: SIGCONT persisted pids whose startTicks still match, then clear file
    frozenCount(): number;
  }
  ```
- Every signal is skipped when `startTicksOf(pid) !== expected`, which guards against pid reuse. ESRCH errors are swallowed. The persist file is JSON `[{pid,startTicks}]`, written on every change.

- [ ] **Step 1: Write the failing tests:**
  - `freeze` on 3 procs where one has mismatched ticks → returns 2, `kill` called twice with `SIGSTOP`, and the persisted file has 2 entries
  - `thawAll` → two `SIGCONT` calls, file `[]`
  - `killTree` sends `SIGKILL` in the given (descendants-first) order and removes those pids from the frozen set
  - `kill` throwing ESRCH doesn't throw out of the method
  - `recoverFromCrash` with a file listing one live matching pid and one reused pid → exactly one `SIGCONT`, and the file is cleared
- [ ] **Step 2: Run them and confirm they fail.** Run: `npx vitest run tests/unit/electron/loadGuard/signals.test.ts --maxWorkers=2`
- [ ] **Step 3: Implement `signals.ts`.** The default deps are `process.kill`, a `/proc` stat reader, and `persistPath = path.join(app.getPath('userData'), 'loadguard-frozen.json')`, injected from `index.ts`.
- [ ] **Step 4: Run them and confirm they pass.**
- [ ] **Step 5: Commit** `feat(loadguard): pid-reuse-safe freeze/thaw/kill with crash recovery`

---

### Task 8: AI notes and per-scope delivery

**Files:**
- Create: `electron/services/loadGuard/notes.ts`
- Test: `tests/unit/electron/loadGuard/notes.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export function warningNote(s: SystemSample, c: Classified, swapRising: boolean): string
  export function normalNote(): string
  export function killNote(u: AiUnit, memUsedPct: number): string
  export class NoteBox {
    postAll(text: string, now: number): void;                 // replaces any earlier postAll note (only latest load note matters)
    postTo(tag: Omit<ScopeTag, 'instance'>, text: string, now: number): void; // kill notes; scope '*' matches every scope of that provider+project
    take(provider: Provider, projectPath: string, scope: string, now: number): string | null; // unseen notes for this scope joined by '\n', then marked seen; notes older than 10 min are dropped
  }
  ```
- **Exact copy** (sizes in GB to 1 decimal place, percentages rounded):
  - Warning:
    - Base: `[SAI system load: WARNING] RAM {pct}% used ({free} GB free of {total} GB), swap {swap} GB used{ and rising}, memory pressure {psiSome}%, CPU pressure {psiCpu}%.`
    - Then, if a GPU sample exists: ` GPU {util}%, VRAM {used}/{total} GB.`
    - Then, if there are non-SAI top users: ` Also running: {up to 3 "label size GB" joined by ", "}.` A game is listed first as `game "{name}" {size} GB`.
    - Then: ` SAI's own processes: {saiAi} GB. Prefer lighter work for now (fewer parallel workers, avoid full builds or whole test suites, or wait), and tell the user if you're holding back.`
  - Normal: `[SAI system load: back to normal] Normal workloads are fine again.`
  - Kill: `[SAI system load: CRITICAL] SAI killed \`{label}\` ({size} GB) to keep the user's PC from freezing (RAM {pct}% used). Don't re-run it as-is; use a lighter approach or ask the user first.`

- [ ] **Step 1: Write the failing tests:**
  - `warningNote` with a game of 11.4 GB and zen at 6.1 GB contains `game "Deep Rock Galactic" 11.4 GB, app.zen_browser.zen 6.1 GB`
  - `killNote` matches the exact string for label `vitest`, 7.2 GB, 97%
  - `NoteBox`: two `postAll`s then a `take` → only the second note; a second `take` → `null`; a `postTo` with scope `'*'` is taken by scopes `a` and `b` of that provider but not by another provider; a note posted at t=0 and taken at t=600_001 → `null`
- [ ] **Step 2: Run them and confirm they fail.** Run: `npx vitest run tests/unit/electron/loadGuard/notes.test.ts --maxWorkers=2`
- [ ] **Step 3: Implement `notes.ts`.**
- [ ] **Step 4: Run them and confirm they pass.**
- [ ] **Step 5: Commit** `feat(loadguard): AI note copy and per-scope delivery box`

---

### Task 9: LoadGuard orchestrator plus main and preload wiring

**Files:**
- Create: `electron/services/loadGuard/index.ts`
- Modify:
  - `electron/main.ts`:
    - construct the guard after `registerTerminalHandlers` (`:525`)
    - settings side effects next to `subprocessMemoryCapMB` (`:864`)
    - boot settings next to `:888-892`
    - `before-quit` (`:1406`) calls `stop()`
  - `electron/preload.ts`: add flat APIs next to `claudeOnMessage` (`:189`)
  - `src/types.ts`: add to `SaiBridge` (`:484`)
- Test: `tests/unit/electron/loadGuard/index.test.ts`

**Interfaces:**
- Consumes everything from Tasks 1–8.
- Produces:
  ```ts
  export interface LoadGuardPublicState { level: Level; paused: boolean; override: boolean; saiCaused: boolean; saiAppHeavy: boolean; memUsedPct: number; swapUsedPct: number; game: { name: string; sizeKb: number } | null; recoveredAt: number | null; enabled: boolean }
  export type LoadGuardChatEvent =
    | { kind: 'note'; text: string }                                   // emitted when a note is actually delivered to this scope
    | { kind: 'killed'; unitKind: UnitKind; label: string; sizeKb: number; memUsedPct: number; top: TopUser[]; toldAi: string };
  export interface LoadGuardDeps { now(): number; readSystem(): Promise<Omit<SystemSample,'gpu'>>; readProcs(): Promise<ProcInfo[]>; readGpu(): Promise<SystemSample['gpu']>; appPids(): Set<number> /* app.getAppMetrics() */; terminalPids(): Set<number> /* listDesktopTerminals() */; signaller: Signaller; broadcastState(s: LoadGuardPublicState): void /* webContents.send('loadGuard:state') */; emitChat(projectPath: string, scope: string, provider: Provider, ev: LoadGuardChatEvent): void /* emitChatMessage({type:'load_guard',...}) */; onAgentKilled(tag: ScopeTag): void; devlog(event: string, data?: Record<string, unknown>): void; fake?: Level /* SAI_LOAD_GUARD_FAKE */ }
  export class LoadGuard {
    constructor(deps: LoadGuardDeps);
    start(): void; stop(): void;                 // stop() thaws everything
    tick(): Promise<void>;                       // one sample+decide pass; exposed for tests
    applySettings(s: { enabled: boolean; autoKill: boolean }): void; // disabling thaws immediately
    resumeOverride(): void;                      // thaw + override until critical episode ends
    state(): LoadGuardPublicState; topUsers(): TopUser[];
    takeNote(provider: Provider, projectPath: string, scope: string): string | null; // NoteBox.take + emitChat({kind:'note'})
  }
  export function getLoadGuard(): LoadGuard | null   // null on non-linux / before start
  ```
- **IPC:**
  - `loadGuard:getState` → `LoadGuardPublicState`
  - `loadGuard:topUsers` → `TopUser[]`
  - `loadGuard:resume` → `void`
  - broadcast `loadGuard:state`
- **Preload:** `loadGuardGetState()`, `loadGuardTopUsers()`, `loadGuardResume()`, `loadGuardOnState(cb) → unsubscribe`.
- **Tick algorithm** (wrap the whole tick in try/catch; on error, devlog `tick_error` and return without changing level or signalling):
  1. Read the system sample (plus GPU on a 10s cadence). Read processes on the cadence from Global Constraints. Push to `History`.
  2. `raw = fake ?? rawLevel(sample, history.swapUsedKbAt(now - 30_000))`, then `stepLevel`.
  3. **On a level change:**
     - devlog `state {from,to,memUsedPct,psi}`
     - entering critical: devlog `critical_snapshot { top, history.summary(120_000) }`
     - entering warning (from either side): `postAll(warningNote(...))`
     - entering normal from warning or critical: `postAll(normalNote())`
     - leaving critical: clear `override`, set `recoveredAt = now`, `thawAll()`
  4. **While critical, enabled and not override:** `freeze` every own-instance sai-ai pid not already frozen (run every tick, so newly spawned pids are caught).
  5. **While critical, enabled, autoKill on, `isSaiFault` true, and ≥5s since the last kill:**
     - `pickKillTarget`, then `killTree`
     - `postTo(tag, killNote)`
     - `emitChat(..., {kind:'killed', ..., toldAi})`
     - if it's an agent: `onAgentKilled(tag)` before the kill
     - devlog `kill {label,kind,sizeKb,tag}`
  6. Broadcast state when any public field changes. `saiAppHeavy` = SAI app processes in the top 3.
- **Boot:**
  - `main.ts`:
    - creates the guard only on linux
    - calls `signaller.recoverFromCrash()` first
    - reads `loadGuardEnabled`/`loadGuardAutoKill` (missing → `true`) and calls `applySettings`
    - sets `fake` from `process.env.SAI_LOAD_GUARD_FAKE` when it is `warning`/`critical`
    - starts the guard
  - The timer is `setInterval(tick, 2000)` with overlap protection (skip a tick if the previous one is still running).

- [ ] **Step 1: Write the failing tests** with fake deps and a `vi` mock signaller:
  - critical with SAI not at fault → `freeze` called with the tagged pids, no kill, state `paused: true`
  - critical with a 7 GiB command → `killTree` on that unit only. A second tick 2s later doesn't kill again. A tick at +5s with still-critical and still-at-fault kills the next unit.
  - an agent unit chosen → `onAgentKilled` called before `killTree`
  - `resumeOverride` → `thawAll`, then the next critical tick doesn't freeze
  - critical → 30s of normal ticks → `thawAll` called, `override` cleared, `recoveredAt` set, normal note posted
  - entering warning → `takeNote('claude','/p','s1')` returns the warning text and `emitChat` got `{kind:'note'}`
  - `applySettings({enabled:false})` while frozen → `thawAll`, and critical ticks no longer freeze
  - `readProcs` rejecting → the tick resolves, the level is unchanged, no signals, devlog `tick_error`
  - an untagged process using 20 GiB with critical → never frozen or killed
- [ ] **Step 2: Run them and confirm they fail.** Run: `npx vitest run tests/unit/electron/loadGuard/index.test.ts --maxWorkers=2`
- [ ] **Step 3: Implement `index.ts`, then wire `main.ts`, `preload.ts` and `src/types.ts`.**
- [ ] **Step 4: Run them and confirm they pass.** Also run `npx vitest run tests/unit/preload.test.ts --maxWorkers=2` and `npx tsc --noEmit -p tsconfig.node.json`. Expected: PASS, no type errors.
- [ ] **Step 5: Commit** `feat(loadguard): orchestrator, IPC and boot wiring`

---

### Task 10: Delivering notes to each provider, plus agent-kill teardown

**Files:**
- Modify:
  - `electron/services/claudeBackend/sdkOptions.ts:156-165`: accept `loadGuardHook?: HookCallback`, add it as `PreToolUse` with **no matcher**, alongside the sudo `Bash` entry, and as `UserPromptSubmit`
  - `electron/services/claudeBackend/sdkBackend.ts:1151-1190`: build the hook per scope
  - `electron/services/claude.ts:1618` (`claude:send`, CLI backend only, since SDK scopes get the hook)
  - `electron/services/codex.ts` (`codex:send`)
  - `electron/services/gemini.ts:239`
  - `electron/services/acpProvider.ts:711`
  - `sdkBackend.ts`: add `suspendScope(projectPath, scope)`, extracted from the idle-sweep `stop` body (`:1927-1937`) and reused there
- Test: `tests/unit/electron/sdkOptions.test.ts`, `tests/unit/electron/loadGuardHook.test.ts`

**Interfaces:**
- Consumes `getLoadGuard()?.takeNote(...)` (Task 9).
- Produces:
  - `buildLoadGuardHook(provider: 'claude', projectPath: string, scope: string): HookCallback`, in `electron/services/loadGuard/hook.ts`. It returns:
    - `{ hookSpecificOutput: { hookEventName: input.hook_event_name, additionalContext: note } }` when a note is pending
    - otherwise `{}`

    It never denies.
  - `withLoadNote(provider: Provider, projectPath: string, scope: string, prompt: string): string`, in `hook.ts`. It returns `` `${note}\n\n${prompt}` `` when a note is pending, otherwise `prompt`.
  - `SdkBackend.suspendScope(projectPath: string, scope?: string): void`. Main's `onAgentKilled` dependency calls it for claude SDK scopes (it's a no-op for scope `'*'` and other providers, which simply die and get restarted on the next send by their existing paths).

- [ ] **Step 1: Write the failing tests:**
  - `buildSdkOptions({ preToolUseHook: sudo, loadGuardHook: lg })` gives `hooks.PreToolUse` = `[{matcher:'Bash',hooks:[sudo]},{hooks:[lg]}]` and `hooks.UserPromptSubmit` = `[{hooks:[lg]}]`
  - with only `loadGuardHook` there's no `Bash` entry
  - `buildLoadGuardHook` returns `additionalContext` once, then `{}`
  - `withLoadNote` prefixes the note once
  - `suspendScope` closes the query, stashes the resume id, emits `scope_suspended`, and the idle-sweep tests still pass
- [ ] **Step 2: Run them and confirm they fail.** Run: `npx vitest run tests/unit/electron/sdkOptions.test.ts tests/unit/electron/loadGuardHook.test.ts tests/unit/electron/sdkBackend.test.ts --maxWorkers=2`
- [ ] **Step 3: Implement** `hook.ts`, the option, the per-scope hook build, `withLoadNote` at the four send handlers, and `suspendScope` plus the main `onAgentKilled` wiring.
- [ ] **Step 4: Run them and confirm they pass**, plus `npx vitest run tests/unit/electron --maxWorkers=2`.
- [ ] **Step 5: Commit** `feat(loadguard): deliver load notes to every provider; clean agent teardown on kill`

---

### Task 11: Renderer state, pill, banner and the paused queue

**Files:**
- Create: `src/hooks/useLoadGuard.ts`, `src/components/Chat/LoadGuardPill.tsx`, `src/components/Chat/LoadGuardBanner.tsx`
- Modify:
  - `src/components/Chat/ChatPanel.tsx`:
    - pill in `.chat-conversation-header` (`:2550`)
    - banner at the top of `.chat-panel` next to `.pinned-prompt-bar` (`:2496`)
    - `handleSend` (`:2193`) queues via `onQueueAdd` when `paused`, the same as busy (`:2371`)
    - the drain effect (`:2392-2485`) also waits for `!paused`
- Test: `tests/unit/components/Chat/LoadGuardBanner.test.tsx`, `tests/unit/components/Chat/LoadGuardPill.test.tsx`, `tests/unit/hooks/useLoadGuard.test.ts`

**Interfaces:**
- Consumes the preload APIs and `LoadGuardPublicState` (Task 9).
- Produces: `useLoadGuard(): LoadGuardPublicState`, which starts as the `getState` result and then follows `loadGuardOnState`. It defaults to `{ level: 'normal', paused: false, … enabled: false }` when the bridge is missing.
- **Visuals:** follow the approved mockups in the spec, using the theme tokens `--accent` (warning), `--red` (critical), `--green` (recovered) and the `--surface-*` scale.

**Copy:**

- **Pill:**
  - warning: `RAM {memUsedPct}%` plus ` · game running` when `game` is set
  - critical and paused: `Paused · critical load`
  - critical with override: `Critical load · resumed manually`
  - normal with `recoveredAt` within 60s: `Recovered`
  - otherwise hidden
- **Banner** (only when `paused`):
  - title: `AI paused: your PC is under heavy load`
  - body: a cause sentence followed by `Resumes automatically once things stay calm for 30s.` The cause sentence is one of:
    - `SAI's processes are a big part of it.` when `saiCaused`
    - `SAI's app itself is using a lot of memory.` when `saiAppHeavy`
    - otherwise `Not caused by SAI.`
  - RAM and swap meters (`memUsedPct`, `swapUsedPct`)
  - buttons:
    - `Resume anyway` calls `loadGuardResume()`
    - `What's using memory?` toggles an inline list from `loadGuardTopUsers()`. Each row shows `label` and `x.x GB`, with `sai-ai` rows in `--red` and an `(SAI)` suffix.
- **Composer placeholder while paused:** `Message… (queued until resume)`

- [ ] **Step 1: Write the failing tests:**
  - pill text for each of the 5 states (and hidden at normal with no recent recovery)
  - banner not rendered when not paused
  - banner cause sentence for each of the 3 cases
  - clicking `Resume anyway` calls `window.sai.loadGuardResume`
  - clicking `What's using memory?` renders `vitest (SAI)` and `7.2 GB` from a mocked `loadGuardTopUsers`
  - `useLoadGuard` updates when the mocked `loadGuardOnState` callback fires and unsubscribes on unmount
- [ ] **Step 2: Run them and confirm they fail.** Run: `npx vitest run tests/unit/components/Chat/LoadGuardBanner.test.tsx tests/unit/components/Chat/LoadGuardPill.test.tsx tests/unit/hooks/useLoadGuard.test.ts --maxWorkers=2`
- [ ] **Step 3: Implement** the hook and components, then the ChatPanel mount, queue gate and placeholder.
- [ ] **Step 4: Run them and confirm they pass**, plus the existing ChatPanel queue tests: `npx vitest run tests/unit/components/Chat --maxWorkers=2`.
- [ ] **Step 5: Commit** `feat(loadguard): load pill, paused banner, queue sends while paused`

---

### Task 12: Chat events (Stopped card, "Told the AI" note, error suppression)

**Files:**
- Create: `src/components/Chat/LoadGuardEventCard.tsx`
- Modify:
  - `src/types.ts`: `ChatMessage` gains `loadGuard?: LoadGuardChatEvent` (re-declare the type in `src/types.ts`; don't import from electron)
  - `src/components/Chat/ChatPanel.tsx` (the `claudeOnMessage` handler `:864`): on `type === 'load_guard'` for this panel's `projectPath` and either its scope or `'*'` with the matching provider, append `{ role: 'system', content: '', loadGuard: ev }`
  - `src/components/Chat/ChatMessage.tsx`: render `LoadGuardEventCard` when `message.loadGuard` is set
- Test: `tests/unit/components/Chat/LoadGuardEventCard.test.tsx`, plus a ChatPanel handler test in the existing ChatPanel test file

**Interfaces:**
- Consumes `LoadGuardChatEvent` (Task 9).

**Copy:**
- **`note` event:** a callout titled `System load:` followed by the note text with its `[SAI system load: …]` prefix stripped.
- **`killed` event:**
  - a card with a `Stopped` tag and the struck-through `label`
  - the body: `SAI stopped this to keep your PC from freezing. It was using {size} GB while RAM hit {memUsedPct}%.`
  - the `top` list, with `sai-ai` rows highlighted
  - a `Told the AI:` callout containing `toldAi`
  - for `unitKind === 'agent'`, the title line reads `Stopped to save your PC` and the body adds `This chat will pick up where it left off when you send your next message.`
- **Error suppression:** after a `killed` event for this scope, ChatPanel ignores `error` messages for 15s and marks the turn done, the same as a normal `done` (reuse the existing done path), so the kill reads as a deliberate stop, not a crash.

- [ ] **Step 1: Write the failing tests:**
  - the card renders the exact body copy for `vitest`, 7.2 GB, 97%
  - the agent variant shows `Stopped to save your PC` and the resume sentence
  - the note variant strips the prefix
  - ChatPanel: a `load_guard` killed event for scope `s1` appends one system message, then an `error` 3s later is ignored and streaming ends; an `error` 16s later is shown
  - an event for scope `'*'` with provider `codex` isn't appended to a claude panel
- [ ] **Step 2: Run them and confirm they fail.** Run: `npx vitest run tests/unit/components/Chat --maxWorkers=2`
- [ ] **Step 3: Implement** the card, type, handler and render branch.
- [ ] **Step 4: Run them and confirm they pass.**
- [ ] **Step 5: Commit** `feat(loadguard): stopped card, told-the-AI note, kill error suppression`

---

### Task 13: Settings toggles and live smoke

**Files:**
- Modify: `src/components/SettingsModal.tsx`, General page (`renderGeneralPage`, `:971`). Load the state alongside the other settings (around `:288`) and save via `settingsSet` (the same pattern as `claudeBackend`, `:501`). Main's side effects come from Task 9.
- Test: `tests/unit/components/SettingsModal.loadGuard.test.tsx`

**Copy:**
- `Protect my PC from overload`, with the description `Pause AI work when memory runs critically low, and tell the AI when the system is busy.`
- `Stop SAI's heavy processes when needed`, with the description `If SAI's own work is what's overloading your PC, stop the biggest offender.` This toggle is disabled when the first one is off.
- Both toggles are hidden when `window.sai.platform !== 'linux'`. Use the existing platform check in SettingsModal if there is one; otherwise add `platform` to preload.

- [ ] **Step 1: Write the failing tests:**
  - both toggles render checked by default
  - unchecking the first calls `settingsSet('loadGuardEnabled', false)` and disables the second
- [ ] **Step 2: Run them and confirm they fail.** Run: `npx vitest run tests/unit/components/SettingsModal.loadGuard.test.tsx --maxWorkers=2`
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and confirm they pass**, then the full suite: `npx vitest run --maxWorkers=2`. Expected: all PASS.
- [ ] **Step 5: Live smoke with the fake level.** Never stress the real machine.
  1. Start SAI dev with `SAI_LOAD_GUARD_FAKE=warning`, start a chat, ask it to run `ls`, and confirm:
     - the pill shows `RAM n%`
     - the "System load:" note appears in the chat
     - the AI's reply acknowledges the load
  2. Restart with `SAI_LOAD_GUARD_FAKE=critical` while a chat runs `sleep 120; echo done`, and confirm:
     - the banner shows
     - `ps -o stat= -p <sleep pid>` shows `T`
     - typing queues
     - `Resume anyway` thaws (`S`)
     - quitting SAI leaves nothing in state `T`
  3. Check `~/.config/sai/logs/devlog.jsonl` has `loadguard` `state`/`critical_snapshot` entries.
  4. Capture the banner with `sai_capture_app` for the user.
- [ ] **Step 6: Commit** `feat(loadguard): settings toggles`
