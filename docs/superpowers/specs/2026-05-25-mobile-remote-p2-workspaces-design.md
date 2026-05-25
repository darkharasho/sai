# Mobile Remote — Phase 2: Workspace switcher + per-prompt overrides

Status: design spec. Implementation plan follows.

Parent roadmap: `2026-05-25-mobile-remote-roadmap.md`.
P0 (foundation) and P1 (chat + approvals) are merged.

## Scope

Phase 2 adds two phone-side surfaces on top of P1's chat:

1. **Workspace picker** in the session drawer — list all open workspaces (plain projects and meta workspaces), tap to switch which workspace the phone is attached to AND drive the desktop's active workspace to match.
2. **Per-prompt overrides** above the composer — a sticky chip row letting the user override `model`, `effort`, and `permMode` on the phone, per session. Overrides ride along on every `prompt` frame using fields the wire protocol already accepts.

Claude only (same as P1). Codex / Gemini wrap-points and pairing-management-from-phone are explicit non-goals for v1.

## Goals

1. A user with two workspaces open on desktop can tap a workspace in the phone drawer; the desktop window switches active workspace and the phone re-attaches to that workspace's chat session.
2. A user can tap the `model` chip on the phone and pick a different model; the next prompt uses it and the chip persists across follow-ups in that session.
3. Setting `permMode` on the phone is clamped by the existing `remoteCeiling` desktop setting from P1 — phone can never be more permissive than the ceiling, regardless of what the chip shows.
4. Overrides survive PWA reload (localStorage); switching session clears them automatically (sessionId-keyed).

## Non-goals

- Pairing management from phone (later phase if needed)
- Codex / Gemini provider wiring (separate phase)
- Per-prompt one-shot overrides (sticky only)
- Custom user-editable model lists (hardcoded common Claude models)
- Multi-workspace fan-out (each tap attaches exactly one workspace)

## Architecture

```
phone PWA
   ⇄ WS
bridge-server.ts
   ├─ new inbound: workspaces.list, workspace.set
   ├─ new outbound: workspaces.list.result
   └─ session.active push reused — desktop's existing setActiveProjectPath
      effect re-broadcasts via the activeSessionRef wired in P1.

electron/services/remote/renderer-proxy.ts
   └─ new kinds: 'listWorkspaces', 'setActiveWorkspace'

src/lib/remoteProxyClient.ts (renderer)
   ├─ listWorkspaces: derive [{ projectPath, name, kind, members? }] from
   │  the App's workspaces state + meta workspace registry
   └─ setActiveWorkspace: call setActiveProjectPath(projectPath)

src/renderer-remote/ (PWA)
   ├─ chat/WorkspacePicker.tsx   workspaces section in SessionDrawer
   ├─ chat/OverridesBar.tsx      sticky chip row above Composer
   └─ chat/PickerSheet.tsx       bottom-sheet picker
```

## Wire protocol additions

### Client → Server

```jsonc
{ "type": "workspaces.list", "reqId": "<client-uuid>" }
{ "type": "workspace.set",   "projectPath": "/path/to/repo" }
```

### Server → Client

```jsonc
{ "v": 1, "type": "workspaces.list.result", "reqId": "...",
  "workspaces": [
    { "projectPath": "/p/sai", "name": "sai", "kind": "project" },
    { "projectPath": "meta://ai-dev", "name": "AI Dev Tools", "kind": "meta",
      "members": [
        { "projectPath": "/p/sai", "name": "sai" },
        { "projectPath": "/p/tai", "name": "tai" }
      ]
    }
  ]
}
```

No new server frame is needed in response to `workspace.set`. The renderer applies the change, the existing `setActiveSession` effect fires its `setActiveSessionRef` snapshot through main, and main re-broadcasts `session.active` to followers (Phase 1 behavior). The phone's existing follow handler then re-attaches.

Existing prompt frame already accepts `model`, `effort`, `permMode`; no changes needed for overrides.

## Main-process changes

### `renderer-proxy.ts`

Extend the `Kind` union:

```ts
type Kind = 'listSessions' | 'loadHistory' | 'getActiveSession'
          | 'listWorkspaces' | 'setActiveWorkspace';
```

New methods (request/reply pattern identical to P1):

```ts
listWorkspaces(): Promise<RemoteWorkspace[]>;
setActiveWorkspace(projectPath: string): Promise<void>;
```

