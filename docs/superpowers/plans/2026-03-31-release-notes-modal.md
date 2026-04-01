# What's New Modal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a "What's New" modal on first launch after a version update, fetching release notes from GitHub Releases, with a re-open trigger in Settings.

**Architecture:** A `useWhatsNew` hook in `src/hooks/` owns version-check logic, settings persistence, and release notes fetch. A pure `WhatsNewModal` component receives state and handlers as props. `App.tsx` wires them together and passes `openWhatsNew` down to `TitleBar → SettingsModal` for re-opening.

**Tech Stack:** React 19, TypeScript 5.7, Vite 6 (JSON import), `react-markdown` + `remark-gfm` (already installed), `window.sai.settingsGet/settingsSet` IPC, GitHub Releases API, Vitest + @testing-library/react

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `src/hooks/useWhatsNew.ts` | Version check, settings persistence, fetch, open/close state |
| Create | `src/components/WhatsNewModal.tsx` | Pure UI: header, markdown body, loading/error states, footer |
| Create | `tests/unit/hooks/useWhatsNew.test.ts` | Hook unit tests |
| Create | `tests/unit/components/WhatsNewModal.test.tsx` | Modal unit tests |
| Modify | `src/App.tsx` | Call hook, render modal, pass `openWhatsNew` to TitleBar |
| Modify | `src/components/TitleBar.tsx` | Accept + pass `onOpenWhatsNew` prop to SettingsModal |
| Modify | `src/components/SettingsModal.tsx` | Accept `onOpenWhatsNew` prop, render "What's New" button |

---

## Task 1: `useWhatsNew` hook

**Files:**
- Create: `src/hooks/useWhatsNew.ts`
- Create: `tests/unit/hooks/useWhatsNew.test.ts`

- [ ] **Step 1: Create the test file**

