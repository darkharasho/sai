# Remove Terminal Mode

**Date:** 2026-04-14
**Status:** Proposed

## Goal

Remove the Terminal Mode feature (the fullscreen AI-powered terminal view) from SAI, since its functionality now lives in the separate TAI app. The standard bottom TerminalPanel stays.

## Scope

### Delete

**`src/components/TerminalMode/`** (14 files):

- `TerminalModeView.tsx` — main layout (tabs, input, blocks, editor)
- `TerminalModeInput.tsx` — dual-mode shell/AI input
- `TerminalTabBar.tsx` — tab management for terminal mode
- `HiddenXterm.tsx` — background xterm for state tracking
- `providerBridge.ts` — AI provider bridge with 'terminal' scope
- `BlockSegmenter.ts` — PTY output parser into blocks
- `NativeBlockList.tsx` — block display list
- `NativeCommandBlock.tsx` — command output blocks
- `AIResponseBlock.tsx` — AI response blocks
- `InlineAIBlock.tsx` — inline AI response rendering
- `ApprovalBlock.tsx` — tool approval UI
- `TerminalModeEditor.tsx` — side panel file editor
- `stripAnsi.ts` — ANSI escape code stripper
- `types.ts` — Terminal Mode-specific types

**`tests/unit/components/TerminalMode/`** (9 test files):

- `AIResponseBlock.test.tsx`
- `ApprovalBlock.test.tsx`
- `BlockSegmenter.test.ts`
- `InlineAIBlock.test.tsx`
- `NativeCommandBlock.test.tsx`
- `TerminalModeInput.test.tsx`
- `TerminalTabBar.test.tsx`
- `providerBridge.test.ts`
- `stripAnsi.test.ts`

### Modify

**`src/App.tsx`:**
- Remove imports: `TerminalModeView`, `TerminalTabBar`
- Remove `termModeActivated` / `termModeTabs` / `termModeActiveTabId` state and all conditional rendering that switches between Terminal Mode and the default view
- Remove `'terminal'` from the `PanelId` type union
- Remove the `activeTerminal` prop passed to NavBar

**`src/components/NavBar.tsx`:**
- Remove the "Term" button entirely
- Remove the `activeTerminal` prop and the `disabled` logic it gates on Files/Git/Chats buttons
- Remove `SquareTerminal` import from lucide-react

**`src/components/SettingsModal.tsx`:**
- Remove the `defaultView` state, setting load/save, and the dropdown UI for choosing between "Default" and "Terminal" startup view

**`src/types.ts`:**
- Remove from `WorkspaceContext`: `termModeActivated`, `termModeTabs`, `termModeActiveTabId`
- Keep `TerminalTab` interface (used by standard TerminalPanel)

### Keep (no changes)

- `src/components/Terminal/TerminalPanel.tsx` — standard bottom terminal pane
- `src/terminalBuffer.ts` — terminal buffer registry
- `electron/services/pty.ts` — PTY service
- `electron/preload.ts` — terminal IPC bridge
- All xterm / node-pty dependencies
- `tests/e2e/terminal.spec.ts` — tests the standard TerminalPanel, not Terminal Mode
- `tests/unit/terminalBuffer.test.ts` — tests buffer utilities

## Non-goals

- No changes to the standard TerminalPanel's behavior or appearance
- No dependency removals (xterm/node-pty still needed)
- No layout changes beyond removing the Terminal Mode toggle
