import { app, BrowserWindow, ipcMain, dialog, shell, Menu, MenuItem, screen, clipboard, Notification, protocol } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
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
import { listDesktopWindows, captureDesktopSource, captureViaCli } from './capture/backends';
import { activeWindowTitle, raiseWindowByTitle } from './capture/windowControl';
import { gitStatusImpl, gitDiffImpl, gitStageImpl, gitUnstageImpl, gitCommitImpl, gitPushImpl, gitPullImpl } from './services/git';
import { enrichedEnv } from './services/shellEnv';
import {
  createRenderProtocolStore,
  resolveRenderAsset,
  RENDER_CSP,
  contentTypeFor,
  prepareRenderTarget,
  mintRenderToken,
  evictRenderToken,
} from './services/renderProtocol';
import { execFile as _execFile, execFileSync } from 'node:child_process';
import { promisify as _promisify } from 'node:util';
const _execFileP = _promisify(_execFile);

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
import { registerTerminalHandlers, destroyAllTerminals } from './services/pty';
import { registerClaudeHandlers, destroyClaude, setRemoteCeiling, setRemoteBus, setSubprocessMemoryCapMB } from './services/claude';
import { getClaudeBackend } from './services/claudeBackend';
import { RendererProxy } from './services/remote/renderer-proxy';
import { registerGitHandlers } from './services/git';
import { registerFsHandlers } from './services/fs';
import { registerUpdater } from './services/updater';
import { registerUsageHandlers, destroyUsagePolling } from './services/usage';
import { destroyAll, startSuspendTimer, stopSuspendTimer, getAll, remove, suspend, getOrCreate as getOrCreateWorkspace, DEFAULT_SUSPEND_TIMEOUT } from './services/workspace';
import { initFocusTracking, setActiveWorkspace } from './services/notify';
import { OverlayManager } from './services/overlay';
import { registerGithubAuthHandlers } from './services/github-auth';
import { initialSync, schedulePush } from './services/github-sync';
import { registerCodexHandlers } from './services/codex';
import { registerGeminiHandlers } from './services/gemini';
import { registerPluginHandlers } from './services/plugins';
import { registerMcpHandlers } from './services/mcp';
import { registerScaffoldHandler } from './services/scaffold';
import { registerJiraHandlers } from './services/jira';
import { registerLinearHandlers } from './services/linear';
import { registerBrainstormHandlers } from './services/brainstorm';
import { registerSearchHandlers } from './services/search';
import { registerSwarmHandlers } from './services/swarm';
import * as swarmMcpHost from './services/swarmMcpHost';
import {
  listMetaWorkspaces, createMetaWorkspace, updateMetaWorkspace,
  deleteMetaWorkspace, getMetaWorkspace,
} from './services/metaWorkspace';
import {
  syntheticRootFor, materialize, reconcile, deleteSyntheticRoot, resolveLinkName,
} from './services/metaSyntheticRoot';
import { renderHostSearch, type RenderHostParams } from './renderHostUrl';
import { formTimeoutMs } from '../src/render/formTimeout';
import { sanitizeCssColor } from '../src/render/renderSizing';

// Allow E2E tests to isolate userData
if (process.env.SAI_USER_DATA_DIR) {
  app.setPath('userData', process.env.SAI_USER_DATA_DIR);
}

// Enable remote debugging when requested (npm run dev:debug)
if (process.env.SAI_REMOTE_DEBUG) {
  app.commandLine.appendSwitch('remote-debugging-port', process.env.SAI_REMOTE_DEBUG);
}

// On Linux, EGL context loss from Mesa/driver bugs can freeze the renderer entirely.
// Disable GPU acceleration so the app stays functional.
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('disable-gpu');
}