`RemoteWorkspace`:
```ts
interface RemoteWorkspace {
  projectPath: string;
  name: string;
  kind: 'project' | 'meta';
  members?: { projectPath: string; name: string }[]; // meta only
}
```

### `bridge-server.ts`

Extend `BridgeServerOpts` with two optional callbacks:

```ts
listWorkspaces?: () => Promise<RemoteWorkspace[]>;
setActiveWorkspace?: (projectPath: string) => Promise<void>;
```

Inside the WS message handler, add two new branches:

```ts
if (msg.type === 'workspaces.list') {
  const reqId = msg.reqId;
  try {
    const workspaces = (await this.opts.listWorkspaces?.()) ?? [];
    ws.send(JSON.stringify({ v: 1, type: 'workspaces.list.result', reqId, workspaces }));
  } catch (err) {
    ws.send(JSON.stringify({ v: 1, type: 'error', reqId, code: 'list_failed', message: (err as Error).message }));
  }
  return;
}

if (msg.type === 'workspace.set' && typeof msg.projectPath === 'string') {
  try { await this.opts.setActiveWorkspace?.(msg.projectPath); }
  catch (err) {
    ws.send(JSON.stringify({ v: 1, type: 'error', code: 'switch_failed', message: (err as Error).message }));
  }
  return;
}
```

### `main.ts`

Wire the new opts into the bridge construction:

```ts
listWorkspaces: () => rendererProxy!.listWorkspaces(),
setActiveWorkspace: (path) => rendererProxy!.setActiveWorkspace(path),
```

## Renderer changes

### `src/lib/remoteProxyClient.ts`

Extend the deps interface:

```ts
export interface RemoteProxyDeps {
  getActiveSession: () => ActiveSessionSnapshot | null;
  listWorkspaces: () => RemoteWorkspace[];
  setActiveWorkspace: (projectPath: string) => void;
}
```

Add the new kinds to the request handler:

```ts
else if (kind === 'listWorkspaces') result = deps.listWorkspaces();
else if (kind === 'setActiveWorkspace') {
  deps.setActiveWorkspace(args.projectPath);
  result = null;
}
```

### `src/App.tsx`

Pass `listWorkspaces` and `setActiveWorkspace` to `installRemoteProxyHandler`:

```tsx
const off = installRemoteProxyHandler({
  getActiveSession: () => activeSessionRef.current,
  listWorkspaces: () => {
    return Array.from(workspacesRef.current.entries()).map(([projectPath, ws]) => ({
      projectPath,
      name: deriveWorkspaceName(projectPath), // basename or meta-workspace name
      kind: projectPath.startsWith('meta://') ? 'meta' : 'project',
      members: /* meta member list when applicable */ undefined,
    }));
  },
  setActiveWorkspace: (path) => setActiveProjectPath(path),
});
```

The exact `deriveWorkspaceName` and meta member extraction live in `lib/remoteProxyClient.ts` (or a small helper) so the App component stays compact.

## PWA — new components

### `chat/WorkspacePicker.tsx`

Renders inside `SessionDrawer` above the sessions list:

- Section header "Workspaces" (uppercase mono in `--text-muted`)
- Each workspace: button row showing icon + name + projectPath in muted mono
- Icon: `Folder` (lucide) for project, `Layers` for meta
- Meta entries show member chips in a second line
- Current attached workspace gets an accent left border + bold name

On tap:
```ts
client.setActiveWorkspace(workspace.projectPath);
onClose(); // close the drawer
```

The phone's existing follow-mode handler (`session.active` push) drives the re-attach naturally. Within 1–2 seconds the chat surface reflects the new workspace.

### `chat/OverridesBar.tsx`

Sticky row above the Composer:

```
┌──────────────────────────────────────────┐
│ ▌ opus-4-7  │  effort: medium  │  ask │  │
└──────────────────────────────────────────┘
```

- Three pill buttons; one per override (`model`, `effort`, `permMode`)
- Each pill shows the current value or muted "default" when unset
- Tap → opens `PickerSheet`
- "Reset to defaults" link at the right edge clears all three

State persists in `localStorage['sai-remote-overrides']`:

```ts
type OverrideMap = Record<string /* sessionId */, {
  model?: string;
  effort?: 'low' | 'medium' | 'high';
  permMode?: 'auto' | 'auto-read' | 'always-ask';
}>;
```

Cleared when the active session changes (Chat orchestrator clears the entry for the previous session id on attach).

