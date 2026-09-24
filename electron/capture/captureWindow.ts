import type { BackendName } from './selectBackend';
import type { PortalCaptureResult } from './portalCapture';
import { inferWindow, type WindowCandidate } from './inferWindow';
import { isBlankFrame } from './blankFrame';
import { activeWindowIsTarget } from './activeGuard';

export interface CaptureWindowDeps {
  listWindows: () => Promise<WindowCandidate[]>;
  captureSource: (id: string) => Promise<{ base64: string; rgba: Buffer; empty: boolean }>;
  captureCli: (b: 'spectacle' | 'grim' | 'screencapture') => Promise<{ base64: string; rgba: Buffer }>;
  // Whole-monitor capture for `display: true`. Absent when no backend on this
  // platform can do it.
  captureDisplay?: () => Promise<{ base64: string; rgba: Buffer }>;
  chain: BackendName[];
  projectNames: string[];
  selfSourceId?: string;
  selfClasses?: string[];
  raiseWindow?: (w: WindowCandidate) => Promise<boolean>;
  activeWindowTitle?: () => Promise<string | null>;
  selfTitle?: string;
  // Wayland fallback: capture via the xdg-desktop-portal ScreenCast picker.
  // Only reached when window inference finds nothing, because the portal
  // returns whatever the user picked once and cannot honour `target`.
  portal?: () => Promise<PortalCaptureResult>;
  // Focus takes a moment to settle after a raise, and other apps can steal it
  // back. Poll rather than checking once.
  settleMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export type CaptureWindowResult =
  | { ok: true; __mcpImage: { base64: string; mimeType: 'image/png' }; window?: string }
  | { ok: false; candidates?: string[]; message: string };

const DEFAULT_SETTLE_MS = 1500;
const POLL_STEP_MS = 150;

const ok = (base64: string, window: string): CaptureWindowResult => ({
  ok: true,
  __mcpImage: { base64, mimeType: 'image/png' },
  window,
});

// Raise the pick, then wait for the compositor to actually make it active.
// Returns false if focus never landed on the target (or landed on SAI).
async function focusTarget(pick: WindowCandidate, deps: CaptureWindowDeps): Promise<boolean> {
  if (deps.raiseWindow) await deps.raiseWindow(pick);
  if (!deps.activeWindowTitle) return false;
  const budget = deps.settleMs ?? DEFAULT_SETTLE_MS;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  for (let waited = 0; ; waited += POLL_STEP_MS) {
    const activeTitle = await deps.activeWindowTitle();
    if (activeWindowIsTarget(activeTitle, pick.title, deps.selfTitle ?? '')) return true;
    if (waited >= budget) return false;
    await sleep(POLL_STEP_MS);
  }
}

async function captureViaChain(
  pick: WindowCandidate,
  deps: CaptureWindowDeps,
): Promise<CaptureWindowResult | null> {
  let focusFailed = false;
  for (const backend of deps.chain) {
    try {
      if (backend === 'desktopCapturer') {
        const shot = await deps.captureSource(pick.id);
        if (!shot.empty && !isBlankFrame(shot.rgba)) return ok(shot.base64, pick.title);
      } else {
        // CLI backends capture the ACTIVE window (spectacle) or whole screen
        // (grim/screencapture), NOT a specific window. To uphold the no-SAI
        // guarantee, raise the intended window and only proceed once the active
        // window is confirmed to be the target and is not SAI.
        if (!(await focusTarget(pick, deps))) {
          focusFailed = true;
          continue;
        }
        const shot = await deps.captureCli(backend);
        if (!isBlankFrame(shot.rgba)) return ok(shot.base64, pick.title);
      }
    } catch {
      // advance to next backend
    }
  }
  if (focusFailed) {
    return {
      ok: false,
      message: `Could not bring ${pick.title ? `"${pick.title}"` : 'the target window'} to the foreground to capture it (your compositor may block programmatic window raising). Focus that window, then ask again.`,
    };
  }
  return null;
}

async function captureViaPortal(deps: CaptureWindowDeps): Promise<CaptureWindowResult | null> {
  if (!deps.portal) return null;
  const r = await deps.portal();
  if (!r.ok) return r.reason === 'unavailable' ? null : { ok: false, message: r.message };
  if (isBlankFrame(r.rgba)) return null;
  return ok(r.base64, 'portal selection');
}

export async function captureWindowFlow(
  opts: { target?: string; display?: boolean },
  deps: CaptureWindowDeps,
): Promise<CaptureWindowResult> {
  if (opts.display) {
    if (!deps.captureDisplay) {
      return { ok: false, message: 'whole-display capture is not available on this system' };
    }
    const shot = await deps.captureDisplay();
    if (isBlankFrame(shot.rgba)) {
      return { ok: false, message: 'display capture returned an empty frame' };
    }
    return ok(shot.base64, 'display');
  }

  const windows = await deps.listWindows();
  const inferred = inferWindow(windows, {
    target: opts.target,
    projectNames: deps.projectNames,
    selfSourceId: deps.selfSourceId,
    selfClasses: deps.selfClasses,
  });

  if (inferred.kind === 'pick') {
    const result = await captureViaChain(inferred.window, deps);
    if (result) return result;
  } else if (inferred.kind === 'target-miss') {
    const open = inferred.titles.length ? ` Open windows: ${inferred.titles.join(', ')}` : '';
    return {
      ok: false,
      candidates: inferred.titles.length ? inferred.titles : undefined,
      message: `No window matching "${opts.target}" found.${open}`,
    };
  } else if (inferred.kind === 'candidates') {
    return { ok: false, candidates: inferred.titles, message: 'Multiple windows matched; pass `target` to disambiguate.' };
  }

  // Last resort. The portal cannot honour `target`, so an explicit target that
  // we failed to capture must not silently become "whatever was picked once".
  if (!opts.target) {
    const viaPortal = await captureViaPortal(deps);
    if (viaPortal) return viaPortal;
  }

  if (inferred.kind === 'none') return { ok: false, message: 'no external app window found' };
  return { ok: false, message: 'capture returned an empty frame (screen-recording permission or Wayland portal?)' };
}