let mainWindow: BrowserWindow | null = null;
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
          });
        },
        resolveApproval: async (args) => {
          await getClaudeBackend().approve({ projectPath: args.projectPath, toolUseId: args.toolUseId, approved: args.decision === 'approve', modifiedCommand: args.modifiedCommand, scope: args.scope });
        },
        answerQuestion: async (args) => {
          await getClaudeBackend().answerQuestion({ projectPath: args.projectPath, toolUseId: args.toolUseId, answers: args.answers, scope: args.scope });
        },
        interruptTurn: (path, scope) => getClaudeBackend().interrupt(path, scope),
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
      mainWindow?.webContents.send('swarm:request-quit');
      return;
    }
    if (mainWindow) writeSetting('windowBounds', mainWindow.getBounds());
    stopSuspendTimer();
    destroyClaude();
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
  registerClaudeHandlers(mainWindow);
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
  registerCodexHandlers(mainWindow);
  registerGeminiHandlers(mainWindow);
  registerGitHandlers();
  registerFsHandlers(mainWindow!);
  registerPluginHandlers(readSettings);
  registerSearchHandlers();
  registerMcpHandlers();
  registerSwarmHandlers();
  try {
    const mcpHandle = swarmMcpHost.start();
    console.log('[swarm-mcp] socket listening at', mcpHandle.socketPath);

    // Bridge MCP tool calls (from socket) into the renderer over IPC.
    const pendingMcpCalls = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void; toolUseId: string; workspace: string; orchSessionId: string | undefined }>();
    // Per-workspace orchestrator session id, registered by the renderer when
    // ensureOrchestratorSession resolves. Used to tag synthetic claude:message
    // events so ChatPanel renders inline tool cards for MCP calls.
    const swarmOrchestratorSessions = new Map<string, string>();

    const safeSendMcp = (channel: string, payload: unknown) => {
      try {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send(channel, payload);
        }
      } catch { /* noop */ }
    };

    ipcMain.handle('swarm:set-orchestrator-session', (_evt, workspace: string, sessionId: string) => {
      if (typeof workspace === 'string' && typeof sessionId === 'string') {
        swarmOrchestratorSessions.set(workspace, sessionId);
      }
    });

    swarmMcpHost.onToolCall(async (req) => {
      const id = `mcp-${crypto.randomUUID()}`;
      // Deterministic tool_use id so the later tool_result can be matched.
      const toolUseId = `mcp-tooluse-${id}`;
      const orchSessionId = swarmOrchestratorSessions.get(req.workspace);

      // Inject a synthetic assistant tool_use into the orchestrator chat so a
      // SwarmToolCardSelector card renders inline. Claude CLI's stream-json
      // output doesn't surface tool_use blocks for MCP tools (they're absorbed
      // into the MCP exchange), so without this fallback the orchestrator chat
      // looks like the model "did nothing" even though tasks landed.
      if (orchSessionId) {
        safeSendMcp('claude:message', {
          type: 'assistant',
          projectPath: req.workspace,
          scope: orchSessionId,
          message: {
            content: [
              { type: 'tool_use', id: toolUseId, name: `mcp__swarm__${req.tool}`, input: req.input },
            ],
          },
        });
      }

      return await new Promise<unknown>((resolve, reject) => {
        pendingMcpCalls.set(id, { resolve, reject, toolUseId, workspace: req.workspace, orchSessionId });
        safeSendMcp('swarm:tool-request', {
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
    });

    // Don't leave MCP tool calls hanging if the window goes away mid-call.
    mainWindow.on('closed', () => {
      for (const pending of pendingMcpCalls.values()) {
        pending.reject(new Error('main window closed'));
      }
      pendingMcpCalls.clear();
    });

    const emitSyntheticToolResult = (
      pending: { toolUseId: string; workspace: string; orchSessionId: string | undefined },
      content: string,
      isError: boolean,
    ) => {
      if (!pending.orchSessionId) return;
      safeSendMcp('claude:message', {
        type: 'user',
        projectPath: pending.workspace,
        scope: pending.orchSessionId,
        message: {
          content: [
            { type: 'tool_result', tool_use_id: pending.toolUseId, content, is_error: isError },
          ],
        },
      });
    };

    ipcMain.on('swarm:tool-response', (_evt, id: string, result: unknown) => {
      const pending = pendingMcpCalls.get(id);
      if (!pending) return;
      pendingMcpCalls.delete(id);
      let serialized: string;
      try { serialized = typeof result === 'string' ? result : JSON.stringify(result); } catch { serialized = String(result); }
      emitSyntheticToolResult(pending, serialized, false);
      pending.resolve(result);
    });

    ipcMain.on('swarm:tool-response-error', (_evt, id: string, error: string) => {
      const pending = pendingMcpCalls.get(id);
      if (!pending) return;
      pendingMcpCalls.delete(id);
      emitSyntheticToolResult(pending, String(error ?? 'error'), true);
      pending.reject(new Error(error));
    });

    // Renderer-driven synthetic card emission. Used for user-initiated actions
    // (Land / Discard clicks) that bypass the MCP onToolCall path but should
    // still appear inline in the orchestrator chat as activity cards.
    ipcMain.handle('swarm:emit-card', (_evt, args: { workspace: string; kind: string; input: unknown }) => {
      if (!args || typeof args.workspace !== 'string' || typeof args.kind !== 'string') return null;
      const orchSessionId = swarmOrchestratorSessions.get(args.workspace);
      if (!orchSessionId) return null;
      const toolUseId = `mcp-tooluse-${crypto.randomUUID()}`;
      safeSendMcp('claude:message', {
        type: 'assistant',
        projectPath: args.workspace,
        scope: orchSessionId,
        message: {
          content: [
            { type: 'tool_use', id: toolUseId, name: `mcp__swarm__${args.kind}`, input: args.input ?? {} },
          ],
        },
      });
      return { id: toolUseId };
    });

    ipcMain.on('swarm:emit-card-result', (_evt, args: { workspace: string; id: string; result: unknown; isError?: boolean }) => {
      if (!args || typeof args.workspace !== 'string' || typeof args.id !== 'string') return;
      const orchSessionId = swarmOrchestratorSessions.get(args.workspace);
      if (!orchSessionId) return;
      let serialized: string;
      try { serialized = typeof args.result === 'string' ? args.result : JSON.stringify(args.result); } catch { serialized = String(args.result); }
      safeSendMcp('claude:message', {
        type: 'user',
        projectPath: args.workspace,
        scope: orchSessionId,
        message: {
          content: [
            { type: 'tool_result', tool_use_id: args.id, content: serialized, is_error: !!args.isError },
          ],
        },
      });
    });
  } catch (err) {
    console.error('[swarm-mcp] failed to start host:', err);
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

  ipcMain.on('workspace:setActive', (_event, projectPath: string) => {
    setActiveWorkspace(projectPath || '');
  });

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

  ipcMain.handle('settings:get', (_event, key: string, defaultValue?: any) => {
    const settings = readSettings();
    return key in settings ? settings[key] : defaultValue;
  });

  ipcMain.handle('settings:set', (_event, key: string, value: any) => {
    writeSetting(key, value);
    if (key === 'subprocessMemoryCapMB') {
      setSubprocessMemoryCapMB(typeof value === 'number' ? value : 0);
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
    if (!mainWindow || mainWindow.isDestroyed()) return null;
    const bounds = mainWindow.getContentBounds();
    const clamped = clampRect(rect, { width: bounds.width, height: bounds.height });
    const image = await mainWindow.webContents.capturePage(clamped);
    return image.toPNG().toString('base64'); // bare base64, no data: prefix
  });

  ipcMain.handle('sai:capture-window', async (_evt, opts: { target?: string; workspace?: string } = {}) => {
    const selfSourceId = mainWindow && !mainWindow.isDestroyed() ? mainWindow.getMediaSourceId() : undefined;
    const chain = selectBackendChain({
      platform: process.platform,
      sessionType: process.env.XDG_SESSION_TYPE,
      desktop: process.env.XDG_CURRENT_DESKTOP,
      has: (bin) => {
        try { execFileSync('which', [bin], { stdio: 'ignore' }); return true; }
        catch { return false; }
      },
    });
    return captureWindowFlow(
      { target: opts.target },
      {
        listWindows: listDesktopWindows,
        captureSource: captureDesktopSource,
        captureCli: captureViaCli,
        chain,
        projectNames: projectNamesFor(opts.workspace),
        selfSourceId,
        raiseWindow: raiseWindowByTitle,
        activeWindowTitle,
        selfTitle: (mainWindow && !mainWindow.isDestroyed() ? mainWindow.getTitle() : undefined) ?? 'SAI',
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
  ipcMain.handle('render:captureHtml', async (_event, args: { html?: string; width?: number; background?: string }) => {
    const html = typeof args?.html === 'string' ? args.html : '';
    if (!html) return null;
    const minWidth = Math.min(Math.max(Math.round(args?.width || 480), 80), 2000);
    const background = (typeof args?.background === 'string' && sanitizeCssColor(args.background)) || '#1a1a1a';
    let win: BrowserWindow | null = null;
    try {
      win = new BrowserWindow({
        width: minWidth,
        height: 1200,
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
        win.setContentSize(width, 1200);
        await new Promise((r) => setTimeout(r, 60));
      }
      const h = (await win.webContents.executeJavaScript(
        'Math.ceil(Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0)) || 200',
      )) as number;
      const height = Math.min(Math.max(Math.round(h), 40), 4000);
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

  // Render a FILE-backed site (workspace path or inline html + baseDir) in a
  // hidden off-screen window via the sai-render:// protocol and screenshot it,
  // so the agent can SEE a real multi-file render. Returns base64 PNG or null.
  ipcMain.handle('render:captureFile', async (_event, args: { cwd?: string; path?: string; html?: string; baseDir?: string; width?: number; height?: number }) => {
    if (!args || typeof args.cwd !== 'string' || !args.cwd) return null;
    const target = prepareRenderTarget({ cwd: args.cwd, path: args.path, html: args.html, baseDir: args.baseDir, allowedRoots: [app.getPath('temp')] });
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
      const target = prepareRenderTarget({ ...args, allowedRoots: [app.getPath('temp')] });
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
        const target = prepareRenderTarget({ cwd: arg.cwd, path: arg.path, allowedRoots: [app.getPath('temp')] });
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
let _quitInProgress = false;
app.on('before-quit', (e) => {
  try { swarmMcpHost.stop(); } catch { /* noop */ }
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
  destroyAllTerminals();
  terminalStore.destroyAll();
  if (mainWindow) destroyAll(mainWindow);
  try { swarmMcpHost.stop(); } catch { /* noop */ }
  app.quit();
});
