# Tab Sequential Numbering & Right-Click Rename Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** New tabs are always named "Tab N+1" based on current open count, and right-clicking a tab shows a context menu with a "Rename" option.

**Architecture:** Two isolated changes — (1) remove the ever-incrementing `termTabCounterRef` in `App.tsx` and replace with `tabs.length + 1` derived at creation time; (2) add `contextMenu` state and render logic to `TerminalTabBar.tsx` with click-outside and Escape dismiss.

**Tech Stack:** React 18, TypeScript, Vitest, @testing-library/react

---

## File Map

| File | Change |
|------|--------|
| `src/App.tsx` | Remove `termTabCounterRef`; fix `createTermTab` and `closeTermTab` |
| `src/components/TerminalMode/TerminalTabBar.tsx` | Add context menu state, handler, render, dismiss logic, styles |
| `tests/unit/components/TerminalMode/TerminalTabBar.test.tsx` | Add 4 tests for right-click context menu |

---

## Task 1: Fix sequential tab numbering in App.tsx

**Files:**
- Modify: `src/App.tsx`

The current code uses `++termTabCounterRef.current` which never resets. Replace with `termTabs.length + 1` read at call time.

- [ ] **Step 1: Remove `termTabCounterRef` declaration**

In `src/App.tsx`, find line ~97:
```typescript
const termTabCounterRef = useRef(1);
```
Delete this line entirely.

- [ ] **Step 2: Fix `createTermTab`**

Find `createTermTab` (~line 778):
```typescript
const createTermTab = useCallback(() => {
  const num = ++termTabCounterRef.current;
  const tab = { id: crypto.randomUUID(), name: `Tab ${num}`, createdAt: Date.now() };
  setTermTabs(prev => [...prev, tab]);
  setActiveTermTabId(tab.id);
}, []);
```

Replace with:
```typescript
const createTermTab = useCallback(() => {
  const num = termTabs.length + 1;
  const tab = { id: crypto.randomUUID(), name: `Tab ${num}`, createdAt: Date.now() };
  setTermTabs(prev => [...prev, tab]);
  setActiveTermTabId(tab.id);
}, [termTabs.length]);
```

- [ ] **Step 3: Fix `closeTermTab` fallback**

In `closeTermTab` (~line 790), find the fallback that creates a fresh tab when all tabs are closed:
```typescript
const num = ++termTabCounterRef.current;
const fresh = { id: crypto.randomUUID(), name: `Tab ${num}`, createdAt: Date.now() };
```

Replace with:
```typescript
const fresh = { id: crypto.randomUUID(), name: 'Tab 1', createdAt: Date.now() };
```

- [ ] **Step 4: Verify TypeScript compiles**

