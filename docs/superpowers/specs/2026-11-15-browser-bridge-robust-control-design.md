# Browser bridge: robust, full control — design

Date: 2026-11-15
Status: draft, pending approval

## Intent

The SAI browser bridge (`extension/chrome/background.js` + `electron/services/browserBridge.ts`
+ `sai_browser_*` tools) is fragile and too limited to finish real tasks:

- A native page dialog — most visibly the "Leave site?" `beforeunload` prompt —
  wedges the tab. While a JS dialog is open, `Runtime.evaluate` blocks, so every
  call hangs until SAI's 20 s timeout. Nothing in the bridge notices or can
  dismiss the dialog.
- Once that happens the user often can't re-attach. The toolbar click decides
  attach-vs-detach from the in-memory `attached` map, which is lost whenever
  the MV3 service worker is torn down. If the map and Chrome's real debugger
  state disagree, the click calls `chrome.debugger.attach` on a tab that is
  already attached, Chrome refuses, and the error only reaches the worker console.
- The action set is small (click, type, 14 keys, scroll, same-origin navigate),
  so SAI stalls on hover menus, `<select>`s, history, waiting for content,
  login/OAuth hops to another origin, and links that open new tabs.

The user wants SAI to reliably drive a shared tab end to end. What they'd
ideally like is unrestricted Chrome control (option C below). For now they chose
to keep the per-tab sharing model, with sharing a tab also meaning control.

## Decisions (made by the user)

- **Approach B.** Keep the extension and per-tab sharing. Remove the
  same-origin limit, and auto-share tabs opened by a shared tab.
- **No read-only mode.** Attaching a tab = SAI can control it. Remove the
  "Let SAI control this tab" context-menu opt-in, the `control` flag, the
  `resolveControlledTabId` gate, `controlledTabIds` storage, and the amber/blue
  badge distinction.

## Goals

1. A page dialog never wedges the bridge. SAI is told a dialog is open and can
   accept or dismiss it.
2. No call hangs silently. Every call either succeeds or returns a specific error
   well inside SAI's 20 s call timeout.
3. The toolbar click always does what the user expects. If Chrome says the
   extension's debugger is on the tab, the click detaches it. Otherwise the click
   attaches. A stale map can never lock a tab out. When attach fails (for example
   because DevTools is open on that tab), the user sees why.
4. Broader actions: history (back/forward/reload), cross-origin navigation,
   hover, select an option, wait for a condition, key combos and arbitrary
   single characters, opening and closing shared tabs.
5. Tabs opened by a shared tab (`target=_blank`, `window.open`, OAuth popups) are
   attached automatically.

## Non-goals

- Option C (drive Chrome over a remote-debugging port, chrome-devtools-mcp
  style). This is a possible future direction, not part of this build.
- Seeing tabs the user never shared. The bridge still can't enumerate them.
- Cross-origin iframe traversal, file upload, drag-and-drop, Firefox.

## Anti-goals

- Re-introducing silent failure modes: any new path that can block must have a
  timeout and an actionable error.
- Auto-accepting dialogs. A "Leave site?" prompt can mean unsaved work. It is
  surfaced to SAI and never answered implicitly.

## Approaches considered

- **A. Add actions, keep the read-only/control split and the same-origin rule.**
  This is the safest option, but SAI would still get stuck on login and payment
  redirects. Rejected.
- **B. Option A plus cross-origin navigation and auto-attaching child tabs.**
  Chosen. The user then also removed the read-only mode.
- **C. Drop the extension and drive Chrome over its remote-debugging port.** The
  user's preference long term. Deferred because it ends the share-a-tab model and
  fits poorly with the Flatpak Chrome setup (see the flatpak bridge relay).

## Design

### 1. Dialogs

- On attach, enable `Page`. That already happens; keep it, and re-enable after
  rehydrate. Listen on `chrome.debugger.onEvent` for:
  - `Page.javascriptDialogOpening`: store `{ type, message, url, defaultPrompt }`
    in a per-tab `dialogs` map. Send a `dialog-opened` event to SAI.
  - `Page.javascriptDialogClosed`: clear the entry.
- Every handler checks the map before touching the page. If a dialog is open, it
  fails fast with: `a <type> dialog is open on tab N: "<message>" — call
  sai_browser_dialog to accept or dismiss it`. `tabs.list` and the new `dialog`
  method are the only exceptions.
- If a dialog opens *during* an action (for example `beforeunload` fired by
  `navigate` or `click`), the in-flight wait (settle/evaluate) must stop
  promptly. The action then returns success-with-`dialog: {…}` instead of an error,
  because the action did happen and the dialog is its result.
- New tool `sai_browser_dialog { action: 'accept' | 'dismiss', promptText?, tabId? }`
  → `Page.handleJavaScriptDialog`. After accepting a `beforeunload` dialog, it
  settles and returns the new URL and title.
- `tabs.list` and `snapshot` include the open dialog, if any, so SAI can see it
  without first failing a call.

