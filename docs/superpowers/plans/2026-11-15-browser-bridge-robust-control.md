# Browser Bridge Robust Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the SAI browser bridge survive dialogs and foreign-extension frames (1Password autofill), recover attachment reliably, and give SAI full control of shared tabs (cross-origin navigation, history, hover, select, wait, key combos, dialogs, opening and closing tabs).

**Architecture:** Nearly all logic lives in the MV3 service worker (`extension/chrome/background.js`), plus a new pure `keys.js` and new page scripts in `pageScripts.js`. SAI's side (`electron/services/browserBridge.ts`) gains a single method allowlist, devlog diagnostics and a short wait for a dropped relay to come back. Tool schemas are in `src/lib/saiTools.ts`, and the tool→method map is in `src/lib/browserTools.ts`.

**Tech Stack:** Chrome MV3 extension (plain ES modules, `chrome.debugger` CDP 1.3), Electron/TypeScript, vitest.

**Spec:** `docs/superpowers/specs/2026-11-15-browser-bridge-robust-control-design.md`

## Global Constraints

- Sharing a tab = SAI can control it. There is no read-only mode, no context menu, and no `control` flag anywhere.
- Unshared tabs stay invisible. Don't add the `tabs` permission. `chrome.tabs.create/get/remove` and `onCreated.openerTabId` don't need it.
- Navigation: any `http:`/`https:` URL. Every other scheme is refused.
- Never auto-accept a JS dialog.
- Per-CDP-command timeout `CDP_TIMEOUT_MS = 8000`. The extension must answer every request within SAI's `CALL_TIMEOUT_MS = 20_000`. `wait` defaults to `timeoutMs` 5000 and is capped at 15000.
- Re-attach backoff `[250, 500, 1000, 2000]` ms, then every 5000 ms, giving up after 120000 ms. Calls wait up to 3000 ms for a re-attach.
- Port reconnect backoff `[500, 1000, 2000, 5000]` ms (repeat the last value) while any tab is shared.
- Child tabs are auto-attached only when opened during an SAI action on an attached tab, or within `ACTION_GRACE_MS = 3000` after it.
- Badge: single colour `#d29922`. Title `N tab(s) shared with SAI — SAI can control them`.
- Run vitest with `--maxWorkers=2`.
- Manifest version becomes `0.4.0` (Task 9).

## Review Focus

1. **A dialog that was already open before attach** (the user shares a tab sitting on an alert). `Page.enable` replays `javascriptDialogOpening`, so the first call must report the dialog rather than hang. Test in Task 4.
2. **The 1Password menu reappears during the re-attach loop** (re-attach succeeds, then the menu detaches again immediately). The loop must restart cleanly and not stack two timers. Test in Task 3.
3. **Toolbar click while a tab is reattaching or wedged by a dialog.** It must detach and cancel retries, not try to attach. Test in Task 2/3.
4. **An action triggers `beforeunload` and the navigation never happens.** `navigate`/`click` must return `{ dialog }` within budget, and must not wait out the 8 s CDP timeout. Test in Task 4.
5. **The user middle-clicks a link on a shared tab while SAI is idle.** The new tab must stay unshared. Test in Task 8.

---

## Test harness (shared by all extension tasks)

`tests/unit/lib/chromeStub.ts` (created in Task 1) exports:

```ts
export interface CdpScript { reply?: any | ((params: any) => any); error?: string; hang?: boolean }
export interface ChromeStub {
  chrome: any;                                     // assign to globalThis.chrome
  cdp: { script: Record<string, CdpScript>; calls: Array<{ tabId: number; method: string; params: any }> };
  fire(event: string, ...args: any[]): Promise<void>; // e.g. fire('debugger.onEvent', {tabId:1}, 'Page.javascriptDialogOpening', {...})
  posted: any[];                                   // frames the worker sent on its native port
}
export function makeChromeStub(): ChromeStub;
export async function loadWorker(stub: ChromeStub): Promise<any>; // vi.resetModules + import background.js
```

