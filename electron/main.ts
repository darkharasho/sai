import { app, BrowserWindow, ipcMain, dialog, shell, Menu, MenuItem, screen, clipboard, Notification, protocol, powerMonitor } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { RemoteModule } from './services/remote';
import { PhoneTerminalRegistry } from './services/remote/terminal-store';
import { BridgeServer } from './services/remote/bridge-server';
import { PairingStore } from './services/remote/pairing-store';
import { SessionBus } from './services/remote/session-bus';
import { resolveTailnetEndpoint } from './services/remote/tailnet';
import { BlobStore } from './services/remote/blob-store';
import { safeJoin } from './services/remote/safe-join';
import { langFromPath, isTextLike, mimeFromPath } from './services/remote/lang';
import { readDirImpl, readFileImpl, readFileBufImpl, statFileImpl, writeFileImpl } from './services/fs';
import { clampRect, type Rect } from './capturePage';
import { selectBackendChain } from './capture/selectBackend';
import { captureWindowFlow } from './capture/captureWindow';
import { listDesktopWindows, captureDesktopSource, captureViaCli, captureDisplay } from './capture/backends';
import { capturePortalViaDbus } from './capture/portalDbus';
import { listKdotoolWindows, activateKdotoolWindow, kdotoolActiveWindowTitle, kdotoolAvailable } from './capture/kdotool';
import { activeWindowTitle, raiseWindowByTitle } from './capture/windowControl';
import { gitStatusImpl, gitDiffImpl, gitStageImpl, gitUnstageImpl, gitCommitImpl, gitPushImpl, gitPullImpl } from './services/git';
import { enrichedEnv, patchProcessPath } from './services/shellEnv';
import { stripInheritedScopeTag } from './services/loadGuard/scopeTag';
import {
  createRenderProtocolStore,
  resolveRenderAsset,
  RENDER_CSP,
  contentTypeFor,
  prepareRenderTarget,
  osTempRoots,
  mintRenderToken,
  evictRenderToken,
} from './services/renderProtocol';
import { snapshotModel, readCachedModel, pruneModelCache, isVersionKey } from './services/modelCache';
import { execFile as _execFile, execFileSync } from 'node:child_process';
import { promisify as _promisify } from 'node:util';
const _execFileP = _promisify(_execFile);

// A dev SAI launched by a parent SAI's AI inherits that instance's load-guard
// tag; drop it so this instance's own terminals and spawns stay untagged.
stripInheritedScopeTag(process.env);

// Widen the process-global PATH immediately (heuristic dirs) so early spawns —
// including the claude-agent-sdk, which spawns the CLI with a plain
// {...process.env} — can find `claude`, git, node, etc. even under a Finder-
// stripped PATH. Re-patched with the real login-shell PATH once captured.
patchProcessPath();

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'sai-render',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
]);

const renderProtocolStore = createRenderProtocolStore();

// Wrap `tailscale` shell calls with SAI's enrichedEnv (login-shell PATH).
// Without this, Electron's stripped PATH may not find `/usr/bin/tailscale`.
async function _resolveTailnetEndpointWithEnv() {
  return resolveTailnetEndpoint({
    exec: async () => {
      try {
        const r = await _execFileP('tailscale', ['status', '--json'], { env: enrichedEnv() });
        return { stdout: r.stdout, stderr: r.stderr, code: 0 };
      } catch (err) {
        const e = err as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
        return { stdout: e.stdout ?? '', stderr: e.stderr ?? '', code: typeof e.code === 'number' ? e.code : 1 };
      }
    },
  });
}
import { registerTerminalHandlers, destroyAllTerminals, listTerminalPids } from './services/pty';
import { registerClaudeHandlers, destroyClaude, setRemoteCeiling, setRemoteBus, setSubprocessMemoryCapMB, emitChatMessage } from './services/claude';
import { initSudoService, lockSudo } from './services/sudo';
import { getClaudeBackend } from './services/claudeBackend';
import { RendererProxy } from './services/remote/renderer-proxy';
import { registerGitHandlers } from './services/git';
import { registerFsHandlers } from './services/fs';
import { registerUpdater } from './services/updater';
import { registerUsageHandlers, destroyUsagePolling } from './services/usage';
import { destroyAll, startSuspendTimer, stopSuspendTimer, getAll, remove, suspend, getOrCreate as getOrCreateWorkspace, DEFAULT_SUSPEND_TIMEOUT } from './services/workspace';
import { initFocusTracking, setActiveWorkspace } from './services/notify';
import { devlog, devlogEnabled, devlogFor, devlogPath } from './services/devlog';
import { readIntactClipboardPng } from './services/clipboardImage';
import { startIdleMemoryPurge, collectRendererGarbage, logPurge } from './services/idleMemoryPurge';
import { canonicalUserData, enforceSingleInstance } from './services/singleInstance';
import { LoadGuard, inactiveState } from './services/loadGuard';
import { makeOnAgentKilled, type ScopeSuspender } from './services/loadGuard/hook';
import { Signaller, defaultSignalDeps, frozenFileName, readStartTicks, recoverOrphanedFrozenFiles } from './services/loadGuard/signals';
import { readBootTimeSec, readGpu, readProcesses, readSelfCgroup, readSystemSample } from './services/loadGuard/procReader';
import { OverlayManager } from './services/overlay';
import { registerGithubAuthHandlers } from './services/github-auth';
import { initialSync, schedulePush } from './services/github-sync';
import { registerCodexHandlers, destroyCodexTelemetry } from './services/codex';
import { destroyCodexBackendIfActive } from './services/codexBackend';
import { registerGeminiHandlers } from './services/gemini';
import { registerKimiHandlers } from './services/kimi';
import { registerPluginHandlers } from './services/plugins';
import { registerMcpHandlers } from './services/mcp';
import { registerScaffoldHandler } from './services/scaffold';
import { registerJiraHandlers } from './services/jira';
import { registerLinearHandlers } from './services/linear';
import { registerBrainstormHandlers } from './services/brainstorm';
import { registerSearchHandlers } from './services/search';
import * as saiMcpHost from './services/saiMcpHost';
import * as browserBridge from './services/browserBridge';
import * as browserDeploy from './services/browserDeploy';
import { cleanupSaiMcpConfigs } from './services/saiMcpConfig';
import { setSaiToolDispatch } from './services/saiToolBridge';
import {
  listMetaWorkspaces, createMetaWorkspace, updateMetaWorkspace,
  deleteMetaWorkspace, getMetaWorkspace,
} from './services/metaWorkspace';
import {
  syntheticRootFor, materialize, reconcile, deleteSyntheticRoot, resolveLinkName,
  metaLinkRoots,
} from './services/metaSyntheticRoot';
import { renderHostSearch, type RenderHostParams } from './renderHostUrl';
import { formTimeoutMs } from '../src/render/formTimeout';
import { sanitizeCssColor } from '../src/render/renderSizing';

// Allow E2E tests to isolate userData
if (process.env.SAI_USER_DATA_DIR) {
  app.setPath('userData', process.env.SAI_USER_DATA_DIR);
}

// Canonicalize userData so the single-instance lock key is stable regardless of
// how the path was spelled. $HOME here is symlinked (/home -> /var/home), and a
// self-update relaunch can re-enter via the other spelling; without this the two
// spellings would key different locks and a second copy would slip through to
// fight over the same IndexedDB backing store (see services/singleInstance.ts).
app.setPath('userData', canonicalUserData(app.getPath('userData')));

// Guard against a second copy sharing this profile. If another instance already
// holds the lock we focus it and quit — two instances corrupt each other's
// IndexedDB and freeze the renderer. E2E runs opt out (each gets its own dir).
if (!process.env.SAI_USER_DATA_DIR) {
  enforceSingleInstance({
    requestLock: () => app.requestSingleInstanceLock(),
    onSecondInstance: (handler) => app.on('second-instance', handler),
    focusExisting: () => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    },
    // app.exit(0) terminates immediately and synchronously, so the rest of main
    // never runs in a duplicate instance.
    quit: () => app.exit(0),
  });
}

// Enable remote debugging when requested (npm run dev:debug)
if (process.env.SAI_REMOTE_DEBUG) {
  app.commandLine.appendSwitch('remote-debugging-port', process.env.SAI_REMOTE_DEBUG);
}

