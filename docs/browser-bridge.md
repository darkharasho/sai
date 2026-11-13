# Browser bridge

Lets SAI *see* a browser tab you explicitly share — and, if you separately say
so, *act* in it — so it can look at what you're looking at instead of narrating
steps for you to follow.

Sharing and control are two different decisions, and the second is never
implied by the first.

## Consent model

Nothing is shared until you click the extension's toolbar button on a tab.

- Clicking attaches a `chrome.debugger` (CDP) session to **that tab only**, for
  reading. Chrome shows its own *"DevTools is debugging this tab"* infobar for
  as long as the attachment lasts, and the extension badge shows how many tabs
  are shared.
- Clicking again detaches. Closing the tab detaches.
- Tabs you never attached are not enumerated — `sai_browser_tabs` lists only
  attached tabs, so SAI can't see that your other tabs exist. The extension
  deliberately does not request the `tabs` permission.
- Password field values are returned as `•••`, never as text.

Things to know before attaching a tab you care about: a snapshot includes the
values of ordinary (non-password) form fields, and a screenshot captures
whatever is on screen. Don't attach a tab mid-2FA.

### Granting control

A shared tab is **read-only until you grant control on it specifically**:
right-click the SAI toolbar button and tick **"Let SAI control this tab"**.

- The grant is **per tab**, not global. Other shared tabs stay read-only.
- The badge turns **amber** whenever any tab can be driven, so "SAI can act
  here" never looks like "SAI can look here".
- Detaching drops the grant. Re-attaching starts read-only again.
- Grants live in `chrome.storage.session`, so they survive the service worker
  being torn down (which happens constantly) but **never a browser restart**.
- Control is not a left-click modifier because `action.onClicked` reports no
  modifier keys, and a popup would replace the one-click share that works.

Without a grant, every control method fails with a message naming the exact
menu item — so the model tells you how to enable it rather than silently
failing or retrying.

### What control can and cannot do

Allowed: `click`, `type`, `press` (a fixed key list), `scroll`, and `navigate`.

`press` takes `Enter, Space, Tab, Escape, Backspace, Delete, Arrow*, Home, End,
PageUp, PageDown` — `Space` because it is the only way to toggle a focused
checkbox, radio or switch. Enter doesn't activate those at all; on an app with
global keyboard shortcuts it falls through to the page behind the dialog and
activates something else, which is worse than doing nothing. Since `press` is
the one action with no ref behind it, it reports the focused element's role,
name and checked state before and after, so a key that was swallowed is
visible instead of reading as success.

Deliberately absent:

- **No arbitrary script execution.** There is no eval/inject tool. The page
  scripts that *are* evaluated are a fixed set shipped with the extension.
- **No cross-origin navigation.** `navigate` resolves the target against the
  current page and refuses anything that changes origin, or any non-http(s)
  scheme. Clicking a link that happens to leave the origin is still fine — that
  is the page behaving normally, not SAI choosing a destination.
- **No raw CDP.** The main process speaks only the method names below; nothing
  in the path can send an `Input.*` command directly, so the per-tab grant
  can't be bypassed from the SAI side.

### Acting on a stale ref

`browser_snapshot` returns a `refGen` alongside the elements. Control tools take
it and refuse if the page has re-snapshotted or navigated since.

This matters more than it sounds: `e17` is an index into a list captured at a
moment in time. After a re-render, that index may point at a different control
entirely — so an unguarded click could hit *Delete* where the model meant
*Download*. Every resolution failure (stale generation, detached node,
zero-sized box, element scrolled out of view) is a refusal telling the caller to
re-snapshot, never a best guess.

### Reaching the element you want

An element the model was never shown is an element it cannot click — refs are
the only way to address anything. The snapshot walk is document order, so on an
app that renders a long result list *before* the panel you came for (Gmail's
filter dialog, say), the panel's controls sit past any sane element cap. The
checkbox was focusable by keyboard and un-addressable by snapshot at the same
time.

Raising the cap is the wrong fix — it spends context linearly to reach one
checkbox. So the walk collects everything (hard ceiling 3000) and the *output*
narrows instead:

| | |
|---|---|
| modal first | An open dialog makes the rest of the page inert, so its controls lead regardless of DOM position, and `modal` is reported. Needs no parameters — it just works. |
| `match` | Substring on role/name, e.g. `match: "skip the inbox"`. The best tool when you know what you're looking for. |
| `root` | CSS selector scoping the snapshot to one region. Refuses an unmatched selector rather than quietly snapshotting everything. |
| `offset` | Window into the full list, so a big page is pageable rather than truncated. |

Refs are assigned *after* ordering and filtering, over the whole narrowed list
— so `e1` is the first thing you were shown, every visible ref resolves, and
labels stay consistent across pages of one snapshot. Getting this backwards
would be the bad kind of bug: a ref that resolves to a message row while the
caller believes it is the checkbox.