The stub captures every `addListener` under its dotted path (`action.onClicked`, `debugger.onDetach`, `debugger.onEvent`, `tabs.onCreated`, `tabs.onRemoved`, `runtime.onStartup`, `alarms.onAlarm`, `port.onMessage`, `port.onDisconnect`) so that `fire` can invoke them. `debugger.sendCommand(target, method, params, cb)` follows `cdp.script[method]`. `hang` never calls back. `error` sets `chrome.runtime.lastError` for the duration of the callback. `debugger.attach` / `tabs.create` / `tabs.get` / `tabs.remove` are `vi.fn`s that tests can override. Tests use `vi.useFakeTimers()` where they need backoff or timeouts.

---

### Task 1: Sharing = control (remove the read-only split)

**Files:**
- Create: `tests/unit/lib/chromeStub.ts`
- Rename+rewrite: `tests/unit/lib/browserControlGate.test.ts` → `tests/unit/lib/browserExtension.test.ts`
- Modify: `extension/chrome/background.js`, `extension/chrome/manifest.json` (drop the `contextMenus` permission; new description "Lets SAI see and control the tabs you explicitly share.")
- Modify: `electron/services/browserBridge.ts:50-66`, `tests/integration/browserBridge.test.ts:235-252`
- Modify: `src/lib/saiTools.ts` (the browser_* descriptions: drop "Read-only." and "Requires control on that tab …"; for browser_click, replace the REQUIRES-control sentence)

**Interfaces:**
- Produces: `export const BRIDGE_METHODS: Set<string>` built from one `export const BRIDGE_METHOD_LIST = ['tabs.list','snapshot','read','click','type','press','scroll','navigate'] as const` (later tasks append to it). `BRIDGE_READ_METHODS`/`BRIDGE_WRITE_METHODS` are deleted.
- Produces (extension exports): `HANDLERS, handleRequest, attached, resolveTabId, KEYS`. `resolveControlledTabId` is deleted.
- `attached` value shape from now on: `{ url, title, state: 'attached' | 'reattaching' }`.

- [ ] **Step 1: Write the harness and failing tests** in `browserExtension.test.ts` under `describe('sharing = control')`:
  - `drives any attached tab` — share tab 1, click `e2` → `cdpCalls` contains three `Input.dispatchMouseEvent`s.
  - `refuses a tab that was never shared` — `click {tabId: 99}` rejects `/not attached/`.
  - `installs no context menu` — `chrome.contextMenus` is undefined in the stub and loading the worker doesn't throw.
  - `badge is amber with the control title` — after `fire('action.onClicked', {id:1,url:'https://a.test'})`, `setBadgeBackgroundColor` gets `{color:'#d29922'}` and `setTitle` gets `'1 tab(s) shared with SAI — SAI can control them'`.
  - Keep the existing ref, snapshot and type tests from the old file, minus the `control` arg.
- [ ] **Step 2: Run** `npx vitest run --maxWorkers=2 tests/unit/lib/browserExtension.test.ts` — expect FAIL (`contextMenus` is referenced, `share` is read-only).
- [ ] **Step 3: Implement.** Delete the context menu, `setControl`, `controlledTabIds`, `resolveControlledTabId` and the control events. Every handler calls `resolveTabId`. `refreshBadge` uses the constants above. Update `browserBridge.ts` and the integration test assertion to the single list.
- [ ] **Step 4: Run** the unit file and `npx vitest run --maxWorkers=2 tests/integration/browserBridge.test.ts tests/unit/lib/browserTools.test.ts` — expect PASS.
- [ ] **Step 5: Commit** `feat(browser-bridge): sharing a tab grants control; drop the read-only mode`.

### Task 2: CDP timeouts, attachment truth, diagnostics

**Files:**
- Modify: `extension/chrome/background.js`, `electron/services/browserBridge.ts`
- Test: `tests/unit/lib/browserExtension.test.ts`, `tests/integration/browserBridge.test.ts`