// On Linux, EGL context loss from Mesa/driver bugs can freeze the renderer entirely.
// Disable GPU acceleration so the app stays functional.
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('disable-gpu');
  // WebGL (3D model viewer) runs on SwiftShader because the GPU is disabled.
  app.commandLine.appendSwitch('enable-unsafe-swiftshader');
}

let mainWindow: BrowserWindow | null = null;
/** System load guard; linux only, null elsewhere. */
let loadGuard: LoadGuard | null = null;
let loadGuardEventSeq = 0;
let quitConfirmed = false;
let overlayManager: OverlayManager | null = null;

const THEME_TITLEBAR: Record<string, { color: string; symbolColor: string; bg: string }> = {
  default:  { color: '#0c0f11', symbolColor: '#bec6d0', bg: '#111418' },
  midnight: { color: '#131316', symbolColor: '#c8c8d0', bg: '#1a1a1e' },
  steel:    { color: '#2c2d33', symbolColor: '#d5d5dc', bg: '#36373e' },
};

const isMac = process.platform === 'darwin';
let useFramelessRounded = false;

// Remote module singletons
let remote: RemoteModule | null = null;
const terminalStore = new PhoneTerminalRegistry();
terminalStore.startIdleGc();
let pairing: PairingStore | null = null;
let bus: SessionBus | null = null;
let rendererProxy: RendererProxy | null = null;
let blobStore: BlobStore | null = null;
let bridge: BridgeServer | null = null;
let remoteKvPath: string | null = null;
let activeSessionBroadcast: ((payload: { projectPath: string; scope: string; sessionId: string }) => void) | null = null;
let lastActiveSession: { projectPath: string; scope: string; sessionId: string } | null = null;
// Otto uses 17829; pick a distinct port so both can run side by side.
const REMOTE_PORT = 17830;

// Register the active-session IPC handler at module load — the renderer fires this
// on every session change regardless of whether the mobile bridge is enabled. The
// handler stays a no-op until BridgeServer wires up `activeSessionBroadcast`.
ipcMain.handle('remote:setActiveSession', (_e, payload) => {
  lastActiveSession = payload;
  activeSessionBroadcast?.(payload);
});

interface RemoteKv { screenshotSecret?: string; enabled?: boolean; remoteCeiling?: 'auto' | 'auto-read' | 'always-ask' | null }

function readRemoteKv(): RemoteKv {
  if (!remoteKvPath) return {};
  try { return JSON.parse(fs.readFileSync(remoteKvPath, 'utf8')); } catch { return {}; }
}
function writeRemoteKv(patch: RemoteKv): void {
  if (!remoteKvPath) return;
  const merged = { ...readRemoteKv(), ...patch };
  fs.mkdirSync(path.dirname(remoteKvPath), { recursive: true });
  fs.writeFileSync(remoteKvPath, JSON.stringify(merged, null, 2), 'utf8');
}

async function getOrInitRemote(): Promise<RemoteModule> {
  if (remote) return remote;
  const userDataDir = app.getPath('userData');
  const pairingPath = path.join(userDataDir, 'sai-remote-pairings.json');
  remoteKvPath = path.join(userDataDir, 'sai-remote-kv.json');
  pairing = new PairingStore(pairingPath);
  bus = new SessionBus();
  setRemoteBus(bus);
  blobStore = new BlobStore();
  rendererProxy = new RendererProxy({ getWindow: () => mainWindow });
  ipcMain.handle('remote:proxy:reply', (_e, reply) => rendererProxy?.handleReply(reply));
  ipcMain.handle('remote:emit-workspace-status', (_evt, projectPath: string, status: { busy: boolean; streaming: boolean; completed: boolean; approval: boolean; streamingSessionId?: string | null }) => {
    bus?.publish('workspace.status', { type: 'workspace.status', projectPath, status });
  });
  ipcMain.handle('remote:emit-github-watcher', (_evt, payload: { messageId: string; url: string; snapshot: unknown }) => {
    bus?.publish('github.watcher', { type: 'github.watcher', ...payload });
  });

  let kv = readRemoteKv();
  if (!kv.screenshotSecret) {
    kv = { ...kv, screenshotSecret: crypto.randomBytes(32).toString('base64url') };
    writeRemoteKv(kv);
  }
  const screenshotSecret = kv.screenshotSecret!;
  setRemoteCeiling(kv.remoteCeiling ?? null);

  const pwaDir = app.isPackaged
    ? path.join(app.getAppPath(), 'dist', 'renderer-remote')
    : path.join(__dirname, '..', 'dist', 'renderer-remote');

  remote = new RemoteModule({
    pairing,
    bus,
    resolveTailnetEndpoint: () => _resolveTailnetEndpointWithEnv(),
    makeBridge: (tailnetIp) => {
      const b: BridgeServer = new BridgeServer({
        tailnetIp,
        pairing: pairing!,
        bus: bus!,
        pwaDir,
        screenshotSecret,
        loadScreenshot: async () => null, // Phase 3+ wires this
        port: REMOTE_PORT,
        fallbackPorts: [17831, 17832],
        sendPrompt: (args) => {
          // Persist base64 image attachments to temp files (parity with the
          // desktop path, which expects on-disk paths). Fire-and-forget:
          // bridge-server doesn't await this callback.
          const writeImages = (imgs?: string[]): string[] => {
            if (!imgs || imgs.length === 0) return [];
            const tmpDir = path.join(app.getPath('temp'), 'sai-images');
            try { fs.mkdirSync(tmpDir, { recursive: true }); } catch { /* best-effort */ }
            const out: string[] = [];
            for (const dataUrl of imgs) {
              const m = dataUrl.match(/^data:image\/([\w+.-]+);base64,(.+)$/);
              if (!m) continue;
              const ext = (m[1] || 'png').replace(/[^\w]/g, '') || 'png';
              const filename = `image-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${ext}`;
              const filepath = path.join(tmpDir, filename);
              try {
                fs.writeFileSync(filepath, Buffer.from(m[2], 'base64'));
                out.push(filepath);
              } catch { /* skip unreadable item */ }
            }
            return out;
          };
          const imagePaths = writeImages(args.images);
          // Adopt the session the device is attached to so ensureProcess
          // spawns with --resume instead of forking a fresh context. The
          // workspace may not exist yet (first remote message after launch).
          if (args.sessionId) {
            getOrCreateWorkspace(args.projectPath);
            getClaudeBackend().setSessionId(args.projectPath, args.sessionId, args.scope);
          }
          getClaudeBackend().send({
            projectPath: args.projectPath,
            message: args.text,
            imagePaths: imagePaths.length > 0 ? imagePaths : undefined,
            permMode: args.permMode,
            effort: args.effort,
            model: args.model,
            scope: args.scope,
            origin: 'remote',
          });
        },
        resolveApproval: async (args) => {
          await getClaudeBackend().approve({ projectPath: args.projectPath, toolUseId: args.toolUseId, approved: args.decision === 'approve', modifiedCommand: args.modifiedCommand, scope: args.scope });
        },
        answerQuestion: async (args) => {
          await getClaudeBackend().answerQuestion({ projectPath: args.projectPath, toolUseId: args.toolUseId, answers: args.answers, scope: args.scope });
        },
        interruptTurn: (path, scope) => getClaudeBackend().interrupt(path, scope),
        getClaudeModels: () => getClaudeBackend().getModels(),
        listSessions: async (path) => (await rendererProxy!.listSessions(path)) as any,
        loadHistory: async (sid) => (await rendererProxy!.loadHistory(sid)) as any,
        listWorkspaces: () => rendererProxy!.listWorkspaces(),
        setActiveWorkspace: (path) => rendererProxy!.setActiveWorkspace(path),
        registerActiveSessionBroadcast: (broadcast) => {
          activeSessionBroadcast = broadcast;
        },
        getInitialActiveSession: () => lastActiveSession,
        getActiveSessionFromRenderer: async () => {
          try {
            const v = await rendererProxy!.getActiveSession();
            if (v) lastActiveSession = v as any;
            return v as any;
          } catch { return null; }
        },
        listFiles: async (cwd, path) => {
          const full = safeJoin(cwd, path);
          const stat = await statFileImpl(full);
          if (!stat.isDir) throw new Error(`not a directory: ${path}`);
          const entries = await readDirImpl(full);
          return entries.map((e) => ({ name: e.name, kind: e.type === 'directory' ? 'dir' as const : 'file' as const }));
        },
        readFile: async (cwd, path) => {
          const full = safeJoin(cwd, path);
          const stat = await statFileImpl(full);
          const lang = langFromPath(path) ?? undefined;
          const inline = isTextLike(path) && stat.size <= 64 * 1024;
          if (inline) {
            const r = await readFileImpl(full);
            return { content: r.content, encoding: 'text' as const, size: stat.size, lang, mtime: r.mtime, sha: r.sha };
          }
          const id = blobStore!.register(cwd, path);
          const signedUrl = b.signBlobUrl(id);
          return { signedUrl, encoding: 'binary' as const, size: stat.size, mime: mimeFromPath(path) };
        },
        statusFiles: async (cwd) => {
          const { branch, ahead, behind, entries } = await gitStatusImpl(cwd);
          return { entries, branch, ahead, behind };
        },
        diffFile: async (cwd, path, staged) => {
          const diff = await gitDiffImpl(cwd, path, staged);
          return { diff, lang: langFromPath(path) ?? undefined };
        },
        loadBlob: async (id) => {
          const entry = blobStore!.consume(id);
          if (!entry) return null;
          const full = safeJoin(entry.cwd, entry.path);
          const buffer = await readFileBufImpl(full);
          return { buffer, mime: mimeFromPath(entry.path) };
        },
        writeFile: (cwd, p, content, opts) => writeFileImpl(cwd, p, content, opts),
        stageFile:   (cwd, path) => gitStageImpl(cwd, path),
        unstageFile: (cwd, path) => gitUnstageImpl(cwd, path),
        commit:      (cwd, msg) => gitCommitImpl(cwd, msg),
        push:        (cwd) => gitPushImpl(cwd),
        pull:        (cwd) => gitPullImpl(cwd),
        terminalStore,
      });
      bridge = b;
      return b;
    },
  });
  return remote;
}

