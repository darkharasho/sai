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
  // Diagnostics sink. Capture decides between several backends across a
  // compositor boundary we cannot observe afterwards, so every branch that
  // picks a window, a backend, or an error reports itself here. Injected
  // rather than imported so this module stays free of electron and its unit
  // tests stay silent.
  log?: (event: string, data?: Record<string, unknown>) => void;
}

export type CaptureWindowResult =
  | { ok: true; __mcpImage: { base64: string; mimeType: 'image/png' }; window?: string }
  | { ok: false; candidates?: string[]; message: string };

const DEFAULT_SETTLE_MS = 1500;
const POLL_STEP_MS = 150;

const noop = () => {};

const ok = (base64: string, window: string): CaptureWindowResult => ({
  ok: true,
  __mcpImage: { base64, mimeType: 'image/png' },
  window,
});

// Raise the pick, then wait for the compositor to actually make it active.
// Returns false if focus never landed on the target (or landed on SAI).
async function focusTarget(pick: WindowCandidate, deps: CaptureWindowDeps): Promise<boolean> {
  const log = deps.log ?? noop;
  const raised = deps.raiseWindow ? await deps.raiseWindow(pick) : null;
  if (!deps.activeWindowTitle) {
    log('focus.giveUp', { window: pick.title, raised, why: 'no activeWindowTitle probe' });
    return false;
  }
  const budget = deps.settleMs ?? DEFAULT_SETTLE_MS;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  for (let waited = 0; ; waited += POLL_STEP_MS) {
    const activeTitle = await deps.activeWindowTitle();
    if (activeWindowIsTarget(activeTitle, pick.title, deps.selfTitle ?? '')) {
      log('focus.settled', { window: pick.title, raised, activeTitle, waited });
      return true;
    }
    if (waited >= budget) {
      // The active window at timeout is the whole diagnosis: SAI here means the
      // raise never took, a third app means focus was stolen mid-poll.
      log('focus.timeout', { window: pick.title, raised, activeTitle, waited });
      return false;
    }
    await sleep(POLL_STEP_MS);
  }
}

async function captureViaChain(
  pick: WindowCandidate,
  deps: CaptureWindowDeps,
): Promise<CaptureWindowResult | null> {
  const log = deps.log ?? noop;
  let focusFailed = false;
  for (const backend of deps.chain) {
    try {
      if (backend === 'desktopCapturer') {
        const shot = await deps.captureSource(pick.id);
        if (!shot.empty && !isBlankFrame(shot.rgba)) {
          log('backend.ok', { backend, window: pick.title });
          return ok(shot.base64, pick.title);
        }
        log('backend.blank', { backend, window: pick.title, empty: shot.empty });
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
        if (!isBlankFrame(shot.rgba)) {
          log('backend.ok', { backend, window: pick.title });
          return ok(shot.base64, pick.title);
        }
        log('backend.blank', { backend, window: pick.title });
      }
    } catch (e) {
      log('backend.threw', { backend, window: pick.title, error: String((e as Error)?.message ?? e) });
      // advance to next backend
    }
  }
  if (focusFailed) {
    log('result.focusFailed', { window: pick.title });
    return {
      ok: false,
      message: `Could not bring ${pick.title ? `"${pick.title}"` : 'the target window'} to the foreground to capture it (your compositor may block programmatic window raising). Focus that window, then ask again.`,
    };
  }
  log('chain.exhausted', { window: pick.title, chain: deps.chain });
  return null;
}

async function captureViaPortal(deps: CaptureWindowDeps): Promise<CaptureWindowResult | null> {
  const log = deps.log ?? noop;
  if (!deps.portal) return null;
  const r = await deps.portal();
  // The portal returns whatever was picked once and never says what that was,
  // so this line is the only record that a frame came from the restore token.
  log('portal.result', { ok: r.ok, reason: r.ok ? undefined : r.reason });
  if (!r.ok) return r.reason === 'unavailable' ? null : { ok: false, message: r.message };
  if (isBlankFrame(r.rgba)) {
    log('portal.blank');
    return null;
  }
  return ok(r.base64, 'portal selection');
}

export async function captureWindowFlow(
  opts: { target?: string; display?: boolean },
  deps: CaptureWindowDeps,
): Promise<CaptureWindowResult> {
  const log = deps.log ?? noop;
  log('flow.start', {
    target: opts.target ?? null,
    display: opts.display === true,
    chain: deps.chain,
    projectNames: deps.projectNames,
    selfTitle: deps.selfTitle,
  });
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
  // Titles and classes as the window source reported them: when inference picks
  // the "wrong" window the answer is almost always visible in this list.
  log('windows.listed', {
    count: windows.length,
    windows: windows.map((w) => ({ title: w.title, klass: w.klass ?? null })),
    selfSourceId: deps.selfSourceId ?? null,
    selfClasses: deps.selfClasses ?? [],
  });
  const inferred = inferWindow(windows, {
    target: opts.target,
    projectNames: deps.projectNames,
    selfSourceId: deps.selfSourceId,
    selfClasses: deps.selfClasses,
  });

  log('infer.result', {
    kind: inferred.kind,
    pick: inferred.kind === 'pick' ? inferred.window.title : undefined,
    pickClass: inferred.kind === 'pick' ? (inferred.window.klass ?? null) : undefined,
    titles: 'titles' in inferred ? inferred.titles : undefined,
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
    log('portal.attempt', { why: inferred.kind });
    const viaPortal = await captureViaPortal(deps);
    if (viaPortal) return viaPortal;
  } else {
    log('portal.skipped', { why: 'explicit target' });
  }

  if (inferred.kind === 'none') {
    log('result.noWindow');
    return { ok: false, message: 'no external app window found' };
  }
  log('result.emptyFrame');
  return { ok: false, message: 'capture returned an empty frame (screen-recording permission or Wayland portal?)' };
}