**Interfaces:**
- Produces (extension):
  - `cdp(tabId, method, params = {}, { timeoutMs = CDP_TIMEOUT_MS } = {}): Promise<any>`. On timeout it rejects `Error('CDP <method> timed out after 8s on tab <id>')`. Every in-flight call is registered in `inflight: Map<tabId, Set<(err: Error) => void>>` so later tasks can abort a tab's calls with `abortInflight(tabId, err)`.
  - `probeAttached(tabId): Promise<boolean>`: `Runtime.evaluate {expression:'1'}` with `timeoutMs: 1500`. Success **or timeout** → `true`; an error → `false`. (A not-attached tab errors immediately, and a dialog-wedged tab hangs.)
  - `toggleTab(tab): Promise<void>`: the toolbar handler. `attached.has(id) || await probeAttached(id)` → detach, else attach.
  - `friendlyAttachError(message: string): string` mapping: `/Another debugger is already attached/` → `'DevTools (or another debugger) is open on this tab — close it and click again'`; `/Cannot access|chrome:\/\/|chrome-extension:\/\/|cannot be scripted/i` → `"Chrome doesn't allow sharing this page"`; `/No tab with given id/` → `'That tab is gone'`; otherwise the raw message.
  - `diag(kind: string, data?: object)`: posts `{type:'event', event:'diag', kind, ...data}`.
- Produces (SAI): `handleFrame` writes `devlog('browserBridge', frame.kind, frame)` for `diag` events, and `devlog('browserBridge', 'relay-connected' | 'relay-dropped', {reason})` on relay changes.
- `rehydrate()` candidates = stored ids ∪ `getTargets().filter(t => t.attached && typeof t.tabId === 'number')`. Adopt each id where `probeAttached` is true, then `diag('rehydrate', {stored, adopted})`.

- [ ] **Step 1: Failing tests** (`describe('attachment truth')`):
  - `cdp times out with the method name`: `script['Runtime.evaluate']={hang:true}`, fake timers, `read` → rejects `/CDP Runtime.evaluate timed out after 8s on tab 1/` after `advanceTimersByTime(8000)`.
  - `toolbar click on an attached-but-forgotten tab detaches it`: `attached` is empty, probe succeeds → `debugger.detach` called, `debugger.attach` not called.
  - `toolbar click on a dialog-wedged tab detaches it`: probe hangs → after 1500 ms `detach` is called.
  - `attach failure is shown`: `attach` rejects `'Another debugger is already attached to the tab with id: 3.'` → `setBadgeText({tabId:3,text:'!'})`, `setTitle` contains `'DevTools (or another debugger) is open'`, and `posted` has a `diag` with `kind:'attach-failed'`.
  - `rehydrate adopts tabs missing from storage`: storage empty, `getTargets` → `[{tabId:5,attached:true}]`, probe ok → `attached.has(5)`.
  - Integration: a relayed `{type:'event',event:'diag',kind:'detach',reason:'x'}` frame → the `devlog` mock is called with `('browserBridge','detach', expect.objectContaining({reason:'x'}))` (mock `electron/services/devlog` with `vi.mock`).
- [ ] **Step 2: Run** — expect FAIL.
- [ ] **Step 3: Implement** the interfaces above. `Runtime.evaluate` in `evaluateFn` also passes `timeout: 6000`. The badge `'!'` clears after 4000 ms via `refreshBadge()`.
- [ ] **Step 4: Run** the unit and integration files — expect PASS.
- [ ] **Step 5: Commit** `fix(browser-bridge): time-box CDP calls, probe real attachment, log diagnostics`.

### Task 3: Auto re-attach (1Password) and port reconnect

**Files:**
- Modify: `extension/chrome/background.js`, `electron/services/browserBridge.ts`
- Test: both test files from Task 2