Create `tests/unit/hooks/useWhatsNew.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { installMockSai, createMockSai } from '../../helpers/ipc-mock';

// We mock the module so we control what 'version' resolves to.
// The real package.json version is whatever it is — tests pin it to '1.2.3'.
vi.mock('../../../package.json', () => ({ version: '1.2.3' }));

import { useWhatsNew } from '../../../src/hooks/useWhatsNew';

function makeSettingsGetMock(lastSeenVersion: string | null = null) {
  return vi.fn((_key: string, defaultValue?: unknown) => {
    if (_key === 'lastSeenVersion') return Promise.resolve(lastSeenVersion);
    return Promise.resolve(defaultValue ?? undefined);
  });
}

describe('useWhatsNew', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset fetch mock
    global.fetch = vi.fn();
    const mock = createMockSai();
    installMockSai(mock);
  });

  describe('auto-open on version mismatch', () => {
    it('opens the modal when lastSeenVersion is null (first install)', async () => {
      const mock = createMockSai();
      mock.settingsGet = makeSettingsGetMock(null);
      mock.settingsSet = vi.fn().mockResolvedValue(undefined);
      // Fetch returns a release body
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: async () => ({ body: '## Release notes' }),
      });
      installMockSai(mock);

      const { result } = renderHook(() => useWhatsNew());

      await waitFor(() => expect(result.current.isOpen).toBe(true));
    });

    it('opens the modal when lastSeenVersion differs from current version', async () => {
      const mock = createMockSai();
      mock.settingsGet = makeSettingsGetMock('1.2.2');
      mock.settingsSet = vi.fn().mockResolvedValue(undefined);
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: async () => ({ body: '## Notes' }),
      });
      installMockSai(mock);

      const { result } = renderHook(() => useWhatsNew());

      await waitFor(() => expect(result.current.isOpen).toBe(true));
    });

    it('does NOT open the modal when lastSeenVersion matches current version', async () => {
      const mock = createMockSai();
      mock.settingsGet = makeSettingsGetMock('1.2.3');
      installMockSai(mock);

      const { result } = renderHook(() => useWhatsNew());

      // Give async operations time to settle
      await new Promise(r => setTimeout(r, 50));
      expect(result.current.isOpen).toBe(false);
    });

    it('writes lastSeenVersion to settings when auto-opening', async () => {
      const mock = createMockSai();
      mock.settingsGet = makeSettingsGetMock(null);
      mock.settingsSet = vi.fn().mockResolvedValue(undefined);
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: async () => ({ body: 'notes' }),
      });
      installMockSai(mock);

      renderHook(() => useWhatsNew());

      await waitFor(() =>
        expect(mock.settingsSet).toHaveBeenCalledWith('lastSeenVersion', '1.2.3')
      );
    });
  });

  describe('fetch logic', () => {
    it('sets fetchStatus to "success" and releaseNotes on successful fetch', async () => {
      const mock = createMockSai();
      mock.settingsGet = makeSettingsGetMock(null);
      mock.settingsSet = vi.fn().mockResolvedValue(undefined);
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: async () => ({ body: '## What is new' }),
      });
      installMockSai(mock);

      const { result } = renderHook(() => useWhatsNew());

      await waitFor(() => expect(result.current.fetchStatus).toBe('success'));
      expect(result.current.releaseNotes).toBe('## What is new');
    });

    it('sets fetchStatus to "error" on non-OK HTTP response', async () => {
      const mock = createMockSai();
      mock.settingsGet = makeSettingsGetMock(null);
      mock.settingsSet = vi.fn().mockResolvedValue(undefined);
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        status: 404,
      });
      installMockSai(mock);

      const { result } = renderHook(() => useWhatsNew());

      await waitFor(() => expect(result.current.fetchStatus).toBe('error'));
      expect(result.current.releaseNotes).toBeNull();
    });

    it('sets fetchStatus to "error" on network failure', async () => {
      const mock = createMockSai();
      mock.settingsGet = makeSettingsGetMock(null);
      mock.settingsSet = vi.fn().mockResolvedValue(undefined);
      (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('network error'));
      installMockSai(mock);

      const { result } = renderHook(() => useWhatsNew());

      await waitFor(() => expect(result.current.fetchStatus).toBe('error'));
    });
  });

  describe('openWhatsNew', () => {
    it('opens the modal and triggers fetch', async () => {
      const mock = createMockSai();
      mock.settingsGet = makeSettingsGetMock('1.2.3'); // already seen — no auto-open
      mock.settingsSet = vi.fn().mockResolvedValue(undefined);
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: async () => ({ body: 'notes' }),
      });
      installMockSai(mock);

      const { result } = renderHook(() => useWhatsNew());

      // Initially closed
      await new Promise(r => setTimeout(r, 20));
      expect(result.current.isOpen).toBe(false);

      // Manually open
      result.current.openWhatsNew();

      await waitFor(() => expect(result.current.isOpen).toBe(true));
      await waitFor(() => expect(result.current.fetchStatus).toBe('success'));
    });
  });

  describe('closeWhatsNew', () => {
    it('closes the modal', async () => {
      const mock = createMockSai();
      mock.settingsGet = makeSettingsGetMock(null);
      mock.settingsSet = vi.fn().mockResolvedValue(undefined);
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: async () => ({ body: 'notes' }),
      });
      installMockSai(mock);

      const { result } = renderHook(() => useWhatsNew());

      await waitFor(() => expect(result.current.isOpen).toBe(true));

      result.current.closeWhatsNew();

      await waitFor(() => expect(result.current.isOpen).toBe(false));
    });
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd /var/home/mstephens/Documents/GitHub/sai
npx vitest run tests/unit/hooks/useWhatsNew.test.ts 2>&1 | tail -20
```

Expected: FAIL — `useWhatsNew` not found / module missing.

- [ ] **Step 3: Create `src/hooks/useWhatsNew.ts`**

```typescript
import { useState, useEffect, useCallback } from 'react';
import { version as currentVersion } from '../../package.json';

export type FetchStatus = 'idle' | 'loading' | 'success' | 'error';

export interface UseWhatsNewReturn {
  isOpen: boolean;
  version: string;
  releaseNotes: string | null;
  fetchStatus: FetchStatus;
  openWhatsNew: () => void;
  closeWhatsNew: () => void;
}

const RELEASES_URL = `https://api.github.com/repos/darkharasho/sai/releases/tags/v${currentVersion}`;

