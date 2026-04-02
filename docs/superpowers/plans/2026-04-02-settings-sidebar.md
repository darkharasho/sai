# Settings Sidebar Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the settings modal from a flat scrollable layout to a sidebar-navigated layout with General, Provider, Claude, Codex, and Gemini pages.

**Architecture:** Add an `activePage` state to SettingsModal. Split the render into a sidebar nav component and page-specific render functions. Widen the modal to ~720px with a 185px fixed sidebar. All existing state, handlers, and IPC remain unchanged.

**Tech Stack:** React, TypeScript, lucide-react (Settings, Monitor icons), existing CSS-in-JS pattern

**Spec:** `docs/superpowers/specs/2026-04-02-settings-sidebar-design.md`

---

### Task 1: Add sidebar navigation state and layout shell

**Files:**
- Modify: `src/components/SettingsModal.tsx`

- [ ] **Step 1: Write the failing test — sidebar renders with nav items**

Add to `tests/unit/components/SettingsModal.test.tsx`:

```tsx
it('renders sidebar with General and Provider nav items', () => {
  render(<SettingsModal {...defaultProps} />);
  const sidebar = document.querySelector('.settings-sidebar');
  expect(sidebar).toBeTruthy();
  expect(screen.getByText('General')).toBeTruthy();
  expect(screen.getByText('Provider')).toBeTruthy();
});

it('renders provider sub-items in sidebar', () => {
  render(<SettingsModal {...defaultProps} />);
  expect(screen.getByText('Claude')).toBeTruthy();
  expect(screen.getByText('Codex')).toBeTruthy();
  expect(screen.getByText('Gemini')).toBeTruthy();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/components/SettingsModal.test.tsx`
Expected: FAIL — no `.settings-sidebar` element, no "General"/"Provider" text in the sidebar

- [ ] **Step 3: Add activePage state and sidebar markup**

In `src/components/SettingsModal.tsx`, add the import for `Settings` and `Monitor` from lucide-react (line 2):

```tsx
import { X, Check, ChevronDown, Settings as SettingsIcon, Monitor } from 'lucide-react';
```

Add a type and state after the existing state declarations (after line 73):

```tsx
type SettingsPage = 'general' | 'provider' | 'claude' | 'codex' | 'gemini';
const [activePage, setActivePage] = useState<SettingsPage>('general');
```

Replace the `settings-body` div (the entire `<div className="settings-body">...</div>` block, lines 221-494) with a new layout that has a sidebar + content area:

```tsx
<div className="settings-layout">
  <nav className="settings-sidebar">
    <button
      className={`settings-nav-item${activePage === 'general' ? ' active' : ''}`}
      onClick={() => setActivePage('general')}
    >
      <SettingsIcon size={14} />
      <span>General</span>
    </button>
    <button
      className={`settings-nav-item${activePage === 'provider' ? ' active' : ''}`}
      onClick={() => setActivePage('provider')}
    >
      <Monitor size={14} />
      <span>Provider</span>
    </button>
    {PROVIDER_OPTIONS.map(p => (
      <button
        key={p.id}
        className={`settings-nav-sub${activePage === p.id ? ' active' : ''}`}
        onClick={() => setActivePage(p.id)}
        style={activePage === p.id ? { borderLeftColor: p.color } as React.CSSProperties : undefined}
      >
        <span
          className="provider-icon"
          style={{
            maskImage: `url('${p.svg}')`,
            WebkitMaskImage: `url('${p.svg}')`,
            backgroundColor: activePage === p.id ? p.color : 'var(--text-muted)',
            width: 14,
            height: 14,
          }}
        />
        <span>{p.label}</span>
      </button>
    ))}
  </nav>

  <div className="settings-content">
    {/* Page content will go here in subsequent tasks — for now render all sections */}
    {renderActivePage()}
  </div>
</div>
```

Add a temporary `renderActivePage` function before the `return` statement:

```tsx
const renderActivePage = () => {
  // Temporary: render everything on all pages until we split in Task 2
  return (
    <div className="settings-body">
      {/* All existing section JSX from the old settings-body goes here unchanged */}
    </div>
  );
};
```

Move ALL the existing section JSX (from the old `settings-body`) into `renderActivePage`.

- [ ] **Step 4: Add sidebar CSS**