**Interfaces:**
- Consumes: `cdp`, `diag`, `attached` state from Tasks 1–2.
- Produces (extension): `scheduleReattach(tabId, reason)`, `cancelReattach(tabId)`, and `awaitAttached(tabId, ms = 3000): Promise<void>`. `resolveTabId` becomes async (`await resolveTabId(params)` in every handler) and calls `awaitAttached` for a reattaching tab. It throws the spec's message if the re-attach is still pending: `Chrome detached the debugger on tab N because another extension (likely a password manager's autofill menu) put a frame in the page — reattaching automatically; press Escape or dismiss the menu, then retry`.
- Events posted: `reattaching {tabId, reason}`, `reattached {tabId}`, `detached {tabId, reason}`.
- `chrome.tabs.onRemoved` → `cancelReattach` + `detachTab(id, {reason:'tab-closed'})`.
- Port: on `onDisconnect` while `attached.size`, call `connectWithBackoff()` (delays from Global Constraints). Reset the backoff index on a successful `hello` exchange (first `onMessage`) or when ≥10 s pass without a disconnect.
- SAI side: `inst.lastRelayAt: number`. In `call()`, if `!inst.relay` and `Date.now() - inst.lastRelayAt < 60_000`, wait up to `RELAY_RECONNECT_WAIT_MS = 4000` for a relay before rejecting with `'the link to the browser dropped and did not come back within 4s — click the SAI toolbar button on the tab to reconnect'`.

- [ ] **Step 1: Failing tests:**
  - `foreign-frame detach keeps the tab and re-attaches`: fire `debugger.onDetach({tabId:1}, 'target_closed')` → `attached.get(1).state === 'reattaching'`, a `reattaching` event is posted. The first `attach` rejects, the second resolves after `advanceTimersByTime(250+500)` → state `'attached'`, `Page.enable` re-sent, `reattached` posted.
  - `a call during re-attach waits, then succeeds`: a `read` issued while reattaching resolves once the attach succeeds within 3000 ms.
  - `a call during a long re-attach fails with the password-manager message`: attach keeps rejecting → `read` rejects `/likely a password manager's autofill menu/` after 3000 ms.
  - `gives up after 2 minutes`: attach always rejects → after 120000 ms the tab is removed and `detached {reason:'reattach-timeout'}` is posted.
  - `canceled_by_user drops the tab immediately` and so does `tabs.onRemoved`.
  - `re-detach during re-attach doesn't stack timers` (Review Focus 2): detach → re-attach succeeds → detach again → exactly one pending timer (`vi.getTimerCount()`), and a single attach call per backoff step.
  - `toolbar click on a reattaching tab cancels and detaches` (Review Focus 3).
  - `port drop reconnects without waiting for the alarm`: fire `port.onDisconnect` → `connectNative` called again after 500 ms.
  - Integration: with no relay but `lastRelayAt` recent, `call()` resolves once a relay connects 1 s later. With no relay ever, it rejects immediately with the existing NOT_CONNECTED text.
- [ ] **Step 2: Run** — expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — expect PASS.
- [ ] **Step 5: Commit** `fix(browser-bridge): auto re-attach after foreign-extension frames, reconnect the port with backoff`.

### Task 4: Dialogs

**Files:**
- Modify: `extension/chrome/background.js`, `electron/services/browserBridge.ts` (append `'dialog'`), `src/lib/browserTools.ts` (`browser_dialog: 'dialog'`), `src/lib/saiTools.ts` (new `browser_dialog` schema: `action` enum `accept|dismiss` required, `promptText` string, `tabId`)
- Test: `tests/unit/lib/browserExtension.test.ts`, `tests/unit/lib/browserTools.test.ts`

**Interfaces:**
- Produces: `dialogs: Map<tabId, { type, message, url, defaultPrompt }>` (exported). `class DialogOpenError extends Error { dialog }`. `assertNoDialog(tabId)` throws `` `a ${type} dialog is open on tab ${id}: "${message}" — call sai_browser_dialog to accept or dismiss it` ``.
- `runAction(tabId, fn): Promise<object>`: runs `fn`. If a `DialogOpenError` surfaces, it returns `{ tabId, dialog }` instead of throwing. If `dialogs.has(tabId)` after `fn`, it adds `dialog`. Task 8 extends it with the action window and `openedTabs`. `click`, `type`, `press`, `navigate` and `dialog` use it.
- `debugger.onEvent` handles `Page.javascriptDialogOpening` (set the map, `abortInflight(tabId, new DialogOpenError(...))`, post `dialog-opened`) and `Page.javascriptDialogClosed` (delete, post `dialog-closed`). `settle()` returns early when a dialog is open.
- `snapshot` with an open dialog returns `{ tabId, dialog, elements: [], note: 'a dialog is blocking the page — handle it with sai_browser_dialog' }` without evaluating. `tabs.list` adds `dialog` and `state` per tab. Every other handler calls `assertNoDialog` first.
- `dialog` handler: `{action, promptText, tabId}` → `Page.handleJavaScriptDialog {accept: action==='accept', promptText}` → delete the entry → `settle` → `{ tabId, handled: action, type, url, title }`. If no dialog is open, it rejects `` `no dialog is open on tab ${id}` ``.