async function getEnabledFlag(): Promise<boolean> {
  await getOrInitRemote();
  return Boolean(readRemoteKv().enabled);
}
async function setEnabledFlag(value: boolean): Promise<void> {
  await getOrInitRemote();
  writeRemoteKv({ enabled: value });
}

function projectNamesFor(workspace?: string): string[] {
  const names: string[] = [];
  if (!workspace) return names;
  try {
    const pkgPath = path.join(workspace, 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      if (typeof pkg.productName === 'string') names.push(pkg.productName);
      if (typeof pkg.name === 'string') names.push(pkg.name);
    }
  } catch { /* ignore malformed package.json */ }
  names.push(path.basename(workspace));
  return names.filter(Boolean);
}

function createWindow() {
  let tb = THEME_TITLEBAR.default;
  let rounded = false;
  try {
    const s = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'settings.json'), 'utf-8'));
    if (s.theme && THEME_TITLEBAR[s.theme]) tb = THEME_TITLEBAR[s.theme];
    rounded = !!s.roundedCorners;
  } catch { /* use default */ }
  // Frameless transparent mode is only used off macOS — macOS keeps its native traffic lights.
  useFramelessRounded = rounded && !isMac;

  // Restore last window position/size if valid
  let savedBounds: { x: number; y: number; width: number; height: number } | undefined;
  try {
    const s = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'settings.json'), 'utf-8'));
    const b = s.windowBounds;
    if (b && typeof b.x === 'number' && typeof b.y === 'number' &&
        typeof b.width === 'number' && typeof b.height === 'number') {
      const isOnScreen = screen.getAllDisplays().some(({ bounds }) =>
        b.x < bounds.x + bounds.width &&
        b.x + b.width > bounds.x &&
        b.y < bounds.y + bounds.height &&
        b.y + b.height > bounds.y
      );
      if (isOnScreen) savedBounds = b;
    }
  } catch { /* use defaults */ }

  mainWindow = new BrowserWindow({
    width: savedBounds?.width ?? 1400,
    height: savedBounds?.height ?? 900,
    ...(savedBounds ? { x: savedBounds.x, y: savedBounds.y } : {}),
    minWidth: 800,
    minHeight: 600,
    ...(useFramelessRounded
      ? { frame: false, transparent: true, backgroundColor: '#00000000' }
      : {
          titleBarStyle: 'hidden' as const,
          ...(isMac
            ? {}
            : { titleBarOverlay: { color: tb.color, symbolColor: tb.symbolColor, height: 38 } }
          ),
          backgroundColor: tb.bg,
        }
    ),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      spellcheck: true,
    },
  });

  mainWindow.on('maximize', () => mainWindow?.webContents.send('window:maximizedChange', true));
  mainWindow.on('unmaximize', () => mainWindow?.webContents.send('window:maximizedChange', false));

  // Black-screen forensics. A blank window has three distinct causes that look
  // identical from the outside: the renderer died, the renderer is alive but
  // wedged (no paint), or the GPU/viz process died and took compositing with
  // it. None of them left a trace anywhere before this — no crash dump, no log
  // line — so a report of "it went black" was unfalsifiable. Record which one
  // it was at the moment it happens.
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    devlog('lifecycle', 'renderProcessGone', {
      reason: details.reason,
      exitCode: details.exitCode,
    });
  });
  mainWindow.webContents.on('unresponsive', () => {
    devlog('lifecycle', 'unresponsive', { at: 'mainWindow' });
  });
  mainWindow.webContents.on('responsive', () => {
    devlog('lifecycle', 'responsive', { at: 'mainWindow' });
  });
  mainWindow.webContents.on('did-fail-load', (_e, errorCode, errorDescription, validatedURL, isMainFrame) => {
    devlog('lifecycle', 'didFailLoad', { errorCode, errorDescription, validatedURL, isMainFrame });
  });

  initFocusTracking(mainWindow);
  // Focus overlay (off by default; spec 2026-06-11-focus-overlay-design.md).
  // Single instance across re-registration, destroyed in the close handler.
  overlayManager?.destroy();
  overlayManager = new OverlayManager({
    getSavedBounds: () => readSettings().overlayBounds,
    saveBounds: (b) => writeSetting('overlayBounds', b),
  });
  // setEnabled happens after the settings helpers are initialized below —
  // settingsFile is a const declared mid-function, so calling readSettings()
  // here would hit its TDZ and silently report {} (the catch eats the
  // ReferenceError). Burned us once: the overlay stayed disabled at startup.
  mainWindow.on('blur', () => overlayManager?.setMainFocused(false));
  mainWindow.on('focus', () => {
    overlayManager?.setMainFocused(true);
    mainWindow?.flashFrame(false);
  });

  // Give freed renderer memory back to the OS while nobody is looking.
  // See services/idleMemoryPurge.ts for the measurements behind this.
  {
    const win = mainWindow;
    const memoryPurge = startIdleMemoryPurge({
      now: () => Date.now(),
      isFocused: () => !win.isDestroyed() && win.isFocused(),
      systemIdleMs: () => powerMonitor.getSystemIdleTime() * 1000,
      purge: async () => {
        if (win.isDestroyed()) return;
        const wc = win.webContents;
        const pid = wc.getOSProcessId();
        const workingSetMb = () => {
          const m = app.getAppMetrics().find((x) => x.pid === pid);
          return m ? Math.round(m.memory.workingSetSize / 1024) : undefined;
        };
        const beforeMb = workingSetMb();
        const gcMs = await collectRendererGarbage(wc);
        // Freed pages are returned asynchronously; sample a little later.
        setTimeout(() => logPurge({ gcMs, beforeMb, afterMb: workingSetMb() }), 5_000).unref?.();
      },
    });
    win.on('blur', memoryPurge.onBlur);
    win.on('focus', memoryPurge.onFocus);
    win.on('closed', memoryPurge.stop);
  }

  // Right-click context menu with spelling suggestions
  mainWindow.webContents.on('context-menu', (_event, params) => {
    const menu = new Menu();
    if (params.misspelledWord) {
      for (const suggestion of params.dictionarySuggestions) {
        menu.append(new MenuItem({
          label: suggestion,
          click: () => mainWindow!.webContents.replaceMisspelling(suggestion),
        }));
      }
      if (params.dictionarySuggestions.length > 0) {
        menu.append(new MenuItem({ type: 'separator' }));
      }
      menu.append(new MenuItem({
        label: 'Add to dictionary',
        click: () => mainWindow!.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord),
      }));
      menu.append(new MenuItem({ type: 'separator' }));
    }
    if (params.isEditable) {
      menu.append(new MenuItem({ role: 'cut' }));
      menu.append(new MenuItem({ role: 'copy' }));
      menu.append(new MenuItem({ role: 'paste' }));
    } else if (params.selectionText) {
      menu.append(new MenuItem({ role: 'copy' }));
    }
    if (menu.items.length > 0) {
      menu.popup();
    }
  });

  // On macOS, Chromium's Cocoa text-input layer can swallow Ctrl+key events
  // before they reach the DOM / xterm.js.  Intercept Ctrl+C here so the
  // renderer can forward SIGINT to the active terminal PTY.
  mainWindow.webContents.on('before-input-event', (_event, input) => {
    if (
      input.type === 'keyDown' &&
      input.control &&
      !input.shift &&
      !input.alt &&
      !input.meta &&
      input.key.toLowerCase() === 'c'
    ) {
      mainWindow?.webContents.send('terminal:ctrl-c');
    }
  });

  mainWindow.on('close', (e) => {
    if (!quitConfirmed) {
      e.preventDefault();
      // A before-quit that fired first already stopped the guard; the app keeps running, so
      // restart it (start() is a no-op when running; stop() bumped the epoch, settings stay).
      try { loadGuard?.start(); } catch { /* noop */ }
      mainWindow?.webContents.send('app:requestQuit');
      return;
    }
    if (mainWindow) writeSetting('windowBounds', mainWindow.getBounds());
    stopSuspendTimer();
    destroyClaude();
    try { destroyCodexBackendIfActive(); } catch { /* backend already down */ }
    overlayManager?.destroy();
    overlayManager = null;
    destroyAllTerminals();
    terminalStore.destroyAll();
    destroyAll(mainWindow!);
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  registerTerminalHandlers(mainWindow);
  if (process.platform === 'linux' && !loadGuard) {
    const userData = app.getPath('userData');
    // Resume whatever a crashed SAI (any instance, or the legacy shared file) left stopped.
    // Live instances' files are skipped. Once, before this instance freezes anything.
    const orphans = recoverOrphanedFrozenFiles(userData, defaultSignalDeps(''));
    if (orphans.files > 0) devlog('loadguard', 'crash_recovered', orphans);
    // Per-instance file, so a second SAI never resumes or overwrites our frozen set.
    const selfTicks = readStartTicks(process.pid) ?? 0;
    const signaller = new Signaller(defaultSignalDeps(
      path.join(userData, frozenFileName(process.pid, selfTicks)),
      devlogFor('loadguard'),
    ));
    const fake = process.env.SAI_LOAD_GUARD_FAKE;
    loadGuard = new LoadGuard({
      now: () => Date.now(),
      readSystem: () => readSystemSample(),
      readProcs: () => readProcesses(),
      readGpu: () => readGpu(),
      appPids: () => new Set(app.getAppMetrics().map((m) => m.pid)),
      terminalPids: listTerminalPids,
      signaller,
      broadcastState: (state) => {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('loadGuard:state', state);
      },
      // The id lets the renderer dedupe a live panel's card against App's buffered copy.
      emitChat: (projectPath, scope, provider, ev) =>
        emitChatMessage({ type: 'load_guard', id: `load-guard-${Date.now()}-${++loadGuardEventSeq}`, projectPath, scope, provider, loadGuard: ev }),
      onAgentKilled: makeOnAgentKilled(
        () => getClaudeBackend() as ReturnType<typeof getClaudeBackend> & ScopeSuspender,
        (event, data) => devlog('loadguard', event, data),
      ),
      devlog: devlogFor('loadguard'),
      fake: fake === 'warning' || fake === 'critical' ? fake : undefined,
      instance: process.pid,
      bootTimeSec: readBootTimeSec() ?? Math.floor(Date.now() / 1000 - os.uptime()),
      selfCgroup: readSelfCgroup(),
    });
  }
  registerClaudeHandlers(mainWindow);
  initSudoService(emitChatMessage);
  registerJiraHandlers();
  registerLinearHandlers();

  // Auto-start the mobile remote bridge if it was enabled before the last quit.
  void (async () => {
    const r = await getOrInitRemote();
    if (readRemoteKv().enabled) {
      try { await r.start(); } catch (err) {
        console.warn('[remote] auto-start failed:', err);
      }
    }
  })();
  registerCodexHandlers();
  registerGeminiHandlers(mainWindow);
  registerKimiHandlers(mainWindow);
  registerGitHandlers();
  registerFsHandlers(mainWindow!);
  registerPluginHandlers();
  registerSearchHandlers();
  registerMcpHandlers();
  try {
    const mcpHandle = saiMcpHost.start();
    console.log('[sai-mcp] socket listening at', mcpHandle.socketPath);

    // Browser bridge: listens for the native-messaging relay that Chrome
    // spawns when the SAI Browser Bridge extension has a tab attached. Nothing
    // connects until the user clicks the extension's toolbar button.
    try {
      const bridgeHandle = browserBridge.start();
      console.log('[browser-bridge] socket listening at', bridgeHandle.socketPath);
    } catch (err) {
      console.error('[browser-bridge] failed to start:', err);
    }
    // Deploying the extension: SAI automates everything except the "Load
    // unpacked" click, which Chromium reserves for a human. The extension ID is
    // then read back out of the browser's own profile, so the user never has to
    // copy it.
    // Chromium has to read the extension folder off disk and exec the relay,
    // so both are in asarUnpack and must be addressed through the unpacked
    // mirror rather than the archive path app.getAppPath() reports.
    const unpacked = (p: string) => p.replace(/app\.asar([/\\])/, 'app.asar.unpacked$1');
    const bundledExtensionDir = () => unpacked(app.isPackaged
      ? path.join(app.getAppPath(), 'extension', 'chrome')
      : path.join(__dirname, '..', 'extension', 'chrome'));
    // Packaged Linux builds hand the browser a stable copy instead: an
    // AppImage's mount path changes every launch (Chromium would lose the
    // unpacked extension on SAI's next restart), and a Flatpak browser can't
    // read the bundle at all. Synced once per launch so updates land.
    let stableExtensionDir: string | null = null;
    const extensionDir = () => {
      if (!app.isPackaged || process.platform !== 'linux') return bundledExtensionDir();
      if (!stableExtensionDir) {
        try {
          stableExtensionDir = browserDeploy.syncExtensionCopy(bundledExtensionDir());
        } catch (err) {
          console.error('[browser-bridge] could not copy extension, using bundle:', err);
          return bundledExtensionDir();
        }
      }
      return stableExtensionDir;
    };
    const relayScript = () => unpacked(path.join(__dirname, 'browser-bridge-host.js'));

    const browsersById = (ids: string[]): browserDeploy.BrowserDef[] => {
      const detected = browserDeploy.detectBrowsers({ extensionDir: extensionDir() });
      const picked = detected.filter((b) => ids.includes(b.id));
      if (!picked.length) throw new Error('no matching installed browser');
      return picked;
    };

    ipcMain.handle('browser:deploy:info', () => ({
      extensionDir: extensionDir(),
      relayScript: relayScript(),
      relayBuilt: fs.existsSync(relayScript()),
      // Non-null because the manifest pins a `key`: the id is known up front,
      // so the native host can be registered before the extension is loaded.
      expectedExtensionId: browserDeploy.expectedExtensionId(extensionDir()),
      browsers: browserDeploy.detectBrowsers({ extensionDir: extensionDir() }),
    }));

    ipcMain.handle('browser:deploy:install', async (_evt, ids: string[], extensionId: string) => {
      const browsers = browsersById(ids);
      const results = browserDeploy.installNativeHost({
        browsers,
        extensionId,
        relayScript: relayScript(),
      });
      if (process.platform === 'win32' && results[0]) {
        await browserDeploy.registerWindowsHost(results[0].manifestPath);
      }
      return results;
    });

    ipcMain.handle('browser:deploy:uninstall', (_evt, ids: string[]) =>
      browserDeploy.uninstallNativeHost(browsersById(ids)));

    ipcMain.handle('browser:deploy:open-extensions', async (_evt, id: string) => {
      await browserDeploy.openExtensionsPage(browsersById([id])[0]);
    });

    ipcMain.handle('browser:deploy:reveal', () => {
      shell.showItemInFolder(extensionDir());
    });

    ipcMain.handle('browser:status', () => browserBridge.status());
    ipcMain.handle('browser:call', async (_evt, method: string, params: unknown) => {
      // Read-only slice: refuse anything the extension shouldn't be asked for,
      // so a compromised renderer can't reach past the implemented surface.
      if (!browserBridge.BRIDGE_METHODS.has(method)) {
        throw new Error(`unsupported browser bridge method: ${method}`);
      }
      return browserBridge.call(method, params);
    });

    // Bridge SAI chat tool calls into the renderer over IPC.
    const pendingMcpCalls = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

    const safeSendMcp = (channel: string, payload: unknown) => {
      try {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send(channel, payload);
        }
      } catch { /* noop */ }
    };

    // Single dispatch used by BOTH MCP transports: the socket saiMcpHost (Claude
    // CLI and Codex SDK backends) and the in-process SDK MCP server (Claude SDK
    // backend, via saiToolBridge).
    const dispatchSaiTool = async (req: { tool: string; input: unknown; workspace: string }) => {
      const id = `mcp-${crypto.randomUUID()}`;
      return await new Promise<unknown>((resolve, reject) => {
        pendingMcpCalls.set(id, { resolve, reject });
        safeSendMcp('sai-tool:request', {
          id,
          tool: req.tool,
          input: req.input,
          workspace: req.workspace,
        });
        // render_form blocks on human input — give it the form's own (clamped)
        // timeout as a backstop above the renderer's; everything else stays 60s.
        const timeoutMs = req.tool === 'render_form' ? formTimeoutMs(req.input) + 5_000 : 60_000;
        setTimeout(() => {
          if (pendingMcpCalls.has(id)) {
            pendingMcpCalls.delete(id);
            reject(new Error(`tool call ${req.tool} timed out after ${Math.round(timeoutMs / 1000)}s`));
          }
        }, timeoutMs);
      });
    };

    saiMcpHost.onToolCall(dispatchSaiTool);
    setSaiToolDispatch(dispatchSaiTool);

    // Don't leave MCP tool calls hanging if the window goes away mid-call.
    mainWindow.on('closed', () => {
      for (const pending of pendingMcpCalls.values()) {
        pending.reject(new Error('main window closed'));
      }
      pendingMcpCalls.clear();
    });

    ipcMain.on('sai-tool:response', (_evt, id: string, result: unknown) => {
      const pending = pendingMcpCalls.get(id);
      if (!pending) return;
      pendingMcpCalls.delete(id);
      pending.resolve(result);
    });

    ipcMain.on('sai-tool:response-error', (_evt, id: string, error: string) => {
      const pending = pendingMcpCalls.get(id);
      if (!pending) return;
      pendingMcpCalls.delete(id);
      pending.reject(new Error(error));
    });
  } catch (err) {
    console.error('[sai-mcp] failed to start host:', err);
  }
  registerUpdater(mainWindow!);
  registerUsageHandlers(mainWindow!);
  startSuspendTimer(mainWindow, () => {
    const s = readSettings();
    return typeof s.suspendTimeout === 'number' ? s.suspendTimeout : DEFAULT_SUSPEND_TIMEOUT;
  });

  ipcMain.on('app:setBadgeCount', (_event, count: number) => {
    app.setBadgeCount(count);
  });

  // The Home workspace roots at $HOME. Report the realpath plus every spelling
  // that can reach the renderer: on this class of distro /home/<user> is a
  // symlink to /var/home/<user>, and workspace paths arrive in both forms, so
  // identity has to be alias-aware rather than string-equal.
  ipcMain.handle('app:homeDir', () => {
    const raw = os.homedir();
    let real = raw;
    try { real = fs.realpathSync(raw); } catch { /* keep raw */ }
    return { path: real, aliases: [...new Set([raw, real])] };
  });

  ipcMain.on('workspace:setActive', (_event, projectPath: string) => {
    setActiveWorkspace(projectPath || '');
  });

  // Renderer-side developer diagnostics land in the same JSONL as the main
  // process, so a notification and the UI state around it share one timeline.
  ipcMain.on('devlog:write', (_event, event: string, data?: Record<string, unknown>) => {
    devlog('renderer', String(event), data);
  });

  ipcMain.handle('devlog:info', () => ({
    enabled: devlogEnabled(),
    path: devlogEnabled() ? devlogPath() : null,
  }));

  ipcMain.handle('workspace:getAll', () => {
    const active = getAll().filter(w => w.projectPath);
    const recent = getRecentProjects();
    const activeSet = new Set(active.map(w => w.projectPath));
    const recentOnly = recent
      .filter(p => p && !activeSet.has(p))
      .map(p => ({ projectPath: p, status: 'recent', lastActivity: 0 }));
    return [...active, ...recentOnly];
  });

  ipcMain.handle('workspace:close', (_event, projectPath: string) => {
    remove(projectPath, mainWindow!);
  });

  ipcMain.handle('workspace:suspend', (_event, projectPath: string) => {
    suspend(projectPath, mainWindow!);
  });

  ipcMain.handle('metaWorkspace:list', () =>
    listMetaWorkspaces().map(m => ({ ...m, syntheticRoot: syntheticRootFor(m.id) }))
  );

  ipcMain.handle('metaWorkspace:create', (_e, input: {
    name: string;
    projects: { path: string; linkName?: string; description?: string }[];
  }) => {
    const taken = new Set<string>();
    const projects = input.projects.map(p => {
      const base = p.linkName || path.basename(p.path);
      const name = resolveLinkName(base, taken);
      taken.add(name);
      return { path: p.path, linkName: name, description: p.description };
    });
    const meta = createMetaWorkspace({ name: input.name, projects });
    const root = syntheticRootFor(meta.id);
    const runtime = materialize(meta, root);
    return { meta, syntheticRoot: root, projects: runtime };
  });

  ipcMain.handle('metaWorkspace:update', (_e, id: string, patch: any) => {
    const updated = updateMetaWorkspace(id, patch);
    if (!updated) return null;
    const root = syntheticRootFor(updated.id);
    const runtime = reconcile(updated, root);
    return { meta: updated, syntheticRoot: root, projects: runtime };
  });

  ipcMain.handle('metaWorkspace:activate', (_e, id: string) => {
    const meta = getMetaWorkspace(id);
    if (!meta) return null;
    const root = syntheticRootFor(meta.id);
    const runtime = reconcile(meta, root);
    updateMetaWorkspace(meta.id, { lastActivity: Date.now() });
    return { meta, syntheticRoot: root, projects: runtime };
  });

  ipcMain.handle('metaWorkspace:delete', (_e, id: string) => {
    const meta = getMetaWorkspace(id);
    if (meta) {
      const root = syntheticRootFor(meta.id);
      try { deleteSyntheticRoot(root); } catch (err) { console.warn('[sai] meta delete failed:', err); }
    }
    deleteMetaWorkspace(id);
    return true;
  });

  // Settings persistence (works across dev/prod)
  const settingsFile = path.join(app.getPath('userData'), 'settings.json');

  function readSettings(): Record<string, any> {
    try {
      return JSON.parse(fs.readFileSync(settingsFile, 'utf-8'));
    } catch {
      return {};
    }
  }

  function getAuthInfo(): { token: string; login: string } | null {
    const auth = readSettings().github_auth;
    if (!auth?.token || !auth?.user?.login) return null;
    return { token: auth.token, login: auth.user.login };
  }

  function writeSetting(key: string, value: any) {
    const settings = readSettings();
    settings[key] = value;
    fs.writeFileSync(settingsFile, JSON.stringify(settings));
    // Schedule a push to GitHub if authed (skip for auth key itself)
    if (key !== 'github_auth') {
      const auth = getAuthInfo();
      if (auth) schedulePush(auth.token, auth.login, readSettings, mainWindow!);
    }
  }

  /** Missing settings mean on. */
  function applyLoadGuardSettings() {
    const s = readSettings();
    loadGuard?.applySettings({ enabled: s.loadGuardEnabled !== false, autoKill: s.loadGuardAutoKill !== false });
  }

  // Registered on every platform; without a guard (non-linux) they report an inactive normal state.
  ipcMain.handle('loadGuard:getState', () => loadGuard?.state() ?? inactiveState());
  ipcMain.handle('loadGuard:topUsers', () => loadGuard?.topUsers() ?? []);
  ipcMain.handle('loadGuard:resume', () => { loadGuard?.resumeOverride(); });

  ipcMain.handle('settings:get', (_event, key: string, defaultValue?: any) => {
    const settings = readSettings();
    return key in settings ? settings[key] : defaultValue;
  });

  ipcMain.handle('settings:set', (_event, key: string, value: any) => {
    writeSetting(key, value);
    if (key === 'subprocessMemoryCapMB') {
      setSubprocessMemoryCapMB(typeof value === 'number' ? value : 0);
    }
    if (key === 'loadGuardEnabled' || key === 'loadGuardAutoKill') {
      applyLoadGuardSettings();
    }
    if (key === 'overlayEnabled') {
      overlayManager?.setEnabled(value === true);
    }
    if (key === 'overlayMode' && (value === 'on' || value === 'off' || value === 'persist')) {
      overlayManager?.setMode(value);
    }
  });

  ipcMain.on('overlay:update', (_event, payload) => overlayManager?.update(payload));
  ipcMain.on('overlay:setInteractive', (_event, v: boolean) => overlayManager?.setInteractive(!!v));
  ipcMain.on('overlay:dragBy', (_event, dx: number, dy: number) => overlayManager?.dragBy(Number(dx) || 0, Number(dy) || 0));
  ipcMain.on('overlay:dragEnd', () => overlayManager?.noteMoved());
  ipcMain.on('overlay:setMode', (_event, m: string) => {
    if (m === 'on' || m === 'off' || m === 'persist') overlayManager?.setMode(m);
  });
  overlayManager?.setEnabled(readSettings().overlayEnabled === true);
  {
    const m = readSettings().overlayMode;
    if (m === 'on' || m === 'off' || m === 'persist') overlayManager?.setMode(m);
  }

  // Initialize subprocess memory cap from settings (default 4096MB).
  setSubprocessMemoryCapMB(
    typeof readSettings().subprocessMemoryCapMB === 'number'
      ? readSettings().subprocessMemoryCapMB
      : 4096,
  );

  applyLoadGuardSettings();
  loadGuard?.start();

  ipcMain.handle('titlebar:setOverlay', (_event, color: string, symbolColor: string) => {
    if (mainWindow && !useFramelessRounded && !isMac) {
      try { mainWindow.setTitleBarOverlay({ color, symbolColor, height: 38 }); } catch { /* no overlay */ }
    }
  });

  ipcMain.handle('window:isFramelessRounded', () => useFramelessRounded);
  ipcMain.handle('window:isMaximized', () => !!mainWindow?.isMaximized());
  ipcMain.on('window:minimize', () => mainWindow?.minimize());
  ipcMain.on('window:maximizeToggle', () => {
    if (!mainWindow) return;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  });
  ipcMain.on('window:close', () => mainWindow?.close());
  ipcMain.on('app:confirmQuit', () => {
    quitConfirmed = true;
    mainWindow?.close();
  });

  ipcMain.handle('github:syncNow', async () => {
    const auth = getAuthInfo();
    if (!auth) return;
    await initialSync(auth.token, auth.login, readSettings, writeSetting, mainWindow!);
  });

  registerGithubAuthHandlers(mainWindow, readSettings, writeSetting, () => {
    // Called after successful auth — run initial sync
    const auth = getAuthInfo();
    if (auth) initialSync(auth.token, auth.login, readSettings, writeSetting, mainWindow!);
  });

  registerScaffoldHandler(readSettings);
  registerBrainstormHandlers(mainWindow);

  // Run sync on startup if already authenticated.
  // Delay briefly so the renderer has time to mount and subscribe to IPC events.
  mainWindow.webContents.once('did-finish-load', () => {
    setTimeout(() => {
      const auth = getAuthInfo();
      if (auth) initialSync(auth.token, auth.login, readSettings, writeSetting, mainWindow!);
    }, 1500);
  });

  // Recent projects persistence
  const recentProjectsFile = path.join(app.getPath('userData'), 'recent-projects.json');

  function getRecentProjects(): string[] {
    try {
      return JSON.parse(fs.readFileSync(recentProjectsFile, 'utf-8'));
    } catch {
      return [];
    }
  }

  function addRecentProject(projectPath: string) {
    const recent = getRecentProjects().filter(p => p !== projectPath);
    recent.unshift(projectPath);
    fs.writeFileSync(recentProjectsFile, JSON.stringify(recent.slice(0, 50)));
  }

  ipcMain.handle('sai:capture-region', async (_evt, rect: Rect): Promise<string | null> => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      devlog('capture', 'region.noWindow');
      return null;
    }
    const bounds = mainWindow.getContentBounds();
    const clamped = clampRect(rect, { width: bounds.width, height: bounds.height });
    const image = await mainWindow.webContents.capturePage(clamped);
    // capturePage always shoots the live window, whichever workspace it shows;
    // the renderer's foreground check is what keeps that honest, so record what
    // was actually shot to tell a real capture from one that slipped the check.
    devlog('capture', 'region.shot', { clamped, bounds, title: mainWindow.getTitle() });
    return image.toPNG().toString('base64'); // bare base64, no data: prefix
  });

  ipcMain.handle('sai:capture-window', async (_evt, opts: { target?: string; workspace?: string; display?: boolean } = {}) => {
    const selfSourceId = mainWindow && !mainWindow.isDestroyed() ? mainWindow.getMediaSourceId() : undefined;
    const has = (bin: string) => {
      try { execFileSync('which', [bin], { stdio: 'ignore' }); return true; }
      catch { return false; }
    };
    const chain = selectBackendChain({
      platform: process.platform,
      sessionType: process.env.XDG_SESSION_TYPE,
      desktop: process.env.XDG_CURRENT_DESKTOP,
      has,
    });

    // On KDE Wayland, wmctrl/xdotool only see XWayland windows. kdotool asks
    // KWin directly, so it is the only source that enumerates and raises the
    // real window list — and it reports window classes, which is how SAI's own
    // windows are excluded regardless of the workspace name in the titlebar.
    const useKdotool = process.platform === 'linux'
      && (process.env.XDG_SESSION_TYPE ?? '').toLowerCase() === 'wayland'
      && await kdotoolAvailable();

    const cliBackend = chain.find((b) => b !== 'desktopCapturer') as
      'spectacle' | 'grim' | 'screencapture' | undefined;

    devlog('capture', 'window.request', {
      target: opts.target ?? null,
      workspace: opts.workspace ?? null,
      display: opts.display === true,
      platform: process.platform,
      sessionType: process.env.XDG_SESSION_TYPE ?? null,
      desktop: process.env.XDG_CURRENT_DESKTOP ?? null,
      useKdotool,
      cliBackend: cliBackend ?? null,
    });

    return captureWindowFlow(
      { target: opts.target, display: opts.display },
      {
        listWindows: useKdotool ? listKdotoolWindows : listDesktopWindows,
        captureSource: captureDesktopSource,
        captureCli: captureViaCli,
        captureDisplay: () => captureDisplay(cliBackend ?? null),
        chain,
        projectNames: projectNamesFor(opts.workspace),
        selfSourceId,
        selfClasses: ['sai'],
        raiseWindow: useKdotool
          ? (w) => activateKdotoolWindow(w.id)
          : (w) => raiseWindowByTitle(w.title),
        activeWindowTitle: useKdotool ? kdotoolActiveWindowTitle : activeWindowTitle,
        selfTitle: (mainWindow && !mainWindow.isDestroyed() ? mainWindow.getTitle() : undefined) ?? 'SAI',
        portal: process.platform === 'linux' && (process.env.XDG_SESSION_TYPE ?? '').toLowerCase() === 'wayland'
          ? () => capturePortalViaDbus(path.join(app.getPath('userData'), 'capture-portal.json'))
          : undefined,
        log: (event, data) => devlog('capture', event, data),
      },
    );
  });

  ipcMain.handle('project:saveImage', async (_event, base64Data: string) => {
    const tmpDir = path.join(app.getPath('temp'), 'sai-images');
    fs.mkdirSync(tmpDir, { recursive: true });
    // Strip data URL prefix
    const matches = base64Data.match(/^data:image\/(\w+);base64,(.+)$/);
    const ext = matches?.[1] || 'png';
    const data = matches?.[2] || base64Data;
    const filename = `image-${Date.now()}.${ext}`;
    const filepath = path.join(tmpDir, filename);
    fs.writeFileSync(filepath, Buffer.from(data, 'base64'));
    return filepath;
  });

  ipcMain.handle('project:selectFolder', async (_event, defaultPath?: string) => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openDirectory'],
      title: 'Select Project Folder',
      ...(defaultPath ? { defaultPath } : {}),
    });
    const folder = result.filePaths[0] || null;
    if (folder) addRecentProject(folder);
    return folder;
  });

  ipcMain.handle('project:selectFile', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openFile'],
      title: 'Select File',
    });
    return result.filePaths[0] || null;
  });

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

  // Renderer paste delivered a corrupt PNG (Wayland transfer bug) — re-read it.
  ipcMain.handle('sai:clipboard-read-image', async (): Promise<string | null> => readIntactClipboardPng({
    isWayland: process.platform === 'linux' && (process.env.XDG_SESSION_TYPE ?? '').toLowerCase() === 'wayland',
    wlPaste: async () => {
      try {
        const r = await _execFileP('wl-paste', ['--no-newline', '--type', 'image/png'], { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024, timeout: 5000 });
        return r.stdout as Buffer;
      } catch { return null; }
    },
    electronPng: () => { const b = clipboard.readBuffer('image/png'); return b.length ? b : null; },
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    log: (event, data) => devlog('clipboard', event, data),
  }));

  ipcMain.handle('sai:clipboard-write', async (_evt, text: string): Promise<boolean> => {
    try {
      clipboard.writeText(String(text ?? ''));
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.handle('project:getRecent', () => getRecentProjects());
  ipcMain.handle('project:getCwd', () => {
    const recent = getRecentProjects();
    if (recent.length > 0 && fs.existsSync(recent[0])) {
      return recent[0];
    }
    return null;
  });

  ipcMain.handle('project:openRecent', (_event, projectPath: string) => {
    addRecentProject(projectPath);
    return projectPath;
  });

  ipcMain.handle('shell:openExternal', (_event, url: string) => {
    if (/^https?:\/\//i.test(url)) {
      return shell.openExternal(url);
    }
  });

  // Render a mock's HTML in a hidden off-screen window and screenshot it, so the
  // agent can SEE its render without opening a visible browser tab. Returns a
  // bare base64 PNG (or null on failure).
  ipcMain.handle('render:captureHtml', async (_event, args: { html?: string; width?: number; height?: number; background?: string }) => {
    const html = typeof args?.html === 'string' ? args.html : '';
    if (!html) return null;
    const minWidth = Math.min(Math.max(Math.round(args?.width || 480), 80), 2000);
    const hasExplicitHeight = typeof args?.height === 'number' && args.height > 0;
    const initialHeight = Math.min(Math.max(Math.round(args?.height || 480), 80), 4000);
    const background = (typeof args?.background === 'string' && sanitizeCssColor(args.background)) || '#1a1a1a';
    let win: BrowserWindow | null = null;
    try {
      win = new BrowserWindow({
        width: minWidth,
        height: initialHeight,
        show: false,
        // Park it far off any display so it never flashes on screen.
        x: -32000,
        y: -32000,
        frame: false,
        skipTaskbar: true,
        webPreferences: { sandbox: true, javascript: true, backgroundThrottling: false },
      });
      const doc =
        `<!doctype html><html><head><meta charset="utf-8">` +
        `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:;">` +
        `</head><body style="margin:0;background:${background}">${html}</body></html>`;
      await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(doc));
      // Let layout, fonts and any inline scripts settle before measuring.
      await new Promise((r) => setTimeout(r, 320));
      // Grow-only width: widen to the content's natural width (capped) so the
      // screenshot matches the in-chat region instead of clipping/scrolling.
      const naturalW = (await win.webContents.executeJavaScript(
        'Math.ceil(Math.max(document.documentElement.scrollWidth, document.body ? document.body.scrollWidth : 0)) || 0',
      )) as number;
      const width = Math.min(Math.max(minWidth, Math.round(naturalW) || 0), 2000);
      if (width > minWidth) {
        win.setContentSize(width, initialHeight);
        await new Promise((r) => setTimeout(r, 60));
      }
      const h = (await win.webContents.executeJavaScript(
        'Math.ceil(Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0)) || 200',
      )) as number;
      const height = Math.min(Math.max(Math.round(h), hasExplicitHeight ? initialHeight : 40), 4000);
      win.setContentSize(width, height);
      await new Promise((r) => setTimeout(r, 60));
      const image = await win.webContents.capturePage({ x: 0, y: 0, width, height });
      return image.toPNG().toString('base64');
    } catch (err) {
      console.error('[render] captureHtml failed:', err);
      return null;
    } finally {
      try { win?.destroy(); } catch { /* noop */ }
    }
  });

  // Roots a render target may resolve into besides the session cwd: temp dirs for
  // scratch files, plus the linked project roots when cwd is a meta workspace's
  // synthetic root (its contents are symlinks, so realpath'd containment would
  // otherwise read every file in the workspace as an escape).
  const renderAllowedRoots = (cwd: string): string[] => [
    app.getPath('temp'),
    ...osTempRoots(),
    ...metaLinkRoots(cwd),
  ];

  // Content-addressed model version cache (3D viewer): snapshot at tool-call
  // time, read back by versionKey. Containment applies here, not to the code panel.
  const modelCacheDir = () => path.join(app.getPath('userData'), 'model-cache');
  ipcMain.handle('model:snapshot', (_e, args: { cwd: string; path: string }) => {
    if (!args || typeof args.cwd !== 'string' || typeof args.path !== 'string') {
      return { ok: false, error: 'invalid arguments' };
    }
    return snapshotModel({ cwd: args.cwd, path: args.path, allowedRoots: renderAllowedRoots(args.cwd), dir: modelCacheDir() });
  });
  ipcMain.handle('model:readCached', (_e, versionKey: string) => {
    if (!isVersionKey(versionKey)) return null;
    const buf = readCachedModel(versionKey, modelCacheDir());
    return buf ? buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) : null;
  });
  ipcMain.handle('model:prune', (_e, keys: string[]) => {
    return pruneModelCache(Array.isArray(keys) ? keys.filter(isVersionKey) : [], modelCacheDir());
  });

  // Render a FILE-backed site (workspace path or inline html + baseDir) in a
  // hidden off-screen window via the sai-render:// protocol and screenshot it,
  // so the agent can SEE a real multi-file render. Returns base64 PNG or null.
  ipcMain.handle('render:captureFile', async (_event, args: { cwd?: string; path?: string; html?: string; baseDir?: string; width?: number; height?: number }) => {
    if (!args || typeof args.cwd !== 'string' || !args.cwd) return null;
    const target = prepareRenderTarget({ cwd: args.cwd, path: args.path, html: args.html, baseDir: args.baseDir, allowedRoots: renderAllowedRoots(args.cwd) });
    if (!target.ok) return null;
    const token = mintRenderToken(renderProtocolStore, { root: target.root, inlineHtml: target.inlineHtml });
    const url = `sai-render://${token}/${encodeURIComponent(target.entry)}`;
    const width = Math.min(Math.max(Math.round(args.width || 480), 80), 2000);
    let win: BrowserWindow | null = null;
    try {
      win = new BrowserWindow({
        width,
        height: 1200,
        show: false,
        x: -32000,
        y: -32000,
        frame: false,
        skipTaskbar: true,
        webPreferences: { sandbox: true, javascript: true, backgroundThrottling: false },
      });
      await win.loadURL(url);
      // Let layout, fonts and any scripts settle before measuring.
      await new Promise((r) => setTimeout(r, 320));
      const measured = (await win.webContents.executeJavaScript(
        'Math.ceil(Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0)) || 200',
      )) as number;
      const height = args.height && args.height > 0
        ? Math.min(Math.max(Math.round(args.height), 40), 4000)
        : Math.min(Math.max(Math.round(measured), 40), 4000);
      win.setContentSize(width, height);
      await new Promise((r) => setTimeout(r, 60));
      const image = await win.webContents.capturePage({ x: 0, y: 0, width, height });
      return image.toPNG().toString('base64');
    } catch (err) {
      console.error('[render] captureFile failed:', err);
      return null;
    } finally {
      try { win?.destroy(); } catch { /* noop */ }
      evictRenderToken(renderProtocolStore, token);
    }
  });

  ipcMain.handle('render:captureComponent', async (_event, params: RenderHostParams): Promise<string | null> => {
    const width = typeof params?.width === 'number' && params.width > 0 ? Math.min(Math.round(params.width), 2000) : 360;
    let win: BrowserWindow | null = null;
    try {
      win = new BrowserWindow({
        width,
        height: 1200,
        show: false,
        x: -32000,
        y: -32000,
        frame: false,
        skipTaskbar: true,
        webPreferences: { preload: path.join(__dirname, 'preload.js'), sandbox: false, javascript: true, backgroundThrottling: false },
      });
      const search = renderHostSearch({ ...params, width });
      if (process.env.VITE_DEV_SERVER_URL) {
        await win.loadURL(`${process.env.VITE_DEV_SERVER_URL.replace(/\/$/, '')}/render-host?${search}`);
      } else {
        await win.loadFile(path.join(__dirname, '../dist/index.html'), { search });
      }
      // Poll for the host's ready flag (set after layout + fonts), max ~3s.
      const deadline = Date.now() + 3000;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        if (win.isDestroyed()) throw new Error('capture window destroyed during poll');
        const ready = (await win.webContents.executeJavaScript('window.__renderReady === true').catch(() => false)) as boolean;
        if (ready) break;
        if (Date.now() >= deadline) {
          console.warn('[render] captureComponent: ready flag timed out, capturing current frame');
          break;
        }
        await new Promise((r) => setTimeout(r, 50));
      }
      const h = (await win.webContents.executeJavaScript(
        "(function(){var el=document.getElementById('render-host-root');return el?Math.ceil(el.getBoundingClientRect().height):0;})() || 200",
      ).catch(() => 200)) as number;
      const height = Math.min(Math.max(Math.round(h), 40), 4000);
      win.setContentSize(width, height);
      await new Promise((r) => setTimeout(r, 60));
      const image = await win.webContents.capturePage({ x: 0, y: 0, width, height });
      return image.toPNG().toString('base64');
    } catch (err) {
      console.error('[render] captureComponent failed:', err);
      return null;
    } finally {
      try { win?.destroy(); } catch { /* noop */ }
    }
  });

  ipcMain.handle(
    'render:mintFileUrl',
    async (_e, args: { cwd: string; path?: string; html?: string; baseDir?: string }) => {
      if (!args || typeof args.cwd !== 'string' || !args.cwd) {
        return { ok: false, error: 'missing cwd' };
      }
      const target = prepareRenderTarget({ ...args, allowedRoots: renderAllowedRoots(args.cwd) });
      if (!target.ok) return { ok: false, error: target.error };
      const token = mintRenderToken(renderProtocolStore, {
        root: target.root,
        inlineHtml: target.inlineHtml,
      });
      return { ok: true, url: `sai-render://${token}/${encodeURIComponent(target.entry)}`, token };
    },
  );

  ipcMain.handle('render:releaseFileUrl', async (_e, token: string) => {
    if (typeof token === 'string') evictRenderToken(renderProtocolStore, token);
    return true;
  });

  // Open a render in the default browser. Accepts EITHER inline HTML (written to a
  // temp file) OR { cwd, path } to open the real on-disk file.
  ipcMain.handle('render:openInBrowser', async (_event, arg: string | { cwd: string; path: string }) => {
    try {
      if (arg && typeof arg === 'object' && typeof arg.path === 'string') {
        const target = prepareRenderTarget({ cwd: arg.cwd, path: arg.path, allowedRoots: renderAllowedRoots(arg.cwd) });
        if (!target.ok) return false;
        const file = path.join(target.root, target.entry);
        await shell.openExternal(pathToFileURL(file).toString());
        return true;
      }
      const html = arg as string;
      if (typeof html !== 'string' || !html) return false;
      const dir = path.join(app.getPath('temp'), 'sai-renders');
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `render-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.html`);
      fs.writeFileSync(file, html, 'utf8');
      await shell.openExternal(pathToFileURL(file).toString());
      return true;
    } catch (err) {
      console.error('[render] openInBrowser failed:', err);
      return false;
    }
  });

  ipcMain.handle('remote:setEnabled', async (_e, enabled: boolean) => {
    const r = await getOrInitRemote();
    await setEnabledFlag(enabled);
    if (enabled) await r.start();
    else await r.stop();
  });

  ipcMain.handle('remote:status', async () => {
    const enabled = await getEnabledFlag();
    if (!remote) return { running: false, url: null, reason: 'disabled', pairedCount: 0, enabled };
    return { ...remote.status(), enabled };
  });

  ipcMain.handle('remote:mintPairCode', async () => {
    const r = await getOrInitRemote();
    return r.mintPairingCode();
  });

  ipcMain.handle('remote:listDevices', async () => {
    await getOrInitRemote();
    return pairing!.list();
  });

  ipcMain.handle('remote:revoke', async (_e, deviceId: string) => {
    await getOrInitRemote();
    pairing!.revoke(deviceId);
    remote!.closeDeviceConnections(deviceId);
  });

  ipcMain.handle('remote:setCeiling', async (_e, ceiling: 'auto' | 'auto-read' | 'always-ask' | null) => {
    await getOrInitRemote();
    writeRemoteKv({ remoteCeiling: ceiling });
    setRemoteCeiling(ceiling);
  });

  ipcMain.handle('remote:getCeiling', async () => {
    await getOrInitRemote();
    return readRemoteKv().remoteCeiling ?? null;
  });
}