export function useWhatsNew(): UseWhatsNewReturn {
  const [isOpen, setIsOpen] = useState(false);
  const [releaseNotes, setReleaseNotes] = useState<string | null>(null);
  const [fetchStatus, setFetchStatus] = useState<FetchStatus>('idle');

  const doFetch = useCallback(() => {
    setFetchStatus('loading');
    setReleaseNotes(null);
    fetch(RELEASES_URL)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<{ body?: string }>;
      })
      .then(data => {
        setReleaseNotes(data.body ?? '');
        setFetchStatus('success');
      })
      .catch(() => setFetchStatus('error'));
  }, []);

  const openWhatsNew = useCallback(() => {
    window.sai.settingsSet('lastSeenVersion', currentVersion);
    setIsOpen(true);
    doFetch();
  }, [doFetch]);

  const closeWhatsNew = useCallback(() => setIsOpen(false), []);

  useEffect(() => {
    window.sai.settingsGet('lastSeenVersion', null).then((lastSeen: string | null) => {
      if (lastSeen !== currentVersion) {
        openWhatsNew();
      }
    });
    // Intentionally run once on mount only; openWhatsNew is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { isOpen, version: currentVersion, releaseNotes, fetchStatus, openWhatsNew, closeWhatsNew };
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npx vitest run tests/unit/hooks/useWhatsNew.test.ts 2>&1 | tail -20
```

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useWhatsNew.ts tests/unit/hooks/useWhatsNew.test.ts
git commit -m "feat: add useWhatsNew hook with version check and release notes fetch"
```

---

## Task 2: `WhatsNewModal` component

**Files:**
- Create: `src/components/WhatsNewModal.tsx`
- Create: `tests/unit/components/WhatsNewModal.test.tsx`

- [ ] **Step 1: Create the test file**

Create `tests/unit/components/WhatsNewModal.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { installMockSai, createMockSai } from '../../helpers/ipc-mock';
import WhatsNewModal from '../../../src/components/WhatsNewModal';

const defaultProps = {
  isOpen: true,
  version: '1.2.3',
  releaseNotes: null,
  fetchStatus: 'loading' as const,
  onClose: vi.fn(),
};

describe('WhatsNewModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installMockSai(createMockSai());
  });

  it('renders nothing when isOpen is false', () => {
    const { container } = render(<WhatsNewModal {...defaultProps} isOpen={false} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the header with version number', () => {
    render(<WhatsNewModal {...defaultProps} />);
    expect(screen.getByText("What's New in v1.2.3")).toBeTruthy();
  });

  it('shows loading text when fetchStatus is "loading"', () => {
    render(<WhatsNewModal {...defaultProps} fetchStatus="loading" />);
    expect(screen.getByText('Loading release notes…')).toBeTruthy();
  });

  it('shows GitHub fallback link when fetchStatus is "error"', () => {
    render(<WhatsNewModal {...defaultProps} fetchStatus="error" />);
    expect(screen.getByText('See release notes on GitHub →')).toBeTruthy();
  });

  it('renders markdown content when fetchStatus is "success"', () => {
    render(
      <WhatsNewModal
        {...defaultProps}
        fetchStatus="success"
        releaseNotes="## Hello\n\nSome release notes here."
      />
    );
    expect(screen.getByText('Hello')).toBeTruthy();
    expect(screen.getByText('Some release notes here.')).toBeTruthy();
  });

  it('shows "no notes" message when fetchStatus is success but releaseNotes is empty string', () => {
    render(<WhatsNewModal {...defaultProps} fetchStatus="success" releaseNotes="" />);
    expect(screen.getByText('No release notes available for this version.')).toBeTruthy();
  });

  it('calls onClose when close button (X) is clicked', () => {
    const onClose = vi.fn();
    render(<WhatsNewModal {...defaultProps} onClose={onClose} />);
    const closeBtn = screen.getByTestId('whats-new-close-btn');
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when "Got it" button is clicked', () => {
    const onClose = vi.fn();
    render(<WhatsNewModal {...defaultProps} onClose={onClose} />);
    fireEvent.click(screen.getByText('Got it'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when backdrop is clicked', () => {
    const onClose = vi.fn();
    const { container } = render(<WhatsNewModal {...defaultProps} onClose={onClose} />);
    const backdrop = container.querySelector('[data-testid="whats-new-backdrop"]') as HTMLElement;
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does NOT call onClose when modal content is clicked', () => {
    const onClose = vi.fn();
    const { container } = render(<WhatsNewModal {...defaultProps} onClose={onClose} />);
    const modal = container.querySelector('[data-testid="whats-new-modal"]') as HTMLElement;
    fireEvent.click(modal);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('calls onClose when ESC key is pressed', () => {
    const onClose = vi.fn();
    render(<WhatsNewModal {...defaultProps} onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does NOT call onClose on ESC when modal is closed', () => {
    const onClose = vi.fn();
    render(<WhatsNewModal {...defaultProps} isOpen={false} onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx vitest run tests/unit/components/WhatsNewModal.test.tsx 2>&1 | tail -20
```

Expected: FAIL — `WhatsNewModal` module missing.

- [ ] **Step 3: Create `src/components/WhatsNewModal.tsx`**

```tsx
import { useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { X } from 'lucide-react';
import type { FetchStatus } from '../hooks/useWhatsNew';

interface Props {
  isOpen: boolean;
  version: string;
  releaseNotes: string | null;
  fetchStatus: FetchStatus;
  onClose: () => void;
}

export default function WhatsNewModal({ isOpen, version, releaseNotes, fetchStatus, onClose }: Props) {
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const githubUrl = `https://github.com/darkharasho/sai/releases/tag/v${version}`;

  return (
    <div
      data-testid="whats-new-backdrop"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 3000,
        backdropFilter: 'blur(4px)',
      }}
      onClick={onClose}
    >
      <div
        data-testid="whats-new-modal"
        style={{
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border)',
          borderRadius: 10,
          width: 560,
          maxHeight: '80vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 24px 64px rgba(0,0,0,0.5)',
          overflow: 'hidden',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '16px 20px',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
        }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>
            What's New in v{version}
          </span>
          <button
            data-testid="whats-new-close-btn"
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              padding: 4,
              borderRadius: 4,
              display: 'flex',
            }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div style={{
          flex: 1,
          overflowY: 'auto',
          padding: '20px',
          minHeight: 0,
          fontSize: 13,
          lineHeight: 1.6,
          color: 'var(--text)',
        }}>
          {fetchStatus === 'loading' && (
            <span style={{ color: 'var(--text-muted)' }}>Loading release notes…</span>
          )}

          {fetchStatus === 'error' && (
            <a
              href={githubUrl}
              onClick={e => {
                e.preventDefault();
                window.sai.openExternal(githubUrl);
              }}
              style={{ color: 'var(--accent)', textDecoration: 'underline', cursor: 'pointer' }}
            >
              See release notes on GitHub →
            </a>
          )}

          {fetchStatus === 'success' && releaseNotes === '' && (
            <span style={{ color: 'var(--text-muted)' }}>No release notes available for this version.</span>
          )}

          {fetchStatus === 'success' && releaseNotes && (
            <div className="whats-new-markdown">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{releaseNotes}</ReactMarkdown>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: '12px 20px',
          borderTop: '1px solid var(--border)',
          display: 'flex',
          justifyContent: 'flex-end',
          flexShrink: 0,
        }}>
          <button
            onClick={onClose}
            style={{
              background: 'var(--accent)',
              border: 'none',
              borderRadius: 6,
              color: '#000',
              fontWeight: 600,
              fontSize: 13,
              padding: '7px 16px',
              cursor: 'pointer',
            }}
          >
            Got it
          </button>
        </div>
      </div>

      <style>{`
        .whats-new-markdown h1,
        .whats-new-markdown h2,
        .whats-new-markdown h3 {
          color: var(--text);
          margin: 12px 0 6px;
          font-weight: 600;
        }
        .whats-new-markdown h2 { font-size: 14px; }
        .whats-new-markdown h3 { font-size: 13px; }
        .whats-new-markdown p { margin: 0 0 8px; }
        .whats-new-markdown ul,
        .whats-new-markdown ol { margin: 0 0 8px; padding-left: 20px; }
        .whats-new-markdown li { margin-bottom: 3px; }
        .whats-new-markdown code {
          background: var(--bg-secondary);
          border-radius: 3px;
          padding: 1px 4px;
          font-family: 'JetBrains Mono', monospace;
          font-size: 12px;
        }
        .whats-new-markdown a { color: var(--accent); }
      `}</style>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npx vitest run tests/unit/components/WhatsNewModal.test.tsx 2>&1 | tail -20