### 1b. Detaching (user-reported: happens "a LOT") — diagnose first

The user reports frequent detaching. The cause isn't known yet, so the first task
is to instrument and reproduce. Fixes come after. Candidates from reading the code:

- **The link drops, not the debugger.** `browser-bridge-host.ts` exits whenever
  the SAI socket closes (SAI restart, or a newer relay winning the socket). The
  extension's `port.onDisconnect` then nulls the port and only reconnects on the
  30 s keepalive alarm. To the user that looks like a detach, even though the
  tab is still attached.
- **The service worker restarts and loses track.** `rehydrate()` only restores
  tabs listed in session storage *and* reported `attached` by `getTargets`. If
  either is missing, the map is empty while Chrome's debugger stays on the tab.
  That is the "can't reattach" state.
- **`chrome.debugger.onDetach`.** This fires for `canceled_by_user` (infobar
  closed, or DevTools opened) and `target_closed`. Some navigations (crashes,
  certain process swaps, pages Chrome blocks) may also detach.
- **The user clicks to recover from a wedged dialog.** Covered by §1.

Instrumentation (kept permanently, cheap):
- The extension sends a `diag` event frame for every `onDetach` (with `reason`),
  `port.onDisconnect` (with `lastError`), worker start/rehydrate (stored vs.
  adopted tab counts), and attach failure.
- `browserBridge.ts` writes those frames and its own relay connect/disconnect to
  the devlog on channel `browserBridge` (`devlog()` in `electron/services/devlog.ts`).

Fixes this design commits to, whichever cause dominates:
- On `port.onDisconnect`, reconnect immediately while tabs are attached, with
  backoff (for example 0.5 s → 1 s → 2 s → 5 s), instead of waiting for the alarm.
  A request that arrives during a reconnect is answered once the link is back.
- Rehydrate by probing (§3), not by storage plus the `attached` flag.
- Errors and `tabs.list` say which state the tab is in: "the link to SAI
  dropped, reconnecting" vs. "Chrome detached the debugger (reason: …) — click
  the toolbar button to share again".
- After instrumenting, the builder reproduces with the user's Flatpak Chrome (SAI
  restart, idle worker, navigation, dialog) and fixes any further cause the log
  shows before calling this done.

### 2. Timeouts

