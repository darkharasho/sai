# Per-Workspace Model + Effort Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each workspace can override the Claude model and effort; unset workspaces follow the app-wide defaults, which move to the Settings modal.

**Architecture:** A pure module `src/lib/claudeWorkspaceConfig.ts` owns the override map (resolve/set/sanitize). App.tsx holds the map (persisted inside the nested `claude` settings object as `workspaceOverrides`), resolves effective values per ChatPanel, and hands workspace-scoped handlers down. ChatInput's controls become pure overrides (model dropdown "Follow Settings" entry; effort cycle gains a Default stop). SettingsModal's AI Provider section gains the global model/effort rows.

**Tech Stack:** TypeScript, React, Vitest (worker cap 2 — do not raise).

**Spec:** `docs/superpowers/specs/2026-06-11-per-workspace-model-effort-design.md`

**Setup:** fresh branch off `main`: `git checkout -b per-workspace-model-effort`. Subagents: NEVER `git checkout` a commit SHA — use `git show <sha>` to inspect.

**Key existing code (verify exact lines by searching the quoted code; they drift):**
- Global state: `src/App.tsx:194-196` (`effortLevel`, `modelChoice`), `:205` (`claudeModels`)
- Load: `src/App.tsx:~1966` `window.sai.settingsGet('claude', {})` → `c.model`, `c.effort` with validation guards
- Save: `src/App.tsx:~3700` `saveClaudeSetting(key, value)` read-modify-writes the nested `claude` object; `handleModelChange` / `handleEffortChange` call it
- ChatPanel prop sites: `src/App.tsx:~3980` (orchestrator) and `~4299` (regular) pass `effortLevel/onEffortChange/modelChoice/onModelChange/availableModels`
- ChatInput pickers: `src/components/Chat/ChatInput.tsx:119-124` (`EFFORT_CONFIG`), `:1165-1180` (effort cycle button), `:1182-1215` (Claude model dropdown). NOTE: the model list already contains an id `'default'` meaning "account's recommended model" — the new follow-settings entry must NOT reuse that id or the word alone; label it "Follow Settings".
- SettingsModal AI Provider section: `src/components/SettingsModal.tsx:683-803` (`settings-row` pattern with `provider-select` dropdowns)
- Types `ModelChoice` / `EffortLevel`: defined in `src/types.ts` (verify import path used by App.tsx)

---

### Task 1: Pure module — override map resolve/set/sanitize

**Files:**
- Create: `src/lib/claudeWorkspaceConfig.ts`
- Test: `tests/unit/lib/claudeWorkspaceConfig.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/lib/claudeWorkspaceConfig.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  resolveClaudeConfig,
  setWorkspaceOverride,
  sanitizeOverrideMap,
  type ClaudeOverrideMap,
} from '@/lib/claudeWorkspaceConfig';

const globals = { model: 'sonnet', effort: 'high' } as const;

describe('resolveClaudeConfig', () => {
  it('no override → globals, not flagged', () => {
    expect(resolveClaudeConfig({}, '/ws', globals)).toEqual({
      model: 'sonnet', effort: 'high', modelOverridden: false, effortOverridden: false,
    });
  });
  it('full override wins and is flagged', () => {
    const map: ClaudeOverrideMap = { '/ws': { model: 'opus', effort: 'max' } };
    expect(resolveClaudeConfig(map, '/ws', globals)).toEqual({
      model: 'opus', effort: 'max', modelOverridden: true, effortOverridden: true,
    });
  });
  it('partial override resolves field-by-field', () => {
    const map: ClaudeOverrideMap = { '/ws': { effort: 'low' } };
    expect(resolveClaudeConfig(map, '/ws', globals)).toEqual({
      model: 'sonnet', effort: 'low', modelOverridden: false, effortOverridden: true,
    });
  });
  it('other workspaces are unaffected', () => {
    const map: ClaudeOverrideMap = { '/other': { model: 'opus' } };
    expect(resolveClaudeConfig(map, '/ws', globals).model).toBe('sonnet');
  });
});

describe('setWorkspaceOverride', () => {
  it('sets a field immutably', () => {
    const map: ClaudeOverrideMap = {};
    const next = setWorkspaceOverride(map, '/ws', { model: 'opus' });
    expect(next['/ws']).toEqual({ model: 'opus' });
    expect(map).toEqual({});
  });
  it('null clears a field; empty entries are pruned', () => {
    const map: ClaudeOverrideMap = { '/ws': { model: 'opus', effort: 'low' } };
    const a = setWorkspaceOverride(map, '/ws', { model: null });
    expect(a['/ws']).toEqual({ effort: 'low' });
    const b = setWorkspaceOverride(a, '/ws', { effort: null });
    expect(b['/ws']).toBeUndefined();
  });
});

describe('sanitizeOverrideMap', () => {
  const isModel = (v: unknown): v is string => v === 'sonnet' || v === 'opus';
  const isEffort = (v: unknown): v is string => v === 'low' || v === 'high';
  it('drops invalid values and empty entries, keeps valid ones', () => {
    const raw = {
      '/a': { model: 'opus', effort: 'turbo' },
      '/b': { model: 'gpt5' },
      '/c': { effort: 'low' },
      '/d': 'nonsense',
    };
    expect(sanitizeOverrideMap(raw, isModel as any, isEffort as any)).toEqual({
      '/a': { model: 'opus' },
      '/c': { effort: 'low' },
    });
  });
  it('non-object input → empty map', () => {
    expect(sanitizeOverrideMap(null, isModel as any, isEffort as any)).toEqual({});
    expect(sanitizeOverrideMap('x', isModel as any, isEffort as any)).toEqual({});
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run --project unit tests/unit/lib/claudeWorkspaceConfig.test.ts`
Expected: FAIL — module unresolved.

