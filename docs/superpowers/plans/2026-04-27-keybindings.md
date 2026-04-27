# Customizable Keyboard Shortcuts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Settings → Keybindings page that lets users rebind SAI's 4 global shortcuts, backed by a `useKeybinding` hook that replaces the existing scattered `addEventListener('keydown', ...)` sites in `App.tsx`.

**Architecture:** A static `KEYBINDINGS` registry in `src/utils/keybindings.ts` defines the 4 in-scope shortcut IDs and their defaults. A `useKeybinding(id, handler)` hook in `src/hooks/useKeybinding.ts` listens for the user-configured combo (read from `settings.keybindings`) and invokes the handler. A new `KeybindingsPage` component renders rows with edit / reset / capture-mode UX inside `SettingsModal`. Storage piggybacks on the existing settings IPC + GitHub sync.

**Tech Stack:** TypeScript, React, Vitest, Playwright, existing `settingsGet`/`settingsSet` IPC.

**Spec:** `docs/superpowers/specs/2026-04-27-keybindings-design.md`

---

## File Structure

**Create:**
- `src/utils/keybindings.ts` — registry, types, `eventToCombo`, `formatCombo`, `findConflict` (pure functions)
- `src/hooks/useKeybinding.ts` — hook + shared global keydown dispatcher
- `src/components/Settings/KeybindingsPage.tsx` — Settings page UI (rows, capture mode, conflict modal, reset)
- `src/components/Settings/KeybindingsPage.css` — styles
- `tests/unit/utils/keybindings.test.ts` — pure-function tests
- `tests/unit/hooks/useKeybinding.test.ts` — hook tests
- `tests/unit/components/KeybindingsPage.test.tsx` — component tests
- `tests/e2e/keybindings.spec.ts` — E2E

**Modify:**
- `src/App.tsx` — replace 4 `useEffect` keydown blocks with 4 `useKeybinding` calls
- `src/components/SettingsModal.tsx` — add sidebar nav entry + render switch case

---

## Task 1: Pure utilities — registry, normalization, conflict detection

Build the dependency-free core. Five pure exports, all unit-tested.

**Files:**
- Create: `src/utils/keybindings.ts`
- Create: `tests/unit/utils/keybindings.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/utils/keybindings.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { eventToCombo, formatCombo, findConflict, mergeWithDefaults, KEYBINDINGS } from '../../../src/utils/keybindings';

function ke(opts: Partial<KeyboardEvent>): KeyboardEvent {
  return new KeyboardEvent('keydown', opts);
}

describe('eventToCombo', () => {
  it('maps a plain letter key', () => {
    expect(eventToCombo(ke({ key: 'a' }))).toBe('A');
  });

  it('uppercases letters consistently', () => {
    expect(eventToCombo(ke({ key: 'A' }))).toBe('A');
  });

  it('includes Ctrl modifier', () => {
    expect(eventToCombo(ke({ key: 'k', ctrlKey: true }))).toBe('Ctrl+K');
  });

  it('treats metaKey (Cmd) as Ctrl', () => {
    expect(eventToCombo(ke({ key: 'k', metaKey: true }))).toBe('Ctrl+K');
  });

  it('orders modifiers Ctrl, Alt, Shift', () => {
    expect(eventToCombo(ke({ key: 'f', ctrlKey: true, shiftKey: true, altKey: true })))
      .toBe('Ctrl+Alt+Shift+F');
  });

  it('returns empty for pure-modifier events', () => {
    expect(eventToCombo(ke({ key: 'Control', ctrlKey: true }))).toBe('');
    expect(eventToCombo(ke({ key: 'Shift', shiftKey: true }))).toBe('');
    expect(eventToCombo(ke({ key: 'Meta', metaKey: true }))).toBe('');
    expect(eventToCombo(ke({ key: 'Alt', altKey: true }))).toBe('');
  });

  it('normalizes special keys', () => {
    expect(eventToCombo(ke({ key: 'Enter' }))).toBe('Enter');
    expect(eventToCombo(ke({ key: 'Escape' }))).toBe('Escape');
    expect(eventToCombo(ke({ key: 'Tab' }))).toBe('Tab');
    expect(eventToCombo(ke({ key: ' ' }))).toBe('Space');
    expect(eventToCombo(ke({ key: 'ArrowLeft' }))).toBe('Left');
    expect(eventToCombo(ke({ key: 'F5' }))).toBe('F5');
  });
});

describe('formatCombo', () => {
  it('formats verbatim on linux', () => {
    expect(formatCombo('Ctrl+K', 'linux')).toBe('Ctrl+K');
    expect(formatCombo('Ctrl+Shift+F', 'linux')).toBe('Ctrl+Shift+F');
  });

  it('uses mac symbols on mac', () => {
    expect(formatCombo('Ctrl+K', 'mac')).toBe('⌘K');
    expect(formatCombo('Ctrl+Shift+F', 'mac')).toBe('⇧⌘F');
    expect(formatCombo('Ctrl+Alt+Shift+M', 'mac')).toBe('⌥⇧⌘M');
  });

  it('returns "—" for empty combo', () => {
    expect(formatCombo('', 'linux')).toBe('—');
    expect(formatCombo('', 'mac')).toBe('—');
  });
});

describe('findConflict', () => {
  it('returns null when no conflict', () => {
    expect(findConflict('palette.open', 'Ctrl+J', { 'palette.open': 'Ctrl+K' })).toBeNull();
  });

  it('returns the conflicting binding id', () => {
    const overrides = { 'palette.open': 'Ctrl+K', 'search.toggle': 'Ctrl+Shift+F' };
    expect(findConflict('chatHistory.toggle', 'Ctrl+K', overrides)).toBe('palette.open');
  });

  it('falls back to defaults when override is missing', () => {
    // KEYBINDINGS has palette.open with default Ctrl+K
    expect(findConflict('chatHistory.toggle', 'Ctrl+K', {})).toBe('palette.open');
  });

  it('does not flag self', () => {
    expect(findConflict('palette.open', 'Ctrl+K', { 'palette.open': 'Ctrl+K' })).toBeNull();
  });

  it('treats empty combo as never-conflicting', () => {
    expect(findConflict('palette.open', '', { 'search.toggle': '' })).toBeNull();
  });
});

describe('mergeWithDefaults', () => {
  it('returns defaults when overrides empty', () => {
    const merged = mergeWithDefaults({});
    expect(merged['palette.open']).toBe('Ctrl+K');
    expect(merged['search.toggle']).toBe('Ctrl+Shift+F');
  });

  it('overrides take precedence', () => {
    const merged = mergeWithDefaults({ 'palette.open': 'Ctrl+J' });
    expect(merged['palette.open']).toBe('Ctrl+J');
    expect(merged['search.toggle']).toBe('Ctrl+Shift+F');
  });

  it('empty-string override keeps the binding unbound', () => {
    const merged = mergeWithDefaults({ 'palette.open': '' });
    expect(merged['palette.open']).toBe('');
  });

  it('unknown override keys are silently ignored', () => {
    const merged = mergeWithDefaults({ 'nonexistent.id': 'Ctrl+X' } as any);
    expect((merged as any)['nonexistent.id']).toBeUndefined();
  });
});

describe('KEYBINDINGS registry', () => {
  it('contains the 4 in-scope global shortcuts', () => {
    const ids = KEYBINDINGS.map(b => b.id);
    expect(ids).toContain('palette.open');
    expect(ids).toContain('chatHistory.toggle');
    expect(ids).toContain('search.toggle');
    expect(ids).toContain('markdownPreview.toggle');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test:unit -- tests/unit/utils/keybindings.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the utilities**

Create `src/utils/keybindings.ts`:

```typescript
export type KeybindingId =
  | 'palette.open'
  | 'chatHistory.toggle'
  | 'search.toggle'
  | 'markdownPreview.toggle';