In the `<style>` block, change `.settings-modal` width from `480px` to `720px`:

```css
.settings-modal {
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: 10px;
  width: 720px;
  box-shadow: 0 24px 64px rgba(0,0,0,0.5);
  overflow: hidden;
}
```

Add new CSS rules after the `.settings-modal` rule:

```css
.settings-layout {
  display: flex;
  min-height: 400px;
  max-height: calc(100vh - 120px);
}
.settings-sidebar {
  width: 185px;
  min-width: 185px;
  background: var(--bg-primary);
  border-right: 1px solid var(--border);
  padding: 12px 0;
  display: flex;
  flex-direction: column;
}
.settings-nav-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 16px;
  font-size: 12px;
  color: var(--text-muted);
  background: none;
  border: none;
  border-left: 2px solid transparent;
  cursor: pointer;
  text-align: left;
  width: 100%;
}
.settings-nav-item:hover { color: var(--text); background: var(--bg-hover); }
.settings-nav-item.active {
  color: var(--text);
  background: rgba(255,255,255,0.05);
  border-left-color: var(--accent);
}
.settings-nav-sub {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 16px 7px 36px;
  font-size: 11px;
  color: var(--text-muted);
  background: none;
  border: none;
  border-left: 2px solid transparent;
  cursor: pointer;
  text-align: left;
  width: 100%;
}
.settings-nav-sub:hover { color: var(--text); background: var(--bg-hover); }
.settings-nav-sub.active {
  color: var(--text);
  background: rgba(255,255,255,0.05);
}
.settings-content {
  flex: 1;
  overflow-y: auto;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/unit/components/SettingsModal.test.tsx`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add src/components/SettingsModal.tsx tests/unit/components/SettingsModal.test.tsx
git commit -m "feat: add sidebar navigation shell to settings modal"
```

---

### Task 2: Split content into page render functions

**Files:**
- Modify: `src/components/SettingsModal.tsx`
- Modify: `tests/unit/components/SettingsModal.test.tsx`

- [ ] **Step 1: Write the failing tests — page navigation**

Add to `tests/unit/components/SettingsModal.test.tsx`:

```tsx
it('shows General page by default with Editor section', () => {
  render(<SettingsModal {...defaultProps} />);
  expect(screen.getByText('Editor')).toBeTruthy();
  expect(screen.getByText('Font size')).toBeTruthy();
});

it('shows Provider page when Provider nav is clicked', async () => {
  render(<SettingsModal {...defaultProps} />);
  const providerNav = screen.getByText('Provider');
  fireEvent.click(providerNav);
  await waitFor(() => {
    expect(screen.getByText('Chat provider')).toBeTruthy();
    expect(screen.getByText('Commit message provider')).toBeTruthy();
  });
});

it('shows Claude page when Claude nav is clicked', async () => {
  render(<SettingsModal {...defaultProps} />);
  const claudeNav = screen.getByText('Claude');
  fireEvent.click(claudeNav);
  await waitFor(() => {
    expect(screen.getByText('Auto-compact context')).toBeTruthy();
  });
});

it('shows Gemini page when Gemini nav is clicked', async () => {
  render(<SettingsModal {...defaultProps} />);
  const geminiNav = screen.getByText('Gemini');
  fireEvent.click(geminiNav);
  await waitFor(() => {
    expect(screen.getByText('Loading phrases')).toBeTruthy();
  });
});

it('shows Codex placeholder page when Codex nav is clicked', async () => {
  render(<SettingsModal {...defaultProps} />);
  const codexNav = screen.getByText('Codex');
  fireEvent.click(codexNav);
  await waitFor(() => {
    expect(screen.getByText(/no codex-specific settings/i)).toBeTruthy();
  });
});