- [ ] **Step 1: Failing tests:**
  - `blocks calls while a dialog is open`: fire `Page.javascriptDialogOpening {type:'beforeunload', message:''}` → `read` rejects `/beforeunload dialog is open on tab 1/` with no `Runtime.evaluate` in `cdpCalls`.
  - `an action that opens a dialog returns it promptly` (Review Focus 4): `Page.navigate` hangs, then fire the dialog event 100 ms later → `navigate` resolves `{dialog:{type:'beforeunload'}}` well before 8000 ms.
  - `pre-existing dialog is reported` (Review Focus 1): the `Page.enable` reply fires the dialog event synchronously → the first `click` rejects with the dialog message.
  - `dialog accept`: `handleJavaScriptDialog` is called with `{accept:true}`, the map is cleared, and the URL is returned. `dismiss` passes `false`. Missing dialog → `/no dialog is open/`.
  - `snapshot reports the dialog without evaluating`.
  - browserTools: `isBrowserTool('browser_dialog')`, mapped to `'dialog'`.
- [ ] **Step 2: Run** — expect FAIL. **Step 3: Implement.** **Step 4: Run** — expect PASS.
- [ ] **Step 5: Commit** `feat(browser-bridge): surface and handle JS dialogs instead of hanging`.

### Task 5: Navigation — any http(s) origin, history, reload

**Files:** `extension/chrome/background.js`, `src/lib/saiTools.ts` (browser_navigate: `url` optional, new `action` enum `back|forward|reload`; description notes that exactly one is required). Test: `browserExtension.test.ts`.