```

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/WhatsNewModal.tsx tests/unit/components/WhatsNewModal.test.tsx
git commit -m "feat: add WhatsNewModal component"
```

---

## Task 3: Wire up in `App.tsx`

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Add imports to `App.tsx`**

In `src/App.tsx`, add these two imports near the top (after the existing imports):

```typescript
import { useWhatsNew } from './hooks/useWhatsNew';
import WhatsNewModal from './components/WhatsNewModal';
```

- [ ] **Step 2: Call the hook inside the `App` component**

In `src/App.tsx`, inside `export default function App()`, add the hook call after the existing `useState` declarations (around line 106, after `const [toast, setToast] = ...`):

```typescript
const { isOpen: whatsNewOpen, version: whatsNewVersion, releaseNotes, fetchStatus, openWhatsNew, closeWhatsNew } = useWhatsNew();
```

- [ ] **Step 3: Render `<WhatsNewModal>` in the JSX**

In `src/App.tsx`, find the block that renders `{toast && ...}` (around line 1107). Add the modal just before it:

```tsx
      {whatsNewOpen && (
        <WhatsNewModal
          isOpen={whatsNewOpen}
          version={whatsNewVersion}
          releaseNotes={releaseNotes}
          fetchStatus={fetchStatus}
          onClose={closeWhatsNew}
        />
      )}

      {toast && (
```

