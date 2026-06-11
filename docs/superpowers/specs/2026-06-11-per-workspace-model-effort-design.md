# Per-Workspace Model + Effort — Design

**Date:** 2026-06-11
**Status:** Approved

## Goal

Each workspace can set its own Claude model and thinking/effort level. Semantics:
**override with global default** — a workspace with no override follows the app-wide
setting (including later changes to it); explicitly picking a value in a workspace
detaches that workspace until its override is cleared.

Scope: Claude only. Codex/Gemini keep their existing global settings (the same pattern
can be applied later).

## 1. State + persistence

- App.tsx gains `claudeWorkspaceOverrides: Map<string, { model?: ModelChoice; effort?: EffortLevel }>`.
- Persisted under the settings key `claude.workspaceOverrides` as an object keyed by
  projectPath — the SAME path strings used as keys of the `workspaces` Map, never
  re-derived from another path form (this machine's `/home` ↔ `/var/home` symlink makes
  path-string matching a known trap).
- Writes are read-modify-write like the existing `saveClaudeSetting` pattern
  (App.tsx ~3700). Clearing an override deletes that field; an entry with no fields left
  is removed. Paths for workspaces that no longer exist are ignored on load and pruned
  on the next write.
- The existing global keys `claude.model` / `claude.effort` keep their current meaning
  (the defaults). No migration needed.

## 2. Resolution

- Pure helper (new `src/lib/claudeWorkspaceConfig.ts`):
  `resolveClaudeConfig(overrides, wsPath, globals) → { model, effort }`
  where each field is `override ?? global`. Partial overrides (only model, only effort)
  resolve field-by-field.
- App.tsx computes the effective values where ChatPanel props are passed (both the
  regular ChatPanel and the orchestrator ChatPanel), keyed by that panel's workspace
  path (meta-workspaces use their synthetic root path).
- The per-message send path (`claudeSend(..., effort, model, scope)`) is untouched — it
  already carries values per call, so different workspaces sending different values
  needs no backend changes.
- Existing behavior, documented not changed: when a workspace's effective model/effort
  changes, that workspace's CLI process respawns on the next send and its session
  context restarts.

## 3. Picker UI (`src/components/Chat/ChatInput.tsx`)

The existing model and effort menus become workspace-scoped:

- Top entry: **"Default — follow app setting (<current global model · effort>)"**,
  showing the live global values. Selecting it clears that workspace's override for
  that field.
- The remaining entries set the workspace override (current behavior, new scope).
- Each concrete choice row gets a secondary **"make default"** affordance that writes
  the GLOBAL key (`claude.model` / `claude.effort`) instead, leaving the workspace's
  override state untouched.
- When the workspace has an override, the picker trigger shows a subtle marker
  (dot/asterisk) so a detached workspace is visible at a glance.

## 4. Error handling

- Unknown/stale paths in `claude.workspaceOverrides` are ignored at load, pruned on
  write.
- Invalid persisted values (not a known ModelChoice/EffortLevel) are dropped at load
  using the same validation guards the global load path uses (App.tsx ~1966).

## 5. Testing

- Unit: `resolveClaudeConfig` (override wins; fallback to global; partial override;
  unknown path → globals).
- Unit: overrides settings round-trip (load validation drops invalid values; write
  prunes empty entries) using the existing settings mock patterns.
- Picker: component test if ChatInput has existing test precedent, otherwise manual —
  set override, confirm marker; clear via Default entry; "make default" changes the
  global and other workspaces follow.