**Interfaces:** `resolveSameOriginUrl` → rename to `resolveNavigableUrl(tabId, raw): Promise<string>` (resolve relative URLs against the current URL, `http:`/`https:` only). `navigate` with `action`: `back`/`forward` use `Page.getNavigationHistory` + `Page.navigateToHistoryEntry {entryId}`. If there's no entry it rejects `'no previous page in this tab\'s history'` / `'no next page in this tab\'s history'`. `reload` uses `Page.reload`. Both `url` and `action` → reject `'pass either url or action, not both'`.

- [ ] **Step 1: Failing tests:** `cross-origin navigate is allowed` (`Page.navigate {url:'https://b.test/y'}` from `a.test`). `javascript: and file: are refused` (`/only http\(s\)/`). `back uses the previous history entry` (history `{currentIndex:1, entries:[{id:7},{id:8}]}` → `navigateToHistoryEntry {entryId:7}`). `back at the start of history errors`. `reload calls Page.reload`. Delete the old same-origin tests.
- [ ] **Step 2–4:** Run (FAIL) → implement → run (PASS).
- [ ] **Step 5: Commit** `feat(browser-bridge): navigate anywhere http(s), plus back/forward/reload`.

### Task 6: Hover, select, wait

**Files:** `extension/chrome/pageScripts.js`, `extension/chrome/background.js`, `electron/services/browserBridge.ts` (append `'hover','select','wait'`), `src/lib/browserTools.ts`, `src/lib/saiTools.ts` (three schemas per spec §5). Test: `browserExtension.test.ts`, `tests/unit/electron/browserPageScripts.test.ts`, `browserTools.test.ts`.

**Interfaces:**
- Page scripts: extract the ref lookup at the top of `RESOLVE_FN_SOURCE` (refs, gen, stale, bad, unknown and disconnected checks) into a shared string `REF_LOOKUP` that the new scripts embed, so the error texts stay identical.
  - `SELECT_FN_SOURCE(opts {ref, refGen, value?, label?, values?: string[]})` → `{ selected: [{value,label}] }`, or `{ error }`. Not a `<select>` → `` `${ref} is a <${tag}>, not a <select> — use browser_click for custom dropdowns` ``. No match → `` `no option matching "${x}" — options: ${labels.join(', ')}` `` (the list is capped at 30). Sets `option.selected` and dispatches bubbling `input` then `change`.
  - `WAIT_CHECK_FN_SOURCE(opts {text?, selector?})` → `{ met: boolean, url }`. `text` matches by substring of `document.body.innerText`. `selector` needs a matching element with a non-zero box.
- Handlers: `hover {ref, refGen}` → RESOLVE + one `mouseMoved` + `settle(tabId, 500)` → `{tabId, hovered: ref}`. `select` → `{tabId, ref, selected}`. `wait {text?, selector?, urlIncludes?, gone?, timeoutMs?}`: polls every 200 ms. If none of the three is given, it rejects `'wait needs text, selector or urlIncludes'`. It returns `{tabId, met, waitedMs, url}` and never rejects on timeout.

- [ ] **Step 1: Failing tests:** page-script tests in jsdom (`browserPageScripts.test.ts` style): select by value, by label, `multiple` with `values`, missing option lists the options, a non-select errors, and `change` fires once. Wait-check text and selector cases. Extension: `hover sends exactly one mouseMoved at the ref centre`, `wait resolves met:true once text appears on the 3rd poll`, `wait caps timeoutMs at 15000 and returns met:false`, `wait with gone:true is met when the text disappears`. browserTools mappings.
- [ ] **Step 2–4:** Run (FAIL) → implement → run (PASS).
- [ ] **Step 5: Commit** `feat(browser-bridge): hover, native select, and wait-for`.

### Task 7: Key combos and arbitrary characters

**Files:** Create `extension/chrome/keys.js` (move `KEYS`/`KEY_ALIASES` there). Modify `background.js` (`dispatchKey` uses `parseKeySpec`) and `src/lib/saiTools.ts` (browser_press `key` description: named keys, any single character, `+`-joined modifiers such as `Control+a`, `Shift+Tab`, `Meta+Enter`). Test: create `tests/unit/lib/browserKeys.test.ts`.

**Interfaces:** `parseKeySpec(spec: string): { key, code, keyCode, text?: string, modifiers: number }`. The modifier bitmask is Alt=1, Control=2, Meta=4, Shift=8, with aliases `Ctrl→Control`, `Cmd→Meta`, `Option→Alt`. A trailing `++` means the `+` key. A single character `c`: letters give `code 'Key'+upper` and `keyCode` = upper char code; digits give `'Digit'+d`. Shift on a letter upper-cases `key`/`text`. `text` is omitted when Control, Meta or Alt is held, so shortcuts don't insert characters. Unknown → throw `` `unsupported key: ${spec}` `` plus the supported list. `dispatchKey` passes `modifiers` on both keyDown and keyUp.

- [ ] **Step 1: Failing tests:** `'Enter'` stays as before. `'a'` → `{key:'a',code:'KeyA',keyCode:65,text:'a',modifiers:0}`. `'Shift+a'` → key and text `'A'`, modifiers 8. `'Ctrl+a'` → modifiers 2, no text. `'Control+Shift+Tab'` → 10. `'Control++'` → key `'+'`. `'Foo+x'` throws. `'Spacebar'` → Space.
- [ ] **Step 2–4:** Run (FAIL) → implement → run (PASS) (also rerun `browserExtension.test.ts`).
- [ ] **Step 5: Commit** `feat(browser-bridge): key combos and any single character in press`.

### Task 8: Opening/closing tabs and auto-attaching SAI-opened children

**Files:** `extension/chrome/background.js`, `electron/services/browserBridge.ts` (append `'tabs.open','tabs.close'`), `src/lib/browserTools.ts` (`browser_open_tab`, `browser_close_tab`), `src/lib/saiTools.ts` (schemas: `open_tab {url required, tabId}`, `close_tab {tabId required}`). Test: `browserExtension.test.ts`, `browserTools.test.ts`.

**Interfaces:**
- `actionWindows: Map<tabId, { depth: number, until: number, opened: number[] }>`. `runAction` (Task 4) increments `depth` on entry. On exit it decrements and sets `until = Date.now() + ACTION_GRACE_MS`, and it adds `openedTabs: [...opened]` to the result when non-empty. `isInActionWindow(tabId)` = `depth > 0 || Date.now() < until`.
- `tabs.onCreated(tab)`: if `attached.has(tab.openerTabId) && isInActionWindow(tab.openerTabId)`, call `attachWithRetry(tab, { openedBy })` (3 tries, 200 ms apart, with failures logged via `diag('child-attach-failed')`, never thrown) and push the id to the opener's `opened`. The `attached` event carries `openedBy`.
- `tabs.open {url, tabId?}`: opener = `await resolveTabId(params)`, URL checked like `resolveNavigableUrl` but without a base. `chrome.tabs.get(opener)` gives the `windowId`. `chrome.tabs.create({url, openerTabId: opener, windowId, active:false})`, then attach → `{tabId, url, openedBy: opener}`. Mark the id so `onCreated` doesn't double-attach.
- `tabs.close {tabId}`: requires an explicit attached `tabId` (`'tabs.close needs an explicit tabId'`) → `cancelReattach`, `chrome.tabs.remove` → `{closed: tabId}`.

- [ ] **Step 1: Failing tests:** `a tab opened during a click is attached and reported` (`click` → fire `tabs.onCreated({id:9, openerTabId:1})` during the click → the result has `openedTabs:[9]` and `attached.has(9)`). `a tab opened within 3s after an action is attached`. `a tab the user opens while SAI is idle stays unshared` (Review Focus 5: advance 3001 ms after the action, then onCreated → not attached, no attach call). `a child of an unshared tab is ignored`. `open_tab creates a background tab in the opener's window` (`tabs.create` called with `{active:false, windowId: 4, openerTabId: 1}`). `open_tab refuses non-http`. `close_tab requires tabId and closes only attached tabs`.
- [ ] **Step 2–4:** Run (FAIL) → implement → run (PASS).
- [ ] **Step 5: Commit** `feat(browser-bridge): open/close tabs and auto-share tabs SAI's actions open`.

