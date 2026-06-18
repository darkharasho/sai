import type { BackendName } from './selectBackend';
import { inferWindow } from './inferWindow';
import { isBlankFrame } from './blankFrame';
import { activeWindowIsTarget } from './activeGuard';

export interface CaptureWindowDeps {
  listWindows: () => Promise<Array<{ id: string; title: string }>>;
  captureSource: (id: string) => Promise<{ base64: string; rgba: Buffer; empty: boolean }>;
  captureCli: (b: 'spectacle' | 'grim' | 'screencapture') => Promise<{ base64: string; rgba: Buffer }>;
  chain: BackendName[];
  projectNames: string[];
  selfSourceId?: string;
  raiseWindow?: (title: string) => Promise<boolean>;
  activeWindowTitle?: () => Promise<string | null>;
  selfTitle?: string;
}

export type CaptureWindowResult =
  | { ok: true; __mcpImage: { base64: string; mimeType: 'image/png' }; window?: string }
  | { ok: false; candidates?: string[]; message: string };

export async function captureWindowFlow(
  opts: { target?: string },
  deps: CaptureWindowDeps,
): Promise<CaptureWindowResult> {
  const windows = await deps.listWindows();
  const inferred = inferWindow(windows, {
    target: opts.target,
    projectNames: deps.projectNames,
    selfSourceId: deps.selfSourceId,
  });

  if (inferred.kind === 'none') return { ok: false, message: 'no external app window found' };
  if (inferred.kind === 'candidates') {
    return { ok: false, candidates: inferred.titles, message: 'Multiple windows matched; pass `target` to disambiguate.' };
  }

  const pick = inferred.window;
  for (const backend of deps.chain) {
    try {
      if (backend === 'desktopCapturer') {
        const shot = await deps.captureSource(pick.id);
        if (!shot.empty && !isBlankFrame(shot.rgba)) {
          return { ok: true, __mcpImage: { base64: shot.base64, mimeType: 'image/png' }, window: pick.title };
        }
      } else {
        // CLI backends capture the ACTIVE window (spectacle) or whole screen
        // (grim/screencapture), NOT a specific window. To uphold the no-SAI
        // guarantee, best-effort raise the intended window, then only proceed if
        // the active window is confirmed to be the target and is not SAI.
        if (deps.raiseWindow) await deps.raiseWindow(pick.title);
        const activeTitle = deps.activeWindowTitle ? await deps.activeWindowTitle() : null;
        if (!activeWindowIsTarget(activeTitle, pick.title, deps.selfTitle ?? '')) {
          return {
            ok: false,
            message: `Could not bring "${pick.title}" to the foreground to capture it (your compositor may block programmatic window raising). Focus that window, then ask again.`,
          };
        }
        const shot = await deps.captureCli(backend);
        if (!isBlankFrame(shot.rgba)) {
          return { ok: true, __mcpImage: { base64: shot.base64, mimeType: 'image/png' }, window: pick.title };
        }
      }
    } catch {
      // advance to next backend
    }
  }
  return { ok: false, message: 'capture returned an empty frame (screen-recording permission or Wayland portal?)' };
}
