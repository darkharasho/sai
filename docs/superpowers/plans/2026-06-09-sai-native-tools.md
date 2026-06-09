# SAI Native Tools (`pick_file`, `notify`, `clipboard`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three renderer-target native tools — `pick_file` (native dialog), `notify` (OS notification), `clipboard` (write-only) — that the chat agent can call.

**Architecture:** A pure `handleSaiNativeToolRequest(req, deps)` routes the three tools to injected deps (mirroring `saiQueryTools.ts`); `App.tsx` wires the deps to preload bridges (`sai.pickFile`/`sai.notify`/`sai.clipboardWrite`) that invoke new Electron-main IPC handlers (`dialog`/`Notification`/`clipboard`). No new MCP route (Delta A stays deferred).

**Tech Stack:** TypeScript, React, Electron, Vitest (`--maxWorkers=2`).

**Spec:** `docs/superpowers/specs/2026-06-09-sai-native-tools-design.md`

---

## File Structure

| File | Responsibility | New/Mod |
|------|----------------|---------|
| `src/render/saiNativeTools.ts` | `handleSaiNativeToolRequest` + `SaiNativeDeps`. Pure, dep-injected. | New |
| `src/lib/saiTools.ts` | `pick_file`/`notify`/`clipboard` schemas. | Mod |
| `src/App.tsx` | `onSwarmToolRequest` native-tool branch. | Mod |
| `electron/main.ts` | `sai:pick-file`/`sai:notify`/`sai:clipboard-write` IPC + `clipboard` import. | Mod |
| `electron/preload.ts` | `pickFile`/`notify`/`clipboardWrite` bridges. | Mod |

**Naming contract:** `handleSaiNativeToolRequest(req: { tool: string; input: any }, deps: SaiNativeDeps): Promise<unknown | null>`; deps `pickFile`/`notify`/`clipboardWrite`; bare tool names `pick_file`/`notify`/`clipboard`; preload `sai.pickFile`/`sai.notify`/`sai.clipboardWrite`.

---

## Task 1: `handleSaiNativeToolRequest`

**Files:** Create `src/render/saiNativeTools.ts`; Test `tests/unit/render/saiNativeTools.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/render/saiNativeTools.test.ts
import { describe, it, expect } from 'vitest';
import { handleSaiNativeToolRequest } from '../../../src/render/saiNativeTools';

describe('handleSaiNativeToolRequest', () => {
  it('returns null for an unowned tool', async () => {
    const r = await handleSaiNativeToolRequest({ tool: 'render_html', input: {} }, {});
    expect(r).toBeNull();
  });

  it('pick_file returns the chosen paths', async () => {
    const pickFile = async () => ['/a/b.txt'];
    const r = await handleSaiNativeToolRequest({ tool: 'pick_file', input: { mode: 'open' } }, { pickFile });
    expect(r).toEqual({ paths: ['/a/b.txt'] });
  });

  it('pick_file returns cancelled when the dialog is dismissed', async () => {
    const pickFile = async () => null;
    const r = await handleSaiNativeToolRequest({ tool: 'pick_file', input: {} }, { pickFile });
    expect(r).toEqual({ cancelled: true });
  });

  it('pick_file with no dep reports unavailable', async () => {
    const r = await handleSaiNativeToolRequest({ tool: 'pick_file', input: {} }, {});
    expect(r).toEqual({ ok: false, error: 'pick_file unavailable' });
  });

  it('notify requires a title', async () => {
    const notify = async () => true;
    const r = await handleSaiNativeToolRequest({ tool: 'notify', input: {} }, { notify });
    expect(r).toMatchObject({ ok: false });
    expect((r as any).error).toMatch(/title/i);
  });

  it('notify fires and returns ok', async () => {
    let got: any = null;
    const notify = async (a: any) => { got = a; return true; };
    const r = await handleSaiNativeToolRequest({ tool: 'notify', input: { title: 'Done', body: 'built' } }, { notify });
    expect(r).toEqual({ ok: true });
    expect(got).toEqual({ title: 'Done', body: 'built' });
  });

  it('clipboard writes text and returns ok', async () => {
    let written = '';
    const clipboardWrite = async (t: string) => { written = t; return true; };
    const r = await handleSaiNativeToolRequest({ tool: 'clipboard', input: { text: 'hello' } }, { clipboardWrite });
    expect(r).toEqual({ ok: true });
    expect(written).toBe('hello');
  });

  it('clipboard read is explicitly unsupported', async () => {
    const r = await handleSaiNativeToolRequest({ tool: 'clipboard', input: { action: 'read' } }, { clipboardWrite: async () => true });
    expect(r).toMatchObject({ ok: false });
    expect((r as any).error).toMatch(/read not supported/i);
  });

  it('clipboard requires text on write', async () => {
    const r = await handleSaiNativeToolRequest({ tool: 'clipboard', input: {} }, { clipboardWrite: async () => true });
    expect(r).toMatchObject({ ok: false });
    expect((r as any).error).toMatch(/text/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/render/saiNativeTools.test.ts --maxWorkers=2`