it('hides General content when on Provider page', async () => {
  render(<SettingsModal {...defaultProps} />);
  fireEvent.click(screen.getByText('Provider'));
  await waitFor(() => {
    expect(screen.queryByText('Font size')).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/components/SettingsModal.test.tsx`
Expected: FAIL — navigation doesn't switch content yet (all sections visible on all pages)

- [ ] **Step 3: Replace renderActivePage with page-specific functions**

Replace the `renderActivePage` function in `src/components/SettingsModal.tsx` with these separate render functions:

```tsx
const renderGeneralPage = () => (
  <>
    <section className="settings-section">
      <div className="settings-section-label">Editor</div>
      <div className="settings-row">
        <div className="settings-row-info">
          <div className="settings-row-name">Font size</div>
        </div>
        <select
          className="settings-select"
          value={editorFontSize}
          onChange={e => handleFontSizeChange(Number(e.target.value))}
        >
          {FONT_SIZES.map(s => (
            <option key={s} value={s}>{s}px</option>
          ))}
        </select>
      </div>
      <div className="settings-row settings-row-spaced">
        <div className="settings-row-info">
          <div className="settings-row-name">Minimap</div>
          <div className="settings-row-desc">Code overview on the right edge of the editor</div>
        </div>
        <button
          className={`settings-toggle${editorMinimap ? ' on' : ''}`}
          onClick={() => handleMinimapChange(!editorMinimap)}
          role="switch"
          aria-checked={editorMinimap}
        >
          <span className="settings-toggle-thumb" />
        </button>
      </div>
    </section>

    <div className="settings-divider" />

    <section className="settings-section">
      <div className="settings-section-label">Layout</div>
      <div className="settings-row">
        <div className="settings-row-info">
          <div className="settings-row-name">Focused chat</div>
          <div className="settings-row-desc">Chat stays at 66%, editor and terminal toggle in the remaining space</div>
        </div>
        <button
          className={`settings-toggle${focusedChat ? ' on' : ''}`}
          onClick={() => handleFocusedChatChange(!focusedChat)}
          role="switch"
          aria-checked={focusedChat}
        >
          <span className="settings-toggle-thumb" />
        </button>
      </div>
      <div className="settings-row settings-row-spaced">
        <div className="settings-row-info">
          <div className="settings-row-name">Sidebar width</div>
          <div className="settings-row-desc">Width of the file explorer and git sidebars</div>
        </div>
        <select
          className="settings-select"
          value={sidebarWidth}
          onChange={e => handleSidebarWidthChange(Number(e.target.value))}
        >
          {SIDEBAR_WIDTH_OPTIONS.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>
    </section>

    <div className="settings-divider" />

    <section className="settings-section">
      <div className="settings-section-label">Workspaces</div>
      <div className="settings-row">
        <div className="settings-row-info">
          <div className="settings-row-name">Auto-suspend after</div>
          <div className="settings-row-desc">Idle workspaces are suspended to free up resources</div>
        </div>
        <select
          className="settings-select"
          value={suspendTimeout}
          onChange={e => handleTimeoutChange(Number(e.target.value))}
        >
          {TIMEOUT_OPTIONS.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>
    </section>

    <div className="settings-divider" />

    <section className="settings-section">
      <div className="settings-section-label">Notifications</div>
      <div className="settings-row">
        <div className="settings-row-info">
          <div className="settings-row-name">System notifications</div>
          <div className="settings-row-desc">Send a desktop notification when a response completes and the app is not focused</div>
        </div>
        <button
          className={`settings-toggle${systemNotifications ? ' on' : ''}`}
          onClick={() => handleSystemNotificationsChange(!systemNotifications)}
          role="switch"
          aria-checked={systemNotifications}
        >
          <span className="settings-toggle-thumb" />
        </button>
      </div>
    </section>

    {isAuthed && (
      <>
        <div className="settings-divider" />
        <div className="settings-sync-note">
          Settings are synced to your private <code>sai-config</code> GitHub repo and shared across devices.
        </div>
      </>
    )}

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
  </>
);

const renderProviderPage = () => (
  <>
    <section className="settings-section">
      <div className="settings-section-label">AI Provider</div>
      <div className="settings-row">
        <div className="settings-row-info">
          <div className="settings-row-name">Chat provider</div>
          <div className="settings-row-desc">Which AI backend to use for the chat panel</div>
        </div>
        <div className="provider-select" ref={providerRef}>
          <button className="provider-select-btn" onClick={() => setProviderOpen(!providerOpen)}>
            <span
              className="provider-icon"
              style={{
                maskImage: `url('${PROVIDER_OPTIONS.find(p => p.id === aiProvider)!.svg}')`,
                WebkitMaskImage: `url('${PROVIDER_OPTIONS.find(p => p.id === aiProvider)!.svg}')`,
                backgroundColor: PROVIDER_OPTIONS.find(p => p.id === aiProvider)!.color,
              }}
            />
            <span>{PROVIDER_OPTIONS.find(p => p.id === aiProvider)!.label}</span>
            <ChevronDown size={11} style={{ opacity: 0.5 }} />
          </button>
          {providerOpen && (
            <div className="provider-dropdown">
              {PROVIDER_OPTIONS.map(opt => (
                <button
                  key={opt.id}
                  className={`provider-dropdown-item ${opt.id === aiProvider ? 'active' : ''}`}
                  onClick={() => { handleProviderChange(opt.id); setProviderOpen(false); }}
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
                  {opt.id === aiProvider && <Check size={13} style={{ marginLeft: 'auto', color: 'var(--accent)' }} />}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="settings-row settings-row-spaced">
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
    </section>
  </>
);

const renderClaudePage = () => (
  <section className="settings-section">
    <div className="settings-section-label">Claude</div>
    <div className="settings-row">
      <div className="settings-row-info">
        <div className="settings-row-name">Auto-compact context</div>
        <div className="settings-row-desc">Automatically compact when context reaches this threshold to reduce token costs</div>
      </div>
      <select
        className="settings-select"
        value={autoCompactThreshold}
        onChange={e => handleAutoCompactChange(Number(e.target.value))}
      >
        {AUTO_COMPACT_OPTIONS.map(opt => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    </div>
  </section>
);

const renderCodexPage = () => (
  <section className="settings-section">
    <div className="settings-section-label">Codex</div>
    <div className="settings-row">
      <div className="settings-row-info">
        <div className="settings-row-name" style={{ color: 'var(--text-muted)' }}>No Codex-specific settings yet</div>
      </div>
    </div>
  </section>
);

const renderGeminiPage = () => (
  <section className="settings-section">
    <div className="settings-section-label">Gemini</div>
    <div className="settings-row">
      <div className="settings-row-info">
        <div className="settings-row-name">Loading phrases</div>
        <div className="settings-row-desc">What to show while Gemini is thinking</div>
      </div>
      <select
        className="settings-select"
        value={geminiLoadingPhrases}
        onChange={e => handleGeminiLoadingPhrasesChange(e.target.value as any)}
      >
        <option value="all">All (witty + tips)</option>
        <option value="witty">Witty phrases</option>
        <option value="tips">Informative tips</option>
        <option value="off">Off</option>
      </select>
    </div>
  </section>
);

const renderActivePage = () => {
  switch (activePage) {
    case 'general': return renderGeneralPage();
    case 'provider': return renderProviderPage();
    case 'claude': return renderClaudePage();
    case 'codex': return renderCodexPage();
    case 'gemini': return renderGeminiPage();
  }
};
```

The `settings-content` div in the return JSX stays as:

```tsx
<div className="settings-content">
  {renderActivePage()}
</div>
```

Add padding to `.settings-content` in the CSS (update the rule):

```css
.settings-content {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
}
```

Remove the `.settings-body { padding: 20px; }` CSS rule since it's no longer used.

- [ ] **Step 4: Update existing tests that assume flat layout**

The existing test `'renders AI Provider section'` checks for text "AI Provider" which now only appears on the Provider page. Update it:

```tsx
it('renders AI Provider section on Provider page', async () => {
  render(<SettingsModal {...defaultProps} />);
  fireEvent.click(screen.getByText('Provider'));
  await waitFor(() => {
    expect(screen.getByText('AI Provider')).toBeTruthy();
  });
});
```

The existing tests for `'renders Chat provider row'` and `'renders Commit message provider row'` also need to navigate to the Provider page first:

```tsx
it('renders Chat provider row on Provider page', async () => {
  render(<SettingsModal {...defaultProps} />);
  fireEvent.click(screen.getByText('Provider'));
  await waitFor(() => {
    expect(screen.getByText('Chat provider')).toBeTruthy();
  });
});

it('renders Commit message provider row on Provider page', async () => {
  render(<SettingsModal {...defaultProps} />);
  fireEvent.click(screen.getByText('Provider'));
  await waitFor(() => {
    expect(screen.getByText('Commit message provider')).toBeTruthy();
  });
});
```

The provider dropdown test needs to navigate to Provider page first:

```tsx
it('opens provider dropdown when provider button is clicked', async () => {
  render(<SettingsModal {...defaultProps} />);
  fireEvent.click(screen.getByText('Provider'));
  await waitFor(() => {
    const providerBtns = document.querySelectorAll('.provider-select-btn');
    expect(providerBtns.length).toBeGreaterThan(0);
    fireEvent.click(providerBtns[0]);
  });
  await waitFor(() => {
    expect(document.querySelector('.provider-dropdown')).toBeTruthy();
  });
});
```

The `settingsSet` on provider change test also needs to navigate first:

```tsx
it('calls settingsSet when provider changes', async () => {
  const mock = createMockSai();
  mock.settingsGet = makeSettingsGetMock();
  mock.githubGetUser.mockResolvedValue(null);
  installMockSai(mock);

  render(<SettingsModal {...defaultProps} />);
  fireEvent.click(screen.getByText('Provider'));

  await waitFor(() => {
    const providerBtns = document.querySelectorAll('.provider-select-btn');
    expect(providerBtns.length).toBeGreaterThan(0);
    fireEvent.click(providerBtns[0]);
  });

  await waitFor(() => {
    const dropdown = document.querySelector('.provider-dropdown');
    expect(dropdown).toBeTruthy();
  });

  const codexBtn = Array.from(document.querySelectorAll('.provider-dropdown-item')).find(
    btn => btn.textContent?.includes('Codex')
  );
  if (codexBtn) {
    fireEvent.click(codexBtn);
    await waitFor(() => {
      expect(mock.settingsSet).toHaveBeenCalledWith('aiProvider', 'codex');
    });
  }
});
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/unit/components/SettingsModal.test.tsx`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add src/components/SettingsModal.tsx tests/unit/components/SettingsModal.test.tsx
git commit -m "feat: split settings into navigable pages (General, Provider, Claude, Codex, Gemini)"
```

---

### Task 3: Update E2E tests

**Files:**
- Modify: `tests/e2e/settings.spec.ts`

- [ ] **Step 1: Read current E2E tests**

Read `tests/e2e/settings.spec.ts` to understand the current test structure and selectors.

- [ ] **Step 2: Update E2E tests for sidebar navigation**

Update the E2E tests to account for the new sidebar layout. The "Contains AI provider options" test needs to click the Provider nav item first. The font size test should still work on the default General page. Add a test for sidebar navigation between pages.

Exact changes depend on the E2E framework selectors found in Step 1 — adjust selectors to navigate via `.settings-nav-item` clicks before asserting page-specific content.

- [ ] **Step 3: Run E2E tests**

Run: `npx playwright test tests/e2e/settings.spec.ts`
Expected: ALL PASS

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/settings.spec.ts
git commit -m "test: update settings E2E tests for sidebar navigation"
```

---

### Task 4: Visual polish and final verification

**Files:**
- Modify: `src/components/SettingsModal.tsx` (CSS only)

- [ ] **Step 1: Run the dev server and visually verify**

Run: `npm run dev` (or the project's dev command)
Open the app, open settings, and verify:
- General page shows Editor, Layout, Workspaces, Notifications sections
- Provider page shows Chat provider and Commit message provider dropdowns
- Claude page shows Auto-compact context
- Codex page shows placeholder message
- Gemini page shows Loading phrases
- Active sidebar item is highlighted with correct color
- Provider sub-items use brand colors when active
- Modal is wider (~720px) and sidebar is 185px
- Content area scrolls independently

- [ ] **Step 2: Tweak CSS if needed**

Adjust spacing, colors, or hover states based on visual inspection. Common adjustments:
- Ensure the sidebar doesn't scroll unless there are many items
- Verify the provider icon badges render correctly in the sidebar
- Check that the modal doesn't overflow on smaller screens

- [ ] **Step 3: Run all tests**

Run: `npx vitest run tests/unit/components/SettingsModal.test.tsx && npx playwright test tests/e2e/settings.spec.ts`
Expected: ALL PASS

- [ ] **Step 4: Commit**

```bash
git add src/components/SettingsModal.tsx
git commit -m "style: polish settings sidebar navigation"
```