- [ ] **Step 3: Implementation**

Create `src/lib/claudeWorkspaceConfig.ts`:

```ts
import type { EffortLevel, ModelChoice } from '../types';

export interface ClaudeWorkspaceOverride {
  model?: ModelChoice;
  effort?: EffortLevel;
}
/** Keyed by projectPath — the SAME strings used as keys of the workspaces Map.
 *  Never re-derive keys from another path form (symlinked-home trap). */
export type ClaudeOverrideMap = Record<string, ClaudeWorkspaceOverride>;

export interface ResolvedClaudeConfig {
  model: ModelChoice;
  effort: EffortLevel;
  modelOverridden: boolean;
  effortOverridden: boolean;
}

export function resolveClaudeConfig(
  overrides: ClaudeOverrideMap,
  wsPath: string,
  globals: { model: ModelChoice; effort: EffortLevel },
): ResolvedClaudeConfig {
  const o = overrides[wsPath] ?? {};
  return {
    model: o.model ?? globals.model,
    effort: o.effort ?? globals.effort,
    modelOverridden: o.model != null,
    effortOverridden: o.effort != null,
  };
}

/** Immutable update; null clears a field; entries with no fields left are pruned. */
export function setWorkspaceOverride(
  overrides: ClaudeOverrideMap,
  wsPath: string,
  patch: { model?: ModelChoice | null; effort?: EffortLevel | null },
): ClaudeOverrideMap {
  const current = { ...(overrides[wsPath] ?? {}) };
  if ('model' in patch) {
    if (patch.model == null) delete current.model;
    else current.model = patch.model;
  }
  if ('effort' in patch) {
    if (patch.effort == null) delete current.effort;
    else current.effort = patch.effort;
  }
  const next = { ...overrides };
  if (Object.keys(current).length === 0) delete next[wsPath];
  else next[wsPath] = current;
  return next;
}

/** Validate a persisted map: drop unknown shapes and invalid values. */
export function sanitizeOverrideMap(
  raw: unknown,
  isModel: (v: unknown) => v is ModelChoice,
  isEffort: (v: unknown) => v is EffortLevel,
): ClaudeOverrideMap {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: ClaudeOverrideMap = {};
  for (const [path, entry] of Object.entries(raw as Record<string, unknown>)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const e = entry as Record<string, unknown>;
    const cleaned: ClaudeWorkspaceOverride = {};
    if (isModel(e.model)) cleaned.model = e.model;
    if (isEffort(e.effort)) cleaned.effort = e.effort;
    if (Object.keys(cleaned).length > 0) out[path] = cleaned;
  }
  return out;
}
```