Expected: FAIL — module missing.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/render/saiNativeTools.ts
export interface PickFileOpts {
  mode?: 'open' | 'save' | 'directory';
  filters?: { name: string; extensions: string[] }[];
  multi?: boolean;
}

export interface SaiNativeDeps {
  pickFile?: (opts: PickFileOpts) => Promise<string[] | null>;
  notify?: (args: { title: string; body?: string }) => Promise<boolean>;
  clipboardWrite?: (text: string) => Promise<boolean>;
}

export interface SaiNativeRequest { tool: string; input: any; }

/**
 * Handle the native-affordance tools. Returns the result object, or null if
 * `tool` is not one this module owns (so the caller can fall through).
 */
export async function handleSaiNativeToolRequest(req: SaiNativeRequest, deps: SaiNativeDeps): Promise<unknown | null> {
  const input = req.input ?? {};

  if (req.tool === 'pick_file') {
    if (!deps.pickFile) return { ok: false, error: 'pick_file unavailable' };
    const opts: PickFileOpts = {
      mode: input.mode === 'save' || input.mode === 'directory' ? input.mode : 'open',
      filters: Array.isArray(input.filters) ? input.filters : undefined,
      multi: input.multi === true,
    };
    const paths = await deps.pickFile(opts);
    return paths === null ? { cancelled: true } : { paths };
  }

  if (req.tool === 'notify') {
    if (!deps.notify) return { ok: false, error: 'notify unavailable' };
    const title = typeof input.title === 'string' ? input.title : '';
    if (!title) return { ok: false, error: 'notify requires a "title" string' };
    const ok = await deps.notify({ title, body: typeof input.body === 'string' ? input.body : undefined });
    return ok ? { ok: true } : { ok: false, error: 'notifications unavailable' };
  }

  if (req.tool === 'clipboard') {
    if (input.action === 'read') return { ok: false, error: 'clipboard read not supported' };
    if (!deps.clipboardWrite) return { ok: false, error: 'clipboard unavailable' };
    const text = typeof input.text === 'string' ? input.text : '';
    if (!text) return { ok: false, error: 'clipboard requires a "text" string' };
    const ok = await deps.clipboardWrite(text);
    return ok ? { ok: true } : { ok: false, error: 'clipboard write failed' };
  }

  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/render/saiNativeTools.test.ts --maxWorkers=2`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add src/render/saiNativeTools.ts tests/unit/render/saiNativeTools.test.ts
git commit -m "feat(native): handleSaiNativeToolRequest for pick_file/notify/clipboard"
```

---

## Task 2: Register the schemas

**Files:** Modify `src/lib/saiTools.ts`; Test `tests/unit/lib/saiTools.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// append to tests/unit/lib/saiTools.test.ts
describe('native tools', () => {
  it('registers pick_file, notify, clipboard as chat tools', () => {
    for (const n of ['pick_file', 'notify', 'clipboard']) {
      expect(SAI_TOOL_NAMES.has(n)).toBe(true);
      expect(SAI_TOOL_SCHEMA.find((t) => t.name === n)!.toolset).toBe('chat');
    }
    expect(SAI_TOOL_SCHEMA.find((t) => t.name === 'notify')!.input_schema.required).toContain('title');
    expect(SAI_TOOL_SCHEMA.find((t) => t.name === 'clipboard')!.input_schema.required).toContain('text');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/lib/saiTools.test.ts --maxWorkers=2`
Expected: FAIL.

- [ ] **Step 3: Write minimal implementation**

Add to `SAI_TOOL_SCHEMA` in `src/lib/saiTools.ts`, after the `render_form` entry:

```ts
  {
    name: 'pick_file',
    description:
      'Open a native file/folder picker and return the path(s) the user chooses. USE THIS when you need a ' +
      'file or directory from the user — they pick it in a real OS dialog; you only receive the chosen path.',
    toolset: 'chat',
    input_schema: {
      type: 'object',
      properties: {
        mode: { type: 'string', description: "'open' (default), 'save', or 'directory'." },
        filters: { type: 'array', items: { type: 'object' }, description: 'Open-dialog file filters: [{name, extensions:[...]}].' },
        multi: { type: 'boolean', description: 'Allow selecting multiple files (open mode).' },
      },
    },
  },
  {
    name: 'notify',
    description:
      'Show an OS notification to the user (e.g. a long task finished). Fire-and-forget; returns ok. Use ' +
      'sparingly for things worth interrupting the user about.',
    toolset: 'chat',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Notification title.' },
        body: { type: 'string', description: 'Notification body text.' },
        level: { type: 'string', description: "Optional hint: 'info' | 'warn' | 'error'." },
      },
      required: ['title'],
    },
  },
  {
    name: 'clipboard',
    description:
      'Write text to the system clipboard for the user to paste. WRITE-ONLY — reading the clipboard is not ' +
      'supported. Use to hand the user a result (a command, a snippet) they can paste elsewhere.',
    toolset: 'chat',
    input_schema: {
      type: 'object',
      properties: {
        action: { type: 'string', description: "Only 'write' is supported." },
        text: { type: 'string', description: 'Text to copy to the clipboard.' },
      },
      required: ['text'],
    },
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/lib/saiTools.test.ts --maxWorkers=2`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/saiTools.ts tests/unit/lib/saiTools.test.ts
git commit -m "feat(native): register pick_file/notify/clipboard schemas"
```

---

## Task 3: Wire the renderer branch in `App.tsx`

**Files:** Modify `src/App.tsx`. Verify via typecheck.

- [ ] **Step 1: Add the native-tool branch**

In `src/App.tsx`:

1. Add the import near the other render imports (~line 55):

```ts
import { handleSaiNativeToolRequest } from './render/saiNativeTools';
```

2. In `onSwarmToolRequest`, BEFORE the existing `if (typeof req.tool === 'string' && req.tool.startsWith('render_'))` block, insert (mirroring the existing `inspect_element`/`capture_app` branch — read that branch first to match `sai`/`respondSwarmTool` names):

```ts
      if (req.tool === 'pick_file' || req.tool === 'notify' || req.tool === 'clipboard') {
        const saiAny = sai as {
          pickFile?: (o: unknown) => Promise<string[] | null>;
          notify?: (a: { title: string; body?: string }) => Promise<boolean>;
          clipboardWrite?: (t: string) => Promise<boolean>;
        };
        void handleSaiNativeToolRequest(
          { tool: req.tool, input: req.input },
          { pickFile: saiAny.pickFile, notify: saiAny.notify, clipboardWrite: saiAny.clipboardWrite },
        ).then(
          (result) =>
            result === null
              ? sai.respondSwarmToolError(req.id, `unhandled native tool: ${req.tool}`)
              : sai.respondSwarmTool(req.id, result),
          (err) => sai.respondSwarmToolError(req.id, err instanceof Error ? err.message : String(err)),
        );
        return;
      }
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/App.tsx
git commit -m "feat(native): route pick_file/notify/clipboard in the renderer"
```

---

## Task 4: Electron IPC handlers + preload bridges

**Files:** Modify `electron/main.ts`, `electron/preload.ts`. Verify via typecheck.

- [ ] **Step 1: Add the IPC handlers**

In `electron/main.ts`:

1. Add `clipboard` and `Notification` to the electron import. The current line is:
```ts
import { app, BrowserWindow, ipcMain, dialog, shell, Menu, MenuItem, screen } from 'electron';
```
Change it to:
```ts
import { app, BrowserWindow, ipcMain, dialog, shell, Menu, MenuItem, screen, clipboard, Notification } from 'electron';
```

2. Add these three handlers next to the existing `dialog.showOpenDialog` handlers (search `dialog.showOpenDialog`):

```ts
  ipcMain.handle('sai:pick-file', async (_evt, opts: { mode?: 'open' | 'save' | 'directory'; filters?: { name: string; extensions: string[] }[]; multi?: boolean }): Promise<string[] | null> => {
    if (!mainWindow || mainWindow.isDestroyed()) return null;
    const filters = Array.isArray(opts?.filters) ? opts.filters : undefined;
    if (opts?.mode === 'save') {
      const r = await dialog.showSaveDialog(mainWindow, { filters });
      return r.canceled || !r.filePath ? null : [r.filePath];
    }
    const properties: Array<'openFile' | 'openDirectory' | 'multiSelections'> =
      opts?.mode === 'directory' ? ['openDirectory'] : ['openFile'];
    if (opts?.multi && opts.mode !== 'directory') properties.push('multiSelections');
    const r = await dialog.showOpenDialog(mainWindow, { properties, filters });
    return r.canceled || r.filePaths.length === 0 ? null : r.filePaths;
  });

  ipcMain.handle('sai:notify', async (_evt, args: { title: string; body?: string }): Promise<boolean> => {
    if (!Notification.isSupported()) return false;
    try {
      new Notification({ title: String(args?.title ?? ''), body: typeof args?.body === 'string' ? args.body : undefined }).show();
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.handle('sai:clipboard-write', async (_evt, text: string): Promise<boolean> => {
    try {
      clipboard.writeText(String(text ?? ''));
      return true;
    } catch {
      return false;
    }
  });
```

- [ ] **Step 2: Add the preload bridges**

In `electron/preload.ts`, next to `captureRegion` (~line 162), add:

```ts
  pickFile: (opts: { mode?: 'open' | 'save' | 'directory'; filters?: { name: string; extensions: string[] }[]; multi?: boolean }): Promise<string[] | null> =>
    ipcRenderer.invoke('sai:pick-file', opts),
  notify: (args: { title: string; body?: string }): Promise<boolean> =>
    ipcRenderer.invoke('sai:notify', args),
  clipboardWrite: (text: string): Promise<boolean> =>
    ipcRenderer.invoke('sai:clipboard-write', text),
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0. (As with prior Electron changes, `tsconfig.json` covers `src/`; if a separate `tsconfig.node.json` has pre-existing cross-boundary errors, confirm none are NEW from these edits.)

- [ ] **Step 4: Commit**

```bash
git add electron/main.ts electron/preload.ts
git commit -m "feat(native): electron dialog/notify/clipboard IPC + preload bridges"
```

---

## Task 5: Regression + typecheck

**Files:** none (verification only)

- [ ] **Step 1: Render + tools unit suites**

Run: `npx vitest run tests/unit/render tests/unit/lib/saiTools.test.ts --maxWorkers=2`
Expected: PASS.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

---

## Self-Review Notes

- **Spec coverage:** `handleSaiNativeToolRequest` (T1), schemas (T2), renderer routing (T3), Electron IPC + preload (T4). All three tools + write-only clipboard + the unsupported-read error + user-mediated pick_file covered.
- **Pattern parity:** mirrors `saiQueryTools.ts` + the `inspect_element`/`capture_app` App branch, including the `null`-result guard at the call site.
- **Type consistency:** `SaiNativeDeps`, `PickFileOpts`, `handleSaiNativeToolRequest` defined in T1 and used unchanged in T3; preload bridge names match the deps; bare tool names match across handler/schema/App.
- **No card/e2e:** these return data (like inspect/capture); the Electron IPC is main-process and verified by build, with the pure handler fully unit-tested via injected deps.
- **Restart caveat:** the new tools are not live until the app restarts (memory `project_sai_tools_need_restart`).
