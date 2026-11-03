# Browser bridge (read-only slice)

Lets SAI *see* a browser tab you explicitly share, so it can look at what you're
looking at instead of narrating steps for you to follow.

This is the read-only slice. It can snapshot, screenshot, and read text. It
cannot click, type, or navigate — no CDP `Input` commands are implemented
anywhere in the path, and the main process rejects any bridge method outside
the three below.

## Consent model

Nothing is shared until you click the extension's toolbar button on a tab.

- Clicking attaches a `chrome.debugger` (CDP) session to **that tab only**.
  Chrome shows its own *"DevTools is debugging this tab"* infobar for as long as
  the attachment lasts, and the extension badge shows how many tabs are shared.
- Clicking again detaches. Closing the tab detaches.
- Tabs you never attached are not enumerated — `sai_browser_tabs` lists only
  attached tabs, so SAI can't see that your other tabs exist. The extension
  deliberately does not request the `tabs` permission.
- Password field values are returned as `•••`, never as text.

Things to know before attaching a tab you care about: a snapshot includes the
values of ordinary (non-password) form fields, and a screenshot captures
whatever is on screen. Don't attach a tab mid-2FA.

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
derive one from `$HOME`. So unlike `swarmMcpHost` (PID-suffixed socket, secret
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

| Tool | What it returns |
| --- | --- |
| `sai_browser_tabs` | The attached tabs, with `tabId`, URL, title |
| `sai_browser_snapshot` | Screenshot (JPEG) + interactive/labelled elements with `ref`, `role`, `name`, `box` |
| `sai_browser_read` | Visible text of the page, or of one `selector` |

All three take an optional `tabId`; omit it when exactly one tab is attached.

Snapshot refs (`e1`, `e2`, …) are stashed on the page as `window.__saiRefs` so a
later drive slice can resolve `e17` back to a live node without re-walking the
DOM. Nothing reads them yet.

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