// Suppress EPIPE errors from writing to closed streams (e.g. killed child processes)
process.on('uncaughtException', (err) => {
  if ((err as NodeJS.ErrnoException).code === 'EPIPE') return;
  console.error('Uncaught exception:', err);
});

app.whenReady().then(() => {
  protocol.handle('sai-render', async (request) => {
    const url = new URL(request.url); // sai-render://<token>/<path>
    const token = url.hostname;
    const rawPath = url.pathname; // leading slash included
    const r = resolveRenderAsset(renderProtocolStore, token, rawPath);
    if (!r.ok) {
      return new Response('blocked', { status: r.status });
    }
    const headers: Record<string, string> = { 'Content-Security-Policy': RENDER_CSP };
    if (r.inlineHtml != null) {
      return new Response(r.inlineHtml, {
        status: 200,
        headers: { ...headers, 'Content-Type': 'text/html' },
      });
    }
    const body = fs.readFileSync(r.filePath);
    return new Response(new Uint8Array(body), {
      status: 200,
      headers: { ...headers, 'Content-Type': contentTypeFor(r.filePath) },
    });
  });
  createWindow();
});
// The GPU/viz process death is the one black-screen cause the window's own
// events can't see: the renderer stays alive and healthy, it just has nowhere
// to present frames. Chromium restarts the process silently, so without this
// the only evidence is a window that stopped painting.
app.on('child-process-gone', (_e, details) => {
  devlog('lifecycle', 'childProcessGone', {
    type: details.type,
    reason: details.reason,
    exitCode: details.exitCode,
    serviceName: details.serviceName,
    name: details.name,
  });
});