Initial model list (hardcoded for v1):

```ts
const CLAUDE_MODELS = [
  { id: 'claude-opus-4-7',   label: 'Opus 4.7' },
  { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
  { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5' },
];
```

When Anthropic ships new models we update this array. Replacing with a remote-fetched list is a separate task if it becomes annoying.

### `chat/PickerSheet.tsx`

Bottom-sheet picker shown when a pill is tapped:

- Slides up from the bottom 60% of the viewport
- Title in the header
- Vertical list of options
- Tap an option → selects and closes
- Backdrop tap closes without changing
- Generic over the option type: receives `{ title, options: { value, label, hint? }[], current, onSelect, onClose }`

Used by all three overrides; possibly reused later for other settings.

### `chat/Composer.tsx` integration

Composer's `sendPrompt` call now spreads the active override map:

```ts
const overrides = overridesForSession[active.sessionId] ?? {};
client.sendPrompt({
  text,
  projectPath: active.projectPath,
  scope: active.scope,
  model: overrides.model,
  effort: overrides.effort,
  permMode: overrides.permMode,
});
```

The override-bar lives between the Transcript and the Composer in `Chat.tsx`.

## Persistence

- Overrides: `localStorage['sai-remote-overrides']`, keyed by sessionId
- Bearer + deviceId: existing P0 storage unchanged
- Workspace selection is NOT persisted — phone always picks up wherever the desktop's active workspace currently is (the follow effect re-attaches on every load)

## Failure modes

| Condition | Behavior |
|---|---|
| `workspaces.list` proxy times out | Phone shows "Workspaces unavailable" in the picker; falls back to current attached workspace only |
| Phone taps a workspace that's since been closed on desktop | `setActiveWorkspace` resolves but the resulting `session.active` references a still-open workspace; phone re-attaches to whatever desktop landed on |
| Override model that desktop doesn't support | claude.ts already validates; an error event flows back via the bus. Phone shows it as a `system` bubble. |
| `permMode` override exceeds `remoteCeiling` | Clamp applies (P1 wiring); resulting `permMode` is the stricter of the two |

## Testing

### Unit (`tests/unit/remote/`)

- Extend `bridge-server-chat.test.ts`:
  - `workspaces.list` returns the stubbed list with reqId correlation
  - `workspace.set` calls the injected callback exactly once with the right path
- Extend `renderer-proxy.test.ts` (or add new file): the two new kinds round-trip through reply/reject correctly

### Integration (`tests/integration/remote/`)

Append to `chat-end-to-end.test.ts` (or a new `workspace-switch-end-to-end.test.ts`):

- list workspaces → expect stubbed payload
- set workspace → expect injected callback fired, simulate the resulting `session.active` push, assert the phone receives it

### Manual smoke

`docs/superpowers/notes/2026-05-25-mobile-remote-p2-smoke.md`:

- Open SAI with 2+ workspaces; pair phone; verify the drawer's Workspaces section lists them all
- Tap a different workspace from the phone → desktop window switches AND phone transcript switches
- Set `model` chip to Haiku; send a prompt; verify on desktop the prompt ran with Haiku (the resulting `system` init event will mention the model)
- Set `permMode` to `always-ask` and desktop's ceiling to `auto`; send a prompt that would normally auto-approve → approval banner appears (clamp from P1 still works on top)
- Reload PWA; chips persist their values

## Exit criteria

1. All vitest unit + integration tests pass (P0+P1 still green; P2 additions new and passing).
2. `tsc --noEmit` clean.
3. Manual smoke checklist completed on iPhone over Tailscale.
4. Per-prompt overrides survive PWA reload and apply on the next send.
5. Workspace switching from phone drives the desktop window and the phone in sync.

## Open questions resolved during implementation

- Exact shape of `deriveWorkspaceName` for meta workspaces — check `electron/services/metaWorkspace.ts` for the canonical name field
- Whether sessions for the destination workspace should auto-load when arriving via `workspace.set` — Phase 1's `session.active` push already drives this; verify the flow ends with a clean attach
- Where the override-bar sits visually when an Approval banner is shown — likely above the banner but below transcript

These are wrap-point checks for implementation, not blockers on design.

## Phase 3+ preview

Phase 3 (read-only files) will reuse the workspace picker as its "pick a repo to browse" entry point. Phase 4 (git panel) adds per-repo controls inside the picker. No design churn expected from P2.
