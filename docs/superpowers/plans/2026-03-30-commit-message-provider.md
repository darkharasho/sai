# Commit Message AI Provider Setting — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a separate `commitMessageProvider` setting so users can choose which AI provider generates commit messages independently from the chat provider.

**Architecture:** New setting key `commitMessageProvider` follows the same pattern as `aiProvider`. State flows from `App.tsx` → `GitSidebar` → `CommitBox` via the `onGenerateMessage` callback closure. A new dropdown in `SettingsModal` mirrors the existing chat provider dropdown.

**Tech Stack:** React, Electron IPC, TypeScript

---

### Task 1: Add `commitMessageProvider` state to App.tsx

**Files:**
- Modify: `src/App.tsx:88` (state declaration)
- Modify: `src/App.tsx:163-165` (settings load)
- Modify: `src/App.tsx:213` (GitHub sync apply)
- Modify: `src/App.tsx:1042-1046` (onSettingChange handler)
- Modify: `src/App.tsx:1053` (GitSidebar prop)

- [ ] **Step 1: Add state declaration**

At line 88, after the `aiProvider` state declaration, add:

```typescript
const [commitMessageProvider, setCommitMessageProvider] = useState<AIProvider>('claude');
```

- [ ] **Step 2: Load setting on startup**

At line 165, after the `aiProvider` settings load block, add:

```typescript
window.sai.settingsGet('commitMessageProvider', 'claude').then((v: string) => {
  if (v === 'claude' || v === 'codex' || v === 'gemini') setCommitMessageProvider(v as AIProvider);
});
```

- [ ] **Step 3: Handle GitHub sync apply**

At line 213, after the `aiProvider` sync handler, add:

```typescript
if ('commitMessageProvider' in remote && (remote.commitMessageProvider === 'claude' || remote.commitMessageProvider === 'codex' || remote.commitMessageProvider === 'gemini')) setCommitMessageProvider(remote.commitMessageProvider);
```

- [ ] **Step 4: Handle onSettingChange from SettingsModal**

At line 1045, after the `aiProvider` case in the `onSettingChange` handler, add:

```typescript
if (key === 'commitMessageProvider') setCommitMessageProvider(value);
```

- [ ] **Step 5: Pass commitMessageProvider to GitSidebar**

At line 1053, update the GitSidebar usage to pass the new prop:

```typescript
{sidebarOpen === 'git' && <GitSidebar projectPath={projectPath} onFileClick={handleFileClick} aiProvider={aiProvider} commitMessageProvider={commitMessageProvider} />}
```

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx
git commit -m "feat: add commitMessageProvider state to App.tsx"
```

---

### Task 2: Update GitSidebar to use commitMessageProvider

**Files:**
- Modify: `src/components/Git/GitSidebar.tsx:24-28` (props interface)
- Modify: `src/components/Git/GitSidebar.tsx:62` (destructure)
- Modify: `src/components/Git/GitSidebar.tsx:257` (onGenerateMessage callback)

- [ ] **Step 1: Add prop to interface**

Update the `GitSidebarProps` interface to add the new prop:

```typescript
interface GitSidebarProps {
  projectPath: string;
  onFileClick: (file: GitFile) => void;
  aiProvider?: 'claude' | 'codex' | 'gemini';
  commitMessageProvider?: 'claude' | 'codex' | 'gemini';
}
```

- [ ] **Step 2: Destructure the new prop**

Update the component signature at line 62:

```typescript
export default function GitSidebar({ projectPath, onFileClick, aiProvider, commitMessageProvider }: GitSidebarProps) {
```

- [ ] **Step 3: Use commitMessageProvider in onGenerateMessage**

Update line 257 to use `commitMessageProvider` instead of `aiProvider`, falling back to `aiProvider` if not set:

```typescript
onGenerateMessage={() => window.sai.claudeGenerateCommitMessage(projectPath, commitMessageProvider ?? aiProvider)}
```

- [ ] **Step 4: Commit**

```bash
git add src/components/Git/GitSidebar.tsx
git commit -m "feat: use commitMessageProvider in GitSidebar"
```

---

### Task 3: Add commit message provider dropdown to SettingsModal

**Files:**
- Modify: `src/components/SettingsModal.tsx:53-55` (state declarations)
- Modify: `src/components/SettingsModal.tsx:74-76` (settings load)
- Modify: `src/components/SettingsModal.tsx:89` (sync apply)
- Modify: `src/components/SettingsModal.tsx:98-106` (outside click handler)
- Modify: `src/components/SettingsModal.tsx:125-129` (change handler)
- Modify: `src/components/SettingsModal.tsx:185-229` (UI section)

- [ ] **Step 1: Add state for the new dropdown**

After line 55 (`const providerRef = useRef<HTMLDivElement>(null);`), add:

```typescript
const [commitMessageProvider, setCommitMessageProvider] = useState<'claude' | 'codex' | 'gemini'>('claude');
const [commitProviderOpen, setCommitProviderOpen] = useState(false);
const commitProviderRef = useRef<HTMLDivElement>(null);
```

- [ ] **Step 2: Load the setting on mount**

After line 76 (the `aiProvider` settings load), add:

```typescript
window.sai.settingsGet('commitMessageProvider', 'claude').then((v: string) => {
  if (v === 'claude' || v === 'codex' || v === 'gemini') setCommitMessageProvider(v as 'claude' | 'codex' | 'gemini');
});
```

- [ ] **Step 3: Handle GitHub sync apply**

After line 89 (the `aiProvider` sync handler), add:

```typescript
if ('commitMessageProvider' in remote && (remote.commitMessageProvider === 'claude' || remote.commitMessageProvider === 'codex' || remote.commitMessageProvider === 'gemini')) setCommitMessageProvider(remote.commitMessageProvider);
```

- [ ] **Step 4: Add outside-click handler for the new dropdown**

After the existing outside-click `useEffect` block (lines 98-106), add a new one:

```typescript
useEffect(() => {
  if (!commitProviderOpen) return;
  const handler = (e: MouseEvent) => {
    if (commitProviderRef.current && !commitProviderRef.current.contains(e.target as Node)) setCommitProviderOpen(false);
  };
  document.addEventListener('mousedown', handler);
  return () => document.removeEventListener('mousedown', handler);
}, [commitProviderOpen]);
```

- [ ] **Step 5: Add change handler**

After the `handleProviderChange` function (line 129), add:

```typescript
const handleCommitProviderChange = (value: 'claude' | 'codex' | 'gemini') => {
  setCommitMessageProvider(value);
  window.sai.settingsSet('commitMessageProvider', value);
  onSettingChange?.('commitMessageProvider', value);
};
```

- [ ] **Step 6: Add the dropdown UI**

After line 228 (the closing `</div>` of the chat provider settings-row), before line 229 (`</section>`), add a new settings row:

```tsx
<div className="settings-row">
  <div className="settings-row-info">
    <div className="settings-row-name">Commit message provider</div>
    <div className="settings-row-desc">Which AI backend generates commit messages</div>
  </div>
  <div className="provider-select" ref={commitProviderRef}>
    <button className="provider-select-btn" onClick={() => setCommitProviderOpen(!commitProviderOpen)}>
      <span
        className="provider-icon"
        style={{
          maskImage: `url('${PROVIDER_OPTIONS.find(p => p.id === commitMessageProvider)!.svg}')`,
          WebkitMaskImage: `url('${PROVIDER_OPTIONS.find(p => p.id === commitMessageProvider)!.svg}')`,
          backgroundColor: PROVIDER_OPTIONS.find(p => p.id === commitMessageProvider)!.color,
        }}
      />
      <span>{PROVIDER_OPTIONS.find(p => p.id === commitMessageProvider)!.label}</span>
      <ChevronDown size={11} style={{ opacity: 0.5 }} />
    </button>
    {commitProviderOpen && (
      <div className="provider-dropdown">
        {PROVIDER_OPTIONS.map(opt => (
          <button
            key={opt.id}
            className={`provider-dropdown-item ${opt.id === commitMessageProvider ? 'active' : ''}`}
            onClick={() => { handleCommitProviderChange(opt.id); setCommitProviderOpen(false); }}
          >
            <span
              className="provider-icon"
              style={{
                maskImage: `url('${opt.svg}')`,
                WebkitMaskImage: `url('${opt.svg}')`,
                backgroundColor: opt.color,
              }}
            />
            <span>{opt.label}</span>
            {opt.id === commitMessageProvider && <Check size={13} style={{ marginLeft: 'auto', color: 'var(--accent)' }} />}
          </button>
        ))}
      </div>
    )}
  </div>
</div>
```

- [ ] **Step 7: Commit**

```bash
git add src/components/SettingsModal.tsx
git commit -m "feat: add commit message provider dropdown to settings"
```

---

### Task 4: Verify and test

- [ ] **Step 1: Build the project**

```bash
npm run build
```

Expected: Build succeeds with no TypeScript errors.

- [ ] **Step 2: Manual smoke test**

1. Open the app
2. Go to Settings — verify both "Chat provider" and "Commit message provider" dropdowns appear
3. Set commit message provider to a different provider than chat
4. Go to Git sidebar, stage a change, click the sparkle button to generate a commit message
5. Verify the commit message is generated by the selected commit message provider (check terminal output for which CLI was invoked)

- [ ] **Step 3: Commit any fixes**

```bash
git add -A
git commit -m "fix: address any issues found during testing"
```