let _quitInProgress = false;
app.on('before-quit', (e) => {
  // Process-level fallback for exit paths that bypass the window close handler.
  // Idempotent with the close-path cleanup above.
  try { destroyCodexBackendIfActive(); } catch { /* backend already down */ }
  try { destroyCodexTelemetry(); } catch { /* telemetry already down */ }
  try { saiMcpHost.stop(); } catch { /* noop */ }
  // The bridge token authenticates any local process to the browser — drop it.
  try { browserBridge.stop(); } catch { /* noop */ }
  // Config tmp files carry the SAI MCP host auth secret — don't leave them behind.
  try { cleanupSaiMcpConfigs(); } catch { /* noop */ }
  // The sudo pw file holds the user's password — never leave it behind.
  try { lockSudo(); } catch { /* noop */ }
  // Never leave SAI's processes SIGSTOPped behind us.
  try { loadGuard?.stop(); } catch { /* noop */ }
  // Synchronously release the remote bridge port before Electron exits.
  if (remote && !_quitInProgress) {
    _quitInProgress = true;
    e.preventDefault();
    // Cap the await — never block Electron exit on a hung socket close.
    const timer = setTimeout(() => app.exit(0), 2000);
    void remote.stop().finally(() => { clearTimeout(timer); app.exit(0); });
  }
});
app.on('window-all-closed', () => {
  stopSuspendTimer();
  destroyUsagePolling();
  try { destroyCodexTelemetry(); } catch { /* telemetry already down */ }
  destroyAllTerminals();
  terminalStore.destroyAll();
  if (mainWindow) destroyAll(mainWindow);
  try { saiMcpHost.stop(); } catch { /* noop */ }
  try { browserBridge.stop(); } catch { /* noop */ }
  app.quit();
});