The reply carries `total`, `returned` and `offset` rather than a bare
`truncated` flag, which never said how much was missing or how to get at it.
Snapshots also report `checked` as an explicit `true`/`false` (including
`aria-checked`) and flag which element has `focused`, so a toggle's state is
checkable before and after acting on it.

## Architecture

```
Chrome tab
   │  chrome.debugger (CDP 1.3) — attached only while you say so
   ▼
MV3 service worker            extension/chrome/background.js
   │  chrome.runtime.connectNative("com.sai.browser_bridge")
   ▼
relay host (bare Node)        electron/browser-bridge-host.ts
   │  NDJSON over ~/.sai/browser-bridge/bridge.sock  (token-authenticated)
   ▼
SAI main process              electron/services/browserBridge.ts
   │  ipcMain 'browser:call'  (method allowlist)
   ▼
renderer tool dispatch        src/lib/browserTools.ts
   │
   ▼
sai_browser_* MCP tools       src/lib/saiTools.ts
```

Deployment is a separate concern, shared by Settings → Browser and the CLI:

```
electron/services/browserDeploy.ts
   ├── detectBrowsers()    — Chromium forks present on this machine
   ├── findExtensionId()   — read the id out of the browser's own profile
   ├── installNativeHost() — write the manifest + launcher shim
   └── openExtensionsPage()
```

The relay exists because Chrome insists on *spawning* a native host itself,
while SAI is already running. The relay is spawned per port, holds no state,
and only re-frames: Chrome's 4-byte-length-prefixed native messages become
NDJSON lines on SAI's socket.

Because Chrome spawns it, the relay can't be handed a socket path — it has to
derive one from `$HOME`. So unlike the `sai` MCP host (`electron/services/saiMcpHost.ts`; PID-suffixed socket, secret
in env), the bridge uses a **stable** socket path plus a `0600` token file at
`~/.sai/browser-bridge/token`, rotated on every SAI start and deleted on quit.

## The pinned extension ID

`extension/chrome/manifest.json` carries a `key` field, which fixes the
extension's ID at:

```
hlockbfefhbphlhfbnabmobbcoijkcjb
```

Without it, Chromium derives an unpacked extension's ID by hashing its
**absolute install path**. That would mean a repo clone, a packaged
`/Applications/SAI.app`, and a Gatekeeper-translocated copy of that app are
three different extensions — each needing its own native host manifest, and
the translocated one changing identity on every launch. Pinning removes the
whole class of problem.

It also buys a better install order: because the ID is known before the
extension exists, Settings → Browser registers the native host *first*, so the
bridge is wired up by the time you finish clicking through **Load unpacked**.

The derivation is SHA-256 over the identity bytes (the DER public key, or the
path when unkeyed), first 16 bytes, each hex nibble mapped `0-f` → `a-p`. The
test suite checks this against an ID a real Chromium actually assigned, not
just against our own implementation.

### The private key

`~/.sai/browser-bridge/extension-signing-key.pem` (mode `0600`, outside the
repo). Only the **public** half is needed for sideloading — it's in the
manifest, committed. The private key matters only if the extension is ever
packed into a `.crx` or published, and losing it means the ID changes.

Back it up somewhere durable if the ID ever needs to survive. It is
deliberately not in version control.

## Install

**Settings → Browser → Deploy to \<browser\>.**

Chromium offers no API to install an unpacked extension — that click is
reserved for a human, and no amount of automation gets around it. So the
Deploy button automates both sides of it:

1. It writes the native host manifest for the pinned extension ID, then
   reveals `extension/chrome` in Finder and opens the browser's extensions
   page.
2. You turn on **Developer mode** and click **Load unpacked**. This is the one
   manual step.
3. SAI notices the extension appear and reports itself ready.

Step 3 works because Chromium records every unpacked extension in its profile's
`Secure Preferences` under `extensions.settings[<id>].path` with `location: 4`.
Matching on our folder path finds it without anything being copied by hand.
That discovery is also the fallback path for an unkeyed manifest, where the ID
can only be learned after loading; a manual-entry field backs it up.

The panel lists only browsers that actually exist — a user-data directory
counts only if it contains a `Local State` file, since uninstalled Chromium
forks leave empty support directories behind.

Supported: Chrome, Chrome Beta/Canary, Chromium, Edge, Brave, Vivaldi, Opera,
Arc, Dia, Comet.

### CLI equivalent

For headless setups, after `npm run build`:

```sh
node scripts/install-browser-bridge.mjs             # detect and report
node scripts/install-browser-bridge.mjs --install   # auto-discovers the id
node scripts/install-browser-bridge.mjs --install <extension-id>
node scripts/install-browser-bridge.mjs --uninstall
```

The CLI requires the built `dist-electron/browserDeploy.js` rather than
reimplementing any of this, so both paths behave identically.

### What gets written