export type KeyCombo = string;       // canonical, e.g. 'Ctrl+K' or '' (unbound)

export interface KeybindingDef {
  id: KeybindingId;
  label: string;
  defaultCombo: KeyCombo;
  description?: string;
}

export const KEYBINDINGS: KeybindingDef[] = [
  { id: 'palette.open',           label: 'Open command palette',        defaultCombo: 'Ctrl+K' },
  { id: 'chatHistory.toggle',     label: 'Toggle chat history sidebar', defaultCombo: 'Ctrl+H' },
  { id: 'search.toggle',          label: 'Toggle search sidebar',       defaultCombo: 'Ctrl+Shift+F' },
  { id: 'markdownPreview.toggle', label: 'Toggle markdown preview',     defaultCombo: 'Ctrl+Shift+M' },
];

const SPECIAL_KEY_MAP: Record<string, string> = {
  ' ': 'Space',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
};

function normalizeKey(key: string): string {
  if (key.length === 1) return key.toUpperCase();
  return SPECIAL_KEY_MAP[key] ?? key;
}

/**
 * Convert a KeyboardEvent into a canonical combo string.
 * Pure-modifier events return ''.
 * Cmd is collapsed to Ctrl so combos work cross-platform.
 */
export function eventToCombo(e: KeyboardEvent): KeyCombo {
  if (['Control', 'Meta', 'Shift', 'Alt'].includes(e.key)) return '';
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  parts.push(normalizeKey(e.key));
  return parts.join('+');
}

const MAC_SYMBOLS: Record<string, string> = {
  Ctrl: '⌘',
  Alt: '⌥',
  Shift: '⇧',
};

export type Platform = 'mac' | 'linux' | 'windows';

/**
 * Render a combo for display. On macOS, modifiers become symbols and the
 * key is appended directly. On Linux/Windows, return the verbatim string.
 */
export function formatCombo(combo: KeyCombo, platform: Platform): string {
  if (!combo) return '—';
  if (platform !== 'mac') return combo;
  const parts = combo.split('+');
  const key = parts.pop()!;
  const modSyms = parts.map(p => MAC_SYMBOLS[p] ?? p).join('');
  return `${modSyms}${key}`;
}

/**
 * Return the id of the binding currently assigned to `combo` (other than
 * `selfId`), or null if unassigned.
 */
export function findConflict(
  selfId: KeybindingId,
  combo: KeyCombo,
  overrides: Partial<Record<KeybindingId, KeyCombo>>,
): KeybindingId | null {
  if (!combo) return null;
  for (const def of KEYBINDINGS) {
    if (def.id === selfId) continue;
    const effective = overrides[def.id] ?? def.defaultCombo;
    if (effective === combo) return def.id;
  }
  return null;
}

/**
 * Merge user overrides on top of registry defaults, dropping unknown ids.
 */
export function mergeWithDefaults(
  overrides: Partial<Record<KeybindingId, KeyCombo>>,
): Record<KeybindingId, KeyCombo> {
  const out: Record<string, KeyCombo> = {};
  for (const def of KEYBINDINGS) {
    out[def.id] = overrides[def.id] ?? def.defaultCombo;
  }
  return out as Record<KeybindingId, KeyCombo>;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm run test:unit -- tests/unit/utils/keybindings.test.ts`
Expected: PASS — all tests.

- [ ] **Step 5: Commit**

```bash
git add src/utils/keybindings.ts tests/unit/utils/keybindings.test.ts
git commit -m "feat(keybindings): add registry, eventToCombo, formatCombo, findConflict utilities"
```

---

## Task 2: `useKeybinding` hook + shared dispatcher

A React hook that subscribes a handler to its registered combo. One shared global keydown listener serves all subscriptions; subscriptions are stored in a module-level Map so adding/removing is O(1).

**Files:**
- Create: `src/hooks/useKeybinding.ts`
- Create: `tests/unit/hooks/useKeybinding.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/hooks/useKeybinding.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useKeybinding } from '../../../src/hooks/useKeybinding';