(If `ModelChoice`/`EffortLevel` are not exported from `src/types.ts`, locate their actual home with `grep -rn "type ModelChoice" src` and import from there.)

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run --project unit tests/unit/lib/claudeWorkspaceConfig.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/claudeWorkspaceConfig.ts tests/unit/lib/claudeWorkspaceConfig.test.ts
git commit -m "feat(claude): workspace override map — resolve/set/sanitize"
```

---

### Task 2: App.tsx — state, persistence, resolution, prop plumbing

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/Chat/ChatPanel.tsx` (prop types + forwarding only)

- [ ] **Step 1: State + load**

In App.tsx, next to the existing claude state (~line 196), add:

```ts
  const [claudeWsOverrides, setClaudeWsOverrides] = useState<ClaudeOverrideMap>({});
```

with imports:

```ts
import { resolveClaudeConfig, setWorkspaceOverride, sanitizeOverrideMap, type ClaudeOverrideMap } from './lib/claudeWorkspaceConfig';
```

In the settings-load effect where `settingsGet('claude', {})` is consumed (~1966), add after the existing model/effort/permission guards (reusing the SAME validation predicates used there — if they're inline conditions today, extract them as `isModelChoice` / `isEffortLevel` local guards so `sanitizeOverrideMap` can take them):

```ts
    setClaudeWsOverrides(sanitizeOverrideMap(c.workspaceOverrides, isModelChoice, isEffortLevel));
```

- [ ] **Step 2: Workspace-scoped handlers**

Next to `handleModelChange`/`handleEffortChange` (~3700), add:

```ts
  const handleWorkspaceModelChange = (wsPath: string, model: ModelChoice | null) => {
    setClaudeWsOverrides(prev => {
      const next = setWorkspaceOverride(prev, wsPath, { model });
      saveClaudeSetting('workspaceOverrides', next);
      return next;
    });
  };
  const handleWorkspaceEffortChange = (wsPath: string, effort: EffortLevel | null) => {
    setClaudeWsOverrides(prev => {
      const next = setWorkspaceOverride(prev, wsPath, { effort });
      saveClaudeSetting('workspaceOverrides', next);
      return next;
    });
  };
```

(`handleModelChange`/`handleEffortChange` remain the GLOBAL setters — they move to SettingsModal in Task 4.)

- [ ] **Step 3: Resolve at both ChatPanel prop sites**

At BOTH ChatPanel render sites (regular ~4299, orchestrator ~3980 — locate by the `effortLevel={effortLevel}` props), compute above the JSX (the orchestrator panel's workspace path is its synthetic root — use the same path variable that site already uses for `projectPath`):

```ts
const wsClaudeCfg = resolveClaudeConfig(claudeWsOverrides, wsPath, { model: modelChoice, effort: effortLevel });
```

and replace the four props with:

```tsx
  effortLevel={wsClaudeCfg.effort}
  onEffortChange={(level) => handleWorkspaceEffortChange(wsPath, level)}
  modelChoice={wsClaudeCfg.model}
  onModelChange={(model) => handleWorkspaceModelChange(wsPath, model)}
  claudeOverrideState={{
    modelOverridden: wsClaudeCfg.modelOverridden,
    effortOverridden: wsClaudeCfg.effortOverridden,
    globalModel: modelChoice,
    globalEffort: effortLevel,
  }}
```

(`wsPath` = whatever variable that site uses for the workspace's project path.)

- [ ] **Step 4: ChatPanel prop types + forwarding**

In `src/components/Chat/ChatPanel.tsx` (~lines 94-97), change:

```ts
  effortLevel: 'low' | 'medium' | 'high' | 'max';
  onEffortChange: (level: 'low' | 'medium' | 'high' | 'max') => void;
  modelChoice: ModelChoice;
  onModelChange: (model: ModelChoice) => void;
```

to:

```ts
  effortLevel: 'low' | 'medium' | 'high' | 'max';
  onEffortChange: (level: 'low' | 'medium' | 'high' | 'max' | null) => void;
  modelChoice: ModelChoice;
  onModelChange: (model: ModelChoice | null) => void;
  claudeOverrideState?: {
    modelOverridden: boolean;
    effortOverridden: boolean;
    globalModel: ModelChoice;
    globalEffort: 'low' | 'medium' | 'high' | 'max';
  };
```

(match the file's actual type aliases — if it imports `EffortLevel`/`ModelChoice`, use those). Forward `claudeOverrideState` to `<ChatInput …>` where the other four props are forwarded. The panel's internal uses of `effortLevel`/`modelChoice` (the `claudeSend`/`claudeCompact` calls) stay as-is — the props are already the effective values.

- [ ] **Step 5: Verify + commit**

Run: `npx tsc --noEmit` — EXPECT errors in ChatInput (handler types now accept null; `claudeOverrideState` unused) ONLY if ChatInput declares the narrower types; if it errors, proceed to Task 3 in the same branch state but commit App/ChatPanel separately only when tsc is clean. If tsc is clean, also run `npx vitest run --project unit`.

```bash
git add src/App.tsx src/components/Chat/ChatPanel.tsx
git commit -m "feat(claude): per-workspace override state, resolution, and plumbing"
```

(If tsc cannot be made clean without the Task 3 ChatInput changes, do Tasks 2+3 as one commit — note it in the report.)

- [ ] **Step 6: Sweep other ChatInput/ChatPanel consumers**

`grep -rn "onModelChange\|onEffortChange" src --include="*.tsx" | grep -v "ChatInput.tsx\|ChatPanel.tsx\|App.tsx"` — update any other callers (e.g. test harness stories) for the widened `| null` types.

---

### Task 3: ChatInput — override controls

**Files:**
- Modify: `src/components/Chat/ChatInput.tsx` (EFFORT_CONFIG ~119-124, effort button ~1165-1180, model dropdown ~1182-1215, props)
- Test: extend an existing ChatInput test file if present (`grep -rln "ChatInput" tests/unit`), else rely on tsc + manual.

- [ ] **Step 1: Props**

Add to `ChatInputProps` and destructure in the signature (~258):

```ts
  claudeOverrideState?: {
    modelOverridden: boolean;
    effortOverridden: boolean;
    globalModel: ModelChoice;
    globalEffort: EffortLevel;
  };
```

and widen `onEffortChange: (level: EffortLevel | null) => void;` / `onModelChange: (model: ModelChoice | null) => void;`.

- [ ] **Step 2: Effort cycle with Default stop**

Replace the effort button block (~1166-1180) with:

```tsx
          {getCapabilities(aiProvider).hasEffortMode && (() => {
            const ov = claudeOverrideState;
            const onDefault = ov ? !ov.effortOverridden : false;
            const cfg = EFFORT_CONFIG[effortLevel];
            const Icon = onDefault ? Settings2 : cfg.icon;
            // Cycle: low → medium → high → max → Default(clear) → low …
            const next: EffortLevel | null = onDefault ? 'low' : cfg.next === 'low' ? (ov ? null : 'low') : cfg.next;
            return (
              <button
                className="toolbar-btn effort-btn"
                onClick={() => onEffortChange(next)}
                title={onDefault
                  ? `Effort: follows Settings (${ov!.globalEffort}) — Click to override`
                  : `Effort: ${effortLevel} (workspace override) — Click to cycle`}
                style={{ color: onDefault ? 'var(--text-muted)' : cfg.color }}
              >
                <Icon size={15} />
                <span className="effort-label">{onDefault ? `Def·${EFFORT_CONFIG[ov!.globalEffort].label}` : cfg.label}</span>
                {!onDefault && ov && <span className="override-dot" aria-hidden />}
              </button>
            );
          })()}
```

Import `Settings2` from `lucide-react` alongside the other icon imports. When `claudeOverrideState` is undefined (legacy callers), behavior is exactly today's cycle (the `ov ? null : 'low'` branch).

- [ ] **Step 3: Model dropdown Follow-Settings entry**

Inside the Claude model dropdown (~1193-1213), insert ABOVE the `{modelOptions.map(...)}` list:

```tsx
                {claudeOverrideState && (
                  <button
                    className={`model-dropdown-item ${!claudeOverrideState.modelOverridden ? 'active' : ''}`}
                    onClick={() => { onModelChange(null); setModelMenuOpen(false); }}
                  >
                    <div className="model-dropdown-item-info">
                      <span className="model-dropdown-item-name">
                        Follow Settings
                        <span className="model-recommended">
                          ({modelOptions.find(m => m.id === claudeOverrideState.globalModel)?.label ?? claudeOverrideState.globalModel})
                        </span>
                      </span>
                      <span className="model-dropdown-item-desc">Use the app-wide default for this workspace</span>
                    </div>
                    {!claudeOverrideState.modelOverridden && <Check size={14} style={{ flexShrink: 0 }} />}
                  </button>
                )}
```

The existing entries keep calling `onModelChange(opt.id)` (now an override). Active-state: the `opt.id === modelChoice` checks stay (effective value), but only mark concrete entries active when `claudeOverrideState?.modelOverridden !== false` — change the item className condition to:

```ts
className={`model-dropdown-item ${opt.id === modelChoice && (claudeOverrideState?.modelOverridden ?? true) ? 'active' : ''}`}
```

and gate the trailing `<Check …>` the same way. Add the override marker on the trigger button label:

```tsx
              <span className="model-label">{modelOptions.find(m => m.id === modelChoice)?.label ?? modelChoice}{claudeOverrideState?.modelOverridden ? ' •' : ''}</span>
```

- [ ] **Step 4: `override-dot` style**

In the stylesheet ChatInput uses (locate: `grep -n "effort-label" src/components/Chat/*.css`), add:

```css
.override-dot { width: 4px; height: 4px; border-radius: 50%; background: currentColor; display: inline-block; margin-left: 2px; }
```

- [ ] **Step 5: Verify + commit**

Run: `npx tsc --noEmit && npx vitest run --project unit`
Expected: clean, all pass.

```bash
git add src/components/Chat/ChatInput.tsx src/components/Chat/*.css
git commit -m "feat(claude): chat controls become per-workspace overrides"
```

---

### Task 4: SettingsModal — global defaults UI

**Files:**
- Modify: `src/components/SettingsModal.tsx` (AI Provider section, ~683-803)
- Modify: `src/App.tsx` (SettingsModal render site — pass props)

- [ ] **Step 1: Props**

Add to SettingsModal's props interface:

```ts
  claudeModel: ModelChoice;
  onClaudeModelChange: (m: ModelChoice) => void;
  claudeEffort: EffortLevel;
  onClaudeEffortChange: (e: EffortLevel) => void;
  claudeModels: ClaudeModelOption[];
```

(import the types the same way App.tsx does). At the App.tsx render site (`grep -n "<SettingsModal" src/App.tsx`), pass:

```tsx
  claudeModel={modelChoice}
  onClaudeModelChange={handleModelChange}
  claudeEffort={effortLevel}
  onClaudeEffortChange={handleEffortChange}
  claudeModels={claudeModels}
```

- [ ] **Step 2: Rows**

In the AI Provider section, after the "Chat provider" row (~line 727), add two `settings-row`s following the existing `provider-select` dropdown pattern (own open-state + outside-click ref, like `providerRef`):

- **"Claude model — Default for all workspaces; chats can override per workspace"**: dropdown listing `claudeModels` (fallback: just show current value if the list is empty), active item = `claudeModel`, click → `onClaudeModelChange(id)`.
- **"Claude effort — Default thinking effort; chats can override per workspace"**: dropdown with the four levels `low/medium/high/max`, active = `claudeEffort`, click → `onClaudeEffortChange(level)`.

Reuse the `provider-dropdown` / `provider-dropdown-item` classes for both (they're generic list styles).

- [ ] **Step 3: Verify + commit**

Run: `npx tsc --noEmit && npx vitest run --project unit`
Expected: clean, all pass.

```bash
git add src/components/SettingsModal.tsx src/App.tsx
git commit -m "feat(claude): global model/effort defaults in Settings"
```

---

### Task 5: Verification

- [ ] **Step 1:** `npx tsc --noEmit && npx vitest run` — all pass. `npx vite build --config vite.config.pwa.ts` — builds.
- [ ] **Step 2:** Manual (app restart): set workspace A to opus via the chat picker (trigger shows `•`), confirm workspace B still shows the global; change the global in Settings → B follows, A stays opus; pick "Follow Settings" in A → A follows again; cycle effort to the `Def·Hi` stop and confirm the override clears; restart the app and confirm overrides persisted.
- [ ] **Step 3:** Commit fixups if any.