- `<user-data-dir>/NativeMessagingHosts/com.sai.browser_bridge.json` — the host
  manifest, with `allowed_origins` pinned to your extension ID. That pin is the
  trust boundary: no other extension can spawn the relay.

  **Arc and Dia are the exception.** On macOS, Chromium resolves the
  native-messaging directory from a *branded* constant, not from the profile.
  Arc and Dia ship the same `ArcCore.framework` and never rebranded it, so both
  read Chrome's directory:

  ```
  ~/Library/Application Support/Google/Chrome/NativeMessagingHosts/
  ```

  — even though their profiles live under `Arc/User Data` and `Dia/User Data`,
  and even when Chrome isn't installed. Writing to their own user-data root
  produces a bridge that fails silently: the extension loads, the debugger
  attaches, the infobar appears, and `connectNative` never finds a host.

  One consequence: Chrome, Arc and Dia share a single manifest, so removing it
  for any one of them removes it for all three. There is no per-browser
  manifest to remove instead.
- `~/.sai/browser-bridge/bridge-host.sh` — a launcher shim. Chromium execs the
  host directly, so the manifest `path` can't be `node file.js`. The shim sets
  `ELECTRON_RUN_AS_NODE=1` so a packaged build's Electron binary runs the relay
  as a plain Node script instead of booting an app.

In a packaged build, `extension/` and the relay are in `asarUnpack` — Chromium
has to read the extension off a real filesystem, not out of an asar archive.

### Why not force-install it?

Chromium's `ExtensionSettings` policy can force-install an extension with no
click at all, but it needs a signed CRX served from an HTTPS update URL, and it
flags the browser as managed by an organization. Too much machinery, and too
invasive, for a local developer tool.

## Tools

Read tools — available on any attached tab:

| Tool | What it returns |
| --- | --- |
| `sai_browser_tabs` | The attached tabs, with `tabId`, URL, title |
| `sai_browser_snapshot` | Screenshot (JPEG) + interactive/labelled elements with `ref`, `role`, `name`, `box`, plus `refGen` |
| `sai_browser_read` | Visible text of the page, or of one `selector` |

Control tools — additionally require **"Let SAI control this tab"** on that tab:

| Tool | What it does |
| --- | --- |
| `sai_browser_click` | Clicks the element at `ref` (real CDP mouse events at its centre) |
| `sai_browser_type` | Types into `ref`; `replace` clears first, `submit` presses Enter |
| `sai_browser_press` | Sends one key from a fixed list to whatever is focused |
| `sai_browser_scroll` | Scrolls by `dy`/`dx`, or jumps `to` top/bottom |
| `sai_browser_navigate` | Navigates to a **same-origin** URL |

Every tool takes an optional `tabId`; omit it when exactly one tab is attached.
Control tools take `ref` plus the `refGen` from the snapshot that produced it.

Snapshot refs (`e1`, `e2`, …) are stashed on the page as `window.__saiRefs`,
with a generation counter in `window.__saiRefGen`, so a control call can
resolve `e17` back to a live node without re-walking the DOM — and can tell
when that node is no longer the one it meant.

## Debugging a bridge that won't connect

The failure is quiet by design — nothing in the UI distinguishes "attached but
no host" from "attached and working". Work down this list:

1. `pgrep -f bridge-host` — if the relay isn't running, the browser never
   launched it, and the problem is the manifest or its location.
2. Open the extension's service worker console from the browser's extensions
   page and look for `[sai-bridge]` lines. `Specified native messaging host not
   found` means a manifest-location problem; `Native host has exited` means the
   shim ran and died.
3. Some forks (Dia among them) won't open that console reliably. Relaunch the
   browser with logging instead and grep for `launch_context`, which names the
   host it couldn't find:

   ```sh
   /Applications/<Browser>.app/Contents/MacOS/<Browser> \
     --enable-logging=stderr --v=1 2>&1 | grep -i native
   ```

Note that the extension retries on its 30-second keepalive alarm while a tab is
attached, so a fix can take up to 30s to take effect without re-clicking.

## Known limitations

- **MV3 service worker lifetime.** The worker is torn down when idle. Native
  port traffic resets the idle timer (Chrome 116+), and a 30-second
  `chrome.alarms` keepalive runs while any tab is attached, but if the worker
  does die the port closes and SAI reports the bridge as disconnected until the
  next attach or alarm. This is the most likely source of flakiness.
- **1 MB native message cap.** Chrome's hard limit. Screenshots are JPEG and
  step down through 1024px/q60 → 800px/q45 → 600px/q35 until they fit; a
  snapshot that still doesn't fit errors with a suggestion to pass
  `screenshot: false`.
- **One browser at a time.** The socket path is stable, so a second SAI
  instance takes over the bridge from the first. Newest relay connection wins.
- **Blocked surfaces.** `chrome://*`, the Chrome Web Store, and other
  extensions' pages can't be attached. Permanent Chrome restriction.
- **Same-process frames only.** The snapshot walks the top-level document;
  cross-origin iframes are not traversed.
- **No Firefox.** Firefox has no `chrome.debugger` equivalent, so it would be
  limited to content-script DOM reads, and permanent sideloading needs a
  signed-unlisted XPI from AMO. Not attempted here.