Run:
```bash
npx tsc --noEmit
```
Expected: no errors (or only pre-existing errors unrelated to these changes).

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx
git commit -m "fix: tab numbering uses current count instead of ever-incrementing counter"
```

---

## Task 2: Write failing tests for right-click context menu

**Files:**
- Modify: `tests/unit/components/TerminalMode/TerminalTabBar.test.tsx`

- [ ] **Step 1: Add 4 failing tests to the existing describe block**

Append these tests inside the `describe('TerminalTabBar', ...)` block in `tests/unit/components/TerminalMode/TerminalTabBar.test.tsx`:

```typescript
  it('shows context menu on right-click', () => {
    renderBar();
    fireEvent.contextMenu(screen.getByText('Tab 1'));
    expect(document.querySelector('.tt-context-menu')).toBeTruthy();
    expect(screen.getByText('Rename')).toBeDefined();
  });

  it('starts rename when Rename is clicked in context menu', () => {
    renderBar();
    fireEvent.contextMenu(screen.getByText('Tab 1'));
    fireEvent.mouseDown(screen.getByText('Rename'));
    const input = document.querySelector('.tt-rename-input') as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(input.value).toBe('Tab 1');
  });

  it('closes context menu when clicking outside', () => {
    renderBar();
    fireEvent.contextMenu(screen.getByText('Tab 1'));
    expect(document.querySelector('.tt-context-menu')).toBeTruthy();
    fireEvent.mouseDown(document.body);
    expect(document.querySelector('.tt-context-menu')).toBeNull();
  });

  it('closes context menu on Escape', () => {
    renderBar();
    fireEvent.contextMenu(screen.getByText('Tab 1'));
    expect(document.querySelector('.tt-context-menu')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(document.querySelector('.tt-context-menu')).toBeNull();
  });
```

- [ ] **Step 2: Run tests and confirm new ones fail**

```bash
npm run test:unit -- --reporter=verbose 2>&1 | grep -A2 "TerminalTabBar"
```
Expected: existing 8 tests pass, 4 new tests fail with something like "unable to find element" or "expected null to be truthy".

---

## Task 3: Implement right-click context menu in TerminalTabBar.tsx

**Files:**
- Modify: `src/components/TerminalMode/TerminalTabBar.tsx`

- [ ] **Step 1: Add `contextMenu` state and `contextMenuRef`**

After the existing state declarations at the top of the component (~line 26):
```typescript
const [editingId, setEditingId] = useState<string | null>(null);
const [editValue, setEditValue] = useState('');
const editRef = useRef<HTMLInputElement>(null);
```

Add:
```typescript
const [contextMenu, setContextMenu] = useState<{ tabId: string; x: number; y: number } | null>(null);
const contextMenuRef = useRef<HTMLDivElement>(null);
```

- [ ] **Step 2: Add dismiss effect**

After the existing `useEffect` that focuses `editRef` (~line 30):
```typescript
useEffect(() => {
  if (editingId) editRef.current?.focus();
}, [editingId]);
```

Add:
```typescript
useEffect(() => {
  if (!contextMenu) return;
  const handleMouseDown = (e: MouseEvent) => {
    if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
      setContextMenu(null);
    }
  };
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') setContextMenu(null);
  };
  document.addEventListener('mousedown', handleMouseDown);
  document.addEventListener('keydown', handleKeyDown);
  return () => {
    document.removeEventListener('mousedown', handleMouseDown);
    document.removeEventListener('keydown', handleKeyDown);
  };
}, [contextMenu]);
```

- [ ] **Step 3: Add `onContextMenu` to each tab div**

Find the tab div (~line 50):
```tsx
<div
  key={tab.id}
  className={`tt-tab ${tab.id === activeTabId ? 'tt-tab-active' : ''}`}
  onClick={() => onSelect(tab.id)}
  onDoubleClick={() => startRename(tab)}
>
```

Add `onContextMenu`:
```tsx
<div
  key={tab.id}
  className={`tt-tab ${tab.id === activeTabId ? 'tt-tab-active' : ''}`}
  onClick={() => onSelect(tab.id)}
  onDoubleClick={() => startRename(tab)}
  onContextMenu={(e) => { e.preventDefault(); setContextMenu({ tabId: tab.id, x: e.clientX, y: e.clientY }); }}
>
```

- [ ] **Step 4: Render context menu**

After the closing `</div>` of `.tt-tabs` and before the `<button className="tt-new">` (~line 84):
```tsx
      </div>
      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="tt-context-menu"
          style={{ position: 'fixed', top: contextMenu.y, left: contextMenu.x }}
        >
          <div
            className="tt-context-item"
            onMouseDown={(e) => {
              e.preventDefault();
              const tab = tabs.find(t => t.id === contextMenu.tabId);
              if (tab) startRename(tab);
              setContextMenu(null);
            }}
          >
            Rename
          </div>
        </div>
      )}
      <button className="tt-new" onClick={onCreate} title="New tab (Ctrl+T)">+</button>
```

- [ ] **Step 5: Add context menu styles**

Inside the `<style>` block, after `.tt-new:hover { ... }` and before the closing backtick:
```css
        .tt-context-menu {
          background: #1a1e24;
          border: 1px solid #2d333b;
          border-radius: 4px;
          padding: 4px 0;
          min-width: 100px;
          box-shadow: 0 4px 12px rgba(0,0,0,0.4);
          z-index: 1000;
        }
        .tt-context-item {
          padding: 6px 14px;
          font-family: 'JetBrains Mono NF', 'JetBrains Mono', monospace;
          font-size: 11px;
          color: #9ca3af;
          cursor: pointer;
          user-select: none;
        }
        .tt-context-item:hover {
          background: #21262d;
          color: #e5e7eb;
        }
```

- [ ] **Step 6: Run tests — all 12 should pass**

```bash
npm run test:unit -- --reporter=verbose 2>&1 | grep -A2 "TerminalTabBar"
```
Expected: 12 tests pass, 0 fail.

- [ ] **Step 7: Commit**

```bash
git add src/components/TerminalMode/TerminalTabBar.tsx tests/unit/components/TerminalMode/TerminalTabBar.test.tsx
git commit -m "feat: add right-click rename context menu to terminal tab bar"
```