beforeEach(() => {
  (window as any).sai = {
    settingsGet: vi.fn().mockResolvedValue({}),
    settingsSet: vi.fn().mockResolvedValue(undefined),
  };
});

afterEach(() => {
  delete (window as any).__sai_keybinding_overrides;
});

function fireKey(combo: { key: string; ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean; metaKey?: boolean }) {
  window.dispatchEvent(new KeyboardEvent('keydown', combo));
}

describe('useKeybinding', () => {
  it('invokes the handler when the default combo fires', async () => {
    const handler = vi.fn();
    renderHook(() => useKeybinding('palette.open', handler));
    // wait one microtask for the hook's settingsGet to resolve
    await Promise.resolve();
    fireKey({ key: 'k', ctrlKey: true });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('does not invoke the handler when the combo does not match', async () => {
    const handler = vi.fn();
    renderHook(() => useKeybinding('palette.open', handler));
    await Promise.resolve();
    fireKey({ key: 'j', ctrlKey: true });
    expect(handler).not.toHaveBeenCalled();
  });

  it('respects user override from settings', async () => {
    (window as any).sai.settingsGet = vi.fn().mockResolvedValue({ 'palette.open': 'Ctrl+J' });
    const handler = vi.fn();
    renderHook(() => useKeybinding('palette.open', handler));
    await Promise.resolve(); await Promise.resolve();   // settingsGet then re-render
    fireKey({ key: 'j', ctrlKey: true });
    expect(handler).toHaveBeenCalledTimes(1);
    fireKey({ key: 'k', ctrlKey: true });
    expect(handler).toHaveBeenCalledTimes(1);   // old default no longer fires
  });

  it('treats empty combo as disabled', async () => {
    (window as any).sai.settingsGet = vi.fn().mockResolvedValue({ 'palette.open': '' });
    const handler = vi.fn();
    renderHook(() => useKeybinding('palette.open', handler));
    await Promise.resolve(); await Promise.resolve();
    fireKey({ key: 'k', ctrlKey: true });
    expect(handler).not.toHaveBeenCalled();
  });

  it('stops listening after unmount', async () => {
    const handler = vi.fn();
    const { unmount } = renderHook(() => useKeybinding('palette.open', handler));
    await Promise.resolve();
    unmount();
    fireKey({ key: 'k', ctrlKey: true });
    expect(handler).not.toHaveBeenCalled();
  });

  it('multiple subscriptions each fire for their own combo', async () => {
    const h1 = vi.fn();
    const h2 = vi.fn();
    renderHook(() => useKeybinding('palette.open', h1));
    renderHook(() => useKeybinding('search.toggle', h2));
    await Promise.resolve();
    fireKey({ key: 'k', ctrlKey: true });
    expect(h1).toHaveBeenCalledTimes(1);
    expect(h2).not.toHaveBeenCalled();
    fireKey({ key: 'F', ctrlKey: true, shiftKey: true });
    expect(h2).toHaveBeenCalledTimes(1);
  });

  it('on duplicate-combo conflict, only the first registered (registry order) fires', async () => {
    (window as any).sai.settingsGet = vi.fn().mockResolvedValue({
      'palette.open': 'Ctrl+J',
      'chatHistory.toggle': 'Ctrl+J',
    });
    const h1 = vi.fn();
    const h2 = vi.fn();
    renderHook(() => useKeybinding('palette.open', h1));
    renderHook(() => useKeybinding('chatHistory.toggle', h2));
    await Promise.resolve(); await Promise.resolve();
    fireKey({ key: 'j', ctrlKey: true });
    // palette.open is declared before chatHistory.toggle in KEYBINDINGS
    expect(h1).toHaveBeenCalledTimes(1);
    expect(h2).not.toHaveBeenCalled();
  });

  it('refreshes bindings when keybindingsChanged event fires', async () => {
    const handler = vi.fn();
    renderHook(() => useKeybinding('palette.open', handler));
    await Promise.resolve();

    // user edits in Settings — overrides update + event dispatched
    (window as any).sai.settingsGet = vi.fn().mockResolvedValue({ 'palette.open': 'Ctrl+J' });
    window.dispatchEvent(new CustomEvent('sai:keybindings-changed'));
    await Promise.resolve(); await Promise.resolve();

    fireKey({ key: 'k', ctrlKey: true });
    expect(handler).not.toHaveBeenCalled();
    fireKey({ key: 'j', ctrlKey: true });
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test:unit -- tests/unit/hooks/useKeybinding.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the hook + dispatcher**

Create `src/hooks/useKeybinding.ts`:

```typescript
import { useEffect } from 'react';
import {
  KEYBINDINGS,
  type KeybindingId,
  type KeyCombo,
  eventToCombo,
  mergeWithDefaults,
} from '../utils/keybindings';

// Module-level state — one shared dispatcher serves every useKeybinding caller.
const handlers = new Map<KeybindingId, (e: KeyboardEvent) => void>();
let activeBindings: Record<KeybindingId, KeyCombo> = mergeWithDefaults({});
let listenerAttached = false;

async function loadOverrides(): Promise<void> {
  try {
    const stored = await (window as any).sai?.settingsGet?.('keybindings', {});
    activeBindings = mergeWithDefaults(stored ?? {});
  } catch {
    activeBindings = mergeWithDefaults({});
  }
}

function dispatch(e: KeyboardEvent): void {
  const combo = eventToCombo(e);
  if (!combo) return;
  // Iterate KEYBINDINGS in declaration order so duplicates resolve deterministically.
  for (const def of KEYBINDINGS) {
    if (activeBindings[def.id] === combo) {
      const handler = handlers.get(def.id);
      if (handler) handler(e);
      return;
    }
  }
}

function ensureListener(): void {
  if (listenerAttached) return;
  window.addEventListener('keydown', dispatch);
  window.addEventListener('sai:keybindings-changed', () => { void loadOverrides(); });
  listenerAttached = true;
}

/**
 * Subscribe a handler to the user-configured combo for `id`.
 * Re-binds automatically when the user changes keybindings in Settings
 * (callers anywhere can dispatch the `sai:keybindings-changed` event).
 */
export function useKeybinding(id: KeybindingId, handler: (e: KeyboardEvent) => void): void {
  useEffect(() => {
    ensureListener();
    handlers.set(id, handler);
    void loadOverrides();
    return () => {
      if (handlers.get(id) === handler) handlers.delete(id);
    };
  }, [id, handler]);
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm run test:unit -- tests/unit/hooks/useKeybinding.test.ts`
Expected: PASS — 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useKeybinding.ts tests/unit/hooks/useKeybinding.test.ts
git commit -m "feat(keybindings): add useKeybinding hook with shared global dispatcher"
```

---

## Task 3: Migrate `App.tsx` global keydown handlers to `useKeybinding`

Replace the 4 existing `useEffect`/`addEventListener('keydown', ...)` blocks.

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Read the four keydown sites**

Run: `grep -n "addEventListener.*keydown\|removeEventListener.*keydown" src/App.tsx`
Expected lines roughly: 162, 600, 666, 949 (line numbers may shift; locate by behavior).

The four handlers, by behavior:
- Around line 154-163: `Ctrl+K` opens command palette → `palette.open`
- Around line 592-601: `Ctrl+H` toggles chat history sidebar → `chatHistory.toggle`
- Around line 654-664: `Ctrl+Shift+F` toggles search sidebar → `search.toggle`
- Around line 998-1010: `Ctrl+Shift+M` toggles markdown preview for `.md` files → `markdownPreview.toggle`

- [ ] **Step 2: Add the import**

In `src/App.tsx`, add next to the other hook imports:

```typescript
import { useKeybinding } from './hooks/useKeybinding';
```

- [ ] **Step 3: Replace the palette handler**

Locate the block:

```typescript
  // Global Ctrl+K / Cmd+K handler for command palette
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        // ... existing body that toggles the palette ...
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
```

Replace with (preserving the body that toggles the palette — copy whatever the existing handler does into the new arrow function):

```typescript
  useKeybinding('palette.open', useCallback((e) => {
    e.preventDefault();
    // ... same body as before ...
  }, [/* same deps the original effect had */]));
```

If the original handler had no dependencies (closed over only stable refs/setters), use an empty dep array.

- [ ] **Step 4: Replace the chat-history handler**

Locate the `Ctrl+H` block (`if (e.key === 'h' && (e.metaKey || e.ctrlKey))`) and replace the same way:

```typescript
  useKeybinding('chatHistory.toggle', useCallback((e) => {
    e.preventDefault();
    setSidebarOpen(prev => prev === 'chats' ? null : 'chats');
  }, []));
```

(Adjust if the existing body does anything else.)

- [ ] **Step 5: Replace the search handler**

Locate the `Ctrl+Shift+F` block and replace:

```typescript
  useKeybinding('search.toggle', useCallback((e) => {
    e.preventDefault();
    setSidebarOpen(prev => prev === 'search' ? null : 'search');
  }, []));
```

- [ ] **Step 6: Replace the markdown-preview handler**

Locate the `Ctrl+Shift+M` block. Preserve its conditional logic (only fires for `.md` files):

```typescript
  useKeybinding('markdownPreview.toggle', useCallback((e) => {
    e.preventDefault();
    if (!activeProjectPath) return;
    const ws = workspaces.get(activeProjectPath);
    const activePath = ws?.activeFilePath;
    if (activePath && activePath.endsWith('.md')) {
      handleToggleMdPreview(activePath);
    }
  }, [activeProjectPath, workspaces, handleToggleMdPreview]));
```

(Adjust deps to match what the original captured.)

- [ ] **Step 7: Verify the app still type-checks and unit tests pass**

Run: `npm run test:unit`
Expected: all 737+ tests pass (no regression).

If TypeScript complains about `useCallback` not being imported, add it:

```typescript
import { useCallback, useEffect, useState, useRef } from 'react';
```

- [ ] **Step 8: Manual smoke**

Run: `npm run dev`. In the live app:
- Press `Ctrl+K` — command palette opens.
- Press `Ctrl+H` — chat history sidebar toggles.
- Press `Ctrl+Shift+F` — search sidebar toggles.
- Open a `.md` file and press `Ctrl+Shift+M` — preview toggles.

If any shortcut fails, the most likely issue is a missing dependency in `useCallback`. Check the original `useEffect` deps and copy them.

- [ ] **Step 9: Commit**

```bash
git add src/App.tsx
git commit -m "refactor(keybindings): migrate App.tsx global shortcuts to useKeybinding"
```

---

## Task 4: `KeybindingsPage` component

The Settings page UI: rows, capture mode, conflict modal, reset.

**Files:**
- Create: `src/components/Settings/KeybindingsPage.tsx`
- Create: `src/components/Settings/KeybindingsPage.css`
- Create: `tests/unit/components/KeybindingsPage.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/components/KeybindingsPage.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import KeybindingsPage from '../../../src/components/Settings/KeybindingsPage';

let savedOverrides: Record<string, string> = {};

beforeEach(() => {
  savedOverrides = {};
  (window as any).sai = {
    settingsGet: vi.fn().mockImplementation((key: string, def: any) =>
      key === 'keybindings' ? Promise.resolve(savedOverrides) : Promise.resolve(def)),
    settingsSet: vi.fn().mockImplementation((key: string, value: any) => {
      if (key === 'keybindings') savedOverrides = value;
      return Promise.resolve();
    }),
  };
});

describe('KeybindingsPage', () => {
  it('renders all four registered bindings with their defaults', async () => {
    render(<KeybindingsPage />);
    expect(await screen.findByText('Open command palette')).toBeInTheDocument();
    expect(screen.getByText('Toggle chat history sidebar')).toBeInTheDocument();
    expect(screen.getByText('Toggle search sidebar')).toBeInTheDocument();
    expect(screen.getByText('Toggle markdown preview')).toBeInTheDocument();
    // Combos shown verbatim on linux
    expect(screen.getAllByText('Ctrl+K').length).toBeGreaterThan(0);
  });

  it('search filter narrows rows by label', async () => {
    render(<KeybindingsPage />);
    await screen.findByText('Open command palette');
    fireEvent.change(screen.getByPlaceholderText(/search keybindings/i), { target: { value: 'palette' } });
    expect(screen.getByText('Open command palette')).toBeInTheDocument();
    expect(screen.queryByText('Toggle search sidebar')).not.toBeInTheDocument();
  });

  it('Edit button enters capture mode and captures a new combo', async () => {
    render(<KeybindingsPage />);
    await screen.findByText('Open command palette');
    const row = screen.getByText('Open command palette').closest('.keybinding-row')!;
    fireEvent.click(row.querySelector('.keybinding-edit')!);
    expect(row.textContent).toMatch(/press keys/i);
    fireEvent.keyDown(window, { key: 'j', ctrlKey: true });
    expect(row.textContent).toContain('Ctrl+J');
    expect((window as any).sai.settingsSet).toHaveBeenCalledWith(
      'keybindings',
      expect.objectContaining({ 'palette.open': 'Ctrl+J' }),
    );
  });

  it('Esc cancels capture mode without saving', async () => {
    render(<KeybindingsPage />);
    await screen.findByText('Open command palette');
    const row = screen.getByText('Open command palette').closest('.keybinding-row')!;
    fireEvent.click(row.querySelector('.keybinding-edit')!);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(row.textContent).not.toMatch(/press keys/i);
    expect(row.textContent).toContain('Ctrl+K');
    expect((window as any).sai.settingsSet).not.toHaveBeenCalled();
  });

  it('Reset button restores default and is disabled when already default', async () => {
    savedOverrides = { 'palette.open': 'Ctrl+J' };
    render(<KeybindingsPage />);
    await screen.findByText('Ctrl+J');
    const row = screen.getByText('Open command palette').closest('.keybinding-row')!;
    const resetBtn = row.querySelector('.keybinding-reset') as HTMLButtonElement;
    expect(resetBtn.disabled).toBe(false);
    fireEvent.click(resetBtn);
    expect(row.textContent).toContain('Ctrl+K');
  });

  it('shows conflict modal when captured combo is already taken', async () => {
    render(<KeybindingsPage />);
    await screen.findByText('Open command palette');
    const row = screen.getByText('Toggle chat history sidebar').closest('.keybinding-row')!;
    fireEvent.click(row.querySelector('.keybinding-edit')!);
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });   // collides with palette.open
    expect(screen.getByText(/currently bound to/i)).toBeInTheDocument();
    expect(screen.getByText(/open command palette/i)).toBeInTheDocument();
  });

  it('Reset all button restores all defaults', async () => {
    savedOverrides = { 'palette.open': 'Ctrl+J', 'search.toggle': 'Ctrl+G' };
    render(<KeybindingsPage />);
    await screen.findByText('Ctrl+J');
    fireEvent.click(screen.getByText(/reset all/i));
    fireEvent.click(screen.getByText(/^reset$/i));   // confirm in modal
    expect((window as any).sai.settingsSet).toHaveBeenCalledWith('keybindings', {});
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test:unit -- tests/unit/components/KeybindingsPage.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the component**

Create `src/components/Settings/KeybindingsPage.tsx`:

```typescript
import { useEffect, useState, useCallback } from 'react';
import { Pencil, RotateCcw, AlertTriangle } from 'lucide-react';
import {
  KEYBINDINGS,
  type KeybindingId,
  type KeyCombo,
  type Platform,
  eventToCombo,
  formatCombo,
  findConflict,
  mergeWithDefaults,
} from '../../utils/keybindings';
import './KeybindingsPage.css';

type Overrides = Partial<Record<KeybindingId, KeyCombo>>;

const RESERVED = new Set([
  'Ctrl+C', 'Ctrl+V', 'Ctrl+X', 'Ctrl+A', 'Ctrl+Z', 'Ctrl+Y',
  'Tab', 'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12',
]);

function detectPlatform(): Platform {
  const p = (window as any).sai?.platform ?? '';
  if (p === 'darwin' || p === 'mac' || /Mac/.test(navigator.platform)) return 'mac';
  if (p === 'win32' || /Win/.test(navigator.platform)) return 'windows';
  return 'linux';
}

export default function KeybindingsPage() {
  const [overrides, setOverrides] = useState<Overrides>({});
  const [filter, setFilter] = useState('');
  const [editingId, setEditingId] = useState<KeybindingId | null>(null);
  const [conflict, setConflict] = useState<{ id: KeybindingId; combo: KeyCombo; conflictWith: KeybindingId } | null>(null);
  const [resetAllOpen, setResetAllOpen] = useState(false);
  const platform = detectPlatform();

  // Load saved overrides on mount
  useEffect(() => {
    void (async () => {
      const stored = await (window as any).sai?.settingsGet?.('keybindings', {});
      setOverrides(stored ?? {});
    })();
  }, []);

  const persist = useCallback(async (next: Overrides) => {
    setOverrides(next);
    await (window as any).sai?.settingsSet?.('keybindings', next);
    window.dispatchEvent(new CustomEvent('sai:keybindings-changed'));
  }, []);

  // Capture: a global keydown listener while editing
  useEffect(() => {
    if (!editingId) return;
    const handler = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') {
        setEditingId(null);
        return;
      }
      const combo = eventToCombo(e);
      if (!combo) return;   // pure modifier — keep waiting
      const conflictWith = findConflict(editingId, combo, overrides);
      if (conflictWith) {
        setConflict({ id: editingId, combo, conflictWith });
        setEditingId(null);
        return;
      }
      void persist({ ...overrides, [editingId]: combo });
      setEditingId(null);
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [editingId, overrides, persist]);

  const handleResetRow = (id: KeybindingId) => {
    const next = { ...overrides };
    delete next[id];
    void persist(next);
  };

  const handleResetAll = () => {
    void persist({});
    setResetAllOpen(false);
  };

  const handleConflictConfirm = () => {
    if (!conflict) return;
    const next = { ...overrides, [conflict.id]: conflict.combo, [conflict.conflictWith]: '' };
    void persist(next);
    setConflict(null);
  };

  const merged = mergeWithDefaults(overrides);
  const rows = KEYBINDINGS.filter(b =>
    !filter || b.label.toLowerCase().includes(filter.toLowerCase())
  );

  return (
    <div className="keybindings-page">
      <input
        type="text"
        className="keybindings-search"
        placeholder="Search keybindings..."
        value={filter}
        onChange={e => setFilter(e.target.value)}
      />

      <div className="keybindings-list">
        {rows.map(def => {
          const current = merged[def.id];
          const isEditing = editingId === def.id;
          const isDefault = !overrides[def.id] || overrides[def.id] === def.defaultCombo;
          const isReserved = current && RESERVED.has(current);
          return (
            <div key={def.id} className="keybinding-row">
              <span className="keybinding-label">{def.label}</span>
              <span className="keybinding-combo">
                {isEditing ? (
                  <em>Press keys… (Esc to cancel)</em>
                ) : (
                  formatCombo(current, platform)
                )}
                {isReserved && (
                  <span className="keybinding-warn" title="May not fire reliably (browser shortcut)">
                    <AlertTriangle size={11} />
                  </span>
                )}
              </span>
              <button
                className="keybinding-edit"
                title="Edit"
                onClick={() => setEditingId(def.id)}
                disabled={isEditing}
              ><Pencil size={12} /></button>
              <button
                className="keybinding-reset"
                title="Reset to default"
                onClick={() => handleResetRow(def.id)}
                disabled={isDefault}
              ><RotateCcw size={12} /></button>
            </div>
          );
        })}
      </div>

      <div className="keybindings-footer">
        <button
          className="keybindings-reset-all"
          onClick={() => setResetAllOpen(true)}
        >Reset all to defaults</button>
      </div>

      {conflict && (
        <div className="keybindings-modal-overlay" onClick={() => setConflict(null)}>
          <div className="keybindings-modal" onClick={e => e.stopPropagation()}>
            <p>
              <strong>{formatCombo(conflict.combo, platform)}</strong> is currently bound to{' '}
              <strong>{KEYBINDINGS.find(k => k.id === conflict.conflictWith)?.label}</strong>.
              Reassign it to <strong>{KEYBINDINGS.find(k => k.id === conflict.id)?.label}</strong>?
            </p>
            <div className="keybindings-modal-buttons">
              <button onClick={() => setConflict(null)}>Cancel</button>
              <button className="primary" onClick={handleConflictConfirm}>Reassign</button>
            </div>
          </div>
        </div>
      )}

      {resetAllOpen && (
        <div className="keybindings-modal-overlay" onClick={() => setResetAllOpen(false)}>
          <div className="keybindings-modal" onClick={e => e.stopPropagation()}>
            <p>Reset all keybindings to their defaults?</p>
            <div className="keybindings-modal-buttons">
              <button onClick={() => setResetAllOpen(false)}>Cancel</button>
              <button className="primary" onClick={handleResetAll}>Reset</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Create the CSS**

Create `src/components/Settings/KeybindingsPage.css`:

```css
.keybindings-page {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 4px 0;
}

.keybindings-search {
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text);
  padding: 6px 10px;
  font-family: inherit;
  font-size: 12px;
  outline: none;
}
.keybindings-search:focus { border-color: var(--accent); }

.keybindings-list {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border);
  border-radius: 4px;
  overflow: hidden;
}

.keybinding-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  font-size: 12px;
  border-bottom: 1px solid var(--border);
}
.keybinding-row:last-child { border-bottom: none; }
.keybinding-row:hover { background: var(--bg-hover); }

.keybinding-label { flex: 1; color: var(--text); }
.keybinding-combo {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-family: 'Geist Mono', monospace;
  font-size: 11px;
  color: var(--text-secondary);
  background: var(--bg-elevated);
  padding: 2px 8px;
  border-radius: 3px;
  min-width: 90px;
  justify-content: center;
}
.keybinding-combo em {
  font-style: italic;
  color: var(--accent);
}
.keybinding-warn { color: var(--orange); display: inline-flex; }

.keybinding-edit,
.keybinding-reset {
  background: transparent;
  border: none;
  color: var(--text-muted);
  padding: 3px;
  border-radius: 3px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
}
.keybinding-edit:hover:not(:disabled),
.keybinding-reset:hover:not(:disabled) {
  color: var(--accent);
  background: var(--bg-elevated);
}
.keybinding-edit:disabled,
.keybinding-reset:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.keybindings-footer {
  display: flex;
  justify-content: flex-end;
}
.keybindings-reset-all {
  background: transparent;
  border: 1px solid var(--border);
  color: var(--text-secondary);
  padding: 4px 12px;
  border-radius: 3px;
  cursor: pointer;
  font-family: inherit;
  font-size: 11px;
}
.keybindings-reset-all:hover { border-color: var(--text-muted); color: var(--text); }

.keybindings-modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(2px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1100;
}
.keybindings-modal {
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  padding: 16px;
  border-radius: 6px;
  max-width: 420px;
  font-size: 12px;
  color: var(--text);
}
.keybindings-modal-buttons {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 12px;
}
.keybindings-modal-buttons button {
  background: transparent;
  color: var(--text);
  border: 1px solid var(--border);
  padding: 4px 12px;
  border-radius: 3px;
  cursor: pointer;
  font-family: inherit;
  font-size: 11px;
}
.keybindings-modal-buttons button.primary {
  background: var(--accent);
  color: #1a1110;
  border-color: var(--accent);
  font-weight: 600;
}
```

- [ ] **Step 5: Run tests**

Run: `npm run test:unit -- tests/unit/components/KeybindingsPage.test.tsx`
Expected: PASS — 7 tests.

- [ ] **Step 6: Commit**

```bash
git add src/components/Settings/ tests/unit/components/KeybindingsPage.test.tsx
git commit -m "feat(keybindings): add KeybindingsPage UI with capture mode and conflict modal"
```

---

## Task 5: Mount KeybindingsPage in SettingsModal

Add a sidebar nav entry and a render-switch case.

**Files:**
- Modify: `src/components/SettingsModal.tsx`

- [ ] **Step 1: Add the import**

In `src/components/SettingsModal.tsx`, add next to other component imports:

```typescript
import KeybindingsPage from './Settings/KeybindingsPage';
import { Keyboard } from 'lucide-react';
```

(Verify `Keyboard` exists in the installed `lucide-react`; if not, use `Command` as a substitute.)

- [ ] **Step 2: Add the page to the render switch**

Locate `renderActivePage()` (around line 786). Add a case:

```typescript
      case 'keybindings': return <KeybindingsPage />;
```

- [ ] **Step 3: Add the sidebar nav button**

Locate the sidebar nav (the block of `<button className="settings-nav-item ...">` entries around line 822-865). Insert a new entry between Editor and Layout (or wherever feels natural — Editor → Keybindings → Layout reads well):

```typescript
            <button
              className={`settings-nav-item${activePage === 'keybindings' ? ' active' : ''}`}
              onClick={() => setActivePage('keybindings')}
            >
              <Keyboard size={14} />
              <span>Keybindings</span>
            </button>
```

- [ ] **Step 4: Update the activePage type union**

Search for the `setActivePage` state declaration (likely `useState<'general' | 'editor' | ...>`) and add `'keybindings'`:

```typescript
const [activePage, setActivePage] = useState<'general' | 'editor' | 'layout' | 'style' | 'storage' | 'provider' | 'claude' | 'codex' | 'gemini' | 'keybindings'>('general');
```

(If the union literal differs from the above, just add `'keybindings'` to whatever exists.)

- [ ] **Step 5: Run unit tests**

Run: `npm run test:unit`
Expected: all pass (no regression).

- [ ] **Step 6: Manual smoke**

Run: `npm run dev`. Open Settings via the GitHub user menu, click "Keybindings" in the sidebar — page renders with all 4 rows. Click Edit, press Ctrl+J — combo updates and saves. Press Ctrl+K (or whatever the new combo is) outside Settings — palette opens.

- [ ] **Step 7: Commit**

```bash
git add src/components/SettingsModal.tsx
git commit -m "feat(keybindings): mount KeybindingsPage in SettingsModal sidebar"
```

---

## Task 6: E2E test

Verify the end-to-end flow through the saiMock fixture.

**Files:**
- Create: `tests/e2e/keybindings.spec.ts`

- [ ] **Step 1: Write the test**

Create `tests/e2e/keybindings.spec.ts`:

```typescript
import { test, expect } from './electron.setup';

test.describe('Keybindings', () => {
  // Capture settingsSet calls for later assertion
  test.use({
    saiMock: {
      // settings store starts empty; settingsSet writes are captured by the page eval below.
      settingsGet: (key: string, def: any) => {
        const stored = (window as any).__keybindings_overrides ?? {};
        if (key === 'keybindings') return Promise.resolve(stored);
        if (key === 'lastSeenVersion') return Promise.resolve('0.8.36');
        return Promise.resolve(def ?? null);
      },
      settingsSet: (key: string, value: any) => {
        if (key === 'keybindings') (window as any).__keybindings_overrides = value;
        return Promise.resolve();
      },
    },
  });

  async function openSettingsKeybindings(window: any) {
    await window.locator('.gh-user-btn').click();
    await window.locator('.gh-dropdown-item').filter({ hasText: 'Settings' }).click();
    await window.locator('.settings-modal').waitFor({ state: 'visible' });
    const keybindingsNav = window.locator('.settings-nav-item').filter({ hasText: 'Keybindings' });
    await keybindingsNav.click();
    await window.locator('.keybindings-page').waitFor({ state: 'visible' });
  }

  test('Keybindings page lists the 4 registered shortcuts', async ({ window }) => {
    await openSettingsKeybindings(window);
    await expect(window.locator('text=Open command palette')).toBeVisible();
    await expect(window.locator('text=Toggle search sidebar')).toBeVisible();
    await expect(window.locator('text=Toggle chat history sidebar')).toBeVisible();
    await expect(window.locator('text=Toggle markdown preview')).toBeVisible();
  });

  test('rebinding Command Palette to Ctrl+J makes Ctrl+J open it', async ({ window }) => {
    await openSettingsKeybindings(window);
    // Click the Edit pencil on the palette row
    const paletteRow = window.locator('.keybinding-row').filter({ hasText: 'Open command palette' });
    await paletteRow.locator('.keybinding-edit').click();
    // Press the new combo
    await window.keyboard.press('Control+J');
    // Combo should now show Ctrl+J in the row
    await expect(paletteRow.locator('.keybinding-combo')).toContainText('Ctrl+J');
    // Close Settings
    await window.keyboard.press('Escape');
    await window.locator('.settings-modal').waitFor({ state: 'hidden' });
    // Press Ctrl+J — command palette should open
    await window.keyboard.press('Control+J');
    await expect(window.locator('.command-palette')).toBeVisible({ timeout: 3000 });
  });

  test('Reset row restores default and disables when at default', async ({ window }) => {
    await openSettingsKeybindings(window);
    const paletteRow = window.locator('.keybinding-row').filter({ hasText: 'Open command palette' });
    const resetBtn = paletteRow.locator('.keybinding-reset');
    await expect(resetBtn).toBeDisabled();   // default at first
    // Change it
    await paletteRow.locator('.keybinding-edit').click();
    await window.keyboard.press('Control+J');
    await expect(resetBtn).toBeEnabled();
    // Reset it
    await resetBtn.click();
    await expect(paletteRow.locator('.keybinding-combo')).toContainText('Ctrl+K');
    await expect(resetBtn).toBeDisabled();
  });

  test('conflict modal appears when assigning a taken combo', async ({ window }) => {
    await openSettingsKeybindings(window);
    const chatRow = window.locator('.keybinding-row').filter({ hasText: 'Toggle chat history sidebar' });
    await chatRow.locator('.keybinding-edit').click();
    await window.keyboard.press('Control+K');   // taken by palette
    await expect(window.locator('.keybindings-modal')).toBeVisible({ timeout: 3000 });
    await expect(window.locator('.keybindings-modal')).toContainText('Open command palette');
  });
});
```

- [ ] **Step 2: Run the spec**

Run: `npm run test:e2e -- tests/e2e/keybindings.spec.ts`
Expected: PASS — 4 tests.

If `.command-palette` is the wrong selector for the palette UI, search `src/components/CommandPalette.tsx` for the actual root class and update.

If the rebound shortcut doesn't fire for the second test, the dispatcher may not have refreshed — verify the `sai:keybindings-changed` event is dispatched in `KeybindingsPage.persist` and handled by the dispatcher (see Task 2).

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/keybindings.spec.ts
git commit -m "test(e2e): add keybindings E2E coverage"
```

---

## Task 7: Final verification + PR

- [ ] **Step 1: Run all tests**

Run: `npm test && npm run test:integration && npm run test:e2e -- tests/e2e/keybindings.spec.ts tests/e2e/search.spec.ts`
Expected: all pass; new keybindings tests are green.

- [ ] **Step 2: Skip guard**

Run: `bash scripts/check-no-skipped-e2e.sh`
Expected: `OK: no test.skip in e2e specs.`

- [ ] **Step 3: Manual end-to-end smoke**

Run: `npm run dev`. Verify:
1. All 4 default shortcuts work.
2. Open Settings → Keybindings, rebind one, close Settings, the new combo works and the old one does nothing.
3. Reset that row, original combo works again.
4. Reset all, all defaults restored.
5. Try to bind a combo already in use — conflict modal appears, "Reassign" clears the old one.

- [ ] **Step 4: Open the PR**

```bash
git push -u origin HEAD
gh pr create --title "feat: customizable keyboard shortcuts" --body "$(cat <<'EOF'
## Summary

Implements the design in [`docs/superpowers/specs/2026-04-27-keybindings-design.md`](https://github.com/darkharasho/sai/blob/main/docs/superpowers/specs/2026-04-27-keybindings-design.md). Third 1.0-readiness item.

- New Settings → Keybindings page lets users rebind SAI's 4 global shortcuts.
- Capture mode: click ✏ on a row, press the new combo, captured. Esc cancels.
- Conflict modal: assigning a taken combo prompts to reassign (clears the old binding).
- Per-row reset + Reset all to defaults.
- Cross-platform: Ctrl/Cmd are stored canonically as `Ctrl`; macOS displays `⌘` symbols.
- New `useKeybinding(id, handler)` hook replaces the 4 scattered `addEventListener('keydown', ...)` sites in `App.tsx`.
- Settings persist via the existing settings IPC and sync to GitHub automatically.

## Test plan
- [x] Unit tests: `keybindings` utils, `useKeybinding` hook, `KeybindingsPage` component
- [x] E2E tests: page renders, rebind round-trip, reset, conflict modal
- [x] Manual smoke: rebind Ctrl+K → Ctrl+J, verify it works, reset, verify it works
- [ ] CI green

## Out of scope (post-1.0)
- Chord sequences (`Ctrl+K Ctrl+X`)
- Component-local shortcuts (Ctrl+F in GitSidebar, Ctrl+Enter in ChatInput/CommitBox, terminal shortcuts)
- Per-context `when` clauses
- JSON file editor
- VS Code keybindings.json import

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review Notes

- **Spec coverage:** all 8 spec sections mapped to tasks. Architecture (registry/hook/storage/normalization) → Task 1+2. Settings UI → Task 4. Migration → Task 3. SettingsModal integration → Task 5. Error handling edge cases (empty combo, unknown ID, duplicate combos, Esc cancel, blur) → covered by unit tests in Tasks 1, 2, 4. E2E → Task 6. Out-of-scope items explicitly excluded.
- **Type consistency:** `KeybindingId` defined as a union of the 4 IDs in Task 1; all later tasks use that union. `KeyCombo` is `string` throughout. The `sai:keybindings-changed` custom event name is consistent across Task 2 (listener) and Task 4 (dispatcher).
- **Placeholder check:** every step has concrete code or a precise file/line target. The Step "locate the existing block" instructions in Task 3 give grep commands and behavioral signatures so the engineer can find the right code even if line numbers shift.
- **Known caveat:** Task 3's `useCallback` deps mirror whatever the original `useEffect` captured. If the original handler captured stale state (a real bug worth fixing), the migration may surface it — note in the PR if so.