### Task 9: Docs, version, full verification, live smoke

**Files:** `docs/browser-bridge.md`, `extension/chrome/manifest.json`.

- [ ] **Step 1:** Rewrite `docs/browser-bridge.md`:
  - Consent model: sharing = control, amber badge, no context menu, child tabs only from SAI actions.
  - Tools table: all 14 tools.
  - New sections "Dialogs" and "Password managers and other extensions": the 1Password detach and the auto re-attach behaviour.
  - Debugging: the devlog channel `browserBridge` and its `diag` kinds.
  - Known limitations: remove same-origin and read-only; add "a foreign-extension frame blocks control until it closes".
- [ ] **Step 2:** Bump the manifest `version` to `0.4.0`.
- [ ] **Step 3: Run** `npx vitest run --maxWorkers=2 tests/unit/lib/browserExtension.test.ts tests/unit/lib/browserKeys.test.ts tests/unit/lib/browserTools.test.ts tests/unit/electron tests/integration/browserBridge.test.ts tests/integration/browserBridgeRelay.test.ts` and `npx tsc --noEmit` — expect all PASS and no type errors.
- [ ] **Step 4: Commit** `docs(browser-bridge): sharing = control, dialogs, auto re-attach`.
- [ ] **Step 5: Live smoke (needs the user).** The SAI dev build runs, the user re-loads the extension from `~/.sai/browser-bridge/extension`, and SAI is restarted for the new tools:
  1. On a login page, focus the username field so the 1Password menu appears. The devlog shows `diag detach` with its reason, then `reattached` after the menu closes, and the tab never drops.
  2. On a page with `beforeunload`, `navigate` returns `dialog`, then `sai_browser_dialog accept` lands on the new page.
  3. Close the debugging infobar, then click the toolbar button: it re-shares on the first click.
  4. Cross-origin navigate, back, and reload work.
  5. A `target=_blank` link clicked by SAI auto-shares, while a middle-click by the user doesn't.
  6. `Control+a` then `Backspace` clears a field. If Ctrl+A doesn't select on Linux, add `commands:['selectAll']` for that combo and note it.
  Record the results in the PR body.