- [ ] **Step 4: Pass `openWhatsNew` to `TitleBar`**

Find the `<TitleBar` usage in `src/App.tsx` (search for `<TitleBar`). Add `onOpenWhatsNew={openWhatsNew}` as a prop:

```tsx
        <TitleBar
          projectPath={activeProjectPath}
          onProjectChange={handleProjectChange}
          completedWorkspaces={completedWorkspaces}
          busyWorkspaces={busyWorkspaces}
          onSettingChange={handleGlobalSettingChange}
          onOpenWhatsNew={openWhatsNew}
        />
```

- [ ] **Step 5: Verify existing unit tests still pass**

```bash
npx vitest run --project unit 2>&1 | tail -20
```

Expected: All existing tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx
git commit -m "feat: wire useWhatsNew and WhatsNewModal into App"
```

---

## Task 4: Add re-open trigger in `SettingsModal` and `TitleBar`

**Files:**
- Modify: `src/components/SettingsModal.tsx`
- Modify: `src/components/TitleBar.tsx`
- Test: `tests/unit/components/SettingsModal.test.tsx`
- Test: `tests/unit/components/TitleBar.test.tsx`

- [ ] **Step 1: Write failing tests for SettingsModal**

Open `tests/unit/components/SettingsModal.test.tsx` and add two tests inside the existing `describe('SettingsModal', ...)` block:

```typescript
  it('renders "What\'s New" button when onOpenWhatsNew is provided', async () => {
    const mock = createMockSai();
    mock.settingsGet = makeSettingsGetMock();
    installMockSai(mock);

    render(<SettingsModal onClose={vi.fn()} onOpenWhatsNew={vi.fn()} />);

    await waitFor(() =>
      expect(screen.getByText("What's New")).toBeTruthy()
    );
  });

  it('calls onOpenWhatsNew and onClose when "What\'s New" is clicked', async () => {
    const mock = createMockSai();
    mock.settingsGet = makeSettingsGetMock();
    installMockSai(mock);

    const onOpenWhatsNew = vi.fn();
    const onClose = vi.fn();
    render(<SettingsModal onClose={onClose} onOpenWhatsNew={onOpenWhatsNew} />);

    await waitFor(() => expect(screen.getByText("What's New")).toBeTruthy());
    fireEvent.click(screen.getByText("What's New"));

    expect(onOpenWhatsNew).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
```

Also add `waitFor` to the existing import line at the top of that file:
```typescript
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx vitest run tests/unit/components/SettingsModal.test.tsx 2>&1 | tail -20
```

Expected: the two new tests FAIL.

- [ ] **Step 3: Update `SettingsModal.tsx` to accept and use the prop**

In `src/components/SettingsModal.tsx`, update the `Props` interface (around line 3):

```typescript
interface Props {
  onClose: () => void;
  onSettingChange?: (key: string, value: any) => void;
  onOpenWhatsNew?: () => void;
}
```

Update the function signature (around line 49):

```typescript
export default function SettingsModal({ onClose, onSettingChange, onOpenWhatsNew }: Props) {
```

In the settings body, add the "What's New" button at the very bottom of the `<div className="settings-body">` block, just before `</div>` and the closing `<style>` tag. Place it after the GitHub sync note conditional:

```tsx
          {onOpenWhatsNew && (
            <>
              <div className="settings-divider" />
              <div className="settings-row">
                <div className="settings-row-info">
                  <div className="settings-row-name">What's New</div>
                  <div className="settings-row-desc">See what changed in this version</div>
                </div>
                <button
                  className="settings-close"
                  style={{ padding: '5px 10px', fontSize: 12, color: 'var(--accent)' }}
                  onClick={() => { onOpenWhatsNew(); onClose(); }}
                >
                  What's New
                </button>
              </div>
            </>
          )}
```

- [ ] **Step 4: Run SettingsModal tests**

```bash
npx vitest run tests/unit/components/SettingsModal.test.tsx 2>&1 | tail -20
```

Expected: All tests pass.

- [ ] **Step 5: Update `TitleBar.tsx` to accept and pass the prop**

In `src/components/TitleBar.tsx`, update the `TitleBarProps` interface (around line 20):

```typescript
interface TitleBarProps {
  projectPath: string;
  onProjectChange: (path: string) => void;
  completedWorkspaces?: Set<string>;
  busyWorkspaces?: Set<string>;
  onSettingChange?: (key: string, value: any) => void;
  onOpenWhatsNew?: () => void;
}
```

Update the function signature (around line 28):

```typescript
export default function TitleBar({ projectPath, onProjectChange, completedWorkspaces, busyWorkspaces, onSettingChange, onOpenWhatsNew }: TitleBarProps) {
```

Find where `<SettingsModal` is rendered (around line 289) and add the prop:

```tsx
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} onSettingChange={onSettingChange} onOpenWhatsNew={onOpenWhatsNew} />}
```

- [ ] **Step 6: Verify all unit tests pass**

```bash
npx vitest run --project unit 2>&1 | tail -30
```

Expected: All tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/components/SettingsModal.tsx src/components/TitleBar.tsx tests/unit/components/SettingsModal.test.tsx
git commit -m "feat: add What's New re-open trigger in SettingsModal and TitleBar"
```

---

## Task 5: Final verification

- [ ] **Step 1: Run full test suite**

```bash
npx vitest run --project unit 2>&1 | tail -30
```

Expected: All tests pass (522+ from before, plus new ones).

- [ ] **Step 2: TypeScript check**

```bash
npx tsc --noEmit 2>&1 | head -30
```

Expected: No errors.

- [ ] **Step 3: Commit if any fixes were needed, then done**

```bash
git add -p
git commit -m "fix: address TypeScript errors in What's New feature"
```

(Only run this step if Step 2 revealed errors that needed fixing.)