- Every `cdp()` call gets a timeout (builder's call; around 8 s). A late reply is
  ignored. The timeout error names the CDP method and says whether a dialog is
  open.
- `Runtime.evaluate` also passes CDP's own `timeout` parameter, so a runaway
  page script is cut off inside the page as well.
- The extension's total time per request stays under SAI's `CALL_TIMEOUT_MS`
  (20 s), so SAI always gets the extension's specific error, not the generic
  `timed out after 20s`. `wait` is the one long-running method: cap its timeout at
  15 s.

### 3. Attachment truth and re-attach

- Toolbar click: ask Chrome first. Probe the tab with a cheap `sendCommand`
  (for example `Runtime.evaluate("1")` with a short timeout). Success means our
  debugger is attached: adopt it into the map if missing, then detach. If the
  probe fails with "not attached", attach.
- Failed attach: show it to the user. Set badge text `!` for a few seconds, set
  the title to the error, and log it. Map known Chrome errors to plain text, for
  example "DevTools is open on this tab — close it and try again" and "Chrome
  doesn't allow attaching to this page".
- `rehydrate()` keeps reading `attachedTabIds` from session storage, and also
  drops entries Chrome no longer reports. Treat storage as a hint and the probe
  as the source of truth.
- `chrome.debugger.onDetach`: on `canceled_by_user` (the user closed the infobar)
  or `target_closed`, remove the tab and tell SAI. Either way, the next toolbar
  click re-attaches cleanly.
- Builder verifies: a tab-level `chrome.debugger` session survives cross-origin
  navigation and renderer process swaps (it should for tab targets). If
  `Page.enable` or other domain state is lost, re-enable it on
  `Page.frameNavigated` / `Runtime.executionContextsCleared`.

### 4. Remove the read-only/control split

- Delete `CONTROL_MENU_ID`, the context menu and its listeners, `setControl`,
  `meta.control`, `controlledTabIds`, `resolveControlledTabId`, and the
  `control-granted`/`control-revoked` events. Every handler uses `resolveTabId`.
- Badge: a single colour (amber, because attached now means drivable). Title:
  `N tab(s) shared with SAI — SAI can control them`.
- `browserBridge.ts`: merge `BRIDGE_READ_METHODS` and `BRIDGE_WRITE_METHODS` into
  one list, add the new methods, and update the comment about the consent
  boundary.
- `tests/unit/lib/browserControlGate.test.ts`: replace its assertions. Assert that
  any attached tab can be driven and an unattached tab can't.

### 5. New and changed tools

All take an optional `tabId`. Tool schemas live in `src/lib/saiTools.ts`, and the
tool→method map in `src/lib/browserTools.ts`.

| Tool | Method | Behaviour |
| --- | --- | --- |
| `sai_browser_navigate` (changed) | `navigate` | `url` (any http/https; relative URLs resolve against the current page) **or** `action: 'back' \| 'forward' \| 'reload'`. Back/forward via `Page.getNavigationHistory` + `Page.navigateToHistoryEntry`. Returns settled URL/title, plus `dialog` if one opened. |
| `sai_browser_hover` | `hover` | Resolve `ref` and send `mouseMoved` to its centre. Returns after a short settle. |
| `sai_browser_select` | `select` | Set a `<select>`'s option by `value` or visible `label` (`multiple` takes an array). Dispatch `input` and `change`. Fail with the available options if none match. Custom (non-native) dropdowns stay click-driven. |
| `sai_browser_wait` | `wait` | Poll until `text` appears, `selector` matches a visible element, or `urlIncludes` matches. `gone: true` inverts the check. `timeoutMs` defaults to 5000 and is capped at 15000. Returns `{ met, waitedMs }` and never errors on timeout. |
| `sai_browser_press` (changed) | `press` | Keep the named keys. Also accept any single printable character and `+`-joined modifiers (`Control+a`, `Shift+Tab`, `Meta+Enter`) via the CDP `modifiers` bitmask. |
| `sai_browser_dialog` | `dialog` | See §1. |
| `sai_browser_open_tab` | `tabs.open` | `chrome.tabs.create({ url, openerTabId, windowId, active: false })`, http/https only. The opener defaults to the resolved shared tab, and the new tab opens in that tab's window in the background, so it doesn't take focus from the user. Auto-attaches the new tab and returns its `tabId`. *(My call: there is no standalone mode. The bridge is only connected while a tab is shared anyway.)* |
| `sai_browser_close_tab` | `tabs.close` | Close an attached tab only. |

`browser_snapshot`, `browser_read`, `browser_click`, `browser_type` and
`browser_scroll` keep their behaviour. Their descriptions drop the "requires
control" wording.

### 6. Auto-attach child tabs

*(User decision: only tabs that SAI's own actions open.)*

- `chrome.tabs.onCreated`: attach the new tab only if its `openerTabId` is an
  attached tab **and** that tab is inside an SAI action window. The window lasts
  from the start of a `click`/`press`/`type`/`navigate`/`dialog` call until a
  short grace period after it returns (builder's call; around 3 s, enough for
  OAuth popups). Tabs the user opens from a shared tab (middle-click, Ctrl+click)
  stay private. Grandchildren qualify through the same rule, because their opener
  is then an attached tab that SAI is acting in. `openerTabId` is readable without the `tabs` permission, so the bridge
  still can't list tabs that weren't shared. Send `attached` with
  `openedBy: <openerTabId>`.
- The SAI-side result of `click` (and `press` with Enter) includes `openedTabs:
  [tabId…]` for tabs created during the action, so SAI knows to switch.
- Attach can race the new tab's first navigation. Retry briefly. If Chrome refuses
  (for example `chrome://` pages), report the failure instead of throwing.

### 6b. Where bridge events go

*(My call.)* `dialog-opened`, `detached` and `attached` (with `openedBy`) only
update the bridge's state in `browserBridge.ts` (attached tab ids, open dialogs
per tab). The next tool call or `tabs.list` reflects that state. Nothing is
pushed to the renderer or into the running chat session.

### 7. Docs, versioning, rollout

- Rewrite `docs/browser-bridge.md`: the consent model (sharing = control), the
  tools table, dialogs, limitations (remove "same-origin" and the read-only
  sections).
- Bump the extension manifest to `0.4.0`, and update its `description`.
- Since the Flatpak bridge, the user's Chrome loads the extension from
  `~/.sai/browser-bridge/extension`. After the update ships, the user re-loads
  the extension there (same step as before). New MCP tool schemas need an SAI
  restart.

## Testing

- Unit tests (vitest, `--maxWorkers=2`): handler tests in the style of the
  existing `browserControlGate` test, with a faked `chrome.debugger`. Cover:
  dialog open blocks with the specific error, and an action that triggers a dialog
  returns `dialog`; the CDP timeout fires; the toolbar click adopts an attached tab
  missing from the map and detaches it; attach errors map to user text; key-combo
  parsing; select by value/label/missing; wait met/timeout; history navigate;
  child-tab auto-attach via `openerTabId`.
- `tests/unit/lib/browserTools.test.ts`: the new tool→method mappings.
- Live smoke (manual, user's Flatpak Chrome): a page with `beforeunload` →
  navigate away → dialog surfaced → accept → new page. Close the debugging
  infobar, then re-click → re-attaches. A `target=_blank` link auto-attaches.
  Cross-origin navigate works.

## Left to the builder

- Exact timeout values within the budgets above.
- Whether history/reload stay folded into `navigate` or become a separate tool,
  if the schema reads better that way.
- Internal structure of the dialog/timeout plumbing.
