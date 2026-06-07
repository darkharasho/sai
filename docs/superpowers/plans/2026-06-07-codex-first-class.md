# Codex First-Class Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand the Codex settings page with default model and permission mode controls, wired through `onSettingChange` in App.tsx so changes take effect immediately.

**Architecture:** Runs after the Gemini first-class pass. `capabilities.ts`, unified IPC routing, strict session filtering, and the NavBar Swarm gate are all already in place. This pass is purely a settings UI expansion for Codex.

**Tech Stack:** TypeScript, React, Vitest, React Testing Library

---

## Prerequisites

The following must be complete before starting:

- `src/providers/capabilities.ts` exists with Codex capability flags
- `src/lib/sessionProvider.ts` exists
- `src/components/NavBar.tsx` has the `hasOrchestrator` prop
- `src/App.tsx` imports `getCapabilities` and passes it to NavBar
- Confirm: `npx vitest run --project unit --pool=forks --poolOptions.forks.maxForks=2` passes

---

## Existing state (read before touching code)

- `codexModel` state at `App.tsx:173`, loaded from `settingsGet('codex', {}).model` at `App.tsx:1725`
- `codexPermission` state at `App.tsx:175`, loaded from `settingsGet('codex', {}).permission` at `App.tsx:1727`
- `saveCodexSetting(key, value)` helper at `App.tsx:3401`
- `handleCodexModelChange` at `App.tsx:3423`, `handleCodexPermissionChange` at `App.tsx:3428`
- Codex settings page currently shows only static text ("Model and permission mode live in the chat toolbar")

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `src/components/SettingsModal.tsx` | **Modify** | Add codex default model + permission controls |
| `src/App.tsx` | **Modify** | Add `codexModel` / `codexPermission` onSettingChange handlers |
| `tests/unit/components/SettingsModal.test.tsx` | **Modify** (if exists) | Settings round-trip tests |

---

## Task 1: Expand Codex settings page

**Files:**
- Modify: `src/components/SettingsModal.tsx`
- Modify: `src/App.tsx`

The Codex model list is fetched dynamically from the CLI via `codex:models`. The settings modal will fetch it on mount (same as App.tsx does). If the CLI isn't installed or returns nothing, the model field falls back gracefully.

- [ ] **Step 1: Add state to SettingsModal**

Open `src/components/SettingsModal.tsx`. After the last state declaration in the component (look for the state block around lines 85-110), add:

```typescript
const [codexDefaultModel, setCodexDefaultModel] = useState('');
const [codexDefaultPermission, setCodexDefaultPermission] = useState<'auto' | 'read-only' | 'full-access'>('auto');
const [codexAvailableModels, setCodexAvailableModels] = useState<{ id: string; name: string }[]>([]);
```

- [ ] **Step 2: Load from settings and fetch models on mount**

Find the `useEffect` that calls `settingsGet` (around line 113). Add inside it:

```typescript
window.sai.settingsGet('codex', {}).then((c: any) => {
  if (c.model) setCodexDefaultModel(c.model);
  if (c.permission === 'auto' || c.permission === 'read-only' || c.permission === 'full-access') setCodexDefaultPermission(c.permission);
});
window.sai.codexModels?.().then((result: { models: { id: string; name: string }[]; defaultModel: string } | undefined) => {
  if (result?.models?.length) {
    setCodexAvailableModels(result.models);
    // functional update avoids stale closure — settings and models fetch run concurrently
    setCodexDefaultModel(prev => prev || result.defaultModel || '');
  }
}).catch(() => {});
```

Note: `window.sai.codexModels` may not be available if Codex CLI isn't installed — the `.catch(() => {})` handles that silently.

- [ ] **Step 3: Add change handlers**

Find `handleGeminiLoadingPhrasesChange` (around line 285). After it, add:

```typescript
const handleCodexDefaultModelChange = (model: string) => {
  setCodexDefaultModel(model);
  window.sai.settingsGet('codex', {}).then((existing: any) => {
    window.sai.settingsSet('codex', { ...existing, model });
  });
  onSettingChange?.('codexModel', model);
};

const handleCodexDefaultPermissionChange = (permission: 'auto' | 'read-only' | 'full-access') => {
  setCodexDefaultPermission(permission);
  window.sai.settingsGet('codex', {}).then((existing: any) => {
    window.sai.settingsSet('codex', { ...existing, permission });
  });
  onSettingChange?.('codexPermission', permission);
};
```

- [ ] **Step 4: Replace the Codex settings page content**

Find `renderCodexPage` in `SettingsModal.tsx`. Replace the static-text placeholder with:

```typescript
const renderCodexPage = () => (
  <section className="settings-section">
    <div className="settings-section-label">Codex</div>
    {codexAvailableModels.length > 0 && (
      <div className="settings-row">
        <div className="settings-row-info">
          <div className="settings-row-name">Default model</div>
          <div className="settings-row-desc">Pre-selected model when starting a new Codex session</div>
        </div>
        <select
          className="settings-select"
          value={codexDefaultModel}
          onChange={e => handleCodexDefaultModelChange(e.target.value)}
        >
          {codexAvailableModels.map(m => (
            <option key={m.id} value={m.id}>{m.name || m.id}</option>
          ))}
        </select>
      </div>
    )}
    <div className="settings-row">
      <div className="settings-row-info">
        <div className="settings-row-name">Default permission mode</div>
        <div className="settings-row-desc">How Codex handles file system and shell access</div>
      </div>
      <select
        className="settings-select"
        value={codexDefaultPermission}
        onChange={e => handleCodexDefaultPermissionChange(e.target.value as any)}
      >
        <option value="auto">Auto (sandboxed)</option>
        <option value="read-only">Read-only</option>
        <option value="full-access">Full access</option>
      </select>
    </div>
  </section>
);
```

- [ ] **Step 5: Add onSettingChange handlers in App.tsx**

Open `src/App.tsx`. Find the `onSettingChange` handler (around line 4325). After the Gemini handlers added in the previous plan, add:

```typescript
if (key === 'codexModel') handleCodexModelChange(value);
if (key === 'codexPermission') handleCodexPermissionChange(value);
```

Where `handleCodexModelChange` and `handleCodexPermissionChange` are the existing handlers at `App.tsx:3423` and `App.tsx:3428`.

- [ ] **Step 6: Run full unit test suite**

```bash
npx vitest run --project unit --pool=forks --poolOptions.forks.maxForks=2
```

Expected: All pass.

- [ ] **Step 7: Commit**

```bash
git add src/components/SettingsModal.tsx src/App.tsx
git commit -m "feat: expand Codex settings page with default model and permission mode"
```

---

## Task 2: Manual smoke test

- [ ] **Step 1: Manual smoke test checklist**

Start the app (`npm run dev`) and verify:

1. Open Settings → Codex page
   - If Codex CLI is installed: model dropdown shows available models
   - If Codex CLI is not installed: model section hidden, permission dropdown shows
2. Change default permission mode → switch to Codex in main settings → start new session → permission pre-set in toolbar
3. Change default model (if available) → start new session → model pre-selected in toolbar
4. Rapidly switch Claude → Gemini → Codex → Claude — each switch shows correct history, correct toolbar, correct settings
5. No console errors during any provider switch

- [ ] **Step 2: Commit if any fixes needed**

```bash
git add -p
git commit -m "fix: codex settings smoke test fixes"
```
